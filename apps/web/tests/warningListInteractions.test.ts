import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { WarningListFilters } from '../src/warnings/WarningListFilters.tsx';
import {
  createWarningListSearchState,
  type WarningListSearchState,
} from '../src/warnings/warningListFilterModel.ts';
import { AppShell } from '../src/shell/AppShell.tsx';
import { useHeaderBuzzer } from '../src/notifications/useHeaderBuzzer.ts';
import {
  createNotificationUiState,
  receiveNotifications,
  selectQuestionConfirmation,
  setNotificationCursor,
  notificationCounts,
  nextUnconfirmedChime,
} from '../src/notifications/notificationStore.ts';
import { previewNotices } from '../src/shell/fixtures.ts';
import { testTerminals } from './venueConfigPreload.ts';

// React要素の操作ハンドラーを実行する。ブラウザーのレイアウトは検収で別途確認する。
function propsOf(element: unknown): Record<string, unknown> {
  assert.equal(React.isValidElement(element), true);
  return (element as React.ReactElement<Record<string, unknown>>).props;
}
function childrenOf(element: unknown): unknown[] {
  return React.Children.toArray(propsOf(element).children as React.ReactNode);
}
function invoke(element: unknown, name: string, event?: unknown) {
  const fn = propsOf(element)[name];
  assert.equal(typeof fn, 'function');
  (fn as (event?: unknown) => void)(event);
}

test('#68 条件UIの変更/検索/Enter/フォーム送信/クリアを実ハンドラーへ接続する', () => {
  let search = createWarningListSearchState();
  const render = () =>
    WarningListFilters({
      items: previewNotices('mixed'),
      search,
      onSearchChange: (next: WarningListSearchState) => {
        search = next;
      },
    });
  const initialApplied = search.applied;
  let form = render();
  const fields = childrenOf(form);
  invoke(childrenOf(fields[2])[1], 'onChange', { target: { value: 'question' } });
  assert.equal(search.draft.category, 'question');
  assert.equal(search.applied, initialApplied);
  form = render();
  invoke(childrenOf(childrenOf(form)[4])[0], 'onClick');
  assert.equal(search.applied.category, 'question');
  form = render();
  invoke(childrenOf(childrenOf(form)[0])[1], 'onChange', { target: { value: '2026-10-04T10:00' } });
  form = render();
  invoke(childrenOf(childrenOf(form)[1])[1], 'onChange', { target: { value: '2026-10-04T09:00' } });
  form = render();
  let prevented = 0;
  invoke(form, 'onKeyDown', {
    key: 'Enter',
    target: { tagName: 'INPUT' },
    preventDefault: () => prevented++,
  });
  assert.equal(prevented, 1);
  assert.equal(search.error, '開始日時は終了日時以前にしてください。');
  assert.equal(search.applied.category, 'question');
  form = render();
  invoke(childrenOf(childrenOf(form)[4])[1], 'onClick');
  assert.deepEqual(search, createWarningListSearchState());
  form = render();
  invoke(childrenOf(childrenOf(form)[3])[1], 'onChange', { target: { value: 'warning_current' } });
  form = render();
  invoke(form, 'onSubmit', { preventDefault: () => prevented++ });
  assert.equal(prevented, 2);
  assert.equal(search.applied.sourceType, 'warning_current');
});

// 既存hookテストと同じdispatcher方式で、イベント登録解除・音声を独立に制御する。
function withHooks(task: (flush: () => void, unmount: () => void) => void) {
  // @ts-expect-error Reactのテスト用内部dispatcher
  const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previous = internals.H;
  const effects: Array<() => (() => void) | void> = [];
  const cleanups: Array<() => void> = [];
  internals.H = {
    useRef: (initial: unknown) => ({ current: initial }),
    useState: (initial: unknown) => [initial, () => {}],
    useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => (() => void) | void) => effects.push(fn),
    useLayoutEffect: () => {},
  };
  const flush = () => {
    for (const effect of effects.splice(0)) {
      const cleanup = effect();
      if (cleanup) cleanups.push(cleanup);
    }
  };
  const unmount = () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  };
  try {
    task(flush, unmount);
  } finally {
    unmount();
    internals.H = previous;
  }
}

