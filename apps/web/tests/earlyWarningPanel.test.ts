import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EarlyWarningResponse, EarlyWarningData, WeatherDataset } from '@wx-viewer-poc/shared';
import {
  buildDetailTable,
  buildPanelTable,
  selectPanelColumns,
  buildTable,
  classify,
  columnsFor,
} from '../src/map/panels/earlyWarning/earlyWarningModel.ts';
import { NearPanel } from '../src/map/panels/earlyWarning/EarlyWarningContent.tsx';
import { InfoPanelFrame } from '../src/map/panels/InfoPanelFrame.tsx';
import { formatIssuedTimes } from '../src/map/panels/earlyWarning/issuedTimes.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function segment(
  kind: 'near' | 'far',
  issuedAt: string | null,
  dates: readonly [string, string, string][],
  cells: EarlyWarningData['cells'],
  availability: 'available' | 'stale' | 'unavailable' = 'available',
): WeatherDataset<EarlyWarningData> {
  return {
    area: { code: '130010', name: '東京地方' },
    metadata: {
      source: 'jma',
      issuedAt,
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: null,
      lastSuccessAt: null,
      availability,
      sourceVersion: null,
    },
    data: {
      segment: kind,
      telegramType: kind === 'near' ? 'VPFD61' : 'VPFW60',
      timeDefines: dates.map(([timeId, timeFrom, timeTo], sequence) => ({
        timeId,
        timeFrom,
        timeTo,
        sequence,
        duration: null,
      })),
      cells,
    },
  };
}
function response(
  near: WeatherDataset<EarlyWarningData>,
  far: WeatherDataset<EarlyWarningData>,
): EarlyWarningResponse {
  return {
    terminalId: 'east',
    venueId: 'east',
    controlStatus: 'normal',
    isTraining: false,
    evaluatedAt: '2026-09-28T00:00:00Z',
    near,
    far,
  };
}
const nearDate: [string, string, string] = ['1', '2026-09-29T15:00:00Z', '2026-09-30T15:00:00Z'];
const farOld: [string, string, string] = ['1', '2026-09-29T15:00:00Z', '2026-09-30T15:00:00Z'];
const farNew: [string, string, string] = ['2', '2026-09-30T15:00:00Z', '2026-10-01T15:00:00Z'];
const rain = (
  refId: string,
  phenomenonCode: string,
  rankValue: string | null,
  condition: string | null = null,
) => ({ refId, phenomenonCode, phenomenonName: phenomenonCode, rankValue, condition });

test('JST境界、逆順の定義、系列間の同一IDを独立して扱う', () => {
  const data = response(
    segment('near', '2026-09-27T16:00:00Z', [nearDate], [rain('1', '大雨の警報級の可能性', '高')]),
    segment(
      'far',
      '2026-09-27T16:00:00Z',
      [farNew, farOld],
      [rain('1', '雨の警報級の可能性', '中'), rain('2', '雨の警報級の可能性', 'なし')],
    ),
  );
  assert.deepEqual(
    columnsFor(data, 'far').map((column) => column.timeId),
    ['2'],
  );
  const detail = buildDetailTable(data);
  assert.deepEqual(
    detail.columns.map((column) => `${column.segment}:${column.timeId}`),
    ['near:1', 'far:2'],
  );
  assert.deepEqual(
    detail.rows.slice(0, 2).map((row) => [row.label, ...row.cells]),
    [
      ['大雨', 'high', 'none'],
      ['土砂災害', 'outOfRange', 'none'],
    ],
  );
  assert.equal(detail.rainJoined, true);
});

test('異なる発表日でも遠距離の境界を独立算出し、重複区間を除く', () => {
  const data = response(
    segment('near', '2026-09-27T16:00:00Z', [farNew], [rain('2', '雪の警報級の可能性', '中')]),
    segment(
      'far',
      '2026-09-26T16:00:00Z',
      [farOld, farNew],
      [rain('1', '雨の警報級の可能性', '高'), rain('2', '雨の警報級の可能性', '中')],
    ),
  );
  assert.deepEqual(
    buildDetailTable(data).columns.map((column) => `${column.segment}:${column.timeId}`),
    ['far:1', 'near:2'],
  );
});

