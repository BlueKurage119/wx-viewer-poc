import {
  TERMINAL_DEFINITIONS,
  VENUE_IDS,
  type Availability,
  type MonitoringHealthSection,
  type MonitoringHealthSource,
  type MonitoringInformationSection,
  type MonitoringOperationSection,
  type MonitoringReadinessSection,
  type MonitoringStatusResponse,
  type MonitoringTilesLayer,
  type MonitoringTilesSection,
  type MonitoringVenueSection,
  type TerminalDefinition,
  type UtcIso8601String,
  type VenueId,
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
  readonly scheduler: Pick<TimeBasedPollingScheduler, 'getStatus' | 'isRunningNow'>;
  readonly xmlPollingService: XmlPollingStatusProvider;
  readonly fetchHealthMonitor: Pick<FetchHealthMonitorService, 'getLastAggregate'>;
  readonly startupInitialization: StartupInitializationStatusProvider;
  readonly progressTracker?: StartupProgressTracker;
  readonly weatherApi: WeatherApiService;
  readonly nowcastApi: NowcastApiService;
  readonly kikikuruApi: KikikuruApiService;
  readonly fetchHealthConfig: FetchHealthConfig;
  readonly serverGenerationId: string;
  readonly now: () => UtcIso8601String;
  readonly adoptionWindowHours?: number;
}

export interface MonitoringStatusService {
  getStatus(terminal: TerminalDefinition): MonitoringStatusResponse;
}

function resolveRepresentativeTerminal(venueId: VenueId): TerminalDefinition {
  const found = TERMINAL_DEFINITIONS.find((t) => t.venueId === venueId);
  if (!found) {
    throw new Error(`会場 ${venueId} に対応する端末定義が見つかりません`);
  }
  return found;
}

const AVAILABILITY_RANK: Readonly<Record<Availability, number>> = {
  available: 0,
  stale: 1,
  unavailable: 2,
};

function worseAvailability(a: Availability, b: Availability): Availability {
  return AVAILABILITY_RANK[a] >= AVAILABILITY_RANK[b] ? a : b;
}

