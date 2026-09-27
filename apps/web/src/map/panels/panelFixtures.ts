/**
 * 実データ結線前の仮データ (G1 §6)。
 *
 * 開発ビルド限定で `?panelFixture=<名前>` から状態セットを切り替える。
 * 本番ビルドでは `resolvePanelFixtureInput` が常に `undefined` を返す。
 */
import { createElement } from 'react';
import type {
  BulletinDto,
  WarningTimeseriesResponse,
  WarningTimeseriesTimeDefine,
  WarningTimeseriesValue,
  WeatherMetadata,
} from '@wx-viewer-poc/shared';
import type { InfoPanelCardInput, InfoPanelColumnInput } from './panelDefinitions';
import { AreaForecastDetailFixtureEntry } from './detailDialogFixtures';
import { buildBosaiBulletinCards } from './bosai/bosaiBulletinCards';
import { buildWarningCards } from './warning/warningBadges';
import { buildWarningTimeSeriesCard } from './warningTimeSeries/warningTimeSeriesModel';
import type { WarningCurrentItem, WarningsResponse } from '@wx-viewer-poc/shared';

const DUMMY_CONTENT = '（G2〜G7で実装）';

function todayAt(hour: number, minute: number): string {
  const now = new Date();
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const jst = new Date(jstMs);
  jst.setUTCHours(hour, minute, 0, 0);
  return new Date(jst.getTime() - 9 * 60 * 60 * 1000).toISOString();
}

function contentCard(
  key: string,
  time: string,
  timeKind: 'issued' | 'observed',
  availability: 'available' | 'stale',
  heading?: string,
  content: InfoPanelCardInput['content'] = DUMMY_CONTENT,
): InfoPanelCardInput {
  return {
    key,
    heading,
    status: { kind: 'data', availability, time, timeKind },
    content,
  };
}

/**
 * 警報等時系列(§6)の合成データ組み立て。実電文ではなく、開発用に合成した値である。
 * `buildWarningTimeSeriesCard` を本番と同じ経路で通す。
 */
let wtsSequence = 0;
function nextWtsSequence(): number {
  wtsSequence += 1;
  return wtsSequence;
}

function wtsRiskValue(
  blockId: string,
  refId: string,
  propertyType: string,
  areaDivision: string | null,
  valueCode: string | null,
): WarningTimeseriesValue {
  return {
    blockId,
    refId,
    kindCode: null,
    kindName: null,
    kindStatus: '発表',
    kindDateTime: null,
    valueCategory: 'risk',
    propertyType,
    valueType: propertyType,
    valueCode,
    valueText: valueCode ?? '',
    unit: null,
    description: null,
    condition: null,
    areaDivision,
    sequence: nextWtsSequence(),
    scope: null,
  };
}

function wtsQuantityValue(
  blockId: string,
  refId: string,
  propertyType: string,
  valueType: string,
  areaDivision: string | null,
  valueText: string,
  unit: string | null,
  condition: string | null = null,
): WarningTimeseriesValue {
  return {
    blockId,
    refId,
    kindCode: null,
    kindName: null,
    kindStatus: '発表',
    kindDateTime: null,
    valueCategory: 'quantity',
    propertyType,
    valueType,
    valueCode: null,
    valueText,
    unit,
    description: null,
    condition,
    areaDivision,
    sequence: nextWtsSequence(),
    scope: null,
  };
}

function wtsTimeDefine(
  blockId: string,
  timeId: string,
  sequence: number,
  timeFrom: string,
  timeTo: string,
  duration: string,
): WarningTimeseriesTimeDefine {
  return { blockId, timeId, sequence, timeFrom, timeTo, duration };
}

/** 「今日0時JST」から`offsetHours`時間後のISO(日境界をまたいでも正しく進む)。 */
function jstDayOffset(offsetHours: number): string {
  const now = new Date();
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const jst = new Date(jstMs);
  jst.setUTCHours(0, 0, 0, 0);
  return new Date(jst.getTime() + offsetHours * 60 * 60 * 1000 - 9 * 60 * 60 * 1000).toISOString();
}

/** 当日06時起点の3時間区切りの時刻ISOを返す(block1用)。 */
function block1Hour(columnIndex: number): string {
  return jstDayOffset(6 + columnIndex * 3);
}

/**
 * §6の合成応答。`quiet=true` は全行が未満・値なしになる正常空フィクスチャ。
 */
