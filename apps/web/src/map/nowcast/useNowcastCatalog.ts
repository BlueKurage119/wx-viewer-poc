import { useCallback } from 'react';
import type { WeatherControlStatus } from '@wx-viewer-poc/shared';
import { useTileCatalogPolling, type TileCatalogState } from '../tiles/useTileCatalogPolling';
import { fetchNowcastTimes } from '../../api/nowcastTimes';
import { buildNowcastCatalog, type NowcastCatalog } from './nowcastCatalog';

export type NowcastCatalogState = TileCatalogState<NowcastCatalog>;

/**
 * 雨雲ナウキャストの索引ポーリング hook (§8.5)
 */
export function useNowcastCatalog(params: {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly enabled: boolean;
}): NowcastCatalogState {
  const { terminalId, controlStatus, enabled } = params;

  const load = useCallback(
    async (signal: AbortSignal) => {
      const res = await fetchNowcastTimes({
        terminalId,
        controlStatus,
        signal,
      });
      if (!res.ok) {
        return res;
      }
      return {
        ok: true as const,
        value: buildNowcastCatalog(res.value),
      };
    },
    [terminalId, controlStatus],
  );

  const resetKey = `${terminalId}:${controlStatus}:nowcast`;

  return useTileCatalogPolling<NowcastCatalog>({
    load,
    resetKey,
    enabled,
  });
}
