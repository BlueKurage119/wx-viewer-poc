import { useState, useRef, useMemo, useCallback, type ReactElement } from 'react';
import type L from 'leaflet';
import type { WeatherControlStatus } from '@wx-viewer-poc/shared';
import type { Venue } from '../shell/config';
import type { MapLayerId, TimelineIntent, TimelineViewModel } from './types';
import { LAYER_PRESENTATIONS, emptyTimeline } from './fixtures';
import { MapViewport, type MapViewportHandle } from './MapViewport';
import { MapInformationColumnSlot } from './MapInformationColumnSlot';
import { InfoPanelColumn } from './panels/InfoPanelColumn';
import { DetailDialogScrollContainerProvider } from './detail/DetailDialogScrollContainerContext';
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
import { KikikuruStatusCard } from './kikikuru/KikikuruStatusCard';
import { WeatherTileOverlay, type WeatherTileOverlayProps } from './tiles/WeatherTileOverlay';

export interface WeatherMapViewProps {
  venue: Venue;
  terminalId?: string;
  controlStatus?: WeatherControlStatus;
  timelineViewModel?: TimelineViewModel;
  onTimelineIntent?: (intent: TimelineIntent) => void;
  selectedLayerId?: MapLayerId;
  onLayerSelect?: (layerId: MapLayerId) => void;
}

const NOWCAST_LAYER_OPACITY = 1;
const KIKIKURU_LAYER_OPACITY = 0.75;
const SWAP_TIMEOUT_MS = 12_000;

/** 高さ基準要素 (Issue #212 §4.8) の TimelineControlCard へ渡す no-op ハンドラ。不可視のため操作されない。 */
function noopTimelineIntent() {
  /* 高さ基準要素は inert のため操作を受け取らない */
}

/** 実際にオーバーレイへ渡す不透明度を回帰テストから検証する公開境界。 */
// eslint-disable-next-line react-refresh/only-export-components
export const weatherMapViewConfiguration = {
  nowcastLayerOpacity: NOWCAST_LAYER_OPACITY,
  kikikuruLayerOpacity: KIKIKURU_LAYER_OPACITY,
} as const;

/** ナウキャストとキキクルの間では、共通オーバーレイを必ず破棄する境界キー。 */
// eslint-disable-next-line react-refresh/only-export-components
export function getOverlayProductKey(layerId: MapLayerId): 'nowcast' | 'kikikuru' {
  return layerId === 'nowcast' ? 'nowcast' : 'kikikuru';
}

/** MapViewport に触れず、選択状態だけを更新するレイヤー選択の本番経路。 */
// eslint-disable-next-line react-refresh/only-export-components
export function createLayerSelectHandler(
  controlledLayerId: MapLayerId | undefined,
  setInternalLayerId: (layerId: MapLayerId) => void,
  onLayerSelect: ((layerId: MapLayerId) => void) | undefined,
): (layerId: MapLayerId) => void {
  return (layerId) => {
    if (controlledLayerId === undefined) setInternalLayerId(layerId);
    onLayerSelect?.(layerId);
  };
}

