import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectWeatherRuntimeStatus,
  canRestartWeatherRuntime,
  type WeatherRuntimeStatus,
} from '../src/weatherRuntime.js';
const input: Omit<WeatherRuntimeStatus, 'reportFreshness' | 'restartAllowed'> = {
  role: 'acquisition',
  mode: 'worker',
  workerGeneration: 'worker-1',
  lifecycle: 'ready',
  reportedAt: '2026-10-09T00:00:00.000Z',
  receivedAt: '2026-10-09T00:00:00.000Z',
  stopReason: null,
  pendingRequests: 0,
  exitConfirmed: false,
  failureCode: null,
};
test('受領後15秒まではfresh、超過はstaleで再開可能', () => {
  assert.deepEqual(projectWeatherRuntimeStatus(input, '2026-10-09T00:00:15.000Z'), {
    ...input,
    reportFreshness: 'fresh',
    restartAllowed: false,
  });
  assert.deepEqual(projectWeatherRuntimeStatus(input, '2026-10-09T00:00:15.001Z'), {
    ...input,
    reportFreshness: 'stale',
    restartAllowed: true,
  });
});
test('fresh/unknownの制御失敗は再開可能だが、停止処理中と異世代は拒否', () => {
  for (const receivedAt of [null, input.receivedAt]) {
    const state = projectWeatherRuntimeStatus(
      { ...input, receivedAt, lifecycle: 'failed', failureCode: 'protocol_error' },
      '2026-10-09T00:00:01.000Z',
    );
    assert.equal(state.restartAllowed, true);
    assert.equal(
      canRestartWeatherRuntime(state, { requestId: 'r1', expectedWorkerGeneration: 'worker-1' }),
      true,
    );
    assert.equal(
      canRestartWeatherRuntime(state, { requestId: 'r1', expectedWorkerGeneration: 'other' }),
      false,
    );
  }
  for (const lifecycle of ['stopping', 'restarting'] as const) {
    assert.equal(
      projectWeatherRuntimeStatus({ ...input, lifecycle }, '2026-10-09T00:00:30.000Z')
        .restartAllowed,
      false,
    );
  }
});
