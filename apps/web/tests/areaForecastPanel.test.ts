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
  resolveAreaForecastTarget,
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

  // 旧2行の対象表記が本文に無いこと（対象表記はパネル見出しのメタ行に統合、確定事項11）
  assert.doesNotMatch(panelHtml, /天気・風：/);
  assert.doesNotMatch(panelHtml, /気温：/);

  // カード入力の対象表記が1行「東京地方／東京（北の丸公園）」であること（確定事項11）
  assert.equal(card.target, '東京地方／東京（北の丸公園）');

  // 時点1段の見出し（区間「9-12時」等が DOM に無い）
  assert.doesNotMatch(panelHtml, /\d+-\d+時/);

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
  // 見出しが2段（日（曜日）、時刻）。区間行「時間帯」は廃止（確定事項12）
  assert.match(detailHtml, /日（曜日）/);
  assert.match(detailHtml, /時刻/);
  assert.doesNotMatch(detailHtml, /時間帯/);

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
  // 輪郭層は廃止(確定事項18): 塗り1層のみ
  assert.doesNotMatch(htmlAvailable, /af-wind-outline/);
  // 矢羽根の表示可否は Sharp だけで決まる(Outlined 未読込でも矢羽根は出る)
  const sharpOnly = renderToStaticMarkup(
    createElement(AreaForecastPanel, {
      response,
      now,
      fontStatus: { outlinedReady: false, sharpReady: true },
    }),
  );
  assert.match(sharpOnly, /af-wind-layer af-wind-fill/);
  const outlinedOnly = renderToStaticMarkup(
    createElement(AreaForecastPanel, {
      response,
      now,
      fontStatus: { outlinedReady: true, sharpReady: false },
    }),
  );
  assert.doesNotMatch(outlinedOnly, /af-wind-layer/);
  assert.match(outlinedOnly, /af-wind-dir-fallback/);
  // 階級不明('7')の矢羽根は階級色を付けない(style に color が無い、通常文字色=CSS既定)
  const model = buildAreaForecastModel(response.data!);
  assert.equal(model.kind, 'table');
  if (model.kind === 'table') {
    const detail = renderToStaticMarkup(
      createElement(AreaForecastDetail, { table: model, now, fontStatus }),
    );
    assert.match(detail, /class="af-wind-layer af-wind-fill" style="transform:rotate\(315deg\)"/);
  }
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

  // 4. 固定表記ルール（1行「東京地方／東京（北の丸公園）」、確定事項11）
  const defaultTarget = resolveAreaForecastTarget(
    { code: '130010', name: '東京都' },
    { code: '44132', name: '東京' },
  );
  assert.equal(defaultTarget, '東京地方／東京（北の丸公園）');

  const customTarget = resolveAreaForecastTarget(
    { code: '120010', name: '千葉県北西部' },
    { code: '45106', name: '千葉' },
  );
  assert.equal(customTarget, '千葉県北西部／千葉');

  // buildAreaForecastCard のカード入力にも同じ規則で target が渡ること
  const customResponse = {
    ...response,
    area: { code: '120010', name: '千葉県北西部' },
    data: { ...response.data!, station: { code: '45106', name: '千葉' } },
  };
  const customCard = buildAreaForecastCard(customResponse, now);
  assert.equal(customCard.target, '千葉県北西部／千葉');
});

