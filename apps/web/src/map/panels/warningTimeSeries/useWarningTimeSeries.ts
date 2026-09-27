import { useCallback, useMemo } from 'react';
import type { WeatherControlStatus } from '@wx-viewer-poc/shared';
import type { InfoPanelCardInput } from '../panelDefinitions';
import { useTileCatalogPolling } from '../../tiles/useTileCatalogPolling';
import { fetchWarningTimeseries } from '../../../api/warningTimeseries';
import { buildWarningTimeSeriesCard } from './warningTimeSeriesModel';

/**
 * 警報等時系列パネルの定期取得 (G4 #55 §4.1)。
 * 現在列を追従させるタイマーは置かず、`now` は応答更新時にだけ取る。
 */
export function useWarningTimeSeries(params: {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
}): InfoPanelCardInput {
  const { terminalId, controlStatus } = params;

  const load = useCallback(
    (signal: AbortSignal) => fetchWarningTimeseries({ terminalId, controlStatus, signal }),
    [terminalId, controlStatus],
  );

  const pollingState = useTileCatalogPolling({
    load,
    resetKey: `${terminalId}:${controlStatus}`,
    enabled: true,
  });

  return useMemo(() => {
    if (pollingState.status === 'ready') {
      const availability =
        pollingState.catalog.metadata.availability === 'stale' ? 'stale' : 'available';
      return buildWarningTimeSeriesCard(pollingState.catalog, availability, Date.now());
    }
    if (pollingState.status === 'stale') {
      return buildWarningTimeSeriesCard(pollingState.catalog, 'stale', Date.now());
    }
    if (pollingState.status === 'failed') {
      return { key: 'warningTimeSeries', status: { kind: 'failed' } };
    }
    return { key: 'warningTimeSeries', status: { kind: 'loading' } };
  }, [pollingState]);
}
