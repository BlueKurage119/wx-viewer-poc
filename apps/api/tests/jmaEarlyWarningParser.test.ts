import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseEarlyWarning,
  DEFAULT_EARLY_WARNING_TARGET_AREA,
  EXPECTED_METEOROLOGICAL_INFOS_TYPE,
  EXPECTED_VPFD61_INFO_KIND,
  EXPECTED_VPFW60_INFO_KIND,
} from '../src/polling/jmaEarlyWarningParser.js';
import type { TelegramReception } from '../src/repositories/types.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const jmaFixturesDir = join(apiRoot, 'tests/fixtures/jma');

const defaultExpectedVpfd61: Pick<
  TelegramReception,
  'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
> = {
  telegramType: 'VPFD61',
  controlStatus: 'normal',
  reportDateTime: '2026-09-09T00:00:00.000Z',
  controlDateTime: '2026-09-09T00:00:00.000Z',
};

const defaultExpectedVpfw60: Pick<
  TelegramReception,
  'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
> = {
  telegramType: 'VPFW60',
  controlStatus: 'normal',
  reportDateTime: '2026-09-09T00:00:00.000Z',
  controlDateTime: '2026-09-09T00:00:00.000Z',
};

interface BuildEarlyWarningXmlOptions {
  controlTitle?: string;
  controlStatus?: string;
  controlDateTime?: string;
  headTitle?: string;
  reportDateTime?: string;
  targetDateTime?: string;
  targetDuration?: string;
  eventId?: string;
  infoType?: string;
  infoKind?: string;
  infoKindVersion?: string;
  meteorologicalInfosType?: string;
  extraMeteorologicalInfos?: string;
  timeSeriesInfoCount?: number;
  timeDefines?: Array<{ timeId: string; dateTime: string; duration: string; name?: string }>;
  items?: Array<{
    areaCode: string;
    areaName: string;
    kinds: Array<{
      propertyType: string;
      warnings: Array<{ refId: string; rankValue?: string | null; condition?: string | null }>;
    }>;
  }>;
  customXml?: string;
}

