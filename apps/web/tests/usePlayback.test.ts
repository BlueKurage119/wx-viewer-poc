import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildNowcastCatalog } from '../src/map/nowcast/nowcastCatalog.ts';
import { usePlayback, type UsePlaybackResult } from '../src/map/nowcast/usePlayback.ts';
import { createSampleNowcastResponse } from './fixtures/nowcastFixtures.ts';

const el = React.createElement;

test('usePlayback: 初期化時に実況最新コマが targetFrameId として設定される', () => {
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

  // overlayFrame が実況最新コマ (03:00) を指していること
  assert.ok(result.overlayFrame);
  assert.equal(result.overlayFrame.id, 'N1:2026-09-15T03:00:00.000Z:2026-09-15T03:00:00.000Z');
  assert.ok(result.overlayFrame.urlTemplate.includes('baseTime=2026-09-15T03%3A00%3A00.000Z'));
});

test('usePlayback: catalog が null または enabled=false のときは overlayFrame=null となる', () => {
  let captured: UsePlaybackResult | null = null;
  function TestComponent() {
    const result = usePlayback({
      catalog: null,
      terminalId: 'hkeagh01',
      controlStatus: 'normal',
      enabled: false,
    });
    captured = result;
    return null;
  }

  renderToStaticMarkup(el(TestComponent));

  assert.ok(captured);
  const result: UsePlaybackResult = captured;
  assert.equal(result.overlayFrame, null);
  assert.equal(result.viewModel.selectedFrameId, null);
  assert.equal(result.viewModel.frames.length, 0);
});
