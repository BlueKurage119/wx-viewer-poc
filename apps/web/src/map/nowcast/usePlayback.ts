import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { WeatherControlStatus } from '@wx-viewer-poc/shared';
import type { TimelineIntent, TimelineViewModel } from '../types';
import type { WeatherTileOverlayFrame } from '../tiles/WeatherTileOverlay';
import type { NowcastCatalog, NowcastFrame } from './nowcastCatalog';
import { buildNowcastTileUrlTemplate } from './nowcastTileUrl';
import { buildNowcastTimelineViewModel, findLatestNowcastFrame } from './nowcastTimeline';

export interface UsePlaybackParams {
  readonly catalog: NowcastCatalog | null;
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly enabled: boolean;
}

export interface UsePlaybackResult {
  readonly viewModel: TimelineViewModel;
  readonly overlayFrame: WeatherTileOverlayFrame | null;
  readonly prefetchFrames?: readonly WeatherTileOverlayFrame[];
  readonly retainLoaded?: boolean;
  readonly handleIntent: (intent: TimelineIntent) => void;
  readonly handleSwapSettled: (result: { frameId: string; complete: boolean }) => void;
}

export const PLAYBACK_INTERVAL_MS = 1000;
export const PLAYBACK_PREFETCH_DEPTH = 3;

/**
 * 再生先読み対象のフレーム群を計算する純関数 (§9.3.2)
 */
export function computePrefetchFrames(params: {
  readonly frames: readonly NowcastFrame[];
  readonly targetFrameId: string | null;
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly depth?: number;
}): readonly WeatherTileOverlayFrame[] {
  const {
    frames,
    targetFrameId,
    terminalId,
    controlStatus,
    depth = PLAYBACK_PREFETCH_DEPTH,
  } = params;
  if (!targetFrameId) return [];

  const representative = frames.filter((f) => f.representative);
  if (representative.length <= 1) return [];

  const currentIdx = representative.findIndex((f) => f.id === targetFrameId);
  if (currentIdx === -1) return [];

  const targets: WeatherTileOverlayFrame[] = [];
  const seenIds = new Set<string>([targetFrameId]);

  for (let offset = 1; offset <= depth; offset++) {
    const targetIndex = (currentIdx + offset) % representative.length;
    const f = representative[targetIndex];
    if (f && !seenIds.has(f.id)) {
      seenIds.add(f.id);
      targets.push({
        id: f.id,
        urlTemplate: buildNowcastTileUrlTemplate({
          frame: f,
          terminalId,
          controlStatus,
        }),
      });
    }
  }

  return targets;
}

/**
 * ナウキャストのタイムライン再生・選択コントローラー (§9, §10)
 */
