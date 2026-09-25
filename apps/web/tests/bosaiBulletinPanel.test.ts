import './setupEnv.ts';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BulletinDto, BulletinsResponse, WeatherControlStatus } from '@wx-viewer-poc/shared';

(globalThis as unknown as { React: typeof React }).React = React;

import { parseBulletinsResponse } from '../src/api/bosaiBulletins';
import {
  buildBosaiBulletinCards,
  isBulletinDisplayed,
} from '../src/map/panels/bosai/bosaiBulletinCards';
import { BosaiBulletinContent } from '../src/map/panels/bosai/BosaiBulletinContent';
import { InfoPanelColumn } from '../src/map/panels/InfoPanelColumn';
import {
  DEFAULT_INFO_PANEL_INPUT,
  PANEL_FIXTURE_NAMES,
  buildBosaiBulletinsFixture,
} from '../src/map/panels/panelFixtures';

const el = React.createElement;

function createTestBulletin(overrides: Partial<BulletinDto> = {}): BulletinDto {
  return {
    eventId: 'test-event-1',
    telegramType: 'VPBS50',
    infoType: '発表',
    isCancelled: false,
    reportDateTime: '2026-09-25T02:30:00.000Z',
    controlDateTime: '2026-09-25T02:30:00.000Z',
    title: '東京都気象防災速報（記録的短時間大雨）',
    headlineText: 'テスト本文です。',
    informationTag: '記録雨',
    hasSighting: null,
    areas: [
      {
        areaCode: '130000',
        areaName: '東京地方',
        codeType: 'Area',
        sequence: 1,
        informationType: null,
      },
    ],
    isDirect: false,
    matchedAreaCodes: [],
    metadata: {
      source: null,
      issuedAt: null,
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: null,
      lastSuccessAt: null,
      availability: 'available',
      sourceVersion: null,
    },
    ...overrides,
  };
}

function createValidBulletinsResponse(
  bulletins: readonly BulletinDto[] = [createTestBulletin()],
  controlStatus: WeatherControlStatus = 'normal',
): BulletinsResponse {
  return {
    terminalId: 'east-term',
    venueId: 'east',
    controlStatus,
    isTraining: controlStatus === 'training',
    evaluatedAt: '2026-09-25T05:00:00.000Z',
    area: {
      code: '130108',
      name: '江東区',
    },
    availability: 'available',
    bulletins,
    capabilities: {
      telegramTypes: ['VPBS50', 'VPHW50', 'VPHW51'],
      sightingUndeterminableTypes: ['VPHW50', 'VPBS50'],
      unsupportedFields: ['editorialOffice', 'publishingOffice'],
      deduplicated: false,
    },
  };
}

