import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  toNotificationDeltaCursor,
  resolveNotificationMessage,
  type NotificationOrigin,
} from '@wx-viewer-poc/shared';
import { createNotificationFeedController } from '../src/notifications/notificationFeedController.ts';
import {
  createNotificationUiState,
  receiveNotifications,
  confirmNotification,
  setNotificationTransport,
} from '../src/notifications/notificationStore.ts';
import { fetchNotificationDelta } from '../src/api/notificationDelta.ts';
import { createStartupNotificationClient } from '../src/api/startupNotifications.ts';
import { initializeTestDatabases } from '../../api/tests/helpers/databasePair.ts';
import {
  testVenueRegistry,
  testTerminalRegistry,
  eastVenueId,
} from '../../api/tests/helpers/venueConfigPreload.ts';
import { createStartupNotificationRuntime } from '../../api/src/server.ts';
import { createStartupNotificationService } from '../../api/src/notifications/startupNotificationService.ts';
import { createApp } from '../../api/src/app.ts';
import { recordNotificationOutputHistory } from '../../api/src/repositories/notificationOutputHistoryRepository.ts';

const now = '2026-10-09T03:00:00.000Z';
async function until(condition: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('通知処理が期限内に完了しませんでした');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

for (const mode of ['K', 'H'] as const)
  test(`#253 AC1-8: ${mode}端末の本番controller→HTTP→DBで準備待ち・境界・再起動を検証`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'independent-feed-'));
    const db = initializeTestDatabases({
      databasePath: join(directory, 'weather.sqlite'),
      migrationsDirectory: new URL('../../api/migrations', import.meta.url).pathname,
    });
    const insert = (id: string, origin: NotificationOrigin) =>
      recordNotificationOutputHistory(db.retained.connection, {
        notificationId: id,
        weatherDatabaseGenerationId: null,
        category: 'question',
        sourceType: origin === 'system' ? 'fetch_health' : 'warning_current',
        sourceVersion: null,
        targetAreaJson: JSON.stringify([
          { kind: 'equipment', codeType: 'venue', code: eastVenueId, name: '東地区' },
        ]),
        occurredAt: now,
        detectedAt: now,
        changeType: 'fixture',
        ackRequired: true,
        summary: id,
        relatedRefsJson: '[]',
        origin,
        detectionContext: 'initial',
        isTraining: false,
        messageDefinitionId: null,
        messageDefinitionVersion: null,
      });
    insert('before-start', 'system');
    const runtime = () =>
      createStartupNotificationRuntime(
        db.weather.connection,
        () => now,
        testVenueRegistry,
        undefined,
        undefined,
        testTerminalRegistry,
        db.retained.connection,
        db.weatherDatabaseGenerationId,
      );
    let current = runtime();
    const startup = () =>
      createStartupNotificationService({
        weatherConnection: db.weather.connection,
        retainedConnection: db.retained.connection,
        weatherDatabaseGenerationId: db.weatherDatabaseGenerationId,
        initialization: current.initialization,
        venueRegistry: testVenueRegistry,
        terminalRegistry: testTerminalRegistry,
        serverGenerationId: current.serverGenerationId,
        projector: () => ({
          notifications: [
            {
              outputId: `snapshot-${current.serverGenerationId}`,
              category: 'question',
              origin: 'weather',
              sourceType: 'warning_current',
              sourceVersion: null,
              targets: [
                { kind: 'equipment', codeType: 'venue', code: eastVenueId, name: '東地区' },
              ],
              occurredAt: now,
              relatedRefs: [],
              isTraining: false,
              output: resolveNotificationMessage(
                {
                  notificationId: 'snapshot',
                  category: 'question',
                  origin: 'weather',
                  sourceType: 'warning_current',
                  sourceVersion: null,
                  changeType: 'new',
                  targets: [{ kind: 'area', codeType: 'venue', code: eastVenueId, name: '東地区' }],
                  occurredAt: now,
                  detectedAt: now,
                  relatedRefs: [],
                  detectionContext: 'initial',
                  isTraining: false,
                },
                { definitionId: 'weather-warning-issued' },
              ),
            },
          ],
        }),
      });
    let currentStartup = startup();
    const app = createApp({
      terminalRegistry: testTerminalRegistry,
      venueRegistry: testVenueRegistry,
      notificationDelta: { query: (input) => current.notificationDelta.query(input) },
      startupNotifications: { inquire: (input) => currentStartup.inquire(input) },
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const originalFetch = window.fetch;
    const transport = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetch(`${base}${input}`, init);
      const path = String(input);
      // system継続とstartup readyの完了順を両方向に制御する。
      if (
        (mode === 'K' && path.includes('origin=system') && path.includes('cursor=')) ||
        (mode === 'H' && path === '/api/notifications/startup' && response.status === 200)
      )
        await new Promise((resolve) => setTimeout(resolve, 30));
      return response;
    };
    window.fetch = transport;
    const client = createStartupNotificationClient({
      getSession: () => ({
        status: 'ready',
        sessionId: '00000000-0000-4000-8000-000000000253',
        persistence: 'memory',
      }),
      fetch: transport,
    });
    let state = createNotificationUiState();
    const received: string[] = [];
    const chimes: string[] = [];
    const timers = new Map<number, { task: () => void; delay: number }>();
    let timerId = 0;
    const run = (delay: number) => {
      for (const [id, timer] of [...timers])
        if (timer.delay === delay) {
          timers.delete(id);
          timer.task();
        }
    };
    const controller = createNotificationFeedController({
      terminalId: mode === 'K' ? 'kkeagh01' : 'hkeagh01',
      fetchDelta: fetchNotificationDelta,
      fetchStartup: client.fetchStartupNotifications,
      receive: (items) => {
        received.push(...items.map((item) => item.feedKey));
        const result = receiveNotifications(state, items, mode, Date.parse(now));
        state = result.state;
        if (result.chime) chimes.push(result.chime.feedKey);
      },
      onTransportState: (update) => {
        state = setNotificationTransport(state, update);
      },
      setTimer: (task, delay) => {
        const id = ++timerId;
        timers.set(id, { task, delay });
        return id as never;
      },
      clearTimer: (id) => {
        timers.delete(id as never);
      },
    });
    try {
      insert('system-started', 'system'); // sequence 2
      insert('initial-weather', 'weather'); // sequence 3
      controller.start();
      await until(() => state.transport.weather === 'pending');
      assert.deepEqual(received, ['delta:system-started']);
      assert.deepEqual(chimes, mode === 'K' ? ['delta:system-started'] : []);
      assert.equal(state.phase, 'ready');
      assert.equal(state.operationMessage, '');
      assert.equal(
        db.retained.connection.prepare('SELECT COUNT(*) AS n FROM terminal_session').get().n,
        0,
      );
      current.initialization.setInitialFetchPhase('completed');
      current.initialization.markVenueEvaluated(eastVenueId);
      insert('system-boundary', 'system'); // sequence 4
      run(15000);
      run(1000);
      await until(() => state.transport.weather === 'ready' && timers.size === 2);
      assert.equal(
        received.indexOf('delta:system-boundary') <
          received.indexOf(`startup:snapshot-${current.serverGenerationId}`),
        mode === 'H',
      );
      insert('normal-weather', 'weather'); // sequence 5
      run(15000);
      await until(
        () =>
          received.includes('delta:normal-weather') && received.includes('delta:system-boundary'),
      );
      assert.deepEqual(
        [...received].sort(),
        [
          'delta:normal-weather',
          'delta:system-boundary',
          'delta:system-started',
          `startup:snapshot-${current.serverGenerationId}`,
        ].sort(),
      );
      state = confirmNotification(state, 'delta:system-started', mode);
      const oldGeneration = current.serverGenerationId;
      const sessionCount = db.retained.connection
        .prepare('SELECT COUNT(*) AS n FROM terminal_session')
        .get().n;
      current = runtime();
      currentStartup = startup();
      insert('new-generation', 'system');
      const stale = await transport('/api/notifications/startup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          terminalId: 'kkeagh01',
          sessionId: '00000000-0000-4000-8000-000000000999',
          serverGenerationId: oldGeneration,
        }),
      });
      assert.equal(stale.status, 409);
      assert.deepEqual(await stale.json(), {
        status: 'error',
        code: 'server_generation_changed',
        serverGenerationId: current.serverGenerationId,
      });
      assert.equal(
        db.retained.connection.prepare('SELECT COUNT(*) AS n FROM terminal_session').get().n,
        sessionCount,
      );
      run(15000);
      await until(() => received.includes('delta:new-generation'));
      assert.equal(state.confirmedFeedKeys.has('delta:system-started'), true);
      assert.equal(received.filter((id) => id === 'delta:system-started').length, 1);
      assert.equal(received.filter((id) => id === 'delta:new-generation').length, 1);
      assert.equal(state.cursors.system, toNotificationDeltaCursor(6));
    } finally {
      controller.stop();
      window.fetch = originalFetch;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

test('#253 AC6/7: 通信・session障害の再試行は独立し旧世代の遅延startup応答を破棄する', async () => {
  const timers = new Map<number, { task: () => void; delay: number }>();
  let id = 0;
  const received: string[] = [];
  let state = createNotificationUiState();
  let systemCalls = 0;
  let startupCalls = 0;
  let releaseOld!: (
    result: Awaited<
      ReturnType<ReturnType<typeof createStartupNotificationClient>['fetchStartupNotifications']>
    >,
  ) => void;
  const startupGenerations: string[] = [];
  const ready = (generation: string) => ({
    status: 'ready' as const,
    origin: 'system' as const,
    terminalId: 'kkeagh01',
    venueId: eastVenueId,
    serverGenerationId: generation,
    generatedAt: now,
    cursor: toNotificationDeltaCursor(2),
    notifications: [],
    skippedCount: 0,
  });
  const controller = createNotificationFeedController({
    terminalId: 'kkeagh01',
    fetchDelta: async () => {
      systemCalls++;
      if (systemCalls === 2) return { status: 'unavailable' };
      return systemCalls === 4
        ? { status: 'server_generation_changed', serverGenerationId: 'B' }
        : { status: 'ready', response: ready(systemCalls > 4 ? 'B' : 'A') };
    },
    fetchStartup: async (_terminal, generation) => {
      startupGenerations.push(generation);
      startupCalls++;
      if (startupCalls === 1) return { status: 'unavailable', reason: 'session' };
      if (startupCalls === 2)
        return new Promise((resolve) => {
          releaseOld = resolve;
        });
      return {
        status: 'initializing',
        terminalId: 'kkeagh01',
        venueId: eastVenueId,
        serverGenerationId: 'B',
        weatherState: 'failed',
      };
    },
    receive: (items) => received.push(...items.map((item) => item.feedKey)),
    onTransportState: (update) => {
      state = setNotificationTransport(state, update);
    },
    setTimer: (task, delay) => {
      timers.set(++id, { task, delay });
      return id as never;
    },
    clearTimer: (timer) => {
      timers.delete(timer as never);
    },
  });
  const run = (delay: number) => {
    for (const [key, timer] of [...timers])
      if (timer.delay === delay) {
        timers.delete(key);
        timer.task();
      }
  };
  try {
    controller.start();
    await until(() => state.transport.weather === 'retrying');
    run(15000);
    await until(() => systemCalls === 2);
    assert.equal(state.transport.system, 'retrying');
    assert.equal(state.transport.weather, 'retrying');
    assert.equal(state.operationMessage, 'システム通知・気象通知を受信できません。再試行します。');
    run(1000);
    await until(() => startupCalls === 2 && systemCalls === 3);
    assert.equal(state.transport.system, 'ready');
    assert.equal(state.transport.weather, 'retrying');
    assert.equal(state.operationMessage, '気象通知を受信できません。再試行します。');
    run(15000);
    await until(() => startupCalls === 3);
    releaseOld({
      status: 'ready',
      terminalId: 'kkeagh01',
      venueId: eastVenueId,
      serverGenerationId: 'A',
      generatedAt: now,
      cursor: toNotificationDeltaCursor(999),
      session: { kind: 'startup', firstInquiredAt: now },
      warningClaimed: true,
      notifications: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(startupGenerations, ['A', 'A', 'B']);
    assert.deepEqual(state.cursors, { system: '2', weather: null });
    assert.equal(state.transport.weather, 'pending');
    assert.equal(state.operationMessage, '');
    assert.deepEqual(received, []);
  } finally {
    controller.stop();
    assert.equal(timers.size, 0);
  }
});
