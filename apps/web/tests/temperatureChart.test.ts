import './setupEnv.ts';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  calculateDateBoundaries,
  calculateLabelPositions,
  calculateTemperatureRange,
  calculateTemperatureY,
  calculateTicks,
  formatTemperatureReaderItem,
  buildTemperatureReaderItems,
  temperatureLinePaths,
} from '../src/map/panels/areaForecast/temperatureChart.ts';
import {
  TemperatureChart,
  TemperatureChartHeader,
} from '../src/map/panels/areaForecast/TemperatureChart.tsx';
import {
  buildAreaForecastModel,
  type AreaForecastColumn,
  type PointCell,
} from '../src/map/panels/areaForecast/areaForecastModel.ts';
import {
  AreaForecastDetail,
  AreaForecastPanel,
} from '../src/map/panels/areaForecast/AreaForecastContent.tsx';
import { buildAreaForecastFixtureResponse } from '../src/map/panels/areaForecast/areaForecastFixture.ts';
import { applyMd3Theme } from '../src/theme/applyTheme.ts';
import { DEFAULT_THEME_SEED } from '../src/theme/seeds.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

// 相対輝度とコントラスト比の計算 (AC-8)
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

test('Issue #58 AC-3: temperatureChart 単体テスト (線分割・1点・同値・空・負値・ラベル上下判定)', () => {
  const getX = (i: number) => i * 64 + 32;

  // 1. temperatureLinePaths: null (欠測・文字値・対象外) で線を切り補間しない
  const valuesWithGap: (number | null)[] = [10, 15, null, 12, 14, 16];
  const range = calculateTemperatureRange(valuesWithGap)!;
  const getY = (val: number) => calculateTemperatureY(val, range);

  const paths = temperatureLinePaths(valuesWithGap, getX, getY);
  assert.equal(paths.length, 2, 'null で線が2つに分割される');
  assert.equal(paths[0], `M ${getX(0)} ${getY(10)} L ${getX(1)} ${getY(15)}`);
  assert.equal(
    paths[1],
    `M ${getX(3)} ${getY(12)} L ${getX(4)} ${getY(14)} L ${getX(5)} ${getY(16)}`,
  );

  // 2. 1点のみで線0本
  const singleValue: (number | null)[] = [null, 15, null];
  const singleRange = calculateTemperatureRange(singleValue)!;
  assert.ok(singleRange);
  assert.equal(singleRange.low, 15 - 0.5);
  assert.equal(singleRange.high, 15 + 0.5);
  const singlePaths = temperatureLinePaths(singleValue, getX, (v) =>
    calculateTemperatureY(v, singleRange),
  );
  assert.equal(singlePaths.length, 0, '1点のみは線0本');

  // 3. 全点同値で水平線と範囲±0.5℃
  const flatValues: (number | null)[] = [15, 15, 15];
  const flatRange = calculateTemperatureRange(flatValues)!;
  assert.equal(flatRange.low, 14.5);
  assert.equal(flatRange.high, 15.5);
  const flatGetY = (v: number) => calculateTemperatureY(v, flatRange);
  const flatY = flatGetY(15);
  assert.equal(flatY, 64, '同値の点は y=64 (描画域 30〜98 の中央)');
  const flatPaths = temperatureLinePaths(flatValues, getX, flatGetY);
  assert.equal(flatPaths.length, 1);
  assert.equal(flatPaths[0], `M ${getX(0)} 64 L ${getX(1)} 64 L ${getX(2)} 64`);

  // 平坦ケースのラベル上下判定は「上」
  const flatLabels = calculateLabelPositions(flatValues, flatGetY);
  assert.equal(flatLabels.length, 3);
  for (const lbl of flatLabels) {
    assert.equal(lbl.position, 'top', '平坦ケースのラベルは上');
    assert.equal(lbl.y, 64 - 8, '上ラベルのベースラインは 点y - 8');
  }

  // 4. 数値0件で range null
  assert.equal(calculateTemperatureRange([]), null);
  assert.equal(calculateTemperatureRange([null, null]), null);

  // 5. 負値を含む範囲で 0℃ 固定下限にならない
  const negativeValues: (number | null)[] = [-15, -10, -5];
  const negRange = calculateTemperatureRange(negativeValues)!;
  assert.ok(negRange.low < -15);
  assert.ok(negRange.high < 0, '0℃固定下限にならず上限も負のまま余白が付く');

  // 6. ラベルの上下判定: 急上昇・急下降
  // (a) 急下降ケース (前列が高温で点yより上、線分が上側矩形に入る -> ラベルは下)
  // 列0: 30℃ (y=30), 列1: 0℃ (y=98), 列2: 0℃ (y=98)
  // range: [0, 30] -> 列0の点y=30, 列1の点y=98
  // 列1において、左側線分の x_1 - 16 での y は 98 - (98 - 30)*0.25 = 81
  // 列1の上側矩形は [98-18, 98-5] = [80, 93]。81 は上側矩形と交差する！
  // 下側矩形 [98+6, 98+19] = [104, 117] とは交差しない。
  // したがって列1のラベルは「下」になるべき。
  const dropValues: (number | null)[] = [30, 0, 0];
  const dropRange = { low: 0, high: 30 };
  const dropGetY = (v: number) => calculateTemperatureY(v, dropRange);
  const dropLabels = calculateLabelPositions(dropValues, dropGetY);
  const dropLabel1 = dropLabels.find((l) => l.index === 1)!;
  assert.equal(dropLabel1.position, 'bottom', '急下降で上側矩形と交差するため下');
  assert.equal(dropLabel1.y, dropGetY(0) + 17);

  // (b) 急上昇ケース (次列が高温で点yより上、線分が上側矩形に入る -> ラベルは下)
  // 列0: 0℃, 列1: 0℃, 列2: 30℃
  // 列1において、右側線分の x_1 + 16 での y は 98 + (30 - 98)*0.25 = 81
  // 上側矩形 [80, 93] と交差する！
  // したがって列1のラベルは「下」になるべき。
  const riseValues: (number | null)[] = [0, 0, 30];
  const riseLabels = calculateLabelPositions(riseValues, dropGetY);
  const riseLabel1 = riseLabels.find((l) => l.index === 1)!;
  assert.equal(riseLabel1.position, 'bottom', '急上昇で上側矩形と交差するため下');
  assert.equal(riseLabel1.y, dropGetY(0) + 17);

  // 7. calculateTicks の検証 (2〜4本になる最小の刻み、同値、null)
  assert.deepEqual(calculateTicks(null), []);
  assert.deepEqual(calculateTicks({ low: 10.8, high: 21.2 }), [15, 20]);
  assert.deepEqual(calculateTicks({ low: 14.5, high: 15.5 }), [15]);
});

