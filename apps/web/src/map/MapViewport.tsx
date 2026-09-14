import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import L from 'leaflet';
import type { Venue } from '../shell/config';
import type { ViewPlacement } from './types';
import { calculateLeafletAdjustedCenter } from './projection';

export interface MapViewportHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  returnToVenue: () => void;
}

export interface MapViewportProps {
  venue: Venue;
  rightColumnElement: HTMLElement | null;
  bottomCardElement: HTMLElement | null;
  onZoomChange?: (zoom: number) => void;
  onPlacementChange?: (placement: ViewPlacement) => void;
}

const GSI_PALE_TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png';
const INITIAL_ZOOM = 11;
const MIN_ZOOM = 5;
const MAX_ZOOM = 18;

/**
 * 会場マーカー用 SVG アイコン (F1 §2.2)
 *
 * Vite のアセット解決に依存しないインライン SVG の L.divIcon。
 * 会場名を aria-label とした操作要素を持たず、フォーカス・クリックによる暗黙操作を行わない。
 */
function createVenueIcon(): L.DivIcon {
  return L.divIcon({
    className: 'wx-venue-marker-container',
    html: `<div class="wx-venue-marker-pin" aria-hidden="true">
      <svg width="28" height="36" viewBox="0 0 28 36" fill="none">
        <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 22 14 22s14-11.5 14-22c0-7.732-6.268-14-14-14z" fill="var(--md-sys-color-error-light)"/>
        <circle cx="14" cy="14" r="5" fill="var(--md-sys-color-on-error-light)"/>
      </svg>
    </div>`,
    iconSize: [28, 36],
    iconAnchor: [14, 36],
  });
}

/**
 * Leaflet 地図基盤コンテナ (F1 §2, §4, §9.2)
 *
 * 国土地理院の淡色地図、会場マーカー、可視矩形への会場中心補正、
 * リサイズ時の閲覧位置維持、ズーム・会場復帰の実行を提供する。
 */
