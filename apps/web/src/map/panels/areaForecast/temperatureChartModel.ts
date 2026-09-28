import { amedasPlotRange } from '../amedas/amedasModel';
import { formatFullJstDate } from '../../detail/timeSeriesHeader';
import {
  toJstHour,
  type AreaForecastColumn,
  type IntervalCell,
  type PointCell,
} from './areaForecastModel';

export interface LabelPlacement {
  readonly index: number;
  readonly value: number;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly position: 'top' | 'bottom';
}

export interface TemperatureChartGrid {
  readonly intervalColumns: readonly AreaForecastColumn[];
  readonly boundaryPoints: readonly (PointCell | undefined)[];
  readonly boundaryMoments: readonly { readonly at: string; readonly label: string }[];
  readonly endBoundaryAt: string;
  readonly endBoundaryLabel: string;
  readonly droppedLastColumn: boolean;
}

/**
 * 詳細ダイアログ用の区間列・境目ポイント・境界グリッドを構築する（Issue #58 §3.2, §3.3, AC-3）。
 * 最終の気温だけの列（時刻が直前区間の終了時刻に等しい列）は詳細の列から除き、境目 M の点とする。
 */
export function buildTemperatureChartGrid(
  columns: readonly AreaForecastColumn[],
  intervals: readonly IntervalCell[],
  points: readonly PointCell[],
): TemperatureChartGrid {
  if (columns.length === 0) {
    return {
      intervalColumns: [],
      boundaryPoints: [],
      boundaryMoments: [],
      endBoundaryAt: '',
      endBoundaryLabel: '',
      droppedLastColumn: false,
    };
  }

  const lastColIndex = columns.length - 1;
  const lastCol = columns[lastColIndex]!;

  // 直前区間の終了時刻を判定
  let prevIntervalEndTime: string | null = null;
  for (const int of intervals) {
    if (int.kind === 'value') {
      if (int.startIndex + int.span === lastColIndex) {
        prevIntervalEndTime = int.timeTo;
      }
    }
  }

  // lastCol 自体が有効な区間を持つか
  const lastHasInterval = intervals.some(
    (int) =>
      int.kind === 'value' &&
      int.startIndex <= lastColIndex &&
      lastColIndex < int.startIndex + int.span,
  );

  const shouldDrop =
    lastColIndex > 0 &&
    !lastHasInterval &&
    prevIntervalEndTime !== null &&
    lastCol.at === prevIntervalEndTime;

  if (shouldDrop) {
    const intervalColumns = columns.slice(0, lastColIndex);
    const boundaryPoints: (PointCell | undefined)[] = [];
    const boundaryMoments: { at: string; label: string }[] = [];

    for (let i = 0; i <= lastColIndex; i++) {
      boundaryPoints.push(points[i]);
      const col = columns[i]!;
      boundaryMoments.push({ at: col.at, label: col.label });
    }

    return {
      intervalColumns,
      boundaryPoints,
      boundaryMoments,
      endBoundaryAt: lastCol.at,
      endBoundaryLabel: lastCol.label,
      droppedLastColumn: true,
    };
  }

  // 最終列を除去しない場合（または最後の区間の終了時刻に気温がない場合）
  let lastTimeTo: string = lastCol.at;
  for (const int of intervals) {
    if (int.kind === 'value') {
      if (int.startIndex + int.span === columns.length) {
        lastTimeTo = int.timeTo;
      }
    }
  }

  const intervalColumns = [...columns];
  const boundaryPoints: (PointCell | undefined)[] = [...points, undefined];
  const boundaryMoments: { at: string; label: string }[] = columns.map((col) => ({
    at: col.at,
    label: col.label,
  }));
  const endLabel = `${toJstHour(lastTimeTo)}時`;
  boundaryMoments.push({ at: lastTimeTo, label: endLabel });

  return {
    intervalColumns,
    boundaryPoints,
    boundaryMoments,
    endBoundaryAt: lastTimeTo,
    endBoundaryLabel: endLabel,
    droppedLastColumn: false,
  };
}

/**
 * 気温のプロット範囲を計算する（Issue #58 §4.2）。
 * 数値の点だけで amedasPlotRange(values, true) を呼ぶ。
 * 0℃固定下限にせず、余白は max(幅×15%, 0.5℃)、同値は ±0.5℃、数値0件は null。
 */
