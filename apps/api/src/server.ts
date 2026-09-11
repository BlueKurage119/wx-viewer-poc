import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';

import { createApp } from './app.js';
import { initializeDatabase, type DatabaseConfig } from './database/index.js';
import { JmaXmlPollingService, type JmaXmlPollingServiceOptions } from './polling/index.js';
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
  close(): Promise<void>;
}

export interface StartServerOptions {
  readonly config?: DatabaseConfig;
  readonly port?: number;
  readonly enablePolling?: boolean;
  readonly pollingService?: JmaXmlPollingService;
  readonly pollingServiceOptions?: JmaXmlPollingServiceOptions;
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

export async function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  const database = initializeDatabase(options.config);
  const app = createApp();
  const actualServer = app.listen(options.port ?? DEFAULT_PORT);

  const serverListeningPromise = waitForServerListening(actualServer);

  const enablePolling = options.enablePolling ?? process.env.DISABLE_POLLING !== 'true';
  let pollingService: JmaXmlPollingService | undefined;

  try {
    // 初期取得より先に待受失敗を監視する。失敗時は直ちに catch で全資源を解放する。
    await serverListeningPromise;

    if (enablePolling) {
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
        new JmaXmlPollingService(database.connection, options.pollingServiceOptions);
      await pollingService.start();
    }
  } catch (error) {
    if (pollingService) {
      await pollingService.stop();
    }
    await closeServer(actualServer);
    database.close();
    throw error;
  }

  const address = actualServer.address();
  if (address === null || typeof address === 'string') {
    if (pollingService) {
      await pollingService.stop();
    }
    database.close();
    await closeServer(actualServer);
    throw new Error('HTTP server did not provide a TCP port.');
  }

  let closed = false;
  return {
    port: address.port,
    pollingService,
    async close() {
      if (!closed) {
        closed = true;
        if (pollingService) {
          await pollingService.stop();
        }
        await closeServer(actualServer);
        database.close();
      }
    },
  };
}

async function main(): Promise<void> {
  const port = process.env.PORT ? Number(process.env.PORT) : DEFAULT_PORT;
  const database = initializeDatabase();
  const app = createApp();
  const server = app.listen(port);
  let pollingService: JmaXmlPollingService | undefined;

  let closed = false;
  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    if (pollingService) {
      await pollingService.stop();
    }
    await closeServer(server);
    database.close();
  };

  try {
    await waitForServerListening(server);

    if (process.env.DISABLE_POLLING !== 'true') {
      await reprocessPendingWarningTelegramReceptions(
        database.connection,
        DEFAULT_WARNING_CURRENT_TARGET_AREA,
        () => new Date().toISOString(),
      );
      rebuildWarningCurrentFromReceptions(database.connection, DEFAULT_WARNING_CURRENT_TARGET_AREA);
      pollingService = new JmaXmlPollingService(database.connection);
      await pollingService.start();
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
