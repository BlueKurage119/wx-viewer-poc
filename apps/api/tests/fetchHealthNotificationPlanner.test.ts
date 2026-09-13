import test from 'node:test';
import assert from 'node:assert/strict';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import { planFetchHealthNotification } from '../src/notifications/fetchHealthNotificationPlanner.js';
import {
  aggregateFetchHealth,
  type FetchSourceHealthResult,
} from '../src/monitoring/fetchHealthEvaluator.js';
import {
  MONITORED_FETCH_SOURCES,
  type MonitoredFetchSourceId,
} from '../src/monitoring/fetchHealthSources.js';

function createResult(
  sourceId: MonitoredFetchSourceId,
  status: FetchSourceHealthResult['status'],
  text = '連続失敗',
): FetchSourceHealthResult {
  return {
    sourceId,
    status,
    reasons:
      status === 'normal' || status === 'suspended'
        ? []
        : [
            {
              kind: 'consecutive_failures',
              status,
              sourceKind: sourceId,
              text,
            },
          ],
    lastAttemptAt: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
    lastSuccessAt: '2026-09-09T00:00:00.000Z' as UtcIso8601String,
    maxConsecutiveFailures: status === 'abnormal' ? 5 : status === 'delayed' ? 2 : 0,
    intervalSeconds: 60,
  };
}

function createAllSourcesAggregate(
  statusBySource: Partial<Record<MonitoredFetchSourceId, FetchSourceHealthResult['status']>> = {},
  now = '2026-09-09T00:01:00.000Z' as UtcIso8601String,
) {
  const results = MONITORED_FETCH_SOURCES.map((def) => {
    const status = statusBySource[def.id] ?? 'normal';
    return createResult(def.id, status);
  });
  return aggregateFetchHealth(results, now);
}

function createInitialPrevStatus(): Record<MonitoredFetchSourceId, null> {
  const prev = {} as Record<MonitoredFetchSourceId, null>;
  for (const def of MONITORED_FETCH_SOURCES) {
    prev[def.id] = null;
  }
  return prev;
}

let nextId = 1;
const testIdFactory = () => `test-notif-${nextId++}`;

test('planFetchHealthNotification: 起動直後の初期評価 (initial)', () => {
  const prev = createInitialPrevStatus();

  // 1. normal のみ -> 通知 0 件
  const allNormal = createAllSourcesAggregate();
  const planNormal = planFetchHealthNotification({
    previousStatusBySource: prev,
    current: allNormal,
    detectedAt: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
    notificationIdFactory: testIdFactory,
  });
  assert.equal(planNormal.notifications.length, 0);
  assert.equal(planNormal.skipped.length, 6);
  assert.ok(planNormal.skipped.every((s) => s.reason === 'initial_no_problem'));

  // 2. delayed が 1 件 -> initial の warning 通知が 1 件
  const oneDelayed = createAllSourcesAggregate({ xml_regular: 'delayed' });
  const planDelayed = planFetchHealthNotification({
    previousStatusBySource: prev,
    current: oneDelayed,
    detectedAt: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
    notificationIdFactory: testIdFactory,
  });
  assert.equal(planDelayed.notifications.length, 1);
  const notif = planDelayed.notifications[0];
  assert.equal(notif.sourceId, 'xml_regular');
  assert.equal(notif.notification.category, 'warning');
  assert.equal(notif.notification.changeType, 'fetch_delayed');
  assert.equal(notif.notification.detectionContext, 'initial');
  assert.equal(notif.notification.origin, 'system');
  assert.equal(notif.notification.sourceType, 'fetch_health');
  assert.equal(notif.notification.isTraining, false);
  assert.equal(notif.output.messageDefinition.id, 'system-data-fetch-delayed');
  assert.equal(notif.output.ackRequired, false);

  // 3. abnormal が 1 件 -> initial の question 通知が 1 件
  const oneAbnormal = createAllSourcesAggregate({ xml_regular: 'abnormal' });
  const planAbnormal = planFetchHealthNotification({
    previousStatusBySource: prev,
    current: oneAbnormal,
    detectedAt: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
    notificationIdFactory: testIdFactory,
  });
  assert.equal(planAbnormal.notifications.length, 1);
  const notifAbnormal = planAbnormal.notifications[0];
  assert.equal(notifAbnormal.sourceId, 'xml_regular');
  assert.equal(notifAbnormal.notification.category, 'question');
  assert.equal(notifAbnormal.notification.changeType, 'fetch_abnormal');
  assert.equal(notifAbnormal.notification.detectionContext, 'initial');
  assert.equal(notifAbnormal.output.messageDefinition.id, 'system-data-fetch-failed');
  assert.equal(notifAbnormal.output.ackRequired, true);
});

