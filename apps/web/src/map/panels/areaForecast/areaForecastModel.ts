import type {
  AreaTimeseriesData,
  AreaTimeseriesTimeDefineDto,
  AreaTimeseriesValueDto,
  UtcIso8601String,
  WeatherArea,
  WeatherStation,
} from '@wx-viewer-poc/shared';
import { classifyWindDirection16, isDirectionalText } from './windDirection16';
import { buildWeatherView, type WeatherView } from './weatherIconMap';
import { buildLevelView, type LevelView } from './windSpeedLevel';
import { formatFullJstDate } from '../../detail/timeSeriesHeader';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type AreaForecastColumn = {
  readonly key: string;
  readonly at: UtcIso8601String; // 列の代表時刻（区間の開始時刻 = 同時刻の時点）
  readonly label: string; // 「9時」。全列に付ける時点1段の見出し（確定事項12）
};

export type DirView =
  | { readonly kind: 'missing' } // 参照欠落（欠測）
  | { readonly kind: 'none'; readonly raw: string } // 方向なし（方位文字以外の文字列）→「ー」
  | { readonly kind: 'text'; readonly text: string; readonly rotation: number | null };

export type WindView = {
  readonly direction: DirView;
  readonly level: LevelView;
};

export type TemperatureView =
  | { readonly kind: 'missing' }
  | { readonly kind: 'value'; readonly text: string; readonly value: number | null }; // 例 "12℃", "-3℃"

export type IntervalCell =
  | {
      readonly kind: 'value';
      readonly startIndex: number;
      readonly span: number;
      readonly timeFrom: string;
      readonly timeTo: string;
      readonly weather: WeatherView;
      readonly wind: WindView;
    }
  | { readonly kind: 'none'; readonly startIndex: number; readonly span: number };

export type PointCell =
  | {
      readonly kind: 'value';
      readonly index: number;
      readonly at: string;
      readonly temperature: TemperatureView;
    }
  | { readonly kind: 'none'; readonly index: number };

export type AreaForecastTableModel = {
  readonly kind: 'table';
  readonly columns: readonly AreaForecastColumn[];
  readonly intervals: readonly IntervalCell[];
  readonly points: readonly PointCell[];
  readonly droppedValueCount: number;
};

export type AreaForecastModel = AreaForecastTableModel | { readonly kind: 'invalid' };

/** JSTの「時」を0〜23で返す */
export function toJstHour(iso: string): number {
  const d = new Date(Date.parse(iso) + JST_OFFSET_MS);
  return d.getUTCHours();
}

/** 区間の終了時刻のJST「時」を返す。翌日0時終端は24 */
export function toJstEndHour(fromIso: string, toIso: string): number {
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  const end = new Date(toMs + JST_OFFSET_MS);
  const endHour = end.getUTCHours();
  if (endHour === 0 && toMs > fromMs) {
    const diffHours = (toMs - fromMs) / (60 * 60 * 1000);
    if (diffHours <= 24) {
      return 24;
    }
  }
  return endHour;
}

export function buildTemperatureView(
  valueNumber: number | null,
  valueText: string | null,
  unit: string | null,
): TemperatureView {
  if (typeof valueNumber === 'number' && Number.isFinite(valueNumber)) {
    const u = unit === '度' ? '℃' : (unit ?? '℃');
    return { kind: 'value', text: `${valueNumber}${u}`, value: valueNumber };
  }
  if (valueText !== null && valueText !== '') {
    return { kind: 'value', text: valueText, value: null };
  }
  return { kind: 'missing' };
}

export function buildDirView(valueText: string | null, unit: string | null): DirView {
  if (valueText === null) {
    return { kind: 'missing' };
  }
  if (!isDirectionalText(valueText)) {
    return { kind: 'none', raw: valueText };
  }
  return {
    kind: 'text',
    text: valueText,
    rotation: classifyWindDirection16(valueText, unit),
  };
}

/**
 * DTOから表モデルを組み立てる純粋関数 (Issue #58 §3.2, AD-H050, AC-2, AC-3)。
 */
