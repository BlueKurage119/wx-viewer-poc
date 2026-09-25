import { useState, useEffect, useCallback, useMemo } from 'react';
import type { WeatherControlStatus } from '@wx-viewer-poc/shared';
import type { InfoPanelCardInput } from '../panelDefinitions';
import { useTileCatalogPolling } from '../../tiles/useTileCatalogPolling';
import { fetchBosaiBulletins } from '../../../api/bosaiBulletins';
import { buildBosaiBulletinCards } from './bosaiBulletinCards';

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
      const { availability } = pollingState.catalog;
      // parseBulletinsResponse が 'unavailable' を取得失敗として弾くため、ここには来ない
      if (availability === 'unavailable') {
        return [];
      }
      return buildBosaiBulletinCards({
        bulletins: pollingState.catalog.bulletins,
        availability,
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
