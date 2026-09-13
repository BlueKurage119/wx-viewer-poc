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
// 観測実値をリテラル期待値で完全一致比較する。
// ---------------------------------------------------------------------------
test(
  'AC1. 両地点と履歴: factory 既定で両地点を取得・保存し、地点別の異なる観測実値をリテラル完全一致比較、fetch_attempt 4行を検証',
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
      assert.equal(snap44136.metadata.issuedAt, '2026-09-11T11:40:00.000Z');
      assert.equal(snap44136.metadata.validAt, '2026-09-11T11:40:00.000Z');
      assert.equal(
        snap44136.observations.length,
        289,
        '全17時刻分の観測レコード数 (17要素×17時刻)',
      );

      assert.equal(snap44166.stationCode, '44166');
      assert.equal(snap44166.stationName, '羽田');
      assert.equal(snap44166.metadata.availability, 'available');
      assert.equal(snap44166.metadata.issuedAt, '2026-09-11T11:40:00.000Z');
      assert.equal(snap44166.metadata.validAt, '2026-09-11T11:40:00.000Z');
      assert.equal(
        snap44166.observations.length,
        238,
        '全17時刻分の観測レコード数 (14要素×17時刻)',
      );

      // 地点別の異なる観測実値をリテラル期待値で完全一致比較 (最新時刻 2026-09-11T11:40:00.000Z の全要素)
      const latestObs44136 = snap44136.observations
        .filter((o) => o.observedAt === '2026-09-11T11:40:00.000Z')
        .map((o) => ({
          observedAt: o.observedAt,
          element: o.element,
          valueNumber: o.valueNumber,
          valueText: o.valueText,
          qualityFlag: o.qualityFlag,
          isEstimated: o.isEstimated,
        }));

      const expected44136LatestObs = [
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'gust',
          valueNumber: 6.0,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'gustDirection',
          valueNumber: 1,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'gustTime',
          valueNumber: null,
          valueText: '06:08',
          qualityFlag: null,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'humidity',
          valueNumber: 95,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'maxTemp',
          valueNumber: 20.6,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'maxTempTime',
          valueNumber: null,
          valueText: '05:23',
          qualityFlag: null,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'minTemp',
          valueNumber: 18.0,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'minTempTime',
          valueNumber: null,
          valueText: '23:21',
          qualityFlag: null,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'precipitation10m',
          valueNumber: 0.0,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'precipitation1h',
          valueNumber: 0.0,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'precipitation24h',
          valueNumber: 15.5,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'precipitation3h',
          valueNumber: 0.0,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'sun10m',
          valueNumber: 0,
          valueText: null,
          qualityFlag: 0,
          isEstimated: true,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'sun1h',
          valueNumber: 0.0,
          valueText: null,
          qualityFlag: 0,
          isEstimated: true,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'temp',
          valueNumber: 20.2,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'wind',
          valueNumber: 1.7,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'windDirection',
          valueNumber: 1,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
      ];
      assert.deepEqual(latestObs44136, expected44136LatestObs, '44136 最新時刻の観測実値完全一致');

      const latestObs44166 = snap44166.observations
        .filter((o) => o.observedAt === '2026-09-11T11:40:00.000Z')
        .map((o) => ({
          observedAt: o.observedAt,
          element: o.element,
          valueNumber: o.valueNumber,
          valueText: o.valueText,
          qualityFlag: o.qualityFlag,
          isEstimated: o.isEstimated,
        }));

      const expected44166LatestObs = [
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'gust',
          valueNumber: 7.2,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'gustDirection',
          valueNumber: 16,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'gustTime',
          valueNumber: null,
          valueText: '16:58',
          qualityFlag: null,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'maxTemp',
          valueNumber: 21.0,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'maxTempTime',
          valueNumber: null,
          valueText: '11:11',
          qualityFlag: null,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'minTemp',
          valueNumber: 18.7,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'minTempTime',
          valueNumber: null,
          valueText: '00:08',
          qualityFlag: null,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'precipitation10m',
          valueNumber: 0.0,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'precipitation1h',
          valueNumber: 0.0,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'precipitation24h',
          valueNumber: 20.5,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'precipitation3h',
          valueNumber: 0.0,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'temp',
          valueNumber: 20.7,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'wind',
          valueNumber: 3.3,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
        {
          observedAt: '2026-09-11T11:40:00.000Z',
          element: 'windDirection',
          valueNumber: 1,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
      ];
      assert.deepEqual(latestObs44166, expected44166LatestObs, '44166 最新時刻の観測実値完全一致');

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
// 羽田の保存済み観測配列を失敗前後に deepEqual して保持を示す。
// 次の既存周期で時刻不変のまま羽田だけ再取得して回復し、回復 fixture は羽田の値を実際に変更して新値と失敗数0を比較する。
// 正常地点の再確認時刻が失敗地点の再試行でずれないことを599/600秒等の時刻進行と地点別取得回数で実測する。
// 羽田初回失敗も別ケースで実行し、unavailable・観測行なし・江戸川臨海値の流用なしを確認する。
// ---------------------------------------------------------------------------
test(
  'AC3. 片地点の失敗・回復: 羽田503で観測配列deepEqual保持、羽田値変更回復と失敗数0、正常地点再確認時刻の非干渉、初回失敗',
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

      // 羽田の回復用 fixture: 最新観測の temp を 25.8 に変更
      const point44166RecoveredData = JSON.parse(point44166Json);
      point44166RecoveredData['20260911204000'].temp = [25.8, 0];
      const point44166RecoveredJson = JSON.stringify(point44166RecoveredData);
      let point44166ResponseText = point44166Json;

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
          return new Response(point44166ResponseText, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      };

      // 内部状態確認のため、テスト側から AmedasFetchState を明示注入した単地点 adapter 2本を作成し集合 adapter で実行
      const eastState = new AmedasFetchState('east');
      const trcState = new AmedasFetchState('trc');

      const eastAdapter = new AmedasScheduledAdapter(database.connection, eastState, 600, {
        fetchOptions: {
          fetchFn: customFetch,
          clock: () => new Date(currentMockTimeMs).toISOString() as UtcIso8601String,
        },
        now: nowFn,
      });
      const trcAdapter = new AmedasScheduledAdapter(database.connection, trcState, 600, {
        fetchOptions: {
          fetchFn: customFetch,
          clock: () => new Date(currentMockTimeMs).toISOString() as UtcIso8601String,
        },
        now: nowFn,
      });

      const multiAdapter = new MultiVenueAmedasScheduledAdapter([eastAdapter, trcAdapter]);

      // 1回目 (t=0s): 両地点正常
      await multiAdapter.runScheduled();
      assert.equal(point44136RequestCount, 1);
      assert.equal(point44166RequestCount, 1);
      assert.equal(eastState.getStreamStatus('pointData').consecutiveFailures, 0);
      assert.equal(trcState.getStreamStatus('pointData').consecutiveFailures, 0);

      const snap44166_1 = findAmedasSnapshot(database.connection, '44166')!;
      assert.equal(snap44166_1.metadata.availability, 'available');
      assert.ok(snap44166_1.observations.length > 0);

      // 2回目 (t=60s): 時刻更新周期で羽田のみ 503
      currentMockTimeMs += 60_000;
      currentLatestTime = '2026-09-11T20:40:00+09:00';
      point44166Status = 503;
      await multiAdapter.runScheduled();
      assert.equal(point44136RequestCount, 2, '江戸川臨海は更新成功');
      assert.equal(point44166RequestCount, 2, '羽田は取得試行して失敗');
      assert.equal(eastState.getStreamStatus('pointData').consecutiveFailures, 0);
      assert.equal(trcState.getStreamStatus('pointData').consecutiveFailures, 1);

      const snap44136_2 = findAmedasSnapshot(database.connection, '44136')!;
      const snap44166_2 = findAmedasSnapshot(database.connection, '44166')!;
      assert.equal(snap44136_2.metadata.availability, 'available');
      assert.equal(snap44166_2.metadata.availability, 'stale', '羽田はstale');
      // 羽田の保存済み観測配列を失敗前後に deepEqual して保持を示す
      assert.deepEqual(
        snap44166_2.observations,
        snap44166_1.observations,
        '失敗前後で羽田の観測値配列が完全に保持されていること',
      );

      // 3回目 (t=120s): 時刻不変のまま次周期 -> 羽田のみ再取得して回復（新値 fixture を適用）
      currentMockTimeMs += 60_000;
      point44166Status = 200;
      point44166ResponseText = point44166RecoveredJson;
      await multiAdapter.runScheduled();
      assert.equal(point44136RequestCount, 2, '江戸川臨海はスキップされたまま');
      assert.equal(point44166RequestCount, 3, '羽田のみ再取得');
      assert.equal(
        trcState.getStreamStatus('pointData').consecutiveFailures,
        0,
        '羽田回復で失敗数0',
      );

      const snap44166_3 = findAmedasSnapshot(database.connection, '44166')!;
      assert.equal(snap44166_3.metadata.availability, 'available', '羽田がavailableに回復');
      // 回復 fixture の新値（temp = 25.8）が保存されていること
      const latestRecoveredTemp = snap44166_3.observations.find(
        (o) => o.observedAt === '2026-09-11T11:40:00.000Z' && o.element === 'temp',
      );
      assert.ok(latestRecoveredTemp);
      assert.equal(latestRecoveredTemp.valueNumber, 25.8, '新値 25.8 が保存されていること');

      // 正常地点の再確認時刻が失敗地点の再試行でずれないことを599/600秒等の時刻進行と地点別取得回数で実測
      // 江戸川臨海の最終試行時刻は t=60s。羽田の最終試行時刻は t=120s。
      // 江戸川臨海が 600秒経過するのは t=60s + 600s = t=660s。
      // t=659s (t=60s + 599s) では江戸川臨海はスキップ (取得回数 2 のまま)
      currentMockTimeMs = new Date('2026-09-11T12:00:00.000Z').getTime() + 659_000;
      await multiAdapter.runScheduled();
      assert.equal(point44136RequestCount, 2, 't=659s では江戸川臨海スキップ');
      assert.equal(point44166RequestCount, 3, 't=659s (羽田試行から539s) では羽田スキップ');

      // t=660s (t=60s + 600s) では江戸川臨海が再確認 (取得回数 3 に増加)
      currentMockTimeMs = new Date('2026-09-11T12:00:00.000Z').getTime() + 660_000;
      await multiAdapter.runScheduled();
      assert.equal(point44136RequestCount, 3, 't=660s で江戸川臨海のみ再確認');
      assert.equal(point44166RequestCount, 3, 't=660s では羽田はまだスキップ (羽田試行から540s)');

      // t=720s (t=120s + 600s) では羽田が再確認 (取得回数 4 に増加)
      currentMockTimeMs = new Date('2026-09-11T12:00:00.000Z').getTime() + 720_000;
      await multiAdapter.runScheduled();
      assert.equal(
        point44136RequestCount,
        3,
        't=720s (江戸川臨海試行から60s) では江戸川臨海スキップ',
      );
      assert.equal(point44166RequestCount, 4, 't=720s で羽田が再確認');

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
// 羽田だけ不正な地点 JSON を返し、連続する2周期で羽田の取得回数と失敗数が各1増えることを直接確認（HTTP回数だけでなくconsecutiveFailuresを直接確認）。
// 正常地点は省略され失敗数0を維持。復旧後の次周期では羽田も通常の省略に戻り失敗数0になる。
// ---------------------------------------------------------------------------
test(
  'AC4. 構造異常と継続失敗: 不正JSONで羽田の地点連続失敗数1→2を直接確認、正常地点0維持、回復後0復帰とスキップ',
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

      const eastState = new AmedasFetchState('east');
      const trcState = new AmedasFetchState('trc');

      const eastAdapter = new AmedasScheduledAdapter(database.connection, eastState, 600, {
        fetchOptions: {
          fetchFn: customFetch,
          clock: () => new Date(currentMockTimeMs).toISOString() as UtcIso8601String,
        },
        now: nowFn,
      });
      const trcAdapter = new AmedasScheduledAdapter(database.connection, trcState, 600, {
        fetchOptions: {
          fetchFn: customFetch,
          clock: () => new Date(currentMockTimeMs).toISOString() as UtcIso8601String,
        },
        now: nowFn,
      });

      const multiAdapter = new MultiVenueAmedasScheduledAdapter([eastAdapter, trcAdapter]);

      // 1回目 (t=0s): 初回両地点正常
      await multiAdapter.runScheduled();
      assert.equal(point44136RequestCount, 1);
      assert.equal(point44166RequestCount, 1);
      assert.equal(eastState.getStreamStatus('pointData').consecutiveFailures, 0);
      assert.equal(trcState.getStreamStatus('pointData').consecutiveFailures, 0);

      // 2回目 (t=600s): 600秒経過で再確認。羽田に構造異常（不正なJSON構造）を注入
      currentMockTimeMs += 600_000;
      point44166ResponseText = '{"invalid_key": 123}';
      await multiAdapter.runScheduled();
      assert.equal(point44136RequestCount, 2);
      assert.equal(point44166RequestCount, 2);
      assert.equal(
        eastState.getStreamStatus('pointData').consecutiveFailures,
        0,
        '正常地点は失敗数0維持',
      );
      assert.equal(
        trcState.getStreamStatus('pointData').consecutiveFailures,
        1,
        '羽田の失敗数 1 を直接確認',
      );

      // 3回目 (t=660s): 時刻不変・再確認時間未満だが、羽田が失敗（consecutiveFailures >= 1）のため羽田のみ再試行、失敗継続
      currentMockTimeMs += 60_000;
      await multiAdapter.runScheduled();
      assert.equal(point44136RequestCount, 2, '江戸川臨海はスキップ');
      assert.equal(point44166RequestCount, 3, '羽田は再試行');
      assert.equal(
        eastState.getStreamStatus('pointData').consecutiveFailures,
        0,
        '正常地点は失敗数0維持',
      );
      assert.equal(
        trcState.getStreamStatus('pointData').consecutiveFailures,
        2,
        '羽田の失敗数 1→2 を直接確認',
      );

      // 4回目 (t=720s): 羽田を正常 fixture に復旧して実行
      currentMockTimeMs += 60_000;
      point44166ResponseText = point44166Json;
      await multiAdapter.runScheduled();
      assert.equal(point44136RequestCount, 2, '江戸川臨海はスキップ');
      assert.equal(point44166RequestCount, 4, '羽田再試行で復旧');
      assert.equal(
        eastState.getStreamStatus('pointData').consecutiveFailures,
        0,
        '正常地点は失敗数0維持',
      );
      assert.equal(
        trcState.getStreamStatus('pointData').consecutiveFailures,
        0,
        '羽田回復で失敗数0復帰を直接確認',
      );

      // 5回目 (t=780s): 復旧後の次周期では両地点ともにスキップ
      currentMockTimeMs += 60_000;
      await multiAdapter.runScheduled();
      assert.equal(point44136RequestCount, 2, '江戸川臨海スキップ');
      assert.equal(point44166RequestCount, 4, '羽田も通常のスキップに戻る');
      assert.equal(eastState.getStreamStatus('pointData').consecutiveFailures, 0);
      assert.equal(trcState.getStreamStatus('pointData').consecutiveFailures, 0);

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
// 地点取得失敗→次周期latest_timeだけ失敗→同じ最新時刻で回復、を追加。
// 600秒再確認期限直前/期限時のlatest失敗→回復でも再確認時刻が誤更新されず地点取得すること。
// 初回失敗、両地点の最新時刻失敗も実行し、履歴2行・地点取得0回を確認する。
// ---------------------------------------------------------------------------
test(
  'AC5. 最新時刻失敗: 地点失敗後のlatest失敗挟み込み・targetRef検証、600秒期限時latest失敗からの回復、初回・両地点失敗',
  { timeout: 10_000 },
  async () => {
    // --- ケース 1: 地点取得失敗 → 次周期 latest_time だけ失敗 → 同じ最新時刻で回復 ---
    {
      const { databasePath, cleanup } = createTempDb();
      try {
        const database = initializeDatabase({ databasePath, migrationsDirectory });
        let currentMockTimeMs = new Date('2026-09-11T12:00:00.000Z').getTime();
        const nowFn = () => new Date(currentMockTimeMs);

        let point44136Count = 0;
        let point44166Count = 0;
        const latestTime44136Status = 200;
        let latestTime44166Status = 200;
        let point44166Status = 200;
        let currentLatestTime = '2026-09-11T20:30:00+09:00';

        const customFetch: typeof fetch = async (input) => {
          const urlStr = String(input);
          if (urlStr.includes('latest_time.txt')) {
            return new Response(currentLatestTime, { status: 200 });
          }
          if (urlStr.includes('44136')) {
            point44136Count++;
            return new Response(point44136Json, { status: 200 });
          }
          if (urlStr.includes('44166')) {
            point44166Count++;
            if (point44166Status !== 200) {
              return new Response('503 Service Unavailable', { status: point44166Status });
            }
            return new Response(point44166Json, { status: 200 });
          }
          return new Response('Not found', { status: 404 });
        };

        const eastState = new AmedasFetchState('east');
        const trcState = new AmedasFetchState('trc');

        const eastAdapter = new AmedasScheduledAdapter(database.connection, eastState, 600, {
          fetchOptions: {
            fetchFn: async (input) => {
              const urlStr = String(input);
              if (urlStr.includes('latest_time.txt')) {
                return new Response(currentLatestTime, { status: latestTime44136Status });
              }
              return customFetch(input);
            },
            clock: () => new Date(currentMockTimeMs).toISOString() as UtcIso8601String,
          },
          now: nowFn,
        });

        const trcAdapter = new AmedasScheduledAdapter(database.connection, trcState, 600, {
          fetchOptions: {
            fetchFn: async (input) => {
              const urlStr = String(input);
              if (urlStr.includes('latest_time.txt')) {
                if (latestTime44166Status !== 200) {
                  return new Response('500 Internal Error', { status: latestTime44166Status });
                }
                return new Response(currentLatestTime, { status: 200 });
              }
              return customFetch(input);
            },
            clock: () => new Date(currentMockTimeMs).toISOString() as UtcIso8601String,
          },
          now: nowFn,
        });

        const multiAdapter = new MultiVenueAmedasScheduledAdapter([eastAdapter, trcAdapter]);

        // 周期1 (t=0s): 両地点正常
        await multiAdapter.runScheduled();
        assert.equal(point44136Count, 1);
        assert.equal(point44166Count, 1);
        assert.equal(trcState.getStreamStatus('pointData').consecutiveFailures, 0);

        // 周期2 (t=60s): 時刻更新で羽田の地点データのみ 503 失敗
        currentMockTimeMs += 60_000;
        currentLatestTime = '2026-09-11T20:40:00+09:00';
        point44166Status = 503;
        await multiAdapter.runScheduled();
        assert.equal(point44136Count, 2);
        assert.equal(point44166Count, 2);
        assert.equal(
          trcState.getStreamStatus('pointData').consecutiveFailures,
          1,
          '羽田の地点失敗数1',
        );

        // 周期3 (t=120s): 時刻不変のまま、羽田の latest_time のみ 500 失敗
        currentMockTimeMs += 60_000;
        latestTime44166Status = 500;
        point44166Status = 200; // 地点データ側は 200 に戻しておくが、latest が失敗するため呼ばれないはず
        await multiAdapter.runScheduled();
        assert.equal(point44136Count, 2, '江戸川臨海はスキップ');
        assert.equal(point44166Count, 2, '羽田はlatest失敗のため地点未試行（回数増えず）');
        assert.equal(
          trcState.getStreamStatus('pointData').consecutiveFailures,
          1,
          'latest失敗中は地点失敗数を1のまま維持',
        );

        // latest_time 失敗履歴の targetRef が羽田 (44166) であること
        const latestAttempt = database.connection
          .prepare(
            `SELECT source_kind, target_ref, outcome FROM fetch_attempt WHERE source_kind = 'amedas_latest_time' AND outcome = 'failure' ORDER BY id DESC LIMIT 1`,
          )
          .get() as { source_kind: string; target_ref: string | null; outcome: string };
        assert.equal(latestAttempt.source_kind, 'amedas_latest_time');
        assert.equal(latestAttempt.target_ref, '44166', '失敗履歴の targetRef は羽田');
        assert.equal(latestAttempt.outcome, 'failure');

        // 周期4 (t=180s): 羽田の latest_time が 200 回復（最新時刻は同じ 20:40 のまま）
        currentMockTimeMs += 60_000;
        latestTime44166Status = 200;
        await multiAdapter.runScheduled();
        assert.equal(point44136Count, 2, '江戸川臨海はスキップ');
        assert.equal(
          point44166Count,
          3,
          '羽田は再試行待ちが残っているため同じ最新時刻でも地点取得を実行して回復',
        );
        assert.equal(
          trcState.getStreamStatus('pointData').consecutiveFailures,
          0,
          '回復後は地点失敗数0',
        );

        database.close();
      } finally {
        cleanup();
      }
    }

    // --- ケース 2: 600秒再確認期限時の latest 失敗 → 回復でも再確認時刻が誤更新されず地点取得 ---
    {
      const { databasePath, cleanup } = createTempDb();
      try {
        const database = initializeDatabase({ databasePath, migrationsDirectory });
        let currentMockTimeMs = new Date('2026-09-11T12:00:00.000Z').getTime();
        const nowFn = () => new Date(currentMockTimeMs);

        let point44166Count = 0;
        let latestTime44166Status = 200;
        const currentLatestTime = '2026-09-11T20:30:00+09:00';

        const trcState = new AmedasFetchState('trc');
        const trcAdapter = new AmedasScheduledAdapter(database.connection, trcState, 600, {
          fetchOptions: {
            fetchFn: async (input) => {
              const urlStr = String(input);
              if (urlStr.includes('latest_time.txt')) {
                if (latestTime44166Status !== 200) {
                  return new Response('500 Internal Error', { status: latestTime44166Status });
                }
                return new Response(currentLatestTime, { status: 200 });
              }
              if (urlStr.includes('44166')) {
                point44166Count++;
                return new Response(point44166Json, { status: 200 });
              }
              return new Response('Not found', { status: 404 });
            },
            clock: () => new Date(currentMockTimeMs).toISOString() as UtcIso8601String,
          },
          now: nowFn,
        });

        // 周期1 (t=0s): 正常取得
        await trcAdapter.runScheduled();
        assert.equal(point44166Count, 1);

        // 周期2 (t=600s): 600秒経過（再確認期限）。ここで latest_time が失敗
        currentMockTimeMs += 600_000;
        latestTime44166Status = 500;
        await trcAdapter.runScheduled();
        assert.equal(point44166Count, 1, 'latest失敗のため地点未試行');

        // 周期3 (t=660s): latest_time が 200 回復（時刻不変）。再確認時刻が誤更新されていないため地点取得が実行される
        currentMockTimeMs += 60_000;
        latestTime44166Status = 200;
        await trcAdapter.runScheduled();
        assert.equal(
          point44166Count,
          2,
          '再確認期限超過の条件が維持されているため地点データが取得される',
        );

        database.close();
      } finally {
        cleanup();
      }
    }

    // --- ケース 3: 初回 latest 失敗（片地点失敗時の他地点完了、地点未試行、回復後の地点取得） ---
    {
      const { databasePath, cleanup } = createTempDb();
      try {
        const database = initializeDatabase({ databasePath, migrationsDirectory });
        let currentMockTimeMs = new Date('2026-09-11T12:00:00.000Z').getTime();
        const nowFn = () => new Date(currentMockTimeMs);

        let latestTimeCallCount = 0;
        let point44136Count = 0;
        let point44166Count = 0;
        let failFirstLatestTime = true;

        const customFetch: typeof fetch = async (input) => {
          const urlStr = String(input);
          if (urlStr.includes('latest_time.txt')) {
            latestTimeCallCount++;
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

        database.close();
      } finally {
        cleanup();
      }
    }

    // --- ケース 4: 両地点最新時刻失敗の検証 ---
    {
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
// 04:00再開を総通信数>で済ませず、latest各地点分と44136/44166 JSONの正確な回数で検証。
// 羽田が再試行待ちの状態で20:00を越える別ケースを追加し、夜間通信0→04:00再試行を実測。
// 夜間に新規起動した場合も04:00まで通信0回。保留応答は必ず解放してstopを待つ。
// ---------------------------------------------------------------------------
test(
  'AC7. 夜間・実行中完了: 20:00跨ぎの保留と安全な完了、正確な04:00通信回数、再試行待ち20:00跨ぎと04:00再試行、夜間新規起動',
  { timeout: 10_000 },
  async () => {
    const { databasePath, cleanup } = createTempDb();
    try {
      const database = initializeDatabase({ databasePath, migrationsDirectory });

      // --- サブケース 1: 20:00跨ぎの保留と安全な完了、正確な回数の検証 ---
      {
        // 19:59:50 JST = 2026-09-12 10:59:50Z (20:00まであと10秒)
        const timer = new FakeTimerScheduler('2026-09-12T10:59:50.000Z');

        let holdPointRequests = true;
        let resolvePoint44136: ((val: Response) => void) | null = null;
        let resolvePoint44166: ((val: Response) => void) | null = null;
        let latestTimeCount = 0;
        let point44136Count = 0;
        let point44166Count = 0;

        const customFetch: typeof fetch = async (input) => {
          const urlStr = String(input);
          if (urlStr.includes('latest_time.txt')) {
            latestTimeCount++;
            return new Response(latestTimeText, { status: 200 });
          }
          if (urlStr.includes('44136')) {
            point44136Count++;
            if (holdPointRequests) {
              return new Promise<Response>((resolve) => {
                resolvePoint44136 = resolve;
              });
            }
            return new Response(point44136Json, { status: 200 });
          }
          if (urlStr.includes('44166')) {
            point44166Count++;
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
        assert.equal(latestTimeCount, 2);
        assert.equal(point44136Count, 1);
        assert.equal(point44166Count, 1);

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
        await timer.advanceTime((7 * 3600 + 58 * 60 + 50) * 1000);
        assert.equal(latestTimeCount, 2, '夜間中は latest_time 追加通信0回');
        assert.equal(point44136Count, 1, '夜間中は 44136 追加通信0回');
        assert.equal(point44166Count, 1, '夜間中は 44166 追加通信0回');

        // 翌 04:00:10 JST に到達 (あと70秒進める: 03:59:00 -> 04:00:10)
        await timer.advanceTime(70 * 1000);
        await new Promise<void>((resolve) => setImmediate(resolve));

        // 04:00 再開時の正確な通信回数検証 (latest 各地点 +1回 で計4回、地点データ各 +1回 で計2回)
        assert.equal(latestTimeCount, 4, '04:00 再開で latest_time 各地点分(+2回)');
        assert.equal(point44136Count, 2, '04:00 再開で 44136 (+1回)');
        assert.equal(point44166Count, 2, '04:00 再開で 44166 (+1回)');

        await scheduler.stop();
      }

      // --- サブケース 2: 羽田が再試行待ちの状態で20:00を越え、夜間通信0→04:00再試行 ---
      {
        // 19:58:00 JST = 2026-09-12 10:58:00Z
        const retryTimer = new FakeTimerScheduler('2026-09-12T10:58:00.000Z');

        let retryLatestCount = 0;
        let retry44136Count = 0;
        let retry44166Count = 0;
        let point44166Status = 503; // 羽田を失敗させて再試行待ちにする

        const retryFetch: typeof fetch = async (input) => {
          const urlStr = String(input);
          if (urlStr.includes('latest_time.txt')) {
            retryLatestCount++;
            return new Response(latestTimeText, { status: 200 });
          }
          if (urlStr.includes('44136')) {
            retry44136Count++;
            return new Response(point44136Json, { status: 200 });
          }
          if (urlStr.includes('44166')) {
            retry44166Count++;
            if (point44166Status !== 200) {
              return new Response('503 Service Unavailable', { status: point44166Status });
            }
            return new Response(point44166Json, { status: 200 });
          }
          return new Response('Not found', { status: 404 });
        };

        const retryAdapters = createScheduledAdapters({
          connection: database.connection,
          nowcastService: dummyNowcastService,
          kikikuruService: dummyKikikuruService,
          now: retryTimer.now,
          amedasFetchOptions: {
            fetchFn: retryFetch,
            clock: retryTimer.clock,
          },
        });

        const retryScheduler = new TimeBasedPollingScheduler({
          schedule: defaultSchedule,
          adapters: retryAdapters,
          xmlPollingService: new DummyXmlPollingService() as unknown as JmaXmlPollingService,
          now: retryTimer.now,
          setTimer: retryTimer.setTimer,
          clearTimer: retryTimer.clearTimer,
        });

        await retryScheduler.start();
        await new Promise<void>((resolve) => setImmediate(resolve));

        // 19:58:00 JST: 初回実行で羽田が 503 失敗 -> 再試行待ち
        assert.equal(retryLatestCount, 2);
        assert.equal(retry44136Count, 1);
        assert.equal(retry44166Count, 1);

        // 2分10秒進めて 20:00:10 JST (夜間突入)
        await retryTimer.advanceTime(130 * 1000);
        await new Promise<void>((resolve) => setImmediate(resolve));

        const countAtNightEntry = {
          latest: retryLatestCount,
          p44136: retry44136Count,
          p44166: retry44166Count,
        };

        // 夜間中（03:59:00 JST まで）は再試行待ちでも通信0回
        await retryTimer.advanceTime((7 * 3600 + 58 * 60 + 50) * 1000);
        assert.equal(
          retryLatestCount,
          countAtNightEntry.latest,
          '夜間中は再試行通信なし (latest=0)',
        );
        assert.equal(retry44136Count, countAtNightEntry.p44136, '夜間中は再試行通信なし (44136=0)');
        assert.equal(retry44166Count, countAtNightEntry.p44166, '夜間中は再試行通信なし (44166=0)');

        // 翌 04:00:10 JST に到達。羽田のステータスを 200 回復にして進める
        point44166Status = 200;
        await retryTimer.advanceTime(70 * 1000);
        await new Promise<void>((resolve) => setImmediate(resolve));

        // 04:00 にポーリング再開し、羽田の再試行・地点取得が実行されて回復
        assert.equal(
          retryLatestCount,
          countAtNightEntry.latest + 2,
          '04:00 に latest_time 各地点実行',
        );
        assert.equal(retry44136Count, countAtNightEntry.p44136 + 1, '04:00 に 44136 実行');
        assert.equal(
          retry44166Count,
          countAtNightEntry.p44166 + 1,
          '04:00 に羽田の再試行地点データ取得実行',
        );

        const snap44166Recovered = findAmedasSnapshot(database.connection, '44166');
        assert.ok(snap44166Recovered);
        assert.equal(
          snap44166Recovered.metadata.availability,
          'available',
          '04:00再開後に羽田が回復',
        );

        await retryScheduler.stop();
      }

      // --- サブケース 3: 夜間に新規起動した場合の通信0回検証 ---
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
// 両地点正常保存→DB閉じる→再接続/新factory→両地点成功、のケースを追加し、同じlatestでも2地点取得と過去0を実測。
// 既存片地点失敗ケースで再起動前後の羽田実観測値配列を deepEqual する（件数だけ不可）。
// ---------------------------------------------------------------------------
test(
  'AC8. 再起動と保持: 再起動後両地点成功（同latest2地点取得・過去0）、再起動後片地点失敗（羽田実観測配列deepEqual保持・値分離）',
  { timeout: 10_000 },
  async () => {
    const { databasePath, cleanup } = createTempDb();
    try {
      // --- ケース 1: 両地点正常保存 → DB閉じる → 再接続/新factory → 両地点成功 ---
      {
        let reqUrls1: string[] = [];
        const fetch1: typeof fetch = async (input) => {
          const urlStr = String(input);
          reqUrls1.push(urlStr);
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

        const db1 = initializeDatabase({ databasePath, migrationsDirectory });
        const adapters1 = createScheduledAdapters({
          connection: db1.connection,
          nowcastService: dummyNowcastService,
          kikikuruService: dummyKikikuruService,
          amedasFetchOptions: {
            fetchFn: fetch1,
            clock: () => '2026-09-11T12:00:00.000Z',
          },
        });
        const amedas1 = adapters1.find((a) => a.source === 'amedas')!;
        await amedas1.runScheduled();
        db1.close();

        // 再接続して新しい factory / 状態を作り、同じ latest_time で実行
        reqUrls1 = [];
        const db2 = initializeDatabase({ databasePath, migrationsDirectory });
        const adapters2 = createScheduledAdapters({
          connection: db2.connection,
          nowcastService: dummyNowcastService,
          kikikuruService: dummyKikikuruService,
          amedasFetchOptions: {
            fetchFn: fetch1,
            clock: () => '2026-09-11T12:05:00.000Z',
          },
        });
        const amedas2 = adapters2.find((a) => a.source === 'amedas')!;
        await amedas2.runScheduled();

        // 同じ latest_time でも新プロセス初回なので両地点を取得し、過去ブロック取得0回
        assert.equal(reqUrls1.length, 4, '最新時刻2回 + 地点データ2回 = 4回（過去ブロック0回）');
        const snap44136 = findAmedasSnapshot(db2.connection, '44136')!;
        const snap44166 = findAmedasSnapshot(db2.connection, '44166')!;
        assert.equal(snap44136.metadata.availability, 'available');
        assert.equal(snap44166.metadata.availability, 'available');
        db2.close();
      }

      // --- ケース 2: 再起動後片地点失敗ケースで再起動前後の羽田実観測値配列を deepEqual ---
      {
        let requestedUrls: string[] = [];
        const baseFetch: typeof fetch = async (input) => {
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
        const db1 = initializeDatabase({ databasePath, migrationsDirectory });
        const adapters1 = createScheduledAdapters({
          connection: db1.connection,
          nowcastService: dummyNowcastService,
          kikikuruService: dummyKikikuruService,
          amedasFetchOptions: {
            fetchFn: baseFetch,
            clock: () => '2026-09-11T12:00:00.000Z',
          },
        });
        const amedas1 = adapters1.find((a) => a.source === 'amedas')!;
        await amedas1.runScheduled();

        const snap44166_before = findAmedasSnapshot(db1.connection, '44166')!;
        assert.equal(snap44166_before.metadata.availability, 'available');
        assert.ok(snap44166_before.observations.length > 0);
        db1.close();

        // 2. プロセス2 (再起動): 新しい factory / 状態で接続し、羽田を 503 失敗にする
        requestedUrls = [];
        const point44166Status = 503;
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
        assert.equal(
          requestedUrls.length,
          4,
          '最新時刻2回 + 地点データ2回 = 4回（過去ブロック0回）',
        );

        const snap44136 = findAmedasSnapshot(db2.connection, '44136')!;
        const snap44166 = findAmedasSnapshot(db2.connection, '44166')!;

        // 江戸川臨海は更新成功で available
        assert.equal(snap44136.metadata.availability, 'available');
        assert.ok(snap44136.observations.length > 0);

        // 羽田は再起動前の羽田値を stale で保持し、再起動前後の観測配列が deepEqual で完全一致
        assert.equal(snap44166.metadata.availability, 'stale');
        assert.deepEqual(
          snap44166.observations,
          snap44166_before.observations,
          '再起動前後の羽田実観測値配列が deepEqual で完全一致すること',
        );
        assert.equal(
          snap44166.observations.some((o) => o.element === 'humidity'),
          false,
          '羽田の保持値に江戸川臨海の湿度等は混入しない',
        );

        db2.close();
      }
    } finally {
      cleanup();
    }
  },
);

// ---------------------------------------------------------------------------
// AC9 非提供・欠測の維持:
// fixture内の提供対象要素にAQC5と6を明示注入し、実service経路でDB保存後 value_number=null・quality_flag=5/6 を完全一致で検証。
// 羽田の湿度等の非提供要素が正常な数値や他地点の値にならず、江戸川臨海の日照推計フラグが既存契約どおり保存されることを確認する。
// fixtureファイルは変更せずテスト内でJSON.parseした複製を加工する。
// ---------------------------------------------------------------------------
test(
  'AC9. 非提供・欠測の維持: 提供対象要素へのAQC5/6明示注入とnull/品質フラグ完全一致、羽田非提供要素不在、日照推計フラグ検証',
  { timeout: 10_000 },
  async () => {
    const { databasePath, cleanup } = createTempDb();
    try {
      const database = initializeDatabase({ databasePath, migrationsDirectory });

      // fixture ファイルは変更せずテスト内で JSON.parse した複製を加工
      const modified44136Data = JSON.parse(point44136Json);
      // 提供対象要素に AQC 5 と 6 を明示注入 (最新時刻 20260911204000 の temp に 5, precipitation10m に 6)
      modified44136Data['20260911204000'].temp = [20.2, 5];
      modified44136Data['20260911204000'].precipitation10m = [0.0, 6];
      const modified44136Json = JSON.stringify(modified44136Data);

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
              return new Response(modified44136Json, { status: 200 });
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

      // 1. 実 service 経路で DB 保存後、AQC 5 / 6 を注入した要素が value_number = null, quality_flag = 5 / 6 になっていることを完全一致で検証
      const aqcRows = database.connection
        .prepare(
          `SELECT obs.observed_at, obs.element, obs.value_number, obs.value_text, obs.quality_flag, obs.is_estimated
         FROM amedas_observation obs
         JOIN amedas_snapshot snap ON obs.snapshot_id = snap.id
         WHERE snap.station_code = '44136'
           AND obs.observed_at = '2026-09-11T11:40:00.000Z'
           AND obs.element IN ('temp', 'precipitation10m')
         ORDER BY obs.element ASC`,
        )
        .all() as Array<{
        observed_at: string;
        element: string;
        value_number: number | null;
        value_text: string | null;
        quality_flag: number | null;
        is_estimated: number;
      }>;

      assert.deepEqual(
        aqcRows.map((r) => ({
          observedAt: r.observed_at,
          element: r.element,
          valueNumber: r.value_number,
          valueText: r.value_text,
          qualityFlag: r.quality_flag,
          isEstimated: r.is_estimated === 1,
        })),
        [
          {
            observedAt: '2026-09-11T11:40:00.000Z',
            element: 'precipitation10m',
            valueNumber: null,
            valueText: null,
            qualityFlag: 6,
            isEstimated: false,
          },
          {
            observedAt: '2026-09-11T11:40:00.000Z',
            element: 'temp',
            valueNumber: null,
            valueText: null,
            qualityFlag: 5,
            isEstimated: false,
          },
        ],
        'AQC 5/6 注入要素の value_number=null・quality_flag=5/6 完全一致',
      );

      // 2. 羽田（44166）の非提供要素（humidity 等）が存在しないこと
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

      // 3. 江戸川臨海（44136）の日照推計フラグ (sun10m, sun1h)
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
// 実 TimeBasedPollingScheduler を start し、片地点を保留した状態で既存周期を超えて fake timer を進める。
// 地点別 HTTP 回数が増えないことを比較。保留解放後に全体完了し、完了時刻+周期で次回取得することを確認。
// 片地点の予期しない例外を注入しても他地点は完了し、集合 adapter は全地点終了後に例外を返す。
// スケジューラ登録は amedas 1個である。
// ---------------------------------------------------------------------------
test(
  'AC10. 多重実行・例外分離: 実スケジューラでの片地点保留・周期超過時の非多重実行・完了後次回周期発火、例外分離集約、単一amedas登録',
  { timeout: 10_000 },
  async () => {
    const { databasePath, cleanup } = createTempDb();
    try {
      const database = initializeDatabase({ databasePath, migrationsDirectory });
      // 日中 10:00 JST = 2026-09-12 01:00:00Z (05:00-18:00 の amedas 周期は 60秒)
      const timer = new FakeTimerScheduler('2026-09-12T01:00:00.000Z');

      // 1. スケジューラ登録が amedas 1個であり、実スケジューラでも非重複であることを確認
      const baseAdapters = createScheduledAdapters({
        connection: database.connection,
        nowcastService: dummyNowcastService,
        kikikuruService: dummyKikikuruService,
        now: timer.now,
      });
      assert.equal(baseAdapters.length, 3);
      const amedasAdapters = baseAdapters.filter((a) => a.source === 'amedas');
      assert.equal(amedasAdapters.length, 1, 'amedas adapter は単一登録');

      const baseScheduler = new TimeBasedPollingScheduler({
        schedule: defaultSchedule,
        adapters: baseAdapters,
        xmlPollingService: new DummyXmlPollingService() as unknown as JmaXmlPollingService,
        now: timer.now,
        setTimer: timer.setTimer,
        clearTimer: timer.clearTimer,
      });
      const schedulerStatus = baseScheduler.getStatus();
      assert.equal(schedulerStatus.sources.amedas.source, 'amedas');
      assert.deepEqual(Object.keys(schedulerStatus.sources).sort(), [
        'amedas',
        'kikikuru',
        'nowcast',
        'xml',
      ]);

      // 2. 実 TimeBasedPollingScheduler を start し、片地点を保留した状態で周期を超えて fake timer を進める
      let latestTimeCount = 0;
      let point44136Count = 0;
      let point44166Count = 0;
      let hold44166 = true;
      let resolve44166: ((res: Response) => void) | null = null;

      const slowAdapters = createScheduledAdapters({
        connection: database.connection,
        nowcastService: dummyNowcastService,
        kikikuruService: dummyKikikuruService,
        now: timer.now,
        amedasFetchOptions: {
          fetchFn: async (input) => {
            const urlStr = String(input);
            if (urlStr.includes('latest_time.txt')) {
              latestTimeCount++;
              return new Response(latestTimeText, { status: 200 });
            }
            if (urlStr.includes('44136')) {
              point44136Count++;
              return new Response(point44136Json, { status: 200 });
            }
            if (urlStr.includes('44166')) {
              point44166Count++;
              if (hold44166) {
                return new Promise<Response>((resolve) => {
                  resolve44166 = resolve;
                });
              }
              return new Response(point44166Json, { status: 200 });
            }
            return new Response('Not found', { status: 404 });
          },
          clock: timer.clock,
        },
      });

      const scheduler = new TimeBasedPollingScheduler({
        schedule: defaultSchedule,
        adapters: slowAdapters,
        xmlPollingService: new DummyXmlPollingService() as unknown as JmaXmlPollingService,
        now: timer.now,
        setTimer: timer.setTimer,
        clearTimer: timer.clearTimer,
      });

      await scheduler.start();
      await new Promise<void>((resolve) => setImmediate(resolve));

      // 初回実行が開始され、44166 が保留中
      assert.ok(resolve44166, '羽田のリクエストが保留中');
      assert.equal(latestTimeCount, 2);
      assert.equal(point44136Count, 1);
      assert.equal(point44166Count, 1);

      // amedas の日中周期 (60秒) を超えて 70秒進める (t=70s)
      await timer.advanceTime(70_000);
      await new Promise<void>((resolve) => setImmediate(resolve));

      // 保留中のため前回の amedas 実行が完了しておらず、新しい実行は重ならない（地点別 HTTP 回数が増えていないことを比較）
      assert.equal(latestTimeCount, 2, '保留中は周期超過しても latest_time 増えない');
      assert.equal(point44136Count, 1, '保留中は周期超過しても 44136 増えない');
      assert.equal(point44166Count, 1, '保留中は周期超過しても 44166 増えない');

      // 保留を解放し、全体完了させる (完了時刻 = t=70s)
      hold44166 = false;
      resolve44166!(new Response(point44166Json, { status: 200 }));
      await new Promise<void>((resolve) => setImmediate(resolve));

      // 完了時刻 (t=70s) から 59秒進める (t=129s) -> 次回周期 (60秒後) 直前のため未発火
      await timer.advanceTime(59_000);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(latestTimeCount, 2, '次回周期直前では通信増えない');

      // さらに 1秒進める (t=130s = 完了時刻 + 60秒) -> 次回取得が発火
      await timer.advanceTime(1_000);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(latestTimeCount, 4, '完了時刻+60秒で次回取得が発火 (latest_time 各地点分 +2回)');

      await scheduler.stop();

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