// ==========================================
// AC-2: 期限・取消（単体）
// ==========================================
test('AC-2: isBulletinDisplayed の期限・取消判定', () => {
  const nowMs = Date.parse('2026-09-25T05:00:00.000Z');

  // VPBS50: 発表 02:00:00Z + 1ms -> 終了時刻 05:00:00.001Z > now -> true
  const vpbsJustBefore = createTestBulletin({
    telegramType: 'VPBS50',
    reportDateTime: '2026-09-25T02:00:00.001Z',
  });
  assert.equal(isBulletinDisplayed(vpbsJustBefore, nowMs), true);

  // VPBS50: 発表ちょうど 02:00:00Z (now === 終了時刻) -> false
  const vpbsExactEnd = createTestBulletin({
    telegramType: 'VPBS50',
    reportDateTime: '2026-09-25T02:00:00.000Z',
  });
  assert.equal(isBulletinDisplayed(vpbsExactEnd, nowMs), false);

  // VPBS50: 発表 02:30Z で metadata.validAt に過去時刻を入れても true (validAt を見ない)
  const vpbsWithValidAt = createTestBulletin({
    telegramType: 'VPBS50',
    reportDateTime: '2026-09-25T02:30:00.000Z',
    metadata: {
      ...createTestBulletin().metadata,
      validAt: '2026-09-25T01:00:00.000Z',
    },
  });
  assert.equal(isBulletinDisplayed(vpbsWithValidAt, nowMs), true);

  // VPHW50: validAt=05:00:01Z -> true
  const vphwFuture = createTestBulletin({
    telegramType: 'VPHW50',
    reportDateTime: '2026-09-25T04:30:00.000Z',
    metadata: {
      ...createTestBulletin().metadata,
      validAt: '2026-09-25T05:00:01.000Z',
    },
  });
  assert.equal(isBulletinDisplayed(vphwFuture, nowMs), true);

  // VPHW50: validAt=05:00:00Z -> false
  const vphwExact = createTestBulletin({
    telegramType: 'VPHW50',
    reportDateTime: '2026-09-25T04:30:00.000Z',
    metadata: {
      ...createTestBulletin().metadata,
      validAt: '2026-09-25T05:00:00.000Z',
    },
  });
  assert.equal(isBulletinDisplayed(vphwExact, nowMs), false);

  // VPHW50: 発表が4時間前でも validAt が未来なら true (3時間ルールを当てない)
  const vphwOldIssued = createTestBulletin({
    telegramType: 'VPHW50',
    reportDateTime: '2026-09-25T01:00:00.000Z',
    metadata: {
      ...createTestBulletin().metadata,
      validAt: '2026-09-25T05:00:01.000Z',
    },
  });
  assert.equal(isBulletinDisplayed(vphwOldIssued, nowMs), true);

  // VPHW51: validAt=null -> false
  const vphwNullValidAt = createTestBulletin({
    telegramType: 'VPHW51',
    reportDateTime: '2026-09-25T04:50:00.000Z',
    metadata: {
      ...createTestBulletin().metadata,
      validAt: null,
    },
  });
  assert.equal(isBulletinDisplayed(vphwNullValidAt, nowMs), false);

  // isCancelled=true (期限内の VPBS50・VPHW51 それぞれ) -> false
  const vpbsCancelled = createTestBulletin({
    telegramType: 'VPBS50',
    reportDateTime: '2026-09-25T04:00:00.000Z',
    isCancelled: true,
  });
  assert.equal(isBulletinDisplayed(vpbsCancelled, nowMs), false);

  const vphwCancelled = createTestBulletin({
    telegramType: 'VPHW51',
    reportDateTime: '2026-09-25T04:50:00.000Z',
    isCancelled: true,
    metadata: {
      ...createTestBulletin().metadata,
      validAt: '2026-09-25T05:30:00.000Z',
    },
  });
  assert.equal(isBulletinDisplayed(vphwCancelled, nowMs), false);

  // infoType='訂正'・期限内 -> true
  const vpbsCorrection = createTestBulletin({
    telegramType: 'VPBS50',
    infoType: '訂正',
    reportDateTime: '2026-09-25T04:00:00.000Z',
    isCancelled: false,
  });
  assert.equal(isBulletinDisplayed(vpbsCorrection, nowMs), true);
});

// ==========================================
// AC-3: 重複非統合（単体）
// ==========================================
test('AC-3: 同一発表時刻・同一区域の VPHW50 と VPHW51 を重複排除せず2枚のカードにする', () => {
  const nowMs = Date.parse('2026-09-25T05:00:00.000Z');
  const reportDateTime = '2026-09-25T04:50:00.000Z';
  const validAt = '2026-09-25T05:50:00.000Z';

  const vphw50 = createTestBulletin({
    eventId: 'VPHW50:130010',
    telegramType: 'VPHW50',
    reportDateTime,
    title: '東京都気象防災速報（竜巻注意）',
    metadata: { ...createTestBulletin().metadata, validAt },
  });

  const vphw51 = createTestBulletin({
    eventId: 'VPHW51:130010',
    telegramType: 'VPHW51',
    reportDateTime,
    title: '東京都気象防災速報（竜巻目撃）',
    hasSighting: true,
    metadata: { ...createTestBulletin().metadata, validAt },
  });

  const cards = buildBosaiBulletinCards({
    bulletins: [vphw50, vphw51],
    availability: 'available',
    nowMs,
  });

  assert.equal(cards.length, 2);
  assert.equal(cards[0].key, 'VPHW50:130010');
  assert.equal(cards[1].key, 'VPHW51:130010');
});

