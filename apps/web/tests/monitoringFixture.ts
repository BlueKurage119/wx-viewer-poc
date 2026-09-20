import type {
  MonitoredFetchSourceId,
  MonitoringHealthSource,
  MonitoringScheduledSourceStatus,
  MonitoringStatusResponse,
} from '@wx-viewer-poc/shared';

export function createHealthSource(
  sourceId: MonitoredFetchSourceId,
  overrides?: Partial<MonitoringHealthSource>,
): MonitoringHealthSource {
  return {
    sourceId,
    displayName: sourceId,
    status: 'normal',
    lastAttemptAt: '2026-09-20T05:25:00.000Z',
    lastSuccessAt: '2026-09-20T05:25:00.000Z',
    consecutiveFailures: 0,
    intervalSeconds: 60,
    appliesElapsedCondition: sourceId !== 'amedas_point',
    lastDurationMs: 250,
    reasons: [],
    ...overrides,
  };
}

export function createDefaultSources(): readonly MonitoringHealthSource[] {
  return [
    createHealthSource('xml_regular', { intervalSeconds: 60, lastDurationMs: 350 }),
    createHealthSource('xml_extra', { intervalSeconds: 60, lastDurationMs: 420 }),
    createHealthSource('nowcast_target_times', { intervalSeconds: 60, lastDurationMs: 500 }),
    createHealthSource('kikikuru_target_times', { intervalSeconds: 60, lastDurationMs: 600 }),
    createHealthSource('amedas_latest_time', { intervalSeconds: 60, lastDurationMs: 200 }),
    createHealthSource('amedas_point', { intervalSeconds: 60, lastDurationMs: 180 }),
  ];
}

export function createDefaultScheduledSources(): readonly MonitoringScheduledSourceStatus[] {
  return [
    {
      source: 'xml',
      state: 'waiting',
      intervalSeconds: 60,
      nextRunAt: '2026-09-20T05:26:00.000Z',
    },
    {
      source: 'nowcast',
      state: 'waiting',
      intervalSeconds: 60,
      nextRunAt: '2026-09-20T05:26:00.000Z',
    },
    {
      source: 'kikikuru',
      state: 'waiting',
      intervalSeconds: 60,
      nextRunAt: '2026-09-20T05:26:00.000Z',
    },
    {
      source: 'amedas',
      state: 'waiting',
      intervalSeconds: 60,
      nextRunAt: '2026-09-20T05:26:00.000Z',
    },
  ];
}

export const normalMonitoringResponseFixture: MonitoringStatusResponse = {
  status: 'ready',
  terminalId: 'kkeagh01',
  requestedVenueId: 'east',
  serverGenerationId: 'generation-a',
  generatedAt: '2026-09-20T05:25:28.000Z',
  operation: {
    schedulerRunning: true,
    period: {
      start: '09:00',
      end: '18:00',
      xmlSeconds: 60,
      imageCatalogSeconds: 60,
      amedasSeconds: 60,
      nowcastEnabled: true,
      kikikuruEnabled: true,
    },
    nextPeriodChangeAt: '2026-09-20T09:00:00.000Z',
    scheduledSources: createDefaultScheduledSources(),
  },
  health: {
    evaluatedAt: '2026-09-20T05:25:20.000Z',
    worstStatus: 'normal',
    worstSourceIds: [],
    sources: createDefaultSources(),
    thresholds: {
      evaluationIntervalSeconds: 30,
      delayedConsecutiveFailures: 2,
      delayedIntervalMultiplier: 3,
      abnormalConsecutiveFailures: 5,
      abnormalElapsedSeconds: 600,
      maxScanAttempts: 50,
    },
  },
  readiness: {
    initialFetchPhase: 'completed',
    startedAt: '2026-09-20T05:00:00.000Z',
    finishedAt: '2026-09-20T05:01:00.000Z',
    feeds: [
      { feedKind: 'regular', succeeded: true },
      { feedKind: 'extra', succeeded: true },
      { feedKind: 'regular_l', succeeded: true },
      { feedKind: 'extra_l', succeeded: true },
    ],
    errorReason: null,
  },
  venues: [
    {
      venueId: 'east',
      startupEvaluated: true,
      reprocessing: {
        status: 'completed',
        total: 10,
        processedCount: 10,
        startedAt: '2026-09-20T05:00:00.000Z',
        finishedAt: '2026-09-20T05:02:00.000Z',
        elapsedMs: 120000,
      },
      recentAdoptions: [],
      adoptionWindowHours: 24,
    },
    {
      venueId: 'trc',
      startupEvaluated: true,
      reprocessing: {
        status: 'completed',
        total: 5,
        processedCount: 5,
        startedAt: '2026-09-20T05:00:00.000Z',
        finishedAt: '2026-09-20T05:01:30.000Z',
        elapsedMs: 90000,
      },
      recentAdoptions: [],
      adoptionWindowHours: 24,
    },
  ],
  information: [],
  tiles: { healthMonitored: false, healthCriteriaStatus: 'undecided', layers: [] },
};

export const unevaluatedMonitoringResponseFixture: MonitoringStatusResponse = {
  ...normalMonitoringResponseFixture,
  health: {
    ...normalMonitoringResponseFixture.health,
    evaluatedAt: null,
    worstStatus: null,
    worstSourceIds: [],
    sources: createDefaultSources().map((s) => ({
      ...s,
      status: null,
      lastAttemptAt: null,
      lastSuccessAt: null,
      consecutiveFailures: null,
      lastDurationMs: null,
    })),
  },
};

