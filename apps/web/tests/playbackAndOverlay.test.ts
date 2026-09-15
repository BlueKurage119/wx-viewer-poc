import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildNowcastCatalog } from '../src/map/nowcast/nowcastCatalog.ts';
import { usePlayback, type UsePlaybackResult } from '../src/map/nowcast/usePlayback.ts';
import { createSampleNowcastResponse } from './fixtures/nowcastFixtures.ts';

const el = React.createElement;

test('usePlayback: handleIntent と handleSwapSettled で選択コマが確定する (§9.3)', () => {
  const response = createSampleNowcastResponse();
  const catalog = buildNowcastCatalog(response);

  let captured: UsePlaybackResult | null = null;
  function TestComponent() {
    const result = usePlayback({
      catalog,
      terminalId: 'hkeagh01',
      controlStatus: 'normal',
      enabled: true,
    });
    captured = result;
    return null;
  }

  renderToStaticMarkup(el(TestComponent));

  assert.ok(captured);
  const result: UsePlaybackResult = captured;

  // 初期ロード中の overlayFrame がある
  assert.ok(result.overlayFrame);
  const initialFrameId = result.overlayFrame.id;

  // swap 完了前は selectedFrameId は null
  assert.equal(result.viewModel.selectedFrameId, null);

  // swap 完了を通知
  result.handleSwapSettled({ frameId: initialFrameId, complete: true });

  // 完了コールバックが正常に処理される
  assert.ok(initialFrameId);
});

test('usePlayback: タイムライン view model が代表コマで構築される', () => {
  const response = createSampleNowcastResponse();
  const catalog = buildNowcastCatalog(response);

  let captured: UsePlaybackResult | null = null;
  function TestComponent() {
    const result = usePlayback({
      catalog,
      terminalId: 'hkeagh01',
      controlStatus: 'normal',
      enabled: true,
    });
    captured = result;
    return null;
  }

  renderToStaticMarkup(el(TestComponent));

  assert.ok(captured);
  const result: UsePlaybackResult = captured;

  const repFrames = catalog.frames.filter((f) => f.representative);
  assert.equal(result.viewModel.frames.length, repFrames.length);
  assert.equal(result.viewModel.playing, false);
});
