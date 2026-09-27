/**
 * 警報等時系列パネル・詳細ダイアログの純粋関数群 (G4 #55)。
 *
 * コード表、行・列モデルの組み立て、日単位危険度の3時間列への統合、
 * 切替セルの文字付与、量的予想の表組み立て、備考(付加事項)の結合を行う。
 * JSX・hooksは使わない。設計書 §3.2・§4 を正とする(UI監修反映版)。
 */
import { createElement } from 'react';
import type {
  TimeseriesAddition,
  WarningTimeseriesData,
  WarningTimeseriesResponse,
  WarningTimeseriesTimeDefine,
  WarningTimeseriesValue,
} from '@wx-viewer-poc/shared';
import type { InfoPanelCardInput } from '../panelDefinitions';
import { WarningTimeSeriesContent } from './WarningTimeSeriesContent';

export type RiskDisplay =
  | 'level5'
  | 'level4'
  | 'level3'
  | 'level2'
  | 'below'
  | 'noValue'
  | 'missing'
  /** 延長列(§2.1-33)で、その行に対象範囲外を示すためだけに使う。3時間表の基準範囲には出ない。 */
  | 'outOfRange';

/** 別表4のコード表 (§2.3・§4.3で確認・確定)。名称は別表4と完全一致させる。 */
export const RISK_CODE_TABLE: Readonly<
  Record<string, { readonly name: string; readonly display: RiskDisplay }>
> = Object.freeze({
  '50': Object.freeze({ name: '特別警報級', display: 'level5' as const }),
  '51': Object.freeze({ name: '警戒レベル５相当', display: 'level5' as const }),
  '41': Object.freeze({ name: '警戒レベル４相当', display: 'level4' as const }),
  '30': Object.freeze({ name: '警報級', display: 'level3' as const }),
  '31': Object.freeze({ name: '警戒レベル３相当', display: 'level3' as const }),
  '20': Object.freeze({ name: '注意報級', display: 'level2' as const }),
  '22': Object.freeze({ name: '警戒レベル２相当', display: 'level2' as const }),
  '21': Object.freeze({ name: '警戒レベル２', display: 'level2' as const }),
  '01': Object.freeze({ name: '注意報級未満', display: 'below' as const }),
  '11': Object.freeze({ name: '警戒レベル２未満', display: 'below' as const }),
  '00': Object.freeze({ name: '値なし', display: 'noValue' as const }),
});

/** ref欠落(undefined)・valueCode null・表外コードは missing (§4.3・AC-5) */
export function classifyRiskValue(value: WarningTimeseriesValue | undefined): RiskDisplay {
  if (value === undefined) {
    return 'missing';
  }
  if (value.valueCode === null) {
    return 'missing';
  }
  const entry = RISK_CODE_TABLE[value.valueCode];
  return entry === undefined ? 'missing' : entry.display;
}

/** UI監修により「—」を廃止。値なし・未満はどちらも空白(null)、欠測だけ「?」(§2.1-17)。 */
export type RiskCellLabel = '切迫' | '危険' | '警戒' | '?' | null;

export interface RiskCell {
  readonly display: RiskDisplay;
  readonly label: RiskCellLabel;
  /** 由来の区間(テスト・aria用) */
  readonly sources: readonly { readonly blockId: string; readonly timeId: string }[];
}

export interface WtsColumn {
  readonly key: string;
  readonly timeFrom: string;
  readonly timeTo: string;
  readonly label: string;
}

export interface WtsRow<C> {
  readonly key: string;
  readonly label: string;
  readonly cells: readonly C[];
}

export interface RiskTable {
  readonly baseBlockId: string;
  /** 基準blockの全コマ(パネル・初期列の基準。延長列は含まない) */
  readonly columns: readonly WtsColumn[];
  /** 詳細3時間表だけに足す日単位の延長列(§2.1-33)。パネルには出さない。 */
  readonly extensionColumns: readonly WtsColumn[];
  /** `columns`+`extensionColumns`(詳細の描画に使う全列) */
  readonly detailColumns: readonly WtsColumn[];
  /** パネルの3列窓(§4.2 UI監修 §2.1-13) */
  readonly panelColumns: readonly WtsColumn[];
  /** 詳細用(非表示行を含み、cellsは`detailColumns`の全コマ分) */
  readonly allRows: readonly WtsRow<RiskCell>[];
  /** パネル用(§4.2 行の表示条件。cellsは`panelColumns`分のみ) */
  readonly visibleRows: readonly WtsRow<RiskCell>[];
  /** 詳細の初期スクロール列(従来どおり、パネル窓とは独立) */
  readonly currentColumnKey: string | null;
}

export type DetailCell =
  | {
      readonly kind: 'quantity';
      readonly text: string;
      readonly condition: string | null;
      /** 風向(単独行、統合されない片方のみの区分)の矢印回転角(§4.7)。8語一致時のみ数値、それ以外null。風向以外はundefined */
      readonly windRotation?: number | null;
    }
  | { readonly kind: 'noValue' }
  | { readonly kind: 'missing' }
  /** 延長列(§2.1-33)で、危険度以外の行(量的予想・風向風速)が対象範囲外を示す。 */
  | { readonly kind: 'outOfRange' };

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function jstParts(iso: string): { readonly day: number; readonly hour: number } {
  const ms = Date.parse(iso) + JST_OFFSET_MS;
  const d = new Date(ms);
  return { day: d.getUTCDate(), hour: d.getUTCHours() };
}

/**
 * パネル・詳細3時間表の列下段ラベル。終端0時は24と書く(§4.2)。
 * 「時」は付けない(例「21-24」、§2.1-24)。読み上げ用の「時」はaria-label側で付与する。
 */
