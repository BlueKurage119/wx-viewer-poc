import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';

import { createApp } from './app.js';
import { initializeDatabase, type DatabaseConfig } from './database/index.js';
import {
  loadPollingScheduleConfig,
  validatePollingScheduleConfig,
  type PollingScheduleConfig,
} from './config/index.js';
import {
  JmaXmlPollingService,
  TimeBasedPollingScheduler,
  createScheduledAdapters,
  createImageServices,
  type ImageServices,
  type JmaXmlPollingServiceOptions,
  type TimeBasedPollingSchedulerOptions,
  type NowcastService,
  type KikikuruService,
} from './polling/index.js';
import {
  DEFAULT_WARNING_CURRENT_TARGET_AREA,
  rebuildWarningCurrentFromReceptions,
} from './polling/jmaWarningCurrentProcessor.js';
import {
  DEFAULT_WARNING_TARGET_AREA,
  reprocessPendingWarningTelegramReceptions,
} from './polling/jmaWarningTelegramProcessor.js';
import type { WarningCurrentTargetArea } from './repositories/types.js';

export interface StartedServer {
  readonly port: number;
  readonly pollingService?: JmaXmlPollingService;
  readonly scheduler?: TimeBasedPollingScheduler;
  readonly imageServices?: {
    readonly nowcast: NowcastService;
    readonly kikikuru: KikikuruService;
  };
  close(): Promise<void>;
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
}

const DEFAULT_PORT = 3001;

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
  const app = createApp();
  const actualServer = app.listen(options.port ?? DEFAULT_PORT);

  const serverListeningPromise = waitForServerListening(actualServer);

  const enablePolling = options.enablePolling ?? process.env.DISABLE_POLLING !== 'true';
  let pollingService: JmaXmlPollingService | undefined;
  let scheduler: TimeBasedPollingScheduler | undefined;
  let imageServices: ImageServices | undefined;

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

          const rawTargetArea =
            options.pollingServiceOptions?.warningTargetArea ?? DEFAULT_WARNING_TARGET_AREA;
          const currentTargetArea: WarningCurrentTargetArea =
            'prefectureCode' in rawTargetArea && typeof rawTargetArea.prefectureCode === 'string'
              ? (rawTargetArea as WarningCurrentTargetArea)
              : {
                  ...rawTargetArea,
                  prefectureCode: DEFAULT_WARNING_CURRENT_TARGET_AREA.prefectureCode,
                };

          await reprocessPendingWarningTelegramReceptions(
            database.connection,
            currentTargetArea,
            options.pollingServiceOptions?.clock ?? (() => new Date().toISOString()),
          );
          rebuildWarningCurrentFromReceptions(database.connection, currentTargetArea);

          pollingService =
            options.pollingService ??
            new JmaXmlPollingService(database.connection, {
              freshnessPolicy: schedule.freshness.xml,
              ...options.pollingServiceOptions,
            });

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

          // XML開始責務は scheduler に集約し、二重起動を防止する
          await scheduler.start();
        })(),
      ]);
    } finally {
      serverErrorMonitor.dispose();
    }
  } catch (error) {
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
  const close = async () => {
    if (!closed) {
      closed = true;
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
    }
  };
  actualServer.once('error', (error) => {
    void close().catch((closeError: unknown) => {
      console.error('Failed to close API server after an error:', closeError);
    });
    console.error(error);
  });

  return {
    port: address.port,
    pollingService,
    scheduler,
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
  const app = createApp();
  const server = app.listen(port);
  let pollingService: JmaXmlPollingService | undefined;
  let scheduler: TimeBasedPollingScheduler | undefined;
  let imageServices: ImageServices | undefined;

  let closed = false;
  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    if (scheduler) {
      await scheduler.stop();
    }
    if (imageServices) {
      await imageServices.close();
    }
    if (pollingService) {
      await pollingService.stop();
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

          await reprocessPendingWarningTelegramReceptions(
            database.connection,
            DEFAULT_WARNING_CURRENT_TARGET_AREA,
            () => new Date().toISOString(),
          );
          rebuildWarningCurrentFromReceptions(
            database.connection,
            DEFAULT_WARNING_CURRENT_TARGET_AREA,
          );

          pollingService = new JmaXmlPollingService(database.connection, {
            freshnessPolicy: schedule.freshness.xml,
          });

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

          await scheduler.start();
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
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
