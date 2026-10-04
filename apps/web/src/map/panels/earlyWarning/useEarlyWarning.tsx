import { useCallback, useMemo } from 'react';
import type { EarlyWarningResponse, WeatherControlStatus } from '@wx-viewer-poc/shared';
import type { InfoPanelCardInput } from '../panelDefinitions';
import type { TileCatalogState } from '../../tiles/useTileCatalogPolling';
import { useTileCatalogPolling } from '../../tiles/useTileCatalogPolling';
import { fetchEarlyWarning } from '../../../api/earlyWarning';
import { available } from './earlyWarningModel';
import { EarlyWarningContent } from './EarlyWarningContent';
import type { IssuedTime, IssuedTimes } from './issuedTimes';
import {
  isEarlyWarningFixtureActive,
  type EarlyWarningFixtureEnvironment,
} from './earlyWarningFixtureGate';
function time(response: EarlyWarningResponse, segment: 'near' | 'far'): IssuedTime {
  if (!available(response, segment)) return { kind: 'unavailable' };
  const issued = response[segment].metadata.issuedAt;
  return issued === null ? { kind: 'unknown' } : { kind: 'issued', value: issued };
}
export function buildEarlyWarningCard(
  response: EarlyWarningResponse,
  now: number,
  heading?: string,
  pollingAvailability: 'available' | 'stale' = 'available',
): InfoPanelCardInput {
  const issuedTimes: IssuedTimes = { near: time(response, 'near'), far: time(response, 'far') };
  const near = available(response, 'near');
  const far = available(response, 'far');
  return {
    key: 'earlyWarning',
    heading,
    status:
      near || far
        ? {
            kind: 'data',
            availability:
              pollingAvailability === 'stale' ||
              response.near.metadata.availability === 'stale' ||
              response.far.metadata.availability === 'stale'
                ? 'stale'
                : 'available',
            time: response.near.metadata.issuedAt ?? '',
            timeKind: 'issued',
          }
        : { kind: 'failed' },
    issuedTimes,
    content: <EarlyWarningContent response={response} issuedTimes={issuedTimes} now={now} />,
  };
}
export function useEarlyWarning(params: {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly fixtureEnvironment?: EarlyWarningFixtureEnvironment;
}): InfoPanelCardInput {
  const { terminalId, controlStatus, fixtureEnvironment } = params;
  const load = useCallback(
    (signal: AbortSignal) => fetchEarlyWarning({ terminalId, controlStatus, signal }),
    [terminalId, controlStatus],
  );
  const state = useTileCatalogPolling({
    load,
    resetKey: `${terminalId}:${controlStatus}`,
    enabled: !isEarlyWarningFixtureActive(fixtureEnvironment),
  });
  return useMemo(() => buildEarlyWarningPollingCard(state, Date.now()), [state]);
}
export function buildEarlyWarningPollingCard(
  state: TileCatalogState<EarlyWarningResponse>,
  nowMs: number,
): InfoPanelCardInput {
  if (state.status === 'ready') return buildEarlyWarningCard(state.catalog, nowMs);
  if (state.status === 'stale')
    return buildEarlyWarningCard(state.catalog, nowMs, undefined, 'stale');
  const kind = state.status === 'failed' ? 'unavailable' : 'loading';
  return {
    key: 'earlyWarning',
    status: state.status === 'failed' ? { kind: 'failed' } : { kind: 'loading' },
    issuedTimes: { near: { kind }, far: { kind } },
  };
}
