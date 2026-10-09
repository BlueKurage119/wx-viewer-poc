import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NotificationFeedItem } from '@wx-viewer-poc/shared';
import {
  createNotificationUiState,
  receiveNotifications,
  expireWarningHistory,
  confirmNotification,
  selectQuestionConfirmation,
  setNotificationCursor,
  notificationCounts,
  nextUnconfirmedChime,
  displayedNoticeForRow,
} from '../src/notifications/notificationStore.ts';
import {
  mergeWarningHistory,
  selectWarningHistory,
  formatWarningOccurredAt,
  warningSourceTypeLabel,
} from '../src/warnings/warningListModel.ts';
import {
  createWarningListSearchState,
  applyWarningListSearch,
  parseWarningListFilter,
  filterWarningListItems,
} from '../src/warnings/warningListFilterModel.ts';
import { WarningListView } from '../src/warnings/WarningListView.tsx';
import { WarningListFilters } from '../src/warnings/WarningListFilters.tsx';
import { NotificationArea } from '../src/shell/NotificationArea.tsx';

const receivedAt = 1791072000000;
const day = 86400000;
function notice(key: string, overrides: Partial<NotificationFeedItem> = {}): NotificationFeedItem {
  const startup = key.startsWith('startup:');
  return {
    feedKey: key,
    source: startup ? 'startup' : 'delta',
    sequence: startup ? null : 1,
    category: 'warning',
    origin: 'weather',
    detectionContext: startup ? null : 'normal',
    changeType: startup ? null : 'new',
    sourceType: 'warning_current',
    sourceVersion: null,
    targets: [{ kind: 'area', codeType: 'test', code: '1', name: '対象A' }],
    occurredAt: '2026-10-04T00:00:00.000Z',
    detectedAt: startup ? null : '2026-10-04T00:00:00.000Z',
    relatedRefs: [],
    isTraining: false,
    ackRequired: true,
    summary: '同じ内容',
    display: null,
    messageDefinition: null,
    venueScope: null,
    ...overrides,
  };
}
const keys = (items: readonly NotificationFeedItem[]) => items.map((item) => item.feedKey);
const renderList = (
  entries: ReturnType<typeof mergeWarningHistory>,
  options: Partial<React.ComponentProps<typeof WarningListView>> = {},
) =>
  renderToStaticMarkup(
    React.createElement(WarningListView, {
      entries,
      mode: 'K',
      nowMs: receivedAt,
      phase: 'ready',
      search: createWarningListSearchState(),
      onSearchChange: () => {},
      ...options,
    }),
  );

// 表の列契約を独立したHTML期待値で照合し、前後の操作部は別に検証する。
const tbody = (html: string) => html.match(/<tbody>(.*?)<\/tbody>/s)?.[1];

test('#67 同内容の起動・差分を別行に保持し、同一キー更新・初回受信時刻・整列順を守る', () => {
  const startup = notice('startup:1');
  const older = notice('delta:old', { occurredAt: '2026-10-03T00:00:00.000Z' });
  const entries = mergeWarningHistory(
    [],
    [startup, older, notice('delta:a', { sequence: 2 }), notice('delta:z', { sequence: 2 })],
    receivedAt,
  );
  assert.deepEqual(keys(selectWarningHistory(entries, 'K', receivedAt)), [
    'delta:z',
    'delta:a',
    'startup:1',
    'delta:old',
  ]);
  const updated = mergeWarningHistory(
    entries,
    [notice('delta:a', { sequence: 2, summary: '更新' })],
    receivedAt + 1000,
  );
  assert.equal(updated.length, 4);
  assert.equal(updated.find((e) => e.item.feedKey === 'delta:a')?.firstReceivedAtMs, receivedAt);
  assert.equal(updated.find((e) => e.item.feedKey === 'delta:a')?.item.summary, '更新');
  assert.equal(startup.detectionContext, null);
  const many = Array.from({ length: 500 }, (_, i) => notice(`delta:${i}`, { sequence: i }));
  const capped = mergeWarningHistory(
    [],
    [...many, notice('startup:old', { occurredAt: '2020-01-01T00:00:00.000Z' })],
    receivedAt,
  );
  assert.equal(capped.length, 500);
  assert.equal(
    capped.some((entry) => entry.item.feedKey === 'startup:old'),
    false,
  );
});

