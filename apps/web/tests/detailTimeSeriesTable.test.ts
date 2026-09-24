import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof React }).React = React;

import { DetailTimeSeriesTable } from '../src/map/detail/DetailTimeSeriesTable.tsx';
import type { TimeSeriesColumn, TimeSeriesRow } from '../src/map/detail/DetailTimeSeriesTable.tsx';

const el = React.createElement;

const columns: readonly TimeSeriesColumn[] = [
  { key: 'c0', at: '2026-09-24T00:00:00+09:00', timeLabel: '0時' },
  { key: 'c1', at: '2026-09-24T03:00:00+09:00', timeLabel: '3時' },
  { key: 'c2', at: '2026-09-25T00:00:00+09:00', timeLabel: '0時' },
];
const rows: readonly TimeSeriesRow[] = [
  {
    key: 'row1',
    header: '大雨',
    cells: [
      { key: 'c0', content: '－' },
      { key: 'c1', content: '注意報' },
      { key: 'c2', content: '警報' },
    ],
  },
];

// AC-4: 上段の日付セルは日付境界の列にだけ文字を持ち、行見出しが th scope="row"、
// 横スクロール div が role="region" と tabindex="0" を持つ
test('DetailTimeSeriesTable: 日付セル・行見出し・横スクロール領域の属性', () => {
  const html = renderToStaticMarkup(
    el(DetailTimeSeriesTable, { caption: 'サンプル', columns, rows }),
  );

  assert.match(html, /role="region"/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /scope="row"/);
  assert.match(html, /9\/24\(木\)/);
  assert.match(html, /9\/25\(金\)/);

  // 中間列(c1)は同日のため上段が空 (日付文字列を持たない)
  const theadStart = html.indexOf('<thead');
  const theadEnd = html.indexOf('</thead>');
  const theadHtml = html.slice(theadStart, theadEnd);
  const firstRowEnd = theadHtml.indexOf('</tr>');
  const firstHeaderRow = theadHtml.slice(0, firstRowEnd);
  // 3列とも th 要素が出力される（colspan結合しない）
  assert.equal((firstHeaderRow.match(/<th[ >]/g) ?? []).length, 4); // 角セル + 3列（"<thead"の誤マッチを除外）
});
