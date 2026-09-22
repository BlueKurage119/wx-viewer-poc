import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// tsx が JSX を React.createElement に変換する際のグローバル参照を確保
(globalThis as unknown as { React: typeof React }).React = React;

import { TimelineControlCard } from '../src/map/TimelineControlCard.tsx';
import { findEnabledFrameIndex } from '../src/map/timelineNavigation.ts';
import { LayerSelector } from '../src/map/LayerSelector.tsx';
import { MapLegend } from '../src/map/MapLegend.tsx';
import { MapAttribution } from '../src/map/MapAttribution.tsx';
import { MapZoomControls } from '../src/map/MapZoomControls.tsx';
import { KikikuruStatusCard } from '../src/map/kikikuru/KikikuruStatusCard.tsx';
import {
  sampleNowcastTimeline,
  sampleKikikuruTimeline,
  emptyTimeline,
  LAYER_PRESENTATIONS,
} from '../src/map/fixtures.ts';

const el = React.createElement;

test('F4: fixture の複数フレームでスライダー、各ボタンの属性と文言が正しくレンダリングされる', () => {
  const html = renderToStaticMarkup(
    el(TimelineControlCard, {
      viewModel: sampleNowcastTimeline,
      onIntent: () => {},
    }),
  );

  // 実況と時刻は種別→時刻の順に表示する
  assert.ok(html.includes('09/15 01:30'));
  assert.ok(html.includes('実況'));
  assert.ok(html.includes('nowcast-timeline-card'));
  assert.ok(html.indexOf('>実況<') < html.indexOf('>09/15 01:30<'));
  assert.ok(html.includes('timeline-slider'));
  assert.ok(html.includes('aria-valuetext="実況 01:30"'));

  // ボタンの aria-label（戻る、再生、現在、次へ）
  assert.ok(html.includes('aria-label="戻る"'));
  assert.ok(html.includes('aria-label="再生"'));
  assert.ok(html.includes('aria-label="現在"'));
  assert.ok(html.includes('aria-label="次へ"'));

  // 再生中状態のテスト
  const playingHtml = renderToStaticMarkup(
    el(TimelineControlCard, {
      viewModel: { ...sampleNowcastTimeline, playing: true },
      onIntent: () => {},
    }),
  );
  assert.ok(playingHtml.includes('aria-label="停止"'));
});

