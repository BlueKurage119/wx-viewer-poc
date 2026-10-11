import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { flushSync } from 'react-dom';
import { webcrypto } from 'node:crypto';
import type { NotificationDeltaItem } from '@wx-viewer-poc/shared';
import { useNotificationFeed } from '../src/notifications/useNotificationFeed.ts';
import { useHeaderBuzzer } from '../src/notifications/useHeaderBuzzer.ts';
import {
  isVisibleForTerminal,
  notificationChimeLevel,
} from '../src/notifications/notificationStore.ts';
import { AppShell } from '../src/shell/AppShell.tsx';
import { testTerminals } from './venueConfigPreload.ts';

// 最小DOMへ実React rootをmountし、hookのeffect・cleanupを実行する。
interface Timer {
  readonly callback: () => void;
  readonly delay: number;
  readonly deadline: number;
  cleared: boolean;
}
interface Environment {
  terminalId: string;
  clock: number;
  readonly batches: NotificationDeltaItem[][];
}
let environment: Environment | null = null;
const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  assert.ok(environment);
  const url = new URL(String(input), 'http://test.invalid');
  const common = {
    status: 'ready',
    terminalId: environment.terminalId,
    venueId: 'east',
    serverGenerationId: environment.terminalId,
    generatedAt: '2026-10-11T00:00:00.000Z',
    cursor: '0',
  };
  const body = url.pathname.endsWith('/startup')
    ? {
        ...common,
        terminalId: JSON.parse(String(init?.body)).terminalId,
        session: { kind: 'startup', firstInquiredAt: '2026-10-11T00:00:00.000Z' },
        warningClaimed: true,
        notifications: [],
      }
    : {
        ...common,
        origin: url.searchParams.get('origin'),
        skippedCount: 0,
        notifications:
          url.searchParams.get('origin') === 'system' ? (environment.batches.shift() ?? []) : [],
      };
  return { status: 200, json: async () => body } as Response;
};
let nextTerminal = 0;
function notice(
  id: string,
  category: 'warning' | 'question' | 'emergency' = 'warning',
  automatic = true,
): NotificationDeltaItem {
  return {
    notificationId: id,
    sequence: 1,
    category,
    origin: 'system',
    detectionContext: 'normal',
    changeType: 'test',
    sourceType: 'test',
    sourceVersion: null,
    targets: [{ kind: 'equipment', codeType: 'test', code: '1', name: '検証' }],
    occurredAt: '2026-10-11T00:00:00.000Z',
    detectedAt: '2026-10-11T00:00:00.000Z',
    relatedRefs: [],
    isTraining: true,
    venueScope: 'venue',
    output: {
      ackRequired: true,
      summary: id,
      messageDefinition: automatic
        ? { id: 'system-weather-acquisition-report-stale', version: '2' }
        : null,
    },
  } as NotificationDeltaItem;
}
async function flushEffects() {
  await act(async () => {
    for (let n = 0; n < 12; n++) await Promise.resolve();
  });
}
async function mountFeed(initial: NotificationDeltaItem[] = []) {
  const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const original = {
    document: globalThis.document,
    fetch: window.fetch,
    crypto: window.crypto,
    HTMLIFrameElement: window.HTMLIFrameElement,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    Audio: globalThis.Audio,
    add: window.addEventListener,
    remove: window.removeEventListener,
    act: actEnvironment.IS_REACT_ACT_ENVIRONMENT,
  };
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  environment = { terminalId: `hook-test-${++nextTerminal}`, clock: 0, batches: [initial] };
  const timers: Timer[] = [];
  const documentListeners = new Map<string, Set<() => void>>();
  const windowListeners = new Map<string, Set<(event: unknown) => void>>();
  const documentForClient = {
    addEventListener: (type: string, fn: () => void) => {
      if (!documentListeners.has(type)) documentListeners.set(type, new Set());
      documentListeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => documentListeners.get(type)?.delete(fn),
    createElement: () => ({ style: {}, setAttribute() {}, removeAttribute() {} }),
    visibilityState: 'visible',
    documentElement: null as unknown as object,
    defaultView: window,
    activeElement: null,
  };
  const element = {
    nodeType: 1,
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: documentForClient,
    addEventListener() {},
    removeEventListener() {},
  };
  documentForClient.documentElement = element;
  (globalThis as unknown as { document: typeof documentForClient }).document = documentForClient;
  Object.assign(window, { HTMLIFrameElement: class {}, crypto: webcrypto, fetch: fetchMock });
  window.addEventListener = ((type: string, fn: (event: unknown) => void) => {
    if (!windowListeners.has(type)) windowListeners.set(type, new Set());
    windowListeners.get(type)!.add(fn);
  }) as typeof window.addEventListener;
  window.removeEventListener = ((type: string, fn: (event: unknown) => void) =>
    windowListeners.get(type)?.delete(fn)) as typeof window.removeEventListener;
  globalThis.setTimeout = ((callback: () => void, delay = 0) => {
    const timer = { callback, delay, deadline: environment!.clock + delay, cleared: false };
    timers.push(timer);
    return timer as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
    const timer = timers.find((item) => item === (id as unknown));
    if (timer) timer.cleared = true;
  }) as typeof clearTimeout;
  const plays: string[] = [];
  let pauses = 0;
  globalThis.Audio = class {
    loop = false;
    currentTime = 0;
    constructor(readonly src: string) {}
    play() {
      plays.push(this.src);
      return Promise.resolve();
    }
    pause() {
      pauses++;
    }
  } as unknown as typeof Audio;
  let feed!: ReturnType<typeof useNotificationFeed>;
  let buzzer!: ReturnType<typeof useHeaderBuzzer>;
  let renders = 0;
  const confirmations: string[][] = [];
  function Component() {
    renders++;
    buzzer = useHeaderBuzzer();
    feed = useNotificationFeed({
      terminalId: environment!.terminalId,
      mode: 'K',
      nowMs: environment!.clock,
      clock: () => environment!.clock,
      preferences: {
        schemaVersion: 1,
        autoConfirmMessageDefinitionIds: ['system-weather-acquisition-report-stale'],
      },
      onChimeRequest: buzzer.request,
      onConfirmed: (state, keys) => {
        confirmations.push([...keys]);
        for (const key of keys) {
          const item = state.items.find((item) => item.feedKey === key);
          if (item && isVisibleForTerminal(item, 'K'))
            buzzer.confirmLevel(notificationChimeLevel(state, item));
        }
      },
    });
    // AppShellの実effectが登録するF8を、通知hookと実ブザーへ接続する。
    AppShell({
      terminal: testTerminals[1]!,
      title: '検証',
      view: 'warnings',
      onViewChange() {},
      navigation: [],
      now: new Date(),
      connection: { failed: false, lastSuccessAt: null },
      buzzer: buzzer.state,
      onStopBuzzer: buzzer.state.category ? buzzer.stop : undefined,
      notifications: null,
      children: null,
    });
    return null;
  }
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(element as unknown as Element);
  let mounted = true;
  act(() => flushSync(() => root.render(React.createElement(Component))));
  await flushEffects();
  return {
    timers,
    plays,
    confirmations,
    get feed() {
      return feed;
    },
    get buzzer() {
      return buzzer;
    },
    get pauses() {
      return pauses;
    },
    get renders() {
      return renders;
    },
    async advance(now: number, runTimers = true) {
      environment!.clock = now;
      if (runTimers) {
        await act(async () => {
          for (const timer of [...timers])
            if (!timer.cleared && timer.deadline <= now) {
              timer.cleared = true;
              timer.callback();
            }
        });
        await flushEffects();
      }
    },
    async poll(items: NotificationDeltaItem[], now: number) {
      environment!.clock = now;
      environment!.batches.push(items);
      await act(async () => {
        for (const timer of [...timers])
          if (!timer.cleared && timer.delay === 15000) {
            timer.cleared = true;
            timer.callback();
          }
      });
      await flushEffects();
    },
    async visibility() {
      await act(async () => {
        for (const listener of documentListeners.get('visibilitychange') ?? []) listener();
      });
      await flushEffects();
    },
    async confirm(key: string) {
      await act(async () => feed.confirm(key));
      await flushEffects();
    },
    async f8() {
      let prevented = 0;
      await act(async () => {
        for (const listener of windowListeners.get('keydown') ?? [])
          listener({
            key: 'F8',
            preventDefault: () => {
              prevented++;
            },
          });
      });
      await flushEffects();
      return prevented;
    },
    async switchTerminal(items: NotificationDeltaItem[]) {
      environment!.terminalId = `hook-test-${++nextTerminal}`;
      environment!.batches.push(items);
      act(() => flushSync(() => root.render(React.createElement(Component))));
      await flushEffects();
    },
    async oldCallback(timer: Timer) {
      await act(async () => timer.callback());
      await flushEffects();
    },
    unmount() {
      if (mounted) {
        act(() => root.unmount());
        mounted = false;
      }
    },
    cleanup() {
      if (mounted) {
        act(() => root.unmount());
        mounted = false;
      }
      globalThis.setTimeout = original.setTimeout;
      globalThis.clearTimeout = original.clearTimeout;
      globalThis.Audio = original.Audio;
      (globalThis as unknown as { document: typeof original.document }).document =
        original.document;
      Object.assign(window, {
        fetch: original.fetch,
        crypto: original.crypto,
        HTMLIFrameElement: original.HTMLIFrameElement,
        addEventListener: original.add,
        removeEventListener: original.remove,
      });
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = original.act;
      environment = null;
    },
  };
}

test('#271 実hook: 4999ms未確認、5000ms満了で鳴動停止し状態を更新する', async () => {
  const h = await mountFeed([notice('a')]);
  try {
    assert.deepEqual(h.plays, ['/audio/2.wav']);
    assert.equal(h.timers.filter((t) => !t.cleared && t.delay === 5000).length, 1);
    await h.advance(4999);
    assert.deepEqual(h.feed.state.confirmedFeedKeys, new Set());
    await h.advance(5000);
    assert.deepEqual(h.feed.state.confirmedFeedKeys, new Set(['delta:a']));
    assert.deepEqual(h.confirmations, [['delta:a']]);
    assert.equal(h.buzzer.state.level, null);
    assert.equal(h.pauses, 1);
  } finally {
    h.cleanup();
  }
});
test('#271 実hook: タイマー抑制後のvisibility復帰は期限超過全件を確認する', async () => {
  const h = await mountFeed([notice('a'), notice('b')]);
  try {
    await h.advance(9000, false);
    assert.deepEqual(h.feed.state.confirmedFeedKeys, new Set());
    await h.visibility();
    assert.deepEqual(h.feed.state.confirmedFeedKeys, new Set(['delta:a', 'delta:b']));
    assert.deepEqual(h.confirmations, [['delta:a', 'delta:b']]);
    assert.equal(h.buzzer.state.level, null);
    assert.deepEqual(h.plays, ['/audio/2.wav']);
  } finally {
    h.cleanup();
  }
});
test('#271 実hook: terminal切替で旧タイマーを解除し同名feedKeyを誤確認しない', async () => {
  const h = await mountFeed([notice('same')]);
  try {
    const old = h.timers.find((t) => !t.cleared && t.delay === 5000)!;
    await h.advance(2000, false);
    await h.switchTerminal([notice('same')]);
    assert.equal(old.cleared, true);
    await h.advance(8000, false);
    await h.oldCallback(old);
    assert.deepEqual(h.feed.state.confirmedFeedKeys, new Set());
    assert.equal(
      h.feed.state.warningPresentationByFeedKey['delta:same']?.autoConfirmDeadlineMs,
      7000,
    );
    await h.advance(8000);
    assert.deepEqual(h.feed.state.confirmedFeedKeys, new Set(['delta:same']));
  } finally {
    h.cleanup();
  }
});
test('#271 実hook: unmount後の旧callbackは状態・鳴動・確認通知を更新しない', async () => {
  const h = await mountFeed([notice('a')]);
  try {
    const timer = h.timers.find((t) => !t.cleared && t.delay === 5000)!;
    h.unmount();
    assert.equal(timer.cleared, true);
    const state = h.feed.state;
    const renders = h.renders;
    await h.advance(6000, false);
    await h.oldCallback(timer);
    assert.equal(h.feed.state, state);
    assert.equal(h.renders, renders);
    assert.deepEqual(h.confirmations, []);
    assert.deepEqual(h.plays, ['/audio/2.wav']);
  } finally {
    h.cleanup();
  }
});
test('#271 実hook: 連続受信と手動確認競合でref/reducerと期限を失わない', async () => {
  const h = await mountFeed([notice('a')]);
  try {
    await h.poll([notice('b')], 2000);
    assert.deepEqual(Object.keys(h.feed.state.warningPresentationByFeedKey).sort(), [
      'delta:a',
      'delta:b',
    ]);
    assert.equal(h.feed.state.warningPresentationByFeedKey['delta:a']?.autoConfirmDeadlineMs, 5000);
    assert.equal(h.feed.state.warningPresentationByFeedKey['delta:b']?.autoConfirmDeadlineMs, 7000);
    await h.advance(5000, false);
    await h.confirm('delta:b');
    assert.deepEqual(h.feed.state.confirmedFeedKeys, new Set(['delta:a', 'delta:b']));
    assert.deepEqual(h.confirmations, [['delta:a'], ['delta:b']]);
    assert.equal(
      h.timers.some((t) => !t.cleared && t.delay < 15000),
      false,
    );
    await h.advance(9000);
    assert.deepEqual(h.confirmations, [['delta:a'], ['delta:b']]);
  } finally {
    h.cleanup();
  }
});
test('#271 実hook+F8: 停止後の自動確認/復帰は再鳴動せず新着Lv.3だけが鳴る', async () => {
  const h = await mountFeed([notice('a'), notice('old-emergency', 'emergency')]);
  try {
    assert.deepEqual(h.plays, ['/audio/5.wav']);
    assert.equal(await h.f8(), 1);
    assert.equal(h.buzzer.state.level, null);
    await h.advance(5000);
    await h.visibility();
    assert.deepEqual(h.plays, ['/audio/5.wav']);
    await h.poll([notice('new', 'warning', false)], 6000);
    assert.deepEqual(h.plays, ['/audio/5.wav', '/audio/3.wav']);
    await h.confirm('delta:old-emergency');
    assert.equal(h.buzzer.state.level, 3);
    await h.confirm('delta:new');
    assert.equal(h.buzzer.state.level, null);
    assert.deepEqual(
      h.feed.state.confirmedFeedKeys,
      new Set(['delta:a', 'delta:old-emergency', 'delta:new']),
    );
  } finally {
    h.cleanup();
  }
});
