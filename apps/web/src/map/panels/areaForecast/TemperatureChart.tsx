import { useMemo, type ReactNode } from 'react';
import {
  calculateDateBoundaries,
  calculateLabelPositions,
  calculateTemperatureRange,
  calculateTemperatureY,
  temperatureLinePaths,
  buildTemperatureReaderItems,
  isTemperatureChartWidthValid,
  type TemperatureChartGrid,
} from './temperatureChartModel';

export interface TemperatureChartProps {
  readonly grid: TemperatureChartGrid;
  readonly columnWidths?: readonly string[];
}

/**
 * 詳細ダイアログの気温折れ線グラフ行見出し（Issue #58 §4.5）。
 * 目盛りは描かず、「気温（℃）」の文字のみ。
 */
export function TemperatureChartHeader(): ReactNode {
  return (
    <div className="af-temp-chart-header">
      <span className="af-temp-chart-title">気温（℃）</span>
    </div>
  );
}

/**
 * 詳細ダイアログの気温折れ線グラフ行セル（Issue #58 §4）。
 */
export function TemperatureChart({ grid, columnWidths }: TemperatureChartProps): ReactNode {
  const intervalCount = grid.intervalColumns.length;
  const boundaryCount = grid.boundaryPoints.length;
  // 先頭余白列(1) + 区間列(M) + 末尾余白列(1)
  const totalColumnCount = intervalCount + 2;

  // 読み上げリストの項目一覧
  const readerItems = useMemo(
    () => buildTemperatureReaderItems(grid.boundaryPoints, grid.boundaryMoments),
    [grid.boundaryPoints, grid.boundaryMoments],
  );

  // 列幅の検証（先頭 1.25rem, 区間 4rem, 末尾 2.5rem、Issue #58 §4.3, §5）
  const isWidthValid = useMemo(
    () => isTemperatureChartWidthValid(columnWidths, totalColumnCount),
    [columnWidths, totalColumnCount],
  );

  // 数値配列の抽出（境目 0〜M）
  const temperatureValues = useMemo(
    () =>
      grid.boundaryPoints.map((pt) => {
        if (!pt || pt.kind !== 'value') return null;
        if (pt.temperature.kind !== 'value') return null;
        return pt.temperature.value;
      }),
    [grid.boundaryPoints],
  );

  const range = useMemo(() => calculateTemperatureRange(temperatureValues), [temperatureValues]);

  const getY = useMemo(() => {
    if (!range) return () => 64;
    return (val: number) => calculateTemperatureY(val, range);
  }, [range]);

  const getX = (index: number) => 20 + index * 64;

  const viewBoxWidth = 20 + 64 * intervalCount + 40;
  const svgWidth = `calc(1.25rem + ${intervalCount * 4}rem + 2.5rem)`;

  const linePaths = useMemo(
    () => (range ? temperatureLinePaths(temperatureValues, getX, getY) : []),
    [range, temperatureValues, getY],
  );

  const labels = useMemo(
    () => (range ? calculateLabelPositions(temperatureValues, getY, viewBoxWidth) : []),
    [range, temperatureValues, getY, viewBoxWidth],
  );

  const dateBoundaries = useMemo(
    () => calculateDateBoundaries(grid.boundaryMoments),
    [grid.boundaryMoments],
  );

  // 全境目が欠測（数値0件かつ文字値0件）かどうか判定
  const isAllMissing = useMemo(() => {
    if (range !== null) return false;
    const hasAnyText = grid.boundaryPoints.some((pt) => {
      return pt?.kind === 'value' && pt.temperature.kind === 'value';
    });
    return !hasAnyText;
  }, [range, grid.boundaryPoints]);

  // 列幅が規定と異なる場合はグラフを描かず代替文字表示（Issue #58 §3, §4.3）
  if (!isWidthValid) {
    return (
      <div className="af-temp-chart af-temp-chart-fallback">
        <div className="af-temp-chart-fallback-text">
          {grid.boundaryMoments.map((m, i) => {
            const pt = grid.boundaryPoints[i];
            let text = '対象外';
            if (pt && pt.kind === 'value') {
              text = pt.temperature.kind === 'missing' ? '欠測' : pt.temperature.text;
            }
            return (
              <span key={`fallback-${i}-${m.at}`} className="af-temp-chart-fallback-item">
                {m.label} {text}
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

  return (
    <div className="af-temp-chart">
      <svg
        className="af-temp-chart-svg"
        style={{ inlineSize: svgWidth, blockSize: '8rem' }}
        viewBox={`0 0 ${viewBoxWidth} 128`}
        aria-hidden="true"
      >
        {/* 日付境界の縦線 (Issue #58 §4.3, AC-5) */}
        {dateBoundaries.map((colIdx) => {
          const x = 20 + colIdx * 64;
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

        {/* 点 (circle r=3.5, 中心 x = 20 + 64k) */}
        {labels.map((lbl) => (
          <circle
            key={`circle-${lbl.index}`}
            cx={20 + lbl.index * 64}
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
          grid.boundaryMoments.map((_, i) => {
            if (i >= boundaryCount) return null;
            const pt = grid.boundaryPoints[i];
            if (!pt || pt.kind !== 'value') return null;
            const isMissing = pt.temperature.kind === 'missing';
            const isTextOnly = pt.temperature.kind === 'value' && pt.temperature.value === null;
            if (!isMissing && !isTextOnly) return null;

            const cx = 20 + i * 64;
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
