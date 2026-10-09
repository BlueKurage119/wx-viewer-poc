import {
  type MonitoringStatusResponse,
  type TerminalDefinition,
  type VenueRegistry,
} from '@wx-viewer-poc/shared';
import {
  buildHealthSection,
  buildOperationSection,
  buildReadinessSection,
} from '../monitoring/monitoringStatusService.js';
import { buildStoppedPollingStatus } from '../polling/index.js';
import type { PollingScheduleConfig } from '../config/pollingSchedule.js';
import { InMemoryWarningCurrentRecoveryTracker } from '../monitoring/warningCurrentRecoveryTracker.js';
import { InMemoryStartupProgressTracker } from '../monitoring/startupProgressTracker.js';
export function unavailableMonitoring(input: {
  terminal: TerminalDefinition;
  registry: VenueRegistry;
  schedule: PollingScheduleConfig;
  generation: string;
  startedAt: string;
  runtimes: MonitoringStatusResponse['weatherRuntimes'];
  now: string;
}): MonitoringStatusResponse {
  const recovery = new InMemoryWarningCurrentRecoveryTracker(input.registry);
  const progress = new InMemoryStartupProgressTracker(() => input.now, input.registry);
  return {
    status: 'ready',
    terminalId: input.terminal.id,
    requestedVenueId: input.terminal.venueId,
    serverGenerationId: input.generation,
    serverStartedAt: input.startedAt,
    generatedAt: input.now,
    weatherRuntimes: input.runtimes,
    operation: buildOperationSection(
      buildStoppedPollingStatus(new Date(input.now), input.schedule),
      false,
    ),
    health: buildHealthSection(null, input.schedule.fetchHealth),
    readiness: buildReadinessSection(
      {
        initialFetch: {
          phase:
            input.runtimes.acquisition.stopReason === 'initialization_failed'
              ? 'failed'
              : 'not_started',
          result: null,
        },
      },
      [],
    ),
    venues: input.registry.listVenueIds().map((venueId) => ({
      venueId,
      startupEvaluated: false,
      reprocessing: progress.getVenueReprocessingStatus(venueId),
      recovery: recovery.getStatus(venueId, input.now),
      recentAdoptions: [],
      adoptionWindowHours: 24,
    })),
    information: input.registry.listVenueIds().flatMap((venueId) =>
      (
        [
          'bosai_bulletin',
          'warning',
          'warning_timeseries',
          'early_warning',
          'amedas',
          'area_timeseries',
          'nowcast',
          'kikikuru',
        ] as const
      ).map((kind) => ({
        kind,
        venueId,
        availability: 'unavailable' as const,
        issuedAt: null,
        validAt: null,
        fetchedAt: null,
        lastSuccessAt: null,
        summaryCount: null,
      })),
    ),
    readErrors: [
      {
        section: 'recent_adoptions',
        venueId: null,
        kind: null,
        code: 'weather_data_read_failed',
      },
      ...(['nowcast', 'kikikuru'] as const).map((kind) => ({
        section: 'tiles' as const,
        venueId: null,
        kind,
        code: 'weather_data_read_failed' as const,
      })),
    ],
    tiles: { healthMonitored: false, healthCriteriaStatus: 'undecided', layers: [] },
  };
}
