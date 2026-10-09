import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import type { Worker } from 'node:worker_threads';
import {
  createTemporaryTestDatabaseFixture,
  createTestServerDatabaseOptions,
} from './helpers/databasePair.js';
import { createTestPollingSchedule } from './helpers/pollingSchedule.js';
import { startServer } from '../src/server.js';

function waitFixture(worker: Worker, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.off('message', onMessage);
      reject(new Error(`${expected} の応答待機が期限切れです`));
    }, 5000);
    function onMessage(message: unknown) {
      if (!message || typeof message !== 'object' || !('test' in message)) return;
      if (message.test !== expected) return;
      clearTimeout(timer);
      worker.off('message', onMessage);
      resolve();
    }
    worker.on('message', onMessage);
  });
}

test('実提供WorkerのHTTP応答は待機中に取得scopeが失効したら破棄し、別会場は読める', async () => {
  const fixture = createTemporaryTestDatabaseFixture();
  const options = createTestServerDatabaseOptions(fixture.config);
  let deliveryWorker: Worker | undefined;
  const server = await startServer({
    ...options,
    port: 0,
    enablePolling: false,
    pollingSchedule: createTestPollingSchedule(),
    nowcastCacheRoot: join(fixture.config.databasePath, '..', 'nowcast'),
    kikikuruCacheRoot: join(fixture.config.databasePath, '..', 'kikikuru'),
    acquisitionWorkerEntry: new URL('./fixtures/worker/publication.ts', import.meta.url),
    deliveryWorkerEntry: new URL('./fixtures/worker/delivery-read-hold.ts', import.meta.url),
    onDeliveryWorkerCreated(worker) {
      deliveryWorker = worker;
    },
  });
  try {
    assert.equal((await server.weatherPrepared).status, 'ready');
    assert.ok(deliveryWorker);
    const base = `http://127.0.0.1:${server.port}`;
    const url = `${base}/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal`;
    assert.equal((await fetch(url)).status, 200);
    const ready = waitFixture(deliveryWorker, 'reads-held');
    deliveryWorker.postMessage({ type: 'test', id: 'fixture-control', test: 'hold-reads' });
    await ready;
    const held = waitFixture(deliveryWorker, 'read-held');
    const pending = fetch(url);
    await held;
    await server.acquisitionHost.call('fixture.invalidate-scope', 'east|normal|warnings');
    const released = waitFixture(deliveryWorker, 'reads-released');
    deliveryWorker.postMessage({ type: 'test', id: 'fixture-control', test: 'release-reads' });
    await released;
    const response = await pending;
    assert.equal(response.status, 503);
    assert.equal(((await response.json()) as { code: string }).code, 'weather_worker_unavailable');
    assert.equal(
      (await fetch(`${base}/api/weather/warnings?terminalId=htrcph01&controlStatus=normal`)).status,
      200,
    );
  } finally {
    await server.close();
    fixture.cleanup();
  }
});

test('取得・提供の同時再開は旧readerを再接続せず新世代へ収束する', async () => {
  const fixture = createTemporaryTestDatabaseFixture();
  const options = createTestServerDatabaseOptions(fixture.config);
  let acquisitionWorker: Worker | undefined;
  let deliveryWorker: Worker | undefined;
  let deliverySpawns = 0;
  const server = await startServer({
    ...options,
    port: 0,
    enablePolling: false,
    pollingSchedule: createTestPollingSchedule(),
    nowcastCacheRoot: join(fixture.config.databasePath, '..', 'nowcast'),
    kikikuruCacheRoot: join(fixture.config.databasePath, '..', 'kikikuru'),
    onAcquisitionWorkerCreated(worker) {
      acquisitionWorker = worker;
    },
    onDeliveryWorkerCreated(worker) {
      deliveryWorker = worker;
      deliverySpawns += 1;
    },
  });
  try {
    assert.equal((await server.weatherPrepared).status, 'ready');
    assert.ok(acquisitionWorker);
    assert.ok(deliveryWorker);
    const oldAcquisition = server.acquisitionHost.epoch.workerGeneration;
    const oldDelivery = server.deliveryHost.epoch.workerGeneration;
    await Promise.all([acquisitionWorker.terminate(), deliveryWorker.terminate()]);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        server.acquisitionHost.status().exitConfirmed &&
        server.deliveryHost.status().exitConfirmed
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const base = `http://127.0.0.1:${server.port}`;
    const restart = (role: 'acquisition' | 'delivery', generation: string) =>
      fetch(`${base}/api/control/weather-workers/${role}/restart`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestId: `concurrent-${role}`,
          expectedWorkerGeneration: generation,
        }),
      });
    let entered!: () => void;
    const suspendEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let resume!: () => void;
    const suspended = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const suspendReader = server.deliveryHost.suspendReader.bind(server.deliveryHost);
    server.deliveryHost.suspendReader = async () => {
      entered();
      await suspended;
      await suspendReader();
    };
    try {
      assert.equal((await restart('acquisition', oldAcquisition)).status, 202);
      await suspendEntered;
      assert.equal((await restart('delivery', oldDelivery)).status, 202);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const pendingDelivery = await fetch(
        `${base}/api/control/weather-workers/operations/concurrent-delivery`,
      );
      assert.equal(((await pendingDelivery.json()) as { status: string }).status, 'in_progress');
      assert.equal(deliverySpawns, 1);
      assert.equal(server.deliveryHost.epoch.workerGeneration, oldDelivery);
    } finally {
      resume();
    }
    for (const role of ['acquisition', 'delivery'] as const) {
      let completed = false;
      for (let attempt = 0; attempt < 250; attempt++) {
        const response = await fetch(
          `${base}/api/control/weather-workers/operations/concurrent-${role}`,
        );
        const body = (await response.json()) as { status: string; result?: string; role: string };
        if (body.status === 'completed') {
          assert.equal(body.role, role);
          assert.equal(body.result, 'success');
          completed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(completed, true);
    }
    let converged = false;
    for (let attempt = 0; attempt < 250; attempt++) {
      if (
        server.acquisitionHost.epoch.weatherDatabaseGenerationId !== null &&
        server.deliveryHost.epoch.weatherDatabaseGenerationId ===
          server.acquisitionHost.epoch.weatherDatabaseGenerationId &&
        server.deliveryHost.epoch.readerEpoch !== null
      ) {
        converged = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(converged, true);
    assert.equal(
      (await fetch(`${base}/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal`)).status,
      200,
    );
  } finally {
    await server.close();
    fixture.cleanup();
  }
});
