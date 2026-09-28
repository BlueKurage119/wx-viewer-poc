import assert from 'node:assert/strict';
import test from 'node:test';
import type { AmedasResponse } from '@wx-viewer-poc/shared';
import { parseAmedasResponse } from '../src/api/amedas';
import {
  AMEDAS_FIELDS,
  amedasDisplayValue,
  amedasValue,
  nextAmedasWindowCount,
  visibleAmedasRows,
  latestAmedasRow,
  recentAmedasRows,
  windDirectionName,
} from '../src/map/panels/amedas/amedasModel';

const at = '2026-09-28T00:00:00.000Z';
const response: AmedasResponse = {
  terminalId: 'htrcph01',
  venueId: 'trc',
  controlStatus: 'normal',
  isTraining: false,
  evaluatedAt: at,
  station: { code: '44166', name: '羽田' },
  metadata: {
    source: null,
    issuedAt: null,
    validAt: null,
    validFrom: null,
    validTo: null,
    fetchedAt: null,
    lastSuccessAt: null,
    availability: 'available',
    sourceVersion: null,
  },
  capabilities: {
    publicElements: ['temp', 'humidity', 'windDirection', 'wind', 'precipitation1h'],
    unsupportedElements: ['humidity'],
  },
  data: {
    latestObservedAt: at,
    observations: [
      { observedAt: at, values: { temp: -2, windDirection: 0, wind: 0, precipitation1h: null } },
    ],
  },
};

test('風向の公式17コードと例外値を区別する', () => {
  assert.deepEqual(
    Array.from({ length: 17 }, (_, value) => windDirectionName(value)),
    [
      '静穏',
      '北北東',
      '北東',
      '東北東',
      '東',
      '東南東',
      '南東',
      '南南東',
      '南',
      '南南西',
      '南西',
      '西南西',
      '西',
      '西北西',
      '北西',
      '北北西',
      '北',
    ],
  );
  for (const value of [-1, 17, 1.5, NaN]) assert.equal(windDirectionName(value), '方位不明');
});
test('最新の同一観測行で負値・0・欠測・非提供を区別する', () => {
  const row = latestAmedasRow(response)!;
  assert.equal(amedasValue(response, row, 'temp'), '-2 ℃');
  assert.equal(amedasValue(response, row, 'wind'), '0 m/s');
  assert.equal(amedasValue(response, row, 'windDirection'), '静穏');
  assert.equal(amedasValue(response, row, 'precipitation1h'), '欠測');
  assert.equal(amedasValue(response, row, 'humidity'), '非提供');
  assert.equal(
    latestAmedasRow({
      ...response,
      data: { ...response.data!, latestObservedAt: '2026-09-28T01:00:00.000Z' },
    }),
    null,
  );
});
test('24時間の境界と会場・端末の応答整合を検証する', () => {
  assert.equal(recentAmedasRows(response, Date.parse(at)).length, 1);
  assert.equal(recentAmedasRows(response, Date.parse(at) + 25 * 60 * 60 * 1000).length, 0);
  assert.equal(parseAmedasResponse(response, 'htrcph01', 'normal')?.venueId, 'trc');
  assert.equal(parseAmedasResponse(response, 'hkeagh01', 'normal'), null);
  assert.equal(parseAmedasResponse(response, 'htrcph01', 'training'), null);
});

test('時雨量と羽田湿度の視覚・読み上げ表示を区別する', () => {
  assert.equal(AMEDAS_FIELDS[4]?.label, '時雨量');
  const row = latestAmedasRow(response)!;
  assert.deepEqual(amedasDisplayValue(response, row, 'humidity'), {
    text: '—',
    accessibleLabel: '湿度 非提供',
  });
  assert.deepEqual(amedasDisplayValue(response, row, 'precipitation1h'), {
    text: '欠測',
    accessibleLabel: null,
  });
  assert.deepEqual(amedasDisplayValue(response, row, 'wind'), {
    text: '0 m/s',
    accessibleLabel: null,
  });
});

test('観測表は新しい順、3時間境界は重複せず、空の時間帯を飛ばして24時間まで進む', () => {
  const now = Date.parse(at);
  const row = (hoursAgo: number) => ({
    observedAt: new Date(now - hoursAgo * 60 * 60 * 1000).toISOString(),
    values: {},
  });
  const rows = [row(24), row(12), row(6), row(3), row(1), row(0)];
  assert.deepEqual(
    visibleAmedasRows(rows, now, 1).rows.map((value) => value.observedAt),
    [row(0).observedAt, row(1).observedAt, row(3).observedAt],
  );
  assert.equal(visibleAmedasRows(rows, now, 1).hasMore, true);
  assert.equal(nextAmedasWindowCount(rows, now, 1), 2);
  assert.deepEqual(
    visibleAmedasRows(rows, now, 2).rows.map((value) => value.observedAt),
    [row(0).observedAt, row(1).observedAt, row(3).observedAt, row(6).observedAt],
  );
  assert.equal(nextAmedasWindowCount(rows, now, 2), 4);
  assert.equal(nextAmedasWindowCount(rows, now, 4), 8);
  assert.deepEqual(
    visibleAmedasRows(rows, now, 8).rows.map((value) => value.observedAt),
    rows.map((value) => value.observedAt).reverse(),
  );
  assert.equal(visibleAmedasRows(rows, now, 8).hasMore, false);
});