function buildWarningTimeseriesFixtureResponse(quiet: boolean): WarningTimeseriesResponse {
  wtsSequence = 0;
  const COLUMN_COUNT = 14;
  const block1Ids = Array.from({ length: COLUMN_COUNT }, (_, i) => `b1t${i}`);
  const block1TimeDefines: WarningTimeseriesTimeDefine[] = block1Ids.map((timeId, i) =>
    wtsTimeDefine('block1', timeId, i, block1Hour(i), block1Hour(i + 1), 'PT3H'),
  );

  const block2TimeDefines: WarningTimeseriesTimeDefine[] = [
    wtsTimeDefine('block2', 'b2t0', 0, jstDayOffset(0), jstDayOffset(24), 'PT24H'),
    wtsTimeDefine('block2', 'b2t1', 1, jstDayOffset(24), jstDayOffset(48), 'PT24H'),
  ];

  const block3TimeDefines: WarningTimeseriesTimeDefine[] = [
    wtsTimeDefine('block3', 'b3t0', 0, jstDayOffset(6), jstDayOffset(24), 'PT18H'),
    wtsTimeDefine('block3', 'b3t1', 1, jstDayOffset(24), jstDayOffset(48), 'PT24H'),
    wtsTimeDefine('block3', 'b3t2', 2, jstDayOffset(48), jstDayOffset(72), 'PT24H'),
  ];

  const riskCodes = (codes: readonly string[]): readonly string[] =>
    quiet ? codes.map(() => '01') : codes;

  const values: WarningTimeseriesValue[] = [];

  // 大雨浸水危険度(切替セルの確認用)
  riskCodes([
    '11',
    '21',
    '21',
    '31',
    '31',
    '41',
    '51',
    '50',
    '31',
    '21',
    '11',
    '01',
    '01',
    '01',
  ]).forEach((code, i) =>
    values.push(wtsRiskValue('block1', block1Ids[i] as string, '大雨浸水危険度', null, code)),
  );
  // 雨(１時間最大雨量 mm)
  block1Ids.forEach((timeId, i) =>
    values.push(
      wtsQuantityValue(
        'block1',
        timeId,
        '雨',
        '１時間最大雨量',
        null,
        `${i + 1}`,
        'mm',
        i === 5 ? '値なし' : null,
      ),
    ),
  );
  // 土砂災害危険度
  riskCodes([
    '22',
    '31',
    '31',
    '21',
    '11',
    '01',
    '01',
    '01',
    '01',
    '01',
    '01',
    '01',
    '01',
    '01',
  ]).forEach((code, i) =>
    values.push(wtsRiskValue('block1', block1Ids[i] as string, '土砂災害危険度', null, code)),
  );
  // 風危険度(陸上)
  riskCodes([
    '01',
    '20',
    '30',
    '30',
    '50',
    '50',
    '41',
    '31',
    '21',
    '11',
    '01',
    '01',
    '01',
    '01',
  ]).forEach((code, i) =>
    values.push(wtsRiskValue('block1', block1Ids[i] as string, '風危険度', '陸上', code)),
  );
  // 風危険度(東京湾): 01と欠測のみ(非表示行、idx2/5はrefごと欠落=欠測)
  block1Ids.forEach((timeId, i) => {
    if (i === 2 || i === 5) return;
    values.push(wtsRiskValue('block1', timeId, '風危険度', '東京湾', '01'));
  });
  // 風(風向・最大風速、陸上/東京湾)
  block1Ids.forEach((timeId, i) => {
    values.push(wtsQuantityValue('block1', timeId, '風', '最大風速', '陸上', `${10 + i}`, 'm/s'));
    values.push(wtsQuantityValue('block1', timeId, '風', '最大風速', '東京湾', `${8 + i}`, 'm/s'));
  });
  // 雷危険度: 00とref欠落を1つずつ、表外コード99を1つ
  values.push(
    wtsRiskValue('block1', block1Ids[0] as string, '雷危険度', null, quiet ? '01' : '00'),
  );
  values.push(
    wtsRiskValue('block1', block1Ids[1] as string, '雷危険度', null, quiet ? '01' : '99'),
  );
  // block1Ids[2] はref欠落(値を作らない)
  for (let i = 3; i < COLUMN_COUNT; i += 1) {
    values.push(wtsRiskValue('block1', block1Ids[i] as string, '雷危険度', null, '01'));
  }
  // 濃霧危険度: 全て01(非表示行)
  block1Ids.forEach((timeId) =>
    values.push(wtsRiskValue('block1', timeId, '濃霧危険度', null, '01')),
  );

  // 雨(２４時間最大雨量 mm)
  values.push(wtsQuantityValue('block2', 'b2t0', '雨', '２４時間最大雨量', null, '120', 'mm'));
  values.push(
    wtsQuantityValue('block2', 'b2t1', '雨', '２４時間最大雨量', null, '0', 'mm', '値なし'),
  );
  // 雪(２４時間最大降雪量 cm)
  values.push(wtsQuantityValue('block2', 'b2t0', '雪', '２４時間最大降雪量', null, '5', 'cm'));
  values.push(wtsQuantityValue('block2', 'b2t1', '雪', '２４時間最大降雪量', null, '0', 'cm'));

  // 乾燥危険度(日単位、3時間列へ複製)
  riskCodes(['20', '01', '20']).forEach((code, i) =>
    values.push(wtsRiskValue('block3', `b3t${i}`, '乾燥危険度', null, code)),
  );
  // 乾燥(実効湿度 %・最小湿度 %)
  ['55', '60', '58'].forEach((text, i) =>
    values.push(wtsQuantityValue('block3', `b3t${i}`, '乾燥', '実効湿度', null, text, '%')),
  );
  ['30', '28', '32'].forEach((text, i) =>
    values.push(wtsQuantityValue('block3', `b3t${i}`, '乾燥', '最小湿度', null, text, '%')),
  );
  // 霜危険度: 全て00(非表示行)
  ['b3t0', 'b3t1', 'b3t2'].forEach((timeId) =>
    values.push(wtsRiskValue('block3', timeId, '霜危険度', null, '00')),
  );

  return {
    terminalId: 'fixture-terminal',
    venueId: 'east',
    controlStatus: 'normal',
    isTraining: false,
    evaluatedAt: todayAt(5, 0),
    area: { code: '130108', name: '江東区' },
    metadata: {
      source: null,
      issuedAt: todayAt(5, 0),
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: null,
      lastSuccessAt: null,
      availability: 'available',
      sourceVersion: null,
    },
    data: {
      timeDefines: [...block1TimeDefines, ...block2TimeDefines, ...block3TimeDefines],
      values,
      additions: null,
    },
  };
}

