import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeDatabase } from '../src/database/index.js';
import {
  findTelegramReceptionById,
  recordTelegramReception,
} from '../src/repositories/telegramReceptionRepository.js';
import type { TelegramReceptionInput } from '../src/repositories/types.js';
import { parseWarningTelegram } from '../src/polling/jmaWarningTelegramParser.js';
import {
  DEFAULT_WARNING_TARGET_AREA,
  processWarningTelegramReception,
  reprocessPendingWarningTelegramReceptions,
} from '../src/polling/jmaWarningTelegramProcessor.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');
const reportDateTime = '2026-09-09T00:00:00.000Z';

function telegramXml(
  options: {
    readonly status?: '通常' | '訓練' | '試験';
    readonly type?: string;
    readonly municipalCode?: string;
    readonly kinds?: string;
    readonly extraWarnings?: string;
    readonly headlineAreaCode?: string;
  } = {},
): string {
  const status = options.status ?? '通常';
  const type = options.type ?? '気象警報・注意報（市町村等）';
  const municipalCode = options.municipalCode ?? '1310800';
  const kinds =
    options.kinds ?? '<Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status></Kind>';
  return `<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
  <Control>
    <Status>${status}</Status>
    <DateTime>2026-09-09T00:00:00Z</DateTime>
  </Control>
  <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><ReportDateTime>2026-09-09T00:00:00Z</ReportDateTime><TargetDateTime>2026-09-09T01:00:00Z</TargetDateTime><InfoType>発表</InfoType><EventID>event-1</EventID><Serial>1</Serial>${options.headlineAreaCode ? `<Headline><Information><Item><Area><Code>${options.headlineAreaCode}</Code></Area></Item></Information></Headline>` : ''}</Head>
  <Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/"><Warning type="${type}"><Item>${kinds}<Area><Name>江東区</Name><Code>${municipalCode}</Code></Area></Item></Warning>${options.extraWarnings ?? ''}</Body>
</Report>`;
}

function expected(telegramType: string, status: 'normal' | 'training' | 'test' = 'normal') {
  return {
    telegramType,
    controlStatus: status,
    reportDateTime,
    controlDateTime: reportDateTime,
  } as const;
}

test('VPWW55–61 と VPWS50 は市町村等 Warning だけを完全一致で解析する', () => {
  for (const telegramType of [
    'VPWW55',
    'VPWW56',
    'VPWW57',
    'VPWW58',
    'VPWW59',
    'VPWW60',
    'VPWW61',
    'VPWS50',
  ]) {
    const result = parseWarningTelegram(
      telegramXml(),
      expected(telegramType),
      DEFAULT_WARNING_TARGET_AREA,
    );
    assert.equal(result.ok, true, telegramType);
    if (result.ok) {
      assert.deepEqual(result.value.kinds, [
        {
          sequence: 1,
          kindType: 'warning',
          name: '大雨警報',
          code: '03',
          status: '発表',
          dateTime: null,
          lastKind: null,
          properties: [],
          addition: null,
        },
      ]);
      assert.equal(result.value.warningType, '気象警報・注意報（市町村等）');
    }
  }
});

test('複数 Property を XML 出現順で保持し、訓練・試験を区別する', () => {
  const kinds =
    '<Kind><Name>濃霧注意報</Name><Code>16</Code><Status>継続</Status><DateTime>2026-09-09T01:00:00+09:00</DateTime><LastKind><Name>濃霧注意報</Name><Code>16</Code></LastKind><Property source="jma"><Type>濃霧危険度</Type></Property><Property><Type>濃霧</Type></Property><Addition><Text>補足</Text></Addition></Kind><Kind><Name>雷注意報</Name><Code>14</Code><Status>発表</Status></Kind>';
  const training = parseWarningTelegram(
    telegramXml({ status: '訓練', kinds }),
    expected('VPWW61', 'training'),
    DEFAULT_WARNING_TARGET_AREA,
  );
  assert.equal(training.ok, true);
  if (training.ok) {
    assert.equal(training.value.controlStatus, 'training');
    assert.deepEqual(training.value.kinds[0], {
      sequence: 1,
      kindType: 'warning',
      name: '濃霧注意報',
      code: '16',
      status: '継続',
      dateTime: '2026-09-08T16:00:00.000Z',
      lastKind: { name: '濃霧注意報', code: '16' },
      properties: [
        {
          namespaceUri: 'http://xml.kishou.go.jp/jmaxml1/body/meteorology1/',
          localName: 'Property',
          attributes: [{ namespaceUri: null, localName: 'source', value: 'jma' }],
          text: null,
          children: [
            {
              namespaceUri: 'http://xml.kishou.go.jp/jmaxml1/body/meteorology1/',
              localName: 'Type',
              attributes: [],
              text: '濃霧危険度',
              children: [],
            },
          ],
        },
        {
          namespaceUri: 'http://xml.kishou.go.jp/jmaxml1/body/meteorology1/',
          localName: 'Property',
          attributes: [],
          text: null,
          children: [
            {
              namespaceUri: 'http://xml.kishou.go.jp/jmaxml1/body/meteorology1/',
              localName: 'Type',
              attributes: [],
              text: '濃霧',
              children: [],
            },
          ],
        },
      ],
      addition: {
        namespaceUri: 'http://xml.kishou.go.jp/jmaxml1/body/meteorology1/',
        localName: 'Addition',
        attributes: [],
        text: null,
        children: [
          {
            namespaceUri: 'http://xml.kishou.go.jp/jmaxml1/body/meteorology1/',
            localName: 'Text',
            attributes: [],
            text: '補足',
            children: [],
          },
        ],
      },
    });
    assert.equal(training.value.kinds[1]?.kindType, 'warning');
  }
  const testResult = parseWarningTelegram(
    telegramXml({ status: '試験' }),
    expected('VPWW55', 'test'),
    DEFAULT_WARNING_TARGET_AREA,
  );
  assert.equal(testResult.ok, true);
  if (testResult.ok) assert.equal(testResult.value.controlStatus, 'test');
});

