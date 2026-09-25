import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WarningCurrentItem, WarningsResponse } from '@wx-viewer-poc/shared';

(globalThis as unknown as { React: typeof React }).React = React;

import { parseWarningsResponse } from '../src/api/warnings';
import {
  WARNING_BADGE_TABLE,
  buildWarningBadges,
  buildWarningCards,
  resolveWarningChange,
} from '../src/map/panels/warning/warningBadges';
import { InfoPanelColumn } from '../src/map/panels/InfoPanelColumn';
import { DEFAULT_INFO_PANEL_INPUT } from '../src/map/panels/panelFixtures';

const el = React.createElement;

function item(overrides: Partial<WarningCurrentItem> = {}): WarningCurrentItem {
  return {
    sequence: 0,
    kindCode: '14',
    kindName: '雷注意報',
    kindStatus: '継続',
    lastKindCode: null,
    lastKindName: null,
    kindIssuedAt: null,
    sourceTelegram: 'test',
    ...overrides,
  };
}

function response(overrides: Partial<WarningsResponse> = {}): WarningsResponse {
  return {
    terminalId: 'east-term',
    venueId: 'east',
    controlStatus: 'normal',
    isTraining: false,
    evaluatedAt: '2026-09-25T05:10:00.000Z',
    area: { code: '130108', name: '江東区' },
    metadata: {
      source: null,
      issuedAt: '2026-09-25T05:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-25T05:20:00.000Z',
      lastSuccessAt: '2026-09-25T05:20:00.000Z',
      availability: 'available',
      sourceVersion: null,
    },
    data: { items: [] },
    capabilities: { unsupportedKindCodes: ['04', '18'], supplementSource: 'warning-timeseries' },
    ...overrides,
  };
}

// §6 のW1〜W6 (W7は表外)
const W1 = item({ kindCode: '14', kindStatus: '継続', lastKindCode: null });
const W2 = item({ kindCode: '03', kindStatus: '発表', lastKindCode: '10' });
const W3 = item({ kindCode: '29', kindStatus: '発表', lastKindCode: null });
const W4 = item({ kindCode: '48', kindStatus: '継続', lastKindCode: null });
const W5 = item({ kindCode: '38', kindStatus: '継続', lastKindCode: null });
const W6 = item({ kindCode: '15', kindStatus: '警報から注意報', lastKindCode: '05' });
const W7 = item({ kindCode: '99', kindStatus: '発表', lastKindCode: null });

const EXPECTED_ORDER = [
  'レベル5高潮特別警報',
  'レベル4高潮危険警報',
  'レベル3大雨警報',
  'レベル2土砂災害注意報',
  '雷注意報',
  '強風注意報',
];

// AC-2: 並び順
test('buildWarningBadges: 逆順入力でも段階順・段階内固定順に並ぶ', () => {
  const reversed = [W6, W5, W4, W3, W2, W1, W7];
  const { badges, unknownCodes } = buildWarningBadges(reversed);
  assert.deepEqual(
    badges.map((b) => b.label),
    EXPECTED_ORDER,
  );
  assert.deepEqual(unknownCodes, ['99']);
});

test('buildWarningBadges: シャッフル順でも段階順・段階内固定順に並ぶ', () => {
  const shuffled = [W3, W7, W1, W5, W2, W6, W4];
  const { badges, unknownCodes } = buildWarningBadges(shuffled);
  assert.deepEqual(
    badges.map((b) => b.label),
    EXPECTED_ORDER,
  );
  assert.deepEqual(unknownCodes, ['99']);
});

// AC-3: コード表
test('WARNING_BADGE_TABLE: §3.3の36コードとレベル冠の12コードを持つ', () => {
  const codes = Object.keys(WARNING_BADGE_TABLE);
  assert.equal(codes.length, 36);

  const levelPrefixed = codes.filter((c) => /^レベル[2-5]/.test(WARNING_BADGE_TABLE[c].label));
  assert.deepEqual(
    levelPrefixed.sort(),
    ['03', '08', '09', '10', '19', '29', '33', '38', '39', '43', '48', '49'].sort(),
  );
});

test('WARNING_BADGE_TABLE: API側WARNING_CODE_TABLEと共通するコードの段階が対応する', () => {
  // apps/api/src/polling/jmaWarningCurrentReducer.ts の WARNING_CODE_TABLE を書き写した値
  // (API モジュールは import しない)
  const apiLevelByCode: Record<string, number> = {
    '10': 1,
    '03': 2,
    '43': 3,
    '33': 4,
    '29': 1,
    '09': 2,
    '49': 3,
    '39': 4,
    '19': 1,
    '08': 2,
    '48': 3,
    '38': 4,
    '13': 1,
    '02': 2,
    '32': 4,
    '15': 1,
    '05': 2,
    '35': 4,
    '16': 1,
    '07': 2,
    '37': 4,
    '12': 1,
    '06': 2,
    '36': 4,
    '14': 1,
    '17': 1,
    '20': 1,
    '21': 1,
    '22': 1,
    '23': 1,
    '24': 1,
    '25': 1,
    '26': 1,
    '27': 1,
  };
  const stageToLevel: Record<string, number> = {
    advisory: 1,
    warning: 2,
    danger: 3,
    special: 4,
  };
  for (const [code, level] of Object.entries(apiLevelByCode)) {
    const def = WARNING_BADGE_TABLE[code];
    assert.ok(def, `コード ${code} が表にありません`);
    assert.equal(stageToLevel[def.stage], level, `コード ${code} の段階が不一致`);
  }
});