export function calculateTemperatureRange(
  values: readonly (number | null)[],
): { low: number; high: number } | null {
  const finiteValues = values.filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
  if (finiteValues.length === 0) return null;
  return amedasPlotRange(finiteValues, true);
}

/**
 * 気温値から SVG y 座標を計算する（Issue #58 §4.3）。
 * 描画域: y = 30〜98。
 * y = 98 - (value - low) / (high - low) * 68
 */
export function calculateTemperatureY(value: number, range: { low: number; high: number }): number {
  const span = range.high - range.low;
  if (span <= 0) return 64;
  const ratio = (value - range.low) / span;
  return 98 - ratio * 68;
}

/**
 * 折れ線の SVG パス文字列群を計算する（Issue #58 §4.2, AC-3）。
 * 数値でない列（null）で線を切り、補間しない。
 * 2点以上連続する区間のみパスを作り、1点のみでは線0本。
 */
export function temperatureLinePaths(
  values: readonly (number | null)[],
  getX: (index: number) => number,
  getY: (value: number) => number,
): string[] {
  const paths: string[] = [];
  let currentPath = '';
  let segmentPointCount = 0;

  for (let i = 0; i < values.length; i++) {
    const val = values[i];
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      if (segmentPointCount >= 2 && currentPath) {
        paths.push(currentPath);
      }
      currentPath = '';
      segmentPointCount = 0;
      continue;
    }

    const px = getX(i);
    const py = getY(val);
    if (segmentPointCount === 0) {
      currentPath = `M ${px} ${py}`;
    } else {
      currentPath += ` L ${px} ${py}`;
    }
    segmentPointCount++;
  }

  if (segmentPointCount >= 2 && currentPath) {
    paths.push(currentPath);
  }

  return paths;
}

function getTopOverlap(yEnd: number, yPoint: number): number {
  if (yEnd >= yPoint - 5) return 0;
  return yPoint - 5 - Math.max(yEnd, yPoint - 18);
}

function getBottomOverlap(yEnd: number, yPoint: number): number {
  if (yEnd <= yPoint + 6) return 0;
  return Math.min(yEnd, yPoint + 19) - (yPoint + 6);
}

/**
 * 数値ラベルの上下配置と座標を計算する（Issue #58 §4.4, AC-3）。
 * 点の上（ベースライン y = 点y - 8）を既定とする。
 * ラベル左右端（中心 ±16）における隣接線分の y を求め、
 * 上側矩形（点y-18〜点y-5）と交差し、下側矩形（点y+6〜点y+19）と交差しないとき下（点y + 17）。
 * 両方交差する場合は上。
 * 境目0・M のラベルは x を [半幅, SVG幅 - 半幅] に丸めて SVG 外へのはみ出しを防ぐ。
 */
export function calculateLabelPositions(
  values: readonly (number | null)[],
  getY: (value: number) => number,
  viewBoxWidth: number,
): readonly LabelPlacement[] {
  const placements: LabelPlacement[] = [];

  for (let i = 0; i < values.length; i++) {
    const val = values[i];
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      continue;
    }

    const pointX = 20 + i * 64;
    const pointY = getY(val);

    const hasLeft = i > 0 && values[i - 1] !== null && Number.isFinite(values[i - 1]);
    const hasRight =
      i < values.length - 1 && values[i + 1] !== null && Number.isFinite(values[i + 1]);

    let topLeftOverlap = 0;
    let bottomLeftOverlap = 0;
    if (hasLeft) {
      const yPrev = getY(values[i - 1]!);
      // x = x_i - 16 における左側隣接線分の y
      const yLeft = pointY - (pointY - yPrev) * (16 / 64);
      topLeftOverlap = getTopOverlap(yLeft, pointY);
      bottomLeftOverlap = getBottomOverlap(yLeft, pointY);
    }

    let topRightOverlap = 0;
    let bottomRightOverlap = 0;
    if (hasRight) {
      const yNext = getY(values[i + 1]!);
      // x = x_i + 16 における右側隣接線分の y
      const yRight = pointY + (yNext - pointY) * (16 / 64);
      topRightOverlap = getTopOverlap(yRight, pointY);
      bottomRightOverlap = getBottomOverlap(yRight, pointY);
    }

    const topOverlap = topLeftOverlap + topRightOverlap;
    const bottomOverlap = bottomLeftOverlap + bottomRightOverlap;

    const intersectsTop = topOverlap > 0;
    const intersectsBottom = bottomOverlap > 0;

    let position: 'top' | 'bottom' = 'top';
    if (intersectsTop && !intersectsBottom) {
      position = 'bottom';
    } else {
      position = 'top';
    }

    const labelY = position === 'top' ? pointY - 8 : pointY + 17;

    const text = `${val}`;
    const halfWidth = (text.length * 7) / 2;
    const labelX =
      viewBoxWidth >= halfWidth * 2
        ? Math.max(halfWidth, Math.min(viewBoxWidth - halfWidth, pointX))
        : viewBoxWidth / 2;

    placements.push({
      index: i,
      value: val,
      text,
      x: labelX,
      y: labelY,
      position,
    });
  }

  return placements;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * JST日付が変わる境目インデックスを計算する（Issue #58 §3.2, §4.3, AC-5）。
 * 先頭境目（index 0）は除き、日付が変わる境目の x = 20 + 64 * k に縦線を描く。
 */
