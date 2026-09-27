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
  'level5' | 'level4' | 'level3' | 'level2' | 'below' | 'noValue' | 'missing';

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
  /** 全コマ(詳細で使う) */
  readonly columns: readonly WtsColumn[];
  /** パネルの3列窓(§4.2 UI監修 §2.1-13) */
  readonly panelColumns: readonly WtsColumn[];
  /** 詳細用(非表示行を含み、cellsは`columns`の全コマ分) */
  readonly allRows: readonly WtsRow<RiskCell>[];
  /** パネル用(§4.2 行の表示条件。cellsは`panelColumns`分のみ) */
  readonly visibleRows: readonly WtsRow<RiskCell>[];
  /** 詳細の初期スクロール列(従来どおり、パネル窓とは独立) */
  readonly currentColumnKey: string | null;
}

export type DetailCell =
  | { readonly kind: 'quantity'; readonly text: string; readonly condition: string | null }
  | { readonly kind: 'noValue' }
  | { readonly kind: 'missing' };

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

    // 詳細(全コマ)用のラベル・セル
    const detailLabels = assignTransitionLabels(displays, detailInitialIndex);
    const detailCells: RiskCell[] = displays.map((display, index) => ({
      display,
      label: detailLabels[index] ?? null,
      sources: sourcesPerColumn[index] ?? [],
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

  return { baseBlockId, columns, panelColumns, allRows, visibleRows, currentColumnKey };
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

function buildQuantityCell(value: WarningTimeseriesValue | undefined): DetailCell {
  if (value === undefined) {
    return { kind: 'missing' };
  }
  if (value.condition === '値なし') {
    return { kind: 'noValue' };
  }
  return { kind: 'quantity', text: value.valueText, condition: value.condition };
}

/** 詳細: 基準blockの量的予想の行(3時間表に追加、§4.4-(1))。同種の区分行は連続配置(§2.1-16)。 */
export function buildBaseQuantityRows(
  data: WarningTimeseriesData,
  baseBlockId: string,
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
    const cells = columns.map((timeDefine) => buildQuantityCell(byTimeId.get(timeDefine.timeId)));
    return {
      key,
      label: buildQuantityRowLabel(meta.valueType, meta.areaDivision, meta.unit),
      cells,
    };
  });
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
export function buildRemarks(
  additions: readonly TimeseriesAddition[] | null,
  rows: readonly {
    readonly key: string;
    readonly propertyType: string;
    readonly areaDivision: string | null;
  }[],
): { readonly byRow: ReadonlyMap<string, string> } | null {
  if (additions === null) {
    return null;
  }

  const sorted = [...additions].sort(compareAdditionOrder);
  const textsByRow = new Map<string, string[]>();

  for (const note of sorted) {
    const isBaseNote = note.scope.localIndex === null;
    let targetRows: readonly {
      readonly key: string;
      readonly propertyType: string;
      readonly areaDivision: string | null;
    }[];
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