// ==========================================
// AC-4: 並び順（単体）
// ==========================================
test('AC-4: 発表時刻の新しい順にカードが並び替わる（3通りの入力順すべてで同じ順序）', () => {
  const nowMs = Date.parse('2026-09-25T05:35:00.000Z');

  const b1 = createTestBulletin({
    eventId: 'b1',
    telegramType: 'VPBS50',
    reportDateTime: '2026-09-25T04:40:00.000Z', // 13:40 JST
    title: '東京都気象防災速報（13:40）',
  });
  const b2 = createTestBulletin({
    eventId: 'b2',
    telegramType: 'VPHW51',
    reportDateTime: '2026-09-25T05:05:00.000Z', // 14:05 JST
    title: '東京都気象防災速報（14:05）',
    metadata: { ...createTestBulletin().metadata, validAt: '2026-09-25T06:05:00.000Z' },
  });
  const b3 = createTestBulletin({
    eventId: 'b3',
    telegramType: 'VPBS50',
    reportDateTime: '2026-09-25T05:30:00.000Z', // 14:30 JST
    title: '東京都気象防災速報（14:30）',
  });

  const orderPatterns = [
    [b1, b2, b3], // 古い順
    [b3, b2, b1], // 新しい順
    [b2, b1, b3], // 混在順
  ];

  for (const pattern of orderPatterns) {
    const cards = buildBosaiBulletinCards({
      bulletins: pattern,
      availability: 'available',
      nowMs,
    });
    const input = {
      ...DEFAULT_INFO_PANEL_INPUT,
      bosaiBulletin: cards,
    };
    const html = renderToStaticMarkup(el(InfoPanelColumn, { venueId: 'east', input }));

    const idx1430 = html.indexOf('東京都気象防災速報（14:30）');
    const idx1405 = html.indexOf('東京都気象防災速報（14:05）');
    const idx1340 = html.indexOf('東京都気象防災速報（13:40）');

    assert.ok(idx1430 >= 0 && idx1405 >= 0 && idx1340 >= 0);
    assert.ok(idx1430 < idx1405, '14:30 が 14:05 より先に出現する');
    assert.ok(idx1405 < idx1340, '14:05 が 13:40 より先に出現する');
  }
});