export function buildAreaForecastModel(data: AreaTimeseriesData): AreaForecastModel {
  const regionTimeDefines = data.timeDefines.filter((td) => td.blockId === 'region-3hour');
  const tempTimeDefines = data.timeDefines.filter((td) => td.blockId === 'temperature-3hour');

  // 区間の検証 (timeTo <= timeFrom または区間の重なり)
  const sortedRegions = [...regionTimeDefines].sort(
    (a, b) => Date.parse(a.timeFrom) - Date.parse(b.timeFrom),
  );

  for (let i = 0; i < sortedRegions.length; i++) {
    const r = sortedRegions[i]!;
    const fromMs = Date.parse(r.timeFrom);
    const toMs = Date.parse(r.timeTo);
    if (toMs <= fromMs) {
      return { kind: 'invalid' };
    }
    if (i > 0) {
      const prev = sortedRegions[i - 1]!;
      const prevToMs = Date.parse(prev.timeTo);
      if (fromMs < prevToMs) {
        // 重なり検出
        return { kind: 'invalid' };
      }
    }
  }

  // values を blockId ごとに timeId と結合
  // 重複チェック: 同一 blockId, refId, element
  const regionValuesMap = new Map<string, Map<string, AreaTimeseriesValueDto | null>>();
  const tempValuesMap = new Map<string, Map<string, AreaTimeseriesValueDto | null>>();
  let droppedValueCount = 0;

  const regionTimeIds = new Set(regionTimeDefines.map((td) => td.timeId));
  const tempTimeIds = new Set(tempTimeDefines.map((td) => td.timeId));

  for (const v of data.values) {
    if (v.blockId === 'region-3hour') {
      if (!regionTimeIds.has(v.refId)) {
        droppedValueCount++;
        continue;
      }
      let elemMap = regionValuesMap.get(v.refId);
      if (!elemMap) {
        elemMap = new Map();
        regionValuesMap.set(v.refId, elemMap);
      }
      if (elemMap.has(v.element)) {
        // 重複値 -> missing (推測で選ばない)
        elemMap.set(v.element, null);
      } else {
        elemMap.set(v.element, v);
      }
    } else if (v.blockId === 'temperature-3hour') {
      if (!tempTimeIds.has(v.refId)) {
        droppedValueCount++;
        continue;
      }
      let elemMap = tempValuesMap.get(v.refId);
      if (!elemMap) {
        elemMap = new Map();
        tempValuesMap.set(v.refId, elemMap);
      }
      if (elemMap.has(v.element)) {
        elemMap.set(v.element, null);
      } else {
        elemMap.set(v.element, v);
      }
    } else {
      droppedValueCount++;
    }
  }

  // 列の集合 = region-3hour の各 timeFrom ∪ temperature-3hour の各時刻(timeFrom)
  const timeSet = new Set<string>();
  for (const td of regionTimeDefines) {
    timeSet.add(td.timeFrom);
  }
  for (const td of tempTimeDefines) {
    timeSet.add(td.timeFrom);
  }

  const sortedTimes = [...timeSet].sort((a, b) => Date.parse(a) - Date.parse(b));
  if (sortedTimes.length === 0) {
    return {
      kind: 'table',
      columns: [],
      intervals: [],
      points: [],
      droppedValueCount,
    };
  }

  // 各 timeDefine のマップ
  const regionByFrom = new Map<string, AreaTimeseriesTimeDefineDto>();
  for (const td of regionTimeDefines) {
    regionByFrom.set(td.timeFrom, td);
  }
  const tempByFrom = new Map<string, AreaTimeseriesTimeDefineDto>();
  for (const td of tempTimeDefines) {
    tempByFrom.set(td.timeFrom, td);
  }

  // 列リストの構築（見出しは時点1段「9時」、確定事項12）
  const columns: AreaForecastColumn[] = sortedTimes.map((at, index) => ({
    key: `col-${index}-${at}`,
    at,
    label: `${toJstHour(at)}時`,
  }));

  // 区間セルの構築
  const intervals: IntervalCell[] = [];
  let colIndex = 0;
  while (colIndex < sortedTimes.length) {
    const colTime = sortedTimes[colIndex]!;
    const colTimeMs = Date.parse(colTime);

    // この列時刻から始まる、あるいはこの列時刻を含む region 区間を探す
    const activeRegion = sortedRegions.find((r) => {
      const fromMs = Date.parse(r.timeFrom);
      const toMs = Date.parse(r.timeTo);
      return colTimeMs >= fromMs && colTimeMs < toMs;
    });

    if (!activeRegion || Date.parse(activeRegion.timeFrom) !== colTimeMs) {
      // どの区間にも含まれない列 (または区間の開始列でない)
      // 連続する非区間列を数えて span
      let span = 0;
      const startIndex = colIndex;
      while (colIndex < sortedTimes.length) {
        const tMs = Date.parse(sortedTimes[colIndex]!);
        const r = sortedRegions.find(
          (reg) => tMs >= Date.parse(reg.timeFrom) && tMs < Date.parse(reg.timeTo),
        );
        if (r && Date.parse(r.timeFrom) === tMs) {
          break; // 次の区間の開始列に到達
        }
        span++;
        colIndex++;
      }
      intervals.push({ kind: 'none', startIndex, span });
    } else {
      // 区間の開始列
      const startIndex = colIndex;
      const regToMs = Date.parse(activeRegion.timeTo);
      let span = 0;
      while (colIndex < sortedTimes.length) {
        const tMs = Date.parse(sortedTimes[colIndex]!);
        if (tMs >= regToMs) break;
        span++;
        colIndex++;
      }

      // 要素の取得
      const elemMap = regionValuesMap.get(activeRegion.timeId);
      const weatherVal = elemMap?.get('weather');
      const weatherView: WeatherView =
        weatherVal === null || weatherVal === undefined
          ? { kind: 'missing' }
          : buildWeatherView(weatherVal.valueText);

      const dirVal = elemMap?.get('wind_direction');
      const dirView: DirView =
        dirVal === null || dirVal === undefined
          ? { kind: 'missing' }
          : buildDirView(dirVal.valueText, dirVal.unit);

      const rankVal = elemMap?.get('wind_speed_rank');
      const levelView: LevelView =
        rankVal === null || rankVal === undefined
          ? { kind: 'missing' }
          : buildLevelView(rankVal.valueCode);

      intervals.push({
        kind: 'value',
        startIndex,
        span,
        timeFrom: activeRegion.timeFrom,
        timeTo: activeRegion.timeTo,
        weather: weatherView,
        wind: { direction: dirView, level: levelView },
      });
    }
  }

  // 時点セル (points) の構築: 各列に対して1対1
  const points: PointCell[] = sortedTimes.map((at, index) => {
    const tempTd = tempByFrom.get(at);
    if (!tempTd) {
      return { kind: 'none', index };
    }
    const elemMap = tempValuesMap.get(tempTd.timeId);
    const tempVal = elemMap?.get('temperature');
    const tempView: TemperatureView =
      tempVal === null || tempVal === undefined
        ? { kind: 'missing' }
        : buildTemperatureView(tempVal.valueNumber, tempVal.valueText, tempVal.unit);

    return {
      kind: 'value',
      index,
      at,
      temperature: tempView,
    };
  });

  return {
    kind: 'table',
    columns,
    intervals,
    points,
    droppedValueCount,
  };
}

