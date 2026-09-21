import './setupEnv.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import React from 'react';
import { normalMonitoringResponseFixture } from './monitoringFixture.ts';
import {
  useMonitoringStatus,
  type MonitoringLoadState,
} from '../src/monitoring/useMonitoringStatus.ts';

// React 19 の内部 dispatcher をテスト用に差し替える
// @ts-expect-error React shared internals
const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface FakeTimer {
  id: number;
  fn: () => void;
  delay: number;
}

let activeFetchHandler: (...args: unknown[]) => Promise<Response> = () =>
  Promise.reject(new Error('No fetch handler configured'));

// window.fetch を常に activeFetchHandler へ委譲する
(window as unknown as { fetch: typeof window.fetch }).fetch = (
  ...args: Parameters<typeof window.fetch>
) => activeFetchHandler(...args);

function createTestHarness() {
  const timers: FakeTimer[] = [];
  let nextTimerId = 1;

  const fakeSetTimeout = (fn: () => void, delay = 0): number => {
    const id = nextTimerId++;
    timers.push({ id, fn, delay });
    return id;
  };
  const fakeClearTimeout = (id: number): void => {
    const idx = timers.findIndex((t) => t.id === id);
    if (idx !== -1) timers.splice(idx, 1);
  };

  const tick = async (ms: number): Promise<void> => {
    const eligible = timers.filter((t) => t.delay <= ms);
    for (const t of eligible) {
      fakeClearTimeout(t.id);
      t.fn();
    }
    // microtask をフラッシュ
    await new Promise((r) => setTimeout(r, 0));
  };

  (window as unknown as { setTimeout: typeof fakeSetTimeout }).setTimeout = fakeSetTimeout;
  (window as unknown as { clearTimeout: typeof fakeClearTimeout }).clearTimeout = fakeClearTimeout;

  const docListeners = new Map<string, () => void>();
  (
    document as unknown as { addEventListener: (t: string, f: () => void) => void }
  ).addEventListener = (type, fn) => docListeners.set(type, fn);
  (document as unknown as { removeEventListener: (t: string) => void }).removeEventListener = (
    type,
  ) => docListeners.delete(type);
  (document as unknown as { visibilityState: string }).visibilityState = 'visible';

  function triggerVisibilityChange(state: 'visible' | 'hidden'): void {
    (document as unknown as { visibilityState: string }).visibilityState = state;
    docListeners.get('visibilitychange')?.();
  }

  function setFetchHandler(handler: (...args: unknown[]) => Promise<Response>): void {
    activeFetchHandler = handler;
  }

  function renderHook(hook: () => MonitoringLoadState) {
    let currentState: MonitoringLoadState;
    let effectCleanup: (() => void) | undefined;
    const history: MonitoringLoadState[] = [];

    const dispatcher = {
      useState: (initial: MonitoringLoadState) => {
        if (currentState === undefined) {
          currentState = initial;
          history.push(initial);
        }
        const setState = (
          next: MonitoringLoadState | ((prev: MonitoringLoadState) => MonitoringLoadState),
        ) => {
          currentState = typeof next === 'function' ? next(currentState) : next;
          history.push(currentState);
        };
        return [currentState, setState];
      },
      useEffect: (fn: () => (() => void) | void) => {
        if (!effectCleanup) {
          const cleanup = fn();
          if (typeof cleanup === 'function') {
            effectCleanup = cleanup;
          }
        }
      },
    };

    internals.H = dispatcher;
    hook();

    return {
      getCurrentState: () => currentState,
      getHistory: () => [...history],
      unmount: () => {
        effectCleanup?.();
      },
    };
  }

  const cleanup = () => {
    timers.length = 0;
    docListeners.clear();
    activeFetchHandler = () => Promise.reject(new Error('No fetch handler configured'));
    internals.H = null;
  };

  return { tick, triggerVisibilityChange, setFetchHandler, renderHook, cleanup };
}

