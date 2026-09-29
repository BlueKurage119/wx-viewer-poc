import crypto from 'node:crypto';
import fs from 'node:fs';
import yaml from 'js-yaml';
import {
  createVenueRegistry,
  type AmedasStationCode,
  type BosaiBulletinAreaCode,
  type ForecastTemperatureStationCode,
  type MunicipalWarningAreaCode,
  type PrefectureForecastAreaCode,
  type RegionalForecastAreaCode,
  type VenueConfigResponse,
  type VenueForecastTargets,
  type VenueId,
  type VenueRegistry,
} from '@wx-viewer-poc/shared';

export const DEFAULT_VENUES_CONFIG_URL = new URL('../../../../config/venues.yaml', import.meta.url);
export const LOCAL_VENUES_CONFIG_URL = new URL('venues.local.yaml', DEFAULT_VENUES_CONFIG_URL);
export interface LoadedVenueConfig {
  readonly registry: VenueRegistry;
  readonly response: VenueConfigResponse;
  readonly sources: readonly URL[];
  readonly localOverride: 'applied' | 'absent' | 'disabled-production' | 'not-applicable';
}
type Mapping = Record<string, unknown>;
class VenueConfigReadError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
  }
}
const venueKeys = [
  'id',
  'name',
  'experimental',
  'mapReference',
  'warning',
  'warningTimeseries',
  'broadForecast',
  'temperatureForecast',
  'amedas',
  'bosaiBulletin',
] as const;
const nestedKeys: Readonly<Record<string, readonly string[]>> = {
  mapReference: ['latitude', 'longitude'],
  warning: ['municipalCode', 'displayName', 'prefectureCode'],
  warningTimeseries: ['municipalCode', 'displayName'],
  broadForecast: ['areaCode', 'displayName'],
  temperatureForecast: ['stationCode', 'displayName'],
  amedas: ['stationCode', 'displayName', 'elements'],
  bosaiBulletin: ['includedAreaCodes'],
};
function mapping(value: unknown, path: string): Mapping {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${path} はマッピングである必要があります`);
  return value as Mapping;
}
function exactKeys(value: Mapping, keys: readonly string[], path: string, partial = false): void {
  for (const key of Object.keys(value))
    if (!keys.includes(key)) throw new Error(`${path}.${key} は未知の設定キーです`);
  if (!partial)
    for (const key of keys) if (!(key in value)) throw new Error(`${path}.${key} が必要です`);
}
function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${path} は空でない文字列で指定してください`);
  return value;
}
function code(value: unknown, path: string, expression: RegExp): string {
  const result = string(value, path);
  if (!expression.test(result)) throw new Error(`${path} の形式が不正です`);
  return result;
}
function number(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`${path} は ${min} から ${max} の有限数値で指定してください`);
  return value;
}
function read(url: URL): unknown {
  let content: string;
  try {
    content = fs.readFileSync(url, 'utf8');
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    throw new VenueConfigReadError(`${relative(url)} の読み込みに失敗しました`, code);
  }
  try {
    return yaml.load(content, { schema: yaml.CORE_SCHEMA, json: false });
  } catch (error) {
    const mark = error instanceof yaml.YAMLException ? error.mark : undefined;
    const location =
      mark === undefined ? '位置を特定できません' : `${mark.line + 1}行${mark.column + 1}列`;
    throw new Error(`${relative(url)} のYAML解析に失敗しました: ${location}`);
  }
}
function relative(url: URL): string {
  if (url.href === DEFAULT_VENUES_CONFIG_URL.href) return 'config/venues.yaml';
  if (url.href === LOCAL_VENUES_CONFIG_URL.href) return 'config/venues.local.yaml';
  return url.pathname.split('/').filter(Boolean).at(-1) ?? 'venues.yaml';
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function validateLoadedVenueConfig(url: URL, value: unknown): readonly VenueForecastTargets[] {
  try {
    return validateVenueConfig(value);
  } catch (error) {
    throw new Error(`${relative(url)}: ${errorMessage(error)}`);
  }
}
function isNotFound(error: unknown): boolean {
  return error instanceof VenueConfigReadError && error.code === 'ENOENT';
}
function clone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clone);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}
function mergeVenue(base: Mapping, local: Mapping): Mapping {
  const output = clone(base) as Mapping;
  for (const [key, value] of Object.entries(local))
    output[key] =
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      output[key] !== null &&
      typeof output[key] === 'object' &&
      !Array.isArray(output[key])
        ? { ...(output[key] as Mapping), ...(value as Mapping) }
        : clone(value);
  return output;
}
function validateLocal(value: unknown): Mapping[] {
  const root = mapping(value, 'root');
  exactKeys(root, ['venues'], 'root');
  if (!Array.isArray(root.venues) || root.venues.length === 0)
    throw new Error('venues は1件以上の配列で指定してください');
  const seen = new Set<string>();
  return root.venues.map((item, index) => {
    const venue = mapping(item, `venues[${index}]`);
    exactKeys(venue, venueKeys, `venues[${index}]`, true);
    const id = string(venue.id, `venues[${index}].id`);
    if (seen.has(id)) throw new Error(`venues[${index}].id が重複しています`);
    seen.add(id);
    for (const [key, value] of Object.entries(venue))
      if (key !== 'id' && key in nestedKeys)
        exactKeys(
          mapping(value, `venues[${index}].${key}`),
          nestedKeys[key]!,
          `venues[${index}].${key}`,
          true,
        );
    return venue;
  });
}
export function validateVenueConfig(value: unknown): readonly VenueForecastTargets[] {
  const root = mapping(value, 'root');
  exactKeys(root, ['venues'], 'root');
  if (!Array.isArray(root.venues) || root.venues.length === 0)
    throw new Error('venues は1件以上の配列で指定してください');
  const seen = new Set<string>();
  return root.venues.map((item, index) => {
    const path = `venues[${index}]`;
    const v = mapping(item, path);
    exactKeys(v, venueKeys, path);
    const id = code(v.id, `${path}.id`, /^[a-z][a-z0-9-]{0,31}$/);
    if (seen.has(id)) throw new Error(`${path}.id が重複しています`);
    seen.add(id);
    if (typeof v.experimental !== 'boolean')
      throw new Error(`${path}.experimental は真偽値で指定してください`);
    const map = mapping(v.mapReference, `${path}.mapReference`);
    exactKeys(map, nestedKeys.mapReference!, `${path}.mapReference`);
    const warning = mapping(v.warning, `${path}.warning`);
    exactKeys(warning, nestedKeys.warning!, `${path}.warning`);
    const warningTimeseries = mapping(v.warningTimeseries, `${path}.warningTimeseries`);
    exactKeys(warningTimeseries, nestedKeys.warningTimeseries!, `${path}.warningTimeseries`);
    const broad = mapping(v.broadForecast, `${path}.broadForecast`);
    exactKeys(broad, nestedKeys.broadForecast!, `${path}.broadForecast`);
    const temperature = mapping(v.temperatureForecast, `${path}.temperatureForecast`);
    exactKeys(temperature, nestedKeys.temperatureForecast!, `${path}.temperatureForecast`);
    const amedas = mapping(v.amedas, `${path}.amedas`);
    exactKeys(amedas, nestedKeys.amedas!, `${path}.amedas`);
    const bulletin = mapping(v.bosaiBulletin, `${path}.bosaiBulletin`);
    exactKeys(bulletin, nestedKeys.bosaiBulletin!, `${path}.bosaiBulletin`);
    const municipalCode = code(
      warning.municipalCode,
      `${path}.warning.municipalCode`,
      /^[0-9]{7}$/,
    );
    if (
      code(
        warningTimeseries.municipalCode,
        `${path}.warningTimeseries.municipalCode`,
        /^[0-9]{7}$/,
      ) !== municipalCode
    )
      throw new Error(
        `${path}.warningTimeseries.municipalCode は warning.municipalCode と一致してください`,
      );
    if (!Array.isArray(bulletin.includedAreaCodes) || bulletin.includedAreaCodes.length === 0)
      throw new Error(`${path}.bosaiBulletin.includedAreaCodes は1件以上の配列で指定してください`);
    const included = bulletin.includedAreaCodes.map((item, codeIndex) =>
      code(item, `${path}.bosaiBulletin.includedAreaCodes[${codeIndex}]`, /^[0-9]{6,7}$/),
    );
    if (new Set(included).size !== included.length)
      throw new Error(`${path}.bosaiBulletin.includedAreaCodes は重複できません`);
    if (
      !included.includes(municipalCode) ||
      !included.includes(code(broad.areaCode, `${path}.broadForecast.areaCode`, /^[0-9]{6}$/))
    )
      throw new Error(
        `${path}.bosaiBulletin.includedAreaCodes は市町村警報区域と広域予報区域を含めてください`,
      );
    return {
      venueId: id as VenueId,
      venueName: string(v.name, `${path}.name`),
      experimental: v.experimental,
      mapReference: {
        latitude: number(map.latitude, `${path}.mapReference.latitude`, -90, 90),
        longitude: number(map.longitude, `${path}.mapReference.longitude`, -180, 180),
      },
      warning: {
        municipalCode: municipalCode as MunicipalWarningAreaCode,
        displayName: string(warning.displayName, `${path}.warning.displayName`),
        prefectureCode: code(
          warning.prefectureCode,
          `${path}.warning.prefectureCode`,
          /^[0-9]{6}$/,
        ) as PrefectureForecastAreaCode,
      },
      warningTimeseries: {
        municipalCode: municipalCode as MunicipalWarningAreaCode,
        displayName: string(warningTimeseries.displayName, `${path}.warningTimeseries.displayName`),
      },
      broadForecast: {
        areaCode: code(
          broad.areaCode,
          `${path}.broadForecast.areaCode`,
          /^[0-9]{6}$/,
        ) as RegionalForecastAreaCode,
        displayName: string(broad.displayName, `${path}.broadForecast.displayName`),
      },
      temperatureForecast: {
        stationCode: code(
          temperature.stationCode,
          `${path}.temperatureForecast.stationCode`,
          /^[0-9]{5}$/,
        ) as ForecastTemperatureStationCode,
        displayName: string(temperature.displayName, `${path}.temperatureForecast.displayName`),
      },
      amedas: {
        stationCode: code(
          amedas.stationCode,
          `${path}.amedas.stationCode`,
          /^[0-9]{5}$/,
        ) as AmedasStationCode,
        displayName: string(amedas.displayName, `${path}.amedas.displayName`),
        elements: code(amedas.elements, `${path}.amedas.elements`, /^[0-9]{8}$/),
      },
      bosaiBulletin: { includedAreaCodes: included as BosaiBulletinAreaCode[] },
    };
  });
}
export function loadVenueConfig(
  options: { readonly baseUrl?: URL; readonly localUrl?: URL; readonly environment?: string } = {},
): LoadedVenueConfig {
  const baseUrl = options.baseUrl ?? DEFAULT_VENUES_CONFIG_URL;
  const localUrl = options.localUrl ?? LOCAL_VENUES_CONFIG_URL;
  const applicable =
    baseUrl.href === DEFAULT_VENUES_CONFIG_URL.href ||
    (options.baseUrl !== undefined && options.localUrl !== undefined);
  const environment = options.environment ?? process.env.NODE_ENV;
  const base = read(baseUrl);
  const baseVenues = validateLoadedVenueConfig(baseUrl, base);
  let localOverride: LoadedVenueConfig['localOverride'] = applicable ? 'absent' : 'not-applicable';
  const combined = clone(base) as Mapping;
  const sources: URL[] = [baseUrl];
  let venues = baseVenues;
  if (applicable && environment === 'production') localOverride = 'disabled-production';
  else if (applicable) {
    try {
      let local: Mapping[];
      try {
        local = validateLocal(read(localUrl));
      } catch (error) {
        if (isNotFound(error)) throw error;
        throw new Error(`${relative(localUrl)}: ${errorMessage(error)}`);
      }
      const root = mapping(combined, 'root');
      const configuredVenues = Array.isArray(root.venues)
        ? root.venues.map((item) => mapping(item, 'venues'))
        : [];
      const byId = new Map(configuredVenues.map((venue) => [venue.id, venue]));
      for (const venue of local) {
        const previous = byId.get(venue.id);
        if (previous) Object.assign(previous, mergeVenue(previous, venue));
        else configuredVenues.push(venue);
      }
      root.venues = configuredVenues;
      venues = validateLoadedVenueConfig(localUrl, combined);
      localOverride = 'applied';
      sources.push(localUrl);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
  const canonical = JSON.stringify(venues);
  const generation = crypto.createHash('sha256').update(canonical).digest('hex');
  const registry = createVenueRegistry(venues, generation);
  return {
    registry,
    response: { generation, venues: registry.listVenues() },
    sources,
    localOverride,
  };
}
