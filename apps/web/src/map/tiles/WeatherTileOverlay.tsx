import { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import { resolveTileZoomPolicy } from './tileZoom';

export interface WeatherTileOverlayFrame {
  /** スライダー位置・通知の識別子。validTime 由来でよい (§8.3) */
  readonly id: string;
  /** 実際に要求するタイル URL。差し替え判定はこちらを含めて行う (§8.3) */
  readonly urlTemplate: string;
}

export interface WeatherTileOverlayProps {
  readonly map: L.Map | null;
  /** null なら地図から外す。差し替え判定は §8.3 の swapKey で行う */
  readonly frame: WeatherTileOverlayFrame | null;
  /** 再生の先読み対象。表示はせず、背景で読み込んで保持する (§9.3) */
  readonly prefetchFrames?: readonly WeatherTileOverlayFrame[];
  /** 再生中は読み込み済みレイヤーを保持する。false で active 以外を破棄 (§9.3) */
  readonly retainLoaded?: boolean;
  readonly allowedZooms: readonly number[];
  readonly opacity: number;
  readonly swapTimeoutMs: number;
  readonly onSwapSettled?: (result: { frameId: string; complete: boolean }) => void;
  readonly onTileError?: (frameId: string) => void;
}

interface OverlayLayerEntry {
  readonly frame: WeatherTileOverlayFrame;
  readonly layer: L.TileLayer;
  loaded: boolean;
}

/** 差し替え判定キー: id と urlTemplate の組み合わせ (§8.3) */
function getSwapKey(frame: WeatherTileOverlayFrame): string {
  return `${frame.id} ${frame.urlTemplate}`;
}

/**
 * 気象タイルレイヤーの重ね描画コンポーネント (共通モジュール 3)
 *
 * swapKey による差し替え判定 (§8.3) と、
 * 次コマ先読み・読込済みレイヤー保持 (リテンション) (§9.3) を提供する。
 */
export function WeatherTileOverlay({
  map,
  frame,
  prefetchFrames,
  retainLoaded = false,
  allowedZooms,
  opacity,
  swapTimeoutMs,
  onSwapSettled,
  onTileError,
}: WeatherTileOverlayProps): null {
  const policy = resolveTileZoomPolicy(allowedZooms);

  // swapKey をキーとするレイヤーマップ (リテンションプール兼 active/pending 管理)
  const layersRef = useRef<Map<string, OverlayLayerEntry>>(new Map());
  const activeSwapKeyRef = useRef<string | null>(null);
  const pendingSwapKeyRef = useRef<string | null>(null);
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
    if (pendingSwapKeyRef.current !== null) {
      const entry = layersRef.current.get(pendingSwapKeyRef.current);
      if (entry) {
        entry.layer.remove();
        layersRef.current.delete(pendingSwapKeyRef.current);
      }
      pendingSwapKeyRef.current = null;
    }
  }, []);

  /** active 以外のレイヤーをすべて破棄する (§9.3.3) */
  const purgeNonActiveLayers = useCallback(() => {
    if (pendingTimeoutRef.current !== null) {
      clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
    }
    pendingSwapKeyRef.current = null;

    for (const [key, entry] of layersRef.current.entries()) {
      if (key !== activeSwapKeyRef.current) {
        entry.layer.remove();
        layersRef.current.delete(key);
      }
    }
  }, []);

  /** すべてのレイヤーを破棄する */
  const removeAllLayers = useCallback(() => {
    if (pendingTimeoutRef.current !== null) {
      clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
    }
    pendingSwapKeyRef.current = null;

    for (const entry of layersRef.current.values()) {
      entry.layer.remove();
    }
    layersRef.current.clear();
    activeSwapKeyRef.current = null;
  }, []);

  // opacity 変更の即時反映
  useEffect(() => {
    if (activeSwapKeyRef.current && map && policy) {
      const isVisible = map.getZoom() >= policy.minDisplayZoom;
      if (isVisible) {
        const activeEntry = layersRef.current.get(activeSwapKeyRef.current);
        if (activeEntry) {
          activeEntry.layer.setOpacity(opacity);
        }
      }
    }
  }, [opacity, map, policy]);

  // 地図の moveend / zoomend を受けたら active 以外を全破棄 (§9.3.3)
  useEffect(() => {
    if (!map || !policy) return;

    const handleMapChange = () => {
      const currentZoom = map.getZoom();
      const isVisible = currentZoom >= policy.minDisplayZoom;

      if (!isVisible) {
        // 表示ズーム下限未満: レイヤーを地図から外す
        removeAllLayers();
      } else {
        // active 以外の保持レイヤーをすべて破棄し再開 (§9.3.3)
        purgeNonActiveLayers();

        // active レイヤーが存在していれば表示を同期
        if (activeSwapKeyRef.current) {
          const activeEntry = layersRef.current.get(activeSwapKeyRef.current);
          if (activeEntry) {
            if (!map.hasLayer(activeEntry.layer)) {
              activeEntry.layer.addTo(map);
            }
            activeEntry.layer.setOpacity(opacity);
          }
        }
      }
    };

    map.on('moveend', handleMapChange);
    map.on('zoomend', handleMapChange);
    return () => {
      map.off('moveend', handleMapChange);
      map.off('zoomend', handleMapChange);
    };
  }, [map, policy, opacity, purgeNonActiveLayers, removeAllLayers]);

  // retainLoaded が false に変化したときは active 以外を破棄
  useEffect(() => {
    if (!retainLoaded) {
      purgeNonActiveLayers();
    }
  }, [retainLoaded, purgeNonActiveLayers]);

  // L.TileLayer インスタンスの生成ヘルパー
  const createTileLayer = useCallback(
    (f: WeatherTileOverlayFrame) => {
      if (!policy) return null;
      const layer = L.tileLayer(f.urlTemplate, {
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
        onTileErrorRef.current?.(f.id);
      });

      return layer;
    },
    [policy],
  );

  // コマ切替 (swapKey による判定) および先読み
  useEffect(() => {
    if (!map || !policy || !frame) {
      removeAllLayers();
      return;
    }

    const targetSwapKey = getSwapKey(frame);
    const targetFrameId = frame.id;
    const currentZoom = map.getZoom();
    const isVisible = currentZoom >= policy.minDisplayZoom;

    // 先読みパイプラインの実行ヘルパー
    const executePrefetch = () => {
      if (!retainLoaded || !prefetchFrames || prefetchFrames.length === 0 || !isVisible) {
        return;
      }
      const targets = prefetchFrames.slice(0, 3);
      for (const pFrame of targets) {
        const pKey = getSwapKey(pFrame);
        if (pKey === activeSwapKeyRef.current || layersRef.current.has(pKey)) {
          continue;
        }
        const pLayer = createTileLayer(pFrame);
        if (!pLayer) continue;
        const pEntry: OverlayLayerEntry = { frame: pFrame, layer: pLayer, loaded: false };
        layersRef.current.set(pKey, pEntry);
        pLayer.once('load', () => {
          pEntry.loaded = true;
        });
        pLayer.addTo(map);
      }
    };

    if (!isVisible) {
      removeAllLayers();
      onSwapSettledRef.current?.({ frameId: targetFrameId, complete: true });
      return;
    }

    // 1. 既に表示中のコマと同じ swapKey なら何もしない (§8.3)
    if (activeSwapKeyRef.current === targetSwapKey) {
      executePrefetch();
      return;
    }

    // 2. 読込済みプールに存在するかチェック (§9.3.2)
    let targetEntry = layersRef.current.get(targetSwapKey);

    if (targetEntry && targetEntry.loaded) {
      // 読込済み (2周目以降または先読み完了): opacity の入れ替えだけで即座に切り替え
      clearPending();

      if (activeSwapKeyRef.current) {
        const oldActive = layersRef.current.get(activeSwapKeyRef.current);
        if (oldActive) {
          if (retainLoaded) {
            oldActive.layer.setOpacity(0);
          } else {
            oldActive.layer.remove();
            layersRef.current.delete(activeSwapKeyRef.current);
          }
        }
      }

      if (!map.hasLayer(targetEntry.layer)) {
        targetEntry.layer.addTo(map);
      }
      targetEntry.layer.setOpacity(opacity);
      activeSwapKeyRef.current = targetSwapKey;

      onSwapSettledRef.current?.({ frameId: targetFrameId, complete: true });
      executePrefetch();
      return;
    }

    // 3. 待機中のコマと同じ swapKey なら多重処理しない
    if (pendingSwapKeyRef.current === targetSwapKey) {
      executePrefetch();
      return;
    }

    // 4. 手動操作または別コマの待機があれば破棄
    clearPending();

    if (!targetEntry) {
      const newLayer = createTileLayer(frame);
      if (!newLayer) return;
      targetEntry = { frame, layer: newLayer, loaded: false };
      layersRef.current.set(targetSwapKey, targetEntry);
      newLayer.addTo(map);
    }

    pendingSwapKeyRef.current = targetSwapKey;

    let settled = false;
    const settle = (complete: boolean) => {
      if (settled) return;
      settled = true;

      if (pendingTimeoutRef.current !== null) {
        clearTimeout(pendingTimeoutRef.current);
        pendingTimeoutRef.current = null;
      }

      if (targetEntry) {
        targetEntry.loaded = true;
      }

      // 旧 active レイヤーの扱い
      if (activeSwapKeyRef.current) {
        const oldActive = layersRef.current.get(activeSwapKeyRef.current);
        if (oldActive) {
          if (retainLoaded) {
            oldActive.layer.setOpacity(0);
          } else {
            oldActive.layer.remove();
            layersRef.current.delete(activeSwapKeyRef.current);
          }
        }
      }

      // 新 active レイヤーの反映
      if (targetEntry && map.hasLayer(targetEntry.layer)) {
        targetEntry.layer.setOpacity(opacity);
      }
      activeSwapKeyRef.current = targetSwapKey;
      pendingSwapKeyRef.current = null;

      onSwapSettledRef.current?.({ frameId: targetFrameId, complete });
    };

    targetEntry.layer.once('load', () => {
      settle(true);
    });

    pendingTimeoutRef.current = setTimeout(() => {
      settle(false);
    }, swapTimeoutMs);

    executePrefetch();
  }, [
    map,
    policy,
    frame,
    prefetchFrames,
    retainLoaded,
    opacity,
    swapTimeoutMs,
    createTileLayer,
    clearPending,
    removeAllLayers,
  ]);

  // アンマウント時の全破棄
  useEffect(() => {
    return () => {
      removeAllLayers();
    };
  }, [removeAllLayers]);

  return null;
}