test('#67 受信から24時間の境界を含み、起動現況は期限外・遅着の古い発生日時も保持する', () => {
  const entries = mergeWarningHistory(
    [],
    [notice('startup:1'), notice('delta:old', { occurredAt: '2020-01-01T00:00:00.000Z' })],
    receivedAt,
  );
  assert.deepEqual(keys(selectWarningHistory(entries, 'K', receivedAt + day - 1)), [
    'startup:1',
    'delta:old',
  ]);
  assert.deepEqual(keys(selectWarningHistory(entries, 'K', receivedAt + day)), [
    'startup:1',
    'delta:old',
  ]);
  assert.deepEqual(keys(selectWarningHistory(entries, 'K', receivedAt + day + 1)), ['startup:1']);
});

test('#67 一覧だけ500件へ制限し、超過・期限削除・再受信は確認/未読/選択/cursor/次候補を変更しない', () => {
  const notices = Array.from({ length: 501 }, (_, i) =>
    notice(`delta:${String(i).padStart(3, '0')}`, { sequence: i }),
  );
  let state = receiveNotifications(createNotificationUiState(), notices, 'K', receivedAt).state;
  assert.equal(state.warningHistory.length, 500);
  assert.deepEqual(
    keys(state.warningHistory.map((e) => e.item)),
    notices
      .slice(1)
      .reverse()
      .map((i) => i.feedKey),
  );
  assert.equal(state.items.length, 501);
  state = setNotificationCursor(state, '501' as never);
  const snapshot = {
    items: state.items,
    cursor: state.cursor,
    confirmed: state.confirmedFeedKeys,
    unread: state.unreadFeedKeys,
    selected: state.selectedQuestionFeedKey,
    choice: state.selectedQuestionChoice,
    counts: notificationCounts(state, 'K'),
    chime: nextUnconfirmedChime(state, 'K'),
    row: displayedNoticeForRow(state, 'K', 'warning'),
  };
  const expired = expireWarningHistory(state, receivedAt + day + 1);
  assert.equal(expired.warningHistory.length, 0);
  assert.deepEqual(
    {
      items: expired.items,
      cursor: expired.cursor,
      confirmed: expired.confirmedFeedKeys,
      unread: expired.unreadFeedKeys,
      selected: expired.selectedQuestionFeedKey,
      choice: expired.selectedQuestionChoice,
      counts: notificationCounts(expired, 'K'),
      chime: nextUnconfirmedChime(expired, 'K'),
      row: displayedNoticeForRow(expired, 'K', 'warning'),
    },
    snapshot,
  );
  const repeated = receiveNotifications(
    expired,
    [notices[0]!, notices[500]!],
    'K',
    receivedAt + day + 2,
  );
  assert.deepEqual(repeated.state.warningHistory, []);
  assert.equal(repeated.chime, null);
  assert.equal(expireWarningHistory(expired, receivedAt + day + 10), expired);
});

test('#67 再受信でも期限を延長せず、明示確認後の行を保持し、リセットのみ履歴を空にする', () => {
  let state = receiveNotifications(
    createNotificationUiState(),
    [notice('delta:1', { category: 'question' })],
    'K',
    receivedAt,
  ).state;
  state = selectQuestionConfirmation(state, 'delta:1');
  const updated = receiveNotifications(
    state,
    [notice('delta:1', { category: 'question', summary: '更新' })],
    'K',
    receivedAt + day,
  );
  assert.equal(updated.state.warningHistory[0]?.firstReceivedAtMs, receivedAt);
  assert.equal(updated.state.selectedQuestionChoice, 'confirm');
  const confirmed = confirmNotification(updated.state, 'delta:1', 'K');
  assert.deepEqual(confirmed.warningHistory, updated.state.warningHistory);
  assert.deepEqual(
    keys(selectWarningHistory(confirmed.warningHistory, 'K', receivedAt + day + 1)),
    [],
  );
  assert.deepEqual(createNotificationUiState().warningHistory, []);
});

