import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  useTileCatalogPolling,
  TILE_CATALOG_POLL_INTERVAL_MS,
  TILE_CATALOG_BACKOFF_MS,
  type TileCatalogState,
} from '../src/map/tiles/useTileCatalogPolling.ts';

const el = React.createElement;

test('useTileCatalogPolling: ポーリング間隔が 60 秒固定であること (§5.2, §11.6)', () => {
  assert.equal(TILE_CATALOG_POLL_INTERVAL_MS, 60_000);
  assert.deepEqual(TILE_CATALOG_BACKOFF_MS, [60_000, 120_000, 240_000, 300_000]);
});

test('useTileCatalogPolling: 初期状態は status="loading" であること', () => {
  let captured: TileCatalogState<string> | null = null;
  function TestComponent() {
    const state = useTileCatalogPolling<string>({
      load: async () => ({ ok: true, value: 'data' }),
      resetKey: 'key1',
      enabled: true,
    });
    captured = state;
    return null;
  }

  renderToStaticMarkup(el(TestComponent));
  assert.ok(captured);
  assert.equal((captured as TileCatalogState<string>).status, 'loading');
});
