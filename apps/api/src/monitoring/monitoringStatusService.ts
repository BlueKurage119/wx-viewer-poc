import {
  projectWeatherRuntimeStatus,
  type TerminalRegistry,
  type Availability,
  type MonitoringHealthSection,
  type MonitoringHealthSource,
  type MonitoringInformationSection,
  type MonitoringInformationKind,
  type MonitoringReadError,
  type TileUpstreamAccess,
  type WeatherPreparationFailure,
  type MonitoringOperationSection,
  type MonitoringReadinessSection,
  type MonitoringStatusResponse,
  type MonitoringTilesLayer,
  type MonitoringTilesSection,
  type MonitoringVenueSection,
  type TerminalDefinition,
  type UtcIso8601String,
  type VenueId,
  type VenueRegistry,
} from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import type { TimeBasedPollingScheduler } from '../polling/timeBasedPollingScheduler.js';
import type { InitialFetchStatus } from '../polling/jmaXmlPollingService.js';
import type { FetchHealthMonitorService } from './fetchHealthMonitorService.js';
import type { FetchHealthConfig } from './fetchHealthConfig.js';
import { MONITORED_FETCH_SOURCES } from './fetchHealthSources.js';
import type { StartupNotificationInitializationStatus } from '../notifications/startupNotificationService.js';
import type { WeatherApiService } from '../services/weatherApiService.js';
import type { NowcastApiService } from '../services/nowcastApiService.js';
import type { KikikuruApiService } from '../services/kikikuruApiService.js';
import { summarizeAdoptionResults } from '../repositories/telegramReceptionRepository.js';
import type { StartupProgressTracker } from './startupProgressTracker.js';
import type { WarningCurrentRecoveryTracker } from './warningCurrentRecoveryTracker.js';

const ADOPTION_WINDOW_HOURS_DEFAULT = 24;

export interface StartupInitializationStatusProvider {
  getStatus(): StartupNotificationInitializationStatus;
}

/**
 * Issue #42/#43 レビュー指摘 #2: 監視状態APIが実際に使うのは initialFetch フィールドのみ。
 * JmaXmlPollingService 全体ではなくこの最小限のインターフェースを要求することで、
 * ポーリング無効起動・初期化中に pollingService インスタンスが無くても
 * サーバー側で安全な既定値（not_started）を注入できるようにする。
 */
export interface XmlPollingStatusProvider {
  getStatus(): { readonly initialFetch: InitialFetchStatus };
}

export interface MonitoringStatusServiceDependencies {
  readonly connection: DatabaseConnection;
  readonly venueRegistry: VenueRegistry;
  readonly terminalRegistry: TerminalRegistry;
  readonly scheduler: Pick<TimeBasedPollingScheduler, 'getStatus' | 'isRunningNow'>;
  readonly xmlPollingService: XmlPollingStatusProvider;
  readonly fetchHealthMonitor: Pick<FetchHealthMonitorService, 'getLastAggregate'>;
  readonly startupInitialization: StartupInitializationStatusProvider;
  readonly progressTracker?: Pick<StartupProgressTracker, 'getVenueReprocessingStatus'>;
  readonly recoveryTracker?: Pick<WarningCurrentRecoveryTracker, 'getStatus'>;
  readonly weatherApi: WeatherApiService;
  readonly nowcastApi: NowcastApiService;
  readonly kikikuruApi: KikikuruApiService;
  readonly getTileUpstreamAccess: (layer: 'nowcast' | 'kikikuru') => TileUpstreamAccess;
  readonly fetchHealthConfig: FetchHealthConfig;
  readonly serverGenerationId: string;
  readonly serverStartedAt: UtcIso8601String;
  readonly now: () => UtcIso8601String;
  readonly adoptionWindowHours?: number;
}

export interface MonitoringStatusService {
  getStatus(
    terminal: TerminalDefinition,
    cached?: MonitoringStatusResponse,
  ): MonitoringStatusResponse;
}

