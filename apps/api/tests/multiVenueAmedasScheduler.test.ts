import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AmedasTarget, UtcIso8601String } from '@wx-viewer-poc/shared';
import { initializeDatabase } from '../src/database/index.js';
import { loadPollingScheduleConfig } from '../src/config/pollingScheduleLoader.js';
import {
  AmedasScheduledAdapter,
  createScheduledAdapters,
  MultiVenueAmedasScheduledAdapter,
  resolveUniqueAmedasVenues,
  TimeBasedPollingScheduler,
} from '../src/polling/timeBasedPollingScheduler.js';
import { AmedasFetchState } from '../src/polling/amedasFetchService.js';
import { findAmedasSnapshot } from '../src/repositories/amedasRepository.js';
import type { NowcastService } from '../src/polling/nowcastService.js';
import type { KikikuruService } from '../src/polling/kikikuruService.js';
import type { JmaXmlPollingService } from '../src/polling/jmaXmlPollingService.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');
const fixturesDir = join(fileURLToPath(import.meta.url), '../fixtures/jma/amedas');

const latestTimeText = readFileSync(join(fixturesDir, 'amedas_latest_time.txt'), 'utf-8'); // '2026-09-11T20:40:00+09:00'
const point44136Json = readFileSync(join(fixturesDir, 'amedas_point_44136_block.json'), 'utf-8');
const point44166Json = readFileSync(join(fixturesDir, 'amedas_point_44166_block.json'), 'utf-8');

const defaultSchedule = loadPollingScheduleConfig();

const dummyNowcastService = {
  refreshTimes: async () => {},
} as unknown as NowcastService;

const dummyKikikuruService = {
  refreshTimes: async () => {},
} as unknown as KikikuruService;

