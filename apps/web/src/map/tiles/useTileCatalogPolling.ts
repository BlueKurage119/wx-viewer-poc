import { useState, useEffect, useRef, useCallback } from 'react';
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isExecutingRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const getNextIntervalMs = useCallback(() => {
    if (failureCountRef.current === 0) {
      return TILE_CATALOG_POLL_INTERVAL_MS;
    }
    const idx = Math.min(failureCountRef.current - 1, TILE_CATALOG_BACKOFF_MS.length - 1);
    return TILE_CATALOG_BACKOFF_MS[idx];
  }, []);

  const executeFetch = useCallback(async () => {
    if (!enabled) return;

    // 前回の要求がまだ実行中なら中断
    if (abortControllerRef.current !== null) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    clearTimer();

    const controller = new AbortController();
    abortControllerRef.current = controller;
    isExecutingRef.current = true;

    try {
      const result = await loadRef.current(controller.signal);
      if (controller.signal.aborted) {
        return;
      }

      if (result.ok) {
        failureCountRef.current = 0;
        const fetchedAt = Date.now();
        lastSuccessRef.current = { catalog: result.value, fetchedAt };
        setState({
          status: 'ready',
          catalog: result.value,
          fetchedAt,
        });
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
          setState({
            status: 'failed',
            failure: result.failure,
          });
        }
      }
    } catch {
      if (controller.signal.aborted) {
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
        setState({
          status: 'failed',
          failure,
        });
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      isExecutingRef.current = false;

      // 可視状態かつ enabled の場合のみ次回タイマーをスケジュール
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        const nextMs = getNextIntervalMs();
        clearTimer();
        timerRef.current = setTimeout(() => {
          void executeFetch();
        }, nextMs);
      }
    }
  }, [clearTimer, enabled, getNextIntervalMs]);

  // resetKey や enabled の変更監視
  useEffect(() => {
    if (!enabled) {
      clearTimer();
      if (abortControllerRef.current !== null) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      return;
    }

    failureCountRef.current = 0;
    lastSuccessRef.current = null;
    setState({ status: 'loading' });

    void executeFetch();

    return () => {
      clearTimer();
      if (abortControllerRef.current !== null) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [resetKey, enabled, clearTimer, executeFetch]);

  // visibilitychange の監視
  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // 可視復帰時は即時取得
        void executeFetch();
      } else {
        // 不可視時は次回タイマー停止
        clearTimer();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, clearTimer, executeFetch]);

  return state;
}
