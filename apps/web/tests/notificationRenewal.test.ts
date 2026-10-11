import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  listWarningMessagePreferenceOptions,
  type NotificationFeedItem,
} from '@wx-viewer-poc/shared';
import { previewNotices } from '../src/shell/fixtures.ts';
import { NotificationPreferencesDialog } from '../src/notifications/NotificationPreferencesDialog.tsx';
import { NotificationArea } from '../src/shell/NotificationArea.tsx';
import { WarningListView } from '../src/warnings/WarningListView.tsx';
import { createWarningListSearchState } from '../src/warnings/warningListFilterModel.ts';
import {
  createNotificationPreferencesRepository,
  EMPTY_NOTIFICATION_PREFERENCES,
  NOTIFICATION_PREFERENCES_KEY,
  resolveWarningPresentationPolicy,
  validateNotificationPreferences,
} from '../src/notifications/notificationPreferences.ts';
import {
  advanceAutoConfirmation,
  nextAutoConfirmationDeadline,
} from '../src/notifications/autoConfirmation.ts';
import {
  confirmationSoundDecision,
  confirmNotification,
  createNotificationUiState,
  displayedNoticeForRow,
  isVisibleForTerminal,
  receiveNotifications,
  selectQuestionConfirmation,
} from '../src/notifications/notificationStore.ts';
import { useHeaderBuzzer } from '../src/notifications/useHeaderBuzzer.ts';
import { createBuzzerNoticeColors } from '../src/theme/buzzerNoticeColors.ts';
import { Contrast } from '@material/material-color-utilities';
const preferences = {
  schemaVersion: 1 as const,
  autoConfirmMessageDefinitionIds: [
    'weather-advisory-issued',
    'system-weather-acquisition-report-stale',
  ],
};
function notice(
  feedKey: string,
  options: Partial<NotificationFeedItem> = {},
): NotificationFeedItem {
  return {
    ...previewNotices('mixed').find((item) => item.category === 'warning')!,
    category: 'warning',
    feedKey,
    messageDefinition: { id: 'weather-advisory-issued', version: '1' },
    ...options,
  };
}
test('#271 設定保存・再読込・破損・未知版・取得保存例外', () => {
  let saved: string | null = null;
  const repository = createNotificationPreferencesRepository(() => ({
    getItem: (key) => {
      assert.equal(key, NOTIFICATION_PREFERENCES_KEY);
      return saved;
    },
    setItem: (key, value) => {
      assert.equal(key, NOTIFICATION_PREFERENCES_KEY);
      saved = value;
    },
  }));
  assert.deepEqual(repository.load(), EMPTY_NOTIFICATION_PREFERENCES);
  assert.deepEqual(repository.save(preferences), { saved: true });
  assert.deepEqual(repository.load(), preferences);
  saved = '{';
  assert.deepEqual(repository.load(), EMPTY_NOTIFICATION_PREFERENCES);
  saved = '{"schemaVersion":2,"autoConfirmMessageDefinitionIds":[]}';
  assert.deepEqual(repository.load(), EMPTY_NOTIFICATION_PREFERENCES);
  assert.deepEqual(
    validateNotificationPreferences({
      schemaVersion: 1,
      autoConfirmMessageDefinitionIds: [
        'unknown',
        'weather-advisory-issued',
        'weather-advisory-issued',
      ],
    }),
    { schemaVersion: 1, autoConfirmMessageDefinitionIds: ['weather-advisory-issued'] },
  );
  const blocked = createNotificationPreferencesRepository(() => {
    throw new Error('保存不可');
  });
  assert.deepEqual(blocked.load(), EMPTY_NOTIFICATION_PREFERENCES);
  assert.deepEqual(blocked.save(preferences), { saved: false });
});
test('#271 警報だけに定義ID照合を行い版変更でも維持する', () => {
  assert.deepEqual(
    resolveWarningPresentationPolicy(
      notice('a', { messageDefinition: { id: 'weather-advisory-issued', version: '9' } }),
      preferences,
    ),
    { autoConfirmAfterMs: 5000, tone: 'level2' },
  );
  for (const messageDefinition of [
    null,
    { id: 'unknown', version: '1' },
    { id: 'weather-warning-issued', version: '1' },
  ])
    assert.deepEqual(
      resolveWarningPresentationPolicy(notice('b', { messageDefinition }), preferences),
      { autoConfirmAfterMs: null, tone: 'level3' },
    );
  for (const category of ['question', 'emergency'] as const)
    assert.equal(resolveWarningPresentationPolicy(notice('c', { category }), preferences), null);
  assert.deepEqual(resolveWarningPresentationPolicy(notice('d'), EMPTY_NOTIFICATION_PREFERENCES), {
    autoConfirmAfterMs: null,
    tone: 'level3',
  });
});
test('#271 4999/5000ms境界・表示割込・重複・設定変更・履歴保持', () => {
  const first = receiveNotifications(
    createNotificationUiState(),
    [notice('a')],
    'K',
    1000,
    preferences,
  );
  assert.deepEqual(first.chime, { category: 'warning', feedKey: 'a', level: 2 });
  assert.equal(nextAutoConfirmationDeadline(first.state), 6000);
  const next = receiveNotifications(
    first.state,
    [notice('a'), notice('b', { occurredAt: '2099-01-01T00:00:00Z' })],
    'K',
    3000,
    EMPTY_NOTIFICATION_PREFERENCES,
  ).state;
  assert.equal(displayedNoticeForRow(next, 'K', 'warning')?.feedKey, 'b');
  assert.deepEqual(next.warningPresentationByFeedKey.a, {
    policy: { autoConfirmAfterMs: 5000, tone: 'level2' },
    autoConfirmDeadlineMs: 6000,
  });
  assert.deepEqual(next.warningPresentationByFeedKey.b, {
    policy: { autoConfirmAfterMs: null, tone: 'level3' },
    autoConfirmDeadlineMs: null,
  });
  assert.equal(advanceAutoConfirmation(next, 'K', 5999).state, next);
  const expired = advanceAutoConfirmation(next, 'K', 6000);
  assert.deepEqual(expired.automaticallyConfirmedFeedKeys, ['a']);
  assert.deepEqual(expired.state.confirmedFeedKeys, new Set(['a']));
  assert.equal(expired.state.warningHistory, next.warningHistory);
  assert.equal(expired.state.items, next.items);
  assert.equal(expired.state.cursors, next.cursors);
  assert.equal(nextAutoConfirmationDeadline(expired.state), null);
  assert.equal(advanceAutoConfirmation(expired.state, 'K', 99999).state, expired.state);
});
test('#271 自動確認は問いかけ選択を保持し対象外と未知の確認は冪等', () => {
  let state = receiveNotifications(
    createNotificationUiState(),
    [
      notice('a'),
      notice('q', { category: 'question' }),
      notice('e', { category: 'emergency' }),
      notice('manual', { messageDefinition: null }),
    ],
    'K',
    0,
    preferences,
  ).state;
  state = selectQuestionConfirmation(state, 'q');
  const expired = advanceAutoConfirmation(state, 'K', 5000);
  assert.deepEqual(expired.state.confirmedFeedKeys, new Set(['a']));
  assert.equal(expired.state.selectedQuestionFeedKey, 'q');
  assert.equal(expired.state.selectedQuestionChoice, 'confirm');
  for (const key of ['a', 'missing'])
    assert.equal(confirmNotification(expired.state, key, 'K'), expired.state);
  for (const key of ['q', 'e', 'manual'])
    assert.equal(confirmNotification(expired.state, key, 'K', 'automatic'), expired.state);
});
test('#271 同時満了・非表示system期限と可視音の境界', () => {
  let state = receiveNotifications(
    createNotificationUiState(),
    [
      notice('system', {
        origin: 'system',
        messageDefinition: { id: 'system-weather-acquisition-report-stale', version: '2' },
      }),
    ],
    'H',
    0,
    preferences,
  ).state;
  assert.equal(displayedNoticeForRow(state, 'H', 'warning'), undefined);
  const result = receiveNotifications(
    state,
    [notice('weather'), notice('weather2')],
    'H',
    2000,
    preferences,
  );
  assert.equal(result.chime?.level, 2);
  state = result.state;
  const first = advanceAutoConfirmation(state, 'H', 5000);
  assert.deepEqual(first.automaticallyConfirmedFeedKeys, ['system']);
  assert.deepEqual(
    first.automaticallyConfirmedFeedKeys.filter((key) =>
      isVisibleForTerminal(
        first.state.items.find((item) => item.feedKey === key)!,
        'H',
      ),
    ),
    [],
  );
  const second = advanceAutoConfirmation(first.state, 'H', 7000);
  assert.deepEqual(second.automaticallyConfirmedFeedKeys, ['weather', 'weather2']);
  assert.deepEqual(second.state.confirmedFeedKeys, new Set(['system', 'weather', 'weather2']));
});
test('#271 新着候補Lv.5>4>3>2、古い非常と重複を除外する', () => {
  for (const [category, level] of [
    ['warning', 3],
    ['question', 4],
    ['emergency', 5],
  ] as const) {
    const result = receiveNotifications(
      createNotificationUiState(),
      [
        notice('auto'),
        notice('manual', { messageDefinition: null }),
        notice('higher', { category, messageDefinition: null }),
      ],
      'K',
      0,
      preferences,
    );
    assert.equal(result.chime?.level, level);
  }
  const state = receiveNotifications(
    createNotificationUiState(),
    [notice('emergency', { category: 'emergency' })],
    'K',
    0,
    preferences,
  ).state;
  const result = receiveNotifications(
    state,
    [notice('new', { messageDefinition: null })],
    'K',
    1000,
    preferences,
  );
  assert.deepEqual(result.chime, { category: 'warning', feedKey: 'new', level: 3 });
  assert.equal(
    receiveNotifications(result.state, [notice('new')], 'K', 3000, preferences).chime,
    null,
  );
});
test('#271 確認による停止は同レベルだけ', () => {
  for (const current of [null, 2, 3, 4, 5] as const)
    for (const confirmed of [2, 3, 4, 5] as const)
      assert.equal(
        confirmationSoundDecision(current, confirmed),
        current === confirmed ? 'stop' : 'keep',
      );
});
async function withHooks(task: (flush: () => void) => void | Promise<void>) {
  // @ts-expect-error Reactのテスト用内部dispatcher
  const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previous = internals.H;
  const effects: Array<() => void | (() => void)> = [];
  const cleanups: Array<() => void> = [];
  internals.H = {
    useRef: (value: unknown) => ({ current: value }),
    useState: (value: unknown) => [
      typeof value === 'function' ? (value as () => unknown)() : value,
      () => {},
    ],
    useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => void | (() => void)) => effects.push(fn),
  };
  try {
    await task(() => {
      for (const effect of effects.splice(0)) {
        const cleanup = effect();
        if (cleanup) cleanups.push(cleanup);
      }
    });
  } finally {
    for (const cleanup of cleanups) cleanup();
    internals.H = previous;
  }
}
test('#271 音源・上位割込・同以下維持・同レベル停止・明示停止を実hookで検証', async () => {
  const oldAudio = globalThis.Audio;
  const played: string[] = [];
  let pauses = 0;
  globalThis.Audio = class {
    loop = false;
    currentTime = 0;
    constructor(readonly src: string) {}
    play() {
      played.push(this.src);
      return Promise.resolve();
    }
    pause() {
      pauses++;
    }
  } as unknown as typeof Audio;
  try {
    await withHooks(() => {
      const buzzer = useHeaderBuzzer();
      buzzer.request({ category: 'warning', feedKey: 'a', level: 2 });
      buzzer.request({ category: 'warning', feedKey: 'b', level: 3 });
      buzzer.request({ category: 'warning', feedKey: 'c', level: 2 });
      buzzer.request({ category: 'warning', feedKey: 'd', level: 3 });
      buzzer.confirmLevel(2);
      assert.deepEqual(played, ['/audio/2.wav', '/audio/3.wav']);
      assert.equal(pauses, 1);
      buzzer.confirmLevel(3);
      assert.equal(pauses, 2);
      buzzer.request({ category: 'question', feedKey: 'q', level: 4 });
      buzzer.request({ category: 'emergency', feedKey: 'e', level: 5 });
      buzzer.stop();
      buzzer.request({ category: 'warning', feedKey: 'new', level: 3 });
      buzzer.confirmLevel(5);
      assert.equal(pauses, 4);
      buzzer.confirmLevel(3);
      assert.equal(pauses, 5);
      assert.deepEqual(played, [
        '/audio/2.wav',
        '/audio/3.wav',
        '/audio/4.wav',
        '/audio/5.wav',
        '/audio/3.wav',
      ]);
    });
  } finally {
    globalThis.Audio = oldAudio;
  }
});
test('#271 停止後の古いplay rejectは操作リトライを復活させない', async () => {
  const oldAudio = globalThis.Audio;
  const oldAdd = window.addEventListener;
  const oldRemove = window.removeEventListener;
  const listeners: Array<() => void> = [];
  let plays = 0;
  let reject!: () => void;
  globalThis.Audio = class {
    loop = false;
    currentTime = 0;
    play() {
      plays++;
      if (plays > 1) return Promise.resolve();
      return new Promise<void>((_resolve, fail) => {
        reject = () => fail(new Error('blocked'));
      });
    }
    pause() {}
  } as unknown as typeof Audio;
  window.addEventListener = ((_type: string, listener: () => void) =>
    listeners.push(listener)) as typeof window.addEventListener;
  window.removeEventListener = (() => {}) as typeof window.removeEventListener;
  try {
    await withHooks(async (flush) => {
      const buzzer = useHeaderBuzzer();
      flush();
      buzzer.request({ category: 'warning', feedKey: 'a', level: 2 });
      buzzer.stop();
      buzzer.request({ category: 'warning', feedKey: 'new', level: 3 });
      await Promise.resolve();
      reject();
      await Promise.resolve();
      for (const listener of listeners) listener();
      assert.equal(plays, 2);
    });
  } finally {
    globalThis.Audio = oldAudio;
    window.addEventListener = oldAdd;
    window.removeEventListener = oldRemove;
  }
});
test('#271 同名Worker補助表示と検索フォーム外の設定入口', () => {
  const workers = listWarningMessagePreferenceOptions().filter(
    ({ title }) => title === '気象Worker応答不明',
  );
  assert.deepEqual(
    workers.map(({ qualifier }) => qualifier),
    ['気象取得Worker', '気象情報提供Worker'],
  );
  const html = renderToStaticMarkup(
    React.createElement(WarningListView, {
      entries: [],
      mode: 'K',
      nowMs: 0,
      phase: 'ready',
      search: createWarningListSearchState(),
      onSearchChange: () => {
        throw new Error('検索操作禁止');
      },
    }),
  );
  assert.equal(html.indexOf('</form>') < html.indexOf('>通知設定</md-gb-button>'), true);
});
test('#271 四状態トークンと非常のコントラストを検証しヘッダー色維持', () => {
  const state = receiveNotifications(
    createNotificationUiState(),
    [notice('auto'), notice('e', { category: 'emergency' })],
    'K',
    0,
    preferences,
  ).state;
  const html = renderToStaticMarkup(React.createElement(NotificationArea, { state, mode: 'K' }));
  assert.equal(html.includes('warning-auto-row'), true);
  assert.equal(html.includes('emergency-row'), true);
  const colors = createBuzzerNoticeColors(true);
  assert.equal(colors['--wx-buzzer-notice-warning-auto-foreground'], '#ffffff');
  assert.equal(colors['--wx-buzzer-header-emergency-container'], '#b4271f');
  assert.equal(Contrast.ratioOfTones(80, 20) >= 4.5, true);
});

