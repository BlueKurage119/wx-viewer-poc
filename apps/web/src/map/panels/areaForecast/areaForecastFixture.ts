import type {
  AreaTimeseriesData,
  AreaTimeseriesResponse,
  AreaTimeseriesTimeDefineDto,
  AreaTimeseriesValueDto,
} from '@wx-viewer-poc/shared';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

/**
 * 開発用フィクスチャ応答を生成する (Issue #58 §6)。
 *
 * 現在時刻を含む区間を先頭から3つ目(インデックス2)に配置し、
 * 過去2区間を含めて計14区間・15時点を作成する。
 * パネル3列内にアイコンあり・文字代替・欠測を揃え、
 * 階級1〜6、unknown、負値気温、文字気温、欠測、区間のない最終列を含める。
 */
export interface AreaForecastFixtureOptions {
  readonly isDev?: boolean;
  readonly search?: string;
  readonly tempCase?: string | null;
}

export function buildAreaForecastFixtureResponse(
  now: number,
  tempCaseOrOptions?: string | null | AreaForecastFixtureOptions,
): AreaTimeseriesResponse {
  // JSTでの現在時刻を基準に、現在の3時間区間の開始時刻を求める
  const jstNowMs = now + JST_OFFSET_MS;
  const jstNow = new Date(jstNowMs);
  const currentHour = jstNow.getUTCHours();
  const slotHour = Math.floor(currentHour / 3) * 3;

  const currentSlotJst = new Date(jstNowMs);
  currentSlotJst.setUTCHours(slotHour, 0, 0, 0);
  const currentSlotUtcMs = currentSlotJst.getTime() - JST_OFFSET_MS;

  // 先頭から3つ目(インデックス2)が現在区間になるよう、2区間(6時間)前から開始
  const baseUtcMs = currentSlotUtcMs - 2 * THREE_HOURS_MS;

  const timeDefines: AreaTimeseriesTimeDefineDto[] = [];
  const values: AreaTimeseriesValueDto[] = [];

  // 14区間 (PT3H)
  for (let i = 0; i < 14; i++) {
    const fromMs = baseUtcMs + i * THREE_HOURS_MS;
    const toMs = fromMs + THREE_HOURS_MS;
    const timeId = `reg-${i + 1}`;
    timeDefines.push({
      blockId: 'region-3hour',
      timeId,
      sequence: i + 1,
      timeFrom: new Date(fromMs).toISOString(),
      timeTo: new Date(toMs).toISOString(),
      duration: 'PT3H',
    });
  }

  // 15時点 (各区間の開始時刻14時点 + 最終区間の終了時刻1時点)
  for (let i = 0; i < 15; i++) {
    const atMs = baseUtcMs + i * THREE_HOURS_MS;
    const timeId = `temp-${i + 1}`;
    timeDefines.push({
      blockId: 'temperature-3hour',
      timeId,
      sequence: i + 1,
      timeFrom: new Date(atMs).toISOString(),
      timeTo: new Date(atMs).toISOString(),
      duration: null,
    });
  }

  // 天気データ (インデックス 2: アイコンあり「晴れ」、3: 長文字「くもり一時雨」、4: 欠測 null)
  const weatherList: (string | null)[] = [
    'くもり', // 0
    '雨', // 1
    '晴れ', // 2 (現在区間: アイコンあり)
    'くもり一時雨', // 3 (文字代替・2行折返し確認)
    null, // 4 (欠測)
    '雪', // 5
    '雨または雪', // 6
    '雨か雪', // 7
    '雪か雨', // 8
    '晴れ', // 9
    'くもり', // 10
    '雨', // 11
    '雪', // 12
    '晴れ', // 13
  ];

  // 風データ (風向・風速階級)
  // インデックス 2: 階級1・「北」(矢羽根)、3: 階級2・「北北西」(unit=１６方位漢字、矢羽根)、4: 欠測
  const windList: {
    readonly dir: string | null;
    readonly unit: string | null;
    readonly rank: string | null;
  }[] = [
    { dir: '南', unit: '８方位漢字', rank: '3' }, // 0: 階級3
    { dir: '南西', unit: '８方位漢字', rank: '4' }, // 1: 階級4
    { dir: '北', unit: '８方位漢字', rank: '1' }, // 2 (現在区間: 階級1)
    { dir: '北北西', unit: '１６方位漢字', rank: '2' }, // 3: 階級2・矢羽根(unit=１６方位漢字)
    { dir: null, unit: null, rank: null }, // 4: 欠測(参照欠落 → ?)
    { dir: '西', unit: '８方位漢字', rank: '5' }, // 5: 階級5
    { dir: '東', unit: '８方位漢字', rank: '6' }, // 6: 階級6
    { dir: '南東', unit: '８方位漢字', rank: '7' }, // 7: unknown 階級 '7'
    { dir: '北北西', unit: '８方位漢字', rank: '1' }, // 8: 矢羽根(unit=８方位漢字でも16方位表にあれば回転)
    { dir: '北北北西', unit: '８方位漢字', rank: '2' }, // 9: 16方位表に無い方位文字 → 漢字代替
    { dir: '静穏', unit: '８方位漢字', rank: '3' }, // 10: 方向なし → 「ー」
    { dir: '東', unit: '８方位漢字', rank: '4' }, // 11
    { dir: '北西', unit: '８方位漢字', rank: '5' }, // 12
    { dir: '北', unit: '８方位漢字', rank: '6' }, // 13
  ];

  // 気温ケース判定 (開発ビルド限定クエリ afTempCase=single|flat|empty|text、本番ビルドでは無視、Issue #58 §6)
  let afTempCase: string | null = null;
  if (typeof tempCaseOrOptions === 'string') {
    afTempCase = tempCaseOrOptions;
  } else if (tempCaseOrOptions && typeof tempCaseOrOptions === 'object') {
    if (tempCaseOrOptions.tempCase !== undefined) {
      afTempCase = tempCaseOrOptions.tempCase;
    } else {
      const isDev = tempCaseOrOptions.isDev ?? import.meta.env?.DEV === true;
      const search =
        tempCaseOrOptions.search ??
        (typeof window !== 'undefined' ? (window.location?.search ?? '') : '');
      if (isDev) {
        afTempCase = new URLSearchParams(search).get('afTempCase');
      }
    }
  } else if (import.meta.env?.DEV === true && typeof window !== 'undefined' && window.location) {
    afTempCase = new URLSearchParams(window.location.search).get('afTempCase');
  }

  // 気温データ (15時点)
  // 通常: 欠測1点(4)、文字値1点(5: 約8度)、負値(3, 8)、2桁(0, 1, 2, 13, 14)、小数(8: -10.5)、
  // 隣と大きく差のある点(2->3)、区間の無い最終列(14: 12)
  let tempList: {
    readonly num: number | null;
    readonly text: string | null;
    readonly unit: string | null;
  }[];

  if (afTempCase === 'single') {
    // 1点のみ (現在区間のインデックス2のみ 15℃、他は欠測)
    tempList = Array.from({ length: 15 }, (_, i) =>
      i === 2 ? { num: 15, text: null, unit: '度' } : { num: null, text: null, unit: null },
    );
  } else if (afTempCase === 'flat') {
    // 全点同値 (15℃)
    tempList = Array.from({ length: 15 }, () => ({ num: 15, text: null, unit: '度' }));
  } else if (afTempCase === 'empty') {
    // 全欠測
    tempList = Array.from({ length: 15 }, () => ({ num: null, text: null, unit: null }));
  } else if (afTempCase === 'text') {
    // 全点文字値のみ (点・線なし、各列「?」)
    tempList = Array.from({ length: 15 }, () => ({ num: null, text: '約15度', unit: null }));
  } else {
    // 通常
    tempList = [
      { num: 20, text: null, unit: '度' }, // 0
      { num: 18, text: null, unit: '度' }, // 1
      { num: 15, text: null, unit: '度' }, // 2 (現在区間)
      { num: -3, text: null, unit: '度' }, // 3 (負値、15->-3 急降下)
      { num: null, text: null, unit: null }, // 4 (欠測)
      { num: null, text: '約8度', unit: null }, // 5 (文字値)
      { num: 5, text: null, unit: '度' }, // 6
      { num: 3, text: null, unit: '度' }, // 7
      { num: -10.5, text: null, unit: '度' }, // 8 (負値・小数・2桁)
      { num: 0, text: null, unit: '度' }, // 9
      { num: 2, text: null, unit: '度' }, // 10
      { num: 6, text: null, unit: '度' }, // 11
      { num: 8, text: null, unit: '度' }, // 12
      { num: 10, text: null, unit: '度' }, // 13
      { num: -10.5, text: null, unit: '度' }, // 14 (区間のない最終列、境目 M)
    ];
  }

  let seq = 1;
  // region values
  for (let i = 0; i < 14; i++) {
    const timeId = `reg-${i + 1}`;
    const weather = weatherList[i] ?? null;
    values.push({
      blockId: 'region-3hour',
      refId: timeId,
      element: 'weather',
      valueCode: null,
      valueText: weather,
      valueNumber: null,
      unit: null,
      condition: null,
      sequence: seq++,
    });

    const wind = windList[i]!;
    values.push({
      blockId: 'region-3hour',
      refId: timeId,
      element: 'wind_direction',
      valueCode: null,
      valueText: wind.dir,
      valueNumber: null,
      unit: wind.unit,
      condition: null,
      sequence: seq++,
    });

    values.push({
      blockId: 'region-3hour',
      refId: timeId,
      element: 'wind_speed_rank',
      valueCode: wind.rank,
      valueText: null,
      valueNumber: null,
      unit: null,
      condition: null,
      sequence: seq++,
    });
  }

  // temp values
  for (let i = 0; i < 15; i++) {
    const timeId = `temp-${i + 1}`;
    const temp = tempList[i]!;
    values.push({
      blockId: 'temperature-3hour',
      refId: timeId,
      element: 'temperature',
      valueCode: null,
      valueText: temp.text,
      valueNumber: temp.num,
      unit: temp.unit,
      condition: null,
      sequence: seq++,
    });
  }

  const data: AreaTimeseriesData = {
    station: { code: '44132', name: '東京' },
    timeDefines,
    values,
  };

  return {
    terminalId: 'hkeagh01',
    venueId: 'east',
    controlStatus: 'normal',
    isTraining: false,
    evaluatedAt: new Date(now).toISOString(),
    area: { code: '130010', name: '東京地方' },
    metadata: {
      source: 'VPFD51',
      issuedAt: new Date(baseUtcMs + 2 * THREE_HOURS_MS).toISOString(),
      validAt: null,
      validFrom: new Date(baseUtcMs).toISOString(),
      validTo: new Date(baseUtcMs + 14 * THREE_HOURS_MS).toISOString(),
      fetchedAt: new Date(now).toISOString(),
      lastSuccessAt: new Date(now).toISOString(),
      availability: 'available',
      sourceVersion: '1.0',
    },
    data,
    capabilities: {
      blockIds: ['region-3hour', 'temperature-3hour'],
      elements: ['weather', 'wind_direction', 'wind_speed_rank', 'temperature'],
      unsupportedFields: ['weatherCode', 'windSpeedRange', 'windSpeedDescription'],
    },
  };
}
