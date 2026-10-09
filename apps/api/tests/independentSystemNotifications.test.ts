import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTemporaryTestDatabaseFixture,
  createTestServerDatabaseOptions,
  initializeTestDatabases,
} from './helpers/databasePair.js';
import {
  testVenueRegistry,
  testTerminalRegistry,
  eastVenueId,
} from './helpers/venueConfigPreload.js';
import {
  createStartupNotificationRuntime,
  startInlineServer as startServer,
} from '../src/server.js';
import { createApp } from '../src/app.js';
import {
  JmaXmlPollingService,
  type PollingTimerScheduler,
} from '../src/polling/jmaXmlPollingService.js';
import {
  toNotificationDeltaCursor,
  type MonitoringStatusResponse,
  type NotificationDeltaReadyResponse,
  type StartupNotificationInitializingResponse,
} from '@wx-viewer-poc/shared';

const now = '2026-10-09T03:00:00.000Z';

test('#253 AC9/14: 復旧throw後もHTTP・保持DB・監視を維持し明示closeで解放する', async () => {
  const fixture = createTemporaryTestDatabaseFixture();
  const server = await startServer({
    ...createTestServerDatabaseOptions(fixture.config),
    port: 0,
    enablePolling: false,
    recoveryInternals: {
      recover: async () => {
        throw new Error('復旧の試験失敗');
      },
    },
  });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const status = await fetch(`${base}/api/monitoring/status?terminalId=kkeagh01`);
    assert.equal(status.status, 200);
    const body = (await status.json()) as MonitoringStatusResponse;
    assert.deepEqual(
      body.readiness.preparationFailures.map((failure) => [failure.stage, failure.venueId]),
      [['recovery', eastVenueId]],
    );
    const delta = await fetch(`${base}/api/notifications/delta?origin=system&terminalId=kkeagh01`);
    assert.equal(delta.status, 200);
    assert.equal(delta.headers.get('cache-control'), 'no-store');
    const feed = (await delta.json()) as NotificationDeltaReadyResponse;
    assert.deepEqual(
      feed.notifications.map((item: { changeType: string }) => item.changeType),
      ['database_recovery_started', 'database_recovery_failed'],
    );
    const pending = await fetch(`${base}/api/notifications/startup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        terminalId: 'kkeagh01',
        sessionId: '00000000-0000-4000-8000-000000000253',
        serverGenerationId: feed.serverGenerationId,
      }),
    });
    assert.equal(pending.status, 202);
    assert.equal(
      ((await pending.json()) as StartupNotificationInitializingResponse).weatherState,
      'failed',
    );
  } finally {
    await server.close();
    fixture.cleanup();
  }
});

test('#253 AC15: 世代不一致は大cursorと準備判定に優先し、新規session/claimへ副作用を起こさない', async () => {
  const fixture = createTemporaryTestDatabaseFixture();
  const db = initializeTestDatabases(fixture.config);
  const runtime = createStartupNotificationRuntime(
    db.weather.connection,
    () => now,
    testVenueRegistry,
    undefined,
    undefined,
    testTerminalRegistry,
    db.retained.connection,
    db.weatherDatabaseGenerationId,
  );
  const app = createApp({
    terminalRegistry: testTerminalRegistry,
    venueRegistry: testVenueRegistry,
    notificationDelta: runtime.notificationDelta,
    startupNotifications: runtime.startupNotifications,
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const query of [
      'terminalId=kkeagh01',
      'terminalId=kkeagh01&origin=weather',
      'terminalId=kkeagh01&origin=system&cursor=0',
      'terminalId=kkeagh01&origin=system&serverGenerationId=x',
      'terminalId=kkeagh01&origin=bad',
      'terminalId=kkeagh01&origin=system&extra=1',
      'terminalId=kkeagh01&origin=system&origin=weather',
    ]) {
      const response = await fetch(`${base}/api/notifications/delta?${query}`);
      assert.equal(response.status, 400, query);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    for (const origin of ['system', 'weather']) {
      const response = await fetch(
        `${base}/api/notifications/delta?terminalId=kkeagh01&origin=${origin}&cursor=999&serverGenerationId=old`,
      );
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        status: 'error',
        code: 'server_generation_changed',
        serverGenerationId: runtime.serverGenerationId,
      });
    }
    const pending = runtime.notificationDelta.query({
      terminalId: 'kkeagh01',
      venueId: eastVenueId,
      origin: 'weather',
      cursor: toNotificationDeltaCursor(0),
      serverGenerationId: runtime.serverGenerationId,
      requestedAt: now,
    });
    assert.deepEqual(pending, {
      status: 'initializing',
      terminalId: 'kkeagh01',
      venueId: eastVenueId,
      serverGenerationId: runtime.serverGenerationId,
      weatherState: 'initializing',
    });
    const stale = runtime.startupNotifications.inquire({
      terminalId: 'kkeagh01',
      venueId: eastVenueId,
      sessionId: '00000000-0000-4000-8000-000000000253',
      serverGenerationId: 'old',
      inquiredAt: now,
    });
    assert.deepEqual(stale, {
      status: 'error',
      code: 'server_generation_changed',
      serverGenerationId: runtime.serverGenerationId,
    });
    assert.deepEqual(
      db.retained.connection.prepare('SELECT COUNT(*) AS count FROM terminal_session').get(),
      { count: 0 },
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    fixture.cleanup();
  }
});

test('#253 AC10: XML初回throwの後にrecovery timerを一本登録し運転中のまま回復する', async (t) => {
  const fixture = createTemporaryTestDatabaseFixture();
  const db = initializeTestDatabases(fixture.config);
  const tasks = new Map<ReturnType<typeof setTimeout>, () => void>();
  let nextId = 0;
  const timerScheduler: PollingTimerScheduler = {
    setTimeout: (task) => {
      const id = ++nextId as unknown as ReturnType<typeof setTimeout>;
      tasks.set(id, task);
      return id;
    },
    clearTimeout: (id) => {
      tasks.delete(id);
    },
  };
  const service = new JmaXmlPollingService(db.weather.connection, {
    venueRegistry: testVenueRegistry,
    freshnessPolicy: { staleAfterSeconds: 300 },
    timerScheduler,
    clock: () => now,
  });
  const runtime = createStartupNotificationRuntime(
    db.weather.connection,
    () => now,
    testVenueRegistry,
    undefined,
    undefined,
    testTerminalRegistry,
    db.retained.connection,
    db.weatherDatabaseGenerationId,
  );
  runtime.connectPolling(service);
  const original = service.pollFeeds;
  let calls = 0;
  t.mock.method(
    service,
    'pollFeeds',
    async (...[trigger, kinds]: Parameters<typeof service.pollFeeds>) => {
      calls += 1;
      if (calls === 1) throw new Error('初回取得の試験失敗');
      return original.call(service, trigger, kinds);
    },
  );
  // 回復周期では外部通信を行わず4feedの成功を返す。
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>fixture</title><updated>2026-10-09T03:00:00Z</updated></feed>',
        { status: 200 },
      ),
  );
  try {
    await assert.rejects(service.start(), /試験失敗/);
    assert.equal(runtime.initialization.getStatus().initialFetchPhase, 'failed');
    assert.equal(tasks.size, 1);
    await service.start();
    assert.equal(tasks.size, 1);
    const task = [...tasks.values()][0]!;
    tasks.clear();
    task();
    const deadline = Date.now() + 5000;
    while (runtime.initialization.getStatus().initialFetchPhase !== 'completed') {
      if (Date.now() > deadline) throw new Error('回復しませんでした');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(runtime.initialization.isReady(eastVenueId), true);
    assert.equal(tasks.size, 1);
    assert.deepEqual(
      db.retained.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM notification_output_history WHERE source_type='initial_sync'",
        )
        .get(),
      { count: 1 },
    );
  } finally {
    await service.stop();
    assert.equal(tasks.size, 0);
    db.close();
    fixture.cleanup();
  }
});

test(
  '#253 AC13: main実プロセスは待受後の同期例外でも生存し、SIGTERMで両DBを閉じる',
  { timeout: 20000 },
  async () => {
    const { spawn } = await import('node:child_process');
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { createTestServerProcessEnv } = await import('./helpers/databasePair.js');
    const { createServer } = await import('node:net');
    const fixture = createTemporaryTestDatabaseFixture();
    const probe = createServer();
    probe.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => probe.once('listening', resolve));
    const address = probe.address();
    assert.ok(address && typeof address === 'object');
    const port = address.port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const marker = join(fixture.config.databasePath, '..', 'closed.txt');
    const child = spawn(
      process.execPath,
      [
        '--import',
        import.meta.resolve('tsx'),
        '--import',
        new URL('./helpers/initialSyncFailurePreload.mjs', import.meta.url).href,
        new URL('../src/server.ts', import.meta.url).pathname,
      ],
      {
        env: {
          ...createTestServerProcessEnv(fixture.config),
          NODE_ENV: 'production',
          DISABLE_POLLING: 'true',
          PORT: String(port),
          WX_TEST_CLOSE_MARKER: marker,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
    try {
      const deadline = Date.now() + 10000;
      for (;;) {
        if (child.exitCode !== null || Date.now() > deadline) throw new Error(output);
        const status = await fetch(
          `http://127.0.0.1:${port}/api/monitoring/status?terminalId=kkeagh01`,
        ).catch(() => null);
        const body = status ? ((await status.json()) as MonitoringStatusResponse) : null;
        if (
          body?.weatherRuntimes.acquisition.exitConfirmed &&
          body.weatherRuntimes.acquisition.stopReason === 'initialization_failed'
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const status = await fetch(
        `http://127.0.0.1:${port}/api/monitoring/status?terminalId=kkeagh01`,
      );
      assert.equal(status.status, 200);
      const delta = await fetch(
        `http://127.0.0.1:${port}/api/notifications/delta?origin=system&terminalId=kkeagh01`,
      );
      assert.equal(delta.status, 200);
      const feed = (await delta.json()) as NotificationDeltaReadyResponse;
      assert.deepEqual(
        feed.notifications.map((item) => item.changeType),
        ['initial_sync_failed', 'initialization_failed'],
      );
      assert.equal(child.exitCode, null);
      child.kill('SIGTERM');
      assert.equal(await exited, 0);
      assert.equal(readFileSync(marker, 'utf8'), 'close\nclose\nclose\n');
    } finally {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await exited;
      }
      fixture.cleanup();
    }
  },
);

