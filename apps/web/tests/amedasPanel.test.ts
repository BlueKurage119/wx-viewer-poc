import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createVenueRegistry,
  type AmedasResponse,
  type VenueForecastTargets,
  type VenueId,
} from '@wx-viewer-poc/shared';
import { parseAmedasResponse } from '../src/api/amedas';
import { testVenueRegistry } from './venueConfigPreload.ts';
import { buildAmedasCard, buildAmedasFailedCard } from '../src/map/panels/amedas/useAmedas';
import {
  AMEDAS_FIELDS,
  AMEDAS_TABLE_FIELDS,
  hourlyPrecipitationRows,
  amedasPlotRange,
  amedasLinePaths,
  amedasTimeTicks,
  amedasDisplayValue,
  amedasValue,
  nextAmedasWindowCount,
  visibleAmedasRows,
  latestAmedasRow,
  recentAmedasRows,
  windDirectionName,
} from '../src/map/panels/amedas/amedasModel';

const at = '2026-09-28T00:00:00.000Z';
const thirdVenueRegistry = createVenueRegistry(
  [
    ...testVenueRegistry.listVenues(),
    {
      ...testVenueRegistry.getVenue(testVenueRegistry.resolveVenueId('east')!),
      venueId: 'third-venue' as VenueId,
    } satisfies VenueForecastTargets,
  ],
  'third-venue-test',
);
(globalThis as unknown as { React: typeof React }).React = React;
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
    publicElements: [
      'temp',
      'humidity',
      'windDirection',
      'wind',
      'precipitation1h',
      'precipitation10m',
    ],
    unsupportedElements: ['humidity'],
  },
  data: {
    latestObservedAt: at,
    observations: [
      {
        observedAt: at,
        values: { temp: -2, windDirection: 0, wind: 0, precipitation1h: null, precipitation10m: 0 },
      },
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
  assert.equal(
    parseAmedasResponse(response, 'htrcph01', 'normal', testVenueRegistry)?.venueId,
    'trc',
  );
  assert.equal(parseAmedasResponse(response, 'hkeagh01', 'normal', testVenueRegistry), null);
  assert.equal(parseAmedasResponse(response, 'htrcph01', 'training', testVenueRegistry), null);
});

test('Issue #236: レジストリ登録済みの第3会場のアメダス応答を受理し、未知会場は拒否する', () => {
  const thirdVenueResponse = { ...response, venueId: 'third-venue' };
  assert.equal(
    parseAmedasResponse(thirdVenueResponse, 'htrcph01', 'normal', thirdVenueRegistry)?.venueId,
    'third-venue',
  );
  assert.equal(
    parseAmedasResponse(
      { ...thirdVenueResponse, venueId: 'unknown-venue' },
      'htrcph01',
      'normal',
      thirdVenueRegistry,
    ),
    null,
  );
});

test('保持値なしのHTTP失敗だけ通信異常とし、network失敗は取得不能を表示する', () => {
  const http = buildAmedasFailedCard('http');
  const network = buildAmedasFailedCard('network');
  assert.deepEqual(http.status, { kind: 'failed' });
  assert.deepEqual(network.status, { kind: 'failed' });
  assert.equal(renderToStaticMarkup(http.content), '<p role="alert">通信異常</p>');
  assert.equal(renderToStaticMarkup(network.content), '<p role="alert">取得できません</p>');
});

test('保持値ありのHTTP失敗だけ通信異常とし、network失敗は更新不能と前回観測時刻を表示する', () => {
  const http = buildAmedasCard(response, Date.parse(at), 'http');
  const network = buildAmedasCard(response, Date.parse(at), 'network');
  assert.deepEqual(http.status, {
    kind: 'data',
    availability: 'stale',
    time: at,
    timeKind: 'observed',
  });
  assert.deepEqual(network.status, http.status);
  assert.ok(React.isValidElement(http.content));
  assert.ok(React.isValidElement(network.content));
  assert.equal(
    (http.content.props as { staleMessage: string }).staleMessage,
    '通信異常 · 前回値：9/28 09:00観測',
  );
  assert.equal(
    (network.content.props as { staleMessage: string }).staleMessage,
    '更新できていません · 前回値：9/28 09:00観測',
  );
});

