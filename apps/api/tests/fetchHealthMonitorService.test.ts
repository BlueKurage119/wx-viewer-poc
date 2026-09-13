import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import { initializeDatabase } from '../src/database/index.js';
import { recordFetchAttempt, listNotificationOutputHistory } from '../src/repositories/index.js';
import {
  FetchHealthMonitorService,
  type FetchHealthStatusProvider,
} from '../src/monitoring/fetchHealthMonitorService.js';
import { FetchHealthStateStore } from '../src/monitoring/fetchHealthStateStore.js';
import type { FetchHealthConfig } from '../src/monitoring/fetchHealthConfig.js';
import type {
  TimeBasedPollingStatus,
  ScheduledPollStatus,
} from '../src/polling/timeBasedPollingScheduler.js';
import type { ScheduledSource, PollingPeriod } from '../src/config/pollingSchedule.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

function createTempDb(): { databasePath: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-monitor-service-test-'));
  const databasePath = join(directory, 'test.sqlite3');
  return {
    databasePath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

const standardConfig: FetchHealthConfig = {
  evaluationIntervalSeconds: 30,
  delayedConsecutiveFailures: 2,
  delayedIntervalMultiplier: 3,
  abnormalConsecutiveFailures: 5,
  abnormalElapsedSeconds: 600,
  maxScanAttempts: 50,
};

const dummyPeriod: PollingPeriod = {
  start: '05:00',
  end: '18:00',
  xmlSeconds: 60,
  imageCatalogSeconds: 60,
  amedasSeconds: 60,
  nowcastEnabled: true,
  kikikuruEnabled: true,
};

class FakeSchedulerStatusProvider implements FetchHealthStatusProvider {
  sourcesState: Record<ScheduledSource, ScheduledPollStatus['state']> = {
    xml: 'waiting',
    nowcast: 'waiting',
    kikikuru: 'waiting',
    amedas: 'waiting',
  };
  sourcesInterval: Record<ScheduledSource, number | null> = {
    xml: 60,
    nowcast: 60,
    kikikuru: 60,
    amedas: 60,
  };

  getStatus(): TimeBasedPollingStatus {
    const makeStatus = (source: ScheduledSource): ScheduledPollStatus => ({
      source,
      period: dummyPeriod,
      state: this.sourcesState[source],
      intervalSeconds: this.sourcesInterval[source],
      nextRunAt: null,
    });

    return {
      period: dummyPeriod,
      nextPeriodChangeAt: '2026-09-09T09:00:00.000Z' as UtcIso8601String,
      sources: {
        xml: makeStatus('xml'),
        nowcast: makeStatus('nowcast'),
        kikikuru: makeStatus('kikikuru'),
        amedas: makeStatus('amedas'),
      },
    };
  }
}

function insertAttempt(
  connection: ReturnType<typeof initializeDatabase>['connection'],
  sourceKind: string,
  outcome: 'success' | 'failure',
  startedAt: string,
): void {
  recordFetchAttempt(connection, {
    sourceKind,
    targetRef: null,
    requestUrl: `https://example.com/${sourceKind}`,
    triggerKind: 'scheduled',
    attemptNo: 1,
    startedAt: startedAt as UtcIso8601String,
    finishedAt: startedAt as UtcIso8601String,
    durationMs: 100,
    outcome,
    httpStatus: outcome === 'success' ? 200 : 500,
    responseBytes: 100,
    itemCount: null,
    failedItemCount: null,
    contentHash: 'hash',
    errorKind: outcome === 'success' ? null : 'network_error',
    errorMessage: outcome === 'success' ? null : 'error',
  });
}

// ---------------------------------------------------------------------------
// AC1: 遅延判定で「警報」、異常判定で「問いかけ」が生成される
// ---------------------------------------------------------------------------
test('AC1: 連続2回失敗で警報、連続5回失敗で問いかけが生成される', () => {
  const { databasePath, cleanup } = createTempDb();
  try {
    const database = initializeDatabase({ databasePath, migrationsDirectory });
    const statusProvider = new FakeSchedulerStatusProvider();
    const store = new FetchHealthStateStore();
    let currentNow = '2026-09-09T00:01:00.000Z';
    const nowFn = () => currentNow as UtcIso8601String;

    const service = new FetchHealthMonitorService({
      connection: database.connection,
      statusProvider,
      config: standardConfig,
      store,
      now: nowFn,
    });

    // 成功 1 件 -> 失敗 2 件
    insertAttempt(database.connection, 'xml_feed_regular', 'success', '2026-09-09T00:00:00.000Z');
    insertAttempt(database.connection, 'xml_feed_regular', 'failure', '2026-09-09T00:00:30.000Z');
    insertAttempt(database.connection, 'xml_feed_regular', 'failure', '2026-09-09T00:01:00.000Z');

    // 1 回目 runOnce (遅延)
    const result1 = service.runOnce();
    assert.equal(result1.aggregate.status, 'delayed');
    assert.equal(result1.emit.recorded.length, 1);
    const notif1 = result1.emit.recorded[0];
    assert.equal(notif1.category, 'warning');
    assert.equal(notif1.changeType, 'fetch_delayed');
    assert.equal(notif1.origin, 'system');
    assert.equal(notif1.sourceType, 'fetch_health');
    assert.equal(notif1.isTraining, false);

    const history1 = listNotificationOutputHistory(database.connection, { origin: 'system' });
    assert.equal(history1.length, 1);
    assert.equal(history1[0].messageDefinitionId, 'system-data-fetch-delayed');
    assert.equal(history1[0].ackRequired, false);

    // 失敗をさらに 3 件（計 5 件）追加
    insertAttempt(database.connection, 'xml_feed_regular', 'failure', '2026-09-09T00:01:30.000Z');
    insertAttempt(database.connection, 'xml_feed_regular', 'failure', '2026-09-09T00:02:00.000Z');
    insertAttempt(database.connection, 'xml_feed_regular', 'failure', '2026-09-09T00:02:30.000Z');
    currentNow = '2026-09-09T00:02:30.000Z';

    // 2 回目 runOnce (異常)
    const result2 = service.runOnce();
    assert.equal(result2.aggregate.status, 'abnormal');
    assert.equal(result2.emit.recorded.length, 1);
    const notif2 = result2.emit.recorded[0];
    assert.equal(notif2.category, 'question');
    assert.equal(notif2.changeType, 'fetch_abnormal');
    assert.equal(notif2.origin, 'system');
    assert.equal(notif2.sourceType, 'fetch_health');
    assert.equal(notif2.isTraining, false);

    const history2 = listNotificationOutputHistory(database.connection, { origin: 'system' });
    assert.equal(history2.length, 2);
    // listNotificationOutputHistory は detected_at DESC なので最新が [0]
    assert.equal(history2[0].messageDefinitionId, 'system-data-fetch-failed');
    assert.equal(history2[0].ackRequired, true);

    database.close();
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC2: 経過時間条件でも判定される
// ---------------------------------------------------------------------------
test('AC2: 最終成功から適用周期×3 を超えると遅延、10 分を超えると異常になる', () => {
  const { databasePath, cleanup } = createTempDb();
  try {
    const database = initializeDatabase({ databasePath, migrationsDirectory });
    const statusProvider = new FakeSchedulerStatusProvider();
    const store = new FetchHealthStateStore();
    let currentNow = '2026-09-09T00:00:00.000Z';
    const nowFn = () => currentNow as UtcIso8601String;

    const service = new FetchHealthMonitorService({
      connection: database.connection,
      statusProvider,
      config: standardConfig,
      store,
      now: nowFn,
    });

    // 成功 1 件投入 (失敗行なし)
    insertAttempt(database.connection, 'xml_feed_regular', 'success', '2026-09-09T00:00:00.000Z');

    // 最初の評価を 00:00:00 で実行 (activeSinceAt を 00:00:00 に固定)
    const initResult = service.runOnce();
    assert.equal(initResult.aggregate.status, 'normal');

    // 最終成功 + 181 秒 (遅延)
    currentNow = '2026-09-09T00:03:01.000Z';
    const resultDelayed = service.runOnce();
    assert.equal(resultDelayed.aggregate.status, 'delayed');
    const xmlDelayed = resultDelayed.aggregate.sources.find((s) => s.sourceId === 'xml_regular');
    assert.ok(xmlDelayed);
    assert.ok(xmlDelayed.reasons.some((r) => r.kind === 'last_success_elapsed'));
    assert.equal(xmlDelayed.maxConsecutiveFailures, 0);

    // 最終成功 + 601 秒 (異常)
    currentNow = '2026-09-09T00:10:01.000Z';
    const resultAbnormal = service.runOnce();
    assert.equal(resultAbnormal.aggregate.status, 'abnormal');
    const xmlAbnormal = resultAbnormal.aggregate.sources.find((s) => s.sourceId === 'xml_regular');
    assert.ok(xmlAbnormal);
    assert.ok(xmlAbnormal.reasons.some((r) => r.kind === 'last_success_elapsed'));
    assert.equal(xmlAbnormal.maxConsecutiveFailures, 0);

    database.close();
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC3: 複数取得元が同時に問題を抱えると取得元ごとに個別の通知が出る
// ---------------------------------------------------------------------------
test('AC3: 2 取得元が同時に問題化すると通知が 2 件出て、区分はそれぞれの状態で決まる', () => {
  const { databasePath, cleanup } = createTempDb();
  try {
    const database = initializeDatabase({ databasePath, migrationsDirectory });
    const statusProvider = new FakeSchedulerStatusProvider();
    const store = new FetchHealthStateStore();
    let currentNow = '2026-09-09T00:01:00.000Z';
    const nowFn = () => currentNow as UtcIso8601String;

    const service = new FetchHealthMonitorService({
      connection: database.connection,
      statusProvider,
      config: standardConfig,
      store,
      now: nowFn,
    });

    // xml_feed_regular: 失敗 2 件 (delayed)
    insertAttempt(database.connection, 'xml_feed_regular', 'failure', '2026-09-09T00:00:30.000Z');
    insertAttempt(database.connection, 'xml_feed_regular', 'failure', '2026-09-09T00:01:00.000Z');

    // risk_target_times: 失敗 5 件 (abnormal)
    for (let i = 1; i <= 5; i++) {
      insertAttempt(
        database.connection,
        'risk_target_times',
        'failure',
        `2026-09-09T00:00:0${i}.000Z`,
      );
    }

    const result = service.runOnce();
    // 記録された通知は 2 件
    assert.equal(result.emit.recorded.length, 2);

    const xmlNotif = result.emit.recorded.find((n) => n.targets[0].code === 'xml_regular');
    assert.ok(xmlNotif);
    assert.equal(xmlNotif.category, 'warning', '遅延側は warning');
    assert.equal(xmlNotif.changeType, 'fetch_delayed');
    assert.equal(xmlNotif.targets.length, 1);
    assert.equal(xmlNotif.relatedRefs.length, 1);

    const kikiNotif = result.emit.recorded.find(
      (n) => n.targets[0].code === 'kikikuru_target_times',
    );
    assert.ok(kikiNotif);
    assert.equal(kikiNotif.category, 'question', '異常側は question');
    assert.equal(kikiNotif.changeType, 'fetch_abnormal');
    assert.equal(kikiNotif.targets.length, 1);
    assert.equal(kikiNotif.relatedRefs.length, 1);

    // 集約表示
    assert.equal(result.aggregate.sources.length, 6);
    assert.equal(result.aggregate.status, 'abnormal');
    assert.deepEqual(result.aggregate.worstSourceIds, ['kikikuru_target_times']);

    // xml_feed_regular に失敗を 3 件足して再実行 (delayed -> abnormal)
    insertAttempt(database.connection, 'xml_feed_regular', 'failure', '2026-09-09T00:01:10.000Z');
    insertAttempt(database.connection, 'xml_feed_regular', 'failure', '2026-09-09T00:01:20.000Z');
    insertAttempt(database.connection, 'xml_feed_regular', 'failure', '2026-09-09T00:01:30.000Z');
    currentNow = '2026-09-09T00:01:30.000Z';

    const resultSecond = service.runOnce();
    assert.equal(resultSecond.emit.recorded.length, 1, 'xml_regular だけが 1 件増える');
    assert.equal(resultSecond.emit.recorded[0].targets[0].code, 'xml_regular');
    assert.equal(resultSecond.emit.recorded[0].category, 'question');

    const allHistory = listNotificationOutputHistory(database.connection, { origin: 'system' });
    assert.equal(allHistory.length, 3);

    database.close();
  } finally {
    cleanup();
  }
});

test('AC3 追加ケース: 5 取得元同時異常で question 通知が 5 件出る', () => {
  const { databasePath, cleanup } = createTempDb();
  try {
    const database = initializeDatabase({ databasePath, migrationsDirectory });
    const statusProvider = new FakeSchedulerStatusProvider();
    const store = new FetchHealthStateStore();
    const nowFn = () => '2026-09-09T00:01:00.000Z' as UtcIso8601String;

    const service = new FetchHealthMonitorService({
      connection: database.connection,
      statusProvider,
      config: standardConfig,
      store,
      now: nowFn,
    });

    const sources = [
      'xml_feed_regular',
      'xml_feed_extra',
      'radar_times_N1',
      'risk_target_times',
      'amedas_latest_time',
    ];
    for (const src of sources) {
      for (let i = 1; i <= 5; i++) {
        insertAttempt(database.connection, src, 'failure', `2026-09-09T00:00:0${i}.000Z`);
      }
    }

    const result = service.runOnce();
    assert.equal(result.emit.recorded.length, 5);
    assert.ok(result.emit.recorded.every((n) => n.category === 'question'));

    const codes = result.emit.recorded.map((n) => n.targets[0].code);
    assert.deepEqual(codes, [
      'xml_regular',
      'xml_extra',
      'nowcast_target_times',
      'kikikuru_target_times',
      'amedas_latest_time',
    ]);

    const ids = new Set(result.emit.recorded.map((n) => n.notificationId));
    assert.equal(ids.size, 5);

    database.close();
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC4: 状態変化が取得元ごとに通知され、無変化では通知されない
// ---------------------------------------------------------------------------
test('AC4: 1 取得元の delayed->abnormal->delayed->normal の遷移で 4 件の通知が出る', () => {
  const { databasePath, cleanup } = createTempDb();
  try {
    const database = initializeDatabase({ databasePath, migrationsDirectory });
    const statusProvider = new FakeSchedulerStatusProvider();
    const store = new FetchHealthStateStore();
    let currentNow = '2026-09-09T00:00:01.000Z';
    const nowFn = () => currentNow as UtcIso8601String;

    const service = new FetchHealthMonitorService({
      connection: database.connection,
      statusProvider,
      config: standardConfig,
      store,
      now: nowFn,
    });

    const otherSources = [
      'xml_feed_extra',
      'radar_times_N1',
      'radar_times_N2',
      'risk_target_times',
      'amedas_latest_time',
      'amedas_point',
    ];

    const refreshOtherSources = (timestamp: string) => {
      for (const src of otherSources) {
        insertAttempt(database.connection, src, 'success', timestamp);
      }
    };

    // 初期評価 (他5取得元も含め normal)
    refreshOtherSources('2026-09-09T00:00:00.000Z');
    const init = service.runOnce();
    assert.equal(init.emit.recorded.length, 0);

    // 1. delayed (失敗 2 件)
    refreshOtherSources('2026-09-09T00:00:20.000Z');
    insertAttempt(database.connection, 'xml_feed_regular', 'failure', '2026-09-09T00:00:10.000Z');
    insertAttempt(database.connection, 'xml_feed_regular', 'failure', '2026-09-09T00:00:20.000Z');
    currentNow = '2026-09-09T00:00:20.000Z';
    const step1 = service.runOnce();
    assert.equal(step1.emit.recorded.length, 1);
    assert.equal(step1.emit.recorded[0].changeType, 'fetch_delayed');
    assert.equal(step1.emit.recorded[0].category, 'warning');

    // 無変化 runOnce
    const step1Unchanged = service.runOnce();
    assert.equal(step1Unchanged.emit.recorded.length, 0);

    // 2. abnormal (失敗さらに 3 件 = 計 5 件)
    refreshOtherSources('2026-09-09T00:00:50.000Z');
    insertAttempt(database.connection, 'xml_feed_regular', 'failure', '2026-09-09T00:00:30.000Z');
    insertAttempt(database.connection, 'xml_feed_regular', 'failure', '2026-09-09T00:00:40.000Z');
    insertAttempt(database.connection, 'xml_feed_regular', 'failure', '2026-09-09T00:00:50.000Z');
    currentNow = '2026-09-09T00:00:50.000Z';
    const step2 = service.runOnce();
    assert.equal(step2.emit.recorded.length, 1);
    assert.equal(step2.emit.recorded[0].changeType, 'fetch_abnormal');
    assert.equal(step2.emit.recorded[0].category, 'question');

    // 無変化 runOnce
    const step2Unchanged = service.runOnce();
    assert.equal(step2Unchanged.emit.recorded.length, 0);

    // 3. abnormal -> delayed 回復 (成功 1 件を足し、+181 秒で経過時間遅延にする)
    refreshOtherSources('2026-09-09T00:04:01.000Z');
    insertAttempt(database.connection, 'xml_feed_regular', 'success', '2026-09-09T00:01:00.000Z');
    currentNow = '2026-09-09T00:04:01.000Z'; // 00:01:00 + 181s
    const step3 = service.runOnce();
    assert.equal(step3.emit.recorded.length, 1);
    assert.equal(step3.emit.recorded[0].changeType, 'fetch_delayed');
    assert.equal(step3.emit.recorded[0].category, 'warning');

    // 無変化 runOnce
    const step3Unchanged = service.runOnce();
    assert.equal(step3Unchanged.emit.recorded.length, 0);

    // 4. delayed -> normal 正常復帰 (成功 1 件追加し、now を最終成功 + 10 秒)
    refreshOtherSources('2026-09-09T00:05:10.000Z');
    insertAttempt(database.connection, 'xml_feed_regular', 'success', '2026-09-09T00:05:00.000Z');
    currentNow = '2026-09-09T00:05:10.000Z';
    const step4 = service.runOnce();
    assert.equal(step4.emit.recorded.length, 1);
    assert.equal(step4.emit.recorded[0].changeType, 'fetch_recovered');
    assert.equal(step4.emit.recorded[0].category, 'warning');

    const history = listNotificationOutputHistory(database.connection, { origin: 'system' });
    assert.equal(history.length, 4);
    // history は detected_at DESC なので最新 (step4) が [0]
    assert.equal(history[0].messageDefinitionId, 'system-data-fetch-recovered');
    assert.equal(history[0].ackRequired, false);

    database.close();
  } finally {
    cleanup();
  }
});

test('AC4 追加ケース: 取得元 A が異常のまま取得元 B が delayed になると B の警報が出る', () => {
  const { databasePath, cleanup } = createTempDb();
  try {
    const database = initializeDatabase({ databasePath, migrationsDirectory });
    const statusProvider = new FakeSchedulerStatusProvider();
    const store = new FetchHealthStateStore();
    let currentNow = '2026-09-09T00:01:00.000Z';
    const nowFn = () => currentNow as UtcIso8601String;

    const service = new FetchHealthMonitorService({
      connection: database.connection,
      statusProvider,
      config: standardConfig,
      store,
      now: nowFn,
    });

    // 取得元 A (xml_regular) を異常にする
    for (let i = 1; i <= 5; i++) {
      insertAttempt(
        database.connection,
        'xml_feed_regular',
        'failure',
        `2026-09-09T00:00:0${i}.000Z`,
      );
    }
    const resA = service.runOnce();
    assert.equal(resA.emit.recorded.length, 1);
    assert.equal(resA.emit.recorded[0].targets[0].code, 'xml_regular');

    // 取得元 B (xml_extra) を delayed にする
    insertAttempt(database.connection, 'xml_feed_extra', 'failure', '2026-09-09T00:01:10.000Z');
    insertAttempt(database.connection, 'xml_feed_extra', 'failure', '2026-09-09T00:01:20.000Z');
    currentNow = '2026-09-09T00:01:20.000Z';

    const resB = service.runOnce();
    assert.equal(resB.emit.recorded.length, 1, 'B の通知が 1 件記録される');
    assert.equal(resB.emit.recorded[0].targets[0].code, 'xml_extra');
    assert.equal(resB.emit.recorded[0].category, 'warning');

    database.close();
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC5: 停止中が判定から除外され、復帰直後に誤検知しない
// ---------------------------------------------------------------------------
test('AC5: スケジュール停止中は判定せず、復帰直後に経過時間で異常にならない', () => {
  const { databasePath, cleanup } = createTempDb();
  try {
    const database = initializeDatabase({ databasePath, migrationsDirectory });
    const statusProvider = new FakeSchedulerStatusProvider();
    const store = new FetchHealthStateStore();
    let currentNow = '2026-09-09T08:00:00.000Z';
    const nowFn = () => currentNow as UtcIso8601String;

    // 全取得元を scheduled_stopped にする
    for (const k of ['xml', 'nowcast', 'kikikuru', 'amedas'] as const) {
      statusProvider.sourcesState[k] = 'scheduled_stopped';
      statusProvider.sourcesInterval[k] = null;
    }

    const service = new FetchHealthMonitorService({
      connection: database.connection,
      statusProvider,
      config: standardConfig,
      store,
      now: nowFn,
    });

    // 8 時間前の最終成功行を投入
    insertAttempt(database.connection, 'xml_feed_regular', 'success', '2026-09-09T00:00:00.000Z');

    // 停止中 runOnce
    const stopResult = service.runOnce();
    assert.equal(stopResult.aggregate.status, 'suspended');
    assert.ok(stopResult.aggregate.sources.every((s) => s.status === 'suspended'));
    assert.equal(stopResult.emit.recorded.length, 0);

    // 稼働再開に切り替え
    for (const k of ['xml', 'nowcast', 'kikikuru', 'amedas'] as const) {
      statusProvider.sourcesState[k] = 'waiting';
      statusProvider.sourcesInterval[k] = 60;
    }

    // 復帰直後 (同時刻)
    const resumeResult1 = service.runOnce();
    assert.equal(resumeResult1.aggregate.status, 'normal', '8時間前の成功でも復帰直後は normal');
    assert.equal(resumeResult1.emit.recorded.length, 0);

    // +61 秒後
    currentNow = '2026-09-09T08:01:01.000Z';
    const resumeResult2 = service.runOnce();
    assert.equal(resumeResult2.aggregate.status, 'normal');
    assert.equal(resumeResult2.emit.recorded.length, 0);

    // 問題を抱えたまま停止に入るケース:
    // 異常通知を出した後に scheduled_stopped に入ると復帰通知が出ないこと
    for (let i = 1; i <= 5; i++) {
      insertAttempt(
        database.connection,
        'xml_feed_regular',
        'failure',
        `2026-09-09T08:01:1${i}.000Z`,
      );
    }
    currentNow = '2026-09-09T08:01:20.000Z';
    const abnormalRes = service.runOnce();
    assert.equal(abnormalRes.emit.recorded.length, 1);

    // 停止に切り替え
    for (const k of ['xml', 'nowcast', 'kikikuru', 'amedas'] as const) {
      statusProvider.sourcesState[k] = 'scheduled_stopped';
      statusProvider.sourcesInterval[k] = null;
    }
    const stoppedRes = service.runOnce();
    assert.equal(stoppedRes.emit.recorded.length, 0, '停止に入っても復帰通知は出ない');
    assert.ok(
      stoppedRes.emit.skipped.some(
        (s) => s.sourceId === 'xml_regular' && s.reason === 'suspended_transition',
      ),
    );

    database.close();
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC6: プロセス再起動時の初期状態
// ---------------------------------------------------------------------------
test('AC6: 新しい StateStore で評価すると継続中の異常が initial として通知される', () => {
  const { databasePath, cleanup } = createTempDb();
  try {
    const database = initializeDatabase({ databasePath, migrationsDirectory });
    const statusProvider = new FakeSchedulerStatusProvider();
    const nowFn = () => '2026-09-09T00:01:00.000Z' as UtcIso8601String;

    // 失敗 5 件を投入
    for (let i = 1; i <= 5; i++) {
      insertAttempt(
        database.connection,
        'xml_feed_regular',
        'failure',
        `2026-09-09T00:00:0${i}.000Z`,
      );
    }

    // 新しい StateStore と新しい Service
    const store1 = new FetchHealthStateStore();
    const service1 = new FetchHealthMonitorService({
      connection: database.connection,
      statusProvider,
      config: standardConfig,
      store: store1,
      now: nowFn,
    });

    const res1 = service1.runOnce();
    assert.equal(res1.emit.recorded.length, 1);
    assert.equal(res1.emit.recorded[0].detectionContext, 'initial');

    // 再実行では増えない
    const res1Repeat = service1.runOnce();
    assert.equal(res1Repeat.emit.recorded.length, 0);

    // 問題のない DB でのテスト
    const { databasePath: dbPathClean, cleanup: cleanupClean } = createTempDb();
    try {
      const dbClean = initializeDatabase({ databasePath: dbPathClean, migrationsDirectory });
      const storeClean = new FetchHealthStateStore();
      const serviceClean = new FetchHealthMonitorService({
        connection: dbClean.connection,
        statusProvider,
        config: standardConfig,
        store: storeClean,
        now: nowFn,
      });
      const resClean = serviceClean.runOnce();
      assert.equal(resClean.emit.recorded.length, 0);
      assert.ok(resClean.emit.skipped.every((s) => s.reason === 'initial_no_problem'));
      dbClean.close();
    } finally {
      cleanupClean();
    }

    // 2 取得元に失敗 5 件ずつがある DB での再起動テスト
    for (let i = 1; i <= 5; i++) {
      insertAttempt(
        database.connection,
        'risk_target_times',
        'failure',
        `2026-09-09T00:00:0${i}.000Z`,
      );
    }
    const store2 = new FetchHealthStateStore();
    const service2 = new FetchHealthMonitorService({
      connection: database.connection,
      statusProvider,
      config: standardConfig,
      store: store2,
      now: nowFn,
    });
    const res2 = service2.runOnce();
    assert.equal(res2.emit.recorded.length, 2, '2 取得元が initial で通知される');
    assert.ok(res2.emit.recorded.every((n) => n.detectionContext === 'initial'));

    database.close();
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC7: 対象取得元と除外取得元
// ---------------------------------------------------------------------------
test('AC7: 6 取得元が判定対象で、タイル・長期フィード・個別電文は対象外', () => {
  const { databasePath, cleanup } = createTempDb();
  try {
    const database = initializeDatabase({ databasePath, migrationsDirectory });
    const statusProvider = new FakeSchedulerStatusProvider();
    const store = new FetchHealthStateStore();
    const nowFn = () => '2026-09-09T00:01:00.000Z' as UtcIso8601String;

    const service = new FetchHealthMonitorService({
      connection: database.connection,
      statusProvider,
      config: standardConfig,
      store,
      now: nowFn,
    });

    // 除外対象に失敗 10 件ずつ投入
    const excludedSources = [
      'radar_tile',
      'risk_tile_frame',
      'xml_document',
      'xml_feed_regular_long',
      'xml_feed_extra_long',
    ];
    for (const src of excludedSources) {
      for (let i = 1; i <= 10; i++) {
        insertAttempt(
          database.connection,
          src,
          'failure',
          `2026-09-09T00:00:${i < 10 ? '0' + i : i}.000Z`,
        );
      }
    }

    // 6 取得元には成功行だけ置く
    const validSources = [
      'xml_feed_regular',
      'xml_feed_extra',
      'radar_times_N1',
      'radar_times_N2',
      'risk_target_times',
      'amedas_latest_time',
      'amedas_point',
    ];
    for (const src of validSources) {
      insertAttempt(database.connection, src, 'success', '2026-09-09T00:00:50.000Z');
    }

    const res = service.runOnce();
    assert.equal(res.aggregate.status, 'normal');
    assert.equal(res.emit.recorded.length, 0);
    assert.equal(res.aggregate.sources.length, 6);
    assert.deepEqual(
      res.aggregate.sources.map((s) => s.sourceId),
      [
        'xml_regular',
        'xml_extra',
        'nowcast_target_times',
        'kikikuru_target_times',
        'amedas_latest_time',
        'amedas_point',
      ],
    );

    // 雨雲について radar_times_N1 だけ失敗 5 件にすると nowcast_target_times が abnormal になる
    for (let i = 1; i <= 5; i++) {
      insertAttempt(
        database.connection,
        'radar_times_N1',
        'failure',
        `2026-09-09T00:00:5${i}.000Z`,
      );
    }
    const resRain = service.runOnce();
    const nowcastSource = resRain.aggregate.sources.find(
      (s) => s.sourceId === 'nowcast_target_times',
    );
    assert.ok(nowcastSource);
    assert.equal(nowcastSource.status, 'abnormal');

    database.close();
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC7b: アメダス（地点）は連続失敗回数だけで判定され、経過時間では判定されない
// ---------------------------------------------------------------------------
test('AC7b: amedas_point は 8 時間成功が無くても正常、連続失敗 2 回で遅延・5 回で異常になる', () => {
  const { databasePath, cleanup } = createTempDb();
  try {
    const database = initializeDatabase({ databasePath, migrationsDirectory });
    const statusProvider = new FakeSchedulerStatusProvider();
    const store = new FetchHealthStateStore();
    let currentNow = '2026-09-09T00:00:00.000Z';
    const nowFn = () => currentNow as UtcIso8601String;

    const service = new FetchHealthMonitorService({
      connection: database.connection,
      statusProvider,
      config: standardConfig,
      store,
      now: nowFn,
    });

    // 1. amedas_point に 8 時間前の成功 1 件、amedas_latest_time にも 8 時間前の成功 1 件
    insertAttempt(database.connection, 'amedas_point', 'success', '2026-09-09T00:00:00.000Z');
    insertAttempt(database.connection, 'amedas_latest_time', 'success', '2026-09-09T00:00:00.000Z');

    // 8 時間前の時点で 1 回初期評価 (activeSinceAt を 00:00:00 に固定)
    service.runOnce();

    // now を 8 時間後に進める
    currentNow = '2026-09-09T08:00:00.000Z';
    const res8h = service.runOnce();

    const amedasPointRes = res8h.aggregate.sources.find((s) => s.sourceId === 'amedas_point');
    const amedasTimeRes = res8h.aggregate.sources.find((s) => s.sourceId === 'amedas_latest_time');
    assert.ok(amedasPointRes);
    assert.ok(amedasTimeRes);

    assert.equal(amedasPointRes.status, 'normal', 'amedas_point は経過時間条件が適用されず normal');
    assert.equal(amedasTimeRes.status, 'abnormal', 'amedas_latest_time は経過時間超過で abnormal');

    // 2. amedas_point に失敗 2 件追加 -> delayed
    insertAttempt(database.connection, 'amedas_point', 'failure', '2026-09-09T08:00:10.000Z');
    insertAttempt(database.connection, 'amedas_point', 'failure', '2026-09-09T08:00:20.000Z');
    currentNow = '2026-09-09T08:00:20.000Z';
    const resDelayed = service.runOnce();
    const pointDelayed = resDelayed.aggregate.sources.find((s) => s.sourceId === 'amedas_point');
    assert.ok(pointDelayed);
    assert.equal(pointDelayed.status, 'delayed');
    assert.ok(!pointDelayed.reasons.some((r) => r.kind === 'last_success_elapsed'));
    assert.ok(pointDelayed.reasons.some((r) => r.kind === 'consecutive_failures'));

    const pointNotif = resDelayed.emit.recorded.find((n) => n.targets[0].code === 'amedas_point');
    assert.ok(pointNotif);
    assert.equal(pointNotif.category, 'warning');
    assert.equal(pointNotif.targets[0].code, 'amedas_point');
    assert.equal(pointNotif.targets[0].name, 'アメダス（地点）');

    // 3. 失敗さらに 3 件追加 (計 5 件) -> abnormal
    insertAttempt(database.connection, 'amedas_point', 'failure', '2026-09-09T08:00:30.000Z');
    insertAttempt(database.connection, 'amedas_point', 'failure', '2026-09-09T08:00:40.000Z');
    insertAttempt(database.connection, 'amedas_point', 'failure', '2026-09-09T08:00:50.000Z');
    currentNow = '2026-09-09T08:00:50.000Z';
    const resAbnormal = service.runOnce();
    const pointAbnormal = resAbnormal.aggregate.sources.find((s) => s.sourceId === 'amedas_point');
    assert.ok(pointAbnormal);
    assert.equal(pointAbnormal.status, 'abnormal');
    assert.ok(pointAbnormal.reasons.some((r) => r.kind === 'consecutive_failures'));

    // 4. amedas_latest_time と amedas_point の同時異常で 2 件出ることを確認
    // amedas_latest_time にも失敗 5 件を投入
    for (let i = 1; i <= 5; i++) {
      insertAttempt(
        database.connection,
        'amedas_latest_time',
        'failure',
        `2026-09-09T08:00:5${i}.000Z`,
      );
    }
    // 新しい store/service で再起動評価
    const storeReboot = new FetchHealthStateStore();
    const serviceReboot = new FetchHealthMonitorService({
      connection: database.connection,
      statusProvider,
      config: standardConfig,
      store: storeReboot,
      now: nowFn,
    });
    const rebootRes = serviceReboot.runOnce();
    const amedasNotifs = rebootRes.emit.recorded.filter(
      (n) => n.targets[0].code === 'amedas_latest_time' || n.targets[0].code === 'amedas_point',
    );
    assert.equal(amedasNotifs.length, 2, 'アメダス時刻と地点で 2 件別々に通知が出る');

    database.close();
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC8: 設定ファイルで閾値が変わる
// ---------------------------------------------------------------------------
test('AC8: fetchHealth の閾値を変えると判定が変わる', () => {
  const { databasePath, cleanup } = createTempDb();
  try {
    const database = initializeDatabase({ databasePath, migrationsDirectory });
    const statusProvider = new FakeSchedulerStatusProvider();
    const store = new FetchHealthStateStore();
    const nowFn = () => '2026-09-09T00:01:00.000Z' as UtcIso8601String;

    // delayedConsecutiveFailures を 3 に変更
    const customConfig: FetchHealthConfig = {
      ...standardConfig,
      delayedConsecutiveFailures: 3,
    };

    const service = new FetchHealthMonitorService({
      connection: database.connection,
      statusProvider,
      config: customConfig,
      store,
      now: nowFn,
    });

    // 失敗 2 件 -> customConfig ではまだ normal
    insertAttempt(database.connection, 'xml_feed_regular', 'failure', '2026-09-09T00:00:10.000Z');
    insertAttempt(database.connection, 'xml_feed_regular', 'failure', '2026-09-09T00:00:20.000Z');

    const res2 = service.runOnce();
    assert.equal(res2.aggregate.status, 'normal');

    // 失敗 3 件 -> delayed
    insertAttempt(database.connection, 'xml_feed_regular', 'failure', '2026-09-09T00:00:30.000Z');
    const res3 = service.runOnce();
    assert.equal(res3.aggregate.status, 'delayed');

    database.close();
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC5 回帰テスト: 停止から長時間経過後の復帰で activeSinceAt が正しく即時更新され誤判定しない
// ---------------------------------------------------------------------------
test('AC5 回帰テスト: 稼働中 -> 8時間停止 -> 稼働再開の初回評価で経過時間による異常判定にならず normal と判定される', () => {
  const { databasePath, cleanup } = createTempDb();
  try {
    const database = initializeDatabase({ databasePath, migrationsDirectory });
    const statusProvider = new FakeSchedulerStatusProvider();
    const store = new FetchHealthStateStore();
    let currentNow = '2026-09-09T00:00:00.000Z';
    const nowFn = () => currentNow as UtcIso8601String;

    const service = new FetchHealthMonitorService({
      connection: database.connection,
      statusProvider,
      config: standardConfig,
      store,
      now: nowFn,
    });

    // 1. 稼働中に評価 (00:00:00) - 成功実績あり
    insertAttempt(database.connection, 'xml_feed_regular', 'success', '2026-09-09T00:00:00.000Z');
    insertAttempt(database.connection, 'xml_feed_extra', 'success', '2026-09-09T00:00:00.000Z');
    insertAttempt(database.connection, 'radar_times_N1', 'success', '2026-09-09T00:00:00.000Z');
    insertAttempt(database.connection, 'risk_target_times', 'success', '2026-09-09T00:00:00.000Z');
    insertAttempt(database.connection, 'amedas_latest_time', 'success', '2026-09-09T00:00:00.000Z');
    insertAttempt(database.connection, 'amedas_point', 'success', '2026-09-09T00:00:00.000Z');

    const resRunning = service.runOnce();
    assert.equal(resRunning.aggregate.status, 'normal');
    assert.equal(resRunning.emit.recorded.length, 0);

    // 2. 停止に切替 (01:00:00)
    for (const k of ['xml', 'nowcast', 'kikikuru', 'amedas'] as const) {
      statusProvider.sourcesState[k] = 'scheduled_stopped';
      statusProvider.sourcesInterval[k] = null;
    }
    currentNow = '2026-09-09T01:00:00.000Z';
    const resStopped1 = service.runOnce();
    assert.equal(resStopped1.aggregate.status, 'suspended');
    assert.equal(resStopped1.emit.recorded.length, 0);

    // 停止中に時刻を進めて複数回評価 (04:00:00, 08:00:00)
    currentNow = '2026-09-09T04:00:00.000Z';
    const resStopped2 = service.runOnce();
    assert.equal(resStopped2.aggregate.status, 'suspended');

    currentNow = '2026-09-09T08:00:00.000Z';
    const resStopped3 = service.runOnce();
    assert.equal(resStopped3.aggregate.status, 'suspended');

    // 3. 稼働再開 (08:00:00)
    for (const k of ['xml', 'nowcast', 'kikikuru', 'amedas'] as const) {
      statusProvider.sourcesState[k] = 'waiting';
      statusProvider.sourcesInterval[k] = 60;
    }
    const resResumed = service.runOnce();
    assert.equal(
      resResumed.aggregate.status,
      'normal',
      '復帰直後は経過時間条件で abnormal にならず normal',
    );
    assert.equal(resResumed.emit.recorded.length, 0, '通知は 0 件');

    database.close();
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC12 回帰テスト: start() / stop() のライフサイクルとスケジューラ初期化に依存しない即時開始
// ---------------------------------------------------------------------------
test('AC12 回帰テスト: start() 呼び出しで即時に初回評価が走り、タイマーで定期実行され、stop() で停止する', () => {
  const { databasePath, cleanup } = createTempDb();
  try {
    const database = initializeDatabase({ databasePath, migrationsDirectory });
    const statusProvider = new FakeSchedulerStatusProvider();
    const store = new FetchHealthStateStore();
    let currentNow = '2026-09-09T00:00:00.000Z';
    const nowFn = () => currentNow as UtcIso8601String;

    let timerCallback: (() => void) | null = null;
    let timerDelay: number | null = null;
    let clearedTimerId: unknown = null;
    let timerHandle = 1;

    const setTimer = (cb: () => void, ms: number) => {
      timerCallback = cb;
      timerDelay = ms;
      return timerHandle++;
    };
    const clearTimer = (id: unknown) => {
      clearedTimerId = id;
      timerCallback = null;
    };

    const service = new FetchHealthMonitorService({
      connection: database.connection,
      statusProvider,
      config: standardConfig,
      store,
      now: nowFn,
      setTimer,
      clearTimer,
    });

    // 初期状態: lastAggregate は null
    assert.equal(service.getLastAggregate(), null);

    // 1. start() 呼び出し: 同期的に初回評価が走り、lastAggregate がセットされ、次回タイマーが登録される
    service.start();
    assert.notEqual(service.getLastAggregate(), null);
    assert.equal(service.getLastAggregate()?.status, 'normal');
    assert.equal(timerDelay, 30000);
    assert.ok(timerCallback !== null);

    // 2. 失敗を投入してタイマー発火
    insertAttempt(database.connection, 'xml_feed_regular', 'failure', '2026-09-09T00:00:10.000Z');
    insertAttempt(database.connection, 'xml_feed_regular', 'failure', '2026-09-09T00:00:20.000Z');
    currentNow = '2026-09-09T00:00:30.000Z';

    const fireTimer = timerCallback!;
    fireTimer();

    assert.equal(service.getLastAggregate()?.status, 'delayed');
    const history = listNotificationOutputHistory(database.connection, { origin: 'system' });
    assert.equal(history.length, 1);
    assert.equal(history[0].messageDefinitionId, 'system-data-fetch-delayed');

    // 3. stop() 呼び出しでタイマーが解除される
    service.stop();
    assert.equal(clearedTimerId, 2);

    database.close();
  } finally {
    cleanup();
  }
});
