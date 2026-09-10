import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVpfd51 } from '../src/polling/jmaVpfd51Parser.js';
import type { TelegramReception } from '../src/repositories/types.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const jmaFixturesDir = join(apiRoot, 'tests/fixtures/jma');

const defaultExpectedVpfd51: Pick<
  TelegramReception,
  'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
> = {
  telegramType: 'VPFD51',
  controlStatus: 'normal',
  reportDateTime: '2026-09-10T08:00:00.000Z',
  controlDateTime: '2026-09-10T07:48:12.000Z',
};

interface BuildVpfd51XmlOptions {
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
  regionMeteorologicalInfosType?: string;
  pointMeteorologicalInfosType?: string;
  extraMeteorologicalInfos?: string;
  regionTimeSeriesInfoList?: Array<{
    timeDefines: Array<{ timeId: string; dateTime: string; duration?: string }>;
    items: Array<{
      areaCode: string;
      areaName: string;
      weatherList?: Array<{ refId: string; text: string }>;
      windDirectionList?: Array<{ refId: string; text: string; unit?: string }>;
      windSpeedList?: Array<{ refId: string; text: string }>;
      omitWeather?: boolean;
      omitWind?: boolean;
    }>;
  }>;
  pointTimeSeriesInfoList?: Array<{
    timeDefines: Array<{ timeId: string; dateTime: string }>;
    items: Array<{
      stationCode: string;
      stationName: string;
      temperatureList?: Array<{ refId: string; text: string; unit?: string }>;
      omitTemperature?: boolean;
    }>;
  }>;
  customXml?: string;
}

