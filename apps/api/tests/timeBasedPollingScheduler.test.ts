import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import { initializeDatabase } from '../src/database/index.js';
import {
  DEFAULT_POLLING_SCHEDULE,
  resolvePollingMode,
  getNextModeChangeAt,
  getNextJstTime,
  validatePollingScheduleConfig,
  type PollingScheduleConfig,
  type ScheduledSource,
} from '../src/config/pollingSchedule.js';
import {
  TimeBasedPollingScheduler,
  AmedasScheduledAdapter,
  type ScheduledPollAdapter,
} from '../src/polling/timeBasedPollingScheduler.js';
import {
  JmaXmlPollingService,
  type InitialFetchResult,
  type JmaXmlPollingStatus,
} from '../src/polling/jmaXmlPollingService.js';
import { AmedasFetchState } from '../src/polling/amedasFetchService.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

function createTempDb(): { databasePath: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-sched-test-'));
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

  getScheduledCount(): number {
    return this.timers.size;
  }

  getTimerDueTimes(): number[] {
    return Array.from(this.timers.values())
      .map((t) => t.dueTimeMs)
      .sort((a, b) => a - b);
  }

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

class FakeScheduledAdapter implements ScheduledPollAdapter {
  callCount = 0;
  inFlight = false;
  executionDurationMs = 0;
  private timerScheduler?: FakeTimerScheduler;

  constructor(
    readonly source: ScheduledSource,
    options?: { executionDurationMs?: number; timerScheduler?: FakeTimerScheduler },
  ) {
    this.executionDurationMs = options?.executionDurationMs ?? 0;
    this.timerScheduler = options?.timerScheduler;
  }

  async runScheduled(): Promise<void> {
    this.callCount++;
    this.inFlight = true;
    if (this.executionDurationMs > 0 && this.timerScheduler) {
      await new Promise<void>((resolve) => {
        this.timerScheduler!.setTimer(() => {
          this.inFlight = false;
          resolve();
        }, this.executionDurationMs);
      });
    } else {
      this.inFlight = false;
    }
  }
}

class FakeXmlPollingService {
  isRunning = false;
  suppliedIntervalSeconds: number | null = null;
  startCount = 0;
  stopCount = 0;
  initialFetchCount = 0;
  scheduledFetchCount = 0;
  executing = false;
  nextRunAt: UtcIso8601String | null = null;

  constructor(private readonly timerScheduler?: FakeTimerScheduler) {}

  setScheduledIntervalSeconds(seconds: number | null): void {
    this.suppliedIntervalSeconds = seconds;
  }

  getScheduledIntervalSeconds(): number | null {
    return this.suppliedIntervalSeconds;
  }

  isExecuting(): boolean {
    return this.executing;
  }

  getNextRunAt(): UtcIso8601String | null {
    return this.nextRunAt;
  }

  start(options?: { immediateScheduled?: boolean }): Promise<InitialFetchResult> {
    this.isRunning = true;
    this.startCount++;
    if (options?.immediateScheduled) {
      this.scheduledFetchCount++;
    } else {
      this.initialFetchCount++;
    }
    return Promise.resolve({
      completed: true,
      startedAt: '2026-09-12T00:00:00.000Z' as UtcIso8601String,
      finishedAt: '2026-09-12T00:00:01.000Z' as UtcIso8601String,
      failedFeedKinds: [],
      cycleResult: null,
      errorReason: null,
    });
  }

  stop(): Promise<void> {
    this.isRunning = false;
    this.stopCount++;
    return Promise.resolve();
  }

  getStatus(): JmaXmlPollingStatus {
    return {
      isRunning: this.isRunning,
      initialFetch: {
        phase: this.isRunning ? 'completed' : 'not_started',
        result: null,
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
          lastErrorReason: null,
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
          lastErrorReason: null,
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
          lastErrorReason: null,
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
          lastErrorReason: null,
        },
      },
    };
  }
}

