import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { flushSync } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TileCatalogResult } from '../src/api/tileCatalogClient.ts';
import {
  useTileCatalogPolling,
  TILE_CATALOG_POLL_INTERVAL_MS,
  TILE_CATALOG_BACKOFF_MS,
  type TileCatalogState,
} from '../src/map/tiles/useTileCatalogPolling.ts';

const el = React.createElement;

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

interface RecordedTimer {
  readonly id: number;
  readonly delay: number;
  readonly callback: () => void;
  cleared: boolean;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

function failure(): TileCatalogResult<string> {
  return { ok: false, failure: { kind: 'network' } };
}

function success(value: string): TileCatalogResult<string> {
  return { ok: true, value };
}

async function installHarness(options: { readonly strictMode?: boolean } = {}) {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const listeners = new Set<() => void>();
  let visibilityState: 'visible' | 'hidden' = 'visible';
  const documentForClient = {
    addEventListener(type: string, listener: () => void) {
      if (type === 'visibilitychange') listeners.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      if (type === 'visibilitychange') listeners.delete(listener);
    },
    createElement() {
      return { style: {}, setAttribute() {}, removeAttribute() {} };
    },
    get visibilityState() {
      return visibilityState;
    },
    documentElement: null as unknown as object,
    defaultView: null as unknown as typeof globalThis.window,
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
  documentForClient.defaultView = globalThis.window;
  (globalThis as unknown as { document: typeof documentForClient }).document = documentForClient;
  Object.assign(globalThis.window, { HTMLIFrameElement: class {} });

  const timers: RecordedTimer[] = [];
  let nextTimerId = 1;
  const applicationDelays = new Set([60_000, 120_000, 240_000, 300_000]);
  globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    if (!applicationDelays.has(delay ?? 0)) {
      return originalSetTimeout(callback, delay);
    }
    const timer: RecordedTimer = {
      id: nextTimerId++,
      delay: delay ?? 0,
      callback: () => {
        timer.cleared = true;
        callback();
      },
      cleared: false,
    };
    timers.push(timer);
    return timer.id as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
    const timer = timers.find((candidate) => candidate.id === (id as unknown as number));
    if (timer !== undefined) {
      timer.cleared = true;
      return;
    }
    originalClearTimeout(id);
  }) as typeof clearTimeout;

  const requests: {
    readonly deferred: Deferred<TileCatalogResult<string>>;
    readonly signal: AbortSignal;
  }[] = [];
  const states: TileCatalogState<string>[] = [];
  let enabled = true;
  let resetKey = 'A';
  const load = (signal: AbortSignal) => {
    const deferred = createDeferred<TileCatalogResult<string>>();
    requests.push({ deferred, signal });
    return deferred.promise;
  };
  function TestComponent() {
    const state = useTileCatalogPolling({ load, resetKey, enabled });
    states.push(state);
    return null;
  }
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(element as unknown as Element);
  const render = () => {
    const child = el(TestComponent);
    flushSync(() => root.render(options.strictMode ? el(React.StrictMode, null, child) : child));
  };
  const activeTimers = () => timers.filter((timer) => !timer.cleared);
  const setVisibility = (value: 'visible' | 'hidden') => {
    visibilityState = value;
    for (const listener of [...listeners]) listener();
  };
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    root.unmount();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    (globalThis as unknown as { document: typeof originalDocument }).document = originalDocument;
    (globalThis as unknown as { window: typeof originalWindow }).window = originalWindow;
  };

  return {
    activeTimers,
    cleanup,
    render,
    requests,
    setEnabled(value: boolean) {
      enabled = value;
      render();
    },
    setResetKey(value: string) {
      resetKey = value;
      render();
    },
    setVisibility,
    states,
    timers,
  };
}

test('useTileCatalogPolling: ポーリング間隔が 60 秒固定であること (§5.2, §11.6)', () => {
  assert.equal(TILE_CATALOG_POLL_INTERVAL_MS, 60_000);
  assert.deepEqual(TILE_CATALOG_BACKOFF_MS, [60_000, 120_000, 240_000, 300_000]);
});

test('useTileCatalogPolling: 初期状態は status="loading" であること', () => {
  let captured: TileCatalogState<string> | null = null;
  function TestComponent() {
    captured = useTileCatalogPolling<string>({
      load: async () => success('data'),
      resetKey: 'key1',
      enabled: true,
    });
    return null;
  }

  renderToStaticMarkup(el(TestComponent));
  assert.deepEqual(captured, { status: 'loading' });
});

test('useTileCatalogPolling: 未解決取得を無効化した後の成功と失敗を採用しないこと (§11.5.1)', async () => {
  for (const completion of ['resolve', 'reject'] as const) {
    const harness = await installHarness();
    try {
      harness.render();
      assert.equal(harness.requests.length, 1);
      await flushEffects();
      harness.setEnabled(false);
      assert.equal(harness.requests[0].signal.aborted, true);
      const statesAfterDisable = [...harness.states];
      if (completion === 'resolve') {
        harness.requests[0].deferred.resolve(success('late'));
      } else {
        harness.requests[0].deferred.reject(new Error('late'));
      }
      await flushEffects();
      assert.deepEqual(harness.states, statesAfterDisable);
      assert.deepEqual(harness.activeTimers(), []);
      assert.equal(harness.requests.length, 1);
    } finally {
      harness.cleanup();
    }
  }
});

