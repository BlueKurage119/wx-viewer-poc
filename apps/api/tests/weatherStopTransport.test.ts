import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { WeatherTransport } from '../src/runtime/weatherTransport.js';

async function until(condition: () => boolean) {
  const end = performance.now() + 1500;
  while (!condition()) {
    assert.ok(performance.now() < end);
    await delay(5);
  }
}

test('一般制御8件と停止2件が未完了でも終了・異常停止は独立し、各上限超過はbusy', async () => {
  const { port1, port2 } = new MessageChannel();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const failures: string[] = [];
  const left = new WeatherTransport(
    port1,
    'g',
    () => null,
    (code) => failures.push(code),
  );
  const right = new WeatherTransport(
    port2,
    'g',
    async (method, value) => {
      if (
        (value as { hold?: boolean })?.hold ||
        (method !== 'runtime.close' && method !== 'runtime.fail')
      )
        await blocked;
      return method;
    },
    (code) => failures.push(code),
  );
  try {
    const general = Array.from({ length: 8 }, () => left.call('publication.pause', {}));
    await assert.rejects(left.call('publication.release', {}), { message: 'busy' });
    const stops = [
      left.call('fetch.execute', { operation: 'stop' }),
      left.call('operation.query', { operation: 'stop' }),
    ];
    await assert.rejects(left.call('fetch.execute', { operation: 'stop' }), { message: 'busy' });
    assert.equal(await left.call('runtime.close', {}, 500), 'runtime.close');
    assert.equal(await left.call('runtime.fail', {}, 500), 'runtime.fail');
    assert.equal(left.size, 10);
    const lifecycle = [
      left.call('runtime.close', { hold: true }),
      left.call('runtime.fail', { hold: true }),
    ];
    await assert.rejects(left.call('runtime.close', null), { message: 'busy' });
    assert.equal(left.size, 12);
    release();
    await Promise.all([...general, ...stops, ...lifecycle]);
    assert.equal(left.size, 0);
    assert.deepEqual(failures, []);
    left.close();
    await assert.rejects(left.call('fetch.execute', { operation: 'stop' }), {
      message: 'not_ready',
    });
  } finally {
    release();
    left.close();
    right.close();
    port1.close();
    port2.close();
  }
});

test('Worker側のpayload/control未ACK枠を占有しても停止・照会の返信を返し、停止枠占有中も終了返信を返す', async () => {
  const { port1, port2 } = new MessageChannel();
  const held: unknown[] = [];
  const blockedIds = new Set<string>();
  const failures: string[] = [];
  const originalPost = port1.postMessage.bind(port1);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  port1.on('message', (message) => {
    if (message.type === 'frame') blockedIds.add(message.id);
    else if (message.type === 'control') {
      const packet = JSON.parse(Buffer.from(message.bytes).toString()) as { kind: string };
      if (packet.kind === 'call') blockedIds.add(message.id);
    }
  });
  port1.postMessage = ((message: { type: string; id: string }) => {
    if (message.type === 'ack' && blockedIds.has(message.id)) held.push(message);
    else originalPost(message);
  }) as typeof port1.postMessage;
  const left = new WeatherTransport(
    port1,
    'g',
    async () => {
      await blocked;
      return null;
    },
    (code) => failures.push(code),
  );
  const right = new WeatherTransport(
    port2,
    'g',
    (method, value) => {
      if ((value as { reject?: boolean } | null)?.reject)
        throw new Error('fixture-operation-failed');
      return { method, status: 'completed', error: null };
    },
    (code) => failures.push(code),
  );
  const requests: Promise<unknown>[] = [];
  try {
    requests.push(
      right.call('payload-1', 'x'.repeat(300000)),
      right.call('payload-2', 'x'.repeat(300000)),
      right.call('publication.pause', { padding: 'x'.repeat(200000) }),
      right.call('publication.pause', { padding: 'x'.repeat(200000) }),
    );
    await until(() => held.length === 4);
    assert.deepEqual(
      await left.call('fetch.execute', { operation: 'stop', operationId: 'stop-1' }, 500),
      { method: 'fetch.execute', status: 'completed', error: null },
    );
    assert.deepEqual(
      await left.call('operation.query', { operation: 'stop', operationId: 'stop-1' }, 500),
      { method: 'operation.query', status: 'completed', error: null },
    );
    await assert.rejects(
      left.call('operation.query', { operation: 'stop', operationId: 'stop-1', reject: true }, 500),
      { message: 'fixture-operation-failed' },
    );
    requests.push(
      right.call('operation.query', { operation: 'stop' }),
      right.call('operation.query', { operation: 'stop' }),
    );
    await until(() => held.length === 6);
    assert.deepEqual(await left.call('runtime.close', null, 500), {
      method: 'runtime.close',
      status: 'completed',
      error: null,
    });
    port1.postMessage = originalPost;
    for (const ack of held) originalPost(ack);
    release();
    await Promise.all(requests);
    assert.equal(left.size, 0);
    assert.equal(right.size, 0);
    assert.deepEqual(failures, []);
  } finally {
    port1.postMessage = originalPost;
    release();
    left.close();
    right.close();
    await Promise.allSettled(requests);
    port1.close();
    port2.close();
  }
});

test('payload組立64件の途中でも停止の単一control frameを受信・返信できる', async () => {
  const { port1, port2 } = new MessageChannel();
  const failures: string[] = [];
  const right = new WeatherTransport(
    port2,
    'g',
    () => ({ status: 'completed' }),
    (code) => failures.push(code),
  );
  const left = new WeatherTransport(
    port1,
    'g',
    () => null,
    (code) => failures.push(code),
  );
  try {
    for (let i = 0; i < 64; i++)
      port1.postMessage({
        protocolVersion: 1,
        generation: 'g',
        type: 'frame',
        id: `partial-${i}`,
        index: 0,
        final: false,
        bytes: new Uint8Array([123]),
      });
    assert.deepEqual(await left.call('fetch.execute', { operation: 'stop' }, 500), {
      status: 'completed',
    });
    assert.deepEqual(failures, []);
    assert.equal(left.size, 0);
  } finally {
    left.close();
    right.close();
    port1.close();
    port2.close();
  }
});
