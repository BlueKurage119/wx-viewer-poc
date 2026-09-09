import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveEarlyWarningTargetArea,
  resolveWarningCurrentTargetArea,
  resolveWarningTargetArea,
  resolveWarningTimeseriesTargetArea,
} from '../src/venueForecastTargets.js';

test('C2/C3/C4/C5向けadapterが会場ごとの用途別対象を返す', () => {
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
});
