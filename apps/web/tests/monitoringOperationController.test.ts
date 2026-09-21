import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMonitoringOperationController,
  type FetchControlClient,
  type FetchControlReply,
  type SubmittedOperation,
} from '../src/monitoring/monitoringOperationController.ts';

const requestId = '123e4567-e89b-42d3-a456-426614174000';
const completed = (request: SubmittedOperation): FetchControlReply => ({
  kind: 'completed',
  response: {
    status: 'completed',
    requestId: request.requestId,
    operationKind: request.operationKind,
    targetKind: 'all',
    result: 'success',
    requestedAt: '2026-09-22T01:02:03.000Z',
    completedAt: '2026-09-22T01:02:04.000Z',
    duplicate: false,
    errorCode: null,
    errorMessage: null,
    fetchControlState: 'stopped',
  },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const entries = new Map<number, { at: number; callback: () => void }>();
  return {
    setTimeout(callback: () => void, delayMs: number) {
      const id = nextId++;
      entries.set(id, { at: now + delayMs, callback });
      return id;
    },
    clearTimeout(id: number) {
      entries.delete(id);
    },
    advance(ms: number) {
      const until = now + ms;
      while (true) {
        const due = [...entries.entries()]
          .filter(([, entry]) => entry.at <= until)
          .sort(([, left], [, right]) => left.at - right.at)[0];
        if (!due) break;
        entries.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = until;
    },
    get size() {
      return entries.size;
    },
  };
}

test('30秒待機後はPOSTを再送せず、同じIDを一度照会して完了を確定する', async () => {
  const timers = fakeTimers();
  const post = deferred<FetchControlReply>();
  const finds: SubmittedOperation[] = [];
  const client: FetchControlClient = {
    submit: async () => post.promise,
    find: async (request) => {
      finds.push(request);
      return completed(request);
    },
  };
  const controller = createMonitoringOperationController({
    client,
    requestIdFactory: () => requestId,
    ...timers,
  });
  controller.submit('stop');
  controller.submit('stop');
  assert.equal(controller.getSnapshot().phase, 'sending');
  timers.advance(29_999);
  assert.equal(finds.length, 0);
  timers.advance(1);
  await Promise.resolve();
  assert.deepEqual(finds, [{ requestId, operationKind: 'stop' }]);
  assert.equal(controller.getSnapshot().phase, 'completed');
  assert.equal(timers.size, 0);
  post.resolve(completed({ requestId, operationKind: 'stop' }));
  await Promise.resolve();
  assert.equal(controller.getSnapshot().phase, 'completed');
});

test('202は直列の5秒後照会を予約し、非表示中は予約を保留する', async () => {
  const timers = fakeTimers();
  const finds: SubmittedOperation[] = [];
  let findCount = 0;
  const client: FetchControlClient = {
    submit: async (request) => ({
      kind: 'in_progress',
      response: {
        status: 'in_progress',
        requestId: request.requestId,
        operationKind: request.operationKind,
        targetKind: 'all',
        requestedAt: '2026-09-22T01:02:03.000Z',
        fetchControlState: 'stopping',
      },
    }),
    find: async (request) => {
      finds.push(request);
      findCount += 1;
      if (findCount === 1) {
        return {
          kind: 'in_progress',
          response: {
            status: 'in_progress',
            requestId: request.requestId,
            operationKind: request.operationKind,
            targetKind: 'all',
            requestedAt: '2026-09-22T01:02:03.000Z',
            fetchControlState: 'stopping',
          },
        };
      }
      return completed(request);
    },
  };
  const controller = createMonitoringOperationController({
    client,
    requestIdFactory: () => requestId,
    ...timers,
  });
  controller.submit('stop');
  await Promise.resolve();
  assert.equal(controller.getSnapshot().phase, 'checking');
  timers.advance(4_999);
  assert.equal(finds.length, 0);
  timers.advance(1);
  await Promise.resolve();
  assert.equal(finds.length, 1);
  controller.setVisible(false);
  timers.advance(5_000);
  assert.equal(finds.length, 1);
  controller.setVisible(true);
  timers.advance(0);
  await Promise.resolve();
  assert.equal(finds.length, 2);
  assert.equal(controller.getSnapshot().phase, 'completed');
});