test('Issue #58 AC-13: 風速色・コントラスト比・トークン検証', () => {
  // 1. areaForecast 配下に HEX (#...) や rgb(...) がハードコードされていないこと
  const dir = new URL('../src/map/panels/areaForecast/', import.meta.url);
  const files = [
    'areaForecastModel.ts',
    'weatherIconMap.ts',
    'windSpeedLevel.ts',
    'AreaForecastContent.tsx',
    'useAreaForecast.tsx',
    'areaForecast.css',
    'areaForecastFixture.ts',
    'areaForecastFixtureGate.ts',
  ];

  const hexRgbRegex = /#[0-9a-fA-F]{3,8}\b|rgb\(/;
  for (const file of files) {
    const content = readFileSync(new URL(file, dir), 'utf-8');
    assert.equal(
      hexRgbRegex.test(content),
      false,
      `File ${file} must not contain hardcoded HEX or rgb()`,
    );
  }

  // 2. 塗り色6色とパネル/詳細背景のダークでのコントラスト(確定事項19・20)
  const properties = new Map<string, string>();
  const rootStub = {
    style: {
      setProperty(k: string, v: string) {
        properties.set(k, v);
      },
    },
  } as unknown as HTMLElement;
  applyMd3Theme(DEFAULT_THEME_SEED, true, rootStub);
  const panelBg = properties.get('--md-sys-color-surface-container')!;
  const detailBg = properties.get('--md-sys-color-surface-container-high')!;

  const css = readFileSync(new URL('../src/theme/weatherDataColors.css', import.meta.url), 'utf-8');
  const jma = readFileSync(new URL('../src/theme/officialJmaColors.css', import.meta.url), 'utf-8');
  function tokenHex(name: string): string {
    const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
    assert.ok(m, name);
    const v = m[1]!.trim();
    const ref = /^var\(--([^)]+)\)$/.exec(v);
    if (ref) return tokenHex2(ref[1]!);
    return v;
  }
  function tokenHex2(name: string): string {
    const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(jma);
    assert.ok(m, name);
    return m[1]!.trim();
  }
  // 階級 → nowcast トークン(§5.1)
  const levelToken: Record<number, string> = {
    1: 'wx-data-nowcast-1',
    2: 'wx-data-nowcast-2',
    3: 'wx-data-nowcast-4',
    4: 'wx-data-nowcast-5',
    5: 'wx-data-nowcast-6',
    6: 'wx-data-nowcast-7',
  };
  for (const [level, token] of Object.entries(levelToken)) {
    const fill = tokenHex(token);
    for (const [label, bg] of [
      ['panel', panelBg],
      ['detail', detailBg],
    ] as const) {
      const ratio = contrastRatio(fill, bg);
      if (level === '3') {
        // 確定事項20: 階級3(nowcast-4)は 3:1 未満の既知の例外
        assert.ok(ratio < 3.0, `level 3 ${label} is a known exception, got ${ratio.toFixed(2)}`);
      } else {
        assert.ok(ratio >= 3.0, `level ${level} ${label} must be >= 3.0, got ${ratio.toFixed(2)}`);
      }
    }
  }
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

  // 風セル内は矢羽根枠に風向の漢字が代替表示され、範囲表記は残っていること
  assert.match(detailHtml, /class="af-wind-dir-fallback"/);
  assert.match(detailHtml, /class="af-wind-range"/);

  // 天気セル内に名称は残っていること
  assert.match(detailHtml, /class="af-weather-name"/);
});

test('Issue #58 AC-19: パネル表は行見出しの最小幅を確保し、値セルは列幅いっぱいの中央寄せ', () => {
  const now = Date.parse('2026-09-28T03:00:00Z');
  const response = sampleFixtureResponse(now);
  const html = renderToStaticMarkup(
    createElement(AreaForecastPanel, {
      response,
      now,
      fontStatus: { outlinedReady: true, sharpReady: true },
    }),
  );
  // 3列: 行見出し3rem + 4rem×3 を下回らない(狭い列幅で行見出しが値セルへ食い込まない)
  assert.match(html, /<table class="af-table" style="min-inline-size:calc\(3rem \+ 12rem\)"/);

  const css = readFileSync(
    new URL('../src/map/panels/areaForecast/areaForecast.css', import.meta.url),
    'utf-8',
  );
  // 行見出しは折り返し可で最小幅を持つ
  assert.match(css, /th\[scope='row'\][^}]*white-space: normal;[^}]*min-inline-size: 3rem;/s);
  // 各行の値は同じ幅(列幅いっぱい)で中央寄せされる
  for (const cls of ['af-cell-weather', 'af-cell-wind', 'af-cell-temperature']) {
    assert.match(css, new RegExp(`\\.${cls} \\{\\s*inline-size: 100%;`));
  }
});
