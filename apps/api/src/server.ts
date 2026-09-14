import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import crypto from 'node:crypto';

import { VENUE_IDS, type UtcIso8601String } from '@wx-viewer-poc/shared';
import { createApp } from './app.js';
import { initializeDatabase, type DatabaseConfig } from './database/index.js';
import {
  loadPollingScheduleConfig,
  resolvePollingPeriod,
  validatePollingScheduleConfig,
  type PollingScheduleConfig,
} from './config/index.js';
import {
  createFetchControlService,
  ForceRefreshFailedError,
  type FetchControlService,
  type FetchControlTargets,
} from './services/fetchControlService.js';
import { registerGracefulShutdown, type SignalSource } from './gracefulShutdown.js';
import {
  createMonitoringStatusService,
  type MonitoringStatusService,
} from './monitoring/monitoringStatusService.js';
import {
  createMonitoringProcessingService,
  type MonitoringProcessingService,
} from './monitoring/monitoringProcessingService.js';
import {
  createMonitoringHistoryService,
  type MonitoringHistoryService,
} from './monitoring/monitoringHistoryService.js';
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
import { rebuildWarningCurrentFromReceptions } from './polling/jmaWarningCurrentProcessor.js';
import { reprocessPendingWarningTelegramReceptions } from './polling/jmaWarningTelegramProcessor.js';
import { recoverLegacyVphwBulletinAreas } from './polling/jmaVphwProcessor.js';
import { resolveVenueWarningContext } from './venueForecastTargets.js';
import {
  InitialWarningNotificationTracker,
  InitialBosaiNotificationTracker,
  createStartupNotificationService,
  createNotificationDeltaService,
  StartupNotificationInitialization,
  emitInitialWarningNotifications,
  emitInitialBosaiBulletinNotifications,
  type WarningNotificationEmitDeps,
  type BosaiNotificationEmitDeps,
} from './notifications/index.js';
import { FetchHealthMonitorService } from './monitoring/index.js';
import { createWeatherApiService } from './services/weatherApiService.js';
import { createNowcastApiService } from './services/nowcastApiService.js';
import { createKikikuruApiService } from './services/kikikuruApiService.js';

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
  readonly config?: DatabaseConfig;
  readonly port?: number;
  readonly enablePolling?: boolean;
  readonly pollingService?: JmaXmlPollingService;
  readonly pollingServiceOptions?: Partial<JmaXmlPollingServiceOptions>;
  readonly scheduler?: TimeBasedPollingScheduler;
  readonly schedulerOptions?: Partial<TimeBasedPollingSchedulerOptions>;
  readonly pollingSchedule?: PollingScheduleConfig;
  readonly configUrl?: URL;
  readonly imageServices?: ImageServices;
  /** Issue #43 §6.1: graceful shutdown の検証用。指定すると SIGTERM/SIGINT を購読する。 */
  readonly shutdownSignalSource?: SignalSource;
  readonly fetchControlNotificationIdFactory?: () => string;
}

const DEFAULT_PORT = 3001;

