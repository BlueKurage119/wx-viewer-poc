import assert from 'node:assert/strict';
import test from 'node:test';
import type { Worker } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { DeliveryWorkerHost } from '../src/runtime/deliveryWorkerHost.js';
import { initializeDatabases } from '../src/database/pair.js';
import { resetWeatherDatabase } from '../src/database/resetWeatherDatabase.js';
import {
  createTemporaryTestDatabaseFixture,
  createTestDatabasePairConfig,
} from './helpers/databasePair.js';
import { createTestPollingSchedule } from './helpers/pollingSchedule.js';
import { testTerminalRegistry, testVenueRegistry } from './helpers/venueConfigPreload.js';

async function until(check: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) assert.fail('Worker状態が期限内に更新されませんでした');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function workerEvent(worker: Worker, event: string): Promise<void> {
  return new Promise((resolve) => {
    const onMessage = (message: { test?: string }) => {
      if (message.test !== event) return;
      worker.off('message', onMessage);
      resolve();
    };
    worker.on('message', onMessage);
  });
}

function createHost(workerEntry?: URL) {
  const fixture = createTemporaryTestDatabaseFixture();
  const config = createTestDatabasePairConfig(fixture.config);
  const workers: Worker[] = [];
  const failures: string[] = [];
  const host = new DeliveryWorkerHost({
    pair: config,
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
  return { host, workers, failures, config, cleanup: fixture.cleanup };
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

test('受付期限後にauthorizeが到着してもreaderを開かず、旧世代のまま失敗する', async () => {
  const f = createHost(new URL('./fixtures/worker/delivery-late-authorize.ts', import.meta.url));
  try {
    const started = f.host.start();
    await until(() => f.workers.length === 1);
    const replies: { type?: string; error?: string }[] = [];
    f.workers[0]!.on('message', (message: { type?: string; error?: string }) => {
      replies.push(message);
    });
    await assert.rejects(started, /deadline_exceeded/);
    await until(
      () =>
        replies.some(
          (message) => message.type === 'reply' && message.error === 'initial_accept_timeout',
        ),
      5000,
    );
    assert.equal(f.host.status().lifecycle, 'failed');
    assert.equal(f.host.epoch.readerEpoch, null);
    assert.equal(f.workers.length, 1);
    await assert.rejects(
      f.host.connectReader({
        generation: 'late',
        schemaVersion: 1,
        acquisitionEpoch: {
          serverGenerationId: 'server',
          workerGeneration: 'acquisition',
          weatherDatabaseGenerationId: 'late',
          readerEpoch: null,
        },
        readerEpoch: 'late',
      }),
      /not_ready/,
    );
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

test('提供Workerの報告途絶は処理をfailedにせず、一度だけ異常通知する', async (t) => {
  const f = createHost();
  try {
    await f.host.start();
    const realNow = Date.now;
    t.mock.method(Date, 'now', () => realNow() + 20000);
    await until(() => f.failures.includes('report_stale'));
    assert.deepEqual(f.failures, ['report_stale']);
    assert.equal(f.host.status().lifecycle, 'starting');
    assert.equal(f.host.status().failureCode, null);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.deepEqual(f.failures, ['report_stale']);
  } finally {
    t.mock.restoreAll();
    await f.host.close();
    f.cleanup();
  }
});

test('実提供Workerの報告停止中もreadを受付け、復帰後の再staleで通知を増やさない', async (t) => {
  const f = createHost(new URL('./fixtures/worker/delivery-heartbeat.ts', import.meta.url));
  const databases = initializeDatabases(f.config);
  const generation = databases.weatherDatabaseGenerationId;
  const schemaVersion = (
    databases.weather.connection
      .prepare('SELECT MAX(version) AS version FROM __schema_migrations')
      .get() as {
      version: number;
    }
  ).version;
  databases.close();
  try {
    await f.host.start();
    await f.host.connectReader({
      generation,
      schemaVersion,
      acquisitionEpoch: {
        serverGenerationId: 'server',
        workerGeneration: 'acquisition',
        weatherDatabaseGenerationId: generation,
        readerEpoch: null,
      },
      readerEpoch: 'reader',
    });
    const worker = f.workers[0]!;
    const paused = workerEvent(worker, 'reports-paused');
    worker.postMessage({ type: 'test', id: 'fixture-control', test: 'pause-reports' });
    await paused;
    await until(() => f.host.status().reportFreshness === 'stale', 22000);
    await until(() => f.failures.includes('report_stale'));
    assert.equal(f.host.status().lifecycle, 'ready');
    assert.equal(f.host.status().failureCode, null);
    assert.equal(f.host.status().restartAllowed, true);
    assert.equal(f.workers.length, 1);
    const response = await f.host.read(
      'monitoring.sample',
      {
        terminal: testTerminalRegistry.listTerminals()[0]!,
        requestedAt: new Date().toISOString(),
      } as never,
      { report: null, unknownScopes: [], validatedScopes: [] },
    );
    assert.equal(typeof response, 'object');
    const resumed = workerEvent(worker, 'reports-resumed');
    worker.postMessage({ type: 'test', id: 'fixture-control', test: 'resume-reports' });
    await resumed;
    await until(() => f.host.status().reportFreshness === 'fresh', 7000);
    const pausedAgain = workerEvent(worker, 'reports-paused');
    worker.postMessage({ type: 'test', id: 'fixture-control', test: 'pause-reports' });
    await pausedAgain;
    const realNow = Date.now;
    t.mock.method(Date, 'now', () => realNow() + 20000);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.deepEqual(f.failures, ['report_stale']);
    assert.equal(f.host.status().lifecycle, 'ready');
    t.mock.restoreAll();
    worker.postMessage({ type: 'test', id: 'fixture-control', test: 'send-protocol-error' });
    await until(() => f.host.status().failureCode === 'protocol_error');
    assert.equal(f.host.status().lifecycle, 'failed');
    const beforeReport = f.host.status().receivedAt;
    const reportsResumed = workerEvent(worker, 'reports-resumed');
    worker.postMessage({ type: 'test', id: 'fixture-control', test: 'resume-reports' });
    await reportsResumed;
    await until(() => f.host.status().receivedAt !== beforeReport, 7000);
    assert.equal(f.host.status().failureCode, 'protocol_error');
    assert.equal(f.host.status().lifecycle, 'failed');
    assert.deepEqual(f.failures, ['report_stale', 'protocol_error']);
  } finally {
    t.mock.restoreAll();
    await f.host.close();
    f.cleanup();
  }
});

test('正常・初期化失敗後の二重closeは同じ終了確認を返し、新しい要求を拒否する', async () => {
  const normal = createHost();
  try {
    await normal.host.start();
    const first = normal.host.close();
    const second = normal.host.close();
    assert.equal(first, second);
    await Promise.all([first, second]);
    assert.equal(normal.host.status().exitConfirmed, true);
    await assert.rejects(normal.host.start(), /not_ready/);
  } finally {
    await normal.host.close();
    normal.cleanup();
  }

  const failed = createHost(new URL('./fixtures/worker/delivery-error.ts', import.meta.url));
  try {
    await assert.rejects(failed.host.start());
    const first = failed.host.close();
    assert.equal(first, failed.host.close());
    await first;
    assert.equal(failed.host.status().exitConfirmed, true);
  } finally {
    await failed.host.close();
    failed.cleanup();
  }
});

test('実提供readerが開いた間はresetを拒否し、suspend ACKと二重close後にplan/apply/resumeする', async () => {
  const f = createHost();
  const databases = initializeDatabases(f.config);
  const generation = databases.weatherDatabaseGenerationId;
  const schemaVersion = (
    databases.weather.connection
      .prepare('SELECT MAX(version) AS version FROM __schema_migrations')
      .get() as {
      version: number;
    }
  ).version;
  databases.close();
  try {
    await f.host.start();
    await f.host.connectReader({
      generation,
      schemaVersion,
      acquisitionEpoch: {
        serverGenerationId: 'server',
        workerGeneration: 'acquisition',
        weatherDatabaseGenerationId: generation,
        readerEpoch: null,
      },
      readerEpoch: 'reader',
    });
    assert.throws(
      () => resetWeatherDatabase(f.config, { mode: 'plan', confirmStopped: true }),
      /対象DBを開いているプロセスがあります/,
    );
    await f.host.suspendReader();
    assert.equal(f.workers.length, 1);
    await f.host.connectReader({
      generation,
      schemaVersion,
      acquisitionEpoch: {
        serverGenerationId: 'server',
        workerGeneration: 'acquisition',
        weatherDatabaseGenerationId: generation,
        readerEpoch: null,
      },
      readerEpoch: 'reader-reconnected',
    });
    assert.equal(f.host.epoch.readerEpoch, 'reader-reconnected');
    assert.equal(f.workers.length, 1);
    await f.host.suspendReader();
    const first = f.host.close();
    assert.equal(first, f.host.close());
    await first;
    assert.equal(f.host.status().exitConfirmed, true);
    const plan = resetWeatherDatabase(f.config, { mode: 'plan', confirmStopped: true });
    assert.ok(plan.planDigest);
    assert.throws(
      () =>
        resetWeatherDatabase(
          f.config,
          { mode: 'apply', confirmStopped: true, confirm: plan.planDigest },
          {
            afterUnlink() {
              throw new Error('中断fixture');
            },
          },
        ),
      /中断fixture/,
    );
    resetWeatherDatabase(f.config, {
      mode: 'resume',
      confirmStopped: true,
      confirm: plan.planDigest,
    });
    const restarted = initializeDatabases(f.config);
    assert.notEqual(restarted.weatherDatabaseGenerationId, generation);
    restarted.close();
  } finally {
    await f.host.close();
    f.cleanup();
  }
});

test('外部exclusive lock中の実提供読取は有限に失敗し、lock解除後に再読取できる', async () => {
  const f = createHost();
  const databases = initializeDatabases(f.config);
  const generation = databases.weatherDatabaseGenerationId;
  const schemaVersion = (
    databases.weather.connection
      .prepare('SELECT MAX(version) AS version FROM __schema_migrations')
      .get() as {
      version: number;
    }
  ).version;
  databases.close();
  const locker = new Database(f.config.weather.databasePath);
  locker.pragma('journal_mode = DELETE');
  locker.exec('CREATE TABLE busy_probe (value INTEGER); INSERT INTO busy_probe VALUES (1)');
  try {
    await f.host.start();
    await f.host.connectReader({
      generation,
      schemaVersion,
      acquisitionEpoch: {
        serverGenerationId: 'server',
        workerGeneration: 'acquisition',
        weatherDatabaseGenerationId: generation,
        readerEpoch: null,
      },
      readerEpoch: 'reader',
    });
    const request = { expectedDatabaseGenerationId: generation, receptionId: 1 };
    const context = { report: null, unknownScopes: [], validatedScopes: [] };
    locker.exec('BEGIN EXCLUSIVE; UPDATE busy_probe SET value=2');
    const started = performance.now();
    await assert.rejects(f.host.read('history.reception', request, context), /database is locked/);
    assert.ok(performance.now() - started < 1000);
    locker.exec('ROLLBACK');
    await f.host.read('history.reception', request, context);
  } finally {
    if (locker.inTransaction) locker.exec('ROLLBACK');
    locker.close();
    await f.host.close();
    f.cleanup();
  }
});

test('読取中と再開中の二重closeは旧Worker終了を確認し、後続要求を拒否する', async () => {
  const f = createHost(new URL('./fixtures/worker/delivery-heartbeat.ts', import.meta.url));
  const databases = initializeDatabases(f.config);
  const generation = databases.weatherDatabaseGenerationId;
  const schemaVersion = (
    databases.weather.connection
      .prepare('SELECT MAX(version) AS version FROM __schema_migrations')
      .get() as {
      version: number;
    }
  ).version;
  databases.close();
  try {
    await f.host.start();
    await f.host.connectReader({
      generation,
      schemaVersion,
      acquisitionEpoch: {
        serverGenerationId: 'server',
        workerGeneration: 'acquisition',
        weatherDatabaseGenerationId: generation,
        readerEpoch: null,
      },
      readerEpoch: 'reader',
    });
    const worker = f.workers[0]!;
    const blocked = workerEvent(worker, 'reads-blocked');
    worker.postMessage({ type: 'test', id: 'fixture-control', test: 'block-reads' });
    await blocked;
    const reading = f.host.read(
      'history.reception',
      { expectedDatabaseGenerationId: generation, receptionId: 1 },
      { report: null, unknownScopes: [], validatedScopes: [] },
    );
    void reading.catch(() => {});
    await until(() => f.host.status().pendingRequests > 0);
    const first = f.host.close();
    assert.equal(first, f.host.close());
    await first;
    await assert.rejects(reading);
    assert.equal(f.host.status().exitConfirmed, true);
    assert.equal(f.host.status().pendingRequests, 0);
    await assert.rejects(
      f.host.read(
        'history.reception',
        { expectedDatabaseGenerationId: generation, receptionId: 1 },
        { report: null, unknownScopes: [], validatedScopes: [] },
      ),
      /not_ready/,
    );
  } finally {
    await f.host.close();
    f.cleanup();
  }

  const restarting = createHost();
  try {
    await restarting.host.start();
    const operation = restarting.host.restart();
    void operation.catch(() => {});
    const close = restarting.host.close();
    assert.equal(close, restarting.host.close());
    await close;
    await assert.rejects(operation, /not_ready/);
    assert.equal(restarting.host.status().exitConfirmed, true);
    assert.equal(restarting.workers.length, 1, '終了要求後に新Workerをspawnしました');
  } finally {
    await restarting.host.close();
    restarting.cleanup();
  }
});
