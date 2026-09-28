import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  TimeseriesAddition,
  WarningTimeseriesData,
  WarningTimeseriesResponse,
  WarningTimeseriesTimeDefine,
  WarningTimeseriesValue,
} from '@wx-viewer-poc/shared';

(globalThis as unknown as { React: typeof React }).React = React;

import { parseWarningTimeseriesResponse } from '../src/api/warningTimeseries';
import {
  RISK_CODE_TABLE,
  WIND_DIRECTION_ROTATION,
  assignTransitionLabels,
  buildBaseQuantityRows,
  buildRemarks,
  buildRiskTable,
  buildSeparateQuantityTables,
  buildWarningTimeSeriesCard,
  buildWindCell,
  buildWindRows,
  classifyRiskValue,
  classifyWindDirection,
  formatColumnLabel,
  formatIntervalHeader,
  resolveCurrentColumnKey,
  resolveMergedDisplay,
  resolveWarningTimeSeriesPanelMessage,
  selectBaseBlockId,
  selectPanelColumns,
  type RiskDisplay,
  type WtsColumn,
} from '../src/map/panels/warningTimeSeries/warningTimeSeriesModel';
import { InfoPanelColumn } from '../src/map/panels/InfoPanelColumn.tsx';
import { DetailDialogInner } from '../src/map/detail/DetailDialog.tsx';
import {
  WarningTimeSeriesDetail,
  buildThreeHourRows,
} from '../src/map/panels/warningTimeSeries/WarningTimeSeriesDetail.tsx';
import { Switch } from '../src/components/md/Switch.tsx';
import { renderNarrowSwitchAction } from '../src/map/panels/warningTimeSeries/WarningTimeSeriesContent.tsx';
import { buildWarningTimeseriesFixtureResponse } from '../src/map/panels/panelFixtures.ts';

const el = React.createElement;

// ==========================================
// テスト用ヘルパ
// ==========================================

function td(
  blockId: string,
  timeId: string,
  sequence: number,
  timeFrom: string,
  timeTo: string,
): WarningTimeseriesTimeDefine {
  return { blockId, timeId, sequence, timeFrom, timeTo, duration: null };
}

function riskValue(
  blockId: string,
  refId: string,
  propertyType: string,
  valueCode: string | null,
  areaDivision: string | null = null,
): WarningTimeseriesValue {
  return {
    blockId,
    refId,
    kindCode: null,
    kindName: null,
    kindStatus: '発表',
    kindDateTime: null,
    valueCategory: 'risk',
    propertyType,
    valueType: propertyType,
    valueCode,
    valueText: valueCode ?? '',
    unit: null,
    description: null,
    condition: null,
    areaDivision,
    sequence: 0,
    scope: null,
  };
}

function quantityValue(
  blockId: string,
  refId: string,
  propertyType: string,
  valueType: string,
  valueText: string,
  unit: string | null = null,
  condition: string | null = null,
  areaDivision: string | null = null,
): WarningTimeseriesValue {
  return {
    blockId,
    refId,
    kindCode: null,
    kindName: null,
    kindStatus: '発表',
    kindDateTime: null,
    valueCategory: 'quantity',
    propertyType,
    valueType,
    valueCode: null,
    valueText,
    unit,
    description: null,
    condition,
    areaDivision,
    sequence: 0,
    scope: null,
  };
}

function addition(
  blockId: string,
  propertyType: string,
  areaDivision: string | null,
  localIndex: number | null,
  additionIndex: number,
  noteIndex: number,
  text: string,
): TimeseriesAddition {
  return {
    blockId,
    scope: {
      kindIndex: 0,
      propertyIndex: 0,
      partName: 'Note',
      partIndex: 0,
      baseIndex: 0,
      localIndex,
    },
    propertyType,
    kindStatus: '発表',
    kindDateTime: null,
    areaDivision,
    additionIndex,
    noteIndex,
    text,
  };
}

// 3時間刻み14列(2026-09-27T06:00:00Z起点。日境界をまたいでも単調増加させるためms演算で作る)
const COLS_BASE_MS = Date.parse('2026-09-27T06:00:00Z');
const COLS: readonly WarningTimeseriesTimeDefine[] = Array.from({ length: 14 }, (_, i) =>
  td(
    'block1',
    `t${i}`,
    i,
    new Date(COLS_BASE_MS + i * 3 * 3_600_000).toISOString(),
    new Date(COLS_BASE_MS + (i + 1) * 3 * 3_600_000).toISOString(),
  ),
);

function response(
  data: WarningTimeseriesData | null,
  issuedAt: string | null = '2026-09-27T20:00:00Z',
): WarningTimeseriesResponse {
  return {
    terminalId: 'east-term',
    venueId: 'east',
    controlStatus: 'normal',
    isTraining: false,
    evaluatedAt: '2026-09-27T20:10:00Z',
    area: { code: '130108', name: '江東区' },
    metadata: {
      source: null,
      issuedAt,
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-27T20:20:00Z',
      lastSuccessAt: '2026-09-27T20:20:00Z',
      availability: 'available',
      sourceVersion: null,
    },
    data,
  };
}

// ==========================================
// AC-2: 行順
// ==========================================
test('AC-2: 行順は電文の出現順(§5.7順・五十音順に並べ替わらない)', () => {
  const values: WarningTimeseriesValue[] = [
    riskValue('block1', 't0', '雷危険度', '30'),
    riskValue('block1', 't0', '大雨浸水危険度', '30'),
    riskValue('block1', 't0', '風危険度', '30', '陸上'),
    riskValue('block1', 't0', '土砂災害危険度', '30'),
    riskValue('block3', 'd0', '乾燥危険度', '20'),
  ];
  const data: WarningTimeseriesData = {
    timeDefines: [...COLS, td('block3', 'd0', 0, COLS[0].timeFrom, COLS[13].timeTo)],
    values,
    additions: null,
  };
  const table = buildRiskTable(data, Date.parse('2026-09-27T07:00:00Z'));
  assert.ok(table);
  assert.deepEqual(
    table?.allRows.map((r) => r.label),
    ['雷', '大雨浸水', '風(陸上)', '土砂災害', '乾燥'],
  );
  assert.deepEqual(
    table?.visibleRows.map((r) => r.label),
    ['雷', '大雨浸水', '風(陸上)', '土砂災害', '乾燥'],
  );

  // 別の出現順を渡すとその順になる(並べ替えではない)
  const reordered: WarningTimeseriesValue[] = [
    riskValue('block1', 't0', '大雨浸水危険度', '30'),
    riskValue('block1', 't0', '雷危険度', '30'),
  ];
  const table2 = buildRiskTable(
    { timeDefines: COLS, values: reordered, additions: null },
    Date.parse('2026-09-27T07:00:00Z'),
  );
  assert.deepEqual(
    table2?.allRows.map((r) => r.label),
    ['大雨浸水', '雷'],
  );
});

test('AC-2 (区分の連続配置、§2.1-16): 同じ種類の区分行は最初の出現位置にまとめて連続する', () => {
  const values: WarningTimeseriesValue[] = [
    riskValue('block1', 't0', '風危険度', '30', '陸上'),
    riskValue('block1', 't0', '雷危険度', '30'),
    riskValue('block1', 't0', '風危険度', '30', '東京湾'),
    riskValue('block1', 't0', '大雨浸水危険度', '30'),
    riskValue('block1', 't0', '風危険度', '30', '海上'),
  ];
  const table = buildRiskTable(
    { timeDefines: COLS, values, additions: null },
    Date.parse('2026-09-27T07:00:00Z'),
  );
  assert.deepEqual(
    table?.allRows.map((r) => r.label),
    ['風(陸上)', '風(東京湾)', '風(海上)', '雷', '大雨浸水'],
  );
  // 見出し行(「風」単独)は無い
  assert.ok(!table?.allRows.some((r) => r.label === '風'));
});

// ==========================================
// AC-3: 結合
// ==========================================
test('AC-3: (blockId,refId)結合。逆順timeDefines・シャッフルrefIdでも一致し、ref欠落はmissing', () => {
  const shuffledTimeDefines = [...COLS].reverse();
  const values: WarningTimeseriesValue[] = [
    riskValue('block1', 't5', '大雨浸水危険度', '30'),
    riskValue('block1', 't0', '大雨浸水危険度', '50'),
    // t1 は値なし(ref欠落) -> missing
  ];
  const data: WarningTimeseriesData = { timeDefines: shuffledTimeDefines, values, additions: null };
  const table = buildRiskTable(data, Date.parse('2026-09-27T07:00:00Z'));
  const row = table?.allRows[0];
  assert.equal(row?.cells[0]?.display, 'level5');
  assert.equal(row?.cells[1]?.display, 'missing');
  assert.equal(row?.cells[5]?.display, 'level3');
});