function buildWarningTimeSeriesFixtureCards(quiet: boolean): readonly InfoPanelCardInput[] {
  const response = buildWarningTimeseriesFixtureResponse(quiet);
  return [buildWarningTimeSeriesCard(response, 'available', Date.now())];
}

const LOADING_CARD: InfoPanelCardInput = { key: 'default', status: { kind: 'loading' } };
const FAILED_CARD: InfoPanelCardInput = { key: 'default', status: { kind: 'failed' } };

/** 既定値: 全パネル loading（always 4枚はスケルトン、occasional 2枚は非表示） */
export const DEFAULT_INFO_PANEL_INPUT: InfoPanelColumnInput = Object.freeze({
  bosaiBulletin: Object.freeze([]),
  warning: Object.freeze([LOADING_CARD]),
  warningTimeSeries: Object.freeze([LOADING_CARD]),
  earlyWarning: Object.freeze([LOADING_CARD]),
  amedas: Object.freeze([LOADING_CARD]),
  areaForecast: Object.freeze([LOADING_CARD]),
});

function buildAllContentFixture(): InfoPanelColumnInput {
  return Object.freeze({
    // 入力は古い順に渡す（並べ替えロジックの確認用、§6）
    bosaiBulletin: Object.freeze([
      contentCard(
        'bosai-2',
        todayAt(13, 40),
        'issued',
        'available',
        '東京都気象防災速報（記録的短時間大雨）',
      ),
      contentCard(
        'bosai-1',
        todayAt(14, 5),
        'issued',
        'available',
        '東京都気象防災速報（竜巻注意）',
      ),
    ]),
    warning: Object.freeze([contentCard('warning', todayAt(14, 0), 'issued', 'available')]),
    // §6の合成応答を本番と同じ buildWarningTimeSeriesCard に通す(G10の仮入口を撤去、AC-15)
    warningTimeSeries: Object.freeze(buildWarningTimeSeriesFixtureCards(false)),
    earlyWarning: Object.freeze([
      contentCard('earlyWarning', todayAt(14, 0), 'issued', 'available'),
    ]),
    amedas: Object.freeze([contentCard('amedas', todayAt(14, 10), 'observed', 'available')]),
    // 「詳細（仮）」入口 (G10 §6)。G6で本物のパネル本文に置き換える
    areaForecast: Object.freeze([
      contentCard(
        'areaForecast',
        todayAt(14, 0),
        'issued',
        'available',
        undefined,
        createElement(AreaForecastDetailFixtureEntry),
      ),
    ]),
  });
}

