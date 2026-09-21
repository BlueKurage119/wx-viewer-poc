import assert from 'node:assert/strict';
import test from 'node:test';
import type { NotificationFeedItem } from '@wx-viewer-poc/shared';
import {
  confirmNotification,
  createNotificationUiState,
  displayedNoticeForRow,
  notificationCounts,
  noticesForRow,
  receiveNotifications,
  setNotificationCursor,
  setNotificationRetry,
} from '../src/notifications/notificationStore.ts';
import { retryDelayMs } from '../src/notifications/useNotificationFeed.ts';

function notice(
  feedKey: string,
  category: NotificationFeedItem['category'],
  options: Partial<NotificationFeedItem> = {},
): NotificationFeedItem {
  return {
    feedKey,
    source: feedKey.startsWith('startup:') ? 'startup' : 'delta',
    sequence: feedKey.startsWith('startup:') ? null : 1,
    category,
    origin: 'weather',
    detectionContext: 'normal',
    changeType: 'new',
    sourceType: 'test',
    sourceVersion: null,
    targets: [{ kind: 'area', codeType: 'test', code: '1', name: '対象' }],
    occurredAt: '2026-09-21T00:00:00.000Z',
    detectedAt: '2026-09-21T00:00:00.000Z',
    relatedRefs: [],
    isTraining: false,
    ackRequired: true,
    summary: feedKey,
    display: null,
    messageDefinition: null,
    venueScope: 'venue',
    ...options,
  };
}

test('H2 AC1/AC2: startupとdeltaは別feedKeyで保持し、同一feedKeyは二重表示しない', () => {
  const startup = notice('startup:42', 'warning');
  const delta = notice('delta:42', 'warning', { sequence: 2 });
  const first = receiveNotifications(
    createNotificationUiState(),
    [startup, delta, delta],
    'K',
  ).state;
  assert.deepEqual(
    first.items.map((item) => item.feedKey),
    ['delta:42', 'startup:42'],
  );
  const second = receiveNotifications(first, [delta], 'K').state;
  assert.equal(second.items.length, 2);
  assert.equal(noticesForRow(second, 'K', 'warning')[0]?.summary, 'delta:42');
});

test('H2 AC3/AC5: 通知ごとの確認は別通知に波及せず、ackRequiredと確認済みを分離する', () => {
  const first = notice('delta:first', 'question', { occurredAt: '2026-09-21T00:00:01.000Z' });
  const second = notice('delta:second', 'question', {
    occurredAt: '2026-09-21T00:00:02.000Z',
    ackRequired: false,
  });
  const state = receiveNotifications(createNotificationUiState(), [first, second], 'K').state;
  const confirmed = confirmNotification(state, 'delta:second', 'K');
  assert.equal(confirmed.confirmedFeedKeys.has('delta:second'), true);
  assert.equal(confirmed.confirmedFeedKeys.has('delta:first'), false);
  assert.equal(notificationCounts(confirmed, 'K').pending, 1);
  assert.equal(noticesForRow(confirmed, 'K', 'question')[0]?.feedKey, 'delta:second');
  assert.equal(confirmed.items.find((item) => item.feedKey === 'delta:first')?.ackRequired, true);
});

test('H2 AC3: 確認後に次に表示する未確認通知を既読にする', () => {
  const older = notice('delta:older', 'warning', { occurredAt: '2026-09-21T00:00:01.000Z' });
  const newer = notice('delta:newer', 'warning', { occurredAt: '2026-09-21T00:00:02.000Z' });
  const received = receiveNotifications(createNotificationUiState(), [older, newer], 'K').state;
  assert.equal(displayedNoticeForRow(received, 'K', 'warning')?.feedKey, 'delta:newer');
  assert.equal(received.unreadFeedKeys.has('delta:older'), true);
  const confirmed = confirmNotification(received, 'delta:newer', 'K');
  assert.equal(displayedNoticeForRow(confirmed, 'K', 'warning')?.feedKey, 'delta:older');
  assert.equal(confirmed.unreadFeedKeys.has('delta:older'), false);
});

test('H2 AC3/AC4: 問いかけ行の新着は選択状態を解除し、同一取得の鳴動要求は最高区分だけになる', () => {
  const selected = {
    ...createNotificationUiState(),
    selectedQuestionFeedKey: 'delta:old',
    selectedQuestionChoice: 'approve',
  };
  const result = receiveNotifications(
    selected,
    [notice('delta:warning', 'warning'), notice('delta:emergency', 'emergency')],
    'K',
  );
  assert.equal(result.chime, 'emergency');
  assert.equal(result.state.selectedQuestionFeedKey, null);
  assert.equal(result.state.selectedQuestionChoice, null);
});

test('H2 AC4/AC6/AC7: H端末のsystem通知は表示・件数・鳴動から除外し、cursorと失敗状態は保持する', () => {
  const system = notice('delta:system', 'emergency', { origin: 'system' });
  const received = receiveNotifications(createNotificationUiState(), [system], 'H');
  assert.equal(received.chime, null);
  assert.equal(noticesForRow(received.state, 'H', 'question').length, 0);
  assert.deepEqual(notificationCounts(received.state, 'H'), { unread: 0, pending: 0 });
  const synchronized = setNotificationCursor(
    received.state,
    '9' as never,
    '通知の受信位置を同期しました。',
  );
  const retrying = setNotificationRetry(synchronized);
  assert.equal(retrying.cursor, '9');
  assert.equal(retrying.items.length, 1);
  assert.equal(retrying.operationMessage, '通知を受信できません。再試行します。');
});

test('H2 AC6: 契約外応答による再試行でも既存通知を維持する', () => {
  const received = receiveNotifications(
    createNotificationUiState(),
    [notice('delta:existing', 'warning')],
    'K',
  ).state;
  const retrying = setNotificationRetry(received);
  assert.deepEqual(
    retrying.items.map((item) => item.feedKey),
    ['delta:existing'],
  );
  assert.equal(retrying.phase, 'retrying');
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6].map(retryDelayMs),
    [1000, 2000, 4000, 8000, 16000, 30000, 30000],
  );
});
