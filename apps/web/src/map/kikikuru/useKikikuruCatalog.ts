import { useCallback } from 'react';
import type { WeatherControlStatus } from '@wx-viewer-poc/shared';
import { fetchKikikuruTimes } from '../../api/kikikuruTimes';
import { useTileCatalogPolling, type TileCatalogState } from '../tiles/useTileCatalogPolling';
import { buildKikikuruCatalog, type KikikuruCatalog } from './kikikuruCatalog';

export interface UseKikikuruCatalogParams {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly enabled: boolean;
}

/**
 * キキクル保存索引のポーリング hook (§6)
 *
 * 基準間隔 60 秒 (F2 共通の TILE_CATALOG_POLL_INTERVAL_MS) でポーリングする。
 * キキクル API は 1 回の応答で 3 種別すべてを返すため、resetKey にキキクル種別を含めない (§6.2, §10.1)。
 */
export function useKikikuruCatalog(
  params: UseKikikuruCatalogParams,
): TileCatalogState<KikikuruCatalog> {
  const { terminalId, controlStatus, enabled } = params;

  const load = useCallback(
    async (signal: AbortSignal) => {
      const result = await fetchKikikuruTimes({
        terminalId,
        controlStatus,
        signal,
      });

      if (!result.ok) {
        return result;
      }

      return {
        ok: true as const,
        value: buildKikikuruCatalog(result.value),
      };
    },
    [terminalId, controlStatus],
  );

  // 種別切替での即時再取得を行わないため、resetKey は terminalId と controlStatus のみで構成する (§6.2)
  const resetKey = `${terminalId}:${controlStatus}`;

  return useTileCatalogPolling<KikikuruCatalog>({
    load,
    resetKey,
    enabled,
  });
}