function buildMixedFixture(): InfoPanelColumnInput {
  return Object.freeze({
    bosaiBulletin: Object.freeze([]),
    warning: Object.freeze([contentCard('warning', todayAt(13, 0), 'issued', 'stale')]),
    warningTimeSeries: Object.freeze([FAILED_CARD]),
    earlyWarning: Object.freeze([LOADING_CARD]),
    amedas: Object.freeze([contentCard('amedas', todayAt(13, 10), 'observed', 'stale')]),
    areaForecast: Object.freeze([
      contentCard('areaForecast', todayAt(14, 0), 'issued', 'available'),
    ]),
  });
}

function buildFailedFixture(): InfoPanelColumnInput {
  return Object.freeze({
    bosaiBulletin: Object.freeze([FAILED_CARD]),
    warning: Object.freeze([FAILED_CARD]),
    warningTimeSeries: Object.freeze([FAILED_CARD]),
    earlyWarning: Object.freeze([FAILED_CARD]),
    amedas: Object.freeze([FAILED_CARD]),
    areaForecast: Object.freeze([FAILED_CARD]),
  });
}

/**
 * フィクスチャ用のダミーメタデータ。
 * ※ フィクスチャのタイトル・全文・区域データ等は合成であり、実電文ではありません。
 * ※ F1〜F3 は現在時刻を起点とする同一日の時刻で作るため、日付をまたぐ直前（00:00〜00:50 JST）に開くと並びや日付表記が変わり得ます。
 */
function createFixtureMetadata(validAt: string | null = null): WeatherMetadata {
  return {
    source: null,
    issuedAt: null,
    validAt,
    validFrom: null,
    validTo: null,
    fetchedAt: null,
    lastSuccessAt: null,
    availability: 'available',
    sourceVersion: null,
  };
}

