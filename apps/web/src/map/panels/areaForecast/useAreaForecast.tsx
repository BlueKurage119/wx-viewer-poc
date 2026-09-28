import { useCallback, useMemo } from 'react';
import type { AreaTimeseriesResponse, WeatherControlStatus } from '@wx-viewer-poc/shared';
import type { InfoPanelCardInput } from '../panelDefinitions';
import { useTileCatalogPolling } from '../../tiles/useTileCatalogPolling';
import { fetchAreaForecast } from '../../../api/areaForecast';
import { AreaForecastContent } from './AreaForecastContent';
import {
  isAreaForecastFixtureActive,
  type AreaForecastFixtureEnvironment,
} from './areaForecastFixtureGate';

export function buildAreaForecastCard(
  response: AreaTimeseriesResponse,
  now: number,
  heading?: string,
  pollingAvailability: 'available' | 'stale' = 'available',
): InfoPanelCardInput {
  const isAvailable = response.data !== null && response.metadata.availability !== 'unavailable';

  return {
    key: 'areaForecast',
    heading,
    status: isAvailable
      ? {
          kind: 'data',
          availability:
            pollingAvailability === 'stale' || response.metadata.availability === 'stale'
              ? 'stale'
              : 'available',
          time: response.metadata.issuedAt ?? '',
          timeKind: 'issued',
        }
      : { kind: 'failed' },
    content: <AreaForecastContent response={response} now={now} />,
  };
}

export function useAreaForecast(params: {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly fixtureEnvironment?: AreaForecastFixtureEnvironment;
}): InfoPanelCardInput {
  const { terminalId, controlStatus, fixtureEnvironment } = params;
  const load = useCallback(
    (signal: AbortSignal) => fetchAreaForecast({ terminalId, controlStatus, signal }),
    [terminalId, controlStatus],
  );
  const state = useTileCatalogPolling({
    load,
    resetKey: `${terminalId}:${controlStatus}`,
    enabled: !isAreaForecastFixtureActive(fixtureEnvironment),
  });

  return useMemo(() => {
    if (state.status === 'ready') {
      return buildAreaForecastCard(state.catalog, Date.now());
    }
    if (state.status === 'stale') {
      return buildAreaForecastCard(state.catalog, Date.now(), undefined, 'stale');
    }
    return {
      key: 'areaForecast',
      status: state.status === 'failed' ? { kind: 'failed' } : { kind: 'loading' },
    };
  }, [state]);
}