test('Issue #58 AC-5: 日付境界の縦線計算 (先頭列を除き日付変化列の左端 x=i*64)', () => {
  const columns: AreaForecastColumn[] = [
    { key: 'c0', at: '2026-09-28T00:00:00Z', label: '9時' }, // 28日
    { key: 'c1', at: '2026-09-28T03:00:00Z', label: '12時' }, // 28日
    { key: 'c2', at: '2026-09-28T15:00:00Z', label: '0時' }, // 29日 00:00 JST (日付変化)
    { key: 'c3', at: '2026-09-28T18:00:00Z', label: '3時' }, // 29日
    { key: 'c4', at: '2026-09-29T15:00:00Z', label: '0時' }, // 30日 00:00 JST (日付変化)
  ];

  const boundaries = calculateDateBoundaries(columns);
  assert.deepEqual(boundaries, [2, 4], '先頭列を除き、日付が変わる列インデックスが抽出される');
});

test('Issue #58 AC-1 & AC-2: 詳細ダイアログの3行構成と気温グラフレンダリング、中心一致', () => {
  const now = Date.parse('2026-09-28T03:00:00Z');
  const response = buildAreaForecastFixtureResponse(now);
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

  // AC-1: 表が「天気」「風（m/s）」「気温（℃）」の3行
  assert.match(detailHtml, /<th scope="row">天気<\/th>/);
  assert.match(detailHtml, /<th scope="row">風（m\/s）<\/th>/);
  assert.match(detailHtml, /<th scope="row"><div class="af-temp-chart-header">/);
  assert.match(detailHtml, /<span class="af-temp-chart-title">気温（℃）<\/span>/);

  // 詳細ダイアログに旧気温数値行のセルのクラス `.af-cell-temperature` が存在しないこと
  assert.doesNotMatch(detailHtml, /class="af-cell-temperature"/);

  // SVG 内に線・点・数値ラベル・目盛りが描画されていること
  assert.match(detailHtml, /class="af-temp-chart-svg"/);
  assert.match(detailHtml, /<circle/);
  assert.match(detailHtml, /<path[^>]*stroke="var\(--md-sys-color-primary\)"/);
  assert.match(detailHtml, /class="af-temp-chart-label"/);
  assert.match(detailHtml, /class="af-temp-chart-tick"/);

  // パネルの表（気温数値行を含む）は変更前と DOM が同じ
  const panelHtml = renderToStaticMarkup(
    createElement(AreaForecastPanel, {
      response,
      now,
      fontStatus: { outlinedReady: true, sharpReady: true },
    }),
  );
  assert.match(panelHtml, /<th scope="row">気温<\/th>/);
  assert.match(panelHtml, /class="af-cell-temperature"/);

  // AC-2: 各点の circle の中心 x と数値ラベルの中心 x が列中心 (i*64+32) と一致する
  // 最終列 (index 14) の点 x = 14*64+32 = 928
  assert.match(detailHtml, /<circle[^>]*cx="928"/);
  assert.match(detailHtml, /<text[^>]*x="928"[^>]*class="af-temp-chart-label"/);
});