// ==========================================
// AC-5: 中身（単体・renderToStaticMarkup）
// ==========================================
test('AC-5: カード中身の検証（目撃情報・改行全文・詳細ボタンなし・eventIdなし・官署なし・取消なし）', () => {
  const nowMs = Date.parse('2026-09-25T05:00:00.000Z');

  // 区域・経過時間・「目撃情報あり」は見出し文と重複するため描画しない（UI監修）
  const bSighting = createTestBulletin({
    eventId: 'secret-id-sighting-true',
    telegramType: 'VPHW51',
    hasSighting: true,
    metadata: { ...createTestBulletin().metadata, validAt: '2026-09-25T05:30:00.000Z' },
  });
  const htmlSighting = renderToStaticMarkup(el(BosaiBulletinContent, { bulletin: bSighting }));
  assert.equal(htmlSighting.includes('目撃情報あり'), false);
  assert.equal(htmlSighting.includes('経過'), false);
  for (const area of bSighting.areas) {
    assert.equal(htmlSighting.includes(area.areaName), false);
  }

  // headlineText に2行（\n 区切り）の文字列を入れるとその全文が省略なく含まれる
  const multilineHeadline = '1行目の速報テキストです。\n2行目の速報テキストです。';
  const bMultiline = createTestBulletin({
    eventId: 'secret-id-multiline',
    headlineText: multilineHeadline,
  });
  const htmlMultiline = renderToStaticMarkup(el(BosaiBulletinContent, { bulletin: bMultiline }));
  assert.ok(htmlMultiline.includes(multilineHeadline));

  // headlineText が null の場合は全文要素が描画されない
  const bNullHeadline = createTestBulletin({
    eventId: 'secret-id-null-headline',
    headlineText: null,
  });
  const htmlNullHeadline = renderToStaticMarkup(
    el(BosaiBulletinContent, { bulletin: bNullHeadline }),
  );
  assert.equal(htmlNullHeadline.includes('bosai-bulletin-headline'), false);

  // 詳細ボタン（button 要素・「詳細」文字列）が中身に存在しない
  assert.equal(htmlMultiline.includes('<button'), false);
  assert.equal(htmlMultiline.includes('詳細'), false);

  // eventId の文字列がマークアップに含まれない
  assert.equal(htmlMultiline.includes('secret-id-multiline'), false);

  // 「発表官署」「気象庁」等の官署表示がない（title 以外に官署名を出さない）
  assert.equal(htmlMultiline.includes('発表官署'), false);
  assert.equal(htmlMultiline.includes('気象庁'), false);

  // 「取消」の文字列がどのカードにも出ない（取消行はカード自体が作られない）
  const bCancelled = createTestBulletin({
    eventId: 'secret-id-cancelled',
    isCancelled: true,
    infoType: '取消',
    title: '東京都気象防災速報（取消）',
  });
  const cardsWithCancelled = buildBosaiBulletinCards({
    bulletins: [bCancelled, bMultiline],
    availability: 'available',
    nowMs,
  });
  const columnHtml = renderToStaticMarkup(
    el(InfoPanelColumn, {
      venueId: 'east',
      input: { ...DEFAULT_INFO_PANEL_INPUT, bosaiBulletin: cardsWithCancelled },
    }),
  );
  assert.equal(columnHtml.includes('取消'), false);
  assert.equal(cardsWithCancelled.length, 1);
});

