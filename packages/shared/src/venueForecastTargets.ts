/** 起動時に検証済みの会場 ID。外部入力は VenueRegistry.resolveVenueId を通す。 */
export type VenueId = string;

declare const municipalWarningAreaCodeBrand: unique symbol;
declare const prefectureForecastAreaCodeBrand: unique symbol;
declare const regionalForecastAreaCodeBrand: unique symbol;
declare const forecastTemperatureStationCodeBrand: unique symbol;
declare const amedasStationCodeBrand: unique symbol;
declare const bosaiBulletinAreaCodeBrand: unique symbol;
export type MunicipalWarningAreaCode = string & {
  readonly [municipalWarningAreaCodeBrand]: 'MunicipalWarningAreaCode';
};
export type PrefectureForecastAreaCode = string & {
  readonly [prefectureForecastAreaCodeBrand]: 'PrefectureForecastAreaCode';
};
export type RegionalForecastAreaCode = string & {
  readonly [regionalForecastAreaCodeBrand]: 'RegionalForecastAreaCode';
};
export type ForecastTemperatureStationCode = string & {
  readonly [forecastTemperatureStationCodeBrand]: 'ForecastTemperatureStationCode';
};
export type AmedasStationCode = string & { readonly [amedasStationCodeBrand]: 'AmedasStationCode' };
export type BosaiBulletinAreaCode = string & {
  readonly [bosaiBulletinAreaCodeBrand]: 'BosaiBulletinAreaCode';
};

export interface WarningCurrentTarget {
  readonly municipalCode: MunicipalWarningAreaCode;
  readonly displayName: string;
  readonly prefectureCode: PrefectureForecastAreaCode;
}
export interface WarningTimeseriesTarget {
  readonly municipalCode: MunicipalWarningAreaCode;
  readonly displayName: string;
}
export interface BroadForecastTarget {
  readonly areaCode: RegionalForecastAreaCode;
  readonly displayName: string;
}
export interface TemperatureForecastTarget {
  readonly stationCode: ForecastTemperatureStationCode;
  readonly displayName: string;
}
export interface AmedasTarget {
  readonly stationCode: AmedasStationCode;
  readonly displayName: string;
  readonly elements: string;
}
export interface BosaiBulletinTarget {
  readonly includedAreaCodes: readonly BosaiBulletinAreaCode[];
}
export interface VenueForecastTargets {
  readonly venueId: VenueId;
  readonly venueName: string;
  readonly experimental: boolean;
  readonly mapReference: Readonly<{ readonly latitude: number; readonly longitude: number }>;
  readonly warning: WarningCurrentTarget;
  readonly warningTimeseries: WarningTimeseriesTarget;
  readonly broadForecast: BroadForecastTarget;
  readonly temperatureForecast: TemperatureForecastTarget;
  readonly amedas: AmedasTarget;
  readonly bosaiBulletin: BosaiBulletinTarget;
}
export type VenueConfigDto = VenueForecastTargets;
export interface VenueConfigResponse {
  readonly generation: string;
  readonly venues: readonly VenueConfigDto[];
}

function freezeVenue(venue: VenueForecastTargets): VenueForecastTargets {
  return Object.freeze({
    ...venue,
    mapReference: Object.freeze({ ...venue.mapReference }),
    warning: Object.freeze({ ...venue.warning }),
    warningTimeseries: Object.freeze({ ...venue.warningTimeseries }),
    broadForecast: Object.freeze({ ...venue.broadForecast }),
    temperatureForecast: Object.freeze({ ...venue.temperatureForecast }),
    amedas: Object.freeze({ ...venue.amedas }),
    bosaiBulletin: Object.freeze({
      includedAreaCodes: Object.freeze([...venue.bosaiBulletin.includedAreaCodes]),
    }),
  });
}
export interface VenueRegistry {
  readonly generation: string;
  listVenueIds(): readonly VenueId[];
  listVenues(): readonly VenueForecastTargets[];
  resolveVenueId(value: unknown): VenueId | null;
  getVenue(id: VenueId): VenueForecastTargets;
}
export function createVenueRegistry(
  venues: readonly VenueForecastTargets[],
  generation: string,
): VenueRegistry {
  const frozen = Object.freeze(venues.map(freezeVenue));
  const byId = new Map(frozen.map((venue) => [venue.venueId, venue]));
  return Object.freeze({
    generation,
    listVenueIds: (): readonly VenueId[] => frozen.map((venue) => venue.venueId),
    listVenues: (): readonly VenueForecastTargets[] => frozen,
    resolveVenueId: (value: unknown): VenueId | null =>
      typeof value === 'string' && byId.has(value as VenueId) ? (value as VenueId) : null,
    getVenue: (id: VenueId): VenueForecastTargets => {
      const venue = byId.get(id);
      if (!venue) throw new Error(`会場 ID が設定にありません: ${id}`);
      return venue;
    },
  });
}
let activeRegistry: VenueRegistry | null = null;
/** 後方互換の配列参照。起動時に同じ参照を更新する。 */
export const VENUE_IDS: VenueId[] = [];
/** 起動済みレジストリの投影。会場データの正本ではない。 */
export const VENUE_FORECAST_TARGETS: Record<VenueId, VenueForecastTargets> = {} as Record<
  VenueId,
  VenueForecastTargets
>;
export function configureVenueRegistry(registry: VenueRegistry): void {
  activeRegistry = registry;
  VENUE_IDS.splice(0, VENUE_IDS.length, ...registry.listVenueIds());
  for (const key of Object.keys(VENUE_FORECAST_TARGETS))
    delete VENUE_FORECAST_TARGETS[key as VenueId];
  for (const venue of registry.listVenues()) VENUE_FORECAST_TARGETS[venue.venueId] = venue;
}
export function getVenueRegistry(): VenueRegistry {
  if (!activeRegistry) throw new Error('会場レジストリが初期化されていません');
  return activeRegistry;
}
export function resolveVenueForecastTargets(venueId: string): VenueForecastTargets {
  const resolved = getVenueRegistry().resolveVenueId(venueId);
  if (!resolved) throw new Error(`会場 ID が設定にありません: ${venueId}`);
  return getVenueRegistry().getVenue(resolved);
}
export function isVenueId(value: unknown): value is VenueId {
  return getVenueRegistry().resolveVenueId(value) !== null;
}