export function buildBosaiBulletinsFixture(): InfoPanelColumnInput {
  const nowMs = Date.now();
  const allContent = buildAllContentFixture();

  const bulletins: readonly BulletinDto[] = [
    // F1: VPBS50 発表=現在−40分、区域重複あり、全文2文
    {
      eventId: 'fixture-f1',
      telegramType: 'VPBS50',
      infoType: '発表',
      isCancelled: false,
      reportDateTime: new Date(nowMs - 40 * 60 * 1000).toISOString(),
      controlDateTime: new Date(nowMs - 40 * 60 * 1000).toISOString(),
      title: '東京都気象防災速報（記録的短時間大雨）',
      headlineText:
        '東京都で記録的短時間大雨が観測されました。\n土砂災害や低い土地の浸水に警戒してください。',
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
        {
          areaCode: '130010',
          areaName: '２３区東部',
          codeType: 'Area',
          sequence: 2,
          informationType: null,
        },
        {
          areaCode: '130108',
          areaName: '江東区',
          codeType: 'Area',
          sequence: 3,
          informationType: null,
        },
        {
          areaCode: '130108',
          areaName: '江東区',
          codeType: 'Area',
          sequence: 4,
          informationType: null,
        },
      ],
      isDirect: false,
      matchedAreaCodes: [],
      metadata: createFixtureMetadata(null),
    },
    // F2: VPHW51 発表=現在−10分、validAt=現在+50分、hasSighting=true、発表細分+市町村等3件
    {
      eventId: 'VPHW51:130010',
      telegramType: 'VPHW51',
      infoType: '発表',
      isCancelled: false,
      reportDateTime: new Date(nowMs - 10 * 60 * 1000).toISOString(),
      controlDateTime: new Date(nowMs - 10 * 60 * 1000).toISOString(),
      title: '東京都気象防災速報（竜巻目撃）',
      headlineText: '東京地方で竜巻などの激しい突風が発生したとみられます。',
      informationTag: null,
      hasSighting: true,
      areas: [
        {
          areaCode: '130010',
          areaName: '東京地方',
          codeType: 'Area',
          sequence: 1,
          informationType: '竜巻注意情報（発表細分）',
        },
        {
          areaCode: '130011',
          areaName: '２３区東部',
          codeType: 'Area',
          sequence: 2,
          informationType: '竜巻注意情報（まとめた地域）',
        },
        {
          areaCode: '130108',
          areaName: '江東区',
          codeType: 'Area',
          sequence: 3,
          informationType: '竜巻注意情報（市町村等）',
        },
        {
          areaCode: '130107',
          areaName: '墨田区',
          codeType: 'Area',
          sequence: 4,
          informationType: '竜巻注意情報（市町村等）',
        },
      ],
      isDirect: false,
      matchedAreaCodes: [],
      metadata: createFixtureMetadata(new Date(nowMs + 50 * 60 * 1000).toISOString()),
    },
    // F3: VPHW50 F2と同刻・同区域・同validAt、hasSighting=null
    {
      eventId: 'VPHW50:130010',
      telegramType: 'VPHW50',
      infoType: '発表',
      isCancelled: false,
      reportDateTime: new Date(nowMs - 10 * 60 * 1000).toISOString(),
      controlDateTime: new Date(nowMs - 10 * 60 * 1000).toISOString(),
      title: '東京都気象防災速報（竜巻注意）',
      headlineText: '東京地方は、竜巻などの激しい突風が発生しやすい気象状況になっています。',
      informationTag: null,
      hasSighting: null,
      areas: [
        {
          areaCode: '130010',
          areaName: '東京地方',
          codeType: 'Area',
          sequence: 1,
          informationType: '竜巻注意情報（発表細分）',
        },
        {
          areaCode: '130011',
          areaName: '２３区東部',
          codeType: 'Area',
          sequence: 2,
          informationType: '竜巻注意情報（まとめた地域）',
        },
        {
          areaCode: '130108',
          areaName: '江東区',
          codeType: 'Area',
          sequence: 3,
          informationType: '竜巻注意情報（市町村等）',
        },
        {
          areaCode: '130107',
          areaName: '墨田区',
          codeType: 'Area',
          sequence: 4,
          informationType: '竜巻注意情報（市町村等）',
        },
      ],
      isDirect: false,
      matchedAreaCodes: [],
      metadata: createFixtureMetadata(new Date(nowMs + 50 * 60 * 1000).toISOString()),
    },
    // F4: VPBS50 発表=現在−3時間1分（期限切れで非表示）
    {
      eventId: 'fixture-f4',
      telegramType: 'VPBS50',
      infoType: '発表',
      isCancelled: false,
      reportDateTime: new Date(nowMs - (3 * 60 + 1) * 60 * 1000).toISOString(),
      controlDateTime: new Date(nowMs - (3 * 60 + 1) * 60 * 1000).toISOString(),
      title: '東京都気象防災速報（線状降水帯発生）',
      headlineText: '線状降水帯による非常に激しい雨が同じ場所に降り続いています。',
      informationTag: '線状降水帯発生',
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
      metadata: createFixtureMetadata(null),
    },
    // F5: VPHW50 発表=現在−20分、validAt=現在−1分（電文期限切れで非表示）
    {
      eventId: 'VPHW50:130020',
      telegramType: 'VPHW50',
      infoType: '発表',
      isCancelled: false,
      reportDateTime: new Date(nowMs - 20 * 60 * 1000).toISOString(),
      controlDateTime: new Date(nowMs - 20 * 60 * 1000).toISOString(),
      title: '東京都気象防災速報（竜巻注意）',
      headlineText: '東京地方は、竜巻などの激しい突風が発生しやすい気象状況になっています。',
      informationTag: null,
      hasSighting: null,
      areas: [
        {
          areaCode: '130010',
          areaName: '東京地方',
          codeType: 'Area',
          sequence: 1,
          informationType: '竜巻注意情報（発表細分）',
        },
      ],
      isDirect: false,
      matchedAreaCodes: [],
      metadata: createFixtureMetadata(new Date(nowMs - 1 * 60 * 1000).toISOString()),
    },
    // F6: VPBS50 発表=現在−5分、取消、headlineText=null（非表示）
    {
      eventId: 'fixture-f6',
      telegramType: 'VPBS50',
      infoType: '取消',
      isCancelled: true,
      reportDateTime: new Date(nowMs - 5 * 60 * 1000).toISOString(),
      controlDateTime: new Date(nowMs - 5 * 60 * 1000).toISOString(),
      title: '東京都気象防災速報（線状降水帯直前予測）',
      headlineText: null,
      informationTag: '線状降水帯直前',
      hasSighting: null,
      areas: [],
      isDirect: false,
      matchedAreaCodes: [],
      metadata: createFixtureMetadata(null),
    },
  ];

  const bosaiBulletinCards = buildBosaiBulletinCards({
    bulletins,
    availability: 'available',
    nowMs,
  });

  return Object.freeze({
    bosaiBulletin: Object.freeze(bosaiBulletinCards),
    warning: allContent.warning,
    warningTimeSeries: allContent.warningTimeSeries,
    earlyWarning: allContent.earlyWarning,
    amedas: allContent.amedas,
    areaForecast: allContent.areaForecast,
  });
}

