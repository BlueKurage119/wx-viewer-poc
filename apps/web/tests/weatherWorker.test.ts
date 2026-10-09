import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { WeatherRestartOperation, WeatherRestartRequest } from '@wx-viewer-poc/shared';
import { createWeatherRestartController } from '../src/monitoring/weatherRestartController.ts';
import {
  createWeatherWorkerClient,
  parseWeatherRestartReply,
  type WeatherRestartReply,
} from '../src/api/weatherWorkers.ts';

function timers() {
  let now = 0;
  let id = 0;
  const jobs = new Map<number, { at: number; callback: () => void }>();
  return {
    setTimeout(callback: () => void, delay: number) {
      jobs.set(++id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(timer: number) {
      jobs.delete(timer);
    },
    advance(ms: number) {
      const end = now + ms;
      while (true) {
        const next = [...jobs]
          .filter(([, value]) => value.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        jobs.delete(next[0]);
        now = next[1].at;
        next[1].callback();
      }
      now = end;
    },
    size: () => jobs.size,
  };
}
const request = { requestId: 'restart-1', expectedWorkerGeneration: 'worker-1' };
const completed: WeatherRestartOperation = {
  status: 'completed',
  requestId: 'restart-1',
  role: 'acquisition',
  result: 'success',
  workerGeneration: 'worker-2',
  errorCode: null,
  historyRecorded: true,
};
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('再開POST応答喪失後は同じIDをGETし、二重クリックと遅延応答を抑止する', async () => {
  const clock = timers();
  let resolvePost!: (reply: WeatherRestartReply) => void;
  const posts: WeatherRestartRequest[] = [];
  const gets: WeatherRestartRequest[] = [];
  let refreshed = 0;
  const controller = createWeatherRestartController({
    ...clock,
    requestIdFactory: () => 'restart-1',
    onRefresh: () => refreshed++,
    client: {
      restart: (_role, value) => {
        posts.push(value);
        return new Promise((resolve) => {
          resolvePost = resolve;
        });
      },
      find: async (_role, value) => {
        gets.push(value);
        return { kind: 'operation', operation: completed };
      },
    },
  });
  controller.restart('worker-1');
  controller.restart('worker-1');
  assert.deepEqual(controller.getSnapshot(), { phase: 'sending', request });
  clock.advance(5_999);
  assert.deepEqual(gets, []);
  clock.advance(1);
  await flush();
  assert.deepEqual(posts, [request]);
  assert.deepEqual(gets, [request]);
  assert.deepEqual(controller.getSnapshot(), { phase: 'completed', request, operation: completed });
  assert.equal(refreshed, 1);
  assert.equal(clock.size(), 0);
  resolvePost({ kind: 'conflict' });
  await flush();
  assert.deepEqual(controller.getSnapshot(), { phase: 'completed', request, operation: completed });
  controller.dispose();
});

test('1秒間隔で照会し30秒で止め、結果確認待ちの間は再送しない', async () => {
  const clock = timers();
  let posts = 0;
  const gets: WeatherRestartRequest[] = [];
  const controller = createWeatherRestartController({
    ...clock,
    requestIdFactory: () => 'restart-1',
    onRefresh: () => undefined,
    client: {
      restart: async () => {
        posts++;
        return {
          kind: 'operation',
          operation: {
            status: 'in_progress',
            role: 'acquisition',
            requestId: 'restart-1',
            historyRecorded: true,
          },
        };
      },
      find: async (_role, value) => {
        gets.push(value);
        return { kind: 'unverifiable' };
      },
    },
  });
  controller.restart('worker-1');
  await flush();
  clock.advance(999);
  await flush();
  assert.equal(gets.length, 0);
  clock.advance(1);
  await flush();
  assert.equal(gets.length, 1);
  for (let count = 0; count < 29; count++) {
    clock.advance(1_000);
    await flush();
  }
  assert.deepEqual(controller.getSnapshot(), { phase: 'unverifiable', request });
  assert.equal(gets.length, 29);
  assert.equal(clock.size(), 0);
  controller.restart('worker-1');
  assert.equal(posts, 1);
  assert.equal(gets.length, 29);
  assert.deepEqual(controller.getSnapshot(), { phase: 'unverifiable', request });
  controller.dispose();
});

test('409は監視再取得だけを行い、自動再送せず終了する', async () => {
  const clock = timers();
  let refreshed = 0;
  let posts = 0;
  const controller = createWeatherRestartController({
    ...clock,
    requestIdFactory: () => 'restart-1',
    onRefresh: () => refreshed++,
    client: {
      restart: async () => {
        posts++;
        return { kind: 'conflict' };
      },
      find: async () => {
        throw new Error('照会不要');
      },
    },
  });
  controller.restart('worker-1');
  await flush();
  clock.advance(60_000);
  assert.deepEqual(controller.getSnapshot(), { phase: 'conflict', request });
  assert.equal(posts, 1);
  assert.equal(refreshed, 1);
  assert.equal(clock.size(), 0);
});

test('APIは他ID・他role・履歴記録フラグの欠落を正常応答としない', () => {
  assert.deepEqual(parseWeatherRestartReply(200, completed, 'restart-1'), {
    kind: 'operation',
    operation: completed,
  });
  for (const body of [
    { ...completed, requestId: 'other' },
    { ...completed, role: 'delivery' },
    { ...completed, historyRecorded: undefined },
  ]) {
    assert.deepEqual(parseWeatherRestartReply(200, body, 'restart-1'), { kind: 'unverifiable' });
  }
});

test('APIはPOST内容と同ID照会・専用履歴のURLを送信し、未記録履歴を拒否する', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const client = createWeatherWorkerClient({
    fetch: (async (url, init) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify(completed), { status: 200 });
    }) as typeof fetch,
  });
  const signal = new AbortController().signal;
  await client.restart('acquisition', request, signal);
  await client.find('acquisition', request, signal);
  assert.deepEqual(calls, [
    { url: '/api/control/weather-workers/acquisition/restart', body: request },
    { url: '/api/control/weather-workers/operations/restart-1', body: null },
  ]);
  await assert.rejects(client.history(21, signal), { message: '再開履歴の応答形式が不正です' });
  assert.deepEqual(calls[2], {
    url: '/api/monitoring/weather-worker-operations?limit=20&beforeId=21',
    body: null,
  });
});

test('提供再開は専用URLと同ID照会を使い、取得停止意図を表示しない', async () => {
  const deliveryOperation: WeatherRestartOperation = {
    status: 'completed',
    requestId: 'restart-1',
    role: 'delivery',
    result: 'success',
    workerGeneration: 'worker-2',
    errorCode: null,
    historyRecorded: true,
  };
  const calls: string[] = [];
  const client = createWeatherWorkerClient({
    fetch: (async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify(deliveryOperation), { status: 200 });
    }) as typeof fetch,
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await client.restart('delivery', request, signal), {
    kind: 'operation',
    operation: deliveryOperation,
  });
  assert.deepEqual(await client.find('delivery', request, signal), {
    kind: 'operation',
    operation: deliveryOperation,
  });
  assert.deepEqual(calls, [
    '/api/control/weather-workers/delivery/restart',
    '/api/control/weather-workers/operations/restart-1',
  ]);
});
