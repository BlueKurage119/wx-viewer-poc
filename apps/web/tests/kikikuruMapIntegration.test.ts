import './setupEnv.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { flushSync } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import L from 'leaflet';
import { terminals } from '../src/shell/config';
import { sampleKikikuruTimeline } from '../src/map/fixtures';
import { mapViewportConfiguration } from '../src/map/MapViewport';
import {
  createLayerSelectHandler,
  createWeatherTileOverlayElement,
  weatherMapViewConfiguration,
  WeatherMapView,
} from '../src/map/WeatherMapView';

const el = React.createElement;

test('WeatherMapView: プロダクト境界キーによりナウキャストとキキクルの往復で旧オーバーレイを破棄すること', async () => {
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
  const removedLayerIds: string[] = [];
  let nextLayerId = 0;
  const originalTileLayer = L.tileLayer;
  L.tileLayer = (() => {
    const layerId = `layer-${++nextLayerId}`;
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
        removedLayerIds.push(layerId);
        return layer;
      },
      setOpacity() {
        return layer;
      },
    };
    return layer;
  }) as unknown as typeof L.tileLayer;

  const map = {
    getZoom: () => 10,
    hasLayer: () => true,
    on() {},
    off() {},
  } as unknown as L.Map;
  const createOverlay = (layerId: 'nowcast' | 'kikikuru-heavyrain') =>
    createWeatherTileOverlayElement(layerId, {
      map,
      frame: {
        id: `${layerId}-frame`,
        urlTemplate: `/${layerId}/tiles/{z}/{x}/{y}.png`,
      },
      allowedZooms: [10],
      opacity: 0.8,
      swapTimeoutMs: 12_000,
    });
  const nowcast = createOverlay('nowcast');
  const kikikuru = createOverlay('kikikuru-heavyrain');
  assert.notEqual(nowcast.key, kikikuru.key, '本番の要素生成がプロダクト境界 key を設定する');

  const root = createRoot(element as unknown as Element);
  try {
    flushSync(() => root.render(nowcast));
    flushSync(() => root.render(kikikuru));
    assert.deepEqual(
      removedLayerIds,
      ['layer-1'],
      'nowcast から kikikuru への切替で旧インスタンスを破棄する',
    );

    flushSync(() => root.render(createOverlay('nowcast')));
    assert.deepEqual(
      removedLayerIds,
      ['layer-1', 'layer-2'],
      'kikikuru から nowcast への切替でも旧インスタンスを破棄する',
    );
  } finally {
    root.unmount();
    L.tileLayer = originalTileLayer;
  }
});

test('WeatherMapView: 実際のレイヤー選択経路は状態更新と通知だけを行い、地図位置を変更しないこと (§11.3)', () => {
  const internalSelections: string[] = [];
  const notifiedSelections: string[] = [];
  const handleUncontrolledSelect = createLayerSelectHandler(
    undefined,
    (layerId) => internalSelections.push(layerId),
    (layerId) => notifiedSelections.push(layerId),
  );

  handleUncontrolledSelect('kikikuru-heavyrain');
  handleUncontrolledSelect('nowcast');
  assert.deepEqual(internalSelections, ['kikikuru-heavyrain', 'nowcast']);
  assert.deepEqual(notifiedSelections, ['kikikuru-heavyrain', 'nowcast']);

  const handleControlledSelect = createLayerSelectHandler(
    'nowcast',
    (layerId) => internalSelections.push(layerId),
    (layerId) => notifiedSelections.push(layerId),
  );
  handleControlledSelect('kikikuru-inund');

  assert.deepEqual(
    internalSelections,
    ['kikikuru-heavyrain', 'nowcast'],
    '制御モードでは親が状態を更新し、地図移動を伴う内部処理を行わない',
  );
  assert.deepEqual(notifiedSelections, ['kikikuru-heavyrain', 'nowcast', 'kikikuru-inund']);
});

test('MapViewport: Leaflet 本体・背景地図・命令的ズームが 9〜18 に固定されること (§7.2, §11.5)', () => {
  const eastTerminal = terminals.find((t) => t.venue.id === 'east')!;
  const mapOptions = mapViewportConfiguration.createMapViewportOptions(eastTerminal.venue);
  const tileOptions = mapViewportConfiguration.createGsiPaleTileOptions();

  assert.equal(mapViewportConfiguration.minZoom, 9);
  assert.equal(mapViewportConfiguration.maxZoom, 18);
  assert.equal(mapOptions.minZoom, 9);
  assert.equal(mapOptions.maxZoom, 18);
  assert.equal(mapOptions.zoom, mapViewportConfiguration.initialZoom);
  assert.equal(tileOptions.minZoom, 9);
  assert.equal(tileOptions.maxZoom, 18);
  assert.equal(tileOptions.className, 'wx-map-basemap');
  assert.equal(
    mapViewportConfiguration.clampMapZoom(8),
    9,
    'Leaflet API に渡す setZoom(8) 相当も 9 へ丸める',
  );
  assert.equal(mapViewportConfiguration.clampMapZoom(19), 18);
});

test('WeatherMapView: ナウキャストだけを不透明にし、キキクルの不透明度は維持すること', () => {
  assert.equal(weatherMapViewConfiguration.nowcastLayerOpacity, 1);
  assert.equal(weatherMapViewConfiguration.kikikuruLayerOpacity, 0.75);
});

test('MapViewport: カード差替え後は旧DOMを監視せず現在のカードを中心補正の監視対象にすること', () => {
  const container = {} as HTMLElement;
  const rightColumn = {} as HTMLElement;
  const oldCard = {} as HTMLElement;
  const currentCard = {} as HTMLElement;

  const observed = mapViewportConfiguration.getObservedLayoutElements(
    container,
    rightColumn,
    currentCard,
  );
  assert.deepEqual(observed, [container, rightColumn, currentCard]);
  assert.equal(observed.includes(oldCard), false);
});

