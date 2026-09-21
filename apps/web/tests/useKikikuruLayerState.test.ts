import './setupEnv.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildKikikuruCatalog } from '../src/map/kikikuru/kikikuruCatalog';
import {
  useKikikuruLayerState,
  transitionKikikuruLayer,
  type UseKikikuruLayerStateResult,
  type KikikuruLayerState,
} from '../src/map/kikikuru/useKikikuruLayerState';
import {
  createSampleKikikuruResponse,
  createSampleKikikuruFrames,
} from './fixtures/kikikuruFixtures';

const el = React.createElement;

test('useKikikuruLayerState: 初期化時に最新コマが選択され、ラベルが「危険度判定 基準時刻 MM/DD HH:mm」形式であること (§8.2, §11.7)', () => {
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

  // 最新コマ (2026-09-15T03:00:00.000Z) が選択されていること
  assert.equal(result.viewModel.selectedFrameId, '2026-09-15T03:00:00.000Z');
  assert.equal(result.overlayFrame?.id, '2026-09-15T03:00:00.000Z');

  // ラベルが「危険度判定 基準時刻 MM/DD HH:mm」形式であること (03:00 UTC は 12:00 JST)
  assert.equal(result.viewModel.selectedFrameLabel, '危険度判定 基準時刻 09/15 12:00');
  assert.equal(result.viewModel.playing, false);
  assert.equal(result.viewModel.latestAvailable, false); // 最新選択中は false
});

test('transitionKikikuruLayer: 種別切替（大雨→浸水→土砂）で selectedFrameId が維持され、playing が false になること (§5.2, §5.3, §11.3, §11.4)', () => {
  const response = createSampleKikikuruResponse();
  const catalog = buildKikikuruCatalog(response);

  // 1. 大雨で過去コマ (02:00:00.000Z) を選択し、playing=true の状態
  const state0: KikikuruLayerState = {
    selectedFrameId: '2026-09-15T02:00:00.000Z',
    playing: true,
  };

  // 2. 浸水へ切り替え
  const { nextState: stateInund, isOutOfRange: outInund } = transitionKikikuruLayer(
    state0,
    'kikikuru-inund',
    catalog,
  );

  // 選択していた時刻が維持されていること！最新へ巻き戻らないこと！(§5.3, §11.4)
  assert.equal(stateInund.selectedFrameId, '2026-09-15T02:00:00.000Z');
  // 切替直後に再生が停止すること (§5.2, §11.4)
  assert.equal(stateInund.playing, false);
  assert.equal(outInund, false);

  // 3. 土砂へ切り替え
  const { nextState: stateLand, isOutOfRange: outLand } = transitionKikikuruLayer(
    stateInund,
    'kikikuru-land',
    catalog,
  );

  // 土砂でも同じ時刻が維持されていること！(§5.3, §11.4)
  assert.equal(stateLand.selectedFrameId, '2026-09-15T02:00:00.000Z');
  assert.equal(stateLand.playing, false);
  assert.equal(outLand, false);
});

test('transitionKikikuruLayer: 切替先に同じ validTime が存在しない場合は null になり提供範囲外の注記フラグが立つこと (§5.3, §6.3, §11.4)', () => {
  const baseResponse = createSampleKikikuruResponse();

  // inund から 02:00:00.000Z のコマを削ったカタログを作成
  const inundFrames = createSampleKikikuruFrames('inund', '2026-09-15T03:00:00.000Z', 37).filter(
    (f) => f.validTime !== '2026-09-15T02:00:00.000Z',
  );

  const modifiedResponse = {
    ...baseResponse,
    layers: {
      ...baseResponse.layers,
      inund: {
        ...baseResponse.layers.inund,
        data: { frames: inundFrames },
      },
    },
  };
  const catalog = buildKikikuruCatalog(modifiedResponse);

  const state0: KikikuruLayerState = {
    selectedFrameId: '2026-09-15T02:00:00.000Z',
    playing: false,
  };

  // 02:00:00.000Z が存在しない浸水へ切り替え
  const { nextState, isOutOfRange } = transitionKikikuruLayer(state0, 'kikikuru-inund', catalog);

  // 黙って別時刻へ差し替えず、selectedFrameId は null になる (§5.3)
  assert.equal(nextState.selectedFrameId, null);
  assert.equal(isOutOfRange, true);
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
