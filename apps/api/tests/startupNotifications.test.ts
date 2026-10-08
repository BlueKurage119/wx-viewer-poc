import { toNotificationDeltaCursor } from '@wx-viewer-poc/shared';
import {
  testTerminalRegistry,
  testVenueRegistry,
  eastVenueId,
  trcVenueId,
} from './helpers/venueConfigPreload.js';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import test from 'node:test';

import { initializeDatabase, initializeDatabases } from '../src/database/index.js';
import { createApp } from '../src/app.js';
import { createNotificationDeltaService } from '../src/notifications/notificationDeltaService.js';
import { projectStartupCurrentNotifications } from '../src/notifications/startupCurrentNotificationProjector.js';
import {
  createStartupNotificationService,
  StartupNotificationInitialization,
} from '../src/notifications/startupNotificationService.js';
import {
  saveBosaiBulletin,
  saveWarningCurrentSnapshot,
  recordNotificationOutputHistory,
} from '../src/repositories/index.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');
const now = '2026-09-13T12:00:00.000Z';

function createDb() {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-startup-notification-'));
  const context = initializeDatabases({
    weather: {
      databasePath: join(directory, 'weather.sqlite3'),
      migrationsDirectory: join(migrationsDirectory, 'weather'),
      role: 'weather',
    },
    retained: {
      databasePath: join(directory, 'retained.sqlite3'),
      migrationsDirectory: join(migrationsDirectory, 'retained'),
      role: 'retained',
    },
  });
  return { context, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

const metadata = {
  source: 'test',
  issuedAt: now,
  validAt: null,
  validFrom: null,
  validTo: null,
  fetchedAt: now,
  lastSuccessAt: now,
  availability: 'available' as const,
  sourceVersion: 'source-v1',
};

function saveEastCurrent(connection: ReturnType<typeof initializeDatabase>['connection']) {
  saveWarningCurrentSnapshot(connection, {
    areaCode: '1310800',
    areaName: '江東区',
    metadata,
    telegram: {
      controlStatus: 'normal',
      infoType: '発表',
      eventId: 'event-1',
      reportDateTime: '2026-09-13T11:00:00.000Z',
      controlDateTime: '2026-09-13T11:00:00.000Z',
    },
    items: [
      {
        sequence: 1,
        kindCode: '12',
        kindName: '大雨注意報',
        kindStatus: '発表',
        lastKindCode: null,
        lastKindName: null,
        significancyCode: null,
        significancyName: null,
        warningLevel: null,
        attentionText: null,
        kindIssuedAt: '2026-09-13T11:00:01.000Z',
        sourceTelegram: 'VPWW53',
      },
      {
        sequence: 2,
        kindCode: '02',
        kindName: '暴風警報',
        kindStatus: '発表',
        lastKindCode: null,
        lastKindName: null,
        significancyCode: null,
        significancyName: null,
        warningLevel: null,
        attentionText: null,
        kindIssuedAt: '2026-09-13T11:00:02.000Z',
        sourceTelegram: 'VPWW53',
      },
      {
        sequence: 3,
        kindCode: '32',
        kindName: '大雨特別警報',
        kindStatus: '発表',
        lastKindCode: null,
        lastKindName: null,
        significancyCode: null,
        significancyName: null,
        warningLevel: null,
        attentionText: null,
        kindIssuedAt: '2026-09-13T11:00:03.000Z',
        sourceTelegram: 'VPWW53',
      },
    ],
  });
}

function saveEastBulletin(
  connection: ReturnType<typeof initializeDatabase>['connection'],
  reportDateTime = now,
  controlStatus: 'normal' | 'training' | 'test' = 'normal',
) {
  saveBosaiBulletin(connection, {
    eventId: `bulletin-${reportDateTime}`,
    controlStatus,
    infoType: '発表',
    reportDateTime,
    controlDateTime: reportDateTime,
    title: '気象防災速報',
    headlineText: 'headline',
    informationTag: '線状降水帯発生',
    hasSighting: null,
    isCancelled: false,
    metadata,
    areas: [
      {
        areaCode: '1310800',
        areaName: '江東区',
        codeType: 'municipal',
        sequence: 1,
        informationType: null,
      },
    ],
  });
}

function readyInitialization() {
  const initialization = new StartupNotificationInitialization();
  initialization.setInitialFetchPhase('completed');
  initialization.markVenueEvaluated(eastVenueId);
  initialization.markVenueEvaluated(trcVenueId);
  return initialization;
}

async function withServer<T>(
  app: ReturnType<typeof createApp>,
  run: (baseUrl: string) => Promise<T>,
) {
  const server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('missing TCP address');
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('AC3-5/11: 会場ごとの claim は一度だけで、継続問い合わせは warning 以外を監査スナップショットと同じ内容で返す', () => {
  const { context, cleanup } = createDb();
  try {
    saveEastCurrent(context.weather.connection);
    saveEastBulletin(context.weather.connection);
    let id = 0;
    const service = createStartupNotificationService({
      weatherConnection: context.weather.connection,
      retainedConnection: context.retained.connection,
      weatherDatabaseGenerationId: context.weatherDatabaseGenerationId,
      initialization: readyInitialization(),
      venueRegistry: testVenueRegistry,
      terminalRegistry: testTerminalRegistry,
      serverGenerationId: '00000000-0000-4000-8000-0000000000aa',
      now: () => now,
      outputIdFactory: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    });
    const request = {
      serverGenerationId: '00000000-0000-4000-8000-0000000000aa',
      terminalId: 'hkeagh01',
      venueId: eastVenueId,
      sessionId: '00000000-0000-4000-8000-000000000001',
      inquiredAt: now,
    };
    const first = service.inquire(request);
    assert.equal(first.status, 'ready');
    if (first.status !== 'ready') throw new Error('expected ready');
    assert.equal(first.warningClaimed, true);
    assert.deepEqual(
      first.notifications.map((item) => item.category),
      ['warning', 'question', 'emergency', 'question'],
    );
    assert.deepEqual(first.notifications[0]!.output, {
      ackRequired: false,
      summary: '気象注意報発表\n江東区\n大雨注意報',
      messageDefinition: { id: 'weather-advisory-issued', version: '1' },
      display: { title: '気象注意報発表', target: '江東区', content: '大雨注意報' },
      action: null,
    });
    const continuation = service.inquire(request);
    assert.equal(continuation.status, 'ready');
    if (continuation.status !== 'ready') throw new Error('expected ready');
    assert.equal(continuation.warningClaimed, false);
    assert.equal(continuation.session.kind, 'continuation');
    assert.deepEqual(
      continuation.notifications.map((item) => item.category),
      ['question', 'emergency', 'question'],
    );
    const trc = service.inquire({
      serverGenerationId: '00000000-0000-4000-8000-0000000000aa',
      terminalId: 'htrcph01',
      venueId: trcVenueId,
      sessionId: '00000000-0000-4000-8000-000000000003',
      inquiredAt: now,
    });
    assert.equal(trc.status, 'ready');
    if (trc.status !== 'ready') throw new Error('expected ready');
    assert.equal(trc.warningClaimed, true);
    const restarted = createStartupNotificationService({
      weatherConnection: context.weather.connection,
      retainedConnection: context.retained.connection,
      weatherDatabaseGenerationId: context.weatherDatabaseGenerationId,
      initialization: readyInitialization(),
      venueRegistry: testVenueRegistry,
      terminalRegistry: testTerminalRegistry,
      serverGenerationId: '00000000-0000-4000-8000-0000000000bb',
      now: () => now,
      outputIdFactory: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    });
    const afterRestart = restarted.inquire({
      ...request,
      serverGenerationId: '00000000-0000-4000-8000-0000000000bb',
    });
    assert.equal(afterRestart.status, 'ready');
    if (afterRestart.status !== 'ready') throw new Error('expected ready');
    assert.equal(afterRestart.warningClaimed, false);
    const freshAfterRestart = restarted.inquire({
      ...request,
      serverGenerationId: '00000000-0000-4000-8000-0000000000bb',
      sessionId: '00000000-0000-4000-8000-000000000004',
    });
    assert.equal(freshAfterRestart.status, 'ready');
    if (freshAfterRestart.status !== 'ready') throw new Error('expected ready');
    assert.equal(freshAfterRestart.warningClaimed, true);
    const rows = context.retained.connection
      .prepare(
        'SELECT warning_claimed, response_json FROM startup_notification_inquiry ORDER BY id',
      )
      .all() as Array<{ warning_claimed: number; response_json: string }>;
    assert.equal(rows.length, 5);
    assert.equal(rows[0]!.warning_claimed, 1);
    assert.deepEqual(JSON.parse(rows[0]!.response_json), first);
    assert.equal(
      (
        context.retained.connection
          .prepare('SELECT COUNT(*) AS count FROM startup_warning_claim')
          .get() as {
          count: number;
        }
      ).count,
      3,
    );
  } finally {
    context.close();
    cleanup();
  }
});

test('AC2/7/9/10: 未初期化は副作用なし、投影失敗は rollback、速報は下限含む・3時間上限除外', () => {
  const { context, cleanup } = createDb();
  try {
    const initialization = new StartupNotificationInitialization();
    const unavailable = createStartupNotificationService({
      weatherConnection: context.weather.connection,
      retainedConnection: context.retained.connection,
      weatherDatabaseGenerationId: context.weatherDatabaseGenerationId,
      initialization,
      venueRegistry: testVenueRegistry,
      terminalRegistry: testTerminalRegistry,
      serverGenerationId: '00000000-0000-4000-8000-0000000000aa',
      now: () => now,
    });
    assert.deepEqual(
      unavailable.inquire({
        serverGenerationId: '00000000-0000-4000-8000-0000000000aa',
        terminalId: 'hkeagh01',
        venueId: eastVenueId,
        sessionId: '00000000-0000-4000-8000-000000000010',
        inquiredAt: now,
      }),
      {
        status: 'initializing',
        venueId: eastVenueId,
        terminalId: 'hkeagh01',
        serverGenerationId: '00000000-0000-4000-8000-0000000000aa',
        weatherState: 'initializing',
      },
    );
    assert.equal(
      (
        context.retained.connection
          .prepare('SELECT COUNT(*) AS count FROM terminal_session')
          .get() as {
          count: number;
        }
      ).count,
      0,
    );
    const rollback = createStartupNotificationService({
      weatherConnection: context.weather.connection,
      retainedConnection: context.retained.connection,
      weatherDatabaseGenerationId: context.weatherDatabaseGenerationId,
      initialization: readyInitialization(),
      venueRegistry: testVenueRegistry,
      terminalRegistry: testTerminalRegistry,
      serverGenerationId: '00000000-0000-4000-8000-0000000000aa',
      now: () => now,
      projector: () => {
        throw new Error('projector failure');
      },
    });
    assert.throws(() =>
      rollback.inquire({
        serverGenerationId: '00000000-0000-4000-8000-0000000000aa',
        terminalId: 'hkeagh01',
        venueId: eastVenueId,
        sessionId: '00000000-0000-4000-8000-000000000011',
        inquiredAt: now,
      }),
    );
    for (const table of [
      'terminal_session',
      'startup_warning_claim',
      'startup_notification_inquiry',
    ]) {
      assert.equal(
        (
          context.retained.connection.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
            count: number;
          }
        ).count,
        0,
      );
    }
    const auditRollback = createStartupNotificationService({
      weatherConnection: context.weather.connection,
      retainedConnection: context.retained.connection,
      weatherDatabaseGenerationId: context.weatherDatabaseGenerationId,
      initialization: readyInitialization(),
      venueRegistry: testVenueRegistry,
      terminalRegistry: testTerminalRegistry,
      serverGenerationId: '00000000-0000-4000-8000-0000000000aa',
      now: () => now,
      recordInquiry: () => {
        throw new Error('audit failure');
      },
    });
    assert.throws(() =>
      auditRollback.inquire({
        serverGenerationId: '00000000-0000-4000-8000-0000000000aa',
        terminalId: 'hkeagh01',
        venueId: eastVenueId,
        sessionId: '00000000-0000-4000-8000-000000000012',
        inquiredAt: now,
      }),
    );
    for (const table of [
      'terminal_session',
      'startup_warning_claim',
      'startup_notification_inquiry',
    ]) {
      assert.equal(
        (
          context.retained.connection.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
            count: number;
          }
        ).count,
        0,
      );
    }
    saveEastBulletin(context.weather.connection, '2026-09-13T09:00:00.000Z');
    saveEastBulletin(context.weather.connection, '2026-09-13T09:00:00.001Z');
    saveEastBulletin(context.weather.connection, '2026-09-13T12:00:00.000Z');
    const projection = projectStartupCurrentNotifications(context.weather.connection, {
      venueRegistry: testVenueRegistry,
      venueId: eastVenueId,
      now,
      includeWarningCategory: true,
    });
    assert.deepEqual(
      projection.notifications.map((item) => item.occurredAt),
      ['2026-09-13T09:00:00.001Z', '2026-09-13T12:00:00.000Z'],
    );
    saveEastBulletin(context.weather.connection, '2026-09-13T11:59:00.000Z', 'training');
    saveEastBulletin(context.weather.connection, '2026-09-13T11:58:00.000Z', 'test');
    const trainingProjection = projectStartupCurrentNotifications(context.weather.connection, {
      venueRegistry: testVenueRegistry,
      venueId: eastVenueId,
      now,
      includeWarningCategory: true,
    });
    assert.deepEqual(
      trainingProjection.notifications
        .filter((item) => item.relatedRefs[0]!.ref === 'bulletin-2026-09-13T11:59:00.000Z')
        .map((item) => item.isTraining),
      [true],
    );
    assert.equal(
      trainingProjection.notifications.some(
        (item) => item.relatedRefs[0]!.ref === 'bulletin-2026-09-13T11:58:00.000Z',
      ),
      false,
    );
  } finally {
    context.close();
    cleanup();
  }
});

test('AC1/13: HTTP endpoint は JSON 契約・入力エラー・初期化中を区別し、health を維持する', async () => {
  const { context, cleanup } = createDb();
  try {
    const service = createStartupNotificationService({
      weatherConnection: context.weather.connection,
      retainedConnection: context.retained.connection,
      weatherDatabaseGenerationId: context.weatherDatabaseGenerationId,
      initialization: new StartupNotificationInitialization(),
      venueRegistry: testVenueRegistry,
      terminalRegistry: testTerminalRegistry,
      serverGenerationId: '00000000-0000-4000-8000-0000000000aa',
      now: () => now,
    });
    await withServer(
      createApp({
        terminalRegistry: testTerminalRegistry,
        startupNotifications: service,
        venueRegistry: testVenueRegistry,
      }),
      async (baseUrl) => {
        const health = await fetch(`${baseUrl}/api/health`);
        assert.equal(health.status, 200);
        assert.deepEqual(await health.json(), { status: 'ok' });
        const initializing = await fetch(`${baseUrl}/api/notifications/startup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            terminalId: 'hkeagh01',
            sessionId: '00000000-0000-4000-8000-000000000020',
            serverGenerationId: '00000000-0000-4000-8000-0000000000aa',
          }),
        });
        assert.equal(initializing.status, 202);
        assert.deepEqual(await initializing.json(), {
          status: 'initializing',
          venueId: eastVenueId,
          terminalId: 'hkeagh01',
          serverGenerationId: '00000000-0000-4000-8000-0000000000aa',
          weatherState: 'initializing',
        });
        const invalid = await fetch(`${baseUrl}/api/notifications/startup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            terminalId: 'hkeagh01',
            sessionId: 'bad',
            extra: true,
            serverGenerationId: '00000000-0000-4000-8000-0000000000aa',
          }),
        });
        assert.equal(invalid.status, 400);
        assert.deepEqual(await invalid.json(), { status: 'error', code: 'invalid_request' });
        const unknown = await fetch(`${baseUrl}/api/notifications/startup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            terminalId: 'unknown',
            sessionId: '00000000-0000-4000-8000-000000000021',
            serverGenerationId: '00000000-0000-4000-8000-0000000000aa',
          }),
        });
        assert.equal(unknown.status, 404);
        assert.deepEqual(await unknown.json(), { status: 'error', code: 'terminal_not_found' });
      },
    );
    for (const table of [
      'terminal_session',
      'startup_warning_claim',
      'startup_notification_inquiry',
    ]) {
      assert.equal(
        (
          context.retained.connection.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
            count: number;
          }
        ).count,
        0,
      );
    }
  } finally {
    context.close();
    cleanup();
  }
});

test('Issue #247 AC8: JSON化・weather読取・retained commit失敗をHTTP 500として全rollbackする', async () => {
  for (const failure of ['serialization', 'weather_read', 'retained_commit', 'thenable'] as const) {
    const { context, cleanup } = createDb();
    try {
      if (failure === 'retained_commit') {
        context.retained.connection.exec(`
          CREATE TABLE commit_parent (id INTEGER PRIMARY KEY);
          CREATE TABLE commit_child (parent_id INTEGER REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED);
          CREATE TRIGGER fail_inquiry_commit AFTER INSERT ON startup_notification_inquiry BEGIN
            INSERT INTO commit_child VALUES(99);
          END;
        `);
      }
      const service = createStartupNotificationService({
        weatherConnection: context.weather.connection,
        retainedConnection: context.retained.connection,
        weatherDatabaseGenerationId: context.weatherDatabaseGenerationId,
        initialization: readyInitialization(),
        venueRegistry: testVenueRegistry,
        terminalRegistry: testTerminalRegistry,
        serverGenerationId: '00000000-0000-4000-8000-0000000000aa',
        projector: (connection, input, outputIdFactory) => {
          if (failure === 'weather_read')
            connection.prepare('SELECT * FROM absent_weather_table').all();
          if (failure === 'thenable')
            return { then() {} } as unknown as ReturnType<
              typeof projectStartupCurrentNotifications
            >;
          const projection = projectStartupCurrentNotifications(connection, input, outputIdFactory);
          if (failure === 'serialization')
            Object.defineProperty(projection.notifications, 'toJSON', {
              value() {
                throw new Error('応答JSON化失敗');
              },
            });
          return projection;
        },
      });
      await withServer(
        createApp({
          startupNotifications: service,
          terminalRegistry: testTerminalRegistry,
          venueRegistry: testVenueRegistry,
        }),
        async (baseUrl) => {
          const response = await fetch(`${baseUrl}/api/notifications/startup`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              terminalId: 'hkeagh01',
              sessionId: '00000000-0000-4000-8000-000000000088',
              serverGenerationId: '00000000-0000-4000-8000-0000000000aa',
            }),
          });
          assert.equal(response.status, 500, failure);
        },
      );
      for (const table of [
        'terminal_session',
        'startup_warning_claim',
        'startup_notification_inquiry',
      ]) {
        assert.deepEqual(
          context.retained.connection.prepare(`SELECT * FROM ${table}`).all(),
          [],
          `${failure}:${table}`,
        );
      }
    } finally {
      context.close();
      cleanup();
    }
  }
});

test('Issue #247 AC9: 予約更新callbackの境界前後でsnapshotとcursorとdeltaが一致する', async () => {
  for (const ordering of ['before', 'after'] as const) {
    const { context, cleanup } = createDb();
    try {
      saveEastCurrent(context.weather.connection);
      const startup = createStartupNotificationService({
        weatherConnection: context.weather.connection,
        retainedConnection: context.retained.connection,
        weatherDatabaseGenerationId: context.weatherDatabaseGenerationId,
        initialization: readyInitialization(),
        venueRegistry: testVenueRegistry,
        terminalRegistry: testTerminalRegistry,
        serverGenerationId: 'boundary-generation',
        now: () => now,
      });
      const update = new Promise<void>((resolve) =>
        setImmediate(() => {
          // 現況commitから通知保存まで同期区間を分断しない。
          context.weather.connection.transaction(() =>
            context.weather.connection.exec('DELETE FROM warning_current_snapshot'),
          )();
          recordNotificationOutputHistory(context.retained.connection, {
            notificationId: 'boundary-update',
            category: 'warning',
            sourceType: 'warning_current',
            sourceVersion: 'new',
            targetAreaJson: JSON.stringify([
              {
                kind: 'area',
                codeType: 'jma_municipal_warning_area',
                code: '1310800',
                name: '江東区',
              },
            ]),
            occurredAt: now,
            detectedAt: now,
            changeType: 'released',
            ackRequired: false,
            summary: '解除通知',
            relatedRefsJson: '[]',
            origin: 'weather',
            detectionContext: 'normal',
            isTraining: false,
            messageDefinitionId: null,
            messageDefinitionVersion: null,
            weatherDatabaseGenerationId: context.weatherDatabaseGenerationId,
          });
          resolve();
        }),
      );
      if (ordering === 'after') await update;
      const response = startup.inquire({
        serverGenerationId: 'boundary-generation',
        terminalId: 'hkeagh01',
        venueId: eastVenueId,
        sessionId: '00000000-0000-4000-8000-000000000099',
        inquiredAt: now,
      });
      assert.equal(response.status, 'ready');
      if (response.status !== 'ready') throw new Error('readyなし');
      assert.equal(
        response.notifications.filter((item) => item.category === 'warning').length,
        ordering === 'before' ? 1 : 0,
      );
      await update;
      const delta = createNotificationDeltaService({
        serverStartCursor: toNotificationDeltaCursor(0),
        initialization: readyInitialization(),
        connection: context.retained.connection,
        venueRegistry: testVenueRegistry,
        serverGenerationId: 'boundary-generation',
        now: () => now,
      });
      const result = delta.query({
        origin: 'weather',
        serverGenerationId: 'boundary-generation',
        terminalId: 'hkeagh01',
        venueId: eastVenueId,
        cursor: response.cursor,
        requestedAt: now,
      });
      assert.equal(result.status, 'ready');
      if (result.status !== 'ready') throw new Error('readyなし');
      assert.deepEqual(
        result.notifications.map((item) => item.notificationId),
        ordering === 'before' ? ['boundary-update'] : [],
      );
    } finally {
      context.close();
      cleanup();
    }
  }
});
