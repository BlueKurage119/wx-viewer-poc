import type { GeoPoint, PixelPoint, MapAdjustedDimensions } from './types';

/**
 * Web Mercator (EPSG:3857) におけるズームレベルに応じた全体ピクセルサイズ
 */
export function mercatorScale(zoom: number): number {
  return 256 * Math.pow(2, zoom);
}

/**
 * 緯度経度から Web Mercator ピクセル座標への投影 (EPSG:3857)
 */
export function projectWebMercator(point: GeoPoint, zoom: number): PixelPoint {
  const scale = mercatorScale(zoom);
  const x = (scale * (point.longitude + 180)) / 360;
  const sin = Math.sin((point.latitude * Math.PI) / 180);
  // 極端な緯度での発散を防ぐためクリップ
  const clampedSin = Math.max(-0.9999999999, Math.min(0.9999999999, sin));
  const y = scale * (0.5 - Math.log((1 + clampedSin) / (1 - clampedSin)) / (4 * Math.PI));
  return { x, y };
}

/**
 * Web Mercator ピクセル座標から緯度経度への逆投影 (EPSG:3857)
 */
export function unprojectWebMercator(pixel: PixelPoint, zoom: number): GeoPoint {
  const scale = mercatorScale(zoom);
  const longitude = (pixel.x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * pixel.y) / scale;
  const latitude = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { latitude, longitude };
}

/**
 * 可視矩形（右列幅 R、下部カード高 B を差し引いた領域）の中心画面内座標を計算する。
 * x: 0 .. W - R, y: 0 .. H - B
 * 目標の画面内座標: ((W - R) / 2, (H - B) / 2)
 */
export function calculateVisibleRectCenter(dimensions: MapAdjustedDimensions): PixelPoint {
  const { containerWidth, containerHeight, rightColumnWidth, bottomCardHeight } = dimensions;
  const visibleWidth = Math.max(0, containerWidth - rightColumnWidth);
  const visibleHeight = Math.max(0, containerHeight - bottomCardHeight);
  return {
    x: visibleWidth / 2,
    y: visibleHeight / 2,
  };
}

/**
 * 会場を可視矩形の中心に置くための地図中心座標（画面中央 W/2, H/2 に対応する地理座標）を計算する。
 *
 * 設計書 §4.1:
 * mapCenter = unproject(
 *   project(venue.mapReference, zoom) + (R / 2, B / 2),
 *   zoom,
 * )
 */
export function calculateAdjustedMapCenter(
  venueReference: GeoPoint,
  dimensions: MapAdjustedDimensions,
  zoom: number,
): GeoPoint {
  const { rightColumnWidth, bottomCardHeight } = dimensions;
  const venuePixel = projectWebMercator(venueReference, zoom);
  const adjustedPixel: PixelPoint = {
    x: venuePixel.x + rightColumnWidth / 2,
    y: venuePixel.y + bottomCardHeight / 2,
  };
  return unprojectWebMercator(adjustedPixel, zoom);
}

/**
 * Leaflet の Map インスタンスを用いて中心補正座標を算出する。
 * map.project / map.unproject を使用する。
 */
export interface LeafletProjector {
  project(
    latlng: [number, number] | { lat: number; lng: number },
    zoom?: number,
  ): {
    x: number;
    y: number;
  };
  unproject(
    point: [number, number] | { x: number; y: number },
    zoom?: number,
  ): {
    lat: number;
    lng: number;
  };
}

export function calculateLeafletAdjustedCenter(
  projector: LeafletProjector,
  venueReference: GeoPoint,
  rightColumnWidth: number,
  bottomCardHeight: number,
  zoom: number,
): { lat: number; lng: number } {
  const venuePixel = projector.project(
    { lat: venueReference.latitude, lng: venueReference.longitude },
    zoom,
  );
  const shiftedPixel = {
    x: venuePixel.x + rightColumnWidth / 2,
    y: venuePixel.y + bottomCardHeight / 2,
  };
  return projector.unproject(shiftedPixel, zoom);
}
