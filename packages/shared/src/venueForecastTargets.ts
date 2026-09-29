/** 起動時に検証済みの会場 ID。外部入力は VenueRegistry.resolveVenueId を通す。 */
declare const venueIdBrand: unique symbol;
export type VenueId = string & { readonly [venueIdBrand]: 'VenueId' };

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
  const venueIds = Object.freeze(frozen.map((venue) => venue.venueId));
  const byId = new Map<VenueId, VenueForecastTargets>();
  for (const venue of frozen) {
    if (byId.has(venue.venueId)) {
      throw new Error(`会場 ID が重複しています: ${venue.venueId}`);
    }
    byId.set(venue.venueId, venue);
  }
  return Object.freeze({
    generation,
    listVenueIds: (): readonly VenueId[] => venueIds,
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
