import { useState, useRef, useEffect } from 'react';
import type L from 'leaflet';
import type { WeatherControlStatus } from '@wx-viewer-poc/shared';
import type { Venue } from '../shell/config';
import type { MapLayerId, TimelineIntent, TimelineViewModel } from './types';
import { LAYER_PRESENTATIONS, emptyTimeline } from './fixtures';
import { MapViewport, type MapViewportHandle } from './MapViewport';
import { MapInformationColumnSlot } from './MapInformationColumnSlot';
import { MapLegend } from './MapLegend';
import { MapAttribution } from './MapAttribution';
import { MapZoomControls } from './MapZoomControls';
import { TimelineControlCard } from './TimelineControlCard';
import { LayerSelector } from './LayerSelector';
import { useNowcastCatalog } from './nowcast/useNowcastCatalog';
import { usePlayback } from './nowcast/usePlayback';
import { WeatherTileOverlay } from './tiles/WeatherTileOverlay';

export interface WeatherMapViewProps {
  venue: Venue;
  terminalId?: string;
  controlStatus?: WeatherControlStatus;
  timelineViewModel?: TimelineViewModel;
  onTimelineIntent?: (intent: TimelineIntent) => void;
  selectedLayerId?: MapLayerId;
  onLayerSelect?: (layerId: MapLayerId) => void;
}

const NOWCAST_LAYER_OPACITY = 0.8;
const SWAP_TIMEOUT_MS = 12_000;

/**
 * 防災気象情報地図ビュー統括コンポーネント (F1, F2, F4, F5, F6)
 *
 * レイヤー選択、時間操作、ズーム、会場復帰、および気象タイルレイヤーの重ね描画を統合する。
 * 通常画面のデフォルト表示は空カタログ (emptyTimeline) とし、API 応答取得後に実データを反映する。
 */
export function WeatherMapView({
  venue,
  terminalId: propTerminalId,
  controlStatus = 'normal',
  timelineViewModel: controlledTimelineViewModel,
  onTimelineIntent,
  selectedLayerId: controlledLayerId,
  onLayerSelect,
}: WeatherMapViewProps) {
  const terminalId = propTerminalId ?? (venue.id === 'trc' ? 'htrcph01' : 'hkeagh01');

  const [internalLayerId, setInternalLayerId] = useState<MapLayerId>('nowcast');
  const currentLayerId = controlledLayerId ?? internalLayerId;
  const isNowcast = currentLayerId === 'nowcast';

  const [legendOpen, setLegendOpen] = useState(true);
  const [currentZoom, setCurrentZoom] = useState(11);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);

  // 右列 slot と時間カードの DOM 要素参照 (MapViewport の中心補正に渡す)
  const rightColumnRef = useRef<HTMLElement>(null);
  const bottomCardRef = useRef<HTMLDivElement>(null);
  const [rightColumnEl, setRightColumnEl] = useState<HTMLElement | null>(null);
  const [bottomCardEl, setBottomCardEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setRightColumnEl(rightColumnRef.current);
    setBottomCardEl(bottomCardRef.current);
  }, []);

  const viewportRef = useRef<MapViewportHandle>(null);

  // 雨雲ナウキャストの索引ポーリング
  const nowcastState = useNowcastCatalog({
    terminalId,
    controlStatus,
    enabled: isNowcast,
  });

  const catalog =
    nowcastState.status === 'ready' || nowcastState.status === 'stale'
      ? nowcastState.catalog
      : null;

  // 雨雲ナウキャストの再生・選択制御
  const {
    viewModel: internalViewModel,
    overlayFrame,
    handleIntent: internalHandleIntent,
    handleSwapSettled,
  } = usePlayback({
    catalog,
    terminalId,
    controlStatus,
    enabled: isNowcast,
  });

  const effectiveTimelineViewModel =
    controlledTimelineViewModel ?? (catalog ? internalViewModel : emptyTimeline);

  const handleLayerSelect = (layerId: MapLayerId) => {
    if (controlledLayerId === undefined) {
      setInternalLayerId(layerId);
    }
    onLayerSelect?.(layerId);
  };

  const handleIntent = (intent: TimelineIntent) => {
    internalHandleIntent(intent);
    onTimelineIntent?.(intent);
  };

  const presentation = LAYER_PRESENTATIONS[currentLayerId];

  // ズーム・会場復帰操作 (F6)
  const handleZoomIn = () => viewportRef.current?.zoomIn();
  const handleZoomOut = () => viewportRef.current?.zoomOut();
  const handleReturnToVenue = () => viewportRef.current?.returnToVenue();

  return (
    <div className="weather-map-view" aria-label="防災気象情報ビュー">
      {/* 気象タイルオーバーレイ (F2) */}
      <WeatherTileOverlay
        map={mapInstance}
        frame={overlayFrame}
        allowedZooms={catalog?.allowedZooms ?? [10]}
        opacity={NOWCAST_LAYER_OPACITY}
        swapTimeoutMs={SWAP_TIMEOUT_MS}
        onSwapSettled={handleSwapSettled}
      />

      {/* 1. 左上凡例カード／再表示ボタン (F5) */}
      <MapLegend
        presentation={presentation}
        open={legendOpen}
        onClose={() => setLegendOpen(false)}
        onOpen={() => setLegendOpen(true)}
      />

      {/* 2. 左下フローティングレイヤー選択 (F5) */}
      <LayerSelector selectedLayerId={currentLayerId} onLayerSelect={handleLayerSelect} />

      {/* 3. 下部中央時間操作カード (F4) */}
      <div className="timeline-card-wrapper">
        <TimelineControlCard
          ref={bottomCardRef}
          viewModel={effectiveTimelineViewModel}
          onIntent={handleIntent}
        />
      </div>

      {/* 4. 左下ズーム群および会場復帰 (F6) */}
      <MapZoomControls
        currentZoom={currentZoom}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onReturnToVenue={handleReturnToVenue}
      />

      {/* 5. 右下出典リンク (F5) */}
      <MapAttribution />

      {/* 6. 右側情報列スロット (F1 / G1) */}
      <MapInformationColumnSlot ref={rightColumnRef} />

      {/* 7. Leaflet 地図本体 (F1) - 背景レイヤー */}
      <MapViewport
        ref={viewportRef}
        venue={venue}
        rightColumnElement={rightColumnEl}
        bottomCardElement={bottomCardEl}
        onZoomChange={setCurrentZoom}
        onMapReady={setMapInstance}
      />
    </div>
  );
}