export const abnormalMonitoringResponseFixture: MonitoringStatusResponse = {
  ...normalMonitoringResponseFixture,
  health: {
    ...normalMonitoringResponseFixture.health,
    worstStatus: 'abnormal',
    worstSourceIds: ['xml_regular'],
    sources: createDefaultSources().map((s) =>
      s.sourceId === 'xml_regular'
        ? {
            ...s,
            status: 'abnormal',
            consecutiveFailures: 5,
            reasons: [
              {
                kind: 'consecutive_failures',
                status: 'abnormal',
                sourceKind: 'xml_regular',
                text: '連続5回失敗',
              },
            ],
          }
        : s,
    ),
  },
};

export const delayedMonitoringResponseFixture: MonitoringStatusResponse = {
  ...normalMonitoringResponseFixture,
  health: {
    ...normalMonitoringResponseFixture.health,
    worstStatus: 'delayed',
    worstSourceIds: ['xml_regular'],
    sources: createDefaultSources().map((s) =>
      s.sourceId === 'xml_regular'
        ? {
            ...s,
            status: 'delayed',
            consecutiveFailures: 2,
            reasons: [
              {
                kind: 'consecutive_failures',
                status: 'delayed',
                sourceKind: 'xml_regular',
                text: '連続2回失敗',
              },
            ],
          }
        : s,
    ),
  },
};

export const suspendedMonitoringResponseFixture: MonitoringStatusResponse = {
  ...normalMonitoringResponseFixture,
  health: {
    ...normalMonitoringResponseFixture.health,
    worstStatus: 'suspended',
    worstSourceIds: [],
    sources: createDefaultSources().map((s) => ({
      ...s,
      status: 'suspended',
    })),
  },
};

export const scheduledStoppedMonitoringResponseFixture: MonitoringStatusResponse = {
  ...normalMonitoringResponseFixture,
  operation: {
    ...normalMonitoringResponseFixture.operation,
    scheduledSources: createDefaultScheduledSources().map((s) =>
      s.source === 'nowcast' ? { ...s, state: 'scheduled_stopped' as const } : s,
    ),
  },
};

export const stoppedSchedulerMonitoringResponseFixture: MonitoringStatusResponse = {
  ...normalMonitoringResponseFixture,
  operation: {
    ...normalMonitoringResponseFixture.operation,
    schedulerRunning: false,
  },
};

/** 手動停止時に実APIが返す組み合わせ（全グループ scheduled_stopped・全系列 suspended）。 */
export const manualStoppedMonitoringResponseFixture: MonitoringStatusResponse = {
  ...normalMonitoringResponseFixture,
  operation: {
    ...normalMonitoringResponseFixture.operation,
    schedulerRunning: false,
    scheduledSources: createDefaultScheduledSources().map((s) => ({
      ...s,
      state: 'scheduled_stopped' as const,
      nextRunAt: null,
    })),
  },
  health: {
    ...normalMonitoringResponseFixture.health,
    worstStatus: 'suspended',
    worstSourceIds: [],
    sources: createDefaultSources().map((s) => ({ ...s, status: 'suspended' })),
  },
};

export const monitoringResponseFixture: MonitoringStatusResponse = {
  status: 'ready',
  terminalId: 'kkeagh01',
  requestedVenueId: 'east',
  serverGenerationId: 'generation-a',
  generatedAt: '2026-09-20T05:25:28.000Z',
  operation: {
    schedulerRunning: false,
    period: {
      start: '09:00',
      end: '18:00',
      xmlSeconds: 600,
      imageCatalogSeconds: null,
      amedasSeconds: null,
      nowcastEnabled: false,
      kikikuruEnabled: false,
    },
    nextPeriodChangeAt: '2026-09-20T09:00:00.000Z',
    scheduledSources: [],
  },
  health: {
    evaluatedAt: null,
    worstStatus: null,
    worstSourceIds: [],
    sources: [],
    thresholds: {
      evaluationIntervalSeconds: 60,
      delayedConsecutiveFailures: 2,
      delayedIntervalMultiplier: 3,
      abnormalConsecutiveFailures: 3,
      abnormalElapsedSeconds: 600,
      maxScanAttempts: 10,
    },
  },
  readiness: {
    initialFetchPhase: 'failed',
    startedAt: null,
    finishedAt: null,
    feeds: [],
    errorReason: '接続できません',
  },
  venues: [
    {
      venueId: 'east',
      startupEvaluated: false,
      reprocessing: {
        status: 'completed',
        total: 0,
        processedCount: 0,
        startedAt: null,
        finishedAt: null,
        elapsedMs: 0,
      },
      recentAdoptions: [],
      adoptionWindowHours: 24,
    },
    {
      venueId: 'trc',
      startupEvaluated: false,
      reprocessing: {
        status: 'running',
        total: 8,
        processedCount: 3,
        startedAt: '2026-09-20T05:00:00.000Z',
        finishedAt: null,
        elapsedMs: null,
      },
      recentAdoptions: [],
      adoptionWindowHours: 24,
    },
  ],
  information: [],
  tiles: { healthMonitored: false, healthCriteriaStatus: 'undecided', layers: [] },
};