test('useTileCatalogPolling: resetKey の旧取得は新世代の状態とタイマーを変えないこと (§11.5.1)', async () => {
  const harness = await installHarness();
  try {
    harness.render();
    harness.setResetKey('B');
    assert.equal(harness.requests[0].signal.aborted, true);
    harness.requests[1].deferred.resolve(success('B'));
    await flushEffects();
    const bTimer = harness.activeTimers()[0];
    const ready = harness.states.at(-1);
    assert.ok(ready?.status === 'ready');
    assert.equal(ready.catalog, 'B');
    assert.deepEqual(
      harness.activeTimers().map(({ id, delay }) => ({ id, delay })),
      [{ id: bTimer.id, delay: 60_000 }],
    );
    harness.requests[0].deferred.resolve(failure());
    await flushEffects();
    assert.deepEqual(
      harness.activeTimers().map(({ id, delay }) => ({ id, delay })),
      [{ id: bTimer.id, delay: 60_000 }],
    );
    assert.deepEqual(harness.states.at(-1), ready);
  } finally {
    harness.cleanup();
  }
});

test('useTileCatalogPolling: 無効から再有効化した世代だけが更新し、旧タイマー callback を拒否すること (§11.5.1)', async () => {
  const harness = await installHarness();
  try {
    harness.render();
    harness.requests[0].deferred.resolve(success('first'));
    await flushEffects();
    const oldTimer = harness.activeTimers()[0];
    harness.setEnabled(false);
    harness.setEnabled(true);
    assert.equal(harness.requests.length, 2);
    oldTimer.callback();
    assert.equal(harness.requests.length, 2);
    harness.requests[0].deferred.resolve(success('old'));
    harness.requests[1].deferred.resolve(success('new'));
    await flushEffects();
    assert.equal(harness.states.at(-1)?.status, 'ready');
    assert.deepEqual(
      harness.activeTimers().map((timer) => timer.delay),
      [60_000],
    );
    assert.equal(harness.activeTimers()[0].id, harness.timers.at(-1)?.id);
  } finally {
    harness.cleanup();
  }
});

test('useTileCatalogPolling: 不可視中の完了を無視し、可視復帰で一度だけ再開すること (§11.5.1)', async () => {
  const harness = await installHarness();
  try {
    harness.render();
    await flushEffects();
    harness.setVisibility('hidden');
    assert.equal(harness.requests[0].signal.aborted, true);
    const statesAfterHidden = [...harness.states];
    harness.requests[0].deferred.resolve(success('hidden'));
    await flushEffects();
    assert.deepEqual(harness.states, statesAfterHidden);
    assert.deepEqual(harness.activeTimers(), []);
    harness.setVisibility('visible');
    assert.equal(harness.requests.length, 2);
    harness.setVisibility('visible');
    assert.equal(harness.requests.length, 2);
    harness.requests[1].deferred.resolve(success('visible'));
    await flushEffects();
    assert.deepEqual(
      harness.activeTimers().map((timer) => timer.delay),
      [60_000],
    );
  } finally {
    harness.cleanup();
  }
});

test('useTileCatalogPolling: 正常系、stale、指数バックオフ、成功後の復帰を維持すること (§11.5.1)', async () => {
  const harness = await installHarness();
  try {
    harness.render();
    harness.requests[0].deferred.resolve(success('catalog'));
    await flushEffects();
    const ready = harness.states.at(-1);
    assert.ok(ready?.status === 'ready');
    const expectedDelays = [60_000, 60_000, 120_000, 240_000, 300_000];
    for (const expectedDelay of expectedDelays) {
      const timer = harness.activeTimers()[0];
      assert.equal(timer.delay, expectedDelay);
      timer.callback();
      const request = harness.requests.at(-1);
      assert.ok(request);
      request.deferred.resolve(failure());
      await flushEffects();
      assert.deepEqual(harness.states.at(-1), {
        status: 'stale',
        catalog: 'catalog',
        fetchedAt: ready.fetchedAt,
        failure: { kind: 'network' },
      });
    }
    const recoveryTimer = harness.activeTimers()[0];
    assert.equal(recoveryTimer.delay, 300_000);
    recoveryTimer.callback();
    const recovery = harness.requests.at(-1);
    assert.ok(recovery);
    recovery.deferred.resolve(success('recovered'));
    await flushEffects();
    assert.deepEqual(
      harness.activeTimers().map((timer) => timer.delay),
      [60_000],
    );
    assert.equal(harness.states.at(-1)?.status, 'ready');
  } finally {
    harness.cleanup();
  }
});

test('useTileCatalogPolling: 成功前の失敗は failed になること (§11.5.1)', async () => {
  const harness = await installHarness();
  try {
    harness.render();
    harness.requests[0].deferred.resolve(failure());
    await flushEffects();
    assert.deepEqual(harness.states.at(-1), { status: 'failed', failure: { kind: 'network' } });
    assert.deepEqual(
      harness.activeTimers().map((timer) => timer.delay),
      [60_000],
    );
  } finally {
    harness.cleanup();
  }
});

test('useTileCatalogPolling: StrictMode の旧 setup は状態とタイマーに干渉しないこと (§11.5.1)', async () => {
  const harness = await installHarness({ strictMode: true });
  try {
    harness.render();
    assert.equal(harness.requests.length, 2);
    assert.equal(harness.requests[0].signal.aborted, true);
    harness.requests[0].deferred.resolve(success('old'));
    harness.requests[1].deferred.resolve(success('current'));
    await flushEffects();
    assert.equal(harness.states.at(-1)?.status, 'ready');
    assert.deepEqual(
      harness.activeTimers().map((timer) => timer.delay),
      [60_000],
    );
    harness.cleanup();
    assert.deepEqual(harness.activeTimers(), []);
  } finally {
    harness.cleanup();
  }
});