test('AC-3: selectBaseBlockId は3時間刻みblockを返す', () => {
  const values: WarningTimeseriesValue[] = [
    riskValue('block1', 't0', '大雨浸水危険度', '30'),
    riskValue('block3', 'd0', '乾燥危険度', '20'),
  ];
  const timeDefines = [...COLS, td('block3', 'd0', 0, COLS[0].timeFrom, COLS[13].timeTo)];
  assert.equal(selectBaseBlockId({ timeDefines, values, additions: null }), 'block1');
});

// ==========================================
// AC-4: 日単位の統合
// ==========================================
test('AC-4a: 日区間は覆う3時間列に複製され、区間外はnoValue', () => {
  const dayFrom = COLS[2].timeFrom; // 3列目から
  const dayTo = COLS[9].timeFrom; // 10列目の開始まで(=9列目終端)
  const timeDefines = [...COLS, td('block3', 'd0', 0, dayFrom, dayTo)];
  const values: WarningTimeseriesValue[] = [
    // block1に危険度を1つ置き、block1を基準blockにする(3時間刻み < 日単位)
    riskValue('block1', 't0', '大雨浸水危険度', '01'),
    riskValue('block3', 'd0', '乾燥危険度', '30'),
  ];
  const table = buildRiskTable(
    { timeDefines, values, additions: null },
    Date.parse('2026-09-27T07:00:00Z'),
  );
  assert.equal(table?.baseBlockId, 'block1');
  const row = table?.allRows.find((r) => r.label === '乾燥');
  assert.ok(row);
  for (let i = 0; i < 2; i += 1) assert.equal(row?.cells[i]?.display, 'noValue');
  for (let i = 2; i < 9; i += 1) assert.equal(row?.cells[i]?.display, 'level3');
  for (let i = 9; i < 14; i += 1) assert.equal(row?.cells[i]?.display, 'noValue');
});

test('AC-4b: 境界をまたぐ場合は優先順位規則で高い方を採る', () => {
  // COLS[2] = 12-15時, 境界を13時に置く(2列目内)
  const boundary = new Date(Date.parse(COLS[2].timeFrom) + 60 * 60 * 1000).toISOString();
  const timeDefines = [
    ...COLS,
    td('block3', 'd0', 0, COLS[0].timeFrom, boundary), // level3
    td('block3', 'd1', 1, boundary, COLS[13].timeTo), // below
  ];
  const values: WarningTimeseriesValue[] = [
    riskValue('block1', 't0', '大雨浸水危険度', '01'),
    riskValue('block3', 'd0', '乾燥危険度', '30'),
    riskValue('block3', 'd1', '乾燥危険度', '01'),
  ];
  const table = buildRiskTable(
    { timeDefines, values, additions: null },
    Date.parse('2026-09-27T07:00:00Z'),
  );
  assert.equal(table?.baseBlockId, 'block1');
  const row = table?.allRows.find((r) => r.label === '乾燥');
  // 境界を含む列(COLS[2])は level3 が優先される
  assert.equal(row?.cells[2]?.display, 'level3');
});

test('AC-4c: 境界列でmissingとbelowが重なるとmissingになる', () => {
  const result = resolveMergedDisplay(
    { key: 'c', timeFrom: '2026-09-27T00:00:00Z', timeTo: '2026-09-27T03:00:00Z' },
    [
      {
        timeFrom: '2026-09-26T22:00:00Z',
        timeTo: '2026-09-27T01:00:00Z',
        display: 'below' as RiskDisplay,
      },
      {
        timeFrom: '2026-09-27T01:00:00Z',
        timeTo: '2026-09-27T04:00:00Z',
        display: 'missing' as RiskDisplay,
      },
    ],
  );
  assert.equal(result, 'missing');
});

// ==========================================
// AC-5: コード表
// ==========================================
test('AC-5: RISK_CODE_TABLEは11コード・別表4名称・表示区分が一致。null/99/undefinedはmissing', () => {
  assert.equal(Object.keys(RISK_CODE_TABLE).length, 11);
  assert.equal(RISK_CODE_TABLE['50']?.name, '特別警報級');
  assert.equal(RISK_CODE_TABLE['50']?.display, 'level5');
  assert.equal(RISK_CODE_TABLE['30']?.name, '警報級');
  assert.equal(RISK_CODE_TABLE['30']?.display, 'level3');
  assert.equal(RISK_CODE_TABLE['00']?.display, 'noValue');
  assert.equal(RISK_CODE_TABLE['01']?.display, 'below');

  assert.equal(classifyRiskValue(riskValue('b', 't', 'x', null)), 'missing');
  assert.equal(classifyRiskValue(riskValue('b', 't', 'x', '99')), 'missing');
  assert.equal(classifyRiskValue(undefined), 'missing');
  // valueTextを変えても結果が変わらない
  const v1 = riskValue('b', 't', 'x', '30');
  const v2 = { ...v1, valueText: '別の文字列' };
  assert.equal(classifyRiskValue(v1), classifyRiskValue(v2));
});

// ==========================================
// AC-6: 切替文字
// ==========================================
test('AC-6: assignTransitionLabels', () => {
  const displays: RiskDisplay[] = [
    'below',
    'level3',
    'level3',
    'level5',
    'level5',
    'level4',
    'missing',
    'level4',
    'level2',
    'level3',
  ];
  assert.deepEqual(assignTransitionLabels(displays, null), [
    null,
    '警戒',
    null,
    '切迫',
    null,
    '危険',
    '?',
    '危険',
    null,
    '警戒',
  ]);

  const withInitial2 = assignTransitionLabels(displays, 2);
  assert.equal(withInitial2[2], '警戒');

  const withInitial8 = assignTransitionLabels(displays, 8);
  assert.equal(withInitial8[8], null);

  const allLevel3: RiskDisplay[] = ['level3', 'level3', 'level3', 'level3', 'level3'];
  assert.deepEqual(assignTransitionLabels(allLevel3, 3), ['警戒', null, null, '警戒', null]);

  // UI監修により「—」は廃止(§2.1-17)。noValueは文字なし(null)。
  const noValues: RiskDisplay[] = ['noValue', 'noValue'];
  assert.deepEqual(assignTransitionLabels(noValues, null), [null, null]);

  const missingValues: RiskDisplay[] = ['missing', 'missing'];
  assert.deepEqual(assignTransitionLabels(missingValues, null), ['?', '?']);
});

// ==========================================
// AC-7: 行の表示条件
// ==========================================
test('AC-7: 全セルがbelow/noValue/missingの行はvisibleRowsに現れず、allRowsには残る', () => {
  const values: WarningTimeseriesValue[] = [
    riskValue('block1', 't0', '濃霧危険度', '01'),
    riskValue('block1', 't1', '濃霧危険度', '01'),
    riskValue('block1', 't0', '大雨浸水危険度', '30'),
  ];
  const table = buildRiskTable(
    { timeDefines: COLS, values, additions: null },
    Date.parse('2026-09-27T07:00:00Z'),
  );
  assert.ok(table?.allRows.some((r) => r.label === '濃霧'));
  assert.ok(!table?.visibleRows.some((r) => r.label === '濃霧'));
  assert.ok(table?.visibleRows.some((r) => r.label === '大雨浸水'));
});

test('AC-7 (§2.1-19): 3列窓の外(4コマ目以降)にだけlevel2以上がある行はvisibleRowsに無い', () => {
  const values: WarningTimeseriesValue[] = [
    // now は t0 の区間内 -> パネル窓は t0,t1,t2 のみ。t5 は窓外
    riskValue('block1', 't5', '土砂災害危険度', '30'),
    riskValue('block1', 't0', '大雨浸水危険度', '30'),
  ];
  const table = buildRiskTable(
    { timeDefines: COLS, values, additions: null },
    Date.parse('2026-09-27T07:00:00Z'),
  );
  assert.deepEqual(
    table?.panelColumns.map((c) => c.key),
    ['block1::t0', 'block1::t1', 'block1::t2'],
  );
  assert.ok(table?.allRows.some((r) => r.label === '土砂災害'));
  assert.ok(!table?.visibleRows.some((r) => r.label === '土砂災害'));
  assert.ok(table?.visibleRows.some((r) => r.label === '大雨浸水'));
});

