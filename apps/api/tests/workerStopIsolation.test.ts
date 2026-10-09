import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { startServer } from '../src/server.js';
import {
  createTemporaryTestDatabaseFixture,
  createTestServerDatabaseOptions,
} from './helpers/databasePair.js';
import { createTestPollingSchedule } from './helpers/pollingSchedule.js';

async function until(condition: () => boolean) {
  const end = performance.now() + 5000;
  while (!condition()) {
    assert.ok(performance.now() < end, 'Worker要求が期待した状態になりません');
    await delay(5);
  }
}
for (const load of [false, true]) {
  test(
    `startup HTTP中断${load ? '8件' : 'なし'}でも停止POSTの受付・照会・履歴が成功しpendingを残さない`,
    { timeout: 12000 },
    async () => {
      const fixture = createTemporaryTestDatabaseFixture();
      const options = createTestServerDatabaseOptions(fixture.config);
      const server = await startServer({
        ...options,
        port: 0,
        enablePolling: true,
        pollingSchedule: createTestPollingSchedule(),
        acquisitionWorkerEntry: new URL('./fixtures/worker/stop-isolation.ts', import.meta.url),
      });
      const base = `http://127.0.0.1:${server.port}`;
      try {
        assert.equal((await server.weatherPrepared).status, 'ready');
        await until(() => server.acquisitionHost.status().pendingRequests === 0);
        if (load) {
          for (let i = 0; i < 8; i++) {
            const controller = new AbortController();
            const request = fetch(`${base}/api/notifications/startup`, {
              method: 'POST',
              signal: controller.signal,
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                terminalId: 'hkeagh01',
                sessionId: randomUUID(),
                serverGenerationId: server.acquisitionHost.epoch.serverGenerationId,
              }),
            }).catch(() => null);
            await until(() => server.acquisitionHost.status().pendingRequests === i + 1);
            controller.abort();
            assert.equal(await request, null);
            await delay(15);
          }
          assert.equal(server.acquisitionHost.status().pendingRequests, 8);
        }
        const requestId = randomUUID();
        const response = await fetch(`${base}/api/control/fetch/stop`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ requestId }),
        });
        assert.equal(response.status, 200);
        const result = (await response.json()) as { result: string; errorCode: string | null };
        assert.equal(result.result, 'success');
        assert.equal(result.errorCode, null);
        assert.equal(server.acquisitionHost.desiredRunning, false);
        const details = await server.acquisitionHost.call<{
          executions: number;
          queries: number;
          heldPauses: number;
        }>('fixture.operations', null);
        assert.deepEqual(details, { executions: 1, queries: 1, heldPauses: load ? 8 : 0 });
        assert.equal(server.acquisitionHost.status().pendingRequests, load ? 8 : 0);
        const retained = new Database(options.config.retained.databasePath, { readonly: true });
        try {
          assert.deepEqual(
            retained
              .prepare(
                'SELECT operation_kind, result, error_code FROM operation_history WHERE request_id=?',
              )
              .all(requestId),
            [{ operation_kind: 'stop', result: 'success', error_code: null }],
          );
        } finally {
          retained.close();
        }
        await server.acquisitionHost.call('fixture.release-pauses', null);
        await until(() => server.acquisitionHost.status().pendingRequests === 0);
        assert.equal((await fetch(`${base}/api/health`)).status, 200);
      } finally {
        await server.close();
        fixture.cleanup();
      }
    },
  );
}