// ---------------------------------------------------------------------------
// 受け入れ条件 1:
// 04:00:00、05:00:00、18:00:00、20:00:00、00:00:00、03:59:59.999 の JST 時刻について
// モードと4対象の周期値が上表と完全一致する。UTC日付をまたぐ夜間も off_hours となる。
// ---------------------------------------------------------------------------
test('1. JST 時間帯判定と周期値の完全一致 (受け入れ条件 1)', () => {
  const cases = [
    {
      jstLabel: '04:00:00',
      iso: '2026-09-11T19:00:00.000Z',
      expectedMode: 'early' as const,
      expectedIntervals: { xml: 120, nowcast: 300, kikikuru: 300, amedas: 300 },
    },
    {
      jstLabel: '05:00:00',
      iso: '2026-09-11T20:00:00.000Z',
      expectedMode: 'busy' as const,
      expectedIntervals: { xml: 60, nowcast: 60, kikikuru: 60, amedas: 60 },
    },
    {
      jstLabel: '18:00:00',
      iso: '2026-09-12T09:00:00.000Z',
      expectedMode: 'late' as const,
      expectedIntervals: { xml: 120, nowcast: 300, kikikuru: 300, amedas: 300 },
    },
    {
      jstLabel: '20:00:00',
      iso: '2026-09-12T11:00:00.000Z',
      expectedMode: 'off_hours' as const,
      expectedIntervals: { xml: null, nowcast: null, kikikuru: null, amedas: null },
    },
    {
      jstLabel: '00:00:00 (UTC跨ぎの夜間)',
      iso: '2026-09-11T15:00:00.000Z',
      expectedMode: 'off_hours' as const,
      expectedIntervals: { xml: null, nowcast: null, kikikuru: null, amedas: null },
    },
    {
      jstLabel: '03:59:59.999',
      iso: '2026-09-11T18:59:59.999Z',
      expectedMode: 'off_hours' as const,
      expectedIntervals: { xml: null, nowcast: null, kikikuru: null, amedas: null },
    },
  ];

  for (const tc of cases) {
    const d = new Date(tc.iso);
    const mode = resolvePollingMode(d, DEFAULT_POLLING_SCHEDULE);
    assert.equal(mode, tc.expectedMode, `JST ${tc.jstLabel} のモード不一致`);
    assert.deepEqual(
      DEFAULT_POLLING_SCHEDULE.intervalsSeconds[mode],
      tc.expectedIntervals,
      `JST ${tc.jstLabel} の周期不一致`,
    );
  }

  // 次回モード切替時刻と次回04:00の計算検証
  const earlyDate = new Date('2026-09-11T19:00:00.000Z'); // 04:00 JST
  assert.equal(
    getNextModeChangeAt(earlyDate, DEFAULT_POLLING_SCHEDULE).toISOString(),
    '2026-09-11T20:00:00.000Z', // 05:00 JST
  );
  assert.equal(
    getNextJstTime(earlyDate, '04:00').toISOString(),
    '2026-09-12T19:00:00.000Z', // 翌日 04:00 JST
  );
});

// ---------------------------------------------------------------------------
// 受け入れ条件 2:
// 既定設定の運用時間中に各 non-XML adapter を起動直後1回呼び、early / busy / late で
// それぞれ300、60、300秒後に次回が1本だけ登録される。XML サービスには
// early / busy / late の120/60/120秒が供給され、通常 scheduled は高頻度2フィードだけで長期フィードを増やさない。
// ---------------------------------------------------------------------------
test('2. 運用時間帯中の起動即時実行と次回登録・XML周期供給 (受け入れ条件 2)', async () => {
  const modesToTest = [
    {
      mode: 'early',
      iso: '2026-09-11T19:30:00.000Z',
      expectedInterval: 300,
      expectedXmlInterval: 120,
    },
    {
      mode: 'busy',
      iso: '2026-09-12T01:00:00.000Z',
      expectedInterval: 60,
      expectedXmlInterval: 60,
    },
    {
      mode: 'late',
      iso: '2026-09-12T09:30:00.000Z',
      expectedInterval: 300,
      expectedXmlInterval: 120,
    },
  ];

  for (const tc of modesToTest) {
    const timer = new FakeTimerScheduler(tc.iso);
    const nowcastAdapter = new FakeScheduledAdapter('nowcast');
    const kikikuruAdapter = new FakeScheduledAdapter('kikikuru');
    const amedasAdapter = new FakeScheduledAdapter('amedas');
    const xmlService = new FakeXmlPollingService(timer);

    const scheduler = new TimeBasedPollingScheduler({
      schedule: DEFAULT_POLLING_SCHEDULE,
      adapters: [nowcastAdapter, kikikuruAdapter, amedasAdapter],
      xmlPollingService: xmlService as unknown as JmaXmlPollingService,
      now: timer.now,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });

    await scheduler.start();
    await new Promise<void>((resolve) => setImmediate(resolve));

    // 各 non-XML adapter が起動直後に1回呼ばれたこと
    assert.equal(nowcastAdapter.callCount, 1, `${tc.mode}: nowcast 初回実行回数`);
    assert.equal(kikikuruAdapter.callCount, 1, `${tc.mode}: kikikuru 初回実行回数`);
    assert.equal(amedasAdapter.callCount, 1, `${tc.mode}: amedas 初回実行回数`);

    // XML サービスへ正しい周期が供給されたこと
    assert.equal(
      xmlService.getScheduledIntervalSeconds(),
      tc.expectedXmlInterval,
      `${tc.mode}: XML 供給周期不一致`,
    );

    // non-XML 各 adapter に次回 timer が 1 本だけ登録されたこと
    const status = scheduler.getStatus();
    assert.equal(status.mode, tc.mode);
    assert.equal(status.sources.nowcast.state, 'waiting');
    assert.equal(status.sources.kikikuru.state, 'waiting');
    assert.equal(status.sources.amedas.state, 'waiting');

    const expectedNextRunAt = new Date(
      timer.now().getTime() + tc.expectedInterval * 1000,
    ).toISOString();
    assert.equal(status.sources.nowcast.nextRunAt, expectedNextRunAt);
    assert.equal(status.sources.kikikuru.nextRunAt, expectedNextRunAt);
    assert.equal(status.sources.amedas.nextRunAt, expectedNextRunAt);

    await scheduler.stop();
  }
});

