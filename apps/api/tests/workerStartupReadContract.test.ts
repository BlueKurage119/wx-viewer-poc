import assert from 'node:assert/strict';
import test from 'node:test';
import type { Worker } from 'node:worker_threads';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import type { MonitoringStatusResponse } from '@wx-viewer-poc/shared';
import { startServer } from '../src/server.js';
import { saveWarningCurrentSnapshot } from '../src/repositories/index.js';
import {
  createTemporaryTestDatabaseFixture,
  createTestServerDatabaseOptions,
  initializeTestDatabases,
} from './helpers/databasePair.js';
import { createTestPollingSchedule } from './helpers/pollingSchedule.js';
import { until } from './helpers/acquisitionWorkerHostFixture.js';
import { testVenueRegistry } from './helpers/venueConfigPreload.js';

// Webが実際に使う検証器を読み、API側の型だけで境界の整合を判断しない。
const { createMonitoringStatusClient } = (await import(
  new URL('../../web/src/api/monitoringStatus.ts', import.meta.url).href
)) as {
  createMonitoringStatusClient(input: {
    fetch: typeof fetch;
    registry: typeof testVenueRegistry;
  }): { fetchMonitoringStatus(id: string): Promise<MonitoringStatusResponse> };
};

test('DB初期化前と初期化失敗の実fallbackをWebで検証し、専用手動再開できる', async () => {
  const fixture = createTemporaryTestDatabaseFixture();
  const options = createTestServerDatabaseOptions(fixture.config);
  writeFileSync(fixture.config.databasePath, '不正なDB');
  let releaseAuthorization: (() => void) | undefined;
  const server = await startServer({
    ...options,
    port: 0,
    enablePolling: false,
    pollingSchedule: createTestPollingSchedule(),
    onAcquisitionWorkerCreated(worker) {
      const post = worker.postMessage.bind(worker);
      worker.postMessage = (message) => {
        if (message.bytes) {
          const packet = JSON.parse(Buffer.from(message.bytes).toString());
          if (
            !releaseAuthorization &&
            packet.kind === 'reply' &&
            packet.method === 'runtime.accepting'
          ) {
            releaseAuthorization = () => post(message);
            return;
          }
        }
        post(message);
      };
    },
  });
  const base = `http://127.0.0.1:${server.port}`;
  const client = createMonitoringStatusClient({
    registry: testVenueRegistry,
    fetch: (input, init) => fetch(`${base}${String(input)}`, init),
  });
  try {
    await until(() => releaseAuthorization !== undefined);
    const preparing = await client.fetchMonitoringStatus('hkeagh01');
    assert.deepEqual(preparing.readErrors, [
      { section: 'recent_adoptions', venueId: null, kind: null, code: 'weather_data_read_failed' },
      { section: 'tiles', venueId: null, kind: 'nowcast', code: 'weather_data_read_failed' },
      { section: 'tiles', venueId: null, kind: 'kikikuru', code: 'weather_data_read_failed' },
    ]);
    assert.equal(preparing.weatherRuntimes.delivery.lifecycle, 'starting');
    releaseAuthorization!();
    assert.equal((await server.weatherPrepared).status, 'failed');
    await until(() => server.acquisitionHost.status().exitConfirmed);
    const failed = await client.fetchMonitoringStatus('hkeagh01');
    assert.equal(failed.readiness.initialFetchPhase, 'failed');
    assert.equal(failed.weatherRuntimes.acquisition.restartAllowed, true);
    const response = await fetch(`${base}/api/control/weather-workers/acquisition/restart`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: 'fallback-restart',
        expectedWorkerGeneration: failed.weatherRuntimes.acquisition.workerGeneration,
      }),
    });
    assert.equal(response.status, 202);
    let operation: { status: string; result?: string } = { status: 'in_progress' };
    for (let attempt = 0; attempt < 150 && operation.status !== 'completed'; attempt++) {
      operation = (await (
        await fetch(`${base}/api/control/weather-workers/operations/fallback-restart`)
      ).json()) as typeof operation;
      if (operation.status !== 'completed') await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(operation.status, 'completed');
    assert.equal(operation.result, 'success');
    assert.notEqual(
      server.acquisitionHost.epoch.workerGeneration,
      failed.weatherRuntimes.acquisition.workerGeneration,
    );
  } finally {
    releaseAuthorization?.();
    await server.close();
    fixture.cleanup();
  }
});