for (const via of ['header', 'F8'] as const) {
  test(`#67 ${via}停止は音声だけを停止し、確認/未読/選択/履歴/cursor/件数/鳴動候補を維持する`, () => {
    let state = receiveNotifications(
      createNotificationUiState(),
      previewNotices('mixed'),
      'K',
      1791072000000,
    ).state;
    const selected = state.items.find((item) => item.category !== 'warning')!;
    state = selectQuestionConfirmation(state, selected.feedKey);
    state = setNotificationCursor(state, '4' as never);
    const snapshot = structuredClone(state);
    const counts = notificationCounts(state, 'K');
    const nextChime = nextUnconfirmedChime(state, 'K');
    const oldAudio = globalThis.Audio;
    const oldAdd = window.addEventListener;
    const oldRemove = window.removeEventListener;
    const listeners = new Set<EventListener>();
    let plays = 0;
    let pauses = 0;
    let currentTime = 9;
    globalThis.Audio = class {
      loop = false;
      get currentTime() {
        return currentTime;
      }
      set currentTime(next: number) {
        currentTime = next;
      }
      play() {
        plays++;
        return Promise.resolve();
      }
      pause() {
        pauses++;
      }
    } as unknown as typeof Audio;
    window.addEventListener = ((type: string, fn: EventListener) => {
      if (type === 'keydown') listeners.add(fn);
    }) as typeof window.addEventListener;
    window.removeEventListener = ((type: string, fn: EventListener) => {
      if (type === 'keydown') listeners.delete(fn);
    }) as typeof window.removeEventListener;
    try {
      withHooks((flush, unmount) => {
        const buzzer = useHeaderBuzzer();
        buzzer.request({ category: 'question', feedKey: selected.feedKey });
        assert.equal(plays, 1);
        assert.equal(pauses, 0);
        const shell = AppShell({
          terminal: testTerminals[1]!,
          title: '警報一覧',
          view: 'warnings',
          onViewChange: () => {},
          navigation: [],
          now: new Date('2026-10-04T00:00:00Z'),
          connection: { failed: false, lastSuccessAt: null },
          onStopBuzzer: buzzer.stop,
          buzzer: { category: 'question', feedKey: selected.feedKey },
          children: null,
          notifications: null,
        });
        flush();
        let prevented = 0;
        if (via === 'header') invoke(childrenOf(shell)[1], 'onClick');
        else {
          for (const listener of listeners)
            listener({ key: 'F8', preventDefault: () => prevented++ } as unknown as Event);
          assert.equal(prevented, 1);
        }
        assert.equal(pauses, 1);
        assert.equal(currentTime, 0);
        assert.equal(plays, 1);
        assert.deepEqual(state, snapshot);
        assert.deepEqual(notificationCounts(state, 'K'), counts);
        assert.deepEqual(nextUnconfirmedChime(state, 'K'), nextChime);
        unmount();
        assert.equal(listeners.size, 0);
      });
    } finally {
      globalThis.Audio = oldAudio;
      window.addEventListener = oldAdd;
      window.removeEventListener = oldRemove;
    }
  });
}

test('#67 停止可能でないF8/他キーは既定動作を妨げず、unmountでF8を解除する', () => {
  const oldAdd = window.addEventListener;
  const oldRemove = window.removeEventListener;
  const listeners = new Set<EventListener>();
  window.addEventListener = ((type: string, fn: EventListener) => {
    if (type === 'keydown') listeners.add(fn);
  }) as typeof window.addEventListener;
  window.removeEventListener = ((type: string, fn: EventListener) => {
    if (type === 'keydown') listeners.delete(fn);
  }) as typeof window.removeEventListener;
  try {
    withHooks((flush, unmount) => {
      AppShell({
        terminal: testTerminals[1]!,
        title: '警報一覧',
        view: 'warnings',
        onViewChange: () => {},
        navigation: [],
        now: new Date('2026-10-04T00:00:00Z'),
        connection: { failed: false, lastSuccessAt: null },
        children: null,
        notifications: null,
      });
      flush();
      let prevented = 0;
      for (const key of ['F8', 'F7'])
        for (const listener of listeners)
          listener({ key, preventDefault: () => prevented++ } as unknown as Event);
      assert.equal(prevented, 0);
      assert.equal(listeners.size, 1);
      unmount();
      assert.equal(listeners.size, 0);
    });
  } finally {
    window.addEventListener = oldAdd;
    window.removeEventListener = oldRemove;
  }
});
