import {
  VENUE_IDS,
  resolveVenueForecastTargets,
  type AmedasTarget,
  type VenueId,
} from '@wx-viewer-poc/shared';
import type {
  AreaTimeseriesForecastTarget,
  BosaiBulletinTarget,
  EarlyWarningTargetArea,
  WarningCurrentTargetArea,
  WarningTargetArea,
  WarningTimeseriesTargetArea,
} from './repositories/types.js';

/** C2 用の市町村等警報対象を会場定義から解決する。 */
export function resolveWarningTargetArea(venueId: VenueId): WarningTargetArea {
  const target = resolveVenueForecastTargets(venueId).warning;
  return { municipalCode: target.municipalCode, displayName: target.displayName };
}

/** C3 用の市町村等・府県予報区対象を会場定義から解決する。 */
export function resolveWarningCurrentTargetArea(venueId: VenueId): WarningCurrentTargetArea {
  const target = resolveVenueForecastTargets(venueId).warning;
  return {
    municipalCode: target.municipalCode,
    displayName: target.displayName,
    prefectureCode: target.prefectureCode,
  };
}

/** C4 用の警報等時系列対象を会場定義から解決する。 */
export function resolveWarningTimeseriesTargetArea(venueId: VenueId): WarningTimeseriesTargetArea {
  const target = resolveVenueForecastTargets(venueId).warningTimeseries;
  return { municipalCode: target.municipalCode, displayName: target.displayName };
}

/** C2 用の会場 ID と解決済み対象を対で運ぶ。パース結果を会場間で共有しないため、両者を 1 引数にまとめる。 */
export interface VenueWarningContext {
  readonly venueId: VenueId;
  readonly targetArea: WarningCurrentTargetArea;
}

/** C2 用のコンテキストを会場定義から解決する。 */
export function resolveVenueWarningContext(venueId: VenueId): VenueWarningContext {
  return { venueId, targetArea: resolveWarningCurrentTargetArea(venueId) };
}

/** C4 用の会場 ID と解決済み対象を対で運ぶ。 */
export interface VenueWarningTimeseriesContext {
  readonly venueId: VenueId;
  readonly targetArea: WarningTimeseriesTargetArea;
}

/** C4 用のコンテキストを会場定義から解決する。 */
export function resolveVenueWarningTimeseriesContext(
  venueId: VenueId,
): VenueWarningTimeseriesContext {
  return { venueId, targetArea: resolveWarningTimeseriesTargetArea(venueId) };
}

/** C5 用の広域予報対象を会場定義から解決する。 */
export function resolveEarlyWarningTargetArea(venueId: VenueId): EarlyWarningTargetArea {
  const target = resolveVenueForecastTargets(venueId).broadForecast;
  return { forecastAreaCode: target.areaCode, displayName: target.displayName };
}

/**
 * 全会場が同一のキーへ解決することを保証した上で代表値を 1 つ返す。
 * 不一致は「静かに壊れる」ため例外にする（§3.3.1）。resolveShared* から使う内部ヘルパーで、
 * テストでは合成 resolver を注入して不一致検知そのものを直接検証する。
 */
export function assertSharedAcrossVenues<T>(
  resolveForVenue: (venueId: VenueId) => T,
  keyOf: (value: T) => unknown,
  errorContext: string,
): T {
  const values = VENUE_IDS.map((venueId) => resolveForVenue(venueId));
  const first = values[0]!;
  const firstKey = keyOf(first);
  for (const value of values.slice(1)) {
    if (keyOf(value) !== firstKey) {
      throw new Error(
        `${errorContext} は全会場で同一である前提が崩れています: ${JSON.stringify(values)}`,
      );
    }
  }
  return first;
}

/**
 * C5 用の広域予報対象を、全会場で同一に解決されることを保証した上で 1 つ返す。
 * 会場追加等で対象が食い違うと「静かに壊れる」のを防ぐための表明（§3.3.1）。
 */
export function resolveSharedEarlyWarningTargetArea(): EarlyWarningTargetArea {
  return assertSharedAcrossVenues(
    resolveEarlyWarningTargetArea,
    (v) => v.forecastAreaCode,
    'C5 の広域予報対象',
  );
}

/** C6 用の地域時系列予報対象（広域予報区域＋気温予報地点）を会場定義から解決する。 */
export function resolveAreaTimeseriesForecastTarget(
  venueId: VenueId,
): AreaTimeseriesForecastTarget {
  const targets = resolveVenueForecastTargets(venueId);
  return {
    forecastAreaCode: targets.broadForecast.areaCode,
    forecastAreaName: targets.broadForecast.displayName,
    temperatureStationCode: targets.temperatureForecast.stationCode,
    temperatureStationName: targets.temperatureForecast.displayName,
  };
}

/**
 * C6 用の地域時系列予報対象を、全会場で同一に解決されることを保証した上で 1 つ返す。
 * 会場追加等で対象が食い違うと「静かに壊れる」のを防ぐための表明（§3.3.1）。
 */
export function resolveSharedAreaTimeseriesForecastTarget(): AreaTimeseriesForecastTarget {
  return assertSharedAcrossVenues(
    resolveAreaTimeseriesForecastTarget,
    (v) => `${v.forecastAreaCode} ${v.temperatureStationCode}`,
    'C6 の地域時系列予報対象',
  );
}

/** C7 用の気象防災速報判定対象（両会場の includedAreaCodes の和集合。順序は east → trc の出現順、重複除去済み）を解決する。 */
export function resolveBosaiBulletinTarget(): BosaiBulletinTarget {
  const eastCodes = resolveVenueForecastTargets('east').bosaiBulletin.includedAreaCodes;
  const trcCodes = resolveVenueForecastTargets('trc').bosaiBulletin.includedAreaCodes;
  const combined = new Set<string>([...eastCodes, ...trcCodes]);
  return { includedAreaCodes: Array.from(combined) };
}

export const DEFAULT_BOSAI_BULLETIN_TARGET: BosaiBulletinTarget = resolveBosaiBulletinTarget();

/** C9 用のアメダス対象地点を会場定義から解決する。 */
export function resolveAmedasTarget(venueId: VenueId): AmedasTarget {
  return resolveVenueForecastTargets(venueId).amedas;
}

/** east 既定の後方互換 alias（Issue #109 §3.2 の DEFAULT_* と同じ作法）。 */
export const DEFAULT_AMEDAS_TARGET: AmedasTarget = resolveAmedasTarget('east');
