import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EarlyWarningResponse, EarlyWarningData, WeatherDataset } from '@wx-viewer-poc/shared';
import {
  buildDetailTable,
  resolveEarlyWarningDetailTarget,
  buildPanelTable,
  selectPanelColumns,
  buildTable,
  classify,
  columnsFor,
} from '../src/map/panels/earlyWarning/earlyWarningModel.ts';
import {
  EarlyWarningContent,
  EarlyWarningDetail,
  NearPanel,
} from '../src/map/panels/earlyWarning/EarlyWarningContent.tsx';
import { InfoPanelFrame } from '../src/map/panels/InfoPanelFrame.tsx';
import { formatIssuedTimes } from '../src/map/panels/earlyWarning/issuedTimes.ts';
import { buildEarlyWarningFixtureResponse } from '../src/map/panels/earlyWarning/earlyWarningFixture.ts';
import { isEarlyWarningFixtureRequest } from '../src/map/panels/earlyWarning/earlyWarningFixtureGate.ts';
import { buildEarlyWarningCard } from '../src/map/panels/earlyWarning/useEarlyWarning.tsx';
import {
  buildEarlyWarningFixtureInput,
  PANEL_FIXTURE_NAMES,
} from '../src/map/panels/panelFixtures.ts';

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
  assert.match(heading, /発表時刻不明/);
  assert.doesNotMatch(heading, /明後日まで:/);
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
  assert.match(heading, /未取得/);
  assert.doesNotMatch(heading, /明後日まで:/);
  assert.doesNotMatch(heading, /明々後日以降/);
  assert.match(formatIssuedTimes(issuedTimes), /明々後日以降:/);
});

test('初回取得中は警報級カードのヘッダーに取得中を表示しない', () => {
  const html = renderToStaticMarkup(
    createElement(InfoPanelFrame, {
      definition: { id: 'earlyWarning', title: '警報級の可能性', presence: 'always' },
      status: { kind: 'loading' },
      issuedTimes: { near: { kind: 'loading' }, far: { kind: 'loading' } },
    }),
  );
  assert.doesNotMatch(html, /明後日まで: 取得中/);
  assert.match(html, /info-panel-card-skeleton/);
});

test('詳細は共通二段見出しで近距離・遠距離を表示し、雨の列だけ縦結合する', () => {
  const near = segment(
    'near',
    '2026-09-28T00:00:00Z',
    [nearDate],
    [rain('1', '大雨の警報級の可能性', '高'), rain('1', '土砂災害の警報級の可能性', '中')],
  );
  const far1: [string, string, string] = ['2', '2026-09-30T15:00:00Z', '2026-10-01T15:00:00Z'];
  const far2: [string, string, string] = ['3', '2026-10-01T15:00:00Z', '2026-10-02T15:00:00Z'];
  const far = segment(
    'far',
    '2026-09-28T00:00:00Z',
    [far1, far2],
    [
      rain('2', '雨の警報級の可能性', null, '値なし'),
      rain('3', '雨の警報級の可能性', null, '欠測'),
    ],
  );
  const html = renderToStaticMarkup(
    createElement(EarlyWarningDetail, {
      table: buildDetailTable(response(near, far)),
      now: Date.parse('2026-09-30T16:00:00Z'),
    }),
  );
  assert.match(html, /class="detail-ts-sticky"/);
  assert.match(html, /class="detail-ts-head"/);
  assert.match(html, /data-column-key="far:2:0"/);
  assert.equal((html.match(/rowSpan="2"/g) ?? []).length, 2);
  assert.equal((html.match(/<thead>/g) ?? []).length, 1);
  assert.match(
    html,
    /aria-label="大雨・土砂災害、雨の警報級の可能性、2026年10月1日\(木\) 0-24時、高・中の表示なし"/,
  );
  assert.match(
    html,
    /aria-label="大雨・土砂災害、雨の警報級の可能性、2026年10月2日\(金\) 0-24時、欠測"/,
  );
  assert.match(html, /detail-ts-date-boundary/);
  assert.match(html, /role="region" aria-label="警報級の可能性の全期間"/);
  assert.doesNotMatch(html, /class="ew-table"/);
});

