import type { Availability } from './availability.js';
import type { UtcIso8601String } from './types.js';
import type {
  WeatherApiQueryParseResult,
  WeatherContext,
  WeatherControlStatus,
  WeatherMetadata,
} from './weatherApi.js';
import { parseWeatherApiQuery } from './weatherApi.js';

export const TILE_API_ALLOWED_ZOOMS = [10] as const;
export type TileDeliveryProfile = 'proxy' | 'jma-direct';

export interface TileUpstreamAccess {
  readonly allowed: boolean;
  readonly reason: 'disabled' | 'scheduled_stopped' | null;
  readonly nextAllowedAt: UtcIso8601String | null;
}

export interface NowcastApiFrame {
  readonly product: 'N1' | 'N2';
  readonly baseTime: UtcIso8601String;
  readonly validTime: UtcIso8601String;
  readonly element: 'hrpns';
  readonly member: 'none';
}

export interface NowcastApiProduct {
  readonly metadata: WeatherMetadata;
  readonly data: { readonly frames: readonly NowcastApiFrame[] } | null;
}

export type NowcastTimesResponse = WeatherContext & {
  readonly tileDeliveryProfile: TileDeliveryProfile;
  readonly status: 'ok' | 'unsupported_control_status';
  readonly window: {
    readonly from: UtcIso8601String;
    readonly to: UtcIso8601String;
  } | null;
  readonly catalogAccess: TileUpstreamAccess | null;
  readonly imageAccess: TileUpstreamAccess | null;
  readonly allowedZooms: readonly number[];
  readonly products: Readonly<Record<'N1' | 'N2', NowcastApiProduct>>;
};

export type KikikuruApiLayer = 'heavyrain' | 'inund' | 'land';

export interface KikikuruApiFrame {
  readonly layer: KikikuruApiLayer;
  readonly baseTime: UtcIso8601String;
  readonly validTime: UtcIso8601String;
  readonly imageId: 'rain_mesh' | 'inund' | 'land';
  readonly member: string;
}

export interface KikikuruApiDataset {
  readonly metadata: WeatherMetadata;
  readonly data: { readonly frames: readonly KikikuruApiFrame[] } | null;
}

export type KikikuruTimesResponse = WeatherContext & {
  readonly tileDeliveryProfile: TileDeliveryProfile;
  readonly status: 'ok' | 'unsupported_control_status';
  readonly catalogAccess: TileUpstreamAccess | null;
  readonly imageAccess: TileUpstreamAccess | null;
  readonly allowedZooms: readonly number[];
  readonly layers: Readonly<Record<KikikuruApiLayer, KikikuruApiDataset>>;
};

export interface TileCoordinate {
  readonly zoom: number;
  readonly tileX: number;
  readonly tileY: number;
}

export interface TileApiError {
  readonly status: 'error';
  readonly code:
    | 'invalid_request'
    | 'method_not_allowed'
    | 'terminal_not_found'
    | 'frame_not_available'
    | 'unsupported_control_status'
    | 'image_services_initializing'
    | 'acquisition_stopped'
    | 'tile_fetch_failed'
    | 'tile_read_failed'
    | 'weather_read_failed';
  readonly catalogAvailability?: Availability;
  readonly imageAccess?: TileUpstreamAccess;
}

export function parseTileTimesQuery(query: unknown): WeatherApiQueryParseResult {
  return parseWeatherApiQuery(query);
}

const NON_NEGATIVE_DECIMAL = /^(0|[1-9]\d*)$/;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function parseCoordinate(zStr: unknown, xStr: unknown, yStr: unknown): TileCoordinate | null {
  if (typeof zStr !== 'string' || typeof xStr !== 'string' || typeof yStr !== 'string') {
    return null;
  }
  if (
    !NON_NEGATIVE_DECIMAL.test(zStr) ||
    !NON_NEGATIVE_DECIMAL.test(xStr) ||
    !NON_NEGATIVE_DECIMAL.test(yStr)
  ) {
    return null;
  }
  const zoom = Number(zStr);
  const tileX = Number(xStr);
  const tileY = Number(yStr);
  if (!Number.isSafeInteger(zoom) || !Number.isSafeInteger(tileX) || !Number.isSafeInteger(tileY)) {
    return null;
  }
  if (!TILE_API_ALLOWED_ZOOMS.includes(zoom as (typeof TILE_API_ALLOWED_ZOOMS)[number])) {
    return null;
  }
  const maxCoord = 2 ** zoom;
  if (tileX < 0 || tileX >= maxCoord || tileY < 0 || tileY >= maxCoord) {
    return null;
  }
  return { zoom, tileX, tileY };
}

function isValidUtcIso(s: unknown): s is UtcIso8601String {
  if (typeof s !== 'string' || !ISO_UTC_PATTERN.test(s)) {
    return false;
  }
  const date = new Date(s);
  return !Number.isNaN(date.getTime()) && date.toISOString() === s;
}

export type ParseNowcastTileRequestResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly terminalId: string;
        readonly controlStatus: WeatherControlStatus;
        readonly coordinate: TileCoordinate;
        readonly frame: NowcastApiFrame;
      };
    }
  | {
      readonly ok: false;
      readonly error: 'invalid_request';
    };

