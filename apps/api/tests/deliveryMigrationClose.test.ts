import assert from 'node:assert/strict';
import test from 'node:test';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { startServer } from '../src/server.js';
import { createTestServerDatabaseOptions } from './helpers/databasePair.js';
import { createTestPollingSchedule } from './helpers/pollingSchedule.js';

test(
  '実Workerのmigration中の二重closeは旧Workerを止め、leaseと接続を残さない',
  { timeout: 50_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'wx-migration-close-'));
    const migrationsDirectory = join(directory, 'migrations');
    cpSync(join(import.meta.dirname, '../migrations'), migrationsDirectory, { recursive: true });
    writeFileSync(
      join(migrationsDirectory, 'weather', '9999_slow_close.sql'),
      `CREATE TABLE migration_close_probe(value INTEGER NOT NULL);
     INSERT INTO migration_close_probe
         WITH RECURSIVE sequence(value) AS (
           VALUES(1) UNION ALL SELECT value + 1 FROM sequence WHERE value < 1000
         ) SELECT MAX(value) FROM sequence;`,
    );
    const databasePath = join(directory, 'weather.sqlite3');
    const config = { databasePath, migrationsDirectory };
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    let signal: Int32Array | undefined;
    let entered!: (signal: Int32Array) => void;
    const migrationEntered = new Promise<Int32Array>((resolve) => {
      entered = resolve;
    });
    try {
      server = await startServer({
        ...createTestServerDatabaseOptions(config),
        port: 0,
        enablePolling: false,
        pollingSchedule: createTestPollingSchedule(),
        acquisitionWorkerEntry: new URL(
          './fixtures/worker/acquisition-migration-gate.ts',
          import.meta.url,
        ),
        onAcquisitionWorkerCreated(worker) {
          worker.on('message', (message: unknown) => {
            if (!message || typeof message !== 'object' || !('test' in message)) return;
            if (message.test !== 'migration-entered' || !('signal' in message)) return;
            entered(new Int32Array(message.signal as SharedArrayBuffer));
          });
        },
      });
      signal = await migrationEntered;
      assert.equal(existsSync(`${databasePath}.writer-lock`), true);
      assert.equal(existsSync(databasePath), true);
      assert.equal(server.acquisitionHost.epoch.weatherDatabaseGenerationId, null);
      const first = server.close();
      assert.equal(server.close(), first);
      Atomics.store(signal, 0, 1);
      Atomics.notify(signal, 0);
      await first;
      assert.equal(server.acquisitionHost.status().exitConfirmed, true);
      assert.equal(server.deliveryHost.status().exitConfirmed, true);
      assert.equal(existsSync(`${databasePath}.writer-lock`), false);
      assert.equal(existsSync(`${databasePath}.retained.writer-lock`), false);
      await assert.rejects(server.acquisitionHost.call('fixture.unavailable', null), /not_ready/);
      const database = new Database(databasePath, { readonly: true });
      try {
        assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
      } finally {
        database.close();
      }
    } finally {
      if (signal) {
        Atomics.store(signal, 0, 1);
        Atomics.notify(signal, 0);
      }
      await server?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
