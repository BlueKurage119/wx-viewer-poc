import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AMEDAS_ELEMENT_SERIES,
  AMEDAS_LATEST_TIME_SOURCE_KIND,
  AMEDAS_LATEST_TIME_URL,
  AMEDAS_MISSING_EQUIVALENT_AQC,
  AMEDAS_POINT_SOURCE_KIND,
  buildPointBlockUrl,
  resolveBlockKey,
  resolveEstimatedElements,
  resolveUnsupportedElements,
} from '../src/polling/amedasSource.js';

test('定数の定義値の検証', () => {
  assert.equal(AMEDAS_LATEST_TIME_URL, 'https://www.jma.go.jp/bosai/amedas/data/latest_time.txt');
  assert.equal(AMEDAS_LATEST_TIME_SOURCE_KIND, 'amedas_latest_time');
  assert.equal(AMEDAS_POINT_SOURCE_KIND, 'amedas_point');
  assert.deepEqual(AMEDAS_MISSING_EQUIVALENT_AQC, [5, 6]);
  assert.equal(AMEDAS_ELEMENT_SERIES.length, 8);
});

test('resolveUnsupportedElements の動作検証', () => {
  // 11112010 (east) -> snow*, pressure, normalPressure を含む、humidity, sun10m, sun1h, temp を含まない
  const unsuppEast = resolveUnsupportedElements('11112010');
  for (const k of [
    'snow',
    'snow1h',
    'snow6h',
    'snow12h',
    'snow24h',
    'pressure',
    'normalPressure',
  ]) {
    assert.ok(unsuppEast.has(k), `should contain ${k}`);
  }
  for (const k of ['humidity', 'sun10m', 'sun1h', 'temp']) {
    assert.ok(!unsuppEast.has(k), `should not contain ${k}`);
  }

  // 11110000 (trc) -> 上記に加えて humidity, sun10m, sun1h を含む。temp, precipitation1h, windDirection, wind は含まない
  const unsuppTrc = resolveUnsupportedElements('11110000');
  for (const k of ['humidity', 'sun10m', 'sun1h', 'snow1h', 'pressure', 'normalPressure']) {
    assert.ok(unsuppTrc.has(k), `should contain ${k}`);
  }
  for (const k of ['temp', 'precipitation1h', 'windDirection', 'wind']) {
    assert.ok(!unsuppTrc.has(k), `should not contain ${k}`);
  }

  // 11111111 -> 空集合
  assert.equal(resolveUnsupportedElements('11111111').size, 0);

  // 00000000 -> 全キーを含む
  const unsuppAll = resolveUnsupportedElements('00000000');
  const allKeys = AMEDAS_ELEMENT_SERIES.flat();
  assert.equal(unsuppAll.size, allKeys.length);
  for (const k of allKeys) {
    assert.ok(unsuppAll.has(k));
  }

  // 不正形式での例外
  assert.throws(() => resolveUnsupportedElements('1111201'), /must match \^\[0-9\]\{8\}\$/);
  assert.throws(() => resolveUnsupportedElements('111120100'), /must match \^\[0-9\]\{8\}\$/);
  assert.throws(() => resolveUnsupportedElements('1111201x'), /must match \^\[0-9\]\{8\}\$/);
});

test('resolveEstimatedElements の動作検証', () => {
  // 11112010 -> sun10m, sun1h のちょうど2キー
  const estEast = resolveEstimatedElements('11112010');
  assert.equal(estEast.size, 2);
  assert.ok(estEast.has('sun10m'));
  assert.ok(estEast.has('sun1h'));
  assert.ok(!estEast.has('temp'));
  assert.ok(!estEast.has('humidity'));
  assert.ok(!estEast.has('snow1h'));

  // 11110000 (羽田) -> 空集合（日照桁は0で非対応であり推計ではない）
  const estTrc = resolveEstimatedElements('11110000');
  assert.equal(estTrc.size, 0);

  // 22222222 -> 全キー
  const estAll = resolveEstimatedElements('22222222');
  const allKeys = AMEDAS_ELEMENT_SERIES.flat();
  assert.equal(estAll.size, allKeys.length);

  // 11111111 -> 空集合
  assert.equal(resolveEstimatedElements('11111111').size, 0);

  // 不正形式での例外
  assert.throws(() => resolveEstimatedElements('1111201'), /must match \^\[0-9\]\{8\}\$/);
  assert.throws(() => resolveEstimatedElements('111120100'), /must match \^\[0-9\]\{8\}\$/);
  assert.throws(() => resolveEstimatedElements('1111201x'), /must match \^\[0-9\]\{8\}\$/);
});

test('resolveUnsupportedElements と resolveEstimatedElements が互いに素であること', () => {
  const cases = ['11112010', '11110000', '11111111', '00000000', '22222222', '01201201'];
  for (const c of cases) {
    const unsupp = resolveUnsupportedElements(c);
    const est = resolveEstimatedElements(c);
    for (const item of est) {
      assert.ok(!unsupp.has(item), `Disjoint check failed for case ${c} on element ${item}`);
    }
  }
});

test('resolveBlockKey の境界値および JST 日付計算', () => {
  // 2026-09-11T19:50:00+09:00 (UTC 2026-09-11T10:50:00.000Z) -> 20260911_18
  assert.equal(resolveBlockKey('2026-09-11T10:50:00.000Z'), '20260911_18');

  // JST 00:00:00 (UTC 2026-09-11T15:00:00.000Z) -> 20260912_00
  assert.equal(resolveBlockKey('2026-09-11T15:00:00.000Z'), '20260912_00');

  // JST 02:59:59 (UTC 2026-09-11T17:59:59.000Z) -> 20260912_00
  assert.equal(resolveBlockKey('2026-09-11T17:59:59.000Z'), '20260912_00');

  // JST 03:00:00 (UTC 2026-09-11T18:00:00.000Z) -> 20260912_03
  assert.equal(resolveBlockKey('2026-09-11T18:00:00.000Z'), '20260912_03');

  // JST 21:00:00 (UTC 2026-09-12T12:00:00.000Z) -> 20260912_21
  assert.equal(resolveBlockKey('2026-09-12T12:00:00.000Z'), '20260912_21');

  // JST 23:59:59 (UTC 2026-09-12T14:59:59.000Z) -> 20260912_21
  assert.equal(resolveBlockKey('2026-09-12T14:59:59.000Z'), '20260912_21');

  // 年跨ぎ: JST 2026-01-01T00:10:00+09:00 (UTC 2025-12-31T15:10:00.000Z)
  // UTC 日付ではなく JST 日付 20260101_00 を返すこと
  assert.equal(resolveBlockKey('2025-12-31T15:10:00.000Z'), '20260101_00');
});

test('buildPointBlockUrl の動作検証', () => {
  assert.equal(
    buildPointBlockUrl('44136', '20260911_18'),
    'https://www.jma.go.jp/bosai/amedas/data/point/44136/20260911_18.json',
  );
});