test('no_warning は Status-only と公式の DateTime 付き形式を正常 Kind として保持する', () => {
  const noWarning = parseWarningTelegram(
    telegramXml({ kinds: '<Kind><Status>発表警報・注意報はなし</Status></Kind>' }),
    expected('VPWS50'),
    DEFAULT_WARNING_TARGET_AREA,
  );
  assert.deepEqual(noWarning, {
    ok: true,
    value: {
      telegramType: 'VPWS50',
      controlStatus: 'normal',
      reportDateTime,
      controlDateTime: reportDateTime,
      targetDateTime: '2026-09-09T01:00:00.000Z',
      infoType: '発表',
      eventId: 'event-1',
      serial: '1',
      area: { code: '1310800', name: '江東区' },
      warningType: '気象警報・注意報（市町村等）',
      kinds: [
        {
          kindType: 'no_warning',
          sequence: 1,
          status: '発表警報・注意報はなし',
          dateTime: null,
        },
      ],
    },
  });
  const withDateTime = parseWarningTelegram(
    telegramXml({
      municipalCode: '0151700',
      kinds:
        '<Kind><Status>発表警報・注意報はなし</Status>\n<DateTime type="発表時刻">2019-10-12T04:11:00+09:00</DateTime></Kind>',
    }),
    expected('VPWS50'),
    { municipalCode: '0151700', displayName: '礼文町' },
  );
  assert.equal(withDateTime.ok, true);
  if (withDateTime.ok) {
    assert.deepEqual(withDateTime.value.kinds, [
      {
        kindType: 'no_warning',
        sequence: 1,
        status: '発表警報・注意報はなし',
        dateTime: '2019-10-11T19:11:00.000Z',
      },
    ]);
  }
});

test('no_warning の属性、未知子、重複、順序違反、不正日時を拒否する', () => {
  for (const kinds of [
    '<Kind flag="1"><Status>発表警報・注意報はなし</Status></Kind>',
    '<Kind><Status flag="1">発表警報・注意報はなし</Status></Kind>',
    '<Kind><Status>発表警報・注意報はなし</Status><DateTime type="発表時刻" extra="1">2019-10-12T04:11:00+09:00</DateTime></Kind>',
    '<Kind><Status>発表警報・注意報はなし</Status><Unknown>値</Unknown></Kind>',
    '<Kind><Status>発表警報・注意報はなし</Status><DateTime type="発表時刻">2019-10-12T04:11:00+09:00</DateTime><DateTime type="発表時刻">2019-10-12T04:11:00+09:00</DateTime></Kind>',
    '<Kind><DateTime type="発表時刻">2019-10-12T04:11:00+09:00</DateTime><Status>発表警報・注意報はなし</Status></Kind>',
    '<Kind><Status>発表警報・注意報はなし</Status><DateTime type="別の時刻">2019-10-12T04:11:00+09:00</DateTime></Kind>',
    '<Kind><Status>発表警報・注意報はなし</Status><DateTime type="発表時刻">2019-02-30T04:11:00+09:00</DateTime></Kind>',
  ]) {
    const result = parseWarningTelegram(
      telegramXml({ kinds }),
      expected('VPWS50'),
      DEFAULT_WARNING_TARGET_AREA,
    );
    assert.equal(result.ok, false, kinds);
    if (!result.ok) assert.equal(result.disposition, '未対応構造');
  }
});

