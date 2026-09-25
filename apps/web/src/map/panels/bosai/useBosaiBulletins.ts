import { useState, useEffect, useCallback, useMemo } from 'react';
import type { WeatherControlStatus } from '@wx-viewer-poc/shared';
import type { InfoPanelCardInput } from '../panelDefinitions';
import { useTileCatalogPolling } from '../../tiles/useTileCatalogPolling';
import { fetchBosaiBulletins } from '../../../api/bosaiBulletins';
import { buildBosaiBulletinCards, toCardAvailability } from './bosaiBulletinCards';

export const BOSAI_BULLETIN_NOW_UPDATE_INTERVAL_MS = 60_000;

export function useBosaiBulletins(params: {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
}): readonly InfoPanelCardInput[] {
  const { terminalId, controlStatus } = params;

  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, BOSAI_BULLETIN_NOW_UPDATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(
    (signal: AbortSignal) => fetchBosaiBulletins({ terminalId, controlStatus, signal }),
    [terminalId, controlStatus],
  );

  const pollingState = useTileCatalogPolling({
    load,
    resetKey: `${terminalId}:${controlStatus}`,
    enabled: true,
  });

  return useMemo(() => {
    if (pollingState.status === 'ready') {
      return buildBosaiBulletinCards({
        bulletins: pollingState.catalog.bulletins,
        availability: toCardAvailability(pollingState.catalog.availability),
        nowMs,
      });
    }
    if (pollingState.status === 'stale') {
      return buildBosaiBulletinCards({
        bulletins: pollingState.catalog.bulletins,
        availability: 'stale',
        nowMs,
      });
    }
    return [];
  }, [pollingState, nowMs]);
}
