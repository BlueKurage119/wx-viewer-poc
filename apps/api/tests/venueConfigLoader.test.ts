import assert from 'node:assert/strict';
import test from 'node:test';
import { loadVenueConfig, validateVenueConfig } from '../src/config/venueConfigLoader.js';

test('会場 YAML は旧2会場を順序どおり読み込み、世代とレジストリを生成する', () => {
  const loaded = loadVenueConfig({ environment: 'production' });
  assert.deepEqual(loaded.registry.listVenueIds(), ['east', 'trc']);
  assert.equal(loaded.response.generation.length, 64);
  assert.deepEqual(
    loaded.response.venues.map((venue) => venue.venueName),
    ['東京ビッグサイト', '東京流通センター'],
  );
});

test('会場設定は未知キーと会場内の対象不整合を拒否する', () => {
  assert.throws(
    () => validateVenueConfig({ venues: [{ id: 'east', unknown: true }] }),
    /venues\[0\]\.unknown/,
  );
  assert.throws(
    () =>
      validateVenueConfig({
        venues: [
          {
            id: 'test',
            name: '試験会場',
            experimental: false,
            mapReference: { latitude: 0, longitude: 0 },
            warning: { municipalCode: '1310800', displayName: '江東区', prefectureCode: '130000' },
            warningTimeseries: { municipalCode: '1310800', displayName: '江東区' },
            broadForecast: { areaCode: '130010', displayName: '東京地方' },
            temperatureForecast: { stationCode: '44132', displayName: '東京' },
            amedas: { stationCode: '44136', displayName: '江戸川臨海', elements: '11112010' },
            bosaiBulletin: { includedAreaCodes: ['1310800'] },
          },
        ],
      }),
    /venues\[0\]\.bosaiBulletin\.includedAreaCodes/,
  );
});