for (const [abortPreparation, dropFinalReport] of [
  [false, false],
  [true, false],
  [true, true],
] as const) {
  test(`実HTTPは未検証snapshotを隠し、同一DBの旧検証scopeを再開中だけ維持する（後続準備失敗=${abortPreparation}、最終報告欠落=${dropFinalReport}）`, async () => {
    const fixture = createTemporaryTestDatabaseFixture();
    const options = createTestServerDatabaseOptions(fixture.config);
    const seed = initializeTestDatabases(fixture.config);
    const at = '2026-10-09T03:00:00.000Z';
    saveWarningCurrentSnapshot(seed.weather.connection, {
      areaCode: '1310800',
      areaName: '江東区',
      metadata: {
        source: 'test',
        issuedAt: at,
        validAt: null,
        validFrom: null,
        validTo: null,
        fetchedAt: at,
        lastSuccessAt: at,
        availability: 'available',
        sourceVersion: '未整合snapshot',
      },
      telegram: {
        controlStatus: 'normal',
        infoType: '発表',
        eventId: '不整合',
        reportDateTime: at,
        controlDateTime: at,
      },
      items: [],
    });
    seed.close();
    const marker = `${options.nowcastCacheRoot}.scope-startup`;
    let worker: Worker | undefined;
    const server = await startServer({
      ...options,
      port: 0,
      enablePolling: false,
      pollingSchedule: createTestPollingSchedule(),
      pollingServiceOptions: { clock: () => at },
      onAcquisitionWorkerCreated(created) {
        worker = created;
        created.on('message', (message) => {
          if (!dropFinalReport || !existsSync(`${marker}.abort`) || !message.bytes) return;
          const packet = JSON.parse(Buffer.from(message.bytes).toString());
          if (
            packet.kind === 'call' &&
            packet.method === 'status' &&
            packet.value.report?.locallyValidatedScopes.length > 0
          ) {
            packet.value.report = null;
            message.bytes = Buffer.from(JSON.stringify(packet));
          }
        });
      },
      acquisitionWorkerEntry: new URL(
        './fixtures/acquisition-worker/scope-startup.ts',
        import.meta.url,
      ),
    });
    const base = `http://127.0.0.1:${server.port}`;
    const monitoring = async () =>
      (await (
        await fetch(`${base}/api/monitoring/status?terminalId=hkeagh01`)
      ).json()) as MonitoringStatusResponse;
    const informationErrors = async () =>
      (await monitoring()).readErrors
        .filter((error) => error.section === 'information')
        .map((error) => `${error.venueId}:${error.kind}`)
        .sort();
    try {
      await until(() => existsSync(`${marker}.paused`));
      const weather = (await (
        await fetch(`${base}/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal`)
      ).json()) as {
        metadata: { availability: string; sourceVersion: string | null };
        data: unknown;
      };
      assert.equal(weather.metadata.availability, 'unavailable');
      assert.equal(weather.metadata.sourceVersion, null);
      assert.equal(weather.data, null);
      assert.deepEqual(
        await informationErrors(),
        testVenueRegistry
          .listVenueIds()
          .flatMap((id) =>
            [
              'warning',
              'warning_timeseries',
              'early_warning',
              'area_timeseries',
              'amedas',
              'bosai_bulletin',
            ].map((kind) => `${id}:${kind}`),
          )
          .sort(),
      );
      writeFileSync(`${marker}.release`, '再検証開始');
      assert.equal((await server.weatherPrepared).status, 'ready');
      assert.deepEqual(await informationErrors(), []);
      assert.equal(server.acquisitionHost.report?.initialization.initialFetchPhase, 'not_started');
      assert.deepEqual(server.acquisitionHost.decisions.snapshot().warningDoneKeys, []);
      await worker!.terminate();
      await until(() => server.acquisitionHost.status().exitConfirmed);
      assert.deepEqual(await informationErrors(), []);
      rmSync(`${marker}.release`);
      rmSync(`${marker}.paused`);
      writeFileSync(`${marker}.fault`, '読取失敗');
      if (abortPreparation) writeFileSync(`${marker}.abort`, '後続準備失敗');
      await server.acquisitionHost.restart();
      await until(() => existsSync(`${marker}.paused`));
      assert.deepEqual(await informationErrors(), []);
      writeFileSync(`${marker}.release`, '再検証開始');
      await until(() => server.acquisitionHost.preparationCompleted);
      const errors = await informationErrors();
      if (abortPreparation) {
        assert.equal(server.acquisitionHost.status().stopReason, 'initialization_failed');
        assert.deepEqual(
          errors,
          [
            ...(dropFinalReport ? [] : ['east:early_warning']),
            ...testVenueRegistry
              .listVenueIds()
              .filter((id) => dropFinalReport || id !== 'east')
              .flatMap((id) =>
                [
                  'warning',
                  'warning_timeseries',
                  'early_warning',
                  'area_timeseries',
                  'amedas',
                  'bosai_bulletin',
                ].map((kind) => `${id}:${kind}`),
              ),
          ].sort(),
        );
      } else
        assert.deepEqual(
          errors,
          testVenueRegistry
            .listVenueIds()
            .map((id) => `${id}:early_warning`)
            .sort(),
        );
      if (!dropFinalReport) {
        assert.equal(
          server.acquisitionHost.report?.locallyValidatedScopes.includes('east|training|warnings'),
          true,
        );
        assert.equal(
          server.acquisitionHost.report?.locallyValidatedScopes.includes('trc|normal|warnings'),
          !abortPreparation,
        );
        assert.equal(server.acquisitionHost.desiredRunning, false);
        assert.equal(
          server.acquisitionHost.report?.initialization.initialFetchPhase,
          'not_started',
        );
        assert.deepEqual(server.acquisitionHost.decisions.snapshot().warningDoneKeys, []);
      } else assert.equal(server.acquisitionHost.report, null);
    } finally {
      writeFileSync(`${marker}.release`, '終了');
      await server.close();
      fixture.cleanup();
    }
  });
}

