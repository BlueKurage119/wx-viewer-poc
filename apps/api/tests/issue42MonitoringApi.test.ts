import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import test from 'node:test';

import {
  EXCERPT_MAX_CHARS,
  PROCESSING_FAILURE_SAMPLE_LIMIT,
  PROCESSING_WINDOW_HOURS,
  type UtcIso8601String,
} from '@wx-viewer-poc/shared';
import { initializeDatabase } from '../src/database/index.js';
import { createApp } from '../src/app.js';
import { createWeatherApiService } from '../src/services/weatherApiService.js';
import type { WeatherApiService } from '../src/services/weatherApiService.js';
import type { NowcastApiService } from '../src/services/nowcastApiService.js';
import type { KikikuruApiService } from '../src/services/kikikuruApiService.js';
import { recordTelegramReception } from '../src/repositories/telegramReceptionRepository.js';
import { recordOperationHistory } from '../src/repositories/operationHistoryRepository.js';
import { recordNotificationOutputHistory } from '../src/repositories/notificationOutputHistoryRepository.js';
import {
  createMonitoringStatusService,
  type MonitoringStatusServiceDependencies,
} from '../src/monitoring/monitoringStatusService.js';
import { createMonitoringProcessingService } from '../src/monitoring/monitoringProcessingService.js';
import { createMonitoringHistoryService } from '../src/monitoring/monitoringHistoryService.js';
import type { TimeBasedPollingStatus } from '../src/polling/timeBasedPollingScheduler.js';
import type { JmaXmlPollingStatus } from '../src/polling/jmaXmlPollingService.js';
import type { FetchHealthAggregate } from '../src/monitoring/fetchHealthEvaluator.js';
import type { StartupNotificationInitializationStatus } from '../src/notifications/startupNotificationService.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');
const FIXED_NOW = '2026-09-15T10:00:00.000Z' as UtcIso8601String;