function buildVpfd51Xml(options: BuildVpfd51XmlOptions = {}): string {
  if (options.customXml) return options.customXml;

  const controlStatus = options.controlStatus ?? '通常';
  const controlDateTime = options.controlDateTime ?? '2026-09-10T07:48:12Z';
  const reportDateTime = options.reportDateTime ?? '2026-09-10T17:00:00+09:00';
  const infoKind = options.infoKind ?? '府県天気予報';
  const infoType = options.infoType ?? '発表';
  const infoKindVersion = options.infoKindVersion ?? '1.0_1';
  const regionType = options.regionMeteorologicalInfosType ?? '区域予報';
  const pointType = options.pointMeteorologicalInfosType ?? '地点予報';

  const defaultRegionTimeSeries = [
    {
      timeDefines: [
        { timeId: '1', dateTime: '2026-09-10T18:00:00+09:00', duration: 'PT3H' },
        { timeId: '2', dateTime: '2026-09-10T21:00:00+09:00', duration: 'PT3H' },
      ],
      items: [
        {
          areaCode: '130010',
          areaName: '東京地方',
          weatherList: [
            { refId: '1', text: 'くもり' },
            { refId: '2', text: '雨' },
          ],
          windDirectionList: [
            { refId: '1', text: '北', unit: '８方位漢字' },
            { refId: '2', text: '北東', unit: '８方位漢字' },
          ],
          windSpeedList: [
            { refId: '1', text: '3' },
            { refId: '2', text: '4' },
          ],
        },
      ],
    },
  ];

  const defaultPointTimeSeries = [
    {
      timeDefines: [
        { timeId: '1', dateTime: '2026-09-10T18:00:00+09:00' },
        { timeId: '2', dateTime: '2026-09-10T21:00:00+09:00' },
        { timeId: '3', dateTime: '2026-09-11T00:00:00+09:00' },
      ],
      items: [
        {
          stationCode: '44132',
          stationName: '東京',
          temperatureList: [
            { refId: '1', text: '22', unit: '度' },
            { refId: '2', text: '20.5', unit: '度' },
            { refId: '3', text: '19', unit: '度' },
          ],
        },
      ],
    },
  ];

  const regionTimeSeriesList = options.regionTimeSeriesInfoList ?? defaultRegionTimeSeries;
  const pointTimeSeriesList = options.pointTimeSeriesInfoList ?? defaultPointTimeSeries;

  const renderRegionTimeSeries = (tsList: typeof regionTimeSeriesList) => {
    return tsList
      .map((ts) => {
        const tdXml = ts.timeDefines
          .map(
            (td) => `
          <TimeDefine timeId="${td.timeId}">
            <DateTime>${td.dateTime}</DateTime>
            ${td.duration ? `<Duration>${td.duration}</Duration>` : ''}
          </TimeDefine>`,
          )
          .join('');

        const itemXml = ts.items
          .map((item) => {
            const weatherProp = item.omitWeather
              ? ''
              : `
            <Kind>
              <Property>
                <Type>３時間内卓越天気</Type>
                <WeatherPart>
                  ${(item.weatherList ?? [])
                    .map(
                      (w) =>
                        `<jmx_eb:Weather refID="${w.refId}" type="天気">${w.text}</jmx_eb:Weather>`,
                    )
                    .join('')}
                </WeatherPart>
              </Property>
            </Kind>`;

            const windProp = item.omitWind
              ? ''
              : `
            <Kind>
              <Property>
                <Type>３時間内代表風</Type>
                <WindDirectionPart>
                  ${(item.windDirectionList ?? [])
                    .map(
                      (wd) =>
                        `<jmx_eb:WindDirection refID="${wd.refId}" type="風向"${wd.unit ? ` unit="${wd.unit}"` : ''}>${wd.text}</jmx_eb:WindDirection>`,
                    )
                    .join('')}
                </WindDirectionPart>
                <WindSpeedPart>
                  ${(item.windSpeedList ?? [])
                    .map(
                      (ws) =>
                        `<WindSpeedLevel refID="${ws.refId}" type="風速階級">${ws.text}</WindSpeedLevel>`,
                    )
                    .join('')}
                </WindSpeedPart>
              </Property>
            </Kind>`;

            return `
          <Item>
            ${weatherProp}
            ${windProp}
            <Area>
              <Name>${item.areaName}</Name>
              <Code>${item.areaCode}</Code>
            </Area>
          </Item>`;
          })
          .join('');

        return `
        <TimeSeriesInfo>
          <TimeDefines>${tdXml}</TimeDefines>
          ${itemXml}
        </TimeSeriesInfo>`;
      })
      .join('');
  };

  const renderPointTimeSeries = (tsList: typeof pointTimeSeriesList) => {
    return tsList
      .map((ts) => {
        const tdXml = ts.timeDefines
          .map(
            (td) => `
          <TimeDefine timeId="${td.timeId}">
            <DateTime>${td.dateTime}</DateTime>
          </TimeDefine>`,
          )
          .join('');

        const itemXml = ts.items
          .map((item) => {
            const tempProp = item.omitTemperature
              ? ''
              : `
            <Kind>
              <Property>
                <Type>３時間毎気温</Type>
                <TemperaturePart>
                  ${(item.temperatureList ?? [])
                    .map(
                      (t) =>
                        `<jmx_eb:Temperature refID="${t.refId}" type="気温"${t.unit ? ` unit="${t.unit}"` : ''}>${t.text}</jmx_eb:Temperature>`,
                    )
                    .join('')}
                </TemperaturePart>
              </Property>
            </Kind>`;

            return `
          <Item>
            ${tempProp}
            <Station>
              <Name>${item.stationName}</Name>
              <Code>${item.stationCode}</Code>
            </Station>
          </Item>`;
          })
          .join('');

        return `
        <TimeSeriesInfo>
          <TimeDefines>${tdXml}</TimeDefines>
          ${itemXml}
        </TimeSeriesInfo>`;
      })
      .join('');
  };

  return `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx="http://xml.kishou.go.jp/jmaxml1/">
  <Control>
    <Title>${options.controlTitle ?? '府県天気予報（Ｒ１）'}</Title>
    <DateTime>${controlDateTime}</DateTime>
    <Status>${controlStatus}</Status>
    <EditorialOffice>気象庁本庁</EditorialOffice>
    <PublishingOffice>気象庁予報部</PublishingOffice>
  </Control>
  <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
    <Title>${options.headTitle ?? '東京都府県天気予報'}</Title>
    <ReportDateTime>${reportDateTime}</ReportDateTime>
    <TargetDateTime>2026-09-10T17:00:00+09:00</TargetDateTime>
    <TargetDuration>P2DT7H</TargetDuration>
    <EventID>${options.eventId ?? ''}</EventID>
    <InfoType>${infoType}</InfoType>
    <Serial/>
    <InfoKind>${infoKind}</InfoKind>
    <InfoKindVersion>${infoKindVersion}</InfoKindVersion>
    <Headline><Text/></Headline>
  </Head>
  <Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
    <MeteorologicalInfos type="${regionType}">
      ${renderRegionTimeSeries(regionTimeSeriesList)}
    </MeteorologicalInfos>
    <MeteorologicalInfos type="${pointType}">
      ${renderPointTimeSeries(pointTimeSeriesList)}
    </MeteorologicalInfos>
    ${options.extraMeteorologicalInfos ?? ''}
  </Body>
</Report>`;
}

