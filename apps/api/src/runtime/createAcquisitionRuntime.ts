import { createWeatherApiService } from '../services/weatherApiService.js';
import { weatherReadScope } from './weatherReadScope.js';
import {
  createVenueRegistry,
  type VenueId,
  type VenueRegistry,
  type UtcIso8601String,
  type WeatherPreparationFailure,
  type VenueForecastTargets,
} from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/connection.js';
import type { PollingScheduleConfig } from '../config/pollingSchedule.js';
import { resolveVenueWarningContext } from '../venueForecastTargets.js';
import {
  StartupNotificationInitialization,
  emitInitialWarningNotifications,
  emitInitialBosaiBulletinNotifications,
  planDatabaseRecoveryNotification,
  type WarningNotificationEmitDeps,
  type BosaiNotificationEmitDeps,
} from '../notifications/index.js';
import {
  planInitialSyncNotification,
  type InitialSyncFailureStage,
} from '../notifications/initialSyncNotificationPlanner.js';
import { toNotificationOutputHistoryInput } from '../notifications/notificationOutputHistoryMapper.js';
import { InMemoryStartupProgressTracker } from '../monitoring/startupProgressTracker.js';
import { InMemoryWarningCurrentRecoveryTracker } from '../monitoring/warningCurrentRecoveryTracker.js';
import { FetchHealthMonitorService } from '../monitoring/index.js';
import {
  JmaXmlPollingService,
  TimeBasedPollingScheduler,
  createScheduledAdapters,
  createImageServices,
  buildStoppedPollingStatus,
} from '../polling/index.js';
import { recoverWarningCurrent } from '../polling/jmaWarningCurrentProcessor.js';
import { reprocessPendingWarningTelegramReceptions } from '../polling/jmaWarningTelegramProcessor.js';
import { reprocessPendingVenueForecastReceptions } from '../polling/jmaVenueForecastReprocessor.js';
import { recoverLegacyVphwBulletinAreas } from '../polling/jmaVphwProcessor.js';
import type { DecisionScope } from './weatherDecisionRuntime.js';
import { createWorkerDecisions } from './workerDecisions.js';
import type { DecisionCheckpoint, WeatherEpoch } from './weatherContracts.js';
import type { WeatherTransport } from './weatherTransport.js';