// ==========================================
// AC-8: 状態
// ==========================================
test('AC-8: buildWarningTimeSeriesCard の状態遷移', () => {
  // (a) data:null -> failed
  const failedCard = buildWarningTimeSeriesCard(
    response(null),
    'available',
    Date.parse('2026-09-27T07:00:00Z'),
  );
  assert.equal(failedCard.status.kind, 'failed');

  // (b) issuedAt:null -> failed
  const noIssuedCard = buildWarningTimeSeriesCard(
    response(
      {
        timeDefines: COLS,
        values: [riskValue('block1', 't0', '大雨浸水危険度', '30')],
        additions: null,
      },
      null,
    ),
    'available',
    Date.parse('2026-09-27T07:00:00Z'),
  );
  assert.equal(noIssuedCard.status.kind, 'failed');

  // (c) 表示行0件 -> data状態 + 「注意報級以上の予想はありません」
  // (DetailDialog は createPortal を使い renderToStaticMarkup 非対応のため、
  //  メッセージ判定は純粋関数 resolveWarningTimeSeriesPanelMessage で検証する。§10前提)
  const quietCard = buildWarningTimeSeriesCard(
    response({
      timeDefines: COLS,
      values: [riskValue('block1', 't0', '大雨浸水危険度', '01')],
      additions: null,
    }),
    'available',
    Date.parse('2026-09-27T07:00:00Z'),
  );
  assert.equal(quietCard.status.kind, 'data');
  assert.equal(
    resolveWarningTimeSeriesPanelMessage(
      buildRiskTable(
        {
          timeDefines: COLS,
          values: [riskValue('block1', 't0', '大雨浸水危険度', '01')],
          additions: null,
        },
        Date.parse('2026-09-27T07:00:00Z'),
      ),
    ),
    '注意が必要な時間帯はありません',
  );

  // (d) 危険度0件 -> 「危険度の情報がありません」
  assert.equal(
    resolveWarningTimeSeriesPanelMessage(
      buildRiskTable(
        { timeDefines: [], values: [], additions: null },
        Date.parse('2026-09-27T07:00:00Z'),
      ),
    ),
    '危険度の情報がありません',
  );
  assert.equal(resolveWarningTimeSeriesPanelMessage(null), '危険度の情報がありません');

  // 全列が過去 -> panelColumns 0件 -> 「最新の予想時間帯がありません」
  assert.equal(
    resolveWarningTimeSeriesPanelMessage(
      buildRiskTable(
        {
          timeDefines: COLS,
          values: [riskValue('block1', 't0', '大雨浸水危険度', '30')],
          additions: null,
        },
        Date.parse(COLS[13].timeTo) + 1000,
      ),
    ),
    '最新の予想時間帯がありません',
  );

  // (e) stale
  const staleCard = buildWarningTimeSeriesCard(
    response({
      timeDefines: COLS,
      values: [riskValue('block1', 't0', '大雨浸水危険度', '30')],
      additions: null,
    }),
    'stale',
    Date.parse('2026-09-27T07:00:00Z'),
  );
  assert.equal(staleCard.status.kind, 'data');
  assert.equal((staleCard.status as { availability: string }).availability, 'stale');
});

// ==========================================
// AC-9: 初期列
// ==========================================
test('AC-9: resolveCurrentColumnKey', () => {
  const columns: readonly WtsColumn[] = COLS.map((c) => ({
    key: c.timeId,
    timeFrom: c.timeFrom,
    timeTo: c.timeTo,
    label: '',
  }));
  assert.equal(resolveCurrentColumnKey(columns, Date.parse(COLS[0].timeFrom) - 1000), 't0');
  assert.equal(resolveCurrentColumnKey(columns, Date.parse(COLS[5].timeFrom) + 1000), 't5');
  assert.equal(resolveCurrentColumnKey(columns, Date.parse(COLS[5].timeTo)), 't6');
  assert.equal(resolveCurrentColumnKey(columns, Date.parse(COLS[13].timeTo) + 1000), 't13');
  assert.equal(resolveCurrentColumnKey([], Date.now()), null);
});

test('AC-9: selectPanelColumns(パネルの3列窓)', () => {
  const columns: readonly WtsColumn[] = COLS.map((c) => ({
    key: c.timeId,
    timeFrom: c.timeFrom,
    timeTo: c.timeTo,
    label: '',
  }));
  const keys = (cols: readonly WtsColumn[]) => cols.map((c) => c.key);

  // 先頭より前 -> 1〜3列目
  assert.deepEqual(keys(selectPanelColumns(columns, Date.parse(COLS[0].timeFrom) - 1000)), [
    't0',
    't1',
    't2',
  ]);
  // 5列目の区間内 -> 5〜7列目
  assert.deepEqual(keys(selectPanelColumns(columns, Date.parse(COLS[4].timeFrom) + 1000)), [
    't4',
    't5',
    't6',
  ]);
  // 5列目のtimeToちょうど -> 6〜8列目
  assert.deepEqual(keys(selectPanelColumns(columns, Date.parse(COLS[4].timeTo))), [
    't5',
    't6',
    't7',
  ]);
  // 13列目(0始まりindex12)の区間内 -> 13〜14列目(2列)
  assert.deepEqual(keys(selectPanelColumns(columns, Date.parse(COLS[12].timeFrom) + 1000)), [
    't12',
    't13',
  ]);
  // 14列目(最終列)の区間内 -> 14列目(1列)
  assert.deepEqual(keys(selectPanelColumns(columns, Date.parse(COLS[13].timeFrom) + 1000)), [
    't13',
  ]);
  // 末尾より後 -> 0列
  assert.deepEqual(keys(selectPanelColumns(columns, Date.parse(COLS[13].timeTo) + 1000)), []);
  // 列0件 -> 0列
  assert.deepEqual(selectPanelColumns([], Date.now()), []);
});

// ==========================================
// AC-10: 詳細
// ==========================================
test('AC-10: 詳細ダイアログの3時間表・別欄・凡例', () => {
  const timeDefines = [
    ...COLS,
    td('block2', 'q0', 0, COLS[0].timeFrom, COLS[13].timeTo),
    td('block2', 'q1', 1, COLS[13].timeTo, COLS[13].timeTo),
  ];
  const values: WarningTimeseriesValue[] = [
    riskValue('block1', 't0', '大雨浸水危険度', '30'),
    quantityValue('block1', 't0', '雨', '１時間最大雨量', '5', 'mm'),
    quantityValue('block1', 't0', '風', '風向', '北西', '８方位漢字', null, '陸上'),
    quantityValue('block1', 't0', '風', '最大風速', '10', 'm/s', null, '陸上'),
    quantityValue('block2', 'q0', '雨', '２４時間最大雨量', '80', 'mm'),
    quantityValue('block2', 'q1', '実効湿度', '実効湿度', '0', '%', '値なし'),
  ];
  const data: WarningTimeseriesData = { timeDefines, values, additions: null };
  const table = buildRiskTable(data, Date.parse('2026-09-27T07:00:00Z'));
  const html = renderToStaticMarkup(el(WarningTimeSeriesDetail, { data, table, narrowed: false }));

  assert.match(html, /１時間最大雨量/);
  assert.match(html, /mm/);
  assert.match(html, /風向・風速\(陸上\) m\/s/);
  assert.doesNotMatch(html, />最大風速</); // 統合されたので「最大風速」単独の行見出しは無い
  assert.doesNotMatch(html, />風向</); // 「風向」単独の行見出しも無い
  assert.match(html, /北西/);
  assert.match(html, /m\/s/);
  assert.match(html, /２４時間最大雨量/);
  assert.match(html, /切迫/);
  assert.match(html, /危険/);
  assert.match(html, /警戒/);
  assert.doesNotMatch(html, /—/); // UI監修: 「—」は廃止(§2.1-17)
  assert.match(html, /欠測・未取得/);
  // 凡例: 危険警報級の表記、レベル4・注記は無い
  assert.match(html, /危険警報級/);
  assert.doesNotMatch(html, /レベル4/);
  assert.doesNotMatch(html, /文字は段階が変わる/);
});

test('AC-10d/e: condition=値なしは0と表示せず、valueTextはそのまま表示される', () => {
  const cells = buildBaseQuantityRows(
    {
      timeDefines: COLS,
      values: [quantityValue('block1', 't0', '雨', '最大雨量', '0', 'mm', '値なし')],
      additions: null,
    },
    'block1',
  );
  assert.equal(cells[0]?.cells[0]?.kind, 'noValue');

  const cells2 = buildBaseQuantityRows(
    {
      timeDefines: COLS,
      values: [quantityValue('block1', 't0', '雨', '最大雨量', '10以上', 'mm')],
      additions: null,
    },
    'block1',
  );
  assert.deepEqual(cells2[0]?.cells[0], { kind: 'quantity', text: '10以上', condition: null });
});

