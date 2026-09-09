/** 会場固有の気象対象を表す識別子。端末の表示モードとは独立する。 */
export type VenueId = 'east' | 'trc';

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
  /** 気象庁地点表の elems。ビット演算による機能推測には使用しない。 */
  readonly elements: string;
}

export interface BosaiBulletinTarget {
  readonly includedAreaCodes: readonly BosaiBulletinAreaCode[];
}

export interface VenueForecastTargets {
  readonly venueId: VenueId;
  readonly venueName: string;
  readonly mapReference: Readonly<{ readonly latitude: number; readonly longitude: number }>;
  readonly warning: WarningCurrentTarget;
  readonly warningTimeseries: WarningTimeseriesTarget;
  readonly broadForecast: BroadForecastTarget;
  readonly temperatureForecast: TemperatureForecastTarget;
  readonly amedas: AmedasTarget;
  readonly bosaiBulletin: BosaiBulletinTarget;
}

const municipalWarningAreaCode = (value: string): MunicipalWarningAreaCode =>
  value as MunicipalWarningAreaCode;
const prefectureForecastAreaCode = (value: string): PrefectureForecastAreaCode =>
  value as PrefectureForecastAreaCode;
const regionalForecastAreaCode = (value: string): RegionalForecastAreaCode =>
  value as RegionalForecastAreaCode;
const forecastTemperatureStationCode = (value: string): ForecastTemperatureStationCode =>
  value as ForecastTemperatureStationCode;
const amedasStationCode = (value: string): AmedasStationCode => value as AmedasStationCode;
const bosaiBulletinAreaCode = (value: string): BosaiBulletinAreaCode =>
  value as BosaiBulletinAreaCode;

function mapReference(latitude: number, longitude: number): VenueForecastTargets['mapReference'] {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('会場の地図基準位置は有限数値で指定してください');
  }
  return Object.freeze({ latitude, longitude });
}

export const VENUE_FORECAST_TARGETS: Readonly<Record<VenueId, VenueForecastTargets>> =
  Object.freeze({
    east: Object.freeze({
      venueId: 'east',
      venueName: '東京ビッグサイト',
      mapReference: mapReference(35.63159368010876, 139.79281040119963),
      warning: Object.freeze({
        municipalCode: municipalWarningAreaCode('1310800'),
        displayName: '江東区',
        prefectureCode: prefectureForecastAreaCode('130000'),
      }),
      warningTimeseries: Object.freeze({
        municipalCode: municipalWarningAreaCode('1310800'),
        displayName: '江東区',
      }),
      broadForecast: Object.freeze({
        areaCode: regionalForecastAreaCode('130010'),
        displayName: '東京地方',
      }),
      temperatureForecast: Object.freeze({
        stationCode: forecastTemperatureStationCode('44132'),
        displayName: '東京（北の丸公園）',
      }),
      amedas: Object.freeze({
        stationCode: amedasStationCode('44136'),
        displayName: '江戸川臨海',
        elements: '11112010',
      }),
      bosaiBulletin: Object.freeze({
        includedAreaCodes: Object.freeze([
          bosaiBulletinAreaCode('1310800'),
          bosaiBulletinAreaCode('130012'),
          bosaiBulletinAreaCode('130010'),
        ]),
      }),
    }),
    trc: Object.freeze({
      venueId: 'trc',
      venueName: '東京流通センター',
      mapReference: mapReference(35.58138, 139.748119),
      warning: Object.freeze({
        municipalCode: municipalWarningAreaCode('1311100'),
        displayName: '大田区',
        prefectureCode: prefectureForecastAreaCode('130000'),
      }),
      warningTimeseries: Object.freeze({
        municipalCode: municipalWarningAreaCode('1311100'),
        displayName: '大田区',
      }),
      broadForecast: Object.freeze({
        areaCode: regionalForecastAreaCode('130010'),
        displayName: '東京地方',
      }),
      temperatureForecast: Object.freeze({
        stationCode: forecastTemperatureStationCode('44132'),
        displayName: '東京（北の丸公園）',
      }),
      amedas: Object.freeze({
        stationCode: amedasStationCode('44166'),
        displayName: '羽田',
        elements: '11110000',
      }),
      bosaiBulletin: Object.freeze({
        includedAreaCodes: Object.freeze([
          bosaiBulletinAreaCode('1311100'),
          bosaiBulletinAreaCode('130011'),
          bosaiBulletinAreaCode('130010'),
        ]),
      }),
    }),
  });

export function resolveVenueForecastTargets(venueId: VenueId): VenueForecastTargets {
  return VENUE_FORECAST_TARGETS[venueId];
}
