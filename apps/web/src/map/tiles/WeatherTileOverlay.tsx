import { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import { resolveTileZoomPolicy } from './tileZoom';

export interface WeatherTileOverlayProps {
  readonly map: L.Map | null;
  /** null なら地図から外す。id が変わったときだけ差し替える */
  readonly frame: { readonly id: string; readonly urlTemplate: string } | null;
  readonly allowedZooms: readonly number[];
  readonly opacity: number;
  readonly swapTimeoutMs: number;
  readonly onSwapSettled?: (result: { frameId: string; complete: boolean }) => void;
  readonly onTileError?: (frameId: string) => void;
}

/**
 * ダブルバッファ (同時最大 2 枚) でタイルレイヤーを差し替える。
 * レイヤー種別・プロダクト非依存。
 */
export function WeatherTileOverlay({
  map,
  frame,
  allowedZooms,
  opacity,
  swapTimeoutMs,
  onSwapSettled,
  onTileError,
}: WeatherTileOverlayProps): null {
  const policy = resolveTileZoomPolicy(allowedZooms);

  const activeLayerRef = useRef<L.TileLayer | null>(null);
  const activeFrameIdRef = useRef<string | null>(null);

  const pendingLayerRef = useRef<L.TileLayer | null>(null);
  const pendingFrameIdRef = useRef<string | null>(null);
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSwapSettledRef = useRef(onSwapSettled);
  useEffect(() => {
    onSwapSettledRef.current = onSwapSettled;
  }, [onSwapSettled]);

  const onTileErrorRef = useRef(onTileError);
  useEffect(() => {
    onTileErrorRef.current = onTileError;
  }, [onTileError]);

  const clearPending = useCallback(() => {
    if (pendingTimeoutRef.current !== null) {
      clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
    }
    if (pendingLayerRef.current !== null) {
      pendingLayerRef.current.remove();
      pendingLayerRef.current = null;
    }
    pendingFrameIdRef.current = null;
  }, []);

  const removeAllLayers = useCallback(() => {
    clearPending();
    if (activeLayerRef.current !== null) {
      activeLayerRef.current.remove();
      activeLayerRef.current = null;
    }
    activeFrameIdRef.current = null;
  }, [clearPending]);

  // opacity 変更の即時反映
  useEffect(() => {
    if (activeLayerRef.current && map) {
      const isVisible = policy !== null && map.getZoom() >= policy.minDisplayZoom;
      if (isVisible) {
        activeLayerRef.current.setOpacity(opacity);
      }
    }
  }, [opacity, map, policy]);

  // ズーム変更時の表示・非表示制御
  useEffect(() => {
    if (!map || !policy) return;

    const handleZoom = () => {
      const currentZoom = map.getZoom();
      const isVisible = currentZoom >= policy.minDisplayZoom;

      if (!isVisible) {
        // 表示ズーム下限未満: レイヤーを地図から外す
        if (activeLayerRef.current && map.hasLayer(activeLayerRef.current)) {
          map.removeLayer(activeLayerRef.current);
        }
        if (pendingLayerRef.current && map.hasLayer(pendingLayerRef.current)) {
          map.removeLayer(pendingLayerRef.current);
        }
      } else {
        // 表示ズーム下限以上: レイヤーを地図へ載せる
        if (activeLayerRef.current && !map.hasLayer(activeLayerRef.current)) {
          activeLayerRef.current.addTo(map);
          activeLayerRef.current.setOpacity(opacity);
        }
        if (pendingLayerRef.current && !map.hasLayer(pendingLayerRef.current)) {
          pendingLayerRef.current.addTo(map);
          pendingLayerRef.current.setOpacity(0);
        }
      }
    };

    map.on('zoomend', handleZoom);
    return () => {
      map.off('zoomend', handleZoom);
    };
  }, [map, policy, opacity]);

  // コマ切替 (ダブルバッファ)
  useEffect(() => {
    if (!map || !policy || !frame) {
      removeAllLayers();
      return;
    }

    // 既に表示中と同じコマなら何もしない
    if (activeFrameIdRef.current === frame.id && activeLayerRef.current !== null) {
      return;
    }

    // 既に待機中のコマと同じなら多重処理しない
    if (pendingFrameIdRef.current === frame.id) {
      return;
    }

    // 以前の待機レイヤーがあれば破棄
    clearPending();

    const targetFrameId = frame.id;
    const currentZoom = map.getZoom();
    const isVisible = currentZoom >= policy.minDisplayZoom;

    const layer = L.tileLayer(frame.urlTemplate, {
      minNativeZoom: policy.nativeZoom,
      maxNativeZoom: policy.nativeZoom,
      minZoom: policy.minDisplayZoom,
      maxZoom: 18,
      tileSize: 256,
      opacity: 0,
      pane: 'overlayPane',
      crossOrigin: false,
      errorTileUrl: undefined,
      keepBuffer: 0,
    });

    layer.on('tileerror', () => {
      onTileErrorRef.current?.(targetFrameId);
    });

    let settled = false;
    const settle = (complete: boolean) => {
      if (settled) return;
      settled = true;

      if (pendingTimeoutRef.current !== null) {
        clearTimeout(pendingTimeoutRef.current);
        pendingTimeoutRef.current = null;
      }

      // 新レイヤーの不透明度を反映
      if (isVisible && map.hasLayer(layer)) {
        layer.setOpacity(opacity);
      }

      // 旧レイヤーを地図から外して破棄
      if (activeLayerRef.current !== null) {
        activeLayerRef.current.remove();
      }

      activeLayerRef.current = layer;
      activeFrameIdRef.current = targetFrameId;
      pendingLayerRef.current = null;
      pendingFrameIdRef.current = null;

      onSwapSettledRef.current?.({ frameId: targetFrameId, complete });
    };

    pendingLayerRef.current = layer;
    pendingFrameIdRef.current = targetFrameId;

    if (!isVisible) {
      // ズーム下限未満のときはタイル要求を出さず即座に確定
      settle(true);
      return;
    }

    layer.on('load', () => {
      settle(true);
    });

    // タイムアウト設定 (最大 swapTimeoutMs 待つ)
    pendingTimeoutRef.current = setTimeout(() => {
      settle(false);
    }, swapTimeoutMs);

    // 地図へ追加 (初期は opacity: 0)
    layer.addTo(map);
  }, [map, policy, frame, opacity, swapTimeoutMs, clearPending, removeAllLayers]);

  // アンマウント時のクリーンアップ
  useEffect(() => {
    return () => {
      removeAllLayers();
    };
  }, [removeAllLayers]);

  return null;
}
