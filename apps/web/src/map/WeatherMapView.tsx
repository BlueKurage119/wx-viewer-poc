import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { Venue } from '../shell/config';
import type { MapLayerId, TimelineIntent, TimelineViewModel } from './types';
import { LAYER_PRESENTATIONS, sampleNowcastTimeline, sampleKikikuruTimeline } from './fixtures';
import { MapViewport, type MapViewportHandle } from './MapViewport';
import { MapInformationColumnSlot } from './MapInformationColumnSlot';
import { MapLegend } from './MapLegend';
import { MapAttribution } from './MapAttribution';
import { MapZoomControls } from './MapZoomControls';
import { TimelineControlCard } from './TimelineControlCard';
import { LayerSelector } from './LayerSelector';

export interface WeatherMapViewProps {
  venue: Venue;
  initialTimeline?: TimelineViewModel;
}

/**
 * 防災気象情報地図ビュー統括コンポーネント (F1, F4, F5, F6)
 */
export function WeatherMapView({ venue, initialTimeline }: WeatherMapViewProps) {
  const [selectedLayerId, setSelectedLayerId] = useState<MapLayerId>('nowcast');
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

  // レイヤー別の初期ビューモデル選択
  const baseTimeline = useMemo(() => {
    if (initialTimeline) return initialTimeline;
    if (selectedLayerId.startsWith('kikikuru')) {
      return {
        ...sampleKikikuruTimeline,
        layerLabel: LAYER_PRESENTATIONS[selectedLayerId].label,
      };
    }
    return sampleNowcastTimeline;
  }, [initialTimeline, selectedLayerId]);

  // タイムラインの選択・再生内部状態
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(
    () => baseTimeline.selectedFrameId,
  );
  const [playing, setPlaying] = useState(false);

  // レイヤー切り替え時にフレーム選択を同期
  useEffect(() => {
    setSelectedFrameId(baseTimeline.selectedFrameId);
    setPlaying(false);
  }, [baseTimeline]);

  const frames = baseTimeline.frames;
  const currentIndex = selectedFrameId ? frames.findIndex((f) => f.id === selectedFrameId) : -1;

  // 再生タイマー (1秒間隔)
  useEffect(() => {
    if (!playing || frames.length === 0) return;

    const timer = window.setInterval(() => {
      setSelectedFrameId((currentId) => {
        const idx = currentId ? frames.findIndex((f) => f.id === currentId) : -1;
        if (idx < 0 || idx >= frames.length - 1) {
          return frames[0]?.id ?? null;
        }
        return frames[idx + 1]?.id ?? null;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [playing, frames]);

  // Intent ハンドラー (F4)
  const handleIntent = useCallback(
    (intent: TimelineIntent) => {
      switch (intent.type) {
        case 'select-frame':
          setSelectedFrameId(intent.frameId);
          break;
        case 'previous-frame':
          if (currentIndex > 0) {
            const prev = frames[currentIndex - 1];
            if (prev) setSelectedFrameId(prev.id);
          }
          break;
        case 'next-frame':
          if (currentIndex < frames.length - 1) {
            const next = frames[currentIndex + 1];
            if (next) setSelectedFrameId(next.id);
          }
          break;
        case 'toggle-play':
          setPlaying((prev) => !prev);
          break;
        case 'select-latest': {
          const last = frames[frames.length - 1];
          if (last) setSelectedFrameId(last.id);
          break;
        }
      }
    },
    [currentIndex, frames],
  );

  // 現在の View Model を合成
  const currentFrame = currentIndex >= 0 ? frames[currentIndex] : undefined;
  const currentViewModel: TimelineViewModel = useMemo(
    () => ({
      layerLabel: LAYER_PRESENTATIONS[selectedLayerId].label,
      selectedFrameId,
      selectedFrameLabel: currentFrame ? `09/15 ${currentFrame.displayTime}` : '',
      frames,
      playing,
      latestAvailable: baseTimeline.latestAvailable,
    }),
    [selectedLayerId, selectedFrameId, currentFrame, frames, playing, baseTimeline.latestAvailable],
  );

  const presentation = LAYER_PRESENTATIONS[selectedLayerId];

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
          viewModel={currentViewModel}
          onIntent={handleIntent}
          layerSelector={
            <LayerSelector
              selectedLayerId={selectedLayerId}
              onLayerSelect={setSelectedLayerId}
              legendOpen={legendOpen}
              onOpenLegend={() => setLegendOpen(true)}
            />
          }
        />
      </div>
    </div>
  );
}
