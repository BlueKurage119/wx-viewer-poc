import type { EarlyWarningResponse, WeatherControlStatus } from '@wx-viewer-poc/shared';
import { fetchTileCatalog, type TileCatalogResult } from './tileCatalogClient';

export function parseEarlyWarningResponse(
  body: unknown,
  requested: WeatherControlStatus,
): EarlyWarningResponse | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (record.controlStatus !== requested || record.isTraining !== (requested === 'training'))
    return null;
  for (const segment of ['near', 'far']) {
    const entry = record[segment];
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
    const dataset = entry as Record<string, unknown>;
    const meta = dataset.metadata;
    if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null;
    const metadata = meta as Record<string, unknown>;
    if (!['available', 'stale', 'unavailable'].includes(String(metadata.availability))) return null;
    if (metadata.issuedAt !== null && typeof metadata.issuedAt !== 'string') return null;
    if (dataset.data !== null) {
      if (typeof dataset.data !== 'object' || Array.isArray(dataset.data)) return null;
      const data = dataset.data as Record<string, unknown>;
      if (
        data.segment !== segment ||
        !Array.isArray(data.timeDefines) ||
        !Array.isArray(data.cells)
      )
        return null;
      if (
        !data.timeDefines.every(
          (item) =>
            typeof item === 'object' &&
            item !== null &&
            typeof item.timeId === 'string' &&
            typeof item.timeFrom === 'string' &&
            typeof item.timeTo === 'string' &&
            typeof item.sequence === 'number',
        )
      )
        return null;
      if (
        !data.cells.every(
          (item) =>
            typeof item === 'object' &&
            item !== null &&
            typeof item.refId === 'string' &&
            typeof item.phenomenonCode === 'string' &&
            typeof item.phenomenonName === 'string' &&
            (item.rankValue === null || typeof item.rankValue === 'string') &&
            (item.condition === null || typeof item.condition === 'string'),
        )
      )
        return null;
    }
  }
  return body as EarlyWarningResponse;
}
export function fetchEarlyWarning(params: {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly signal: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}): Promise<TileCatalogResult<EarlyWarningResponse>> {
  return fetchTileCatalog({
    path: '/api/weather/early-warning',
    terminalId: params.terminalId,
    controlStatus: params.controlStatus,
    signal: params.signal,
    parse: (body) => parseEarlyWarningResponse(body, params.controlStatus),
    fetchImpl: params.fetchImpl,
  });
}