const AVAILABILITY_RANK: Readonly<Record<Availability, number>> = {
  available: 0,
  stale: 1,
  unavailable: 2,
};

function worseAvailability(a: Availability, b: Availability): Availability {
  return AVAILABILITY_RANK[a] >= AVAILABILITY_RANK[b] ? a : b;
}

export function buildOperationSection(
  status: ReturnType<TimeBasedPollingScheduler['getStatus']>,
  schedulerRunning: boolean,
): MonitoringOperationSection {
  return {
    schedulerRunning,
    period: {
      start: status.period.start,
      end: status.period.end,
      xmlSeconds: status.period.xmlSeconds,
      imageCatalogSeconds: status.period.imageCatalogSeconds,
      amedasSeconds: status.period.amedasSeconds,
      nowcastEnabled: status.period.nowcastEnabled,
      kikikuruEnabled: status.period.kikikuruEnabled,
    },
    nextPeriodChangeAt: status.nextPeriodChangeAt,
    scheduledSources: (['xml', 'nowcast', 'kikikuru', 'amedas'] as const).map((source) => ({
      source,
      state: status.sources[source].state,
      intervalSeconds: status.sources[source].intervalSeconds,
      nextRunAt: status.sources[source].nextRunAt,
    })),
  };
}

export function buildHealthSection(
  aggregate: ReturnType<FetchHealthMonitorService['getLastAggregate']>,
  config: FetchHealthConfig,
): MonitoringHealthSection {
  const thresholds = {
    evaluationIntervalSeconds: config.evaluationIntervalSeconds,
    delayedConsecutiveFailures: config.delayedConsecutiveFailures,
    delayedIntervalMultiplier: config.delayedIntervalMultiplier,
    abnormalConsecutiveFailures: config.abnormalConsecutiveFailures,
    abnormalElapsedSeconds: config.abnormalElapsedSeconds,
    maxScanAttempts: config.maxScanAttempts,
  };

  if (aggregate === null) {
    const sources: MonitoringHealthSource[] = MONITORED_FETCH_SOURCES.map((def) => ({
      sourceId: def.id,
      displayName: def.displayName,
      status: null,
      lastAttemptAt: null,
      lastSuccessAt: null,
      consecutiveFailures: null,
      intervalSeconds: null,
      appliesElapsedCondition: def.appliesElapsedCondition,
      lastDurationMs: null,
      reasons: [],
    }));
    return {
      evaluatedAt: null,
      worstStatus: null,
      worstSourceIds: [],
      sources,
      thresholds,
    };
  }

  const resultMap = new Map(aggregate.sources.map((s) => [s.sourceId, s]));
  const sources: MonitoringHealthSource[] = MONITORED_FETCH_SOURCES.map((def) => {
    const r = resultMap.get(def.id);
    if (!r) {
      return {
        sourceId: def.id,
        displayName: def.displayName,
        status: null,
        lastAttemptAt: null,
        lastSuccessAt: null,
        consecutiveFailures: null,
        intervalSeconds: null,
        appliesElapsedCondition: def.appliesElapsedCondition,
        lastDurationMs: null,
        reasons: [],
      };
    }
    return {
      sourceId: def.id,
      displayName: def.displayName,
      status: r.status,
      lastAttemptAt: r.lastAttemptAt,
      lastSuccessAt: r.lastSuccessAt,
      consecutiveFailures: r.maxConsecutiveFailures,
      intervalSeconds: r.intervalSeconds,
      appliesElapsedCondition: def.appliesElapsedCondition,
      lastDurationMs: r.lastDurationMs,
      reasons: r.reasons.map((reason) => ({
        kind: reason.kind,
        status: reason.status,
        sourceKind: reason.sourceKind,
        text: reason.text,
      })),
    };
  });

  return {
    evaluatedAt: aggregate.evaluatedAt,
    worstStatus: aggregate.status,
    worstSourceIds: aggregate.worstSourceIds,
    sources,
    thresholds,
  };
}