export function usePlayback(params: {
  readonly catalog: NowcastCatalog | null;
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly enabled: boolean;
}): UsePlaybackResult {
  const { catalog, terminalId, controlStatus, enabled } = params;

  // 画面に適用中のカタログ (再生中は固定)
  const [activeCatalog, setActiveCatalog] = useState<NowcastCatalog | null>(catalog);

  // 画面に表示確定しているコマ ID
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);

  // WeatherTileOverlay でロード中の目標コマ ID
  const [targetFrameId, setTargetFrameId] = useState<string | null>(() => {
    if (!catalog) return null;
    const latest = findLatestNowcastFrame(catalog.frames);
    return latest?.id ?? null;
  });

  // 再生状態
  const [playing, setPlaying] = useState(false);

  // 最新追従フラグ (初期値 true)
  const [followLatest, setFollowLatest] = useState(true);

  const playbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackFramesRef = useRef<readonly NowcastFrame[]>([]);
  const latestCatalogRef = useRef<NowcastCatalog | null>(catalog);

  useEffect(() => {
    latestCatalogRef.current = catalog;
  }, [catalog]);

  const clearPlaybackTimer = useCallback(() => {
    if (playbackTimerRef.current !== null) {
      clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
  }, []);

  // カタログ更新時の同期処理 (§9.2, §10)
  useEffect(() => {
    if (!catalog) {
      setActiveCatalog(null);
      setSelectedFrameId(null);
      setTargetFrameId(null);
      return;
    }

    // 再生中は一覧を固定し、新しいカタログの反映を停止時まで保留する
    if (playing) {
      return;
    }

    setActiveCatalog(catalog);

    const latestFrame = findLatestNowcastFrame(catalog.frames);

    if (selectedFrameId === null) {
      // 初回カタログ取得時: 代表最新コマを選択
      if (latestFrame) {
        setTargetFrameId(latestFrame.id);
      }
      return;
    }

    if (followLatest) {
      // 最新追従中: 最新代表コマへ進める
      if (latestFrame && latestFrame.id !== selectedFrameId) {
        setTargetFrameId(latestFrame.id);
      }
    } else {
      // 手動保持中: 現在のコマが新しいカタログに存在するか確認
      const exists = catalog.frames.some((f) => f.id === selectedFrameId);
      if (!exists && latestFrame) {
        setTargetFrameId(latestFrame.id);
      }
    }
  }, [catalog, playing, followLatest, selectedFrameId]);

  // enabled が false (非選択レイヤー) になった場合は再生停止
  useEffect(() => {
    if (!enabled) {
      setPlaying(false);
      clearPlaybackTimer();
    }
  }, [enabled, clearPlaybackTimer]);

  // 次の再生コマをスケジュールする
  const scheduleNextPlaybackFrame = useCallback(
    (currentFrameId: string, framesList: readonly NowcastFrame[]) => {
      clearPlaybackTimer();
      const representativeFrames = framesList.filter((f) => f.representative);
      if (representativeFrames.length === 0) return;

      const currentIndex = representativeFrames.findIndex((f) => f.id === currentFrameId);
      let nextIndex = currentIndex + 1;
      if (nextIndex >= representativeFrames.length || nextIndex < 0) {
        nextIndex = 0; // 末尾なら先頭へ戻る
      }

      const nextFrame = representativeFrames[nextIndex]!;

      playbackTimerRef.current = setTimeout(() => {
        setTargetFrameId(nextFrame.id);
      }, PLAYBACK_INTERVAL_MS);
    },
    [clearPlaybackTimer],
  );

  // WeatherTileOverlay の swap 完了通知ハンドラ (§9.3)
  const handleSwapSettled = useCallback(
    (result: { frameId: string; complete: boolean }) => {
      // ロード完了 (または 12 秒タイムアウト) した瞬間に、画面の選択コマを進める
      setSelectedFrameId(result.frameId);

      if (playing) {
        // 再生中は切替完了時点から 1,000 ms 後に次コマを予約
        scheduleNextPlaybackFrame(result.frameId, playbackFramesRef.current);
      }
    },
    [playing, scheduleNextPlaybackFrame],
  );

  // タイムライン操作 intent ハンドラ
  const handleIntent = useCallback(
    (intent: TimelineIntent) => {
      const currentList = activeCatalog ? activeCatalog.frames.filter((f) => f.representative) : [];
      if (currentList.length === 0) return;

      switch (intent.type) {
        case 'toggle-play': {
          if (!playing) {
            // 再生開始: 現在のコマ一覧を固定し、次コマへ進める
            clearPlaybackTimer();
            playbackFramesRef.current = currentList;
            setPlaying(true);
            setFollowLatest(false);

            const currentIndex = currentList.findIndex((f) => f.id === selectedFrameId);
            let nextIndex = currentIndex + 1;
            if (nextIndex >= currentList.length || nextIndex < 0) {
              nextIndex = 0;
            }
            const nextFrame = currentList[nextIndex]!;
            setTargetFrameId(nextFrame.id);
          } else {
            // 再生停止: タイマー停止し、最新カタログを反映
            clearPlaybackTimer();
            setPlaying(false);

            if (latestCatalogRef.current) {
              setActiveCatalog(latestCatalogRef.current);
              const latestList = latestCatalogRef.current.frames.filter((f) => f.representative);
              const exists = latestList.some((f) => f.id === selectedFrameId);
              if (!exists) {
                const latestFrame = findLatestNowcastFrame(latestCatalogRef.current.frames);
                if (latestFrame) {
                  setTargetFrameId(latestFrame.id);
                }
              }
            }
          }
          break;
        }

        case 'select-frame': {
          clearPlaybackTimer();
          setPlaying(false);
          setFollowLatest(false);

          const target = currentList.find((f) => f.id === intent.frameId);
          if (target) {
            setTargetFrameId(target.id);
          }
          break;
        }

        case 'previous-frame': {
          clearPlaybackTimer();
          setPlaying(false);
          setFollowLatest(false);

          const currentIndex = currentList.findIndex((f) => f.id === selectedFrameId);
          if (currentIndex > 0) {
            const prev = currentList[currentIndex - 1]!;
            setTargetFrameId(prev.id);
          }
          break;
        }

        case 'next-frame': {
          clearPlaybackTimer();
          setPlaying(false);
          setFollowLatest(false);

          const currentIndex = currentList.findIndex((f) => f.id === selectedFrameId);
          if (currentIndex >= 0 && currentIndex < currentList.length - 1) {
            const next = currentList[currentIndex + 1]!;
            setTargetFrameId(next.id);
          }
          break;
        }

        case 'select-latest': {
          clearPlaybackTimer();
          setPlaying(false);
          setFollowLatest(true);

          const latest = findLatestNowcastFrame(activeCatalog?.frames ?? []);
          if (latest) {
            setTargetFrameId(latest.id);
          }
          break;
        }
      }
    },
    [activeCatalog, playing, selectedFrameId, clearPlaybackTimer],
  );

  // アンマウント時タイマークリア
  useEffect(() => {
    return () => {
      clearPlaybackTimer();
    };
  }, [clearPlaybackTimer]);

  // タイムライン ViewModel の生成
  const viewModel = activeCatalog
    ? buildNowcastTimelineViewModel({
        catalog: activeCatalog,
        selectedFrameId,
        playing,
      })
    : {
        layerLabel: '雨雲ナウキャスト',
        selectedFrameId: null,
        selectedFrameLabel: '',
        frames: [],
        playing: false,
        latestAvailable: false,
      };

  // WeatherTileOverlay 用の frame オブジェクト
  const targetFrame =
    activeCatalog && targetFrameId
      ? (activeCatalog.frames.find((f) => f.id === targetFrameId) ?? null)
      : null;

  const overlayFrame: WeatherTileOverlayFrame | null =
    enabled && targetFrame
      ? {
          id: targetFrame.id,
          urlTemplate: buildNowcastTileUrlTemplate({
            frame: targetFrame,
            terminalId,
            controlStatus,
          }),
        }
      : null;

  // 再生先読み対象のフレーム群 (§9.3.2)
  const prefetchFrames: readonly WeatherTileOverlayFrame[] | undefined = useMemo(() => {
    if (!enabled || !playing || !targetFrameId) return undefined;
    return computePrefetchFrames({
      frames: playbackFramesRef.current,
      targetFrameId,
      terminalId,
      controlStatus,
    });
  }, [enabled, playing, targetFrameId, terminalId, controlStatus]);

  return {
    viewModel,
    overlayFrame,
    prefetchFrames,
    retainLoaded: playing,
    handleIntent,
    handleSwapSettled,
  };
}
