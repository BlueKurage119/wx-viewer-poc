import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDateHeaderLabels, validateRowSpans } from '../src/map/detail/timeSeriesHeader.ts';
import type { TimeSeriesColumn, TimeSeriesRow } from '../src/map/detail/DetailTimeSeriesTable.tsx';

function column(key: string, at: string, timeLabel = '0時'): TimeSeriesColumn {
  return { key, at, timeLabel };
}

// AC-2: (a) 先頭列は常に日付 (b) 同日の後続列は null (c) JST日付境界 (d) 表記が 9/24(木) 形式
test('buildDateHeaderLabels: 先頭列は常に日付、同日の後続列は null', () => {
  const columns = [
    column('c0', '2026-09-24T00:00:00+09:00'),
    column('c1', '2026-09-24T03:00:00+09:00'),
    column('c2', '2026-09-24T06:00:00+09:00'),
  ];
  assert.deepEqual(buildDateHeaderLabels(columns), ['9/24(木)', null, null]);
});

test('buildDateHeaderLabels: JST 23時台→翌0時台の境界で日付が出る（UTC同日でもJSTで日付が変わる）', () => {
  const columns = [
    column('c0', '2026-09-23T14:00:00Z'), // JST 2026-09-23 23:00
    column('c1', '2026-09-23T15:00:00Z'), // JST 2026-09-24 00:00
  ];
  assert.deepEqual(buildDateHeaderLabels(columns), ['9/23(水)', '9/24(木)']);
});

test('buildDateHeaderLabels: 表記が M/D(曜) 形式でゼロ埋めしない', () => {
  const columns = [column('c0', '2026-01-05T00:00:00+09:00')];
  assert.deepEqual(buildDateHeaderLabels(columns), ['1/5(月)']);
});

// AC-2: validateRowSpans が span 合計の過不足を検出する
test('validateRowSpans: span 合計が列数と一致しない行の key を返す', () => {
  const columns = [
    column('c0', '2026-09-24T00:00:00+09:00'),
    column('c1', '2026-09-24T03:00:00+09:00'),
  ];
  const rows: readonly TimeSeriesRow[] = [
    {
      key: 'ok',
      header: 'ok',
      cells: [
        { key: 'a', content: 'x' },
        { key: 'b', content: 'y' },
      ],
    },
    { key: 'tooFew', header: 'tooFew', cells: [{ key: 'a', span: 1, content: 'x' }] },
    { key: 'tooMany', header: 'tooMany', cells: [{ key: 'a', span: 3, content: 'x' }] },
    { key: 'spanned-ok', header: 'spanned-ok', cells: [{ key: 'a', span: 2, content: 'x' }] },
  ];
  assert.deepEqual(validateRowSpans(columns, rows), ['tooFew', 'tooMany']);
});