/**
 * パネル3列の選択 (Issue #58 §3.2, #56 §4)。
 *
 * timeFrom <= now < timeTo の区間の開始列を起点に最大3列。
 * 現在を含む区間が無ければ now 以降で最初の列から最大3列。
 * 対象がなければ空配列。
 */
export function selectPanelColumns(
  columns: readonly AreaForecastColumn[],
  intervals: readonly IntervalCell[],
  now: number,
): readonly AreaForecastColumn[] {
  if (columns.length === 0) return [];

  // 現在時刻を含む区間を探す (timeFrom <= now < timeTo)
  const currentInterval = intervals.find(
    (cell): cell is Extract<IntervalCell, { kind: 'value' }> =>
      cell.kind === 'value' && Date.parse(cell.timeFrom) <= now && now < Date.parse(cell.timeTo),
  );

  let startColumnIndex = -1;
  if (currentInterval) {
    startColumnIndex = currentInterval.startIndex;
  } else {
    // now 以降で最初の列
    startColumnIndex = columns.findIndex((c) => Date.parse(c.at) >= now);
  }

  if (startColumnIndex < 0 || startColumnIndex >= columns.length) {
    return [];
  }

  return columns.slice(startColumnIndex, startColumnIndex + 3);
}

/**
 * 画面表記の対象地点・地域名の解決 (Issue #58 §4.2, §4.3, 確定事項11, AC-11)。
 *
 * パネル見出し・詳細ダイアログとも同じ「東京地方／東京（北の丸公園）」の1本の文字列で表す。
 * `area.code` / `station.code` が会場定義と一致しない場合は、推測で定義名を付けず
 * API の `area.name` / `station.name` をそのまま使う。
 */