// ---------------------------------------------------------------------------
// 受け入れ条件 3:
// 20:00直前に遅い adapter を実行中にし、20:00後は新規呼出しが0回である一方、
// 開始済み Promise は完了できる。状態は scheduled_stopped、nextRunAt は翌04:00となる。
// ---------------------------------------------------------------------------
test('3. 20:00 停止と実行中ジョブの安全な完了 (受け入れ条件 3)', async () => {
  // 19:59:50 JST -> 2026-09-12 10:59:50Z (late モード、20:00まであと10秒)
  const timer = new FakeTimerScheduler('2026-09-12T10:59:50.000Z');
  // 実行に 20秒かかる adapter (20:00:10 JST までかかる)
  const slowAdapter = new FakeScheduledAdapter('nowcast', {
    executionDurationMs: 20_000,
    timerScheduler: timer,
  });
  const kikikuruAdapter = new FakeScheduledAdapter('kikikuru');
  const amedasAdapter = new FakeScheduledAdapter('amedas');
  const xmlService = new FakeXmlPollingService(timer);

  const scheduler = new TimeBasedPollingScheduler({
    schedule: DEFAULT_POLLING_SCHEDULE,
    adapters: [slowAdapter, kikikuruAdapter, amedasAdapter],
    xmlPollingService: xmlService as unknown as JmaXmlPollingService,
    now: timer.now,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });

  await scheduler.start();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(slowAdapter.callCount, 1);
  assert.equal(slowAdapter.inFlight, true);

  // 15 秒進めて 20:00:05 JST (off_hours 到達)
  await timer.advanceTime(15_000);

  // 20:00 到達により、新規呼出しは 0 回
  assert.equal(kikikuruAdapter.callCount, 1, 'kikikuru は新規呼出なし');
  assert.equal(amedasAdapter.callCount, 1, 'amedas は新規呼出なし');
  assert.equal(slowAdapter.callCount, 1, 'slowAdapter は新規呼出なし');

  // slowAdapter はまだ実行中
  assert.equal(slowAdapter.inFlight, true);

  // さらに 10 秒進めて 20:00:15 JST (slowAdapter 完了後)
  await timer.advanceTime(10_000);

  // 開始済み Promise が正常に完了したこと
  assert.equal(slowAdapter.inFlight, false);
  assert.equal(slowAdapter.callCount, 1, '完了後も新規実行は増えない');

  // 状態が scheduled_stopped、nextRunAt が翌 04:00 (JST)
  const status = scheduler.getStatus();
  assert.equal(status.mode, 'off_hours');
  assert.equal(status.sources.nowcast.state, 'scheduled_stopped');
  assert.equal(status.sources.kikikuru.state, 'scheduled_stopped');
  assert.equal(status.sources.amedas.state, 'scheduled_stopped');
  assert.equal(status.sources.xml.state, 'scheduled_stopped');

  // 翌 04:00 JST = 2026-09-12 19:00:00Z
  const expectedNext0400 = '2026-09-12T19:00:00.000Z';
  assert.equal(status.sources.nowcast.nextRunAt, expectedNext0400);
  assert.equal(status.sources.kikikuru.nextRunAt, expectedNext0400);
  assert.equal(status.sources.amedas.nextRunAt, expectedNext0400);
  assert.equal(status.sources.xml.nextRunAt, expectedNext0400);

  await scheduler.stop();
});

