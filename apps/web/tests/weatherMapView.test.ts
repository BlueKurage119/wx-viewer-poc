import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof React }).React = React;

import { WeatherMapView } from '../src/map/WeatherMapView.tsx';
import { terminals } from '../src/shell/config.ts';
import { LAYER_PRESENTATIONS, emptyTimeline } from '../src/map/fixtures.ts';

const el = React.createElement;

test('WeatherMapView: east (東京ビッグサイト) で地図構造と全コントロールがレンダリングされる (通常表示は空カタログ)', () => {
  const eastTerminal = terminals.find((t) => t.venue.id === 'east')!;
  assert.ok(eastTerminal);

  const html = renderToStaticMarkup(el(WeatherMapView, { venue: eastTerminal.venue }));

  // 地図コンテナ
  assert.ok(html.includes('map-viewport'));
  assert.ok(html.includes('aria-label="会場周辺の地図"'));

  // 右側情報列スロットとプレースホルダーカード
  assert.ok(html.includes('map-information-column-slot'));
  assert.ok(html.includes('map-info-placeholder-card'));

  // 凡例 (初期表示)
  assert.ok(html.includes('map-legend'));
  assert.ok(html.includes('雨雲ナウキャスト（降水強度）'));

  // 常時出典リンク
  assert.ok(html.includes('map-attribution'));
  assert.ok(html.includes('https://maps.gsi.go.jp/development/ichiran.html'));

  // ズームコントロールと会場復帰アイコン
  assert.ok(html.includes('map-zoom-controls'));
  assert.ok(html.includes('aria-label="会場の初期位置に戻る"'));

  // 左下フローティングレイヤー選択
  assert.ok(html.includes('map-layer-selector-floating'));

  // 時間操作カード (デフォルトは空カタログで fixture の固定日時を出さない)
  assert.ok(html.includes('timeline-control-card'));
  assert.ok(html.includes('利用可能な時刻はありません'));
  assert.equal(html.includes('09/15 01:30'), false);
});

test('WeatherMapView: trc (東京流通センター) で地図構造と全コントロールがレンダリングされる', () => {
  const trcTerminal = terminals.find((t) => t.venue.id === 'trc')!;
  assert.ok(trcTerminal);

  const html = renderToStaticMarkup(el(WeatherMapView, { venue: trcTerminal.venue }));

  assert.ok(html.includes('map-viewport'));
  assert.ok(html.includes('map-information-column-slot'));
  assert.ok(html.includes('map-info-placeholder-card'));
  assert.ok(html.includes('map-legend'));
  assert.ok(html.includes('map-attribution'));
  assert.ok(html.includes('map-zoom-controls'));
  assert.ok(html.includes('map-layer-selector-floating'));
  assert.ok(html.includes('timeline-control-card'));
});

test('WeatherMapView: F4 境界 - 外部から渡された表示モデル (空カタログ等) をそのまま描画する', () => {
  const eastTerminal = terminals.find((t) => t.venue.id === 'east')!;
  const html = renderToStaticMarkup(
    el(WeatherMapView, {
      venue: eastTerminal.venue,
      timelineViewModel: emptyTimeline,
    }),
  );

  // 空カタログのメッセージがそのまま表示されること
  assert.ok(html.includes('利用可能な時刻はありません'));
  assert.ok(html.includes('timeline-slider-empty'));
});

test('F5/F6 状態独立性: 会場復帰やレイヤー選択のデータ整合性', () => {
  // レイヤー定義の整合性
  const layerIds = Object.keys(LAYER_PRESENTATIONS);
  assert.deepEqual(layerIds, ['nowcast', 'kikikuru-heavyrain', 'kikikuru-inund', 'kikikuru-land']);

  for (const id of layerIds) {
    const layer = LAYER_PRESENTATIONS[id as keyof typeof LAYER_PRESENTATIONS];
    assert.ok(layer.label.length > 0);
    assert.ok(layer.legendTitle.length > 0);
    assert.ok(layer.legendItems.length > 0);
    assert.ok(layer.sourceLabel.includes('気象庁'));
    // HEX ハードコードではなく CSS 変数またはトークン名が使われていること
    for (const item of layer.legendItems) {
      assert.ok(item.swatchToken.startsWith('var(--'));
    }
  }
});

test('WeatherMapView: キーボードフォーカス順（凡例 → レイヤー選択 → 時間操作 → ズーム → 会場復帰）の DOM 順序を検証', () => {
  const eastTerminal = terminals.find((t) => t.venue.id === 'east')!;
  const html = renderToStaticMarkup(el(WeatherMapView, { venue: eastTerminal.venue }));

  const legendIndex = html.indexOf('class="map-legend"');
  const layerSelectorIndex = html.indexOf('class="map-layer-selector-floating"');
  const timelineCardIndex = html.indexOf('class="timeline-control-card nowcast-timeline-card"');
  const zoomControlsIndex = html.indexOf('class="map-zoom-controls"');
  const returnButtonIndex = html.indexOf('class="map-zoom-button map-return-button"');
  const viewportIndex = html.indexOf('class="map-viewport"');

  assert.ok(legendIndex >= 0);
  assert.ok(layerSelectorIndex > legendIndex, '凡例の後にレイヤー選択');
  assert.ok(timelineCardIndex > layerSelectorIndex, 'レイヤー選択の後に時間操作カード');
  assert.ok(zoomControlsIndex > timelineCardIndex, '時間操作カードの後にズーム操作');
  assert.ok(returnButtonIndex > zoomControlsIndex, 'ズーム操作の後に会場復帰');
  assert.ok(viewportIndex > returnButtonIndex, '操作面の後に地図本体');
});
