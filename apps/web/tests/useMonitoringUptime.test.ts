import './setupEnv.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import React from 'react';
import type { MonitoringStatusResponse } from '@wx-viewer-poc/shared';
import { useMonitoringUptime } from '../src/monitoring/useMonitoringUptime.ts';
import { normalMonitoringResponseFixture } from './monitoringFixture.ts';

// React 19 の内部 dispatcher をテスト用に差し替える
// @ts-expect-error React shared internals
const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

interface IntervalTimer {
  id: number;
  fn: () => void;
  ms: number;
}

function createHookHarness() {
  let perfTime = 10_000;
  const originalPerfNow = performance.now;
  performance.now = () => perfTime;

  const intervals: IntervalTimer[] = [];
  let nextIntervalId = 1;

  const originalSetInterval = window.setInterval;
  const originalClearInterval = window.clearInterval;

  window.setInterval = ((fn: () => void, ms = 0): number => {
    const id = nextIntervalId++;
    intervals.push({ id, fn, ms });
    return id;
  }) as unknown as typeof window.setInterval;

  window.clearInterval = ((id: number): void => {
    const idx = intervals.findIndex((t) => t.id === id);
    if (idx !== -1) intervals.splice(idx, 1);
  }) as unknown as typeof window.clearInterval;

  let hookStates: Array<{
    current?: unknown;
    val?: unknown;
    deps?: unknown[];
    cleanup?: () => void;
  }> = [];
  let hookIndex = 0;
  let isDirty = false;
  let pendingEffects: Array<() => void> = [];

  const dispatcher = {
    useRef: <T>(initial: T) => {
      const idx = hookIndex++;
      if (hookStates[idx] === undefined) {
        hookStates[idx] = { current: initial };
      }
      return hookStates[idx] as { current: T };
    },
    useState: <T>(initial: T | (() => T)) => {
      const idx = hookIndex++;
      if (hookStates[idx] === undefined) {
        const val = typeof initial === 'function' ? (initial as () => T)() : initial;
        hookStates[idx] = { val };
      }
      const setState = (next: T | ((prev: T) => T)) => {
        const prevVal = hookStates[idx]!.val as T;
        const nextVal = typeof next === 'function' ? (next as (p: T) => T)(prevVal) : next;
        if (!Object.is(prevVal, nextVal)) {
          hookStates[idx]!.val = nextVal;
          isDirty = true;
        }
      };
      return [hookStates[idx]!.val as T, setState] as const;
    },
    useEffect: (fn: () => (() => void) | void, deps?: unknown[]) => {
      const idx = hookIndex++;
      const prev = hookStates[idx];
      const hasChanged =
        !prev ||
        !deps ||
        !prev.deps ||
        deps.length !== prev.deps.length ||
        deps.some((d, i) => !Object.is(d, prev.deps![i]));

      if (hasChanged) {
        pendingEffects.push(() => {
          if (typeof prev?.cleanup === 'function') {
            prev.cleanup();
          }
          const cleanup = fn();
          hookStates[idx] = {
            deps,
            cleanup: typeof cleanup === 'function' ? cleanup : undefined,
          };
        });
      }
    },
  };

  function render<P, R>(hookFn: (props: P) => R, initialProps: P) {
    let currentProps = initialProps;
    let latestResult: R;

    function run(): R {
      let loops = 0;
      do {
        loops++;
        if (loops > 20) {
          throw new Error('Too many re-renders in test hook');
        }
        isDirty = false;
        hookIndex = 0;
        internals.H = dispatcher;
        latestResult = hookFn(currentProps);

        const effectsToRun = pendingEffects;
        pendingEffects = [];
        for (const effect of effectsToRun) {
          effect();
        }
      } while (isDirty);

      return latestResult;
    }

    run();

    return {
      getResult: () => latestResult,
      rerender: (newProps: P) => {
        currentProps = newProps;
        return run();
      },
      advanceTime: (ms: number) => {
        perfTime += ms;
        for (const timer of [...intervals]) {
          const times = Math.max(1, Math.floor(ms / (timer.ms || 1000)));
          for (let i = 0; i < times; i++) {
            timer.fn();
            run();
          }
        }
      },
      unmount: () => {
        for (const item of hookStates) {
          if (typeof item?.cleanup === 'function') {
            item.cleanup();
          }
        }
        hookStates = [];
        intervals.length = 0;
        pendingEffects = [];
      },
    };
  }

  function cleanup() {
    performance.now = originalPerfNow;
    window.setInterval = originalSetInterval;
    window.clearInterval = originalClearInterval;
    internals.H = null;
  }

  return { render, cleanup };
}