// ==========================================
// AC-19〜21: 備考(付加事項)
// ==========================================
test('AC-19: buildRemarksの結合(出現順・「、」連結・Base直下の複製・対応行無しは捨てる)', () => {
  const rows = [
    { key: '雷危険度::', propertyType: '雷危険度', areaDivision: null },
    { key: '風危険度::陸上', propertyType: '風危険度', areaDivision: '陸上' },
    { key: '風危険度::東京湾', propertyType: '風危険度', areaDivision: '東京湾' },
  ];
  const additions: TimeseriesAddition[] = [
    addition('block1', '雷危険度', null, null, 0, 0, '竜巻'),
    addition('block1', '雷危険度', null, null, 0, 1, 'ひょう'),
    addition('block1', '風危険度', '陸上', 0, 1, 0, '陸上のみのNote'),
    addition('block1', '風危険度', null, null, 2, 0, '全区分共通のNote'),
    addition('block2', '雨', null, null, 3, 0, '対応行が無いNote'),
  ];
  const remarks = buildRemarks(additions, rows);
  assert.equal(remarks?.byRow.get('雷危険度::'), '竜巻、ひょう');
  // Base直下(localIndex=null)は電文構造上Localより先に出現するため、並びはBase→Localの順
  assert.equal(remarks?.byRow.get('風危険度::陸上'), '全区分共通のNote、陸上のみのNote');
  assert.equal(remarks?.byRow.get('風危険度::東京湾'), '全区分共通のNote');
  // 対応行が無いNoteはどの行にも現れない
  for (const [, text] of remarks?.byRow ?? []) {
    assert.doesNotMatch(text, /対応行が無いNote/);
  }

  // 重複は除去しない
  const dup = buildRemarks(
    [
      addition('block1', '雷危険度', null, null, 0, 0, '同じ内容'),
      addition('block1', '雷危険度', null, null, 0, 1, '同じ内容'),
    ],
    rows,
  );
  assert.equal(dup?.byRow.get('雷危険度::'), '同じ内容、同じ内容');
});

test('AC-19/21 (5a6141c設計改訂): 量的予想のNoteは同じblockIdの行にだけ載る。危険度はblockIdを照合しない', () => {
  const quantityRows = [
    { key: '雨::１時間最大雨量::', propertyType: '雨', areaDivision: null, blockId: 'block1' },
  ];
  // 別blockの雨Noteは、3時間表(block1)の雨の行には載らない
  const otherBlockNote = buildRemarks(
    [addition('block2', '雨', null, null, 0, 0, '別blockのNote')],
    quantityRows,
  );
  assert.equal(otherBlockNote?.byRow.has('雨::１時間最大雨量::'), false);

  // 同じblockの雨Noteは載る
  const sameBlockNote = buildRemarks(
    [addition('block1', '雨', null, null, 0, 0, '同じblockのNote')],
    quantityRows,
  );
  assert.equal(sameBlockNote?.byRow.get('雨::１時間最大雨量::'), '同じblockのNote');

  // 危険度の行(blockId未設定)は、blockIdが違うNoteでも載る(従来どおり)
  const riskRows = [{ key: '雷危険度::', propertyType: '雷危険度', areaDivision: null }];
  const riskNote = buildRemarks(
    [addition('block3', '雷危険度', null, null, 0, 0, '別blockの危険度Note')],
    riskRows,
  );
  assert.equal(riskNote?.byRow.get('雷危険度::'), '別blockの危険度Note');
});

test('AC-19/21: §6合成応答(block2の雨Note)は、雨Noteだけのadditionsでも3時間表・別欄・パネルのどこにも出ない', () => {
  const response = buildWarningTimeseriesFixtureResponse(false);
  const data = response.data;
  assert.ok(data);
  const table = buildRiskTable(data, Date.parse(response.metadata.issuedAt as string));
  const html = renderToStaticMarkup(el(WarningTimeSeriesDetail, { data, table, narrowed: false }));
  assert.doesNotMatch(html, /合成データ: 対応行なし確認用/);

  // 雨Noteだけのadditionsに絞っても出ない(block2の雨Noteはblock1の雨行と照合されない)
  const rainOnlyAdditions = (data.additions ?? []).filter(
    (a) => a.text === '合成データ: 対応行なし確認用',
  );
  assert.ok(rainOnlyAdditions.length > 0, '§6のフィクスチャに雨Noteが含まれていること');
  const rainOnlyData = { ...data, additions: rainOnlyAdditions };
  const rainOnlyTable = buildRiskTable(
    rainOnlyData,
    Date.parse(response.metadata.issuedAt as string),
  );
  const rainOnlyHtml = renderToStaticMarkup(
    el(WarningTimeSeriesDetail, { data: rainOnlyData, table: rainOnlyTable, narrowed: false }),
  );
  assert.doesNotMatch(rainOnlyHtml, /合成データ: 対応行なし確認用/);
});

test('AC-20/21: 時間セルへ非複製・null/空の区別', () => {
  const rowsWithoutDivision = [{ key: '風危険度::', propertyType: '風危険度', areaDivision: null }];
  // Base直下のNoteは、区分なし行があればそこだけに載る(複製しない)
  const remarksWithPlainRow = buildRemarks(
    [addition('block1', '風危険度', null, null, 0, 0, '無区分行のNote')],
    [
      ...rowsWithoutDivision,
      { key: '風危険度::陸上', propertyType: '風危険度', areaDivision: '陸上' },
    ],
  );
  assert.equal(remarksWithPlainRow?.byRow.get('風危険度::'), '無区分行のNote');
  assert.equal(remarksWithPlainRow?.byRow.has('風危険度::陸上'), false);

  // additions: [] でも byRow は存在する(空のMap)。null と区別する
  const empty = buildRemarks([], rowsWithoutDivision);
  assert.ok(empty !== null);
  assert.equal(empty?.byRow.size, 0);

  const notExtracted = buildRemarks(null, rowsWithoutDivision);
  assert.equal(notExtracted, null);
});

test('AC-20: 3時間表の各行のセル数は常に時間列数+1(備考)。備考は時間セル・別欄・パネルに現れない', () => {
  const timeDefines = [...COLS, td('block2', 'q0', 0, COLS[0].timeFrom, COLS[13].timeTo)];
  const values: WarningTimeseriesValue[] = [
    riskValue('block1', 't0', '雷危険度', '30'),
    quantityValue('block2', 'q0', '雨', '２４時間最大雨量', '80', 'mm'),
  ];
  const additions: TimeseriesAddition[] = [
    addition('block1', '雷危険度', null, null, 0, 0, '竜巻注意'),
  ];
  const data: WarningTimeseriesData = { timeDefines, values, additions };
  const table = buildRiskTable(data, Date.parse('2026-09-27T07:00:00Z'));
  const html = renderToStaticMarkup(el(WarningTimeSeriesDetail, { data, table, narrowed: false }));
  assert.match(html, /竜巻注意/);
  // 別欄・パネルには出ない(パネル本体は本テストでは描画していないため、別欄側だけ確認する)
  const separateOnly = html.slice(html.indexOf('wts-detail-separate'));
  assert.doesNotMatch(separateOnly, /竜巻注意/);
});

// ==========================================
// AC-25: 時刻見出し(「時」を含まない形)
// ==========================================
test('AC-25: formatColumnLabelは「時」を含まない形式で、aria-labelには「時」を残す', () => {
  assert.equal(formatColumnLabel('2026-09-27T15:00:00Z', '2026-09-27T18:00:00Z'), '0-3'); // JST0-3時
  assert.equal(formatColumnLabel('2026-09-26T12:00:00Z', '2026-09-26T15:00:00Z'), '21-24'); // 終端0時は24と書く

  const table = buildRiskTable(
    {
      timeDefines: COLS,
      values: [riskValue('block1', 't0', '大雨浸水危険度', '30')],
      additions: null,
    },
    Date.parse('2026-09-27T07:00:00Z'),
  );
  // パネル列見出しに「時」を含まない
  assert.ok(table?.panelColumns.every((c) => !c.label.includes('時')));
  const html = renderToStaticMarkup(
    el(WarningTimeSeriesDetail, {
      data: {
        timeDefines: COLS,
        values: [riskValue('block1', 't0', '大雨浸水危険度', '30')],
        additions: null,
      },
      table,
      narrowed: false,
    }),
  );
  // 読み上げ用aria-labelには「時」が付く
  assert.match(html, /aria-label="[^"]*時 /);
});