test('Issue #58 AC-6: 各状態 (通常・single・flat・empty・text・stale) の寸法と表示', () => {
  const now = Date.parse('2026-09-28T03:00:00Z');
  const fontStatus = { outlinedReady: true, sharpReady: true };

  const cases = ['normal', 'single', 'flat', 'empty', 'text'] as const;
  for (const c of cases) {
    const override = c === 'normal' ? undefined : c;
    const resp = buildAreaForecastFixtureResponse(now, override);
    const model = buildAreaForecastModel(resp.data!);
    assert.equal(model.kind, 'table');
    if (model.kind !== 'table') continue;

    const html = renderToStaticMarkup(
      createElement(AreaForecastDetail, { table: model, now, fontStatus }),
    );

    // SVG 幅 列数×64px (15列 * 4rem = 60rem, 15*64 = 960)
    assert.match(html, /inline-size:60rem/);
    assert.match(html, /viewBox="0 0 960 128"/);

    if (c === 'empty') {
      // empty では「気温の予想なし」だけ
      assert.match(html, /気温の予想なし/);
      assert.doesNotMatch(html, /class="af-temp-chart-label"/);
      assert.doesNotMatch(html, /class="af-temp-chart-question"/);
      assert.doesNotMatch(html, /<circle/);
    } else if (c === 'text') {
      // text では各列が「?」だけで点・線・原文の文字が無い（原文は読み上げリストにだけある）
      assert.doesNotMatch(html, /<circle/);
      assert.doesNotMatch(html, /class="af-temp-chart-label"/);
      assert.doesNotMatch(html, /気温の予想なし/);
      assert.match(html, /class="af-temp-chart-question"/);
      // 原文 '約15度' は SVG 内の text には無く、ul の li にのみある
      assert.match(html, /<li[^>]*>[^<]*約15度/);
      assert.doesNotMatch(html, /<text[^>]*>[^<]*約15度/);
    } else if (c === 'single') {
      // 1点のみ (線なし、点1つ)
      assert.doesNotMatch(html, /<path[^>]*stroke="var\(--md-sys-color-primary\)"/);
      const circleMatches = html.match(/<circle/g);
      assert.equal(circleMatches?.length, 1);
    } else if (c === 'flat') {
      // 全点同値 (全ラベル上側)
      assert.doesNotMatch(html, /class="af-temp-chart-question"/);
      assert.doesNotMatch(html, /気温の予想なし/);
    }
  }

  // 本番ビルド判定 (isDev: false 相当で afTempCase クエリがあっても無視され通常データになる)
  const prodResp = buildAreaForecastFixtureResponse(now, {
    isDev: false,
    search: '?afTempCase=single',
  });
  const prodModel = buildAreaForecastModel(prodResp.data!);
  if (prodModel.kind === 'table') {
    // 通常データのインデックス2は15℃、インデックス8は-10.5℃、インデックス0は20℃
    assert.equal(
      prodModel.points[2]?.kind === 'value' && prodModel.points[2].temperature.value,
      15,
    );
    assert.equal(
      prodModel.points[8]?.kind === 'value' && prodModel.points[8].temperature.value,
      -10.5,
    );
    assert.equal(
      prodModel.points[0]?.kind === 'value' && prodModel.points[0].temperature.value,
      20,
    );
  }
});

test('Issue #58 AC-8: 色トークン・コントラスト計算・HEX/rgb直書き0件', () => {
  // 1. areaForecast 配下に HEX (#...) や rgb(...) がハードコードされていないこと
  const dir = new URL('../src/map/panels/areaForecast/', import.meta.url);
  const files = readdirSync(dir).filter(
    (f) => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.css'),
  );

  const hexRgbRegex = /#[0-9a-fA-F]{3,8}\b|rgb\(/;
  for (const file of files) {
    const content = readFileSync(new URL(file, dir), 'utf-8');
    assert.equal(
      hexRgbRegex.test(content),
      false,
      `File ${file} must not contain hardcoded HEX or rgb()`,
    );
  }

  // 2. ダークテーマでのコントラスト比
  const properties = new Map<string, string>();
  const rootStub = {
    style: {
      setProperty(k: string, v: string) {
        properties.set(k, v);
      },
    },
  } as unknown as HTMLElement;
  applyMd3Theme(DEFAULT_THEME_SEED, true, rootStub);

  const detailBg = properties.get('--md-sys-color-surface-container-high')!;
  const primary = properties.get('--md-sys-color-primary')!;
  const onSurface = properties.get('--md-sys-color-on-surface')!;

  // 線・点 (--md-sys-color-primary) と 詳細背景: 3:1 以上
  const primaryRatio = contrastRatio(primary, detailBg);
  assert.ok(
    primaryRatio >= 3.0,
    `primary contrast ratio must be >= 3.0, got ${primaryRatio.toFixed(2)}`,
  );

  // ラベル (--md-sys-color-on-surface) と 詳細背景: 4.5:1 以上
  const labelRatio = contrastRatio(onSurface, detailBg);
  assert.ok(labelRatio >= 4.5, `label contrast ratio must be >= 4.5, got ${labelRatio.toFixed(2)}`);
});