// ---------------------------------------------------------------------------
// 受け入れ条件 4:
// 夜間に起動すると04:00までnon-XML の3 adapter と XML 初期取得の HTTP 呼出しが0回である。
// 04:00に XML 初期4フィードが各1回、non-XML の3 adapter が各1回だけ起動し、
// XML の通常 scheduled が初期取得と並列に起動しない。
// ---------------------------------------------------------------------------
test('4. 夜間起動と 04:00 の即時投入 (受け入れ条件 4)', async () => {
  // 02:00:00 JST -> 2026-09-11 17:00:00Z (off_hours)
  const timer = new FakeTimerScheduler('2026-09-11T17:00:00.000Z');
  const nowcastAdapter = new FakeScheduledAdapter('nowcast');
  const kikikuruAdapter = new FakeScheduledAdapter('kikikuru');
  const amedasAdapter = new FakeScheduledAdapter('amedas');
  const xmlService = new FakeXmlPollingService(timer);

  const scheduler = new TimeBasedPollingScheduler({
    schedule: DEFAULT_POLLING_SCHEDULE,
    adapters: [nowcastAdapter, kikikuruAdapter, amedasAdapter],
    xmlPollingService: xmlService as unknown as JmaXmlPollingService,
    now: timer.now,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });

  await scheduler.start();
  await new Promise<void>((resolve) => setImmediate(resolve));

  // 夜間起動時: 04:00 まで外部取得は 0 回
  assert.equal(nowcastAdapter.callCount, 0, '夜間起動で nowcast 呼出 0 回');
  assert.equal(kikikuruAdapter.callCount, 0, '夜間起動で kikikuru 呼出 0 回');
  assert.equal(amedasAdapter.callCount, 0, '夜間起動で amedas 呼出 0 回');
  assert.equal(xmlService.startCount, 0, '夜間起動で XML start 呼出 0 回');

  // 1時間59分進める (03:59:00 JST)
  await timer.advanceTime(119 * 60 * 1000);
  assert.equal(nowcastAdapter.callCount, 0);
  assert.equal(kikikuruAdapter.callCount, 0);
  assert.equal(amedasAdapter.callCount, 0);
  assert.equal(xmlService.startCount, 0);

  // 1分進めて 04:00:00 JST 到達
  await timer.advanceTime(60 * 1000);

  // 04:00 到達時: XML初期取得が1回、non-XML 3 adapter が各1回起動
  assert.equal(xmlService.startCount, 1, '04:00 到達で XML start が 1 回');
  assert.equal(xmlService.initialFetchCount, 1, 'XML 初期取得が 1 回');
  assert.equal(
    xmlService.scheduledFetchCount,
    0,
    'XML 通常 scheduled が初期取得と並列に起動しない',
  );
  assert.equal(nowcastAdapter.callCount, 1, '04:00 到達で nowcast が 1 回');
  assert.equal(kikikuruAdapter.callCount, 1, '04:00 到達で kikikuru が 1 回');
  assert.equal(amedasAdapter.callCount, 1, '04:00 到達で amedas が 1 回');

  await scheduler.stop();
});

