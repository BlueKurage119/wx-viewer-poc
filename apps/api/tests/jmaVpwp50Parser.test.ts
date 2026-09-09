import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import {
  parseVpwp50,
  addIso8601Duration,
  DEFAULT_VPWP50_TARGET_AREA,
} from '../src/polling/jmaVpwp50Parser.js';
import type { TelegramReception } from '../src/repositories/types.js';

const defaultExpected: Pick<
  TelegramReception,
  'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
> = {
  telegramType: 'VPWP50',
  controlStatus: 'normal',
  reportDateTime: '2026-09-09T00:00:00.000Z',
  controlDateTime: '2026-09-09T00:00:00.000Z',
};

function buildVpwp50Xml(options: {
  controlStatus?: string;
  controlDateTime?: string;
  reportDateTime?: string;
  infoType?: string;
  infoKind?: string;
  infoKindVersion?: string;
  eventId?: string;
  meteorologicalInfosType?: string;
  extraMeteorologicalInfos?: string;
  timeSeriesBlocks?: Array<{
    timeDefines: Array<{ timeId: string; dateTime: string; duration: string; name?: string }>;
    items: Array<{
      areaCode: string;
      areaName: string;
      kinds: Array<{
        status: string;
        dateTime?: string;
        propertyType: string;
        parts: string;
      }>;
    }>;
  }>;
}): string {
  const controlStatus = options.controlStatus ?? '通常';
  const controlDateTime = options.controlDateTime ?? '2026-09-09T00:00:00Z';
  const reportDateTime = options.reportDateTime ?? '2026-09-09T09:00:00+09:00';
  const infoType = options.infoType ?? '発表';
  const infoKind = options.infoKind ?? '気象警報・注意報時系列';
  const infoKindVersion = options.infoKindVersion ?? '1.5_0';
  const eventId = options.eventId ?? '';
  const meteorologicalInfosType = options.meteorologicalInfosType ?? '量的予想時系列（市町村等）';

  const defaultBlocks = [
    {
      timeDefines: [
        { timeId: '1', dateTime: '2026-09-09T09:00:00+09:00', duration: 'PT3H', name: '９日昼前' },
        {
          timeId: '2',
          dateTime: '2026-09-09T12:00:00+09:00',
          duration: 'PT3H',
          name: '９日昼過ぎ',
        },
      ],
      items: [
        {
          areaCode: '1310800',
          areaName: '江東区',
          kinds: [
            {
              status: '発表',
              dateTime: '2026-09-09T09:00:00+09:00',
              propertyType: '大雨浸水危険度',
              parts: `
                <SignificancyPart>
                  <Base>
                    <Significancy refID="1" type="大雨浸水危険度">
                      <Name>警戒レベル２未満</Name>
                      <Code>11</Code>
                    </Significancy>
                    <Significancy refID="2" type="大雨浸水危険度">
                      <Name>警戒レベル３相当</Name>
                      <Code>30</Code>
                    </Significancy>
                  </Base>
                </SignificancyPart>
              `,
            },
            {
              status: '発表',
              dateTime: '2026-09-09T09:00:00+09:00',
              propertyType: '雨',
              parts: `
                <PrecipitationPart>
                  <Base>
                    <jmx_eb:Precipitation description="１０ミリ" refID="1" type="１時間最大雨量" unit="mm">10</jmx_eb:Precipitation>
                    <jmx_eb:Precipitation description="３０ミリ" refID="2" type="１時間最大雨量" unit="mm">30</jmx_eb:Precipitation>
                  </Base>
                </PrecipitationPart>
              `,
            },
            {
              status: '継続',
              dateTime: '2026-09-09T09:00:00+09:00',
              propertyType: '風',
              parts: `
                <WindSpeedPart>
                  <Base>
                    <Local>
                      <AreaName>陸上</AreaName>
                      <jmx_eb:WindSpeed condition="風雪" description="１５メートル" refID="1" type="最大風速" unit="m/s">15</jmx_eb:WindSpeed>
                      <jmx_eb:WindSpeed condition="風雪" description="１８メートル" refID="2" type="最大風速" unit="m/s">18</jmx_eb:WindSpeed>
                    </Local>
                    <Local>
                      <AreaName>海上</AreaName>
                      <jmx_eb:WindSpeed condition="風雪" description="２０メートル" refID="1" type="最大風速" unit="m/s">20</jmx_eb:WindSpeed>
                      <jmx_eb:WindSpeed condition="風雪" description="２５メートル" refID="2" type="最大風速" unit="m/s">25</jmx_eb:WindSpeed>
                    </Local>
                  </Base>
                </WindSpeedPart>
              `,
            },
            {
              status: '発表',
              dateTime: '2026-09-09T09:00:00+09:00',
              propertyType: '乾燥',
              parts: `
                <HumidityPart>
                  <Base>
                    <jmx_eb:Humidity description="５０パーセント" refID="1" type="実効湿度" unit="%">50</jmx_eb:Humidity>
                    <jmx_eb:Humidity condition="値なし" refID="2" type="実効湿度" unit="%"></jmx_eb:Humidity>
                  </Base>
                </HumidityPart>
              `,
            },
          ],
        },
      ],
    },
    {
      timeDefines: [
        {
          timeId: '1',
          dateTime: '2026-09-09T09:00:00+09:00',
          duration: 'PT24H',
          name: '１０日０９時まで',
        },
        { timeId: '2', dateTime: '2026-09-10T00:00:00+09:00', duration: 'PT24H', name: '１０日' },
      ],
      items: [
        {
          areaCode: '1310800',
          areaName: '江東区',
          kinds: [
            {
              status: '発表',
              dateTime: '2026-09-09T09:00:00+09:00',
              propertyType: '雨',
              parts: `
                <PrecipitationPart>
                  <Base>
                    <jmx_eb:Precipitation description="８０ミリ" refID="1" type="２４時間最大雨量" unit="mm">80</jmx_eb:Precipitation>
                    <jmx_eb:Precipitation description="１００ミリ" refID="2" type="２４時間最大雨量" unit="mm">100</jmx_eb:Precipitation>
                  </Base>
                </PrecipitationPart>
              `,
            },
          ],
        },
      ],
    },
  ];

  const blocks = options.timeSeriesBlocks ?? defaultBlocks;

  let blocksXml = '';
  for (const block of blocks) {
    let tdXml = '';
    for (const td of block.timeDefines) {
      tdXml += `<TimeDefine timeId="${td.timeId}"><DateTime>${td.dateTime}</DateTime><Duration>${td.duration}</Duration>${td.name ? `<Name>${td.name}</Name>` : ''}</TimeDefine>`;
    }

    let itemsXml = '';
    for (const item of block.items) {
      let kindsXml = '';
      for (const kind of item.kinds) {
        kindsXml += `<Kind><Status>${kind.status}</Status>${kind.dateTime ? `<DateTime type="発表時刻">${kind.dateTime}</DateTime>` : ''}<Property><Type>${kind.propertyType}</Type>${kind.parts}</Property></Kind>`;
      }
      itemsXml += `<Item>${kindsXml}<Area><Name>${item.areaName}</Name><Code>${item.areaCode}</Code></Area></Item>`;
    }

    blocksXml += `<TimeSeriesInfo><TimeDefines>${tdXml}</TimeDefines>${itemsXml}</TimeSeriesInfo>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
<Control>
<Title>気象警報・注意報時系列情報（Ｒ０６）</Title>
<DateTime>${controlDateTime}</DateTime>
<Status>${controlStatus}</Status>
<EditorialOffice>気象庁本庁</EditorialOffice>
<PublishingOffice>気象庁</PublishingOffice>
</Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
<Title>東京都警戒・注意事項時系列情報</Title>
<ReportDateTime>${reportDateTime}</ReportDateTime>
<TargetDateTime>2026-09-09T09:00:00+09:00</TargetDateTime>
<EventID>${eventId}</EventID>
<InfoType>${infoType}</InfoType>
<Serial/>
<InfoKind>${infoKind}</InfoKind>
<InfoKindVersion>${infoKindVersion}</InfoKindVersion>
<Headline><Text/></Headline>
</Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
<MeteorologicalInfos type="${meteorologicalInfosType}">
${blocksXml}
</MeteorologicalInfos>
${options.extraMeteorologicalInfos ?? ''}
</Body>
</Report>`;
}

test('addIso8601Duration: ISO 8601 Duration の加算計算', () => {
  assert.equal(addIso8601Duration('2026-09-09T00:00:00.000Z', 'PT3H'), '2026-09-09T03:00:00.000Z');
  assert.equal(addIso8601Duration('2026-09-09T00:00:00.000Z', 'PT24H'), '2026-09-10T00:00:00.000Z');
  assert.equal(addIso8601Duration('2026-09-09T00:00:00.000Z', 'P1D'), '2026-09-10T00:00:00.000Z');
  assert.equal(
    addIso8601Duration('2026-09-09T00:00:00.000Z', 'PT12H30M'),
    '2026-09-09T12:30:00.000Z',
  );
  assert.equal(addIso8601Duration('2026-09-09T00:00:00.000Z', 'INVALID'), null);
});

test('parseVpwp50: 正常系（複数ブロック・同一timeId共存・危険度・量的値・condition="値なし"・Localエリア区分）', () => {
  const xml = buildVpwp50Xml({});
  const result = parseVpwp50(xml, defaultExpected, DEFAULT_VPWP50_TARGET_AREA);

  assert.equal(result.ok, true);
  if (!result.ok) return;

  const { value } = result;
  assert.equal(value.area.code, '1310800');
  assert.equal(value.area.name, '江東区');
  assert.equal(value.controlStatus, 'normal');
  assert.equal(value.infoType, '発表');
  assert.equal(value.infoKindVersion, '1.5_0');
  assert.equal(value.reportDateTime, '2026-09-09T00:00:00.000Z');
  assert.equal(value.controlDateTime, '2026-09-09T00:00:00.000Z');

  // TimeDefines: 2ブロック x 2 = 4件
  assert.equal(value.timeDefines.length, 4);
  assert.equal(value.timeDefines[0].blockId, 'timeseries-1');
  assert.equal(value.timeDefines[0].timeId, '1');
  assert.equal(value.timeDefines[0].duration, 'PT3H');
  assert.equal(value.timeDefines[0].timeFrom, '2026-09-09T00:00:00.000Z');
  assert.equal(value.timeDefines[0].timeTo, '2026-09-09T03:00:00.000Z');

  assert.equal(value.timeDefines[1].blockId, 'timeseries-1');
  assert.equal(value.timeDefines[1].timeId, '2');
  assert.equal(value.timeDefines[1].timeFrom, '2026-09-09T03:00:00.000Z');
  assert.equal(value.timeDefines[1].timeTo, '2026-09-09T06:00:00.000Z');

  assert.equal(value.timeDefines[2].blockId, 'timeseries-2');
  assert.equal(value.timeDefines[2].timeId, '1');
  assert.equal(value.timeDefines[2].duration, 'PT24H');
  assert.equal(value.timeDefines[2].timeFrom, '2026-09-09T00:00:00.000Z');
  assert.equal(value.timeDefines[2].timeTo, '2026-09-10T00:00:00.000Z');

  // Values: block 1 (危険度2 + 雨2 + 風4 + 湿度2) + block 2 (雨2) = 12件
  assert.equal(value.values.length, 12);

  // 1. 危険度 (Significancy)
  const riskVal = value.values[0];
  assert.equal(riskVal.blockId, 'timeseries-1');
  assert.equal(riskVal.refId, '1');
  assert.equal(riskVal.valueCategory, 'risk');
  assert.equal(riskVal.propertyType, '大雨浸水危険度');
  assert.equal(riskVal.valueType, '大雨浸水危険度');
  assert.equal(riskVal.valueCode, '11');
  assert.equal(riskVal.valueText, '警戒レベル２未満');
  assert.equal(riskVal.kindStatus, '発表');
  assert.equal(riskVal.kindDateTime, '2026-09-09T00:00:00.000Z');
  assert.equal(riskVal.kindCode, null);
  assert.equal(riskVal.kindName, null);
  assert.equal(riskVal.unit, null);
  assert.equal(riskVal.areaDivision, null);

  // 2. 量的雨量 (Precipitation)
  const rainVal = value.values[2];
  assert.equal(rainVal.blockId, 'timeseries-1');
  assert.equal(rainVal.refId, '1');
  assert.equal(rainVal.valueCategory, 'quantity');
  assert.equal(rainVal.propertyType, '雨');
  assert.equal(rainVal.valueType, '１時間最大雨量');
  assert.equal(rainVal.valueCode, null);
  assert.equal(rainVal.valueText, '10');
  assert.equal(rainVal.unit, 'mm');
  assert.equal(rainVal.description, '１０ミリ');
  assert.equal(rainVal.condition, null);
  assert.equal(rainVal.areaDivision, null);

  // 3. 風 (Local: 陸上/海上)
  const windLand = value.values[4];
  assert.equal(windLand.blockId, 'timeseries-1');
  assert.equal(windLand.refId, '1');
  assert.equal(windLand.areaDivision, '陸上');
  assert.equal(windLand.valueText, '15');
  assert.equal(windLand.unit, 'm/s');
  assert.equal(windLand.condition, '風雪');

  const windSea = value.values[6];
  assert.equal(windSea.blockId, 'timeseries-1');
  assert.equal(windSea.refId, '1');
  assert.equal(windSea.areaDivision, '海上');
  assert.equal(windSea.valueText, '20');

  // 4. 乾燥 condition="値なし" の空要素
  const humidityNone = value.values[9];
  assert.equal(humidityNone.blockId, 'timeseries-1');
  assert.equal(humidityNone.refId, '2');
  assert.equal(humidityNone.propertyType, '乾燥');
  assert.equal(humidityNone.valueType, '実効湿度');
  assert.equal(humidityNone.valueText, '', '値なしは空文字');
  assert.equal(humidityNone.condition, '値なし');
  assert.equal(humidityNone.unit, '%');

  // 5. block 2 の値（同一 timeId '1' が block 2 に結合されていること）
  const block2Rain = value.values[10];
  assert.equal(block2Rain.blockId, 'timeseries-2');
  assert.equal(block2Rain.refId, '1');
  assert.equal(block2Rain.propertyType, '雨');
  assert.equal(block2Rain.valueType, '２４時間最大雨量');
  assert.equal(block2Rain.valueText, '80');
});

test('parseVpwp50: 異常系 - 同一ブロック内での timeId 重複は未対応構造', () => {
  const xml = buildVpwp50Xml({
    timeSeriesBlocks: [
      {
        timeDefines: [
          { timeId: '1', dateTime: '2026-09-09T09:00:00+09:00', duration: 'PT3H' },
          { timeId: '1', dateTime: '2026-09-09T12:00:00+09:00', duration: 'PT3H' }, // 重複
        ],
        items: [
          {
            areaCode: '1310800',
            areaName: '江東区',
            kinds: [
              {
                status: '発表',
                propertyType: '大雨浸水危険度',
                parts:
                  '<SignificancyPart><Base><Significancy refID="1" type="危険度"><Name>中</Name><Code>2</Code></Significancy></Base></SignificancyPart>',
              },
            ],
          },
        ],
      },
    ],
  });

  const result = parseVpwp50(xml, defaultExpected, DEFAULT_VPWP50_TARGET_AREA);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
  assert.match(result.reason, /同一ブロック内で timeId "1" が重複しています/);
});

test('parseVpwp50: 異常系 - ブロック内に存在しない refID は未対応構造', () => {
  const xml = buildVpwp50Xml({
    timeSeriesBlocks: [
      {
        timeDefines: [{ timeId: '1', dateTime: '2026-09-09T09:00:00+09:00', duration: 'PT3H' }],
        items: [
          {
            areaCode: '1310800',
            areaName: '江東区',
            kinds: [
              {
                status: '発表',
                propertyType: '大雨浸水危険度',
                parts:
                  '<SignificancyPart><Base><Significancy refID="999" type="危険度"><Name>高</Name><Code>3</Code></Significancy></Base></SignificancyPart>',
              },
            ],
          },
        ],
      },
    ],
  });

  const result = parseVpwp50(xml, defaultExpected, DEFAULT_VPWP50_TARGET_AREA);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
  assert.match(result.reason, /refID "999" がブロック内の TimeDefine に存在しません/);
});

test('parseVpwp50: 異常系 - 別ブロックにある timeId を参照しても誤結合されず未対応構造になる', () => {
  const xml = buildVpwp50Xml({
    timeSeriesBlocks: [
      {
        timeDefines: [{ timeId: '1', dateTime: '2026-09-09T09:00:00+09:00', duration: 'PT3H' }],
        items: [
          {
            areaCode: '1310800',
            areaName: '江東区',
            kinds: [
              {
                status: '発表',
                propertyType: '大雨浸水危険度',
                // block 1 には timeId '2' はない（block 2 にはある）
                parts:
                  '<SignificancyPart><Base><Significancy refID="2" type="危険度"><Name>高</Name><Code>3</Code></Significancy></Base></SignificancyPart>',
              },
            ],
          },
        ],
      },
      {
        timeDefines: [{ timeId: '2', dateTime: '2026-09-09T12:00:00+09:00', duration: 'PT3H' }],
        items: [],
      },
    ],
  });

  const result = parseVpwp50(xml, defaultExpected, DEFAULT_VPWP50_TARGET_AREA);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
  assert.match(result.reason, /refID "2" がブロック内の TimeDefine に存在しません/);
});

test('parseVpwp50: 異常系 - 同一ブロック内に対象地域 Item が複数ある場合は未対応構造', () => {
  const xml = buildVpwp50Xml({
    timeSeriesBlocks: [
      {
        timeDefines: [{ timeId: '1', dateTime: '2026-09-09T09:00:00+09:00', duration: 'PT3H' }],
        items: [
          {
            areaCode: '1310800',
            areaName: '江東区',
            kinds: [{ status: '発表', propertyType: '雨', parts: '' }],
          },
          {
            areaCode: '1310800',
            areaName: '江東区',
            kinds: [{ status: '発表', propertyType: '雨', parts: '' }],
          },
        ],
      },
    ],
  });

  const result = parseVpwp50(xml, defaultExpected, DEFAULT_VPWP50_TARGET_AREA);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
  assert.match(result.reason, /同一ブロック内に対象地域 Item が複数存在します/);
});

test('parseVpwp50: 異常系 - 対象 type の MeteorologicalInfos が複数ある場合は未対応構造', () => {
  const xml = buildVpwp50Xml({
    extraMeteorologicalInfos:
      '<MeteorologicalInfos type="量的予想時系列（市町村等）"><TimeSeriesInfo></TimeSeriesInfo></MeteorologicalInfos>',
  });

  const result = parseVpwp50(xml, defaultExpected, DEFAULT_VPWP50_TARGET_AREA);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
  assert.match(
    result.reason,
    /MeteorologicalInfos\[@type="量的予想時系列（市町村等）"\] は1件である必要があります/,
  );
});

test('parseVpwp50: 異常系 - Duration の解釈に失敗した場合は未対応構造', () => {
  const xml = buildVpwp50Xml({
    timeSeriesBlocks: [
      {
        timeDefines: [
          { timeId: '1', dateTime: '2026-09-09T09:00:00+09:00', duration: 'INVALID_DURATION' },
        ],
        items: [
          {
            areaCode: '1310800',
            areaName: '江東区',
            kinds: [{ status: '発表', propertyType: '雨', parts: '' }],
          },
        ],
      },
    ],
  });

  const result = parseVpwp50(xml, defaultExpected, DEFAULT_VPWP50_TARGET_AREA);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
  assert.match(result.reason, /Duration "INVALID_DURATION" の解釈または加算に失敗しました/);
});

test('parseVpwp50: 対象地域外 - 全ブロックに対象地域がない場合は対象地域外', () => {
  const xml = buildVpwp50Xml({
    timeSeriesBlocks: [
      {
        timeDefines: [{ timeId: '1', dateTime: '2026-09-09T09:00:00+09:00', duration: 'PT3H' }],
        items: [
          {
            areaCode: '0121400',
            areaName: '稚内市',
            kinds: [
              {
                status: '発表',
                propertyType: '大雨浸水危険度',
                parts:
                  '<SignificancyPart><Base><Significancy refID="1" type="危険度"><Name>低</Name><Code>1</Code></Significancy></Base></SignificancyPart>',
              },
            ],
          },
        ],
      },
    ],
  });

  const result = parseVpwp50(xml, defaultExpected, DEFAULT_VPWP50_TARGET_AREA);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '対象地域外');
  assert.match(result.reason, /対象地域（コード: 1310800）が全ブロックに存在しません/);
});