test('起動現況は正常/訓練の警報・速報scopeのローカル検証を迂回しない', async () => {
  const fixture = createTemporaryTestDatabaseFixture();
  const server = await startServer({
    ...createTestServerDatabaseOptions(fixture.config),
    port: 0,
    enablePolling: false,
    pollingSchedule: createTestPollingSchedule(),
    acquisitionWorkerEntry: new URL('./fixtures/worker/publication.ts', import.meta.url),
  });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    assert.equal((await server.weatherPrepared).status, 'ready');
    await server.acquisitionHost.call('fixture.invalidate-scope', 'east|training|bulletins');
    const inquire = async (terminalId: string, sessionId: string) => {
      const response = await fetch(`${base}/api/notifications/startup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          terminalId,
          sessionId,
          serverGenerationId: server.acquisitionHost.epoch.serverGenerationId,
        }),
      });
      assert.equal(response.status, terminalId === 'hkeagh01' ? 202 : 200);
      return (await response.json()) as { status: string };
    };
    assert.equal(
      (await inquire('hkeagh01', '00000000-0000-4000-8000-000000000901')).status,
      'initializing',
    );
    assert.equal(
      (await inquire('htrcph01', '00000000-0000-4000-8000-000000000902')).status,
      'ready',
    );
  } finally {
    await server.close();
    fixture.cleanup();
  }
});
