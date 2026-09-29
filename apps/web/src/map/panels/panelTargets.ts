/**
 * 会場IDから各パネルの対象名を引く関数 (G1 §3.3)。
 *
 * `venueForecastTargets` を正とし、地図の表示位置・選択レイヤーには依存しない
 * （H5: 地図移動・レイヤー切替で対象名・時刻が変化しないことを担保する構造）。
 */
import type { VenueForecastTargets } from '@wx-viewer-poc/shared';
import type { InfoPanelId } from './panelDefinitions';

/**
 * パネルの見出しに表示する対象名。
 *
 * 気象防災速報は固定対象名を持たない（§3.4: 広域速報の元の対象区域名を書き換えない）ため
 * `undefined` を返す。
 */
export function resolvePanelTarget(
  targets: VenueForecastTargets,
  panelId: InfoPanelId,
): string | undefined {
  switch (panelId) {
    case 'bosaiBulletin':
      return undefined;
    case 'warning':
      return targets.warning.displayName;
    case 'warningTimeSeries':
      return targets.warningTimeseries.displayName;
    case 'earlyWarning':
      return targets.broadForecast.displayName;
    case 'amedas':
      return targets.amedas.displayName;
    case 'areaForecast':
      // パネル見出しを1行「東京地方／東京（北の丸公園）」に揃える (確定事項11)
      return `${targets.broadForecast.displayName}／${targets.temperatureForecast.displayName}`;
    default:
      return panelId satisfies never;
  }
}
