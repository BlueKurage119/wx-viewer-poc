import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWarningTelegram } from '../src/polling/jmaWarningTelegramParser.js';
import {
  diffWarningCurrent,
  extractActiveKindsByPhenomenon,
  reduceWarningCurrent,
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
  // VPWS50: 大雨警報(03), 高潮注意報(38), 雷注意報(14)
  const kindsXml = `
    <Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
    <Kind><Name>高潮注意報</Name><Code>38</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
    <Kind><Name>雷注意報</Name><Code>14</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
  `;
  const vpws50 = createWarningXml('VPWS50', '2026-09-09T01:00:00Z', kindsXml);
  const individuals = new Map<IndividualWarningTelegramType, ParsedWarningTelegram>();

  const reduced = reduceWarningCurrent(vpws50, individuals);
  assert.equal(reduced.items.length, 3);
  assert.deepEqual(
    reduced.items.map((i) => i.kindCode),
    ['03', '38', '14'], // VPWW55, VPWW57, VPWW61 順
  );
  assert.deepEqual(reduced.contributingTelegramTypes, ['VPWS50']);

  // 初回は before=[] からの diff
  const changes = diffWarningCurrent([], reduced.items);
  assert.equal(changes.length, 3);
  assert.ok(changes.every((c) => c.changeType === 'new'));
  assert.equal(changes.find((c) => c.phenomenonKey === 'heavy_rain')?.after?.kindCode, '03');
  assert.equal(changes.find((c) => c.phenomenonKey === 'storm_surge')?.after?.kindCode, '38');
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
  // VPWS50: 大雨注意報(33, 01:00), 高潮注意報(38, 01:00), 雷注意報(14, 01:00)
  const baseKinds = `
    <Kind><Name>大雨注意報</Name><Code>33</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
    <Kind><Name>高潮注意報</Name><Code>38</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
    <Kind><Name>雷注意報</Name><Code>14</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
  `;
  const vpws50 = createWarningXml('VPWS50', '2026-09-09T01:00:00Z', baseKinds);

  // VPWW55: 大雨警報(03, 02:00) へ強化
  const vpww55Kinds = `
    <Kind><Name>大雨警報</Name><Code>03</Code><Status>警報から注意報</Status><DateTime>2026-09-09T02:00:00Z</DateTime><LastKind><Name>大雨注意報</Name><Code>33</Code></LastKind></Kind>
  `;
  const vpww55 = createWarningXml('VPWW55', '2026-09-09T02:00:00Z', vpww55Kinds);

  const individuals = new Map<IndividualWarningTelegramType, ParsedWarningTelegram>([
    ['VPWW55', vpww55],
  ]);

  const reduced = reduceWarningCurrent(vpws50, individuals);
  assert.equal(reduced.items.length, 3);
  assert.equal(reduced.items[0]!.kindCode, '03');
  assert.equal(reduced.items[0]!.sourceTelegram, 'VPWW55');
  assert.equal(reduced.items[1]!.kindCode, '38');
  assert.equal(reduced.items[1]!.sourceTelegram, 'VPWS50');
  assert.equal(reduced.items[2]!.kindCode, '14');
  assert.equal(reduced.items[2]!.sourceTelegram, 'VPWS50');

  assert.deepEqual(new Set(reduced.contributingTelegramTypes), new Set(['VPWW55', 'VPWS50']));
});

test('4. VPWW61 の複数 Kind をすべて保持し、同ストリームの no-warning でだけすべて解除する', () => {
  const vpws50 = createWarningXml(
    'VPWS50',
    '2026-09-09T01:00:00Z',
    `<Kind><Name>大雨注意報</Name><Code>33</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>`,
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
  assert.equal(reduced.items[0]!.kindCode, '33'); // 大雨注意報 (VPWS50)
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
  assert.equal(reduced2.items[0]!.kindCode, '33'); // 大雨注意報は残る
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

  // 同一現象キーに複数の発表中Kind (大雨注意報33 + 大雨警報03)
  const xmlMultipleKinds = createWarningXml(
    'VPWW55',
    '2026-09-09T00:00:00Z',
    `
      <Kind><Name>大雨注意報</Name><Code>33</Code><Status>発表</Status></Kind>
      <Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status></Kind>
    `,
  );
  assert.throws(
    () => {
      extractActiveKindsByPhenomenon(xmlMultipleKinds);
    },
    (err: unknown) => err instanceof WarningCurrentConflictError,
  );

  // 矛盾する LastKind (前状態が 08 なのに lastKindCode が 38)
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
    lastKindCode: '38', // 08 ではなく 38
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
  // VPWS50: 大雨注意報(33)
  const vpws50 = createWarningXml(
    'VPWS50',
    '2026-09-09T01:00:00Z',
    `<Kind><Name>大雨注意報</Name><Code>33</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>`,
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
