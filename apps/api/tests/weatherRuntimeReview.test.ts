import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { startInlineServer as startServer } from '../src/server.js';
import { WeatherRequestRegistry } from '../src/runtime/weatherRequestRegistry.js';
import type { WeatherEpoch } from '../src/runtime/weatherContracts.js';
import { createApplicationRuntime } from '../src/runtime/createApplicationRuntime.js';
import { createWeatherApiService } from '../src/services/weatherApiService.js';
import { createNowcastApiService } from '../src/services/nowcastApiService.js';
import { createKikikuruApiService } from '../src/services/kikikuruApiService.js';
import { createStaticTileDeliveryProfileService } from '../src/services/tileDeliveryProfileService.js';
import { NowcastService } from '../src/polling/nowcastService.js';
import {
  createTemporaryTestDatabaseFixture,
  createTestServerDatabaseOptions,
  initializeTestDatabases,
} from './helpers/databasePair.js';
import { testVenueRegistry, testTerminalRegistry } from './helpers/venueConfigPreload.js';

const epoch: WeatherEpoch = {
  serverGenerationId: 'server',
  workerGeneration: 'delivery',
  weatherDatabaseGenerationId: 'weather',
  readerEpoch: 'reader',
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('PR261: registryのclose後は世代変更しても新規要求を実行せずnot_readyを返す', async () => {
  const registry = new WeatherRequestRegistry(epoch);
  let executions = 0;
  registry.close();
  registry.close();
  registry.replaceEpoch(epoch);
  const reply = await registry.request(
    {
      protocolVersion: 1,
      requestId: 'after-close',
      epoch,
      kind: 'history.reception',
      deadlineAt: new Date(Date.now() + 5000).toISOString(),
      payload: { receptionId: 1, expectedDatabaseGenerationId: 'weather' },
    },
    async () => {
      executions += 1;
      return null;
    },
  );
  assert.deepEqual(reply.result, { status: 'failed', code: 'not_ready' });
  assert.equal(executions, 0);
  assert.equal(registry.size, 0);
});

test('PR261: 実server終了中の新規気象HTTP要求は読取を再開しない', async (context) => {
  const fixture = createTemporaryTestDatabaseFixture();
  const stopping = deferred();
  const release = deferred();
  const server = await startServer({
    ...createTestServerDatabaseOptions(fixture.config),
    port: 0,
    enablePolling: false,
  });
  let closing: Promise<void> | undefined;
  try {
    const url = `http://127.0.0.1:${server.port}/api/weather/warnings?terminalId=kkeagh01&controlStatus=normal`;
    const before = await fetch(url);
    assert.equal(before.status, 200);
    await before.json();
    // registry閉鎖後、画像サービスのdrainが終わるまで実HTTPの待受を残す。
    context.mock.method(NowcastService.prototype, 'waitForIdle', async () => {
      stopping.resolve();
      await release.promise;
    });
    closing = server.close();
    await stopping.promise;
    const after = await fetch(url);
    assert.equal(after.status, 500);
    assert.deepEqual(await after.json(), { status: 'error', code: 'weather_read_failed' });
  } finally {
    release.resolve();
    await closing;
    await server.close();
    fixture.cleanup();
  }
});

test('PR261: 両画像の実HTTPタイル要求は初期化中に503と既存理由を返す', async () => {
  const fixture = createTemporaryTestDatabaseFixture();
  const db = initializeTestDatabases(fixture.config);
  const imageDeps = {
    venueRegistry: testVenueRegistry,
    getService: () => null,
    enablePolling: false,
    tileDeliveryProfileService: createStaticTileDeliveryProfileService('proxy'),
  };
  const runtime = createApplicationRuntime({
    deliveryEpoch: epoch,
    deliveryRegistry: new WeatherRequestRegistry(epoch),
    acquisitionEpoch: epoch,
    serverGenerationId: epoch.serverGenerationId,
    weatherDatabaseGenerationId: db.weatherDatabaseGenerationId,
    retainedConnection: db.retained.connection,
    weatherConnection: db.weather.connection,
    terminalRegistry: testTerminalRegistry,
    weatherApi: createWeatherApiService({
      connection: db.weather.connection,
      venueRegistry: testVenueRegistry,
    }),
    nowcastApi: createNowcastApiService(imageDeps),
    kikikuruApi: createKikikuruApiService(imageDeps),
    monitoringProcessing: {
      getProcessing: () => {
        throw new Error('この試験では呼び出さない');
      },
    },
  });
  const server = createApp(runtime.dependencies).listen(0);
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const query =
      'terminalId=hkeagh01&controlStatus=normal&baseTime=2026-09-07T03:00:00.000Z&validTime=2026-09-07T03:05:00.000Z';
    for (const path of [
      `nowcast/N1/tiles/10/900/400.png?${query}`,
      `kikikuru/heavyrain/tiles/10/900/400.png?${query}&imageId=rain_mesh&member=none`,
    ]) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/weather/${path}`);
      assert.equal(response.status, 503, path);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), {
        status: 'error',
        code: 'image_services_initializing',
      });
    }
  } finally {
    runtime.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    db.close();
    fixture.cleanup();
  }
});

test('PR261: 実startServerの通知・操作・電文履歴は注入時計のgeneratedAtを返す', async () => {
  const fixture = createTemporaryTestDatabaseFixture();
  let clock = '2026-09-07T03:00:00.000Z';
  const server = await startServer({
    ...createTestServerDatabaseOptions(fixture.config),
    port: 0,
    enablePolling: false,
    pollingServiceOptions: { clock: () => clock },
  });
  try {
    for (const current of ['2026-09-07T03:00:00.000Z', '2026-09-07T03:01:00.000Z']) {
      clock = current;
      for (const path of ['notification-outputs', 'operations', 'receptions']) {
        const response = await fetch(`http://127.0.0.1:${server.port}/api/monitoring/${path}`);
        assert.equal(response.status, 200, path);
        const body = (await response.json()) as { generatedAt: string };
        assert.equal(body.generatedAt, current, path);
      }
    }
  } finally {
    await server.close();
    fixture.cleanup();
  }
});
