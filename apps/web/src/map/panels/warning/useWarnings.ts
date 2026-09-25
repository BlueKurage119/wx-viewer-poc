import { useCallback, useMemo } from 'react';
import type { WeatherControlStatus } from '@wx-viewer-poc/shared';
import type { InfoPanelCardInput } from '../panelDefinitions';
import { useTileCatalogPolling } from '../../tiles/useTileCatalogPolling';
import { fetchWarnings } from '../../../api/warnings';
import { buildWarningCards } from './warningBadges';

/**
 * 警報・注意報パネルの定期取得 (G3 #54 §4.4)。タイマーによる強調保持は行わない。
 */
export function useWarnings(params: {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
}): readonly InfoPanelCardInput[] {
  const { terminalId, controlStatus } = params;

  const load = useCallback(
    (signal: AbortSignal) => fetchWarnings({ terminalId, controlStatus, signal }),
    [terminalId, controlStatus],
  );

  const pollingState = useTileCatalogPolling({
    load,
    resetKey: `${terminalId}:${controlStatus}`,
    enabled: true,
  });

  return useMemo(() => {
    if (pollingState.status === 'ready') {
      // data===null(availability:'unavailable')のときは buildWarningCards 内で0件になる
      const availability =
        pollingState.catalog.metadata.availability === 'stale' ? 'stale' : 'available';
      return buildWarningCards(pollingState.catalog, availability);
    }
    if (pollingState.status === 'stale') {
      return buildWarningCards(pollingState.catalog, 'stale');
    }
    return [];
  }, [pollingState]);
}
