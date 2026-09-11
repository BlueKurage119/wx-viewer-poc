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
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

export async function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  const database = initializeDatabase(options.config);
  const app = createApp();
  const actualServer = app.listen(options.port ?? DEFAULT_PORT);

  const serverListeningPromise = new Promise<void>((resolve, reject) => {
    actualServer.once('error', reject);
    if (actualServer.listening) {
      resolve();
    } else {
      actualServer.once('listening', resolve);
    }
  });

  const enablePolling = options.enablePolling ?? process.env.DISABLE_POLLING !== 'true';
  let pollingService: JmaXmlPollingService | undefined;

  try {
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

    await serverListeningPromise;
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

  server.once('error', (error) => {
    if (pollingService) {
      void pollingService.stop();
    }
    database.close();
    console.error(error);
    process.exitCode = 1;
  });
  server.once('listening', () => {
    console.log(
      `[api] database: ${database.connection.name}, applied migrations: ${database.migrationSummary.appliedVersions.length}`,
    );
    console.log(`[api] listening on http://localhost:${port}`);
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
