import { useState, useRef, useEffect } from 'react';
import type { Venue } from '../shell/config';
import type { MapLayerId, TimelineIntent, TimelineViewModel } from './types';
import { LAYER_PRESENTATIONS, sampleNowcastTimeline } from './fixtures';
import { MapViewport, type MapViewportHandle } from './MapViewport';
import { MapInformationColumnSlot } from './MapInformationColumnSlot';
import { MapLegend } from './MapLegend';
import { MapAttribution } from './MapAttribution';
import { MapZoomControls } from './MapZoomControls';
import { TimelineControlCard } from './TimelineControlCard';
import { LayerSelector } from './LayerSelector';

export interface WeatherMapViewProps {
  venue: Venue;
  timelineViewModel?: TimelineViewModel;
  onTimelineIntent?: (intent: TimelineIntent) => void;
  selectedLayerId?: MapLayerId;
  onLayerSelect?: (layerId: MapLayerId) => void;
}

/**
 * 防災気象情報地図ビュー統括コンポーネント (F1, F4, F5, F6)
 *
 * F4/F5 の責務境界に従い、タイムライン表示モデルの描画と、
 * ユーザー操作による TimelineIntent / レイヤー選択の通知のみを行う。
 * 時刻選択遷移・再生タイマー・最新追従・カタログ切り替えは後続 (F2/F3/F7) の所有とする。
 */
export function WeatherMapView({
  venue,
  timelineViewModel = sampleNowcastTimeline,
  onTimelineIntent,
  selectedLayerId: controlledLayerId,
  onLayerSelect,
}: WeatherMapViewProps) {
  const [internalLayerId, setInternalLayerId] = useState<MapLayerId>('nowcast');
  const currentLayerId = controlledLayerId ?? internalLayerId;

  const [legendOpen, setLegendOpen] = useState(true);
  const [currentZoom, setCurrentZoom] = useState(10);

  // 右列 slot と時間カードの DOM 要素参照（MapViewport の中心補正に渡す）
  const rightColumnRef = useRef<HTMLElement>(null);
  const bottomCardRef = useRef<HTMLDivElement>(null);
  const [rightColumnEl, setRightColumnEl] = useState<HTMLElement | null>(null);
  const [bottomCardEl, setBottomCardEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setRightColumnEl(rightColumnRef.current);
    setBottomCardEl(bottomCardRef.current);
  }, []);

  const viewportRef = useRef<MapViewportHandle>(null);

  const handleLayerSelect = (layerId: MapLayerId) => {
    if (controlledLayerId === undefined) {
      setInternalLayerId(layerId);
    }
    onLayerSelect?.(layerId);
  };

  const handleIntent = (intent: TimelineIntent) => {
    onTimelineIntent?.(intent);
  };

  const presentation = LAYER_PRESENTATIONS[currentLayerId];

  // ズーム・会場復帰操作 (F6)
  const handleZoomIn = () => viewportRef.current?.zoomIn();
  const handleZoomOut = () => viewportRef.current?.zoomOut();
  const handleReturnToVenue = () => viewportRef.current?.returnToVenue();

  return (
    <div className="weather-map-view" aria-label="防災気象情報ビュー">
      {/* Leaflet 地図本体 (F1) */}
      <MapViewport
        ref={viewportRef}
        venue={venue}
        rightColumnElement={rightColumnEl}
        bottomCardElement={bottomCardEl}
        onZoomChange={setCurrentZoom}
      />

      {/* 右側情報列スロット (F1 / G1) */}
      <MapInformationColumnSlot ref={rightColumnRef} />

      {/* 左上凡例カード (F5) */}
      <MapLegend
        presentation={presentation}
        open={legendOpen}
        onClose={() => setLegendOpen(false)}
      />

      {/* 右下出典リンク (F5) */}
      <MapAttribution />

      {/* 左下ズーム群および会場復帰 (F6) */}
      <MapZoomControls
        currentZoom={currentZoom}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onReturnToVenue={handleReturnToVenue}
      />

      {/* 下部中央時間操作カード (F4) */}
      <div className="timeline-card-wrapper">
        <TimelineControlCard
          ref={bottomCardRef}
          viewModel={timelineViewModel}
          onIntent={handleIntent}
          layerSelector={
            <LayerSelector
              selectedLayerId={currentLayerId}
              onLayerSelect={handleLayerSelect}
              legendOpen={legendOpen}
              onOpenLegend={() => setLegendOpen(true)}
            />
          }
        />
      </div>
    </div>
  );
}
