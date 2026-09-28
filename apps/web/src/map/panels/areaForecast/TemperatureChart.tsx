import { useMemo, type ReactNode } from 'react';
import type { AreaForecastColumn, PointCell } from './areaForecastModel';
import {
  calculateDateBoundaries,
  calculateLabelPositions,
  calculateTemperatureRange,
  calculateTemperatureY,
  calculateTicks,
  temperatureLinePaths,
  buildTemperatureReaderItems,
} from './temperatureChart';

export interface TemperatureChartProps {
  readonly points: readonly PointCell[];
  readonly columns: readonly AreaForecastColumn[];
  readonly columnWidths?: readonly string[];
}

/**
 * 詳細ダイアログの気温折れ線グラフ行見出し（目盛り数値付き、Issue #58 §4.5）。
 */
export function TemperatureChartHeader({
  range,
}: {
  readonly range: { low: number; high: number } | null;
}): ReactNode {
  const ticks = useMemo(() => calculateTicks(range), [range]);

  return (
    <div className="af-temp-chart-header">
      <span className="af-temp-chart-title">気温（℃）</span>
      {range &&
        ticks.map((tick) => {
          const y = calculateTemperatureY(tick, range);
          const topPercent = (y / 128) * 100;
          return (
            <span
              key={tick}
              className="af-temp-chart-tick"
              style={{ top: `${topPercent}%` }}
              aria-hidden="true"
            >
              {tick}
            </span>
          );
        })}
    </div>
  );
}

/**
 * 詳細ダイアログの気温折れ線グラフ行セル（Issue #58 §4）。
 */