test('parseVpfd51: 公式サンプルファイルの正常パース検証', () => {
  const samplePath = join(jmaFixturesDir, '24_11_03_190925_VPFD51.xml');
  assert.ok(existsSync(samplePath), `fixture not found: ${samplePath}`);

  const xml = readFileSync(samplePath, 'utf-8');
  const expectedForSample: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  > = {
    telegramType: 'VPFD51',
    controlStatus: 'normal',
    reportDateTime: '2016-11-23T08:00:00.000Z',
    controlDateTime: '2016-11-23T07:48:12.000Z',
  };

  const result = parseVpfd51(xml, expectedForSample);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const parsed = result.value;
  assert.equal(parsed.area.code, '130010');
  assert.equal(parsed.area.name, '東京地方');
  assert.equal(parsed.station.code, '44132');
  assert.equal(parsed.station.name, '東京');
  assert.equal(parsed.controlStatus, 'normal');
  assert.equal(parsed.infoType, '発表');
  assert.equal(parsed.eventId, null);
  assert.equal(parsed.controlDateTime, '2016-11-23T07:48:12.000Z');
  assert.equal(parsed.reportDateTime, '2016-11-23T08:00:00.000Z');
  assert.equal(parsed.infoKindVersion, '1.0_1');

  // TimeDefines: 区域10件 + 地点11件 = 21件
  assert.equal(parsed.timeDefines.length, 21);
  const regionTds = parsed.timeDefines.filter((td) => td.blockId === 'region-3hour');
  const pointTds = parsed.timeDefines.filter((td) => td.blockId === 'temperature-3hour');
  assert.equal(regionTds.length, 10);
  assert.equal(pointTds.length, 11);

  // 区域: duration="PT3H", timeTo は timeFrom + 3H
  assert.equal(regionTds[0]?.timeId, '1');
  assert.equal(regionTds[0]?.sequence, 1);
  assert.equal(regionTds[0]?.timeFrom, '2016-11-23T09:00:00.000Z');
  assert.equal(regionTds[0]?.timeTo, '2016-11-23T12:00:00.000Z');
  assert.equal(regionTds[0]?.duration, 'PT3H');

  // 地点: duration=null, timeTo === timeFrom
  assert.equal(pointTds[0]?.timeId, '1');
  assert.equal(pointTds[0]?.sequence, 1);
  assert.equal(pointTds[0]?.timeFrom, '2016-11-23T09:00:00.000Z');
  assert.equal(pointTds[0]?.timeTo, '2016-11-23T09:00:00.000Z');
  assert.equal(pointTds[0]?.duration, null);

  // Values: 区域30件 + 地点11件 = 41件
  assert.equal(parsed.values.length, 41);

  // weather
  const weathers = parsed.values.filter((v) => v.element === 'weather');
  assert.equal(weathers.length, 10);
  assert.equal(weathers[0]?.blockId, 'region-3hour');
  assert.equal(weathers[0]?.refId, '1');
  assert.equal(weathers[0]?.valueText, 'くもり');
  assert.equal(weathers[0]?.valueCode, null);
  assert.equal(weathers[0]?.valueNumber, null);
  assert.equal(weathers[0]?.unit, null);

  // wind_direction
  const windDirs = parsed.values.filter((v) => v.element === 'wind_direction');
  assert.equal(windDirs.length, 10);
  assert.equal(windDirs[0]?.blockId, 'region-3hour');
  assert.equal(windDirs[0]?.refId, '1');
  assert.equal(windDirs[0]?.valueText, '北');
  assert.equal(windDirs[0]?.unit, '８方位漢字');

  // wind_speed_rank: 階級値そのままで valueNumber は null
  const windSpeeds = parsed.values.filter((v) => v.element === 'wind_speed_rank');
  assert.equal(windSpeeds.length, 10);
  assert.equal(windSpeeds[0]?.blockId, 'region-3hour');
  assert.equal(windSpeeds[0]?.refId, '1');
  assert.equal(windSpeeds[0]?.valueCode, '3');
  assert.equal(windSpeeds[0]?.valueText, null);
  assert.equal(windSpeeds[0]?.valueNumber, null);

  // temperature
  const temps = parsed.values.filter((v) => v.element === 'temperature');
  assert.equal(temps.length, 11);
  assert.equal(temps[0]?.blockId, 'temperature-3hour');
  assert.equal(temps[0]?.refId, '1');
  assert.equal(temps[0]?.valueText, '11');
  assert.equal(temps[0]?.valueNumber, 11);
  assert.equal(temps[0]?.unit, '度');
  assert.equal(temps[0]?.valueCode, null);
});

