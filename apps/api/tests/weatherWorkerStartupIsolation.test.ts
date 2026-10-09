import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { startServer } from '../src/server.js';
import { initializeRoleDatabase } from '../src/database/roleDatabase.js';
import {
  createTemporaryTestDatabaseFixture,
  createTestServerDatabaseOptions,
} from './helpers/databasePair.js';
import { createTestPollingSchedule } from './helpers/pollingSchedule.js';

for (const defect of ['none', 'eacces', 'open', 'migration', 'recovery'] as const) {
  test(
    `実startServer: ${defect}条件でもHTTPと保持system差分が継続する`,
    { timeout: 15000 },
    async () => {
      const f = createTemporaryTestDatabaseFixture();
      const base = createTestServerDatabaseOptions(f.config);
      const root = dirname(f.config.databasePath);
      const options = {
        ...base,
        enablePolling: false,
        port: 0,
        pollingSchedule: createTestPollingSchedule(),
      };
      const inject = process.env.WX_TEST_STARTUP_NEGATIVE_CONTROL !== '1';
      let prior: Buffer | undefined;
      if (defect === 'eacces') {
        const writer = initializeRoleDatabase(base.config, {
          pid: process.pid,
          role: 'weather',
          token: 'permission-fixture',
          startedAt: '2026-10-09T00:00:00.000Z',
          serverGenerationId: 'fixture',
          workerGeneration: 'fixture',
          threadId: 1,
        });
        writer.close();
        prior = readFileSync(f.config.databasePath);
        if (inject) {
          chmodSync(f.config.databasePath, 0);
          assert.throws(() => readFileSync(f.config.databasePath), { code: 'EACCES' });
        }
      }
      if (defect === 'migration' && inject) {
        const migrationsDirectory = join(root, 'invalid-migrations');
        mkdirSync(migrationsDirectory);
        writeFileSync(
          join(migrationsDirectory, '0001_invalid.sql'),
          'CREATE TABLE partial_migration(value INTEGER); THIS IS INVALID SQL;',
        );
        options.config = {
          ...base.config,
          weather: { ...base.config.weather, migrationsDirectory },
        };
      }
      if ((defect === 'recovery' || defect === 'open') && inject)
        mkdirSync(dirname(options.nowcastCacheRoot), { recursive: true });
      if (defect === 'recovery' && inject)
        writeFileSync(`${options.nowcastCacheRoot}.recovery-fault`, 'enabled');
      if (defect === 'open' && inject)
        writeFileSync(`${options.nowcastCacheRoot}.open-fault`, 'enabled');
      let server: Awaited<ReturnType<typeof startServer>> | undefined;
      try {
        server = await startServer({
          ...options,
          acquisitionWorkerEntry:
            defect === 'open'
              ? new URL('./fixtures/acquisition-worker/open-failure.ts', import.meta.url)
              : defect === 'recovery' || defect === 'none'
                ? new URL('./fixtures/acquisition-worker/recovery-failure.ts', import.meta.url)
                : undefined,
        });
        const result = await server.weatherPrepared;
        assert.equal(result.status, defect === 'none' ? 'ready' : 'failed');
        const url = `http://127.0.0.1:${server.port}`;
        for (const route of [
          '/api/health',
          '/api/monitoring/status?terminalId=hkeagh01',
          '/api/notifications/delta?origin=system&terminalId=hkeagh01',
        ]) {
          const response = await fetch(`${url}${route}`);
          assert.equal(response.status, 200, route);
          assert.ok(await response.json());
        }
        const retained = new Database(base.config.retained.databasePath, { readonly: true });
        try {
          const faults = retained
            .prepare(
              "SELECT change_type FROM notification_output_history WHERE source_type='weather_worker'",
            )
            .all();
          assert.deepEqual(
            faults,
            defect === 'none' ? [] : [{ change_type: 'initialization_failed' }],
          );
        } finally {
          retained.close();
        }
        if (defect === 'recovery')
          assert.equal(
            readFileSync(`${options.nowcastCacheRoot}.recovery-fault.observed`, 'utf8'),
            'recovery-throw\n',
          );
        if (defect === 'open')
          assert.equal(
            readFileSync(`${options.nowcastCacheRoot}.open-fault.observed`, 'utf8'),
            'sqlite-open-throw\n',
          );
        if (defect === 'migration') {
          const weather = new Database(f.config.databasePath, { readonly: true });
          try {
            assert.deepEqual(
              weather
                .prepare("SELECT name FROM sqlite_master WHERE name='partial_migration'")
                .all(),
              [],
            );
          } finally {
            weather.close();
          }
        }
      } finally {
        await server?.close();
        if (defect === 'eacces') {
          chmodSync(f.config.databasePath, 0o600);
          if (inject) assert.deepEqual(readFileSync(f.config.databasePath), prior);
        }
        assert.equal(existsSync(`${base.config.retained.databasePath}.writer-lock`), false);
        f.cleanup();
      }
    },
  );
}
