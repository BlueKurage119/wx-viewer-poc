import { toNotificationDeltaCursor } from '@wx-viewer-poc/shared';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { initializeDatabases, resolveDatabasePairConfig } from '../src/database/index.js';
import { resetWeatherDatabase } from '../src/database/resetWeatherDatabase.js';
import { createApp } from '../src/app.js';
import { createMonitoringHistoryService } from '../src/monitoring/monitoringHistoryService.js';
import {
  createFetchControlService,
  type FetchControlTargets,
} from '../src/services/fetchControlService.js';
import {
  recordNotificationOutputHistory,
  recordTelegramReception,
} from '../src/repositories/index.js';
import {
  createStartupNotificationService,
  StartupNotificationInitialization,
} from '../src/notifications/startupNotificationService.js';
import { createNotificationDeltaService } from '../src/notifications/notificationDeltaService.js';
import {
  testVenueRegistry,
  testTerminalRegistry,
  eastVenueId,
} from './helpers/venueConfigPreload.js';
const now = '2026-10-07T12:00:00.000Z';
const requestId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const retainedTables = [
  'operation_history',
  'notification_output_history',
  'terminal_session',
  'startup_warning_claim',
  'startup_notification_inquiry',
];
async function listen(app: ReturnType<typeof createApp>) {
  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('待受portなし');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
test('Issue #247 AC5/6/9: 実reset後も操作照合・session・通知sequenceを保持し再利用原文をHTTPで拒否', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'wx247-lifecycle-'));
  const config = resolveDatabasePairConfig({
    WX_VIEWER_WEATHER_DB_PATH: join(directory, 'weather.sqlite3'),
    WX_VIEWER_RETAINED_DB_PATH: join(directory, 'retained.sqlite3'),
  });
  let pair = initializeDatabases(config);
  let server: Awaited<ReturnType<typeof listen>> | undefined;
  let startCalls = 0;
  const targets: FetchControlTargets = {
    start: async () => {
      startCalls++;
    },
    stop: async () => {},
    forceRefresh: async () => {},
    runRecovery: async () => {},
    isRunning: () => false,
    isUpstreamAllowedNow: () => true,
  };
  const saveReception = (body: string) =>
    recordTelegramReception(pair.weather.connection, {
      fetchAttemptId: null,
      feedKind: null,
      feedEntryId: null,
      documentUrl: 'https://example.invalid/fixture.xml',
      telegramType: 'VPWW55',
      title: body,
      controlStatus: 'normal',
      infoType: null,
      eventId: null,
      serial: null,
      controlDateTime: null,
      reportDateTime: null,
      targetDateTime: null,
      receivedAt: now,
      rawBody: body,
      bodyBytes: body.length,
      contentHash: null,
      areas: [],
      adoptions: [],
    });
  const saveNotification = (id: string) =>
    recordNotificationOutputHistory(pair.retained.connection, {
      notificationId: id,
      category: 'warning',
      sourceType: 'warning_current',
      sourceVersion: null,
      targetAreaJson: JSON.stringify([
        { kind: 'area', codeType: 'jma_municipal_warning_area', code: '1310800', name: '江東区' },
      ]),
      occurredAt: now,
      detectedAt: now,
      changeType: 'new',
      ackRequired: false,
      summary: '旧通知の表示内容',
      relatedRefsJson: '[{"type":"telegram_reception","ref":"1"}]',
      origin: 'weather',
      detectionContext: 'normal',
      isTraining: false,
      messageDefinitionId: null,
      messageDefinitionVersion: null,
      weatherDatabaseGenerationId: pair.weatherDatabaseGenerationId,
    });
  const initialization = new StartupNotificationInitialization();
  initialization.setInitialFetchPhase('completed');
  initialization.markVenueEvaluated(eastVenueId);
  const runtime = (generation: string) => {
    const control = createFetchControlService({
      connection: pair.retained.connection,
      targets,
      now: () => now,
    });
    const startup = createStartupNotificationService({
      weatherConnection: pair.weather.connection,
      retainedConnection: pair.retained.connection,
      weatherDatabaseGenerationId: pair.weatherDatabaseGenerationId,
      venueRegistry: testVenueRegistry,
      terminalRegistry: testTerminalRegistry,
      initialization,
      serverGenerationId: generation,
      now: () => now,
    });
    const history = createMonitoringHistoryService({
      weatherConnection: pair.weather.connection,
      retainedConnection: pair.retained.connection,
      weatherDatabaseGenerationId: pair.weatherDatabaseGenerationId,
      now: () => now,
    });
    return { control, startup, history };
  };
  try {
    assert.equal(saveReception('旧原文').id, 1);
    const old = saveNotification('old');
    const first = runtime('server-before-reset');
    await first.control.request('start', requestId);
    const firstStartup = first.startup.inquire({
      serverGenerationId: 'server-before-reset',
      terminalId: 'hkeagh01',
      venueId: eastVenueId,
      sessionId,
      inquiredAt: now,
    });
    assert.equal(firstStartup.status, 'ready');
    const rows = retainedTables.map((t) =>
      pair.retained.connection.prepare(`SELECT * FROM ${t}`).all(),
    );
    const oldGeneration = pair.weatherDatabaseGenerationId;
    pair.close();
    const plan = resetWeatherDatabase(config, { mode: 'plan', confirmStopped: true });
    resetWeatherDatabase(config, { mode: 'apply', confirmStopped: true, confirm: plan.planDigest });
    pair = initializeDatabases(config);
    assert.notEqual(pair.weatherDatabaseGenerationId, oldGeneration);
    assert.deepEqual(
      retainedTables.map((t) => pair.retained.connection.prepare(`SELECT * FROM ${t}`).all()),
      rows,
    );
    assert.equal(saveReception('別原文').id, 1);
    const second = runtime('server-after-reset');
    server = await listen(
      createApp({
        fetchControl: second.control,
        monitoringHistory: second.history,
        startupNotifications: second.startup,
        terminalRegistry: testTerminalRegistry,
      }),
    );
    const same = await fetch(`${server.url}/api/control/fetch/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId }),
    });
    assert.equal(same.status, 200);
    assert.equal(startCalls, 1);
    const different = await fetch(`${server.url}/api/control/fetch/stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId }),
    });
    assert.equal(different.status, 409);
    const raw = await fetch(
      `${server.url}/api/monitoring/notification-outputs/${old.id}/reception`,
    );
    assert.equal(raw.status, 410);
    assert.deepEqual(await raw.json(), {
      status: 'error',
      code: 'notification_reception_unavailable',
      reason: 'weather_generation_changed',
    });
    const resumed = second.startup.inquire({
      serverGenerationId: 'server-after-reset',
      terminalId: 'hkeagh01',
      venueId: eastVenueId,
      sessionId,
      inquiredAt: now,
    });
    assert.equal(resumed.status, 'ready');
    if (resumed.status !== 'ready') throw new Error('readyなし');
    assert.equal(resumed.session.kind, 'continuation');
    const sequence = saveNotification('new').id;
    assert.ok(sequence > old.id);
    const delta = createNotificationDeltaService({
      serverStartCursor: toNotificationDeltaCursor(0),
      initialization: (() => {
        const state = new StartupNotificationInitialization();
        state.setInitialFetchPhase('completed');
        state.markVenueEvaluated(eastVenueId);
        return state;
      })(),
      connection: pair.retained.connection,
      venueRegistry: testVenueRegistry,
      serverGenerationId: 'server-after-reset',
      now: () => now,
    });
    const result = delta.query({
      origin: 'weather',
      serverGenerationId: 'server-after-reset',
      terminalId: 'hkeagh01',
      venueId: eastVenueId,
      cursor: resumed.cursor,
      requestedAt: now,
    });
    assert.equal(result.status, 'ready');
    if (result.status !== 'ready') throw new Error('差分readyなし');
    assert.deepEqual(
      result.notifications.map((item) => item.notificationId),
      ['new'],
    );
    const next = delta.query({
      origin: 'weather',
      serverGenerationId: 'server-after-reset',
      terminalId: 'hkeagh01',
      venueId: eastVenueId,
      cursor: result.cursor,
      requestedAt: now,
    });
    assert.equal(next.status, 'ready');
    if (next.status !== 'ready') throw new Error('差分readyなし');
    assert.deepEqual(next.notifications, []);
  } finally {
    if (server) await server.close();
    pair.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Issue #247 AC4: reset後のcache単独はunavailableで、新索引取得後に正常空へ復旧する', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'wx247-image-recovery-'));
  const config = resolveDatabasePairConfig({
    WX_VIEWER_WEATHER_DB_PATH: join(directory, 'weather.sqlite3'),
    WX_VIEWER_RETAINED_DB_PATH: join(directory, 'retained.sqlite3'),
  });
  let pair = initializeDatabases(config);
  const { NowcastService } = await import('../src/polling/nowcastService.js');
  const { mkdirSync, writeFileSync, readFileSync } = await import('node:fs');
  const cacheRoot = join(directory, 'cache');
  mkdirSync(cacheRoot);
  writeFileSync(join(cacheRoot, 'old-tile'), '古いcache');
  const createImage = () =>
    new NowcastService(pair.weather.connection, {
      cacheRoot,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: async () => Response.json([]),
      clock: () => now,
    });
  try {
    const original = createImage();
    await original.refreshTimes();
    await original.waitForIdle();
    assert.equal(original.readCatalog().products.N1.availability, 'available');
    pair.close();
    const plan = resetWeatherDatabase(config, { mode: 'plan', confirmStopped: true });
    resetWeatherDatabase(config, { mode: 'apply', confirmStopped: true, confirm: plan.planDigest });
    pair = initializeDatabases(config);
    const image = createImage();
    const unavailable = image.readCatalog();
    assert.equal(unavailable.products.N1.availability, 'unavailable');
    assert.equal(unavailable.products.N2.availability, 'unavailable');
    await image.refreshTimes();
    const recovered = image.readCatalog();
    assert.equal(recovered.products.N1.availability, 'available');
    assert.equal(recovered.products.N2.availability, 'available');
    assert.deepEqual(recovered.products.N1.snapshot?.frames, []);
    assert.equal(readFileSync(join(cacheRoot, 'old-tile'), 'utf8'), '古いcache');
    await image.waitForIdle();
  } finally {
    pair.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