describe('Issue #187: useMonitoringStatus 通信失敗状態の継続維持と復旧検証', () => {
  it('監視APIリクエスト失敗後、次のリクエスト送信中（未完了・保留中）も phase: "failed" が維持され、成功で初めて ready に復帰する', async () => {
    const harness = createTestHarness();
    const pendingRequests: Deferred<Response>[] = [];

    harness.setFetchHandler(() => {
      const def = createDeferred<Response>();
      pendingRequests.push(def);
      return def.promise;
    });

    try {
      // 1. 初回リクエスト開始
      const h = harness.renderHook(() => useMonitoringStatus('term-retry-fail-1'));
      assert.equal(h.getCurrentState().phase, 'loading');
      assert.equal(pendingRequests.length, 1);

      // 1回目のリクエストを失敗させる
      pendingRequests[0]!.reject(new Error('Network error'));
      await new Promise((r) => setTimeout(r, 0));

      // 状態が failed になる
      assert.equal(h.getCurrentState().phase, 'failed');

      // 2. 次の定期更新（5秒後）の load() が開始される
      await harness.tick(5000);
      assert.equal(pendingRequests.length, 2);

      // リクエスト送信中（保留中）も phase: 'failed' が維持されていること！
      assert.equal(h.getCurrentState().phase, 'failed');

      // 3. 2回目のリクエストが成功する
      pendingRequests[1]!.resolve(
        new Response(
          JSON.stringify({ ...normalMonitoringResponseFixture, terminalId: 'term-retry-fail-1' }),
          { status: 200 },
        ),
      );
      await new Promise((r) => setTimeout(r, 0));

      // 成功した時点で初めて phase: 'ready' に遷移し、受信異常が解除される
      assert.equal(h.getCurrentState().phase, 'ready');
      assert.equal(
        (h.getCurrentState() as { data: { terminalId: string } }).data.terminalId,
        'term-retry-fail-1',
      );

      h.unmount();
    } finally {
      harness.cleanup();
    }
  });

  it('正常稼働時（初回成功後、まだエラーが起きていないとき）の再取得中は phase: "refreshing" に遷移する', async () => {
    const harness = createTestHarness();
    const pendingRequests: Deferred<Response>[] = [];

    harness.setFetchHandler(() => {
      const def = createDeferred<Response>();
      pendingRequests.push(def);
      return def.promise;
    });

    try {
      // 1. 初回リクエスト開始
      const h = harness.renderHook(() => useMonitoringStatus('term-normal-refresh-1'));
      assert.equal(h.getCurrentState().phase, 'loading');
      assert.equal(pendingRequests.length, 1);

      // 1回目のリクエストが成功する
      pendingRequests[0]!.resolve(
        new Response(
          JSON.stringify({
            ...normalMonitoringResponseFixture,
            terminalId: 'term-normal-refresh-1',
          }),
          { status: 200 },
        ),
      );
      await new Promise((r) => setTimeout(r, 0));

      assert.equal(h.getCurrentState().phase, 'ready');

      // 2. 正常稼働時の次回定期更新（5秒後）が開始される
      await harness.tick(5000);
      assert.equal(pendingRequests.length, 2);

      // 正常稼働時（hasFailed === false）は、再取得中に phase: 'refreshing' に遷移すること！
      assert.equal(h.getCurrentState().phase, 'refreshing');
      assert.equal(
        (h.getCurrentState() as { data: { terminalId: string } }).data.terminalId,
        'term-normal-refresh-1',
      );

      // 2回目のリクエストが完了すると再度 ready になる
      pendingRequests[1]!.resolve(
        new Response(
          JSON.stringify({
            ...normalMonitoringResponseFixture,
            terminalId: 'term-normal-refresh-1',
          }),
          { status: 200 },
        ),
      );
      await new Promise((r) => setTimeout(r, 0));

      assert.equal(h.getCurrentState().phase, 'ready');

      h.unmount();
    } finally {
      harness.cleanup();
    }
  });

  it('監視APIリクエスト失敗後、タブ非表示から復帰（visibilitychange）した際の再取得中も phase: "failed" が維持される', async () => {
    const harness = createTestHarness();
    const pendingRequests: Deferred<Response>[] = [];

    harness.setFetchHandler(() => {
      const def = createDeferred<Response>();
      pendingRequests.push(def);
      return def.promise;
    });

    try {
      // 1. 初回リクエスト開始
      const h = harness.renderHook(() => useMonitoringStatus('term-tab-restore-1'));
      assert.equal(pendingRequests.length, 1);

      // 1回目を失敗させる
      pendingRequests[0]!.reject(new Error('Network error'));
      await new Promise((r) => setTimeout(r, 0));

      assert.equal(h.getCurrentState().phase, 'failed');

      // 2. タブを非表示にする
      harness.triggerVisibilityChange('hidden');

      // 3. タブを再表示する（visibilitychange: visible）
      harness.triggerVisibilityChange('visible');
      assert.equal(pendingRequests.length, 2);

      // タブ復帰後のリクエスト送信中（保留中）も phase: 'failed' が維持されていること！
      assert.equal(h.getCurrentState().phase, 'failed');

      // 4. 復帰後リクエストが成功すると ready に遷移する
      pendingRequests[1]!.resolve(
        new Response(
          JSON.stringify({ ...normalMonitoringResponseFixture, terminalId: 'term-tab-restore-1' }),
          { status: 200 },
        ),
      );
      await new Promise((r) => setTimeout(r, 0));

      assert.equal(h.getCurrentState().phase, 'ready');

      h.unmount();
    } finally {
      harness.cleanup();
    }
  });
});
