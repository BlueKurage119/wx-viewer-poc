import type { WeatherControlStatus, KikikuruTimesResponse } from '@wx-viewer-poc/shared';
import { fetchTileCatalog, type TileCatalogResult } from './tileCatalogClient';

export function parseKikikuruTimesResponse(body: unknown): KikikuruTimesResponse | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.terminalId !== 'string') return null;
  if (typeof b.venueId !== 'string') return null;
  if (b.status !== 'ok' && b.status !== 'unsupported_control_status') return null;
  if (!('layers' in b) || typeof b.layers !== 'object' || b.layers === null) return null;
  return body as KikikuruTimesResponse;
}

export function fetchKikikuruTimes(params: {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly signal: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}): Promise<TileCatalogResult<KikikuruTimesResponse>> {
  return fetchTileCatalog({
    path: '/api/weather/kikikuru/times',
    terminalId: params.terminalId,
    controlStatus: params.controlStatus,
    signal: params.signal,
    parse: parseKikikuruTimesResponse,
    fetchImpl: params.fetchImpl,
  });
}
