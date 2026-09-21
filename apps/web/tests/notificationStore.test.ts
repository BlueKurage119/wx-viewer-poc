import assert from 'node:assert/strict';
import test from 'node:test';
import type { NotificationFeedItem } from '@wx-viewer-poc/shared';
import {
  confirmNotification,
  createNotificationUiState,
  displayedNoticeForRow,
  notificationCounts,
  nextUnconfirmedChime,
  noticesForRow,
  receiveNotifications,
  selectQuestionConfirmation,
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

test('問いかけは確認を選択しても確認済みにならず、送信時の確認処理まで選択を保持する', () => {
  const received = receiveNotifications(
    createNotificationUiState(),
    [notice('delta:question', 'question')],
    'K',
  ).state;
  const selected = selectQuestionConfirmation(received, 'delta:question');
  assert.equal(selected.selectedQuestionFeedKey, 'delta:question');
  assert.equal(selected.selectedQuestionChoice, 'confirm');
  assert.equal(selected.confirmedFeedKeys.has('delta:question'), false);

  const submitted = confirmNotification(selected, 'delta:question', 'K');
  assert.equal(submitted.confirmedFeedKeys.has('delta:question'), true);
  assert.equal(submitted.selectedQuestionFeedKey, null);
  assert.equal(submitted.selectedQuestionChoice, null);
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

test('H1 AC4: 確認後は残る未確認通知の最高区分・最新通知を次の鳴動対象にする', () => {
  const older = notice('delta:older', 'question', { occurredAt: '2026-09-21T00:00:01.000Z' });
  const newer = notice('delta:newer', 'question', { occurredAt: '2026-09-21T00:00:02.000Z' });
  const warning = notice('delta:warning', 'warning', { occurredAt: '2026-09-21T00:00:03.000Z' });
  const received = receiveNotifications(
    createNotificationUiState(),
    [older, newer, warning],
    'K',
  ).state;
  assert.deepEqual(nextUnconfirmedChime(received, 'K'), {
    category: 'question',
    feedKey: 'delta:newer',
  });
  const confirmed = confirmNotification(received, 'delta:newer', 'K');
  assert.deepEqual(nextUnconfirmedChime(confirmed, 'K'), {
    category: 'question',
    feedKey: 'delta:older',
  });
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
  assert.deepEqual(result.chime, { category: 'emergency', feedKey: 'delta:emergency' });
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

for (const category of ['warning', 'question', 'emergency'] as const) {
  test(`Issue #200 AC1/AC4: ${category}の最終確認後は空欄とし、保持・再受信・新着を分離する`, () => {
    const row = category === 'warning' ? 'warning' : 'question';
    const original = notice('delta:original', category);
    let state = receiveNotifications(createNotificationUiState(), [original], 'K').state;
    if (category !== 'warning') {
      state = selectQuestionConfirmation(state, original.feedKey);
      assert.equal(displayedNoticeForRow(state, 'K', row)?.feedKey, original.feedKey);
      assert.deepEqual(state.confirmedFeedKeys, new Set());
    }
    state = confirmNotification(state, original.feedKey, 'K');
    assert.equal(displayedNoticeForRow(state, 'K', row), undefined);
    assert.deepEqual(state.items, [original]);
    assert.deepEqual(state.confirmedFeedKeys, new Set(['delta:original']));
    assert.equal(state.selectedQuestionFeedKey, null);
    assert.equal(state.selectedQuestionChoice, null);
    const repeated = receiveNotifications(state, [original], 'K');
    assert.equal(repeated.chime, null);
    assert.equal(nextUnconfirmedChime(repeated.state, 'K'), null);
    assert.equal(displayedNoticeForRow(repeated.state, 'K', row), undefined);
    assert.deepEqual(notificationCounts(repeated.state, 'K'), { unread: 0, pending: 0 });
    assert.deepEqual(repeated.state.items, [original]);
    assert.deepEqual(repeated.state.confirmedFeedKeys, new Set(['delta:original']));
    const incoming = notice('delta:new', category, { occurredAt: '2026-09-21T00:00:01.000Z' });
    const added = receiveNotifications(repeated.state, [incoming], 'K');
    assert.equal(displayedNoticeForRow(added.state, 'K', row)?.feedKey, 'delta:new');
    assert.deepEqual(added.state.items, [incoming, original]);
    assert.deepEqual(added.state.confirmedFeedKeys, new Set(['delta:original']));
    assert.deepEqual(added.chime, { category, feedKey: 'delta:new' });
  });
}

for (const row of ['warning', 'question'] as const) {
  test(`Issue #200 AC2/AC5: ${row}行は区分優先でなく新→旧→空欄へ進み、既読・件数・鳴動を更新する`, () => {
    const olderCategory = row === 'warning' ? 'warning' : 'emergency';
    const newerCategory = row === 'warning' ? 'warning' : 'question';
    const older = notice('delta:older', olderCategory, { ackRequired: false });
    const newer = notice('delta:newer', newerCategory, { occurredAt: '2026-09-21T00:00:01.000Z' });
    let state = receiveNotifications(createNotificationUiState(), [older, newer], 'K').state;
    assert.equal(displayedNoticeForRow(state, 'K', row)?.feedKey, 'delta:newer');
    assert.deepEqual(state.unreadFeedKeys, new Set(['delta:older']));
    assert.deepEqual(notificationCounts(state, 'K'), { unread: 1, pending: 1 });
    assert.deepEqual(nextUnconfirmedChime(state, 'K'), {
      category: olderCategory,
      feedKey: row === 'warning' ? 'delta:newer' : 'delta:older',
    });
    state = confirmNotification(state, 'delta:newer', 'K');
    assert.equal(displayedNoticeForRow(state, 'K', row)?.feedKey, 'delta:older');
    assert.deepEqual(state.unreadFeedKeys, new Set());
    assert.deepEqual(notificationCounts(state, 'K'), { unread: 0, pending: 0 });
    assert.deepEqual(nextUnconfirmedChime(state, 'K'), {
      category: olderCategory,
      feedKey: 'delta:older',
    });
    state = confirmNotification(state, 'delta:older', 'K');
    assert.equal(displayedNoticeForRow(state, 'K', row), undefined);
    assert.deepEqual(state.items, [newer, older]);
    assert.deepEqual(notificationCounts(state, 'K'), { unread: 0, pending: 0 });
    assert.equal(nextUnconfirmedChime(state, 'K'), null);
  });

  test(`Issue #200 AC3: ${row}行だけ全件確認しても他方の未確認通知は残る`, () => {
    const state = receiveNotifications(
      createNotificationUiState(),
      [notice('delta:warning', 'warning'), notice('delta:question', 'question')],
      'K',
    ).state;
    const confirmed = confirmNotification(state, `delta:${row}`, 'K');
    const other = row === 'warning' ? 'question' : 'warning';
    assert.equal(displayedNoticeForRow(confirmed, 'K', row), undefined);
    assert.equal(displayedNoticeForRow(confirmed, 'K', other)?.feedKey, `delta:${other}`);
    assert.deepEqual(confirmed.confirmedFeedKeys, new Set([`delta:${row}`]));
    assert.deepEqual(notificationCounts(confirmed, 'K'), { unread: 0, pending: 1 });
  });

  test(`Issue #200 AC6: ${row}行のH端末はweather確認後に空欄、K端末には未確認systemが残る`, () => {
    const category = row === 'warning' ? 'warning' : 'emergency';
    const system = notice('delta:system', category, { origin: 'system' });
    const weather = notice('delta:weather', category, { occurredAt: '2026-09-21T00:00:01.000Z' });
    let state = receiveNotifications(createNotificationUiState(), [system, weather], 'H').state;
    assert.equal(displayedNoticeForRow(state, 'H', row)?.feedKey, 'delta:weather');
    assert.deepEqual(notificationCounts(state, 'H'), { unread: 0, pending: 1 });
    assert.deepEqual(nextUnconfirmedChime(state, 'H'), { category, feedKey: 'delta:weather' });
    state = confirmNotification(state, 'delta:weather', 'H');
    assert.equal(displayedNoticeForRow(state, 'H', row), undefined);
    assert.deepEqual(notificationCounts(state, 'H'), { unread: 0, pending: 0 });
    assert.equal(nextUnconfirmedChime(state, 'H'), null);
    assert.deepEqual(state.items, [weather, system]);
    assert.deepEqual(state.confirmedFeedKeys, new Set(['delta:weather']));
    assert.equal(displayedNoticeForRow(state, 'K', row)?.feedKey, 'delta:system');
    assert.deepEqual(notificationCounts(state, 'K'), { unread: 1, pending: 1 });
    assert.deepEqual(nextUnconfirmedChime(state, 'K'), { category, feedKey: 'delta:system' });
  });
}