export const MapViewport = forwardRef<MapViewportHandle, MapViewportProps>(function MapViewport(
  { venue, rightColumnElement, bottomCardElement, onZoomChange, onPlacementChange },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const placementRef = useRef<ViewPlacement>('initial');
  const layoutSettledRef = useRef(false);
  const scheduledRafRef = useRef<number | null>(null);

  const onZoomChangeRef = useRef(onZoomChange);
  useEffect(() => {
    onZoomChangeRef.current = onZoomChange;
  }, [onZoomChange]);

  const onPlacementChangeRef = useRef(onPlacementChange);
  useEffect(() => {
    onPlacementChangeRef.current = onPlacementChange;
  }, [onPlacementChange]);

  const setPlacement = useCallback((placement: ViewPlacement) => {
    placementRef.current = placement;
    onPlacementChangeRef.current?.(placement);
  }, []);

  /**
   * 現在の実寸（右列幅 R、時間カード高 B）を取得する
   */
  const getCurrentOffsets = useCallback(() => {
    const rightWidth = rightColumnElement ? rightColumnElement.getBoundingClientRect().width : 0;
    const bottomHeight = bottomCardElement ? bottomCardElement.getBoundingClientRect().height : 0;
    return { rightWidth, bottomHeight };
  }, [rightColumnElement, bottomCardElement]);

  /**
   * 会場を可視矩形の中心に配置する (F1 §4.1)
   */
  const alignVenueCenter = useCallback(
    (map: L.Map, zoom: number, animate = false) => {
      const { rightWidth, bottomHeight } = getCurrentOffsets();
      const mapCenter = calculateLeafletAdjustedCenter(
        map,
        venue.weatherTargets.mapReference,
        rightWidth,
        bottomHeight,
        zoom,
      );
      map.setView(mapCenter, zoom, { animate });
    },
    [getCurrentOffsets, venue.weatherTargets.mapReference],
  );

  /**
   * ズーム操作・会場復帰操作の外部公開メソッド (F6)
   */
  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => {
        const map = mapRef.current;
        if (!map) return;
        if (map.getZoom() < MAX_ZOOM) {
          setPlacement('manual');
          map.zoomIn();
        }
      },
      zoomOut: () => {
        const map = mapRef.current;
        if (!map) return;
        if (map.getZoom() > MIN_ZOOM) {
          setPlacement('manual');
          map.zoomOut();
        }
      },
      returnToVenue: () => {
        const map = mapRef.current;
        if (!map) return;
        setPlacement('returning');
        alignVenueCenter(map, INITIAL_ZOOM, false);
        setPlacement('initial');
      },
    }),
    [alignVenueCenter, setPlacement],
  );

  // Leaflet 地図インスタンスの生成と破棄
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = L.map(container, {
      attributionControl: false,
      zoomControl: false,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      center: [
        venue.weatherTargets.mapReference.latitude,
        venue.weatherTargets.mapReference.longitude,
      ],
      zoom: INITIAL_ZOOM,
    });
    mapRef.current = map;

    // 国土地理院淡色地図タイル
    const tileLayer = L.tileLayer(GSI_PALE_TILE_URL, {
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      attribution: '地理院タイル',
    });
    tileLayer.addTo(map);

    // 会場マーカーの配置 (非操作要素)
    const marker = L.marker(
      [venue.weatherTargets.mapReference.latitude, venue.weatherTargets.mapReference.longitude],
      {
        icon: createVenueIcon(),
        interactive: false, // クリックやフォーカスを無効化
        keyboard: false,
      },
    );
    marker.addTo(map);
    markerRef.current = marker;

    // ユーザーの手動操作イベント検知
    const handleUserOperation = () => {
      if (placementRef.current !== 'returning') {
        setPlacement('manual');
      }
    };

    const handleZoom = () => {
      onZoomChangeRef.current?.(map.getZoom());
    };

    map.on('dragstart', handleUserOperation);
    map.on('zoomstart', handleUserOperation);
    map.on('zoomend', handleZoom);

    return () => {
      map.off('dragstart', handleUserOperation);
      map.off('zoomstart', handleUserOperation);
      map.off('zoomend', handleZoom);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [venue, setPlacement]);

  // 会場が変わった場合のマーカー更新
  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;
    marker.setLatLng([
      venue.weatherTargets.mapReference.latitude,
      venue.weatherTargets.mapReference.longitude,
    ]);
  }, [venue]);

  // ResizeObserver と中心補正・閲覧位置維持 (F1 §4.2)
  useEffect(() => {
    const container = containerRef.current;
    const map = mapRef.current;
    if (!container || !map) return;

    const scheduleRecalculation = () => {
      if (scheduledRafRef.current !== null) {
        cancelAnimationFrame(scheduledRafRef.current);
      }

      scheduledRafRef.current = requestAnimationFrame(() => {
        scheduledRafRef.current = null;
        const currentMap = mapRef.current;
        if (!currentMap) return;

        // 地図コンテナ寸法の変化に追従
        currentMap.invalidateSize({ pan: false });

        const containerRect = container.getBoundingClientRect();
        const { rightWidth, bottomHeight } = getCurrentOffsets();

        // 3要素のサイズが正の値であるか確認
        const hasPositiveDimensions =
          containerRect.width > 0 && containerRect.height > 0 && rightWidth > 0 && bottomHeight > 0;

        // 初期レイアウトの確定判定 (§4.2)
        if (!layoutSettledRef.current) {
          if (hasPositiveDimensions) {
            const checkFontsAndAlign = async () => {
              if (document.fonts) {
                try {
                  await document.fonts.ready;
                } catch {
                  // フォント準備エラーは無視して進行
                }
              }
              requestAnimationFrame(() => {
                if (mapRef.current && placementRef.current === 'initial') {
                  alignVenueCenter(mapRef.current, INITIAL_ZOOM, false);
                  layoutSettledRef.current = true;
                }
              });
            };
            void checkFontsAndAlign();
          }
        } else {
          // 初期レイアウト確定後:
          // returning の場合のみ会場中心補正、manual の場合は invalidateSize のみで位置維持
          if (placementRef.current === 'returning') {
            alignVenueCenter(currentMap, INITIAL_ZOOM, false);
            setPlacement('initial');
          }
        }
      });
    };

    const resizeObserver = new ResizeObserver(() => {
      scheduleRecalculation();
    });

    resizeObserver.observe(container);
    if (rightColumnElement) resizeObserver.observe(rightColumnElement);
    if (bottomCardElement) resizeObserver.observe(bottomCardElement);

    // 初回計測
    scheduleRecalculation();

    return () => {
      resizeObserver.disconnect();
      if (scheduledRafRef.current !== null) {
        cancelAnimationFrame(scheduledRafRef.current);
        scheduledRafRef.current = null;
      }
    };
  }, [alignVenueCenter, getCurrentOffsets, rightColumnElement, bottomCardElement, setPlacement]);

  return (
    <div ref={containerRef} className="map-viewport" aria-label="会場周辺の地図" tabIndex={0} />
  );
});