test('parseVpfd51: 合成XMLでの正常系（件数・時刻が異なるブロック）', () => {
  const xml = buildVpfd51Xml();
  const result = parseVpfd51(xml, defaultExpectedVpfd51);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const parsed = result.value;
  assert.equal(parsed.area.code, '130010');
  assert.equal(parsed.station.code, '44132');
  assert.equal(parsed.timeDefines.length, 5); // 区域2 + 地点3
  assert.equal(parsed.values.length, 9); // 区域(2*3) + 地点3 = 9
});

test('parseVpfd51: telegramType不一致は「対象外」', () => {
  const xml = buildVpfd51Xml();
  const result = parseVpfd51(xml, {
    ...defaultExpectedVpfd51,
    telegramType: 'VPWP50',
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '対象外');
});

test('parseVpfd51: InfoKind不一致は「対象外」', () => {
  const xml = buildVpfd51Xml({ infoKind: '警報級の可能性（明日まで）' });
  const result = parseVpfd51(xml, defaultExpectedVpfd51);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '対象外');
});

test('parseVpfd51: 不正XML・Report要素不正は「未対応構造」', () => {
  const result1 = parseVpfd51('invalid xml', defaultExpectedVpfd51);
  assert.equal(result1.ok, false);
  if (result1.ok) return;
  assert.equal(result1.disposition, '未対応構造');

  const result2 = parseVpfd51(
    '<Other xmlns="http://xml.kishou.go.jp/jmaxml1/"/>',
    defaultExpectedVpfd51,
  );
  assert.equal(result2.ok, false);
  if (result2.ok) return;
  assert.equal(result2.disposition, '未対応構造');
});

test('parseVpfd51: Control Status不一致は「未対応構造」', () => {
  const xml = buildVpfd51Xml({ controlStatus: '訓練' });
  const result = parseVpfd51(xml, defaultExpectedVpfd51);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
});

test('parseVpfd51: Control DateTime不一致は「未対応構造」', () => {
  const xml = buildVpfd51Xml({ controlDateTime: '2026-09-10T12:00:00Z' });
  const result = parseVpfd51(xml, defaultExpectedVpfd51);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
});

test('parseVpfd51: Head ReportDateTime不一致は「未対応構造」', () => {
  const xml = buildVpfd51Xml({ reportDateTime: '2026-09-10T12:00:00+09:00' });
  const result = parseVpfd51(xml, defaultExpectedVpfd51);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
});

