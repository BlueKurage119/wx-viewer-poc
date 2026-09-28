import { amedasPlotRange } from '../amedas/amedasModel';
import { formatFullJstDate } from '../../detail/timeSeriesHeader';
import { toJstHour, type AreaForecastColumn, type PointCell } from './areaForecastModel';

export interface LabelPlacement {
  readonly index: number;
  readonly value: number;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly position: 'top' | 'bottom';
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
 * 両方交差する場合は上（交差の小さい方）。
 */
export function calculateLabelPositions(
  values: readonly (number | null)[],
  getY: (value: number) => number,
): readonly LabelPlacement[] {
  const placements: LabelPlacement[] = [];

  for (let i = 0; i < values.length; i++) {
    const val = values[i];
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      continue;
    }

    const pointX = i * 64 + 32;
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
    } else if (intersectsTop && intersectsBottom) {
      position = bottomOverlap < topOverlap ? 'bottom' : 'top';
    } else {
      position = 'top';
    }

    const labelY = position === 'top' ? pointY - 8 : pointY + 17;

    placements.push({
      index: i,
      value: val,
      text: `${val}`,
      x: pointX,
      y: labelY,
      position,
    });
  }

  return placements;
}

/**
 * 目盛り数値を計算する（Issue #58 §4.5）。
 * range の中の整数のうち、刻み {1, 2, 5, 10}℃ から目盛りが2〜4本になる最小の刻みの倍数。
 * 範囲が狭く2〜4本が無い場合は1〜4本になる刻み。
 */
export function calculateTicks(range: { low: number; high: number } | null): number[] {
  if (!range) return [];
  const steps = [1, 2, 5, 10] as const;

  const getTicksForStep = (step: number): number[] => {
    const first = Math.ceil(range.low / step) * step;
    const last = Math.floor(range.high / step) * step;
    if (first > last) return [];
    const ticks: number[] = [];
    for (let val = first; val <= last + step * 0.001; val += step) {
      const rounded = Math.round(val / step) * step;
      ticks.push(rounded === 0 ? 0 : rounded);
    }
    return ticks;
  };

  // 1) 2〜4本になる最小の刻み
  for (const step of steps) {
    const ticks = getTicksForStep(step);
    if (ticks.length >= 2 && ticks.length <= 4) {
      return ticks;
    }
  }

  // 2) 1〜4本になる最小の刻み
  for (const step of steps) {
    const ticks = getTicksForStep(step);
    if (ticks.length >= 1 && ticks.length <= 4) {
      return ticks;
    }
  }

  return getTicksForStep(10);
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * JST日付が変わる列インデックスを計算する（Issue #58 §3, §4.3, AC-5）。
 * 先頭列（index 0）は除き、日付が変わる列の左端 x = i * 64 に縦線を描く。
 */
export function calculateDateBoundaries(columns: readonly { at: string }[]): number[] {
  const boundaries: number[] = [];
  let previousKey: string | null = null;

  for (let i = 0; i < columns.length; i++) {
    const at = columns[i]!.at;
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
  column: AreaForecastColumn,
): string | null {
  if (!point || point.kind === 'none') {
    return null;
  }

  const dateStr = formatFullJstDate(column.at);
  const hour = toJstHour(column.at);
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
 */
export function buildTemperatureReaderItems(
  points: readonly PointCell[],
  columns: readonly AreaForecastColumn[],
): readonly string[] {
  const items: string[] = [];
  for (let i = 0; i < columns.length; i++) {
    const item = formatTemperatureReaderItem(points[i], columns[i]!);
    if (item !== null) {
      items.push(item);
    }
  }
  return items;
}
