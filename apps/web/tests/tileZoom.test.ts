import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveTileZoomPolicy } from '../src/map/tiles/tileZoom.ts';

test('tileZoom: allowedZooms から nativeZoom と minDisplayZoom を正しく算出する (§6.1)', () => {
  const policy = resolveTileZoomPolicy([10]);
  assert.ok(policy);
  assert.equal(policy.nativeZoom, 10);
  assert.equal(policy.minDisplayZoom, 9);

  const policyMulti = resolveTileZoomPolicy([8, 10]);
  assert.ok(policyMulti);
  assert.equal(policyMulti.nativeZoom, 10);
  assert.equal(policyMulti.minDisplayZoom, 9);
});

test('tileZoom: allowedZooms が空配列の場合は null を返す', () => {
  assert.equal(resolveTileZoomPolicy([]), null);
});
