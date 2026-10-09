import assert from 'node:assert/strict';
import test from 'node:test';
import { planInitialSyncNotification } from '../src/notifications/initialSyncNotificationPlanner.js';
import { planOperationNotification } from '../src/notifications/operationNotificationPlanner.js';
import { eastVenueId, testVenueRegistry } from './helpers/venueConfigPreload.js';

test('初回同期失敗は「気象Worker準備失敗」で対象を取得系、内容を「会場名 理由」とし、重複抑止と配信範囲を変えない', () => {
  const planned = planInitialSyncNotification({
    stage: 'xml_initial_fetch',
    venueId: eastVenueId,
    venueRegistry: testVenueRegistry,
    serverGenerationId: 'server-1',
    occurredAt: '2026-10-09T00:00:00.000Z',
  });
  assert.equal(
    planned.output.messageDefinition.id,
    'system-weather-acquisition-initialization-failed',
  );
  assert.equal(planned.output.display.title, '気象Worker準備失敗');
  assert.equal(planned.output.display.target, '取得系');
  assert.equal(
    planned.output.display.content,
    `${testVenueRegistry.getVenue(eastVenueId).warning.displayName} XML初回取得`,
  );
  assert.equal(planned.notification.category, 'question');
  assert.equal(
    planned.notification.notificationId,
    `initial-sync:server-1:xml_initial_fetch:${eastVenueId}`,
  );
  // 配信範囲の判定に使う会場コードは対象に残る（表示名だけが取得系）
  assert.equal(planned.notification.targets[0]?.codeType, 'venue');
  assert.equal(planned.notification.targets[0]?.code, eastVenueId);
  const global = planInitialSyncNotification({
    stage: 'service_setup',
    venueId: null,
    venueRegistry: testVenueRegistry,
    serverGenerationId: 'server-1',
    occurredAt: '2026-10-09T00:00:00.000Z',
  });
  assert.equal(global.output.display.target, '取得系');
  assert.equal(global.output.display.content, 'サービス準備');
});

test('取得操作の結果不明は警報として出し、内容を持たない', () => {
  const planned = planOperationNotification({
    operationKind: 'stop',
    result: 'failure',
    requestId: 'request-1',
    completedAt: '2026-10-09T00:00:00.000Z',
    notificationIdFactory: () => 'notification-1',
    errorCode: 'operation_result_unknown',
  });
  assert.ok(planned);
  assert.equal(planned.notification.category, 'warning');
  assert.equal(planned.output.messageDefinition.id, 'system-fetch-operation-unknown');
  assert.equal(planned.output.display.title, '取得操作の結果不明');
  assert.equal(planned.output.display.content, null);
});
