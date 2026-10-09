import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Worker } from 'node:worker_threads';
import BetterSqlite3 from 'better-sqlite3';
import { startServer } from '../src/server.js';
import { NowcastTileStore } from '../src/polling/nowcastTileStore.js';
import {
  mergeRadarSnapshot,
  saveWarningTimeseriesSnapshot,
  upsertRadarTile,
} from '../src/repositories/index.js';
import {
  createTestServerDatabaseOptions,
  initializeTestDatabases,
} from './helpers/databasePair.js';
import { createTestPollingSchedule } from './helpers/pollingSchedule.js';

async function waitFor<T>(read: () => T | Promise<T>, matches: (value: T) => boolean, ms: number) {
  const until = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (matches(value)) return value;
    if (Date.now() >= until) assert.fail(`状態が期限内に成立しません: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function command(worker: Worker, name: string, acknowledgement: string) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.off('message', onMessage);
      reject(new Error(`${acknowledgement} 未受領`));
    }, 5000);
    const onMessage = (value: unknown) => {
      if (!value || typeof value !== 'object' || !('test' in value)) return;
      if (value.test !== acknowledgement) return;
      clearTimeout(timer);
      worker.off('message', onMessage);
      resolve();
    };
    worker.on('message', onMessage);
    worker.postMessage({ type: 'test', id: 'fixture-control', test: name });
  });
}

test(
  '提供報告stale中も実HTTPの保存済みtext/PNGを読み、応答途絶は個別503にする',
  { timeout: 65_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'wx-delivery-stale-'));
    const options = createTestServerDatabaseOptions({
      databasePath: join(directory, 'weather.sqlite3'),
      migrationsDirectory: join(import.meta.dirname, '../migrations'),
    });
    const now = new Date().toISOString();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const frame = {
      product: 'N1' as const,
      baseTime: now,
      validTime: now,
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
          issuedAt: now,
          validAt: null,
          validFrom: null,
          validTo: null,
          fetchedAt: now,
          lastSuccessAt: now,
          availability: 'available',
          sourceVersion: 'stale-fixture',
        },
        telegram: {
          controlStatus: 'normal',
          infoType: '発表',
          eventId: 'stale-fixture',
          reportDateTime: now,
          controlDateTime: now,
        },
        timeDefines: [],
        values: [],
      });
      mergeRadarSnapshot(seed.weather.connection, {
        product: 'N1',
        metadata: {
          source: 'test',
          issuedAt: now,
          validAt: now,
          validFrom: now,
          validTo: now,
          fetchedAt: now,
          lastSuccessAt: now,
          availability: 'available',
          sourceVersion: 'stale-fixture',
        },
        frames: [{ ...frame, sequence: 0 }],
      });
      const saved = await new NowcastTileStore(join(directory, 'nowcast')).saveTile(
        'stale.png',
        png,
      );
      upsertRadarTile(seed.weather.connection, frame, {
        zoom: 10,
        tileX: 1,
        tileY: 1,
        filePath: 'stale.png',
        byteSize: saved.byteSize,
        contentHash: saved.contentHash,
        storedAt: now,
      });
    } finally {
      seed.close();
    }
    let worker: Worker | undefined;
    let spawns = 0;
    const server = await startServer({
      ...options,
      port: 0,
      enablePolling: false,
      pollingSchedule: createTestPollingSchedule(),
      pollingServiceOptions: { clock: () => now },
      nowcastCacheRoot: join(directory, 'nowcast'),
      kikikuruCacheRoot: join(directory, 'kikikuru'),
      deliveryWorkerEntry: new URL('./fixtures/worker/delivery-heartbeat.ts', import.meta.url),
      onDeliveryWorkerCreated: (value) => {
        worker = value;
        spawns++;
      },
    });
    const root = `http://127.0.0.1:${server.port}`;
    const textPath = `${root}/api/weather/warning-timeseries?terminalId=hkeagh01&controlStatus=normal`;
    const tilePath = `${root}/api/weather/nowcast/N1/tiles/10/1/1.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${now}&validTime=${now}`;
    try {
      assert.equal((await server.weatherPrepared).status, 'ready');
      await waitFor(
        () => server.deliveryHost.status(),
        (value) => value.lifecycle === 'ready',
        5000,
      );
      assert.equal((await fetch(textPath)).status, 200);
      const firstSample = await waitFor(
        () =>
          fetch(`${root}/api/monitoring/status?terminalId=hkeagh01`).then(
            (response) => response.json() as Promise<{ weatherSampleReceivedAt: string | null }>,
          ),
        (value) => value.weatherSampleReceivedAt !== null,
        10_000,
      );
      await command(worker!, 'pause-reports', 'reports-paused');
      const stale = await waitFor(
        () => server.deliveryHost.status(),
        (value) => value.reportFreshness === 'stale',
        20_000,
      );
      assert.equal(stale.lifecycle, 'ready', JSON.stringify(stale));
      assert.equal(stale.failureCode, null);
      assert.equal(stale.restartAllowed, true);
      assert.equal(spawns, 1);
      const monitoring = await fetch(`${root}/api/monitoring/status?terminalId=hkeagh01`);
      assert.equal(monitoring.status, 200);
      const status = (await monitoring.json()) as {
        weatherRuntimes: { delivery: { reportFreshness: string; lifecycle: string } };
        weatherSampleReceivedAt: string | null;
      };
      assert.equal(status.weatherRuntimes.delivery.reportFreshness, 'stale');
      assert.equal(status.weatherRuntimes.delivery.lifecycle, 'ready');
      assert.equal(
        Date.parse(status.weatherSampleReceivedAt!) >
          Date.parse(firstSample.weatherSampleReceivedAt!),
        true,
        `runtime報告がstaleでも監視sample受領時刻は独立に進む: ${JSON.stringify({ first: firstSample.weatherSampleReceivedAt, current: status.weatherSampleReceivedAt, runtime: stale })}`,
      );
      const text = await fetch(textPath);
      assert.equal(text.status, 200);
      assert.equal(((await text.json()) as { data: unknown }).data !== null, true);
      const tile = await fetch(tilePath);
      assert.equal(tile.status, 200);
      assert.deepEqual(Buffer.from(await tile.arrayBuffer()), png);
      assert.equal(spawns, 1);
      const retained = new BetterSqlite3(options.config.retained.databasePath, { readonly: true });
      try {
        const notifications = await waitFor(
          () =>
            retained
              .prepare(
                "SELECT change_type, category, message_definition_id, message_definition_version FROM notification_output_history WHERE source_type='weather_worker' AND source_version=?",
              )
              .all(stale.workerGeneration) as {
              change_type: string;
              category: string;
              message_definition_id: string;
              message_definition_version: string;
            }[],
          (rows) => rows.length === 1,
          3000,
        );
        assert.deepEqual(notifications, [
          {
            change_type: 'report_stale',
            category: 'warning',
            message_definition_id: 'system-weather-delivery-report-stale',
            message_definition_version: '2',
          },
        ]);
      } finally {
        retained.close();
      }
      const restartId = randomUUID();
      const restart = await fetch(`${root}/api/control/weather-workers/delivery/restart`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestId: restartId,
          expectedWorkerGeneration: stale.workerGeneration,
        }),
      });
      assert.equal(restart.status, 202);
      const outcome = await waitFor(
        () =>
          fetch(`${root}/api/control/weather-workers/operations/${restartId}`).then(
            (response) => response.json() as Promise<{ status: string; result?: string }>,
          ),
        (value) => value.status === 'completed',
        15_000,
      );
      assert.equal(outcome.result, 'success');
      assert.equal(spawns, 2);
      assert.equal((await fetch(textPath)).status, 200);
      await command(worker!, 'pause-reports', 'reports-paused');
      await waitFor(
        () => server.deliveryHost.status(),
        (value) => value.reportFreshness === 'stale',
        20_000,
      );
      await command(worker!, 'block-reads', 'reads-blocked');
      const started = performance.now();
      const timedOut = await fetch(textPath);
      const elapsed = performance.now() - started;
      assert.equal(timedOut.status, 503);
      assert.deepEqual(await timedOut.json(), {
        status: 'error',
        code: 'weather_worker_unavailable',
      });
      assert.equal(elapsed < 6500, true, `個別read期限を超過: ${elapsed}ms`);
      assert.equal(spawns, 2);
    } finally {
      await server.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
