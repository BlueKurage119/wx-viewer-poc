import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WeatherRuntimeStatus } from '@wx-viewer-poc/shared';
import { openDatabase } from '../src/database/connection.js';
import {
  createWeatherWorkerControlService,
  WeatherWorkerRestartError,
} from '../src/services/weatherWorkerControlService.js';

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'wx-worker-control-'));
  const connection = openDatabase(join(directory, 'retained.sqlite'));
  connection.exec(
    readFileSync(
      new URL('../migrations/retained/0002_weather_worker_operation.sql', import.meta.url),
      'utf8',
    ),
  );
  let runtime: WeatherRuntimeStatus = {
    role: 'acquisition',
    mode: 'worker',
    workerGeneration: 'old',
    lifecycle: 'failed',
    reportFreshness: 'fresh',
    receivedAt: '2026-10-09T00:00:00.000Z',
    reportedAt: '2026-10-09T00:00:00.000Z',
    stopReason: null,
    restartAllowed: true,
    pendingRequests: 0,
    exitConfirmed: false,
    failureCode: 'protocol_error',
  };
  let calls = 0;
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const deps = {
    connection,
    serverGenerationId: 'server-1',
    now: () => '2026-10-09T01:00:00.000Z',
    getRuntimeStatus: () => runtime,
    getDesiredRunning: () => false,
    restart: async () => {
      calls++;
      await pending;
      runtime = { ...runtime, workerGeneration: 'new' };
    },
  };
  return {
    connection,
    deps,
    calls: () => calls,
    resolve,
    reject,
    close: () => {
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
const request = { requestId: 'r1', expectedWorkerGeneration: 'old' };
const inProgress = {
  statusCode: 202,
  body: { status: 'in_progress', requestId: 'r1', role: 'acquisition', historyRecorded: true },
};
const success = {
  statusCode: 200,
  body: {
    status: 'completed',
    requestId: 'r1',
    role: 'acquisition',
    result: 'success',
    workerGeneration: 'new',
    errorCode: null,
    desiredRunning: false,
    historyRecorded: true,
  },
};

test('提供再開は取得と別レーンで実行し、同じIDの異role再利用を拒否する', async () => {
  const fixture = setup();
  try {
    let deliveryGeneration = 'delivery-old';
    let deliveryCalls = 0;
    const service = createWeatherWorkerControlService({
      ...fixture.deps,
      delivery: {
        getRuntimeStatus: () => ({
          ...fixture.deps.getRuntimeStatus(),
          role: 'delivery',
          workerGeneration: deliveryGeneration,
        }),
        restart: async () => {
          deliveryCalls++;
          deliveryGeneration = 'delivery-new';
        },
      },
    });
    assert.equal(service.request(request).statusCode, 202);
    assert.equal(
      service.request({ requestId: 'd1', expectedWorkerGeneration: 'delivery-old' }, 'delivery')
        .statusCode,
      202,
    );
    assert.deepEqual(service.request(request, 'delivery'), {
      statusCode: 409,
      body: { status: 'error', code: 'request_conflict' },
    });
    await Promise.resolve();
    assert.equal(deliveryCalls, 1);
    fixture.resolve();
    await service.waitForIdle();
    const delivered = service.get('d1');
    assert.equal(delivered.statusCode, 200);
    assert.equal(delivered.body.status, 'completed');
    if (delivered.body.status === 'completed') {
      assert.equal(delivered.body.role, 'delivery');
      assert.equal(delivered.body.workerGeneration, 'delivery-new');
      assert.equal('desiredRunning' in delivered.body, false);
    }
  } finally {
    fixture.close();
  }
});

test('再開は同IDへ合流、別IDと異世代を拒否し、専用履歴へ1回だけ記録する', async () => {
  const fixture = setup();
  try {
    const service = createWeatherWorkerControlService(fixture.deps);
    assert.deepEqual(service.request(request), inProgress);
    assert.deepEqual(service.request(request), inProgress);
    assert.deepEqual(service.request({ ...request, expectedWorkerGeneration: 'other' }), {
      statusCode: 409,
      body: { status: 'error', code: 'request_conflict' },
    });
    assert.deepEqual(service.request({ ...request, requestId: 'r2' }), {
      statusCode: 409,
      body: { status: 'error', code: 'restart_conflict' },
    });
    await Promise.resolve();
    assert.equal(fixture.calls(), 1);
    fixture.resolve();
    await service.waitForIdle();
    assert.deepEqual(service.get('r1'), success);
    assert.deepEqual(service.request(request), success);
    assert.equal(fixture.calls(), 1);
    assert.deepEqual(service.history(), {
      statusCode: 200,
      body: {
        status: 'ready',
        generatedAt: '2026-10-09T01:00:00.000Z',
        items: [
          {
            id: 1,
            operation: success.body,
            expectedWorkerGeneration: 'old',
            serverGenerationId: 'server-1',
            requestedAt: '2026-10-09T01:00:00.000Z',
            completedAt: '2026-10-09T01:00:00.000Z',
          },
        ],
        nextBeforeId: null,
      },
    });
  } finally {
    fixture.close();
  }
});

test('受付保存失敗はメモリで同IDを照合し、履歴一覧へ架空の行を返さない', async () => {
  const fixture = setup();
  try {
    fixture.connection.exec(
      "CREATE TRIGGER fail_insert BEFORE INSERT ON weather_worker_operation BEGIN SELECT RAISE(FAIL, 'test'); END",
    );
    const service = createWeatherWorkerControlService(fixture.deps);
    assert.deepEqual(service.request(request), {
      ...inProgress,
      body: { ...inProgress.body, historyRecorded: false },
    });
    fixture.resolve();
    await service.waitForIdle();
    assert.deepEqual(service.get('r1'), {
      ...success,
      body: { ...success.body, historyRecorded: false },
    });
    assert.deepEqual(service.request(request), {
      ...success,
      body: { ...success.body, historyRecorded: false },
    });
    assert.equal(fixture.calls(), 1);
    assert.deepEqual(service.history(), {
      statusCode: 200,
      body: {
        status: 'ready',
        generatedAt: '2026-10-09T01:00:00.000Z',
        items: [],
        nextBeforeId: null,
      },
    });
  } finally {
    fixture.close();
  }
});

test('完了保存失敗時はDBのin_progressよりメモリ結果を優先し、再起動後はunknownに閉じる', async () => {
  const fixture = setup();
  try {
    const service = createWeatherWorkerControlService(fixture.deps);
    service.request(request);
    fixture.connection.exec(
      "CREATE TRIGGER fail_update BEFORE UPDATE ON weather_worker_operation BEGIN SELECT RAISE(FAIL, 'test'); END",
    );
    fixture.resolve();
    await service.waitForIdle();
    assert.deepEqual(service.get('r1'), {
      ...success,
      body: { ...success.body, historyRecorded: false },
    });
    fixture.connection.exec('DROP TRIGGER fail_update');
    const next = createWeatherWorkerControlService({
      ...fixture.deps,
      serverGenerationId: 'server-2',
    });
    assert.deepEqual(next.get('r1'), {
      statusCode: 200,
      body: {
        status: 'completed',
        requestId: 'r1',
        role: 'acquisition',
        result: 'unknown',
        workerGeneration: null,
        errorCode: 'server_restarted',
        historyRecorded: true,
      },
    });
    assert.deepEqual(next.request(request), next.get('r1'));
    assert.equal(fixture.calls(), 1);
  } finally {
    fixture.close();
  }
});

test('終了確認不能をunknownとして保持し、通常例外とは区別する', async () => {
  for (const error of [
    new WeatherWorkerRestartError('unknown', 'exit_unconfirmed'),
    new Error('secret'),
  ]) {
    const fixture = setup();
    try {
      const service = createWeatherWorkerControlService(fixture.deps);
      service.request(request);
      await Promise.resolve();
      fixture.reject(error);
      await service.waitForIdle();
      assert.deepEqual(service.get('r1'), {
        statusCode: 200,
        body: {
          status: 'completed',
          requestId: 'r1',
          role: 'acquisition',
          result: error instanceof WeatherWorkerRestartError ? 'unknown' : 'failure',
          workerGeneration: 'old',
          errorCode:
            error instanceof WeatherWorkerRestartError ? 'exit_unconfirmed' : 'restart_failed',
          desiredRunning: false,
          historyRecorded: true,
        },
      });
    } finally {
      fixture.close();
    }
  }
});

test('履歴はID降順cursor・上限200、無効要求とshutdown中の新規受付を拒否する', async () => {
  const fixture = setup();
  try {
    const service = createWeatherWorkerControlService(fixture.deps);
    for (const body of [
      null,
      {},
      { ...request, role: 'delivery' },
      { ...request, requestId: '../x' },
    ]) {
      assert.deepEqual(service.request(body), {
        statusCode: 400,
        body: { status: 'error', code: 'invalid_request' },
      });
    }
    service.request(request);
    fixture.resolve();
    await service.waitForIdle();
    service.request({ requestId: 'r2', expectedWorkerGeneration: 'new' });
    await service.waitForIdle();
    const first = service.history({ limit: 1 });
    assert.equal(first.body.status, 'ready');
    if (first.body.status !== 'ready') assert.fail();
    assert.deepEqual(
      first.body.items.map((item) => item.id),
      [2],
    );
    assert.equal(first.body.nextBeforeId, 2);
    const second = service.history({ limit: 1, beforeId: 2 });
    if (second.body.status !== 'ready') assert.fail();
    assert.deepEqual(
      second.body.items.map((item) => item.id),
      [1],
    );
    assert.equal(second.body.nextBeforeId, null);
    assert.deepEqual(service.history({ limit: 201 }), {
      statusCode: 400,
      body: { status: 'error', code: 'invalid_request' },
    });
    service.stopAccepting();
    assert.deepEqual(service.request({ requestId: 'r3', expectedWorkerGeneration: 'new' }), {
      statusCode: 503,
      body: { status: 'error', code: 'weather_worker_control_unavailable' },
    });
    assert.deepEqual(service.request(request), success);
  } finally {
    fixture.close();
  }
});

test('未記録fallback上限でも既存IDを忘れず、新規の再開を拒否する', async () => {
  const fixture = setup();
  try {
    fixture.connection.exec(
      "CREATE TRIGGER fail_insert BEFORE INSERT ON weather_worker_operation BEGIN SELECT RAISE(FAIL, 'test'); END",
    );
    let generation = 'old';
    let calls = 0;
    const service = createWeatherWorkerControlService({
      ...fixture.deps,
      restart: async () => {
        calls++;
        generation = `g${calls}`;
      },
      getRuntimeStatus: () => ({
        ...fixture.deps.getRuntimeStatus(),
        workerGeneration: generation,
      }),
    });
    for (let i = 0; i < 200; i++) {
      assert.equal(
        service.request({ requestId: `r${i}`, expectedWorkerGeneration: generation }).statusCode,
        202,
      );
      await service.waitForIdle();
    }
    assert.deepEqual(service.request({ requestId: 'new', expectedWorkerGeneration: generation }), {
      statusCode: 503,
      body: { status: 'error', code: 'weather_worker_history_capacity' },
    });
    assert.deepEqual(service.request({ requestId: 'r0', expectedWorkerGeneration: 'old' }), {
      statusCode: 200,
      body: {
        status: 'completed',
        requestId: 'r0',
        role: 'acquisition',
        result: 'success',
        workerGeneration: 'g1',
        errorCode: null,
        historyRecorded: false,
        desiredRunning: false,
      },
    });
    assert.equal(calls, 200);
  } finally {
    fixture.close();
  }
});
