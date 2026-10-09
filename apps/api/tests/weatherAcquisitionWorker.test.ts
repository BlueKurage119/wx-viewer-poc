import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../src/server.js';
import { createTestPollingSchedule } from './helpers/pollingSchedule.js';
import {
  createTestServerDatabaseOptions,
  initializeTestDatabases,
} from './helpers/databasePair.js';
import {
  saveWarningTimeseriesSnapshot,
  mergeRadarSnapshot,
  upsertRadarTile,
} from '../src/repositories/index.js';
import { NowcastTileStore } from '../src/polling/nowcastTileStore.js';

test('実取得WorkerとHTTPを起動し、気象準備と停止を個別に観測する', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'wx-worker-'));
  const server = await startServer({
    ...createTestServerDatabaseOptions({
      databasePath: join(directory, 'weather.sqlite3'),
      migrationsDirectory: join(import.meta.dirname, '../migrations'),
    }),
    enablePolling: false,
    port: 0,
    pollingSchedule: createTestPollingSchedule(),
    nowcastCacheRoot: join(directory, 'nowcast'),
    kikikuruCacheRoot: join(directory, 'kikikuru'),
  });
  try {
    const health = await fetch(`http://127.0.0.1:${server.port}/api/health`);
    assert.deepEqual(await health.json(), { status: 'ok' });
    assert.deepEqual(await server.weatherPrepared, {
      status: 'ready',
      workerGeneration: server.acquisitionHost.epoch.workerGeneration,
    });
    const response = await fetch(
      `http://127.0.0.1:${server.port}/api/monitoring/status?terminalId=hkeagh01`,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      weatherRuntimes: { acquisition: { mode: string; lifecycle: string; exitConfirmed: boolean } };
    };
    assert.equal(body.weatherRuntimes.acquisition.mode, 'worker');
    assert.equal(body.weatherRuntimes.acquisition.lifecycle, 'ready');
    assert.equal(body.weatherRuntimes.acquisition.exitConfirmed, false);
  } finally {
    await server.close();
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('提供Worker異常終了後は閲覧を503に閉じ、専用再開だけで復旧する', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'wx-delivery-restart-'));
  const options = fixtureOptions(directory);
  let deliveryWorker: Worker | undefined;
  let deliverySpawns = 0;
  let acquisitionSpawns = 0;
  const server = await startServer({
    ...options,
    onDeliveryWorkerCreated: (worker) => {
      deliveryWorker = worker;
      deliverySpawns++;
    },
    onAcquisitionWorkerCreated: () => {
      acquisitionSpawns++;
    },
  });
  const root = `http://127.0.0.1:${server.port}`;
  const weather = () =>
    fetch(`${root}/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal`);
  try {
    assert.equal((await server.weatherPrepared).status, 'ready');
    await eventually(
      () => server.deliveryHost.status(),
      (status) => status.lifecycle === 'ready',
    );
    assert.equal((await weather()).status, 200);
    const generation = server.deliveryHost.epoch.workerGeneration;
    const acquisitionGeneration = server.acquisitionHost.epoch.workerGeneration;
    await deliveryWorker!.terminate();
    await eventually(
      () => server.deliveryHost.status(),
      (status) => status.exitConfirmed,
    );
    assert.equal((await weather()).status, 503);
    assert.equal((await fetch(`${root}/api/health`)).status, 200);
    assert.equal((await fetch(`${root}/api/monitoring/status?terminalId=hkeagh01`)).status, 200);
    assert.equal(deliverySpawns, 1);
    const body = { requestId: 'delivery-restart', expectedWorkerGeneration: generation };
    const post = () =>
      fetch(`${root}/api/control/weather-workers/delivery/restart`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    assert.equal((await post()).status, 202);
    const outcome = await eventually(
      async () =>
        (
          await fetch(`${root}/api/control/weather-workers/operations/delivery-restart`)
        ).json() as Promise<{
          status: string;
          role: string;
          result?: string;
          desiredRunning?: boolean;
        }>,
      (value) => value.status === 'completed',
    );
    assert.equal(outcome.role, 'delivery');
    assert.equal(outcome.result, 'success');
    assert.equal('desiredRunning' in outcome, false);
    assert.equal((await post()).status, 200);
    assert.equal(deliverySpawns, 2);
    assert.equal(acquisitionSpawns, 1);
    assert.equal(server.acquisitionHost.epoch.workerGeneration, acquisitionGeneration);
    await eventually(weather, (response) => response.status === 200);
  } finally {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('提供Worker異常通知の保存失敗は再開後に補完されない', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'wx-delivery-notification-failure-'));
  const options = fixtureOptions(directory);
  let worker: Worker | undefined;
  const server = await startServer({
    ...options,
    onDeliveryWorkerCreated: (value) => {
      worker = value;
    },
  });
  const root = `http://127.0.0.1:${server.port}`;
  const originalPrepare = BetterSqlite3.prototype.prepare;
  try {
    assert.equal((await server.weatherPrepared).status, 'ready');
    const oldGeneration = server.deliveryHost.epoch.workerGeneration;
    BetterSqlite3.prototype.prepare = function (this: InstanceType<typeof BetterSqlite3>, ...args) {
      if (String(args[0]).includes('INSERT INTO notification_output_history'))
        throw new Error('保持通知書込の固定障害');
      return originalPrepare.apply(this, args);
    } as typeof BetterSqlite3.prototype.prepare;
    await worker!.terminate();
    await eventually(
      () => server.deliveryHost.status(),
      (status) => status.exitConfirmed,
    );
    BetterSqlite3.prototype.prepare = originalPrepare;
    assert.equal((await fetch(`${root}/api/health`)).status, 200);
    assert.equal(
      (await fetch(`${root}/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal`)).status,
      503,
    );
    const post = await fetch(`${root}/api/control/weather-workers/delivery/restart`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: 'notification-failure-restart',
        expectedWorkerGeneration: oldGeneration,
      }),
    });
    assert.equal(post.status, 202);
    await eventually(
      () => server.deliveryHost.status(),
      (status) => status.lifecycle === 'ready' && status.workerGeneration !== oldGeneration,
    );
    const retained = new BetterSqlite3(options.config.retained.databasePath, { readonly: true });
    try {
      const rows = retained
        .prepare(
          "SELECT change_type FROM notification_output_history WHERE source_type='weather_worker' AND source_version=?",
        )
        .all(oldGeneration);
      assert.deepEqual(rows, []);
    } finally {
      retained.close();
    }
  } finally {
    BetterSqlite3.prototype.prepare = originalPrepare;
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import type { Worker } from 'node:worker_threads';
import BetterSqlite3 from 'better-sqlite3';
import { openWeatherReader } from '../src/database/roleDatabase.js';

async function eventually<T>(read: () => T | Promise<T>, check: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10000;
  for (;;) {
    const value = await read();
    if (check(value)) return value;
    if (Date.now() >= deadline) assert.fail(`状態が期限内に成立しません: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
function fixtureOptions(directory: string) {
  return {
    ...createTestServerDatabaseOptions({
      databasePath: join(directory, 'weather.sqlite3'),
      migrationsDirectory: join(import.meta.dirname, '../migrations'),
    }),
    enablePolling: false,
    port: 0,
    pollingSchedule: createTestPollingSchedule(),
    nowcastCacheRoot: join(directory, 'nowcast'),
    kikikuruCacheRoot: join(directory, 'kikikuru'),
  };
}
for (const defect of ['directory', 'symlink', 'schema'] as const)
  test(`気象${defect}障害でもHTTP/監視/保持systemを継続し、元ファイルを変更しない`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'wx-worker-failure-'));
    const options = fixtureOptions(directory);
    const weatherPath = options.config.weather.databasePath;
    const target = join(directory, 'target');
    if (defect === 'directory') mkdirSync(weatherPath);
    else if (defect === 'symlink') {
      writeFileSync(target, '不変のリンク先');
      symlinkSync(target, weatherPath);
    } else writeFileSync(weatherPath, 'SQLiteではない固定データ');
    const before = defect === 'directory' ? null : readFileSync(weatherPath);
    const server = await startServer(options);
    try {
      assert.deepEqual(await server.weatherPrepared, {
        status: 'failed',
        code: 'initialization_failed',
      });
      assert.deepEqual(await (await fetch(`http://127.0.0.1:${server.port}/api/health`)).json(), {
        status: 'ok',
      });
      const monitor = (await (
        await fetch(`http://127.0.0.1:${server.port}/api/monitoring/status?terminalId=hkeagh01`)
      ).json()) as {
        health: { sources: { status: null }[] };
        information: { availability: string; summaryCount: null }[];
        weatherRuntimes: { acquisition: { stopReason: string } };
      };
      assert.equal(monitor.weatherRuntimes.acquisition.stopReason, 'initialization_failed');
      assert.deepEqual(
        monitor.health.sources.map((source) => source.status),
        [null, null, null, null, null, null],
      );
      assert.equal(monitor.information.length > 0, true);
      assert.equal(
        monitor.information.every(
          (info) => info.availability === 'unavailable' && info.summaryCount === null,
        ),
        true,
      );
      const retained = new BetterSqlite3(options.config.retained.databasePath, { readonly: true });
      try {
        assert.deepEqual(
          retained
            .prepare(
              "SELECT source_type, change_type, is_training FROM notification_output_history WHERE source_type='weather_worker'",
            )
            .all(),
          [{ source_type: 'weather_worker', change_type: 'initialization_failed', is_training: 0 }],
        );
      } finally {
        retained.close();
      }
      if (before) assert.deepEqual(readFileSync(weatherPath), before);
      else assert.equal(existsSync(weatherPath), true);
    } finally {
      await server.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

test('実Worker異常終了後も保存済み気象を提供し、同IDの専用再開は一度だけ実行する', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'wx-worker-restart-'));
  const options = fixtureOptions(directory);
  let worker: Worker | undefined;
  let spawns = 0;
  const server = await startServer({
    ...options,
    onAcquisitionWorkerCreated: (value) => {
      worker = value;
      spawns++;
    },
  });
  const root = `http://127.0.0.1:${server.port}`;
  try {
    assert.equal((await server.weatherPrepared).status, 'ready');
    const oldGeneration = server.acquisitionHost.epoch.workerGeneration;
    const owner = JSON.parse(
      readFileSync(`${options.config.weather.databasePath}.writer-lock/owner.json`, 'utf8'),
    ) as { threadId: number; pid: number };
    assert.equal(owner.threadId, worker!.threadId);
    assert.equal(owner.threadId > 0, true);
    assert.equal(owner.pid, process.pid);
    const inspection = new BetterSqlite3(options.config.weather.databasePath, { readonly: true });
    const version = (
      inspection.prepare('SELECT MAX(version) AS version FROM __schema_migrations').get() as {
        version: number;
      }
    ).version;
    inspection.close();
    const reader = openWeatherReader(
      options.config.weather,
      server.acquisitionHost.epoch.weatherDatabaseGenerationId!,
      version,
    );
    try {
      assert.throws(() => reader.exec('CREATE TABLE forbidden(value INTEGER)'), {
        code: 'SQLITE_READONLY',
      });
    } finally {
      reader.close();
    }
    await worker!.terminate();
    await eventually(
      () => server.acquisitionHost.status(),
      (status) => status.exitConfirmed,
    );
    assert.equal(server.acquisitionHost.status().stopReason, 'unexpected_exit');
    assert.equal(spawns, 1);
    assert.equal(
      (await fetch(`${root}/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal`)).status,
      200,
    );
    const retained = new BetterSqlite3(options.config.retained.databasePath, { readonly: true });
    try {
      assert.deepEqual(
        retained
          .prepare(
            "SELECT change_type FROM notification_output_history WHERE source_type='weather_worker'",
          )
          .all(),
        [{ change_type: 'unexpected_exit' }],
      );
    } finally {
      retained.close();
    }
    const body = { requestId: 'restart-once', expectedWorkerGeneration: oldGeneration };
    const post = () =>
      fetch(`${root}/api/control/weather-workers/acquisition/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    assert.equal((await post()).status, 202);
    const outcome = await eventually(
      async () =>
        (
          await fetch(`${root}/api/control/weather-workers/operations/restart-once`)
        ).json() as Promise<{ status: string; result?: string; desiredRunning?: boolean }>,
      (value) => value.status === 'completed',
    );
    assert.equal(outcome.result, 'success');
    assert.equal(outcome.desiredRunning, false);
    assert.equal(spawns, 2);
    assert.equal((await post()).status, 200);
    assert.equal(spawns, 2);
    await eventually(
      async () => fetch(`${root}/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal`),
      (response) => response.status === 200,
    );
    const history = (await (
      await fetch(`${root}/api/monitoring/weather-worker-operations?limit=1`)
    ).json()) as { items: { operation: { requestId: string } }[] };
    assert.deepEqual(
      history.items.map((item) => item.operation.requestId),
      ['restart-once'],
    );
  } finally {
    await server.close();
    assert.equal(existsSync(`${options.config.weather.databasePath}.writer-lock`), false);
    assert.equal(existsSync(`${options.config.retained.databasePath}.writer-lock`), false);
    rmSync(directory, { recursive: true, force: true });
  }
});

import { cpus, platform, arch } from 'node:os';
test('実Workerの固定XML同期解析中もhealth/監視/system差分各20要求が応答する', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'wx-worker-load-'));
  const options = fixtureOptions(directory);
  const fixedAt = new Date().toISOString();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  const radarFrame = {
    product: 'N1' as const,
    baseTime: fixedAt,
    validTime: fixedAt,
    element: 'hrpns' as const,
    member: 'none' as const,
  };
  const seed = initializeTestDatabases({
    databasePath: options.config.weather.databasePath,
    migrationsDirectory: join(import.meta.dirname, '../migrations'),
  });
  try {
    saveWarningTimeseriesSnapshot(seed.weather.connection, {
      areaCode: '1310800',
      areaName: '江東区',
      metadata: {
        source: 'test',
        issuedAt: fixedAt,
        validAt: null,
        validFrom: null,
        validTo: null,
        fetchedAt: fixedAt,
        lastSuccessAt: fixedAt,
        availability: 'available',
        sourceVersion: 'load-fixture',
      },
      telegram: {
        controlStatus: 'normal',
        infoType: '発表',
        eventId: 'load-fixture',
        reportDateTime: fixedAt,
        controlDateTime: fixedAt,
      },
      timeDefines: [],
      values: [],
    });
    mergeRadarSnapshot(seed.weather.connection, {
      product: 'N1',
      metadata: {
        source: 'test',
        issuedAt: fixedAt,
        validAt: fixedAt,
        validFrom: fixedAt,
        validTo: fixedAt,
        fetchedAt: fixedAt,
        lastSuccessAt: fixedAt,
        availability: 'available',
        sourceVersion: 'load-fixture',
      },
      frames: [{ ...radarFrame, sequence: 0 }],
    });
    const saved = await new NowcastTileStore(options.nowcastCacheRoot).saveTile('load.png', png);
    upsertRadarTile(seed.weather.connection, radarFrame, {
      zoom: 10,
      tileX: 1,
      tileY: 1,
      filePath: 'load.png',
      byteSize: saved.byteSize,
      contentHash: saved.contentHash,
      storedAt: fixedAt,
    });
  } finally {
    seed.close();
  }
  let worker: Worker | undefined;
  const server = await startServer({
    ...options,
    pollingServiceOptions: { clock: () => fixedAt },
    acquisitionWorkerEntry: new URL('./fixtures/worker/load.ts', import.meta.url),
    onAcquisitionWorkerCreated: (value) => {
      worker = value;
    },
  });
  try {
    assert.equal((await server.weatherPrepared).status, 'ready');
    const started = new Promise<{ bytes: number }>((resolve) =>
      worker!.on('message', (value) => {
        if (value.test === 'load-started') resolve(value);
      }),
    );
    let ended = false;
    const finished = new Promise<{ iterations: number }>((resolve) =>
      worker!.on('message', (value) => {
        if (value.test === 'load-ended') {
          ended = true;
          resolve(value);
        }
      }),
    );
    worker!.postMessage({ test: 'xml-load' });
    const fixture = await started;
    const measures: Record<string, number[]> = {};
    const textPath = '/api/weather/warning-timeseries?terminalId=hkeagh01&controlStatus=normal';
    const tilePath = `/api/weather/nowcast/N1/tiles/10/1/1.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${fixedAt}&validTime=${fixedAt}`;
    for (const [name, path, bound] of [
      ['health', '/api/health', 500],
      ['monitoring', '/api/monitoring/status?terminalId=hkeagh01', 1000],
      ['system', '/api/notifications/delta?origin=system&terminalId=hkeagh01', 2000],
      ['text', textPath, 2000],
      ['tile', tilePath, 2000],
    ] as const) {
      const values: number[] = [];
      for (let index = 0; index < 20; index++) {
        assert.equal(ended, false, 'Workerが同期処理中の区間だけを計測する');
        const start = performance.now();
        const response = await fetch(`http://127.0.0.1:${server.port}${path}`);
        if (name === 'tile') assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
        else {
          const body = (await response.json()) as { data?: unknown };
          if (name === 'text') assert.equal(body.data !== null, true, JSON.stringify(body));
        }
        values.push(performance.now() - start);
        assert.equal(response.status, 200);
      }
      measures[name] = values.sort((a, b) => a - b);
      assert.equal(values.at(-1)! < bound, true, `${name}の最大値${values.at(-1)}ms`);
    }
    const result = await finished;
    assert.equal(result.iterations > 0, true);
    t.diagnostic(
      JSON.stringify({
        platform: platform(),
        arch: arch(),
        cpu: cpus()[0]?.model,
        cpuCount: cpus().length,
        bytes: fixture.bytes,
        iterations: result.iterations,
        measurements: Object.fromEntries(
          Object.entries(measures).map(([name, values]) => [
            name,
            { count: values.length, maximumMs: values.at(-1), p95Ms: values[18] },
          ]),
        ),
      }),
    );
    await worker!.terminate();
    await eventually(
      () => server.acquisitionHost.status(),
      (status) => status.exitConfirmed,
    );
    const afterExit = { text: [] as number[], tile: [] as number[] };
    for (let index = 0; index < 20; index++) {
      const textStarted = performance.now();
      const textResponse = await fetch(`http://127.0.0.1:${server.port}${textPath}`);
      assert.equal(textResponse.status, 200);
      assert.equal(((await textResponse.json()) as { data: unknown }).data !== null, true);
      afterExit.text.push(performance.now() - textStarted);
      const tileStarted = performance.now();
      const tileResponse = await fetch(`http://127.0.0.1:${server.port}${tilePath}`);
      assert.equal(tileResponse.status, 200);
      assert.deepEqual(Buffer.from(await tileResponse.arrayBuffer()), png);
      afterExit.tile.push(performance.now() - tileStarted);
    }
    for (const [name, values] of Object.entries(afterExit)) {
      values.sort((a, b) => a - b);
      assert.equal(values.at(-1)! < 2000, true, `${name}の取得終了後最大値${values.at(-1)}ms`);
    }
    t.diagnostic(
      JSON.stringify({
        afterAcquisitionExit: Object.fromEntries(
          Object.entries(afterExit).map(([name, values]) => [
            name,
            { count: values.length, maximumMs: values.at(-1), p95Ms: values[18] },
          ]),
        ),
      }),
    );
  } finally {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('提供Workerの同期encode中もhealth/監視/system差分各20要求が応答する', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'wx-delivery-load-'));
  let worker: Worker | undefined;
  const server = await startServer({
    ...fixtureOptions(directory),
    deliveryWorkerEntry: new URL('./fixtures/worker/delivery-load.ts', import.meta.url),
    onDeliveryWorkerCreated: (value) => {
      worker = value;
    },
  });
  try {
    assert.equal((await server.weatherPrepared).status, 'ready');
    const sampleBefore = await eventually(
      async () =>
        (await (
          await fetch(`http://127.0.0.1:${server.port}/api/monitoring/status?terminalId=hkeagh01`)
        ).json()) as { weatherSampleReceivedAt: string | null },
      (value) => value.weatherSampleReceivedAt !== null,
    );
    const started = new Promise<{ bytes: number }>((resolve) => {
      worker!.on('message', (message) => {
        if (message.test === 'encode-load-started') resolve(message);
      });
    });
    let ended = false;
    const finished = new Promise<{ iterations: number }>((resolve) => {
      worker!.on('message', (message) => {
        if (message.test === 'encode-load-ended') {
          ended = true;
          resolve(message);
        }
      });
    });
    worker!.postMessage({ type: 'test', id: 'fixture-control', test: 'encode-load' });
    const fixture = await started;
    const measurements: Record<string, { count: number; maximumMs: number; p95Ms: number }> = {};
    for (const [name, path, bound] of [
      ['health', '/api/health', 500],
      ['monitoring', '/api/monitoring/status?terminalId=hkeagh01', 1000],
      ['system', '/api/notifications/delta?origin=system&terminalId=hkeagh01', 2000],
    ] as const) {
      const values: number[] = [];
      for (let index = 0; index < 20; index++) {
        assert.equal(ended, false, '提供Workerが同期encode中の区間だけを計測する');
        const start = performance.now();
        const response = await fetch(`http://127.0.0.1:${server.port}${path}`);
        assert.equal(response.status, 200);
        if (name === 'monitoring') {
          const body = (await response.json()) as { weatherSampleReceivedAt: string | null };
          assert.equal(body.weatherSampleReceivedAt, sampleBefore.weatherSampleReceivedAt);
        } else await response.arrayBuffer();
        values.push(performance.now() - start);
      }
      values.sort((a, b) => a - b);
      assert.equal(values.at(-1)! < bound, true, `${name}の最大値${values.at(-1)}ms`);
      measurements[name] = { count: values.length, maximumMs: values.at(-1)!, p95Ms: values[18]! };
    }
    const result = await finished;
    assert.equal(result.iterations > 0, true);
    t.diagnostic(
      JSON.stringify({
        platform: platform(),
        arch: arch(),
        cpu: cpus()[0]?.model,
        cpuCount: cpus().length,
        bytes: fixture.bytes,
        iterations: result.iterations,
        measurements,
      }),
    );
  } finally {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