test('値なし、なし、欠測、対象外を区別し、未知現象も保持する', () => {
  const data = response(
    segment(
      'near',
      null,
      [nearDate],
      [
        rain('1', '大雨の警報級の可能性', 'なし'),
        rain('1', '雪の警報級の可能性', null, '値なし'),
        rain('1', '未知の可能性', '高'),
      ],
    ),
    segment('far', null, [], []),
  );
  assert.deepEqual(
    buildTable(data, 'near').rows.map((row) => [row.label, row.cells[0]]),
    [
      ['大雨', 'none'],
      ['大雪', 'noValue'],
      ['未知の可能性', 'high'],
    ],
  );
  assert.equal(classify(undefined), 'missing');
  assert.equal(classify(rain('1', '大雨', null, '欠測')), 'missing');
  assert.equal(
    formatIssuedTimes({ near: { kind: 'unknown' }, far: { kind: 'unavailable' } }),
    '明後日まで: 発表時刻不明 · 明々後日以降: 未取得',
  );
});

test('雪の「なし」は値として残し、Kind不在は行を省き、既存Kindの参照欠落だけ欠測にする', () => {
  const first: [string, string, string] = [
    'snow-1',
    '2026-09-28T15:00:00Z',
    '2026-09-29T15:00:00Z',
  ];
  const second: [string, string, string] = [
    'snow-2',
    '2026-09-29T15:00:00Z',
    '2026-09-30T15:00:00Z',
  ];
  const data = response(
    segment(
      'near',
      '2026-09-28T00:00:00Z',
      [first, second],
      [
        rain('snow-1', '雪の警報級の可能性', 'なし'),
        rain('snow-2', '雪の警報級の可能性', '中'),
        rain('snow-1', '大雨の警報級の可能性', '高'),
      ],
    ),
    segment('far', '2026-09-28T00:00:00Z', [], []),
  );
  const rows = buildTable(data, 'near').rows;
  assert.deepEqual(
    rows.map((row) => [row.label, ...row.cells]),
    [
      ['大雨', 'high', 'missing'],
      ['大雪', 'none', 'medium'],
    ],
  );
  assert.deepEqual(
    buildDetailTable(data).rows.map((row) => row.label),
    ['大雨', '大雪'],
  );
});

test('近距離パネルは現在から最大3コマ、時刻境界・未来・過去だけを区別する', () => {
  const columns = [
    ['a', '2026-09-28T00:00:00Z', '2026-09-28T03:00:00Z'],
    ['b', '2026-09-28T03:00:00Z', '2026-09-28T06:00:00Z'],
    ['c', '2026-09-28T06:00:00Z', '2026-09-28T09:00:00Z'],
    ['d', '2026-09-28T09:00:00Z', '2026-09-28T12:00:00Z'],
  ] as const;
  const data = response(
    segment('near', '2026-09-28T00:00:00Z', columns, [rain('b', '大雨の警報級の可能性', '高')]),
    segment('far', '2026-09-28T00:00:00Z', [], []),
  );
  const all = columnsFor(data, 'near');
  assert.deepEqual(
    selectPanelColumns(all, Date.parse('2026-09-28T02:59:59Z')).map((c) => c.timeId),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    selectPanelColumns(all, Date.parse('2026-09-28T03:00:00Z')).map((c) => c.timeId),
    ['b', 'c', 'd'],
  );
  assert.deepEqual(
    selectPanelColumns(all, Date.parse('2026-09-27T00:00:00Z')).map((c) => c.timeId),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    selectPanelColumns(all, Date.parse('2026-09-28T11:00:00Z')).map((c) => c.timeId),
    ['d'],
  );
  assert.deepEqual(selectPanelColumns(all, Date.parse('2026-09-29T00:00:00Z')), []);
});