test('WARNING_BADGE_TABLE: 全36コードのラベルが設計書§3.3の表と完全一致する', () => {
  // 設計書 §3.3 の表をそのまま転記した期待値
  const expectedLabels: Record<string, string> = {
    // special
    '32': '暴風雪特別警報',
    '33': 'レベル5大雨特別警報',
    '35': '暴風特別警報',
    '36': '大雪特別警報',
    '37': '波浪特別警報',
    '38': 'レベル5高潮特別警報',
    '39': 'レベル5土砂災害特別警報',
    // danger
    '43': 'レベル4大雨危険警報',
    '48': 'レベル4高潮危険警報',
    '49': 'レベル4土砂災害危険警報',
    // warning
    '02': '暴風雪警報',
    '03': 'レベル3大雨警報',
    '04': '洪水警報',
    '05': '暴風警報',
    '06': '大雪警報',
    '07': '波浪警報',
    '08': 'レベル3高潮警報',
    '09': 'レベル3土砂災害警報',
    // advisory
    '10': 'レベル2大雨注意報',
    '19': 'レベル2高潮注意報',
    '29': 'レベル2土砂災害注意報',
    '12': '大雪注意報',
    '13': '風雪注意報',
    '14': '雷注意報',
    '15': '強風注意報',
    '16': '波浪注意報',
    '17': '融雪注意報',
    '18': '洪水注意報',
    '20': '濃霧注意報',
    '21': '乾燥注意報',
    '22': 'なだれ注意報',
    '23': '低温注意報',
    '24': '霜注意報',
    '25': '着氷注意報',
    '26': '着雪注意報',
    '27': 'その他の注意報',
  };
  assert.equal(Object.keys(expectedLabels).length, 36);
  for (const [code, label] of Object.entries(expectedLabels)) {
    const def = WARNING_BADGE_TABLE[code];
    assert.ok(def, `コード ${code} が表にありません`);
    assert.equal(def.label, label, `コード ${code} のラベルが不一致`);
  }
});

// AC-4: 変化判定
test('resolveWarningChange: §4.3の表どおりに判定する', () => {
  assert.equal(resolveWarningChange(item({ kindStatus: '発表', lastKindCode: null })), 'new');
  assert.equal(
    resolveWarningChange(item({ kindCode: '03', kindStatus: '発表', lastKindCode: '10' })),
    'strengthened',
  );
  assert.equal(
    resolveWarningChange(item({ kindCode: '03', kindStatus: '発表', lastKindCode: '43' })),
    null,
  );
  assert.equal(resolveWarningChange(item({ kindStatus: '発表', lastKindCode: '00' })), null);
  assert.equal(resolveWarningChange(item({ kindStatus: '継続', lastKindCode: null })), null);
  for (const status of [
    '特別警報から危険警報',
    '特別警報から警報',
    '特別警報から注意報',
    '危険警報から警報',
    '危険警報から注意報',
    '警報から注意報',
  ]) {
    assert.equal(resolveWarningChange(item({ kindStatus: status })), 'weakened');
  }
  assert.equal(resolveWarningChange(item({ kindStatus: '発表', lastKindCode: '99' })), null);
  // Status=発表 かつ lastKindCode が同じ段階(warning)なら強調なし('>'を'>='にする変異を検知)
  assert.equal(
    resolveWarningChange(item({ kindCode: '03', kindStatus: '発表', lastKindCode: '08' })),
    null,
  );
});

// AC-5: タイマーなし(静的)
test('warning配下にタイマー・ローカル保存・Date.nowを使わない', async () => {
  const fs = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const dir = fileURLToPath(new URL('../src/map/panels/warning', import.meta.url));
  const forbidden = /setTimeout|setInterval|localStorage|Date\.now/;
  for (const name of fs.readdirSync(dir)) {
    const content = fs.readFileSync(`${dir}/${name}`, 'utf-8');
    assert.doesNotMatch(content, forbidden, `${name} に禁止パターンがあります`);
  }
});

// AC-6: 解除・継続
test('buildWarningCards→InfoPanelColumn: 解除された項目は現況から消え、継続項目は残る', () => {
  const first = response({
    data: { items: [item({ kindCode: '03', kindStatus: '継続' }), W1] },
  });
  const cardsFirst = buildWarningCards(first, 'available');
  const inputFirst = { ...DEFAULT_INFO_PANEL_INPUT, warning: cardsFirst };
  const htmlFirst = renderToStaticMarkup(
    el(InfoPanelColumn, { venueId: 'east', input: inputFirst }),
  );
  assert.match(htmlFirst, /レベル3大雨警報/);
  assert.match(htmlFirst, /雷注意報/);

  const second = response({
    data: { items: [item({ kindCode: '03', kindStatus: '継続' })] },
  });
  const cardsSecond = buildWarningCards(second, 'available');
  const inputSecond = { ...DEFAULT_INFO_PANEL_INPUT, warning: cardsSecond };
  const htmlSecond = renderToStaticMarkup(
    el(InfoPanelColumn, { venueId: 'east', input: inputSecond }),
  );
  assert.match(htmlSecond, /レベル3大雨警報/);
  assert.doesNotMatch(htmlSecond, /雷注意報/);
  assert.doesNotMatch(htmlSecond, /解除/);
});