test('planFetchHealthNotification: 遷移表の検証 (悪化、回復、正常復帰、停止遷移、不変)', () => {
  const basePrev = createInitialPrevStatus();

  // normal -> delayed: warning, fetch_delayed
  const plan1 = planFetchHealthNotification({
    previousStatusBySource: { ...basePrev, xml_regular: 'normal' },
    current: createAllSourcesAggregate({ xml_regular: 'delayed' }),
    detectedAt: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
    notificationIdFactory: testIdFactory,
  });
  assert.equal(plan1.notifications.length, 1);
  assert.equal(plan1.notifications[0].notification.category, 'warning');
  assert.equal(plan1.notifications[0].notification.changeType, 'fetch_delayed');
  assert.equal(plan1.notifications[0].output.messageDefinition.id, 'system-data-fetch-delayed');

  // delayed -> abnormal (悪化): question, fetch_abnormal
  const plan2 = planFetchHealthNotification({
    previousStatusBySource: { ...basePrev, xml_regular: 'delayed' },
    current: createAllSourcesAggregate({ xml_regular: 'abnormal' }),
    detectedAt: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
    notificationIdFactory: testIdFactory,
  });
  assert.equal(plan2.notifications.length, 1);
  assert.equal(plan2.notifications[0].notification.category, 'question');
  assert.equal(plan2.notifications[0].notification.changeType, 'fetch_abnormal');
  assert.equal(plan2.notifications[0].output.messageDefinition.id, 'system-data-fetch-failed');

  // abnormal -> delayed (回復): warning, fetch_delayed
  const plan3 = planFetchHealthNotification({
    previousStatusBySource: { ...basePrev, xml_regular: 'abnormal' },
    current: createAllSourcesAggregate({ xml_regular: 'delayed' }),
    detectedAt: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
    notificationIdFactory: testIdFactory,
  });
  assert.equal(plan3.notifications.length, 1);
  assert.equal(plan3.notifications[0].notification.category, 'warning');
  assert.equal(plan3.notifications[0].notification.changeType, 'fetch_delayed');
  assert.equal(plan3.notifications[0].output.messageDefinition.id, 'system-data-fetch-delayed');

  // delayed -> normal (正常復帰): warning, fetch_recovered
  const plan4 = planFetchHealthNotification({
    previousStatusBySource: { ...basePrev, xml_regular: 'delayed' },
    current: createAllSourcesAggregate({ xml_regular: 'normal' }),
    detectedAt: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
    notificationIdFactory: testIdFactory,
  });
  assert.equal(plan4.notifications.length, 1);
  assert.equal(plan4.notifications[0].notification.category, 'warning');
  assert.equal(plan4.notifications[0].notification.changeType, 'fetch_recovered');
  assert.equal(plan4.notifications[0].output.messageDefinition.id, 'system-data-fetch-recovered');
  assert.equal(plan4.notifications[0].output.ackRequired, false);

  // abnormal -> normal (正常復帰): warning, fetch_recovered
  const plan5 = planFetchHealthNotification({
    previousStatusBySource: { ...basePrev, xml_regular: 'abnormal' },
    current: createAllSourcesAggregate({ xml_regular: 'normal' }),
    detectedAt: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
    notificationIdFactory: testIdFactory,
  });
  assert.equal(plan5.notifications.length, 1);
  assert.equal(plan5.notifications[0].notification.category, 'warning');
  assert.equal(plan5.notifications[0].notification.changeType, 'fetch_recovered');

  // unchanged (delayed -> delayed): 0件
  const plan6 = planFetchHealthNotification({
    previousStatusBySource: { ...basePrev, xml_regular: 'delayed' },
    current: createAllSourcesAggregate({ xml_regular: 'delayed' }),
    detectedAt: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
    notificationIdFactory: testIdFactory,
  });
  assert.equal(plan6.notifications.length, 0);
  assert.ok(plan6.skipped.some((s) => s.sourceId === 'xml_regular' && s.reason === 'unchanged'));

  // abnormal -> suspended (停止遷移): 0件 (suspended_transition)
  const plan7 = planFetchHealthNotification({
    previousStatusBySource: { ...basePrev, xml_regular: 'abnormal' },
    current: createAllSourcesAggregate({ xml_regular: 'suspended' }),
    detectedAt: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
    notificationIdFactory: testIdFactory,
  });
  assert.equal(plan7.notifications.length, 0);
  assert.ok(
    plan7.skipped.some((s) => s.sourceId === 'xml_regular' && s.reason === 'suspended_transition'),
  );

  // suspended -> normal (停止解除): 0件 (suspended_transition)
  const plan8 = planFetchHealthNotification({
    previousStatusBySource: { ...basePrev, xml_regular: 'suspended' },
    current: createAllSourcesAggregate({ xml_regular: 'normal' }),
    detectedAt: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
    notificationIdFactory: testIdFactory,
  });
  assert.equal(plan8.notifications.length, 0);
  assert.ok(
    plan8.skipped.some((s) => s.sourceId === 'xml_regular' && s.reason === 'suspended_transition'),
  );
});