export function formatColumnLabel(timeFrom: string, timeTo: string): string {
  const from = jstParts(timeFrom).hour;
  const toHour = jstParts(timeTo).hour;
  const to = toHour === 0 ? 24 : toHour;
  return `${from}-${to}`;
}

/** 別欄の列見出し(§4.4)。「D日」または「D日H時まで」。 */
export function formatIntervalHeader(timeFrom: string, timeTo: string): string {
  const fromMs = Date.parse(timeFrom);
  const toMs = Date.parse(timeTo);
  const DAY_MS = 24 * 60 * 60 * 1000;
  const fromParts = jstParts(timeFrom);

  if (fromParts.hour === 0 && toMs - fromMs === DAY_MS) {
    return `${fromParts.day}日`;
  }

  const toParts = jstParts(timeTo);
  if (toParts.hour === 0) {
    const prevDayParts = jstParts(new Date(toMs - DAY_MS).toISOString());
    return `${prevDayParts.day}日24時まで`;
  }
  return `${toParts.day}日${toParts.hour}時まで`;
}

/**
 * 基準block(§4.2): 危険度の値を含むblockのうち、列の最大長が最小のもの。
 * 同じ長さならtimeDefines上の初出順で先のもの。危険度が0件ならnull。
 */
export function selectBaseBlockId(data: WarningTimeseriesData): string | null {
  const riskBlockIds = new Set<string>();
  for (const value of data.values) {
    if (value.valueCategory === 'risk') {
      riskBlockIds.add(value.blockId);
    }
  }
  if (riskBlockIds.size === 0) {
    return null;
  }

  const firstIndex = new Map<string, number>();
  const maxDuration = new Map<string, number>();
  data.timeDefines.forEach((timeDefine, index) => {
    if (!firstIndex.has(timeDefine.blockId)) {
      firstIndex.set(timeDefine.blockId, index);
    }
    const duration = Date.parse(timeDefine.timeTo) - Date.parse(timeDefine.timeFrom);
    const prev = maxDuration.get(timeDefine.blockId) ?? -Infinity;
    if (duration > prev) {
      maxDuration.set(timeDefine.blockId, duration);
    }
  });

  let best: string | null = null;
  for (const blockId of riskBlockIds) {
    const duration = maxDuration.get(blockId);
    if (duration === undefined) {
      continue;
    }
    if (best === null) {
      best = blockId;
      continue;
    }
    const bestDuration = maxDuration.get(best) as number;
    if (duration < bestDuration) {
      best = blockId;
    } else if (
      duration === bestDuration &&
      (firstIndex.get(blockId) ?? Infinity) < (firstIndex.get(best) ?? Infinity)
    ) {
      best = blockId;
    }
  }
  return best;
}

/** 詳細の初期スクロール列(§4.2「詳細の初期位置」)。従来どおり、パネル窓とは独立。 */
export function resolveCurrentColumnKey(columns: readonly WtsColumn[], now: number): string | null {
  if (columns.length === 0) {
    return null;
  }
  for (const column of columns) {
    const from = Date.parse(column.timeFrom);
    const to = Date.parse(column.timeTo);
    if (from <= now && now < to) {
      return column.key;
    }
  }
  const first = columns[0] as WtsColumn;
  const last = columns[columns.length - 1] as WtsColumn;
  if (now < Date.parse(first.timeFrom)) {
    return first.key;
  }
  return last.key;
}

/**
 * パネルの3列窓(§4.2 UI監修 §2.1-13)。現在列とその先2コマ。
 * 全列未来なら先頭3列、全列過去なら0列、列0件なら0件。過去列で埋め合わせない。
 */
export function selectPanelColumns(
  columns: readonly WtsColumn[],
  now: number,
): readonly WtsColumn[] {
  if (columns.length === 0) {
    return [];
  }
  const currentIndex = columns.findIndex((column) => {
    const from = Date.parse(column.timeFrom);
    const to = Date.parse(column.timeTo);
    return from <= now && now < to;
  });
  if (currentIndex !== -1) {
    return columns.slice(currentIndex, currentIndex + 3);
  }
  const first = columns[0] as WtsColumn;
  if (now < Date.parse(first.timeFrom)) {
    return columns.slice(0, 3);
  }
  return [];
}

/** 優先順位(§4.2 規則4): level5 > level4 > level3 > level2 > missing > below > noValue */
const MERGE_PRIORITY: readonly RiskDisplay[] = [
  'level5',
  'level4',
  'level3',
  'level2',
  'missing',
  'below',
  'noValue',
];

/** 基準列1つに対する他blockの区間の当てはめ(§4.2 規則1〜4)。 */
export function resolveMergedDisplay(
  column: WtsColumn,
  intervals: readonly {
    readonly timeFrom: string;
    readonly timeTo: string;
    readonly display: RiskDisplay;
  }[],
): RiskDisplay {
  const columnFrom = Date.parse(column.timeFrom);
  const columnTo = Date.parse(column.timeTo);
  const overlapping = intervals.filter(
    (interval) =>
      Date.parse(interval.timeFrom) < columnTo && columnFrom < Date.parse(interval.timeTo),
  );
  if (overlapping.length === 0) {
    return 'noValue';
  }
  let best = (overlapping[0] as (typeof overlapping)[number]).display;
  let bestRank = MERGE_PRIORITY.indexOf(best);
  for (const interval of overlapping.slice(1)) {
    const rank = MERGE_PRIORITY.indexOf(interval.display);
    if (rank < bestRank) {
      best = interval.display;
      bestRank = rank;
    }
  }
  return best;
}