// AC-7: 省略・状態
test('buildWarningCards: items空・data null・表外のみ・issuedAt nullで0件になる', () => {
  assert.equal(buildWarningCards(response({ data: { items: [] } }), 'available').length, 0);
  assert.equal(buildWarningCards(response({ data: null }), 'available').length, 0);
  assert.equal(buildWarningCards(response({ data: { items: [W7] } }), 'available').length, 0);
  assert.equal(
    buildWarningCards(
      response({
        data: { items: [W1] },
        metadata: { ...response().metadata, issuedAt: null },
      }),
      'available',
    ).length,
    0,
  );
});

test('省略時: InfoPanelColumnの出力に見出し・「発表なし」が出ない', () => {
  const input = { ...DEFAULT_INFO_PANEL_INPUT, warning: [] };
  const html = renderToStaticMarkup(el(InfoPanelColumn, { venueId: 'east', input }));
  assert.doesNotMatch(html, /気象警報・注意報/);
  assert.doesNotMatch(html, /発表なし/);
});

test('buildWarningCards: staleを渡すとカードのavailabilityがstaleになる', () => {
  const cards = buildWarningCards(response({ data: { items: [W1] } }), 'stale');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].status.kind, 'data');
  assert.equal((cards[0].status as { availability: string }).availability, 'stale');
});

// AC-8: メタ情報・訓練
test('parseWarningsResponse: 正しい応答を受理し不正な応答をnullにする', () => {
  const valid = response({ data: { items: [W1] } });
  assert.notEqual(parseWarningsResponse(valid, 'normal'), null);

  assert.equal(parseWarningsResponse(response(), 'training'), null); // controlStatus不一致
  assert.equal(
    parseWarningsResponse(
      { ...response(), controlStatus: 'training', isTraining: false },
      'training',
    ),
    null,
  ); // isTraining矛盾
  assert.equal(
    parseWarningsResponse({ ...response(), data: { items: 'not-an-array' } }, 'normal'),
    null,
  ); // data.items 非配列
  assert.equal(
    parseWarningsResponse(
      {
        ...response(),
        data: { items: [{ ...W1, lastKindCode: 123 }] },
      },
      'normal',
    ),
    null,
  ); // lastKindCodeが数値
});

test('見出しの時刻はissuedAt由来で、fetchedAt/evaluatedAt/kindIssuedAtに依存しない', () => {
  const res = response({
    metadata: {
      source: null,
      issuedAt: '2026-09-25T05:00:00.000Z', // JST 14:00
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-25T06:00:00.000Z',
      lastSuccessAt: '2026-09-25T06:00:00.000Z',
      availability: 'available',
      sourceVersion: null,
    },
    evaluatedAt: '2026-09-25T06:30:00.000Z',
    data: { items: [item({ kindIssuedAt: '2026-09-25T07:00:00.000Z' })] },
  });
  const cards = buildWarningCards(res, 'available');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].status.kind, 'data');
  assert.equal((cards[0].status as { time: string }).time, '2026-09-25T05:00:00.000Z');
});

// AC-9: 見出し・会場
test('InfoPanelColumn: venueIdで見出し2行目の対象名が切り替わる', () => {
  const cards = buildWarningCards(response({ data: { items: [W1] } }), 'available');
  const input = { ...DEFAULT_INFO_PANEL_INPUT, warning: cards };

  const htmlEast = renderToStaticMarkup(el(InfoPanelColumn, { venueId: 'east', input }));
  assert.match(htmlEast, /気象警報・注意報/);
  assert.match(htmlEast, /江東区/);

  const htmlTrc = renderToStaticMarkup(el(InfoPanelColumn, { venueId: 'trc', input }));
  assert.match(htmlTrc, /気象警報・注意報/);
  assert.match(htmlTrc, /大田区/);
});

// AC-13: 色
test('warning配下にHEX直書き・rgb()・--wx-notice-を使わない', async () => {
  const fs = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const dir = fileURLToPath(new URL('../src/map/panels/warning', import.meta.url));
  const hexPattern = /#[0-9a-fA-F]{3,8}\b/;
  const rgbPattern = /rgb\(/;
  const noticePattern = /--wx-notice-/;
  for (const name of fs.readdirSync(dir)) {
    const content = fs.readFileSync(`${dir}/${name}`, 'utf-8');
    assert.doesNotMatch(content, hexPattern, `${name} にHEX直書きがあります`);
    assert.doesNotMatch(content, rgbPattern, `${name} にrgb()があります`);
    assert.doesNotMatch(content, noticePattern, `${name} に--wx-notice-の使用があります`);
  }
});