// ---------------------------------------------------------------------------
// 受け入れ条件 5:
// 04:00、20:00、timer callback、start() / stop() の競合を fake timer で
// 同一tickに発生させても、各 source の実行回数は1回だけである。世代の古い callback は実行回数を増やさない。
// ---------------------------------------------------------------------------
test('5. 同一 tick 競合時の排他と世代照合 (受け入れ条件 5)', async () => {
  // 03:59:59.999 JST -> 2026-09-11 18:59:59.999Z
  const timer = new FakeTimerScheduler('2026-09-11T18:59:59.999Z');
  const nowcastAdapter = new FakeScheduledAdapter('nowcast');
  const kikikuruAdapter = new FakeScheduledAdapter('kikikuru');
  const amedasAdapter = new FakeScheduledAdapter('amedas');
  const xmlService = new FakeXmlPollingService(timer);

  const scheduler = new TimeBasedPollingScheduler({
    schedule: DEFAULT_POLLING_SCHEDULE,
    adapters: [nowcastAdapter, kikikuruAdapter, amedasAdapter],
    xmlPollingService: xmlService as unknown as JmaXmlPollingService,
    now: timer.now,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });

  await scheduler.start();

  // 同一 tick で 04:00 到達タイマーの発火と重複 start() の呼出しを重ねる
  await Promise.all([
    timer.advanceTime(1), // 04:00:00.000 JST へ
    scheduler.start(),
    scheduler.start(),
  ]);

  // 各 source の呼出回数は 1 回だけであること
  assert.equal(nowcastAdapter.callCount, 1, 'nowcast 呼出が 1 回');
  assert.equal(kikikuruAdapter.callCount, 1, 'kikikuru 呼出が 1 回');
  assert.equal(amedasAdapter.callCount, 1, 'amedas 呼出が 1 回');
  assert.equal(xmlService.startCount, 1, 'XML start が 1 回');

  // stop() と遅延タイマーの競合: stop() を呼び、古いタイマー callback は実行回数を増やさない
  await scheduler.stop();
  await timer.advanceTime(300_000);

  assert.equal(nowcastAdapter.callCount, 1, 'stop 後に nowcast 呼出が増えない');
  assert.equal(kikikuruAdapter.callCount, 1, 'stop 後に kikikuru 呼出が増えない');
  assert.equal(amedasAdapter.callCount, 1, 'stop 後に amedas 呼出が増えない');

  // 再び稼働状態にし、古い世代番号での triggerSourcePoll 呼出しが無視されることを検証
  await scheduler.start();
  assert.equal(nowcastAdapter.callCount, 2, '再開により 1 回実行されて計 2 回');

  const staleGen = (scheduler as unknown as { generation: number }).generation - 1;
  await (
    scheduler as unknown as { triggerSourcePoll: (src: string, gen: number) => Promise<void> }
  ).triggerSourcePoll('nowcast', staleGen);
  assert.equal(nowcastAdapter.callCount, 2, '古い世代番号のコールバックは実行回数を増やさない');

  await scheduler.stop();
});

test('5b. 運用時間帯境界をまたぐ実行中取得は完了後に新周期で再予約する', async () => {
  // 04:59:30 JST -> 2026-09-11T19:59:30Z。nowcast だけは 60秒後に完了する。
  const timer = new FakeTimerScheduler('2026-09-11T19:59:30.000Z');
  const slowNowcast = new FakeScheduledAdapter('nowcast', {
    executionDurationMs: 60_000,
    timerScheduler: timer,
  });
  const kikikuruAdapter = new FakeScheduledAdapter('kikikuru');
  const amedasAdapter = new FakeScheduledAdapter('amedas');
  const xmlService = new FakeXmlPollingService(timer);
  const scheduler = new TimeBasedPollingScheduler({
    schedule: DEFAULT_POLLING_SCHEDULE,
    adapters: [slowNowcast, kikikuruAdapter, amedasAdapter],
    xmlPollingService: xmlService as unknown as JmaXmlPollingService,
    now: timer.now,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });

  await scheduler.start();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(slowNowcast.inFlight, true);

  // 05:00 の early -> busy 境界を通過しても、実行中の取得は共有して完了を待つ。
  await timer.advanceTime(30_000);
  assert.equal(slowNowcast.callCount, 1);
  assert.equal(slowNowcast.inFlight, true);

  // 05:00:30 に完了したら、busy の60秒周期で次回が必ず予約される。
  await timer.advanceTime(30_000);
  assert.equal(slowNowcast.inFlight, false);
  const status = scheduler.getStatus();
  assert.equal(status.mode, 'busy');
  assert.equal(status.sources.nowcast.state, 'waiting');
  assert.equal(status.sources.nowcast.nextRunAt, '2026-09-11T20:01:30.000Z');

  await timer.advanceTime(60_000);
  assert.equal(slowNowcast.callCount, 2, '新周期の次回取得が実行される');

  await timer.advanceTime(60_000);
  await scheduler.stop();
});

