import './setupEnv.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildKikikuruCatalog } from '../src/map/kikikuru/kikikuruCatalog';
import {
  getKikikuruTileErrorCount,
  getVisibleKikikuruFrame,
  isCurrentKikikuruSwap,
  useKikikuruLayerState,
  type UseKikikuruLayerStateResult,
  type KikikuruDisplayFrame,
} from '../src/map/kikikuru/useKikikuruLayerState';
import { createSampleKikikuruResponse } from './fixtures/kikikuruFixtures';

const el = React.createElement;

test('useKikikuruLayerState: 差替え完了前は最新画像を要求しつつカード時刻を確定しないこと (§8.2, §11.7)', () => {
  const response = createSampleKikikuruResponse();
  const catalog = buildKikikuruCatalog(response);

  let captured: UseKikikuruLayerStateResult | null = null;
  function TestComponent() {
    const result = useKikikuruLayerState({
      catalog,
      currentLayerId: 'kikikuru-heavyrain',
      terminalId: 'hkeagh01',
      controlStatus: 'normal',
      enabled: true,
    });
    captured = result;
    return null;
  }

  renderToStaticMarkup(el(TestComponent));

  assert.ok(captured);
  const result: UseKikikuruLayerStateResult = captured;

  // 最新コマ (2026-09-15T03:00:00.000Z) を要求するが、旧画像と新時刻を混在させない。
  assert.equal(result.viewModel.selectedFrameId, null);
  assert.equal(result.overlayFrame?.id, 'kikikuru-heavyrain:2026-09-15T03:00:00.000Z');
  assert.equal(result.viewModel.playing, false);
  assert.equal(result.viewModel.latestAvailable, false);
});

