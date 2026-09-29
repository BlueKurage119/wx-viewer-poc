import { type AmedasTarget, type VenueId, type VenueRegistry } from '@wx-viewer-poc/shared';
import type {
  AreaTimeseriesForecastTarget,
  BosaiBulletinTarget,
  EarlyWarningTargetArea,
  WarningCurrentTargetArea,
  WarningTargetArea,
  WarningTimeseriesTargetArea,
} from './repositories/types.js';

/** C2 用の市町村等警報対象を会場定義から解決する。 */
export function resolveWarningTargetArea(
  registryOrVenueId: VenueRegistry | VenueId,
  maybeVenueId?: VenueId,
): WarningTargetArea {
  const [registry, venueId] = registryAndVenue(registryOrVenueId, maybeVenueId);
  const target = registry.getVenue(venueId).warning;
  return { municipalCode: target.municipalCode, displayName: target.displayName };
}

/** C3 用の市町村等・府県予報区対象を会場定義から解決する。 */
export function resolveWarningCurrentTargetArea(
  registryOrVenueId: VenueRegistry | VenueId,
  maybeVenueId?: VenueId,
): WarningCurrentTargetArea {
  const [registry, venueId] = registryAndVenue(registryOrVenueId, maybeVenueId);
  const target = registry.getVenue(venueId).warning;
  return {
    municipalCode: target.municipalCode,
    displayName: target.displayName,
    prefectureCode: target.prefectureCode,
  };
}

/** C4 用の警報等時系列対象を会場定義から解決する。 */
export function resolveWarningTimeseriesTargetArea(
  registryOrVenueId: VenueRegistry | VenueId,
  maybeVenueId?: VenueId,
): WarningTimeseriesTargetArea {
  const [registry, venueId] = registryAndVenue(registryOrVenueId, maybeVenueId);
  const target = registry.getVenue(venueId).warningTimeseries;
  return { municipalCode: target.municipalCode, displayName: target.displayName };
}

/** C2 用の会場 ID と解決済み対象を対で運ぶ。パース結果を会場間で共有しないため、両者を 1 引数にまとめる。 */
export interface VenueWarningContext {
  readonly venueId: VenueId;
  readonly targetArea: WarningCurrentTargetArea;
}

/** C2 用のコンテキストを会場定義から解決する。 */
export function resolveVenueWarningContext(
  registry: VenueRegistry,
  venueId: VenueId,
): VenueWarningContext {
  return { venueId, targetArea: resolveWarningCurrentTargetArea(registry, venueId) };
}

/** C4 用の会場 ID と解決済み対象を対で運ぶ。 */
export interface VenueWarningTimeseriesContext {
  readonly venueId: VenueId;
  readonly targetArea: WarningTimeseriesTargetArea;
}

/** C4 用のコンテキストを会場定義から解決する。 */
export function resolveVenueWarningTimeseriesContext(
  registry: VenueRegistry,
  venueId: VenueId,
): VenueWarningTimeseriesContext {
  return { venueId, targetArea: resolveWarningTimeseriesTargetArea(registry, venueId) };
}

/** C5 用の広域予報対象を会場定義から解決する。 */
export function resolveEarlyWarningTargetArea(
  registryOrVenueId: VenueRegistry | VenueId,
  maybeVenueId?: VenueId,
): EarlyWarningTargetArea {
  const [registry, venueId] = registryAndVenue(registryOrVenueId, maybeVenueId);
  const target = registry.getVenue(venueId).broadForecast;
  return { forecastAreaCode: target.areaCode, displayName: target.displayName };
}

/** C6 用の地域時系列予報対象（広域予報区域＋気温予報地点）を会場定義から解決する。 */
export function resolveAreaTimeseriesForecastTarget(
  registryOrVenueId: VenueRegistry | VenueId,
  maybeVenueId?: VenueId,
): AreaTimeseriesForecastTarget {
  const [registry, venueId] = registryAndVenue(registryOrVenueId, maybeVenueId);
  const targets = registry.getVenue(venueId);
  return {
    forecastAreaCode: targets.broadForecast.areaCode,
    forecastAreaName: targets.broadForecast.displayName,
    temperatureStationCode: targets.temperatureForecast.stationCode,
    temperatureStationName: targets.temperatureForecast.displayName,
  };
}

/** C7 用の気象防災速報判定対象（両会場の includedAreaCodes の和集合。順序は east → trc の出現順、重複除去済み）を解決する。 */
export function resolveBosaiBulletinTarget(registry: VenueRegistry): BosaiBulletinTarget {
  const combined = new Set<string>();
  for (const venue of registry.listVenues()) {
    for (const code of venue.bosaiBulletin.includedAreaCodes) combined.add(code);
  }
  return { includedAreaCodes: Array.from(combined) };
}

/** C9 用のアメダス対象地点を会場定義から解決する。 */
export function resolveAmedasTarget(
  registryOrVenueId: VenueRegistry | VenueId,
  maybeVenueId?: VenueId,
): AmedasTarget {
  const [registry, venueId] = registryAndVenue(registryOrVenueId, maybeVenueId);
  return registry.getVenue(venueId).amedas;
}

function registryAndVenue(
  registryOrVenueId: VenueRegistry | VenueId,
  maybeVenueId: VenueId | undefined,
): readonly [VenueRegistry, VenueId] {
  if (maybeVenueId) return [registryOrVenueId as VenueRegistry, maybeVenueId];
  throw new Error('会場レジストリを明示指定してください');
}
