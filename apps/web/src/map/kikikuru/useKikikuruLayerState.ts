import { useCallback, useMemo, useState } from 'react';
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

export type KikikuruLayerState = Readonly<{
  /** 常に切替先の最新コマを選ぶ。null は利用可能な時刻がないことを表す。 */
  selectedFrameId: string | null;
  playing: boolean;
}>;

/**
 * キキクル種別切替時の純粋状態遷移関数。
 * 最新1コマ表示のため、過去の選択状態を引き継がない。
 */
export function transitionKikikuruLayer(
  _currentState: KikikuruLayerState,
  newLayerId: KikikuruMapLayerId,
  catalog: KikikuruCatalog | null,
): {
  readonly nextState: KikikuruLayerState;
  readonly isOutOfRange: boolean;
} {
  const rawFrames = catalog?.layers[toApiLayer(newLayerId)]?.data?.frames ?? [];
  const latest = toTimelineFrames(rawFrames)[0] ?? null;
  return {
    nextState: { selectedFrameId: latest?.id ?? null, playing: false },
    isOutOfRange: false,
  };
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
  const [tileErrorCount, setTileErrorCount] = useState(0);
  const apiLayer = toApiLayer(currentLayerId);
  const dataset = catalog?.layers[apiLayer];
  const rawFrames = dataset?.data?.frames;
  const frames = useMemo(() => toTimelineFrames(rawFrames ?? []), [rawFrames]);
  const latestFrame = frames[0] ?? null;

  const viewModel: TimelineViewModel = {
    layerLabel: LAYER_PRESENTATIONS[currentLayerId].label,
    selectedFrameId: latestFrame?.id ?? null,
    selectedFrameLabel: latestFrame ? formatJstMonthDateTime(latestFrame.validTime) : '',
    frames,
    playing: false,
    latestAvailable: false,
  };

  const overlayFrame = useMemo(() => {
    if (
      !enabled ||
      !catalog ||
      catalog.allowedZooms.length === 0 ||
      controlStatus !== 'normal' ||
      !latestFrame
    ) {
      return null;
    }

    const resolved = resolveKikikuruFrame(rawFrames ?? [], latestFrame.id);
    if (!resolved) return null;

    return {
      id: resolved.validTime,
      urlTemplate: buildKikikuruTileUrlTemplate({
        frame: resolved,
        terminalId,
        controlStatus,
      }),
    };
  }, [catalog, controlStatus, enabled, latestFrame, rawFrames, terminalId]);

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
  const handleSwapSettled = useCallback(() => {}, []);
  const handleTileError = useCallback(() => setTileErrorCount((count) => count + 1), []);

  return {
    viewModel,
    overlayFrame,
    handleIntent,
    handleSwapSettled,
    handleTileError,
    statusMessage,
  };
}