// ---------------------------------------------------------------------------
// 受け入れ条件 6:
// 実行時間が周期を超える adapter を使っても、完了前に同一 source を再投入しない。
// 完了後にだけ1本の次回 timer が存在する。
// ---------------------------------------------------------------------------
test('6. 実行時間が周期を超える場合の重複防止 (受け入れ条件 6)', async () => {
  // busy モード (60秒周期) で実行に 90秒かかる adapter
  const timer = new FakeTimerScheduler('2026-09-12T01:00:00.000Z');
  const slowNowcast = new FakeScheduledAdapter('nowcast', {
    executionDurationMs: 90_000,
    timerScheduler: timer,
  });
  const kikikuruAdapter = new FakeScheduledAdapter('kikikuru');
  const amedasAdapter = new FakeScheduledAdapter('amedas');
  const xmlService = new FakeXmlPollingService(timer);

  const scheduler = new TimeBasedPollingScheduler({
    schedule: DEFAULT_POLLING_SCHEDULE,
    adapters: [slowNowcast, kikikuruAdapter, amedasAdapter],
    xmlPollingService: xmlService as unknown as JmaXmlPollingService,
    now: timer.now,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });

  await scheduler.start();
  await new Promise<void>((resolve) => setImmediate(resolve));

  // 1回目が開始
  assert.equal(slowNowcast.callCount, 1);
  assert.equal(slowNowcast.inFlight, true);

  // 60秒進める (本来の周期が経過したが、まだ実行中)
  await timer.advanceTime(60_000);
  assert.equal(slowNowcast.callCount, 1, '完了前に同一 source を再投入しない');
  assert.equal(slowNowcast.inFlight, true);

  // さらに 30秒進める (計90秒で 1 回目が完了)
  await timer.advanceTime(30_000);
  assert.equal(slowNowcast.inFlight, false);
  assert.equal(slowNowcast.callCount, 1);

  // 完了後に次回タイマーが登録され、さらに 60秒後 (計150秒時点) に 2 回目が投入される
  await timer.advanceTime(59_000);
  assert.equal(slowNowcast.callCount, 1);

  await timer.advanceTime(1_000);
  assert.equal(slowNowcast.callCount, 2, '完了後 60 秒経過で 2 回目が投入された');

  // 2回目の実行を完了させてから stop() を呼ぶ
  await timer.advanceTime(90_000);
  assert.equal(slowNowcast.inFlight, false);

  await scheduler.stop();
});

