import assert from 'node:assert/strict';
import test from 'node:test';
import type { Worker } from 'node:worker_threads';
import { startServer } from '../src/server.js';
import {
  createTemporaryTestDatabaseFixture,
  createTestServerDatabaseOptions,
} from './helpers/databasePair.js';
import { createTestPollingSchedule } from './helpers/pollingSchedule.js';

async function until(condition: () => boolean, timeoutMs = 5000) {
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    assert.ok(performance.now() < deadline, 'Worker状態が期限内に成立しません');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test(
  'readerClosed ACK欠落時は取得再開がmigrationと新Worker生成へ進まない',
  { timeout: 30_000 },
  async () => {
    const fixture = createTemporaryTestDatabaseFixture();
    let acquisitionWorker: Worker | undefined;
    let deliveryWorker: Worker | undefined;
    let acquisitionSpawns = 0;
    const server = await startServer({
      ...createTestServerDatabaseOptions(fixture.config),
      port: 0,
      enablePolling: false,
      pollingSchedule: createTestPollingSchedule(),
      deliveryWorkerEntry: new URL('./fixtures/worker/delivery-heartbeat.ts', import.meta.url),
      onAcquisitionWorkerCreated(worker) {
        acquisitionWorker = worker;
        acquisitionSpawns++;
      },
      onDeliveryWorkerCreated(worker) {
        deliveryWorker = worker;
      },
    });
    try {
      assert.equal((await server.weatherPrepared).status, 'ready');
      assert.ok(acquisitionWorker);
      assert.ok(deliveryWorker);
      const generation = server.deliveryHost.epoch.weatherDatabaseGenerationId;
      assert.ok(generation);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('fixture ACKなし')), 5000);
        const onMessage = (message: unknown) => {
          if (!message || typeof message !== 'object' || !('test' in message)) return;
          if (message.test !== 'suspend-blocked') return;
          clearTimeout(timer);
          deliveryWorker!.off('message', onMessage);
          resolve();
        };
        deliveryWorker!.on('message', onMessage);
        deliveryWorker!.postMessage({ type: 'test', id: 'fixture-control', test: 'block-suspend' });
      });
      await acquisitionWorker.terminate();
      await until(() => server.acquisitionHost.status().exitConfirmed);
      await assert.rejects(server.acquisitionHost.restart(), /timeout|deadline|reader|response/i);
      assert.equal(acquisitionSpawns, 1);
      assert.equal(server.deliveryHost.epoch.weatherDatabaseGenerationId, generation);
      assert.ok(server.deliveryHost.epoch.readerEpoch);
    } finally {
      deliveryWorker?.postMessage({ type: 'test', id: 'fixture-control', test: 'unblock-suspend' });
      await server.close();
      fixture.cleanup();
    }
  },
);