test('parseVpwp50: 一部ブロックに対象地域がない場合は他ブロックを採用', () => {
  const xml = buildVpwp50Xml({
    timeSeriesBlocks: [
      {
        timeDefines: [{ timeId: '1', dateTime: '2026-09-09T09:00:00+09:00', duration: 'PT3H' }],
        items: [
          {
            areaCode: '1310800',
            areaName: '江東区',
            kinds: [
              {
                status: '発表',
                propertyType: '大雨浸水危険度',
                parts:
                  '<SignificancyPart><Base><Significancy refID="1" type="危険度"><Name>低</Name><Code>1</Code></Significancy></Base></SignificancyPart>',
              },
            ],
          },
        ],
      },
      {
        timeDefines: [{ timeId: '1', dateTime: '2026-09-09T09:00:00+09:00', duration: 'PT24H' }],
        items: [
          {
            // block 2 は稚内市のみ（江東区なし）
            areaCode: '0121400',
            areaName: '稚内市',
            kinds: [
              {
                status: '発表',
                propertyType: '雨',
                parts:
                  '<PrecipitationPart><Base><jmx_eb:Precipitation refID="1" type="２４時間最大雨量">50</jmx_eb:Precipitation></Base></PrecipitationPart>',
              },
            ],
          },
        ],
      },
    ],
  });

  const result = parseVpwp50(xml, defaultExpected, DEFAULT_VPWP50_TARGET_AREA);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.timeDefines.length, 2);
  assert.equal(result.value.values.length, 1, 'block 1 の江東区値だけが採用される');
  assert.equal(result.value.values[0].blockId, 'timeseries-1');
});

