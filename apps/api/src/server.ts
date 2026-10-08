import type { WeatherRequest } from './runtime/weatherContracts.js';
import { createAcquisitionControlTargets } from './runtime/acquisitionControlTargets.js';
import { WeatherPublicationGate } from './runtime/weatherPublication.js';
import {
  createWeatherDecisionRuntime,
  type DecisionScope,
} from './runtime/weatherDecisionRuntime.js';
import { createInlineWeatherRead } from './runtime/inlineWeatherRead.js';
import { projectStartupCurrentNotifications } from './notifications/startupCurrentNotificationProjector.js';
import { createApplicationRuntime } from './runtime/createApplicationRuntime.js';
import { findMaxNotificationOutputSequence } from './repositories/notificationOutputHistoryRepository.js';
import { InitialSyncNotificationEmitter } from './notifications/initialSyncNotificationEmitter.js';
import {
  planInitialSyncNotification,
  type InitialSyncFailureStage,
} from './notifications/initialSyncNotificationPlanner.js';
import { resolveOnDemandAccess } from './config/pollingSchedule.js';
import { projectUpstreamAccess } from './services/tileApiSupport.js';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import crypto from 'node:crypto';

import {
  toNotificationDeltaCursor,
  type WeatherPreparationFailure,
  type TerminalRegistry,
  type VenueRegistry,
  type VenueId,
  type UtcIso8601String,
} from '@wx-viewer-poc/shared';
import { createApp } from './app.js';
import {
  initializeDatabase,
  initializeDatabases,
  type DatabasePairConfig,
} from './database/index.js';
import {
  DEFAULT_CONFIG_URL,
  LOCAL_CONFIG_URL,
  loadPollingScheduleConfigWithSources,
  type LoadedPollingScheduleConfig,
  resolvePollingPeriod,
  validatePollingScheduleConfig,
  type PollingScheduleConfig,
  loadVenueConfig,
  loadTerminalConfig,
} from './config/index.js';
import {
  createFetchControlService,
  ForceRefreshAbortedError,
  ForceRefreshFailedError,
  type FetchControlService,
  type FetchControlTargets,
} from './services/fetchControlService.js';
import { registerGracefulShutdown, type SignalSource } from './gracefulShutdown.js';
import { createRetryableDatabaseClose } from './serverClose.js';
import { InMemoryStartupProgressTracker } from './monitoring/startupProgressTracker.js';
import { InMemoryWarningCurrentRecoveryTracker } from './monitoring/warningCurrentRecoveryTracker.js';
import {
  createMonitoringStatusService,
  type MonitoringStatusService,
} from './monitoring/monitoringStatusService.js';
import {
  createMonitoringProcessingService,
  type MonitoringProcessingService,
} from './monitoring/monitoringProcessingService.js';
import {
  JmaXmlPollingService,
  TimeBasedPollingScheduler,
  createScheduledAdapters,
  createImageServices,
  buildStoppedPollingStatus,
  type ImageServices,
  type JmaXmlPollingServiceOptions,
  type TimeBasedPollingSchedulerOptions,
  type NowcastService,
  type KikikuruService,
} from './polling/index.js';
import { recoverWarningCurrent } from './polling/jmaWarningCurrentProcessor.js';
import { reprocessPendingWarningTelegramReceptions } from './polling/jmaWarningTelegramProcessor.js';
import { reprocessPendingVenueForecastReceptions } from './polling/jmaVenueForecastReprocessor.js';
import { recoverLegacyVphwBulletinAreas } from './polling/jmaVphwProcessor.js';
import { resolveVenueWarningContext } from './venueForecastTargets.js';
import {
  createStartupNotificationService,
  createNotificationDeltaService,
  StartupNotificationInitialization,
  emitInitialWarningNotifications,
  emitInitialBosaiBulletinNotifications,
  DatabaseRecoveryNotificationEmitter,
  planDatabaseRecoveryNotification,
  type WarningNotificationEmitDeps,
  type BosaiNotificationEmitDeps,
} from './notifications/index.js';
import { FetchHealthMonitorService } from './monitoring/index.js';
import { createWeatherApiService } from './services/weatherApiService.js';
import { createNowcastApiService } from './services/nowcastApiService.js';
import { createKikikuruApiService } from './services/kikikuruApiService.js';
import { createStaticTileDeliveryProfileService } from './services/tileDeliveryProfileService.js';

export interface StartedServer {
  readonly port: number;
  readonly pollingService?: JmaXmlPollingService;
  readonly scheduler?: TimeBasedPollingScheduler;
  readonly fetchHealthMonitorService?: FetchHealthMonitorService;
  readonly fetchControlService?: FetchControlService;
  readonly imageServices?: {
    readonly nowcast: NowcastService;
    readonly kikikuru: KikikuruService;
  };
  close(options?: { readonly reason?: 'signal' | 'programmatic' }): Promise<void>;
}

export interface StartServerOptions {
  readonly weatherRequestObserver?: (request: WeatherRequest) => void;
  readonly config?: DatabasePairConfig;
  readonly port?: number;
  readonly enablePolling?: boolean;
  readonly pollingService?: JmaXmlPollingService;
  readonly pollingServiceOptions?: Partial<JmaXmlPollingServiceOptions>;
  readonly scheduler?: TimeBasedPollingScheduler;
  readonly schedulerOptions?: Partial<TimeBasedPollingSchedulerOptions>;
  readonly pollingSchedule?: PollingScheduleConfig;
  readonly configUrl?: URL;
  readonly venueConfigUrl?: URL;
  readonly terminalConfigUrl?: URL;
  readonly terminalLocalConfigUrl?: URL;
  readonly imageServices?: ImageServices;
  readonly nowcastCacheRoot?: string;
  readonly kikikuruCacheRoot?: string;
  /** Issue #43 §6.1: graceful shutdown の検証用。指定すると SIGTERM/SIGINT を購読する。 */
  readonly shutdownSignalSource?: SignalSource;
  readonly fetchControlNotificationIdFactory?: () => string;
  readonly recoveryInternals?: Parameters<typeof createStartupNotificationRuntime>[4];
}

