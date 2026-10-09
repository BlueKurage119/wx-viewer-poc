import assert from 'node:assert/strict';
import test from 'node:test';
import BetterSqlite3 from 'better-sqlite3';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Worker } from 'node:worker_threads';
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
  let observedProjection!: () => void;
  const projectionStarted = new Promise<void>((resolve) => {
    observedProjection = resolve;
  });
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
      observedProjection();
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
    const request = (sessionId: string) =>
      fetch(`${base}/api/notifications/startup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          terminalId: 'hkeagh01',
          sessionId,
          serverGenerationId: server.acquisitionHost.epoch.serverGenerationId,
        }),
      });
    const first = request('00000000-0000-4000-8000-000000000258');
    await projectionStarted;
    const second = request('00000000-0000-4000-8000-000000000259');
    const waitForReady = async (response: Response, sessionId: string) => {
      for (let attempt = 0; response.status === 202 && attempt < 100; attempt++) {
        await response.arrayBuffer();
        await new Promise((resolve) => setTimeout(resolve, 20));
        response = await request(sessionId);
      }
      return response;
    };
    const [response, concurrent] = await Promise.all([
      first.then((value) => waitForReady(value, '00000000-0000-4000-8000-000000000258')),
      second.then((value) => waitForReady(value, '00000000-0000-4000-8000-000000000259')),
    ]);
    assert.equal(response.status, 200);
    assert.equal(concurrent.status, 200);
    const startup = (await response.json()) as StartupNotificationReadyResponse;
    const otherStartup = (await concurrent.json()) as StartupNotificationReadyResponse;
    assert.equal(otherStartup.warningClaimed, false);
    assert.equal(
      otherStartup.notifications.some((item) => item.category === 'warning'),
      false,
    );
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
    const audits = retained
      .prepare('SELECT response_json FROM startup_notification_inquiry ORDER BY id')
      .all() as { response_json: string }[];
    assert.equal(audits.length, 2);
    assert.deepEqual(JSON.parse(audits[0]!.response_json), startup);
    assert.deepEqual(JSON.parse(audits[1]!.response_json), otherStartup);
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

for (const restartOrder of ['before-startup', 'after-startup'] as const)
  test(`提供再開${restartOrder}と複数startupは取得checkpointとclaimを増やさない`, async () => {
    const fixture = createTemporaryTestDatabaseFixture();
    const options = createTestServerDatabaseOptions(fixture.config);
    let deliveryWorker: Worker | undefined;
    let deliverySpawns = 0;
    const server = await startServer({
      ...options,
      port: 0,
      enablePolling: false,
      pollingSchedule: createTestPollingSchedule(),
      acquisitionWorkerEntry: new URL('./fixtures/worker/publication.ts', import.meta.url),
      onDeliveryWorkerCreated(worker) {
        deliveryWorker = worker;
        deliverySpawns++;
      },
    });
    const retained = new BetterSqlite3(options.config.retained.databasePath);
    const base = `http://127.0.0.1:${server.port}`;
    const counts = () =>
      ['terminal_session', 'startup_warning_claim', 'startup_notification_inquiry'].map(
        (table) =>
          (retained.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number })
            .count,
      );
    const request = (sessionId: string) =>
      fetch(`${base}/api/notifications/startup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          terminalId: 'hkeagh01',
          sessionId,
          serverGenerationId: server.acquisitionHost.epoch.serverGenerationId,
        }),
      });
    try {
      assert.equal((await server.weatherPrepared).status, 'ready');
      const now = '2026-10-09T03:00:00.000Z';
      recordNotificationOutputHistory(retained, {
        notificationId: `health-${restartOrder}`,
        category: 'warning',
        sourceType: 'fetch_health',
        sourceVersion: 'health-before-restart',
        targetAreaJson: null,
        occurredAt: now,
        detectedAt: now,
        changeType: 'delayed',
        ackRequired: false,
        summary: '取得健全性の保持履歴',
        relatedRefsJson: '[]',
        origin: 'system',
        detectionContext: 'normal',
        isTraining: false,
        messageDefinitionId: null,
        messageDefinitionVersion: null,
        weatherDatabaseGenerationId: null,
      });
      const healthHistory = () =>
        retained
          .prepare("SELECT * FROM notification_output_history WHERE source_type='fetch_health'")
          .all();
      const initialHealthHistory = structuredClone(healthHistory());
      const acquisitionGeneration = server.acquisitionHost.epoch.workerGeneration;
      const initialHealth = structuredClone(server.acquisitionHost.report?.health);
      assert.equal(initialHealth?.status, 'delayed');
      const monitoringHealth = async () => {
        for (let attempt = 0; attempt < 250; attempt++) {
          const response = await fetch(`${base}/api/monitoring/status?terminalId=hkeagh01`);
          assert.equal(response.status, 200);
          const status = (await response.json()) as {
            health: { worstStatus: string | null };
            weatherSampleReceivedAt: string | null;
          };
          if (status.weatherSampleReceivedAt) return status.health;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.fail('監視sampleが期限内に届きません');
      };
      const initialMonitoringHealth = await monitoringHealth();
      assert.equal(initialMonitoringHealth.worstStatus, 'delayed');
      const initialCheckpoint = structuredClone(server.acquisitionHost.decisions.snapshot());
      const initialInitialization = structuredClone(server.acquisitionHost.report?.initialization);
      const desiredRunning = server.acquisitionHost.desiredRunning;
      const restart = async () => {
        const oldGeneration = server.deliveryHost.epoch.workerGeneration;
        await deliveryWorker!.terminate();
        for (let index = 0; index < 100 && !server.deliveryHost.status().exitConfirmed; index++)
          await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(server.deliveryHost.status().exitConfirmed, true);
        const accepted = await fetch(`${base}/api/control/weather-workers/delivery/restart`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            requestId: `publication-${restartOrder}`,
            expectedWorkerGeneration: oldGeneration,
          }),
        });
        assert.equal(accepted.status, 202);
        for (let index = 0; index < 250; index++) {
          const result = await fetch(
            `${base}/api/control/weather-workers/operations/publication-${restartOrder}`,
          );
          const body = (await result.json()) as { status: string; result?: string };
          if (body.status === 'completed') {
            assert.equal(body.result, 'success');
            break;
          }
          if (index === 249) assert.fail('提供再開が期限内に完了しません');
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.equal(deliverySpawns, 2);
        assert.equal(server.acquisitionHost.epoch.workerGeneration, acquisitionGeneration);
        assert.equal(server.acquisitionHost.desiredRunning, desiredRunning);
        assert.deepEqual(server.acquisitionHost.report?.health, initialHealth);
        assert.deepEqual(await monitoringHealth(), initialMonitoringHealth);
        assert.deepEqual(healthHistory(), initialHealthHistory);
        assert.deepEqual(server.acquisitionHost.decisions.snapshot(), initialCheckpoint);
        assert.deepEqual(server.acquisitionHost.report?.initialization, initialInitialization);
      };
      if (restartOrder === 'before-startup') await restart();
      const [first, second] = await Promise.all([
        request('00000000-0000-4000-8000-000000000258'),
        request('00000000-0000-4000-8000-000000000259'),
      ]);
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      const responses = (await Promise.all([
        first.json(),
        second.json(),
      ])) as StartupNotificationReadyResponse[];
      assert.deepEqual(responses.map((response) => response.warningClaimed).sort(), [false, true]);
      assert.deepEqual(counts(), [2, 1, 2]);
      if (restartOrder === 'after-startup') await restart();
      assert.deepEqual(counts(), [2, 1, 2]);
      assert.deepEqual(server.acquisitionHost.decisions.snapshot(), initialCheckpoint);
      assert.deepEqual(server.acquisitionHost.report?.initialization, initialInitialization);
      assert.deepEqual(healthHistory(), initialHealthHistory);
      assert.equal((await request('00000000-0000-4000-8000-000000000258')).status, 200);
      assert.deepEqual(counts(), [2, 1, 3]);
      const cursor = (
        retained.prepare('SELECT MAX(id) AS id FROM notification_output_history').get() as {
          id: number;
        }
      ).id;
      const nextNotificationId = `new-weather-${restartOrder}`;
      await server.acquisitionHost.call('fixture.update', {
        snapshot: {
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
            sourceVersion: nextNotificationId,
          },
          telegram: {
            controlStatus: 'normal',
            infoType: '発表',
            eventId: nextNotificationId,
            reportDateTime: now,
            controlDateTime: now,
          },
          items: [],
        },
        notification: {
          notificationId: nextNotificationId,
          category: 'warning',
          sourceType: 'warning_current',
          sourceVersion: nextNotificationId,
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
          changeType: 'new',
          ackRequired: false,
          summary: '提供再開後の新しい変化',
          relatedRefsJson: '[]',
          origin: 'weather',
          detectionContext: 'normal',
          isTraining: false,
          messageDefinitionId: null,
          messageDefinitionVersion: null,
          weatherDatabaseGenerationId: server.acquisitionHost.epoch.weatherDatabaseGenerationId,
        },
      });
      const delta = await fetch(
        `${base}/api/notifications/delta?origin=weather&terminalId=hkeagh01&cursor=${cursor}&serverGenerationId=${server.acquisitionHost.epoch.serverGenerationId}`,
      );
      assert.equal(delta.status, 200);
      assert.deepEqual(
        ((await delta.json()) as NotificationDeltaReadyResponse).notifications.map(
          (item) => item.notificationId,
        ),
        [nextNotificationId],
      );
      assert.deepEqual(healthHistory(), initialHealthHistory);
      const failures = retained
        .prepare(
          "SELECT change_type FROM notification_output_history WHERE source_type='weather_worker' AND change_type='unexpected_exit'",
        )
        .all() as { change_type: string }[];
      assert.deepEqual(failures, [{ change_type: 'unexpected_exit' }]);
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