function createStartupNotificationRuntime(
  connection: ReturnType<typeof initializeDatabase>['connection'],
  clock: () => string,
  getFetchHealth?: () => ReturnType<FetchHealthMonitorService['getLastAggregate']>,
) {
  const serverGenerationId = crypto.randomUUID();
  const initialization = new StartupNotificationInitialization();
  const warningEmitDeps: WarningNotificationEmitDeps = {
    tracker: new InitialWarningNotificationTracker(),
    now: clock,
  };
  const bosaiEmitDeps: BosaiNotificationEmitDeps = {
    initialState: new InitialBosaiNotificationTracker(),
    now: clock,
  };
  const startupNotifications = createStartupNotificationService({
    connection,
    initialization,
    serverGenerationId,
    now: clock,
    getFetchHealth,
  });
  const notificationDelta = createNotificationDeltaService({
    connection,
    serverGenerationId,
    now: clock,
  });
  const evaluateVenues = async () => {
    recoverLegacyVphwBulletinAreas(connection);
    for (const venueId of VENUE_IDS) {
      const venue = resolveVenueWarningContext(venueId);
      await reprocessPendingWarningTelegramReceptions(connection, venue, clock, warningEmitDeps);
      rebuildWarningCurrentFromReceptions(connection, venue.targetArea);
      emitInitialWarningNotifications(connection, venue.targetArea, warningEmitDeps);
      emitInitialBosaiBulletinNotifications(connection, venueId, bosaiEmitDeps);
      initialization.markVenueEvaluated(venueId);
    }
  };
  const connectPolling = (pollingService: JmaXmlPollingService) => {
    pollingService.onInitialFetchPhaseChange((phase) => {
      initialization.setInitialFetchPhase(phase);
    });
    pollingService.onInitialFetchCompleted(evaluateVenues);
  };
  return {
    serverGenerationId,
    initialization,
    startupNotifications,
    notificationDelta,
    warningEmitDeps,
    bosaiEmitDeps,
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

export async function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  // DB初期化・HTTP待受より前に設定を読み込み検証する（失敗時はDBや待受を起動しない）
  const schedule = validatePollingScheduleConfig(
    options.pollingSchedule ?? loadPollingScheduleConfig(options.configUrl),
  );

  const database = initializeDatabase(options.config);
  const clock = options.pollingServiceOptions?.clock ?? (() => new Date().toISOString());
  let fetchHealthMonitorService: FetchHealthMonitorService | undefined;
  const startupRuntime = createStartupNotificationRuntime(
    database.connection,
    clock,
    () => fetchHealthMonitorService?.getLastAggregate() ?? null,
  );
  let pollingService: JmaXmlPollingService | undefined;
  const weatherApi = createWeatherApiService({
    connection: database.connection,
    getPollingStatus: () => pollingService?.getStatus(),
    now: clock,
  });
  const enablePolling = options.enablePolling ?? process.env.DISABLE_POLLING !== 'true';
  let imageServices: ImageServices | undefined;
  let scheduler: TimeBasedPollingScheduler | undefined;
  let nowFnHolder: () => Date = () => new Date();

  const nowcastApi = createNowcastApiService({
    getService: () => imageServices?.nowcast ?? null,
    enablePolling,
    clock,
  });
  const kikikuruApi = createKikikuruApiService({
    getService: () => imageServices?.kikikuru ?? null,
    enablePolling,
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
    connection: database.connection,
    targets: fetchControlTargets,
    now: () => clock() as UtcIso8601String,
    notificationIdFactory: options.fetchControlNotificationIdFactory,
  });

  const monitoringHistory: MonitoringHistoryService = createMonitoringHistoryService({
    connection: database.connection,
    now: () => clock() as UtcIso8601String,
  });
  const monitoringProcessing: MonitoringProcessingService = createMonitoringProcessingService({
    connection: database.connection,
    serverGenerationId: startupRuntime.serverGenerationId,
    now: () => clock() as UtcIso8601String,
  });
  const monitoringStatus: MonitoringStatusService = createMonitoringStatusService({
    connection: database.connection,
    // レビュー指摘 #2: DISABLE_POLLING=true 起動時・待受開始からサービス生成完了までの間は
    // scheduler/pollingService インスタンスが未生成。監視状態APIは停止・初期化中こそ状態を
    // 表示する用途（設計書 §4.1・§5.1）のため、例外を投げず「停止中」「not_started」を返す。
    scheduler: {
      getStatus: () => scheduler?.getStatus() ?? buildStoppedPollingStatus(nowFnHolder(), schedule),
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
    weatherApi,
    nowcastApi,
    kikikuruApi,
    fetchHealthConfig: schedule.fetchHealth,
    serverGenerationId: startupRuntime.serverGenerationId,
    now: () => clock() as UtcIso8601String,
  });

  const app = createApp({
    startupNotifications: startupRuntime.startupNotifications,
    notificationDelta: startupRuntime.notificationDelta,
    weatherApi,
    nowcastApi,
    kikikuruApi,
    monitoringStatus,
    monitoringProcessing,
    monitoringHistory,
    fetchControl: fetchControlService,
  });
  const actualServer = app.listen(options.port ?? DEFAULT_PORT);

  const serverListeningPromise = waitForServerListening(actualServer);

  try {
    // 初期取得より先に待受失敗を監視する。失敗時は直ちに catch で全資源を解放する。
    await serverListeningPromise;

    const serverErrorMonitor = monitorServerErrors(actualServer);
    try {
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
              connection: database.connection,
              schedule,
              enablePolling,
              now: nowFn,
              fetchFn: options.pollingServiceOptions?.fetchFn,
            });

          if (!enablePolling) {
            return;
          }

          recoverLegacyVphwBulletinAreas(database.connection);
          for (const venueId of VENUE_IDS) {
            const venue = resolveVenueWarningContext(venueId);
            await reprocessPendingWarningTelegramReceptions(
              database.connection,
              venue,
              clock,
              startupRuntime.warningEmitDeps,
            );
            rebuildWarningCurrentFromReceptions(database.connection, venue.targetArea);
            emitInitialWarningNotifications(
              database.connection,
              venue.targetArea,
              startupRuntime.warningEmitDeps,
            );
          }

          pollingService =
            options.pollingService ??
            new JmaXmlPollingService(database.connection, {
              freshnessPolicy: schedule.freshness.xml,
              warningNotificationEmitDeps: startupRuntime.warningEmitDeps,
              bosaiNotificationEmitDeps: startupRuntime.bosaiEmitDeps,
              ...options.pollingServiceOptions,
            });

          startupRuntime.connectPolling(pollingService);

          const adapters =
            options.schedulerOptions?.adapters ??
            createScheduledAdapters({
              connection: database.connection,
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
            connection: database.connection,
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
        })(),
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

  let closed = false;
  const close = async (closeOptions?: { readonly reason?: 'signal' | 'programmatic' }) => {
    if (!closed) {
      closed = true;
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
      database.close();
    }
  };
  actualServer.once('error', (error) => {
    void close().catch((closeError: unknown) => {
      console.error('Failed to close API server after an error:', closeError);
    });
    console.error(error);
  });

  // レビュー指摘 #6: close は上の const 定義まで初期化されない。close 定義前に登録すると、
  // 初期取得中(実測17分超かかりうる await の間)にシグナルが届いた場合、TDZ により
  // ReferenceError で失敗する。close 定義後に登録することで安全にする。
  if (options.shutdownSignalSource) {
    registerGracefulShutdown(options.shutdownSignalSource, () => close({ reason: 'signal' }));
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
}

async function main(): Promise<void> {
  // DB初期化・HTTP待受より前に設定を読み込み検証する
  const schedule = loadPollingScheduleConfig();

  const port = process.env.PORT ? Number(process.env.PORT) : DEFAULT_PORT;
  const database = initializeDatabase();
  const clock = () => new Date().toISOString();
  let fetchHealthMonitorService: FetchHealthMonitorService | undefined;
  const startupRuntime = createStartupNotificationRuntime(
    database.connection,
    clock,
    () => fetchHealthMonitorService?.getLastAggregate() ?? null,
  );
  let pollingService: JmaXmlPollingService | undefined;
  const weatherApi = createWeatherApiService({
    connection: database.connection,
    getPollingStatus: () => pollingService?.getStatus(),
    now: clock,
  });
  const enablePolling = process.env.DISABLE_POLLING !== 'true';
  let imageServices: ImageServices | undefined;
  let scheduler: TimeBasedPollingScheduler | undefined;
  const nowFnHolder: () => Date = () => new Date();

  const nowcastApi = createNowcastApiService({
    getService: () => imageServices?.nowcast ?? null,
    enablePolling,
    clock,
  });
  const kikikuruApi = createKikikuruApiService({
    getService: () => imageServices?.kikikuru ?? null,
    enablePolling,
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
    connection: database.connection,
    targets: fetchControlTargets,
    now: () => clock() as UtcIso8601String,
  });

  const monitoringHistory: MonitoringHistoryService = createMonitoringHistoryService({
    connection: database.connection,
    now: () => clock() as UtcIso8601String,
  });
  const monitoringProcessing: MonitoringProcessingService = createMonitoringProcessingService({
    connection: database.connection,
    serverGenerationId: startupRuntime.serverGenerationId,
    now: () => clock() as UtcIso8601String,
  });
  const monitoringStatus: MonitoringStatusService = createMonitoringStatusService({
    connection: database.connection,
    // レビュー指摘 #2: DISABLE_POLLING=true 起動時・待受開始からサービス生成完了までの間は
    // scheduler/pollingService インスタンスが未生成。監視状態APIは停止・初期化中こそ状態を
    // 表示する用途（設計書 §4.1・§5.1）のため、例外を投げず「停止中」「not_started」を返す。
    scheduler: {
      getStatus: () => scheduler?.getStatus() ?? buildStoppedPollingStatus(nowFnHolder(), schedule),
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
    weatherApi,
    nowcastApi,
    kikikuruApi,
    fetchHealthConfig: schedule.fetchHealth,
    serverGenerationId: startupRuntime.serverGenerationId,
    now: () => clock() as UtcIso8601String,
  });

  const app = createApp({
    startupNotifications: startupRuntime.startupNotifications,
    notificationDelta: startupRuntime.notificationDelta,
    weatherApi,
    nowcastApi,
    kikikuruApi,
    monitoringStatus,
    monitoringProcessing,
    monitoringHistory,
    fetchControl: fetchControlService,
  });
  const server = app.listen(port);

  let closed = false;
  const close = async (closeOptions?: { readonly reason?: 'signal' | 'programmatic' }) => {
    if (closed) {
      return;
    }
    closed = true;
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
    if (closeOptions?.reason === 'signal') {
      try {
        await fetchControlService.recordShutdown();
      } catch (error) {
        console.error('graceful shutdown の記録に失敗しました:', error);
      }
    }
    await closeServer(server);
    database.close();
  };

  try {
    await waitForServerListening(server);

    const serverErrorMonitor = monitorServerErrors(server);
    try {
      await Promise.race([
        serverErrorMonitor.promise,
        (async () => {
          const enablePolling = process.env.DISABLE_POLLING !== 'true';

          imageServices = createImageServices({
            connection: database.connection,
            schedule,
            enablePolling,
          });

          if (!enablePolling) {
            return;
          }

          recoverLegacyVphwBulletinAreas(database.connection);
          for (const venueId of VENUE_IDS) {
            const venue = resolveVenueWarningContext(venueId);
            await reprocessPendingWarningTelegramReceptions(
              database.connection,
              venue,
              clock,
              startupRuntime.warningEmitDeps,
            );
            rebuildWarningCurrentFromReceptions(database.connection, venue.targetArea);
            emitInitialWarningNotifications(
              database.connection,
              venue.targetArea,
              startupRuntime.warningEmitDeps,
            );
          }

          pollingService = new JmaXmlPollingService(database.connection, {
            freshnessPolicy: schedule.freshness.xml,
            warningNotificationEmitDeps: startupRuntime.warningEmitDeps,
            bosaiNotificationEmitDeps: startupRuntime.bosaiEmitDeps,
          });

          startupRuntime.connectPolling(pollingService);

          const adapters = createScheduledAdapters({
            connection: database.connection,
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
            connection: database.connection,
            statusProvider: scheduler,
            config: schedule.fetchHealth,
          });

          // 順序が重要(PRレビュー指摘 #141): scheduler.start() は isRunning=true を
          // 設定した直後、最初の await(XML初期取得)まで同期的に進む。await せず呼び出して
          // から fetchHealthMonitorService.start() を呼ぶことで、isRunning=true の状態で
          // 初回健全性評価が走る。先に await すると初回XML取得完了(実測17分超)まで健全性
          // 判定が始まらず(D7 AC12回帰)、逆に isRunning=false のまま初回評価すると
          // 全取得元が suspended と誤記録され、再起動時の検知が initial ではなくなる。
          const schedulerStartPromise = scheduler.start();
          fetchHealthMonitorService.start();
          await schedulerStartPromise;
        })(),
      ]);
    } finally {
      serverErrorMonitor.dispose();
    }

    console.log(
      `[api] database: ${database.connection.name}, applied migrations: ${database.migrationSummary.appliedVersions.length}`,
    );
    console.log(`[api] listening on http://localhost:${port}`);
  } catch (error) {
    await close();
    throw error;
  }

  server.once('error', (error) => {
    void close().finally(() => {
      console.error(error);
      process.exitCode = 1;
    });
  });
  registerGracefulShutdown(process, () => close({ reason: 'signal' }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
