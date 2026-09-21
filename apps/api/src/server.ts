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
  ForceRefreshAbortedError,
  ForceRefreshFailedError,
  type FetchControlService,
  type FetchControlTargets,
} from './services/fetchControlService.js';
import { registerGracefulShutdown, type SignalSource } from './gracefulShutdown.js';
import { InMemoryStartupProgressTracker } from './monitoring/startupProgressTracker.js';
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
  const serverStartedAt = clock() as UtcIso8601String;
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
  const progressTracker = new InMemoryStartupProgressTracker(() => clock() as UtcIso8601String);
  const evaluateVenues = async () => {
    recoverLegacyVphwBulletinAreas(connection);
    for (const venueId of VENUE_IDS) {
      const venue = resolveVenueWarningContext(venueId);
      await reprocessPendingWarningTelegramReceptions(connection, venue, clock, warningEmitDeps, {
        logger: console.log,
        progressTracker,
      });
      rebuildWarningCurrentFromReceptions(connection, venue.targetArea);
      emitInitialWarningNotifications(connection, venue.targetArea, warningEmitDeps);
      emitInitialBosaiBulletinNotifications(connection, venueId, bosaiEmitDeps);
      initialization.markVenueEvaluated(venueId);
    }
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
        }
      }
    });
    pollingService.onInitialFetchCompleted(evaluateVenues);
  };
  return {
    serverGenerationId,
    serverStartedAt,
    initialization,
    startupNotifications,
    notificationDelta,
    warningEmitDeps,
    bosaiEmitDeps,
    progressTracker,
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
    progressTracker: startupRuntime.progressTracker,
    weatherApi,
    nowcastApi,
    kikikuruApi,
    fetchHealthConfig: schedule.fetchHealth,
    serverGenerationId: startupRuntime.serverGenerationId,
    serverStartedAt: startupRuntime.serverStartedAt,
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
              { logger: console.log, progressTracker: startupRuntime.progressTracker },
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
      database.close();
    }
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
    progressTracker: startupRuntime.progressTracker,
    weatherApi,
    nowcastApi,
    kikikuruApi,
    fetchHealthConfig: schedule.fetchHealth,
    serverGenerationId: startupRuntime.serverGenerationId,
    serverStartedAt: startupRuntime.serverStartedAt,
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
    database.close();
  };

  const runInitialSync = async (): Promise<void> => {
    const enablePolling = process.env.DISABLE_POLLING !== 'true';

    // 【必須】この行より前に await を置かないこと。
    // createImageServices は同期関数であり、ここまでは Promise 生成と同じターンで実行される。
    // これにより待受ログ出力時点で imageServices は必ず生成済みとなり、
    // 画像系API（/api/weather/nowcast|kikikuru/...）が 503 image_services_initializing を
    // 返す窓を作らない（既存テスト nowcastApi.test.ts の子プロセス起動テストがこれに依存する）。
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
      if (closed) {
        return;
      }
      const venue = resolveVenueWarningContext(venueId);
      await reprocessPendingWarningTelegramReceptions(
        database.connection,
        venue,
        clock,
        startupRuntime.warningEmitDeps,
        { logger: console.log, progressTracker: startupRuntime.progressTracker },
      );
      if (closed) {
        return;
      }
      rebuildWarningCurrentFromReceptions(database.connection, venue.targetArea);
      emitInitialWarningNotifications(
        database.connection,
        venue.targetArea,
        startupRuntime.warningEmitDeps,
      );
    }

    if (closed) {
      return;
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
        throw initializationError;
      }
      if (!closed) {
        console.log(`[api] initial sync completed (${Date.now() - startedMs}ms)`);
      }
    } catch (error) {
      // 確定事項(1): 初期化失敗・server error のいずれでも close して異常終了させる。
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
    `[api] database: ${database.connection.name}, applied migrations: ${database.migrationSummary.appliedVersions.length}`,
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
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
