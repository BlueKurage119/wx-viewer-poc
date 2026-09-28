import { useCallback, useMemo } from 'react';
import type { AmedasResponse, VenueId, WeatherControlStatus } from '@wx-viewer-poc/shared';
import { fetchAmedas } from '../../../api/amedas';
import { useTileCatalogPolling } from '../../tiles/useTileCatalogPolling';
import type { InfoPanelCardInput } from '../panelDefinitions';
import { AmedasContent } from './AmedasContent';
import { formatAmedasTime, latestAmedasRow } from './amedasModel';

export function buildAmedasCard(
  response: AmedasResponse,
  now: number,
  pollingFailure: 'network' | 'http' | null = null,
): InfoPanelCardInput {
  const row = latestAmedasRow(response);
  const stale = pollingFailure !== null || response.metadata.availability === 'stale';
  const staleMessage = stale
    ? `${pollingFailure === 'http' ? '通信異常' : '更新できていません'}${row ? ` · 前回値：${formatAmedasTime(row.observedAt)}観測` : ''}`
    : null;
  return {
    key: 'amedas',
    status: row
      ? {
          kind: 'data',
          availability: stale ? 'stale' : 'available',
          time: row.observedAt,
          timeKind: 'observed',
        }
      : { kind: 'failed' },
    content: <AmedasContent response={response} now={now} staleMessage={staleMessage} />,
  };
}
export function buildAmedasFailedCard(failureKind: 'network' | 'http'): InfoPanelCardInput {
  return {
    key: 'amedas',
    status: { kind: 'failed' },
    content: <p role="alert">{failureKind === 'http' ? '通信異常' : '取得できません'}</p>,
  };
}
export function useAmedas(params: {
  terminalId: string;
  controlStatus: WeatherControlStatus;
  venueId: VenueId;
}): InfoPanelCardInput {
  const { terminalId, controlStatus, venueId } = params;
  const load = useCallback(
    async (signal: AbortSignal) => {
      const result = await fetchAmedas({ terminalId, controlStatus, signal });
      if (result.ok && result.value.venueId !== venueId)
        return {
          ok: false as const,
          failure: { kind: 'network' as const },
        };
      return result;
    },
    [terminalId, controlStatus, venueId],
  );
  const state = useTileCatalogPolling({
    load,
    resetKey: `${venueId}:${terminalId}:${controlStatus}`,
    enabled: true,
  });
  return useMemo(() => {
    if (
      (state.status === 'ready' || state.status === 'stale') &&
      (state.catalog.venueId !== venueId ||
        state.catalog.terminalId !== terminalId ||
        state.catalog.controlStatus !== controlStatus)
    )
      return { key: 'amedas', status: { kind: 'loading' } } satisfies InfoPanelCardInput;
    if (state.status === 'ready')
      return buildAmedasCard(state.catalog, Date.parse(state.catalog.evaluatedAt));
    if (state.status === 'stale')
      return buildAmedasCard(state.catalog, Date.now(), state.failure.kind);
    if (state.status === 'failed') return buildAmedasFailedCard(state.failure.kind);
    return { key: 'amedas', status: { kind: 'loading' } } satisfies InfoPanelCardInput;
  }, [state, venueId, terminalId, controlStatus]);
}
