import assert from 'node:assert/strict';
import test from 'node:test';
import type { Worker } from 'node:worker_threads';
import { DeliveryWorkerHost } from '../src/runtime/deliveryWorkerHost.js';
import {
  createTemporaryTestDatabaseFixture,
  createTestDatabasePairConfig,
} from './helpers/databasePair.js';
import { createTestPollingSchedule } from './helpers/pollingSchedule.js';
import { testTerminalRegistry, testVenueRegistry } from './helpers/venueConfigPreload.js';

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) assert.fail('Worker状態が期限内に更新されませんでした');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function createHost(workerEntry?: URL) {
  const fixture = createTemporaryTestDatabaseFixture();
  const workers: Worker[] = [];
  const failures: string[] = [];
  const host = new DeliveryWorkerHost({
    pair: createTestDatabasePairConfig(fixture.config),
    settings: {
      venues: testVenueRegistry.listVenues(),
      venueGeneration: testVenueRegistry.generation,
      terminals: testTerminalRegistry.listTerminals(),
      terminalGeneration: testTerminalRegistry.generation,
      schedule: createTestPollingSchedule(),
      enablePolling: false,
      serverStartedAt: new Date().toISOString(),
      nowcastCacheRoot: `${fixture.config.databasePath}.nowcast`,
      kikikuruCacheRoot: `${fixture.config.databasePath}.kikikuru`,
    },
    serverGenerationId: 'server',
    onFailure: (code) => failures.push(code),
    onWorkerCreated: (worker) => workers.push(worker),
    workerEntry,
  });
  return { host, workers, failures, cleanup: fixture.cleanup };
}

test('提供Worker異常exitでは自動spawnせず、専用再開で旧exit確認後に1回spawnする', async () => {
  const f = createHost();
  try {
    await f.host.start();
    assert.equal(f.workers.length, 1);
    await f.workers[0]!.terminate();
    await until(() => f.host.status().exitConfirmed);
    assert.equal(f.host.status().lifecycle, 'failed');
    assert.deepEqual(f.failures, ['unexpected_exit']);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(f.workers.length, 1);
    await f.host.restart();
    assert.equal(f.workers.length, 2);
    assert.equal(f.host.status().exitConfirmed, false);
  } finally {
    await f.host.close();
    f.cleanup();
  }
});

test('受付未送信は5秒で障害となり、自動spawnしない', async () => {
  const f = createHost(new URL('./fixtures/worker/delivery-no-accept.ts', import.meta.url));
  try {
    await assert.rejects(f.host.start(), /deadline_exceeded/);
    assert.equal(f.host.status().lifecycle, 'failed');
    assert.deepEqual(f.failures, ['initialization_failed']);
    assert.equal(f.workers.length, 1);
  } finally {
    if (f.workers[0]) await f.workers[0].terminate();
    await f.host.close();
    f.cleanup();
  }
});

test('Worker errorイベントでは有限に失敗し、通知を重複させない', async () => {
  const f = createHost(new URL('./fixtures/worker/delivery-error.ts', import.meta.url));
  try {
    await assert.rejects(f.host.start());
    await until(() => f.host.status().exitConfirmed);
    assert.equal(f.host.status().lifecycle, 'failed');
    assert.equal(f.workers.length, 1);
    assert.deepEqual(f.failures, ['protocol_error']);
  } finally {
    await f.host.close();
    f.cleanup();
  }
});

test('提供Workerの報告途絶は一度だけ異常通知し、freshな報告でもfailureを隠さない', async (t) => {
  const f = createHost();
  try {
    await f.host.start();
    const realNow = Date.now;
    t.mock.method(Date, 'now', () => realNow() + 20000);
    await until(() => f.host.status().failureCode === 'report_stale');
    assert.deepEqual(f.failures, ['report_stale']);
    assert.equal(f.host.status().lifecycle, 'failed');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.deepEqual(f.failures, ['report_stale']);
  } finally {
    t.mock.restoreAll();
    await f.host.close();
    f.cleanup();
  }
});