export function TemperatureChart({
  points,
  columns,
  columnWidths,
}: TemperatureChartProps): ReactNode {
  const columnCount = columns.length;

  // 読み上げリストの項目一覧
  const readerItems = useMemo(
    () => buildTemperatureReaderItems(points, columns),
    [points, columns],
  );

  // 全列が '4rem' であるかの検証（Issue #58 §3, §5）
  const isWidthValid = useMemo(() => {
    if (!columnWidths || columnWidths.length === 0) return true;
    return columnWidths.every((width) => width === '4rem');
  }, [columnWidths]);

  // 数値配列の抽出
  const temperatureValues = useMemo(
    () =>
      columns.map((_, i) => {
        const pt = points[i];
        if (!pt || pt.kind !== 'value') return null;
        if (pt.temperature.kind !== 'value') return null;
        return pt.temperature.value;
      }),
    [points, columns],
  );

  const range = useMemo(() => calculateTemperatureRange(temperatureValues), [temperatureValues]);

  const getY = useMemo(() => {
    if (!range) return () => 64;
    return (val: number) => calculateTemperatureY(val, range);
  }, [range]);

  const getX = (index: number) => index * 64 + 32;

  const linePaths = useMemo(
    () => (range ? temperatureLinePaths(temperatureValues, getX, getY) : []),
    [range, temperatureValues, getY],
  );

  const labels = useMemo(
    () => (range ? calculateLabelPositions(temperatureValues, getY) : []),
    [range, temperatureValues, getY],
  );

  const ticks = useMemo(() => calculateTicks(range), [range]);

  const dateBoundaries = useMemo(() => calculateDateBoundaries(columns), [columns]);

  // 全列が欠測（数値0件かつ文字値0件）かどうか判定
  const isAllMissing = useMemo(() => {
    if (range !== null) return false;
    // 数値0件のとき、文字値が1点でもあるか判定
    const hasAnyText = columns.some((_, i) => {
      const pt = points[i];
      return pt?.kind === 'value' && pt.temperature.kind === 'value';
    });
    return !hasAnyText;
  }, [range, points, columns]);

  // 列幅が 4rem 以外を含む場合はグラフを描かず代替文字表示（Issue #58 §3）
  if (!isWidthValid) {
    return (
      <div className="af-temp-chart af-temp-chart-fallback">
        <div className="af-temp-chart-fallback-text">
          {columns.map((col, i) => {
            const pt = points[i];
            let text = '対象外';
            if (pt && pt.kind === 'value') {
              text = pt.temperature.kind === 'missing' ? '欠測' : pt.temperature.text;
            }
            return (
              <span key={col.key} className="af-temp-chart-fallback-item">
                {col.label} {text}
              </span>
            );
          })}
        </div>
        <ul className="af-visually-hidden">
          {readerItems.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>
      </div>
    );
  }

  const svgWidth = `${columnCount * 4}rem`;
  const viewBoxWidth = columnCount * 64;

  return (
    <div className="af-temp-chart">
      <svg
        className="af-temp-chart-svg"
        style={{ inlineSize: svgWidth, blockSize: '8rem' }}
        viewBox={`0 0 ${viewBoxWidth} 128`}
        aria-hidden="true"
      >
        {/* 日付境界の縦線 */}
        {dateBoundaries.map((colIdx) => {
          const x = colIdx * 64;
          return (
            <line
              key={`date-boundary-${colIdx}`}
              x1={x}
              y1={0}
              x2={x}
              y2={128}
              stroke="var(--md-sys-color-outline-variant)"
              strokeWidth={1}
            />
          );
        })}

        {/* 水平補助線（目盛り位置） */}
        {range &&
          ticks.map((tick) => {
            const y = calculateTemperatureY(tick, range);
            return (
              <line
                key={`tick-line-${tick}`}
                x1={0}
                y1={y}
                x2={viewBoxWidth}
                y2={y}
                stroke="var(--md-sys-color-outline-variant)"
                strokeWidth={1}
              />
            );
          })}

        {/* 折れ線 */}
        {linePaths.map((p, idx) => (
          <path
            key={`line-${idx}`}
            d={p}
            fill="none"
            stroke="var(--md-sys-color-primary)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}

        {/* 点 (circle r=3.5) */}
        {labels.map((lbl) => (
          <circle
            key={`circle-${lbl.index}`}
            cx={lbl.x}
            cy={getY(lbl.value)}
            r={3.5}
            fill="var(--md-sys-color-primary)"
          />
        ))}

        {/* 数値ラベル */}
        {labels.map((lbl) => (
          <text
            key={`label-${lbl.index}`}
            x={lbl.x}
            y={lbl.y}
            className="af-temp-chart-label"
            textAnchor="middle"
            fill="var(--md-sys-color-on-surface)"
            fontSize={12}
            fontFamily="inherit"
          >
            {lbl.text}
          </text>
        ))}

        {/* 欠測・文字値のみの「?」表示（全欠測でない場合） */}
        {!isAllMissing &&
          columns.map((_, i) => {
            const pt = points[i];
            if (!pt || pt.kind !== 'value') return null;
            const isMissing = pt.temperature.kind === 'missing';
            const isTextOnly = pt.temperature.kind === 'value' && pt.temperature.value === null;
            if (!isMissing && !isTextOnly) return null;

            const cx = getX(i);
            return (
              <text
                key={`question-${i}`}
                x={cx}
                y={64}
                className="af-temp-chart-question"
                textAnchor="middle"
                dominantBaseline="central"
                fill="var(--md-sys-color-on-surface-variant)"
                fontSize={12}
              >
                ?
              </text>
            );
          })}

        {/* 全欠測の場合の中央「気温の予想なし」 */}
        {isAllMissing && (
          <text
            x={viewBoxWidth / 2}
            y={64}
            className="af-temp-chart-empty"
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--md-sys-color-on-surface-variant)"
            fontSize={13}
          >
            気温の予想なし
          </text>
        )}
      </svg>

      {/* 視覚的に隠した読み上げリスト（Issue #58 §4.7, AC-10） */}
      <ul className="af-visually-hidden">
        {readerItems.map((item, idx) => (
          <li key={idx}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export { calculateTemperatureRange } from './temperatureChart';