const LABEL_TEXT: Readonly<Record<'level3' | 'level4' | 'level5', RiskCellLabel>> = Object.freeze({
  level3: '警戒',
  level4: '危険',
  level5: '切迫',
});

/**
 * 切替セルの文字付与(§4.3)。段階(level3〜5)が直前と異なる最初のセル、
 * および初期列(initialIndex、level3以上のときのみ)に文字を付ける。
 * missingは常に「?」、noValue・belowは常にnull(UI監修 §2.1-17で「—」を廃止)。
 */
export function assignTransitionLabels(
  displays: readonly RiskDisplay[],
  initialIndex: number | null,
): readonly RiskCellLabel[] {
  return displays.map((display, index) => {
    if (display === 'missing') {
      return '?';
    }
    if (display !== 'level3' && display !== 'level4' && display !== 'level5') {
      return null;
    }
    const isTransition = index === 0 || displays[index - 1] !== display;
    const isInitial = initialIndex !== null && index === initialIndex;
    return isTransition || isInitial ? LABEL_TEXT[display] : null;
  });
}

function timeDefineKey(blockId: string, timeId: string): string {
  return `${blockId}::${timeId}`;
}

function riskRowKey(propertyType: string, areaDivision: string | null): string {
  return `${propertyType}::${areaDivision ?? ''}`;
}

function buildRiskRowLabel(propertyType: string, areaDivision: string | null): string {
  const base = propertyType.endsWith('危険度') ? propertyType.slice(0, -3) : propertyType;
  return areaDivision !== null ? `${base}(${areaDivision})` : base;
}

/**
 * 同じ種類(groupKey)の行を、その種類の最初の出現位置にまとめて連続させる(§2.1-16)。
 * まとまりの中の順は各メンバーの元の順(firstIndex)を保つ。見出し行は作らない。
 * 危険度行(groupKey=propertyType)・量的予想行(groupKey=propertyType::valueType)・
 * 詳細の危険度+量的予想の混在マージのいずれにも使える汎用の安定ソート。
 */
function groupConsecutiveByKind<T extends { readonly key: string }>(
  entries: readonly T[],
  groupKeyOf: (entry: T) => string,
  firstIndexOf: (entry: T) => number,
): readonly T[] {
  const groupFirstIndex = new Map<string, number>();
  for (const entry of entries) {
    const groupKey = groupKeyOf(entry);
    const idx = firstIndexOf(entry);
    const prev = groupFirstIndex.get(groupKey);
    if (prev === undefined || idx < prev) {
      groupFirstIndex.set(groupKey, idx);
    }
  }
  return entries
    .map((entry, originalIndex) => ({ entry, originalIndex }))
    .sort((a, b) => {
      const ga = groupFirstIndex.get(groupKeyOf(a.entry)) as number;
      const gb = groupFirstIndex.get(groupKeyOf(b.entry)) as number;
      if (ga !== gb) {
        return ga - gb;
      }
      const fa = firstIndexOf(a.entry);
      const fb = firstIndexOf(b.entry);
      if (fa !== fb) {
        return fa - fb;
      }
      return a.originalIndex - b.originalIndex;
    })
    .map((wrapped) => wrapped.entry);
}

/**
 * 詳細3時間表の延長列(§2.1-33)。基準blockの最終列より後に始まる区間(他blockの日単位区間)を
 * 対象とし、同じ(timeFrom,timeTo)は1列にまとめ、timeFrom昇順に並べる。日付行は既定どおり、
 * 時刻行は空欄(呼び出し側で`label`をそのまま使う想定、ここでは空文字にする)。
 */
export function buildExtensionColumns(
  data: WarningTimeseriesData,
  baseColumns: readonly WtsColumn[],
): readonly WtsColumn[] {
  if (baseColumns.length === 0) {
    return [];
  }
  const lastTimeTo = (baseColumns[baseColumns.length - 1] as WtsColumn).timeTo;
  const lastTimeToMs = Date.parse(lastTimeTo);

  const seen = new Map<string, WtsColumn>();
  for (const timeDefine of data.timeDefines) {
    if (Date.parse(timeDefine.timeFrom) < lastTimeToMs) {
      continue; // 基準期間と重なる区間は3時間列へ複製する対象(§4.2)。延長列には出さない
    }
    const key = `${timeDefine.timeFrom}::${timeDefine.timeTo}`;
    if (!seen.has(key)) {
      seen.set(key, {
        key: `ext::${key}`,
        timeFrom: timeDefine.timeFrom,
        timeTo: timeDefine.timeTo,
        label: '',
      });
    }
  }
  return [...seen.values()].sort((a, b) => Date.parse(a.timeFrom) - Date.parse(b.timeFrom));
}

/** 延長列1つに対する行の値を(timeFrom,timeTo)の完全一致で探す。無ければundefined。 */
function findExtensionValue(
  values: readonly WarningTimeseriesValue[],
  timeDefineMap: ReadonlyMap<string, WarningTimeseriesTimeDefine>,
  column: WtsColumn,
): WarningTimeseriesValue | undefined {
  return values.find((value) => {
    const timeDefine = timeDefineMap.get(timeDefineKey(value.blockId, value.refId));
    return (
      timeDefine !== undefined &&
      timeDefine.timeFrom === column.timeFrom &&
      timeDefine.timeTo === column.timeTo
    );
  });
}