// ---------------------------------------------------------------------------
// 受け入れ条件 7 (設定検証):
// 範囲欠落・重複、0秒、off_hours の数値、運用時間の null は起動前に拒否する。
// ---------------------------------------------------------------------------
test('7. 設定ファイルのバリデーション (受け入れ条件 7)', () => {
  const validated = validatePollingScheduleConfig(DEFAULT_POLLING_SCHEDULE);
  assert.equal(validated.timeZone, 'Asia/Tokyo');

  const customConfig: PollingScheduleConfig = {
    ...DEFAULT_POLLING_SCHEDULE,
    intervalsSeconds: {
      ...DEFAULT_POLLING_SCHEDULE.intervalsSeconds,
      busy: { ...DEFAULT_POLLING_SCHEDULE.intervalsSeconds.busy, xml: 61 },
      late: { ...DEFAULT_POLLING_SCHEDULE.intervalsSeconds.late, amedas: 301 },
    },
  };
  const customValidated = validatePollingScheduleConfig(customConfig);
  assert.equal(customValidated.intervalsSeconds.busy.xml, 61);
  assert.equal(customValidated.intervalsSeconds.late.amedas, 301);

  assert.throws(
    () =>
      validatePollingScheduleConfig({
        ...DEFAULT_POLLING_SCHEDULE,
        timeZone: 'UTC',
      }),
    /timeZone/,
  );

  assert.throws(
    () =>
      validatePollingScheduleConfig({
        ...DEFAULT_POLLING_SCHEDULE,
        ranges: [
          { mode: 'early', start: '04:00', end: '05:30' },
          { mode: 'busy', start: '05:00', end: '18:00' },
          { mode: 'late', start: '18:00', end: '20:00' },
          { mode: 'off_hours', start: '20:00', end: '04:00' },
        ],
      }),
    /時間帯範囲に欠落または重複があります/,
  );

  assert.throws(
    () =>
      validatePollingScheduleConfig({
        ...DEFAULT_POLLING_SCHEDULE,
        ranges: [
          { mode: 'early', start: '04:00', end: '05:00' },
          { mode: 'busy', start: '06:00', end: '18:00' },
          { mode: 'late', start: '18:00', end: '20:00' },
          { mode: 'off_hours', start: '20:00', end: '04:00' },
        ],
      }),
    /時間帯範囲に欠落または重複があります/,
  );

  assert.throws(
    () =>
      validatePollingScheduleConfig({
        ...DEFAULT_POLLING_SCHEDULE,
        intervalsSeconds: {
          ...DEFAULT_POLLING_SCHEDULE.intervalsSeconds,
          busy: { ...DEFAULT_POLLING_SCHEDULE.intervalsSeconds.busy, xml: 0 },
        },
      }),
    /1〜86400 の有限整数秒/,
  );

  assert.throws(
    () =>
      validatePollingScheduleConfig({
        ...DEFAULT_POLLING_SCHEDULE,
        intervalsSeconds: {
          ...DEFAULT_POLLING_SCHEDULE.intervalsSeconds,
          off_hours: { ...DEFAULT_POLLING_SCHEDULE.intervalsSeconds.off_hours, xml: 300 },
        },
      }),
    /off_hours の周期はすべて null/,
  );

  assert.throws(
    () =>
      validatePollingScheduleConfig({
        ...DEFAULT_POLLING_SCHEDULE,
        intervalsSeconds: {
          ...DEFAULT_POLLING_SCHEDULE.intervalsSeconds,
          busy: {
            ...DEFAULT_POLLING_SCHEDULE.intervalsSeconds.busy,
            xml: null as unknown as number,
          },
        },
      }),
    /null は指定できません/,
  );

  assert.throws(
    () =>
      validatePollingScheduleConfig({
        ...DEFAULT_POLLING_SCHEDULE,
        amedasPointRecheckSeconds: 0,
      }),
    /amedasPointRecheckSeconds は正の有限整数/,
  );

  assert.throws(
    () =>
      validatePollingScheduleConfig({
        ...DEFAULT_POLLING_SCHEDULE,
        intervalsSeconds: {
          ...DEFAULT_POLLING_SCHEDULE.intervalsSeconds,
          typo: DEFAULT_POLLING_SCHEDULE.intervalsSeconds.busy,
        } as typeof DEFAULT_POLLING_SCHEDULE.intervalsSeconds,
      }),
    /未定義のモード設定/,
  );

  assert.throws(
    () =>
      validatePollingScheduleConfig({
        ...DEFAULT_POLLING_SCHEDULE,
        intervalsSeconds: {
          ...DEFAULT_POLLING_SCHEDULE.intervalsSeconds,
          busy: {
            ...DEFAULT_POLLING_SCHEDULE.intervalsSeconds.busy,
            typo: 60,
          } as typeof DEFAULT_POLLING_SCHEDULE.intervalsSeconds.busy,
        },
      }),
    /未定義の取得元設定/,
  );
});

