import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { WeatherControlStatus } from '@wx-viewer-poc/shared';
import type { TimelineIntent, TimelineViewModel } from '../types';
import { LAYER_PRESENTATIONS } from '../fixtures';
import {
  toApiLayer,
  toTimelineFrames,
  resolveKikikuruFrame,
  formatJstMonthDateTime,
  type KikikuruMapLayerId,
  type KikikuruCatalog,
  type KikikuruFrameRef,
} from './kikikuruCatalog';
import { buildKikikuruTileUrlTemplate } from './kikikuruTileUrl';

export type KikikuruLayerState = Readonly<{
  /** 選択中のコマ。null は「利用可能な時刻なし」。種別切替をまたいで維持する（§5.3） */
  selectedFrameId: string | null;
  playing: boolean;
}>;

/**
 * キキクル種別切替時の純粋状態遷移関数 (§5.2, §5.3)
 */
export function transitionKikikuruLayer(
  currentState: KikikuruLayerState,
  newLayerId: KikikuruMapLayerId,
  catalog: KikikuruCatalog | null,
): {
  readonly nextState: KikikuruLayerState;
  readonly isOutOfRange: boolean;
} {
  // 1. playing は常に false
  // 2. 切替先のコマ一覧を取得
  if (!catalog) {
    return {
      nextState: {
        selectedFrameId: null,
        playing: false,
      },
      isOutOfRange: false,
    };
  }

  const apiLayer = toApiLayer(newLayerId);
  const rawFrames = catalog.layers[apiLayer]?.data?.frames ?? [];
  const timelineFrames = toTimelineFrames(rawFrames);

  // 3. 切替前に選択していた時刻を維持する (§5.3)
  if (currentState.selectedFrameId !== null) {
    const exists = timelineFrames.some((f) => f.id === currentState.selectedFrameId);
    if (exists) {
      return {
        nextState: {
          selectedFrameId: currentState.selectedFrameId,
          playing: false,
        },
        isOutOfRange: false,
      };
    } else {
      // 切替先に同じ validTime が存在しない場合は null (§5.3)
      return {
        nextState: {
          selectedFrameId: null,
          playing: false,
        },
        isOutOfRange: true,
      };
    }
  }

  const latest = timelineFrames.length > 0 ? timelineFrames[timelineFrames.length - 1] : null;
  return {
    nextState: {
      selectedFrameId: latest?.id ?? null,
      playing: false,
    },
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

/**
 * キキクルの表示・タイムライン・種別切替・時刻維持の状態機械 (§5, §6.3, §7, §8)
 */
export function useKikikuruLayerState(
  params: UseKikikuruLayerStateParams,
): UseKikikuruLayerStateResult {
  const { catalog, currentLayerId, terminalId, controlStatus, enabled } = params;

  // 初期選択コマの計算ヘルパー
  const getInitialFrameId = useCallback(
    (cat: KikikuruCatalog | null, layerId: KikikuruMapLayerId): string | null => {
      if (!cat) return null;
      const apiLayer = toApiLayer(layerId);
      const rawFrames = cat.layers[apiLayer]?.data?.frames ?? [];
      const timelineFrames = toTimelineFrames(rawFrames);
      const latest = timelineFrames.length > 0 ? timelineFrames[timelineFrames.length - 1] : null;
      return latest?.id ?? null;
    },
    [],
  );

  // 画面に適用中のカタログ (再生中は固定して最新をバッファに保持)
  const [activeCatalog, setActiveCatalog] = useState<KikikuruCatalog | null>(catalog);

  // 選択中のコマ ID (validTime)。種別切替をまたいで維持する (§5.3)
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(() =>
    getInitialFrameId(catalog, currentLayerId),
  );

  // タイルオーバーレイで読み込み中のコマ ID
  const [targetFrameId, setTargetFrameId] = useState<string | null>(() =>
    getInitialFrameId(catalog, currentLayerId),
  );

  // 再生状態
  const [playing, setPlaying] = useState(false);

  // 選択していた時刻が提供範囲外になったか
  const [isOutOfRange, setIsOutOfRange] = useState(false);

  // タイル読み込みエラー件数
  const [tileErrorCount, setTileErrorCount] = useState(0);

  const prevLayerIdRef = useRef<KikikuruMapLayerId>(currentLayerId);
  const prevEnabledRef = useRef<boolean>(enabled);
  const latestCatalogRef = useRef<KikikuruCatalog | null>(catalog);

  useEffect(() => {
    latestCatalogRef.current = catalog;
  }, [catalog]);

  // レンダー中におけるレイヤー種別切替の同期処理 (§5.2, §5.3)
  if (prevLayerIdRef.current !== currentLayerId) {
    prevLayerIdRef.current = currentLayerId;

    if (playing) {
      setPlaying(false);
    }

    const currentCat = activeCatalog ?? catalog;
    if (currentCat) {
      const apiLayer = toApiLayer(currentLayerId);
      const rawFrames = currentCat.layers[apiLayer]?.data?.frames ?? [];
      const timelineFrames = toTimelineFrames(rawFrames);

      if (selectedFrameId !== null) {
        const exists = timelineFrames.some((f) => f.id === selectedFrameId);
        if (exists) {
          if (isOutOfRange) setIsOutOfRange(false);
          if (targetFrameId !== selectedFrameId) setTargetFrameId(selectedFrameId);
        } else {
          // 切替先に同じ validTime のコマが存在しない場合: 黙って別時刻へ差し替えず null (§5.3)
          setSelectedFrameId(null);
          setTargetFrameId(null);
          setIsOutOfRange(true);
        }
      } else if (!isOutOfRange) {
        const latest = timelineFrames.length > 0 ? timelineFrames[timelineFrames.length - 1] : null;
        if (latest) {
          setSelectedFrameId(latest.id);
          setTargetFrameId(latest.id);
        }
      }
    }
  }

  // カタログ更新時の同期処理 (§6.3)
  useEffect(() => {
    if (!catalog) {
      setActiveCatalog(null);
      setSelectedFrameId(null);
      setTargetFrameId(null);
      setIsOutOfRange(false);
      return;
    }

    // 再生中は一覧を固定し、新しいカタログの反映を停止時まで保留する (§6.3)
    if (playing) {
      return;
    }

    setActiveCatalog(catalog);
    const apiLayer = toApiLayer(currentLayerId);
    const rawFrames = catalog.layers[apiLayer]?.data?.frames ?? [];
    const timelineFrames = toTimelineFrames(rawFrames);
    const latestFrame =
      timelineFrames.length > 0 ? timelineFrames[timelineFrames.length - 1]! : null;

    if (selectedFrameId === null) {
      // 初回カタログ取得時: 最新コマを選択
      if (latestFrame) {
        setSelectedFrameId(latestFrame.id);
        setTargetFrameId(latestFrame.id);
        setIsOutOfRange(false);
      }
      return;
    }

    // 索引更新後、選択中のコマが新しい一覧に存在すれば維持する (§6.3)
    const exists = timelineFrames.some((f) => f.id === selectedFrameId);
    if (exists) {
      setIsOutOfRange(false);
      // member がドリフトしている可能性があるため targetFrameId を再設定
      setTargetFrameId(selectedFrameId);
    } else {
      // 存在しない場合は、黙って別時刻へ差し替えず null にして提供範囲外を案内する (§6.3, §6.4)
      setSelectedFrameId(null);
      setTargetFrameId(null);
      setIsOutOfRange(true);
    }
  }, [catalog, playing, currentLayerId, selectedFrameId]);

  // レイヤー種別切替時の副作用 (§5.2, §5.3)
  useEffect(() => {
    const apiLayer = toApiLayer(currentLayerId);
    const rawFrames = activeCatalog?.layers[apiLayer]?.data?.frames ?? [];
    const timelineFrames = toTimelineFrames(rawFrames);

    if (selectedFrameId !== null) {
      const exists = timelineFrames.some((f) => f.id === selectedFrameId);
      if (!exists) {
        setSelectedFrameId(null);
        setTargetFrameId(null);
        setIsOutOfRange(true);
      }
    }
  }, [currentLayerId, activeCatalog, selectedFrameId]);

  // enabled 切替時 (雨雲ナウキャスト ↔ キキクル 切替) の副作用 (§5.2, §5.3)
  useEffect(() => {
    const justEnabled = !prevEnabledRef.current && enabled;
    prevEnabledRef.current = enabled;

    if (justEnabled) {
      // ナウキャスト ↔ キキクル の切替では時間軸が一致しないため引き継がず、
      // 切替先の利用可能コマのうち validTime が最大のものを選ぶ (§5.3)
      setPlaying(false);
      setIsOutOfRange(false);
      setTileErrorCount(0);

      if (activeCatalog) {
        const apiLayer = toApiLayer(currentLayerId);
        const rawFrames = activeCatalog.layers[apiLayer]?.data?.frames ?? [];
        const timelineFrames = toTimelineFrames(rawFrames);
        const latestFrame =
          timelineFrames.length > 0 ? timelineFrames[timelineFrames.length - 1]! : null;
        if (latestFrame) {
          setSelectedFrameId(latestFrame.id);
          setTargetFrameId(latestFrame.id);
        } else {
          setSelectedFrameId(null);
          setTargetFrameId(null);
        }
      }
    } else if (!enabled) {
      setPlaying(false);
      setTileErrorCount(0);
    }
  }, [enabled, activeCatalog, currentLayerId]);

  // WeatherTileOverlay の swap 完了ハンドラ (§7.5)
  const handleSwapSettled = useCallback((result: { frameId: string; complete: boolean }) => {
    setSelectedFrameId(result.frameId);
  }, []);

  // タイルエラー通知ハンドラ
  const handleTileError = useCallback(() => {
    setTileErrorCount((prev) => prev + 1);
  }, []);

  // 現在のレイヤーのフレーム一覧 (3時間窓適用済み)
  const apiLayer = toApiLayer(currentLayerId);
  const activeDataset = activeCatalog?.layers[apiLayer];
  const datasetFrames = activeDataset?.data?.frames;
  const rawFrames = useMemo(() => datasetFrames ?? [], [datasetFrames]);
  const timelineFrames: readonly KikikuruFrameRef[] = useMemo(() => {
    return toTimelineFrames(rawFrames);
  }, [rawFrames]);

  const latestFrame = timelineFrames.length > 0 ? timelineFrames[timelineFrames.length - 1]! : null;

  // タイムライン操作 intent ハンドラ
  const handleIntent = useCallback(
    (intent: TimelineIntent) => {
      if (timelineFrames.length === 0) return;

      switch (intent.type) {
        case 'toggle-play': {
          if (!playing) {
            // 再生開始
            setPlaying(true);
          } else {
            // 再生停止: 保留中の最新カタログがあれば反映
            setPlaying(false);
            if (latestCatalogRef.current) {
              setActiveCatalog(latestCatalogRef.current);
            }
          }
          break;
        }

        case 'select-frame': {
          setPlaying(false);
          const target = timelineFrames.find((f) => f.id === intent.frameId);
          if (target) {
            setSelectedFrameId(target.id);
            setTargetFrameId(target.id);
            setIsOutOfRange(false);
          }
          break;
        }

        case 'previous-frame': {
          setPlaying(false);
          const currentIndex = timelineFrames.findIndex((f) => f.id === selectedFrameId);
          if (currentIndex > 0) {
            const prev = timelineFrames[currentIndex - 1]!;
            setSelectedFrameId(prev.id);
            setTargetFrameId(prev.id);
            setIsOutOfRange(false);
          }
          break;
        }

        case 'next-frame': {
          setPlaying(false);
          const currentIndex = timelineFrames.findIndex((f) => f.id === selectedFrameId);
          if (currentIndex >= 0 && currentIndex < timelineFrames.length - 1) {
            const next = timelineFrames[currentIndex + 1]!;
            setSelectedFrameId(next.id);
            setTargetFrameId(next.id);
            setIsOutOfRange(false);
          }
          break;
        }

        case 'select-latest': {
          setPlaying(false);
          if (latestFrame) {
            setSelectedFrameId(latestFrame.id);
            setTargetFrameId(latestFrame.id);
            setIsOutOfRange(false);
          }
          break;
        }
      }
    },
    [playing, timelineFrames, selectedFrameId, latestFrame],
  );

  // 選択日時のラベル: 危険度判定 基準時刻 MM/DD HH:mm (§8.2)
  const selectedFrame = selectedFrameId
    ? (timelineFrames.find((f) => f.id === selectedFrameId) ?? null)
    : null;

  const selectedFrameLabel = selectedFrame
    ? `危険度判定 基準時刻 ${formatJstMonthDateTime(selectedFrame.validTime)}`
    : '';

  const isAtLatest =
    latestFrame !== null && selectedFrame !== null && latestFrame.id === selectedFrame.id;
  const latestAvailable = latestFrame !== null && !isAtLatest;

  const layerLabel = LAYER_PRESENTATIONS[currentLayerId]?.label ?? 'キキクル';

  const viewModel: TimelineViewModel = {
    layerLabel,
    selectedFrameId,
    selectedFrameLabel,
    frames: timelineFrames,
    playing,
    latestAvailable,
  };

  // WeatherTileOverlay 用の overlayFrame (§6.3 member 再解決)
  const currentTargetValidTime = targetFrameId ?? selectedFrameId;
  const overlayFrame = useMemo(() => {
    if (!enabled || !currentTargetValidTime || !activeCatalog || controlStatus !== 'normal') {
      return null;
    }

    // 最新の生フレーム配列から (layer, validTime) で member / imageId / baseTime を引き直す (§6.3)
    const resolved = resolveKikikuruFrame(rawFrames, currentTargetValidTime);
    if (!resolved) {
      return null;
    }

    const urlTemplate = buildKikikuruTileUrlTemplate({
      frame: {
        layer: resolved.layer,
        baseTime: resolved.baseTime,
        validTime: resolved.validTime,
        imageId: resolved.imageId,
        member: resolved.member,
      },
      terminalId,
      controlStatus,
    });

    return {
      id: resolved.validTime,
      urlTemplate,
    };
  }, [enabled, currentTargetValidTime, activeCatalog, rawFrames, terminalId, controlStatus]);

  // 状態注記メッセージの解決 (§9, §11.8)
  const statusMessage = useMemo(() => {
    if (controlStatus !== 'normal') {
      return 'この制御状態ではキキクルを提供していません';
    }

    if (activeCatalog) {
      const dataset = activeCatalog.layers[apiLayer];
      if (dataset) {
        if (dataset.metadata?.availability === 'unavailable' && dataset.data === null) {
          return '危険度分布データを取得できていません';
        }
        if (
          dataset.metadata?.availability === 'available' &&
          dataset.data !== null &&
          dataset.data.frames.length === 0
        ) {
          return '対象の危険度分布データはありません';
        }
        if (dataset.metadata?.availability === 'stale') {
          return 'データ鮮度が低下しています';
        }
      }
    }

    if (isOutOfRange) {
      return '選択していた時刻は提供範囲外になりました';
    }

    if (tileErrorCount > 0) {
      return '一部のタイルを取得できていません';
    }

    return null;
  }, [controlStatus, activeCatalog, apiLayer, isOutOfRange, tileErrorCount]);

  return {
    viewModel,
    overlayFrame,
    handleIntent,
    handleSwapSettled,
    handleTileError,
    statusMessage,
  };
}
