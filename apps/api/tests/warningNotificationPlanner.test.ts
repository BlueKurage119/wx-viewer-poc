import test from 'node:test';
import assert from 'node:assert/strict';
import {
  type WarningNotificationContext,
  planWarningNotifications,
} from '../src/notifications/warningNotificationPlanner.js';
import type { WarningCurrentChange, WarningCurrentItemInput } from '../src/repositories/types.js';

function createDummyContext(
  overrides: Partial<WarningNotificationContext> = {},
): WarningNotificationContext {
  return {
    areaCode: '1310800',
    areaName: '江東区',
    controlStatus: 'normal',
    sourceVersion: 'v1',
    reportDateTime: '2026-09-12T00:00:00Z',
    detectedAt: '2026-09-12T00:00:01Z',
    currentItems: [],
    ...overrides,
  };
}

function createDummyItem(
  overrides: Partial<WarningCurrentItemInput> = {},
): WarningCurrentItemInput {
  return {
    sequence: 1,
    kindCode: '03',
    kindName: 'レベル３大雨警報',
    kindStatus: '発表',
    lastKindCode: null,
    lastKindName: null,
    significancyCode: null,
    significancyName: null,
    warningLevel: null,
    attentionText: null,
    kindIssuedAt: '2026-09-12T00:00:00Z',
    sourceTelegram: 'VPWW55',
    ...overrides,
  };
}

test('planWarningNotifications: new (新規発表) が正しく計画される', () => {
  const item = createDummyItem({ kindCode: '03', kindName: 'レベル３大雨警報' });
  const change: WarningCurrentChange = {
    phenomenonKey: 'heavy_rain',
    changeType: 'new',
    before: null,
    after: item,
  };

  const plan = planWarningNotifications({
    trigger: {
      kind: 'reception',
      infoType: '発表',
      telegramType: 'VPWW55',
      receptionId: 101,
    },
    changes: [change],
    context: createDummyContext({ currentItems: [item] }),
    detectionContext: 'normal',
    notificationIdFactory: () => 'notif-new-001',
  });

  assert.equal(plan.notifications.length, 1);
  assert.equal(plan.skipped.length, 0);

  const p = plan.notifications[0]!;
  assert.equal(p.notification.notificationId, 'notif-new-001');
  assert.equal(p.notification.changeType, 'new');
  assert.equal(p.notification.category, 'question');
  assert.equal(p.notification.detectionContext, 'normal');
  assert.equal(p.notification.isTraining, false);
  assert.equal(p.output.ackRequired, true);
  assert.equal(p.output.messageDefinition.id, 'weather-warning-issued');
  assert.equal(p.output.summary, '気象警報発表\n江東区\nレベル３大雨警報');
});

test('planWarningNotifications: continued は skip され通知は生成されない', () => {
  const item = createDummyItem({ kindCode: '03', kindName: 'レベル３大雨警報' });
  const change: WarningCurrentChange = {
    phenomenonKey: 'heavy_rain',
    changeType: 'continued',
    before: item,
    after: item,
  };

  const plan = planWarningNotifications({
    trigger: {
      kind: 'reception',
      infoType: '発表',
      telegramType: 'VPWW55',
      receptionId: 102,
    },
    changes: [change],
    context: createDummyContext({ currentItems: [item] }),
    detectionContext: 'normal',
    notificationIdFactory: () => 'notif-cont-001',
  });

  assert.equal(plan.notifications.length, 0);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0]!.reason, 'continued');
});

test('AC9: 判定不能コードでフォールバックせず skipped に記録される', () => {
  const unclassifiableItem = createDummyItem({ kindCode: '99', kindName: '未知警報' });
  const validItem = createDummyItem({ kindCode: '14', kindName: '雷注意報' });

  const changes: WarningCurrentChange[] = [
    {
      phenomenonKey: 'other_advisory',
      changeType: 'new',
      before: null,
      after: unclassifiableItem,
    },
    {
      phenomenonKey: 'thunder',
      changeType: 'new',
      before: null,
      after: validItem,
    },
  ];

  const plan = planWarningNotifications({
    trigger: {
      kind: 'reception',
      infoType: '発表',
      telegramType: 'VPWW61',
      receptionId: 103,
    },
    changes,
    context: createDummyContext({ currentItems: [unclassifiableItem, validItem] }),
    detectionContext: 'normal',
    notificationIdFactory: () => 'notif-fallback-001',
  });

  assert.equal(plan.notifications.length, 1);
  assert.equal(plan.notifications[0]!.notification.category, 'warning');
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0]!.reason, 'unclassifiable_kind_code');
});

