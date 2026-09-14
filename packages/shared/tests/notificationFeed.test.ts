import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  NotificationDeltaItem,
  NotificationFeedItem,
  StartupCurrentNotification,
  UtcIso8601String,
} from '../src/index.js';
import {
  mergeNotificationFeedItems,
  toNotificationFeedItemFromDelta,
  toNotificationFeedItemFromStartup,
} from '../src/notificationFeed.js';

const sampleStartupNotification: StartupCurrentNotification = {
  outputId: 'out-001',
  category: 'warning',
  origin: 'weather',
  sourceType: 'warning_current',
  sourceVersion: 'v1',
  targets: [
    {
      kind: 'area',
      codeType: 'jma_municipal_warning_area',
      code: '1310800',
      name: '江東区',
    },
  ],
  occurredAt: '2026-09-14T10:00:00Z' as UtcIso8601String,
  relatedRefs: [{ type: 'telegram', ref: 'tel-001' }],
  isTraining: false,
  output: {
    ackRequired: true,
    summary: '大雨警報\n江東区\n大雨警報が発表されました。',
    messageDefinition: { id: 'warn-01', version: '1.0' },
    display: {
      title: '大雨警報',
      target: '江東区',
      content: '大雨警報が発表されました。',
    },
    action: { kind: 'acknowledge', label: '確認' },
  },
};

const sampleDeltaItem: NotificationDeltaItem = {
  sequence: 42,
  notificationId: 'notif-001',
  category: 'warning',
  origin: 'weather',
  detectionContext: 'normal',
  sourceType: 'warning_current',
  sourceVersion: 'v1',
  changeType: 'new',
  targets: [
    {
      kind: 'area',
      codeType: 'jma_municipal_warning_area',
      code: '1310800',
      name: '江東区',
    },
  ],
  occurredAt: '2026-09-14T10:00:00Z' as UtcIso8601String,
  detectedAt: '2026-09-14T10:00:05Z' as UtcIso8601String,
  relatedRefs: [{ type: 'telegram', ref: 'tel-001' }],
  isTraining: false,
  venueScope: 'venue',
  output: {
    ackRequired: true,
    summary: '大雨警報\n江東区\n大雨警報が発表されました。',
    messageDefinition: { id: 'warn-01', version: '1.0' },
  },
};

test('toNotificationFeedItemFromStartup: 起動現況通知を正規化し、各フィールドを期待通り設定する', () => {
  const item = toNotificationFeedItemFromStartup(sampleStartupNotification);

  assert.equal(item.feedKey, 'startup:out-001');
  assert.equal(item.source, 'startup');
  assert.equal(item.sequence, null);
  assert.equal(item.category, 'warning');
  assert.equal(item.origin, 'weather');
  assert.equal(item.detectionContext, null);
  assert.equal(item.changeType, null);
  assert.equal(item.sourceType, 'warning_current');
  assert.equal(item.sourceVersion, 'v1');
  assert.deepEqual(item.targets, sampleStartupNotification.targets);
  assert.equal(item.occurredAt, '2026-09-14T10:00:00Z');
  assert.equal(item.detectedAt, null);
  assert.deepEqual(item.relatedRefs, sampleStartupNotification.relatedRefs);
  assert.equal(item.isTraining, false);
  assert.equal(item.ackRequired, true);
  assert.equal(item.summary, '大雨警報\n江東区\n大雨警報が発表されました。');
  assert.notEqual(item.summary, '');
  assert.deepEqual(item.display, sampleStartupNotification.output.display);
  assert.deepEqual(item.messageDefinition, { id: 'warn-01', version: '1.0' });
  assert.equal(item.venueScope, null);
});

test('toNotificationFeedItemFromDelta: 差分通知を正規化し、各フィールドを期待通り設定する', () => {
  const item = toNotificationFeedItemFromDelta(sampleDeltaItem);

  assert.equal(item.feedKey, 'delta:notif-001');
  assert.equal(item.source, 'delta');
  assert.equal(item.sequence, 42);
  assert.equal(item.category, 'warning');
  assert.equal(item.origin, 'weather');
  assert.equal(item.detectionContext, 'normal');
  assert.equal(item.changeType, 'new');
  assert.equal(item.sourceType, 'warning_current');
  assert.equal(item.sourceVersion, 'v1');
  assert.deepEqual(item.targets, sampleDeltaItem.targets);
  assert.equal(item.occurredAt, '2026-09-14T10:00:00Z');
  assert.equal(item.detectedAt, '2026-09-14T10:00:05Z');
  assert.deepEqual(item.relatedRefs, sampleDeltaItem.relatedRefs);
  assert.equal(item.isTraining, false);
  assert.equal(item.ackRequired, true);
  assert.equal(item.summary, '大雨警報\n江東区\n大雨警報が発表されました。');
  assert.notEqual(item.summary, '');
  assert.equal(item.display, null);
  assert.deepEqual(item.messageDefinition, { id: 'warn-01', version: '1.0' });
  assert.equal(item.venueScope, 'venue');
});

test('mergeNotificationFeedItems: 同一気象事象由来の startup と delta は統合されず2件残り、同一 feedKey は重複排除される', () => {
  const startupItem = toNotificationFeedItemFromStartup(sampleStartupNotification);
  const deltaItem = toNotificationFeedItemFromDelta(sampleDeltaItem);

  // 同じ気象事象に由来する起動項目と差分項目を渡しても統合されず2件のまま残る（AC10）
  const merged = mergeNotificationFeedItems([startupItem], [deltaItem]);
  assert.equal(merged.length, 2);

  // 同じ feedKey を2回渡すと1件に重複排除される（AC10）
  const updatedStartup: NotificationFeedItem = {
    ...startupItem,
    summary: '更新後文面',
  };
  const deduplicated = mergeNotificationFeedItems([startupItem], [updatedStartup]);
  assert.equal(deduplicated.length, 1);
  assert.equal(deduplicated[0].summary, '更新後文面');
});

test('mergeNotificationFeedItems: occurredAt → sequence(null最後) → feedKey 昇順で安定整列する', () => {
  const item1: NotificationFeedItem = {
    ...toNotificationFeedItemFromDelta(sampleDeltaItem),
    feedKey: 'delta:3',
    sequence: 3,
    occurredAt: '2026-09-14T12:00:00Z' as UtcIso8601String,
  };
  const item2: NotificationFeedItem = {
    ...toNotificationFeedItemFromDelta(sampleDeltaItem),
    feedKey: 'delta:1',
    sequence: 1,
    occurredAt: '2026-09-14T10:00:00Z' as UtcIso8601String,
  };
  const item3: NotificationFeedItem = {
    ...toNotificationFeedItemFromDelta(sampleDeltaItem),
    feedKey: 'delta:2',
    sequence: 2,
    occurredAt: '2026-09-14T10:00:00Z' as UtcIso8601String,
  };
  const itemStartup: NotificationFeedItem = {
    ...toNotificationFeedItemFromStartup(sampleStartupNotification),
    feedKey: 'startup:out-1',
    sequence: null,
    occurredAt: '2026-09-14T10:00:00Z' as UtcIso8601String,
  };

  // 時刻 10:00:00Z に sequence 1, 2 と startup(sequence null) があり、12:00:00Z に sequence 3
  const merged = mergeNotificationFeedItems([item1, item2], [item3, itemStartup]);

  assert.deepEqual(
    merged.map((m) => m.feedKey),
    ['delta:1', 'delta:2', 'startup:out-1', 'delta:3'],
  );
});