export function parseNowcastTileRequest(
  params: unknown,
  query: unknown,
): ParseNowcastTileRequestResult {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return { ok: false, error: 'invalid_request' };
  }
  const paramRec = params as Record<string, unknown>;
  const rawProduct = paramRec.product;
  if (rawProduct !== 'N1' && rawProduct !== 'N2') {
    return { ok: false, error: 'invalid_request' };
  }
  const coordinate = parseCoordinate(paramRec.z, paramRec.x, paramRec.y);
  if (coordinate === null) {
    return { ok: false, error: 'invalid_request' };
  }

  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    return { ok: false, error: 'invalid_request' };
  }
  const queryRec = query as Record<string, unknown>;
  const keys = Object.keys(queryRec);
  if (keys.length !== 4) {
    return { ok: false, error: 'invalid_request' };
  }
  if (
    !Object.prototype.hasOwnProperty.call(queryRec, 'terminalId') ||
    !Object.prototype.hasOwnProperty.call(queryRec, 'controlStatus') ||
    !Object.prototype.hasOwnProperty.call(queryRec, 'baseTime') ||
    !Object.prototype.hasOwnProperty.call(queryRec, 'validTime')
  ) {
    return { ok: false, error: 'invalid_request' };
  }

  const terminalRes = parseWeatherApiQuery({
    terminalId: queryRec.terminalId,
    controlStatus: queryRec.controlStatus,
  });
  if (!terminalRes.ok) {
    return { ok: false, error: 'invalid_request' };
  }

  if (!isValidUtcIso(queryRec.baseTime) || !isValidUtcIso(queryRec.validTime)) {
    return { ok: false, error: 'invalid_request' };
  }

  const frame: NowcastApiFrame = {
    product: rawProduct,
    baseTime: queryRec.baseTime,
    validTime: queryRec.validTime,
    element: 'hrpns',
    member: 'none',
  };

  return {
    ok: true,
    value: {
      terminalId: terminalRes.value.terminalId,
      controlStatus: terminalRes.value.controlStatus,
      coordinate,
      frame,
    },
  };
}

export type ParseKikikuruTileRequestResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly terminalId: string;
        readonly controlStatus: WeatherControlStatus;
        readonly coordinate: TileCoordinate;
        readonly frame: KikikuruApiFrame;
      };
    }
  | {
      readonly ok: false;
      readonly error: 'invalid_request';
    };

export function parseKikikuruTileRequest(
  params: unknown,
  query: unknown,
): ParseKikikuruTileRequestResult {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return { ok: false, error: 'invalid_request' };
  }
  const paramRec = params as Record<string, unknown>;
  const rawLayer = paramRec.layer;
  if (rawLayer !== 'heavyrain' && rawLayer !== 'inund' && rawLayer !== 'land') {
    return { ok: false, error: 'invalid_request' };
  }
  const coordinate = parseCoordinate(paramRec.z, paramRec.x, paramRec.y);
  if (coordinate === null) {
    return { ok: false, error: 'invalid_request' };
  }

  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    return { ok: false, error: 'invalid_request' };
  }
  const queryRec = query as Record<string, unknown>;
  const keys = Object.keys(queryRec);
  if (keys.length !== 6) {
    return { ok: false, error: 'invalid_request' };
  }
  if (
    !Object.prototype.hasOwnProperty.call(queryRec, 'terminalId') ||
    !Object.prototype.hasOwnProperty.call(queryRec, 'controlStatus') ||
    !Object.prototype.hasOwnProperty.call(queryRec, 'baseTime') ||
    !Object.prototype.hasOwnProperty.call(queryRec, 'validTime') ||
    !Object.prototype.hasOwnProperty.call(queryRec, 'imageId') ||
    !Object.prototype.hasOwnProperty.call(queryRec, 'member')
  ) {
    return { ok: false, error: 'invalid_request' };
  }

  const terminalRes = parseWeatherApiQuery({
    terminalId: queryRec.terminalId,
    controlStatus: queryRec.controlStatus,
  });
  if (!terminalRes.ok) {
    return { ok: false, error: 'invalid_request' };
  }

  if (!isValidUtcIso(queryRec.baseTime) || !isValidUtcIso(queryRec.validTime)) {
    return { ok: false, error: 'invalid_request' };
  }

  const rawImageId = queryRec.imageId;
  if (
    (rawLayer === 'heavyrain' && rawImageId !== 'rain_mesh') ||
    (rawLayer === 'inund' && rawImageId !== 'inund') ||
    (rawLayer === 'land' && rawImageId !== 'land')
  ) {
    return { ok: false, error: 'invalid_request' };
  }
  const imageId = rawImageId as 'rain_mesh' | 'inund' | 'land';

  const rawMember = queryRec.member;
  if (typeof rawMember !== 'string' || rawMember.length === 0) {
    return { ok: false, error: 'invalid_request' };
  }
  if (
    rawMember.includes('/') ||
    rawMember.includes('\\') ||
    rawMember.includes('..') ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f]/.test(rawMember)
  ) {
    return { ok: false, error: 'invalid_request' };
  }

  const frame: KikikuruApiFrame = {
    layer: rawLayer,
    baseTime: queryRec.baseTime,
    validTime: queryRec.validTime,
    imageId,
    member: rawMember,
  };

  return {
    ok: true,
    value: {
      terminalId: terminalRes.value.terminalId,
      controlStatus: terminalRes.value.controlStatus,
      coordinate,
      frame,
    },
  };
}