test('#67 5列・JST・対象サービス・1行内容・未知種別・起動/訓練を一致表示し個別操作列を持たない', () => {
  const item = notice('startup:1', {
    category: 'emergency',
    isTraining: true,
    sourceType: 'future_type',
    targets: [
      { kind: 'area', codeType: 'test', code: '1', name: '対象A' },
      { kind: 'area', codeType: 'test', code: '2', name: '対象A' },
    ],
    summary: '長い内容\n全文',
  });
  const entries = mergeWarningHistory([], [item], receivedAt);
  const html = renderList(entries);
  assert.deepEqual(
    [...html.matchAll(/<th scope="col">(.*?)<\/th>/g)].map((m) => m[1]),
    ['発生日時', '通知区分', '対象サービス', '情報種別', '内容'],
  );
  assert.equal(
    tbody(html),
    '<tr data-feed-key="startup:1"><td><time dateTime="2026-10-04T00:00:00.000Z">2026/10/04 09:00:00</time></td><td>非常</td><td>防災気象情報</td><td>future_type</td><td class="warning-list-content"><span class="warning-list-flags"><span>起動時</span><span>訓練</span></span><span class="warning-list-summary">長い内容　全文</span></td></tr>',
  );
  assert.equal((tbody(html)?.match(/<button|<md-gb-button/g) ?? []).length, 0);
  assert.equal(formatWarningOccurredAt('2026-10-03T15:00:00.000Z'), '2026/10/04 00:00:00');
  assert.deepEqual(
    [
      'warning_current',
      'bosai_bulletin',
      'fetch_health',
      'fetch_control',
      'database_recovery',
      'weather_worker',
      'new',
      'constructor',
    ].map(warningSourceTypeLabel),
    [
      '気象警報・注意報',
      '防災気象情報',
      '取得状態',
      '取得操作',
      'データベース復旧',
      '気象Worker',
      'new',
      'constructor',
    ],
  );
  for (const forbidden of ['確認時刻', '端末名称', '自端末', '全端末', '承認', '差戻'])
    assert.equal(html.includes(forbidden), false);
});

test('#67 H/Kの可視規則・開始中/空/再試行と各識別文字を別々に扱う', () => {
  const entries = mergeWarningHistory(
    [],
    [
      notice('delta:system', { origin: 'system', sourceType: 'fetch_health' }),
      notice('delta:weather', { isTraining: true }),
      notice('startup:1'),
    ],
    receivedAt,
  );
  const h = renderList(entries, { mode: 'H' });
  const k = renderList(entries);
  assert.deepEqual(
    [...h.matchAll(/data-feed-key="(.*?)"/g)].map((m) => m[1]),
    ['delta:weather', 'startup:1'],
  );
  assert.deepEqual(
    [...k.matchAll(/data-feed-key="(.*?)"/g)].map((m) => m[1]),
    ['delta:weather', 'delta:system', 'startup:1'],
  );
  assert.equal(h.includes('value="fetch_health"'), false);
  assert.equal(k.includes('value="fetch_health"'), true);
  assert.equal((tbody(h)?.match(/>訓練</g) ?? []).length, 1);
  assert.equal((tbody(h)?.match(/>起動時</g) ?? []).length, 1);
  assert.equal(
    renderList([], { phase: 'starting' }).match(/role="status">(.*?)<\/p>/)?.[1],
    '通知を読み込んでいます',
  );
  assert.equal(renderList([]).match(/role="status">(.*?)<\/p>/)?.[1], '通知はありません');
  assert.equal(tbody(renderList(entries, { phase: 'retrying' })), tbody(k));
});

test('#67 各改行区切りを全角スペースへ置換し、元の内容と複数対象を変更しない', () => {
  const item = notice('delta:lines', {
    summary: 'CRLF\r\nCR\rLF\n行区切り\u2028段落区切り\u2029末尾',
    targets: [
      { kind: 'area', codeType: 'test', code: '1', name: '対象A' },
      { kind: 'area', codeType: 'test', code: '2', name: '対象B' },
    ],
  });
  const original = structuredClone(item);
  const html = renderList(mergeWarningHistory([], [item], receivedAt));
  assert.equal(
    html.match(/<span class="warning-list-summary">(.*?)<\/span>/s)?.[1],
    'CRLF　CR　LF　行区切り　段落区切り　末尾',
  );
  assert.deepEqual(item, original);
});

