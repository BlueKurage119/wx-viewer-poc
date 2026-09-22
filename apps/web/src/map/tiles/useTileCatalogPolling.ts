import { useState, useEffect, useRef } from 'react';
import type { TileCatalogFailure, TileCatalogResult } from '../../api/tileCatalogClient';

export const TILE_CATALOG_POLL_INTERVAL_MS = 60_000;
export const TILE_CATALOG_BACKOFF_MS = [60_000, 120_000, 240_000, 300_000] as const;

export type TileCatalogState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly catalog: T; readonly fetchedAt: number }
  | {
      readonly status: 'stale';
      readonly catalog: T;
      readonly fetchedAt: number;
      readonly failure: TileCatalogFailure;
    }
  | { readonly status: 'failed'; readonly failure: TileCatalogFailure };

interface PollingExecution {
  readonly generation: number;
  readonly controller: AbortController;
}

interface PollingTimer {
  readonly generation: number;
  readonly id: ReturnType<typeof setTimeout>;
}

/**
 * 索引ポーリング hook (レイヤー非依存)
 * 定期取得、不可視時の一時停止、指数バックオフ、AbortSignal による中断制御を提供する。
 */
export function useTileCatalogPolling<T>(params: {
  readonly load: (signal: AbortSignal) => Promise<TileCatalogResult<T>>;
  readonly resetKey: string;
  readonly enabled: boolean;
}): TileCatalogState<T> {
  const { load, resetKey, enabled } = params;

  const [state, setState] = useState<TileCatalogState<T>>({ status: 'loading' });

  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const failureCountRef = useRef(0);
  const lastSuccessRef = useRef<{ catalog: T; fetchedAt: number } | null>(null);
  const generationRef = useRef(0);
  const enabledRef = useRef(enabled);
  const visibilityRef = useRef<'visible' | 'hidden'>(
    typeof document === 'undefined' || document.visibilityState === 'visible'
      ? 'visible'
      : 'hidden',
  );
  const activeExecutionRef = useRef<PollingExecution | null>(null);
  const timerRef = useRef<PollingTimer | null>(null);

  // 非同期処理は render 時点の enabled ではなく、常にこの最新値で判定する。
  enabledRef.current = enabled;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const getVisibility = (): 'visible' | 'hidden' =>
      document.visibilityState === 'visible' ? 'visible' : 'hidden';
    let latestGeneration = generationRef.current;
    const issueNextGeneration = () => {
      latestGeneration += 1;
      generationRef.current = latestGeneration;
      return latestGeneration;
    };
    const clearTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current.id);
        timerRef.current = null;
      }
    };
    const abortActiveExecution = () => {
      activeExecutionRef.current?.controller.abort();
    };
    const isCurrentGeneration = (generation: number) =>
      generationRef.current === generation &&
      enabledRef.current &&
      visibilityRef.current === 'visible' &&
      getVisibility() === 'visible';
    const getNextIntervalMs = () => {
      if (failureCountRef.current === 0) {
        return TILE_CATALOG_POLL_INTERVAL_MS;
      }
      const idx = Math.min(failureCountRef.current - 1, TILE_CATALOG_BACKOFF_MS.length - 1);
      return TILE_CATALOG_BACKOFF_MS[idx];
    };

    const scheduleNextFetch = (
      generation: number,
      executeFetch: (value: number) => Promise<void>,
    ) => {
      if (!isCurrentGeneration(generation)) {
        return;
      }
      clearTimer();
      const delay = getNextIntervalMs();
      const id = setTimeout(() => {
        if (timerRef.current?.generation === generation && timerRef.current.id === id) {
          timerRef.current = null;
        }
        void executeFetch(generation);
      }, delay);
      timerRef.current = { generation, id };
    };

    const executeFetch = async (generation: number): Promise<void> => {
      if (!isCurrentGeneration(generation)) {
        return;
      }

      clearTimer();
      const controller = new AbortController();
      const execution: PollingExecution = { generation, controller };
      activeExecutionRef.current = execution;

      try {
        const result = await loadRef.current(controller.signal);
        if (!isCurrentGeneration(generation)) {
          return;
        }

        if (result.ok) {
          failureCountRef.current = 0;
          const fetchedAt = Date.now();
          lastSuccessRef.current = { catalog: result.value, fetchedAt };
          setState({ status: 'ready', catalog: result.value, fetchedAt });
        } else {
          failureCountRef.current += 1;
          if (lastSuccessRef.current !== null) {
            setState({
              status: 'stale',
              catalog: lastSuccessRef.current.catalog,
              fetchedAt: lastSuccessRef.current.fetchedAt,
              failure: result.failure,
            });
          } else {
            setState({ status: 'failed', failure: result.failure });
          }
        }
      } catch {
        if (!isCurrentGeneration(generation)) {
          return;
        }
        failureCountRef.current += 1;
        const failure: TileCatalogFailure = { kind: 'network' };
        if (lastSuccessRef.current !== null) {
          setState({
            status: 'stale',
            catalog: lastSuccessRef.current.catalog,
            fetchedAt: lastSuccessRef.current.fetchedAt,
            failure,
          });
        } else {
          setState({ status: 'failed', failure });
        }
      } finally {
        if (activeExecutionRef.current === execution) {
          activeExecutionRef.current = null;
        }
        scheduleNextFetch(generation, executeFetch);
      }
    };

    const startNewGeneration = (reset: boolean) => {
      const generation = issueNextGeneration();
      if (reset) {
        failureCountRef.current = 0;
        lastSuccessRef.current = null;
        setState({ status: 'loading' });
      }
      void executeFetch(generation);
    };

    visibilityRef.current = getVisibility();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    startNewGeneration(true);

    function handleVisibilityChange() {
      const visibility = getVisibility();
      if (visibilityRef.current === visibility) {
        return;
      }
      visibilityRef.current = visibility;
      issueNextGeneration();
      clearTimer();
      abortActiveExecution();
      if (visibility === 'visible') {
        startNewGeneration(false);
      }
    }

    return () => {
      issueNextGeneration();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearTimer();
      abortActiveExecution();
    };
  }, [resetKey, enabled]);

  return state;
}
