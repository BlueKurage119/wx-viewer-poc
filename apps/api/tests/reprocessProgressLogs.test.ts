import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import {
  TERMINAL_DEFINITIONS,
  VENUE_IDS,
  type UtcIso8601String,
  type MonitoringVenueReprocessingStatus,
} from '@wx-viewer-poc/shared';
import { initializeDatabase } from '../src/database/index.js';
import {
  countPendingWarningTelegramReceptions,
  recordTelegramReception,
  upsertTelegramReceptionAdoption,
} from '../src/repositories/index.js';
import { reprocessPendingWarningTelegramReceptions } from '../src/polling/jmaWarningTelegramProcessor.js';
import { buildStoppedPollingStatus } from '../src/polling/index.js';
import { loadPollingScheduleConfig } from '../src/config/index.js';
import { InMemoryStartupProgressTracker } from '../src/monitoring/startupProgressTracker.js';
import type { WeatherApiService } from '../src/services/weatherApiService.js';
import type { NowcastApiService } from '../src/services/nowcastApiService.js';
import type { KikikuruApiService } from '../src/services/kikikuruApiService.js';
import { createMonitoringStatusService } from '../src/monitoring/monitoringStatusService.js';
import { resolveVenueWarningContext } from '../src/venueForecastTargets.js';
import { startServer } from '../src/server.js';
import type {
  JmaXmlPollingService,
  InitialFetchPhase,
} from '../src/polling/jmaXmlPollingService.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