test('日時は時刻とタイムゾーンを必須にして厳密に検証する', () => {
  for (const invalidDateTime of [
    '2026-09-09',
    '2026-09-09T00:00:00',
    '2026-02-30T00:00:00Z',
    '2026-09-09T24:00:00Z',
    '2026-09-09T00:00:00+14:01',
  ]) {
    const invalidKindDate = parseWarningTelegram(
      telegramXml({
        kinds: `<Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>${invalidDateTime}</DateTime></Kind>`,
      }),
      expected('VPWW55'),
      DEFAULT_WARNING_TARGET_AREA,
    );
    assert.deepEqual(invalidKindDate, {
      ok: false,
      disposition: '未対応構造',
      reason: 'Body/Warning/Item/Kind/DateTime が不正です',
    });
  }
  const fraction = parseWarningTelegram(
    telegramXml({
      kinds:
        '<Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>2026-09-09T00:00:00.123Z</DateTime></Kind>',
    }),
    expected('VPWW55'),
    DEFAULT_WARNING_TARGET_AREA,
  );
  assert.equal(fraction.ok, true);
  if (fraction.ok) assert.equal(fraction.value.kinds[0]?.kindType, 'warning');
});

test('別 type、Headline 相当の別 namespace、保存値不一致を採用しない', () => {
  const otherType = parseWarningTelegram(
    telegramXml({ type: '気象警報・注意報（府県予報区等）' }),
    expected('VPWW55'),
    DEFAULT_WARNING_TARGET_AREA,
  );
  assert.deepEqual(otherType, {
    ok: false,
    disposition: '未対応構造',
    reason:
      'Body/Warning[@type="気象警報・注意報（市町村等）"] は1件である必要があります（実際: 0件）',
  });
  const otherArea = parseWarningTelegram(
    telegramXml({ municipalCode: '1310900', headlineAreaCode: '1310800' }),
    expected('VPWW55'),
    DEFAULT_WARNING_TARGET_AREA,
  );
  assert.deepEqual(otherArea, {
    ok: false,
    disposition: '対象地域外',
    reason: '対象市町村等コードがありません: 1310800',
  });
  const mismatch = parseWarningTelegram(
    telegramXml(),
    expected('VPWW55', 'training'),
    DEFAULT_WARNING_TARGET_AREA,
  );
  assert.deepEqual(mismatch, {
    ok: false,
    disposition: '未対応構造',
    reason: 'C1保存値と Control/Status または日時が一致しません',
  });
});

function receptionInput(index: number): TelegramReceptionInput {
  return {
    fetchAttemptId: null,
    feedKind: null,
    feedEntryId: null,
    documentUrl: `https://example.test/${index}_VPWW55_test.xml`,
    telegramType: 'VPWW55',
    title: null,
    controlStatus: 'normal',
    infoType: '発表',
    eventId: null,
    serial: null,
    controlDateTime: reportDateTime,
    reportDateTime,
    targetDateTime: null,
    receivedAt: `2026-09-09T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
    adoptionResult: null,
    adoptionReason: null,
    adoptionDecidedAt: null,
    rawBody: telegramXml(),
    bodyBytes: 1,
    contentHash: null,
    areas: [],
  };
}

test('未判定の対象原文を keyset で一度だけ処理し、履歴だけを更新する', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'wx-warning-parser-'));
  const database = initializeDatabase({
    databasePath: join(directory, 'test.sqlite3'),
    migrationsDirectory,
  });
  try {
    const receptions = Array.from({ length: 101 }, (_, index) =>
      recordTelegramReception(database.connection, receptionInput(index)),
    );
    const outcome = await reprocessPendingWarningTelegramReceptions(
      database.connection,
      DEFAULT_WARNING_TARGET_AREA,
      () => '2026-09-09T02:00:00.000Z',
    );
    assert.deepEqual(outcome, { processedCount: 101 });
    const snapshotCount = database.connection
      .prepare('SELECT COUNT(*) AS count FROM warning_current_snapshot')
      .get() as { count: number };
    assert.equal(snapshotCount.count, 0);
    assert.equal(
      findTelegramReceptionById(database.connection, receptions[100]!.id)?.adoptionResult,
      '警報・注意報として解析済み',
    );
    assert.deepEqual(
      await reprocessPendingWarningTelegramReceptions(
        database.connection,
        DEFAULT_WARNING_TARGET_AREA,
        () => '2026-09-09T03:00:00.000Z',
      ),
      { processedCount: 0 },
    );
    const one = findTelegramReceptionById(database.connection, receptions[0]!.id)!;
    processWarningTelegramReception(
      database.connection,
      one,
      '2026-09-09T04:00:00.000Z',
      DEFAULT_WARNING_TARGET_AREA,
    );
    assert.equal(
      findTelegramReceptionById(database.connection, one.id)?.adoptionDecidedAt,
      '2026-09-09T04:00:00.000Z',
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