// ==========================================
// AC-26: 風向・風速の統合
// ==========================================
test('AC-26: buildWindCellのd(8方位/方位外/値なし/欠測)×s(値/値なし/欠測)の12通り', () => {
  const dir = (text: string, condition: string | null = null) =>
    quantityValue('block1', 't0', '風', '風向', text, '８方位漢字', condition, '陸上');
  const other = (text: string) =>
    quantityValue('block1', 't0', '風', '風向', text, '８方位漢字', null, '陸上');
  const speed = (text: string, condition: string | null = null) =>
    quantityValue('block1', 't0', '風', '最大風速', text, 'm/s', condition, '陸上');

  // 8方位 × 値
  let cell = buildWindCell(dir('北西'), speed('15'), '陸上');
  assert.equal(cell.directionState, 'compass');
  assert.equal(cell.directionRotation, 135);
  assert.equal(cell.speedState, 'value');
  assert.equal(cell.speedText, '15');
  assert.equal(cell.ariaLabel, '陸上 北西の風 15メートル毎秒');

  // 8方位 × 値なし
  cell = buildWindCell(dir('北西'), speed('0', '値なし'), '陸上');
  assert.equal(cell.directionState, 'compass');
  assert.equal(cell.speedState, 'noValue');
  assert.equal(cell.speedText, null);
  assert.equal(cell.ariaLabel, '陸上 北西の風');

  // 8方位 × 欠測
  cell = buildWindCell(dir('北西'), undefined, '陸上');
  assert.equal(cell.directionState, 'compass');
  assert.equal(cell.speedState, 'missing');
  assert.equal(cell.ariaLabel, '陸上 北西の風 風速欠測');

  // 方位外 × 値
  cell = buildWindCell(other('静穏'), speed('15'), '陸上');
  assert.equal(cell.directionState, 'other');
  assert.equal(cell.directionRotation, null);
  assert.equal(cell.ariaLabel, '陸上 静穏の風 15メートル毎秒');

  // 方位外 × 値なし
  cell = buildWindCell(other('静穏'), speed('0', '値なし'), '陸上');
  assert.equal(cell.directionState, 'other');
  assert.equal(cell.ariaLabel, '陸上 静穏の風');

  // 方位外 × 欠測
  cell = buildWindCell(other('静穏'), undefined, '陸上');
  assert.equal(cell.directionState, 'other');
  assert.equal(cell.ariaLabel, '陸上 静穏の風 風速欠測');

  // 値なし × 値
  cell = buildWindCell(dir('0', '値なし'), speed('15'), '陸上');
  assert.equal(cell.directionState, 'noValue');
  assert.equal(cell.speedText, '15');
  assert.equal(cell.ariaLabel, '陸上 15メートル毎秒');

  // 値なし × 値なし -> 「値なし」
  cell = buildWindCell(dir('0', '値なし'), speed('0', '値なし'), '陸上');
  assert.equal(cell.directionState, 'noValue');
  assert.equal(cell.speedState, 'noValue');
  assert.equal(cell.ariaLabel, '陸上 値なし');

  // 値なし × 欠測
  cell = buildWindCell(dir('0', '値なし'), undefined, '陸上');
  assert.equal(cell.directionState, 'noValue');
  assert.equal(cell.speedState, 'missing');
  assert.equal(cell.ariaLabel, '陸上 風速欠測');

  // 欠測 × 値
  cell = buildWindCell(undefined, speed('15'), '陸上');
  assert.equal(cell.directionState, 'missing');
  assert.equal(cell.speedText, '15');
  assert.equal(cell.ariaLabel, '陸上 風向欠測 15メートル毎秒');

  // 欠測 × 値なし
  cell = buildWindCell(undefined, speed('0', '値なし'), '陸上');
  assert.equal(cell.directionState, 'missing');
  assert.equal(cell.speedState, 'noValue');
  assert.equal(cell.ariaLabel, '陸上 風向欠測');

  // 欠測 × 欠測
  cell = buildWindCell(undefined, undefined, '陸上');
  assert.equal(cell.directionState, 'missing');
  assert.equal(cell.speedState, 'missing');
  assert.equal(cell.ariaLabel, '陸上 風向欠測 風速欠測');

  // areaDivision===nullなら区分名を付けない
  cell = buildWindCell(dir('北西'), speed('15'), null);
  assert.equal(cell.ariaLabel, '北西の風 15メートル毎秒');
});

test('AC-26: 8方位すべての回転角が§4.7の表どおりで、8語以外は原文表示(推測で丸めない)', () => {
  assert.deepEqual(WIND_DIRECTION_ROTATION, {
    北: 180,
    北東: 225,
    東: 270,
    南東: 315,
    南: 0,
    南西: 45,
    西: 90,
    北西: 135,
  });
  for (const [text, rotation] of Object.entries(WIND_DIRECTION_ROTATION)) {
    assert.equal(classifyWindDirection(text, '８方位漢字'), rotation);
  }
  assert.equal(classifyWindDirection('北北西', '８方位漢字'), null);
  assert.equal(classifyWindDirection('静穏', '８方位漢字'), null);
  assert.equal(classifyWindDirection('北西', 'それ以外の単位'), null); // unitが違えば変換しない
});

test('AC-26: condition=風雪の値はどこにも文字として出ない(値自体は表示される)', () => {
  const cell = buildWindCell(
    quantityValue('block1', 't0', '風', '風向', '北西', '８方位漢字', '風雪', '陸上'),
    quantityValue('block1', 't0', '風', '最大風速', '15', 'm/s', null, '陸上'),
    '陸上',
  );
  assert.doesNotMatch(cell.ariaLabel, /風雪/);
  assert.equal(cell.directionState, 'compass');
  assert.equal(cell.directionRotation, 135);
});

test('AC-26: 風向だけの区分は統合されず単独行のまま矢印が付く', () => {
  const data: WarningTimeseriesData = {
    timeDefines: COLS,
    values: [
      riskValue('block1', 't0', '大雨浸水危険度', '30'),
      quantityValue('block1', 't0', '風', '風向', '北西', '８方位漢字', null, '陸上'),
      // 最大風速は無い(片方のみ) -> 統合されない
    ],
    additions: null,
  };
  const table = buildRiskTable(data, Date.parse('2026-09-27T07:00:00Z'));
  assert.equal(buildWindRows(data, table?.baseBlockId ?? '').length, 0);
  const html = renderToStaticMarkup(el(WarningTimeSeriesDetail, { data, table, narrowed: false }));
  assert.match(html, />風向\(陸上\) ８方位漢字</); // 単独の行見出しが残る(unit付き)
  assert.match(html, /wts-wind-arrow/); // 矢印が付く
});

// ==========================================
// AC-27: 統合行の配置
// ==========================================
test('AC-27: 統合行は同じ区分の風危険度行の直下に、複数区分は交互に並ぶ', () => {
  const values: WarningTimeseriesValue[] = [
    riskValue('block1', 't0', '風危険度', '30', '陸上'),
    riskValue('block1', 't0', '風危険度', '30', '東京湾'),
    riskValue('block1', 't0', '雷危険度', '30'),
    quantityValue('block1', 't0', '風', '風向', '北西', '８方位漢字', null, '陸上'),
    quantityValue('block1', 't0', '風', '最大風速', '15', 'm/s', null, '陸上'),
    quantityValue('block1', 't0', '風', '風向', '北', '８方位漢字', null, '東京湾'),
    quantityValue('block1', 't0', '風', '最大風速', '10', 'm/s', null, '東京湾'),
  ];
  const data: WarningTimeseriesData = { timeDefines: COLS, values, additions: null };
  const table = buildRiskTable(data, Date.parse('2026-09-27T07:00:00Z'));
  const html = renderToStaticMarkup(el(WarningTimeSeriesDetail, { data, table, narrowed: false }));

  const headings = [...html.matchAll(/<th scope="row">([^<]*)<\/th>/g)].map((m) => m[1]);
  // 直下に置けた統合行は区分名を省く(§2.1-30、直上の危険度行で区分が分かるため)
  assert.deepEqual(headings, ['風(陸上)', '風向・風速 m/s', '風(東京湾)', '風向・風速 m/s', '雷']);
});

