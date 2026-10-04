import { useCallback, useMemo } from 'react';
import type { WeatherControlStatus } from '@wx-viewer-poc/shared';
import { fetchWarnings } from '../api/warnings';
import { fetchBosaiBulletins } from '../api/bosaiBulletins';
import { fetchEarlyWarning } from '../api/earlyWarning';
import { useTileCatalogPolling } from '../map/tiles/useTileCatalogPolling';
import { buildWarningPollingCards } from '../map/panels/warning/useWarnings';
import { buildBosaiPollingCards } from '../map/panels/bosai/useBosaiBulletins';
import { buildEarlyWarningPollingCard } from '../map/panels/earlyWarning/useEarlyWarning';
import {
  isEarlyWarningFixtureActive,
  type EarlyWarningFixtureEnvironment,
} from '../map/panels/earlyWarning/earlyWarningFixtureGate';
import type { InfoPanelCardInput } from '../map/panels/panelDefinitions';
import {
  resolveHighestDangerLevel,
  resolveWarningDangerLevel,
  resolveEarlyWarningDangerLevel,
  resolveBulletinDangerLevel,
  type WeatherDangerLevel,
} from './weatherDangerModel';
export interface WeatherDangerPanelData {
  readonly bosaiBulletin: readonly InfoPanelCardInput[];
  readonly warning: readonly InfoPanelCardInput[];
  readonly earlyWarning: InfoPanelCardInput;
}
export interface WeatherDangerData {
  readonly panels: WeatherDangerPanelData;
  readonly level: WeatherDangerLevel | null;
}
export function useWeatherDangerData({
  terminalId,
  controlStatus,
  nowMs,
  fixtureEnvironment,
}: {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly nowMs: number;
  readonly fixtureEnvironment?: EarlyWarningFixtureEnvironment;
}): WeatherDangerData {
  const warningLoad = useCallback(
    (signal: AbortSignal) => fetchWarnings({ terminalId, controlStatus, signal }),
    [terminalId, controlStatus],
  );
  const bulletinLoad = useCallback(
    (signal: AbortSignal) => fetchBosaiBulletins({ terminalId, controlStatus, signal }),
    [terminalId, controlStatus],
  );
  const earlyLoad = useCallback(
    (signal: AbortSignal) => fetchEarlyWarning({ terminalId, controlStatus, signal }),
    [terminalId, controlStatus],
  );
  const resetKey = `${terminalId}:${controlStatus}`;
  const warning = useTileCatalogPolling({ load: warningLoad, resetKey, enabled: true });
  const bulletin = useTileCatalogPolling({ load: bulletinLoad, resetKey, enabled: true });
  const early = useTileCatalogPolling({
    load: earlyLoad,
    resetKey,
    enabled: !isEarlyWarningFixtureActive(fixtureEnvironment),
  });
  return useMemo(() => {
    const panels = {
      bosaiBulletin: buildBosaiPollingCards(bulletin, nowMs),
      warning: buildWarningPollingCards(warning),
      earlyWarning: buildEarlyWarningPollingCard(early, nowMs),
    };
    return {
      panels,
      level: resolveHighestDangerLevel([
        warning.status === 'ready' || warning.status === 'stale'
          ? resolveWarningDangerLevel(warning.catalog)
          : null,
        early.status === 'ready' || early.status === 'stale'
          ? resolveEarlyWarningDangerLevel(early.catalog, nowMs)
          : null,
        resolveBulletinDangerLevel(panels.bosaiBulletin),
      ]),
    };
  }, [warning, bulletin, early, nowMs]);
}
