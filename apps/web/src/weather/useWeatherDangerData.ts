import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WeatherControlStatus } from '@wx-viewer-poc/shared';
import { fetchWarnings } from '../api/warnings';
import { fetchBosaiBulletins } from '../api/bosaiBulletins';
import { fetchEarlyWarning } from '../api/earlyWarning';
import { useTileCatalogPolling } from '../map/tiles/useTileCatalogPolling';
import { buildWarningPollingCards } from '../map/panels/warning/useWarnings';
import {
  BOSAI_BULLETIN_NOW_UPDATE_INTERVAL_MS,
  buildBosaiPollingCards,
} from '../map/panels/bosai/useBosaiBulletins';
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
/**
 * パネルの制御状態。URL クエリ `?controlStatus=training` があれば端末種別によらず training、
 * それ以外は normal。地図レイヤー・ナビの危険度バッジには使わない。
 */
export function resolvePanelControlStatus(search: string): WeatherControlStatus {
  return new URLSearchParams(search).get('controlStatus') === 'training' ? 'training' : 'normal';
}

/** 通常表示のとき、警報・注意報パネルと気象防災速報パネルに重ねる訓練のカードを読み込む。 */
export function useTrainingOverlayCards({
  terminalId,
  enabled,
}: {
  readonly terminalId: string;
  readonly enabled: boolean;
}): {
  readonly warning: readonly InfoPanelCardInput[];
  readonly bosaiBulletin: readonly InfoPanelCardInput[];
} {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNowMs(Date.now()), BOSAI_BULLETIN_NOW_UPDATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled]);
  const warningLoad = useCallback(
    (signal: AbortSignal) => fetchWarnings({ terminalId, controlStatus: 'training', signal }),
    [terminalId],
  );
  const bulletinLoad = useCallback(
    (signal: AbortSignal) => fetchBosaiBulletins({ terminalId, controlStatus: 'training', signal }),
    [terminalId],
  );
  const resetKey = `${terminalId}:training-overlay`;
  const warning = useTileCatalogPolling({ load: warningLoad, resetKey, enabled });
  const bulletin = useTileCatalogPolling({ load: bulletinLoad, resetKey, enabled });
  return useMemo(() => {
    if (!enabled) return { warning: [], bosaiBulletin: [] };
    // 訓練側の取得失敗・読込中は何も出さず、通常側の表示に影響させない。
    // 訓練のカードは通常のカードと key が重ならないようにし、警報は枠で区別する。
    return {
      warning: buildWarningPollingCards(warning).map((card) => ({
        ...card,
        key: `training-overlay-${card.key}`,
        heading: undefined, // 見出しはパネル名「警報・注意報」＋訓練バッジ
        trainingOverlay: true,
      })),
      bosaiBulletin: buildBosaiPollingCards(bulletin, nowMs).map((card) => ({
        ...card,
        key: `training-overlay-${card.key}`,
      })),
    };
  }, [enabled, warning, bulletin, nowMs]);
}

export function useWeatherDangerData({
  terminalId,
  controlStatus,
  nowMs,
  fixtureEnvironment,
  enabled = true,
}: {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly nowMs: number;
  readonly fixtureEnvironment?: EarlyWarningFixtureEnvironment;
  /** false の間は取得しない（訓練切替の二重取得を避けるための入口）。 */
  readonly enabled?: boolean;
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
  const warning = useTileCatalogPolling({ load: warningLoad, resetKey, enabled });
  const bulletin = useTileCatalogPolling({ load: bulletinLoad, resetKey, enabled });
  const early = useTileCatalogPolling({
    load: earlyLoad,
    resetKey,
    enabled: enabled && !isEarlyWarningFixtureActive(fixtureEnvironment),
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