test('parseVpfd51: MeteorologicalInfos の区域予報・地点予報が各1件でない場合は「未対応構造」', () => {
  // 区域予報がない
  const xmlNoRegion = buildVpfd51Xml({ regionMeteorologicalInfosType: 'その他' });
  const resultNoRegion = parseVpfd51(xmlNoRegion, defaultExpectedVpfd51);
  assert.equal(resultNoRegion.ok, false);
  if (resultNoRegion.ok) return;
  assert.equal(resultNoRegion.disposition, '未対応構造');

  // 地点予報がない
  const xmlNoPoint = buildVpfd51Xml({ pointMeteorologicalInfosType: 'その他' });
  const resultNoPoint = parseVpfd51(xmlNoPoint, defaultExpectedVpfd51);
  assert.equal(resultNoPoint.ok, false);
  if (resultNoPoint.ok) return;
  assert.equal(resultNoPoint.disposition, '未対応構造');

  // 対象Propertyを持つ区域予報が重複
  const xmlDupRegion = buildVpfd51Xml({
    extraMeteorologicalInfos: `
    <MeteorologicalInfos type="区域予報">
      <TimeSeriesInfo>
        <TimeDefines>
          <TimeDefine timeId="1"><DateTime>2026-09-10T18:00:00+09:00</DateTime><Duration>PT3H</Duration></TimeDefine>
        </TimeDefines>
        <Item>
          <Kind><Property><Type>３時間内卓越天気</Type><WeatherPart><jmx_eb:Weather refID="1" type="天気">晴れ</jmx_eb:Weather></WeatherPart></Property></Kind>
          <Kind><Property><Type>３時間内代表風</Type><WindDirectionPart><jmx_eb:WindDirection refID="1" type="風向">北</jmx_eb:WindDirection></WindDirectionPart><WindSpeedPart><WindSpeedLevel refID="1" type="風速階級">1</WindSpeedLevel></WindSpeedPart></Property></Kind>
          <Area><Name>東京地方</Name><Code>130010</Code></Area>
        </Item>
      </TimeSeriesInfo>
    </MeteorologicalInfos>`,
  });
  const resultDupRegion = parseVpfd51(xmlDupRegion, defaultExpectedVpfd51);
  assert.equal(resultDupRegion.ok, false);
  if (resultDupRegion.ok) return;
  assert.equal(resultDupRegion.disposition, '未対応構造');
});

test('parseVpfd51: 対象AreaCode不在は「対象地域外」', () => {
  const xml = buildVpfd51Xml({
    regionTimeSeriesInfoList: [
      {
        timeDefines: [{ timeId: '1', dateTime: '2026-09-10T18:00:00+09:00', duration: 'PT3H' }],
        items: [
          {
            areaCode: '999999',
            areaName: '他地域',
            weatherList: [{ refId: '1', text: '晴れ' }],
            windDirectionList: [{ refId: '1', text: '北' }],
            windSpeedList: [{ refId: '1', text: '1' }],
          },
        ],
      },
    ],
  });
  const result = parseVpfd51(xml, defaultExpectedVpfd51);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '対象地域外');
});

test('parseVpfd51: 対象StationCode不在は「対象地域外」', () => {
  const xml = buildVpfd51Xml({
    pointTimeSeriesInfoList: [
      {
        timeDefines: [{ timeId: '1', dateTime: '2026-09-10T18:00:00+09:00' }],
        items: [
          {
            stationCode: '99999',
            stationName: '他地点',
            temperatureList: [{ refId: '1', text: '20' }],
          },
        ],
      },
    ],
  });
  const result = parseVpfd51(xml, defaultExpectedVpfd51);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '対象地域外');
});