/**
 * §6 の合成データ(実電文ではない)。`buildWarningCards` を本番と同じ経路で通す。
 */
function buildWarningBadgesFixture(): InfoPanelColumnInput {
  const allContent = buildAllContentFixture();

  function item(
    kindCode: string,
    kindStatus: string,
    lastKindCode: string | null,
  ): WarningCurrentItem {
    return {
      sequence: 0,
      kindCode,
      kindName: `${kindCode}(合成データ)`,
      kindStatus,
      lastKindCode,
      lastKindName: null,
      kindIssuedAt: null,
      sourceTelegram: 'fixture',
    };
  }

  const items: readonly WarningCurrentItem[] = [
    item('14', '継続', null), // W1
    item('03', '発表', '10'), // W2
    item('29', '発表', null), // W3
    item('48', '継続', null), // W4
    item('38', '継続', null), // W5
    item('15', '警報から注意報', '05'), // W6
    item('99', '発表', null), // W7(表外・描画されない)
  ];

  const response: WarningsResponse = {
    terminalId: 'fixture-terminal',
    venueId: 'east',
    controlStatus: 'normal',
    isTraining: false,
    evaluatedAt: todayAt(14, 0),
    area: { code: '1310800', name: '江東区' },
    metadata: {
      source: null,
      issuedAt: todayAt(14, 0),
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: null,
      lastSuccessAt: null,
      availability: 'available',
      sourceVersion: null,
    },
    data: { items },
    capabilities: { unsupportedKindCodes: ['04', '18'], supplementSource: 'warning-timeseries' },
  };

  return Object.freeze({
    bosaiBulletin: Object.freeze([]),
    warning: Object.freeze(buildWarningCards(response, 'available')),
    warningTimeSeries: allContent.warningTimeSeries,
    earlyWarning: allContent.earlyWarning,
    amedas: allContent.amedas,
    areaForecast: allContent.areaForecast,
  });
}

/** `warning-timeseries`: 通常表示(§6) */
function buildWarningTimeseriesFixture(): InfoPanelColumnInput {
  const allContent = buildAllContentFixture();
  return Object.freeze({
    ...allContent,
    warningTimeSeries: Object.freeze(buildWarningTimeSeriesFixtureCards(false)),
  });
}

/** `warning-timeseries-quiet`: 全行が未満・値なしで、表示行0件になる正常空(§6) */
function buildWarningTimeseriesQuietFixture(): InfoPanelColumnInput {
  const allContent = buildAllContentFixture();
  return Object.freeze({
    ...allContent,
    warningTimeSeries: Object.freeze(buildWarningTimeSeriesFixtureCards(true)),
  });
}

const FIXTURE_BUILDERS: Readonly<Record<string, () => InfoPanelColumnInput>> = Object.freeze({
  'all-content': buildAllContentFixture,
  'bosai-bulletins': buildBosaiBulletinsFixture,
  'warning-badges': buildWarningBadgesFixture,
  'warning-timeseries': buildWarningTimeseriesFixture,
  'warning-timeseries-quiet': buildWarningTimeseriesQuietFixture,
  mixed: buildMixedFixture,
  failed: buildFailedFixture,
});

export const PANEL_FIXTURE_NAMES: readonly string[] = Object.freeze(Object.keys(FIXTURE_BUILDERS));

/**
 * 開発ビルド限定で `?panelFixture=<名前>` からフィクスチャを取得する。
 * 本番ビルド・該当クエリなし・未知の名前のときは `undefined`。
 */
export function resolvePanelFixtureInput(): InfoPanelColumnInput | undefined {
  if (!import.meta.env?.DEV) {
    return undefined;
  }
  if (typeof window === 'undefined' || !window.location) {
    return undefined;
  }
  const name = new URLSearchParams(window.location.search).get('panelFixture');
  if (name === null) {
    return undefined;
  }
  const builder = FIXTURE_BUILDERS[name];
  return builder ? builder() : undefined;
}