// ---------------------------------------------------------------------------
// 受け入れ条件 8:
// #23 の XML 単一timer結線で、C14 が周期を供給しても、通常周期・recovery・初期取得の
// timer が多重化せず、1周期あたり pollOnce('scheduled') が1回だけである。
// nextAllowedFetchAt 到達時は失敗フィードだけが recovery される。
// ---------------------------------------------------------------------------
test('8. #23 XML 単一タイマーとの統合・周期供給 (受け入れ条件 8)', async () => {
  const { databasePath, cleanup } = createTempDb();

  try {
    const database = initializeDatabase({ databasePath, migrationsDirectory });
    const timerScheduler = new FakeTimerScheduler('2026-09-12T01:00:00.000Z');
    const emptyFeed = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>test</title>
  <updated>2026-09-12T01:00:00Z</updated>
  <id>test</id>
</feed>`;
    let regularStatus = 200;
    const requestedKinds: string[] = [];

    const xmlService = new JmaXmlPollingService(database.connection, {
      clock: timerScheduler.clock,
      timerScheduler: {
        setTimeout: timerScheduler.setTimer,
        clearTimeout: timerScheduler.clearTimer,
      },
      fetchFn: async (input) => {
        const url = String(input);
        const kind = /\/([a-z_]+)\.xml$/.exec(url)?.[1];
        assert.notEqual(kind, undefined);
        requestedKinds.push(kind);
        if (kind === 'regular' && regularStatus !== 200) {
          return new Response('Service Unavailable', { status: regularStatus });
        }
        return new Response(emptyFeed, { status: 200 });
      },
    });

    // C14 が late の 120秒を供給した状態で、実際に初期取得・通常周期を開始する。
    xmlService.setScheduledIntervalSeconds(120);
    assert.equal(xmlService.getScheduledIntervalSeconds(), 120);
    const initial = await xmlService.start();
    assert.equal(initial.completed, true);
    assert.deepEqual(requestedKinds, ['regular', 'extra', 'regular_l', 'extra_l']);
    assert.equal(timerScheduler.getScheduledCount(), 1, 'XML サービス内の次回 timer は1本だけ');

    // 通常周期は高頻度2フィードだけを1回ずつ取得する。
    regularStatus = 503;
    await timerScheduler.advanceTime(120_000);
    assert.deepEqual(requestedKinds, [
      'regular',
      'extra',
      'regular_l',
      'extra_l',
      'regular',
      'extra',
    ]);
    assert.equal(timerScheduler.getScheduledCount(), 1, '通常周期後も timer は1本だけ');

    // 通常周期（120秒）より早い nextAllowedFetchAt（60秒）では、失敗した regular だけを再試行する。
    regularStatus = 200;
    await timerScheduler.advanceTime(60_000);
    assert.deepEqual(requestedKinds, [
      'regular',
      'extra',
      'regular_l',
      'extra_l',
      'regular',
      'extra',
      'regular',
    ]);
    assert.equal(timerScheduler.getScheduledCount(), 1, 'backoff 再試行後も timer は1本だけ');
    assert.equal(xmlService.getStatus().feedStatuses.regular.isWaiting, false);

    await xmlService.stop();
    database.close();
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 受け入れ条件 9:
// アメダスは busy 中毎分 latest_time.txt を確認し、時刻不変でも地点データを10分に1回
// always 再確認する。時刻更新時は次の周期で地点データを取得する。夜間は両方0回である。
// ---------------------------------------------------------------------------
test('9. アメダス 10分再確認と時刻更新時の地点データ取得 (受け入れ条件 9)', async () => {
  const { databasePath, cleanup } = createTempDb();

  try {
    const database = initializeDatabase({ databasePath, migrationsDirectory });
    let currentMockTimeMs = new Date('2026-09-12T01:00:00.000Z').getTime(); // busy モード
    const nowFn = () => new Date(currentMockTimeMs);

    let latestTimeRequestCount = 0;
    let pointDataRequestCount = 0;
    let currentLatestTime = '2026-09-12T01:00:00.000Z';

    const customFetch: typeof fetch = async (input) => {
      const urlStr = String(input);
      if (urlStr.includes('latest_time.txt')) {
        latestTimeRequestCount++;
        return new Response(currentLatestTime, { status: 200 });
      }
      if (urlStr.includes('.json')) {
        pointDataRequestCount++;
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    };

    const amedasState = new AmedasFetchState('east');
    const adapter = new AmedasScheduledAdapter(database.connection, amedasState, 600, {
      fetchOptions: { fetchFn: customFetch, allowHttpForTesting: true },
      now: nowFn,
    });

    // 1回目 (t=0分): 初回なので pointFetchPolicy: 'always'
    await adapter.runScheduled();
    assert.equal(latestTimeRequestCount, 1, '1回目: latest_time 取得');
    assert.equal(pointDataRequestCount, 1, '1回目: 地点データ取得');

    // 2回目〜10回目 (t=1分〜9分): 時刻不変、10分未満なので地点データはスキップ
    for (let m = 1; m <= 9; m++) {
      currentMockTimeMs += 60_000;
      await adapter.runScheduled();
      assert.equal(latestTimeRequestCount, m + 1, `${m}分後: latest_time 取得`);
      assert.equal(pointDataRequestCount, 1, `${m}分後: 地点データはスキップされたまま`);
    }

    // 11回目 (t=10分 = 600秒経過): 時刻不変でも 10分経過したので always 再確認
    currentMockTimeMs += 60_000;
    await adapter.runScheduled();
    assert.equal(latestTimeRequestCount, 11, '10分後: latest_time 取得');
    assert.equal(pointDataRequestCount, 2, '10分後: 地点データを always 再確認');

    // 12回目 (t=11分): 時刻が更新された場合
    currentMockTimeMs += 60_000;
    currentLatestTime = '2026-09-12T01:10:00.000Z';
    await adapter.runScheduled();
    assert.equal(latestTimeRequestCount, 12, '11分後: latest_time 取得');
    assert.equal(pointDataRequestCount, 3, '11分後: 時刻更新により地点データ取得');

    database.close();
  } finally {
    cleanup();
  }
});