/** プロダクト境界 key を含むオーバーレイ要素を生成する。 */
// eslint-disable-next-line react-refresh/only-export-components
export function createWeatherTileOverlayElement(
  layerId: MapLayerId,
  props: WeatherTileOverlayProps,
): ReactElement {
  return <WeatherTileOverlay key={getOverlayProductKey(layerId)} {...props} />;
}

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
  const [rightColumnEl, setRightColumnEl] = useState<HTMLElement | null>(null);
  const [bottomCardEl, setBottomCardEl] = useState<HTMLElement | null>(null);
  const setRightColumnRef = useCallback((element: HTMLElement | null) => {
    setRightColumnEl(element);
  }, []);
  const setBottomCardRef = useCallback((element: HTMLDivElement | null) => {
    setBottomCardEl(element);
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

  // キキクルの最新コマ・member 再解決
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

  const handleLayerSelect = useMemo(
    () => createLayerSelectHandler(controlledLayerId, setInternalLayerId, onLayerSelect),
    [controlledLayerId, onLayerSelect],
  );

  const handleIntent = (intent: TimelineIntent) => {
    if (isNowcast) {
      nowcastPlayback.handleIntent(intent);
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

  const presentationLayerId = isKikikuru ? kikikuruPlayback.displayedLayerId : currentLayerId;
  const presentation = LAYER_PRESENTATIONS[presentationLayerId];

  // ズーム・会場復帰操作 (F6)
  const handleZoomIn = () => viewportRef.current?.zoomIn();
  const handleZoomOut = () => viewportRef.current?.zoomOut();
  const handleReturnToVenue = () => viewportRef.current?.returnToVenue();

  const overlayFrame = isNowcast
    ? nowcastPlayback.overlayFrame
    : isKikikuru
      ? kikikuruPlayback.overlayFrame
      : null;

  const overlayAllowedZooms = isNowcast
    ? (nowcastCatalog?.allowedZooms ?? [10])
    : (kikikuruCatalog?.allowedZooms ?? []);

  const overlayOpacity = isNowcast
    ? weatherMapViewConfiguration.nowcastLayerOpacity
    : weatherMapViewConfiguration.kikikuruLayerOpacity;
  const overlayPrefetchFrames = isNowcast ? nowcastPlayback.prefetchFrames : undefined;
  const overlayRetainLoaded = isNowcast ? nowcastPlayback.retainLoaded : false;

  // 雨雲ナウキャスト読込中判定 (intent !== settled §9.4.2)
  const isNowcastLoading =
    isNowcast &&
    nowcastPlayback.viewModel.intentFrameId !== nowcastPlayback.viewModel.settledFrameId;

  // キキクル表示中のステータス注記スロット
  const kikikuruStatusSlot =
    isKikikuru && kikikuruPlayback.statusMessage ? (
      <span className="kikikuru-status-message">{kikikuruPlayback.statusMessage}</span>
    ) : undefined;

  // ナウキャスト表示中のスピナースロット (§9.4.8)
  const nowcastStatusSlot = isNowcast ? (
    <NowcastLoadingSpinner loading={isNowcastLoading} />
  ) : undefined;

  const effectiveStatusSlot = isNowcast ? nowcastStatusSlot : kikikuruStatusSlot;
  // ナウキャストとキキクルの間では画像を引き継がない。種別間だけはキキクル側で
  // settled 表示を維持するため、同一インスタンスの差替えを許可する。
  return (
    <div className="weather-map-view" aria-label="防災気象情報ビュー">
      {/* 気象タイルオーバーレイ (F2 / F3) */}
      {createWeatherTileOverlayElement(currentLayerId, {
        map: mapInstance,
        frame: overlayFrame,
        prefetchFrames: overlayPrefetchFrames,
        retainLoaded: overlayRetainLoaded,
        allowedZooms: overlayAllowedZooms,
        opacity: overlayOpacity,
        swapTimeoutMs: SWAP_TIMEOUT_MS,
        onSwapSettled: handleSwapSettled,
        onTileError: handleTileError,
      })}

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
        {isKikikuru ? (
          <KikikuruStatusCard
            viewModel={effectiveTimelineViewModel}
            statusSlot={effectiveStatusSlot}
          />
        ) : (
          <TimelineControlCard
            viewModel={effectiveTimelineViewModel}
            onIntent={handleIntent}
            statusSlot={effectiveStatusSlot}
          />
        )}
        {/* 中心補正の下端基準 B (Issue #212 §4.8)。レイヤーに関わらずナウキャストカードの高さを測る */}
        <div
          ref={setBottomCardRef}
          className="timeline-card-height-reference"
          aria-hidden="true"
          inert
        >
          <TimelineControlCard viewModel={emptyTimeline} onIntent={noopTimelineIntent} />
        </div>
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
      <MapInformationColumnSlot ref={setRightColumnRef}>
        {/* 詳細（仮）入口 (G10 §6) が scrollContainer として列要素を参照するための Provider */}
        <DetailDialogScrollContainerProvider value={rightColumnEl}>
          <InfoPanelColumn venueId={venue.id} />
        </DetailDialogScrollContainerProvider>
      </MapInformationColumnSlot>

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