test('planWarningNotifications: 訂正電文で continued の現象が corrected として通知される', () => {
  const item = createDummyItem({
    kindCode: '03',
    kindName: 'レベル３大雨警報',
    sourceTelegram: 'VPWW55',
  });
  const change: WarningCurrentChange = {
    phenomenonKey: 'heavy_rain',
    changeType: 'continued',
    before: item,
    after: item,
  };

  const plan = planWarningNotifications({
    trigger: {
      kind: 'reception',
      infoType: '訂正',
      telegramType: 'VPWW55',
      receptionId: 104,
    },
    changes: [change],
    context: createDummyContext({ currentItems: [item] }),
    detectionContext: 'normal',
    notificationIdFactory: () => 'notif-corr-001',
  });

  assert.equal(plan.notifications.length, 1);
  const p = plan.notifications[0]!;
  assert.equal(p.notification.changeType, 'corrected');
  assert.equal(p.notification.category, 'question');
  assert.equal(p.output.messageDefinition.id, 'weather-warning-corrected');
  assert.equal(p.output.summary, '気象警報等訂正\n江東区\nレベル３大雨警報');
});

test('planWarningNotifications: 訂正電文で現況が空（発表なし）の場合は地域のみの corrected 通知が1件生成される', () => {
  const plan = planWarningNotifications({
    trigger: {
      kind: 'reception',
      infoType: '訂正',
      telegramType: 'VPWW55',
      receptionId: 105,
    },
    changes: [],
    context: createDummyContext({ currentItems: [] }),
    detectionContext: 'normal',
    notificationIdFactory: () => 'notif-corr-empty-001',
  });

  assert.equal(plan.notifications.length, 1);
  const p = plan.notifications[0]!;
  assert.equal(p.notification.changeType, 'corrected');
  assert.equal(p.notification.category, 'warning');
  assert.equal(p.output.messageDefinition.id, 'weather-warning-corrected');
  assert.equal(p.output.summary, '気象警報等訂正\n江東区');
  assert.equal(p.output.display.content, null);
});

test('planWarningNotifications: 取消電文で released が cancelled として通知される (category: warning固定)', () => {
  const item = createDummyItem({ kindCode: '03', kindName: 'レベル３大雨警報' }); // 03 は通常 question だが取消は warning 固定
  const change: WarningCurrentChange = {
    phenomenonKey: 'heavy_rain',
    changeType: 'released',
    before: item,
    after: null,
  };

  const plan = planWarningNotifications({
    trigger: {
      kind: 'reception',
      infoType: '取消',
      telegramType: 'VPWW55',
      receptionId: 106,
    },
    changes: [change],
    context: createDummyContext({ currentItems: [] }),
    detectionContext: 'normal',
    notificationIdFactory: () => 'notif-cancel-001',
  });

  assert.equal(plan.notifications.length, 1);
  const p = plan.notifications[0]!;
  assert.equal(p.notification.changeType, 'cancelled');
  assert.equal(p.notification.category, 'warning');
  assert.equal(p.output.ackRequired, false);
  assert.equal(p.output.messageDefinition.id, 'weather-warning-cancelled');
  assert.equal(p.output.summary, '気象警報等取消\n江東区\nレベル３大雨警報');
});

test('planWarningNotifications: test controlStatus は通知を生成しない', () => {
  const item = createDummyItem({ kindCode: '03', kindName: 'レベル３大雨警報' });
  const change: WarningCurrentChange = {
    phenomenonKey: 'heavy_rain',
    changeType: 'new',
    before: null,
    after: item,
  };

  const plan = planWarningNotifications({
    trigger: {
      kind: 'reception',
      infoType: '発表',
      telegramType: 'VPWW55',
      receptionId: 107,
    },
    changes: [change],
    context: createDummyContext({ controlStatus: 'test', currentItems: [item] }),
    detectionContext: 'normal',
    notificationIdFactory: () => 'notif-test-001',
  });

  assert.equal(plan.notifications.length, 0);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0]!.reason, 'control_status_not_notifiable');
});