// ダイアログの実ハンドラーを再描画し、保存失敗時のdraftと再試行を検証する。
function statefulRender<T>(render: () => T) {
  // @ts-expect-error Reactのテスト用内部dispatcher
  const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previous = internals.H;
  const values: unknown[] = [];
  let cursor = 0;
  const dispatcher = {
    useRef: (initial: unknown) => ({ current: initial }),
    useEffect: () => {},
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in values))
        values[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [
        values[index],
        (value: unknown) => {
          values[index] =
            typeof value === 'function'
              ? (value as (old: unknown) => unknown)(values[index])
              : value;
        },
      ];
    },
  };
  return () => {
    cursor = 0;
    internals.H = dispatcher;
    try {
      return render();
    } finally {
      internals.H = previous;
    }
  };
}
function elementsOf(root: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement(root)) return [];
  const element = root as React.ReactElement<Record<string, unknown>>;
  return [
    element,
    ...React.Children.toArray(element.props.children as React.ReactNode).flatMap(elementsOf),
  ];
}

test('#271 ダイアログ保存失敗はdraft/エラー/旧設定を保持し、同じdraftで再試行する', () => {
  let current = EMPTY_NOTIFICATION_PREFERENCES;
  let success = false;
  let closed = 0;
  const render = statefulRender(() =>
    NotificationPreferencesDialog({
      preferences: current,
      onSave: (next) => {
        if (success) current = next;
        return success;
      },
      onClose: () => {
        closed++;
      },
    }),
  );
  let tree = render();
  const input = elementsOf(tree).find((element) => element.type === 'input')!;
  (input.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  const save = () =>
    (
      elementsOf(tree).find((element) => element.props.children === '保存')!.props
        .onClick as () => void
    )();
  tree = render();
  save();
  tree = render();
  assert.equal(closed, 0);
  assert.deepEqual(current, EMPTY_NOTIFICATION_PREFERENCES);
  assert.equal(elementsOf(tree).find((element) => element.type === 'input')!.props.checked, true);
  assert.equal(
    elementsOf(tree).find((element) => element.props.role === 'alert')!.props.children,
    '設定を保存できません。再試行してください。',
  );
  success = true;
  save();
  assert.equal(closed, 1);
  assert.deepEqual(current, {
    schemaVersion: 1,
    autoConfirmMessageDefinitionIds: ['weather-advisory-issued'],
  });
});

test('#271 取消/Escapeは未保存draftを適用せず閉じ、検索操作へ影響しない', () => {
  for (const action of ['cancel', 'escape'] as const) {
    let closed = 0;
    let saved = 0;
    const render = statefulRender(() =>
      NotificationPreferencesDialog({
        preferences: EMPTY_NOTIFICATION_PREFERENCES,
        onSave: () => {
          saved++;
          return false;
        },
        onClose: () => {
          closed++;
        },
      }),
    );
    const tree = render();
    (
      elementsOf(tree).find((element) => element.type === 'input')!.props.onChange as (
        event: unknown,
      ) => void
    )({ target: { checked: true } });
    if (action === 'cancel')
      (
        elementsOf(tree).find((element) => element.props.children === '取消')!.props
          .onClick as () => void
      )();
    else (tree.props.onCancel as (event: unknown) => void)({ preventDefault: () => {} });
    assert.equal(closed, 1);
    assert.equal(saved, 0);
    let stopped = 0;
    (tree.props.onKeyDown as (event: unknown) => void)({
      key: 'Enter',
      stopPropagation: () => {
        stopped++;
      },
    });
    assert.equal(stopped, 1);
  }
});
