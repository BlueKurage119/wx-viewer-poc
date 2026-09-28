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

  // AC-4: c1（前列と同日）の上段日付セルは文字を持たない（空文字）ことを直接検証する。
  // data-column-key="c1" を持つ th を抜き出し、開始タグ直後から</th>までのテキストが空であることを確認する。
  const c1Match = firstHeaderRow.match(/<th[^>]*data-column-key="c1"[^>]*>([\s\S]*?)<\/th>/);
  assert.ok(c1Match, 'c1列の上段 th が見つからない');
  assert.equal(c1Match?.[1], '', 'c1列（日付が変わらない列）の上段日付セルは空文字であるべき');

  // 対照: 日付境界の列(c0, c2)は空でないことも確認し、上記の空文字検証が「そもそも何も出ない実装」に
  // 誤って通過しないようにする。
  const c0Match = firstHeaderRow.match(/<th[^>]*data-column-key="c0"[^>]*>([\s\S]*?)<\/th>/);
  const c2Match = firstHeaderRow.match(/<th[^>]*data-column-key="c2"[^>]*>([\s\S]*?)<\/th>/);
  assert.ok(c0Match?.[1], 'c0列（初回列）の上段日付セルは文字を持つべき');
  assert.ok(c2Match?.[1], 'c2列（日付境界）の上段日付セルは文字を持つべき');
});

// AC-24: stickyHeaderを指定しない場合の出力は、追加前(変更前)の出力と完全に同じであることを固定する。
// 変更前実装のスナップショットをここに固定し、リファクタリングの回帰を防ぐ。
test('DetailTimeSeriesTable: stickyHeader省略時の出力は変更前と同じ(固定スナップショット)', () => {
  const html = renderToStaticMarkup(
    el(DetailTimeSeriesTable, { caption: 'サンプル', rowHeaderLabel: '種別', columns, rows }),
  );
  const expected =
    '<div class="detail-ts-scroll" role="region" aria-label="サンプル" tabindex="0">' +
    '<table class="detail-ts-table">' +
    '<caption class="detail-ts-caption">サンプル</caption>' +
    '<thead>' +
    '<tr><th scope="col" class="detail-ts-corner">種別</th>' +
    '<th scope="col" data-column-key="c0" class="detail-ts-date-boundary">9/24(木)</th>' +
    '<th scope="col" data-column-key="c1"></th>' +
    '<th scope="col" data-column-key="c2" class="detail-ts-date-boundary">9/25(金)</th></tr>' +
    '<tr><th scope="col" class="detail-ts-corner"></th>' +
    '<th scope="col" class="detail-ts-date-boundary">0時</th>' +
    '<th scope="col">3時</th>' +
    '<th scope="col" class="detail-ts-date-boundary">0時</th></tr>' +
    '</thead>' +
    '<tbody>' +
    '<tr><th scope="row">大雨</th>' +
    '<td colSpan="1">－</td><td colSpan="1">注意報</td><td colSpan="1">警報</td></tr>' +
    '</tbody>' +
    '</table>' +
    '</div>';
  assert.equal(html, expected);
  assert.doesNotMatch(html, /detail-ts-sticky|detail-ts-head|colgroup/);
});

