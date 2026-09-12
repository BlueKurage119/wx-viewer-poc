import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  Notification,
  NotificationOutputSnapshot,
  NotificationTarget,
  SystemNotification,
  WeatherNotification,
} from '../src/index.js';

test('Notification 型: 端末宛て属性を持たず、weather と system の構造が分離されている', () => {
  const weatherTarget: NotificationTarget = {
    kind: 'area',
    codeType: 'jma_forecast_area',
    code: '130010',
    name: '東京都',
  };

  const weatherNotification: WeatherNotification = {
    notificationId: 'notif-weather-001',
    category: 'warning',
    origin: 'weather',
    changeType: 'strengthened',
    sourceType: 'warning_current',
    sourceVersion: 'v1',
    target: weatherTarget,
    occurredAt: '2026-09-12T00:00:00Z',
    detectedAt: '2026-09-12T00:00:01Z',
    relatedRefs: [{ type: 'telegram', ref: 'tel-001' }],
    detectionContext: 'normal',
    isTraining: false,
  };

  const systemNotification: SystemNotification = {
    notificationId: 'notif-system-001',
    category: 'emergency',
    origin: 'system',
    changeType: 'device_sensor_error',
    sourceType: 'fetch_attempt',
    sourceVersion: null,
    target: null,
    occurredAt: '2026-09-12T00:00:00Z',
    detectedAt: '2026-09-12T00:00:02Z',
    relatedRefs: [],
    detectionContext: 'initial',
    isTraining: true,
  };

  const notifications: readonly Notification[] = [weatherNotification, systemNotification];

  // 禁止された端末・配信・画面属性が存在しないことをランタイムオブジェクトのキーでも確認
  const forbiddenKeys = [
    'terminalId',
    'terminalGroupId',
    'read',
    'unread',
    'isRead',
    'confirmed',
    'ackStatus',
    'delivered',
    'deliveryStatus',
    'assignedTerminalId',
    'soundAssignee',
    'summary',
    'ackRequired',
  ];

  for (const n of notifications) {
    for (const key of forbiddenKeys) {
      assert.equal(key in n, false, `Notification must not contain property ${key}`);
    }
  }

  // weather と system の changeType / origin
  assert.equal(weatherNotification.origin, 'weather');
  assert.equal(weatherNotification.changeType, 'strengthened');
  assert.equal(systemNotification.origin, 'system');
  assert.equal(systemNotification.changeType, 'device_sensor_error');

  // 出力スナップショットの構造
  const snapshot: NotificationOutputSnapshot = {
    ackRequired: true,
    summary: '気象データ取得失敗',
    messageDefinition: {
      id: 'msg-def-001',
      version: '1.0.0',
    },
  };

  assert.equal(snapshot.ackRequired, true);
  assert.equal(snapshot.summary, '気象データ取得失敗');
  assert.deepEqual(snapshot.messageDefinition, {
    id: 'msg-def-001',
    version: '1.0.0',
  });
});