test('parseVpfd51: 対象AreaのTimeSeriesInfoが複数、またはItem重複は「未対応構造」', () => {
  // TimeSeriesInfo が複数
  const xmlMultiTs = buildVpfd51Xml({
    regionTimeSeriesInfoList: [
      {
        timeDefines: [{ timeId: '1', dateTime: '2026-09-10T18:00:00+09:00', duration: 'PT3H' }],
        items: [
          {
            areaCode: '130010',
            areaName: '東京地方',
            weatherList: [{ refId: '1', text: '晴れ' }],
            windDirectionList: [{ refId: '1', text: '北' }],
            windSpeedList: [{ refId: '1', text: '1' }],
          },
        ],
      },
      {
        timeDefines: [{ timeId: '1', dateTime: '2026-09-10T18:00:00+09:00', duration: 'PT3H' }],
        items: [
          {
            areaCode: '130010',
            areaName: '東京地方',
            weatherList: [{ refId: '1', text: 'くもり' }],
            windDirectionList: [{ refId: '1', text: '北' }],
            windSpeedList: [{ refId: '1', text: '1' }],
          },
        ],
      },
    ],
  });
  const resultMultiTs = parseVpfd51(xmlMultiTs, defaultExpectedVpfd51);
  assert.equal(resultMultiTs.ok, false);
  if (resultMultiTs.ok) return;
  assert.equal(resultMultiTs.disposition, '未対応構造');

  // 同一 TimeSeriesInfo 内で Item 重複
  const xmlDupItem = buildVpfd51Xml({
    regionTimeSeriesInfoList: [
      {
        timeDefines: [{ timeId: '1', dateTime: '2026-09-10T18:00:00+09:00', duration: 'PT3H' }],
        items: [
          {
            areaCode: '130010',
            areaName: '東京地方',
            weatherList: [{ refId: '1', text: '晴れ' }],
            windDirectionList: [{ refId: '1', text: '北' }],
            windSpeedList: [{ refId: '1', text: '1' }],
          },
          {
            areaCode: '130010',
            areaName: '東京地方',
            weatherList: [{ refId: '1', text: 'くもり' }],
            windDirectionList: [{ refId: '1', text: '北' }],
            windSpeedList: [{ refId: '1', text: '1' }],
          },
        ],
      },
    ],
  });
  const resultDupItem = parseVpfd51(xmlDupItem, defaultExpectedVpfd51);
  assert.equal(resultDupItem.ok, false);
  if (resultDupItem.ok) return;
  assert.equal(resultDupItem.disposition, '未対応構造');
});

test('parseVpfd51: ブロック内 timeId 重複は「未対応構造」', () => {
  const xml = buildVpfd51Xml({
    regionTimeSeriesInfoList: [
      {
        timeDefines: [
          { timeId: '1', dateTime: '2026-09-10T18:00:00+09:00', duration: 'PT3H' },
          { timeId: '1', dateTime: '2026-09-10T21:00:00+09:00', duration: 'PT3H' },
        ],
        items: [
          {
            areaCode: '130010',
            areaName: '東京地方',
            weatherList: [{ refId: '1', text: '晴れ' }],
            windDirectionList: [{ refId: '1', text: '北' }],
            windSpeedList: [{ refId: '1', text: '1' }],
          },
        ],
      },
    ],
  });
  const result = parseVpfd51(xml, defaultExpectedVpfd51);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
});

test('parseVpfd51: 参照先なし、または別ブロックの timeId を参照する refID は「未対応構造」', () => {
  const xml = buildVpfd51Xml({
    regionTimeSeriesInfoList: [
      {
        timeDefines: [{ timeId: '1', dateTime: '2026-09-10T18:00:00+09:00', duration: 'PT3H' }],
        items: [
          {
            areaCode: '130010',
            areaName: '東京地方',
            // 地点側の timeId '3' を参照
            weatherList: [{ refId: '3', text: '晴れ' }],
            windDirectionList: [{ refId: '1', text: '北' }],
            windSpeedList: [{ refId: '1', text: '1' }],
          },
        ],
      },
    ],
  });
  const result = parseVpfd51(xml, defaultExpectedVpfd51);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
});

test('parseVpfd51: 同一 (blockId, refId, element) の重複は「未対応構造」', () => {
  const xml = buildVpfd51Xml({
    regionTimeSeriesInfoList: [
      {
        timeDefines: [{ timeId: '1', dateTime: '2026-09-10T18:00:00+09:00', duration: 'PT3H' }],
        items: [
          {
            areaCode: '130010',
            areaName: '東京地方',
            // weather で refId '1' が重複
            weatherList: [
              { refId: '1', text: '晴れ' },
              { refId: '1', text: 'くもり' },
            ],
            windDirectionList: [{ refId: '1', text: '北' }],
            windSpeedList: [{ refId: '1', text: '1' }],
          },
        ],
      },
    ],
  });
  const result = parseVpfd51(xml, defaultExpectedVpfd51);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
});

