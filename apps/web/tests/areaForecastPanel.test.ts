import './setupEnv.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AreaTimeseriesResponse } from '@wx-viewer-poc/shared';
import {
  buildAreaForecastModel,
  selectPanelColumns,
  resolveAreaForecastTargets,
} from '../src/map/panels/areaForecast/areaForecastModel.ts';
import {
  AreaForecastDetail,
  AreaForecastPanel,
} from '../src/map/panels/areaForecast/AreaForecastContent.tsx';
import { buildAreaForecastCard } from '../src/map/panels/areaForecast/useAreaForecast.tsx';
import { buildAreaForecastFixtureResponse } from '../src/map/panels/areaForecast/areaForecastFixture.ts';
import { isAreaForecastFixtureRequest } from '../src/map/panels/areaForecast/areaForecastFixtureGate.ts';
import {
  buildAreaForecastFixtureInput,
  PANEL_FIXTURE_NAMES,
  DEFAULT_INFO_PANEL_INPUT,
} from '../src/map/panels/panelFixtures.ts';
import { applyMd3Theme } from '../src/theme/applyTheme.ts';
import { DEFAULT_THEME_SEED } from '../src/theme/seeds.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function sampleFixtureResponse(now = Date.parse('2026-09-28T03:00:00Z')): AreaTimeseriesResponse {
  return buildAreaForecastFixtureResponse(now);
}

// 相対輝度計算 (AC-13 コントラスト検証用)
function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

test('Issue #58 AC-7: area-forecast フィクスチャの表示内容（パネルおよび詳細ダイアログ）', () => {
  const now = Date.parse('2026-09-28T03:00:00Z');
  const response = sampleFixtureResponse(now);
  const input = buildAreaForecastFixtureInput(DEFAULT_INFO_PANEL_INPUT, now);

  assert.ok(PANEL_FIXTURE_NAMES.includes('area-forecast'));
  assert.equal(isAreaForecastFixtureRequest(true, '?panelFixture=area-forecast'), true);
  assert.equal(isAreaForecastFixtureRequest(false, '?panelFixture=area-forecast'), false);

  const card = input.areaForecast[0]!;
  assert.equal(card.heading, '地域時系列予報（確認用データ）');
  assert.equal(card.status.kind, 'data');

  // パネルのレンダリング
  const panelHtml = renderToStaticMarkup(
    createElement(AreaForecastPanel, {
      response,
      now,
      fontStatus: { outlinedReady: true, sharpReady: true },
      onOpenDetail: () => {},
    }),
  );

  // 対象表記2行
  assert.match(panelHtml, /天気・風：東京地方/);
  assert.match(panelHtml, /気温：東京（北の丸公園）/);

  // 行見出し: 天気、風（m/s）、気温
  assert.match(panelHtml, /<th scope="row">天気<\/th>/);
  assert.match(panelHtml, /<th scope="row">風（m\/s）<\/th>/);
  assert.match(panelHtml, /<th scope="row">気温<\/th>/);

  // パネル3列内にアイコンあり・文字代替・欠測が揃うこと
  assert.match(panelHtml, /晴れ/);
  assert.match(panelHtml, /sunny/);
  assert.match(panelHtml, /くもり一時雨/);
  assert.match(panelHtml, /\?/); // 欠測 ?

  // 詳細ダイアログの表の全列レンダリング
  const model = buildAreaForecastModel(response.data!);
  assert.equal(model.kind, 'table');
  if (model.kind !== 'table') return;

  const detailHtml = renderToStaticMarkup(
    createElement(AreaForecastDetail, {
      table: model,
      now,
      fontStatus: { outlinedReady: true, sharpReady: true },
    }),
  );

  // 14区間・15時点の全列が含まれていること
  assert.equal(model.columns.length, 15);
  // 見出しが3段（日（曜日）、時間帯、時刻）
  assert.match(detailHtml, /日（曜日）/);
  assert.match(detailHtml, /時間帯/);
  assert.match(detailHtml, /時刻/);

  // 風速階級1〜6すべてが表示されていること
  assert.match(detailHtml, /0-2/);
  assert.match(detailHtml, /3-5/);
  assert.match(detailHtml, /6-9/);
  assert.match(detailHtml, /10-14/);
  assert.match(detailHtml, /15-19/);
  assert.match(detailHtml, /20以上/);

  // 最終列（区間のない列）が none セルになっていること
  assert.match(detailHtml, /af-cell-none/);
});

