import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  WarningTimeseriesData,
  WarningTimeseriesResponse,
  WarningTimeseriesTimeDefine,
  WarningTimeseriesValue,
} from '@wx-viewer-poc/shared';

(globalThis as unknown as { React: typeof React }).React = React;

import { parseWarningTimeseriesResponse } from '../src/api/warningTimeseries';
import {
  RISK_CODE_TABLE,
  assignTransitionLabels,
  buildBaseQuantityRows,
  buildRiskTable,
  buildSeparateQuantityTables,
  buildWarningTimeSeriesCard,
  classifyRiskValue,
  formatIntervalHeader,
  resolveCurrentColumnKey,
  resolveMergedDisplay,
  resolveWarningTimeSeriesPanelMessage,
  selectBaseBlockId,
  type RiskDisplay,
  type WtsColumn,
} from '../src/map/panels/warningTimeSeries/warningTimeSeriesModel';
import { InfoPanelColumn } from '../src/map/panels/InfoPanelColumn.tsx';
import { DetailDialogInner } from '../src/map/detail/DetailDialog.tsx';
import { WarningTimeSeriesDetail } from '../src/map/panels/warningTimeSeries/WarningTimeSeriesDetail.tsx';

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

  const noValues: RiskDisplay[] = ['noValue', 'noValue'];
  assert.deepEqual(assignTransitionLabels(noValues, null), ['—', '—']);
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
    '注意報級以上の予想はありません',
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
    quantityValue('block1', 't0', '風', '最大風速', '10', 'm/s', null, '陸上'),
    quantityValue('block2', 'q0', '雨', '２４時間最大雨量', '80', 'mm'),
    quantityValue('block2', 'q1', '実効湿度', '実効湿度', '0', '%', '値なし'),
  ];
  const data: WarningTimeseriesData = { timeDefines, values, additions: null };
  const table = buildRiskTable(data, Date.parse('2026-09-27T07:00:00Z'));
  const html = renderToStaticMarkup(el(WarningTimeSeriesDetail, { data, table }));

  assert.match(html, /１時間最大雨量/);
  assert.match(html, /mm/);
  assert.match(html, /最大風速/);
  assert.match(html, /陸上/);
  assert.match(html, /m\/s/);
  assert.match(html, /２４時間最大雨量/);
  assert.match(html, /切迫/);
  assert.match(html, /危険/);
  assert.match(html, /警戒/);
  assert.match(html, /—/);
  assert.match(html, /欠測・未取得|\?/);
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
      children: el(WarningTimeSeriesDetail, { data, table }),
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