function createDb() {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-monitoring-'));
  const context = initializeDatabase({
    databasePath: join(directory, 'test.sqlite3'),
    migrationsDirectory,
  });
  return { context, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

function startTestServer(app: ReturnType<typeof createApp>): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const server: Server = app.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        baseUrl: `http://localhost:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

const EMPTY_PERIOD = {
  start: '00:00',
  end: '24:00' as unknown as string,
  xmlSeconds: 60,
  imageCatalogSeconds: 60,
  amedasSeconds: 60,
  nowcastEnabled: true,
  kikikuruEnabled: true,
};

function fakeSchedulerStatus(): TimeBasedPollingStatus {
  const period = { ...EMPTY_PERIOD, end: '24:00' };
  const src = (source: 'xml' | 'nowcast' | 'kikikuru' | 'amedas') => ({
    source,
    period,
    state: 'waiting' as const,
    intervalSeconds: 60,
    nextRunAt: FIXED_NOW,
  });
  return {
    period,
    nextPeriodChangeAt: FIXED_NOW,
    sources: {
      xml: src('xml'),
      nowcast: src('nowcast'),
      kikikuru: src('kikikuru'),
      amedas: src('amedas'),
    },
  };
}

function fakeXmlStatus(
  overrides?: Partial<JmaXmlPollingStatus['initialFetch']>,
): JmaXmlPollingStatus {
  return {
    isRunning: true,
    initialFetch: {
      phase: 'completed',
      result: {
        completed: true,
        startedAt: FIXED_NOW,
        finishedAt: FIXED_NOW,
        failedFeedKinds: [],
        cycleResult: null,
        errorReason: null,
      },
      ...overrides,
    },
    lastCycleResult: null,
    feedStatuses: {
      regular: {
        feedKind: 'regular',
        consecutiveFailures: 0,
        isWaiting: false,
        waitingReason: null,
        nextAllowedFetchAt: null,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
      },
      extra: {
        feedKind: 'extra',
        consecutiveFailures: 0,
        isWaiting: false,
        waitingReason: null,
        nextAllowedFetchAt: null,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
      },
      regular_l: {
        feedKind: 'regular_l',
        consecutiveFailures: 0,
        isWaiting: false,
        waitingReason: null,
        nextAllowedFetchAt: null,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
      },
      extra_l: {
        feedKind: 'extra_l',
        consecutiveFailures: 0,
        isWaiting: false,
        waitingReason: null,
        nextAllowedFetchAt: null,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
      },
    },
    feedFreshness: {
      regular: { availability: 'available', lastSuccessAt: FIXED_NOW, staleAfterSeconds: 300 },
      extra: { availability: 'available', lastSuccessAt: FIXED_NOW, staleAfterSeconds: 300 },
    },
  };
}

function stubNowcastApi(): NowcastApiService {
  const metadata = {
    source: null,
    issuedAt: null,
    validAt: null,
    validFrom: null,
    validTo: null,
    fetchedAt: null,
    lastSuccessAt: null,
    availability: 'unavailable' as const,
    sourceVersion: null,
  };
  return {
    getTimes: (
      terminal: { id: string; venueId: 'east' | 'trc' },
      controlStatus: 'normal' | 'training' | 'test',
    ) => ({
      terminalId: terminal.id,
      venueId: terminal.venueId,
      controlStatus,
      isTraining: controlStatus === 'training',
      evaluatedAt: FIXED_NOW,
      status: 'ok',
      window: { from: FIXED_NOW, to: FIXED_NOW },
      catalogAccess: { allowed: true, reason: null, nextAllowedAt: FIXED_NOW },
      imageAccess: { allowed: true, reason: null, nextAllowedAt: FIXED_NOW },
      allowedZooms: [10],
      products: {
        N1: { metadata, data: null },
        N2: { metadata, data: null },
      },
    }),
    getTile: async () => ({
      kind: 'error',
      httpStatus: 500,
      error: { status: 'error', code: 'tile_read_failed' },
    }),
  };
}

function stubKikikuruApi(): KikikuruApiService {
  const metadata = {
    source: null,
    issuedAt: null,
    validAt: null,
    validFrom: null,
    validTo: null,
    fetchedAt: null,
    lastSuccessAt: null,
    availability: 'unavailable' as const,
    sourceVersion: null,
  };
  return {
    getTimes: (
      terminal: { id: string; venueId: 'east' | 'trc' },
      controlStatus: 'normal' | 'training' | 'test',
    ) => ({
      terminalId: terminal.id,
      venueId: terminal.venueId,
      controlStatus,
      isTraining: controlStatus === 'training',
      evaluatedAt: FIXED_NOW,
      status: 'ok',
      catalogAccess: { allowed: true, reason: null, nextAllowedAt: FIXED_NOW },
      imageAccess: { allowed: true, reason: null, nextAllowedAt: FIXED_NOW },
      allowedZooms: [10],
      layers: {
        heavyrain: { metadata, data: null },
        inund: { metadata, data: null },
        land: { metadata, data: null },
      },
    }),
    getTile: async () => ({
      kind: 'error',
      httpStatus: 500,
      error: { status: 'error', code: 'tile_read_failed' },
    }),
  };
}

/**
 * AC11: availability の3状態(available/stale/unavailable)が実際に共存することを検証するため、
 * weatherApi をスタブして warning=available, warning_timeseries=stale を注入する。
 * issuedAt/fetchedAt は保持された値のまま返ることを確認できるよう固定値を使う。
 */
const STUB_WARNING_ISSUED_AT = '2026-09-15T09:00:00.000Z' as UtcIso8601String;
const STUB_WARNING_FETCHED_AT = '2026-09-15T09:05:00.000Z' as UtcIso8601String;
const STUB_TIMESERIES_ISSUED_AT = '2026-09-15T08:00:00.000Z' as UtcIso8601String;
const STUB_TIMESERIES_FETCHED_AT = '2026-09-15T08:10:00.000Z' as UtcIso8601String;

function stubWeatherApi(): WeatherApiService {
  const unavailableMetadata = {
    source: null,
    issuedAt: null,
    validAt: null,
    validFrom: null,
    validTo: null,
    fetchedAt: null,
    lastSuccessAt: null,
    availability: 'unavailable' as const,
    sourceVersion: null,
  };
  const baseContext = (
    terminal: { id: string; venueId: 'east' | 'trc' },
    controlStatus: 'normal' | 'training' | 'test',
  ) => ({
    terminalId: terminal.id,
    venueId: terminal.venueId,
    controlStatus,
    isTraining: controlStatus === 'training',
    evaluatedAt: FIXED_NOW,
  });

  return {
    getWarnings: (terminal, controlStatus) => ({
      ...baseContext(terminal, controlStatus),
      area: { code: '000', name: 'stub' },
      metadata: {
        source: 'xml',
        issuedAt: STUB_WARNING_ISSUED_AT,
        validAt: null,
        validFrom: null,
        validTo: null,
        fetchedAt: STUB_WARNING_FETCHED_AT,
        lastSuccessAt: STUB_WARNING_FETCHED_AT,
        availability: 'available',
        sourceVersion: null,
      },
      data: { items: [] },
      capabilities: { unsupportedKindCodes: ['04', '18'], supplementSource: 'warning-timeseries' },
    }),
    getWarningTimeseries: (terminal, controlStatus) => ({
      ...baseContext(terminal, controlStatus),
      area: { code: '000', name: 'stub' },
      metadata: {
        source: 'xml',
        issuedAt: STUB_TIMESERIES_ISSUED_AT,
        validAt: null,
        validFrom: null,
        validTo: null,
        fetchedAt: STUB_TIMESERIES_FETCHED_AT,
        lastSuccessAt: STUB_TIMESERIES_FETCHED_AT,
        availability: 'stale',
        sourceVersion: null,
      },
      data: null,
    }),
    getEarlyWarning: (terminal, controlStatus) => ({
      ...baseContext(terminal, controlStatus),
      near: { area: { code: '000', name: 'stub' }, metadata: unavailableMetadata, data: null },
      far: { area: { code: '000', name: 'stub' }, metadata: unavailableMetadata, data: null },
    }),
    getAreaTimeseries: (terminal, controlStatus) => ({
      ...baseContext(terminal, controlStatus),
      area: { code: '000', name: 'stub' },
      metadata: unavailableMetadata,
      data: null,
      capabilities: {
        blockIds: ['region-3hour', 'temperature-3hour'],
        elements: ['weather', 'wind_direction', 'wind_speed_rank', 'temperature'],
        unsupportedFields: ['weatherCode', 'windSpeedRange', 'windSpeedDescription'],
      },
    }),
    getAmedas: (terminal, controlStatus) => ({
      ...baseContext(terminal, controlStatus),
      station: { code: '000', name: 'stub' },
      metadata: unavailableMetadata,
      data: null,
      capabilities: {
        publicElements: ['temp', 'humidity', 'windDirection', 'wind', 'precipitation1h'],
        unsupportedElements: [],
      },
    }),
    getBulletins: (terminal, controlStatus) => ({
      ...baseContext(terminal, controlStatus),
      area: { code: '000', name: 'stub' },
      availability: 'unavailable',
      bulletins: [],
      capabilities: {
        telegramTypes: ['VPBS50', 'VPHW50', 'VPHW51'],
        sightingUndeterminableTypes: ['VPHW50', 'VPBS50'],
        unsupportedFields: ['editorialOffice', 'publishingOffice'],
        deduplicated: false,
      },
    }),
  };
}

function fakeStartupStatus(
  overrides?: Partial<StartupNotificationInitializationStatus>,
): StartupNotificationInitializationStatus {
  return {
    initialFetchPhase: 'completed',
    evaluatedVenueIds: new Set(['east', 'trc']),
    ...overrides,
  };
}

interface BuildAppOptions {
  readonly connection: ReturnType<typeof initializeDatabase>['connection'];
  readonly schedulerStatus?: TimeBasedPollingStatus;
  readonly schedulerRunning?: boolean;
  readonly xmlStatus?: JmaXmlPollingStatus;
  readonly aggregate?: FetchHealthAggregate | null;
  readonly startupStatus?: StartupNotificationInitializationStatus;
  readonly weatherApi?: WeatherApiService;
}

function buildApp(options: BuildAppOptions) {
  const weatherApi =
    options.weatherApi ??
    createWeatherApiService({
      connection: options.connection,
      now: () => FIXED_NOW,
    });
  const nowcastApi = stubNowcastApi();
  const kikikuruApi = stubKikikuruApi();

  const deps: MonitoringStatusServiceDependencies = {
    connection: options.connection,
    scheduler: {
      getStatus: () => options.schedulerStatus ?? fakeSchedulerStatus(),
      isRunningNow: () => options.schedulerRunning ?? true,
    },
    xmlPollingService: { getStatus: () => options.xmlStatus ?? fakeXmlStatus() },
    fetchHealthMonitor: { getLastAggregate: () => options.aggregate ?? null },
    startupInitialization: { getStatus: () => options.startupStatus ?? fakeStartupStatus() },
    weatherApi,
    nowcastApi,
    kikikuruApi,
    fetchHealthConfig: {
      evaluationIntervalSeconds: 30,
      delayedConsecutiveFailures: 2,
      delayedIntervalMultiplier: 3,
      abnormalConsecutiveFailures: 5,
      abnormalElapsedSeconds: 600,
      maxScanAttempts: 20,
    },
    serverGenerationId: 'gen-1',
    now: () => FIXED_NOW,
  };

  const monitoringStatus = createMonitoringStatusService(deps);
  const monitoringProcessing = createMonitoringProcessingService({
    connection: options.connection,
    serverGenerationId: 'gen-1',
    now: () => FIXED_NOW,
  });
  const monitoringHistory = createMonitoringHistoryService({
    connection: options.connection,
    now: () => FIXED_NOW,
  });

  return createApp({ monitoringStatus, monitoringProcessing, monitoringHistory });
}

test('AC1 クエリ検証（terminalId 欠落・余剰キー・重複・空文字・未知端末）', async () => {
  const { context, cleanup } = createDb();
  try {
    const app = buildApp({ connection: context.connection });
    const { baseUrl, close } = await startTestServer(app);
    try {
      for (const path of ['/api/monitoring/status', '/api/monitoring/processing']) {
        const invalidQueries = ['', 'venueId=east', 'terminalId=a&terminalId=b', 'terminalId='];
        for (const q of invalidQueries) {
          const res = await fetch(`${baseUrl}${path}?${q}`);
          assert.equal(res.status, 400, `${path}?${q}`);
          assert.deepEqual(await res.json(), { status: 'error', code: 'invalid_request' });
        }
        const notFound = await fetch(`${baseUrl}${path}?terminalId=zzz`);
        assert.equal(notFound.status, 404);
        assert.deepEqual(await notFound.json(), { status: 'error', code: 'terminal_not_found' });

        for (const terminalId of ['hkeagh01', 'kkeagh01', 'htrcph01', 'ktrcph01']) {
          const ok = await fetch(`${baseUrl}${path}?terminalId=${terminalId}`);
          assert.equal(ok.status, 200, `${path} terminalId=${terminalId}`);
        }
      }

      for (const path of [
        '/api/monitoring/receptions',
        '/api/monitoring/notification-outputs',
        '/api/monitoring/operations',
      ]) {
        const res = await fetch(`${baseUrl}${path}?unknownKey=1`);
        assert.equal(res.status, 400, path);
      }

      for (const idPath of ['abc', '-1', '1.5', '01', '%EF%BC%91']) {
        const res = await fetch(`${baseUrl}/api/monitoring/receptions/${idPath}`);
        assert.equal(res.status, 400, `id=${idPath}`);
      }
      // 空文字は URL パス構造上 :id セグメントとして表現できず一覧ルートに落ちるため、
      // 「空文字」の検証は「クエリキーが1つでもあれば400」の分岐で兼ねる（下記）。
      const notFoundReception = await fetch(`${baseUrl}/api/monitoring/receptions/999999`);
      assert.equal(notFoundReception.status, 404);
      assert.deepEqual(await notFoundReception.json(), {
        status: 'error',
        code: 'reception_not_found',
      });
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('AC2 セクション分離（確定事項1・AD-H063）: トップレベルキー集合が完全一致し、processing を含まない', async () => {
  const { context, cleanup } = createDb();
  try {
    const app = buildApp({ connection: context.connection });
    const { baseUrl, close } = await startTestServer(app);
    try {
      const res = await fetch(`${baseUrl}/api/monitoring/status?terminalId=hkeagh01`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      const keys = new Set(Object.keys(body));
      const expected = new Set([
        'status',
        'terminalId',
        'requestedVenueId',
        'serverGenerationId',
        'generatedAt',
        'operation',
        'health',
        'readiness',
        'venues',
        'information',
        'tiles',
      ]);
      assert.deepEqual(keys, expected);
      assert.equal('processing' in body, false);
      assert.equal('overallStatus' in body, false);
      assert.equal('ok' in body, false);
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('AC3 readiness が他セクションを保証しないこと（AD-H063）', async () => {
  const { context, cleanup } = createDb();
  try {
    const app = buildApp({
      connection: context.connection,
      xmlStatus: fakeXmlStatus(),
    });
    const { baseUrl, close } = await startTestServer(app);
    try {
      const res = await fetch(`${baseUrl}/api/monitoring/status?terminalId=hkeagh01`);
      const body = (await res.json()) as {
        readiness: {
          initialFetchPhase: string;
          feeds: readonly { feedKind: string; succeeded: boolean | null }[];
        };
        information: readonly { kind: string; availability: string }[];
      };
      assert.equal(body.readiness.initialFetchPhase, 'completed');
      const nowcastInfo = body.information.find((i) => i.kind === 'nowcast');
      assert.equal(nowcastInfo?.availability, 'unavailable');
      assert.equal(body.readiness.initialFetchPhase, 'completed');
      assert.equal(body.readiness.feeds.length, 4);
    } finally {
      await close();
    }

    // not_started のとき、feeds は全要素 succeeded:null（false に丸められない）
    const app2 = buildApp({
      connection: context.connection,
      xmlStatus: fakeXmlStatus() && {
        isRunning: false,
        initialFetch: { phase: 'not_started', result: null },
        lastCycleResult: null,
        feedStatuses: fakeXmlStatus().feedStatuses,
        feedFreshness: fakeXmlStatus().feedFreshness,
      },
    });
    const { baseUrl: baseUrl2, close: close2 } = await startTestServer(app2);
    try {
      const res2 = await fetch(`${baseUrl2}/api/monitoring/status?terminalId=hkeagh01`);
      const body2 = (await res2.json()) as {
        readiness: { feeds: readonly { succeeded: boolean | null }[] };
      };
      assert.equal(body2.readiness.feeds.length, 4);
      for (const feed of body2.readiness.feeds) {
        assert.equal(feed.succeeded, null);
      }
    } finally {
      await close2();
    }
  } finally {
    cleanup();
  }
});

test('AC4 タイルを健全性系列として返さないこと（確定事項4）', async () => {
  const { context, cleanup } = createDb();
  try {
    const app = buildApp({ connection: context.connection });
    const { baseUrl, close } = await startTestServer(app);
    try {
      const res = await fetch(`${baseUrl}/api/monitoring/status?terminalId=hkeagh01`);
      const body = (await res.json()) as {
        health: { sources: readonly { sourceId: string }[] };
        tiles: {
          healthMonitored: boolean;
          healthCriteriaStatus: string;
          layers: readonly Record<string, unknown>[];
        };
      };
      const sourceIds = new Set(body.health.sources.map((s) => s.sourceId));
      assert.deepEqual(
        sourceIds,
        new Set([
          'xml_regular',
          'xml_extra',
          'nowcast_target_times',
          'kikikuru_target_times',
          'amedas_latest_time',
          'amedas_point',
        ]),
      );
      assert.equal(body.tiles.healthMonitored, false);
      assert.equal(body.tiles.healthCriteriaStatus, 'undecided');

      // §4.3: tiles 自身は status フィールドを持たない。トップレベルキー集合の完全一致で検証する。
      const tilesKeys = new Set(Object.keys(body.tiles));
      assert.deepEqual(tilesKeys, new Set(['healthMonitored', 'healthCriteriaStatus', 'layers']));

      const layer0Keys = new Set(Object.keys(body.tiles.layers[0]!));
      assert.deepEqual(
        layer0Keys,
        new Set([
          'layer',
          'catalogAvailability',
          'catalogUpdatedAt',
          'availableFrameCount',
          'upstreamFetchAllowed',
          'nextUpstreamAllowedAt',
        ]),
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('AC5 健全性の未評価を正常に丸めないこと', async () => {
  const { context, cleanup } = createDb();
  try {
    const app = buildApp({ connection: context.connection, aggregate: null });
    const { baseUrl, close } = await startTestServer(app);
    try {
      const res = await fetch(`${baseUrl}/api/monitoring/status?terminalId=hkeagh01`);
      const body = (await res.json()) as {
        health: {
          evaluatedAt: string | null;
          worstStatus: string | null;
          worstSourceIds: readonly string[];
          sources: readonly {
            status: string | null;
            appliesElapsedCondition: boolean;
            sourceId: string;
          }[];
        };
      };
      assert.equal(body.health.evaluatedAt, null);
      assert.equal(body.health.worstStatus, null);
      assert.deepEqual(body.health.worstSourceIds, []);
      assert.equal(body.health.sources.length, 6);
      for (const s of body.health.sources) {
        assert.equal(s.status, null);
        assert.equal(s.lastDurationMs, null);
      }
      const amedasPoint = body.health.sources.find((s) => s.sourceId === 'amedas_point');
      assert.equal(amedasPoint?.appliesElapsedCondition, false);
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('K6: health.sources に lastDurationMs が含まれる（評価後は系列ごとの値）', async () => {
  const { context, cleanup } = createDb();
  try {
    const aggregate: FetchHealthAggregate = {
      evaluatedAt: FIXED_NOW,
      status: 'normal',
      worstSourceIds: [],
      sources: [
        {
          sourceId: 'xml_regular',
          status: 'normal',
          reasons: [],
          lastAttemptAt: FIXED_NOW,
          lastSuccessAt: FIXED_NOW,
          maxConsecutiveFailures: 0,
          intervalSeconds: 60,
          lastDurationMs: 1234,
        },
        {
          sourceId: 'xml_extra',
          status: 'normal',
          reasons: [],
          lastAttemptAt: FIXED_NOW,
          lastSuccessAt: FIXED_NOW,
          maxConsecutiveFailures: 0,
          intervalSeconds: 60,
          lastDurationMs: 567,
        },
        {
          sourceId: 'nowcast_target_times',
          status: 'normal',
          reasons: [],
          lastAttemptAt: FIXED_NOW,
          lastSuccessAt: FIXED_NOW,
          maxConsecutiveFailures: 0,
          intervalSeconds: 60,
          lastDurationMs: 890,
        },
        {
          sourceId: 'kikikuru_target_times',
          status: 'normal',
          reasons: [],
          lastAttemptAt: FIXED_NOW,
          lastSuccessAt: FIXED_NOW,
          maxConsecutiveFailures: 0,
          intervalSeconds: 60,
          lastDurationMs: null,
        },
        {
          sourceId: 'amedas_latest_time',
          status: 'normal',
          reasons: [],
          lastAttemptAt: FIXED_NOW,
          lastSuccessAt: FIXED_NOW,
          maxConsecutiveFailures: 0,
          intervalSeconds: 60,
          lastDurationMs: 432,
        },
        {
          sourceId: 'amedas_point',
          status: 'normal',
          reasons: [],
          lastAttemptAt: FIXED_NOW,
          lastSuccessAt: FIXED_NOW,
          maxConsecutiveFailures: 0,
          intervalSeconds: 60,
          lastDurationMs: 0,
        },
      ],
    };
    const app = buildApp({ connection: context.connection, aggregate });
    const { baseUrl, close } = await startTestServer(app);
    try {
      const res = await fetch(`${baseUrl}/api/monitoring/status?terminalId=hkeagh01`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        health: {
          sources: readonly {
            sourceId: string;
            lastDurationMs: number | null;
          }[];
        };
      };
      const byId = new Map(body.health.sources.map((s) => [s.sourceId, s.lastDurationMs]));
      assert.equal(byId.get('xml_regular'), 1234);
      assert.equal(byId.get('xml_extra'), 567);
      assert.equal(byId.get('nowcast_target_times'), 890);
      assert.equal(byId.get('kikikuru_target_times'), null);
      assert.equal(byId.get('amedas_latest_time'), 432);
      assert.equal(byId.get('amedas_point'), 0);
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('レビュー指摘#4: schedulerRunning は夜間自動停止と手動停止を区別する', async () => {
  const { context, cleanup } = createDb();
  try {
    // sources[*].state が全て scheduled_stopped(夜間自動停止の見た目)でも、
    // scheduler.isRunningNow()(運転フラグ本体)が true なら「稼働中(夜間帯で自動停止中)」
    // として schedulerRunning=true を返すべきで、all-scheduled_stopped から逆算してはならない。
    const period = { ...EMPTY_PERIOD, end: '24:00' };
    const stoppedSrc = (source: 'xml' | 'nowcast' | 'kikikuru' | 'amedas') => ({
      source,
      period,
      state: 'scheduled_stopped' as const,
      intervalSeconds: 60,
      nextRunAt: null,
    });
    const allStoppedStatus: TimeBasedPollingStatus = {
      period,
      nextPeriodChangeAt: FIXED_NOW,
      sources: {
        xml: stoppedSrc('xml'),
        nowcast: stoppedSrc('nowcast'),
        kikikuru: stoppedSrc('kikikuru'),
        amedas: stoppedSrc('amedas'),
      },
    };

    const nightAutoStopApp = buildApp({
      connection: context.connection,
      schedulerStatus: allStoppedStatus,
      schedulerRunning: true,
    });
    const nightAutoStopServer = await startTestServer(nightAutoStopApp);
    try {
      const res = await fetch(
        `${nightAutoStopServer.baseUrl}/api/monitoring/status?terminalId=hkeagh01`,
      );
      const body = (await res.json()) as { operation: { schedulerRunning: boolean } };
      assert.equal(
        body.operation.schedulerRunning,
        true,
        '夜間自動停止中でもスケジューラ自体は稼働中なら true',
      );
    } finally {
      await nightAutoStopServer.close();
    }

    const manualStopApp = buildApp({
      connection: context.connection,
      schedulerStatus: allStoppedStatus,
      schedulerRunning: false,
    });
    const manualStopServer = await startTestServer(manualStopApp);
    try {
      const res = await fetch(
        `${manualStopServer.baseUrl}/api/monitoring/status?terminalId=hkeagh01`,
      );
      const body = (await res.json()) as { operation: { schedulerRunning: boolean } };
      assert.equal(body.operation.schedulerRunning, false, '手動停止では false');
    } finally {
      await manualStopServer.close();
    }
  } finally {
    cleanup();
  }
});

test('AC6 処理できなかった電文の診断（確定事項2・7・8）', async () => {
  const { context, cleanup } = createDb();
  try {
    const nul = String.fromCharCode(0x00);
    const bel = String.fromCharCode(0x07);
    const controlChars = nul + 'x'.repeat(4990) + bel + 'y'.repeat(8);
    const rawBody =
      '<Report><Control><Status>不正</Status></Control>\n' +
      controlChars.slice(0, 4944) +
      '</Report>';
    // rawBody を正確に5000文字にする
    const padded = rawBody.padEnd(5000, 'z');
    assert.equal(padded.length, 5000);

    recordTelegramReception(context.connection, {
      fetchAttemptId: null,
      feedKind: 'regular',
      feedEntryId: 'e1',
      documentUrl: 'https://example.test/1',
      telegramType: 'VPWS50',
      title: null,
      controlStatus: 'normal',
      infoType: null,
      eventId: null,
      serial: null,
      controlDateTime: null,
      reportDateTime: null,
      targetDateTime: null,
      receivedAt: FIXED_NOW,
      rawBody: padded,
      bodyBytes: Buffer.byteLength(padded, 'utf8'),
      contentHash: 'h1',
      areas: [],
      adoptions: [
        {
          venueId: 'east',
          adoptionResult: '未対応構造',
          adoptionReason: 'Control/Status が不正です',
          adoptionDecidedAt: FIXED_NOW,
        },
      ],
    });

    recordTelegramReception(context.connection, {
      fetchAttemptId: null,
      feedKind: 'regular',
      feedEntryId: 'e2',
      documentUrl: 'https://example.test/2',
      telegramType: 'VPWS50',
      title: null,
      controlStatus: 'normal',
      infoType: null,
      eventId: null,
      serial: null,
      controlDateTime: null,
      reportDateTime: null,
      targetDateTime: null,
      receivedAt: FIXED_NOW,
      rawBody: null,
      bodyBytes: null,
      contentHash: null,
      areas: [],
      adoptions: [
        {
          venueId: 'east',
          adoptionResult: '未対応構造',
          adoptionReason: null,
          adoptionDecidedAt: FIXED_NOW,
        },
      ],
    });

    recordTelegramReception(context.connection, {
      fetchAttemptId: null,
      feedKind: 'regular',
      feedEntryId: 'e2b',
      documentUrl: 'https://example.test/2b',
      telegramType: 'VPWS50',
      title: null,
      controlStatus: 'normal',
      infoType: null,
      eventId: null,
      serial: null,
      controlDateTime: null,
      reportDateTime: null,
      targetDateTime: null,
      receivedAt: FIXED_NOW,
      rawBody: '<Report>head-anchor-body</Report>',
      bodyBytes: 34,
      contentHash: 'h2b',
      areas: [],
      adoptions: [
        {
          venueId: 'east',
          adoptionResult: '未対応構造',
          adoptionReason: null,
          adoptionDecidedAt: FIXED_NOW,
        },
      ],
    });

    recordTelegramReception(context.connection, {
      fetchAttemptId: null,
      feedKind: 'regular',
      feedEntryId: 'e3',
      documentUrl: 'https://example.test/3',
      telegramType: 'VPWS50',
      title: null,
      controlStatus: 'normal',
      infoType: null,
      eventId: null,
      serial: null,
      controlDateTime: null,
      reportDateTime: null,
      targetDateTime: null,
      receivedAt: FIXED_NOW,
      rawBody: 'ok',
      bodyBytes: 2,
      contentHash: 'h3',
      areas: [],
      adoptions: [
        {
          venueId: 'east',
          adoptionResult: '対象地域外',
          adoptionReason: null,
          adoptionDecidedAt: FIXED_NOW,
        },
      ],
    });

    const app = buildApp({ connection: context.connection });
    const { baseUrl, close } = await startTestServer(app);
    try {
      const res = await fetch(`${baseUrl}/api/monitoring/processing?terminalId=hkeagh01`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        windowHours: number;
        byAdoptionResult: readonly { adoptionResult: string; venueId: string; count: number }[];
        recentFailures: readonly {
          adoptionResult: string;
          rawBodyBytes: number | null;
          excerpt: {
            text: string;
            totalLength: number;
            truncated: boolean;
            anchor: string;
            startOffset: number;
          } | null;
        }[];
      };

      assert.equal(body.windowHours, PROCESSING_WINDOW_HOURS);
      assert.equal(body.recentFailures.length, 3);
      for (const f of body.recentFailures) {
        assert.equal(f.adoptionResult, '未対応構造');
      }
      assert.ok(body.byAdoptionResult.some((b) => b.adoptionResult === '対象地域外'));

      const headAnchor = body.recentFailures.find((f) => f.rawBodyBytes === 34);
      assert.equal(headAnchor?.excerpt?.anchor, 'head');
      assert.equal(headAnchor?.excerpt?.startOffset, 0);

      const withBody = body.recentFailures.find(
        (f) => f.rawBodyBytes !== null && f.rawBodyBytes !== 34,
      );
      assert.ok(withBody?.excerpt);
      assert.ok(withBody.excerpt!.text.length <= EXCERPT_MAX_CHARS);
      assert.equal(withBody.excerpt!.totalLength, 5000);
      assert.equal(withBody.excerpt!.truncated, true);
      assert.equal(withBody.excerpt!.text.includes(nul), false);
      assert.equal(withBody.excerpt!.text.includes(bel), false);
      assert.equal(withBody.excerpt!.text.includes('\n'), true);
      assert.equal(withBody.excerpt!.anchor, 'reason_match');
      assert.ok(withBody.excerpt!.text.includes('Control'));

      const withoutBody = body.recentFailures.find((f) => f.rawBodyBytes === null);
      assert.equal(withoutBody?.excerpt, null);
      assert.equal(withoutBody?.rawBodyBytes, null);
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('AC6(f) recentFailures はサンプル上限で止まるが byAdoptionResult は全件を示す', async () => {
  const { context, cleanup } = createDb();
  try {
    const total = PROCESSING_FAILURE_SAMPLE_LIMIT + 3;
    for (let i = 0; i < total; i += 1) {
      recordTelegramReception(context.connection, {
        fetchAttemptId: null,
        feedKind: 'regular',
        feedEntryId: `f${i}`,
        documentUrl: `https://example.test/many/${i}`,
        telegramType: 'VPWS50',
        title: null,
        controlStatus: 'normal',
        infoType: null,
        eventId: null,
        serial: null,
        controlDateTime: null,
        reportDateTime: null,
        targetDateTime: null,
        receivedAt: FIXED_NOW,
        rawBody: 'body',
        bodyBytes: 4,
        contentHash: `hash${i}`,
        areas: [],
        adoptions: [
          {
            venueId: 'east',
            adoptionResult: '未対応構造',
            adoptionReason: null,
            adoptionDecidedAt: FIXED_NOW,
          },
        ],
      });
    }

    const app = buildApp({ connection: context.connection });
    const { baseUrl, close } = await startTestServer(app);
    try {
      const res = await fetch(`${baseUrl}/api/monitoring/processing?terminalId=hkeagh01`);
      const body = (await res.json()) as {
        byAdoptionResult: readonly { adoptionResult: string; count: number }[];
        recentFailures: readonly unknown[];
      };
      assert.equal(body.recentFailures.length, PROCESSING_FAILURE_SAMPLE_LIMIT);
      const count = body.byAdoptionResult
        .filter((r) => r.adoptionResult === '未対応構造')
        .reduce((sum, r) => sum + r.count, 0);
      assert.equal(count, total);
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('AC7 訓練データを既定で除外しないこと（確定事項3）', async () => {
  const { context, cleanup } = createDb();
  try {
    for (const controlStatus of ['normal', 'training', 'test', null] as const) {
      recordTelegramReception(context.connection, {
        fetchAttemptId: null,
        feedKind: 'regular',
        feedEntryId: `cs-${controlStatus}`,
        documentUrl: `https://example.test/cs/${controlStatus}`,
        telegramType: 'VPWS50',
        title: null,
        controlStatus,
        infoType: null,
        eventId: null,
        serial: null,
        controlDateTime: null,
        reportDateTime: null,
        targetDateTime: null,
        receivedAt: FIXED_NOW,
        rawBody: null,
        bodyBytes: null,
        contentHash: null,
        areas: [],
        adoptions: [],
      });
    }

    recordNotificationOutputHistory(context.connection, {
      notificationId: 'n1',
      category: 'warning',
      sourceType: 'fetch_health',
      sourceVersion: null,
      targetAreaJson: null,
      occurredAt: FIXED_NOW,
      detectedAt: FIXED_NOW,
      changeType: 'x',
      ackRequired: false,
      summary: 's1',
      relatedRefsJson: '[]',
      origin: 'system',
      detectionContext: 'normal',
      isTraining: true,
      messageDefinitionId: null,
      messageDefinitionVersion: null,
    });
    recordNotificationOutputHistory(context.connection, {
      notificationId: 'n2',
      category: 'warning',
      sourceType: 'fetch_health',
      sourceVersion: null,
      targetAreaJson: null,
      occurredAt: FIXED_NOW,
      detectedAt: FIXED_NOW,
      changeType: 'x',
      ackRequired: false,
      summary: 's2',
      relatedRefsJson: '[]',
      origin: 'system',
      detectionContext: 'normal',
      isTraining: false,
      messageDefinitionId: null,
      messageDefinitionVersion: null,
    });

    const app = buildApp({ connection: context.connection });
    const { baseUrl, close } = await startTestServer(app);
    try {
      const allReceptions = await fetch(`${baseUrl}/api/monitoring/receptions?limit=100`);
      const allBody = (await allReceptions.json()) as { totalCount: number };
      assert.equal(allBody.totalCount, 4);

      const trainingOnly = await fetch(
        `${baseUrl}/api/monitoring/receptions?controlStatus=training`,
      );
      const trainingBody = (await trainingOnly.json()) as { totalCount: number };
      assert.equal(trainingBody.totalCount, 1);

      const allOutputs = await fetch(`${baseUrl}/api/monitoring/notification-outputs`);
      const allOutputsBody = (await allOutputs.json()) as { totalCount: number };
      assert.equal(allOutputsBody.totalCount, 2);

      const trueOnly = await fetch(
        `${baseUrl}/api/monitoring/notification-outputs?isTraining=true`,
      );
      assert.equal(((await trueOnly.json()) as { totalCount: number }).totalCount, 1);

      const falseOnly = await fetch(
        `${baseUrl}/api/monitoring/notification-outputs?isTraining=false`,
      );
      assert.equal(((await falseOnly.json()) as { totalCount: number }).totalCount, 1);

      const badBool = await fetch(`${baseUrl}/api/monitoring/notification-outputs?isTraining=yes`);
      assert.equal(badBool.status, 400);
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('AC8 一覧に原文を含めないこと（確定事項3）', async () => {
  const { context, cleanup } = createDb();
  try {
    const secret = '<Report>SECRET_MARKER</Report>';
    const created = recordTelegramReception(context.connection, {
      fetchAttemptId: null,
      feedKind: 'regular',
      feedEntryId: 'secret',
      documentUrl: 'https://example.test/secret',
      telegramType: 'VPWS50',
      title: null,
      controlStatus: 'normal',
      infoType: null,
      eventId: null,
      serial: null,
      controlDateTime: null,
      reportDateTime: null,
      targetDateTime: null,
      receivedAt: FIXED_NOW,
      rawBody: secret,
      bodyBytes: Buffer.byteLength(secret, 'utf8'),
      contentHash: 'hs',
      areas: [],
      adoptions: [],
    });

    const app = buildApp({ connection: context.connection });
    const { baseUrl, close } = await startTestServer(app);
    try {
      const listRes = await fetch(`${baseUrl}/api/monitoring/receptions`);
      const listText = await listRes.text();
      assert.equal(listText.includes('SECRET_MARKER'), false);
      const listBody = JSON.parse(listText) as {
        items: readonly Record<string, unknown>[];
      };
      const item = listBody.items.find((i) => i.id === created.id)!;
      assert.equal('rawBody' in item, false);
      assert.equal(item.hasRawBody, true);
      assert.equal(item.bodyBytes, Buffer.byteLength(secret, 'utf8'));

      const detailRes = await fetch(`${baseUrl}/api/monitoring/receptions/${created.id}`);
      const detailBody = (await detailRes.json()) as { reception: { rawBody: string | null } };
      assert.equal(detailBody.reception.rawBody, secret);
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('AC9 検索上限（確定事項3）', async () => {
  const { context, cleanup } = createDb();
  try {
    for (let i = 0; i < 300; i += 1) {
      recordTelegramReception(context.connection, {
        fetchAttemptId: null,
        feedKind: 'regular',
        feedEntryId: `r${i}`,
        documentUrl: `https://example.test/r/${i}`,
        telegramType: 'VPWS50',
        title: null,
        controlStatus: 'normal',
        infoType: null,
        eventId: null,
        serial: null,
        controlDateTime: null,
        reportDateTime: null,
        targetDateTime: null,
        receivedAt: new Date(Date.parse(FIXED_NOW) + i * 1000).toISOString(),
        rawBody: null,
        bodyBytes: null,
        contentHash: null,
        areas: [],
        adoptions: [],
      });
    }

    const app = buildApp({ connection: context.connection });
    const { baseUrl, close } = await startTestServer(app);
    try {
      const defaultRes = await fetch(`${baseUrl}/api/monitoring/receptions`);
      const defaultBody = (await defaultRes.json()) as { items: unknown[]; totalCount: number };
      assert.equal(defaultBody.items.length, 100);
      assert.equal(defaultBody.totalCount, 300);

      const at200 = await fetch(`${baseUrl}/api/monitoring/receptions?limit=200`);
      assert.equal(((await at200.json()) as { items: unknown[] }).items.length, 200);

      for (const badLimit of ['201', '1000', '0', '-1', '1.5', 'abc']) {
        const res = await fetch(`${baseUrl}/api/monitoring/receptions?limit=${badLimit}`);
        assert.equal(res.status, 400, `limit=${badLimit}`);
      }

      const offsetRes = await fetch(`${baseUrl}/api/monitoring/receptions?offset=250`);
      const offsetBody = (await offsetRes.json()) as { items: unknown[]; totalCount: number };
      assert.equal(offsetBody.items.length, 50);
      assert.equal(offsetBody.totalCount, 300);
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('AC9(e) notification-outputs・operations の limit 範囲検証', async () => {
  const { context, cleanup } = createDb();
  try {
    const app = buildApp({ connection: context.connection });
    const { baseUrl, close } = await startTestServer(app);
    try {
      for (const path of ['/api/monitoring/notification-outputs', '/api/monitoring/operations']) {
        for (const badLimit of ['201', '1000', '0', '-1', '1.5', 'abc']) {
          const res = await fetch(`${baseUrl}${path}?limit=${badLimit}`);
          assert.equal(res.status, 400, `${path}?limit=${badLimit}`);
        }

        const at200 = await fetch(`${baseUrl}${path}?limit=200`);
        assert.equal(at200.status, 200, `${path}?limit=200`);

        const withOffset = await fetch(`${baseUrl}${path}?offset=250`);
        assert.equal(withOffset.status, 200, `${path}?offset=250`);
      }
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('AC10(c) operations が空のとき ready・totalCount0・items空を返す', async () => {
  const { context, cleanup } = createDb();
  try {
    const app = buildApp({ connection: context.connection });
    const { baseUrl, close } = await startTestServer(app);
    try {
      const res = await fetch(`${baseUrl}/api/monitoring/operations`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { status: string; totalCount: number; items: unknown[] };
      assert.equal(body.status, 'ready');
      assert.equal(body.totalCount, 0);
      assert.deepEqual(body.items, []);
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('AC10(a) 会場別セクションは全会場分を返す（確定事項6）', async () => {
  const { context, cleanup } = createDb();
  try {
    recordTelegramReception(context.connection, {
      fetchAttemptId: null,
      feedKind: 'regular',
      feedEntryId: 'venue-a',
      documentUrl: 'https://example.test/venue-a',
      telegramType: 'VPWS50',
      title: null,
      controlStatus: 'normal',
      infoType: null,
      eventId: null,
      serial: null,
      controlDateTime: null,
      reportDateTime: null,
      targetDateTime: null,
      receivedAt: FIXED_NOW,
      rawBody: null,
      bodyBytes: null,
      contentHash: null,
      areas: [],
      adoptions: [
        {
          venueId: 'east',
          adoptionResult: '未対応構造',
          adoptionReason: null,
          adoptionDecidedAt: FIXED_NOW,
        },
        {
          venueId: 'trc',
          adoptionResult: '警報・注意報として解析済み',
          adoptionReason: null,
          adoptionDecidedAt: FIXED_NOW,
        },
      ],
    });

    const app = buildApp({ connection: context.connection });
    const { baseUrl, close } = await startTestServer(app);
    try {
      for (const terminalId of ['hkeagh01', 'htrcph01']) {
        const res = await fetch(`${baseUrl}/api/monitoring/status?terminalId=${terminalId}`);
        const body = (await res.json()) as {
          requestedVenueId: string;
          venues: readonly {
            venueId: string;
            recentAdoptions: readonly { adoptionResult: string }[];
          }[];
        };
        const venueIds = new Set(body.venues.map((v) => v.venueId));
        assert.deepEqual(venueIds, new Set(['east', 'trc']));

        const east = body.venues.find((v) => v.venueId === 'east')!;
        const trc = body.venues.find((v) => v.venueId === 'trc')!;
        assert.ok(east.recentAdoptions.some((a) => a.adoptionResult === '未対応構造'));
        assert.ok(
          trc.recentAdoptions.some((a) => a.adoptionResult === '警報・注意報として解析済み'),
        );
        assert.equal(
          east.recentAdoptions.some((a) => a.adoptionResult === '警報・注意報として解析済み'),
          false,
        );
      }

      const eastReq = await fetch(`${baseUrl}/api/monitoring/status?terminalId=hkeagh01`);
      const eastBody = (await eastReq.json()) as { requestedVenueId: string };
      assert.equal(eastBody.requestedVenueId, 'east');

      const trcReq = await fetch(`${baseUrl}/api/monitoring/status?terminalId=htrcph01`);
      const trcBody = (await trcReq.json()) as { requestedVenueId: string };
      assert.equal(trcBody.requestedVenueId, 'trc');

      const processingEast = await fetch(
        `${baseUrl}/api/monitoring/processing?terminalId=hkeagh01`,
      );
      const processingTrc = await fetch(`${baseUrl}/api/monitoring/processing?terminalId=htrcph01`);
      const pe = (await processingEast.json()) as {
        byAdoptionResult: readonly { venueId: string }[];
      };
      const pt = (await processingTrc.json()) as {
        byAdoptionResult: readonly { venueId: string }[];
      };
      assert.ok(pe.byAdoptionResult.some((r) => r.venueId === 'trc'));
      assert.ok(pt.byAdoptionResult.some((r) => r.venueId === 'east'));
    } finally {
      await close();
    }

    recordOperationHistory(context.connection, {
      requestId: '11111111-1111-4111-8111-111111111111',
      operationKind: 'start',
      targetKind: 'all',
      result: 'success',
      requestedAt: FIXED_NOW,
      completedAt: FIXED_NOW,
      actorId: null,
      actorDisplayName: null,
      errorCode: null,
      errorMessage: null,
    });
    context.connection
      .prepare(
        `INSERT INTO operation_history
         (request_id, operation_kind, target_kind, result, requested_at, completed_at, actor_id, actor_display_name, error_code, error_message)
         VALUES (?, 'stop', 'all', 'success', ?, ?, 'op-1', 'オペレータ1', NULL, NULL)`,
      )
      .run('22222222-2222-4222-8222-222222222222', FIXED_NOW, FIXED_NOW);

    const app2 = buildApp({ connection: context.connection });
    const { baseUrl: baseUrl2, close: close2 } = await startTestServer(app2);
    try {
      const opsRes = await fetch(`${baseUrl2}/api/monitoring/operations`);
      const opsBody = (await opsRes.json()) as {
        status: string;
        totalCount: number;
        items: readonly { actorId: string | null; actorDisplayName: string | null }[];
      };
      assert.equal(opsBody.status, 'ready');
      assert.equal(opsBody.totalCount, 2);
      assert.ok(opsBody.items.some((i) => i.actorId === null));
      assert.ok(
        opsBody.items.some((i) => i.actorId === 'op-1' && i.actorDisplayName === 'オペレータ1'),
      );
    } finally {
      await close2();
    }
  } finally {
    cleanup();
  }
});

test('AC11 availability 3状態を縮退させないこと', async () => {
  const { context, cleanup } = createDb();
  try {
    // weatherApi をスタブし、warning=available・warning_timeseries=stale を注入する。
    // nowcast/kikikuru は既定スタブにより unavailable のまま。これで応答中に3状態が共存する。
    const app = buildApp({ connection: context.connection, weatherApi: stubWeatherApi() });
    const { baseUrl, close } = await startTestServer(app);
    try {
      const res = await fetch(`${baseUrl}/api/monitoring/status?terminalId=hkeagh01`);
      const body = (await res.json()) as {
        information: readonly {
          kind: string;
          availability: string;
          issuedAt: string | null;
          fetchedAt: string | null;
        }[];
      };

      const warning = body.information.find((i) => i.kind === 'warning');
      assert.equal(warning?.availability, 'available');
      assert.equal(warning?.issuedAt, STUB_WARNING_ISSUED_AT);
      assert.equal(warning?.fetchedAt, STUB_WARNING_FETCHED_AT);

      const warningTimeseries = body.information.find((i) => i.kind === 'warning_timeseries');
      assert.equal(warningTimeseries?.availability, 'stale');
      assert.equal(warningTimeseries?.issuedAt, STUB_TIMESERIES_ISSUED_AT);
      assert.equal(warningTimeseries?.fetchedAt, STUB_TIMESERIES_FETCHED_AT);

      const nowcastInfo = body.information.find((i) => i.kind === 'nowcast');
      assert.equal(nowcastInfo?.availability, 'unavailable');

      // 3状態が同一応答内に実際に共存していることを確認する（縮退していないこと）。
      const availabilities = new Set(body.information.map((i) => i.availability));
      assert.deepEqual(availabilities, new Set(['available', 'stale', 'unavailable']));

      for (const info of body.information) {
        assert.ok(['available', 'stale', 'unavailable'].includes(info.availability));
        assert.equal('isAvailable' in (info as unknown as Record<string, unknown>), false);
      }
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('AC12 副作用がないこと・上流へポーリングしないこと', async () => {
  const { context, cleanup } = createDb();
  try {
    const app = buildApp({ connection: context.connection });
    const { baseUrl, close } = await startTestServer(app);
    try {
      const tables = [
        'telegram_reception',
        'telegram_reception_area',
        'telegram_reception_adoption',
        'notification_output_history',
        'operation_history',
      ];
      const before = tables.map(
        (t) =>
          (context.connection.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c,
      );

      for (let i = 0; i < 10; i += 1) {
        await fetch(`${baseUrl}/api/monitoring/status?terminalId=hkeagh01`);
        await fetch(`${baseUrl}/api/monitoring/processing?terminalId=hkeagh01`);
        await fetch(`${baseUrl}/api/monitoring/receptions`);
        await fetch(`${baseUrl}/api/monitoring/notification-outputs`);
        await fetch(`${baseUrl}/api/monitoring/operations`);
      }

      const after = tables.map(
        (t) =>
          (context.connection.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c,
      );
      assert.deepEqual(after, before);
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('AC13 HTTP実挙動と依存注入（3依存の独立性・startup-inquiries 不在）', async () => {
  const { context, cleanup } = createDb();
  try {
    const app = buildApp({ connection: context.connection });
    const { baseUrl, close } = await startTestServer(app);
    try {
      const res = await fetch(`${baseUrl}/api/monitoring/status?terminalId=hkeagh01`);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');

      const postRes = await fetch(`${baseUrl}/api/monitoring/status`, { method: 'POST' });
      assert.ok(postRes.status === 404 || postRes.status === 405);

      const startupInquiries = await fetch(`${baseUrl}/api/monitoring/startup-inquiries`);
      assert.equal(startupInquiries.status, 404);
    } finally {
      await close();
    }

    // monitoringStatus のみ登録した場合
    const weatherApi = createWeatherApiService({
      connection: context.connection,
      now: () => FIXED_NOW,
    });
    const monitoringStatus = createMonitoringStatusService({
      connection: context.connection,
      scheduler: { getStatus: () => fakeSchedulerStatus(), isRunningNow: () => true },
      xmlPollingService: { getStatus: () => fakeXmlStatus() },
      fetchHealthMonitor: { getLastAggregate: () => null },
      startupInitialization: { getStatus: () => fakeStartupStatus() },
      weatherApi,
      nowcastApi: stubNowcastApi(),
      kikikuruApi: stubKikikuruApi(),
      fetchHealthConfig: {
        evaluationIntervalSeconds: 30,
        delayedConsecutiveFailures: 2,
        delayedIntervalMultiplier: 3,
        abnormalConsecutiveFailures: 5,
        abnormalElapsedSeconds: 600,
        maxScanAttempts: 20,
      },
      serverGenerationId: 'gen-1',
      now: () => FIXED_NOW,
    });
    const onlyStatusApp = createApp({ monitoringStatus });
    const { baseUrl: onlyBaseUrl, close: onlyClose } = await startTestServer(onlyStatusApp);
    try {
      const statusRes = await fetch(`${onlyBaseUrl}/api/monitoring/status?terminalId=hkeagh01`);
      assert.equal(statusRes.status, 200);
      const processingRes = await fetch(
        `${onlyBaseUrl}/api/monitoring/processing?terminalId=hkeagh01`,
      );
      assert.equal(processingRes.status, 404);
      const receptionsRes = await fetch(`${onlyBaseUrl}/api/monitoring/receptions`);
      assert.equal(receptionsRes.status, 404);
    } finally {
      await onlyClose();
    }
  } finally {
    cleanup();
  }
});

test('AC14 境界（作りすぎていないこと）: POST/PUT/DELETE が /api/monitoring/ 配下に存在しない', async () => {
  const { context, cleanup } = createDb();
  try {
    const app = buildApp({ connection: context.connection });
    const { baseUrl, close } = await startTestServer(app);
    try {
      for (const path of [
        '/api/monitoring/status',
        '/api/monitoring/processing',
        '/api/monitoring/receptions',
        '/api/monitoring/operations',
      ]) {
        for (const method of ['POST', 'PUT', 'DELETE']) {
          const res = await fetch(`${baseUrl}${path}`, { method });
          assert.ok(res.status === 404 || res.status === 405, `${method} ${path}`);
        }
      }
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});