export function buildReadinessSection(
  status: ReturnType<XmlPollingStatusProvider['getStatus']>,
  preparationFailures: readonly WeatherPreparationFailure[],
): MonitoringReadinessSection {
  const { initialFetch } = status;
  const feedKinds = ['regular', 'extra', 'regular_l', 'extra_l'] as const;

  const succeededFor = (feedKind: (typeof feedKinds)[number]): boolean | null => {
    if (initialFetch.phase === 'not_started' || initialFetch.phase === 'running') {
      return null;
    }
    if (initialFetch.result === null) {
      return null;
    }
    return !initialFetch.result.failedFeedKinds.includes(feedKind);
  };

  return {
    preparationFailures,
    initialFetchPhase: initialFetch.phase,
    startedAt: initialFetch.result?.startedAt ?? null,
    finishedAt: initialFetch.result?.finishedAt ?? null,
    feeds: feedKinds.map((feedKind) => ({
      feedKind,
      succeeded: succeededFor(feedKind),
    })),
    errorReason: initialFetch.result?.errorReason ?? null,
  };
}

export function createMonitoringStatusService(
  deps: MonitoringStatusServiceDependencies,
): MonitoringStatusService {
  const adoptionWindowHours = deps.adoptionWindowHours ?? ADOPTION_WINDOW_HOURS_DEFAULT;

  function buildVenues(
    generatedAt: UtcIso8601String,
    readErrors: MonitoringReadError[],
    cached?: MonitoringStatusResponse,
  ): readonly MonitoringVenueSection[] {
    const startupStatus = deps.startupInitialization.getStatus();
    const sinceMs = new Date(generatedAt).getTime() - adoptionWindowHours * 60 * 60 * 1000;
    const sinceIso = new Date(sinceMs).toISOString() as UtcIso8601String;
    let summary: ReturnType<typeof summarizeAdoptionResults> = [];
    try {
      if (!cached) summary = summarizeAdoptionResults(deps.connection, sinceIso);
    } catch {
      readErrors.push({
        section: 'recent_adoptions',
        venueId: null,
        kind: null,
        code: 'weather_data_read_failed',
      });
    }

    return deps.venueRegistry.listVenueIds().map((venueId) => {
      const startupEvaluated =
        startupStatus.initialFetchPhase === 'completed' &&
        startupStatus.evaluatedVenueIds.has(venueId) &&
        !startupStatus.preparationFailures.some(
          (failure) => failure.venueId === null || failure.venueId === venueId,
        );

      const recentAdoptions = summary
        .filter((row) => row.venueId === venueId)
        .map((row) => ({
          adoptionResult: row.adoptionResult,
          count: row.count,
          // 集計SQLは件数のみを返すため、最終決定時刻は別途 §6 の履歴APIで確認する前提とする。
          latestDecidedAt: null,
        }));

      const reprocessing = deps.progressTracker
        ? deps.progressTracker.getVenueReprocessingStatus(venueId)
        : {
            status: 'idle' as const,
            total: 0,
            processedCount: 0,
            startedAt: null,
            finishedAt: null,
            elapsedMs: null,
          };

      return {
        venueId,
        startupEvaluated,
        reprocessing,
        recovery: deps.recoveryTracker?.getStatus(venueId, generatedAt) ?? {
          status: 'idle',
          startedAt: null,
          finishedAt: null,
          delayedAt: null,
          elapsedMs: null,
          currentControlStatus: null,
          completedControlStatuses: [],
          reusedControlStatuses: [],
          rebuiltControlStatuses: [],
          parsedReceptionCount: 0,
          errorCode: null,
        },
        recentAdoptions:
          cached?.venues.find((v) => v.venueId === venueId)?.recentAdoptions ?? recentAdoptions,
        adoptionWindowHours,
      };
    });
  }

  function buildInformationForVenue(
    venueId: VenueId,
    readErrors: MonitoringReadError[],
  ): readonly MonitoringInformationSection[] {
    const terminal =
      deps.terminalRegistry.listTerminals().find((t) => t.venueId === venueId) ?? null;
    const sections: MonitoringInformationSection[] = [];
    if (!terminal) {
      return (
        [
          'warning',
          'warning_timeseries',
          'early_warning',
          'amedas',
          'area_timeseries',
          'bosai_bulletin',
          'nowcast',
          'kikikuru',
        ] as const
      ).map((kind) => ({
        kind,
        venueId,
        availability: 'unavailable',
        issuedAt: null,
        validAt: null,
        fetchedAt: null,
        lastSuccessAt: null,
        summaryCount: null,
      }));
    }

    const readInformation = (
      kind: MonitoringInformationKind,
      read: () => MonitoringInformationSection,
    ): void => {
      try {
        sections.push(read());
      } catch {
        readErrors.push({
          section: 'information',
          venueId,
          kind,
          code: 'weather_data_read_failed',
        });
        sections.push({
          kind,
          venueId,
          availability: 'unavailable',
          issuedAt: null,
          validAt: null,
          fetchedAt: null,
          lastSuccessAt: null,
          summaryCount: null,
        });
      }
    };

    readInformation('warning', () => {
      const warnings = deps.weatherApi.getWarnings(terminal, 'normal');
      return {
        kind: 'warning',
        venueId,
        availability: warnings.metadata.availability,
        issuedAt: warnings.metadata.issuedAt,
        validAt: warnings.metadata.validAt,
        fetchedAt: warnings.metadata.fetchedAt,
        lastSuccessAt: warnings.metadata.lastSuccessAt,
        summaryCount: warnings.data ? warnings.data.items.length : null,
      };
    });

    readInformation('warning_timeseries', () => {
      const warningTimeseries = deps.weatherApi.getWarningTimeseries(terminal, 'normal');
      return {
        kind: 'warning_timeseries',
        venueId,
        availability: warningTimeseries.metadata.availability,
        issuedAt: warningTimeseries.metadata.issuedAt,
        validAt: warningTimeseries.metadata.validAt,
        fetchedAt: warningTimeseries.metadata.fetchedAt,
        lastSuccessAt: warningTimeseries.metadata.lastSuccessAt,
        summaryCount: warningTimeseries.data ? warningTimeseries.data.values.length : null,
      };
    });

    readInformation('early_warning', () => {
      const earlyWarning = deps.weatherApi.getEarlyWarning(terminal, 'normal');
      const earlyAvailability = worseAvailability(
        earlyWarning.near.metadata.availability,
        earlyWarning.far.metadata.availability,
      );
      const earlyPrimary =
        earlyWarning.near.metadata.availability === earlyAvailability
          ? earlyWarning.near.metadata
          : earlyWarning.far.metadata;
      const earlyCount =
        earlyWarning.near.data || earlyWarning.far.data
          ? (earlyWarning.near.data?.cells.length ?? 0) + (earlyWarning.far.data?.cells.length ?? 0)
          : null;
      return {
        kind: 'early_warning',
        venueId,
        availability: earlyAvailability,
        issuedAt: earlyPrimary.issuedAt,
        validAt: earlyPrimary.validAt,
        fetchedAt: earlyPrimary.fetchedAt,
        lastSuccessAt: earlyPrimary.lastSuccessAt,
        summaryCount: earlyCount,
      };
    });

    readInformation('amedas', () => {
      const amedas = deps.weatherApi.getAmedas(terminal, 'normal');
      return {
        kind: 'amedas',
        venueId,
        availability: amedas.metadata.availability,
        issuedAt: amedas.metadata.issuedAt,
        validAt: amedas.metadata.validAt,
        fetchedAt: amedas.metadata.fetchedAt,
        lastSuccessAt: amedas.metadata.lastSuccessAt,
        summaryCount: amedas.data ? amedas.data.observations.length : null,
      };
    });

    readInformation('area_timeseries', () => {
      const areaTimeseries = deps.weatherApi.getAreaTimeseries(terminal, 'normal');
      return {
        kind: 'area_timeseries',
        venueId,
        availability: areaTimeseries.metadata.availability,
        issuedAt: areaTimeseries.metadata.issuedAt,
        validAt: areaTimeseries.metadata.validAt,
        fetchedAt: areaTimeseries.metadata.fetchedAt,
        lastSuccessAt: areaTimeseries.metadata.lastSuccessAt,
        summaryCount: areaTimeseries.data ? areaTimeseries.data.values.length : null,
      };
    });

    readInformation('bosai_bulletin', () => {
      const bulletins = deps.weatherApi.getBulletins(terminal, 'normal');
      return {
        kind: 'bosai_bulletin',
        venueId,
        availability: bulletins.availability,
        issuedAt: null,
        validAt: null,
        fetchedAt: null,
        lastSuccessAt: null,
        summaryCount: bulletins.bulletins.length,
      };
    });

    readInformation('nowcast', () => {
      const nowcast = deps.nowcastApi.getTimes(terminal, 'normal');
      const nowcastN1 = nowcast.products.N1;
      const nowcastN2 = nowcast.products.N2;
      const nowcastAvailability = worseAvailability(
        nowcastN1.metadata.availability,
        nowcastN2.metadata.availability,
      );
      const nowcastPrimary =
        nowcastN1.metadata.availability === nowcastAvailability
          ? nowcastN1.metadata
          : nowcastN2.metadata;
      const nowcastCount =
        nowcastN1.data || nowcastN2.data
          ? (nowcastN1.data?.frames.length ?? 0) + (nowcastN2.data?.frames.length ?? 0)
          : null;
      return {
        kind: 'nowcast',
        venueId,
        availability: nowcastAvailability,
        issuedAt: nowcastPrimary.issuedAt,
        validAt: nowcastPrimary.validAt,
        fetchedAt: nowcastPrimary.fetchedAt,
        lastSuccessAt: nowcastPrimary.lastSuccessAt,
        summaryCount: nowcastCount,
      };
    });

    readInformation('kikikuru', () => {
      const kikikuru = deps.kikikuruApi.getTimes(terminal, 'normal');
      const kikikuruLayers = Object.values(kikikuru.layers);
      let kikikuruAvailability: Availability = 'available';
      for (const layer of kikikuruLayers) {
        kikikuruAvailability = worseAvailability(kikikuruAvailability, layer.metadata.availability);
      }
      const kikikuruPrimary =
        kikikuruLayers.find((layer) => layer.metadata.availability === kikikuruAvailability)
          ?.metadata ?? kikikuruLayers[0]?.metadata;
      const kikikuruHasAnyData = kikikuruLayers.some((layer) => layer.data !== null);
      const kikikuruCount = kikikuruHasAnyData
        ? kikikuruLayers.reduce((sum, layer) => sum + (layer.data?.frames.length ?? 0), 0)
        : null;
      return {
        kind: 'kikikuru',
        venueId,
        availability: kikikuruAvailability,
        issuedAt: kikikuruPrimary?.issuedAt ?? null,
        validAt: kikikuruPrimary?.validAt ?? null,
        fetchedAt: kikikuruPrimary?.fetchedAt ?? null,
        lastSuccessAt: kikikuruPrimary?.lastSuccessAt ?? null,
        summaryCount: kikikuruCount,
      };
    });

    return sections;
  }

  function buildTiles(readErrors: MonitoringReadError[]): MonitoringTilesSection {
    // タイルの索引・配信状態はサーバー共通（会場に依存しない）。
    const terminal = deps.terminalRegistry.listTerminals()[0]!;
    const layers = (['nowcast', 'kikikuru'] as const).map((layer): MonitoringTilesLayer => {
      const access = deps.getTileUpstreamAccess(layer);
      let catalog: Pick<
        MonitoringTilesLayer,
        'catalogAvailability' | 'catalogUpdatedAt' | 'availableFrameCount'
      >;
      try {
        const datasets =
          layer === 'nowcast'
            ? Object.values(deps.nowcastApi.getTimes(terminal, 'normal').products)
            : Object.values(deps.kikikuruApi.getTimes(terminal, 'normal').layers);
        const availability = datasets.reduce<Availability>(
          (result, dataset) => worseAvailability(result, dataset.metadata.availability),
          'available',
        );
        const primary = datasets.find((dataset) => dataset.metadata.availability === availability);
        catalog = {
          catalogAvailability: availability,
          catalogUpdatedAt: primary?.metadata.fetchedAt ?? null,
          availableFrameCount: datasets.reduce(
            (count, dataset) => count + (dataset.data?.frames.length ?? 0),
            0,
          ),
        };
      } catch {
        readErrors.push({
          section: 'tiles',
          venueId: null,
          kind: layer,
          code: 'weather_data_read_failed',
        });
        catalog = {
          catalogAvailability: 'unavailable',
          catalogUpdatedAt: null,
          availableFrameCount: 0,
        };
      }
      return {
        layer,
        ...catalog,
        upstreamFetchAllowed: access.allowed,
        nextUpstreamAllowedAt: access.nextAllowedAt,
      };
    });
    return { healthMonitored: false, healthCriteriaStatus: 'undecided', layers };
  }

  return {
    getStatus(
      terminal: TerminalDefinition,
      cached?: MonitoringStatusResponse,
    ): MonitoringStatusResponse {
      const generatedAt = deps.now();
      const schedulerStatus = deps.scheduler.getStatus();
      const xmlStatus = deps.xmlPollingService.getStatus();
      const aggregate = deps.fetchHealthMonitor.getLastAggregate();

      const readErrors: MonitoringReadError[] = cached ? [...cached.readErrors] : [];
      const venues = buildVenues(generatedAt, readErrors, cached);
      const information: MonitoringInformationSection[] = [];
      if (!cached)
        for (const venueId of deps.venueRegistry.listVenueIds()) {
          information.push(...buildInformationForVenue(venueId, readErrors));
        }

      return {
        status: 'ready',
        weatherRuntimes: Object.fromEntries(
          ['acquisition', 'delivery'].map((role) => [
            role,
            projectWeatherRuntimeStatus(
              {
                role: role as 'acquisition' | 'delivery',
                mode: 'inline',
                workerGeneration: null,
                lifecycle: 'ready',
                reportedAt: generatedAt,
                receivedAt: generatedAt,
                stopReason: null,
                exitConfirmed: false,
                failureCode: null,
                pendingRequests: 0,
              },
              generatedAt,
            ),
          ]),
        ) as MonitoringStatusResponse['weatherRuntimes'],
        readErrors,
        terminalId: terminal.id,
        requestedVenueId: deps.venueRegistry.resolveVenueId(terminal.venueId)!,
        serverGenerationId: deps.serverGenerationId,
        serverStartedAt: deps.serverStartedAt,
        generatedAt,
        // レビュー指摘 #4: sources[*].state はデフォルト夜間帯で全取得元が scheduled_stopped
        // になるため、これだけでは「スケジューラ稼働中（夜間帯で自動停止中）」と
        // 「手動停止」を区別できない。scheduler.isRunningNow()（運転フラグ本体）を
        // schedulerRunning の出どころにする。
        operation: buildOperationSection(schedulerStatus, deps.scheduler.isRunningNow()),
        health: buildHealthSection(aggregate, deps.fetchHealthConfig),
        readiness: buildReadinessSection(
          xmlStatus,
          deps.startupInitialization.getStatus().preparationFailures,
        ),
        venues,
        information: cached?.information ?? information,
        tiles: cached?.tiles ?? buildTiles(readErrors),
      };
    },
  };
}