test('parseVpwp50: 対象外 - telegramType が VPWP50 でない場合', () => {
  const xml = buildVpwp50Xml({});
  const result = parseVpwp50(xml, { ...defaultExpected, telegramType: 'VPWW55' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '対象外');
});

test('parseVpwp50: 対象外 - InfoKind が異なる場合', () => {
  const xml = buildVpwp50Xml({ infoKind: '気象警報・注意報' });
  const result = parseVpwp50(xml, defaultExpected);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '対象外');
});

test('parseVpwp50: 実提供サンプルファイルのパース検証', () => {
  const samplePath =
    '/Users/yuta/claudeworks/cmk-gsx/docs/260907_weather-data/jmaxml_20260723_Samples/81_01_01_260129_VPWP50.xml';
  if (!existsSync(samplePath)) {
    return;
  }

  const xml = readFileSync(samplePath, 'utf-8');
  const expectedForSample = {
    telegramType: 'VPWP50',
    controlStatus: 'normal' as const,
    reportDateTime: '2023-06-21T20:00:00.000Z',
    controlDateTime: '2023-06-21T20:00:00.000Z',
  };

  // 1. 稚内市（実サンプルの対象地域）
  const wakkanaiArea = { municipalCode: '0121400', displayName: '稚内市' };
  const resultWakkanai = parseVpwp50(xml, expectedForSample, wakkanaiArea);
  assert.equal(resultWakkanai.ok, true);
  if (!resultWakkanai.ok) return;

  // 3ブロック
  const blockIds = new Set(resultWakkanai.value.timeDefines.map((td) => td.blockId));
  assert.equal(blockIds.size, 3);
  assert.equal(resultWakkanai.value.area.code, '0121400');
  assert.equal(resultWakkanai.value.area.name, '稚内市');

  // 2. 江東区（サンプルには存在しない）
  const resultKoto = parseVpwp50(xml, expectedForSample, DEFAULT_VPWP50_TARGET_AREA);
  assert.equal(resultKoto.ok, false);
  if (resultKoto.ok) return;
  assert.equal(resultKoto.disposition, '対象地域外');
});