function buildOperationSection(
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

function buildHealthSection(
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

function buildReadinessSection(
  status: ReturnType<XmlPollingStatusProvider['getStatus']>,
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

  function buildVenues(generatedAt: UtcIso8601String): readonly MonitoringVenueSection[] {
    const startupStatus = deps.startupInitialization.getStatus();
    const sinceMs = new Date(generatedAt).getTime() - adoptionWindowHours * 60 * 60 * 1000;
    const sinceIso = new Date(sinceMs).toISOString() as UtcIso8601String;
    const summary = summarizeAdoptionResults(deps.connection, sinceIso);

    return VENUE_IDS.map((venueId) => {
      const startupEvaluated =
        startupStatus.initialFetchPhase === 'completed' &&
        startupStatus.evaluatedVenueIds.has(venueId);

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
        recentAdoptions,
        adoptionWindowHours,
      };
    });
  }

  function buildInformationForVenue(venueId: VenueId): readonly MonitoringInformationSection[] {
    const terminal = resolveRepresentativeTerminal(venueId);
    const sections: MonitoringInformationSection[] = [];

    const warnings = deps.weatherApi.getWarnings(terminal, 'normal');
    sections.push({
      kind: 'warning',
      venueId,
      availability: warnings.metadata.availability,
      issuedAt: warnings.metadata.issuedAt,
      validAt: warnings.metadata.validAt,
      fetchedAt: warnings.metadata.fetchedAt,
      lastSuccessAt: warnings.metadata.lastSuccessAt,
      summaryCount: warnings.data ? warnings.data.items.length : null,
    });

    const warningTimeseries = deps.weatherApi.getWarningTimeseries(terminal, 'normal');
    sections.push({
      kind: 'warning_timeseries',
      venueId,
      availability: warningTimeseries.metadata.availability,
      issuedAt: warningTimeseries.metadata.issuedAt,
      validAt: warningTimeseries.metadata.validAt,
      fetchedAt: warningTimeseries.metadata.fetchedAt,
      lastSuccessAt: warningTimeseries.metadata.lastSuccessAt,
      summaryCount: warningTimeseries.data ? warningTimeseries.data.values.length : null,
    });

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
    sections.push({
      kind: 'early_warning',
      venueId,
      availability: earlyAvailability,
      issuedAt: earlyPrimary.issuedAt,
      validAt: earlyPrimary.validAt,
      fetchedAt: earlyPrimary.fetchedAt,
      lastSuccessAt: earlyPrimary.lastSuccessAt,
      summaryCount: earlyCount,
    });

    const amedas = deps.weatherApi.getAmedas(terminal, 'normal');
    sections.push({
      kind: 'amedas',
      venueId,
      availability: amedas.metadata.availability,
      issuedAt: amedas.metadata.issuedAt,
      validAt: amedas.metadata.validAt,
      fetchedAt: amedas.metadata.fetchedAt,
      lastSuccessAt: amedas.metadata.lastSuccessAt,
      summaryCount: amedas.data ? amedas.data.observations.length : null,
    });

    const areaTimeseries = deps.weatherApi.getAreaTimeseries(terminal, 'normal');
    sections.push({
      kind: 'area_timeseries',
      venueId,
      availability: areaTimeseries.metadata.availability,
      issuedAt: areaTimeseries.metadata.issuedAt,
      validAt: areaTimeseries.metadata.validAt,
      fetchedAt: areaTimeseries.metadata.fetchedAt,
      lastSuccessAt: areaTimeseries.metadata.lastSuccessAt,
      summaryCount: areaTimeseries.data ? areaTimeseries.data.values.length : null,
    });

    const bulletins = deps.weatherApi.getBulletins(terminal, 'normal');
    sections.push({
      kind: 'bosai_bulletin',
      venueId,
      availability: bulletins.availability,
      issuedAt: null,
      validAt: null,
      fetchedAt: null,
      lastSuccessAt: null,
      summaryCount: bulletins.bulletins.length,
    });

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
    sections.push({
      kind: 'nowcast',
      venueId,
      availability: nowcastAvailability,
      issuedAt: nowcastPrimary.issuedAt,
      validAt: nowcastPrimary.validAt,
      fetchedAt: nowcastPrimary.fetchedAt,
      lastSuccessAt: nowcastPrimary.lastSuccessAt,
      summaryCount: nowcastCount,
    });

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
    sections.push({
      kind: 'kikikuru',
      venueId,
      availability: kikikuruAvailability,
      issuedAt: kikikuruPrimary?.issuedAt ?? null,
      validAt: kikikuruPrimary?.validAt ?? null,
      fetchedAt: kikikuruPrimary?.fetchedAt ?? null,
      lastSuccessAt: kikikuruPrimary?.lastSuccessAt ?? null,
      summaryCount: kikikuruCount,
    });

    return sections;
  }

  function buildTiles(): MonitoringTilesSection {
    // タイルの索引・配信状態はサーバー共通（会場に依存しない）ため、任意の端末で読み出す。
    const terminal = resolveRepresentativeTerminal('east');

    const nowcast = deps.nowcastApi.getTimes(terminal, 'normal');
    const nowcastAvailability = worseAvailability(
      nowcast.products.N1.metadata.availability,
      nowcast.products.N2.metadata.availability,
    );
    const nowcastUpdatedAt =
      nowcast.products.N1.metadata.availability === nowcastAvailability
        ? nowcast.products.N1.metadata.fetchedAt
        : nowcast.products.N2.metadata.fetchedAt;
    const nowcastFrameCount =
      (nowcast.products.N1.data?.frames.length ?? 0) +
      (nowcast.products.N2.data?.frames.length ?? 0);

    const kikikuru = deps.kikikuruApi.getTimes(terminal, 'normal');
    const kikikuruLayers = Object.values(kikikuru.layers);
    let kikikuruAvailability: Availability = 'available';
    for (const layer of kikikuruLayers) {
      kikikuruAvailability = worseAvailability(kikikuruAvailability, layer.metadata.availability);
    }
    const kikikuruPrimary =
      kikikuruLayers.find((layer) => layer.metadata.availability === kikikuruAvailability) ??
      kikikuruLayers[0];
    const kikikuruFrameCount = kikikuruLayers.reduce(
      (sum, layer) => sum + (layer.data?.frames.length ?? 0),
      0,
    );

    const layers: MonitoringTilesLayer[] = [
      {
        layer: 'nowcast',
        catalogAvailability: nowcastAvailability,
        catalogUpdatedAt: nowcastUpdatedAt,
        availableFrameCount: nowcastFrameCount,
        upstreamFetchAllowed: nowcast.imageAccess?.allowed ?? false,
        nextUpstreamAllowedAt: nowcast.imageAccess?.nextAllowedAt ?? null,
      },
      {
        layer: 'kikikuru',
        catalogAvailability: kikikuruAvailability,
        catalogUpdatedAt: kikikuruPrimary?.metadata.fetchedAt ?? null,
        availableFrameCount: kikikuruFrameCount,
        upstreamFetchAllowed: kikikuru.imageAccess?.allowed ?? false,
        nextUpstreamAllowedAt: kikikuru.imageAccess?.nextAllowedAt ?? null,
      },
    ];

    return {
      healthMonitored: false,
      healthCriteriaStatus: 'undecided',
      layers,
    };
  }

  return {
    getStatus(terminal: TerminalDefinition): MonitoringStatusResponse {
      const generatedAt = deps.now();
      const schedulerStatus = deps.scheduler.getStatus();
      const xmlStatus = deps.xmlPollingService.getStatus();
      const aggregate = deps.fetchHealthMonitor.getLastAggregate();

      const information: MonitoringInformationSection[] = [];
      for (const venueId of VENUE_IDS) {
        information.push(...buildInformationForVenue(venueId));
      }

      return {
        status: 'ready',
        terminalId: terminal.id,
        requestedVenueId: terminal.venueId,
        serverGenerationId: deps.serverGenerationId,
        generatedAt,
        // レビュー指摘 #4: sources[*].state はデフォルト夜間帯で全取得元が scheduled_stopped
        // になるため、これだけでは「スケジューラ稼働中（夜間帯で自動停止中）」と
        // 「手動停止」を区別できない。scheduler.isRunningNow()（運転フラグ本体）を
        // schedulerRunning の出どころにする。
        operation: buildOperationSection(schedulerStatus, deps.scheduler.isRunningNow()),
        health: buildHealthSection(aggregate, deps.fetchHealthConfig),
        readiness: buildReadinessSection(xmlStatus),
        venues: buildVenues(generatedAt),
        information,
        tiles: buildTiles(),
      };
    },
  };
}