// ==========================================
// AC-8: 取得状態（単体）
// ==========================================
test('AC-8: parseBulletinsResponse のバリデーション・unavailable の取得失敗扱い・未対応種別の除外', () => {
  const nowMs = Date.parse('2026-09-25T05:00:00.000Z');

  // 正しい応答を受理する
  const validRes = createValidBulletinsResponse();
  assert.notEqual(parseBulletinsResponse(validRes, 'normal'), null);

  // controlStatus が要求値と異なる応答 -> null
  assert.equal(parseBulletinsResponse(validRes, 'training'), null);

  // isTraining が矛盾する応答 -> null
  const contradictoryTraining = {
    ...validRes,
    isTraining: true, // controlStatus='normal' なのに isTraining=true
  };
  assert.equal(parseBulletinsResponse(contradictoryTraining, 'normal'), null);

  // bulletins が配列でない応答 -> null
  const invalidBulletins = {
    ...validRes,
    bulletins: 'not-an-array',
  };
  assert.equal(parseBulletinsResponse(invalidBulletins, 'normal'), null);

  // hasSighting が文字列の要素を含む応答 -> null
  const invalidSighting = {
    ...validRes,
    bulletins: [
      {
        ...createTestBulletin(),
        hasSighting: 'true', // boolean または null であるべき
      },
    ],
  };
  assert.equal(parseBulletinsResponse(invalidSighting, 'normal'), null);

  // telegramType が null の行と 'VPBS51' の行を、期限内の正常な VPBS50・VPHW51 と混ぜた応答
  const normalVpbs = createTestBulletin({
    eventId: 'normal-vpbs',
    telegramType: 'VPBS50',
    title: '正常VPBS50',
    reportDateTime: '2026-09-25T04:30:00.000Z',
  });
  const normalVphw = createTestBulletin({
    eventId: 'normal-vphw',
    telegramType: 'VPHW51',
    title: '正常VPHW51',
    reportDateTime: '2026-09-25T04:35:00.000Z',
    metadata: { ...createTestBulletin().metadata, validAt: '2026-09-25T05:35:00.000Z' },
  });
  const unknownTypeNull = createTestBulletin({
    eventId: 'unknown-null',
    telegramType: null,
    title: '種別null',
    reportDateTime: '2026-09-25T04:30:00.000Z',
  });
  const unsupportedVpbs51 = createTestBulletin({
    eventId: 'unsupported-vpbs51',
    telegramType: 'VPBS51' as unknown as BulletinDto['telegramType'],
    title: '短時間大雪VPBS51',
    reportDateTime: '2026-09-25T04:30:00.000Z',
  });

  const mixedResponse = createValidBulletinsResponse([
    normalVpbs,
    unknownTypeNull,
    normalVphw,
    unsupportedVpbs51,
  ]);

  // parseBulletinsResponse が受理する（null にならない）
  const parsedMixed = parseBulletinsResponse(mixedResponse, 'normal');
  assert.notEqual(parsedMixed, null);

  // buildBosaiBulletinCards の結果は正常な2行のカードだけ（key が正常行の eventId）になる
  const mixedCards = buildBosaiBulletinCards({
    bulletins: parsedMixed!.bulletins,
    availability: 'available',
    nowMs,
  });
  assert.equal(mixedCards.length, 2);
  assert.equal(mixedCards[0].key, 'normal-vpbs');
  assert.equal(mixedCards[1].key, 'normal-vphw');

  // renderToStaticMarkup した InfoPanelColumn の出力に除外行のタイトルが含まれず、正常行のタイトルが含まれ、異常文言が含まれない
  const mixedColumnHtml = renderToStaticMarkup(
    el(InfoPanelColumn, {
      venueId: 'east',
      input: { ...DEFAULT_INFO_PANEL_INPUT, bosaiBulletin: mixedCards },
    }),
  );
  assert.ok(mixedColumnHtml.includes('正常VPBS50'));
  assert.ok(mixedColumnHtml.includes('正常VPHW51'));
  assert.equal(mixedColumnHtml.includes('種別null'), false);
  assert.equal(mixedColumnHtml.includes('短時間大雪VPBS51'), false);
  assert.equal(mixedColumnHtml.includes('取得できませんでした'), false);

  // availability: 'stale' は受理し、'unavailable' は契約違反として取得失敗（null）にする
  assert.notEqual(parseBulletinsResponse({ ...validRes, availability: 'stale' }, 'normal'), null);
  assert.equal(
    parseBulletinsResponse({ ...validRes, availability: 'unavailable' }, 'normal'),
    null,
  );
});

