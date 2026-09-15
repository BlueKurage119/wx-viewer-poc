import { useState, useRef, useEffect } from 'react';
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
 * 通常画面のデフォルト表示は空カタログ (emptyTimeline) とし、固定日時の fixture は描画しない。
 * DOM 順序はキーボードフォーカス順（凡例 → レイヤー選択と時間操作 → ズーム → 会場復帰）に準拠する。
 */
export function WeatherMapView({
  venue,
  timelineViewModel = emptyTimeline,
  onTimelineIntent,
  selectedLayerId: controlledLayerId,
  onLayerSelect,
}: WeatherMapViewProps) {
  const [internalLayerId, setInternalLayerId] = useState<MapLayerId>('nowcast');
  const currentLayerId = controlledLayerId ?? internalLayerId;

  const [legendOpen, setLegendOpen] = useState(true);
  const [currentZoom, setCurrentZoom] = useState(11);

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
          viewModel={timelineViewModel}
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
      />
    </div>
  );
}