export function resolveAreaForecastTarget(area: WeatherArea, station: WeatherStation): string {
  const isDefaultTokyo = area.code === '130010' && station.code === '44132';
  const areaName = isDefaultTokyo ? '東京地方' : area.name;
  const stationName = isDefaultTokyo ? '東京（北の丸公園）' : station.name;
  return `${areaName}／${stationName}`;
}

// ==========================================
// 読み上げテキスト (aria-label) 生成ヘルパー (Issue #58 §4.1, AC-9)
// ==========================================

/** 列見出しの読み上げ。例「2026年9月28日(月) 9時」(§4.1)。 */
export function formatColumnAriaLabel(column: AreaForecastColumn): string {
  return `${formatFullJstDate(column.at)} ${column.label}`;
}

export function formatIntervalRangeJst(fromIso: string, toIso: string): string {
  const fromHour = toJstHour(fromIso);
  const toHour = toJstEndHour(fromIso, toIso);
  return `${fromHour}時から${toHour}時`;
}

export function formatWeatherAriaLabel(interval: IntervalCell, column: AreaForecastColumn): string {
  const dateStr = formatFullJstDate(column.at);
  if (interval.kind === 'none') {
    return `${dateStr}、対象外`;
  }
  const timeRange = formatIntervalRangeJst(interval.timeFrom, interval.timeTo);
  if (interval.weather.kind === 'missing') {
    return `${dateStr} ${timeRange}、天気欠測`;
  }
  return `${dateStr} ${timeRange}、${interval.weather.text}`;
}

export function formatWindAriaLabel(interval: IntervalCell, column: AreaForecastColumn): string {
  const dateStr = formatFullJstDate(column.at);
  if (interval.kind === 'none') {
    return `${dateStr}、対象外`;
  }
  const timeRange = formatIntervalRangeJst(interval.timeFrom, interval.timeTo);

  const direction = interval.wind.direction;
  const dirText =
    direction.kind === 'missing'
      ? '風向欠測'
      : direction.kind === 'none'
        ? `風向なし（${direction.raw}）`
        : `${direction.text}の風`;

  let speedText = '';
  if (interval.wind.level.kind === 'missing') {
    speedText = '風速欠測';
  } else if (interval.wind.level.kind === 'known') {
    if (interval.wind.level.rangeLabel === '20以上') {
      speedText = '毎秒20メートル以上';
    } else {
      const parts = interval.wind.level.rangeLabel.split('-');
      speedText = `毎秒${parts[0]}から${parts[1]}メートル`;
    }
  } else {
    speedText = `毎秒${interval.wind.level.raw}メートル`;
  }

  return `${dateStr} ${timeRange}、${dirText}、${speedText}`;
}

export function formatTemperatureAriaLabel(point: PointCell, column: AreaForecastColumn): string {
  const dateStr = formatFullJstDate(column.at);
  const hour = toJstHour(column.at);
  if (point.kind === 'none') {
    return `${dateStr} ${hour}時、対象外`;
  }
  if (point.temperature.kind === 'missing') {
    return `${dateStr} ${hour}時、気温欠測`;
  }
  // 例 "12℃" -> "気温12度" / "-3℃" -> "気温マイナス3度"
  const rawText = point.temperature.text;
  let speakable = rawText.replace('℃', '度');
  if (speakable.startsWith('-')) {
    speakable = `マイナス${speakable.slice(1)}`;
  }
  return `${dateStr} ${hour}時、気温${speakable}`;
}
