import type { WarningsResponse, WeatherControlStatus } from '@wx-viewer-poc/shared';
import { fetchTileCatalog, type TileCatalogResult } from './tileCatalogClient';

/**
 * 応答の最低限の実行時検証。不正なら null。§3.2 の検証項目に従う。
 * `capabilities` は検証も使用もしない(設計書 §2.1-2)。
 */
export function parseWarningsResponse(
  body: unknown,
  requested: WeatherControlStatus,
): WarningsResponse | null {
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
    if (!Array.isArray(data.items)) {
      return null;
    }
    for (const raw of data.items) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return null;
      }
      const item = raw as Record<string, unknown>;
      if (typeof item.kindCode !== 'string') {
        return null;
      }
      if (typeof item.kindName !== 'string') {
        return null;
      }
      if (typeof item.kindStatus !== 'string') {
        return null;
      }
      if (typeof item.lastKindCode !== 'string' && item.lastKindCode !== null) {
        return null;
      }
      if (typeof item.sequence !== 'number') {
        return null;
      }
    }
  }

  return body as WarningsResponse;
}

export function fetchWarnings(params: {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly signal: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}): Promise<TileCatalogResult<WarningsResponse>> {
  return fetchTileCatalog({
    path: '/api/weather/warnings',
    terminalId: params.terminalId,
    controlStatus: params.controlStatus,
    signal: params.signal,
    parse: (body) => parseWarningsResponse(body, params.controlStatus),
    fetchImpl: params.fetchImpl,
  });
}
