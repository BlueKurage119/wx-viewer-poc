import type { WarningTimeseriesResponse, WeatherControlStatus } from '@wx-viewer-poc/shared';
import { fetchTileCatalog, type TileCatalogResult } from './tileCatalogClient';

function isValidTimeDefine(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return false;
  }
  const timeDefine = raw as Record<string, unknown>;
  return (
    typeof timeDefine.blockId === 'string' &&
    typeof timeDefine.timeId === 'string' &&
    typeof timeDefine.timeFrom === 'string' &&
    typeof timeDefine.timeTo === 'string' &&
    typeof timeDefine.sequence === 'number'
  );
}

function isValidValue(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return false;
  }
  const value = raw as Record<string, unknown>;
  if (
    typeof value.blockId !== 'string' ||
    typeof value.refId !== 'string' ||
    typeof value.propertyType !== 'string' ||
    typeof value.valueType !== 'string' ||
    typeof value.valueText !== 'string'
  ) {
    return false;
  }
  if (value.valueCategory !== 'risk' && value.valueCategory !== 'quantity') {
    return false;
  }
  if (typeof value.valueCode !== 'string' && value.valueCode !== null) {
    return false;
  }
  if (typeof value.unit !== 'string' && value.unit !== null) {
    return false;
  }
  if (typeof value.condition !== 'string' && value.condition !== null) {
    return false;
  }
  if (typeof value.areaDivision !== 'string' && value.areaDivision !== null) {
    return false;
  }
  return true;
}

/**
 * 応答の最低限の実行時検証。不正なら null(設計書 §3.2)。
 * `additions`・`scope`・`capabilities` は検証・使用しない。
 */
export function parseWarningTimeseriesResponse(
  body: unknown,
  requested: WeatherControlStatus,
): WarningTimeseriesResponse | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null;
  }

  const record = body as Record<string, unknown>;

  if (record.controlStatus !== requested) {
    return null;
  }

  if (record.isTraining !== (requested === 'training')) {
    return null;
  }

  if (
    typeof record.metadata !== 'object' ||
    record.metadata === null ||
    Array.isArray(record.metadata)
  ) {
    return null;
  }
  const metadata = record.metadata as Record<string, unknown>;

  if (
    metadata.availability !== 'available' &&
    metadata.availability !== 'stale' &&
    metadata.availability !== 'unavailable'
  ) {
    return null;
  }

  if (typeof metadata.issuedAt !== 'string' && metadata.issuedAt !== null) {
    return null;
  }

  if (record.data !== null) {
    if (typeof record.data !== 'object' || Array.isArray(record.data)) {
      return null;
    }
    const data = record.data as Record<string, unknown>;
    if (!Array.isArray(data.timeDefines) || !Array.isArray(data.values)) {
      return null;
    }
    for (const raw of data.timeDefines) {
      if (!isValidTimeDefine(raw)) {
        return null;
      }
    }
    for (const raw of data.values) {
      if (!isValidValue(raw)) {
        return null;
      }
    }
  }

  return body as WarningTimeseriesResponse;
}

export function fetchWarningTimeseries(params: {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly signal: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}): Promise<TileCatalogResult<WarningTimeseriesResponse>> {
  return fetchTileCatalog({
    path: '/api/weather/warning-timeseries',
    terminalId: params.terminalId,
    controlStatus: params.controlStatus,
    signal: params.signal,
    parse: (body) => parseWarningTimeseriesResponse(body, params.controlStatus),
    fetchImpl: params.fetchImpl,
  });
}