function createTempDb(): {
  connection: ReturnType<typeof initializeDatabase>['connection'];
  databasePath: string;
  cleanup: () => void;
} {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-reprocess-logs-'));
  const databasePath = join(directory, 'test.sqlite3');
  const context = initializeDatabase({ databasePath, migrationsDirectory });
  return {
    connection: context.connection,
    databasePath,
    cleanup: () => {
      context.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function insertSampleTelegram(
  connection: ReturnType<typeof initializeDatabase>['connection'],
  index: number,
  options?: {
    readonly telegramType?: string;
    readonly venueIdToAdopt?: 'east' | 'trc';
  },
): number {
  const telegramType = options?.telegramType ?? 'VPWW55';
  const xmlBody = `<?xml version="1.0" encoding="UTF-8"?><Report><Control><Title>気象警報・注意報</Title></Control><Head><Title>東京都気象警報・注意報</Title><ReportDateTime>2026-09-16T00:00:00Z</ReportDateTime><TargetDateTime>2026-09-16T00:00:00Z</TargetDateTime><EventID>EVENT_${index}</EventID><InfoType>発表</InfoType><Serial>1</Serial></Head><Body><Warning type="気象警報・注意報（市町村等）"><Item><Area><Name>千代田区</Name><Code>1310100</Code></Area><Kind><Name>大雨注意報</Name><Code>10</Code><Status>発表</Status></Kind></Item></Warning></Body></Report>`;
  const contentHash = crypto.createHash('sha256').update(xmlBody).digest('hex');

  const reception = recordTelegramReception(connection, {
    fetchAttemptId: null,
    feedKind: 'extra',
    feedEntryId: `entry-${index}-${contentHash.slice(0, 8)}`,
    documentUrl: `https://example.com/xml/${telegramType}_${index}.xml`,
    telegramType,
    title: '東京都気象警報・注意報',
    controlStatus: 'normal',
    infoType: '発表',
    eventId: `EVENT_${index}`,
    serial: '1',
    controlDateTime: '2026-09-16T00:00:00Z',
    reportDateTime: '2026-09-16T00:00:00Z',
    targetDateTime: '2026-09-16T00:00:00Z',
    receivedAt: new Date(Date.now() + index * 1000).toISOString(),
    adoptions: [],
    rawBody: xmlBody,
    bodyBytes: Buffer.byteLength(xmlBody, 'utf-8'),
    contentHash,
    areas: [
      {
        areaCode: '1310100',
        areaName: '千代田区',
        codeType: '気象警報・注意報（市町村等）',
        sequence: 1,
      },
    ],
  });

  if (options?.venueIdToAdopt) {
    upsertTelegramReceptionAdoption(connection, reception.id, {
      venueId: options.venueIdToAdopt,
      adoptionResult: '警報・注意報として解析済み',
      adoptionReason: null,
      adoptionDecidedAt: '2026-09-16T00:01:00Z',
    });
  }

  return reception.id;
}

// --------------------------------------------------------------------------
// 4.1 未処理電文カウント（countPendingWarningTelegramReceptions）
// --------------------------------------------------------------------------
test('4.1 countPendingWarningTelegramReceptions: 未処理電文が0件のとき0を返す', () => {
  const { connection, cleanup } = createTempDb();
  try {
    const count = countPendingWarningTelegramReceptions(connection, 'east');
    assert.equal(count, 0);
  } finally {
    cleanup();
  }
});

test('4.1 countPendingWarningTelegramReceptions: 未処理電文が3件挿入されているとき3を返す', () => {
  const { connection, cleanup } = createTempDb();
  try {
    insertSampleTelegram(connection, 1);
    insertSampleTelegram(connection, 2);
    insertSampleTelegram(connection, 3);

    const countEast = countPendingWarningTelegramReceptions(connection, 'east');
    const countTrc = countPendingWarningTelegramReceptions(connection, 'trc');
    assert.equal(countEast, 3);
    assert.equal(countTrc, 3);
  } finally {
    cleanup();
  }
});

test('4.1 countPendingWarningTelegramReceptions: eastのみ採用判定済みの電文がある場合、eastは0、trcは1を返す（会場別の判定分離）', () => {
  const { connection, cleanup } = createTempDb();
  try {
    insertSampleTelegram(connection, 1, { venueIdToAdopt: 'east' });

    const countEast = countPendingWarningTelegramReceptions(connection, 'east');
    const countTrc = countPendingWarningTelegramReceptions(connection, 'trc');
    assert.equal(countEast, 0);
    assert.equal(countTrc, 1);
  } finally {
    cleanup();
  }
});

// --------------------------------------------------------------------------
// 4.2 再処理進捗ログ出力（reprocessPendingWarningTelegramReceptions）
// --------------------------------------------------------------------------
test('4.2 reprocessPendingWarningTelegramReceptions: 通常時（0件）は1行のみ出力し早期終了する', async () => {
  const { connection, cleanup } = createTempDb();
  try {
    const venue = resolveVenueWarningContext('east');
    const logs: string[] = [];
    const tracker = new InMemoryStartupProgressTracker();

    const result = await reprocessPendingWarningTelegramReceptions(
      connection,
      venue,
      () => '2026-09-16T00:00:00Z',
      undefined,
      {
        logger: (msg) => logs.push(msg),
        progressTracker: tracker,
      },
    );

    assert.equal(result.processedCount, 0);
    assert.equal(result.elapsedMs, 0);
    assert.equal(logs.length, 1);
    assert.equal(logs[0], "[api] found 0 pending warning telegrams for venue 'east'");

    // トラッカーも completed になる
    const status = tracker.getVenueReprocessingStatus('east');
    assert.equal(status.status, 'completed');
    assert.equal(status.total, 0);
    assert.equal(status.processedCount, 0);
    assert.equal(status.elapsedMs, 0);
  } finally {
    cleanup();
  }
});

test('4.2 reprocessPendingWarningTelegramReceptions: 件数あり（250件）のとき開始、バッチ進捗（100件毎）、完了ログが順に出力される', async () => {
  const { connection, cleanup } = createTempDb();
  try {
    for (let i = 1; i <= 250; i++) {
      insertSampleTelegram(connection, i);
    }

    const venue = resolveVenueWarningContext('east');
    const logs: string[] = [];
    const tracker = new InMemoryStartupProgressTracker();

    const result = await reprocessPendingWarningTelegramReceptions(
      connection,
      venue,
      () => '2026-09-16T00:00:00Z',
      undefined,
      {
        logger: (msg) => logs.push(msg),
        progressTracker: tracker,
        batchLogInterval: 100,
      },
    );

    assert.equal(result.processedCount, 250);
    assert.ok(result.elapsedMs >= 0);

    // ログ順序の検証:
    // 1. 開始時: [api] found 250 pending warning telegrams for venue 'east', reprocessing...
    // 2. バッチ進捗: [api] reprocessed 100/250 telegrams for venue 'east'...
    // 3. バッチ進捗: [api] reprocessed 200/250 telegrams for venue 'east'...
    // 4. 完了時: [api] finished reprocessing pending warning telegrams for venue 'east' (250 items, <elapsedMs>ms)
    assert.equal(logs.length, 4);
    assert.equal(
      logs[0],
      "[api] found 250 pending warning telegrams for venue 'east', reprocessing...",
    );
    assert.equal(logs[1], "[api] reprocessed 100/250 telegrams for venue 'east'...");
    assert.equal(logs[2], "[api] reprocessed 200/250 telegrams for venue 'east'...");
    assert.match(
      logs[3]!,
      /^\[api\] finished reprocessing pending warning telegrams for venue 'east' \(250 items, \d+ms\)$/,
    );

    // トラッカーの完了状態検証
    const status = tracker.getVenueReprocessingStatus('east');
    assert.equal(status.status, 'completed');
    assert.equal(status.total, 250);
    assert.equal(status.processedCount, 250);
    assert.ok(status.elapsedMs !== null && status.elapsedMs >= 0);
  } finally {
    cleanup();
  }
});

test('4.2 reprocessPendingWarningTelegramReceptions: 静穏性（options 未指定または logger 未指定時はログ出力なし）', async () => {
  const { connection, cleanup } = createTempDb();
  try {
    insertSampleTelegram(connection, 1);
    const venue = resolveVenueWarningContext('east');

    // 既存のコンソール出力を汚染しないことを確認（options なし）
    const result = await reprocessPendingWarningTelegramReceptions(
      connection,
      venue,
      () => '2026-09-16T00:00:00Z',
    );
    assert.equal(result.processedCount, 1);
    assert.ok(result.elapsedMs >= 0);
  } finally {
    cleanup();
  }
});

// --------------------------------------------------------------------------
// 4.3 初回XMLフィード取得フェーズのログ出力
// --------------------------------------------------------------------------
test('4.3 初回XMLフィード取得フェーズのログ出力（running / completed / failed）', async () => {
  const { databasePath, cleanup } = createTempDb();
  try {
    let capturedPhaseListener: ((phase: InitialFetchPhase) => void) | undefined;

    const fakePollingService = {
      onInitialFetchPhaseChange: (listener: (phase: InitialFetchPhase) => void) => {
        capturedPhaseListener = listener;
      },
      onInitialFetchCompleted: () => {},
      getStatus: () => ({
        initialFetch: { phase: 'not_started' as const, result: null },
      }),
      setScheduledIntervalSeconds: () => {},
      start: async () => {},
      stop: async () => {},
    } as unknown as JmaXmlPollingService;

    const originalLog = console.log;
    const originalError = console.error;
    const consoleLogs: string[] = [];
    const consoleErrors: string[] = [];

    console.log = (...args: unknown[]) => {
      consoleLogs.push(args.map(String).join(' '));
    };
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(' '));
    };

    let server;
    try {
      server = await startServer({
        config: { databasePath, migrationsDirectory },
        port: 0,
        enablePolling: true,
        pollingService: fakePollingService,
      });

      assert.ok(capturedPhaseListener, 'onInitialFetchPhaseChange リスナーが登録されていること');

      // 1. running への遷移
      capturedPhaseListener!('running');
      assert.ok(consoleLogs.includes('[api] starting initial JMA XML feed fetch...'));

      // 2. completed への遷移
      capturedPhaseListener!('completed');
      assert.ok(
        consoleLogs.some((msg) =>
          /^\[api\] completed initial JMA XML feed fetch \(\d+ms\)$/.test(msg),
        ),
      );

      // 3. failed への遷移（再計測）
      capturedPhaseListener!('running');
      capturedPhaseListener!('failed');
      assert.ok(
        consoleErrors.some((msg) =>
          /^\[api\] failed initial JMA XML feed fetch \(\d+ms\)$/.test(msg),
        ),
      );
    } finally {
      console.log = originalLog;
      console.error = originalError;
      if (server) {
        await server.close();
      }
    }
  } finally {
    cleanup();
  }
});

// --------------------------------------------------------------------------
// 4.4 クラウド移植・監視端末向けAPI構造（進捗トラッカーと /api/monitoring/status）
// --------------------------------------------------------------------------
test('4.4 InMemoryStartupProgressTracker: 単体で開始・更新・完了に応じたステータスを正しく記録・取得できる', () => {
  const fixedNow = '2026-09-16T01:00:00.000Z' as UtcIso8601String;
  const tracker = new InMemoryStartupProgressTracker(() => fixedNow);

  // 初期状態
  for (const venueId of VENUE_IDS) {
    const status = tracker.getVenueReprocessingStatus(venueId);
    assert.deepEqual(status, {
      status: 'idle',
      total: 0,
      processedCount: 0,
      startedAt: null,
      finishedAt: null,
      elapsedMs: null,
    });
  }

  // 0件での開始 -> 即時 completed
  tracker.startVenueReprocessing('east', 0);
  assert.deepEqual(tracker.getVenueReprocessingStatus('east'), {
    status: 'completed',
    total: 0,
    processedCount: 0,
    startedAt: fixedNow,
    finishedAt: fixedNow,
    elapsedMs: 0,
  });

  // 100件での開始 -> running
  const startedAt = '2026-09-16T01:05:00.000Z' as UtcIso8601String;
  tracker.startVenueReprocessing('trc', 100, startedAt);
  assert.deepEqual(tracker.getVenueReprocessingStatus('trc'), {
    status: 'running',
    total: 100,
    processedCount: 0,
    startedAt,
    finishedAt: null,
    elapsedMs: null,
  });

  // 進捗更新
  tracker.updateVenueReprocessing('trc', 50);
  assert.equal(tracker.getVenueReprocessingStatus('trc').processedCount, 50);
  assert.equal(tracker.getVenueReprocessingStatus('trc').status, 'running');

  // 完了
  const finishedAt = '2026-09-16T01:05:02.500Z' as UtcIso8601String;
  tracker.completeVenueReprocessing('trc', 100, 2500, finishedAt);
  assert.deepEqual(tracker.getVenueReprocessingStatus('trc'), {
    status: 'completed',
    total: 100,
    processedCount: 100,
    startedAt,
    finishedAt,
    elapsedMs: 2500,
  });
});

test('4.4 監視API (/api/monitoring/status): venues に reprocessing が含まれ、進捗状態が反映される', async () => {
  const { connection, cleanup } = createTempDb();
  try {
    const tracker = new InMemoryStartupProgressTracker();
    tracker.startVenueReprocessing('east', 150, '2026-09-16T02:00:00.000Z' as UtcIso8601String);
    tracker.updateVenueReprocessing('east', 60);

    tracker.startVenueReprocessing('trc', 0);

    const schedule = loadPollingScheduleConfig();
    const service = createMonitoringStatusService({
      connection,
      scheduler: {
        getStatus: () => buildStoppedPollingStatus(new Date(), schedule),
        isRunningNow: () => false,
      },
      xmlPollingService: {
        getStatus: () => ({
          initialFetch: { phase: 'completed', result: null },
        }),
      },
      fetchHealthMonitor: {
        getLastAggregate: () => null,
      },
      startupInitialization: {
        getStatus: () => ({
          initialFetchPhase: 'completed',
          evaluatedVenueIds: new Set(['east', 'trc']),
        }),
      },
      progressTracker: tracker,
      weatherApi: {
        getWarnings: () => ({
          metadata: {
            availability: 'available',
            issuedAt: null,
            validAt: null,
            fetchedAt: null,
            lastSuccessAt: null,
          },
          data: null,
        }),
        getWarningTimeseries: () => ({
          metadata: {
            availability: 'available',
            issuedAt: null,
            validAt: null,
            fetchedAt: null,
            lastSuccessAt: null,
          },
          data: null,
        }),
        getEarlyWarning: () => ({
          near: {
            metadata: {
              availability: 'available',
              issuedAt: null,
              validAt: null,
              fetchedAt: null,
              lastSuccessAt: null,
            },
            data: null,
          },
          far: {
            metadata: {
              availability: 'available',
              issuedAt: null,
              validAt: null,
              fetchedAt: null,
              lastSuccessAt: null,
            },
            data: null,
          },
        }),
        getAmedas: () => ({
          metadata: {
            availability: 'available',
            issuedAt: null,
            validAt: null,
            fetchedAt: null,
            lastSuccessAt: null,
          },
          data: null,
        }),
        getAreaTimeseries: () => ({
          metadata: {
            availability: 'available',
            issuedAt: null,
            validAt: null,
            fetchedAt: null,
            lastSuccessAt: null,
          },
          data: null,
        }),
        getBulletins: () => ({
          availability: 'available',
          bulletins: [],
        }),
      } as unknown as WeatherApiService,
      nowcastApi: {
        getTimes: () => ({
          products: {
            N1: {
              metadata: {
                availability: 'available',
                issuedAt: null,
                validAt: null,
                fetchedAt: null,
                lastSuccessAt: null,
              },
              data: null,
            },
            N2: {
              metadata: {
                availability: 'available',
                issuedAt: null,
                validAt: null,
                fetchedAt: null,
                lastSuccessAt: null,
              },
              data: null,
            },
          },
        }),
      } as unknown as NowcastApiService,
      kikikuruApi: {
        getTimes: () => ({
          layers: {},
        }),
      } as unknown as KikikuruApiService,
      fetchHealthConfig: {
        evaluationIntervalSeconds: 60,
        delayedConsecutiveFailures: 3,
        delayedIntervalMultiplier: 3,
        abnormalConsecutiveFailures: 5,
        abnormalElapsedSeconds: 600,
        maxScanAttempts: 10,
      },
      serverGenerationId: 'gen-test-1',
      now: () => '2026-09-16T02:00:00Z' as UtcIso8601String,
    });

    const terminal = TERMINAL_DEFINITIONS.find((t) => t.venueId === 'east')!;
    const status = service.getStatus(terminal);

    assert.equal(status.venues.length, 2);
    const eastVenue = status.venues.find((v) => v.venueId === 'east')!;
    const trcVenue = status.venues.find((v) => v.venueId === 'trc')!;

    // east: 再処理中 (running)
    assert.deepEqual(eastVenue.reprocessing, {
      status: 'running',
      total: 150,
      processedCount: 60,
      startedAt: '2026-09-16T02:00:00.000Z',
      finishedAt: null,
      elapsedMs: null,
    });

    // trc: 0件完了 (completed)
    assert.equal(trcVenue.reprocessing.status, 'completed');
    assert.equal(trcVenue.reprocessing.total, 0);
    assert.equal(trcVenue.reprocessing.processedCount, 0);
    assert.equal(trcVenue.reprocessing.elapsedMs, 0);
  } finally {
    cleanup();
  }
});

test('4.4 監視API HTTPエンドポイント: GET /api/monitoring/status の venues に reprocessing プロパティが正しく返される', async () => {
  const { databasePath, cleanup } = createTempDb();
  let server;
  try {
    server = await startServer({
      config: { databasePath, migrationsDirectory },
      port: 0,
      enablePolling: false,
    });

    const res = await fetch(
      `http://127.0.0.1:${server.port}/api/monitoring/status?terminalId=hkeagh01`,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      venues: readonly {
        venueId: string;
        reprocessing: MonitoringVenueReprocessingStatus;
      }[];
    };

    assert.ok(Array.isArray(body.venues));
    assert.equal(body.venues.length, 2);

    for (const venue of body.venues) {
      assert.ok(venue.reprocessing, 'reprocessing オブジェクトが存在すること');
      assert.ok(
        ['idle', 'running', 'completed'].includes(venue.reprocessing.status),
        `status が有効な値であること: ${venue.reprocessing.status}`,
      );
      assert.equal(typeof venue.reprocessing.total, 'number');
      assert.equal(typeof venue.reprocessing.processedCount, 'number');
      // startedAt, finishedAt, elapsedMs の存在確認（キーが存在すること）
      assert.ok('startedAt' in venue.reprocessing);
      assert.ok('finishedAt' in venue.reprocessing);
      assert.ok('elapsedMs' in venue.reprocessing);
    }
  } finally {
    if (server) {
      await server.close();
    }
    cleanup();
  }
});