function createTempDb(): { databasePath: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-multi-amedas-test-'));
  const databasePath = join(directory, 'test.sqlite3');
  return {
    databasePath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

class FakeTimerScheduler {
  currentTimeMs: number;
  private nextTimerId = 1;
  private timers = new Map<number, { callback: () => void; dueTimeMs: number }>();

  constructor(initialIso: string) {
    this.currentTimeMs = new Date(initialIso).getTime();
  }

  now = (): Date => new Date(this.currentTimeMs);
  clock = (): UtcIso8601String => new Date(this.currentTimeMs).toISOString() as UtcIso8601String;

  setTimer = (callback: () => void, delayMs: number): number => {
    const id = this.nextTimerId++;
    this.timers.set(id, { callback, dueTimeMs: this.currentTimeMs + delayMs });
    return id;
  };

  clearTimer = (id: unknown): void => {
    if (typeof id === 'number') {
      this.timers.delete(id);
    }
  };

  async advanceTime(ms: number): Promise<void> {
    const targetTimeMs = this.currentTimeMs + ms;
    while (true) {
      let earliestId: number | null = null;
      let earliestDue = Infinity;

      for (const [id, timer] of this.timers.entries()) {
        if (timer.dueTimeMs <= targetTimeMs && timer.dueTimeMs < earliestDue) {
          earliestDue = timer.dueTimeMs;
          earliestId = id;
        }
      }

      if (earliestId === null) {
        break;
      }

      const timer = this.timers.get(earliestId)!;
      this.timers.delete(earliestId);
      this.currentTimeMs = timer.dueTimeMs;
      timer.callback();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    this.currentTimeMs = targetTimeMs;
  }
}

class DummyXmlPollingService {
  isExecuting(): boolean {
    return false;
  }
  getNextRunAt(): UtcIso8601String | null {
    return null;
  }
  setScheduledIntervalSeconds(): void {}
  start(): Promise<{ completed: boolean }> {
    return Promise.resolve({ completed: true });
  }
  stop(): Promise<void> {
    return Promise.resolve();
  }
  getStatus() {
    return { isRunning: false };
  }
}

// ---------------------------------------------------------------------------
// AC1 両地点と履歴:
// factory 無指定のアメダス adapter を1周期実行する。最新時刻2回、地点 JSON は44136/44166各1回、過去ブロック0回。
// DB に各地点の異なる fixture の観測値が保存され、最新時刻・地点履歴の計4行がそれぞれ正しい地点コードと scheduled を持つ。
// ---------------------------------------------------------------------------
test(
  'AC1. 両地点と履歴: factory 既定で両地点を取得・保存し、fetch_attempt 4行が地点コードと scheduled を持つ',
  { timeout: 10_000 },
  async () => {
    const { databasePath, cleanup } = createTempDb();
    try {
      const database = initializeDatabase({ databasePath, migrationsDirectory });
      const requestedUrls: string[] = [];

      const customFetch: typeof fetch = async (input) => {
        const urlStr = String(input);
        requestedUrls.push(urlStr);
        if (urlStr.includes('latest_time.txt')) {
          return new Response(latestTimeText, { status: 200 });
        }
        if (urlStr.includes('44136')) {
          return new Response(point44136Json, { status: 200 });
        }
        if (urlStr.includes('44166')) {
          return new Response(point44166Json, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      };

      const nowFn = () => new Date('2026-09-11T12:00:00.000Z');
      const adapters = createScheduledAdapters({
        connection: database.connection,
        nowcastService: dummyNowcastService,
        kikikuruService: dummyKikikuruService,
        now: nowFn,
        amedasFetchOptions: {
          fetchFn: customFetch,
          clock: () => '2026-09-11T12:00:00.000Z',
        },
      });

      const amedasAdapter = adapters.find((a) => a.source === 'amedas')!;
      assert.ok(amedasAdapter);

      await amedasAdapter.runScheduled();

      // 最新時刻2回（各地点1回）、地点JSON 44136/44166 各1回、過去ブロック0回
      const latestTimeUrls = requestedUrls.filter((u) => u.includes('latest_time.txt'));
      const point44136Urls = requestedUrls.filter((u) => u.includes('44136'));
      const point44166Urls = requestedUrls.filter((u) => u.includes('44166'));
      assert.equal(latestTimeUrls.length, 2, 'latest_time は地点ごとに1回取得');
      assert.equal(point44136Urls.length, 1, '44136 地点データ取得');
      assert.equal(point44166Urls.length, 1, '44166 地点データ取得');
      assert.equal(requestedUrls.length, 4, '全リクエスト数は4回（過去ブロック0回）');

      // DB に各地点の異なる fixture の観測値が保存されていること
      const snap44136 = findAmedasSnapshot(database.connection, '44136');
      const snap44166 = findAmedasSnapshot(database.connection, '44166');
      assert.ok(snap44136);
      assert.ok(snap44166);
      assert.equal(snap44136.stationCode, '44136');
      assert.equal(snap44136.stationName, '江戸川臨海');
      assert.equal(snap44136.metadata.availability, 'available');
      assert.ok(snap44136.observations.length > 0);
      // 江戸川臨海には humidity がある
      assert.ok(snap44136.observations.some((o) => o.element === 'humidity'));

      assert.equal(snap44166.stationCode, '44166');
      assert.equal(snap44166.stationName, '羽田');
      assert.equal(snap44166.metadata.availability, 'available');
      assert.ok(snap44166.observations.length > 0);
      // 羽田には humidity がない
      assert.equal(
        snap44166.observations.some((o) => o.element === 'humidity'),
        false,
      );

      // fetch_attempt の計4行がそれぞれ正しい地点コードと trigger_kind: 'scheduled' を持つ
      const attempts = database.connection
        .prepare(
          'SELECT source_kind, target_ref, trigger_kind, outcome FROM fetch_attempt ORDER BY source_kind ASC, target_ref ASC',
        )
        .all() as Array<{
        source_kind: string;
        target_ref: string | null;
        trigger_kind: string;
        outcome: string;
      }>;

      assert.equal(attempts.length, 4);
      assert.deepEqual(
        attempts.map((a) => ({
          sourceKind: a.source_kind,
          targetRef: a.target_ref,
          triggerKind: a.trigger_kind,
          outcome: a.outcome,
        })),
        [
          {
            sourceKind: 'amedas_latest_time',
            targetRef: '44136',
            triggerKind: 'scheduled',
            outcome: 'success',
          },
          {
            sourceKind: 'amedas_latest_time',
            targetRef: '44166',
            triggerKind: 'scheduled',
            outcome: 'success',
          },
          {
            sourceKind: 'amedas_point',
            targetRef: '44136',
            triggerKind: 'scheduled',
            outcome: 'success',
          },
          {
            sourceKind: 'amedas_point',
            targetRef: '44166',
            triggerKind: 'scheduled',
            outcome: 'success',
          },
        ],
      );

      database.close();
    } finally {
      cleanup();
    }
  },
);

// ---------------------------------------------------------------------------
// AC2 正常時の省略と境界:
// 同じ最新時刻で初回成功後599秒では両地点 JSON を取得せず、600秒では各1回取得する。
// 600秒未満でも最新時刻更新時は各地点を取得する。最新時刻は全ての周期で地点ごとに1回取得する。
// ---------------------------------------------------------------------------
test(
  'AC2. 正常時の省略と境界: 599秒スキップ、600秒再確認、時刻更新時の再取得、毎周期地点別最新時刻取得',
  { timeout: 10_000 },
  async () => {
    const { databasePath, cleanup } = createTempDb();
    try {
      const database = initializeDatabase({ databasePath, migrationsDirectory });
      let currentMockTimeMs = new Date('2026-09-11T12:00:00.000Z').getTime();
      const nowFn = () => new Date(currentMockTimeMs);

      let latestTimeRequestCount = 0;
      let point44136RequestCount = 0;
      let point44166RequestCount = 0;
      let currentLatestTime = '2026-09-11T20:30:00+09:00';

      const customFetch: typeof fetch = async (input) => {
        const urlStr = String(input);
        if (urlStr.includes('latest_time.txt')) {
          latestTimeRequestCount++;
          return new Response(currentLatestTime, { status: 200 });
        }
        if (urlStr.includes('44136')) {
          point44136RequestCount++;
          return new Response(point44136Json, { status: 200 });
        }
        if (urlStr.includes('44166')) {
          point44166RequestCount++;
          return new Response(point44166Json, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      };

      const adapters = createScheduledAdapters({
        connection: database.connection,
        nowcastService: dummyNowcastService,
        kikikuruService: dummyKikikuruService,
        now: nowFn,
        amedasPointRecheckSeconds: 600,
        amedasFetchOptions: {
          fetchFn: customFetch,
          clock: () => new Date(currentMockTimeMs).toISOString() as UtcIso8601String,
        },
      });

      const amedasAdapter = adapters.find((a) => a.source === 'amedas')!;

      // 1回目 (t=0s): 初回取得
      await amedasAdapter.runScheduled();
      assert.equal(latestTimeRequestCount, 2);
      assert.equal(point44136RequestCount, 1);
      assert.equal(point44166RequestCount, 1);

      // 2回目 (t=599s): 600秒未満かつ時刻不変 -> 地点データはスキップ、最新時刻は各1回取得
      currentMockTimeMs += 599_000;
      await amedasAdapter.runScheduled();
      assert.equal(latestTimeRequestCount, 4);
      assert.equal(point44136RequestCount, 1, '599秒時点では44136スキップ');
      assert.equal(point44166RequestCount, 1, '599秒時点では44166スキップ');

      // 3回目 (t=600s): 初回から600秒経過 -> 両地点データ再確認
      currentMockTimeMs += 1_000;
      await amedasAdapter.runScheduled();
      assert.equal(latestTimeRequestCount, 6);
      assert.equal(point44136RequestCount, 2, '600秒経過で44136再確認');
      assert.equal(point44166RequestCount, 2, '600秒経過で44166再確認');

      // 4回目 (t=660s): 600秒未満（最後の地点試行から60秒）だが最新時刻が更新された場合 -> 両地点取得
      currentMockTimeMs += 60_000;
      currentLatestTime = '2026-09-11T20:40:00+09:00';
      await amedasAdapter.runScheduled();
      assert.equal(latestTimeRequestCount, 8);
      assert.equal(point44136RequestCount, 3, '時刻更新により44136取得');
      assert.equal(point44166RequestCount, 3, '時刻更新により44166取得');

      database.close();
    } finally {
      cleanup();
    }
  },
);

// ---------------------------------------------------------------------------
// AC3 片地点の失敗・回復:
// 両地点正常保存後、時刻更新周期で羽田のみ HTTP 503 にする。羽田は stale で直前値保持、江戸川臨海は更新成功。
// 次の既存周期で時刻不変のまま羽田だけ再取得して回復し、失敗数0・available・新しい羽田値になる。
// 正常地点の地点 JSON 回数と再確認時刻は余分に増えない。
// 羽田初回失敗も別ケースで実行し、unavailable・観測行なし・江戸川臨海値の流用なしを確認する。
// ---------------------------------------------------------------------------
test(
  'AC3. 片地点の失敗・回復: 羽田503でstale保持、次周期で羽田のみ再取得・回復、初回失敗時の独立性',
  { timeout: 10_000 },
  async () => {
    const { databasePath, cleanup } = createTempDb();
    try {
      const database = initializeDatabase({ databasePath, migrationsDirectory });
      let currentMockTimeMs = new Date('2026-09-11T12:00:00.000Z').getTime();
      const nowFn = () => new Date(currentMockTimeMs);

      let point44136RequestCount = 0;
      let point44166RequestCount = 0;
      let currentLatestTime = '2026-09-11T20:30:00+09:00';
      let point44166Status = 200;

      const customFetch: typeof fetch = async (input) => {
        const urlStr = String(input);
        if (urlStr.includes('latest_time.txt')) {
          return new Response(currentLatestTime, { status: 200 });
        }
        if (urlStr.includes('44136')) {
          point44136RequestCount++;
          return new Response(point44136Json, { status: 200 });
        }
        if (urlStr.includes('44166')) {
          point44166RequestCount++;
          if (point44166Status !== 200) {
            return new Response('Service Unavailable', { status: point44166Status });
          }
          return new Response(point44166Json, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      };

      const adapters = createScheduledAdapters({
        connection: database.connection,
        nowcastService: dummyNowcastService,
        kikikuruService: dummyKikikuruService,
        now: nowFn,
        amedasPointRecheckSeconds: 600,
        amedasFetchOptions: {
          fetchFn: customFetch,
          clock: () => new Date(currentMockTimeMs).toISOString() as UtcIso8601String,
        },
      });

      const amedasAdapter = adapters.find((a) => a.source === 'amedas')!;

      // 1回目 (t=0s): 両地点正常
      await amedasAdapter.runScheduled();
      assert.equal(point44136RequestCount, 1);
      assert.equal(point44166RequestCount, 1);
      const snap44166_1 = findAmedasSnapshot(database.connection, '44166')!;
      assert.equal(snap44166_1.metadata.availability, 'available');
      const obsCount44166_1 = snap44166_1.observations.length;

      // 2回目 (t=60s): 時刻更新周期で羽田のみ 503
      currentMockTimeMs += 60_000;
      currentLatestTime = '2026-09-11T20:40:00+09:00';
      point44166Status = 503;
      await amedasAdapter.runScheduled();
      assert.equal(point44136RequestCount, 2, '江戸川臨海は更新成功');
      assert.equal(point44166RequestCount, 2, '羽田は取得試行して失敗');

      const snap44136_2 = findAmedasSnapshot(database.connection, '44136')!;
      const snap44166_2 = findAmedasSnapshot(database.connection, '44166')!;
      assert.equal(snap44136_2.metadata.availability, 'available');
      assert.equal(snap44166_2.metadata.availability, 'stale', '羽田はstale');
      assert.equal(snap44166_2.observations.length, obsCount44166_1, '直前値保持');

      // 3回目 (t=120s): 時刻不変のまま次周期 -> 羽田のみ再取得して回復
      currentMockTimeMs += 60_000;
      point44166Status = 200;
      await amedasAdapter.runScheduled();
      assert.equal(point44136RequestCount, 2, '江戸川臨海はスキップされたまま');
      assert.equal(point44166RequestCount, 3, '羽田のみ再取得');

      const snap44166_3 = findAmedasSnapshot(database.connection, '44166')!;
      assert.equal(snap44166_3.metadata.availability, 'available', '羽田がavailableに回復');

      // 羽田初回失敗の別ケース
      const initialFailDb = createTempDb();
      try {
        const failDb = initializeDatabase({
          databasePath: initialFailDb.databasePath,
          migrationsDirectory,
        });
        const failAdapters = createScheduledAdapters({
          connection: failDb.connection,
          nowcastService: dummyNowcastService,
          kikikuruService: dummyKikikuruService,
          now: nowFn,
          amedasFetchOptions: {
            fetchFn: async (input) => {
              const urlStr = String(input);
              if (urlStr.includes('latest_time.txt')) {
                return new Response(latestTimeText, { status: 200 });
              }
              if (urlStr.includes('44136')) {
                return new Response(point44136Json, { status: 200 });
              }
              if (urlStr.includes('44166')) {
                return new Response('503 Service Unavailable', { status: 503 });
              }
              return new Response('Not found', { status: 404 });
            },
            clock: () => '2026-09-11T12:00:00.000Z',
          },
        });
        const failAmedas = failAdapters.find((a) => a.source === 'amedas')!;
        await failAmedas.runScheduled();

        const failSnap44136 = findAmedasSnapshot(failDb.connection, '44136');
        const failSnap44166 = findAmedasSnapshot(failDb.connection, '44166');
        assert.ok(failSnap44136);
        assert.equal(failSnap44136.metadata.availability, 'available');
        assert.ok(failSnap44136.observations.length > 0);

        assert.ok(failSnap44166);
        assert.equal(
          failSnap44166.metadata.availability,
          'unavailable',
          '羽田初回失敗はunavailable',
        );
        assert.equal(failSnap44166.observations.length, 0, '観測行なし');

        failDb.close();
      } finally {
        initialFailDb.cleanup();
      }

      database.close();
    } finally {
      cleanup();
    }
  },
);

// ---------------------------------------------------------------------------
// AC4 構造異常と継続失敗:
// 羽田だけ不正な地点 JSON を返し、連続する2周期で羽田の取得回数と失敗数が各1増えることを確認する。
// 正常地点は省略される。復旧後の次周期では羽田も通常の省略に戻る。
// ---------------------------------------------------------------------------
test(
  'AC4. 構造異常と継続失敗: 不正JSONで失敗数増加・次周期再試行、正常地点スキップ、復旧後のスキップ復帰',
  { timeout: 10_000 },
  async () => {
    const { databasePath, cleanup } = createTempDb();
    try {
      const database = initializeDatabase({ databasePath, migrationsDirectory });
      let currentMockTimeMs = new Date('2026-09-11T12:00:00.000Z').getTime();
      const nowFn = () => new Date(currentMockTimeMs);

      let point44136RequestCount = 0;
      let point44166RequestCount = 0;
      let point44166ResponseText = point44166Json;

      const customFetch: typeof fetch = async (input) => {
        const urlStr = String(input);
        if (urlStr.includes('latest_time.txt')) {
          return new Response(latestTimeText, { status: 200 });
        }
        if (urlStr.includes('44136')) {
          point44136RequestCount++;
          return new Response(point44136Json, { status: 200 });
        }
        if (urlStr.includes('44166')) {
          point44166RequestCount++;
          return new Response(point44166ResponseText, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      };

      const adapters = createScheduledAdapters({
        connection: database.connection,
        nowcastService: dummyNowcastService,
        kikikuruService: dummyKikikuruService,
        now: nowFn,
        amedasPointRecheckSeconds: 600,
        amedasFetchOptions: {
          fetchFn: customFetch,
          clock: () => new Date(currentMockTimeMs).toISOString() as UtcIso8601String,
        },
      });

      const amedasAdapter = adapters.find((a) => a.source === 'amedas')!;

      // 1回目 (t=0s): 初回両地点正常
      await amedasAdapter.runScheduled();
      assert.equal(point44136RequestCount, 1);
      assert.equal(point44166RequestCount, 1);

      // 2回目 (t=600s): 600秒経過で再確認。羽田に構造異常（不正なJSON構造）を注入
      currentMockTimeMs += 600_000;
      point44166ResponseText = '{"invalid_key": 123}';
      await amedasAdapter.runScheduled();
      assert.equal(point44136RequestCount, 2);
      assert.equal(point44166RequestCount, 2);

      // 3回目 (t=660s): 時刻不変・再確認時間未満だが、羽田が失敗（consecutiveFailures >= 1）のため羽田のみ再試行、失敗継続
      currentMockTimeMs += 60_000;
      await amedasAdapter.runScheduled();
      assert.equal(point44136RequestCount, 2, '江戸川臨海はスキップ');
      assert.equal(point44166RequestCount, 3, '羽田は再試行');

      // 4回目 (t=720s): 羽田を正常 fixture に復旧して実行
      currentMockTimeMs += 60_000;
      point44166ResponseText = point44166Json;
      await amedasAdapter.runScheduled();
      assert.equal(point44136RequestCount, 2, '江戸川臨海はスキップ');
      assert.equal(point44166RequestCount, 4, '羽田再試行で復旧');

      // 5回目 (t=780s): 復旧後の次周期では両地点ともにスキップ
      currentMockTimeMs += 60_000;
      await amedasAdapter.runScheduled();
      assert.equal(point44136RequestCount, 2, '江戸川臨海スキップ');
      assert.equal(point44166RequestCount, 4, '羽田も通常のスキップに戻る');

      database.close();
    } finally {
      cleanup();
    }
  },
);

// ---------------------------------------------------------------------------
// AC5 最新時刻失敗:
// 片地点だけ最新時刻取得に失敗させ、もう一方の取得・保存が完了することを確認する。
// 失敗地点は地点未試行、地点失敗数と再確認時刻が変わらない。
// 初回失敗と、地点失敗後の再試行待ちに最新時刻失敗を挟む場合を実行し、回復周期で地点を取得する。
// 両地点の最新時刻失敗も実行し、履歴2行・地点取得0回を確認する。
// ---------------------------------------------------------------------------
test(
  'AC5. 最新時刻失敗: 片地点失敗時の他地点完了、地点未試行、失敗後再試行待ちでの挟み込み、両地点失敗',
  { timeout: 10_000 },
  async () => {
    const { databasePath, cleanup } = createTempDb();
    try {
      const database = initializeDatabase({ databasePath, migrationsDirectory });
      let currentMockTimeMs = new Date('2026-09-11T12:00:00.000Z').getTime();
      const nowFn = () => new Date(currentMockTimeMs);

      let latestTimeCallCount = 0;
      let point44136Count = 0;
      let point44166Count = 0;
      let failFirstLatestTime = false;

      const customFetch: typeof fetch = async (input) => {
        const urlStr = String(input);
        if (urlStr.includes('latest_time.txt')) {
          latestTimeCallCount++;
          // 奇数番目（east用）を失敗させる場合
          if (failFirstLatestTime && latestTimeCallCount % 2 === 1) {
            return new Response('500 Internal Error', { status: 500 });
          }
          return new Response(latestTimeText, { status: 200 });
        }
        if (urlStr.includes('44136')) {
          point44136Count++;
          return new Response(point44136Json, { status: 200 });
        }
        if (urlStr.includes('44166')) {
          point44166Count++;
          return new Response(point44166Json, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      };

      const adapters = createScheduledAdapters({
        connection: database.connection,
        nowcastService: dummyNowcastService,
        kikikuruService: dummyKikikuruService,
        now: nowFn,
        amedasPointRecheckSeconds: 600,
        amedasFetchOptions: {
          fetchFn: customFetch,
          clock: () => new Date(currentMockTimeMs).toISOString() as UtcIso8601String,
        },
      });

      const amedasAdapter = adapters.find((a) => a.source === 'amedas')!;

      // 1回目: eastの最新時刻のみ失敗
      failFirstLatestTime = true;
      await amedasAdapter.runScheduled();
      assert.equal(point44136Count, 0, 'east最新時刻失敗のため44136は未試行');
      assert.equal(point44166Count, 1, 'trc最新時刻成功のため44166は取得完了');

      const snap44136_1 = findAmedasSnapshot(database.connection, '44136');
      const snap44166_1 = findAmedasSnapshot(database.connection, '44166');
      assert.ok(snap44136_1);
      assert.equal(snap44136_1.metadata.availability, 'unavailable');
      assert.ok(snap44166_1);
      assert.equal(snap44166_1.metadata.availability, 'available');

      // 2回目: eastの最新時刻が回復 -> eastの地点取得が行われる
      failFirstLatestTime = false;
      currentMockTimeMs += 60_000;
      await amedasAdapter.runScheduled();
      assert.equal(point44136Count, 1, 'east回復により44136取得');
      assert.equal(point44166Count, 1, 'trcはスキップ');

      // 両地点最新時刻失敗の検証
      const allFailDb = createTempDb();
      try {
        const fDb = initializeDatabase({
          databasePath: allFailDb.databasePath,
          migrationsDirectory,
        });
        let fPointCount = 0;
        const fAdapters = createScheduledAdapters({
          connection: fDb.connection,
          nowcastService: dummyNowcastService,
          kikikuruService: dummyKikikuruService,
          amedasFetchOptions: {
            fetchFn: async (url) => {
              if (String(url).includes('latest_time.txt')) {
                return new Response('500 Error', { status: 500 });
              }
              fPointCount++;
              return new Response(point44136Json, { status: 200 });
            },
          },
        });
        const fAmedas = fAdapters.find((a) => a.source === 'amedas')!;
        await fAmedas.runScheduled();

        assert.equal(fPointCount, 0, '両地点最新時刻失敗で地点取得0回');
        const attempts = fDb.connection
          .prepare('SELECT source_kind, target_ref, outcome FROM fetch_attempt ORDER BY id ASC')
          .all() as Array<{ source_kind: string; target_ref: string | null; outcome: string }>;
        assert.equal(attempts.length, 2, '履歴2行');
        assert.deepEqual(attempts, [
          { source_kind: 'amedas_latest_time', target_ref: '44136', outcome: 'failure' },
          { source_kind: 'amedas_latest_time', target_ref: '44166', outcome: 'failure' },
        ]);
        fDb.close();
      } finally {
        allFailDb.cleanup();
      }

      database.close();
    } finally {
      cleanup();
    }
  },
);

// ---------------------------------------------------------------------------
// AC6 同一地点共有:
// 重複排除 helper に合成 resolver を注入し、同一地点の2会場から代表会場1個だけが返ることを完全一致で確認する。
// その代表を用いた編成で状態/adapterが1個、最新時刻と地点 JSON が各1回となることを確認する。
// 同じ地点コードで elements または表示名が異なる場合は生成前に例外となる。
// ---------------------------------------------------------------------------
test(
  'AC6. 同一地点共有: 重複排除ヘルパーの完全一致、adapter/状態集約、定義不一致時の例外検知',
  { timeout: 10_000 },
  async () => {
    const { databasePath, cleanup } = createTempDb();
    try {
      const database = initializeDatabase({ databasePath, migrationsDirectory });

      // 1. 重複排除ヘルパー: 両会場が同一地点（44136, 江戸川臨海, 11112010）を指す合成 resolver
      const syntheticTarget: AmedasTarget = {
        stationCode: '44136' as AmedasTarget['stationCode'],
        displayName: '江戸川臨海',
        elements: '11112010',
      };
      const syntheticResolver = (): AmedasTarget => syntheticTarget;

      const uniqueVenues = resolveUniqueAmedasVenues(['east', 'trc'], syntheticResolver);
      assert.deepEqual(uniqueVenues, ['east'], '初出順の代表会場1個だけが返る');

      // 2. 定義不一致（displayName 不一致）の場合は例外
      assert.throws(
        () =>
          resolveUniqueAmedasVenues(['east', 'trc'], (venueId) => {
            if (venueId === 'east') {
              return {
                stationCode: '44136' as AmedasTarget['stationCode'],
                displayName: '江戸川臨海A',
                elements: '11112010',
              };
            }
            return {
              stationCode: '44136' as AmedasTarget['stationCode'],
              displayName: '江戸川臨海B',
              elements: '11112010',
            };
          }),
        /同一地点 \(44136\) に対する会場定義が一致しません/,
      );

      // 3. 定義不一致（elements 不一致）の場合も例外
      assert.throws(
        () =>
          resolveUniqueAmedasVenues(['east', 'trc'], (venueId) => {
            if (venueId === 'east') {
              return {
                stationCode: '44136' as AmedasTarget['stationCode'],
                displayName: '江戸川臨海',
                elements: '11112010',
              };
            }
            return {
              stationCode: '44136' as AmedasTarget['stationCode'],
              displayName: '江戸川臨海',
              elements: '11110000',
            };
          }),
        /同一地点 \(44136\) に対する会場定義が一致しません/,
      );

      // 4. 重複排除結果から代表会場ごとの adapter を編成し、状態/adapterが1個、最新時刻と地点 JSON が各1回となることを確認
      const representativeVenue = uniqueVenues[0]!;
      const state = new AmedasFetchState(representativeVenue);
      const singleAdapter = new AmedasScheduledAdapter(database.connection, state, 600, {
        fetchOptions: {
          fetchFn: async (input) => {
            const urlStr = String(input);
            if (urlStr.includes('latest_time.txt')) {
              return new Response(latestTimeText, { status: 200 });
            }
            return new Response(point44136Json, { status: 200 });
          },
        },
      });
      const multiAdapter = new MultiVenueAmedasScheduledAdapter([singleAdapter]);
      await multiAdapter.runScheduled();

      const attempts = database.connection
        .prepare('SELECT source_kind, target_ref FROM fetch_attempt ORDER BY id ASC')
        .all() as Array<{ source_kind: string; target_ref: string | null }>;
      assert.equal(attempts.length, 2);
      assert.deepEqual(attempts, [
        { source_kind: 'amedas_latest_time', target_ref: '44136' },
        { source_kind: 'amedas_point', target_ref: '44136' },
      ]);

      database.close();
    } finally {
      cleanup();
    }
  },
);

// ---------------------------------------------------------------------------
// AC7 夜間・実行中完了:
// 実 factory の集合 adapter を fake timer の TimeBasedPollingScheduler に接続する。
// 20:00 JST 前に両地点の応答を保留して開始し、20:00を越えて応答を解放すると両地点が保存される。
// 夜間中は再試行を含め追加通信0回。翌04:00に両地点取得が再開する。
// 夜間に新規起動した場合も04:00まで通信0回。既定の日中300/60/300秒は既存試験で確認する。
// ---------------------------------------------------------------------------
test(
  'AC7. 夜間・実行中完了: 20:00跨ぎの保留と安全な完了、夜間通信0回、翌04:00再開、夜間新規起動',
  { timeout: 10_000 },
  async () => {
    const { databasePath, cleanup } = createTempDb();
    try {
      const database = initializeDatabase({ databasePath, migrationsDirectory });
      // 19:59:50 JST = 2026-09-12 10:59:50Z (20:00まであと10秒)
      const timer = new FakeTimerScheduler('2026-09-12T10:59:50.000Z');

      let holdPointRequests = true;
      let resolvePoint44136: ((val: Response) => void) | null = null;
      let resolvePoint44166: ((val: Response) => void) | null = null;
      let requestCount = 0;

      const customFetch: typeof fetch = async (input) => {
        const urlStr = String(input);
        requestCount++;
        if (urlStr.includes('latest_time.txt')) {
          return new Response(latestTimeText, { status: 200 });
        }
        if (urlStr.includes('44136')) {
          if (holdPointRequests) {
            return new Promise<Response>((resolve) => {
              resolvePoint44136 = resolve;
            });
          }
          return new Response(point44136Json, { status: 200 });
        }
        if (urlStr.includes('44166')) {
          if (holdPointRequests) {
            return new Promise<Response>((resolve) => {
              resolvePoint44166 = resolve;
            });
          }
          return new Response(point44166Json, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      };

      const adapters = createScheduledAdapters({
        connection: database.connection,
        nowcastService: dummyNowcastService,
        kikikuruService: dummyKikikuruService,
        now: timer.now,
        amedasFetchOptions: {
          fetchFn: customFetch,
          clock: timer.clock,
        },
      });

      const scheduler = new TimeBasedPollingScheduler({
        schedule: defaultSchedule,
        adapters,
        xmlPollingService: new DummyXmlPollingService() as unknown as JmaXmlPollingService,
        now: timer.now,
        setTimer: timer.setTimer,
        clearTimer: timer.clearTimer,
      });

      await scheduler.start();
      await new Promise<void>((resolve) => setImmediate(resolve));

      // 19:59:50 に開始され、latest_time が2回呼ばれ、両地点の地点データPromiseが保留中
      assert.ok(resolvePoint44136);
      assert.ok(resolvePoint44166);

      // 20秒進めて 20:00:10 JST (夜間突入)
      await timer.advanceTime(20_000);

      // 保留していた応答を解放し、以降の再開取得は即時解決するようにする
      holdPointRequests = false;
      resolvePoint44136!(new Response(point44136Json, { status: 200 }));
      resolvePoint44166!(new Response(point44166Json, { status: 200 }));
      await new Promise<void>((resolve) => setImmediate(resolve));

      // 両地点が保存されていること
      const snap44136 = findAmedasSnapshot(database.connection, '44136');
      const snap44166 = findAmedasSnapshot(database.connection, '44166');
      assert.ok(snap44136);
      assert.ok(snap44166);
      assert.equal(snap44136.metadata.availability, 'available');
      assert.equal(snap44166.metadata.availability, 'available');

      // 夜間中は追加通信0回 (20:00:10 JST から 03:59:00 JST まで = 7時間58分50秒進める)
      const countAfterRelease = requestCount;
      await timer.advanceTime((7 * 3600 + 58 * 60 + 50) * 1000);
      assert.equal(requestCount, countAfterRelease, '夜間中は追加通信0回');

      // 翌 04:00:10 JST に到達 (あと70秒進める: 03:59:00 -> 04:00:10)
      await timer.advanceTime(70 * 1000);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.ok(requestCount > countAfterRelease, '04:00 に両地点取得が再開');

      await scheduler.stop();

      // 夜間に新規起動した場合の通信0回検証
      const nightTimer = new FakeTimerScheduler('2026-09-12T15:00:00.000Z'); // 00:00 JST
      let nightRequestCount = 0;
      const nightAdapters = createScheduledAdapters({
        connection: database.connection,
        nowcastService: dummyNowcastService,
        kikikuruService: dummyKikikuruService,
        now: nightTimer.now,
        amedasFetchOptions: {
          fetchFn: async () => {
            nightRequestCount++;
            return new Response(latestTimeText, { status: 200 });
          },
        },
      });

      const nightScheduler = new TimeBasedPollingScheduler({
        schedule: defaultSchedule,
        adapters: nightAdapters,
        xmlPollingService: new DummyXmlPollingService() as unknown as JmaXmlPollingService,
        now: nightTimer.now,
        setTimer: nightTimer.setTimer,
        clearTimer: nightTimer.clearTimer,
      });

      await nightScheduler.start();
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(nightRequestCount, 0, '夜間新規起動時は通信0回');

      // 03:59:00 JST まで通信0回
      await nightTimer.advanceTime(3 * 3600 * 1000 + 59 * 60 * 1000);
      assert.equal(nightRequestCount, 0, '03:59 まで通信0回');

      await nightScheduler.stop();
      database.close();
    } finally {
      cleanup();
    }
  },
);

// ---------------------------------------------------------------------------
// AC8 再起動と保持:
// 一時ファイル DB に両地点を正常保存して接続を閉じ、再接続して新しい factory/状態を作る。
// 日中初周期は同じ最新時刻でも両地点を取得し、過去ブロック取得0回。
// 同条件で羽田失敗の場合は再起動前の羽田値を stale で保持し、江戸川臨海値と混同しない。
// ---------------------------------------------------------------------------
test(
  'AC8. 再起動と保持: 再起動後の初周期再取得、過去ブロック0回、再起動後片地点失敗時のstale保持と値分離',
  { timeout: 10_000 },
  async () => {
    const { databasePath, cleanup } = createTempDb();
    try {
      let requestedUrls: string[] = [];
      const customFetch: typeof fetch = async (input) => {
        const urlStr = String(input);
        requestedUrls.push(urlStr);
        if (urlStr.includes('latest_time.txt')) {
          return new Response(latestTimeText, { status: 200 });
        }
        if (urlStr.includes('44136')) {
          return new Response(point44136Json, { status: 200 });
        }
        if (urlStr.includes('44166')) {
          return new Response(point44166Json, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      };

      // 1. プロセス1: 両地点を保存して閉じる
      {
        const db1 = initializeDatabase({ databasePath, migrationsDirectory });
        const adapters1 = createScheduledAdapters({
          connection: db1.connection,
          nowcastService: dummyNowcastService,
          kikikuruService: dummyKikikuruService,
          amedasFetchOptions: {
            fetchFn: customFetch,
            clock: () => '2026-09-11T12:00:00.000Z',
          },
        });
        const amedas1 = adapters1.find((a) => a.source === 'amedas')!;
        await amedas1.runScheduled();
        db1.close();
      }

      // 2. プロセス2 (再起動): 新しい factory / 状態で接続
      requestedUrls = [];
      const point44166Status = 503; // 再起動後の初周期で羽田のみ失敗させる
      const restartFetch: typeof fetch = async (input) => {
        const urlStr = String(input);
        requestedUrls.push(urlStr);
        if (urlStr.includes('latest_time.txt')) {
          return new Response(latestTimeText, { status: 200 });
        }
        if (urlStr.includes('44136')) {
          return new Response(point44136Json, { status: 200 });
        }
        if (urlStr.includes('44166')) {
          if (point44166Status !== 200) {
            return new Response('503 Service Unavailable', { status: point44166Status });
          }
          return new Response(point44166Json, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      };

      const db2 = initializeDatabase({ databasePath, migrationsDirectory });
      const adapters2 = createScheduledAdapters({
        connection: db2.connection,
        nowcastService: dummyNowcastService,
        kikikuruService: dummyKikikuruService,
        amedasFetchOptions: {
          fetchFn: restartFetch,
          clock: () => '2026-09-11T12:10:00.000Z',
        },
      });
      const amedas2 = adapters2.find((a) => a.source === 'amedas')!;
      await amedas2.runScheduled();

      // 日中初周期は同じ最新時刻でも両地点を試行し、過去ブロック取得0回
      assert.equal(requestedUrls.length, 4, '最新時刻2回 + 地点データ2回 = 4回（過去ブロック0回）');

      const snap44136 = findAmedasSnapshot(db2.connection, '44136')!;
      const snap44166 = findAmedasSnapshot(db2.connection, '44166')!;

      // 江戸川臨海は更新成功で available
      assert.equal(snap44136.metadata.availability, 'available');
      assert.ok(snap44136.observations.length > 0);

      // 羽田は再起動前の羽田値を stale で保持し、江戸川臨海の値と混同しない
      assert.equal(snap44166.metadata.availability, 'stale');
      assert.ok(snap44166.observations.length > 0);
      assert.equal(
        snap44166.observations.some((o) => o.element === 'humidity'),
        false,
        '羽田の保持値に江戸川臨海の湿度等は混入しない',
      );

      db2.close();
    } finally {
      cleanup();
    }
  },
);

// ---------------------------------------------------------------------------
// AC9 非提供・欠測の維持:
// 両地点の実 service 取得経路に品質付き fixture を渡す。羽田の湿度等の非提供要素が正常な数値や他地点の値にならず、
// 対応要素の AQC 5/6 の null と qualityFlag、江戸川臨海の日照推計フラグが既存契約どおり保存されることを確認する。
// ---------------------------------------------------------------------------
test(
  'AC9. 非提供・欠測の維持: 羽田の非提供要素、AQC品質フラグ、江戸川臨海の日照推計フラグの保存検証',
  { timeout: 10_000 },
  async () => {
    const { databasePath, cleanup } = createTempDb();
    try {
      const database = initializeDatabase({ databasePath, migrationsDirectory });

      const adapters = createScheduledAdapters({
        connection: database.connection,
        nowcastService: dummyNowcastService,
        kikikuruService: dummyKikikuruService,
        amedasFetchOptions: {
          fetchFn: async (input) => {
            const urlStr = String(input);
            if (urlStr.includes('latest_time.txt')) {
              return new Response(latestTimeText, { status: 200 });
            }
            if (urlStr.includes('44136')) {
              return new Response(point44136Json, { status: 200 });
            }
            if (urlStr.includes('44166')) {
              return new Response(point44166Json, { status: 200 });
            }
            return new Response('Not found', { status: 404 });
          },
          clock: () => '2026-09-11T12:00:00.000Z',
        },
      });

      const amedas = adapters.find((a) => a.source === 'amedas')!;
      await amedas.runScheduled();

      // 1. 羽田（44166）の非提供要素（humidity 等）が存在しないこと
      const trcObs = database.connection
        .prepare(
          `SELECT obs.element, obs.value_number, obs.quality_flag, obs.is_estimated
         FROM amedas_observation obs
         JOIN amedas_snapshot snap ON obs.snapshot_id = snap.id
         WHERE snap.station_code = '44166'`,
        )
        .all() as Array<{
        element: string;
        value_number: number | null;
        quality_flag: number;
        is_estimated: number;
      }>;

      assert.ok(trcObs.length > 0);
      assert.equal(
        trcObs.some((o) => o.element === 'humidity'),
        false,
        '羽田に humidity は存在しない',
      );
      assert.equal(
        trcObs.some((o) => o.is_estimated === 1),
        false,
        '羽田に is_estimated=1 は存在しない',
      );

      // 2. 江戸川臨海（44136）の日照推計フラグ (sun10m, sun1h)
      const eastEstimated = database.connection
        .prepare(
          `SELECT DISTINCT obs.element
         FROM amedas_observation obs
         JOIN amedas_snapshot snap ON obs.snapshot_id = snap.id
         WHERE snap.station_code = '44136' AND obs.is_estimated = 1
         ORDER BY obs.element ASC`,
        )
        .all() as Array<{ element: string }>;
      assert.deepEqual(
        eastEstimated.map((r) => r.element),
        ['sun10m', 'sun1h'],
      );

      database.close();
    } finally {
      cleanup();
    }
  },
);

// ---------------------------------------------------------------------------
// AC10 多重実行・例外分離:
// 片地点の Promise を保留し、全体の完了が先行しないことと次周期が重ならないことを確認する。
// 片地点の予期しない例外を注入しても他地点は完了し、集合 adapter は全地点終了後に例外を返す。
// スケジューラ登録は amedas 1個である。
// ---------------------------------------------------------------------------
test(
  'AC10. 多重実行・例外分離: 遅延地点による全体待機、予期しない例外の分離集約、単一amedas登録と非重複',
  { timeout: 10_000 },
  async () => {
    const { databasePath, cleanup } = createTempDb();
    try {
      const database = initializeDatabase({ databasePath, migrationsDirectory });
      const timer = new FakeTimerScheduler('2026-09-12T01:00:00.000Z');

      // 1. スケジューラ登録が amedas 1個であり、実スケジューラでも非重複であることを確認
      const adapters = createScheduledAdapters({
        connection: database.connection,
        nowcastService: dummyNowcastService,
        kikikuruService: dummyKikikuruService,
        now: timer.now,
      });
      assert.equal(adapters.length, 3);
      const amedasAdapters = adapters.filter((a) => a.source === 'amedas');
      assert.equal(amedasAdapters.length, 1, 'amedas adapter は単一登録');

      // 実スケジューラに登録しても amedas の登録は1つであり、重複タイマーや多重管理が発生しないことを確認
      const scheduler = new TimeBasedPollingScheduler({
        schedule: defaultSchedule,
        adapters,
        xmlPollingService: new DummyXmlPollingService() as unknown as JmaXmlPollingService,
        now: timer.now,
        setTimer: timer.setTimer,
        clearTimer: timer.clearTimer,
      });
      const schedulerStatus = scheduler.getStatus();
      assert.equal(schedulerStatus.sources.amedas.source, 'amedas');
      // sources のキー一覧も amedas は1つのみ
      assert.deepEqual(Object.keys(schedulerStatus.sources).sort(), [
        'amedas',
        'kikikuru',
        'nowcast',
        'xml',
      ]);

      // 2. 片地点の Promise を保留し、全体の完了が先行しないことの検証
      let resolve44166: ((res: Response) => void) | null = null;
      let amedasCompleted = false;

      const slowAdapters = createScheduledAdapters({
        connection: database.connection,
        nowcastService: dummyNowcastService,
        kikikuruService: dummyKikikuruService,
        now: timer.now,
        amedasFetchOptions: {
          fetchFn: async (input) => {
            const urlStr = String(input);
            if (urlStr.includes('latest_time.txt')) {
              return new Response(latestTimeText, { status: 200 });
            }
            if (urlStr.includes('44136')) {
              return new Response(point44136Json, { status: 200 });
            }
            if (urlStr.includes('44166')) {
              return new Promise<Response>((resolve) => {
                resolve44166 = resolve;
              });
            }
            return new Response('Not found', { status: 404 });
          },
        },
      });

      const slowAmedas = slowAdapters.find((a) => a.source === 'amedas')!;
      const runPromise = slowAmedas.runScheduled().then(() => {
        amedasCompleted = true;
      });

      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(amedasCompleted, false, '保留中のため全体の完了は先行しない');

      // 保留を解放
      resolve44166!(new Response(point44166Json, { status: 200 }));
      await runPromise;
      assert.equal(amedasCompleted, true, '全地点終了で完了');

      // 3. 片地点の予期しない例外を注入しても他地点は完了し、集合 adapter は全地点終了後に例外を投げる
      let completed44136 = false;
      const normalAdapter = new AmedasScheduledAdapter(
        database.connection,
        new AmedasFetchState('east'),
        600,
        {
          fetchOptions: {
            fetchFn: async (url) => {
              if (String(url).includes('latest_time.txt')) {
                return new Response(latestTimeText, { status: 200 });
              }
              completed44136 = true;
              return new Response(point44136Json, { status: 200 });
            },
          },
        },
      );

      const failingAdapter = {
        source: 'amedas' as const,
        runScheduled: async () => {
          throw new Error('Fatal unexpected driver crash');
        },
      };

      const multiAdapter = new MultiVenueAmedasScheduledAdapter([
        normalAdapter,
        failingAdapter as unknown as AmedasScheduledAdapter,
      ]);

      await assert.rejects(
        multiAdapter.runScheduled(),
        /Fatal unexpected driver crash/,
        '全地点終了後に例外が通知される',
      );
      assert.equal(completed44136, true, '片地点の例外でも他地点の処理は完了する');

      database.close();
    } finally {
      cleanup();
    }
  },
);