function buildEarlyWarningXml(options: BuildEarlyWarningXmlOptions = {}): string {
  if (options.customXml) return options.customXml;

  const controlTitle = options.controlTitle ?? '早期注意情報（明後日まで）';
  const controlStatus = options.controlStatus ?? '通常';
  const controlDateTime = options.controlDateTime ?? '2026-09-09T00:00:00Z';
  const headTitle = options.headTitle ?? '東京都早期注意情報';
  const reportDateTime = options.reportDateTime ?? '2026-09-09T09:00:00+09:00';
  const targetDateTime = options.targetDateTime ?? '2026-09-09T09:00:00+09:00';
  const targetDuration = options.targetDuration ?? 'P2DT15H';
  const eventId = options.eventId ?? '';
  const infoType = options.infoType ?? '発表';
  const infoKind = options.infoKind ?? EXPECTED_VPFD61_INFO_KIND;
  const infoKindVersion = options.infoKindVersion ?? '1.5_0';
  const meteorologicalInfosType =
    options.meteorologicalInfosType ?? EXPECTED_METEOROLOGICAL_INFOS_TYPE;

  const defaultTimeDefines = [
    {
      timeId: '1',
      dateTime: '2026-09-09T09:00:00+09:00',
      duration: 'PT6H',
      name: '９日０９時から１５時',
    },
    {
      timeId: '2',
      dateTime: '2026-09-09T15:00:00+09:00',
      duration: 'PT6H',
      name: '９日１５時から２１時',
    },
  ];

  const defaultItems = [
    {
      areaCode: '130010',
      areaName: '東京地方',
      kinds: [
        {
          propertyType: '大雨の警報級の可能性',
          warnings: [
            { refId: '1', rankValue: '高' },
            { refId: '2', condition: '値なし' },
          ],
        },
        {
          propertyType: '雪の警報級の可能性',
          warnings: [
            { refId: '1', rankValue: 'なし' },
            { refId: '2', rankValue: '中' },
          ],
        },
      ],
    },
  ];

  const timeDefinesList = options.timeDefines ?? defaultTimeDefines;
  const itemsList = options.items ?? defaultItems;

  const timeDefinesXml = timeDefinesList
    .map(
      (td) => `
      <TimeDefine timeId="${td.timeId}">
        <DateTime>${td.dateTime}</DateTime>
        <Duration>${td.duration}</Duration>
        ${td.name ? `<Name>${td.name}</Name>` : ''}
      </TimeDefine>
    `,
    )
    .join('');

  const itemsXml = itemsList
    .map(
      (item) => `
      <Item>
        ${item.kinds
          .map(
            (k) => `
          <Kind>
            <Property>
              <Type>${k.propertyType}</Type>
              <PossibilityRankOfWarningPart>
                ${k.warnings
                  .map((w) => {
                    const condAttr =
                      w.condition !== undefined && w.condition !== null
                        ? ` condition="${w.condition}"`
                        : '';
                    if (w.rankValue !== undefined && w.rankValue !== null) {
                      return `<jmx_eb:PossibilityRankOfWarning refID="${w.refId}" type="${k.propertyType}"${condAttr}>${w.rankValue}</jmx_eb:PossibilityRankOfWarning>`;
                    }
                    return `<jmx_eb:PossibilityRankOfWarning refID="${w.refId}" type="${k.propertyType}"${condAttr}/>`;
                  })
                  .join('\n')}
              </PossibilityRankOfWarningPart>
            </Property>
          </Kind>
        `,
          )
          .join('\n')}
        <Area>
          <Name>${item.areaName}</Name>
          <Code>${item.areaCode}</Code>
        </Area>
      </Item>
    `,
    )
    .join('\n');

  const singleTimeSeries = `
    <TimeSeriesInfo>
      <TimeDefines>
        ${timeDefinesXml}
      </TimeDefines>
      ${itemsXml}
    </TimeSeriesInfo>
  `;

  const timeSeriesCount = options.timeSeriesInfoCount ?? 1;
  let allTimeSeries = '';
  for (let i = 0; i < timeSeriesCount; i += 1) {
    allTimeSeries += singleTimeSeries;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx_add="http://xml.kishou.go.jp/jmaxml1/addition1/">
<Control>
  <Title>${controlTitle}</Title>
  <DateTime>${controlDateTime}</DateTime>
  <Status>${controlStatus}</Status>
  <EditorialOffice>気象庁</EditorialOffice>
  <PublishingOffice>気象庁</PublishingOffice>
</Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
  <Title>${headTitle}</Title>
  <ReportDateTime>${reportDateTime}</ReportDateTime>
  <TargetDateTime>${targetDateTime}</TargetDateTime>
  <TargetDuration>${targetDuration}</TargetDuration>
  <EventID>${eventId}</EventID>
  <InfoType>${infoType}</InfoType>
  <Serial/>
  <InfoKind>${infoKind}</InfoKind>
  <InfoKindVersion>${infoKindVersion}</InfoKindVersion>
</Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
  <MeteorologicalInfos type="${meteorologicalInfosType}">
    ${allTimeSeries}
  </MeteorologicalInfos>
  ${options.extraMeteorologicalInfos ?? ''}
</Body>
</Report>`;
}

// -------------------------------------------------------------------------------------------------
// 正常系テスト
// -------------------------------------------------------------------------------------------------

test('parseEarlyWarning: VPFD61 を near として解析し、各項目が完全一致する', () => {
  const xml = buildEarlyWarningXml();
  const result = parseEarlyWarning(xml, defaultExpectedVpfd61, DEFAULT_EARLY_WARNING_TARGET_AREA);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.segment, 'near');
  assert.equal(result.value.telegramType, 'VPFD61');
  assert.equal(result.value.controlStatus, 'normal');
  assert.equal(result.value.controlDateTime, '2026-09-09T00:00:00.000Z');
  assert.equal(result.value.reportDateTime, '2026-09-09T00:00:00.000Z');
  assert.equal(result.value.infoType, '発表');
  assert.equal(result.value.eventId, null);
  assert.equal(result.value.infoKindVersion, '1.5_0');
  assert.equal(result.value.area.code, '130010');
  assert.equal(result.value.area.name, '東京地方');

  // TimeDefines の検証
  assert.equal(result.value.timeDefines.length, 2);
  assert.deepEqual(result.value.timeDefines[0], {
    timeId: '1',
    sequence: 1,
    timeFrom: '2026-09-09T00:00:00.000Z',
    timeTo: '2026-09-09T06:00:00.000Z',
    duration: 'PT6H',
  });
  assert.deepEqual(result.value.timeDefines[1], {
    timeId: '2',
    sequence: 2,
    timeFrom: '2026-09-09T06:00:00.000Z',
    timeTo: '2026-09-09T12:00:00.000Z',
    duration: 'PT6H',
  });

  // Cells の検証
  assert.equal(result.value.cells.length, 4);
  assert.deepEqual(result.value.cells[0], {
    refId: '1',
    phenomenonCode: '大雨の警報級の可能性',
    phenomenonName: '大雨の警報級の可能性',
    rankValue: '高',
    condition: null,
  });
  assert.deepEqual(result.value.cells[1], {
    refId: '2',
    phenomenonCode: '大雨の警報級の可能性',
    phenomenonName: '大雨の警報級の可能性',
    rankValue: null,
    condition: '値なし',
  });
  assert.deepEqual(result.value.cells[2], {
    refId: '1',
    phenomenonCode: '雪の警報級の可能性',
    phenomenonName: '雪の警報級の可能性',
    rankValue: 'なし',
    condition: null,
  });
  assert.deepEqual(result.value.cells[3], {
    refId: '2',
    phenomenonCode: '雪の警報級の可能性',
    phenomenonName: '雪の警報級の可能性',
    rankValue: '中',
    condition: null,
  });
});

test('parseEarlyWarning: VPFW60 を far として解析し、「雨」を大雨や土砂災害へ複製しない', () => {
  const xml = buildEarlyWarningXml({
    controlTitle: '警報級の可能性（明後日以降）',
    infoKind: EXPECTED_VPFW60_INFO_KIND,
    infoKindVersion: '1.2_0',
    timeDefines: [
      { timeId: '1', dateTime: '2026-09-11T00:00:00+09:00', duration: 'P1D' },
      { timeId: '2', dateTime: '2026-09-12T00:00:00+09:00', duration: 'P1D' },
    ],
    items: [
      {
        areaCode: '130010',
        areaName: '東京地方',
        kinds: [
          {
            propertyType: '雨の警報級の可能性',
            warnings: [
              { refId: '1', rankValue: '高' },
              { refId: '2', condition: '値なし' },
            ],
          },
        ],
      },
    ],
  });

  const expectedVpfw60: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  > = {
    telegramType: 'VPFW60',
    controlStatus: 'normal',
    reportDateTime: '2026-09-09T00:00:00.000Z',
    controlDateTime: '2026-09-09T00:00:00.000Z',
  };

  const result = parseEarlyWarning(xml, expectedVpfw60, DEFAULT_EARLY_WARNING_TARGET_AREA);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.segment, 'far');
  assert.equal(result.value.telegramType, 'VPFW60');
  assert.equal(result.value.cells.length, 2);
  assert.deepEqual(result.value.cells[0], {
    refId: '1',
    phenomenonCode: '雨の警報級の可能性',
    phenomenonName: '雨の警報級の可能性',
    rankValue: '高',
    condition: null,
  });
  assert.deepEqual(result.value.cells[1], {
    refId: '2',
    phenomenonCode: '雨の警報級の可能性',
    phenomenonName: '雨の警報級の可能性',
    rankValue: null,
    condition: '値なし',
  });
});

test('parseEarlyWarning: 「なし」は rankValue="なし", condition=null、condition="値なし" は rankValue=null, condition="値なし" として厳密に区別される', () => {
  const xml = buildEarlyWarningXml({
    items: [
      {
        areaCode: '130010',
        areaName: '東京地方',
        kinds: [
          {
            propertyType: '風（風雪）の警報級の可能性',
            warnings: [
              { refId: '1', rankValue: 'なし', condition: null },
              { refId: '2', rankValue: null, condition: '値なし' },
            ],
          },
        ],
      },
    ],
  });

  const result = parseEarlyWarning(xml, defaultExpectedVpfd61, DEFAULT_EARLY_WARNING_TARGET_AREA);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const cellNashi = result.value.cells[0];
  const cellAtaiNashi = result.value.cells[1];

  assert.equal(cellNashi.rankValue, 'なし');
  assert.equal(cellNashi.condition, null);

  assert.equal(cellAtaiNashi.rankValue, null);
  assert.equal(cellAtaiNashi.condition, '値なし');

  // 両者が同一でないことを確認
  assert.notDeepEqual(cellNashi, cellAtaiNashi);
});

// -------------------------------------------------------------------------------------------------
// 異常系テスト
// -------------------------------------------------------------------------------------------------

test('parseEarlyWarning: 対象外 - telegramType が VPFD61/VPFW60 以外', () => {
  const xml = buildEarlyWarningXml();
  const result = parseEarlyWarning(
    xml,
    { ...defaultExpectedVpfd61, telegramType: 'VPWW55' },
    DEFAULT_EARLY_WARNING_TARGET_AREA,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '対象外');
});

test('parseEarlyWarning: 対象外 - VPFD61 で InfoKind が不一致', () => {
  const xml = buildEarlyWarningXml({ infoKind: '警報級の可能性（明後日以降）' });
  const result = parseEarlyWarning(xml, defaultExpectedVpfd61, DEFAULT_EARLY_WARNING_TARGET_AREA);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '対象外');
});

test('parseEarlyWarning: 対象外 - VPFW60 で InfoKind が不一致', () => {
  const xml = buildEarlyWarningXml({ infoKind: EXPECTED_VPFD61_INFO_KIND });
  const result = parseEarlyWarning(xml, defaultExpectedVpfw60, DEFAULT_EARLY_WARNING_TARGET_AREA);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '対象外');
});

test('parseEarlyWarning: 対象地域外 - 対象 Area (130010) が電文に含まれない', () => {
  const xml = buildEarlyWarningXml({
    items: [
      {
        areaCode: '370000',
        areaName: '香川県',
        kinds: [
          {
            propertyType: '大雨の警報級の可能性',
            warnings: [{ refId: '1', rankValue: '中' }],
          },
        ],
      },
    ],
  });
  const result = parseEarlyWarning(xml, defaultExpectedVpfd61, DEFAULT_EARLY_WARNING_TARGET_AREA);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '対象地域外');
});

test('parseEarlyWarning: 未対応構造 - XML パースエラー', () => {
  const result = parseEarlyWarning(
    '<invalid <xml',
    defaultExpectedVpfd61,
    DEFAULT_EARLY_WARNING_TARGET_AREA,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
});

test('parseEarlyWarning: 未対応構造 - Report 名前空間不正', () => {
  const xml = `<Report xmlns="http://invalid.namespace"><Control/></Report>`;
  const result = parseEarlyWarning(xml, defaultExpectedVpfd61, DEFAULT_EARLY_WARNING_TARGET_AREA);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
});

test('parseEarlyWarning: 未対応構造 - Control/Status 不一致', () => {
  const xml = buildEarlyWarningXml({ controlStatus: '訓練' });
  const result = parseEarlyWarning(xml, defaultExpectedVpfd61, DEFAULT_EARLY_WARNING_TARGET_AREA);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
});

test('parseEarlyWarning: 未対応構造 - Control/DateTime 不一致', () => {
  const xml = buildEarlyWarningXml({ controlDateTime: '2026-09-08T00:00:00Z' });
  const result = parseEarlyWarning(xml, defaultExpectedVpfd61, DEFAULT_EARLY_WARNING_TARGET_AREA);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
});

test('parseEarlyWarning: 未対応構造 - Head/ReportDateTime 不一致', () => {
  const xml = buildEarlyWarningXml({ reportDateTime: '2026-09-08T09:00:00+09:00' });
  const result = parseEarlyWarning(xml, defaultExpectedVpfd61, DEFAULT_EARLY_WARNING_TARGET_AREA);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
});

test('parseEarlyWarning: 未対応構造 - TimeSeriesInfo が 0 件', () => {
  const xml = buildEarlyWarningXml({ timeSeriesInfoCount: 0 });
  const result = parseEarlyWarning(xml, defaultExpectedVpfd61, DEFAULT_EARLY_WARNING_TARGET_AREA);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
});

test('parseEarlyWarning: 未対応構造 - TimeSeriesInfo が 2 件以上', () => {
  const xml = buildEarlyWarningXml({ timeSeriesInfoCount: 2 });
  const result = parseEarlyWarning(xml, defaultExpectedVpfd61, DEFAULT_EARLY_WARNING_TARGET_AREA);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
});

test('parseEarlyWarning: 未対応構造 - TimeDefine の timeId 重複', () => {
  const xml = buildEarlyWarningXml({
    timeDefines: [
      { timeId: '1', dateTime: '2026-09-09T09:00:00+09:00', duration: 'PT6H' },
      { timeId: '1', dateTime: '2026-09-09T15:00:00+09:00', duration: 'PT6H' },
    ],
  });
  const result = parseEarlyWarning(xml, defaultExpectedVpfd61, DEFAULT_EARLY_WARNING_TARGET_AREA);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
});

test('parseEarlyWarning: 未対応構造 - TimeDefine の Duration 不正', () => {
  const xml = buildEarlyWarningXml({
    timeDefines: [{ timeId: '1', dateTime: '2026-09-09T09:00:00+09:00', duration: 'INVALID' }],
  });
  const result = parseEarlyWarning(xml, defaultExpectedVpfd61, DEFAULT_EARLY_WARNING_TARGET_AREA);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
});

test('parseEarlyWarning: 未対応構造 - refID の参照先なし', () => {
  const xml = buildEarlyWarningXml({
    items: [
      {
        areaCode: '130010',
        areaName: '東京地方',
        kinds: [
          {
            propertyType: '大雨の警報級の可能性',
            warnings: [{ refId: '999', rankValue: '高' }],
          },
        ],
      },
    ],
  });
  const result = parseEarlyWarning(xml, defaultExpectedVpfd61, DEFAULT_EARLY_WARNING_TARGET_AREA);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
});

test('parseEarlyWarning: 未対応構造 - 同一現象で同一 refID が重複', () => {
  const xml = buildEarlyWarningXml({
    items: [
      {
        areaCode: '130010',
        areaName: '東京地方',
        kinds: [
          {
            propertyType: '大雨の警報級の可能性',
            warnings: [
              { refId: '1', rankValue: '高' },
              { refId: '1', rankValue: '中' },
            ],
          },
        ],
      },
    ],
  });
  const result = parseEarlyWarning(xml, defaultExpectedVpfd61, DEFAULT_EARLY_WARNING_TARGET_AREA);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
});

test('parseEarlyWarning: 未対応構造 - 同一ブロック内に対象 Area が複数存在', () => {
  const xml = buildEarlyWarningXml({
    items: [
      {
        areaCode: '130010',
        areaName: '東京地方',
        kinds: [
          {
            propertyType: '大雨の警報級の可能性',
            warnings: [{ refId: '1', rankValue: '高' }],
          },
        ],
      },
      {
        areaCode: '130010',
        areaName: '東京地方（重複）',
        kinds: [
          {
            propertyType: '大雨の警報級の可能性',
            warnings: [{ refId: '1', rankValue: '中' }],
          },
        ],
      },
    ],
  });
  const result = parseEarlyWarning(xml, defaultExpectedVpfd61, DEFAULT_EARLY_WARNING_TARGET_AREA);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
});

test('parseEarlyWarning: 未対応構造 - PossibilityRankOfWarning が空かつ condition 属性なし', () => {
  const xml = buildEarlyWarningXml({
    items: [
      {
        areaCode: '130010',
        areaName: '東京地方',
        kinds: [
          {
            propertyType: '大雨の警報級の可能性',
            warnings: [{ refId: '1', rankValue: null, condition: null }],
          },
        ],
      },
    ],
  });
  const result = parseEarlyWarning(xml, defaultExpectedVpfd61, DEFAULT_EARLY_WARNING_TARGET_AREA);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
});

// -------------------------------------------------------------------------------------------------
// 実提供サンプルファイルのパース検証
// -------------------------------------------------------------------------------------------------

test('parseEarlyWarning: 実提供サンプルファイル VPFD61 のパース検証', () => {
  const samplePath = join(jmaFixturesDir, '90_01_01_241031_VPFD61.xml');
  assert.ok(existsSync(samplePath), `fixture not found: ${samplePath}`);

  const xml = readFileSync(samplePath, 'utf-8');
  const expectedForSample: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  > = {
    telegramType: 'VPFD61',
    controlStatus: 'normal',
    reportDateTime: '2024-09-20T20:00:00.000Z',
    controlDateTime: '2024-09-20T19:45:42.000Z',
  };

  // 1. 香川県（実サンプルの対象地域）
  const kagawaArea = { forecastAreaCode: '370000', displayName: '香川県' };
  const resultKagawa = parseEarlyWarning(xml, expectedForSample, kagawaArea);
  assert.equal(resultKagawa.ok, true);
  if (!resultKagawa.ok) return;

  assert.equal(resultKagawa.value.segment, 'near');
  assert.equal(resultKagawa.value.area.code, '370000');
  assert.equal(resultKagawa.value.area.name, '香川県');
  assert.equal(resultKagawa.value.timeDefines.length, 9);
  assert.equal(resultKagawa.value.cells.length, 54); // 6現象 x 9区間

  // 2. 東京地方（サンプルには存在しないため「対象地域外」）
  const resultTokyo = parseEarlyWarning(xml, expectedForSample, DEFAULT_EARLY_WARNING_TARGET_AREA);
  assert.equal(resultTokyo.ok, false);
  if (resultTokyo.ok) return;
  assert.equal(resultTokyo.disposition, '対象地域外');
});

test('parseEarlyWarning: 実提供サンプルファイル VPFW60 のパース検証', () => {
  const samplePath = join(jmaFixturesDir, '69_01_01_241031_VPFW60.xml');
  assert.ok(existsSync(samplePath), `fixture not found: ${samplePath}`);

  const xml = readFileSync(samplePath, 'utf-8');
  const expectedForSample: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  > = {
    telegramType: 'VPFW60',
    controlStatus: 'normal',
    reportDateTime: '2024-10-14T02:00:00.000Z',
    controlDateTime: '2024-10-14T01:32:17.000Z',
  };

  // 1. 香川県（実サンプルの対象地域）
  const kagawaArea = { forecastAreaCode: '370000', displayName: '香川県' };
  const resultKagawa = parseEarlyWarning(xml, expectedForSample, kagawaArea);
  assert.equal(resultKagawa.ok, true);
  if (!resultKagawa.ok) return;

  assert.equal(resultKagawa.value.segment, 'far');
  assert.equal(resultKagawa.value.area.code, '370000');
  assert.equal(resultKagawa.value.area.name, '香川県');
  assert.equal(resultKagawa.value.timeDefines.length, 4);
  assert.equal(resultKagawa.value.cells.length, 20); // 5現象 x 4区間

  // 2. 東京地方（サンプルには存在しないため「対象地域外」）
  const resultTokyo = parseEarlyWarning(xml, expectedForSample, DEFAULT_EARLY_WARNING_TARGET_AREA);
  assert.equal(resultTokyo.ok, false);
  if (resultTokyo.ok) return;
  assert.equal(resultTokyo.disposition, '対象地域外');
});
