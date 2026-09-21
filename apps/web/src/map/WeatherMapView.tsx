import { useState, useRef, useEffect, useMemo } from 'react';
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
import { NowcastLoadingSpinner } from './nowcast/NowcastLoadingSpinner';
import { useKikikuruCatalog } from './kikikuru/useKikikuruCatalog';
import { useKikikuruLayerState } from './kikikuru/useKikikuruLayerState';
import { isKikikuruLayer } from './kikikuru/kikikuruCatalog';
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
const KIKIKURU_LAYER_OPACITY = 0.75;
const SWAP_TIMEOUT_MS = 12_000;

/**
 * 防災気象情報地図ビュー統括コンポーネント (F1, F2, F3, F4, F5, F6)
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
  const isKikikuru = isKikikuruLayer(currentLayerId);

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

  const nowcastCatalog =
    nowcastState.status === 'ready' || nowcastState.status === 'stale'
      ? nowcastState.catalog
      : null;

  // 雨雲ナウキャストの再生・選択制御
  const nowcastPlayback = usePlayback({
    catalog: nowcastCatalog,
    terminalId,
    controlStatus,
    enabled: isNowcast,
  });

  // キキクルの索引ポーリング (60 秒間隔、種別切替で再取得しない)
  const kikikuruState = useKikikuruCatalog({
    terminalId,
    controlStatus,
    enabled: isKikikuru,
  });

  const kikikuruCatalog =
    kikikuruState.status === 'ready' || kikikuruState.status === 'stale'
      ? kikikuruState.catalog
      : null;

  // キキクルの再生・選択制御 (種別切替時の時刻維持、member 再解決)
  const currentKikikuruLayerId = isKikikuru ? currentLayerId : 'kikikuru-heavyrain';
  const kikikuruPlayback = useKikikuruLayerState({
    catalog: kikikuruCatalog,
    currentLayerId: currentKikikuruLayerId,
    terminalId,
    controlStatus,
    enabled: isKikikuru,
  });

  const effectiveTimelineViewModel = useMemo(() => {
    if (controlledTimelineViewModel) {
      return controlledTimelineViewModel;
    }
    if (isNowcast) {
      if (!nowcastCatalog) return emptyTimeline;
      return {
        ...nowcastPlayback.viewModel,
        // TimelineControlCard (F4所有・変更不可) のスライダーつまみ位置 (value) は
        // selectedFrameId から算出されるため、つまみを intentFrameId に追従させる (§9.4.2)
        selectedFrameId: nowcastPlayback.viewModel.intentFrameId,
      };
    }
    if (isKikikuru) {
      return kikikuruCatalog
        ? kikikuruPlayback.viewModel
        : {
            ...emptyTimeline,
            layerLabel: LAYER_PRESENTATIONS[currentLayerId].label,
          };
    }
    return emptyTimeline;
  }, [
    controlledTimelineViewModel,
    isNowcast,
    isKikikuru,
    nowcastCatalog,
    nowcastPlayback.viewModel,
    kikikuruCatalog,
    kikikuruPlayback.viewModel,
    currentLayerId,
  ]);

  const handleLayerSelect = (layerId: MapLayerId) => {
    if (controlledLayerId === undefined) {
      setInternalLayerId(layerId);
    }
    onLayerSelect?.(layerId);
  };

  const handleIntent = (intent: TimelineIntent) => {
    if (isNowcast) {
      nowcastPlayback.handleIntent(intent);
    } else if (isKikikuru) {
      kikikuruPlayback.handleIntent(intent);
    }
    onTimelineIntent?.(intent);
  };

  const handleSwapSettled = (result: { frameId: string; complete: boolean }) => {
    if (isNowcast) {
      nowcastPlayback.handleSwapSettled(result);
    } else if (isKikikuru) {
      kikikuruPlayback.handleSwapSettled(result);
    }
  };

  const handleTileError = (frameId: string) => {
    if (isKikikuru) {
      kikikuruPlayback.handleTileError(frameId);
    }
  };

  const presentation = LAYER_PRESENTATIONS[currentLayerId];

  // ズーム・会場復帰操作 (F6)
  const handleZoomIn = () => viewportRef.current?.zoomIn();
  const handleZoomOut = () => viewportRef.current?.zoomOut();
  const handleReturnToVenue = () => viewportRef.current?.returnToVenue();

  // 表示ズーム 10 未満ではキキクルの重畳を行わない (§7.2, §11.5)
  const isZoomAllowedForKikikuru = currentZoom >= 10;
  const overlayFrame = isNowcast
    ? nowcastPlayback.overlayFrame
    : isKikikuru && isZoomAllowedForKikikuru
      ? kikikuruPlayback.overlayFrame
      : null;

  const overlayAllowedZooms = isNowcast
    ? (nowcastCatalog?.allowedZooms ?? [10])
    : (kikikuruCatalog?.allowedZooms ?? [10]);

  const overlayOpacity = isNowcast ? NOWCAST_LAYER_OPACITY : KIKIKURU_LAYER_OPACITY;
  const overlayPrefetchFrames = isNowcast ? nowcastPlayback.prefetchFrames : undefined;
  const overlayRetainLoaded = isNowcast ? nowcastPlayback.retainLoaded : false;

  // 雨雲ナウキャスト読込中判定 (intent !== settled §9.4.2)
  const isNowcastLoading =
    isNowcast &&
    nowcastPlayback.viewModel.intentFrameId !== nowcastPlayback.viewModel.settledFrameId;

  // キキクル表示中のステータス注記スロット (§7.2, §8.2, §11.5, §11.7)
  const kikikuruStatusSlot = isKikikuru ? (
    <div className="timeline-status-slot">
      <span className="kikikuru-prediction-note">この危険度は予測を含む判定結果です</span>
      {currentZoom < 10 && (
        <span className="kikikuru-status-message">この縮尺では危険度分布を表示していません</span>
      )}
      {currentZoom >= 10 && kikikuruPlayback.statusMessage && (
        <span className="kikikuru-status-message">{kikikuruPlayback.statusMessage}</span>
      )}
    </div>
  ) : undefined;

  // ナウキャスト表示中のスピナースロット (§9.4.8)
  const nowcastStatusSlot = isNowcast ? (
    <NowcastLoadingSpinner loading={isNowcastLoading} />
  ) : undefined;

  const effectiveStatusSlot = isNowcast ? nowcastStatusSlot : kikikuruStatusSlot;

  return (
    <div className="weather-map-view" aria-label="防災気象情報ビュー">
      {/* 気象タイルオーバーレイ (F2 / F3) */}
      <WeatherTileOverlay
        map={mapInstance}
        frame={overlayFrame}
        prefetchFrames={overlayPrefetchFrames}
        retainLoaded={overlayRetainLoaded}
        allowedZooms={overlayAllowedZooms}
        opacity={overlayOpacity}
        swapTimeoutMs={SWAP_TIMEOUT_MS}
        onSwapSettled={handleSwapSettled}
        onTileError={handleTileError}
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
      <div
        className="timeline-card-wrapper"
        aria-busy={isNowcast && isNowcastLoading ? true : undefined}
      >
        <TimelineControlCard
          ref={bottomCardRef}
          viewModel={effectiveTimelineViewModel}
          onIntent={handleIntent}
          statusSlot={effectiveStatusSlot}
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