// AC-24: stickyHeader指定時は、見出しの表と本文の表が別々になり、colgroupの列数・幅指定が一致する。
test('DetailTimeSeriesTable: stickyHeader指定時はcolgroupが見出し・本文で一致する', () => {
  const widthColumns: readonly TimeSeriesColumn[] = [
    { key: 'w0', at: '2026-09-24T00:00:00+09:00', timeLabel: '0-3', width: '5rem' },
    { key: 'w1', at: '2026-09-24T03:00:00+09:00', timeLabel: '3-6' },
  ];
  const widthRows: readonly TimeSeriesRow[] = [
    {
      key: 'row1',
      header: '大雨',
      cells: [
        { key: 'w0', content: 'x' },
        { key: 'w1', content: 'y' },
      ],
    },
  ];
  const html = renderToStaticMarkup(
    el(DetailTimeSeriesTable, {
      caption: 'サンプル2',
      columns: widthColumns,
      rows: widthRows,
      stickyHeader: true,
    }),
  );

  assert.match(html, /class="detail-ts-sticky"/);
  assert.match(html, /class="detail-ts-head"/);

  const extractColgroups = (source: string): readonly string[] => {
    const matches = [...source.matchAll(/<colgroup>([\s\S]*?)<\/colgroup>/g)];
    return matches.map((m) => m[1] ?? '');
  };
  const colgroups = extractColgroups(html);
  assert.equal(colgroups.length, 2, '見出し・本文それぞれにcolgroupがあること');
  assert.equal(colgroups[0], colgroups[1], '見出しと本文のcolgroupが一致すること(列幅がそろう)');
  assert.match(colgroups[0] ?? '', /width:5rem/);

  // 見出し側にはtheadのみ、本文側にはtbodyのみ(表の分離)
  const headTableMatch = html.match(/<div class="detail-ts-head"[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(headTableMatch);
  assert.match(headTableMatch?.[1] ?? '', /<thead>/);
  assert.doesNotMatch(headTableMatch?.[1] ?? '', /<tbody>/);

  const scrollTableMatch = html.match(
    /<div class="detail-ts-scroll"[^>]*>([\s\S]*?)<\/div>\s*<\/div>$/,
  );
  assert.ok(scrollTableMatch);
  assert.match(scrollTableMatch?.[1] ?? '', /<tbody>/);
  assert.doesNotMatch(scrollTableMatch?.[1] ?? '', /<thead>/);
});

// AC-24拡張: bodyDateBoundariesを指定しない場合、tbodyには detail-ts-date-boundary が無い(既存と同じ)。
test('DetailTimeSeriesTable: bodyDateBoundaries省略時はtbodyにdetail-ts-date-boundaryが無い', () => {
  const html = renderToStaticMarkup(
    el(DetailTimeSeriesTable, { caption: 'サンプル', columns, rows }),
  );
  const tbodyHtml = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
  assert.doesNotMatch(tbodyHtml, /detail-ts-date-boundary/);
});

// AC-31: bodyDateBoundaries=true で、境界列(先頭列を除く)のtdだけにdetail-ts-date-boundaryが付く。
test('DetailTimeSeriesTable: bodyDateBoundaries=trueで境界列(先頭列を除く)のtdに縦線クラスが付く', () => {
  const html = renderToStaticMarkup(
    el(DetailTimeSeriesTable, { caption: 'サンプル', columns, rows, bodyDateBoundaries: true }),
  );
  const tbodyHtml = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
  const tds = [...tbodyHtml.matchAll(/<td[^>]*>/g)].map((m) => m[0]);
  assert.equal(tds.length, 3);
  // c0(先頭列、境界だが除外)・c1(境界でない)には付かず、c2(境界)にだけ付く
  assert.doesNotMatch(tds[0] ?? '', /detail-ts-date-boundary/);
  assert.doesNotMatch(tds[1] ?? '', /detail-ts-date-boundary/);
  assert.match(tds[2] ?? '', /detail-ts-date-boundary/);
  // 行見出し・角セルには付かない
  assert.doesNotMatch(tbodyHtml.match(/<th[^>]*>/)?.[0] ?? '', /detail-ts-date-boundary/);
});

// AC-31: stickyHeader併用時も本文の表(tbody)で同じ挙動になる。
test('DetailTimeSeriesTable: stickyHeader併用時もbodyDateBoundariesが本文のtdに付く', () => {
  const html = renderToStaticMarkup(
    el(DetailTimeSeriesTable, {
      caption: 'サンプル',
      columns,
      rows,
      stickyHeader: true,
      bodyDateBoundaries: true,
    }),
  );
  const scrollTableMatch = html.match(
    /<div class="detail-ts-scroll"[^>]*>([\s\S]*?)<\/div>\s*<\/div>$/,
  );
  assert.ok(scrollTableMatch);
  const bodyHtml = scrollTableMatch?.[1] ?? '';
  const tds = [...bodyHtml.matchAll(/<td[^>]*>/g)].map((m) => m[0]);
  assert.equal(tds.length, 3);
  assert.doesNotMatch(tds[0] ?? '', /detail-ts-date-boundary/);
  assert.doesNotMatch(tds[1] ?? '', /detail-ts-date-boundary/);
  assert.match(tds[2] ?? '', /detail-ts-date-boundary/);
});

// AC-31: colSpanのあるセル(区間結合)でも、そのセルが覆う列範囲の先頭が境界列のときだけ付く。
test('DetailTimeSeriesTable: colSpanセルは覆う範囲の先頭列が境界のときだけ縦線が付く', () => {
  const spanColumns: readonly TimeSeriesColumn[] = [
    { key: 's0', at: '2026-09-24T00:00:00+09:00', timeLabel: '0時' },
    { key: 's1', at: '2026-09-24T03:00:00+09:00', timeLabel: '3時' },
    { key: 's2', at: '2026-09-25T00:00:00+09:00', timeLabel: '0時' },
    { key: 's3', at: '2026-09-25T03:00:00+09:00', timeLabel: '3時' },
  ];
  // 1つ目のセルがs0-s1(境界なし)、2つ目がs2-s3(先頭s2が境界)をcolSpan=2で覆う
  const spanRows: readonly TimeSeriesRow[] = [
    {
      key: 'row1',
      header: '天気',
      cells: [
        { key: 'a', span: 2, content: '晴れ' },
        { key: 'b', span: 2, content: 'くもり' },
      ],
    },
  ];
  const html = renderToStaticMarkup(
    el(DetailTimeSeriesTable, {
      caption: 'サンプル',
      columns: spanColumns,
      rows: spanRows,
      bodyDateBoundaries: true,
    }),
  );
  const tbodyHtml = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
  const tds = [...tbodyHtml.matchAll(/<td[^>]*>/g)].map((m) => m[0]);
  assert.equal(tds.length, 2);
  assert.doesNotMatch(tds[0] ?? '', /detail-ts-date-boundary/); // s0(先頭)-s1: 境界なし
  assert.match(tds[1] ?? '', /detail-ts-date-boundary/); // s2(境界)-s3
});