test('時雨量と羽田湿度の視覚・読み上げ表示を区別する', () => {
  assert.equal(AMEDAS_FIELDS[4]?.label, '時雨量');
  assert.equal(AMEDAS_TABLE_FIELDS[4]?.label, '降水量(10分)');
  const row = latestAmedasRow(response)!;
  assert.deepEqual(amedasDisplayValue(response, row, 'humidity'), {
    text: '—',
    accessibleLabel: '湿度 非提供',
  });
  assert.deepEqual(amedasDisplayValue(response, row, 'precipitation1h'), {
    text: '欠測',
    accessibleLabel: null,
  });
  assert.deepEqual(amedasDisplayValue(response, row, 'precipitation10m'), {
    text: '0 mm',
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

test('時雨量の棒候補は最終観測時刻の分と一致する毎時行だけを選ぶ', () => {
  const latest = '2026-09-28T13:50:00.000Z';
  const row = (iso: string, value: number | null) => ({
    observedAt: iso,
    values: { precipitation1h: value, precipitation10m: 0 },
  });
  const rows = [
    row('2026-09-28T11:50:00.000Z', 3),
    row('2026-09-28T12:40:00.000Z', 5),
    row('2026-09-28T12:50:00.000Z', null),
    row('2026-09-28T13:40:00.000Z', 9),
    row(latest, 7),
  ];
  assert.deepEqual(
    hourlyPrecipitationRows(rows, latest).map((value) => value.observedAt),
    [rows[0]?.observedAt, rows[2]?.observedAt, latest],
  );
  assert.equal(hourlyPrecipitationRows(rows, latest)[1]?.values.precipitation1h, null);
  assert.equal(
    recentAmedasRows(
      { ...response, data: { latestObservedAt: latest, observations: rows } },
      Date.parse(latest) + 25 * 60 * 60 * 1000,
    ).length,
    0,
  );
  assert.equal(
    recentAmedasRows(
      { ...response, data: { latestObservedAt: latest, observations: rows } },
      Date.parse(latest),
    ).length,
    rows.length,
  );
});

test('24時間前の左端時刻は時雨量の棒に含めず、最大24本にする', () => {
  const latest = '2026-09-28T13:50:00.000Z';
  const end = Date.parse(latest);
  const rows = Array.from({ length: 25 }, (_, index) => ({
    observedAt: new Date(end - (24 - index) * 60 * 60 * 1000).toISOString(),
    values: { precipitation1h: index },
  }));
  const selected = hourlyPrecipitationRows(rows, latest);
  assert.equal(selected.length, 24);
  assert.equal(selected[0]?.observedAt, rows[1]?.observedAt);
  assert.equal(selected[23]?.observedAt, latest);
});

test('気温の動的縦軸と時刻のみの6時間目盛り', () => {
  const negative = amedasPlotRange([-4, -3, -2], true)!;
  assert.ok(negative.low < -4 && negative.high > -2);
  assert.ok(negative.high < 0);
  const steady = amedasPlotRange([12, 12], true)!;
  assert.ok(steady.low < 12 && steady.high > 12);
  const single = amedasPlotRange([7], true)!;
  assert.ok(single.low < 7 && single.high > 7);
  assert.equal(amedasPlotRange([NaN], true), null);
  const ticks = amedasTimeTicks(Date.parse('2026-09-28T13:50:00.000Z'));
  assert.equal(ticks.length, 5);
  assert.deepEqual(
    ticks.slice(1).map((tick, index) => tick.at - ticks[index]!.at),
    Array(4).fill(6 * 60 * 60 * 1000),
  );
  assert.deepEqual(
    ticks.map((tick) => tick.label),
    ['22:50', '04:50', '10:50', '16:50', '22:50'],
  );
  assert.notEqual(ticks[0]!.accessibleLabel, ticks[4]!.accessibleLabel);
  assert.match(ticks[0]!.accessibleLabel, /9\/27/);
  assert.match(ticks[4]!.accessibleLabel, /9\/28/);
});

test('折れ線は10分を超える未取得区間と欠測行で分断する', () => {
  const minute = 60 * 1000;
  const samples = [
    { at: 0, value: 1 },
    { at: 10 * minute, value: 2 },
    { at: 20 * minute, value: null },
    { at: 30 * minute, value: 3 },
    { at: 40 * minute, value: 4 },
    { at: 4 * 60 * minute, value: 5 },
    { at: 4 * 60 * minute + 10 * minute, value: 6 },
  ];
  assert.deepEqual(
    amedasLinePaths(
      samples,
      (at) => at / minute,
      (value) => value,
    ),
    ['M 0 1 L 10 2', 'M 30 3 L 40 4', 'M 240 5 L 250 6'],
  );
});
