import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { buildNowcastCatalog } from '../src/map/nowcast/nowcastCatalog.ts';
import {
  usePlayback,
  MANUAL_INTENT_DEBOUNCE_MS,
  type UsePlaybackResult,
} from '../src/map/nowcast/usePlayback.ts';
import {
  NowcastLoadingSpinner,
  SPINNER_SHOW_DELAY_MS,
  SPINNER_MIN_VISIBLE_MS,
} from '../src/map/nowcast/NowcastLoadingSpinner.tsx';
import { createSampleNowcastResponse } from './fixtures/nowcastFixtures.ts';

const el = React.createElement;

function mountHookHarness(catalog = buildNowcastCatalog(createSampleNowcastResponse())) {
  let latestResult!: UsePlaybackResult;
  let updateListeners: (() => void)[] = [];
  let mountResolver: (() => void) | null = null;
  const mountPromise = new Promise<void>((r) => {
    mountResolver = r;
  });

  function HookTester() {
    latestResult = usePlayback({
      catalog,
      terminalId: 'hkeagh01',
      controlStatus: 'normal',
      enabled: true,
    });
    React.useEffect(() => {
      if (mountResolver) {
        mountResolver();
        mountResolver = null;
      }
    });
    for (const fn of updateListeners) {
      fn();
    }
    return null;
  }

  const container = document.createElement('div');
  const root = createRoot(container as unknown as Element);
  root.render(el(HookTester));

  return {
    get current() {
      return latestResult;
    },
    async waitForMount() {
      await mountPromise;
      await new Promise((r) => setTimeout(r, 20));
    },
    async waitForUpdate(timeoutMs = 100) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          updateListeners = updateListeners.filter((l) => l !== cb);
          resolve();
        }, timeoutMs);
        const cb = () => {
          clearTimeout(timer);
          updateListeners = updateListeners.filter((l) => l !== cb);
          resolve();
        };
        updateListeners.push(cb);
      });
    },
    unmount() {
      root.unmount();
    },
  };
}

test('【連打】「次へ」を連続5回呼ぶと、つまみ (intentFrameId) が握り潰されず+5コマ進むこと (§9.4.4, §11.4.1)', async () => {
  const catalog = buildNowcastCatalog(createSampleNowcastResponse());
  const repFrames = catalog.frames.filter((f) => f.representative);
  assert.ok(repFrames.length >= 10, '代表コマが十分にあること');

  const harness = mountHookHarness(catalog);
  try {
    await harness.waitForMount();

    // 先頭コマを選択
    const firstFrame = repFrames[0]!;
    harness.current.handleIntent({ type: 'select-frame', frameId: firstFrame.id });
    await harness.waitForUpdate();
    assert.equal(harness.current.viewModel.intentFrameId, firstFrame.id);

    // swapSettled による読込完了を待たずに「次へ」を 5 回連続で呼ぶ (連打相当)
    harness.current.handleIntent({ type: 'next-frame' });
    harness.current.handleIntent({ type: 'next-frame' });
    harness.current.handleIntent({ type: 'next-frame' });
    harness.current.handleIntent({ type: 'next-frame' });
    harness.current.handleIntent({ type: 'next-frame' });

    await harness.waitForUpdate();

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
  const harness = mountHookHarness(catalog);

  try {
    await harness.waitForMount();

    // 先頭コマを選択し、初期ロードを待つ
    const firstFrame = repFrames[0]!;
    harness.current.handleIntent({ type: 'select-frame', frameId: firstFrame.id });
    // 250ms 待って先頭コマのデバウンスを確定させる
    await new Promise((r) => setTimeout(r, MANUAL_INTENT_DEBOUNCE_MS + 50));
    assert.equal(harness.current.overlayFrame?.id, firstFrame.id);

    // 5 連打を連続実行
    harness.current.handleIntent({ type: 'next-frame' });
    harness.current.handleIntent({ type: 'next-frame' });
    harness.current.handleIntent({ type: 'next-frame' });
    harness.current.handleIntent({ type: 'next-frame' });
    harness.current.handleIntent({ type: 'next-frame' });

    // 呼び出し直後 (50ms < 200ms): overlayFrame はまだ最終コマに変わっていない
    await new Promise((r) => setTimeout(r, 50));
    assert.notEqual(
      harness.current.overlayFrame?.id,
      repFrames[5]!.id,
      'デバウンス中はまだ最終コマの要求が始まっていない',
    );

    // デバウンス完了 (200ms 経過後) を待つ
    await new Promise((r) => setTimeout(r, MANUAL_INTENT_DEBOUNCE_MS + 60));

    // 最終コマ (index 5) のみ要求されていること
    assert.equal(harness.current.overlayFrame?.id, repFrames[5]!.id);
  } finally {
    harness.unmount();
  }
});

test('【ドラッグ抑止】ドラッグ中に連続操作された場合、操作停止までタイル要求が抑止されること (§9.4.4, §11.4.1)', async () => {
  const catalog = buildNowcastCatalog(createSampleNowcastResponse());
  const repFrames = catalog.frames.filter((f) => f.representative);
  const harness = mountHookHarness(catalog);

  try {
    await harness.waitForMount();

    const initialFrame = repFrames[0]!;
    harness.current.handleIntent({ type: 'select-frame', frameId: initialFrame.id });
    await new Promise((r) => setTimeout(r, MANUAL_INTENT_DEBOUNCE_MS + 50));
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
      await new Promise((r) => setTimeout(r, 40));
      // ドラッグ中はデバウンスが再設定され続けるため、overlayFrame は初期コマのまま
      assert.equal(harness.current.overlayFrame?.id, initialFrame.id);
    }

    // ドラッグ終了後、デバウンス (200ms) 経過を待つ
    await new Promise((r) => setTimeout(r, MANUAL_INTENT_DEBOUNCE_MS + 60));

    // 最終ドラッグ位置 (index 10) のみ要求される
    assert.equal(harness.current.overlayFrame?.id, repFrames[10]!.id);
  } finally {
    harness.unmount();
  }
});

