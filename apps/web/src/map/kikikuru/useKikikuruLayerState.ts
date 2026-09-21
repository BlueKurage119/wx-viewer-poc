import { useCallback, useMemo, useRef, useState } from 'react';
import type { WeatherControlStatus } from '@wx-viewer-poc/shared';
import type { TimelineIntent, TimelineViewModel } from '../types';
import { LAYER_PRESENTATIONS } from '../fixtures';
import {
  formatJstMonthDateTime,
  resolveKikikuruFrame,
  toApiLayer,
  toTimelineFrames,
  type KikikuruCatalog,
  type KikikuruMapLayerId,
} from './kikikuruCatalog';
import { buildKikikuruTileUrlTemplate } from './kikikuruTileUrl';

export type KikikuruDisplayFrame = Readonly<{
  readonly id: string;
  /** WeatherTileOverlay の通知と種別まで対応付ける差替え識別子。 */
  readonly swapId: string;
  readonly layerId: KikikuruMapLayerId;
  readonly label: string;
}>;

export type KikikuruTileErrorState = Readonly<{
  readonly boundary: string;
  readonly count: number;
}>;

/**
 * 差替え完了の通知が、現在表示を待っているコマのものかを判定する。
 * WeatherTileOverlay は成功と timeout のどちらでも画像を切り替えてから通知するため、
 * complete の値にかかわらず一致した通知だけをカードへ反映する。
 */
export function isCurrentKikikuruSwap(
  target: KikikuruDisplayFrame | null,
  result: { readonly frameId: string; readonly complete: boolean },
): target is KikikuruDisplayFrame {
  return target !== null && target.swapId === result.frameId;
}

/** 新しい画像を待つ間は旧画像と同じ種別・時刻をカードと凡例に維持する。 */
export function getVisibleKikikuruFrame(
  settled: KikikuruDisplayFrame | null,
  target: KikikuruDisplayFrame | null,
  enabled: boolean,
): KikikuruDisplayFrame | null {
  return enabled && target !== null ? settled : null;
}

/** 索引・種別・有効状態が変わった境界では、過去タイルの失敗を表示しない。 */
export function getKikikuruTileErrorCount(state: KikikuruTileErrorState, boundary: string): number {
  return state.boundary === boundary ? state.count : 0;
}

export interface UseKikikuruLayerStateParams {
  readonly catalog: KikikuruCatalog | null;
  readonly currentLayerId: KikikuruMapLayerId;
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly enabled: boolean;
}

export interface UseKikikuruLayerStateResult {
  readonly viewModel: TimelineViewModel;
  readonly overlayFrame: { readonly id: string; readonly urlTemplate: string } | null;
  /** 差替え中は旧画像に対応する凡例を維持する。 */
  readonly displayedLayerId: KikikuruMapLayerId;
  readonly handleIntent: (intent: TimelineIntent) => void;
  readonly handleSwapSettled: (result: { frameId: string; complete: boolean }) => void;
  readonly handleTileError: (frameId: string) => void;
  readonly statusMessage: string | null;
}

/** キキクルの最新1コマを、最新の保存索引から常に再解決する。 */
export function useKikikuruLayerState(
  params: UseKikikuruLayerStateParams,
): UseKikikuruLayerStateResult {
  const { catalog, currentLayerId, terminalId, controlStatus, enabled } = params;
  const [tileErrors, setTileErrors] = useState<KikikuruTileErrorState>({ boundary: '', count: 0 });
  const apiLayer = toApiLayer(currentLayerId);
  const dataset = catalog?.layers[apiLayer];
  const rawFrames = dataset?.data?.frames;
  const frames = useMemo(() => toTimelineFrames(rawFrames ?? []), [rawFrames]);
  const latestFrame = frames[0] ?? null;

  const target = useMemo(() => {
    if (
      !enabled ||
      !catalog ||
      catalog.allowedZooms.length === 0 ||
      controlStatus !== 'normal' ||
      !latestFrame
    ) {
      return {
        display: null,
        overlay: null,
        boundary: `${enabled}:${currentLayerId}:${controlStatus}:none`,
      };
    }

    const resolved = resolveKikikuruFrame(rawFrames ?? [], latestFrame.id);
    if (!resolved) {
      return {
        display: null,
        overlay: null,
        boundary: `${enabled}:${currentLayerId}:${controlStatus}:none`,
      };
    }

    const urlTemplate = buildKikikuruTileUrlTemplate({
      frame: resolved,
      terminalId,
      controlStatus,
    });
    return {
      display: {
        id: resolved.validTime,
        swapId: `${currentLayerId}:${resolved.validTime}`,
        layerId: currentLayerId,
        label: formatJstMonthDateTime(resolved.validTime),
      },
      overlay: { id: `${currentLayerId}:${resolved.validTime}`, urlTemplate },
      boundary: `${enabled}:${currentLayerId}:${controlStatus}:${urlTemplate}`,
    };
  }, [catalog, controlStatus, currentLayerId, enabled, latestFrame, rawFrames, terminalId]);

  // 画像差替えが完了するまで、カードは前に確定した画像の時刻を維持する。
  // 種別切替では layerId が一致しないため、旧種別の画像を新種別として表示しない。
  const [settledFrame, setSettledFrame] = useState<KikikuruDisplayFrame | null>(null);
  const targetRef = useRef<KikikuruDisplayFrame | null>(target.display);
  targetRef.current = target.display;
  const targetBoundaryRef = useRef(target.boundary);
  targetBoundaryRef.current = target.boundary;
  const visibleFrame = getVisibleKikikuruFrame(settledFrame, target.display, enabled);
  const tileErrorCount = getKikikuruTileErrorCount(tileErrors, target.boundary);

  const viewModel: TimelineViewModel = {
    layerLabel: LAYER_PRESENTATIONS[visibleFrame?.layerId ?? currentLayerId].label,
    selectedFrameId: visibleFrame?.id ?? null,
    selectedFrameLabel: visibleFrame?.label ?? '',
    frames,
    playing: false,
    latestAvailable: false,
  };

  const statusMessage = useMemo(() => {
    if (controlStatus !== 'normal') return 'この制御状態ではキキクルを提供していません';
    if (dataset?.metadata.availability === 'unavailable' && dataset.data === null) {
      return '危険度分布データを取得できていません';
    }
    if (dataset?.metadata.availability === 'stale') return 'データ鮮度が低下しています';
    if (tileErrorCount > 0) return '一部のタイルを取得できていません';
    return null;
  }, [controlStatus, dataset, tileErrorCount]);

  const handleIntent = useCallback(() => {}, []);
  const handleSwapSettled = useCallback((result: { frameId: string; complete: boolean }) => {
    const currentTarget = targetRef.current;
    if (!isCurrentKikikuruSwap(currentTarget, result)) return;

    setSettledFrame(currentTarget);
    setTileErrors({ boundary: targetBoundaryRef.current, count: 0 });
  }, []);
  const handleTileError = useCallback((frameId: string) => {
    const currentTarget = targetRef.current;
    if (!currentTarget || currentTarget.swapId !== frameId) return;

    const boundary = targetBoundaryRef.current;
    setTileErrors((previous) => ({
      boundary,
      count: previous.boundary === boundary ? previous.count + 1 : 1,
    }));
  }, []);

  return {
    viewModel,
    overlayFrame: target.overlay,
    displayedLayerId: visibleFrame?.layerId ?? currentLayerId,
    handleIntent,
    handleSwapSettled,
    handleTileError,
    statusMessage,
  };
}
