import assert from 'node:assert/strict';
import test from 'node:test';
import { VENUE_FORECAST_TARGETS, resolveVenueForecastTargets } from '../src/index.ts';

test('会場別の気象対象を用途ごとに完全一致で解決する', () => {
  assert.deepEqual(VENUE_FORECAST_TARGETS, {
    east: {
      venueId: 'east',
      venueName: '東京ビッグサイト',
      mapReference: { latitude: 35.63159368010876, longitude: 139.79281040119963 },
      warning: { municipalCode: '1310800', displayName: '江東区', prefectureCode: '130000' },
      warningTimeseries: { municipalCode: '1310800', displayName: '江東区' },
      broadForecast: { areaCode: '130010', displayName: '東京地方' },
      temperatureForecast: { stationCode: '44132', displayName: '東京（北の丸公園）' },
      amedas: { stationCode: '44136', displayName: '江戸川臨海', elements: '11112010' },
      bosaiBulletin: { includedAreaCodes: ['1310800', '130012', '130010'] },
    },
    trc: {
      venueId: 'trc',
      venueName: '東京流通センター',
      mapReference: { latitude: 35.58138, longitude: 139.748119 },
      warning: { municipalCode: '1311100', displayName: '大田区', prefectureCode: '130000' },
      warningTimeseries: { municipalCode: '1311100', displayName: '大田区' },
      broadForecast: { areaCode: '130010', displayName: '東京地方' },
      temperatureForecast: { stationCode: '44132', displayName: '東京（北の丸公園）' },
      amedas: { stationCode: '44166', displayName: '羽田', elements: '11110000' },
      bosaiBulletin: { includedAreaCodes: ['1311100', '130011', '130010'] },
    },
  });
  assert.equal(resolveVenueForecastTargets('east'), VENUE_FORECAST_TARGETS.east);
  assert.equal(resolveVenueForecastTargets('trc'), VENUE_FORECAST_TARGETS.trc);
});