test('F2: 背景 filter とナウキャスト時刻表示のスタイルは専用境界に限定される', () => {
  const css = readFileSync(new URL('../src/map/map.css', import.meta.url), 'utf8');

  assert.match(
    css,
    /\.map-viewport \.wx-map-basemap\s*\{\s*filter: grayscale\(1\) brightness\(0\.66\);\s*\}/,
  );
  assert.match(css, /\.nowcast-timeline-card \.timeline-kind-badge\s*\{[\s\S]*?font-size: 16px;/);
  assert.match(
    css,
    /\.nowcast-timeline-card \.timeline-selected-time\s*\{[\s\S]*?font-size: 20px;/,
  );
  assert.match(
    css,
    /@media \(max-width: 768px\)\s*\{[\s\S]*?\.nowcast-timeline-card \.timeline-kind-badge\s*\{[\s\S]*?font-size: 14px;/,
  );
  assert.match(
    css,
    /@media \(max-width: 768px\)\s*\{[\s\S]*?\.nowcast-timeline-card \.timeline-selected-time\s*\{[\s\S]*?font-size: 18px;/,
  );
  assert.match(css, /\.kikikuru-status-card \.timeline-selected-time\s*\{[\s\S]*?font-size: 20px;/);
  assert.match(
    css,
    /@media \(max-width: 768px\)\s*\{[\s\S]*?\.kikikuru-status-card \.timeline-selected-time\s*\{[\s\S]*?font-size: 18px;/,
  );
});

test('F3: キキクル簡易カードは既存のレイヤー名と時刻だけを維持する', () => {
  const html = renderToStaticMarkup(
    el(KikikuruStatusCard, {
      viewModel: sampleKikikuruTimeline,
    }),
  );

  assert.ok(html.includes(sampleKikikuruTimeline.layerLabel));
  assert.ok(html.includes(sampleKikikuruTimeline.selectedFrameLabel));
  assert.equal(html.includes('実況'), false);
  assert.equal(html.includes('予報'), false);
  assert.equal(html.includes('基準'), false);
  assert.equal(html.includes('予測'), false);
});

test('F4: 空カタログでは操作が disabled となり、「利用可能な時刻はありません」が表示される', () => {
  const html = renderToStaticMarkup(
    el(TimelineControlCard, {
      viewModel: emptyTimeline,
      onIntent: () => {},
    }),
  );

  assert.ok(html.includes('利用可能な時刻はありません'));
  // スライダー領域が無効状態
  assert.ok(html.includes('timeline-slider-empty'));
  // 各ボタンが disabled（戻る、再生、現在、次へ）
  assert.ok(html.includes('disabled="" aria-label="戻る"'));
  assert.ok(html.includes('disabled="" aria-label="再生"'));
  assert.ok(html.includes('disabled="" aria-label="現在"'));
  assert.ok(html.includes('disabled="" aria-label="次へ"'));
});

test('F4: キキクルの reference フレームで基準バッジと時刻が表示される', () => {
  const refModel = {
    ...sampleKikikuruTimeline,
    selectedFrameId: 'kk-ref',
    selectedFrameLabel: '09/15 01:00',
    frames: [{ id: 'kk-ref', displayTime: '01:00', kind: 'reference' as const, enabled: true }],
  };
  const html = renderToStaticMarkup(
    el(TimelineControlCard, {
      viewModel: refModel,
      onIntent: () => {},
    }),
  );

  assert.ok(html.includes('09/15 01:00'));
  assert.ok(html.includes('基準'));
  assert.ok(html.includes('aria-valuetext="基準 01:00"'));
});

test('F4: キーボード選択は無効コマを飛び越え、Home/Endは最寄りの有効コマを選ぶ', () => {
  const frames = [
    { id: 'disabled-first', displayTime: '00:00', kind: 'observed' as const, enabled: false },
    { id: 'enabled-first', displayTime: '00:10', kind: 'observed' as const, enabled: true },
    { id: 'disabled-middle', displayTime: '00:20', kind: 'observed' as const, enabled: false },
    { id: 'enabled-last', displayTime: '00:30', kind: 'forecast' as const, enabled: true },
    { id: 'disabled-last', displayTime: '00:40', kind: 'forecast' as const, enabled: false },
  ];

  assert.equal(findEnabledFrameIndex(frames, 1, 1), 3);
  assert.equal(findEnabledFrameIndex(frames, 3, -1), 1);
  assert.equal(findEnabledFrameIndex(frames, -1, 1), 1);
  assert.equal(findEnabledFrameIndex(frames, frames.length, -1), 3);
  assert.equal(findEnabledFrameIndex(frames, 3, 1), null);
});

test('F5: レイヤー選択にナウキャストとキキクル3種のみが含まれ、洪水・雷・竜巻が含まれない', () => {
  const html = renderToStaticMarkup(
    el(LayerSelector, {
      selectedLayerId: 'nowcast',
      onLayerSelect: () => {},
    }),
  );

  assert.ok(html.includes('雨雲ナウキャスト'));
  assert.ok(html.includes('キキクル（大雨）'));
  assert.ok(html.includes('キキクル（浸水）'));
  assert.ok(html.includes('キキクル（土砂）'));

  // 除外対象の確認
  assert.equal(html.includes('洪水'), false);
  assert.equal(html.includes('雷'), false);
  assert.equal(html.includes('竜巻'), false);
});

test('F5: 凡例が開いている時は再表示ボタンがなく、閉じている時は元の左上位置に再表示ボタンが現れる', () => {
  const openHtml = renderToStaticMarkup(
    el(MapLegend, {
      presentation: LAYER_PRESENTATIONS.nowcast,
      open: true,
      onClose: () => {},
      onOpen: () => {},
    }),
  );
  assert.equal(openHtml.includes('map-legend-reopen-button'), false);
  assert.ok(openHtml.includes('legend-close-button'));

  const closedHtml = renderToStaticMarkup(
    el(MapLegend, {
      presentation: LAYER_PRESENTATIONS.nowcast,
      open: false,
      onClose: () => {},
      onOpen: () => {},
    }),
  );
  assert.ok(closedHtml.includes('map-legend-reopen-button'));
  assert.ok(closedHtml.includes('aria-label="凡例を表示"'));
});

test('F5: 凡例カードは open=false で本体が描画されず再表示ボタンが表示され、open=true で階級と閉じるボタンが表示される', () => {
  const closed = renderToStaticMarkup(
    el(MapLegend, {
      presentation: LAYER_PRESENTATIONS.nowcast,
      open: false,
      onClose: () => {},
      onOpen: () => {},
    }),
  );
  // open=false のときは凡例本体（map-legend）は描画されず、再表示ボタンが描画される
  assert.equal(closed.includes('class="map-legend"'), false);
  assert.ok(closed.includes('map-legend-reopen-button'));

  const visible = renderToStaticMarkup(
    el(MapLegend, {
      presentation: LAYER_PRESENTATIONS.nowcast,
      open: true,
      onClose: () => {},
      onOpen: () => {},
    }),
  );
  assert.ok(visible.includes('雨雲ナウキャスト（降水強度）'));
  assert.ok(visible.includes('legend-close-button'));
  assert.ok(visible.includes('80 以上 mm/h'));
});

test('F5: 出典リンクが国土地理院の地理院タイル一覧へリンクしている', () => {
  const html = renderToStaticMarkup(el(MapAttribution));
  assert.ok(html.includes('https://maps.gsi.go.jp/development/ichiran.html'));
  assert.ok(html.includes('地理院タイル'));
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes('rel="noreferrer"'));
});

test('F3: 出典リンクの全状態はPrimary tone 40を使い、既存の下線とフォーカス枠を維持する', () => {
  const css = readFileSync(new URL('../src/map/map.css', import.meta.url), 'utf8');
  const tone40 = 'var(--md-sys-color-primary-tone-40)';

  for (const selector of [
    '.attribution-link',
    '.attribution-link:visited',
    '.attribution-link:hover',
    '.attribution-link:focus-visible',
  ]) {
    const escapedSelector = selector.replace(/[.:-]/g, '\\$&');
    assert.match(
      css,
      new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?color: ${tone40.replace(/[()]/g, '\\$&')};`),
    );
  }

  assert.match(css, /\.attribution-link\s*\{[\s\S]*?text-decoration: underline;/);
  assert.match(css, /\.attribution-link:hover\s*\{[\s\S]*?text-decoration: underline;/);
  assert.match(
    css,
    /\.attribution-link:focus-visible\s*\{[\s\S]*?outline: 2px solid var\(--md-sys-color-primary\);/,
  );
});

test('F6: ズームコントロールが境界ズームで正しく disabled になる', () => {
  // zoom 10 (通常) -> 両方 enabled
  const normalHtml = renderToStaticMarkup(
    el(MapZoomControls, {
      currentZoom: 10,
      minZoom: 9,
      maxZoom: 18,
      onZoomIn: () => {},
      onZoomOut: () => {},
      onReturnToVenue: () => {},
    }),
  );
  assert.equal(normalHtml.includes('disabled="" aria-label="地図を拡大"'), false);
  assert.equal(normalHtml.includes('disabled="" aria-label="地図を縮小"'), false);

  // zoom 9 (最小) -> 縮小 disabled
  const minHtml = renderToStaticMarkup(
    el(MapZoomControls, {
      currentZoom: 9,
      minZoom: 9,
      maxZoom: 18,
      onZoomIn: () => {},
      onZoomOut: () => {},
      onReturnToVenue: () => {},
    }),
  );
  assert.equal(minHtml.includes('disabled="" aria-label="地図を拡大"'), false);
  assert.ok(minHtml.includes('disabled="" aria-label="地図を縮小"'));

  // zoom 18 (最大) -> 拡大 disabled
  const maxHtml = renderToStaticMarkup(
    el(MapZoomControls, {
      currentZoom: 18,
      minZoom: 9,
      maxZoom: 18,
      onZoomIn: () => {},
      onZoomOut: () => {},
      onReturnToVenue: () => {},
    }),
  );
  assert.ok(maxHtml.includes('disabled="" aria-label="地図を拡大"'));
  assert.equal(maxHtml.includes('disabled="" aria-label="地図を縮小"'), false);

  // 会場復帰ボタンの aria-label と常時テキスト非表示の確認
  assert.ok(maxHtml.includes('aria-label="会場の初期位置に戻る"'));
  // ボタン要素内にテキスト文字「会場へ戻る」が直接描画されていないこと
  assert.equal(maxHtml.includes('>会場へ戻る<'), false);
  assert.equal(maxHtml.includes('>会場の初期位置に戻る<'), false);
});

test('F6: 既定の最小ズームは9であり、縮小ボタンはズーム9で無効になる', () => {
  const html = renderToStaticMarkup(
    el(MapZoomControls, {
      currentZoom: 9,
      onZoomIn: () => {},
      onZoomOut: () => {},
      onReturnToVenue: () => {},
    }),
  );

  assert.ok(html.includes('disabled="" aria-label="地図を縮小"'));
  assert.equal(html.includes('disabled="" aria-label="地図を拡大"'), false);
});