const draft = (
  overrides: Partial<ReturnType<typeof createWarningListSearchState>['draft']> = {},
) => ({ ...createWarningListSearchState().draft, ...overrides });
function parsed(overrides: Parameters<typeof draft>[0] = {}) {
  const result = parseWarningListFilter(draft(overrides));
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.message);
  return result.filter;
}

test('#68 JSTの秒・両端一致・片側空・両側空はホストTZに依存せず、暦日/逆転/解釈不能を拒否する', () => {
  const originalTZ = process.env.TZ;
  try {
    for (const tz of ['UTC', 'Asia/Tokyo', 'America/New_York']) {
      process.env.TZ = tz;
      assert.deepEqual(
        parsed({ fromLocal: '2026-10-04T09:00:00', toLocal: '2026-10-04T09:00:01' }),
        {
          category: 'all',
          sourceType: 'all',
          fromEpochMs: 1791072000000,
          toEpochMs: 1791072001000,
        },
      );
      const items = [-1, 0, 1, 2].map((s) =>
        notice(`delta:${s}`, { occurredAt: new Date(receivedAt + s * 1000).toISOString() }),
      );
      assert.deepEqual(
        keys(
          filterWarningListItems(
            items,
            parsed({ fromLocal: '2026-10-04T09:00:00', toLocal: '2026-10-04T09:00:01' }),
          ),
        ),
        ['delta:0', 'delta:1'],
      );
      assert.deepEqual(
        keys(filterWarningListItems(items, parsed({ toLocal: '2026-10-04T09:00:00' }))),
        ['delta:-1', 'delta:0'],
      );
      assert.deepEqual(
        keys(filterWarningListItems(items, parsed({ fromLocal: '2026-10-04T09:00' }))),
        ['delta:0', 'delta:1', 'delta:2'],
      );
      assert.deepEqual(keys(filterWarningListItems(items, parsed())), [
        'delta:-1',
        'delta:0',
        'delta:1',
        'delta:2',
      ]);
    }
  } finally {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  }
  for (const value of ['bad', '2026-02-30T12:00', '2026-10-04T25:00'])
    assert.deepEqual(parseWarningListFilter(draft({ fromLocal: value })), {
      ok: false,
      message: '日時を正しく入力してください。',
    });
  assert.deepEqual(
    parseWarningListFilter(draft({ fromLocal: '2026-10-04T10:00', toLocal: '2026-10-04T09:00' })),
    { ok: false, message: '開始日時は終了日時以前にしてください。' },
  );
});

test('#68 区分・種別・日時はAND、訓練/起動/装置でもcategoryを再分類せず表示順を守る', () => {
  const items = [
    notice('delta:warning'),
    notice('startup:training', { category: 'question', sourceType: 'future', isTraining: true }),
    notice('delta:system', { category: 'question', origin: 'system', sourceType: 'future' }),
    notice('delta:emergency', { category: 'emergency' }),
    notice('startup:old', {
      category: 'question',
      sourceType: 'future',
      occurredAt: '2026-10-03T00:00:00.000Z',
    }),
  ];
  for (const category of ['warning', 'question', 'emergency'] as const)
    assert.deepEqual(
      keys(filterWarningListItems(items, parsed({ category }))),
      category === 'warning'
        ? ['delta:warning']
        : category === 'question'
          ? ['startup:training', 'delta:system', 'startup:old']
          : ['delta:emergency'],
    );
  assert.deepEqual(
    keys(
      filterWarningListItems(
        items,
        parsed({
          category: 'question',
          sourceType: 'future',
          fromLocal: '2026-10-04T09:00:00',
          toLocal: '2026-10-04T09:00:00',
        }),
      ),
    ),
    ['startup:training', 'delta:system'],
  );
  assert.deepEqual(keys(items), [
    'delta:warning',
    'startup:training',
    'delta:system',
    'delta:emergency',
    'startup:old',
  ]);
});

