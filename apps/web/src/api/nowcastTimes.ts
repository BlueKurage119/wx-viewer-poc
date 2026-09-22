import type { WeatherControlStatus, NowcastTimesResponse } from '@wx-viewer-poc/shared';
import { fetchTileCatalog, type TileCatalogResult } from './tileCatalogClient';

export function parseNowcastTimesResponse(body: unknown): NowcastTimesResponse | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.terminalId !== 'string') return null;
  if (typeof b.venueId !== 'string') return null;
  if (b.status !== 'ok' && b.status !== 'unsupported_control_status') return null;
  if (b.tileDeliveryProfile !== 'proxy' && b.tileDeliveryProfile !== 'jma-direct') return null;
  if (!('products' in b) || typeof b.products !== 'object' || b.products === null) return null;
  return body as NowcastTimesResponse;
}

export function fetchNowcastTimes(params: {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly signal: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}): Promise<TileCatalogResult<NowcastTimesResponse>> {
  return fetchTileCatalog({
    path: '/api/weather/nowcast/times',
    terminalId: params.terminalId,
    controlStatus: params.controlStatus,
    signal: params.signal,
    parse: parseNowcastTimesResponse,
    fetchImpl: params.fetchImpl,
  });
}
