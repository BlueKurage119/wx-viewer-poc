import type { MonitoringStatusResponse } from '@wx-viewer-poc/shared';

export interface MonitoringStatusClientDependencies {
  readonly fetch: typeof fetch;
}

export interface MonitoringStatusClient {
  fetchMonitoringStatus(
    terminalId: string,
    signal?: AbortSignal,
  ): Promise<MonitoringStatusResponse>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isNullableIsoDate(value: unknown): boolean {
  return value === null || isIsoDate(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isHealthStatus(value: unknown): boolean {
  return value === 'normal' || value === 'delayed' || value === 'abnormal' || value === 'suspended';
}

function isMonitoringResponse(value: unknown): value is MonitoringStatusResponse {
  if (!isRecord(value) || value.status !== 'ready' || typeof value.terminalId !== 'string')
    return false;
  if (
    (value.requestedVenueId !== 'east' && value.requestedVenueId !== 'trc') ||
    typeof value.serverGenerationId !== 'string' ||
    !isIsoDate(value.generatedAt)
  )
    return false;
  if (
    !isRecord(value.operation) ||
    typeof value.operation.schedulerRunning !== 'boolean' ||
    !isRecord(value.operation.period) ||
    typeof value.operation.period.start !== 'string' ||
    typeof value.operation.period.end !== 'string' ||
    !isIsoDate(value.operation.nextPeriodChangeAt) ||
    !Array.isArray(value.operation.scheduledSources)
  )
    return false;
  if (
    !isRecord(value.health) ||
    !isNullableIsoDate(value.health.evaluatedAt) ||
    (value.health.worstStatus !== null && !isHealthStatus(value.health.worstStatus)) ||
    !Array.isArray(value.health.sources) ||
    !Array.isArray(value.health.worstSourceIds) ||
    !isRecord(value.health.thresholds)
  )
    return false;
  if (
    !isRecord(value.readiness) ||
    !['not_started', 'running', 'completed', 'failed'].includes(
      String(value.readiness.initialFetchPhase),
    ) ||
    !isNullableIsoDate(value.readiness.startedAt) ||
    !isNullableIsoDate(value.readiness.finishedAt) ||
    !Array.isArray(value.readiness.feeds) ||
    (value.readiness.errorReason !== null && typeof value.readiness.errorReason !== 'string')
  )
    return false;
  if (!Array.isArray(value.venues) || !Array.isArray(value.information) || !isRecord(value.tiles))
    return false;
  return value.venues.every(
    (venue) =>
      isRecord(venue) &&
      (venue.venueId === 'east' || venue.venueId === 'trc') &&
      typeof venue.startupEvaluated === 'boolean' &&
      isRecord(venue.reprocessing) &&
      ['idle', 'running', 'completed'].includes(String(venue.reprocessing.status)) &&
      isNonNegativeInteger(venue.reprocessing.total) &&
      isNonNegativeInteger(venue.reprocessing.processedCount) &&
      isNullableIsoDate(venue.reprocessing.startedAt) &&
      isNullableIsoDate(venue.reprocessing.finishedAt) &&
      (venue.reprocessing.elapsedMs === null || isNonNegativeInteger(venue.reprocessing.elapsedMs)),
  );
}

/** 稼働状態APIを読み、K1で使用するDTOの構造を検証する。 */
export function createMonitoringStatusClient(
  dependencies: MonitoringStatusClientDependencies,
): MonitoringStatusClient {
  return {
    async fetchMonitoringStatus(terminalId, signal) {
      const response = await dependencies.fetch(
        `/api/monitoring/status?terminalId=${encodeURIComponent(terminalId)}`,
        { signal },
      );
      if (!response.ok) throw new Error(`監視情報の取得に失敗しました (${response.status})`);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error('監視情報の応答JSONが不正です');
      }
      if (!isMonitoringResponse(body) || body.terminalId !== terminalId) {
        throw new Error('監視情報の応答形式が不正です');
      }
      return body;
    },
  };
}

let defaultClient: MonitoringStatusClient | null = null;

export function fetchMonitoringStatus(
  terminalId: string,
  signal?: AbortSignal,
): Promise<MonitoringStatusResponse> {
  if (defaultClient === null) {
    defaultClient = createMonitoringStatusClient({ fetch: window.fetch.bind(window) });
  }
  return defaultClient.fetchMonitoringStatus(terminalId, signal);
}
