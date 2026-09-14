import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateVisibleRectCenter,
  calculateAdjustedMapCenter,
  calculateLeafletAdjustedCenter,
  projectWebMercator,
  unprojectWebMercator,
} from '../src/map/projection.ts';
import { resolveVenueForecastTargets } from '@wx-viewer-poc/shared';

const eastVenue = resolveVenueForecastTargets('east').mapReference;
const trcVenue = resolveVenueForecastTargets('trc').mapReference;

test('可視矩形の中心計算が幅・高さから右列幅・下部カード高を差し引いた中央座標と完全一致する', () => {
  // W=1920, H=1080, R=400, B=200
  // visibleWidth = 1520, visibleHeight = 880
  // center = (760, 440)
  const fhd = calculateVisibleRectCenter({
    containerWidth: 1920,
    containerHeight: 1080,
    rightColumnWidth: 400,
    bottomCardHeight: 200,
  });
  assert.deepEqual(fhd, { x: 760, y: 440 });

  // iPad 横向き想定: W=1024, H=768, R=288, B=180
  // visibleWidth = 736, visibleHeight = 588
  // center = (368, 294)
  const ipad = calculateVisibleRectCenter({
    containerWidth: 1024,
    containerHeight: 768,
    rightColumnWidth: 288,
    bottomCardHeight: 180,
  });
  assert.deepEqual(ipad, { x: 368, y: 294 });

  // R=0, B=0 のときは画面中心 (W/2, H/2) と一致する
  const zero = calculateVisibleRectCenter({
    containerWidth: 1000,
    containerHeight: 800,
    rightColumnWidth: 0,
    bottomCardHeight: 0,
  });
  assert.deepEqual(zero, { x: 500, y: 400 });
});

test('R=0, B=0 の補正中心は会場の基準位置そのものと一致する', () => {
  const zoom = 10;
  for (const venue of [eastVenue, trcVenue]) {
    const center = calculateAdjustedMapCenter(
      venue,
      {
        containerWidth: 1920,
        containerHeight: 1080,
        rightColumnWidth: 0,
        bottomCardHeight: 0,
      },
      zoom,
    );
    // 浮動小数点精度の範囲内で完全一致（差が 1e-9 未満）
    assert.ok(Math.abs(center.latitude - venue.latitude) < 1e-9);
    assert.ok(Math.abs(center.longitude - venue.longitude) < 1e-9);
  }
});

test('会場中心補正により、画面中心に補正中心を置いたとき会場の画面内座標が可視矩形中心と一致する (F1 §4.1, §9.2)', () => {
  const testCases = [
    {
      venue: eastVenue,
      name: 'east (フルHD)',
      dims: {
        containerWidth: 1920,
        containerHeight: 1080,
        rightColumnWidth: 400,
        bottomCardHeight: 220,
      },
      zoom: 10,
    },
    {
      venue: trcVenue,
      name: 'trc (フルHD)',
      dims: {
        containerWidth: 1920,
        containerHeight: 1080,
        rightColumnWidth: 360,
        bottomCardHeight: 180,
      },
      zoom: 10,
    },
    {
      venue: eastVenue,
      name: 'east (iPad横向き)',
      dims: {
        containerWidth: 1024,
        containerHeight: 768,
        rightColumnWidth: 280,
        bottomCardHeight: 160,
      },
      zoom: 10,
    },
    {
      venue: trcVenue,
      name: 'trc (iPad横向き)',
      dims: {
        containerWidth: 1024,
        containerHeight: 768,
        rightColumnWidth: 288,
        bottomCardHeight: 190,
      },
      zoom: 10,
    },
  ];

  for (const tc of testCases) {
    const targetScreenCenter = calculateVisibleRectCenter(tc.dims);
    const adjustedMapCenter = calculateAdjustedMapCenter(tc.venue, tc.dims, tc.zoom);

    // Leaflet の latLngToContainerPoint の計算論理:
    // containerPoint = project(point, zoom) - project(mapCenter, zoom) + (W / 2, H / 2)
    const venuePixel = projectWebMercator(tc.venue, tc.zoom);
    const mapCenterPixel = projectWebMercator(adjustedMapCenter, tc.zoom);

    const actualScreenX = venuePixel.x - mapCenterPixel.x + tc.dims.containerWidth / 2;
    const actualScreenY = venuePixel.y - mapCenterPixel.y + tc.dims.containerHeight / 2;

    // 設計書 §9.2: 可視矩形の中心から ±2 CSS px 以内にあること
    const diffX = Math.abs(actualScreenX - targetScreenCenter.x);
    const diffY = Math.abs(actualScreenY - targetScreenCenter.y);

    assert.ok(
      diffX < 0.001,
      `${tc.name}: 画面内X座標のズレが0.001px未満であること (diffX=${diffX})`,
    );
    assert.ok(
      diffY < 0.001,
      `${tc.name}: 画面内Y座標のズレが0.001px未満であること (diffY=${diffY})`,
    );
  }
});

test('calculateLeafletAdjustedCenter は Leaflet の project/unproject を使って純粋計算と等価な中心を算出する', () => {
  const zoom = 10;
  const dims = {
    containerWidth: 1920,
    containerHeight: 1080,
    rightColumnWidth: 384,
    bottomCardHeight: 210,
  };

  // Leaflet の Map.project / unproject 互換のモック
  const mockProjector = {
    project(latlng: { lat: number; lng: number }, z?: number) {
      const p = projectWebMercator({ latitude: latlng.lat, longitude: latlng.lng }, z ?? zoom);
      return { x: p.x, y: p.y };
    },
    unproject(point: { x: number; y: number }, z?: number) {
      const geo = unprojectWebMercator(point, z ?? zoom);
      return { lat: geo.latitude, lng: geo.longitude };
    },
  };

  const expected = calculateAdjustedMapCenter(eastVenue, dims, zoom);
  const actual = calculateLeafletAdjustedCenter(
    mockProjector,
    eastVenue,
    dims.rightColumnWidth,
    dims.bottomCardHeight,
    zoom,
  );

  assert.ok(Math.abs(actual.lat - expected.latitude) < 1e-9);
  assert.ok(Math.abs(actual.lng - expected.longitude) < 1e-9);
});