const DEFAULT_PORT = 3001;

function validatePort(port: number): number {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RangeError('ポートは0以上65535以下の整数で指定してください。');
  }
  return port;
}

function hasWarningRecoveryTables(
  connection: ReturnType<typeof initializeDatabase>['connection'],
): boolean {
  const names = connection
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
      'telegram_reception', 'warning_current_stream', 'warning_current_snapshot'
    )`,
    )
    .all() as { name: string }[];
  return names.length === 3;
}

function hasTelegramReceptionTable(
  connection: ReturnType<typeof initializeDatabase>['connection'],
): boolean {
  return (
    connection
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'telegram_reception'")
      .get() !== undefined
  );
}

function reprocessVenueForecastBeforeWarningRecovery(
  connection: ReturnType<typeof initializeDatabase>['connection'],
  processedAt: UtcIso8601String,
  registry: VenueRegistry,
): void {
  if (hasTelegramReceptionTable(connection)) {
    reprocessPendingVenueForecastReceptions(connection, processedAt, registry);
  }
}

export function createStartupNotificationRuntime(
  connection: ReturnType<typeof initializeDatabase>['connection'],
  clock: () => string,
  registry: VenueRegistry,
  getFetchHealth: (() => ReturnType<FetchHealthMonitorService['getLastAggregate']>) | undefined,
  recoveryInternals:
    | {
        readonly setTimeout?: typeof setTimeout;
        readonly clearTimeout?: typeof clearTimeout;
        readonly recover?: typeof recoverWarningCurrent;
      }
    | undefined,
  terminalRegistry: TerminalRegistry,
  retainedConnection: ReturnType<typeof initializeDatabase>['connection'],
  weatherDatabaseGenerationId: string,
  observeRequest?: (request: WeatherRequest) => void,
) {
  const serverStartCursor = toNotificationDeltaCursor(
    findMaxNotificationOutputSequence(retainedConnection),
  );
  const serverGenerationId = crypto.randomUUID();
  const serverStartedAt = clock() as UtcIso8601String;
  const initialization = new StartupNotificationInitialization();
  const acquisitionEpoch = {
    serverGenerationId,
    workerGeneration: crypto.randomUUID(),
    weatherDatabaseGenerationId,
    readerEpoch: null,
  };
  const deliveryEpoch = {
    ...acquisitionEpoch,
    workerGeneration: crypto.randomUUID(),
    readerEpoch: crypto.randomUUID(),
  };
  const publication = new WeatherPublicationGate(acquisitionEpoch, deliveryEpoch);
  const decisions = createWeatherDecisionRuntime(retainedConnection, acquisitionEpoch, publication);
  const scopeFor = (venueIds: readonly VenueId[]) => ({
    scopes: venueIds,
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
        scopes: [venue.venueId],
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
  const synchronousStartup = createStartupNotificationService({
    weatherConnection: connection,
    retainedConnection,
    weatherDatabaseGenerationId,
    venueRegistry: registry,
    terminalRegistry,
    initialization,
    serverGenerationId,
    now: clock,
    getFetchHealth,
  });
  const startupReader = createInlineWeatherRead(deliveryEpoch, {
    'startup.project': (input) => ({
      ...connection.transaction(() =>
        projectStartupCurrentNotifications(connection, {
          venueRegistry: registry,
          venueId: input.venueId,
          now: input.inquiredAt,
          includeWarningCategory: true,
        }),
      )(),
      publicationToken: input.publicationToken,
      weatherDatabaseGenerationId,
    }),
  });
  const startupNotifications = {
    inquireWithSignal(
      input: Parameters<typeof synchronousStartup.inquire>[0],
      signal?: AbortSignal,
    ) {
      if (input.serverGenerationId !== serverGenerationId || !initialization.isReady(input.venueId))
        return synchronousStartup.inquire(input);
      return publication.publish(async (token) => {
        const cursor = findMaxNotificationOutputSequence(retainedConnection);
        const request = {
          protocolVersion: 1,
          requestId: crypto.randomUUID(),
          epoch: deliveryEpoch,
          deadlineAt: token.expiresAt,
          kind: 'startup.project',
          payload: {
            publicationToken: token,
            venueId: input.venueId,
            inquiredAt: input.inquiredAt,
          },
        } as const;
        observeRequest?.(request);
        const reply = await startupReader.request(request);
        publication.assertValid(token);
        if (reply.result.status !== 'completed') throw new Error('起動現況の投影に失敗しました');
        return synchronousStartup.inquire(input, { projection: reply.result.value, cursor });
      }, signal);
    },
  };
  const startupFacade = {
    ...startupNotifications,
    inquire: (input: Parameters<typeof synchronousStartup.inquire>[0]) =>
      startupNotifications.inquireWithSignal(input),
  };
  const notificationDelta = createNotificationDeltaService({
    connection: retainedConnection,
    serverStartCursor,
    initialization,
    venueRegistry: registry,
    serverGenerationId,
    now: clock,
  });
  const progressTracker = new InMemoryStartupProgressTracker(
    () => clock() as UtcIso8601String,
    registry,
  );
  const recoveryTracker = new InMemoryWarningCurrentRecoveryTracker(registry);
  const recoveryEmitter = new DatabaseRecoveryNotificationEmitter(retainedConnection);
  const initialSyncEmitter = new InitialSyncNotificationEmitter(retainedConnection);
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
  const setRecoveryTimeout = recoveryInternals?.setTimeout ?? setTimeout;
  const clearRecoveryTimeout = recoveryInternals?.clearTimeout ?? clearTimeout;
  const runRecovery = recoveryInternals?.recover ?? recoverWarningCurrent;
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
  return {
    acquisitionEpoch,
    deliveryEpoch,
    runWeatherUpdate,
    evaluateInitialWarning,
    decisions,
    publication,
    serverGenerationId,
    serverStartedAt,
    serverStartCursor,
    failPreparation,
    markStopped: () => {
      startupReader.registry.close();
      publication.replaceEpochs(
        { ...acquisitionEpoch, workerGeneration: crypto.randomUUID() },
        deliveryEpoch,
      );
      stopped = true;
    },
    initialization,
    startupNotifications: startupFacade,
    notificationDelta,
    warningEmitDeps,
    bosaiEmitDeps,
    progressTracker,
    recoveryTracker,
    recoverVenue,
    connectPolling,
    evaluateVenues,
  };
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

function waitForServerListening(server: Server): Promise<void> {
  if (server.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };

    server.once('listening', onListening);
    server.once('error', onError);
  });
}

function monitorServerErrors(server: Server): {
  readonly promise: Promise<never>;
  dispose(): void;
} {
  let rejectPromise: (error: Error) => void;
  const onError = (error: Error) => rejectPromise(error);
  const promise = new Promise<never>((_resolve, reject) => {
    rejectPromise = reject;
    server.once('error', onError);
  });

  return {
    promise,
    dispose() {
      server.off('error', onError);
    },
  };
}

function formatPollingConfigSource(source: URL): string {
  if (source.href === DEFAULT_CONFIG_URL.href) return 'config/polling.yaml';
  if (source.href === LOCAL_CONFIG_URL.href) return 'config/polling.local.yaml';
  return source.href;
}

function logPollingConfig(loaded: LoadedPollingScheduleConfig | null): void {
  if (loaded === null) {
    console.info('ポーリング設定: 読み込み元=設定オブジェクト; ローカル上書き=対象外（設定注入）');
    return;
  }
  const status = {
    applied: 'あり',
    absent: 'なし（ファイルなし）',
    'disabled-production': '無効（production）',
    'not-applicable': '対象外（明示URL）',
  }[loaded.localOverride];
  console.info(
    `ポーリング設定: 読み込み元=${loaded.sources.map(formatPollingConfigSource).join(', ')}; ローカル上書き=${status}`,
  );
}

export async function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  // Codexレビュー指摘#6（2回目レビュー）: registerGracefulShutdown() の呼び出しを
  // close の定義（＝初回XML取得を含む長い初期化のawait完了後）まで遅らせると、その間に
  // 届いたSIGTERM/SIGINTはリスナー未登録のままNodeの既定動作で即終了してしまい、
  // 停止処理・B5記録・停止通知が一切行われない。そこで、シグナル購読そのものは
  // 初期化より前に行い、実体（close）はまだ無い間は「シグナルを受け取った」ことだけを
  // 記録しておく。close が確定した時点（＝初期化完了時点）で、保留していたシグナルが
  // あれば直ちに close を呼ぶ。
  //
  // 「初期化完了を待ってから close を呼ぶ」を選んだ理由: 初期化処理（DB初期化・
  // スケジューラ生成・初回XML取得等）は多数のリソース確保を伴い、初期化を中断して
  // 即座にclose相当の処理を行う設計は、未確定なリソース（scheduler/pollingService等が
  // 部分的にしか代入されていない状態）の後始末を個別に作り込む必要があり複雑・高リスクに
  // なる。一方、初期化完了後にcloseを呼ぶ方式は、既存のcloseが前提とする
  // 「全リソースが揃っている」という不変条件を壊さずに済み、安全側に倒せる。
  // 初期化の完了を待つ分だけ停止が遅れるが、初期化自体の中断は本Issueの対象外
  // （異常終了検知はAD-H068で対象外と確定済み）であり、正常終了の記録が「初期化完了後」に
  // なることは許容する。
  const deferredCloseRef: {
    current:
      | ((closeOptions?: { readonly reason?: 'signal' | 'programmatic' }) => Promise<void>)
      | undefined;
  } = { current: undefined };
  let shutdownSignalPending = false;
  if (options.shutdownSignalSource) {
    registerGracefulShutdown(options.shutdownSignalSource, () => {
      if (deferredCloseRef.current) {
        return deferredCloseRef.current({ reason: 'signal' });
      }
      // close はまだ定義されていない（初期化中）。初期化完了後に呼び出すよう保留する。
      shutdownSignalPending = true;
      return Promise.resolve();
    });
  }

  // DB初期化・HTTP待受より前に設定を読み込み検証する（失敗時はDBや待受を起動しない）
  const venueConfig = loadVenueConfig({ baseUrl: options.venueConfigUrl });
  const terminalConfig = loadTerminalConfig({
    baseUrl: options.terminalConfigUrl,
    localUrl: options.terminalLocalConfigUrl,
    venueRegistry: venueConfig.registry,
    venueGeneration: venueConfig.response.generation,
  });
  const loaded = options.pollingSchedule
    ? null
    : loadPollingScheduleConfigWithSources(options.configUrl);
  const schedule = validatePollingScheduleConfig(options.pollingSchedule ?? loaded?.config);
  logPollingConfig(loaded);

  const port = validatePort(options.port ?? DEFAULT_PORT);
  const database = initializeDatabases(options.config);
  try {
    const clock = options.pollingServiceOptions?.clock ?? (() => new Date().toISOString());
    let fetchHealthMonitorService: FetchHealthMonitorService | undefined;
    const startupRuntime = createStartupNotificationRuntime(
      database.weather.connection,
      clock,
      venueConfig.registry,
      () => fetchHealthMonitorService?.getLastAggregate() ?? null,
      options.recoveryInternals,
      terminalConfig.registry,
      database.retained.connection,
      database.weatherDatabaseGenerationId,
      options.weatherRequestObserver,
    );
    let pollingService: JmaXmlPollingService | undefined;
    const weatherApi = createWeatherApiService({
      connection: database.weather.connection,
      venueRegistry: venueConfig.registry,
      getPollingStatus: () => pollingService?.getStatus(),
      now: clock,
    });
    const enablePolling = options.enablePolling ?? process.env.DISABLE_POLLING !== 'true';
    let imageServices: ImageServices | undefined;
    let scheduler: TimeBasedPollingScheduler | undefined;
    let nowFnHolder: () => Date = () => new Date();
    const tileDeliveryProfileService = createStaticTileDeliveryProfileService(
      schedule.tileDeliveryProfile,
    );

    const nowcastApi = createNowcastApiService({
      venueRegistry: venueConfig.registry,
      getService: () => imageServices?.nowcast ?? null,
      enablePolling,
      tileDeliveryProfileService,
      clock,
    });
    const kikikuruApi = createKikikuruApiService({
      venueRegistry: venueConfig.registry,
      getService: () => imageServices?.kikikuru ?? null,
      enablePolling,
      tileDeliveryProfileService,
      clock,
    });

    const fetchControlTargets: FetchControlTargets | null = enablePolling
      ? {
          start: () => {
            if (!scheduler) throw new Error('scheduler is not ready');
            return scheduler.start();
          },
          stop: () => {
            if (!scheduler) throw new Error('scheduler is not ready');
            return scheduler.stop();
          },
          forceRefresh: async () => {
            if (!scheduler) throw new Error('scheduler is not ready');
            const result = await scheduler.runManualOnce();
            if (result.failedSources.length > 0) {
              throw new ForceRefreshFailedError(result.failedSources);
            }
            if (result.abortedSources.length > 0) {
              throw new ForceRefreshAbortedError(result.abortedSources);
            }
          },
          runRecovery: () => {
            if (!scheduler) throw new Error('scheduler is not ready');
            return scheduler.runRecoveryOnce();
          },
          isRunning: () => (scheduler ? scheduler.isRunningNow() : false),
          isUpstreamAllowedNow: () =>
            resolvePollingPeriod(nowFnHolder(), schedule).xmlSeconds !== null,
        }
      : null;

    const fetchControlService = createFetchControlService({
      connection: database.retained.connection,
      targets: createAcquisitionControlTargets(
        fetchControlTargets,
        startupRuntime.acquisitionEpoch,
      ),
      now: () => clock() as UtcIso8601String,
      notificationIdFactory: options.fetchControlNotificationIdFactory,
    });

    const monitoringProcessing: MonitoringProcessingService = createMonitoringProcessingService({
      connection: database.weather.connection,
      venueRegistry: venueConfig.registry,
      serverGenerationId: startupRuntime.serverGenerationId,
      now: () => clock() as UtcIso8601String,
    });
    const monitoringStatus: MonitoringStatusService = createMonitoringStatusService({
      connection: database.weather.connection,
      venueRegistry: venueConfig.registry,
      terminalRegistry: terminalConfig.registry,
      // レビュー指摘 #2: DISABLE_POLLING=true 起動時・待受開始からサービス生成完了までの間は
      // scheduler/pollingService インスタンスが未生成。監視状態APIは停止・初期化中こそ状態を
      // 表示する用途（設計書 §4.1・§5.1）のため、例外を投げず「停止中」「not_started」を返す。
      scheduler: {
        getStatus: () =>
          scheduler?.getStatus() ?? buildStoppedPollingStatus(nowFnHolder(), schedule),
        isRunningNow: () => scheduler?.isRunningNow() ?? false,
      },
      xmlPollingService: {
        getStatus: () => ({
          initialFetch: pollingService?.getStatus().initialFetch ?? {
            phase: 'not_started',
            result: null,
          },
        }),
      },
      fetchHealthMonitor: {
        getLastAggregate: () => fetchHealthMonitorService?.getLastAggregate() ?? null,
      },
      startupInitialization: startupRuntime.initialization,
      progressTracker: startupRuntime.progressTracker,
      recoveryTracker: startupRuntime.recoveryTracker,
      weatherApi,
      nowcastApi,
      kikikuruApi,
      getTileUpstreamAccess: (layer) =>
        !enablePolling
          ? { allowed: false, reason: 'disabled', nextAllowedAt: null }
          : projectUpstreamAccess(resolveOnDemandAccess(layer, new Date(clock()), schedule), true),
      fetchHealthConfig: schedule.fetchHealth,
      serverGenerationId: startupRuntime.serverGenerationId,
      serverStartedAt: startupRuntime.serverStartedAt,
      now: () => clock() as UtcIso8601String,
    });

    const applicationRuntime = createApplicationRuntime({
      deliveryEpoch: startupRuntime.deliveryEpoch,
      acquisitionEpoch: startupRuntime.acquisitionEpoch,
      observeRequest: options.weatherRequestObserver,
      retainedConnection: database.retained.connection,
      weatherConnection: database.weather.connection,
      serverGenerationId: startupRuntime.serverGenerationId,
      weatherDatabaseGenerationId: database.weatherDatabaseGenerationId,
      venueConfig: venueConfig.response,
      venueRegistry: venueConfig.registry,
      terminalConfig: terminalConfig.response,
      terminalRegistry: terminalConfig.registry,
      startupNotifications: startupRuntime.startupNotifications,
      notificationDelta: startupRuntime.notificationDelta,
      weatherApi,
      nowcastApi,
      kikikuruApi,
      monitoringStatus,
      monitoringProcessing,
      fetchControl: fetchControlService,
    });
    let preparationStage: WeatherPreparationFailure['stage'] = 'service_setup';
    const app = createApp(applicationRuntime.dependencies);
    const actualServer = app.listen(port);

    const serverListeningPromise = waitForServerListening(actualServer);

    try {
      // 初期取得より先に待受失敗を監視する。失敗時は直ちに catch で全資源を解放する。
      await serverListeningPromise;

      const serverErrorMonitor = monitorServerErrors(actualServer);
      try {
        // Issue #171: main() は待受直後に listening ログを出力し初回同期をバックグラウンド化したが、
        // startServer() は初回同期の完了を待って resolve する契約を維持する。
        // 既存テストが「resolve 時点で初回取得・再処理が完了している」ことに依存しているため、
        // 意図的に main() と構造が異なる。
        await Promise.race([
          serverErrorMonitor.promise,
          (async () => {
            const defaultNow = options.pollingServiceOptions?.clock
              ? () => new Date(options.pollingServiceOptions!.clock!())
              : () => new Date();
            const nowFn = options.schedulerOptions?.now ?? defaultNow;
            nowFnHolder = nowFn;

            // 索引・画像共用サービスの作成（テスト等で注入がない場合）
            imageServices =
              options.imageServices ??
              createImageServices({
                nowcastCacheRoot: options.nowcastCacheRoot,
                kikikuruCacheRoot: options.kikikuruCacheRoot,
                connection: database.weather.connection,
                schedule,
                enablePolling,
                now: nowFn,
                fetchFn: options.pollingServiceOptions?.fetchFn,
              });

            preparationStage = 'reprocessing';
            if (enablePolling)
              recoverLegacyVphwBulletinAreas(database.weather.connection, venueConfig.registry);
            reprocessVenueForecastBeforeWarningRecovery(
              database.weather.connection,
              clock() as UtcIso8601String,
              venueConfig.registry,
            );
            for (const venueId of hasWarningRecoveryTables(database.weather.connection)
              ? venueConfig.registry.listVenueIds()
              : []) {
              const venue = resolveVenueWarningContext(venueConfig.registry, venueId);
              await startupRuntime.recoverVenue(venue, schedule.startupRecovery, async () => {
                if (enablePolling) {
                  await reprocessPendingWarningTelegramReceptions(
                    database.weather.connection,
                    venue,
                    clock,
                    startupRuntime.warningEmitDeps,
                    {
                      logger: console.log,
                      progressTracker: startupRuntime.progressTracker,
                      runWeatherUpdate: startupRuntime.runWeatherUpdate,
                    },
                  );
                }
              });
              await startupRuntime.evaluateInitialWarning(venue);
            }

            if (!enablePolling) {
              return;
            }

            preparationStage = 'service_setup';
            pollingService =
              options.pollingService ??
              new JmaXmlPollingService(database.weather.connection, {
                freshnessPolicy: schedule.freshness.xml,
                venueRegistry: venueConfig.registry,
                runWeatherUpdate: startupRuntime.runWeatherUpdate,
                warningNotificationEmitDeps: startupRuntime.warningEmitDeps,
                bosaiNotificationEmitDeps: startupRuntime.bosaiEmitDeps,
                ...options.pollingServiceOptions,
              });

            startupRuntime.connectPolling(pollingService);

            const adapters =
              options.schedulerOptions?.adapters ??
              createScheduledAdapters({
                connection: database.weather.connection,
                venueRegistry: venueConfig.registry,
                nowcastService: imageServices.nowcast,
                kikikuruService: imageServices.kikikuru,
                now: nowFn,
                amedasPointRecheckSeconds: schedule.amedasPointRecheckSeconds,
              });

            scheduler =
              options.scheduler ??
              new TimeBasedPollingScheduler({
                schedule,
                adapters,
                xmlPollingService: pollingService,
                now: nowFn,
                setTimer: options.schedulerOptions?.setTimer,
                clearTimer: options.schedulerOptions?.clearTimer,
              });

            fetchHealthMonitorService = new FetchHealthMonitorService({
              recordSink: startupRuntime.decisions.recordSink,
              store: startupRuntime.decisions.health,
              runDecision: (work) =>
                startupRuntime.decisions.runSync(
                  { scopes: [], initialWarningKeys: [], initialBosaiKeys: [] },
                  work,
                ),
              connection: database.weather.connection,
              statusProvider: scheduler,
              config: schedule.fetchHealth,
            });

            // 順序が重要(PRレビュー指摘 #141): scheduler.start() は isRunning=true を
            // 設定した直後、最初の await(XML初期取得)まで同期的に進む。await せず呼び出して
            // から fetchHealthMonitorService.start() を呼ぶことで、isRunning=true の状態で
            // 初回健全性評価が走る。先に await すると初回XML取得完了(実測17分超)まで健全性
            // 判定が始まらず(D7 AC12回帰)、逆に isRunning=false のまま初回評価すると
            // 全取得元が suspended と誤記録され、再起動時の検知が initial ではなくなる。
            const schedulerStartPromise = scheduler.start(); // XML開始責務は scheduler に集約し、二重起動を防止する
            fetchHealthMonitorService.start();
            await schedulerStartPromise;
          })().catch((error: unknown) => {
            if (shutdownSignalPending) return;
            // XML取得の失敗は既存recoveryが回復させるため恒久失敗へ固定しない。
            if (startupRuntime.initialization.getStatus().initialFetchPhase !== 'failed')
              startupRuntime.failPreparation(preparationStage);
            console.error('[api] 初回同期に失敗しました。監視とシステム通知を継続します:', error);
          }),
        ]);
      } finally {
        serverErrorMonitor.dispose();
      }
    } catch (error) {
      if (fetchHealthMonitorService) {
        fetchHealthMonitorService.stop();
      }
      if (scheduler) {
        await scheduler.stop();
      }
      if (imageServices) {
        await imageServices.close();
      }
      if (pollingService) {
        await pollingService.stop();
      }
      await closeServer(actualServer);
      database.close();
      throw error;
    }

    const address = actualServer.address();
    if (address === null || typeof address === 'string') {
      if (fetchHealthMonitorService) {
        fetchHealthMonitorService.stop();
      }
      if (scheduler) {
        await scheduler.stop();
      }
      if (imageServices) {
        await imageServices.close();
      }
      if (pollingService) {
        await pollingService.stop();
      }
      database.close();
      await closeServer(actualServer);
      throw new Error('HTTP server did not provide a TCP port.');
    }

    const closeResources = createRetryableDatabaseClose(
      async (closeOptions) => {
        applicationRuntime.close();
        startupRuntime.markStopped();
        if (fetchHealthMonitorService) {
          fetchHealthMonitorService.stop();
        }
        // scheduler.stop() は既定理由 'stop' で abort するため、シャットダウン理由はその前に伝える
        if (pollingService && closeOptions?.reason === 'signal') {
          await pollingService.stop('shutdown');
        }
        if (scheduler) {
          await scheduler.stop();
        }
        if (imageServices) {
          await imageServices.close();
        }
        if (pollingService) {
          await pollingService.stop();
        }
        // Issue #43 §6.1: シグナル由来の停止のときだけB5記録+サービス停止通知を行う。
        // 既存テストのDBに停止行が混ざるのを避けるため、programmatic な close では記録しない。
        if (closeOptions?.reason === 'signal') {
          try {
            await fetchControlService.recordShutdown();
          } catch (error) {
            console.error('graceful shutdown の記録に失敗しました:', error);
          }
        }
        await closeServer(actualServer);
      },
      () => database.close(),
    );
    const close = (closeOptions?: { readonly reason?: 'signal' | 'programmatic' }) => {
      return closeResources(closeOptions);
    };
    actualServer.once('error', (error) => {
      void close().catch((closeError: unknown) => {
        console.error('Failed to close API server after an error:', closeError);
      });
      console.error(error);
    });

    // Codexレビュー指摘#6（2回目レビュー）: シグナル購読自体は関数冒頭で既に行っている。
    // ここでは close の実体を確定させ、初期化中に届いていたシグナル（shutdownSignalPending）が
    // あれば直ちに反映する。
    deferredCloseRef.current = close;
    if (shutdownSignalPending) {
      void close({ reason: 'signal' }).catch((closeError: unknown) => {
        console.error('保留していたgraceful shutdownの処理に失敗しました:', closeError);
      });
    }

    return {
      port: address.port,
      pollingService,
      scheduler,
      fetchHealthMonitorService,
      fetchControlService,
      imageServices: imageServices
        ? {
            nowcast: imageServices.nowcast,
            kikikuru: imageServices.kikikuru,
          }
        : undefined,
      close,
    };
  } catch (error) {
    // 構成・待受開始の同期例外と既存cleanupの失敗でもDB/leaseを解放する。
    try {
      database.close();
    } catch (closeError) {
      console.error('起動失敗後のDBクローズに失敗しました:', closeError);
    }
    throw error;
  }
}

async function main(): Promise<void> {
  // Codexレビュー指摘#6（2回目レビュー）: startServer() と同様、実プロセスのエントリでも
  // シグナル購読を初期化より前に行い、close 確定前に届いたシグナルは保留して
  // 初期化完了後に反映する。
  const deferredCloseRef: {
    current:
      | ((closeOptions?: { readonly reason?: 'signal' | 'programmatic' }) => Promise<void>)
      | undefined;
  } = { current: undefined };
  let shutdownSignalPending = false;
  registerGracefulShutdown(process, () => {
    if (deferredCloseRef.current) {
      return deferredCloseRef.current({ reason: 'signal' });
    }
    shutdownSignalPending = true;
    return Promise.resolve();
  });

  // DB初期化・HTTP待受より前に設定を読み込み検証する
  const venueConfig = loadVenueConfig();
  const terminalConfig = loadTerminalConfig({
    venueRegistry: venueConfig.registry,
    venueGeneration: venueConfig.response.generation,
  });
  const loaded = loadPollingScheduleConfigWithSources();
  const schedule = loaded.config;
  logPollingConfig(loaded);

  const port = validatePort(process.env.PORT ? Number(process.env.PORT) : DEFAULT_PORT);
  const database = initializeDatabases();
  try {
    const clock = () => new Date().toISOString();
    let fetchHealthMonitorService: FetchHealthMonitorService | undefined;
    const startupRuntime = createStartupNotificationRuntime(
      database.weather.connection,
      clock,
      venueConfig.registry,
      () => fetchHealthMonitorService?.getLastAggregate() ?? null,
      undefined,
      terminalConfig.registry,
      database.retained.connection,
      database.weatherDatabaseGenerationId,
    );
    let pollingService: JmaXmlPollingService | undefined;
    const weatherApi = createWeatherApiService({
      connection: database.weather.connection,
      venueRegistry: venueConfig.registry,
      getPollingStatus: () => pollingService?.getStatus(),
      now: clock,
    });
    const enablePolling = process.env.DISABLE_POLLING !== 'true';
    let imageServices: ImageServices | undefined;
    let scheduler: TimeBasedPollingScheduler | undefined;
    const nowFnHolder: () => Date = () => new Date();
    const tileDeliveryProfileService = createStaticTileDeliveryProfileService(
      schedule.tileDeliveryProfile,
    );

    const nowcastApi = createNowcastApiService({
      venueRegistry: venueConfig.registry,
      getService: () => imageServices?.nowcast ?? null,
      enablePolling,
      tileDeliveryProfileService,
      clock,
    });
    const kikikuruApi = createKikikuruApiService({
      venueRegistry: venueConfig.registry,
      getService: () => imageServices?.kikikuru ?? null,
      enablePolling,
      tileDeliveryProfileService,
      clock,
    });

    const fetchControlTargets: FetchControlTargets | null = enablePolling
      ? {
          start: () => {
            if (!scheduler) throw new Error('scheduler is not ready');
            return scheduler.start();
          },
          stop: () => {
            if (!scheduler) throw new Error('scheduler is not ready');
            return scheduler.stop();
          },
          forceRefresh: async () => {
            if (!scheduler) throw new Error('scheduler is not ready');
            const result = await scheduler.runManualOnce();
            if (result.failedSources.length > 0) {
              throw new ForceRefreshFailedError(result.failedSources);
            }
            if (result.abortedSources.length > 0) {
              throw new ForceRefreshAbortedError(result.abortedSources);
            }
          },
          runRecovery: () => {
            if (!scheduler) throw new Error('scheduler is not ready');
            return scheduler.runRecoveryOnce();
          },
          isRunning: () => (scheduler ? scheduler.isRunningNow() : false),
          isUpstreamAllowedNow: () =>
            resolvePollingPeriod(nowFnHolder(), schedule).xmlSeconds !== null,
        }
      : null;

    const fetchControlService = createFetchControlService({
      connection: database.retained.connection,
      targets: createAcquisitionControlTargets(
        fetchControlTargets,
        startupRuntime.acquisitionEpoch,
      ),
      now: () => clock() as UtcIso8601String,
    });

    const monitoringProcessing: MonitoringProcessingService = createMonitoringProcessingService({
      connection: database.weather.connection,
      venueRegistry: venueConfig.registry,
      serverGenerationId: startupRuntime.serverGenerationId,
      now: () => clock() as UtcIso8601String,
    });
    const monitoringStatus: MonitoringStatusService = createMonitoringStatusService({
      connection: database.weather.connection,
      venueRegistry: venueConfig.registry,
      terminalRegistry: terminalConfig.registry,
      // レビュー指摘 #2: DISABLE_POLLING=true 起動時・待受開始からサービス生成完了までの間は
      // scheduler/pollingService インスタンスが未生成。監視状態APIは停止・初期化中こそ状態を
      // 表示する用途（設計書 §4.1・§5.1）のため、例外を投げず「停止中」「not_started」を返す。
      scheduler: {
        getStatus: () =>
          scheduler?.getStatus() ?? buildStoppedPollingStatus(nowFnHolder(), schedule),
        isRunningNow: () => scheduler?.isRunningNow() ?? false,
      },
      xmlPollingService: {
        getStatus: () => ({
          initialFetch: pollingService?.getStatus().initialFetch ?? {
            phase: 'not_started',
            result: null,
          },
        }),
      },
      fetchHealthMonitor: {
        getLastAggregate: () => fetchHealthMonitorService?.getLastAggregate() ?? null,
      },
      startupInitialization: startupRuntime.initialization,
      progressTracker: startupRuntime.progressTracker,
      recoveryTracker: startupRuntime.recoveryTracker,
      weatherApi,
      nowcastApi,
      kikikuruApi,
      getTileUpstreamAccess: (layer) =>
        process.env.DISABLE_POLLING === 'true'
          ? { allowed: false, reason: 'disabled', nextAllowedAt: null }
          : projectUpstreamAccess(resolveOnDemandAccess(layer, new Date(clock()), schedule), true),
      fetchHealthConfig: schedule.fetchHealth,
      serverGenerationId: startupRuntime.serverGenerationId,
      serverStartedAt: startupRuntime.serverStartedAt,
      now: () => clock() as UtcIso8601String,
    });

    const applicationRuntime = createApplicationRuntime({
      deliveryEpoch: startupRuntime.deliveryEpoch,
      acquisitionEpoch: startupRuntime.acquisitionEpoch,
      retainedConnection: database.retained.connection,
      weatherConnection: database.weather.connection,
      serverGenerationId: startupRuntime.serverGenerationId,
      weatherDatabaseGenerationId: database.weatherDatabaseGenerationId,
      venueConfig: venueConfig.response,
      venueRegistry: venueConfig.registry,
      terminalConfig: terminalConfig.response,
      terminalRegistry: terminalConfig.registry,
      startupNotifications: startupRuntime.startupNotifications,
      notificationDelta: startupRuntime.notificationDelta,
      weatherApi,
      nowcastApi,
      kikikuruApi,
      monitoringStatus,
      monitoringProcessing,
      fetchControl: fetchControlService,
    });
    const app = createApp(applicationRuntime.dependencies);
    const server = app.listen(port);

    let closed = false;
    const closeResources = createRetryableDatabaseClose(
      async (closeOptions) => {
        applicationRuntime.close();
        startupRuntime.markStopped();
        if (fetchHealthMonitorService) {
          fetchHealthMonitorService.stop();
        }
        if (pollingService && closeOptions?.reason === 'signal') {
          await pollingService.stop('shutdown');
        }
        if (scheduler) {
          await scheduler.stop();
        }
        if (imageServices) {
          await imageServices.close();
        }
        if (pollingService) {
          await pollingService.stop();
        }
        if (closeOptions?.reason === 'signal') {
          try {
            await fetchControlService.recordShutdown();
          } catch (error) {
            console.error('graceful shutdown の記録に失敗しました:', error);
          }
        }
        await closeServer(server);
      },
      () => database.close(),
    );
    const close = (closeOptions?: { readonly reason?: 'signal' | 'programmatic' }) => {
      closed = true;
      return closeResources(closeOptions);
    };

    let preparationStage: WeatherPreparationFailure['stage'] = 'service_setup';
    const runInitialSync = async (): Promise<void> => {
      const enablePolling = process.env.DISABLE_POLLING !== 'true';

      // 【必須】この行より前に await を置かないこと。
      // createImageServices は同期関数であり、ここまでは Promise 生成と同じターンで実行される。
      // これにより待受ログ出力時点で imageServices は必ず生成済みとなり、
      // 画像系API（/api/weather/nowcast|kikikuru/...）が 503 image_services_initializing を
      // 返す窓を作らない（既存テスト nowcastApi.test.ts の子プロセス起動テストがこれに依存する）。
      imageServices = createImageServices({
        connection: database.weather.connection,
        schedule,
        enablePolling,
      });

      preparationStage = 'reprocessing';
      if (enablePolling)
        recoverLegacyVphwBulletinAreas(database.weather.connection, venueConfig.registry);
      reprocessVenueForecastBeforeWarningRecovery(
        database.weather.connection,
        clock() as UtcIso8601String,
        venueConfig.registry,
      );
      for (const venueId of hasWarningRecoveryTables(database.weather.connection)
        ? venueConfig.registry.listVenueIds()
        : []) {
        if (closed) {
          return;
        }
        const venue = resolveVenueWarningContext(venueConfig.registry, venueId);
        await startupRuntime.recoverVenue(venue, schedule.startupRecovery, async () => {
          if (enablePolling) {
            await reprocessPendingWarningTelegramReceptions(
              database.weather.connection,
              venue,
              clock,
              startupRuntime.warningEmitDeps,
              {
                logger: console.log,
                progressTracker: startupRuntime.progressTracker,
                runWeatherUpdate: startupRuntime.runWeatherUpdate,
              },
            );
          }
          if (closed) {
            throw new Error('DB復旧中にサーバー停止が要求されました');
          }
        });
        await startupRuntime.evaluateInitialWarning(venue);
      }

      if (!enablePolling) {
        return;
      }

      if (closed) {
        return;
      }
      preparationStage = 'service_setup';
      pollingService = new JmaXmlPollingService(database.weather.connection, {
        freshnessPolicy: schedule.freshness.xml,
        venueRegistry: venueConfig.registry,
        runWeatherUpdate: startupRuntime.runWeatherUpdate,
        warningNotificationEmitDeps: startupRuntime.warningEmitDeps,
        bosaiNotificationEmitDeps: startupRuntime.bosaiEmitDeps,
      });

      startupRuntime.connectPolling(pollingService);

      const adapters = createScheduledAdapters({
        connection: database.weather.connection,
        venueRegistry: venueConfig.registry,
        nowcastService: imageServices.nowcast,
        kikikuruService: imageServices.kikikuru,
        amedasPointRecheckSeconds: schedule.amedasPointRecheckSeconds,
      });

      scheduler = new TimeBasedPollingScheduler({
        schedule,
        adapters,
        xmlPollingService: pollingService,
      });

      fetchHealthMonitorService = new FetchHealthMonitorService({
        recordSink: startupRuntime.decisions.recordSink,
        store: startupRuntime.decisions.health,
        runDecision: (work) =>
          startupRuntime.decisions.runSync(
            { scopes: [], initialWarningKeys: [], initialBosaiKeys: [] },
            work,
          ),
        connection: database.weather.connection,
        statusProvider: scheduler,
        config: schedule.fetchHealth,
      });

      if (closed) {
        return;
      }
      // 順序が重要(PRレビュー指摘 #141): scheduler.start() は isRunning=true を
      // 設定した直後、最初の await(XML初期取得)まで同期的に進む。await せず呼び出して
      // から fetchHealthMonitorService.start() を呼ぶことで、isRunning=true の状態で
      // 初回健全性評価が走る。先に await すると初回XML取得完了(実測17分超)まで健全性
      // 判定が始まらず(D7 AC12回帰)、逆に isRunning=false のまま初回評価すると
      // 全取得元が suspended と誤記録され、再起動時の検知が initial ではなくなる。
      const schedulerStartPromise = scheduler.start();
      fetchHealthMonitorService.start();
      await schedulerStartPromise;
    };

    const watchInitialSync = async (
      initializationPromise: Promise<void>,
      serverErrorMonitor: { readonly promise: Promise<never>; dispose(): void },
    ): Promise<void> => {
      const startedMs = Date.now();
      let initializationError: unknown;
      let initializationFailed = false;
      // race で負けた側の rejection が未処理にならないよう、ここで必ず消費する。
      const settled = initializationPromise.catch((error: unknown) => {
        initializationFailed = true;
        initializationError = error;
      });

      try {
        await Promise.race([serverErrorMonitor.promise, settled]);
        if (initializationFailed) {
          if (!closed) {
            if (startupRuntime.initialization.getStatus().initialFetchPhase !== 'failed')
              startupRuntime.failPreparation(preparationStage);
            console.error(
              '[api] 初回同期に失敗しました。監視とシステム通知を継続します:',
              initializationError,
            );
          }
          return;
        }
        if (!closed) {
          console.log(`[api] initial sync completed (${Date.now() - startedMs}ms)`);
        }
      } catch (error) {
        // HTTP server error は同期失敗と分けて終了させる。
        // 既に close 済み（シグナル停止）なら異常終了扱いにしない。
        if (closed) {
          console.error('初期化中に停止したため初回同期を中断しました:', error);
          return;
        }
        console.error(error);
        try {
          await close();
        } catch (closeError) {
          console.error('初期化失敗後のクローズに失敗しました:', closeError);
        }
        process.exitCode = 1;
      } finally {
        serverErrorMonitor.dispose();
        // 既存と同じ順序（dispose の後に長期監視ハンドラを登録）を保つ。
        if (!closed) {
          server.once('error', (error) => {
            void close().finally(() => {
              console.error(error);
              process.exitCode = 1;
            });
          });
        }
      }
    };

    try {
      await waitForServerListening(server);
    } catch (error) {
      await close();
      throw error;
    }

    const serverErrorMonitor = monitorServerErrors(server);

    // (A) 初回同期をバックグラウンドで起動する。
    //     本体先頭の createImageServices() は同期関数なので、この行の完了時点で
    //     imageServices は代入済み（§4.2）。
    const initializationPromise = runInitialSync();

    // (B) 待受ログ（確定事項(2)）
    console.log(
      `[api] database: ${database.weather.connection.name}, applied migrations: ${database.weather.migrationSummary.appliedVersions.length + database.retained.migrationSummary.appliedVersions.length}`,
    );
    console.log(`[api] listening on http://localhost:${port} (initial sync in progress)`);

    // (C) close を確定させ、保留中シグナルを反映（§4.4）
    deferredCloseRef.current = close;
    if (shutdownSignalPending) {
      void close({ reason: 'signal' }).catch((closeError: unknown) => {
        console.error('保留していたgraceful shutdownの処理に失敗しました:', closeError);
      });
    }

    // (D) 初回同期の完了・失敗と server error の監視（§4.3）
    void watchInitialSync(initializationPromise, serverErrorMonitor);
  } catch (error) {
    try {
      database.close();
    } catch (closeError) {
      console.error('起動失敗後のDBクローズに失敗しました:', closeError);
    }
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