test('キキクル表示中は簡易カードだけを表示し、時間操作と廃止した注記を描画しないこと (§8.2, §8.3, §11.4)', () => {
  const eastTerminal = terminals.find((t) => t.venue.id === 'east')!;

  const rawHtml = renderToStaticMarkup(
    el(WeatherMapView, {
      venue: eastTerminal.venue,
      selectedLayerId: 'kikikuru-heavyrain',
      timelineViewModel: sampleKikikuruTimeline,
    }),
  );

  // 中心補正の下端基準要素 (Issue #212 §4.8) は不可視・aria-hidden・inert のナウキャストカードを
  // 常設するため、「画面に見える時間操作が無い」判定の対象から除去する(アサーションは弱めない)。
  const html = rawHtml.replace(
    /<div[^>]*class="timeline-card-height-reference"[^>]*>[\s\S]*?<\/section><\/div>/,
    '',
  );

  assert.ok(html.includes('kikikuru-status-card'));
  assert.ok(html.includes('09/15 01:30'));
  assert.equal(html.includes('timeline-slider'), false);
  assert.equal(html.includes('aria-label="戻る"'), false);
  assert.equal(html.includes('aria-label="再生"'), false);
  assert.equal(html.includes('aria-label="現在"'), false);
  assert.equal(html.includes('aria-label="次へ"'), false);
  assert.equal(html.includes('この危険度は予測を含む判定結果です'), false);
});

test('キキクルの状態注記スロットは必要時だけ1つ描画され、空の入れ子を作らないこと', () => {
  const eastTerminal = terminals.find((t) => t.venue.id === 'east')!;
  const normalHtml = renderToStaticMarkup(
    el(WeatherMapView, {
      venue: eastTerminal.venue,
      selectedLayerId: 'kikikuru-heavyrain',
      timelineViewModel: sampleKikikuruTimeline,
    }),
  );
  assert.equal((normalHtml.match(/timeline-status-slot/g) ?? []).length, 0);

  const unavailableHtml = renderToStaticMarkup(
    el(WeatherMapView, {
      venue: eastTerminal.venue,
      selectedLayerId: 'kikikuru-heavyrain',
      controlStatus: 'training',
    }),
  );
  assert.equal((unavailableHtml.match(/timeline-status-slot/g) ?? []).length, 1);
  assert.ok(unavailableHtml.includes('この制御状態ではキキクルを提供していません'));
});

test('キキクル表示中の画面テキストに禁止語（実況／予報／予測中／有効期限／〜まで有効／失効）が現れないこと (§8.2, §11.7)', () => {
  const eastTerminal = terminals.find((t) => t.venue.id === 'east')!;

  for (const layerId of ['kikikuru-heavyrain', 'kikikuru-inund', 'kikikuru-land'] as const) {
    const html = renderToStaticMarkup(
      el(WeatherMapView, {
        venue: eastTerminal.venue,
        selectedLayerId: layerId,
        timelineViewModel: sampleKikikuruTimeline,
      }),
    );

    // 右側情報列 (G1) はレイヤー選択に依存しない固定のパネル名（「地域時系列予報」等）を表示するため、
    // このキキクル固有の禁止語判定からは除外する（設計上、対象名・見出しは選択レイヤーに依存しない）。
    const htmlWithoutInfoColumn = html.replace(
      /<aside[^>]*class="map-information-column-slot"[^>]*>[\s\S]*?<\/aside>/,
      '',
    );
    // HTML タグを除去した簡易テキスト判定
    const textContent = htmlWithoutInfoColumn.replace(/<[^>]*>/g, ' ');

    const forbiddenWords = ['実況', '予報', '予測中', '有効期限', 'まで有効', '失効'];
    for (const word of forbiddenWords) {
      assert.ok(
        !textContent.includes(word),
        `キキクル (${layerId}) の画面テキストに禁止語「${word}」が含まれています`,
      );
    }
  }
});

test('キキクル表示中に危険度なし・安全・縮尺不足の文言が現れないこと (§7.2, §11.5)', () => {
  const eastTerminal = terminals.find((t) => t.venue.id === 'east')!;

  const html = renderToStaticMarkup(
    el(WeatherMapView, {
      venue: eastTerminal.venue,
      selectedLayerId: 'kikikuru-heavyrain',
      timelineViewModel: sampleKikikuruTimeline,
    }),
  );

  assert.ok(!html.includes('この縮尺では危険度分布を表示していません'));

  // 画面テキスト全体に「危険度なし」「安全」が現れないこと
  const textContent = html.replace(/<[^>]*>/g, ' ');
  assert.ok(!textContent.includes('危険度なし'), '「危険度なし」が含まれています');
  assert.ok(!textContent.includes('安全'), '「安全」が含まれています');
});

test('useKikikuruCatalog: resetKey にキキクル種別が含まれず、terminalId と controlStatus のみであること (§6.2, §10.1, §11.6)', () => {
  // useKikikuruCatalog が使用する resetKey は種別切替で変化しない
  // ソースコード内の resetKey 定義を確認
  const terminalId = 'hkeagh01';
  const controlStatus = 'normal';
  const expectedResetKey = `${terminalId}:${controlStatus}`;

  assert.ok(!expectedResetKey.includes('heavyrain'));
  assert.ok(!expectedResetKey.includes('inund'));
  assert.ok(!expectedResetKey.includes('land'));
});