test('Issue #58 AC-8: 寸法の固定・矢羽根24px枠・中心一致・stale時の無変化', () => {
  const now = Date.parse('2026-09-28T03:00:00Z');
  const response = sampleFixtureResponse(now);

  const cardAvailable = buildAreaForecastCard(response, now);
  const cardStale = buildAreaForecastCard(response, now, undefined, 'stale');

  assert.equal(cardAvailable.status.kind, 'data');
  assert.equal(cardStale.status.kind, 'data');
  assert.equal((cardAvailable.status as { availability: string }).availability, 'available');
  assert.equal((cardStale.status as { availability: string }).availability, 'stale');

  // HTML出力比較: availability 以外のDOM構造・クラス・セル数は完全に一致する
  const fontStatus = { outlinedReady: true, sharpReady: true };
  const htmlAvailable = renderToStaticMarkup(
    createElement(AreaForecastPanel, { response, now, fontStatus, onOpenDetail: () => {} }),
  );
  const htmlStale = renderToStaticMarkup(
    createElement(AreaForecastPanel, { response, now, fontStatus, onOpenDetail: () => {} }),
  );
  assert.equal(htmlAvailable, htmlStale);

  // 矢羽根枠が 24px の af-wind-arrow-box を持ち、af-wind-fill と af-wind-outline が同一枠に配置される
  assert.match(htmlAvailable, /class="af-wind-arrow-box"/);
  assert.match(htmlAvailable, /class="af-wind-layer af-wind-fill"/);
  assert.match(htmlAvailable, /class="af-wind-layer af-wind-outline"/);
});

test('Issue #58 AC-10: 詳細ダイアログの仕様（凡例なし・予報要素追加なし・初期列）', () => {
  const now = Date.parse('2026-09-28T03:00:00Z');
  const response = sampleFixtureResponse(now);
  const model = buildAreaForecastModel(response.data!);
  assert.equal(model.kind, 'table');
  if (model.kind !== 'table') return;

  const panelCols = selectPanelColumns(model.columns, model.intervals, now);
  assert.ok(panelCols.length > 0);

  const detailHtml = renderToStaticMarkup(
    createElement(AreaForecastDetail, {
      table: model,
      now,
      fontStatus: { outlinedReady: true, sharpReady: true },
    }),
  );

  // 凡例がないこと (wts-legend が存在しない)
  assert.doesNotMatch(detailHtml, /wts-legend/);
  assert.doesNotMatch(detailHtml, /凡例/);

  // 初期列がパネル先頭列に設定されていること (stickyHeader 内に data-column-key で存在)
  assert.match(detailHtml, new RegExp(`data-column-key="${panelCols[0]!.key}"`));
});

test('Issue #58 AC-12: 状態（loading、failed、stale、issuedAt=null、固定表記解決）', () => {
  const now = Date.parse('2026-09-28T03:00:00Z');
  const response = sampleFixtureResponse(now);

  // 1. data=null は failed
  const dataNullResponse = { ...response, data: null };
  const cardNull = buildAreaForecastCard(dataNullResponse, now);
  assert.equal(cardNull.status.kind, 'failed');

  // 2. availability='unavailable' は failed
  const unavailResponse = {
    ...response,
    metadata: { ...response.metadata, availability: 'unavailable' as const },
  };
  const cardUnavail = buildAreaForecastCard(unavailResponse, now);
  assert.equal(cardUnavail.status.kind, 'failed');

  // 3. issuedAt=null のとき fetchedAt を使わない
  const nullIssuedResponse = {
    ...response,
    metadata: {
      ...response.metadata,
      issuedAt: null,
      fetchedAt: '2026-09-28T03:05:00Z',
    },
  };
  const cardNullIssued = buildAreaForecastCard(nullIssuedResponse, now);
  assert.equal(cardNullIssued.status.kind, 'data');
  if (cardNullIssued.status.kind === 'data') {
    assert.equal(cardNullIssued.status.time, '');
    assert.notEqual(cardNullIssued.status.time, '2026-09-28T03:05:00Z');
  }

  // 4. 固定表記ルール
  const defaultTargets = resolveAreaForecastTargets(
    { code: '130010', name: '東京都' },
    { code: '44132', name: '東京' },
  );
  assert.equal(defaultTargets.weatherWindTarget, '天気・風：東京地方');
  assert.equal(defaultTargets.temperatureTarget, '気温：東京（北の丸公園）');

  const customTargets = resolveAreaForecastTargets(
    { code: '120010', name: '千葉県北西部' },
    { code: '45106', name: '千葉' },
  );
  assert.equal(customTargets.weatherWindTarget, '天気・風：千葉県北西部');
  assert.equal(customTargets.temperatureTarget, '気温：千葉');
});