test('区間見出しは時なし、なし・値なしは同じ表示で欠測・項目不在と区別する', () => {
  const dates = [
    ['a', '2026-09-28T03:00:00Z', '2026-09-28T09:00:00Z'],
    ['b', '2026-09-28T09:00:00Z', '2026-09-28T15:00:00Z'],
    ['c', '2026-09-28T15:00:00Z', '2026-09-28T21:00:00Z'],
    ['d', '2026-09-28T21:00:00Z', '2026-09-29T03:00:00Z'],
  ] as const;
  const data = response(
    segment('near', '2026-09-28T00:00:00Z', dates, [
      rain('a', '大雨の警報級の可能性', 'なし'),
      rain('b', '大雨の警報級の可能性', null, '値なし'),
      rain('c', '大雨の警報級の可能性', '高'),
      rain('a', '雪の警報級の可能性', '中'),
    ]),
    segment('far', '2026-09-28T00:00:00Z', [farNew], [rain('2', '雨の警報級の可能性', '高')]),
  );
  assert.deepEqual(
    columnsFor(data, 'near').map((column) => column.label),
    ['9/28 12-18', '9/28 18-24', '9/29 0-6', '9/29 6-12'],
  );
  const noonToMidnight = response(
    segment(
      'near',
      '2026-09-28T00:00:00Z',
      [['m', '2026-09-28T03:00:00Z', '2026-09-28T15:00:00Z']],
      [rain('m', '大雨の警報級の可能性', '高')],
    ),
    segment('far', null, [], []),
  );
  assert.equal(columnsFor(noonToMidnight, 'near')[0]?.label, '9/28 12-24');
  const panel = renderToStaticMarkup(
    createElement(NearPanel, { response: data, now: Date.parse('2026-09-28T04:00:00Z') }),
  );
  assert.match(panel, /<th scope="col" aria-label="現象"><\/th>/);
  assert.match(panel, /<th scope="col">12-18<\/th>/);
  assert.match(panel, /<th scope="col">18-24<\/th>/);
  assert.doesNotMatch(panel, /<th scope="col">9\/28/);
  assert.match(
    panel,
    /class="ew-cell ew-cell-quiet" aria-label="大雨、9\/28 12-18、高・中の表示なし"><\/span>/,
  );
  assert.match(
    panel,
    /class="ew-cell ew-cell-quiet" aria-label="大雨、9\/28 18-24、高・中の表示なし"><\/span>/,
  );
  assert.match(
    panel,
    /class="wts-cell wts-cell-missing" aria-label="大雪、9\/28 18-24、欠測">\?<\/span>/,
  );
  assert.doesNotMatch(panel, /12-18時|18-0時/);
  const detail = renderToStaticMarkup(
    createElement(EarlyWarningDetail, {
      table: buildDetailTable(data),
      now: Date.parse('2026-09-28T04:00:00Z'),
    }),
  );
  assert.match(detail, />28\(月\)<\/th>/);
  assert.match(detail, /日（曜日）/);
  assert.match(detail, /時間帯/);
  assert.match(detail, />12-18<\/th>/);
  assert.doesNotMatch(detail, />12-18時<\/th>/);
  assert.match(detail, /aria-label="大雪、2026年9月28日\(月\) 18-24時、欠測"/);
  assert.match(detail, /aria-label="土砂災害、2026年9月28日\(月\) 12-18時、対象外"><\/span>/);
  assert.doesNotMatch(detail, /<th scope="row">波浪<\/th>/);
  const css = readFileSync(
    new URL('../src/map/panels/earlyWarning/earlyWarning.css', import.meta.url),
    'utf8',
  );
  assert.match(css, /\.ew-cell\s*\{[^}]*inline-size:\s*3rem;/);
  assert.match(css, /\.ew-cell-quiet\s*\{[^}]*background:\s*var\(--md-sys-color-scrim\);/);
  assert.match(css, /\.ew-detail \.detail-ts-table td\s*\{[^}]*padding-inline:\s*0\.5rem;/);
  assert.match(css, /\.ew-cell\s*\{[^}]*vertical-align:\s*middle;/);
  assert.match(css, /\.ew-panel-table \.ew-table td,[\s\S]*?inline-size:\s*1%;/);
  assert.match(css, /\.ew-panel-table\s*\{[^}]*inline-size:\s*100%;/);
  assert.match(css, /\.ew-panel-table \.ew-table\s*\{[^}]*inline-size:\s*100%;/);
  assert.match(css, /\.ew-panel-table \.ew-table th,[\s\S]*?padding-inline:\s*4px;/);
  assert.doesNotMatch(css, /\.ew-panel-table\s*\{[^}]*overflow-x:\s*auto;/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
});

test('開発フィクスチャはJSTの日界をまたぐ現在3コマとD+3以降を実モデルへ渡す', () => {
  const now = Date.parse('2026-09-28T14:30:00Z'); // JST 9/28 23:30
  const response = buildEarlyWarningFixtureResponse(now);
  assert.deepEqual(
    columnsFor(response, 'near').map((column) => [column.timeId, column.label]),
    [
      ['near-1', '9/28 18-24'],
      ['near-2', '9/29 0-6'],
      ['near-3', '9/29 6-12'],
    ],
  );
  assert.deepEqual(
    columnsFor(response, 'far').map((column) => [column.timeId, column.label]),
    [
      ['far-1', '10/1'],
      ['far-2', '10/2'],
      ['far-3', '10/3'],
    ],
  );
  const panel = buildPanelTable(response, now);
  assert.deepEqual(
    panel.rows.map((row) => [row.label, ...row.cells]),
    [
      ['大雨', 'high', 'none', 'noValue'],
      ['土砂災害', 'medium', 'missing', 'none'],
      ['大雪', 'noValue', 'high', 'missing'],
    ],
  );
  const detail = buildDetailTable(response);
  assert.deepEqual(
    detail.rows.map((row) => row.label),
    ['大雨', '土砂災害', '大雪', '暴風（雪）', '波浪'],
  );
  assert.deepEqual(
    detail.columns.map((column) => column.segment),
    ['near', 'near', 'near', 'far', 'far', 'far'],
  );
  assert.equal(detail.rainJoined, true);
  const card = buildEarlyWarningCard(response, now, '警報級の可能性（確認用データ）');
  assert.equal(card.heading, '警報級の可能性（確認用データ）');
  assert.equal(card.status.kind, 'data');
  const content = card.content as React.ReactElement;
  assert.equal(content.type, EarlyWarningContent);
  assert.equal(content.props.response, response);
  assert.equal(content.props.now, now);
  const html = renderToStaticMarkup(createElement(EarlyWarningDetail, { table: detail, now }));
  assert.equal((html.match(/rowSpan="2"/g) ?? []).length, 3);
  assert.match(html, /aria-label="波浪、2026年9月28日\(月\) 18-24時、対象外"/);
  assert.doesNotMatch(html, /<th scope="row">高潮<\/th>/);
});

test('専用フィクスチャは開発ビルドの完全一致クエリでだけ有効になる', () => {
  assert.equal(isEarlyWarningFixtureRequest(true, '?panelFixture=early-warning'), true);
  assert.equal(isEarlyWarningFixtureRequest(true, '?panelFixture=all-content'), false);
  assert.equal(isEarlyWarningFixtureRequest(true, ''), false);
  assert.equal(isEarlyWarningFixtureRequest(false, '?panelFixture=early-warning'), false);
  assert.deepEqual(
    PANEL_FIXTURE_NAMES.filter((name) => name === 'early-warning'),
    ['early-warning'],
  );
});

test('専用フィクスチャは他パネルの入力を保持して警報級だけ差し替える', () => {
  const originalCard = { key: 'existing', status: { kind: 'loading' as const } };
  const live = {
    bosaiBulletin: [originalCard],
    warning: [originalCard],
    warningTimeSeries: [originalCard],
    earlyWarning: [originalCard],
    amedas: [originalCard],
    areaForecast: [originalCard],
  };
  const fixture = buildEarlyWarningFixtureInput(live, Date.parse('2026-09-28T14:30:00Z'));
  for (const key of [
    'bosaiBulletin',
    'warning',
    'warningTimeSeries',
    'amedas',
    'areaForecast',
  ] as const) {
    assert.equal(fixture[key], live[key]);
  }
  assert.equal(fixture.earlyWarning.length, 1);
  assert.equal(fixture.earlyWarning[0]?.heading, '警報級の可能性（確認用データ）');
  assert.notEqual(fixture.earlyWarning[0], originalCard);
});

const overlapDay: [string, string, string] = [
  '1',
  '2026-10-01T00:00:00+09:00',
  '2026-10-02T00:00:00+09:00',
];
const overlapHalves: [string, string, string][] = [
  ['1', '2026-10-01T00:00:00+09:00', '2026-10-01T12:00:00+09:00'],
  ['2', '2026-10-01T12:00:00+09:00', '2026-10-02T00:00:00+09:00'],
];
function overlapResponse(dates = overlapHalves) {
  return response(
    segment('near', '2026-09-29T09:00:00+09:00', dates, [
      rain('1', '大雨の警報級の可能性', '高'),
      rain('2', '大雨の警報級の可能性', null, '欠測'),
      rain('1', '土砂災害の警報級の可能性', '中'),
      rain('2', '土砂災害の警報級の可能性', 'なし'),
    ]),
    segment(
      'far',
      '2026-09-28T09:00:00+09:00',
      [overlapDay],
      [rain('1', '雨の警報級の可能性', '中')],
    ),
  );
}
const columnIds = (data: EarlyWarningResponse) =>
  buildDetailTable(data).columns.map((column) => `${column.segment}:${column.timeId}`);

test('全被覆: 異なる発表日の12時間二列が一日列を除き、近距離の値と欠測を保つ', () => {
  const table = buildDetailTable(overlapResponse());
  assert.deepEqual(
    table.columns.map((column) => `${column.segment}:${column.timeId}`),
    ['near:1', 'near:2'],
  );
  assert.deepEqual(
    table.rows.map((row) => [row.label, ...row.cells]),
    [
      ['大雨', 'high', 'missing'],
      ['土砂災害', 'medium', 'none'],
    ],
  );
});

test('全被覆: 6時間四列・包含・完全一致・重なりを実時刻で判定する', () => {
  const cases: [string, string, string][][] = [
    [
      ['1', '2026-09-30T15:00:00Z', '2026-09-30T21:00:00Z'],
      ['2', '2026-09-30T21:00:00Z', '2026-10-01T03:00:00Z'],
      ['3', '2026-10-01T03:00:00Z', '2026-10-01T09:00:00Z'],
      ['4', '2026-10-01T09:00:00Z', '2026-10-01T15:00:00Z'],
    ],
    [['1', '2026-09-30T12:00:00Z', '2026-10-01T18:00:00Z']],
    [['1', '2026-09-30T15:00:00Z', '2026-10-01T15:00:00Z']],
    [overlapDay],
    [
      ['1', '2026-09-30T15:00:00Z', '2026-10-01T09:00:00Z'],
      ['2', '2026-10-01T03:00:00Z', '2026-10-01T15:00:00Z'],
    ],
  ];
  const expected = [
    ['near:1', 'near:2', 'near:3', 'near:4'],
    ['near:1'],
    ['near:1'],
    ['near:1'],
    ['near:1', 'near:2'],
  ];
  cases.forEach((dates, index) =>
    assert.deepEqual(columnIds(overlapResponse(dates)), expected[index]),
  );
});

test('全被覆: 逆順入力でも隣接・過去・未来の遠距離を時刻順に残し、同一IDの値を分離する', () => {
  const base = overlapResponse([...overlapHalves].reverse());
  const data = {
    ...base,
    far: segment(
      'far',
      '2026-09-27T09:00:00+09:00',
      [
        ['2', '2026-10-02T00:00:00+09:00', '2026-10-03T00:00:00+09:00'],
        overlapDay,
        ['1', '2026-09-30T00:00:00+09:00', '2026-10-01T00:00:00+09:00'],
      ],
      [rain('1', '雨の警報級の可能性', 'なし'), rain('2', '雨の警報級の可能性', '中')],
    ),
  };
  assert.deepEqual(columnIds(data), ['far:1', 'near:1', 'near:2', 'far:2']);
  assert.deepEqual(
    buildDetailTable(data).rows.map((row) => [row.label, ...row.cells]),
    [
      ['大雨', 'none', 'high', 'missing', 'medium'],
      ['土砂災害', 'none', 'medium', 'none', 'medium'],
    ],
  );
});

test('全被覆: staleの近距離は使い、unavailable・データなしは遠距離を隠さない', () => {
  const base = overlapResponse();
  const stale = {
    ...base,
    near: { ...base.near, metadata: { ...base.near.metadata, availability: 'stale' as const } },
  };
  assert.deepEqual(columnIds(stale), ['near:1', 'near:2']);
  const unavailable = {
    ...base,
    near: {
      ...base.near,
      metadata: { ...base.near.metadata, availability: 'unavailable' as const },
    },
  };
  assert.deepEqual(columnIds(unavailable), ['far:1']);
  assert.deepEqual(columnIds({ ...base, near: { ...base.near, data: null } }), ['far:1']);
});

test('全被覆: 穴がある場合と部分交差では遠距離の元の期間を残す', () => {
  const cases: [string, string, string][][] = [
    [['1', '2026-10-01T00:00:00+09:00', '2026-10-01T06:00:00+09:00'], overlapHalves[1]!],
    [overlapHalves[1]!],
  ];
  for (const dates of cases) {
    assert.deepEqual(
      buildDetailTable(overlapResponse(dates))
        .columns.filter((c) => c.segment === 'far')
        .map((c) => [c.timeId, c.timeFrom, c.timeTo]),
      [overlapDay],
    );
  }
});

test('全被覆: 詳細の見出しとセル位置を揃え、遠距離の雨だけ縦結合する', () => {
  const base = overlapResponse();
  const data = {
    ...base,
    far: segment(
      'far',
      base.far.metadata.issuedAt,
      [overlapDay, ['2', '2026-10-02T00:00:00+09:00', '2026-10-03T00:00:00+09:00']],
      [rain('1', '雨の警報級の可能性', '高'), rain('2', '雨の警報級の可能性', '中')],
    ),
  };
  const html = renderToStaticMarkup(
    createElement(EarlyWarningDetail, {
      table: buildDetailTable(data),
      now: Date.parse('2026-10-01T00:00:00+09:00'),
    }),
  );
  const head = html.match(/<thead>(.*?)<\/thead>/)?.[1] ?? '';
  assert.deepEqual(
    [...head.matchAll(/data-column-key="([^"]+)"/g)].map((m) => m[1]),
    ['near:1:0', 'near:2:1', 'far:2:1'],
  );
  const body = html.match(/<tbody>(.*?)<\/tbody>/)?.[1] ?? '';
  const rows = [...body.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map((m) => m[1]!);
  assert.deepEqual(
    rows.map((row) =>
      [...row.matchAll(/<td([^>]*)>(.*?)<\/td>/g)].map((m) => [
        m[1]?.includes('rowSpan="2"') ? 2 : 1,
        m[2]?.match(/aria-label="([^"]+)"/)?.[1],
      ]),
    ),
    [
      [
        [1, '大雨、2026年10月1日(木) 0-12時、高'],
        [1, '大雨、2026年10月1日(木) 12-24時、欠測'],
        [2, '大雨・土砂災害、雨の警報級の可能性、2026年10月2日(金) 0-24時、中'],
      ],
      [
        [1, '土砂災害、2026年10月1日(木) 0-12時、中'],
        [1, '土砂災害、2026年10月1日(木) 12-24時、高・中の表示なし'],
      ],
    ],
  );
});

test('詳細の対象地域は応答から取得し、短期と長期が異なる場合は併記する', () => {
  const original = buildEarlyWarningFixtureResponse(Date.now());
  const data: EarlyWarningResponse = {
    ...original,
    near: { ...original.near, area: { code: '110010', name: '南部' } },
    far: { ...original.far, area: { code: '110000', name: '埼玉県' } },
  };
  assert.equal(resolveEarlyWarningDetailTarget(data), '南部／埼玉県');
  assert.equal(resolveEarlyWarningDetailTarget(original), '東京地方');
  assert.equal(
    resolveEarlyWarningDetailTarget({ ...data, far: { ...data.far, data: null } }),
    '南部',
  );
});