test('parseVpfd51: 風速階級が 1〜6 以外は「未対応構造」', () => {
  for (const invalidRank of ['0', '7', '10', '毎秒5メートル']) {
    const xml = buildVpfd51Xml({
      regionTimeSeriesInfoList: [
        {
          timeDefines: [{ timeId: '1', dateTime: '2026-09-10T18:00:00+09:00', duration: 'PT3H' }],
          items: [
            {
              areaCode: '130010',
              areaName: '東京地方',
              weatherList: [{ refId: '1', text: '晴れ' }],
              windDirectionList: [{ refId: '1', text: '北' }],
              windSpeedList: [{ refId: '1', text: invalidRank }],
            },
          ],
        },
      ],
    });
    const result = parseVpfd51(xml, defaultExpectedVpfd51);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.disposition, '未対応構造');
  }
});

test('parseVpfd51: 気温が有限数値以外は「未対応構造」', () => {
  for (const invalidTemp of ['NaN', 'Infinity', '度', '20度', '']) {
    const xml = buildVpfd51Xml({
      pointTimeSeriesInfoList: [
        {
          timeDefines: [{ timeId: '1', dateTime: '2026-09-10T18:00:00+09:00' }],
          items: [
            {
              stationCode: '44132',
              stationName: '東京',
              temperatureList: [{ refId: '1', text: invalidTemp }],
            },
          ],
        },
      ],
    });
    const result = parseVpfd51(xml, defaultExpectedVpfd51);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.disposition, '未対応構造');
  }
});

test('parseVpfd51: 区域側の Duration 欠落または加算不能は「未対応構造」', () => {
  const xmlNoDuration = buildVpfd51Xml({
    regionTimeSeriesInfoList: [
      {
        timeDefines: [{ timeId: '1', dateTime: '2026-09-10T18:00:00+09:00' }], // duration なし
        items: [
          {
            areaCode: '130010',
            areaName: '東京地方',
            weatherList: [{ refId: '1', text: '晴れ' }],
            windDirectionList: [{ refId: '1', text: '北' }],
            windSpeedList: [{ refId: '1', text: '1' }],
          },
        ],
      },
    ],
  });
  const result = parseVpfd51(xmlNoDuration, defaultExpectedVpfd51);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '未対応構造');
});

test('parseVpfd51: 天気または風 Property の欠落は「未対応構造」', () => {
  const xmlNoWeather = buildVpfd51Xml({
    regionTimeSeriesInfoList: [
      {
        timeDefines: [{ timeId: '1', dateTime: '2026-09-10T18:00:00+09:00', duration: 'PT3H' }],
        items: [
          {
            areaCode: '130010',
            areaName: '東京地方',
            omitWeather: true,
            windDirectionList: [{ refId: '1', text: '北' }],
            windSpeedList: [{ refId: '1', text: '1' }],
          },
        ],
      },
    ],
  });
  const result1 = parseVpfd51(xmlNoWeather, defaultExpectedVpfd51);
  assert.equal(result1.ok, false);
  if (result1.ok) return;
  assert.equal(result1.disposition, '未対応構造');

  const xmlNoWind = buildVpfd51Xml({
    regionTimeSeriesInfoList: [
      {
        timeDefines: [{ timeId: '1', dateTime: '2026-09-10T18:00:00+09:00', duration: 'PT3H' }],
        items: [
          {
            areaCode: '130010',
            areaName: '東京地方',
            weatherList: [{ refId: '1', text: '晴れ' }],
            omitWind: true,
          },
        ],
      },
    ],
  });
  const result2 = parseVpfd51(xmlNoWind, defaultExpectedVpfd51);
  assert.equal(result2.ok, false);
  if (result2.ok) return;
  assert.equal(result2.disposition, '未対応構造');
});
