import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AreaTimeseriesResponse, WeatherControlStatus } from '@wx-viewer-poc/shared';
import { fetchAreaForecast, parseAreaForecastResponse } from '../src/api/areaForecast';

function createValidResponse(
  overrides: Partial<AreaTimeseriesResponse> = {},
): AreaTimeseriesResponse {
  return {
    terminalId: 'hkeagh01',
    venueId: 'east',
    controlStatus: 'normal',
    isTraining: false,
    evaluatedAt: '2026-09-28T03:00:00Z',
    area: { code: '130010', name: '東京地方' },
    metadata: {
      source: 'VPFD51',
      issuedAt: '2026-09-28T02:00:00Z',
      validAt: null,
      validFrom: '2026-09-28T03:00:00Z',
      validTo: '2026-09-29T21:00:00Z',
      fetchedAt: '2026-09-28T02:05:00Z',
      lastSuccessAt: '2026-09-28T02:05:00Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    data: {
      station: { code: '44132', name: '東京' },
      timeDefines: [
        {
          blockId: 'region-3hour',
          timeId: '1',
          sequence: 1,
          timeFrom: '2026-09-28T03:00:00Z',
          timeTo: '2026-09-28T06:00:00Z',
          duration: 'PT3H',
        },
      ],
      values: [
        {
          blockId: 'region-3hour',
          refId: '1',
          element: 'weather',
          valueCode: null,
          valueText: '晴れ',
          valueNumber: null,
          unit: null,
          sequence: 1,
        },
      ],
    },
    capabilities: {
      blockIds: ['region-3hour', 'temperature-3hour'],
      elements: ['weather', 'wind_direction', 'wind_speed_rank', 'temperature'],
      unsupportedFields: ['weatherCode', 'windSpeedRange', 'windSpeedDescription'],
    },
    ...overrides,
  };
}

test('Issue #58 AC-1: fetchAreaForecast - east / trc の双方で controlStatus 付きで呼ぶ', async () => {
  const calls: string[] = [];
  const mockFetch: typeof fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const parsedUrl = new URL(url, 'http://localhost');
    const cs = (parsedUrl.searchParams.get('controlStatus') ?? 'normal') as WeatherControlStatus;
    const isTraining = cs === 'training';
    const valid = createValidResponse({ controlStatus: cs, isTraining });
    return {
      ok: true,
      status: 200,
      json: async () => valid,
    } as Response;
  }) as typeof fetch;

  const terminals = [
    { terminalId: 'hkeagh01', controlStatus: 'normal' as WeatherControlStatus },
    { terminalId: 'htrcph01', controlStatus: 'training' as WeatherControlStatus },
  ];

  for (const { terminalId, controlStatus } of terminals) {
    const controller = new AbortController();
    const result = await fetchAreaForecast({
      terminalId,
      controlStatus,
      signal: controller.signal,
      fetchImpl: mockFetch,
    });
    assert.equal(result.ok, true);
  }

  assert.equal(calls.length, 2);
  assert.match(calls[0]!, /\/api\/weather\/area-timeseries/);
  assert.match(calls[0]!, /controlStatus=normal/);
  assert.match(calls[0]!, /terminalId=hkeagh01/);

  assert.match(calls[1]!, /\/api\/weather\/area-timeseries/);
  assert.match(calls[1]!, /controlStatus=training/);
  assert.match(calls[1]!, /terminalId=htrcph01/);
});

test('Issue #58 AC-1: parseAreaForecastResponse - controlStatus / isTraining 不一致は null', () => {
  const base = createValidResponse({ controlStatus: 'normal', isTraining: false });

  // 正常系
  assert.ok(parseAreaForecastResponse(base, 'normal') !== null);

  // 要求が training なのに normal
  assert.equal(parseAreaForecastResponse(base, 'training'), null);

  // 応答の isTraining が不一致
  const mismatchedTraining = { ...base, isTraining: true };
  assert.equal(parseAreaForecastResponse(mismatchedTraining, 'normal'), null);
});

test('Issue #58 AC-1: parseAreaForecastResponse - capabilities 欠落は null', () => {
  const base = createValidResponse();

  // capabilities 自体がない
  const noCaps = { ...base, capabilities: undefined };
  assert.equal(parseAreaForecastResponse(noCaps, 'normal'), null);

  // capabilities.blockIds が欠落
  const noBlockIds = {
    ...base,
    capabilities: {
      elements: base.capabilities.elements,
      unsupportedFields: base.capabilities.unsupportedFields,
    },
  };
  assert.equal(parseAreaForecastResponse(noBlockIds, 'normal'), null);

  // capabilities.elements が欠落
  const noElements = {
    ...base,
    capabilities: {
      blockIds: base.capabilities.blockIds,
      unsupportedFields: base.capabilities.unsupportedFields,
    },
  };
  assert.equal(parseAreaForecastResponse(noElements, 'normal'), null);

  // capabilities.unsupportedFields が欠落
  const noUnsupported = {
    ...base,
    capabilities: {
      blockIds: base.capabilities.blockIds,
      elements: base.capabilities.elements,
    },
  };
  assert.equal(parseAreaForecastResponse(noUnsupported, 'normal'), null);
});

test('Issue #58 AC-1: parseAreaForecastResponse - data null は許容され、構造不正は null', () => {
  const base = createValidResponse({ data: null });
  assert.ok(parseAreaForecastResponse(base, 'normal') !== null);

  // metadata availability 不正
  const invalidAvail = {
    ...base,
    metadata: { ...base.metadata, availability: 'unknown' },
  };
  assert.equal(parseAreaForecastResponse(invalidAvail, 'normal'), null);

  // data.station 不正
  const invalidStation = {
    ...createValidResponse(),
    data: {
      ...createValidResponse().data!,
      station: { code: 123 },
    },
  };
  assert.equal(parseAreaForecastResponse(invalidStation, 'normal'), null);
});

test('Issue #58 PR指摘: parseAreaForecastResponse - area の欠落・不正は null', () => {
  const base = createValidResponse();
  assert.ok(parseAreaForecastResponse(base, 'normal') !== null);

  assert.equal(parseAreaForecastResponse({ ...base, area: undefined }, 'normal'), null);
  assert.equal(parseAreaForecastResponse({ ...base, area: null }, 'normal'), null);
  assert.equal(parseAreaForecastResponse({ ...base, area: { code: 130010 } }, 'normal'), null);
});