// ==========================================
// AC-9: 画面（フィクスチャ）
// ==========================================
test('AC-9: フィクスチャ bosai-bulletins の検証（F2/F3->F1の3枚のみ、F4-F6非表示、見出し・補助表示なし等）', () => {
  assert.ok(PANEL_FIXTURE_NAMES.includes('bosai-bulletins'));

  const fixtureInput = buildBosaiBulletinsFixture();
  assert.ok(fixtureInput, 'フィクスチャが取得できること');

  // WarningTimeSeriesDetailFixtureEntry 等が内部で createPortal を呼ぶため、
  // SSR (renderToStaticMarkup) 環境用に他パネルの content を dummy にして列全体のDOM配置を検証する
  const ssrSafeInput = {
    ...fixtureInput,
    warningTimeSeries: [
      {
        key: 'warningTimeSeries',
        status: {
          kind: 'data' as const,
          availability: 'available' as const,
          time: '2026-09-25T05:00:00.000Z',
          timeKind: 'issued' as const,
        },
        content: 'dummy-wt',
      },
    ],
    areaForecast: [
      {
        key: 'areaForecast',
        status: {
          kind: 'data' as const,
          availability: 'available' as const,
          time: '2026-09-25T05:00:00.000Z',
          timeKind: 'issued' as const,
        },
        content: 'dummy-af',
      },
    ],
  };

  const html = renderToStaticMarkup(el(InfoPanelColumn, { venueId: 'east', input: ssrSafeInput }));

  // F4・F5・F6 のタイトルは DOM に存在しない
  assert.equal(html.includes('東京都気象防災速報（線状降水帯発生）'), false, 'F4は非表示');
  assert.equal(html.includes('東京都気象防災速報（竜巻注意）\n'), false);
  assert.equal(html.includes('東京都気象防災速報（線状降水帯直前予測）'), false, 'F6は非表示');

  // 速報カードが3枚だけ
  const bosaiCardMatches = html.match(/data-panel-id="bosaiBulletin"/g);
  assert.equal(bosaiCardMatches?.length, 3);

  // F2/F3 (同時刻) -> F1 の順
  const idxF1 = html.indexOf('東京都気象防災速報（記録的短時間大雨）');
  const idxF2 = html.indexOf('東京都気象防災速報（竜巻目撃）');
  const idxF3 = html.indexOf('東京都気象防災速報（竜巻注意）');
  assert.ok(idxF1 >= 0 && idxF2 >= 0 && idxF3 >= 0);
  assert.ok(idxF2 < idxF1, 'F2がF1より先');
  assert.ok(idxF3 < idxF1, 'F3がF1より先');

  // 区域行・経過時間・「目撃情報あり」を出さない
  assert.equal(html.includes('目撃情報あり'), false);
  assert.equal(html.includes('東京地方、２３区東部、江東区'), false);
  assert.equal(html.includes('分経過'), false);

  // 各カードに詳細ボタンがない
  assert.equal(html.includes('<button'), false);
  assert.equal(html.includes('詳細'), false);

  // 固定対象名（江東区等）が速報カードの meta 欄に出ない
  const bosaiSection = html.slice(0, html.indexOf('data-panel-id="warning"'));
  assert.equal(bosaiSection.includes('江東区発表'), false);
  assert.equal(bosaiSection.includes('江東区 観測'), false);

  // その下に警報・注意報以降のパネルが §5.2 順で続く
  const idxWarning = html.indexOf('data-panel-id="warning"');
  const idxTimeSeries = html.indexOf('data-panel-id="warningTimeSeries"');
  const idxEarlyWarning = html.indexOf('data-panel-id="earlyWarning"');
  const idxAmedas = html.indexOf('data-panel-id="amedas"');
  const idxAreaForecast = html.indexOf('data-panel-id="areaForecast"');

  assert.ok(idxF1 < idxWarning);
  assert.ok(idxWarning < idxTimeSeries);
  assert.ok(idxTimeSeries < idxEarlyWarning);
  assert.ok(idxEarlyWarning < idxAmedas);
  assert.ok(idxAmedas < idxAreaForecast);
});

// ==========================================
// AC-12: 色（HEX/RGB 不使用検証）
// ==========================================
test('AC-12: 新規ファイルに HEX や RGB が直書きされていないこと', () => {
  const targetFiles = [
    'src/api/bosaiBulletins.ts',
    'src/map/panels/bosai/bosaiBulletinCards.ts',
    'src/map/panels/bosai/useBosaiBulletins.ts',
    'src/map/panels/bosai/BosaiBulletinContent.tsx',
    'src/map/panels/bosai/bosaiBulletin.css',
  ];

  const hexRegex = /#[0-9a-fA-F]{3,8}\b/;
  const rgbRegex = /rgb\(/;

  for (const relPath of targetFiles) {
    const fullPath = path.resolve(import.meta.dirname, '..', relPath);
    const content = fs.readFileSync(fullPath, 'utf-8');

    const hexMatch = content.match(hexRegex);
    assert.equal(
      hexMatch,
      null,
      `${relPath} に HEX カラー直書き (${hexMatch?.[0]}) が含まれていないこと`,
    );

    const rgbMatch = content.match(rgbRegex);
    assert.equal(rgbMatch, null, `${relPath} に rgb() (${rgbMatch?.[0]}) が含まれていないこと`);
  }
});
