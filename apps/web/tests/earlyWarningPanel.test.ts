import assert from 'node:assert/strict';
import test from 'node:test';
import type { EarlyWarningResponse, EarlyWarningData, WeatherDataset } from '@wx-viewer-poc/shared';
import {
  buildDetailTable,
  buildTable,
  classify,
  columnsFor,
} from '../src/map/panels/earlyWarning/earlyWarningModel.ts';
import { formatIssuedTimes } from '../src/map/panels/earlyWarning/issuedTimes.ts';

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