test('#253 AC11: 会場評価の失敗を会場単位で公開し、再評価成功で解除する', async (t) => {
  const fixture = createTemporaryTestDatabaseFixture();
  const db = initializeTestDatabases(fixture.config);
  const runtime = createStartupNotificationRuntime(
    db.weather.connection,
    () => now,
    testVenueRegistry,
    undefined,
    undefined,
    testTerminalRegistry,
    db.retained.connection,
    db.weatherDatabaseGenerationId,
  );
  runtime.initialization.setInitialFetchPhase('completed');
  const mark = runtime.initialization.markVenueEvaluated.bind(runtime.initialization);
  let failOnce = true;
  t.mock.method(runtime.initialization, 'markVenueEvaluated', (venueId: typeof eastVenueId) => {
    if (venueId === eastVenueId && failOnce) {
      failOnce = false;
      throw new Error('会場評価の試験失敗');
    }
    mark(venueId);
  });
  try {
    await assert.rejects(runtime.evaluateVenues(), /会場の初期評価/);
    assert.equal(runtime.initialization.getWeatherState(eastVenueId), 'failed');
    for (const venueId of testVenueRegistry.listVenueIds().filter((venue) => venue !== eastVenueId))
      assert.equal(runtime.initialization.getWeatherState(venueId), 'ready');
    assert.deepEqual(runtime.initialization.getStatus().preparationFailures, [
      {
        stage: 'venue_evaluation',
        venueId: eastVenueId,
        failedAt: now,
        code: 'weather_preparation_failed',
      },
    ]);
    await runtime.evaluateVenues();
    assert.equal(runtime.initialization.getWeatherState(eastVenueId), 'ready');
    assert.deepEqual(runtime.initialization.getStatus().preparationFailures, []);
    assert.deepEqual(
      db.retained.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM notification_output_history WHERE source_type='initial_sync'",
        )
        .get(),
      { count: 1 },
    );
  } finally {
    db.close();
    fixture.cleanup();
  }
});
