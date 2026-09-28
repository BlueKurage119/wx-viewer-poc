import { useCallback, useMemo } from 'react';
import type { EarlyWarningResponse, WeatherControlStatus } from '@wx-viewer-poc/shared';
import type { InfoPanelCardInput } from '../panelDefinitions';
import { useTileCatalogPolling } from '../../tiles/useTileCatalogPolling';
import { fetchEarlyWarning } from '../../../api/earlyWarning';
import { available } from './earlyWarningModel';
import { EarlyWarningContent } from './EarlyWarningContent';
import type { IssuedTime, IssuedTimes } from './issuedTimes';
function time(response: EarlyWarningResponse, segment: 'near' | 'far'): IssuedTime {
  if (!available(response, segment)) return { kind: 'unavailable' };
  const issued = response[segment].metadata.issuedAt;
  return issued === null ? { kind: 'unknown' } : { kind: 'issued', value: issued };
}
function card(response: EarlyWarningResponse, now: number): InfoPanelCardInput {
  const issuedTimes: IssuedTimes = { near: time(response, 'near'), far: time(response, 'far') };
  const near = available(response, 'near');
  const far = available(response, 'far');
  return {
    key: 'earlyWarning',
    status:
      near || far
        ? {
            kind: 'data',
            availability:
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
}): InfoPanelCardInput {
  const { terminalId, controlStatus } = params;
  const load = useCallback(
    (signal: AbortSignal) => fetchEarlyWarning({ terminalId, controlStatus, signal }),
    [terminalId, controlStatus],
  );
  const state = useTileCatalogPolling({
    load,
    resetKey: `${terminalId}:${controlStatus}`,
    enabled: true,
  });
  return useMemo(() => {
    if (state.status === 'ready' || state.status === 'stale')
      return card(state.catalog, Date.now());
    const kind = state.status === 'failed' ? 'unavailable' : 'loading';
    return {
      key: 'earlyWarning',
      status: state.status === 'failed' ? { kind: 'failed' } : { kind: 'loading' },
      issuedTimes: { near: { kind }, far: { kind } },
    };
  }, [state]);
}