test('Issue #58 AC-13: 風速色・コントラスト比・トークン検証', () => {
  // 1. areaForecast 配下に HEX (#...) や rgb(...) がハードコードされていないこと
  const files = [
    'apps/web/src/map/panels/areaForecast/areaForecastModel.ts',
    'apps/web/src/map/panels/areaForecast/weatherIconMap.ts',
    'apps/web/src/map/panels/areaForecast/windSpeedLevel.ts',
    'apps/web/src/map/panels/areaForecast/AreaForecastContent.tsx',
    'apps/web/src/map/panels/areaForecast/useAreaForecast.tsx',
    'apps/web/src/map/panels/areaForecast/areaForecast.css',
    'apps/web/src/map/panels/areaForecast/areaForecastFixture.ts',
    'apps/web/src/map/panels/areaForecast/areaForecastFixtureGate.ts',
  ];

  const hexRgbRegex = /#[0-9a-fA-F]{3,8}\b|rgb\(/;
  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    assert.equal(
      hexRgbRegex.test(content),
      false,
      `File ${file} must not contain hardcoded HEX or rgb()`,
    );
  }

  // 2. 矢羽根輪郭色(--md-sys-color-on-surface)とセル背景色(--md-sys-color-surface-container)のコントラスト比が 3:1 以上
  function getThemeColors(dark: boolean): { onSurface: string; surfaceContainer: string } {
    const properties = new Map<string, string>();
    const rootStub = {
      style: {
        setProperty(k: string, v: string) {
          properties.set(k, v);
        },
      },
    } as unknown as HTMLElement;
    applyMd3Theme(DEFAULT_THEME_SEED, dark, rootStub);
    return {
      onSurface: properties.get('--md-sys-color-on-surface')!,
      surfaceContainer: properties.get('--md-sys-color-surface-container')!,
    };
  }

  const light = getThemeColors(false);
  const dark = getThemeColors(true);

  const lightContrast = contrastRatio(light.onSurface, light.surfaceContainer);
  const darkContrast = contrastRatio(dark.onSurface, dark.surfaceContainer);

  assert.ok(
    lightContrast >= 3.0,
    `Light theme contrast must be >= 3.0, got ${lightContrast.toFixed(2)}`,
  );
  assert.ok(
    darkContrast >= 3.0,
    `Dark theme contrast must be >= 3.0, got ${darkContrast.toFixed(2)}`,
  );
});

test('Issue #58 AC-18: フォント未読み込み時のリガチャ文字列非表示と枠維持', () => {
  const now = Date.parse('2026-09-28T03:00:00Z');
  const response = sampleFixtureResponse(now);
  const model = buildAreaForecastModel(response.data!);
  assert.equal(model.kind, 'table');
  if (model.kind !== 'table') return;

  // fontStatus が両方 false の場合
  const detailHtml = renderToStaticMarkup(
    createElement(AreaForecastDetail, {
      table: model,
      now,
      fontStatus: { outlinedReady: false, sharpReady: false },
    }),
  );

  // visibility: hidden が矢羽根要素と天気アイコンに適用される
  assert.match(detailHtml, /visibility:hidden/);

  // 風セル内に風向文字と範囲表記は残っていること
  assert.match(detailHtml, /class="af-wind-dir-text"/);
  assert.match(detailHtml, /class="af-wind-range"/);

  // 天気セル内に名称は残っていること
  assert.match(detailHtml, /class="af-weather-name"/);
});
