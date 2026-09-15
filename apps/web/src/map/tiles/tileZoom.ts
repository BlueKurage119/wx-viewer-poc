export interface TileZoomPolicy {
  /** L.TileLayer の minNativeZoom / maxNativeZoom に渡す値 */
  readonly nativeZoom: number;
  /** この表示ズーム未満では気象レイヤーを地図へ載せない。nativeZoom - 1 (現状 9) */
  readonly minDisplayZoom: number;
}

/**
 * allowedZooms から native zoom と表示ズーム下限を算出する。
 * allowedZooms が空配列の場合は null (レイヤーを載せない)。
 */
export function resolveTileZoomPolicy(allowedZooms: readonly number[]): TileZoomPolicy | null {
  if (!allowedZooms || allowedZooms.length === 0) {
    return null;
  }
  const nativeZoom = Math.max(...allowedZooms);
  return {
    nativeZoom,
    minDisplayZoom: nativeZoom - 1,
  };
}