test('【表示日時の据え置き】読込中は表示日時ラベルが前のコマのまま据え置かれること (§9.4.3, §11.4.1)', async () => {
  const catalog = buildNowcastCatalog(createSampleNowcastResponse());
  const repFrames = catalog.frames.filter((f) => f.representative);
  const harness = mountHookHarness(catalog);

  try {
    await harness.waitForMount();

    // コマ0 を確定させる (swapSettled を通知)
    const frame0 = repFrames[0]!;
    harness.current.handleIntent({ type: 'select-frame', frameId: frame0.id });
    await new Promise((r) => setTimeout(r, MANUAL_INTENT_DEBOUNCE_MS + 20));
    harness.current.handleSwapSettled({ frameId: frame0.id, complete: true });
    await harness.waitForUpdate();

    const label0 = harness.current.viewModel.selectedFrameLabel;
    assert.ok(label0.length > 0);
    assert.equal(harness.current.viewModel.settledFrameId, frame0.id);

    // 次のコマへ進める (intent を移動)
    const frame1 = repFrames[1]!;
    harness.current.handleIntent({ type: 'select-frame', frameId: frame1.id });
    await harness.waitForUpdate();

    // つまみ (intent) は frame1 に移動したが、画像読込完了前なので表示日時は frame0 のまま据え置き！
    assert.equal(harness.current.viewModel.intentFrameId, frame1.id);
    assert.equal(harness.current.viewModel.settledFrameId, frame0.id);
    assert.equal(harness.current.viewModel.selectedFrameLabel, label0);
  } finally {
    harness.unmount();
  }
});

