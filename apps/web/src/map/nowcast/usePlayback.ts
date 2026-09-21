import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { WeatherControlStatus } from '@wx-viewer-poc/shared';
import type { TimelineIntent, TimelineViewModel, TimelineFrame } from '../types';
import type { WeatherTileOverlayFrame } from '../tiles/WeatherTileOverlay';
import type { NowcastCatalog, NowcastFrame } from './nowcastCatalog';
import { buildNowcastTileUrlTemplate } from './nowcastTileUrl';
import { findLatestNowcastFrame, formatJstMonthDateTime, formatJstTime } from './nowcastTimeline';

export interface UsePlaybackParams {
  readonly catalog: NowcastCatalog | null;
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly enabled: boolean;
}

export const PLAYBACK_INTERVAL_MS = 1000;
export const PLAYBACK_PREFETCH_DEPTH = 3;
export const MANUAL_INTENT_DEBOUNCE_MS = 500;

export interface UsePlaybackResult {
  /** つまみ位置は intent、表示日時ラベルは settled を指す（§9.4.3） */
  readonly viewModel: TimelineViewModel & {
    /** スライダーのつまみ位置。intentFrameId に即座に追従する */
    readonly intentFrameId: string | null;
    /** 表示日時ラベル・地図画像が指すコマ。読込完了またはタイムアウトで進む */
    readonly settledFrameId: string | null;
  };
  /** デバウンス後の最終 intent だけがここに現れる（§9.4.4） */
  readonly overlayFrame: WeatherTileOverlayFrame | null;
  readonly prefetchFrames?: readonly WeatherTileOverlayFrame[];
  readonly retainLoaded?: boolean;
  readonly handleIntent: (intent: TimelineIntent) => void;
  readonly handleSwapSettled: (result: { frameId: string; complete: boolean }) => void;
}

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
 *
 * 手動操作の即応性 (§9.4):
 * - intentFrameId: スライダーつまみ、前後の加算基準、読み込むタイルの決定
 * - settledFrameId: 画像読込完了またはタイムアウトで更新。表示日時ラベルと地図画像
 * - activeCatalog: 表示中のコマ一覧
 * - MANUAL_INTENT_DEBOUNCE_MS (500ms) で連続操作中の読込を抑止し最終 intent のみ読み込む
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

  // 確定選択 (画像の読込完了またはタイムアウトで進む。表示日時ラベル・地図画像)
  const [settledFrameId, setSettledFrameId] = useState<string | null>(null);

  // 操作意図 (操作と同一フレームで即座に更新。つまみ位置・加算の基準)
  const [intentFrameId, setIntentFrameId] = useState<string | null>(() => {
    if (!catalog) return null;
    const latest = findLatestNowcastFrame(catalog.frames);
    return latest?.id ?? null;
  });

  // デバウンス後の最終 intent (WeatherTileOverlay へ渡す要求コマ)
  const [debouncedIntentFrameId, setDebouncedIntentFrameId] = useState<string | null>(() => {
    if (!catalog) return null;
    const latest = findLatestNowcastFrame(catalog.frames);
    return latest?.id ?? null;
  });

  // 再生状態
  const [playing, setPlaying] = useState(false);

  // 最新追従フラグ (初期値 true)
  const [followLatest, setFollowLatest] = useState(true);

  const playbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackFramesRef = useRef<readonly NowcastFrame[]>([]);
  const latestCatalogRef = useRef<NowcastCatalog | null>(catalog);
  const intentFrameIdRef = useRef<string | null>(intentFrameId);
  const playingRef = useRef<boolean>(playing);

  useEffect(() => {
    latestCatalogRef.current = catalog;
  }, [catalog]);

  useEffect(() => {
    intentFrameIdRef.current = intentFrameId;
  }, [intentFrameId]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  const clearPlaybackTimer = useCallback(() => {
    if (playbackTimerRef.current !== null) {
      clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
  }, []);

  const clearDebounceTimer = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  // 手動操作用デバウンス実行 (500ms)
  const triggerManualDebounce = useCallback((targetId: string) => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedIntentFrameId(targetId);
      debounceTimerRef.current = null;
    }, MANUAL_INTENT_DEBOUNCE_MS);
  }, []);

  // カタログ更新時の同期処理 (§9.2, §10)
  useEffect(() => {
    if (!catalog) {
      setActiveCatalog(null);
      setSettledFrameId(null);
      setIntentFrameId(null);
      setDebouncedIntentFrameId(null);
      clearDebounceTimer();
      return;
    }

    // 再生中は一覧を固定し、新しいカタログの反映を停止時まで保留する
    if (playing) {
      return;
    }

    setActiveCatalog(catalog);

    const latestFrame = findLatestNowcastFrame(catalog.frames);

    if (intentFrameId === null) {
      // 初回カタログ取得時: 代表最新コマを選択 (即座にロード開始)
      if (latestFrame) {
        setIntentFrameId(latestFrame.id);
        setDebouncedIntentFrameId(latestFrame.id);
      }
      return;
    }

    if (followLatest) {
      // 最新追従中: 最新代表コマへ進める
      if (latestFrame && latestFrame.id !== intentFrameId) {
        setIntentFrameId(latestFrame.id);
        setDebouncedIntentFrameId(latestFrame.id);
      }
    } else {
      // 手動保持中: 現在のコマが新しいカタログに存在するか確認
      const exists = catalog.frames.some((f) => f.id === intentFrameId);
      if (!exists && latestFrame) {
        setIntentFrameId(latestFrame.id);
        setDebouncedIntentFrameId(latestFrame.id);
      }
    }
  }, [catalog, playing, followLatest, intentFrameId, clearDebounceTimer]);

  // enabled が false (非選択レイヤー) になった場合は再生停止
  useEffect(() => {
    if (!enabled) {
      setPlaying(false);
      clearPlaybackTimer();
      clearDebounceTimer();
    }
  }, [enabled, clearPlaybackTimer, clearDebounceTimer]);

  // 次の再生コマをスケジュールする (再生自動送りにはデバウンスを適用しない §9.4.6)
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
        clearDebounceTimer();
        setIntentFrameId(nextFrame.id);
        setDebouncedIntentFrameId(nextFrame.id);
      }, PLAYBACK_INTERVAL_MS);
    },
    [clearPlaybackTimer, clearDebounceTimer],
  );

  // WeatherTileOverlay の swap 完了通知ハンドラ (§9.3, §9.4.5)
  const handleSwapSettled = useCallback(
    (result: { frameId: string; complete: boolean }) => {
      // §9.4.5: frameId が現在の intentFrameId と一致する場合にかぎり settledFrameId を進める
      // 一致しない場合（読込中にさらに操作が入り intent が動いた場合）は更新せず、現在の読込を継続
      // 古い完了通知で表示日時を巻き戻さない
      if (result.frameId === intentFrameIdRef.current) {
        setSettledFrameId(result.frameId);
      }

      if (playingRef.current) {
        // 再生中は切替完了時点から 1,000 ms 後に次コマを予約
        scheduleNextPlaybackFrame(result.frameId, playbackFramesRef.current);
      }
    },
    [scheduleNextPlaybackFrame],
  );

  // タイムライン操作 intent ハンドラ (§9.4)
  const handleIntent = useCallback(
    (intent: TimelineIntent) => {
      const currentList = activeCatalog ? activeCatalog.frames.filter((f) => f.representative) : [];
      if (currentList.length === 0) return;

      switch (intent.type) {
        case 'toggle-play': {
          if (!playing) {
            // 再生開始: 現在のコマ一覧を固定し、次コマへ進める (デバウンスなし)
            clearPlaybackTimer();
            clearDebounceTimer();
            playbackFramesRef.current = currentList;
            setPlaying(true);
            setFollowLatest(false);

            const baseId = intentFrameIdRef.current ?? settledFrameId;
            const currentIndex = currentList.findIndex((f) => f.id === baseId);
            let nextIndex = currentIndex + 1;
            if (nextIndex >= currentList.length || nextIndex < 0) {
              nextIndex = 0;
            }
            const nextFrame = currentList[nextIndex]!;
            intentFrameIdRef.current = nextFrame.id;
            setIntentFrameId(nextFrame.id);
            setDebouncedIntentFrameId(nextFrame.id);
          } else {
            // 再生停止: タイマー停止し、最新カタログを反映
            clearPlaybackTimer();
            clearDebounceTimer();
            setPlaying(false);

            if (latestCatalogRef.current) {
              setActiveCatalog(latestCatalogRef.current);
              const latestList = latestCatalogRef.current.frames.filter((f) => f.representative);
              const exists = latestList.some((f) => f.id === intentFrameIdRef.current);
              if (!exists) {
                const latestFrame = findLatestNowcastFrame(latestCatalogRef.current.frames);
                if (latestFrame) {
                  intentFrameIdRef.current = latestFrame.id;
                  setIntentFrameId(latestFrame.id);
                  setDebouncedIntentFrameId(latestFrame.id);
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
            intentFrameIdRef.current = target.id;
            setIntentFrameId(target.id);
            triggerManualDebounce(target.id);
          }
          break;
        }

        case 'previous-frame': {
          clearPlaybackTimer();
          setPlaying(false);
          setFollowLatest(false);

          // 加算基準は intentFrameIdRef.current (§9.4.4: 握り潰さず加算)
          const currentId = intentFrameIdRef.current;
          const currentIndex = currentList.findIndex((f) => f.id === currentId);
          if (currentIndex > 0) {
            const prev = currentList[currentIndex - 1]!;
            intentFrameIdRef.current = prev.id;
            setIntentFrameId(prev.id);
            triggerManualDebounce(prev.id);
          }
          break;
        }

        case 'next-frame': {
          clearPlaybackTimer();
          setPlaying(false);
          setFollowLatest(false);

          // 加算基準は intentFrameIdRef.current (§9.4.4: 5連打で+5コマ)
          const currentId = intentFrameIdRef.current;
          const currentIndex = currentList.findIndex((f) => f.id === currentId);
          if (currentIndex >= 0 && currentIndex < currentList.length - 1) {
            const next = currentList[currentIndex + 1]!;
            intentFrameIdRef.current = next.id;
            setIntentFrameId(next.id);
            triggerManualDebounce(next.id);
          }
          break;
        }

        case 'select-latest': {
          clearPlaybackTimer();
          setPlaying(false);
          setFollowLatest(true);

          const latest = findLatestNowcastFrame(activeCatalog?.frames ?? []);
          if (latest) {
            intentFrameIdRef.current = latest.id;
            setIntentFrameId(latest.id);
            triggerManualDebounce(latest.id);
          }
          break;
        }
      }
    },
    [
      activeCatalog,
      playing,
      settledFrameId,
      clearPlaybackTimer,
      clearDebounceTimer,
      triggerManualDebounce,
    ],
  );

  // アンマウント時タイマークリア
  useEffect(() => {
    return () => {
      clearPlaybackTimer();
      clearDebounceTimer();
    };
  }, [clearPlaybackTimer, clearDebounceTimer]);

  // タイムライン ViewModel の生成 (§9.4.2, §9.4.3)
  const timelineFrames: TimelineFrame[] = (activeCatalog?.frames ?? [])
    .filter((f) => f.representative)
    .map((f) => ({
      id: f.id,
      displayTime: formatJstTime(f.validTime),
      kind: f.kind,
      enabled: true,
    }));

  // 表示日時ラベルは settledFrameId から決定 (読込完了まで前のコマを維持 §9.4.3)
  const settledFrame =
    activeCatalog && settledFrameId
      ? (activeCatalog.frames.find((f) => f.id === settledFrameId) ?? null)
      : null;

  const selectedFrameLabel =
    settledFrame !== null ? formatJstMonthDateTime(settledFrame.validTime) : '';

  // 「現在」ボタン活性判定は intentFrameId が最新かどうか
  const latestFrame = activeCatalog ? findLatestNowcastFrame(activeCatalog.frames) : null;
  const isAtLatest =
    latestFrame !== null && intentFrameId !== null && latestFrame.id === intentFrameId;
  const latestAvailable = latestFrame !== null && !isAtLatest;

  const viewModel: TimelineViewModel & {
    readonly intentFrameId: string | null;
    readonly settledFrameId: string | null;
  } = {
    layerLabel: '雨雲ナウキャスト',
    // selectedFrameId は settledFrameId を指すものとして維持 (§9.4.2)
    selectedFrameId: settledFrameId,
    selectedFrameLabel,
    frames: timelineFrames,
    playing,
    latestAvailable,
    intentFrameId,
    settledFrameId,
  };

  // WeatherTileOverlay 用の frame オブジェクト (デバウンス後の最終 intent のみ要求 §9.4.4)
  const targetFrame =
    activeCatalog && debouncedIntentFrameId
      ? (activeCatalog.frames.find((f) => f.id === debouncedIntentFrameId) ?? null)
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
    if (!enabled || !playing || !debouncedIntentFrameId) return undefined;
    return computePrefetchFrames({
      frames: playbackFramesRef.current,
      targetFrameId: debouncedIntentFrameId,
      terminalId,
      controlStatus,
    });
  }, [enabled, playing, debouncedIntentFrameId, terminalId, controlStatus]);

  return {
    viewModel,
    overlayFrame,
    prefetchFrames,
    retainLoaded: playing,
    handleIntent,
    handleSwapSettled,
  };
}