test('パネルの行抽出は選択窓内の高・中だけで、詳細は全期間と遠距離を保つ', () => {
  const dates = [
    ['a', '2026-09-28T00:00:00Z', '2026-09-28T03:00:00Z'],
    ['b', '2026-09-28T03:00:00Z', '2026-09-28T06:00:00Z'],
    ['c', '2026-09-28T06:00:00Z', '2026-09-28T09:00:00Z'],
    ['d', '2026-09-28T09:00:00Z', '2026-09-28T12:00:00Z'],
  ] as const;
  const data = response(
    segment('near', '2026-09-28T00:00:00Z', dates, [
      rain('a', '大雨の警報級の可能性', 'なし'),
      rain('b', '大雨の警報級の可能性', '高'),
      rain('c', '大雨の警報級の可能性', '中'),
      rain('a', '雪の警報級の可能性', 'なし'),
      rain('b', '雪の警報級の可能性', 'なし'),
      rain('c', '雪の警報級の可能性', 'なし'),
      rain('d', '雪の警報級の可能性', '高'),
      rain('a', '風（風雪）の警報級の可能性', null, '値なし'),
      rain('b', '波の警報級の可能性', '中'),
    ]),
    segment('far', '2026-09-28T00:00:00Z', [farNew], [rain('2', '雨の警報級の可能性', '高')]),
  );
  const panel = buildPanelTable(data, Date.parse('2026-09-28T01:00:00Z'));
  assert.deepEqual(
    panel.columns.map((column) => column.timeId),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    panel.rows.map((row) => [row.label, ...row.cells]),
    [
      ['大雨', 'none', 'high', 'medium'],
      ['波浪', 'missing', 'medium', 'missing'],
    ],
  );
  assert.deepEqual(
    buildDetailTable(data).rows.map((row) => row.label),
    ['大雨', '土砂災害', '大雪', '暴風（雪）', '波浪'],
  );
  assert.equal(buildDetailTable(data).columns.length, 5);
  const empty = buildPanelTable(data, Date.parse('2026-09-28T11:00:00Z'));
  assert.deepEqual(
    empty.columns.map((column) => column.timeId),
    ['d'],
  );
  assert.deepEqual(
    empty.rows.map((row) => row.label),
    ['大雪'],
  );
});

test('パネル本文の空状態と見出しは近距離だけを表示し、詳細用の二時刻は保持する', () => {
  const near = segment(
    'near',
    '2026-09-28T00:00:00Z',
    [nearDate],
    [rain('1', '雪の警報級の可能性', 'なし')],
  );
  const far = segment(
    'far',
    '2026-09-28T00:00:00Z',
    [farNew],
    [rain('2', '雨の警報級の可能性', '高')],
  );
  const data = response(near, far);
  const current = renderToStaticMarkup(
    createElement(NearPanel, { response: data, now: Date.parse('2026-09-29T16:00:00Z') }),
  );
  assert.equal(current, '<p class="ew-message">警報級の可能性はありません</p>');
  const past = renderToStaticMarkup(
    createElement(NearPanel, { response: data, now: Date.parse('2026-10-02T00:00:00Z') }),
  );
  assert.equal(past, '<p class="ew-message">表示できる時間帯はありません</p>');
  const issuedTimes = {
    near: { kind: 'unknown' as const },
    far: { kind: 'issued' as const, value: '2026-09-28T02:00:00Z' },
  };
  const heading = renderToStaticMarkup(
    createElement(InfoPanelFrame, {
      definition: { id: 'earlyWarning', title: '警報級の可能性', presence: 'always' },
      target: '東京地方',
      status: {
        kind: 'data',
        availability: 'available',
        time: '2026-09-28T02:00:00Z',
        timeKind: 'issued',
      },
      issuedTimes,
      children: '本文',
    }),
  );
  assert.match(heading, /明後日まで: 発表時刻不明/);
  assert.doesNotMatch(heading, /明々後日以降/);
  assert.equal(
    formatIssuedTimes(issuedTimes).startsWith('明後日まで: 発表時刻不明 · 明々後日以降:'),
    true,
  );
});

test('遠距離だけ取得できてもパネルは近距離の未取得を示す', () => {
  const data = response(
    segment('near', null, [nearDate], [rain('1', '雪の警報級の可能性', '高')], 'unavailable'),
    segment('far', '2026-09-28T02:00:00Z', [farNew], [rain('2', '雨の警報級の可能性', '高')]),
  );
  assert.equal(
    renderToStaticMarkup(
      createElement(NearPanel, { response: data, now: Date.parse('2026-09-29T16:00:00Z') }),
    ),
    '<p class="ew-message">取得できませんでした</p>',
  );
  assert.deepEqual(
    buildDetailTable(data).columns.map((column) => column.segment),
    ['far'],
  );
  const issuedTimes = {
    near: { kind: 'unavailable' as const },
    far: { kind: 'issued' as const, value: '2026-09-28T02:00:00Z' },
  };
  const heading = renderToStaticMarkup(
    createElement(InfoPanelFrame, {
      definition: { id: 'earlyWarning', title: '警報級の可能性', presence: 'always' },
      target: '東京地方',
      status: { kind: 'data', availability: 'available', time: '', timeKind: 'issued' },
      issuedTimes,
      children: '本文',
    }),
  );
  assert.match(heading, /明後日まで: 未取得/);
  assert.doesNotMatch(heading, /明々後日以降/);
  assert.match(formatIssuedTimes(issuedTimes), /明々後日以降:/);
});