test('【収束】読込完了またはタイムアウトで intent と settled が収束すること (§9.4.5, §11.4.1)', async () => {
  const catalog = buildNowcastCatalog(createSampleNowcastResponse());
  const repFrames = catalog.frames.filter((f) => f.representative);
  const harness = mountHookHarness(catalog);

  try {
    await harness.waitForMount();

    const targetFrame = repFrames[2]!;
    harness.current.handleIntent({ type: 'select-frame', frameId: targetFrame.id });
    await harness.waitForUpdate();

    assert.equal(harness.current.viewModel.intentFrameId, targetFrame.id);
    assert.notEqual(harness.current.viewModel.settledFrameId, targetFrame.id);

    // タイムアウト (complete: false) でも一致していれば収束する
    harness.current.handleSwapSettled({ frameId: targetFrame.id, complete: false });
    await harness.waitForUpdate();

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
  const harness = mountHookHarness(catalog);

  try {
    await harness.waitForMount();

    const frameA = repFrames[0]!;
    const frameB = repFrames[1]!;
    const frameC = repFrames[2]!;

    // コマA を確定
    harness.current.handleIntent({ type: 'select-frame', frameId: frameA.id });
    await new Promise((r) => setTimeout(r, MANUAL_INTENT_DEBOUNCE_MS + 20));
    harness.current.handleSwapSettled({ frameId: frameA.id, complete: true });
    await harness.waitForUpdate();
    assert.equal(harness.current.viewModel.settledFrameId, frameA.id);

    // コマB を経由してすぐに コマC へ操作を進める
    harness.current.handleIntent({ type: 'select-frame', frameId: frameB.id });
    harness.current.handleIntent({ type: 'select-frame', frameId: frameC.id });
    await harness.waitForUpdate();
    assert.equal(harness.current.viewModel.intentFrameId, frameC.id);

    // 遅れて届いた古い コマB の完了通知
    harness.current.handleSwapSettled({ frameId: frameB.id, complete: true });
    await harness.waitForUpdate();

    // 巻き戻らず、コマA のまま保持されること！
    assert.equal(
      harness.current.viewModel.settledFrameId,
      frameA.id,
      '古い完了通知で settledFrameId が巻き戻らないこと',
    );

    // 現在の intent である コマC の完了通知が届く
    harness.current.handleSwapSettled({ frameId: frameC.id, complete: true });
    await harness.waitForUpdate();

    // 正しく コマC へ進む
    assert.equal(harness.current.viewModel.settledFrameId, frameC.id);
  } finally {
    harness.unmount();
  }
});

test('【再生との整合】手動操作で再生が停止すること (§9.4.6, §11.4.1)', async () => {
  const catalog = buildNowcastCatalog(createSampleNowcastResponse());
  const harness = mountHookHarness(catalog);

  try {
    await harness.waitForMount();

    // 再生開始
    harness.current.handleIntent({ type: 'toggle-play' });
    await harness.waitForUpdate();
    assert.equal(harness.current.viewModel.playing, true);

    // 手動操作を行うと再生が停止する
    harness.current.handleIntent({ type: 'next-frame' });
    await harness.waitForUpdate();
    assert.equal(harness.current.viewModel.playing, false);
  } finally {
    harness.unmount();
  }
});

test('【スピナー】遅延 250ms と最小表示時間 400ms によるちらつき防止 (§9.4.8, §11.4.1)', async () => {
  const initialLoading = false;
  let updateLoading: ((val: boolean) => void) | null = null;

  function SpinnerTester() {
    const [loading, setLoading] = React.useState(initialLoading);
    updateLoading = setLoading;
    return el(NowcastLoadingSpinner, { loading });
  }

  const container = document.createElement('div') as unknown as {
    children: { style: { visibility?: string } }[];
  };
  const root = createRoot(container as unknown as Element);

  try {
    root.render(el(SpinnerTester));
    await new Promise((r) => setTimeout(r, 30));

    // 1. キャッシュ命中で 100ms で完了するシナリオ (250ms 未満)
    updateLoading!(true);
    await new Promise((r) => setTimeout(r, 100)); // 100ms < 250ms

    updateLoading!(false);
    await new Promise((r) => setTimeout(r, 200));

    // 250ms 未満で終わったため、表示されない (visibility: hidden)
    const spinnerElement = container.children[0];
    assert.ok(spinnerElement, 'スピナーコンテナ要素が存在すること');
    assert.equal(spinnerElement.style.visibility, 'hidden', '遅延未満では表示されないこと');

    // 2. 300ms かかる読込シナリオ (250ms 超過で点灯)
    updateLoading!(true);
    await new Promise((r) => setTimeout(r, 300)); // 300ms > 250ms

    assert.equal(spinnerElement.style.visibility, 'visible', '250ms超過で表示されること');

    // 読込完了したが、最小表示時間 (400ms) を満たすまで表示が維持される
    updateLoading!(false);
    await new Promise((r) => setTimeout(r, 100)); // 完了後 100ms
    assert.equal(spinnerElement.style.visibility, 'visible', '最小表示時間内は消えないこと');

    // 400ms の残り (約 350ms) を待つ
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(spinnerElement.style.visibility, 'hidden', '最小表示時間経過後に消灯すること');
  } finally {
    root.unmount();
  }
});

test('【スピナー定数】遅延250msと最小表示時間400msが設計書通り定義されていること (§9.4.8)', () => {
  assert.equal(SPINNER_SHOW_DELAY_MS, 250);
  assert.equal(SPINNER_MIN_VISIBLE_MS, 400);
  assert.equal(MANUAL_INTENT_DEBOUNCE_MS, 200);
});
