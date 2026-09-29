import type { AmedasResponse, VenueRegistry, WeatherControlStatus } from '@wx-viewer-poc/shared';
import { getCurrentVenueRegistry } from '../venueRegistryContext';
import { fetchTileCatalog, type TileCatalogResult } from './tileCatalogClient';

export function parseAmedasResponse(
  body: unknown,
  terminalId: string,
  controlStatus: WeatherControlStatus,
  registry: VenueRegistry,
): AmedasResponse | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (
    record.terminalId !== terminalId ||
    record.controlStatus !== controlStatus ||
    record.isTraining !== (controlStatus === 'training') ||
    !registry.resolveVenueId(record.venueId)
  )
    return null;
  const station = record.station as Record<string, unknown> | null;
  const metadata = record.metadata as Record<string, unknown> | null;
  const capabilities = record.capabilities as Record<string, unknown> | null;
  if (
    !station ||
    typeof station.code !== 'string' ||
    typeof station.name !== 'string' ||
    !metadata ||
    !['available', 'stale', 'unavailable'].includes(String(metadata.availability)) ||
    !capabilities ||
    !Array.isArray(capabilities.unsupportedElements)
  )
    return null;
  if (record.data !== null) {
    const data = record.data as Record<string, unknown> | null;
    if (
      !data ||
      !Array.isArray(data.observations) ||
      (data.latestObservedAt !== null && typeof data.latestObservedAt !== 'string')
    )
      return null;
    if (
      !data.observations.every((row: unknown) => {
        if (typeof row !== 'object' || row === null) return false;
        const observation = row as Record<string, unknown>;
        return (
          typeof observation.observedAt === 'string' &&
          typeof observation.values === 'object' &&
          observation.values !== null
        );
      })
    )
      return null;
  }
  return body as AmedasResponse;
}

export function fetchAmedas(params: {
  terminalId: string;
  controlStatus: WeatherControlStatus;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<TileCatalogResult<AmedasResponse>> {
  return fetchTileCatalog({
    path: '/api/weather/amedas',
    terminalId: params.terminalId,
    controlStatus: params.controlStatus,
    signal: params.signal,
    parse: (body) =>
      parseAmedasResponse(body, params.terminalId, params.controlStatus, getCurrentVenueRegistry()),
    fetchImpl: params.fetchImpl,
  });
}
