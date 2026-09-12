import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_AMEDAS_TARGET,
  assertSharedAcrossVenues,
  resolveAmedasTarget,
  resolveAreaTimeseriesForecastTarget,
  resolveBosaiBulletinTarget,
  resolveEarlyWarningTargetArea,
  resolveSharedAreaTimeseriesForecastTarget,
  resolveSharedEarlyWarningTargetArea,
  resolveVenueWarningContext,
  resolveVenueWarningTimeseriesContext,
  resolveWarningCurrentTargetArea,
  resolveWarningTargetArea,
  resolveWarningTimeseriesTargetArea,
} from '../src/venueForecastTargets.js';

test('C2/C3/C4/C5/C6向けadapterが会場ごとの用途別対象を返す', () => {
  assert.deepEqual(resolveWarningTargetArea('east'), {
    municipalCode: '1310800',
    displayName: '江東区',
  });
  assert.deepEqual(resolveWarningCurrentTargetArea('east'), {
    municipalCode: '1310800',
    displayName: '江東区',
    prefectureCode: '130000',
  });
  assert.deepEqual(resolveWarningCurrentTargetArea('trc'), {
    municipalCode: '1311100',
    displayName: '大田区',
    prefectureCode: '130000',
  });
  assert.deepEqual(resolveWarningTimeseriesTargetArea('trc'), {
    municipalCode: '1311100',
    displayName: '大田区',
  });
  assert.deepEqual(resolveEarlyWarningTargetArea('east'), {
    forecastAreaCode: '130010',
    displayName: '東京地方',
  });
  assert.deepEqual(resolveEarlyWarningTargetArea('trc'), {
    forecastAreaCode: '130010',
    displayName: '東京地方',
  });
  assert.deepEqual(resolveAreaTimeseriesForecastTarget('east'), {
    forecastAreaCode: '130010',
    forecastAreaName: '東京地方',
    temperatureStationCode: '44132',
    temperatureStationName: '東京（北の丸公園）',
  });
  assert.deepEqual(resolveAreaTimeseriesForecastTarget('trc'), {
    forecastAreaCode: '130010',
    forecastAreaName: '東京地方',
    temperatureStationCode: '44132',
    temperatureStationName: '東京（北の丸公園）',
  });
});

test('C7向けadapterが両会場の速報判定対象（和集合・重複除去）を返す', () => {
  assert.deepEqual(resolveBosaiBulletinTarget(), {
    includedAreaCodes: ['1310800', '130012', '130010', '1311100', '130011'],
  });
});

test('C9向けadapterが会場定義からアメダス対象を解決する', () => {
  assert.deepEqual(resolveAmedasTarget('east'), {
    stationCode: '44136',
    displayName: '江戸川臨海',
    elements: '11112010',
  });
  assert.deepEqual(resolveAmedasTarget('trc'), {
    stationCode: '44166',
    displayName: '羽田',
    elements: '11110000',
  });
  assert.deepEqual(DEFAULT_AMEDAS_TARGET, resolveAmedasTarget('east'));
});

test('VenueWarningContext/VenueWarningTimeseriesContext は venueId と解決済み対象を対で運ぶ', () => {
  assert.deepEqual(resolveVenueWarningContext('east'), {
    venueId: 'east',
    targetArea: { municipalCode: '1310800', displayName: '江東区', prefectureCode: '130000' },
  });
  assert.deepEqual(resolveVenueWarningContext('trc'), {
    venueId: 'trc',
    targetArea: { municipalCode: '1311100', displayName: '大田区', prefectureCode: '130000' },
  });
  assert.deepEqual(resolveVenueWarningTimeseriesContext('east'), {
    venueId: 'east',
    targetArea: { municipalCode: '1310800', displayName: '江東区' },
  });
  assert.deepEqual(resolveVenueWarningTimeseriesContext('trc'), {
    venueId: 'trc',
    targetArea: { municipalCode: '1311100', displayName: '大田区' },
  });
});

test('resolveSharedEarlyWarningTargetArea/resolveSharedAreaTimeseriesForecastTarget は東地区の値を代表値として返す（現行会場定義では両会場一致）', () => {
  assert.deepEqual(resolveSharedEarlyWarningTargetArea(), resolveEarlyWarningTargetArea('east'));
  assert.deepEqual(
    resolveSharedAreaTimeseriesForecastTarget(),
    resolveAreaTimeseriesForecastTarget('east'),
  );
});

test('assertSharedAcrossVenues: 全会場が同一キーに解決すれば代表値を返す', () => {
  const result = assertSharedAcrossVenues(
    () => ({ code: 'X' }),
    (v) => v.code,
    'テスト対象',
  );
  assert.deepEqual(result, { code: 'X' });
});

test('assertSharedAcrossVenues: 会場ごとに異なるキーへ解決すると例外になる（§3.3.1 の表明）', () => {
  assert.throws(
    () =>
      assertSharedAcrossVenues(
        (venueId) => ({ code: venueId === 'east' ? 'X' : 'Y' }),
        (v) => v.code,
        'テスト対象',
      ),
    /テスト対象 は全会場で同一である前提が崩れています/,
  );
});
