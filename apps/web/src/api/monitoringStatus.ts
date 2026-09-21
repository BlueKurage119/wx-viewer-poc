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

const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_UTC_PATTERN.test(value)) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const expectedIso = date.toISOString();
  return value.includes('.') ? expectedIso === value : expectedIso === value.replace('Z', '.000Z');
}

function isNullableIsoDate(value: unknown): boolean {
  return value === null || isIsoDate(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

const KNOWN_SOURCE_IDS = new Set([
  'xml_regular',
  'xml_extra',
  'nowcast_target_times',
  'kikikuru_target_times',
  'amedas_latest_time',
  'amedas_point',
]);

const KNOWN_SCHEDULED_SOURCES = new Set(['xml', 'nowcast', 'kikikuru', 'amedas']);
const KNOWN_SCHEDULED_STATES = new Set(['waiting', 'running', 'scheduled_stopped']);

function isHealthStatus(value: unknown): boolean {
  return value === 'normal' || value === 'delayed' || value === 'abnormal' || value === 'suspended';
}

function isNullableNonNegativeInteger(value: unknown): boolean {
  return value === null || isNonNegativeInteger(value);
}

function isHealthSource(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.sourceId !== 'string' || !KNOWN_SOURCE_IDS.has(value.sourceId)) return false;
  if (typeof value.displayName !== 'string') return false;
  if (value.status !== null && !isHealthStatus(value.status)) return false;
  if (!isNullableIsoDate(value.lastAttemptAt) || !isNullableIsoDate(value.lastSuccessAt))
    return false;
  if (
    !isNullableNonNegativeInteger(value.consecutiveFailures) ||
    !isNullableNonNegativeInteger(value.intervalSeconds) ||
    !isNullableNonNegativeInteger(value.lastDurationMs)
  )
    return false;
  if (typeof value.appliesElapsedCondition !== 'boolean') return false;
  if (!Array.isArray(value.reasons)) return false;
  return true;
}

function isScheduledSource(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.source !== 'string' || !KNOWN_SCHEDULED_SOURCES.has(value.source)) return false;
  if (typeof value.state !== 'string' || !KNOWN_SCHEDULED_STATES.has(value.state)) return false;
  if (!isNullableIsoDate(value.nextRunAt)) return false;
  if (!isNullableNonNegativeInteger(value.intervalSeconds)) return false;
  return true;
}

const KNOWN_INFORMATION_KINDS = new Set([
  'bosai_bulletin',
  'warning',
  'warning_timeseries',
  'early_warning',
  'amedas',
  'area_timeseries',
  'nowcast',
  'kikikuru',
]);

const KNOWN_AVAILABILITY = new Set(['available', 'stale', 'unavailable']);

function isInformationSection(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.kind !== 'string' || !KNOWN_INFORMATION_KINDS.has(value.kind)) return false;
  if (value.venueId !== 'east' && value.venueId !== 'trc') return false;
  if (typeof value.availability !== 'string' || !KNOWN_AVAILABILITY.has(value.availability))
    return false;
  if (!isNullableIsoDate(value.issuedAt)) return false;
  if (!isNullableIsoDate(value.validAt)) return false;
  if (!isNullableIsoDate(value.fetchedAt)) return false;
  if (!isNullableIsoDate(value.lastSuccessAt)) return false;
  if (!isNullableNonNegativeInteger(value.summaryCount)) return false;
  return true;
}

function isTilesLayer(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.layer !== 'nowcast' && value.layer !== 'kikikuru') return false;
  if (
    typeof value.catalogAvailability !== 'string' ||
    !KNOWN_AVAILABILITY.has(value.catalogAvailability)
  )
    return false;
  if (!isNullableIsoDate(value.catalogUpdatedAt)) return false;
  if (!isNonNegativeInteger(value.availableFrameCount)) return false;
  if (typeof value.upstreamFetchAllowed !== 'boolean') return false;
  if (!isNullableIsoDate(value.nextUpstreamAllowedAt)) return false;
  return true;
}

function isTilesSection(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.healthMonitored !== false) return false;
  if (value.healthCriteriaStatus !== 'undecided') return false;
  if (!Array.isArray(value.layers) || !value.layers.every(isTilesLayer)) return false;
  return true;
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
    !Array.isArray(value.operation.scheduledSources) ||
    !value.operation.scheduledSources.every(isScheduledSource)
  )
    return false;
  if (
    !isRecord(value.health) ||
    !isNullableIsoDate(value.health.evaluatedAt) ||
    (value.health.worstStatus !== null && !isHealthStatus(value.health.worstStatus)) ||
    !Array.isArray(value.health.sources) ||
    !value.health.sources.every(isHealthSource) ||
    !Array.isArray(value.health.worstSourceIds) ||
    !isRecord(value.health.thresholds) ||
    !isNonNegativeInteger(value.health.thresholds.abnormalConsecutiveFailures) ||
    !isNonNegativeInteger(value.health.thresholds.delayedConsecutiveFailures)
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
  if (
    !Array.isArray(value.venues) ||
    !Array.isArray(value.information) ||
    !value.information.every(isInformationSection) ||
    !isTilesSection(value.tiles)
  )
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
