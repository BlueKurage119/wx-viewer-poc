import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';

import { createApp } from './app.js';
import { initializeDatabase, type DatabaseConfig } from './database/index.js';
import { JmaXmlPollingService, type JmaXmlPollingServiceOptions } from './polling/index.js';

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

  const enablePolling = options.enablePolling ?? process.env.DISABLE_POLLING !== 'true';
  let pollingService: JmaXmlPollingService | undefined;
  if (enablePolling) {
    pollingService =
      options.pollingService ??
      new JmaXmlPollingService(database.connection, options.pollingServiceOptions);
    pollingService.start();
  }

  try {
    await new Promise<void>((resolve, reject) => {
      actualServer.once('error', reject);
      actualServer.once('listening', resolve);
    });
  } catch (error) {
    if (pollingService) {
      await pollingService.stop();
    }
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
  const pollingService = new JmaXmlPollingService(database.connection);
  if (process.env.DISABLE_POLLING !== 'true') {
    pollingService.start();
  }

  let closed = false;
  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    await pollingService.stop();
    await closeServer(server);
    database.close();
  };

  server.once('error', (error) => {
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
