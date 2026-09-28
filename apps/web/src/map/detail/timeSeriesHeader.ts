/**
 * 詳細ダイアログ時系列表の列見出し・行検証 (G10 §5.1)。
 */
import type { TimeSeriesColumn, TimeSeriesRow } from './DetailTimeSeriesTable';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAY_KANJI = ['日', '月', '火', '水', '木', '金', '土'];

function toJstDateParts(iso: string): {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly weekday: number;
} {
  const jstMs = new Date(iso).getTime() + JST_OFFSET_MS;
  const jst = new Date(jstMs);
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    day: jst.getUTCDate(),
    weekday: jst.getUTCDay(),
  };
}

/** 上段（日付）の表示。日付が前列と変わる列と先頭列だけ文字列、他は null */
export function buildDateHeaderLabels(
  columns: readonly TimeSeriesColumn[],
): readonly (string | null)[] {
  let previousKey: string | null = null;
  return columns.map((column) => {
    const parts = toJstDateParts(column.at);
    const key = `${parts.year}-${parts.month}-${parts.day}`;
    if (key === previousKey) {
      return null;
    }
    previousKey = key;
    return `${parts.month}/${parts.day}(${WEEKDAY_KANJI[parts.weekday]})`;
  });
}

/** 縦結合・横結合を考慮したデータ列配置。行見出し列は含めない。 */
export interface PlacedTimeSeriesCell {
  readonly cell: TimeSeriesRow['cells'][number];
  readonly columnIndex: number;
}
export interface TimeSeriesLayout {
  readonly rows: readonly (readonly PlacedTimeSeriesCell[])[];
  readonly invalidRowKeys: readonly string[];
}
export function layoutTimeSeriesRows(
  columns: readonly TimeSeriesColumn[],
  rows: readonly TimeSeriesRow[],
): TimeSeriesLayout {
  const occupiedUntil = Array<number>(columns.length).fill(0);
  const invalidRowKeys: string[] = [];
  const placedRows = rows.map((row, rowIndex) => {
    const used = occupiedUntil.map((until) => until > rowIndex);
    const placed: PlacedTimeSeriesCell[] = [];
    let cursor = 0;
    let invalid = false;
    for (const cell of row.cells) {
      const span = cell.span ?? 1;
      const rowSpan = cell.rowSpan ?? 1;
      if (
        !Number.isInteger(span) ||
        span < 1 ||
        !Number.isInteger(rowSpan) ||
        rowSpan < 1 ||
        rowIndex + rowSpan > rows.length
      ) {
        invalid = true;
        continue;
      }
      while (cursor < columns.length && used[cursor]) cursor += 1;
      if (cursor + span > columns.length || used.slice(cursor, cursor + span).some(Boolean)) {
        invalid = true;
        continue;
      }
      placed.push({ cell, columnIndex: cursor });
      for (let index = cursor; index < cursor + span; index += 1) {
        used[index] = true;
        occupiedUntil[index] = rowIndex + rowSpan;
      }
      cursor += span;
    }
    if (invalid || used.some((value) => !value)) invalidRowKeys.push(row.key);
    return placed;
  });
  return { rows: placedRows, invalidRowKeys };
}

/** 占有列の重複・不足、最終行を越す結合を持つ行の key を返す。 */
export function validateRowSpans(
  columns: readonly TimeSeriesColumn[],
  rows: readonly TimeSeriesRow[],
): readonly string[] {
  return layoutTimeSeriesRows(columns, rows).invalidRowKeys;
}