function createMockResponse(overrides: {
  serverStartedAt?: string;
  generatedAt?: string;
  serverGenerationId?: string;
}): MonitoringStatusResponse {
  return {
    ...normalMonitoringResponseFixture,
    serverStartedAt: overrides.serverStartedAt ?? '2026-09-20T05:00:00.000Z',
    generatedAt: overrides.generatedAt ?? '2026-09-20T05:01:00.000Z',
    serverGenerationId: overrides.serverGenerationId ?? 'gen-mock-1',
  };
}

describe('useMonitoringUptime: サーバー運転時間の計測フック', () => {
  it('data が null のときは null を返し、データ受信後に初期運転秒数を算出する', () => {
    const harness = createHookHarness();
    try {
      const h = harness.render(
        (d: MonitoringStatusResponse | null) => useMonitoringUptime(d),
        null,
      );
      assert.equal(h.getResult(), null);

      // 60秒稼働しているレスポンスを渡す
      const res = createMockResponse({
        serverStartedAt: '2026-09-20T05:00:00.000Z',
        generatedAt: '2026-09-20T05:01:00.000Z',
      });
      h.rerender(res);
      assert.equal(h.getResult(), 60);

      h.unmount();
    } finally {
      harness.cleanup();
    }
  });

  it('単調増加クロック（performance.now）に従い、1秒ごとに運転時間がカウントアップする', () => {
    const harness = createHookHarness();
    try {
      const res = createMockResponse({
        serverStartedAt: '2026-09-20T05:00:00.000Z',
        generatedAt: '2026-09-20T05:01:00.000Z', // 60秒
      });
      const h = harness.render((d: MonitoringStatusResponse | null) => useMonitoringUptime(d), res);
      assert.equal(h.getResult(), 60);

      // 1秒進める
      h.advanceTime(1000);
      assert.equal(h.getResult(), 61);

      // さらに2秒進める
      h.advanceTime(2000);
      assert.equal(h.getResult(), 63);

      h.unmount();
    } finally {
      harness.cleanup();
    }
  });

  it('【指摘1対策】API応答遅延により古い generatedAt を受信しても、直前の推定運転時間を下回らず巻き戻らない', () => {
    const harness = createHookHarness();
    try {
      // 初期状態: 60秒
      const res1 = createMockResponse({
        serverStartedAt: '2026-09-20T05:00:00.000Z',
        generatedAt: '2026-09-20T05:01:00.000Z',
        serverGenerationId: 'gen-same',
      });
      const h = harness.render(
        (d: MonitoringStatusResponse | null) => useMonitoringUptime(d),
        res1,
      );
      assert.equal(h.getResult(), 60);

      // 5秒経過してクライアント上は 65秒 に達する
      h.advanceTime(5000);
      assert.equal(h.getResult(), 65);

      // 回線遅延等で、サーバーが 63秒時点（生成時刻 05:01:03）で生成した応答が届いたとする
      const resDelayed = createMockResponse({
        serverStartedAt: '2026-09-20T05:00:00.000Z',
        generatedAt: '2026-09-20T05:01:03.000Z', // 63秒（直前の 65秒 より小さい）
        serverGenerationId: 'gen-same',
      });
      h.rerender(resDelayed);

      // 巻き戻らず、直前の 65秒 を維持する
      assert.equal(h.getResult(), 65);

      // その後タイマーが進むと 66秒 にカウントアップする
      h.advanceTime(1000);
      assert.equal(h.getResult(), 66);

      h.unmount();
    } finally {
      harness.cleanup();
    }
  });

  it('サーバーの時間がクライアントの推定より進んでいた場合は速やかに追従する', () => {
    const harness = createHookHarness();
    try {
      const res1 = createMockResponse({
        serverStartedAt: '2026-09-20T05:00:00.000Z',
        generatedAt: '2026-09-20T05:01:00.000Z',
        serverGenerationId: 'gen-same',
      });
      const h = harness.render(
        (d: MonitoringStatusResponse | null) => useMonitoringUptime(d),
        res1,
      );
      assert.equal(h.getResult(), 60);

      // 5秒経過してクライアント上は 65秒
      h.advanceTime(5000);
      assert.equal(h.getResult(), 65);

      // サーバー応答が 68秒 だった場合、最新値（68秒）に追従する
      const resAhead = createMockResponse({
        serverStartedAt: '2026-09-20T05:00:00.000Z',
        generatedAt: '2026-09-20T05:01:08.000Z',
        serverGenerationId: 'gen-same',
      });
      h.rerender(resAhead);
      assert.equal(h.getResult(), 68);

      h.unmount();
    } finally {
      harness.cleanup();
    }
  });

  it('サーバー再起動時（serverGenerationId 変更）は直前の推定値を引き継がず新サーバーの稼働秒数にリセットされる', () => {
    const harness = createHookHarness();
    try {
      const resOldServer = createMockResponse({
        serverStartedAt: '2026-09-20T05:00:00.000Z',
        generatedAt: '2026-09-20T05:05:00.000Z', // 300秒
        serverGenerationId: 'gen-old',
      });
      const h = harness.render(
        (d: MonitoringStatusResponse | null) => useMonitoringUptime(d),
        resOldServer,
      );
      assert.equal(h.getResult(), 300);

      // サーバー再起動: 新 generationId で稼働2秒の応答を受信
      const resNewServer = createMockResponse({
        serverStartedAt: '2026-09-20T05:05:00.000Z',
        generatedAt: '2026-09-20T05:05:02.000Z', // 2秒
        serverGenerationId: 'gen-new',
      });
      h.rerender(resNewServer);

      // 300秒に引っ張られず、2秒にリセットされること
      assert.equal(h.getResult(), 2);

      h.unmount();
    } finally {
      harness.cleanup();
    }
  });

  it('【指摘2対策】端末の壁時計（Date.now）が手動変更やNTP補正でジャンプしても、単調増加クロックにより狂わず進む', () => {
    const harness = createHookHarness();
    const originalDateNow = Date.now;
    let fakeDateNow = 1_700_000_000_000;
    Date.now = () => fakeDateNow;

    try {
      const res = createMockResponse({
        serverStartedAt: '2026-09-20T05:00:00.000Z',
        generatedAt: '2026-09-20T05:01:00.000Z', // 60秒
      });
      const h = harness.render((d: MonitoringStatusResponse | null) => useMonitoringUptime(d), res);
      assert.equal(h.getResult(), 60);

      // 端末の時計が手動で1時間進められた（+3600秒）
      fakeDateNow += 3600 * 1000;

      // しかし実時間（performance.now）は1秒しか進んでいない
      h.advanceTime(1000);

      // 運転時間は壁時計のジャンプに影響されず、61秒になること
      assert.equal(h.getResult(), 61);

      // 端末の時計が1時間戻された（-3600秒）
      fakeDateNow -= 3600 * 1000;

      // 実時間でさらに1秒進む
      h.advanceTime(1000);

      // 運転時間は停止せず、正常に 62秒 にカウントアップされること
      assert.equal(h.getResult(), 62);

      h.unmount();
    } finally {
      Date.now = originalDateNow;
      harness.cleanup();
    }
  });
});