test('#68 入力だけで適用せず、不正期間は前回結果維持、クリアは即時全件・種別消失も選択を保持する', () => {
  const entries = mergeWarningHistory(
    [],
    [notice('delta:1'), notice('delta:2', { category: 'question', sourceType: 'future' })],
    receivedAt,
  );
  const initial = createWarningListSearchState();
  const editing = { ...initial, draft: draft({ category: 'question', sourceType: 'future' }) };
  assert.equal(tbody(renderList(entries, { search: editing })), tbody(renderList(entries)));
  const applied = applyWarningListSearch(editing);
  assert.deepEqual(
    keys(
      filterWarningListItems(
        entries.map((e) => e.item),
        applied.applied,
      ),
    ),
    ['delta:2'],
  );
  const invalid = applyWarningListSearch({
    ...applied,
    draft: { ...applied.draft, fromLocal: '2026-10-04T10:00', toLocal: '2026-10-04T09:00' },
  });
  assert.equal(invalid.error, '開始日時は終了日時以前にしてください。');
  assert.deepEqual(invalid.applied, applied.applied);
  assert.equal(
    tbody(renderList(entries, { search: invalid })),
    tbody(renderList(entries, { search: applied })),
  );
  const form = renderToStaticMarkup(
    React.createElement(WarningListFilters, {
      items: [],
      search: applied,
      onSearchChange: () => {},
    }),
  );
  assert.equal(form.match(/<option value="future"[^>]*>(.*?)<\/option>/)?.[1], 'future');
  assert.equal(
    renderList(entries, { search: invalid }).match(/role="alert">(.*?)<\/p>/)?.[1],
    '開始日時は終了日時以前にしてください。',
  );
  assert.equal(
    tbody(renderList(entries, { search: createWarningListSearchState() })),
    tbody(renderList(entries)),
  );
});

test('#68 新着・失効を適用条件で再評価し、検索は通知storeと下部表示・鳴動候補を変更しない', () => {
  const search = applyWarningListSearch({
    ...createWarningListSearchState(),
    draft: draft({ category: 'question' }),
  });
  let state = receiveNotifications(
    createNotificationUiState(),
    [notice('delta:old', { category: 'question' })],
    'K',
    receivedAt,
  ).state;
  state = selectQuestionConfirmation(state, 'delta:old');
  state = setNotificationCursor(state, '1' as never);
  const snapshot = structuredClone(state);
  const bottom = renderToStaticMarkup(React.createElement(NotificationArea, { state, mode: 'K' }));
  const chime = nextUnconfirmedChime(state, 'K');
  renderList(state.warningHistory, { search });
  renderList(state.warningHistory, { search: createWarningListSearchState() });
  assert.deepEqual(state, snapshot);
  assert.equal(
    renderToStaticMarkup(React.createElement(NotificationArea, { state, mode: 'K' })),
    bottom,
  );
  assert.deepEqual(nextUnconfirmedChime(state, 'K'), chime);
  const result = receiveNotifications(
    state,
    [
      notice('delta:new', { category: 'question', occurredAt: '2026-10-04T00:00:01.000Z' }),
      notice('delta:excluded', { category: 'emergency', occurredAt: '2026-10-04T00:00:02.000Z' }),
    ],
    'K',
    receivedAt + 1000,
  );
  assert.deepEqual(result.chime, { category: 'emergency', feedKey: 'delta:excluded' });
  assert.deepEqual(
    keys(
      filterWarningListItems(
        selectWarningHistory(result.state.warningHistory, 'K', receivedAt + 1000),
        search.applied,
      ),
    ),
    ['delta:new', 'delta:old'],
  );
  assert.deepEqual(
    keys(
      filterWarningListItems(
        selectWarningHistory(result.state.warningHistory, 'K', receivedAt + day + 1),
        search.applied,
      ),
    ),
    ['delta:new'],
  );
  assert.equal(
    renderList(result.state.warningHistory, { search, nowMs: receivedAt + day + 1001 }).match(
      /role="status">(.*?)<\/p>/,
    )?.[1],
    '通知はありません',
  );
  assert.equal(
    renderList(mergeWarningHistory([], [notice('delta:warning')], receivedAt), { search }).match(
      /role="status">(.*?)<\/p>/,
    )?.[1],
    '条件に一致する通知はありません',
  );
});
