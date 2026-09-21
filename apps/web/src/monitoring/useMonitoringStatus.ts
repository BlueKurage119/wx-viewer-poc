import { useEffect, useState } from 'react';
import type { MonitoringStatusResponse } from '@wx-viewer-poc/shared';
import { fetchMonitoringStatus } from '../api/monitoringStatus';

export type MonitoringLoadState =
  | { readonly phase: 'loading'; readonly data: null }
  | { readonly phase: 'ready'; readonly data: MonitoringStatusResponse }
  | { readonly phase: 'refreshing'; readonly data: MonitoringStatusResponse | null }
  | { readonly phase: 'failed'; readonly data: MonitoringStatusResponse | null };

const REFRESH_DELAY_MS = 5_000;
const REQUEST_TIMEOUT_MS = 10_000;

/** 監視画面が表示中だけ、直列の状態取得を行う。 */
export function useMonitoringStatus(terminalId: string): MonitoringLoadState {
  const [state, setState] = useState<MonitoringLoadState>({ phase: 'loading', data: null });

  useEffect(() => {
    let disposed = false;
    let visible = document.visibilityState !== 'hidden';
    let requestController: AbortController | null = null;
    let refreshTimer: number | null = null;
    let timeoutTimer: number | null = null;
    let latestData: MonitoringStatusResponse | null = null;
    let hasFailed = false;

    const clearTimers = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      if (timeoutTimer !== null) window.clearTimeout(timeoutTimer);
      refreshTimer = null;
      timeoutTimer = null;
    };
    const schedule = () => {
      if (disposed || !visible) return;
      refreshTimer = window.setTimeout(load, REFRESH_DELAY_MS);
    };
    const load = () => {
      if (disposed || !visible || requestController !== null) return;
      requestController = new AbortController();
      if (!hasFailed) {
        setState(
          latestData ? { phase: 'refreshing', data: latestData } : { phase: 'loading', data: null },
        );
      }
      timeoutTimer = window.setTimeout(() => requestController?.abort(), REQUEST_TIMEOUT_MS);
      void fetchMonitoringStatus(terminalId, requestController.signal)
        .then((data) => {
          if (disposed || !visible) return;
          hasFailed = false;
          latestData = data;
          setState({ phase: 'ready', data });
        })
        .catch(() => {
          if (disposed || !visible) return;
          hasFailed = true;
          setState({ phase: 'failed', data: latestData });
        })
        .finally(() => {
          requestController = null;
          if (timeoutTimer !== null) window.clearTimeout(timeoutTimer);
          timeoutTimer = null;
          schedule();
        });
    };
    const onVisibilityChange = () => {
      visible = document.visibilityState !== 'hidden';
      clearTimers();
      if (!visible) {
        requestController?.abort();
        requestController = null;
        return;
      }
      if (!hasFailed) {
        setState(
          latestData ? { phase: 'refreshing', data: latestData } : { phase: 'loading', data: null },
        );
      }
      load();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    if (visible) load();
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearTimers();
      requestController?.abort();
    };
  }, [terminalId]);

  return state;
}