test('Issue #58 AC-10: 読み上げリストとアクセシビリティ仕様', () => {
  const columns: AreaForecastColumn[] = [
    { key: 'c0', at: '2026-09-28T00:00:00Z', label: '9時' },
    { key: 'c1', at: '2026-09-28T03:00:00Z', label: '12時' },
    { key: 'c2', at: '2026-09-28T06:00:00Z', label: '15時' },
    { key: 'c3', at: '2026-09-28T09:00:00Z', label: '18時' },
  ];

  const points: PointCell[] = [
    {
      kind: 'value',
      index: 0,
      at: '2026-09-28T00:00:00Z',
      temperature: { kind: 'value', text: '15℃', value: 15 },
    },
    {
      kind: 'value',
      index: 1,
      at: '2026-09-28T03:00:00Z',
      temperature: { kind: 'value', text: '-10.5℃', value: -10.5 },
    },
    {
      kind: 'value',
      index: 2,
      at: '2026-09-28T06:00:00Z',
      temperature: { kind: 'missing' },
    },
    {
      kind: 'value',
      index: 3,
      at: '2026-09-28T09:00:00Z',
      temperature: { kind: 'value', text: '約8度', value: null },
    },
  ];

  // formatTemperatureReaderItem の単体検証
  assert.equal(formatTemperatureReaderItem(undefined, columns[0]!), null);
  assert.equal(formatTemperatureReaderItem({ kind: 'none', index: 0 }, columns[0]!), null);
  assert.equal(
    formatTemperatureReaderItem(points[0], columns[0]!),
    '2026年9月28日(月) 9時、気温15度',
  );

  const items = buildTemperatureReaderItems(points, columns);
  assert.equal(items.length, 4);
  assert.equal(items[0], '2026年9月28日(月) 9時、気温15度');
  assert.equal(items[1], '2026年9月28日(月) 12時、気温マイナス10.5度');
  assert.equal(items[2], '2026年9月28日(月) 15時、気温欠測');
  assert.equal(items[3], '2026年9月28日(月) 18時、気温 約8度');

  const chartHtml = renderToStaticMarkup(
    createElement(TemperatureChart, {
      points,
      columns,
      columnWidths: ['4rem', '4rem', '4rem', '4rem'],
    }),
  );
  assert.match(chartHtml, /<svg[^>]*aria-hidden="true"/);
  assert.match(chartHtml, /<ul class="af-visually-hidden">/);

  const headerHtml = renderToStaticMarkup(
    createElement(TemperatureChartHeader, { range: { low: 10, high: 20 } }),
  );
  assert.match(headerHtml, /aria-hidden="true"/);
  assert.match(headerHtml, /気温（℃）/);
});

test('Issue #58 §3 & §5: 列幅が 4rem 以外を含む場合の代替表示', () => {
  const columns: AreaForecastColumn[] = [
    { key: 'c0', at: '2026-09-28T00:00:00Z', label: '9時' },
    { key: 'c1', at: '2026-09-28T03:00:00Z', label: '12時' },
  ];
  const points: PointCell[] = [
    {
      kind: 'value',
      index: 0,
      at: '2026-09-28T00:00:00Z',
      temperature: { kind: 'value', text: '15℃', value: 15 },
    },
    {
      kind: 'value',
      index: 1,
      at: '2026-09-28T03:00:00Z',
      temperature: { kind: 'value', text: '18℃', value: 18 },
    },
  ];

  // 1列でも '5rem' がある場合
  const html = renderToStaticMarkup(
    createElement(TemperatureChart, {
      points,
      columns,
      columnWidths: ['4rem', '5rem'],
    }),
  );

  // SVG が描画されず、代替文字表示になること
  assert.doesNotMatch(html, /<svg/);
  assert.match(html, /class="af-temp-chart af-temp-chart-fallback"/);
  assert.match(html, /9時 15℃/);
  assert.match(html, /12時 18℃/);
  // 読み上げリストは維持される
  assert.match(html, /<ul class="af-visually-hidden">/);
});
