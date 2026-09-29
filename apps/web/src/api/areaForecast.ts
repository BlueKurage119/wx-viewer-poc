import type { AreaTimeseriesResponse, WeatherControlStatus } from '@wx-viewer-poc/shared';
import { fetchTileCatalog, type TileCatalogResult } from './tileCatalogClient';

/**
 * 地域時系列予報API応答のパースとバリデーション (Issue #58 §4.4, AC-1)。
 *
 * controlStatus/isTrainingの整合性検証、capabilitiesの3配列存在確認、
 * metadata/data構造の整合性を検査する。
 */
export function parseAreaForecastResponse(
  body: unknown,
  requested: WeatherControlStatus,
): AreaTimeseriesResponse | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (record.controlStatus !== requested || record.isTraining !== (requested === 'training')) {
    return null;
  }

  // capabilities の3配列チェック (AC-1)
  if (
    typeof record.capabilities !== 'object' ||
    record.capabilities === null ||
    Array.isArray(record.capabilities)
  ) {
    return null;
  }
  const caps = record.capabilities as Record<string, unknown>;
  if (
    !Array.isArray(caps.blockIds) ||
    !Array.isArray(caps.elements) ||
    !Array.isArray(caps.unsupportedFields)
  ) {
    return null;
  }

  // metadata チェック
  if (
    typeof record.metadata !== 'object' ||
    record.metadata === null ||
    Array.isArray(record.metadata)
  ) {
    return null;
  }
  const metadata = record.metadata as Record<string, unknown>;
  if (!['available', 'stale', 'unavailable'].includes(String(metadata.availability))) {
    return null;
  }
  if (metadata.issuedAt !== null && typeof metadata.issuedAt !== 'string') {
    return null;
  }

  // area チェック (表記の算出で code・name を参照するため)
  if (typeof record.area !== 'object' || record.area === null || Array.isArray(record.area)) {
    return null;
  }
  const area = record.area as Record<string, unknown>;
  if (typeof area.code !== 'string' || typeof area.name !== 'string') {
    return null;
  }

  // data チェック (null 許容)
  if (record.data !== null) {
    if (typeof record.data !== 'object' || Array.isArray(record.data)) {
      return null;
    }
    const data = record.data as Record<string, unknown>;

    // station
    if (typeof data.station !== 'object' || data.station === null || Array.isArray(data.station)) {
      return null;
    }
    const station = data.station as Record<string, unknown>;
    if (typeof station.code !== 'string' || typeof station.name !== 'string') {
      return null;
    }

    // timeDefines
    if (!Array.isArray(data.timeDefines)) {
      return null;
    }
    const timeDefinesValid = data.timeDefines.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.blockId === 'string' &&
        typeof item.timeId === 'string' &&
        typeof item.timeFrom === 'string' &&
        typeof item.timeTo === 'string' &&
        typeof item.sequence === 'number' &&
        (item.duration === null || typeof item.duration === 'string'),
    );
    if (!timeDefinesValid) {
      return null;
    }

    // values
    if (!Array.isArray(data.values)) {
      return null;
    }
    const valuesValid = data.values.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.blockId === 'string' &&
        typeof item.refId === 'string' &&
        typeof item.element === 'string' &&
        typeof item.sequence === 'number' &&
        (item.valueCode === null || typeof item.valueCode === 'string') &&
        (item.valueText === null || typeof item.valueText === 'string') &&
        (item.valueNumber === null || typeof item.valueNumber === 'number') &&
        (item.unit === null || typeof item.unit === 'string') &&
        (item.condition === null || typeof item.condition === 'string'),
    );
    if (!valuesValid) {
      return null;
    }
  }

  return body as AreaTimeseriesResponse;
}

export function fetchAreaForecast(params: {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly signal: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}): Promise<TileCatalogResult<AreaTimeseriesResponse>> {
  return fetchTileCatalog({
    path: '/api/weather/area-timeseries',
    terminalId: params.terminalId,
    controlStatus: params.controlStatus,
    signal: params.signal,
    parse: (body) => parseAreaForecastResponse(body, params.controlStatus),
    fetchImpl: params.fetchImpl,
  });
}