export function calculateDateBoundaries(moments: readonly { readonly at: string }[]): number[] {
  const boundaries: number[] = [];
  let previousKey: string | null = null;

  for (let i = 0; i < moments.length; i++) {
    const at = moments[i]!.at;
    const jstMs = new Date(at).getTime() + JST_OFFSET_MS;
    const jst = new Date(jstMs);
    const key = `${jst.getUTCFullYear()}-${jst.getUTCMonth() + 1}-${jst.getUTCDate()}`;
    if (i > 0 && key !== previousKey) {
      boundaries.push(i);
    }
    previousKey = key;
  }

  return boundaries;
}

/**
 * 読み上げリストの1項目を生成する（Issue #58 §4.7, AC-10）。
 * 対象外は null。
 * 数値: 「年月日(曜) N時、気温N度」 / 負値: 「…、気温マイナスN度」
 * 欠測: 「年月日(曜) N時、気温欠測」
 * 文字値: 「年月日(曜) N時、気温 原文」
 */
export function formatTemperatureReaderItem(
  point: PointCell | undefined,
  moment: { readonly at: string },
): string | null {
  if (!point || point.kind === 'none') {
    return null;
  }

  const dateStr = formatFullJstDate(moment.at);
  const hour = toJstHour(moment.at);
  const prefix = `${dateStr} ${hour}時`;

  if (point.temperature.kind === 'missing') {
    return `${prefix}、気温欠測`;
  }

  const { value, text } = point.temperature;
  if (value !== null && Number.isFinite(value)) {
    let speakable = `${value}`;
    if (speakable.startsWith('-')) {
      speakable = `マイナス${speakable.slice(1)}`;
    }
    return `${prefix}、気温${speakable}度`;
  }

  return `${prefix}、気温 ${text}`;
}

/**
 * 視覚的に隠した読み上げリストの全項目を生成する（Issue #58 §4.7, AC-10）。
 * 境目 0〜M の各境目について項目を生成する。
 */
export function buildTemperatureReaderItems(
  points: readonly (PointCell | undefined)[],
  moments: readonly { readonly at: string }[],
): readonly string[] {
  const items: string[] = [];
  const count = Math.min(points.length, moments.length);
  for (let i = 0; i < count; i++) {
    const item = formatTemperatureReaderItem(points[i], moments[i]!);
    if (item !== null) {
      items.push(item);
    }
  }
  return items;
}

/**
 * 列幅の検査（Issue #58 §4.3, §5）。
 * 先頭余白列 1.25rem・区間列すべて 4rem・末尾余白列 2.5rem 以外の幅があれば false。
 */
export function isTemperatureChartWidthValid(
  columnWidths: readonly string[] | undefined,
  expectedCount: number,
): boolean {
  if (!columnWidths || columnWidths.length === 0) return true;
  if (columnWidths.length !== expectedCount) return false;
  if (expectedCount < 2) return false;

  if (columnWidths[0] !== '1.25rem') return false;
  if (columnWidths[columnWidths.length - 1] !== '2.5rem') return false;

  for (let i = 1; i < columnWidths.length - 1; i++) {
    if (columnWidths[i] !== '4rem') return false;
  }
  return true;
}
