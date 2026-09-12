import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWarningTelegram } from '../src/polling/jmaWarningTelegramParser.js';
import {
  diffWarningCurrent,
  extractActiveKindsByPhenomenon,
  reduceWarningCurrent,
  WARNING_CODE_TABLE,
  WarningCurrentConflictError,
  WarningCurrentUnsupportedError,
} from '../src/polling/jmaWarningCurrentReducer.js';
import type {
  IndividualWarningTelegramType,
  ParsedWarningTelegram,
  WarningCurrentItemInput,
  WarningTargetArea,
} from '../src/repositories/types.js';

const TARGET_AREA: WarningTargetArea = {
  municipalCode: '1310800',
  displayName: '江東区',
};

function createWarningXml(
  telegramType: string,
  reportDateTime: string,
  kindsXml: string,
  controlDateTime = reportDateTime,
): ParsedWarningTelegram {
  const isoReportDateTime = new Date(reportDateTime).toISOString();
  const isoControlDateTime = new Date(controlDateTime).toISOString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
  <Control>
    <Title>気象警報・注意報</Title>
    <DateTime>${isoControlDateTime}</DateTime>
    <Status>通常</Status>
    <EditorialOffice>気象庁本庁</EditorialOffice>
    <PublishingOffice>気象庁</PublishingOffice>
  </Control>
  <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
    <Title>東京都気象警報・注意報</Title>
    <ReportDateTime>${isoReportDateTime}</ReportDateTime>
    <TargetDateTime>${isoReportDateTime}</TargetDateTime>
    <EventID>EVENT1</EventID>
    <InfoType>発表</InfoType>
    <Serial>1</Serial>
    <InfoKind>気象警報・注意報</InfoKind>
    <InfoKindVersion>1.0_1</InfoKindVersion>
    <Headline><Text>警報・注意報</Text></Headline>
  </Head>
  <Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/">
    <Warning type="気象警報・注意報（市町村等）">
      <Item>
        <Area>
          <Name>江東区</Name>
          <Code>1310800</Code>
        </Area>
        ${kindsXml}
      </Item>
    </Warning>
  </Body>
</Report>`;

  const result = parseWarningTelegram(
    xml,
    {
      telegramType,
      controlStatus: 'normal',
      reportDateTime: isoReportDateTime,
      controlDateTime: isoControlDateTime,
    },
    TARGET_AREA,
  );

  if (!result.ok) {
    throw new Error(`Parse failed: ${result.disposition} - ${result.reason}`);
  }
  return result.value;
}

test('1. 初回 VPWS50 の発表中 Kind が現況になり、すべて origin=initial / new として差分計算できる', () => {
  // VPWS50: 大雨警報(03), 高潮注意報(19), 雷注意報(14)
  const kindsXml = `
    <Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
    <Kind><Name>高潮注意報</Name><Code>19</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
    <Kind><Name>雷注意報</Name><Code>14</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
  `;
  const vpws50 = createWarningXml('VPWS50', '2026-09-09T01:00:00Z', kindsXml);
  const individuals = new Map<IndividualWarningTelegramType, ParsedWarningTelegram>();

  const reduced = reduceWarningCurrent(vpws50, individuals);
  assert.equal(reduced.items.length, 3);
  assert.deepEqual(
    reduced.items.map((i) => i.kindCode),
    ['03', '19', '14'], // VPWW55, VPWW57, VPWW61 順
  );
  assert.deepEqual(reduced.contributingTelegramTypes, ['VPWS50']);

  // 初回は before=[] からの diff
  const changes = diffWarningCurrent([], reduced.items);
  assert.equal(changes.length, 3);
  assert.ok(changes.every((c) => c.changeType === 'new'));
  assert.equal(changes.find((c) => c.phenomenonKey === 'heavy_rain')?.after?.kindCode, '03');
  assert.equal(changes.find((c) => c.phenomenonKey === 'storm_surge')?.after?.kindCode, '19');
  assert.equal(changes.find((c) => c.phenomenonKey === 'thunder')?.after?.kindCode, '14');
});

test('2. no_warning の VPWS50 が items=[] の正常状態になり、直前発表中を released とする', () => {
  const noWarningXml = `<Kind><Status>発表警報・注意報はなし</Status><DateTime type="発表時刻">2026-09-09T02:00:00Z</DateTime></Kind>`;
  const vpws50 = createWarningXml('VPWS50', '2026-09-09T02:00:00Z', noWarningXml);
  const individuals = new Map<IndividualWarningTelegramType, ParsedWarningTelegram>();

  const reduced = reduceWarningCurrent(vpws50, individuals);
  assert.equal(reduced.items.length, 0);
  assert.deepEqual(reduced.contributingTelegramTypes, ['VPWS50']);

  const beforeItems: WarningCurrentItemInput[] = [
    {
      sequence: 1,
      kindCode: '03',
      kindName: '大雨警報',
      kindStatus: '発表',
      lastKindCode: null,
      lastKindName: null,
      significancyCode: null,
      significancyName: null,
      warningLevel: null,
      attentionText: null,
      kindIssuedAt: '2026-09-09T01:00:00Z',
      sourceTelegram: 'VPWS50',
    },
  ];

  const changes = diffWarningCurrent(beforeItems, reduced.items);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.changeType, 'released');
  assert.equal(changes[0]!.phenomenonKey, 'heavy_rain');
  assert.equal(changes[0]!.before?.kindCode, '03');
  assert.equal(changes[0]!.after, null);
});

test('3. VPWW55 の更新が大雨だけを置き換え、VPWS50 の高潮・雷を保持する', () => {
  // VPWS50: 大雨注意報(10, 01:00), 高潮注意報(19, 01:00), 雷注意報(14, 01:00)
  const baseKinds = `
    <Kind><Name>大雨注意報</Name><Code>10</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
    <Kind><Name>高潮注意報</Name><Code>19</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
    <Kind><Name>雷注意報</Name><Code>14</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
  `;
  const vpws50 = createWarningXml('VPWS50', '2026-09-09T01:00:00Z', baseKinds);

  // VPWW55: 大雨警報(03, 02:00) へ強化
  const vpww55Kinds = `
    <Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>2026-09-09T02:00:00Z</DateTime><LastKind><Name>大雨注意報</Name><Code>10</Code></LastKind></Kind>
  `;
  const vpww55 = createWarningXml('VPWW55', '2026-09-09T02:00:00Z', vpww55Kinds);

  const individuals = new Map<IndividualWarningTelegramType, ParsedWarningTelegram>([
    ['VPWW55', vpww55],
  ]);

  const reduced = reduceWarningCurrent(vpws50, individuals);
  assert.equal(reduced.items.length, 3);
  assert.equal(reduced.items[0]!.kindCode, '03');
  assert.equal(reduced.items[0]!.sourceTelegram, 'VPWW55');
  assert.equal(reduced.items[1]!.kindCode, '19');
  assert.equal(reduced.items[1]!.sourceTelegram, 'VPWS50');
  assert.equal(reduced.items[2]!.kindCode, '14');
  assert.equal(reduced.items[2]!.sourceTelegram, 'VPWS50');

  assert.deepEqual(new Set(reduced.contributingTelegramTypes), new Set(['VPWW55', 'VPWS50']));
});

test('4. VPWW61 の複数 Kind をすべて保持し、同ストリームの no-warning でだけすべて解除する', () => {
  const vpws50 = createWarningXml(
    'VPWS50',
    '2026-09-09T01:00:00Z',
    `<Kind><Name>大雨注意報</Name><Code>10</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>`,
  );

  // VPWW61: 雷注意報(14) と 濃霧注意報(20)
  const vpww61Kinds = `
    <Kind><Name>雷注意報</Name><Code>14</Code><Status>発表</Status><DateTime>2026-09-09T02:00:00Z</DateTime></Kind>
    <Kind><Name>濃霧注意報</Name><Code>20</Code><Status>発表</Status><DateTime>2026-09-09T02:00:00Z</DateTime></Kind>
  `;
  const vpww61 = createWarningXml('VPWW61', '2026-09-09T02:00:00Z', vpww61Kinds);

  const individuals = new Map<IndividualWarningTelegramType, ParsedWarningTelegram>([
    ['VPWW61', vpww61],
  ]);

  const reduced = reduceWarningCurrent(vpws50, individuals);
  assert.equal(reduced.items.length, 3);
  assert.equal(reduced.items[0]!.kindCode, '10'); // 大雨注意報 (VPWS50)
  assert.equal(reduced.items[1]!.kindCode, '14'); // 雷注意報 (VPWW61)
  assert.equal(reduced.items[2]!.kindCode, '20'); // 濃霧注意報 (VPWW61)

  // VPWW61 の no-warning で更新
  const vpww61NoWarn = createWarningXml(
    'VPWW61',
    '2026-09-09T03:00:00Z',
    `<Kind><Status>発表警報・注意報はなし</Status><DateTime type="発表時刻">2026-09-09T03:00:00Z</DateTime></Kind>`,
  );
  const individuals2 = new Map<IndividualWarningTelegramType, ParsedWarningTelegram>([
    ['VPWW61', vpww61NoWarn],
  ]);
  const reduced2 = reduceWarningCurrent(vpws50, individuals2);
  assert.equal(reduced2.items.length, 1);
  assert.equal(reduced2.items[0]!.kindCode, '10'); // 大雨注意報は残る
});

test('5. Code=00 の個別解除がそのストリームだけを空にし、他ストリームを保持する', () => {
  const vpws50 = createWarningXml(
    'VPWS50',
    '2026-09-09T01:00:00Z',
    `
      <Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
      <Kind><Name>高潮警報</Name><Code>08</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
    `,
  );

  // VPWW55 で Code=00 (全解除)
  const vpww55Kinds = `
    <Kind><Name>解除</Name><Code>00</Code><Status>解除</Status><DateTime>2026-09-09T02:00:00Z</DateTime></Kind>
  `;
  const vpww55 = createWarningXml('VPWW55', '2026-09-09T02:00:00Z', vpww55Kinds);

  const individuals = new Map<IndividualWarningTelegramType, ParsedWarningTelegram>([
    ['VPWW55', vpww55],
  ]);

  const reduced = reduceWarningCurrent(vpws50, individuals);
  assert.equal(reduced.items.length, 1);
  assert.equal(reduced.items[0]!.kindCode, '08'); // 高潮警報だけが残る
});

test('6. VPWS50 の Status=解除 が kind.code の対象現象だけを解除し、00 の全解除分岐へ入らない', () => {
  // VPWS50: 大雨警報(03 継続), 高潮警報(08 解除 LastKind=08)
  const vpws50Kinds = `
    <Kind><Name>大雨警報</Name><Code>03</Code><Status>継続</Status><DateTime>2026-09-09T02:00:00Z</DateTime></Kind>
    <Kind><Name>高潮警報</Name><Code>08</Code><Status>解除</Status><DateTime>2026-09-09T02:00:00Z</DateTime><LastKind><Name>高潮警報</Name><Code>08</Code></LastKind></Kind>
  `;
  const vpws50 = createWarningXml('VPWS50', '2026-09-09T02:00:00Z', vpws50Kinds);

  const reduced = reduceWarningCurrent(vpws50, new Map());
  assert.equal(reduced.items.length, 1);
  assert.equal(reduced.items[0]!.kindCode, '03'); // 大雨警報のみ残る
});

test('7. 高潮実電文構造: Code=08 から 48 を strengthened、48 から 08 を weakened、同一コードを continued とする', () => {
  const item08: WarningCurrentItemInput = {
    sequence: 1,
    kindCode: '08',
    kindName: '高潮警報',
    kindStatus: '発表',
    lastKindCode: null,
    lastKindName: null,
    significancyCode: null,
    significancyName: null,
    warningLevel: null,
    attentionText: null,
    kindIssuedAt: '2026-09-09T00:00:00Z',
    sourceTelegram: 'VPWW57',
  };

  const item48: WarningCurrentItemInput = {
    sequence: 1,
    kindCode: '48',
    kindName: '高潮危険警報',
    kindStatus: '発表',
    lastKindCode: '08',
    lastKindName: '高潮警報',
    significancyCode: null,
    significancyName: null,
    warningLevel: null,
    attentionText: null,
    kindIssuedAt: '2026-09-09T01:00:00Z',
    sourceTelegram: 'VPWW57',
  };

  // 08 -> 48 (strengthened)
  const diff1 = diffWarningCurrent([item08], [item48]);
  assert.equal(diff1.length, 1);
  assert.equal(diff1[0]!.changeType, 'strengthened');
  assert.equal(diff1[0]!.phenomenonKey, 'storm_surge');

  // 48 -> 08 (weakened)
  const item08After48: WarningCurrentItemInput = {
    ...item08,
    lastKindCode: '48',
    lastKindName: '高潮危険警報',
    kindIssuedAt: '2026-09-09T02:00:00Z',
  };
  const diff2 = diffWarningCurrent([item48], [item08After48]);
  assert.equal(diff2.length, 1);
  assert.equal(diff2[0]!.changeType, 'weakened');
  assert.equal(diff2[0]!.phenomenonKey, 'storm_surge');

  // 48 -> 48 (continued)
  const diff3 = diffWarningCurrent([item48], [item48]);
  assert.equal(diff3.length, 1);
  assert.equal(diff3[0]!.changeType, 'continued');
});

test('8. 未対応コード・未対応Status・同一現象の複数Kind・矛盾するLastKindは例外となる', () => {
  // 未対応コード: 99
  const xmlInvalidCode = createWarningXml(
    'VPWW55',
    '2026-09-09T00:00:00Z',
    `<Kind><Name>未知警報</Name><Code>99</Code><Status>発表</Status></Kind>`,
  );
  assert.throws(
    () => {
      extractActiveKindsByPhenomenon(xmlInvalidCode);
    },
    (err: unknown) =>
      err instanceof WarningCurrentUnsupportedError && err.reasonKind === 'unsupported_code',
  );

  // 電文種別とコードの所属ストリームが不一致 (VPWW55に波浪警報07)
  const xmlMismatchedStream = createWarningXml(
    'VPWW55',
    '2026-09-09T00:00:00Z',
    `<Kind><Name>波浪警報</Name><Code>07</Code><Status>発表</Status></Kind>`,
  );
  assert.throws(
    () => {
      extractActiveKindsByPhenomenon(xmlMismatchedStream);
    },
    (err: unknown) =>
      err instanceof WarningCurrentUnsupportedError && err.reasonKind === 'unsupported_code',
  );

  // 未対応Status
  const xmlInvalidStatus = createWarningXml(
    'VPWW55',
    '2026-09-09T00:00:00Z',
    `<Kind><Name>大雨警報</Name><Code>03</Code><Status>テスト未対応</Status></Kind>`,
  );
  assert.throws(
    () => {
      extractActiveKindsByPhenomenon(xmlInvalidStatus);
    },
    (err: unknown) =>
      err instanceof WarningCurrentUnsupportedError && err.reasonKind === 'unsupported_status',
  );

  // 同一現象キーに複数の発表中Kind (大雨注意報10 + 大雨警報03)
  const xmlMultipleKinds = createWarningXml(
    'VPWW55',
    '2026-09-09T00:00:00Z',
    `
      <Kind><Name>大雨注意報</Name><Code>10</Code><Status>発表</Status></Kind>
      <Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status></Kind>
    `,
  );
  assert.throws(
    () => {
      extractActiveKindsByPhenomenon(xmlMultipleKinds);
    },
    (err: unknown) => err instanceof WarningCurrentConflictError,
  );

  // 矛盾する LastKind (前状態が 08 なのに lastKindCode が 19)
  const beforeItem: WarningCurrentItemInput = {
    sequence: 1,
    kindCode: '08',
    kindName: '高潮警報',
    kindStatus: '発表',
    lastKindCode: null,
    lastKindName: null,
    significancyCode: null,
    significancyName: null,
    warningLevel: null,
    attentionText: null,
    kindIssuedAt: '2026-09-09T00:00:00Z',
    sourceTelegram: 'VPWW57',
  };
  const afterConflict: WarningCurrentItemInput = {
    sequence: 1,
    kindCode: '48',
    kindName: '高潮危険警報',
    kindStatus: '発表',
    lastKindCode: '19', // 08 ではなく 19
    lastKindName: '高潮注意報',
    significancyCode: null,
    significancyName: null,
    warningLevel: null,
    attentionText: null,
    kindIssuedAt: '2026-09-09T01:00:00Z',
    sourceTelegram: 'VPWW57',
  };
  assert.throws(
    () => {
      diffWarningCurrent([beforeItem], [afterConflict]);
    },
    (err: unknown) => err instanceof WarningCurrentConflictError,
  );
});

test('9. 同時刻において集約と個別の内容が競合する場合に conflict エラーとなる', () => {
  // VPWS50: 大雨注意報(10)
  const vpws50 = createWarningXml(
    'VPWS50',
    '2026-09-09T01:00:00Z',
    `<Kind><Name>大雨注意報</Name><Code>10</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>`,
  );
  // VPWW55: 同時刻(01:00)だが大雨警報(03)
  const vpww55 = createWarningXml(
    'VPWW55',
    '2026-09-09T01:00:00Z',
    `<Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>`,
  );
  const individuals = new Map<IndividualWarningTelegramType, ParsedWarningTelegram>([
    ['VPWW55', vpww55],
  ]);

  assert.throws(
    () => {
      reduceWarningCurrent(vpws50, individuals);
    },
    (err: unknown) => err instanceof WarningCurrentConflictError,
  );
});

test('AC3: C3 の正しい段階表 - WARNING_CODE_TABLE の段階表が §4 の独立した期待値と完全一致する', () => {
  const expectedTable: Record<
    string,
    { phenomenonKey: string; telegramType: string; level: 1 | 2 | 3 | 4 }
  > = {
    // heavy_rain
    '10': { phenomenonKey: 'heavy_rain', telegramType: 'VPWW55', level: 1 },
    '03': { phenomenonKey: 'heavy_rain', telegramType: 'VPWW55', level: 2 },
    '43': { phenomenonKey: 'heavy_rain', telegramType: 'VPWW55', level: 3 },
    '33': { phenomenonKey: 'heavy_rain', telegramType: 'VPWW55', level: 4 },
    // landslide
    '29': { phenomenonKey: 'landslide', telegramType: 'VPWW56', level: 1 },
    '09': { phenomenonKey: 'landslide', telegramType: 'VPWW56', level: 2 },
    '49': { phenomenonKey: 'landslide', telegramType: 'VPWW56', level: 3 },
    '39': { phenomenonKey: 'landslide', telegramType: 'VPWW56', level: 4 },
    // storm_surge
    '19': { phenomenonKey: 'storm_surge', telegramType: 'VPWW57', level: 1 },
    '08': { phenomenonKey: 'storm_surge', telegramType: 'VPWW57', level: 2 },
    '48': { phenomenonKey: 'storm_surge', telegramType: 'VPWW57', level: 3 },
    '38': { phenomenonKey: 'storm_surge', telegramType: 'VPWW57', level: 4 },
    // snowstorm
    '13': { phenomenonKey: 'snowstorm', telegramType: 'VPWW58', level: 1 },
    '02': { phenomenonKey: 'snowstorm', telegramType: 'VPWW58', level: 2 },
    '32': { phenomenonKey: 'snowstorm', telegramType: 'VPWW58', level: 4 },
    // storm
    '15': { phenomenonKey: 'storm', telegramType: 'VPWW58', level: 1 },
    '05': { phenomenonKey: 'storm', telegramType: 'VPWW58', level: 2 },
    '35': { phenomenonKey: 'storm', telegramType: 'VPWW58', level: 4 },
    // waves
    '16': { phenomenonKey: 'waves', telegramType: 'VPWW59', level: 1 },
    '07': { phenomenonKey: 'waves', telegramType: 'VPWW59', level: 2 },
    '37': { phenomenonKey: 'waves', telegramType: 'VPWW59', level: 4 },
    // heavy_snow
    '12': { phenomenonKey: 'heavy_snow', telegramType: 'VPWW60', level: 1 },
    '06': { phenomenonKey: 'heavy_snow', telegramType: 'VPWW60', level: 2 },
    '36': { phenomenonKey: 'heavy_snow', telegramType: 'VPWW60', level: 4 },
    // VPWW61
    '14': { phenomenonKey: 'thunder', telegramType: 'VPWW61', level: 1 },
    '17': { phenomenonKey: 'snowmelt', telegramType: 'VPWW61', level: 1 },
    '20': { phenomenonKey: 'fog', telegramType: 'VPWW61', level: 1 },
    '21': { phenomenonKey: 'dry_air', telegramType: 'VPWW61', level: 1 },
    '22': { phenomenonKey: 'avalanche', telegramType: 'VPWW61', level: 1 },
    '23': { phenomenonKey: 'low_temperature', telegramType: 'VPWW61', level: 1 },
    '24': { phenomenonKey: 'frost', telegramType: 'VPWW61', level: 1 },
    '25': { phenomenonKey: 'icing', telegramType: 'VPWW61', level: 1 },
    '26': { phenomenonKey: 'snow_accumulation', telegramType: 'VPWW61', level: 1 },
    '27': { phenomenonKey: 'other_advisory', telegramType: 'VPWW61', level: 1 },
  };

  assert.deepEqual(WARNING_CODE_TABLE, expectedTable);
});

test('AC4: 7 現象の強化・緩和 - 隣接 17 組の往復および最上段・最下段の直接遷移', () => {
  function makeItem(
    phenomenonKey: WarningPhenomenonKey,
    kindCode: string,
    kindName: string,
    telegramType: IndividualWarningTelegramType,
    lastKindCode: string | null = null,
    lastKindName: string | null = null,
  ): WarningCurrentItemInput {
    return {
      sequence: 1,
      kindCode,
      kindName,
      kindStatus: '発表',
      lastKindCode,
      lastKindName,
      significancyCode: null,
      significancyName: null,
      warningLevel: null,
      attentionText: null,
      kindIssuedAt: '2026-09-09T00:00:00Z',
      sourceTelegram: telegramType,
    };
  }

  interface TransitionSpec {
    phenomenonKey: WarningPhenomenonKey;
    telegramType: IndividualWarningTelegramType;
    low: { code: string; name: string };
    high: { code: string; name: string };
  }

  // 隣接 17 組
  const adjacentTransitions: TransitionSpec[] = [
    // heavy_rain: 10<->03, 03<->43, 43<->33
    {
      phenomenonKey: 'heavy_rain',
      telegramType: 'VPWW55',
      low: { code: '10', name: '大雨注意報' },
      high: { code: '03', name: '大雨警報' },
    },
    {
      phenomenonKey: 'heavy_rain',
      telegramType: 'VPWW55',
      low: { code: '03', name: '大雨警報' },
      high: { code: '43', name: '大雨危険警報' },
    },
    {
      phenomenonKey: 'heavy_rain',
      telegramType: 'VPWW55',
      low: { code: '43', name: '大雨危険警報' },
      high: { code: '33', name: '大雨特別警報' },
    },
    // landslide: 29<->09, 09<->49, 49<->39
    {
      phenomenonKey: 'landslide',
      telegramType: 'VPWW56',
      low: { code: '29', name: '土砂災害注意報' },
      high: { code: '09', name: '土砂災害警報' },
    },
    {
      phenomenonKey: 'landslide',
      telegramType: 'VPWW56',
      low: { code: '09', name: '土砂災害警報' },
      high: { code: '49', name: '土砂災害危険警報' },
    },
    {
      phenomenonKey: 'landslide',
      telegramType: 'VPWW56',
      low: { code: '49', name: '土砂災害危険警報' },
      high: { code: '39', name: '土砂災害特別警報' },
    },
    // storm_surge: 19<->08, 08<->48, 48<->38
    {
      phenomenonKey: 'storm_surge',
      telegramType: 'VPWW57',
      low: { code: '19', name: '高潮注意報' },
      high: { code: '08', name: '高潮警報' },
    },
    {
      phenomenonKey: 'storm_surge',
      telegramType: 'VPWW57',
      low: { code: '08', name: '高潮警報' },
      high: { code: '48', name: '高潮危険警報' },
    },
    {
      phenomenonKey: 'storm_surge',
      telegramType: 'VPWW57',
      low: { code: '48', name: '高潮危険警報' },
      high: { code: '38', name: '高潮特別警報' },
    },
    // snowstorm: 13<->02, 02<->32
    {
      phenomenonKey: 'snowstorm',
      telegramType: 'VPWW58',
      low: { code: '13', name: '風雪注意報' },
      high: { code: '02', name: '暴風雪警報' },
    },
    {
      phenomenonKey: 'snowstorm',
      telegramType: 'VPWW58',
      low: { code: '02', name: '暴風雪警報' },
      high: { code: '32', name: '暴風雪特別警報' },
    },
    // storm: 15<->05, 05<->35
    {
      phenomenonKey: 'storm',
      telegramType: 'VPWW58',
      low: { code: '15', name: '強風注意報' },
      high: { code: '05', name: '暴風警報' },
    },
    {
      phenomenonKey: 'storm',
      telegramType: 'VPWW58',
      low: { code: '05', name: '暴風警報' },
      high: { code: '35', name: '暴風特別警報' },
    },
    // waves: 16<->07, 07<->37
    {
      phenomenonKey: 'waves',
      telegramType: 'VPWW59',
      low: { code: '16', name: '波浪注意報' },
      high: { code: '07', name: '波浪警報' },
    },
    {
      phenomenonKey: 'waves',
      telegramType: 'VPWW59',
      low: { code: '07', name: '波浪警報' },
      high: { code: '37', name: '波浪特別警報' },
    },
    // heavy_snow: 12<->06, 06<->36
    {
      phenomenonKey: 'heavy_snow',
      telegramType: 'VPWW60',
      low: { code: '12', name: '大雪注意報' },
      high: { code: '06', name: '大雪警報' },
    },
    {
      phenomenonKey: 'heavy_snow',
      telegramType: 'VPWW60',
      low: { code: '06', name: '大雪警報' },
      high: { code: '36', name: '大雪特別警報' },
    },
  ];

  assert.equal(adjacentTransitions.length, 17);

  // 7 現象の最上段から最下段への直接遷移
  const directTransitions: TransitionSpec[] = [
    {
      phenomenonKey: 'heavy_rain',
      telegramType: 'VPWW55',
      low: { code: '10', name: '大雨注意報' },
      high: { code: '33', name: '大雨特別警報' },
    },
    {
      phenomenonKey: 'landslide',
      telegramType: 'VPWW56',
      low: { code: '29', name: '土砂災害注意報' },
      high: { code: '39', name: '土砂災害特別警報' },
    },
    {
      phenomenonKey: 'storm_surge',
      telegramType: 'VPWW57',
      low: { code: '19', name: '高潮注意報' },
      high: { code: '38', name: '高潮特別警報' },
    },
    {
      phenomenonKey: 'snowstorm',
      telegramType: 'VPWW58',
      low: { code: '13', name: '風雪注意報' },
      high: { code: '32', name: '暴風雪特別警報' },
    },
    {
      phenomenonKey: 'storm',
      telegramType: 'VPWW58',
      low: { code: '15', name: '強風注意報' },
      high: { code: '35', name: '暴風特別警報' },
    },
    {
      phenomenonKey: 'waves',
      telegramType: 'VPWW59',
      low: { code: '16', name: '波浪注意報' },
      high: { code: '37', name: '波浪特別警報' },
    },
    {
      phenomenonKey: 'heavy_snow',
      telegramType: 'VPWW60',
      low: { code: '12', name: '大雪注意報' },
      high: { code: '36', name: '大雪特別警報' },
    },
  ];

  assert.equal(directTransitions.length, 7);

  const allTransitions = [...adjacentTransitions, ...directTransitions];

  for (const trans of allTransitions) {
    const itemLow = makeItem(
      trans.phenomenonKey,
      trans.low.code,
      trans.low.name,
      trans.telegramType,
    );
    const itemHighFromLow = makeItem(
      trans.phenomenonKey,
      trans.high.code,
      trans.high.name,
      trans.telegramType,
      trans.low.code,
      trans.low.name,
    );

    // 正方向: low -> high (strengthened)
    const forwardDiff = diffWarningCurrent([itemLow], [itemHighFromLow]);
    assert.deepEqual(forwardDiff, [
      {
        phenomenonKey: trans.phenomenonKey,
        changeType: 'strengthened',
        before: itemLow,
        after: itemHighFromLow,
      },
    ]);

    // 逆方向: high -> low (weakened)
    const itemLowFromHigh = makeItem(
      trans.phenomenonKey,
      trans.low.code,
      trans.low.name,
      trans.telegramType,
      trans.high.code,
      trans.high.name,
    );
    const itemHigh = makeItem(
      trans.phenomenonKey,
      trans.high.code,
      trans.high.name,
      trans.telegramType,
    );

    const reverseDiff = diffWarningCurrent([itemHigh], [itemLowFromHigh]);
    assert.deepEqual(reverseDiff, [
      {
        phenomenonKey: trans.phenomenonKey,
        changeType: 'weakened',
        before: itemHigh,
        after: itemLowFromHigh,
      },
    ]);
  }
});

test('reduceWarningCurrent: cancelledStreams が指定された場合、集約側が保持していても当該ストリームの現象は採用されない', () => {
  // VPWS50: 大雨警報(03, VPWW55), 雷注意報(14, VPWW61)
  const baseKinds = `
    <Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
    <Kind><Name>雷注意報</Name><Code>14</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
  `;
  const vpws50 = createWarningXml('VPWS50', '2026-09-09T01:00:00Z', baseKinds);

  // VPWW55 の取消電文（ダミー Kind を含む。本文は解釈されない）
  const vpww55CancelKinds = `
    <Kind><Name>ダミー大雨警報</Name><Code>03</Code><Status>発表</Status></Kind>
  `;
  const vpww55Cancel = createWarningXml('VPWW55', '2026-09-09T02:00:00Z', vpww55CancelKinds);

  const individuals = new Map<IndividualWarningTelegramType, ParsedWarningTelegram>();
  const cancelledStreams = new Map<IndividualWarningTelegramType, ParsedWarningTelegram>([
    ['VPWW55', vpww55Cancel],
  ]);

  const reduced = reduceWarningCurrent(vpws50, individuals, cancelledStreams);

  // 大雨警報 (03) は消え、雷注意報 (14) のみが残る
  assert.equal(reduced.items.length, 1);
  assert.equal(reduced.items[0]!.kindCode, '14');
  assert.equal(reduced.items[0]!.sourceTelegram, 'VPWS50');

  // contributingTelegramTypes に取消電文 (VPWW55) と集約 (VPWS50) の双方が含まれる
  assert.deepEqual(new Set(reduced.contributingTelegramTypes), new Set(['VPWW55', 'VPWS50']));
});

test('reduceWarningCurrent: 取消電文より新しい VPWS50 が届いた場合は集約側が採用される', () => {
  // VPWS50: 大雨警報(03, VPWW55) (03:00)
  const baseKinds = `
    <Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>2026-09-09T03:00:00Z</DateTime></Kind>
  `;
  const vpws50 = createWarningXml('VPWS50', '2026-09-09T03:00:00Z', baseKinds);

  // 古い VPWW55 の取消電文 (02:00)（ダミー Kind を含む。本文は解釈されない）
  const vpww55CancelKinds = `
    <Kind><Name>ダミー大雨警報</Name><Code>03</Code><Status>発表</Status></Kind>
  `;
  const vpww55Cancel = createWarningXml('VPWW55', '2026-09-09T02:00:00Z', vpww55CancelKinds);

  const individuals = new Map<IndividualWarningTelegramType, ParsedWarningTelegram>();
  const cancelledStreams = new Map<IndividualWarningTelegramType, ParsedWarningTelegram>([
    ['VPWW55', vpww55Cancel],
  ]);

  const reduced = reduceWarningCurrent(vpws50, individuals, cancelledStreams);

  // 取消より新しい VPWS50 の大雨警報が採用される
  assert.equal(reduced.items.length, 1);
  assert.equal(reduced.items[0]!.kindCode, '03');
  assert.equal(reduced.items[0]!.sourceTelegram, 'VPWS50');
});
