/**
 * 詳細ダイアログの時系列表 共通部品 (G10 §5、G4 #55 §4.6でオプトインの吸着見出しを追加)。
 *
 * 既定(`stickyHeader` 省略・false): 表部分だけ横スクロールし、行見出し列を固定する。
 * 列見出しは2段（日付・時刻）。この場合の出力・挙動は追加前と完全に同じ(AC-24)。
 *
 * `stickyHeader: true`: 見出し(日付・時刻の2段)と本文(データ行)を別々の `<table>` に分け、
 * 同じ `<colgroup>` を共有して列幅をそろえ、本文の横スクロールに見出し側を追従させる。
 * これにより見出しをダイアログ本文のスクロール領域の上端に吸着させられる(CSS側は
 * `.detail-ts-sticky`/`.detail-ts-head` を使う。§4.6参照)。
 * オプトイン時は見出しの表と本文の表が分かれるため、列見出しとセルの表上の関連付けが
 * 失われる。呼び出し側はセルの `aria-label` に時間帯を含めること。
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { buildDateHeaderLabels, validateRowSpans } from './timeSeriesHeader';

export interface TimeSeriesColumn {
  readonly key: string;
  readonly at: string; // 列の代表時刻 ISO8601（区間なら開始時刻）。日付段の判定に使う
  readonly timeLabel: string; // 下段の表示（例「9時」「9-12時」）
  /** 列幅(任意)。指定が無ければ `--detail-ts-column-width`(既定4rem)。stickyHeader時のcolgroupに使う */
  readonly width?: string;
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
  /** true: 見出しをダイアログ本文の上端に吸着させる(§4.6)。既定false(既存の挙動を維持)。 */
  readonly stickyHeader?: boolean;
  /**
   * true: 日付境界(先頭列を除く)にあたる列のtbody側のtdにも`detail-ts-date-boundary`を付け、
   * 見出しから本文まで縦線を通す(§4.6.2)。既定false(既存の挙動を維持、AC-24)。
   */
  readonly bodyDateBoundaries?: boolean;
}

const ROW_HEADER_WIDTH = 'var(--detail-ts-row-header-width, 7rem)';

function columnWidth(column: TimeSeriesColumn): string {
  return column.width ?? 'var(--detail-ts-column-width, 4rem)';
}

/** stickyHeader時の表幅。見出し・本文の両表に同じ列幅合計を明示し、内容や容器幅による伸縮で列がずれないようにする */
function stickyTableWidth(columns: readonly TimeSeriesColumn[]): string {
  return `calc(${[ROW_HEADER_WIDTH, ...columns.map(columnWidth)].join(' + ')})`;
}

function ColGroup({ columns }: { readonly columns: readonly TimeSeriesColumn[] }) {
  return (
    <colgroup>
      <col style={{ width: ROW_HEADER_WIDTH }} />
      {columns.map((column) => (
        <col key={column.key} style={{ width: columnWidth(column) }} />
      ))}
    </colgroup>
  );
}

function HeaderRows({
  columns,
  rowHeaderLabel,
  dateLabels,
}: {
  readonly columns: readonly TimeSeriesColumn[];
  readonly rowHeaderLabel?: string;
  readonly dateLabels: readonly (string | null)[];
}) {
  return (
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
  );
}

function BodyRows({
  rows,
  dateBoundaryColumnIndices,
}: {
  readonly rows: readonly TimeSeriesRow[];
  /** 日付境界にあたる列のインデックス(0始まり、先頭列は含まない)。undefinedなら付けない(既定挙動、AC-24) */
  readonly dateBoundaryColumnIndices?: ReadonlySet<number>;
}) {
  return (
    <tbody>
      {rows.map((row) => {
        let columnIndex = 0;
        return (
          <tr key={row.key}>
            <th scope="row">{row.header}</th>
            {row.cells.map((cell) => {
              const span = cell.span ?? 1;
              const isBoundary = dateBoundaryColumnIndices?.has(columnIndex) ?? false;
              const td = (
                <td
                  key={cell.key}
                  colSpan={span}
                  className={isBoundary ? 'detail-ts-date-boundary' : undefined}
                >
                  {cell.content}
                </td>
              );
              columnIndex += span;
              return td;
            })}
          </tr>
        );
      })}
    </tbody>
  );
}

export function DetailTimeSeriesTable({
  caption,
  rowHeaderLabel,
  columns,
  rows,
  initialColumnKey,
  stickyHeader = false,
  bodyDateBoundaries = false,
}: DetailTimeSeriesTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const dateLabels = buildDateHeaderLabels(columns);
  // 先頭列は行見出し列の右境界と二重になるため除く(§4.6.2)。
  const dateBoundaryColumnIndices = bodyDateBoundaries
    ? new Set(
        dateLabels
          .map((label, index) => (index > 0 && label !== null ? index : -1))
          .filter((index) => index !== -1),
      )
    : undefined;

  if (import.meta.env?.DEV) {
    for (const key of validateRowSpans(columns, rows)) {
      console.error(`DetailTimeSeriesTable: 行 "${key}" の span 合計が列数と一致しません`);
    }
  }

  useEffect(() => {
    const body = scrollRef.current;
    if (!body) return;
    // stickyHeaderのときは見出し側(head)を基準に計算する(本文と同じcolgroupで列幅が一致するため)。
    const referenceContainer = stickyHeader ? headRef.current : body;
    if (!initialColumnKey) {
      body.scrollLeft = 0;
      if (headRef.current) headRef.current.scrollLeft = 0;
      return;
    }
    if (!referenceContainer) return;
    const target = referenceContainer.querySelector<HTMLElement>(
      `[data-column-key="${initialColumnKey}"]`,
    );
    const corner = referenceContainer.querySelector<HTMLElement>('.detail-ts-corner');
    if (!target) return;
    const scrollLeft = target.offsetLeft - (corner?.offsetWidth ?? 0);
    body.scrollLeft = scrollLeft;
    if (headRef.current) headRef.current.scrollLeft = scrollLeft;
  }, [initialColumnKey, columns, stickyHeader]);

  if (!stickyHeader) {
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
          <HeaderRows columns={columns} rowHeaderLabel={rowHeaderLabel} dateLabels={dateLabels} />
          <BodyRows rows={rows} dateBoundaryColumnIndices={dateBoundaryColumnIndices} />
        </table>
      </div>
    );
  }

  return (
    <div className="detail-ts-sticky">
      <div className="detail-ts-head" ref={headRef}>
        <table className="detail-ts-table" style={{ width: stickyTableWidth(columns) }}>
          <ColGroup columns={columns} />
          <HeaderRows columns={columns} rowHeaderLabel={rowHeaderLabel} dateLabels={dateLabels} />
        </table>
      </div>
      <div
        className="detail-ts-scroll"
        role="region"
        aria-label={caption}
        tabIndex={0}
        ref={scrollRef}
        onScroll={() => {
          if (headRef.current && scrollRef.current) {
            headRef.current.scrollLeft = scrollRef.current.scrollLeft;
          }
        }}
      >
        <table className="detail-ts-table" style={{ width: stickyTableWidth(columns) }}>
          <caption className="detail-ts-caption">{caption}</caption>
          <ColGroup columns={columns} />
          <BodyRows rows={rows} dateBoundaryColumnIndices={dateBoundaryColumnIndices} />
        </table>
      </div>
    </div>
  );
}