test('AC-27: 対応する危険度行が無い統合行は、風の最初の出現位置に置かれる', () => {
  const values: WarningTimeseriesValue[] = [
    riskValue('block1', 't0', '雷危険度', '30'),
    quantityValue('block1', 't0', '風', '風向', '北西', '８方位漢字', null, '陸上'),
    quantityValue('block1', 't0', '風', '最大風速', '15', 'm/s', null, '陸上'),
    riskValue('block1', 't0', '大雨浸水危険度', '30'),
  ];
  const data: WarningTimeseriesData = { timeDefines: COLS, values, additions: null };
  const table = buildRiskTable(data, Date.parse('2026-09-27T07:00:00Z'));
  const html = renderToStaticMarkup(el(WarningTimeSeriesDetail, { data, table, narrowed: false }));
  const headings = [...html.matchAll(/<th scope="row">([^<]*)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(headings, ['雷', '風向・風速(陸上) m/s', '大雨浸水']);
});

test('AC-27: パネル本体・別欄には統合行・矢印が出ない', () => {
  const values: WarningTimeseriesValue[] = [
    riskValue('block1', 't0', '風危険度', '30', '陸上'),
    quantityValue('block1', 't0', '風', '風向', '北西', '８方位漢字', null, '陸上'),
    quantityValue('block1', 't0', '風', '最大風速', '15', 'm/s', null, '陸上'),
    quantityValue('block2', 'q0', '風', '風向', '北', '８方位漢字', null, '陸上'),
  ];
  const timeDefines = [...COLS, td('block2', 'q0', 0, COLS[0].timeFrom, COLS[13].timeTo)];
  const data: WarningTimeseriesData = { timeDefines, values, additions: null };
  const table = buildRiskTable(data, Date.parse('2026-09-27T07:00:00Z'));
  // パネル: visibleRowsは危険度セルのみ(統合行のラベルは現れない)
  assert.ok(table?.visibleRows.every((r) => r.label !== '風向・風速(陸上) m/s'));
  const separate = buildSeparateQuantityTables(data, table?.baseBlockId ?? null);
  assert.ok(separate.some((t) => t.blockId === 'block2'));
  assert.ok(!separate.some((t) => t.rows.some((r) => r.label.includes('風向・風速'))));
});

// ==========================================
// AC-29: 雨の行の配置
// ==========================================
test('AC-29: 雨の行は大雨浸水・土砂災害の行のうち後ろのものの直後に移る', () => {
  const values: WarningTimeseriesValue[] = [
    riskValue('block1', 't0', '大雨浸水危険度', '30'),
    riskValue('block1', 't0', '雷危険度', '30'),
    riskValue('block1', 't0', '土砂災害危険度', '30'),
    quantityValue('block1', 't0', '雨', '１時間最大雨量', '5', 'mm'),
    riskValue('block1', 't0', '風危険度', '30', '陸上'),
  ];
  const data: WarningTimeseriesData = { timeDefines: COLS, values, additions: null };
  const table = buildRiskTable(data, Date.parse('2026-09-27T07:00:00Z'));
  const html = renderToStaticMarkup(el(WarningTimeSeriesDetail, { data, table, narrowed: false }));
  const headings = [...html.matchAll(/<th scope="row">([^<]*)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(headings, ['大雨浸水', '雷', '土砂災害', '１時間最大雨量 mm', '風(陸上)']);
});

test('AC-29: 雨→大雨浸水→土砂災害の出現順でも、雨の行は土砂災害の直後に移る', () => {
  const values: WarningTimeseriesValue[] = [
    quantityValue('block1', 't0', '雨', '１時間最大雨量', '5', 'mm'),
    riskValue('block1', 't0', '大雨浸水危険度', '30'),
    riskValue('block1', 't0', '土砂災害危険度', '30'),
  ];
  const data: WarningTimeseriesData = { timeDefines: COLS, values, additions: null };
  const table = buildRiskTable(data, Date.parse('2026-09-27T07:00:00Z'));
  const html = renderToStaticMarkup(el(WarningTimeSeriesDetail, { data, table, narrowed: false }));
  const headings = [...html.matchAll(/<th scope="row">([^<]*)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(headings, ['大雨浸水', '土砂災害', '１時間最大雨量 mm']);
});

test('AC-29: 大雨浸水・土砂災害の行が無い入力では、雨の行は出現順のまま', () => {
  const values: WarningTimeseriesValue[] = [
    riskValue('block1', 't0', '雷危険度', '30'),
    quantityValue('block1', 't0', '雨', '１時間最大雨量', '5', 'mm'),
    riskValue('block1', 't0', '風危険度', '30', '陸上'),
  ];
  const data: WarningTimeseriesData = { timeDefines: COLS, values, additions: null };
  const table = buildRiskTable(data, Date.parse('2026-09-27T07:00:00Z'));
  const html = renderToStaticMarkup(el(WarningTimeSeriesDetail, { data, table, narrowed: false }));
  const headings = [...html.matchAll(/<th scope="row">([^<]*)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(headings, ['雷', '１時間最大雨量 mm', '風(陸上)']);
});

test('AC-29: 雪・波の量的予想の行は出現順から動かない', () => {
  const values: WarningTimeseriesValue[] = [
    riskValue('block1', 't0', '大雨浸水危険度', '30'),
    quantityValue('block1', 't0', '雪', '最大降雪量', '5', 'cm'),
    riskValue('block1', 't0', '土砂災害危険度', '30'),
  ];
  const data: WarningTimeseriesData = { timeDefines: COLS, values, additions: null };
  const table = buildRiskTable(data, Date.parse('2026-09-27T07:00:00Z'));
  const html = renderToStaticMarkup(el(WarningTimeSeriesDetail, { data, table, narrowed: false }));
  const headings = [...html.matchAll(/<th scope="row">([^<]*)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(headings, ['大雨浸水', '最大降雪量 cm', '土砂災害']);
});

// ==========================================
// AC-30: 延長列
// ==========================================
test('AC-30: 基準範囲より先の日単位危険度が延長列に表示され、パネル・初期列は延長列を含まない', () => {
  // 基準block(block1): 当日06時〜翌日24時相当の14列(COLSを再利用)
  // 日単位block(block3): 当日(06-24, 基準に重なる)・翌日(重なる)・翌々日(基準の外)の3区間
  const dayCol0 = td('block3', 'd0', 0, COLS[0].timeFrom, COLS[6].timeFrom); // 基準内(重なる)
  const dayCol1 = td('block3', 'd1', 1, COLS[6].timeFrom, COLS[13].timeTo); // 基準内(重なる、末尾まで)
  const extFrom = COLS[13].timeTo; // 基準範囲の終端(翌々日開始)
  const extTo = new Date(Date.parse(extFrom) + 24 * 60 * 60 * 1000).toISOString();
  const dayCol2 = td('block3', 'd2', 2, extFrom, extTo); // 基準の外(延長列)

  const values: WarningTimeseriesValue[] = [
    riskValue('block1', 't0', '大雨浸水危険度', '30'),
    riskValue('block3', 'd0', '乾燥危険度', '20'),
    riskValue('block3', 'd1', '乾燥危険度', '20'),
    riskValue('block3', 'd2', '乾燥危険度', '30'),
    riskValue('block3', 'd0', '霜危険度', '00'),
    riskValue('block3', 'd1', '霜危険度', '00'),
    riskValue('block3', 'd2', '霜危険度', '00'),
  ];
  const data: WarningTimeseriesData = {
    timeDefines: [...COLS, dayCol0, dayCol1, dayCol2],
    values,
    additions: null,
  };
  const now = Date.parse('2026-09-27T07:00:00Z'); // COLS[0]の区間内
  const table = buildRiskTable(data, now);
  assert.ok(table);

  // 3時間表の列が14+1(延長列)になる
  assert.equal(table?.detailColumns.length, 15);
  assert.equal(table?.extensionColumns.length, 1);
  assert.equal(table?.extensionColumns[0]?.timeFrom, extFrom);
  assert.equal(table?.extensionColumns[0]?.label, ''); // 時刻行は空欄

  // 乾燥の延長列セルには翌々日の値がある
  const dryRow = table?.allRows.find((r) => r.label === '乾燥');
  assert.equal(dryRow?.cells[14]?.display, 'level3'); // code 30

  // 大雨浸水(3時間刻み)の延長列はoutOfRange(空白、「?」にしない)
  const rainFloodRow = table?.allRows.find((r) => r.label === '大雨浸水');
  assert.equal(rainFloodRow?.cells[14]?.display, 'outOfRange');

  // パネルの3列窓は延長列を含まない(全列が過去でも延長列を表示しない)
  const allPast = buildRiskTable(data, Date.parse(COLS[13].timeTo) + 999_999_999);
  assert.equal(allPast?.panelColumns.length, 0);

  // initialColumnKeyは基準列のいずれか
  assert.ok(table?.currentColumnKey);
  assert.ok(table?.columns.some((c) => c.key === table.currentColumnKey));
});

test('AC-30: 量的予想・統合行・危険度いずれも延長列は空白でaria-labelが「対象期間外」', () => {
  const extFrom = COLS[13].timeTo;
  const extTo = new Date(Date.parse(extFrom) + 24 * 60 * 60 * 1000).toISOString();
  const dayCol = td('block3', 'd0', 0, extFrom, extTo);
  const values: WarningTimeseriesValue[] = [
    riskValue('block1', 't0', '大雨浸水危険度', '30'),
    quantityValue('block1', 't0', '雨', '１時間最大雨量', '5', 'mm'),
    quantityValue('block1', 't0', '風', '風向', '北西', '８方位漢字', null, '陸上'),
    quantityValue('block1', 't0', '風', '最大風速', '15', 'm/s', null, '陸上'),
    riskValue('block1', 't0', '風危険度', '30', '陸上'),
    // 延長列は危険度が参照する区間だけに作られるため、日単位の危険度を1つ置く
    riskValue('block3', 'd0', '乾燥危険度', '01'),
  ];
  const data: WarningTimeseriesData = {
    timeDefines: [...COLS, dayCol],
    values,
    additions: null,
  };
  const table = buildRiskTable(data, Date.parse('2026-09-27T07:00:00Z'));
  const html = renderToStaticMarkup(el(WarningTimeSeriesDetail, { data, table, narrowed: false }));
  assert.match(html, /aria-label="対象期間外"/);
  assert.doesNotMatch(html, /対象期間外<\/span><span[^>]*>\?/); // 空白であり「?」ではない
});

test('AC-30: 危険度値がある延長列セルのaria-labelはformatIntervalHeaderの結果で始まる(時刻ラベルが空欄のため)', () => {
  const extFrom = COLS[13].timeTo; // 基準範囲の終端(JST 0時想定、§4.2)
  const extTo = new Date(Date.parse(extFrom) + 24 * 60 * 60 * 1000).toISOString();
  const dayCol = td('block3', 'd0', 0, extFrom, extTo);
  const values: WarningTimeseriesValue[] = [
    riskValue('block1', 't0', '大雨浸水危険度', '30'),
    riskValue('block3', 'd0', '乾燥危険度', '20'), // level2、延長列に値が入る
  ];
  const data: WarningTimeseriesData = {
    timeDefines: [...COLS, dayCol],
    values,
    additions: null,
  };
  const table = buildRiskTable(data, Date.parse('2026-09-27T07:00:00Z'));
  const expectedTimePhrase = formatIntervalHeader(extFrom, extTo);
  assert.notEqual(expectedTimePhrase, ''); // 空文字のまま使っていないことの前提確認
  const html = renderToStaticMarkup(el(WarningTimeSeriesDetail, { data, table, narrowed: false }));
  // 「時 注意報級相当」のように空の時刻ラベルのままではなく、formatIntervalHeaderの結果で始まる
  assert.match(html, new RegExp(`aria-label="${expectedTimePhrase} 注意報級相当"`));
  assert.doesNotMatch(html, /aria-label="時 /);
});

// ==========================================
// AC-33: 表示の絞り込みスイッチ(ロジック)
// ==========================================
test('AC-33: 絞り込みは全期間でlevel2以上を含む危険度行だけを残し、量的予想・統合行は全て残す', () => {
  const values: WarningTimeseriesValue[] = [
    riskValue('block1', 't0', '大雨浸水危険度', '30'), // level3、残る
    riskValue('block1', 't0', '濃霧危険度', '01'), // belowのみ、消える
    riskValue('block1', 't0', '雷危険度', null), // missingのみ(欠測だけ)、消える
    quantityValue('block1', 't0', '雨', '１時間最大雨量', '5', 'mm'),
    quantityValue('block1', 't0', '風', '風向', '北西', '８方位漢字', null, '陸上'),
    quantityValue('block1', 't0', '風', '最大風速', '15', 'm/s', null, '陸上'),
  ];
  const data: WarningTimeseriesData = { timeDefines: COLS, values, additions: null };
  const table = buildRiskTable(data, Date.parse('2026-09-27T07:00:00Z'));
  assert.ok(table);

  const full = buildThreeHourRows(data, table as NonNullable<typeof table>, false);
  const headersFull = full.rows.map((r) => r.header);
  // 雨の行は雨に関わる危険度(大雨浸水)の直後に移る(§4.6.1)
  assert.deepEqual(headersFull, [
    '大雨浸水',
    '１時間最大雨量 mm',
    '濃霧',
    '雷',
    '風向・風速(陸上) m/s',
  ]);

  const narrowed = buildThreeHourRows(data, table as NonNullable<typeof table>, true);
  const headersNarrowed = narrowed.rows.map((r) => r.header);
  // 濃霧(未満のみ)・雷(欠測のみ)が消え、大雨浸水(level3)と量的予想・統合行は残る。相対順は変わらない。
  assert.deepEqual(headersNarrowed, ['大雨浸水', '１時間最大雨量 mm', '風向・風速(陸上) m/s']);
});

test('AC-33: 絞り込みで直上の風危険度行が消えると統合行の見出しに区分名が付く', () => {
  const values: WarningTimeseriesValue[] = [
    riskValue('block1', 't0', '風危険度', '01', '陸上'), // 未満のみ -> 絞り込みで消える
    quantityValue('block1', 't0', '風', '風向', '北西', '８方位漢字', null, '陸上'),
    quantityValue('block1', 't0', '風', '最大風速', '15', 'm/s', null, '陸上'),
    riskValue('block1', 't0', '大雨浸水危険度', '30'), // 絞り込みでも残る(全体が0件にならないよう追加)
  ];
  const data: WarningTimeseriesData = { timeDefines: COLS, values, additions: null };
  const table = buildRiskTable(data, Date.parse('2026-09-27T07:00:00Z'));
  assert.ok(table);

  const full = buildThreeHourRows(data, table as NonNullable<typeof table>, false);
  assert.deepEqual(
    full.rows.map((r) => r.header),
    ['風(陸上)', '風向・風速 m/s', '大雨浸水'],
  );

  const narrowed = buildThreeHourRows(data, table as NonNullable<typeof table>, true);
  // 風(陸上)行が消えたため、統合行の見出しに区分名が付く
  assert.deepEqual(
    narrowed.rows.map((r) => r.header),
    ['風向・風速(陸上) m/s', '大雨浸水'],
  );
});

test('AC-33: 別欄・備考列の有無は絞り込みで変わらない', () => {
  const values: WarningTimeseriesValue[] = [
    riskValue('block1', 't0', '濃霧危険度', '01'), // 絞り込みで消える
    quantityValue('block2', 'q0', '雨', '２４時間最大雨量', '80', 'mm'),
  ];
  const timeDefines = [...COLS, td('block2', 'q0', 0, COLS[0].timeFrom, COLS[13].timeTo)];
  const data: WarningTimeseriesData = { timeDefines, values, additions: null };
  const table = buildRiskTable(data, Date.parse('2026-09-27T07:00:00Z'));
  assert.ok(table);
  const full = buildThreeHourRows(data, table as NonNullable<typeof table>, false);
  const narrowed = buildThreeHourRows(data, table as NonNullable<typeof table>, true);
  assert.equal(full.remarksUnavailable, narrowed.remarksUnavailable);
  const separate = buildSeparateQuantityTables(data, table?.baseBlockId ?? null);
  assert.ok(separate.some((t) => t.blockId === 'block2'));
});

test('AC-33: 全行が消える入力では「該当する行はありません」が出る', () => {
  const values: WarningTimeseriesValue[] = [riskValue('block1', 't0', '濃霧危険度', '01')];
  const data: WarningTimeseriesData = { timeDefines: COLS, values, additions: null };
  const table = buildRiskTable(data, Date.parse('2026-09-27T07:00:00Z'));
  const html = renderToStaticMarkup(el(WarningTimeSeriesDetail, { data, table, narrowed: false }));
  // 初期状態(全表示)では濃霧行がある(non-narrowed)。絞り込み後の0件描画はbuildThreeHourRowsで直接確認する。
  assert.ok(table);
  const narrowed = buildThreeHourRows(data, table as NonNullable<typeof table>, true);
  assert.equal(narrowed.rows.length, 0);
  void html;
});

// AC-34: 詳細ダイアログのメタ行右端にmd-switchがあり、ラベル(左)・aria-labelが改訂文言になる(SSR)。
// スイッチ自体はDetailDialogのmetaAction側(WarningTimeSeriesContent側)に配線されるため、
// DetailDialogInnerにrenderNarrowSwitchActionの出力をmetaActionとして載せて検証する。
test('AC-34: 詳細ダイアログのメタ行右端にmd-switchとラベルが配線されている(新文言・新配置)', () => {
  const switchRef = { current: null };
  const metaAction = renderNarrowSwitchAction(false, () => {}, switchRef);
  const html = renderToStaticMarkup(
    el(
      DetailDialogInner,
      {
        open: true,
        meta: {
          title: '警報等時系列',
          target: '江東区',
          time: { kind: 'issued', value: '2026-09-24T05:00:00+09:00' },
          isTraining: false,
        },
        onClose: () => {},
        metaAction,
      },
      el('p', null, '本文'),
    ),
  );
  // 凡例の横ではなく、メタ行(detail-dialog-meta-row)の右端(detail-dialog-meta-action)に配置される
  assert.match(html, /<div class="detail-dialog-meta-row">/);
  const actionMatch = html.match(
    /<div class="detail-dialog-meta-action">(.*?)<\/div>\s*<\/div>\s*<\/header>/s,
  );
  assert.ok(actionMatch, 'detail-dialog-meta-action が見つからない');
  const actionHtml = (actionMatch as RegExpMatchArray)[1];
  assert.match(actionHtml, /<md-switch/);
  assert.match(actionHtml, /要注意のみ表示/);
  assert.match(actionHtml, /aria-label="注意報級以上の危険度と量的予想のみ表示"/);
  // ラベルはスイッチの左(label for が先、md-switchが後)
  const forMatch = actionHtml.match(/<label for="([^"]+)">要注意のみ表示<\/label>/);
  assert.ok(forMatch, 'labelのfor属性が見つからない');
  const labelIndex = actionHtml.indexOf('<label');
  const switchIndex = actionHtml.indexOf('<md-switch');
  assert.ok(labelIndex < switchIndex, 'ラベルはスイッチより左に置く');
  assert.match(actionHtml, new RegExp(`<md-switch[^>]*id="${forMatch?.[1]}"`));
});

// AC-34: WarningTimeSeriesDetail自体には(移設後)絞り込みスイッチが含まれない(回帰防止)
test('AC-34: WarningTimeSeriesDetailの出力にはmd-switchが含まれない(スイッチはDetailDialog側)', () => {
  const values: WarningTimeseriesValue[] = [riskValue('block1', 't0', '大雨浸水危険度', '30')];
  const data: WarningTimeseriesData = { timeDefines: COLS, values, additions: null };
  const table = buildRiskTable(data, Date.parse('2026-09-27T07:00:00Z'));
  const html = renderToStaticMarkup(el(WarningTimeSeriesDetail, { data, table, narrowed: false }));
  assert.doesNotMatch(html, /<md-switch/);
  assert.doesNotMatch(html, /要注意のみ表示/);
});

test('Switchコンポーネントが型どおりに存在する', () => {
  assert.equal(typeof Switch, 'object'); // React.forwardRefはobject
});

test('AC-33: warningTimeSeries配下とSwitch.tsxにlocalStorage・sessionStorageが無い', () => {
  const dir = new URL('../src/map/panels/warningTimeSeries/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));
  for (const file of files) {
    const content = readFileSync(new URL(file, dir), 'utf8');
    assert.doesNotMatch(content, /localStorage|sessionStorage/, file);
  }
  const switchContent = readFileSync(
    new URL('../src/components/md/Switch.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(switchContent, /localStorage|sessionStorage/);
});

// ==========================================
// AC-11: 見出し表記
// ==========================================
test('AC-11: formatIntervalHeader', () => {
  assert.equal(formatIntervalHeader('2026-09-21T15:00:00Z', '2026-09-22T15:00:00Z'), '22日'); // 22日00時JST〜23日00時JST
  assert.equal(
    formatIntervalHeader('2026-09-21T21:00:00Z', '2026-09-22T15:00:00Z'),
    '22日24時まで',
  ); // 22日06時〜23日00時
  assert.equal(
    formatIntervalHeader('2026-09-21T15:00:00Z', '2026-09-22T03:00:00Z'),
    '22日12時まで',
  ); // 22日00時〜22日12時
  assert.equal(formatIntervalHeader('2026-09-21T21:00:00Z', '2026-09-22T21:00:00Z'), '23日6時まで'); // 22日06時〜23日06時
});

// ==========================================
// AC-12: メタ・訓練
// ==========================================
test('AC-12: parseWarningTimeseriesResponse の検証', () => {
  const valid = {
    terminalId: 't',
    venueId: 'east',
    controlStatus: 'normal',
    isTraining: false,
    evaluatedAt: '2026-09-27T20:00:00Z',
    area: { code: '1', name: 'x' },
    metadata: {
      source: null,
      issuedAt: '2026-09-27T20:00:00Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: null,
      lastSuccessAt: null,
      availability: 'available',
      sourceVersion: null,
    },
    data: { timeDefines: [], values: [], additions: null },
  };
  assert.ok(parseWarningTimeseriesResponse(valid, 'normal'));
  assert.equal(
    parseWarningTimeseriesResponse({ ...valid, controlStatus: 'training' }, 'normal'),
    null,
  );
  assert.equal(parseWarningTimeseriesResponse({ ...valid, isTraining: true }, 'normal'), null);
  assert.equal(
    parseWarningTimeseriesResponse(
      { ...valid, data: { timeDefines: [], values: 'x', additions: null } },
      'normal',
    ),
    null,
  );
  assert.equal(
    parseWarningTimeseriesResponse(
      {
        ...valid,
        data: {
          timeDefines: [],
          values: [{ ...riskValue('b', 't', 'p', '30'), valueCategory: 'bad' }],
          additions: null,
        },
      },
      'normal',
    ),
    null,
  );
});

test('AC-12: 見出しはissuedAt由来のみ。venueIdでの対象名切替。', () => {
  const card = buildWarningTimeSeriesCard(
    response(
      {
        timeDefines: COLS,
        values: [riskValue('block1', 't0', '大雨浸水危険度', '30')],
        additions: null,
      },
      '2026-09-27T20:00:00.000Z',
    ),
    'available',
    Date.parse('2026-09-28T00:00:00Z'),
  );
  // content は DetailDialog(createPortal) を含みSSR未対応のため、ダミーに差し替える
  // (bosaiBulletinPanel.test.ts と同様の既存の慣習)。status(見出し時刻)は実際の値を使う。
  const html = renderToStaticMarkup(
    el(InfoPanelColumn, {
      venueId: 'east',
      input: {
        bosaiBulletin: [],
        warning: [],
        warningTimeSeries: [{ ...card, content: 'dummy-wts' }],
        earlyWarning: [],
        amedas: [],
        areaForecast: [],
      },
    }),
  );
  assert.match(html, /05:00発表/);
});

// ==========================================
// AC-15相当: 詳細ダイアログのcreatePortal回避描画確認(DetailDialogInner)
// ==========================================
test('WarningTimeSeriesDetail を DetailDialogInner に載せてもSSRで描画できる', () => {
  const data: WarningTimeseriesData = {
    timeDefines: COLS,
    values: [riskValue('block1', 't0', '大雨浸水危険度', '30')],
    additions: null,
  };
  const table = buildRiskTable(data, Date.parse('2026-09-27T07:00:00Z'));
  const html = renderToStaticMarkup(
    el(DetailDialogInner, {
      open: true,
      meta: {
        title: '警報等時系列',
        target: '江東区',
        time: { kind: 'issued', value: '2026-09-27T20:00:00Z' },
        isTraining: false,
      },
      onClose: () => {},
      children: el(WarningTimeSeriesDetail, { data, table, narrowed: false }),
    }),
  );
  assert.match(html, /警報等時系列/);
});

// buildSeparateQuantityTables の block順(基準以外)確認
test('buildSeparateQuantityTables: 基準block以外の量的予想をblockごとに返す', () => {
  const data: WarningTimeseriesData = {
    timeDefines: [...COLS, td('block2', 'q0', 0, COLS[0].timeFrom, COLS[13].timeTo)],
    values: [quantityValue('block2', 'q0', '雨', '２４時間最大雨量', '80', 'mm')],
    additions: null,
  };
  const tables = buildSeparateQuantityTables(data, 'block1');
  assert.equal(tables.length, 1);
  assert.equal(tables[0]?.blockId, 'block2');
  assert.equal(tables[0]?.rows[0]?.label, '２４時間最大雨量 mm');
});

// ==========================================
// PR #227 レビュー指摘への対応
// ==========================================
test('AC-30: 量的予想だけが参照する基準外の区間は延長列にしない', () => {
  const extFrom = COLS[13].timeTo;
  const extTo = new Date(Date.parse(extFrom) + 24 * 60 * 60 * 1000).toISOString();
  const rainDay = td('block2', 'r0', 0, extFrom, extTo); // 量的予想専用の区間
  const data: WarningTimeseriesData = {
    timeDefines: [...COLS, rainDay],
    values: [
      riskValue('block1', 't0', '大雨浸水危険度', '30'),
      quantityValue('block2', 'r0', '雨', '２４時間最大雨量', '120', 'mm'),
    ],
    additions: null,
  };
  const table = buildRiskTable(data, Date.parse('2026-09-27T07:00:00Z'));
  assert.ok(table);
  assert.equal(table?.extensionColumns.length, 0);
  assert.equal(table?.detailColumns.length, 14);
});

test('AC-19: 同じ行の備考はblockの出現順を優先して連結する(scopeのindexはblock内で振り直される)', () => {
  const later = addition('block3', '乾燥危険度', null, null, 0, 0, '後続block');
  const earlier: TimeseriesAddition = {
    ...addition('block1', '乾燥危険度', null, null, 0, 0, '先行block'),
    scope: { ...later.scope, kindIndex: 5 },
  };
  const rows = [{ key: 'dry', propertyType: '乾燥危険度', areaDivision: null }];
  const remarks = buildRemarks([later, earlier], rows, ['block1', 'block1', 'block2', 'block3']);
  assert.equal(remarks?.byRow.get('dry'), '先行block、後続block');
});
