import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import { WeatherTransport } from '../src/runtime/weatherTransport.js';
import { WeatherRequestRegistry } from '../src/runtime/weatherRequestRegistry.js';
import type { WeatherRequest, WeatherEpoch } from '../src/runtime/weatherContracts.js';

const epoch: WeatherEpoch = {
  serverGenerationId: 's',
  workerGeneration: 'w',
  weatherDatabaseGenerationId: 'd',
  readerEpoch: 'r',
};

test('読取と起動待機は共有64枠・起動8枠を守り、解放と閉鎖が冪等', async () => {
  const registry = new WeatherRequestRegistry(epoch);
  const releases = Array.from({ length: 8 }, () => registry.reserveStartup());
  assert.throws(() => registry.reserveStartup(), { message: 'busy' });
  let complete!: () => void;
  const blocker = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const request = (id: number): WeatherRequest<'history.references'> => ({
    protocolVersion: 1,
    requestId: String(id),
    epoch,
    deadlineAt: new Date(Date.now() + 5000).toISOString(),
    kind: 'history.references',
    payload: [],
  });
  const pending = Array.from({ length: 56 }, (_, i) =>
    registry.request(request(i), async () => {
      await blocker;
      return [];
    }),
  );
  assert.equal(registry.size, 64);
  assert.deepEqual((await registry.request(request(57), async () => [])).result, {
    status: 'failed',
    code: 'busy',
  });
  releases[0]!();
  releases[0]!();
  assert.equal(registry.size, 63);
  complete();
  await Promise.all(pending);
  releases.forEach((release) => release());
  assert.equal(registry.size, 0);
  registry.close();
  assert.throws(() => registry.reserveStartup(), { message: 'not_ready' });
});

test('実transportは256KiBでframe化し8MiB境界を守る', async () => {
  const { port1, port2 } = new MessageChannel();
  const lengths: number[] = [];
  const failures: string[] = [];
  port2.on('message', (message) => {
    if (message.type === 'frame') lengths.push(message.bytes.length);
  });
  const left = new WeatherTransport(
    port1,
    'g',
    () => null,
    (code) => failures.push(code),
  );
  const right = new WeatherTransport(
    port2,
    'g',
    (_method, value) => (typeof value === 'string' ? value.length : null),
    (code) => failures.push(code),
  );
  try {
    const overhead = Buffer.byteLength(
      JSON.stringify({ kind: 'call', id: '0'.repeat(36), method: 'echo', value: '', error: null }),
    );
    const size = 8 * 1024 * 1024 - overhead;
    assert.equal(await left.call('echo', 'x'.repeat(size)), size);
    assert.equal(lengths.length, 32);
    assert.deepEqual([...new Set(lengths)], [262144]);
    assert.equal(left.size, 0);
    await assert.rejects(left.call('echo', 'x'.repeat(size + 1)), { message: 'payload_too_large' });
    assert.deepEqual(failures, ['payload_too_large']);
    assert.equal(left.size, 0);
    left.close();
    await assert.rejects(left.call('echo', ''), { message: 'not_ready' });
  } finally {
    left.close();
    right.close();
    port1.close();
    port2.close();
  }
});

test('HTTP中断は取得依頼の待機枠を解放し、後着結果を採用しない', async () => {
  const { port1, port2 } = new MessageChannel();
  let complete!: () => void;
  const barrier = new Promise<void>((resolve) => {
    complete = resolve;
  });
  let started!: () => void;
  const executing = new Promise<void>((resolve) => {
    started = resolve;
  });
  const left = new WeatherTransport(
    port1,
    'g',
    () => null,
    () => {},
  );
  const cancelled: string[] = [];
  const right = new WeatherTransport(
    port2,
    'g',
    async () => {
      started();
      await barrier;
      return 'saved';
    },
    () => {},
    (id) => cancelled.push(id),
  );
  try {
    const controller = new AbortController();
    const pending = left.call('tile.ensure', { tile: 'a' }, 5000, controller.signal);
    await executing;
    controller.abort();
    await assert.rejects(pending, { message: 'deadline_exceeded' });
    for (let index = 0; cancelled.length === 0; index++) {
      assert.ok(index < 100);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(cancelled.length, 1);
    assert.equal(left.size, 0);
    complete();
    assert.equal(await left.call('tile.ensure', { tile: 'b' }, 5000), 'saved');
    assert.equal(left.size, 0);
  } finally {
    complete();
    left.close();
    right.close();
    port1.close();
    port2.close();
  }
});

test('tile.ensure期限は取消frameを送り、取得Worker全体の障害にしない', async () => {
  const { port1, port2 } = new MessageChannel();
  let complete!: () => void;
  const barrier = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const failures: string[] = [];
  const cancelled: string[] = [];
  const left = new WeatherTransport(
    port1,
    'g',
    () => null,
    (code) => failures.push(code),
  );
  const right = new WeatherTransport(
    port2,
    'g',
    async () => barrier,
    () => {},
    (id) => cancelled.push(id),
  );
  try {
    await assert.rejects(left.call('tile.ensure', { tile: 'deadline' }, 20), /handshake_timeout/);
    for (let index = 0; cancelled.length === 0; index++) {
      assert.ok(index < 100);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(cancelled.length, 1);
    assert.deepEqual(failures, []);
    assert.equal(left.size, 0);
  } finally {
    complete();
    left.close();
    right.close();
    port1.close();
    port2.close();
  }
});

test('payloadの未ACK2frameが停止制御の独立枠を塞がない', async () => {
  const { port1, port2 } = new MessageChannel();
  const held: unknown[] = [];
  const payloadIds = new Set<string>();
  port2.on('message', (message) => {
    if (message.type === 'frame') payloadIds.add(message.id);
  });
  const post = port2.postMessage.bind(port2);
  port2.postMessage = ((message: { type: string; id: string }) => {
    if (message.type === 'ack' && payloadIds.has(message.id)) held.push(message);
    else post(message);
  }) as typeof port2.postMessage;
  const left = new WeatherTransport(
    port1,
    'g',
    () => null,
    () => {},
  );
  const right = new WeatherTransport(
    port2,
    'g',
    (method) => method,
    () => {},
  );
  try {
    const work = [
      left.call('payload1', 'x'.repeat(300000)),
      left.call('payload2', 'x'.repeat(300000)),
    ];
    for (let attempt = 0; held.length < 2; attempt++) {
      assert.ok(attempt < 100);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(await left.call('runtime.close', null, 500), 'runtime.close');
    port2.postMessage = post;
    held.forEach((message) => post(message));
    assert.deepEqual(await Promise.all(work), ['payload1', 'payload2']);
    assert.equal(left.size, 0);
  } finally {
    left.close();
    right.close();
    port1.close();
    port2.close();
  }
});
