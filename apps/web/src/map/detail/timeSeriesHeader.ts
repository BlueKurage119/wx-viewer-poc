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

/**
 * 各行の cells の span 合計が列数と一致するか検証する（純粋関数）。
 * 一致しない行の key を返す。表示側（呼び出し元）が開発ビルドで console.error する。
 */
export function validateRowSpans(
  columns: readonly TimeSeriesColumn[],
  rows: readonly TimeSeriesRow[],
): readonly string[] {
  return rows
    .filter((row) => row.cells.reduce((sum, cell) => sum + (cell.span ?? 1), 0) !== columns.length)
    .map((row) => row.key);
}