test('planFetchHealthNotification: 複数取得元の独立性 (AC3・AC4)', () => {
  const prev = {
    xml_regular: 'normal' as const,
    xml_extra: 'normal' as const,
    nowcast_target_times: 'normal' as const,
    kikikuru_target_times: 'normal' as const,
    amedas_latest_time: 'normal' as const,
    amedas_point: 'normal' as const,
  };

  // 1. xml_regular が delayed、kikikuru_target_times が abnormal -> 2 件通知
  const plan2 = planFetchHealthNotification({
    previousStatusBySource: prev,
    current: createAllSourcesAggregate({
      xml_regular: 'delayed',
      kikikuru_target_times: 'abnormal',
    }),
    detectedAt: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
    notificationIdFactory: testIdFactory,
  });

  assert.equal(plan2.notifications.length, 2);
  const xmlNotif = plan2.notifications.find((n) => n.sourceId === 'xml_regular');
  assert.ok(xmlNotif);
  assert.equal(xmlNotif.notification.category, 'warning');
  assert.equal(xmlNotif.notification.targets[0].code, 'xml_regular');

  const kikiNotif = plan2.notifications.find((n) => n.sourceId === 'kikikuru_target_times');
  assert.ok(kikiNotif);
  assert.equal(kikiNotif.notification.category, 'question');
  assert.equal(kikiNotif.notification.targets[0].code, 'kikikuru_target_times');

  // 2. 5 取得元が同時に abnormal -> 5 件通知
  const plan5 = planFetchHealthNotification({
    previousStatusBySource: prev,
    current: createAllSourcesAggregate({
      xml_regular: 'abnormal',
      xml_extra: 'abnormal',
      nowcast_target_times: 'abnormal',
      kikikuru_target_times: 'abnormal',
      amedas_latest_time: 'abnormal',
    }),
    detectedAt: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
    notificationIdFactory: testIdFactory,
  });
  assert.equal(plan5.notifications.length, 5);
  assert.ok(plan5.notifications.every((n) => n.notification.category === 'question'));
  const targetCodes = plan5.notifications.map((n) => n.notification.targets[0].code);
  assert.deepEqual(targetCodes, [
    'xml_regular',
    'xml_extra',
    'nowcast_target_times',
    'kikikuru_target_times',
    'amedas_latest_time',
  ]);
  // 全通知 ID が異なること
  const idSet = new Set(plan5.notifications.map((n) => n.notification.notificationId));
  assert.equal(idSet.size, 5);

  // 3. 取得元 A が abnormal のまま、取得元 B が normal -> delayed に変化 -> B の 1 件だけ通知
  const prevWithAbnormalA = {
    ...prev,
    xml_regular: 'abnormal' as const,
  };
  const planIndependent = planFetchHealthNotification({
    previousStatusBySource: prevWithAbnormalA,
    current: createAllSourcesAggregate({
      xml_regular: 'abnormal',
      xml_extra: 'delayed',
    }),
    detectedAt: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
    notificationIdFactory: testIdFactory,
  });
  assert.equal(planIndependent.notifications.length, 1);
  assert.equal(planIndependent.notifications[0].sourceId, 'xml_extra');
  assert.equal(planIndependent.notifications[0].notification.category, 'warning');
});
