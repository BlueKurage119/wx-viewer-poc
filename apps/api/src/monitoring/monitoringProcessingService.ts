import {
  PROCESSING_FAILURE_SAMPLE_LIMIT,
  PROCESSING_WINDOW_HOURS,
  type MonitoringProcessingFailure,
  type MonitoringProcessingResponse,
  type TerminalDefinition,
  type UtcIso8601String,
} from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import {
  listRecentAdoptionFailures,
  summarizeAdoptionResults,
} from '../repositories/telegramReceptionRepository.js';
import { buildRawExcerpt } from './monitoringProcessingDiagnostics.js';

export interface MonitoringProcessingServiceDependencies {
  readonly connection: DatabaseConnection;
  readonly serverGenerationId: string;
  readonly now: () => UtcIso8601String;
  readonly windowHours?: number;
  readonly sampleLimit?: number;
}

export interface MonitoringProcessingService {
  getProcessing(terminal: TerminalDefinition): MonitoringProcessingResponse;
}

export function createMonitoringProcessingService(
  deps: MonitoringProcessingServiceDependencies,
): MonitoringProcessingService {
  const windowHours = deps.windowHours ?? PROCESSING_WINDOW_HOURS;
  const sampleLimit = deps.sampleLimit ?? PROCESSING_FAILURE_SAMPLE_LIMIT;

  return {
    getProcessing(terminal: TerminalDefinition): MonitoringProcessingResponse {
      const generatedAt = deps.now();
      const sinceMs = new Date(generatedAt).getTime() - windowHours * 60 * 60 * 1000;
      const sinceIso = new Date(sinceMs).toISOString() as UtcIso8601String;

      const byAdoptionResult = summarizeAdoptionResults(deps.connection, sinceIso).map((row) => ({
        adoptionResult: row.adoptionResult,
        venueId: row.venueId,
        count: row.count,
      }));

      const failureRows = listRecentAdoptionFailures(deps.connection, sinceIso, sampleLimit);
      const recentFailures: MonitoringProcessingFailure[] = failureRows.map((row) => ({
        receptionId: row.receptionId,
        venueId: row.venueId,
        adoptionResult: row.adoptionResult,
        adoptionReason: row.adoptionReason,
        telegramType: row.telegramType,
        documentUrl: row.documentUrl,
        receivedAt: row.receivedAt,
        adoptionDecidedAt: row.adoptionDecidedAt,
        rawBodyBytes: row.rawBody === null ? null : row.bodyBytes,
        excerpt: row.rawBody === null ? null : buildRawExcerpt(row.rawBody, row.adoptionReason),
      }));

      return {
        status: 'ready',
        terminalId: terminal.id,
        requestedVenueId: terminal.venueId,
        serverGenerationId: deps.serverGenerationId,
        generatedAt,
        windowHours,
        byAdoptionResult,
        recentFailures,
      };
    },
  };
}
