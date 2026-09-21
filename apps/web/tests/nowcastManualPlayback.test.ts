import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { buildNowcastCatalog } from '../src/map/nowcast/nowcastCatalog.ts';
import {
  usePlayback,
  MANUAL_INTENT_DEBOUNCE_MS,
  type UsePlaybackParams,
  type UsePlaybackResult,
} from '../src/map/nowcast/usePlayback.ts';
import {
  useDelayedFlag,
  SPINNER_SHOW_DELAY_MS,
  SPINNER_MIN_VISIBLE_MS,
} from '../src/map/nowcast/useDelayedFlag.ts';
import { createSampleNowcastResponse } from './fixtures/nowcastFixtures.ts';

// React 19 の内部 dispatcher をテスト用に使用 (useMonitoringUptime.test.ts と共通のパターン)
// @ts-expect-error React shared internals
const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

interface HookHarnessRunner<P, R> {
  readonly result: R;
  update(newProps: P): R;
  rerender(): R;
  unmount(): void;
}

function createHookHarness() {
  const hookStates: Array<{
    current?: unknown;
    val?: unknown;
    deps?: unknown[];
    cleanup?: () => void;
    fn?: unknown;
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
    useCallback: <T extends (...args: unknown[]) => unknown>(fn: T, deps?: unknown[]) => {
      const idx = hookIndex++;
      const prev = hookStates[idx];
      const hasChanged =
        !prev || !deps || !prev.deps || deps.some((d, i) => !Object.is(d, prev.deps![i]));
      if (hasChanged) {
        hookStates[idx] = { fn, deps };
        return fn;
      }
      return prev!.fn as T;
    },
    useMemo: <T>(fn: () => T, deps?: unknown[]) => {
      const idx = hookIndex++;
      const prev = hookStates[idx];
      const hasChanged =
        !prev || !deps || !prev.deps || deps.some((d, i) => !Object.is(d, prev.deps![i]));
      if (hasChanged) {
        const val = fn();
        hookStates[idx] = { val, deps };
        return val;
      }
      return prev!.val as T;
    },
  };

  return {
    render<P, R>(hookFn: (props: P) => R, initialProps: P): HookHarnessRunner<P, R> {
      let currentProps = initialProps;
      let latestResult: R;

      function run(): R {
        let loops = 0;
        do {
          loops++;
          if (loops > 50) {
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
        get result() {
          return latestResult;
        },
        update(newProps: P) {
          currentProps = newProps;
          return run();
        },
        rerender() {
          return run();
        },
        unmount() {
          for (const s of hookStates) {
            if (typeof s?.cleanup === 'function') {
              s.cleanup();
            }
          }
        },
      };
    },
  };
}

function mountPlaybackHarness(catalog = buildNowcastCatalog(createSampleNowcastResponse())) {
  const harness = createHookHarness();
  const runner = harness.render((p: UsePlaybackParams) => usePlayback(p), {
    catalog,
    terminalId: 'hkeagh01',
    controlStatus: 'normal',
    enabled: true,
  });

  return {
    get current(): UsePlaybackResult {
      return runner.result;
    },
    rerender() {
      runner.rerender();
    },
    unmount() {
      runner.unmount();
    },
  };
}

const EXPECTED_MANUAL_INTENT_DEBOUNCE_MS = 500;

test('【連打】「次へ」を連続5回呼ぶと、つまみ (intentFrameId) が握り潰されず+5コマ進むこと (§9.4.4, §11.4.1)', () => {
  const catalog = buildNowcastCatalog(createSampleNowcastResponse());
  const repFrames = catalog.frames.filter((f) => f.representative);
  assert.ok(repFrames.length >= 10, '代表コマが十分にあること');

  const harness = mountPlaybackHarness(catalog);
  try {
    // 先頭コマを選択
    const firstFrame = repFrames[0]!;
    harness.current.handleIntent({ type: 'select-frame', frameId: firstFrame.id });
    harness.rerender();
    assert.equal(harness.current.viewModel.intentFrameId, firstFrame.id);

    // swapSettled による読込完了を待たずに「次へ」を 5 回連続で呼ぶ (連打相当)
    harness.current.handleIntent({ type: 'next-frame' });
    harness.current.handleIntent({ type: 'next-frame' });
    harness.current.handleIntent({ type: 'next-frame' });
    harness.current.handleIntent({ type: 'next-frame' });
    harness.current.handleIntent({ type: 'next-frame' });

    harness.rerender();

    // 握り潰されず、intentFrameId が index 5 のコマに進んでいること！
    const expectedFrame = repFrames[5]!;
    assert.equal(
      harness.current.viewModel.intentFrameId,
      expectedFrame.id,
      '5連打で+5コマ進んでいること',
    );
  } finally {
    harness.unmount();
  }
});

test('【最終 intent のみ読込】5連打中の途中コマはデバウンスされ、最終コマのみ overlayFrame にセットされること (§9.4.4, §11.4.1)', async () => {
  const catalog = buildNowcastCatalog(createSampleNowcastResponse());
  const repFrames = catalog.frames.filter((f) => f.representative);
  const harness = mountPlaybackHarness(catalog);

  try {
    // 先頭コマを選択し、初期ロードを待つ
    const firstFrame = repFrames[0]!;
    harness.current.handleIntent({ type: 'select-frame', frameId: firstFrame.id });
    harness.rerender();

    // 250ms 待って先頭コマのデバウンスを確定させる
    await new Promise((r) => setTimeout(r, MANUAL_INTENT_DEBOUNCE_MS + 50));
    harness.rerender();
    assert.equal(harness.current.overlayFrame?.id, firstFrame.id);

    // 5 連打を連続実行
    harness.current.handleIntent({ type: 'next-frame' });
    harness.current.handleIntent({ type: 'next-frame' });
    harness.current.handleIntent({ type: 'next-frame' });
    harness.current.handleIntent({ type: 'next-frame' });
    harness.current.handleIntent({ type: 'next-frame' });
    harness.rerender();

    // 呼び出し直後 (50ms < 500ms): overlayFrame はまだ最終コマに変わっていない
    await new Promise((r) => setTimeout(r, 50));
    harness.rerender();
    assert.notEqual(
      harness.current.overlayFrame?.id,
      repFrames[5]!.id,
      'デバウンス中はまだ最終コマの要求が始まっていない',
    );

    // デバウンス完了 (500ms 経過後) を待つ
    await new Promise((r) => setTimeout(r, MANUAL_INTENT_DEBOUNCE_MS + 60));
    harness.rerender();

    // 最終コマ (index 5) のみ要求されていること
    assert.equal(harness.current.overlayFrame?.id, repFrames[5]!.id);
  } finally {
    harness.unmount();
  }
});

for (const operationIntervalMs of [
  EXPECTED_MANUAL_INTENT_DEBOUNCE_MS - 200,
  EXPECTED_MANUAL_INTENT_DEBOUNCE_MS - 100,
]) {
  test(`【間隔境界】${operationIntervalMs}ms 間隔の連続操作では最終コマだけが overlayFrame になること (§9.4.4, §11.4.1)`, async () => {
    const catalog = buildNowcastCatalog(createSampleNowcastResponse());
    const repFrames = catalog.frames.filter((f) => f.representative);
    const harness = mountPlaybackHarness(catalog);

    try {
      const initialFrame = repFrames[0]!;
      harness.current.handleIntent({ type: 'select-frame', frameId: initialFrame.id });
      harness.rerender();
      await new Promise((resolve) => setTimeout(resolve, MANUAL_INTENT_DEBOUNCE_MS + 50));
      harness.rerender();
      assert.equal(harness.current.overlayFrame?.id, initialFrame.id);

      const targets = [repFrames[1]!, repFrames[2]!, repFrames[3]!];
      for (const target of targets) {
        harness.current.handleIntent({ type: 'select-frame', frameId: target.id });
        harness.rerender();
        await new Promise((resolve) => setTimeout(resolve, operationIntervalMs));
        harness.rerender();
        assert.equal(
          harness.current.overlayFrame?.id,
          initialFrame.id,
          `${operationIntervalMs}ms 間隔の連続操作中は中間コマを要求しないこと`,
        );
      }

      await new Promise((resolve) =>
        setTimeout(resolve, MANUAL_INTENT_DEBOUNCE_MS - operationIntervalMs + 50),
      );
      harness.rerender();
      assert.equal(harness.current.overlayFrame?.id, targets.at(-1)!.id);
    } finally {
      harness.unmount();
    }
  });
}

test('【間隔境界】600ms 間隔の操作では各コマが順に overlayFrame になること (§9.4.4, §11.4.1)', async () => {
  const catalog = buildNowcastCatalog(createSampleNowcastResponse());
  const repFrames = catalog.frames.filter((f) => f.representative);
  const harness = mountPlaybackHarness(catalog);
  const operationIntervalMs = EXPECTED_MANUAL_INTENT_DEBOUNCE_MS + 100;

  try {
    const targets = [repFrames[1]!, repFrames[2]!, repFrames[3]!];
    for (const target of targets) {
      harness.current.handleIntent({ type: 'select-frame', frameId: target.id });
      harness.rerender();
      await new Promise((resolve) => setTimeout(resolve, operationIntervalMs));
      harness.rerender();
      assert.equal(
        harness.current.overlayFrame?.id,
        target.id,
        `${operationIntervalMs}ms 間隔では操作ごとに読み込まれること`,
      );
    }
  } finally {
    harness.unmount();
  }
});

test('【ドラッグ抑止】ドラッグ中に連続操作された場合、操作停止までタイル要求が抑止されること (§9.4.4, §11.4.1)', async () => {
  const catalog = buildNowcastCatalog(createSampleNowcastResponse());
  const repFrames = catalog.frames.filter((f) => f.representative);
  const harness = mountPlaybackHarness(catalog);

  try {
    const initialFrame = repFrames[0]!;
    harness.current.handleIntent({ type: 'select-frame', frameId: initialFrame.id });
    harness.rerender();
    await new Promise((r) => setTimeout(r, MANUAL_INTENT_DEBOUNCE_MS + 50));
    harness.rerender();
    assert.equal(harness.current.overlayFrame?.id, initialFrame.id);

    // スライダードラッグを模した高頻度操作 (40ms 間隔で次々と select-frame)
    const dragTargets = [
      repFrames[1]!,
      repFrames[2]!,
      repFrames[3]!,
      repFrames[4]!,
      repFrames[10]!,
    ];
    for (const target of dragTargets) {
      harness.current.handleIntent({ type: 'select-frame', frameId: target.id });
      harness.rerender();
      await new Promise((r) => setTimeout(r, 40));
      harness.rerender();
      // ドラッグ中はデバウンスが再設定され続けるため、overlayFrame は初期コマのまま
      assert.equal(harness.current.overlayFrame?.id, initialFrame.id);
    }

    // ドラッグ終了後、デバウンス (500ms) 経過を待つ
    await new Promise((r) => setTimeout(r, MANUAL_INTENT_DEBOUNCE_MS + 60));
    harness.rerender();

    // 最終ドラッグ位置 (index 10) のみ要求される
    assert.equal(harness.current.overlayFrame?.id, repFrames[10]!.id);
  } finally {
    harness.unmount();
  }
});

test('【表示日時の据え置き】読込中は表示日時ラベルが前のコマのまま据え置かれること (§9.4.3, §11.4.1)', async () => {
  const catalog = buildNowcastCatalog(createSampleNowcastResponse());
  const repFrames = catalog.frames.filter((f) => f.representative);
  const harness = mountPlaybackHarness(catalog);

  try {
    // コマ0 を確定させる (swapSettled を通知)
    const frame0 = repFrames[0]!;
    harness.current.handleIntent({ type: 'select-frame', frameId: frame0.id });
    harness.rerender();
    await new Promise((r) => setTimeout(r, MANUAL_INTENT_DEBOUNCE_MS + 20));
    harness.rerender();
    harness.current.handleSwapSettled({ frameId: frame0.id, complete: true });
    harness.rerender();

    const label0 = harness.current.viewModel.selectedFrameLabel;
    assert.ok(label0.length > 0);
    assert.equal(harness.current.viewModel.settledFrameId, frame0.id);

    // 次のコマへ進める (intent を移動)
    const frame1 = repFrames[1]!;
    harness.current.handleIntent({ type: 'select-frame', frameId: frame1.id });
    harness.rerender();

    // つまみ (intent) は frame1 に移動したが、画像読込完了前なので表示日時は frame0 のまま据え置き！
    assert.equal(harness.current.viewModel.intentFrameId, frame1.id);
    assert.equal(harness.current.viewModel.settledFrameId, frame0.id);
    assert.equal(harness.current.viewModel.selectedFrameLabel, label0);
  } finally {
    harness.unmount();
  }
});

test('【収束】読込完了またはタイムアウトで intent と settled が収束すること (§9.4.5, §11.4.1)', () => {
  const catalog = buildNowcastCatalog(createSampleNowcastResponse());
  const repFrames = catalog.frames.filter((f) => f.representative);
  const harness = mountPlaybackHarness(catalog);

  try {
    const targetFrame = repFrames[2]!;
    harness.current.handleIntent({ type: 'select-frame', frameId: targetFrame.id });
    harness.rerender();

    assert.equal(harness.current.viewModel.intentFrameId, targetFrame.id);
    assert.notEqual(harness.current.viewModel.settledFrameId, targetFrame.id);

    // タイムアウト (complete: false) でも一致していれば収束する
    harness.current.handleSwapSettled({ frameId: targetFrame.id, complete: false });
    harness.rerender();

    assert.equal(harness.current.viewModel.settledFrameId, targetFrame.id);
    assert.equal(
      harness.current.viewModel.intentFrameId,
      harness.current.viewModel.settledFrameId,
      'タイムアウトでも収束すること',
    );
  } finally {
    harness.unmount();
  }
});

test('【古い完了の無視】読込中にさらに操作した場合、古い完了通知で表示日時が巻き戻らないこと (§9.4.5-2, §11.4.1)', async () => {
  const catalog = buildNowcastCatalog(createSampleNowcastResponse());
  const repFrames = catalog.frames.filter((f) => f.representative);
  const harness = mountPlaybackHarness(catalog);

  try {
    const frameA = repFrames[0]!;
    const frameB = repFrames[1]!;
    const frameC = repFrames[2]!;

    // コマA を確定
    harness.current.handleIntent({ type: 'select-frame', frameId: frameA.id });
    harness.rerender();
    await new Promise((r) => setTimeout(r, MANUAL_INTENT_DEBOUNCE_MS + 20));
    harness.rerender();
    harness.current.handleSwapSettled({ frameId: frameA.id, complete: true });
    harness.rerender();
    assert.equal(harness.current.viewModel.settledFrameId, frameA.id);

    // コマB を経由してすぐに コマC へ操作を進める
    harness.current.handleIntent({ type: 'select-frame', frameId: frameB.id });
    harness.current.handleIntent({ type: 'select-frame', frameId: frameC.id });
    harness.rerender();
    assert.equal(harness.current.viewModel.intentFrameId, frameC.id);

    // 遅れて届いた古い コマB の完了通知
    harness.current.handleSwapSettled({ frameId: frameB.id, complete: true });
    harness.rerender();

    // 巻き戻らず、コマA のまま保持されること！
    assert.equal(
      harness.current.viewModel.settledFrameId,
      frameA.id,
      '古い完了通知で settledFrameId が巻き戻らないこと',
    );

    // 現在の intent である コマC の完了通知が届く
    harness.current.handleSwapSettled({ frameId: frameC.id, complete: true });
    harness.rerender();

    // 正しく コマC へ進む
    assert.equal(harness.current.viewModel.settledFrameId, frameC.id);
  } finally {
    harness.unmount();
  }
});

test('【再生との整合】手動操作で再生が停止すること (§9.4.6, §11.4.1)', () => {
  const catalog = buildNowcastCatalog(createSampleNowcastResponse());
  const harness = mountPlaybackHarness(catalog);

  try {
    // 再生開始
    harness.current.handleIntent({ type: 'toggle-play' });
    harness.rerender();
    assert.equal(harness.current.viewModel.playing, true);

    // 手動操作を行うと再生が停止する
    harness.current.handleIntent({ type: 'next-frame' });
    harness.rerender();
    assert.equal(harness.current.viewModel.playing, false);
  } finally {
    harness.unmount();
  }
});

test('【スピナー】遅延 250ms と最小表示時間 400ms によるちらつき防止 (§9.4.8, §11.4.1)', async () => {
  const harness = createHookHarness();
  const runner = harness.render((p: { loading: boolean }) => useDelayedFlag(p.loading), {
    loading: false,
  });

  try {
    assert.equal(runner.result, false, '初期状態は非表示');

    // 1. キャッシュ命中で 100ms で完了するシナリオ (250ms 未満)
    runner.update({ loading: true });
    await new Promise((r) => setTimeout(r, 100)); // 100ms < 250ms
    runner.rerender();

    runner.update({ loading: false });
    await new Promise((r) => setTimeout(r, 200));
    runner.rerender();

    // 250ms 未満で終わったため、表示されない (false)
    assert.equal(runner.result, false, '遅延未満では表示されないこと');

    // 2. 300ms かかる読込シナリオ (250ms 超過で点灯)
    runner.update({ loading: true });
    await new Promise((r) => setTimeout(r, 300)); // 300ms > 250ms
    runner.rerender();

    assert.equal(runner.result, true, '250ms超過で表示されること');

    // 読込完了したが、最小表示時間 (400ms) を満たすまで表示が維持される
    runner.update({ loading: false });
    await new Promise((r) => setTimeout(r, 100)); // 完了後 100ms
    runner.rerender();
    assert.equal(runner.result, true, '最小表示時間内は消えないこと');

    // 400ms の残り (約 350ms) を待つ
    await new Promise((r) => setTimeout(r, 400));
    runner.rerender();
    assert.equal(runner.result, false, '最小表示時間経過後に消灯すること');
  } finally {
    runner.unmount();
  }
});

test('【スピナー定数】遅延250msと最小表示時間400msが設計書通り定義されていること (§9.4.8)', () => {
  assert.equal(SPINNER_SHOW_DELAY_MS, 250);
  assert.equal(SPINNER_MIN_VISIBLE_MS, 400);
  assert.equal(MANUAL_INTENT_DEBOUNCE_MS, EXPECTED_MANUAL_INTENT_DEBOUNCE_MS);
});