test('useKikikuruLayerState: 差替え完了まで旧画像のカード・凡例を維持し、旧種別通知を受理しないこと', async () => {
  const documentForClient = globalThis.document as unknown as {
    addEventListener: () => void;
    removeEventListener: () => void;
    createElement: () => { setAttribute: () => void; removeAttribute: () => void };
    defaultView: typeof globalThis.window;
    documentElement: object;
    activeElement: null;
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
  Object.assign(documentForClient, {
    addEventListener() {},
    removeEventListener() {},
    createElement() {
      return { style: {}, setAttribute() {}, removeAttribute() {} };
    },
    defaultView: globalThis.window,
    documentElement: element,
    activeElement: null,
  });
  Object.assign(globalThis.window, { HTMLIFrameElement: class {} });

  const { createRoot } = await import('react-dom/client');
  const { flushSync } = await import('react-dom');
  const catalog = buildKikikuruCatalog(createSampleKikikuruResponse());
  let currentLayerId: 'kikikuru-heavyrain' | 'kikikuru-inund' = 'kikikuru-heavyrain';
  let captured: UseKikikuruLayerStateResult | null = null;
  function TestComponent() {
    captured = useKikikuruLayerState({
      catalog,
      currentLayerId,
      terminalId: 'hkeagh01',
      controlStatus: 'normal',
      enabled: true,
    });
    return null;
  }

  const root = createRoot(element as unknown as Element);
  try {
    flushSync(() => root.render(el(TestComponent)));
    assert.ok(captured);
    flushSync(() =>
      captured?.handleSwapSettled({ frameId: captured?.overlayFrame?.id ?? '', complete: true }),
    );
    assert.equal(captured?.viewModel.layerLabel, 'キキクル（大雨）');
    assert.equal(captured?.viewModel.selectedFrameLabel, '09/15 12:00');
    flushSync(() => captured?.handleTileError(captured?.overlayFrame?.id ?? ''));
    assert.equal(captured?.statusMessage, '一部のタイルを取得できていません');

    currentLayerId = 'kikikuru-inund';
    flushSync(() => root.render(el(TestComponent)));
    assert.equal(captured?.overlayFrame?.id, 'kikikuru-inund:2026-09-15T03:00:00.000Z');
    assert.equal(captured?.viewModel.layerLabel, 'キキクル（大雨）');
    assert.equal(captured?.displayedLayerId, 'kikikuru-heavyrain');
    assert.equal(captured?.statusMessage, null, '種別境界で旧タイルの失敗を持ち越さない');

    flushSync(() =>
      captured?.handleSwapSettled({
        frameId: 'kikikuru-heavyrain:2026-09-15T03:00:00.000Z',
        complete: true,
      }),
    );
    assert.equal(captured?.displayedLayerId, 'kikikuru-heavyrain');

    flushSync(() => captured?.handleTileError(captured?.overlayFrame?.id ?? ''));
    assert.equal(captured?.statusMessage, '一部のタイルを取得できていません');
    flushSync(() =>
      captured?.handleSwapSettled({ frameId: captured?.overlayFrame?.id ?? '', complete: false }),
    );
    assert.equal(captured?.viewModel.layerLabel, 'キキクル（浸水）');
    assert.equal(captured?.displayedLayerId, 'kikikuru-inund');
    assert.equal(
      captured?.statusMessage,
      null,
      '正常・timeout を問わない差替え完了で失敗を解消する',
    );
  } finally {
    root.unmount();
  }
});

test('キキクル: 現在の差替え通知だけが時刻を確定し、種別切替中は旧画像の種別・時刻を維持すること', () => {
  const oldFrame: KikikuruDisplayFrame = {
    id: '2026-09-15T02:50:00.000Z',
    swapId: 'kikikuru-heavyrain:2026-09-15T02:50:00.000Z',
    layerId: 'kikikuru-heavyrain',
    label: '09/15 11:50',
  };
  const targetFrame: KikikuruDisplayFrame = {
    id: '2026-09-15T03:00:00.000Z',
    swapId: 'kikikuru-inund:2026-09-15T03:00:00.000Z',
    layerId: 'kikikuru-inund',
    label: '09/15 12:00',
  };

  assert.equal(
    isCurrentKikikuruSwap(targetFrame, { frameId: oldFrame.swapId, complete: true }),
    false,
  );
  assert.equal(
    isCurrentKikikuruSwap(targetFrame, { frameId: targetFrame.swapId, complete: false }),
    true,
  );
  assert.deepEqual(getVisibleKikikuruFrame(oldFrame, targetFrame, true), oldFrame);
  assert.deepEqual(getVisibleKikikuruFrame(targetFrame, targetFrame, true), targetFrame);
});

test('キキクル: タイル失敗は索引・種別・有効状態の境界を越えて持ち越さないこと', () => {
  const oldBoundary = 'true:kikikuru-heavyrain:normal:/old';
  const newBoundary = 'true:kikikuru-inund:normal:/new';
  const errorState = { boundary: oldBoundary, count: 2 };

  assert.equal(getKikikuruTileErrorCount(errorState, oldBoundary), 2);
  assert.equal(getKikikuruTileErrorCount(errorState, newBoundary), 0);
});

test('useKikikuruLayerState: controlStatus !== normal のときは非提供の文言が出ること (§11.8)', () => {
  const response = createSampleKikikuruResponse({
    controlStatus: 'training',
    status: 'unsupported_control_status',
  });
  const catalog = buildKikikuruCatalog(response);

  let captured: UseKikikuruLayerStateResult | null = null;
  function TestComponent() {
    const result = useKikikuruLayerState({
      catalog,
      currentLayerId: 'kikikuru-heavyrain',
      terminalId: 'hkeagh01',
      controlStatus: 'training',
      enabled: true,
    });
    captured = result;
    return null;
  }

  renderToStaticMarkup(el(TestComponent));

  assert.ok(captured);
  assert.equal(captured.statusMessage, 'この制御状態ではキキクルを提供していません');
  assert.equal(captured.overlayFrame, null);
});
