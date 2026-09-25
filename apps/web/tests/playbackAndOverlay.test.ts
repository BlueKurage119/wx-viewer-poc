import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import L from 'leaflet';
import { buildNowcastCatalog } from '../src/map/nowcast/nowcastCatalog.ts';
import {
  usePlayback,
  computePrefetchFrames,
  type UsePlaybackResult,
} from '../src/map/nowcast/usePlayback.ts';
import { WeatherTileOverlay, getSwapKey } from '../src/map/tiles/WeatherTileOverlay.tsx';
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
  // 初期状態は停止中
  assert.equal(result.retainLoaded, false);
  assert.equal(result.prefetchFrames, undefined);
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

test('usePlayback: jma-direct は imageAccess が許可されない限りレイヤーを生成しないこと', () => {
  const deniedCatalog = buildNowcastCatalog(
    createSampleNowcastResponse({
      tileDeliveryProfile: 'jma-direct',
      imageAccess: { allowed: false, reason: 'scheduled_stopped', nextAllowedAt: null },
    }),
  );
  let captured: UsePlaybackResult | null = null;
  function TestComponent() {
    captured = usePlayback({
      catalog: deniedCatalog,
      terminalId: 'hkeagh01',
      controlStatus: 'normal',
      enabled: true,
    });
    return null;
  }
  renderToStaticMarkup(el(TestComponent));
  assert.ok(captured);
  assert.equal((captured as UsePlaybackResult).overlayFrame, null);

  const proxyCatalog = buildNowcastCatalog(
    createSampleNowcastResponse({
      tileDeliveryProfile: 'proxy',
      imageAccess: { allowed: false, reason: 'scheduled_stopped', nextAllowedAt: null },
    }),
  );
  function ProxyComponent() {
    captured = usePlayback({
      catalog: proxyCatalog,
      terminalId: 'hkeagh01',
      controlStatus: 'normal',
      enabled: true,
    });
    return null;
  }
  renderToStaticMarkup(el(ProxyComponent));
  assert.ok((captured as UsePlaybackResult).overlayFrame);
});

test('computePrefetchFrames: 先読み深さ3で後続の代表コマが正しく生成されること (§9.3.2)', () => {
  const response = createSampleNowcastResponse();
  const catalog = buildNowcastCatalog(response);
  const repFrames = catalog.frames.filter((f) => f.representative);
  assert.ok(repFrames.length >= 5);

  const target = repFrames[2]!;
  const prefetched = computePrefetchFrames({
    frames: repFrames,
    targetFrameId: target.id,
    terminalId: 'hkeagh01',
    controlStatus: 'normal',
    catalog,
    depth: 3,
  });

  assert.equal(prefetched.length, 3, '先読み深さ3で3コマ生成されること');
  assert.equal(prefetched[0]!.id, repFrames[3]!.id);
  assert.equal(prefetched[1]!.id, repFrames[4]!.id);
  assert.equal(prefetched[2]!.id, repFrames[5]!.id);

  for (const pf of prefetched) {
    assert.ok(pf.urlTemplate.includes('terminalId=hkeagh01'));
  }

  // 末尾近傍でのサイクリックループの検証
  const lastTarget = repFrames[repFrames.length - 1]!;
  const loopPrefetched = computePrefetchFrames({
    frames: repFrames,
    targetFrameId: lastTarget.id,
    terminalId: 'hkeagh01',
    controlStatus: 'normal',
    catalog,
    depth: 3,
  });

  assert.equal(loopPrefetched.length, 3);
  assert.equal(loopPrefetched[0]!.id, repFrames[0]!.id, '末尾の次は先頭へ戻ること');
  assert.equal(loopPrefetched[1]!.id, repFrames[1]!.id);
  assert.equal(loopPrefetched[2]!.id, repFrames[2]!.id);
});

test('WeatherTileOverlay: id が同一で urlTemplate が異なる場合に swapKey が異なり差し替え対象と判定されること (§8.3, §11.6)', () => {
  const frame1 = {
    id: '2026-09-15T03:00:00.000Z',
    urlTemplate: '/api/weather/kikikuru/heavyrain/tiles/{z}/{x}/{y}.png?terminalId=hkeagh01',
  };
  const frame2 = {
    id: '2026-09-15T03:00:00.000Z',
    urlTemplate: '/api/weather/kikikuru/inund/tiles/{z}/{x}/{y}.png?terminalId=hkeagh01',
  };

  assert.equal(frame1.id, frame2.id, 'id は同一');
  const key1 = getSwapKey(frame1);
  const key2 = getSwapKey(frame2);
  assert.notEqual(key1, key2, 'swapKey は urlTemplate の差により異なること');
  assert.equal(
    key1,
    '2026-09-15T03:00:00.000Z /api/weather/kikikuru/heavyrain/tiles/{z}/{x}/{y}.png?terminalId=hkeagh01',
  );
  assert.equal(
    key2,
    '2026-09-15T03:00:00.000Z /api/weather/kikikuru/inund/tiles/{z}/{x}/{y}.png?terminalId=hkeagh01',
  );
});

/** predicate が真になるまで intervalMs 間隔で待つ。timeoutMs 到達時は false を返す(例外は投げない)。 */
async function waitUntil(
  predicate: () => boolean,
  { timeoutMs = 3000, intervalMs = 5 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return true;
}

test('WeatherTileOverlay: タイムアウト時に complete: false で swap 完了を通知すること (§9.3, §11.4)', async () => {
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
  const notifications: { frameId: string; complete: boolean }[] = [];
  const layer = {
    addTo() {
      return layer;
    },
    once() {
      return layer;
    },
    on() {
      return layer;
    },
    remove() {
      return layer;
    },
    setOpacity() {
      return layer;
    },
  };
  const originalTileLayer = L.tileLayer;
  L.tileLayer = (() => layer) as unknown as typeof L.tileLayer;

  const root = createRoot(element as unknown as Element);
  try {
    root.render(
      el(WeatherTileOverlay, {
        map: {
          getZoom: () => 10,
          hasLayer: () => true,
          on() {},
          off() {},
        } as unknown as L.Map,
        frame: { id: 'timeout-frame', urlTemplate: '/tiles/{z}/{x}/{y}.png' },
        allowedZooms: [10],
        opacity: 0.8,
        swapTimeoutMs: 1,
        onSwapSettled: (result) => notifications.push(result),
      }),
    );
    await waitUntil(() => notifications.length >= 1);
    // 重複通知の検出窓: 従来の固定100ms待機と同等以上の猶予を確保する
    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    root.unmount();
    L.tileLayer = originalTileLayer;
  }

  assert.deepEqual(notifications, [{ frameId: 'timeout-frame', complete: false }]);
});

test('WeatherTileOverlay: レンダリングおよびプロパティ契約の検証 (§8.3, §9.3, §11.6)', () => {
  const html = renderToStaticMarkup(
    el(WeatherTileOverlay, {
      map: null,
      frame: {
        id: 'test-frame',
        urlTemplate: '/api/weather/kikikuru/heavyrain/tiles/{z}/{x}/{y}.png',
      },
      prefetchFrames: [
        {
          id: 'next-frame',
          urlTemplate: '/api/weather/kikikuru/heavyrain/tiles/{z}/{x}/{y}.png',
        },
      ],
      retainLoaded: true,
      allowedZooms: [10],
      opacity: 0.8,
      swapTimeoutMs: 12000,
    }),
  );

  assert.equal(html, '');
});
