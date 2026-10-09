import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Worker } from 'node:worker_threads';
import {
  createTemporaryTestDatabaseFixture,
  createTestServerDatabaseOptions,
} from './helpers/databasePair.js';
import { createTestPollingSchedule } from './helpers/pollingSchedule.js';
import { startServer } from '../src/server.js';

test('提供再開の受付成功後にreader接続が失敗しても操作成功と異常状態を分け、後続再開で復旧する', async () => {
  const fixture = createTemporaryTestDatabaseFixture();
  const options = createTestServerDatabaseOptions(fixture.config);
  const nowcastCacheRoot = join(fixture.config.databasePath, '..', 'nowcast');
  const marker = `${nowcastCacheRoot}.fail-reader-connect`;
  let deliveryWorker: Worker | undefined;
  let deliverySpawns = 0;
  const server = await startServer({
    ...options,
    port: 0,
    enablePolling: false,
    pollingSchedule: createTestPollingSchedule(),
    nowcastCacheRoot,
    kikikuruCacheRoot: join(fixture.config.databasePath, '..', 'kikikuru'),
    deliveryWorkerEntry: new URL('./fixtures/worker/delivery-connect-failure.ts', import.meta.url),
    onDeliveryWorkerCreated(worker) {
      deliveryWorker = worker;
      deliverySpawns += 1;
    },
  });
  const root = `http://127.0.0.1:${server.port}`;
  const weather = () =>
    fetch(`${root}/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal`);
  const post = (requestId: string, expectedWorkerGeneration: string) =>
    fetch(`${root}/api/control/weather-workers/delivery/restart`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, expectedWorkerGeneration }),
    });
  const completed = async (requestId: string) => {
    for (let attempt = 0; attempt < 250; attempt++) {
      const response = await fetch(`${root}/api/control/weather-workers/operations/${requestId}`);
      const body = (await response.json()) as {
        status: string;
        result?: string;
        role?: string;
        workerGeneration?: string;
        errorCode?: string | null;
      };
      if (body.status === 'completed') return body;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail(`${requestId} の再開結果が期限内に確定しません`);
  };
  try {
    assert.equal((await server.weatherPrepared).status, 'ready');
    assert.equal((await weather()).status, 200);
    assert.ok(deliveryWorker);
    const firstGeneration = server.deliveryHost.epoch.workerGeneration;
    await deliveryWorker.terminate();
    for (let attempt = 0; attempt < 100 && !server.deliveryHost.status().exitConfirmed; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(server.deliveryHost.status().exitConfirmed, true);
    writeFileSync(marker, '提供readerの一時接続失敗');

    assert.equal((await post('delivery-connect-fails', firstGeneration)).status, 202);
    const first = await completed('delivery-connect-fails');
    assert.equal(first.role, 'delivery');
    assert.equal(first.result, 'success', '新Worker受付成功をreader接続失敗と混同しました');
    assert.equal(first.errorCode, null);
    assert.notEqual(first.workerGeneration, firstGeneration);
    assert.equal(deliverySpawns, 2);
    const failedStatus = server.deliveryHost.status();
    assert.equal(failedStatus.lifecycle, 'failed');
    assert.equal(failedStatus.failureCode, 'initialization_failed');
    assert.equal(failedStatus.restartAllowed, true);
    assert.equal(server.deliveryHost.epoch.readerEpoch, null);
    assert.equal((await weather()).status, 503);
    const monitoring = (await (
      await fetch(`${root}/api/monitoring/status?terminalId=hkeagh01`)
    ).json()) as { weatherRuntimes: { delivery: { lifecycle: string; failureCode: string } } };
    assert.equal(monitoring.weatherRuntimes.delivery.lifecycle, 'failed');
    assert.equal(monitoring.weatherRuntimes.delivery.failureCode, 'initialization_failed');
    assert.equal((await post('delivery-connect-fails', firstGeneration)).status, 200);
    assert.equal(deliverySpawns, 2);

    unlinkSync(marker);
    assert.equal((await post('delivery-connect-recovers', first.workerGeneration!)).status, 202);
    const second = await completed('delivery-connect-recovers');
    assert.equal(second.role, 'delivery');
    assert.equal(second.result, 'success');
    assert.equal(deliverySpawns, 3);
    let readable = false;
    for (let attempt = 0; attempt < 250; attempt++) {
      if ((await weather()).status === 200) {
        readable = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(readable, true);
    const history = (await (
      await fetch(`${root}/api/monitoring/weather-worker-operations?limit=2`)
    ).json()) as { items: { operation: { requestId: string; role: string; result: string } }[] };
    assert.deepEqual(
      history.items.map((item) => [
        item.operation.requestId,
        item.operation.role,
        item.operation.result,
      ]),
      [
        ['delivery-connect-recovers', 'delivery', 'success'],
        ['delivery-connect-fails', 'delivery', 'success'],
      ],
    );
  } finally {
    if (existsSync(marker)) unlinkSync(marker);
    await server.close();
    fixture.cleanup();
  }
});