/** 危険度が0件ならnull(§4.1)。 */
export function buildRiskTable(data: WarningTimeseriesData, now: number): RiskTable | null {
  const baseBlockId = selectBaseBlockId(data);
  if (baseBlockId === null) {
    return null;
  }

  const columns: WtsColumn[] = data.timeDefines
    .filter((timeDefine) => timeDefine.blockId === baseBlockId)
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((timeDefine) => ({
      key: timeDefineKey(timeDefine.blockId, timeDefine.timeId),
      timeFrom: timeDefine.timeFrom,
      timeTo: timeDefine.timeTo,
      label: formatColumnLabel(timeDefine.timeFrom, timeDefine.timeTo),
    }));

  const timeDefineMap = new Map<string, WarningTimeseriesTimeDefine>();
  for (const timeDefine of data.timeDefines) {
    timeDefineMap.set(timeDefineKey(timeDefine.blockId, timeDefine.timeId), timeDefine);
  }

  const extensionColumns = buildExtensionColumns(data, columns);

  const rowOrder: string[] = [];
  const rowFirstValueIndex = new Map<string, number>();
  const rowValues = new Map<string, WarningTimeseriesValue[]>();
  const rowMeta = new Map<
    string,
    { readonly propertyType: string; readonly areaDivision: string | null }
  >();
  data.values.forEach((value, valueIndex) => {
    if (value.valueCategory !== 'risk') {
      return;
    }
    const key = riskRowKey(value.propertyType, value.areaDivision);
    if (!rowValues.has(key)) {
      rowOrder.push(key);
      rowValues.set(key, []);
      rowMeta.set(key, { propertyType: value.propertyType, areaDivision: value.areaDivision });
      rowFirstValueIndex.set(key, valueIndex);
    }
    rowValues.get(key)?.push(value);
  });

  // 同じ種類(propertyType)の行を連続配置する(§2.1-16)。
  const orderedRowKeys = groupConsecutiveByKind(
    rowOrder.map((key) => ({ key })),
    (entry) => (rowMeta.get(entry.key) as { readonly propertyType: string }).propertyType,
    (entry) => rowFirstValueIndex.get(entry.key) ?? Number.MAX_SAFE_INTEGER,
  ).map((entry) => entry.key);

  const currentColumnKey = resolveCurrentColumnKey(columns, now);
  const detailInitialIndex =
    currentColumnKey === null ? null : columns.findIndex((c) => c.key === currentColumnKey);

  const panelColumns = selectPanelColumns(columns, now);
  const panelColumnIndices = panelColumns.map((panelColumn) =>
    columns.findIndex((c) => c.key === panelColumn.key),
  );
  const panelInitialIndexInFull =
    panelColumnIndices.length > 0 ? (panelColumnIndices[0] as number) : null;

  const isLevelUpDisplay = (display: RiskDisplay): boolean =>
    display === 'level2' || display === 'level3' || display === 'level4' || display === 'level5';

  const allRows: WtsRow<RiskCell>[] = [];
  const visibleRows: WtsRow<RiskCell>[] = [];

  for (const key of orderedRowKeys) {
    const values = rowValues.has(key) ? (rowValues.get(key) as WarningTimeseriesValue[]) : [];
    const meta = rowMeta.get(key) as {
      readonly propertyType: string;
      readonly areaDivision: string | null;
    };
    const label = buildRiskRowLabel(meta.propertyType, meta.areaDivision);
    const isBaseRow = values.some((value) => value.blockId === baseBlockId);

    let displays: RiskDisplay[];
    let sourcesPerColumn: { readonly blockId: string; readonly timeId: string }[][];

    if (isBaseRow) {
      const byTimeId = new Map<string, WarningTimeseriesValue>();
      for (const value of values) {
        if (value.blockId === baseBlockId) {
          byTimeId.set(value.refId, value);
        }
      }
      displays = columns.map((column) => {
        const timeId = column.key.slice(baseBlockId.length + 2);
        return classifyRiskValue(byTimeId.get(timeId));
      });
      sourcesPerColumn = columns.map((column) => {
        const timeId = column.key.slice(baseBlockId.length + 2);
        return byTimeId.has(timeId) ? [{ blockId: baseBlockId, timeId }] : [];
      });
    } else {
      const intervals = values
        .map((value) => {
          const timeDefine = timeDefineMap.get(timeDefineKey(value.blockId, value.refId));
          if (!timeDefine) {
            return null;
          }
          return {
            timeFrom: timeDefine.timeFrom,
            timeTo: timeDefine.timeTo,
            display: classifyRiskValue(value),
            blockId: value.blockId,
            timeId: value.refId,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

      displays = columns.map((column) => resolveMergedDisplay(column, intervals));
      sourcesPerColumn = columns.map((column) => {
        const columnFrom = Date.parse(column.timeFrom);
        const columnTo = Date.parse(column.timeTo);
        return intervals
          .filter(
            (interval) =>
              Date.parse(interval.timeFrom) < columnTo && columnFrom < Date.parse(interval.timeTo),
          )
          .map((interval) => ({ blockId: interval.blockId, timeId: interval.timeId }));
      });
    }

    // 延長列(§2.1-33): (blockId, refId===timeId)相当の完全一致で結合。無ければoutOfRange。
    const extensionValues = values.filter((value) => value.blockId !== baseBlockId);
    const extensionDisplays: RiskDisplay[] = extensionColumns.map((column) => {
      const match = findExtensionValue(extensionValues, timeDefineMap, column);
      return match === undefined ? 'outOfRange' : classifyRiskValue(match);
    });
    const extensionSources: { readonly blockId: string; readonly timeId: string }[][] =
      extensionColumns.map((column) => {
        const match = findExtensionValue(extensionValues, timeDefineMap, column);
        return match ? [{ blockId: match.blockId, timeId: match.refId }] : [];
      });

    const fullDisplays = [...displays, ...extensionDisplays];
    const fullSourcesPerColumn = [...sourcesPerColumn, ...extensionSources];

    // 詳細(基準+延長列)用のラベル・セル。切替判定は延長列も同じ行の続きとして行う(§2.1-33)。
    const detailLabels = assignTransitionLabels(fullDisplays, detailInitialIndex);
    const detailCells: RiskCell[] = fullDisplays.map((display, index) => ({
      display,
      label: detailLabels[index] ?? null,
      sources: fullSourcesPerColumn[index] ?? [],
    }));
    allRows.push({ key, label, cells: detailCells });

    // パネル(3列窓)用のラベル・セル。全コマに対して計算し、窓の範囲だけ切り出す
    // (2・3列目の切替判定が全期間の直前列と比較されるようにするため)。
    const panelLabels = assignTransitionLabels(displays, panelInitialIndexInFull);
    const panelCells: RiskCell[] = panelColumnIndices.map((columnIndex) => ({
      display: displays[columnIndex] as RiskDisplay,
      label: panelLabels[columnIndex] ?? null,
      sources: sourcesPerColumn[columnIndex] ?? [],
    }));
    if (panelCells.some((cell) => isLevelUpDisplay(cell.display))) {
      visibleRows.push({ key, label, cells: panelCells });
    }
  }

  const detailColumns = [...columns, ...extensionColumns];

  return {
    baseBlockId,
    columns,
    extensionColumns,
    detailColumns,
    panelColumns,
    allRows,
    visibleRows,
    currentColumnKey,
  };
}

function buildQuantityRowKey(
  propertyType: string,
  valueType: string,
  areaDivision: string | null,
): string {
  return `${propertyType}::${valueType}::${areaDivision ?? ''}`;
}

function buildQuantityRowLabel(
  valueType: string,
  areaDivision: string | null,
  unit: string | null,
): string {
  let label = valueType;
  if (areaDivision !== null) {
    label += `(${areaDivision})`;
  }
  if (unit !== null) {
    label += ` ${unit}`;
  }
  return label;
}

/** 方位→矢印回転角(§4.7)。navigationは回転0度で北を指すため、風下(吹いていく方向)＝風向+180°。 */
export const WIND_DIRECTION_ROTATION: Readonly<Record<string, number>> = Object.freeze({
  北: 180,
  北東: 225,
  東: 270,
  南東: 315,
  南: 0,
  南西: 45,
  西: 90,
  北西: 135,
});

/** unit==='８方位漢字'かつ8語と完全一致する場合だけ回転角を返す。それ以外はnull(推測で丸めない、§4.7)。 */
export function classifyWindDirection(valueText: string, unit: string | null): number | null {
  if (unit !== '８方位漢字') {
    return null;
  }
  return WIND_DIRECTION_ROTATION[valueText] ?? null;
}

function buildQuantityCell(value: WarningTimeseriesValue | undefined): DetailCell {
  if (value === undefined) {
    return { kind: 'missing' };
  }
  if (value.condition === '値なし') {
    return { kind: 'noValue' };
  }
  return { kind: 'quantity', text: value.valueText, condition: value.condition };
}

/**
 * 3時間表(基準block)専用の量的予想セル。condition='風雪'の非表示・風向の矢印回転角付与は
 * 3時間表にだけ適用し、別欄・パネルには適用しない(§2.1-28・29)。
 */
function buildBaseQuantityCell(value: WarningTimeseriesValue | undefined): DetailCell {
  if (value === undefined) {
    return { kind: 'missing' };
  }
  if (value.condition === '値なし') {
    return { kind: 'noValue' };
  }
  // condition='風雪'は表示・読み上げに使わない(§2.1-28)
  const condition = value.condition === '風雪' ? null : value.condition;
  if (value.propertyType === '風' && value.valueType === '風向') {
    return {
      kind: 'quantity',
      text: value.valueText,
      condition,
      windRotation: classifyWindDirection(value.valueText, value.unit),
    };
  }
  return { kind: 'quantity', text: value.valueText, condition };
}

/** 詳細: 基準blockの量的予想の行(3時間表に追加、§4.4-(1))。同種の区分行は連続配置(§2.1-16)。 */
export function buildBaseQuantityRows(
  data: WarningTimeseriesData,
  baseBlockId: string,
  extensionColumns: readonly WtsColumn[] = [],
): readonly WtsRow<DetailCell>[] {
  const columns = data.timeDefines
    .filter((timeDefine) => timeDefine.blockId === baseBlockId)
    .slice()
    .sort((a, b) => a.sequence - b.sequence);

  const rowOrder: string[] = [];
  const rowFirstValueIndex = new Map<string, number>();
  const rowValues = new Map<string, WarningTimeseriesValue[]>();
  const rowMeta = new Map<
    string,
    {
      readonly propertyType: string;
      readonly valueType: string;
      readonly areaDivision: string | null;
      readonly unit: string | null;
    }
  >();

  data.values.forEach((value, valueIndex) => {
    if (value.valueCategory !== 'quantity' || value.blockId !== baseBlockId) {
      return;
    }
    const key = buildQuantityRowKey(value.propertyType, value.valueType, value.areaDivision);
    if (!rowValues.has(key)) {
      rowOrder.push(key);
      rowValues.set(key, []);
      rowMeta.set(key, {
        propertyType: value.propertyType,
        valueType: value.valueType,
        areaDivision: value.areaDivision,
        unit: value.unit,
      });
      rowFirstValueIndex.set(key, valueIndex);
    }
    rowValues.get(key)?.push(value);
  });

  const orderedRowKeys = groupConsecutiveByKind(
    rowOrder.map((key) => ({ key })),
    (entry) => {
      const meta = rowMeta.get(entry.key) as {
        readonly propertyType: string;
        readonly valueType: string;
      };
      return `${meta.propertyType}::${meta.valueType}`;
    },
    (entry) => rowFirstValueIndex.get(entry.key) ?? Number.MAX_SAFE_INTEGER,
  ).map((entry) => entry.key);

  return orderedRowKeys.map((key) => {
    const values = rowValues.get(key) as WarningTimeseriesValue[];
    const meta = rowMeta.get(key) as {
      readonly valueType: string;
      readonly areaDivision: string | null;
      readonly unit: string | null;
    };
    const byTimeId = new Map<string, WarningTimeseriesValue>();
    for (const value of values) {
      byTimeId.set(value.refId, value);
    }
    const cells = columns.map((timeDefine) =>
      buildBaseQuantityCell(byTimeId.get(timeDefine.timeId)),
    );
    // 延長列(§2.1-33): 量的予想の行は常に空白(対象範囲外)。日単位の値はここには持たせない。
    const extensionCells: DetailCell[] = extensionColumns.map(() => ({ kind: 'outOfRange' }));
    return {
      key,
      label: buildQuantityRowLabel(meta.valueType, meta.areaDivision, meta.unit),
      cells: [...cells, ...extensionCells],
    };
  });
}

/** 風向の状態(§2.1-31)。8方位=8語一致、方位外=値はあるが8語以外。 */
export type WindDirectionState = 'compass' | 'other' | 'noValue' | 'missing';
export type WindSpeedState = 'value' | 'noValue' | 'missing';

function classifyDirectionState(value: WarningTimeseriesValue | undefined): WindDirectionState {
  if (value === undefined) {
    return 'missing';
  }
  if (value.condition === '値なし') {
    return 'noValue';
  }
  return classifyWindDirection(value.valueText, value.unit) !== null ? 'compass' : 'other';
}

function classifySpeedState(value: WarningTimeseriesValue | undefined): WindSpeedState {
  if (value === undefined) {
    return 'missing';
  }
  if (value.condition === '値なし') {
    return 'noValue';
  }
  return 'value';
}

/** 風向・風速の統合セル(§4.7・§2.1-31)。上段(風向)・下段(風速)を独立に決める2段セル。 */
export interface WindCell {
  readonly directionState: WindDirectionState;
  readonly directionRotation: number | null;
  readonly speedState: WindSpeedState;
  readonly speedText: string | null;
  /** 時間帯を除く読み上げ内容。区分名を含む(表示に区分名が無くても読み上げには残す、§2.1-30)。 */
  readonly ariaLabel: string;
}

/** §4.7・§2.1-31のセル結合。上段・下段を独立に決め、読み上げに区分名を含める。 */
export function buildWindCell(
  directionValue: WarningTimeseriesValue | undefined,
  speedValue: WarningTimeseriesValue | undefined,
  areaDivision: string | null,
): WindCell {
  const directionState = classifyDirectionState(directionValue);
  const directionRotation =
    directionState === 'compass' && directionValue !== undefined
      ? classifyWindDirection(directionValue.valueText, directionValue.unit)
      : null;

  const speedState = classifySpeedState(speedValue);
  const speedText =
    speedState === 'value' && speedValue !== undefined ? speedValue.valueText : null;

  const directionClause =
    directionState === 'missing'
      ? '風向欠測'
      : directionState === 'noValue'
        ? ''
        : `${(directionValue as WarningTimeseriesValue).valueText}の風`;
  const speedClause =
    speedState === 'missing'
      ? '風速欠測'
      : speedState === 'noValue'
        ? ''
        : (() => {
            const unit = (speedValue as WarningTimeseriesValue).unit;
            const unitReading = unit === 'm/s' ? 'メートル毎秒' : (unit ?? '');
            return `${speedText}${unitReading}`;
          })();

  const bothNoValue = directionState === 'noValue' && speedState === 'noValue';
  const contentLabel = bothNoValue
    ? '値なし'
    : [directionClause, speedClause].filter((clause) => clause !== '').join(' ');
  const ariaLabel = areaDivision !== null ? `${areaDivision} ${contentLabel}` : contentLabel;

  return { directionState, directionRotation, speedState, speedText, ariaLabel };
}

/**
 * 統合行の行見出し(§2.1-30)。同じ区分の風危険度行の直下に置ける場合は区分名を付けない
 * (直上の行で区分が分かるため)。対応する危険度行が無く先頭位置に置く場合は区分名を付ける。
 */
export function buildWindRowLabel(
  areaDivision: string | null,
  unit: string | null,
  includeDivision: boolean,
): string {
  let label = '風向・風速';
  if (includeDivision && areaDivision !== null) {
    label += `(${areaDivision})`;
  }
  if (unit !== null) {
    label += ` ${unit}`;
  }
  return label;
}

export interface WindRowEntry {
  readonly key: string;
  readonly areaDivision: string | null;
  readonly unit: string | null;
  readonly cells: readonly WindCell[];
  /** values配列上の最初の出現位置(§2.1-16準拠の並び決定に使う) */
  readonly firstIndex: number;
}

/**
 * 風向・風速の統合行(§4.7)。基準blockの`風`Propertyで、同じareaDivisionに風向・最大風速の
 * 両方があるものだけを1行にまとめる。片方しか無い区分はここに含めない(統合しない)。
 * `extensionColumns`のセルは常に(方位外扱いではなく)値なし相当の空白とする(§2.1-33、量的予想扱い)。
 */
export function buildWindRows(
  data: WarningTimeseriesData,
  baseBlockId: string,
  extensionColumns: readonly WtsColumn[] = [],
): readonly WindRowEntry[] {
  const columns = data.timeDefines
    .filter((timeDefine) => timeDefine.blockId === baseBlockId)
    .slice()
    .sort((a, b) => a.sequence - b.sequence);

  const directionByDivision = new Map<string, Map<string, WarningTimeseriesValue>>();
  const speedByDivision = new Map<string, Map<string, WarningTimeseriesValue>>();
  const speedUnitByDivision = new Map<string, string | null>();
  const divisionOrder: string[] = [];
  const firstIndexByDivision = new Map<string, number>();

  data.values.forEach((value, valueIndex) => {
    if (
      value.valueCategory !== 'quantity' ||
      value.blockId !== baseBlockId ||
      value.propertyType !== '風' ||
      (value.valueType !== '風向' && value.valueType !== '最大風速')
    ) {
      return;
    }
    const divisionKey = value.areaDivision ?? '';
    if (!divisionOrder.includes(divisionKey)) {
      divisionOrder.push(divisionKey);
      firstIndexByDivision.set(divisionKey, valueIndex);
    }
    if (value.valueType === '風向') {
      if (!directionByDivision.has(divisionKey)) {
        directionByDivision.set(divisionKey, new Map());
      }
      directionByDivision.get(divisionKey)?.set(value.refId, value);
    } else {
      if (!speedByDivision.has(divisionKey)) {
        speedByDivision.set(divisionKey, new Map());
      }
      speedByDivision.get(divisionKey)?.set(value.refId, value);
      speedUnitByDivision.set(divisionKey, value.unit);
    }
  });

  const rows: WindRowEntry[] = [];
  for (const divisionKey of divisionOrder) {
    const directionMap = directionByDivision.get(divisionKey);
    const speedMap = speedByDivision.get(divisionKey);
    if (!directionMap || !speedMap) {
      continue; // 片方しか無い区分は統合しない
    }
    const areaDivision = divisionKey === '' ? null : divisionKey;
    const unit = speedUnitByDivision.get(divisionKey) ?? null;
    const cells = columns.map((column) =>
      buildWindCell(directionMap.get(column.timeId), speedMap.get(column.timeId), areaDivision),
    );
    // 延長列(§2.1-33): 風向・風速は量的予想と同様に対象範囲外として空白にする(欠測「?」にしない)。
    const extensionCells: WindCell[] = extensionColumns.map(() => ({
      directionState: 'noValue',
      directionRotation: null,
      speedState: 'noValue',
      speedText: null,
      ariaLabel: '対象期間外',
    }));
    rows.push({
      key: `風::${divisionKey}`,
      areaDivision,
      unit,
      cells: [...cells, ...extensionCells],
      firstIndex: firstIndexByDivision.get(divisionKey) as number,
    });
  }
  return rows;
}

/** 詳細「別欄」: 基準以外のblockの量的予想をblockごとの表で返す(§4.4-(2))。同種の区分行は連続配置。 */
export function buildSeparateQuantityTables(
  data: WarningTimeseriesData,
  baseBlockId: string | null,
): readonly {
  readonly blockId: string;
  readonly columns: readonly WtsColumn[];
  readonly rows: readonly WtsRow<DetailCell>[];
}[] {
  const blockOrder: string[] = [];
  for (const value of data.values) {
    if (value.valueCategory !== 'quantity' || value.blockId === baseBlockId) {
      continue;
    }
    if (!blockOrder.includes(value.blockId)) {
      blockOrder.push(value.blockId);
    }
  }

  return blockOrder.map((blockId) => {
    const timeDefines = data.timeDefines
      .filter((timeDefine) => timeDefine.blockId === blockId)
      .slice()
      .sort((a, b) => a.sequence - b.sequence);
    const columns: WtsColumn[] = timeDefines.map((timeDefine) => ({
      key: timeDefineKey(timeDefine.blockId, timeDefine.timeId),
      timeFrom: timeDefine.timeFrom,
      timeTo: timeDefine.timeTo,
      label: formatIntervalHeader(timeDefine.timeFrom, timeDefine.timeTo),
    }));

    const rowOrder: string[] = [];
    const rowFirstValueIndex = new Map<string, number>();
    const rowValues = new Map<string, WarningTimeseriesValue[]>();
    const rowMeta = new Map<
      string,
      {
        readonly propertyType: string;
        readonly valueType: string;
        readonly areaDivision: string | null;
        readonly unit: string | null;
      }
    >();
    data.values.forEach((value, valueIndex) => {
      if (value.valueCategory !== 'quantity' || value.blockId !== blockId) {
        return;
      }
      const key = buildQuantityRowKey(value.propertyType, value.valueType, value.areaDivision);
      if (!rowValues.has(key)) {
        rowOrder.push(key);
        rowValues.set(key, []);
        rowMeta.set(key, {
          propertyType: value.propertyType,
          valueType: value.valueType,
          areaDivision: value.areaDivision,
          unit: value.unit,
        });
        rowFirstValueIndex.set(key, valueIndex);
      }
      rowValues.get(key)?.push(value);
    });

    const orderedRowKeys = groupConsecutiveByKind(
      rowOrder.map((key) => ({ key })),
      (entry) => {
        const meta = rowMeta.get(entry.key) as {
          readonly propertyType: string;
          readonly valueType: string;
        };
        return `${meta.propertyType}::${meta.valueType}`;
      },
      (entry) => rowFirstValueIndex.get(entry.key) ?? Number.MAX_SAFE_INTEGER,
    ).map((entry) => entry.key);

    const rows = orderedRowKeys.map((key) => {
      const values = rowValues.get(key) as WarningTimeseriesValue[];
      const meta = rowMeta.get(key) as {
        readonly valueType: string;
        readonly areaDivision: string | null;
        readonly unit: string | null;
      };
      const byTimeId = new Map<string, WarningTimeseriesValue>();
      for (const value of values) {
        byTimeId.set(value.refId, value);
      }
      const cells = timeDefines.map((timeDefine) =>
        buildQuantityCell(byTimeId.get(timeDefine.timeId)),
      );
      return {
        key,
        label: buildQuantityRowLabel(meta.valueType, meta.areaDivision, meta.unit),
        cells,
      };
    });

    return { blockId, columns, rows };
  });
}

/** additions比較用の並び順(電文の出現順に相当。blockIdは照合に使わないため考慮しない、§4.4)。 */
function compareAdditionOrder(a: TimeseriesAddition, b: TimeseriesAddition): number {
  const cmp = (x: number | null, y: number | null): number => (x ?? -1) - (y ?? -1);
  return (
    cmp(a.scope.kindIndex, b.scope.kindIndex) ||
    cmp(a.scope.propertyIndex, b.scope.propertyIndex) ||
    cmp(a.scope.partIndex, b.scope.partIndex) ||
    cmp(a.scope.baseIndex, b.scope.baseIndex) ||
    cmp(a.scope.localIndex, b.scope.localIndex) ||
    cmp(a.additionIndex, b.additionIndex) ||
    cmp(a.noteIndex, b.noteIndex)
  );
}

/**
 * 備考(§4.4)。rowKeyは3時間表の行キー。対応行の無いNoteは捨てる。additions===nullならnull。
 * 備考列は常時表示(byRowが空でも列は出す)。
 */
export interface RemarkSubjectRow {
  readonly key: string;
  readonly propertyType: string;
  readonly areaDivision: string | null;
  /**
   * この行が属するblock(量的予想の行にだけ設定する)。危険度の行はnull/省略にする。
   * 危険度のNoteはblockIdを照合に使わない(日単位blockの危険度も3時間表へ統合済みのため)が、
   * 量的予想のNoteは同じblockId(時間区切り)の行にだけ載せる(3時間表以外のblockのNoteは
   * 3時間表の行に載せない、5a6141c設計改訂)。
   */
  readonly blockId?: string | null;
}

export function buildRemarks(
  additions: readonly TimeseriesAddition[] | null,
  rows: readonly RemarkSubjectRow[],
): { readonly byRow: ReadonlyMap<string, string> } | null {
  if (additions === null) {
    return null;
  }

  const sorted = [...additions].sort(compareAdditionOrder);
  const textsByRow = new Map<string, string[]>();

  for (const note of sorted) {
    const isBaseNote = note.scope.localIndex === null;
    let targetRows: readonly RemarkSubjectRow[];
    if (isBaseNote) {
      const withoutDivision = rows.filter(
        (row) => row.propertyType === note.propertyType && row.areaDivision === null,
      );
      targetRows =
        withoutDivision.length > 0
          ? withoutDivision
          : rows.filter((row) => row.propertyType === note.propertyType);
    } else {
      targetRows = rows.filter(
        (row) => row.propertyType === note.propertyType && row.areaDivision === note.areaDivision,
      );
    }
    // 量的予想の行(blockIdを持つ行)は、同じblockIdのNoteにだけ載せる。危険度の行は照合しない。
    targetRows = targetRows.filter(
      (row) => row.blockId === undefined || row.blockId === null || row.blockId === note.blockId,
    );
    for (const row of targetRows) {
      if (!textsByRow.has(row.key)) {
        textsByRow.set(row.key, []);
      }
      textsByRow.get(row.key)?.push(note.text);
    }
  }

  const byRow = new Map<string, string>();
  for (const [key, texts] of textsByRow) {
    byRow.set(key, texts.join('、'));
  }
  return { byRow };
}

/**
 * 応答からカード入力を組み立てる (§4.1)。
 * `data===null`・`issuedAt===null` は failed。それ以外は必ず data 状態(常時パネル)。
 */
export function buildWarningTimeSeriesCard(
  response: WarningTimeseriesResponse,
  availability: 'available' | 'stale',
  now: number,
): InfoPanelCardInput {
  if (response.data === null) {
    return { key: 'warningTimeSeries', status: { kind: 'failed' } };
  }
  if (response.metadata.issuedAt === null) {
    return { key: 'warningTimeSeries', status: { kind: 'failed' } };
  }

  const table = buildRiskTable(response.data, now);

  return {
    key: 'warningTimeSeries',
    status: {
      kind: 'data',
      availability,
      time: response.metadata.issuedAt,
      timeKind: 'issued',
    },
    content: createElement(WarningTimeSeriesContent, { response, table }),
  };
}

/**
 * パネル本文のメッセージ文言(§4.1・UI監修)。テストでは createPortal(DetailDialog) を
 * 経由せずこの純粋関数で状態分岐を検証する(SSRがportal未対応のため)。
 */
export function resolveWarningTimeSeriesPanelMessage(table: RiskTable | null): string | null {
  if (table === null) {
    return '危険度の情報がありません';
  }
  if (table.columns.length === 0) {
    return '危険度の情報がありません';
  }
  if (table.panelColumns.length === 0) {
    return '最新の予想時間帯がありません';
  }
  if (table.visibleRows.length === 0) {
    return '注意が必要な時間帯はありません';
  }
  return null;
}
