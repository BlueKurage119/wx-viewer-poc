import { WARNING_TELEGRAM_TYPES, type TelegramReceptionInput } from '../repositories/types.js';
import { resolveEarlyWarningTargetAreas } from '../venueForecastTargets.js';
import type { VenueId, VenueRegistry, WeatherControlStatus } from '@wx-viewer-poc/shared';
import type { WeatherReadKind } from './weatherContracts.js';

export type WeatherScopeKind = WeatherReadKind | 'nowcast' | 'kikikuru';

/** 会場全体のscopeも受け付けるが、通常更新は会場・運用区分・情報種を明示する。 */
export function weatherReadScope(
  venueId: VenueId,
  status: WeatherControlStatus,
  kind: WeatherScopeKind,
): string {
  return `${venueId}|${status}|${kind}`;
}
export function weatherScopeVenue(scope: string): string {
  return scope.split('|')[0]!;
}
export function weatherScopeBlocks(
  scopes: readonly string[],
  venueId: VenueId,
  status?: WeatherControlStatus,
  kind?: WeatherScopeKind,
): boolean {
  return scopes.some((scope) => {
    const [venue, scopeStatus, scopeKind] = scope.split('|');
    return (
      venue === venueId &&
      (!scopeStatus || !status || scopeStatus === status) &&
      (!scopeKind || !kind || scopeKind === kind)
    );
  });
}

/** 上流の地域コードを、その更新が触れる会場の読取scopeへ変換する。 */
export function telegramWeatherScopes(
  registry: VenueRegistry,
  reception: Pick<TelegramReceptionInput, 'telegramType' | 'controlStatus' | 'areas'>,
): readonly string[] {
  const status = reception.controlStatus;
  if (status !== 'normal' && status !== 'training' && status !== 'test') return [];
  const type = reception.telegramType ?? '';
  const kind: WeatherReadKind | undefined = (WARNING_TELEGRAM_TYPES as readonly string[]).includes(
    type,
  )
    ? 'warnings'
    : (
        {
          VPWP50: 'warning-timeseries',
          VPFD61: 'early-warning',
          VPFW60: 'early-warning',
          VPFD51: 'area-timeseries',
          VPBS50: 'bulletins',
          VPHW50: 'bulletins',
          VPHW51: 'bulletins',
        } as Record<string, WeatherReadKind>
      )[type];
  if (!kind) return [];
  const areas = new Set(reception.areas.map((area) => area.areaCode));
  return registry.listVenues().flatMap((venue) => {
    const codes =
      kind === 'warnings'
        ? [venue.warning.municipalCode]
        : kind === 'warning-timeseries'
          ? [venue.warningTimeseries.municipalCode]
          : kind === 'early-warning'
            ? resolveEarlyWarningTargetAreas(
                registry,
                venue.venueId,
                type === 'VPFW60' ? 'far' : 'near',
              ).map((target) => target.forecastAreaCode)
            : kind === 'area-timeseries'
              ? [venue.broadForecast.areaCode]
              : venue.bosaiBulletin.includedAreaCodes;
    return codes.some((code) => areas.has(code))
      ? [weatherReadScope(venue.venueId, status, kind)]
      : [];
  });
}