export interface AcquisitionSettings {
  readonly venues: readonly VenueForecastTargets[];
  readonly venueGeneration: string;
  readonly schedule: PollingScheduleConfig;
  readonly enablePolling: boolean;
  readonly desiredRunning: boolean;
  readonly serverStartedAt: string;
  readonly nowcastCacheRoot: string;
  readonly kikikuruCacheRoot: string;
}
export function createAcquisitionRuntime(
  connection: DatabaseConnection,
  settings: AcquisitionSettings,
  epoch: WeatherEpoch,
  checkpoint: DecisionCheckpoint,
  transport: WeatherTransport,
) {
  const registry: VenueRegistry = createVenueRegistry(settings.venues, settings.venueGeneration);
  const clock = () => new Date().toISOString();
  const serverGenerationId = epoch.serverGenerationId;
  const weatherDatabaseGenerationId = epoch.weatherDatabaseGenerationId!;
  const initialization = new StartupNotificationInitialization();
  const decisions = createWorkerDecisions(epoch, checkpoint, transport);
  const locallyValidatedScopes = new Set<string>();
  const scopeFor = (venueIds: readonly VenueId[]) => ({
    scopes: venueIds.flatMap((id) =>
      (['normal', 'training'] as const).flatMap((status) =>
        (['warnings', 'bulletins'] as const).map((kind) => weatherReadScope(id, status, kind)),
      ),
    ),
    initialWarningKeys: venueIds.flatMap((id) =>
      ['normal', 'training'].map(
        (status) =>
          `${resolveVenueWarningContext(registry, id).targetArea.municipalCode}|${status}`,
      ),
    ),
    initialBosaiKeys: venueIds.flatMap((id) =>
      ['normal', 'training'].map((status) => `${id}|${status}`),
    ),
  });
  const runWeatherUpdate = <T>(
    work: () => T,
    scope: DecisionScope = { scopes: [], initialWarningKeys: [], initialBosaiKeys: [] },
  ) => decisions.runUpdate(scope, work);
  const evaluateInitialWarning = (venue: ReturnType<typeof resolveVenueWarningContext>) =>
    decisions.runUpdate(
      {
        scopes: (['normal', 'training'] as const).map((status) =>
          weatherReadScope(venue.venueId, status, 'warnings'),
        ),
        initialWarningKeys: ['normal', 'training'].map(
          (status) => `${venue.targetArea.municipalCode}|${status}`,
        ),
        initialBosaiKeys: [],
      },
      () => emitInitialWarningNotifications(connection, venue.targetArea, warningEmitDeps),
    );

  const warningEmitDeps: WarningNotificationEmitDeps = {
    recordSink: decisions.recordSink,
    weatherDatabaseGenerationId,
    tracker: decisions.warning,
    now: clock,
  };
  const bosaiEmitDeps: BosaiNotificationEmitDeps = {
    venueRegistry: registry,
    recordSink: decisions.recordSink,
    weatherDatabaseGenerationId,
    initialState: decisions.bosai,
    now: clock,
  };
  const progressTracker = new InMemoryStartupProgressTracker(
    () => clock() as UtcIso8601String,
    registry,
  );
  const recoveryTracker = new InMemoryWarningCurrentRecoveryTracker(registry);
  const recoveryEmitter = {
    emit: (planned: ReturnType<typeof planDatabaseRecoveryNotification>) => {
      void transport
        .call(
          'notification.record',
          toNotificationOutputHistoryInput(planned.notification, planned.output, null),
        )
        .catch(() => {});
    },
  };
  const initialSyncEmitter = {
    emit: (planned: ReturnType<typeof planInitialSyncNotification>) => {
      void transport
        .call(
          'notification.record',
          toNotificationOutputHistoryInput(planned.notification, planned.output, null),
        )
        .catch(() => {});
    },
  };
  let stopped = false;
  const emitInitialFailure = (stage: InitialSyncFailureStage, venueId: VenueId | null = null) => {
    if (stopped) return;
    try {
      initialSyncEmitter.emit(
        planInitialSyncNotification({
          stage,
          venueId,
          venueRegistry: registry,
          serverGenerationId,
          occurredAt: clock() as UtcIso8601String,
        }),
      );
    } catch (error) {
      console.error('[api] 初回準備失敗通知の記録に失敗しました:', error);
    }
  };
  const failPreparation = (stage: WeatherPreparationFailure['stage']) => {
    if (
      stopped ||
      initialization
        .getStatus()
        .preparationFailures.some((failure) => failure.stage !== 'venue_evaluation')
    )
      return;
    initialization.markPreparationFailed({
      stage,
      venueId: null,
      failedAt: clock() as UtcIso8601String,
      code: 'weather_preparation_failed',
    });
    if (stage !== 'recovery') emitInitialFailure(stage);
  };
  const setRecoveryTimeout = setTimeout;
  const clearRecoveryTimeout = clearTimeout;
  const runRecovery = recoverWarningCurrent;
  const emitRecovery = (
    venueId: VenueId,
    event: 'started' | 'completed' | 'delayed' | 'failed',
  ) => {
    recoveryEmitter.emit(
      planDatabaseRecoveryNotification({
        venueRegistry: registry,
        event,
        venueId,
        serverGenerationId,
        occurredAt: clock() as UtcIso8601String,
        notificationIdFactory: () => `database-recovery:${serverGenerationId}:${venueId}:${event}`,
      }),
    );
  };
  const recoverVenue = async (
    venue: ReturnType<typeof resolveVenueWarningContext>,
    config: PollingScheduleConfig['startupRecovery'],
    afterStarted?: () => Promise<void>,
  ) => {
    const startedAt = clock() as UtcIso8601String;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectDelay!: (error: unknown) => void;
    const delayedFailure = new Promise<never>((_resolve, reject) => {
      rejectDelay = reject;
    });
    try {
      recoveryTracker.start(venue.venueId, startedAt);
      emitRecovery(venue.venueId, 'started');
      timer = setRecoveryTimeout(() => {
        try {
          const delayedAt = clock() as UtcIso8601String;
          if (
            Date.parse(delayedAt) - Date.parse(startedAt) >=
              config.delayedThresholdSeconds * 1000 &&
            recoveryTracker.markDelayed(venue.venueId, delayedAt)
          ) {
            emitRecovery(venue.venueId, 'delayed');
          }
        } catch (error) {
          console.error('[api] DB復旧遅延通知の記録に失敗しました:', error);
          rejectDelay(error);
        }
      }, config.delayedThresholdSeconds * 1000);
      await afterStarted?.();
      const result = await Promise.race([
        runRecovery(connection, venue, {
          yieldEveryParsedReceptions: config.yieldEveryParsedReceptions,
          candidatePageSize: config.candidatePageSize,
          runWeatherUpdate,
          onProgress: (progress) => recoveryTracker.progress(venue.venueId, progress),
        }),
        delayedFailure,
      ]);
      if (timer) clearRecoveryTimeout(timer);
      const finishedAt = clock() as UtcIso8601String;
      recoveryTracker.complete(venue.venueId, result, finishedAt);
      emitRecovery(venue.venueId, 'completed');
      return result;
    } catch (error) {
      if (timer) clearRecoveryTimeout(timer);
      if (stopped) throw error;
      initialization.markPreparationFailed({
        stage: 'recovery',
        venueId: venue.venueId,
        failedAt: clock() as UtcIso8601String,
        code: 'weather_preparation_failed',
      });
      recoveryTracker.fail(venue.venueId, clock() as UtcIso8601String);
      console.error('[api] DB復旧または状態通知に失敗しました:', error);
      try {
        emitRecovery(venue.venueId, 'failed');
      } catch (notificationError) {
        console.error('[api] DB復旧失敗通知の記録に失敗しました:', notificationError);
      }
      throw error;
    }
  };
  const evaluateVenues = async () => {
    const errors: unknown[] = [];
    for (const venueId of registry.listVenueIds()) {
      if (stopped) return;
      try {
        const venue = resolveVenueWarningContext(registry, venueId);
        await decisions.runUpdate(scopeFor([venueId]), () => {
          emitInitialWarningNotifications(connection, venue.targetArea, warningEmitDeps);
          emitInitialBosaiBulletinNotifications(connection, venueId, bosaiEmitDeps);
        });
        initialization.markVenueEvaluated(venueId);
      } catch (error) {
        initialization.markVenueEvaluationFailed(venueId, clock() as UtcIso8601String);
        emitInitialFailure('venue_evaluation', venueId);
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, '会場の初期評価に失敗しました');
  };
  const connectPolling = (pollingService: JmaXmlPollingService) => {
    let initialFetchStartMs: number | null = null;
    pollingService.onInitialFetchPhaseChange((phase) => {
      initialization.setInitialFetchPhase(phase);
      if (phase === 'running') {
        initialFetchStartMs = Date.now();
        console.log('[api] starting initial JMA XML feed fetch...');
      } else if (phase === 'completed') {
        const elapsedMs =
          initialFetchStartMs !== null ? Math.max(0, Date.now() - initialFetchStartMs) : 0;
        console.log(`[api] completed initial JMA XML feed fetch (${elapsedMs}ms)`);
      } else if (phase === 'failed') {
        const elapsedMs =
          initialFetchStartMs !== null ? Math.max(0, Date.now() - initialFetchStartMs) : 0;
        if (pollingService.wasInitialFetchAborted?.()) {
          console.log(`[api] aborted initial JMA XML feed fetch (${elapsedMs}ms)`);
        } else {
          console.error(`[api] failed initial JMA XML feed fetch (${elapsedMs}ms)`);
          emitInitialFailure('xml_initial_fetch');
        }
      }
    });
    pollingService.onInitialFetchCompleted(evaluateVenues);
  };

  const imageServices = createImageServices({
    connection,
    schedule: settings.schedule,
    enablePolling: settings.enablePolling,
    nowcastCacheRoot: settings.nowcastCacheRoot,
    kikikuruCacheRoot: settings.kikikuruCacheRoot,
  });
  let pollingService: JmaXmlPollingService | undefined;
  let scheduler: TimeBasedPollingScheduler | undefined;
  let healthMonitor: FetchHealthMonitorService | undefined;
  const prepare = async () => {
    if (settings.enablePolling) recoverLegacyVphwBulletinAreas(connection, registry);
    reprocessPendingVenueForecastReceptions(connection, clock(), registry);
    for (const venueId of registry.listVenueIds()) {
      if (stopped) return;
      const venue = resolveVenueWarningContext(registry, venueId);
      const recovered = await recoverVenue(venue, settings.schedule.startupRecovery, async () => {
        if (settings.enablePolling)
          await reprocessPendingWarningTelegramReceptions(
            connection,
            venue,
            clock,
            warningEmitDeps,
            { progressTracker, runWeatherUpdate },
          );
      });
      // 保存済み整合性の検証は上流初回取得や通知済みcheckpointとは独立して記録する。
      for (const result of recovered.statuses)
        locallyValidatedScopes.add(weatherReadScope(venueId, result.controlStatus, 'warnings'));
      const localReader = createWeatherApiService({
        connection,
        venueRegistry: registry,
        now: clock,
      });
      const terminal = {
        id: 'local-validation',
        name: '保存済み整合性検証',
        mode: 'H' as const,
        venueId,
      };
      for (const status of ['normal', 'training', 'test'] as const) {
        for (const [kind, method] of [
          ['warning-timeseries', 'getWarningTimeseries'],
          ['early-warning', 'getEarlyWarning'],
          ['area-timeseries', 'getAreaTimeseries'],
          ['amedas', 'getAmedas'],
          ['bulletins', 'getBulletins'],
        ] as const) {
          try {
            localReader[method](terminal, status);
            locallyValidatedScopes.add(weatherReadScope(venueId, status, kind));
          } catch {
            // 読取に失敗したscopeは未確定のままとし、他scopeの成功へ混ぜない。
          }
        }
      }
      await evaluateInitialWarning(venue);
    }
    if (!settings.enablePolling || stopped) return;
    pollingService = new JmaXmlPollingService(connection, {
      freshnessPolicy: settings.schedule.freshness.xml,
      venueRegistry: registry,
      runWeatherUpdate,
      warningNotificationEmitDeps: warningEmitDeps,
      bosaiNotificationEmitDeps: bosaiEmitDeps,
    });
    connectPolling(pollingService);
    const adapters = createScheduledAdapters({
      connection,
      venueRegistry: registry,
      nowcastService: imageServices.nowcast,
      kikikuruService: imageServices.kikikuru,
      now: () => new Date(),
      amedasPointRecheckSeconds: settings.schedule.amedasPointRecheckSeconds,
    });
    scheduler = new TimeBasedPollingScheduler({
      schedule: settings.schedule,
      adapters,
      xmlPollingService: pollingService,
    });
    healthMonitor = new FetchHealthMonitorService({
      connection,
      statusProvider: scheduler,
      config: settings.schedule.fetchHealth,
      store: decisions.health,
      recordSink: decisions.recordSink,
      runDecisionAsync: (work) =>
        decisions.runUpdate({ scopes: [], initialWarningKeys: [], initialBosaiKeys: [] }, work),
    });
    if (settings.desiredRunning) {
      const starting = scheduler.start();
      healthMonitor.start();
      await starting;
    }
  };
  return {
    imageServices,
    decisions,
    initialization,
    async prepare() {
      try {
        await prepare();
      } catch (error) {
        failPreparation('service_setup');
        throw error;
      }
    },
    status() {
      const status = initialization.getStatus();
      return {
        reportedAt: clock(),
        scheduler:
          scheduler?.getStatus() ?? buildStoppedPollingStatus(new Date(), settings.schedule),
        running: scheduler?.isRunningNow() ?? false,
        polling: pollingService?.getStatus() ?? null,
        health: healthMonitor?.getLastAggregate() ?? null,
        initialization: { ...status, evaluatedVenueIds: [...status.evaluatedVenueIds] },
        locallyValidatedScopes: [...locallyValidatedScopes],
        venues: registry.listVenueIds().map((venueId) => ({
          venueId,
          reprocessing: progressTracker.getVenueReprocessingStatus(venueId),
          recovery: recoveryTracker.getStatus(venueId, clock()),
        })),
      };
    },
    async execute(operation: 'start' | 'stop' | 'force_refresh' | 'recovery') {
      if (!scheduler || stopped) throw new Error('not_ready');
      if (operation === 'start') await scheduler.start();
      else if (operation === 'stop') await scheduler.stop();
      else if (operation === 'recovery') await scheduler.runRecoveryOnce();
      else {
        const result = await scheduler.runManualOnce();
        if (result.failedSources.length) throw new Error('force_refresh_failed');
        if (result.abortedSources.length) throw new Error('force_refresh_aborted');
      }
      return { running: scheduler.isRunningNow() };
    },
    async suspend() {
      decisions.fail();
      healthMonitor?.stop();
      await pollingService?.stop();
      await scheduler?.stop();
    },
    async close() {
      stopped = true;
      decisions.fail();
      healthMonitor?.stop();
      await pollingService?.stop('shutdown');
      await scheduler?.stop();
      await imageServices.close();
      await decisions.drain();
    },
  };
}
export type AcquisitionReport = ReturnType<ReturnType<typeof createAcquisitionRuntime>['status']>;
