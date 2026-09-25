/**
 * 詳細ダイアログの時系列表 共通部品 (G10 §5)。
 *
 * 表部分だけ横スクロールし、行見出し列を固定する。列見出しは2段（日付・時刻）。
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { buildDateHeaderLabels, validateRowSpans } from './timeSeriesHeader';

export interface TimeSeriesColumn {
  readonly key: string;
  readonly at: string; // 列の代表時刻 ISO8601（区間なら開始時刻）。日付段の判定に使う
  readonly timeLabel: string; // 下段の表示（例「9時」「9-12時」）
}

export interface TimeSeriesCell {
  readonly key: string;
  readonly span?: number; // 区間結合。既定1
  readonly content: ReactNode; // 空欄・「－」・「—」等の区別は呼び出し側の責務
}

export interface TimeSeriesRow {
  readonly key: string;
  readonly header: ReactNode; // 行見出し（固定列）
  readonly cells: readonly TimeSeriesCell[];
}

export interface DetailTimeSeriesTableProps {
  readonly caption: string; // 視覚的には非表示可（aria用）
  readonly rowHeaderLabel?: string; // 左上角セル
  readonly columns: readonly TimeSeriesColumn[];
  readonly rows: readonly TimeSeriesRow[];
  readonly initialColumnKey?: string; // 初期表示でこの列を行見出しの直右に置く
}

export function DetailTimeSeriesTable({
  caption,
  rowHeaderLabel,
  columns,
  rows,
  initialColumnKey,
}: DetailTimeSeriesTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dateLabels = buildDateHeaderLabels(columns);

  if (import.meta.env?.DEV) {
    for (const key of validateRowSpans(columns, rows)) {
      console.error(`DetailTimeSeriesTable: 行 "${key}" の span 合計が列数と一致しません`);
    }
  }

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    if (!initialColumnKey) {
      scroll.scrollLeft = 0;
      return;
    }
    const target = scroll.querySelector<HTMLElement>(`[data-column-key="${initialColumnKey}"]`);
    const corner = scroll.querySelector<HTMLElement>('.detail-ts-corner');
    if (!target) return;
    scroll.scrollLeft = target.offsetLeft - (corner?.offsetWidth ?? 0);
  }, [initialColumnKey, columns]);

  return (
    <div
      className="detail-ts-scroll"
      role="region"
      aria-label={caption}
      tabIndex={0}
      ref={scrollRef}
    >
      <table className="detail-ts-table">
        <caption className="detail-ts-caption">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="detail-ts-corner">
              {rowHeaderLabel}
            </th>
            {columns.map((column, index) => (
              <th
                key={column.key}
                scope="col"
                data-column-key={column.key}
                className={dateLabels[index] !== null ? 'detail-ts-date-boundary' : undefined}
              >
                {dateLabels[index]}
              </th>
            ))}
          </tr>
          <tr>
            <th scope="col" className="detail-ts-corner" />
            {columns.map((column, index) => (
              <th
                key={column.key}
                scope="col"
                className={dateLabels[index] !== null ? 'detail-ts-date-boundary' : undefined}
              >
                {column.timeLabel}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.header}</th>
              {row.cells.map((cell) => (
                <td key={cell.key} colSpan={cell.span ?? 1}>
                  {cell.content}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
