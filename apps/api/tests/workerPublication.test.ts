import assert from 'node:assert/strict';
import test from 'node:test';
import BetterSqlite3 from 'better-sqlite3';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTemporaryTestDatabaseFixture,
  createTestServerDatabaseOptions,
  initializeTestDatabases,
} from './helpers/databasePair.js';
import { createTestPollingSchedule } from './helpers/pollingSchedule.js';
import { startServer } from '../src/server.js';
import {
  recordNotificationOutputHistory,
  saveWarningCurrentSnapshot,
} from '../src/repositories/index.js';
import type {
  NotificationDeltaReadyResponse,
  StartupNotificationReadyResponse,
} from '@wx-viewer-poc/shared';

test('実WorkerとHTTPの公開境界: snapshot U1/cursor101、system102、解放後weather103、監査JSONが一致する', async () => {
  const fixture = createTemporaryTestDatabaseFixture();
  const seed = initializeTestDatabases(fixture.config);
  const generation = seed.weatherDatabaseGenerationId;
  const now = '2026-10-09T03:00:00.000Z';
  const notification = (id: string, origin: 'weather' | 'system') => ({
    notificationId: id,
    category: 'warning',
    sourceType: 'warning_current',
    sourceVersion: id,
    targetAreaJson: JSON.stringify([
      { kind: 'area', codeType: 'jma_municipal_warning_area', code: '1310800', name: '江東区' },
    ]),
    occurredAt: now,
    detectedAt: now,
    changeType: 'new',
    ackRequired: false,
    summary: '試験通知',
    relatedRefsJson: '[]',
    origin,
    detectionContext: 'normal' as const,
    isTraining: false,
    messageDefinitionId: null,
    messageDefinitionVersion: null,
    weatherDatabaseGenerationId: origin === 'weather' ? generation : null,
  });
  function snapshot(version: string): Parameters<typeof saveWarningCurrentSnapshot>[1] {
    return {
      areaCode: '1310800',
      areaName: '江東区',
      metadata: {
        source: 'test',
        issuedAt: now,
        validAt: null,
        validFrom: null,
        validTo: null,
        fetchedAt: now,
        lastSuccessAt: now,
        availability: 'available',
        sourceVersion: version,
      },
      telegram: {
        controlStatus: 'normal',
        infoType: '発表',
        eventId: version,
        reportDateTime: now,
        controlDateTime: now,
      },
      items: [
        {
          sequence: 1,
          kindCode: '02',
          kindName: '暴風警報',
          kindStatus: '発表',
          lastKindCode: null,
          lastKindName: null,
          significancyCode: null,
          significancyName: null,
          warningLevel: null,
          attentionText: null,
          kindIssuedAt: now,
          sourceTelegram: 'VPWW53',
        },
      ],
    };
  }
  recordNotificationOutputHistory(seed.retained.connection, notification('seed', 'system'));
  seed.retained.connection.exec('UPDATE notification_output_history SET id = 100');
  seed.close();
  const options = createTestServerDatabaseOptions(fixture.config);
  const retained = new BetterSqlite3(options.config.retained.databasePath);
  let following: Promise<unknown> | undefined;
  let observed = false;
  const server = await startServer({
    ...options,
    port: 0,
    enablePolling: false,
    pollingSchedule: createTestPollingSchedule(),
    pollingServiceOptions: { clock: () => now },
    nowcastCacheRoot: join(fixture.config.databasePath, '..', 'nowcast'),
    kikikuruCacheRoot: join(fixture.config.databasePath, '..', 'kikikuru'),
    acquisitionWorkerEntry: new URL('./fixtures/worker/publication.ts', import.meta.url),
    weatherRequestObserver(request) {
      if (request.kind !== 'startup.project' || observed) return;
      observed = true;
      recordNotificationOutputHistory(retained, notification('system102', 'system'));
      following = server.acquisitionHost.call('fixture.update', {
        snapshot: snapshot('U2'),
        notification: notification('N2', 'weather'),
      });
    },
  });
  try {
    assert.equal((await server.weatherPrepared).status, 'ready');
    await server.acquisitionHost.call('fixture.update', {
      snapshot: snapshot('U1'),
      notification: notification('N1', 'weather'),
    });
    const base = `http://127.0.0.1:${server.port}`;
    const response = await fetch(`${base}/api/notifications/startup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        terminalId: 'hkeagh01',
        sessionId: '00000000-0000-4000-8000-000000000258',
        serverGenerationId: server.acquisitionHost.epoch.serverGenerationId,
      }),
    });
    assert.equal(response.status, 200);
    const startup = (await response.json()) as StartupNotificationReadyResponse;
    assert.equal(startup.cursor, '101');
    assert.deepEqual(
      startup.notifications.map((item) => item.sourceVersion),
      ['U1'],
    );
    await following;
    const weather = (await (
      await fetch(
        `${base}/api/notifications/delta?origin=weather&terminalId=hkeagh01&cursor=101&serverGenerationId=${startup.serverGenerationId}`,
      )
    ).json()) as NotificationDeltaReadyResponse;
    const system = (await (
      await fetch(
        `${base}/api/notifications/delta?origin=system&terminalId=hkeagh01&cursor=100&serverGenerationId=${startup.serverGenerationId}`,
      )
    ).json()) as NotificationDeltaReadyResponse;
    assert.deepEqual(
      weather.notifications.map((item) => item.notificationId),
      ['N2'],
    );
    assert.deepEqual(
      system.notifications.map((item) => item.notificationId),
      ['system102'],
    );
    assert.deepEqual(
      retained
        .prepare('SELECT id, notification_id FROM notification_output_history ORDER BY id')
        .all(),
      [
        { id: 100, notification_id: 'seed' },
        { id: 101, notification_id: 'N1' },
        { id: 102, notification_id: 'system102' },
        { id: 103, notification_id: 'N2' },
      ],
    );
    const audit = retained
      .prepare('SELECT response_json FROM startup_notification_inquiry')
      .get() as { response_json: string };
    assert.deepEqual(JSON.parse(audit.response_json), startup);
    assert.deepEqual(
      retained.prepare('SELECT count(*) AS count FROM startup_warning_claim').get(),
      { count: 1 },
    );
  } finally {
    await server.close();
    retained.close();
    fixture.cleanup();
  }
});

for (const failure of ['read', 'audit', 'pause-expired', 'http-abort'] as const) {
  test(`実Worker公開${failure}失敗はsession/claim/監査を増やさず次の問い合わせへgateを解放する`, async (t) => {
    const fixture = createTemporaryTestDatabaseFixture();
    const options = createTestServerDatabaseOptions(fixture.config);
    const server = await startServer({
      ...options,
      port: 0,
      enablePolling: false,
      pollingSchedule: createTestPollingSchedule(),
      acquisitionWorkerEntry: new URL('./fixtures/worker/publication.ts', import.meta.url),
      deliveryWorkerEntry: new URL('./fixtures/worker/delivery-read-failure.ts', import.meta.url),
    });
    const retained = new BetterSqlite3(options.config.retained.databasePath);
    const request = (signal?: AbortSignal) =>
      fetch(`http://127.0.0.1:${server.port}/api/notifications/startup`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          terminalId: 'hkeagh01',
          sessionId: '00000000-0000-4000-8000-000000000258',
          serverGenerationId: server.acquisitionHost.epoch.serverGenerationId,
        }),
      });
    const counts = () =>
      ['terminal_session', 'startup_warning_claim', 'startup_notification_inquiry'].map(
        (table) =>
          (retained.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number })
            .count,
      );
    try {
      assert.equal((await server.weatherPrepared).status, 'ready');
      const readFailureMarker = join(options.nowcastCacheRoot, 'fail-startup-project');
      if (failure === 'read') {
        mkdirSync(options.nowcastCacheRoot, { recursive: true });
        writeFileSync(readFailureMarker, '1');
      }
      if (failure === 'audit')
        retained.exec(
          "CREATE TRIGGER reject_inquiry BEFORE INSERT ON startup_notification_inquiry BEGIN SELECT RAISE(ABORT, 'fixture'); END",
        );
      if (failure === 'pause-expired' || failure === 'http-abort')
        await server.acquisitionHost.call('fixture.pause-delay', 2100);
      if (failure === 'http-abort') {
        const controller = new AbortController();
        const pending = request(controller.signal);
        setTimeout(() => controller.abort(), 50);
        await assert.rejects(pending, { name: 'AbortError' });
        await new Promise((resolve) => setTimeout(resolve, 2200));
      } else {
        const response = await request();
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), {
          status: 'error',
          code: 'startup_notification_failed',
        });
      }
      assert.deepEqual(counts(), [0, 0, 0]);
      t.mock.restoreAll();
      if (failure === 'read') unlinkSync(readFailureMarker);
      if (failure === 'audit') retained.exec('DROP TRIGGER reject_inquiry');
      await server.acquisitionHost.call('fixture.pause-delay', 0);
      assert.equal((await request()).status, 200);
      assert.deepEqual(counts(), [1, 1, 1]);
    } finally {
      t.mock.restoreAll();
      await server.close();
      retained.close();
      fixture.cleanup();
    }
  });
}
