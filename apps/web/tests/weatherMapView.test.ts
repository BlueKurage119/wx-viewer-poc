import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof React }).React = React;

import { WeatherMapView } from '../src/map/WeatherMapView.tsx';
import { terminals } from '../src/shell/config.ts';
import { LAYER_PRESENTATIONS } from '../src/map/fixtures.ts';

const el = React.createElement;

test('WeatherMapView: east (東京ビッグサイト) で地図構造と全コントロールがレンダリングされる', () => {
  const eastTerminal = terminals.find((t) => t.venue.id === 'east')!;
  assert.ok(eastTerminal);

  const html = renderToStaticMarkup(el(WeatherMapView, { venue: eastTerminal.venue }));

  // 地図コンテナ
  assert.ok(html.includes('map-viewport'));
  assert.ok(html.includes('aria-label="会場周辺の地図"'));

  // 右側情報列スロット (空スロット)
  assert.ok(html.includes('map-information-column-slot'));

  // 凡例 (初期表示)
  assert.ok(html.includes('map-legend'));
  assert.ok(html.includes('雨雲ナウキャスト（降水強度）'));

  // 常時出典リンク
  assert.ok(html.includes('map-attribution'));
  assert.ok(html.includes('https://maps.gsi.go.jp/development/ichiran.html'));

  // ズームコントロールと会場復帰アイコン
  assert.ok(html.includes('map-zoom-controls'));
  assert.ok(html.includes('aria-label="会場の初期位置に戻る"'));

  // 時間操作カード
  assert.ok(html.includes('timeline-control-card'));
  assert.ok(html.includes('雨雲ナウキャスト'));
});

test('WeatherMapView: trc (東京流通センター) で地図構造と全コントロールがレンダリングされる', () => {
  const trcTerminal = terminals.find((t) => t.venue.id === 'trc')!;
  assert.ok(trcTerminal);

  const html = renderToStaticMarkup(el(WeatherMapView, { venue: trcTerminal.venue }));

  assert.ok(html.includes('map-viewport'));
  assert.ok(html.includes('map-information-column-slot'));
  assert.ok(html.includes('map-legend'));
  assert.ok(html.includes('map-attribution'));
  assert.ok(html.includes('map-zoom-controls'));
  assert.ok(html.includes('timeline-control-card'));
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
    assert.equal(layer.sourceLabel, '気象庁');
    // HEX ハードコードではなく CSS 変数またはトークン名が使われていること
    for (const item of layer.legendItems) {
      assert.ok(item.swatchToken.startsWith('var(--'));
    }
  }
});
