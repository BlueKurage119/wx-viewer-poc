import assert from 'node:assert/strict';
import test from 'node:test';
import { createVenueRegistry } from '../src/index.ts';
import { loadVenueConfig } from '../../../apps/api/src/config/venueConfigLoader.ts';

const registry = loadVenueConfig({ environment: 'production' }).registry;

test('会場別の気象対象を用途ごとに完全一致で解決する', () => {
  assert.deepEqual(registry.listVenues(), [
    {
      venueId: 'east',
      venueName: '東京ビッグサイト',
      experimental: false,
      mapReference: { latitude: 35.63159368010876, longitude: 139.79281040119963 },
      warning: { municipalCode: '1310800', displayName: '江東区', prefectureCode: '130000' },
      warningTimeseries: { municipalCode: '1310800', displayName: '江東区' },
      broadForecast: { areaCode: '130010', displayName: '東京地方' },
      temperatureForecast: { stationCode: '44132', displayName: '東京（北の丸公園）' },
      amedas: { stationCode: '44136', displayName: '江戸川臨海', elements: '11112010' },
      bosaiBulletin: { includedAreaCodes: ['1310800', '130012', '130010'] },
    },
    {
      venueId: 'trc',
      venueName: '東京流通センター',
      experimental: true,
      mapReference: { latitude: 35.58138, longitude: 139.748119 },
      warning: { municipalCode: '1311100', displayName: '大田区', prefectureCode: '130000' },
      warningTimeseries: { municipalCode: '1311100', displayName: '大田区' },
      broadForecast: { areaCode: '130010', displayName: '東京地方' },
      temperatureForecast: { stationCode: '44132', displayName: '東京（北の丸公園）' },
      amedas: { stationCode: '44166', displayName: '羽田', elements: '11110000' },
      bosaiBulletin: { includedAreaCodes: ['1311100', '130011', '130010'] },
    },
  ]);
  const east = registry.resolveVenueId('east');
  const trc = registry.resolveVenueId('trc');
  assert.ok(east);
  assert.ok(trc);
  assert.equal(registry.getVenue(east), registry.listVenues()[0]);
  assert.equal(registry.getVenue(trc), registry.listVenues()[1]);
});

test('会場 ID はレジストリで検証してから取得する', () => {
  assert.deepEqual(registry.listVenueIds(), ['east', 'trc']);
  assert.equal(registry.resolveVenueId('east'), 'east');
  assert.equal(registry.resolveVenueId('trc'), 'trc');
  assert.equal(registry.resolveVenueId('osaka'), null);
  assert.equal(registry.resolveVenueId(''), null);
  assert.equal(registry.resolveVenueId(null), null);
  assert.equal(registry.resolveVenueId(undefined), null);
  assert.equal(registry.resolveVenueId(1), null);
});

test('会場定義と配列は深く凍結され、重複 ID を拒否する', () => {
  const east = registry.getVenue(registry.resolveVenueId('east')!);
  assert.ok(Object.isFrozen(registry.listVenueIds()));
  assert.ok(Object.isFrozen(registry.listVenues()));
  assert.ok(Object.isFrozen(east));
  assert.ok(Object.isFrozen(east.mapReference));
  assert.ok(Object.isFrozen(east.bosaiBulletin.includedAreaCodes));
  assert.throws(() => createVenueRegistry([east, east], 'test'), /会場 ID が重複しています: east/);
});

test('会場ごとの市町村等警報コードは相異なる（§3.4 不変条件）', () => {
  const codes = registry.listVenues().map((venue) => venue.warning.municipalCode);
  assert.equal(new Set(codes).size, codes.length);
});

test('warning と warningTimeseries の市町村等コードは会場内で一致する（C3/C4 のキー整合）', () => {
  for (const target of registry.listVenues()) {
    assert.equal(target.warningTimeseries.municipalCode, target.warning.municipalCode);
  }
});
