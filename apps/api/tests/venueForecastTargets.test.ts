import assert from 'node:assert/strict';
import test from 'node:test';
import { testVenueRegistry, eastVenueId, trcVenueId } from './helpers/venueConfigPreload.js';
import {
  resolveAmedasTarget,
  resolveAreaTimeseriesForecastTarget,
  resolveBosaiBulletinTarget,
  resolveEarlyWarningTargetArea,
  resolveVenueWarningContext,
  resolveVenueWarningTimeseriesContext,
} from '../src/venueForecastTargets.js';

test('会場ごとの警報・時系列・アメダス対象を設定から解決する', () => {
  assert.equal(
    resolveVenueWarningContext(testVenueRegistry, eastVenueId).targetArea.municipalCode,
    '1310800',
  );
  assert.equal(
    resolveVenueWarningContext(testVenueRegistry, trcVenueId).targetArea.municipalCode,
    '1311100',
  );
  assert.equal(
    resolveVenueWarningTimeseriesContext(testVenueRegistry, trcVenueId).targetArea.municipalCode,
    '1311100',
  );
  assert.equal(resolveAmedasTarget(testVenueRegistry, eastVenueId).stationCode, '44136');
  assert.equal(resolveAmedasTarget(testVenueRegistry, trcVenueId).stationCode, '44166');
});

test('早期注意・地域時系列は会場ごとに解決する', () => {
  const early = resolveEarlyWarningTargetArea(testVenueRegistry, eastVenueId);
  const timeseries = resolveAreaTimeseriesForecastTarget(testVenueRegistry, eastVenueId);
  assert.equal(early.forecastAreaCode, timeseries.forecastAreaCode);
  assert.equal(timeseries.temperatureStationCode, '44132');
});

test('防災速報の対象は設定順で重複を除いた和集合を返す', () => {
  const codes = resolveBosaiBulletinTarget(testVenueRegistry).includedAreaCodes;
  const expected = [
    ...new Set(
      testVenueRegistry.listVenues().flatMap((venue) => venue.bosaiBulletin.includedAreaCodes),
    ),
  ];
  assert.deepEqual(codes, expected);
});
