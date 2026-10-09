import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import type { MessagePort } from 'node:worker_threads';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { DeliveryTransport } from '../src/runtime/deliveryTransport.js';
import type { WeatherEpoch } from '../src/runtime/weatherContracts.js';

const epoch: WeatherEpoch = {
  serverGenerationId: 'server',
  workerGeneration: 'worker',
  weatherDatabaseGenerationId: 'database',
  readerEpoch: 'reader',
};
function waitPacket(
  port: MessagePort,
  type: string,
  id: string,
): Promise<{ type: string; id: string; accepted?: boolean }> {
  return new Promise((resolve) => {
    const receive = (packet: { type: string; id: string; accepted?: boolean }) => {
      if (packet.type !== type || packet.id !== id) return;
      port.off('message', receive);
      resolve(packet);
    };
    port.on('message', receive);
  });
}

test('提供転送は容量予約後に分割した完全なbytesを返す', async () => {
  const { port1, port2 } = new MessageChannel();
  const failures: string[] = [];
  const source = new Uint8Array(600 * 1024);
  for (let i = 0; i < source.byteLength; i++) source[i] = i % 251;
  const detached: number[] = [];
  const serverEndpoint = {
    postMessage(message: unknown, transfer?: readonly ArrayBuffer[]) {
      port2.postMessage(message, transfer as ArrayBuffer[]);
      if ((message as { type?: string }).type === 'frame')
        detached.push((message as { bytes: Uint8Array }).bytes.byteLength);
    },
    on: port2.on.bind(port2),
    off: port2.off.bind(port2),
  } as unknown as MessagePort;
  const server = new DeliveryTransport(
    serverEndpoint,
    async () => ({
      __deliveryHttp: {
        statusCode: 200,
        contentType: 'image/png',
        bytes: source,
        headers: { 'content-type': 'image/png' },
      },
    }),
    (code) => failures.push(code),
  );
  const client = new DeliveryTransport(
    port1,
    async () => null,
    (code) => failures.push(code),
  );
  try {
    const reply = await client.call<{
      statusCode: number;
      contentType: string;
      bytes: Uint8Array;
    }>(randomUUID(), epoch, 'read.http', null, 5000, true);
    assert.equal(reply.statusCode, 200);
    assert.equal(reply.contentType, 'image/png');
    assert.deepEqual(reply.bytes, source);
    assert.deepEqual(detached, [0, 0, 0]);
    assert.deepEqual(failures, []);
    assert.equal(client.size, 0);
  } finally {
    client.close();
    server.close();
    port1.close();
    port2.close();
  }
});

test('8MiBを超える提供応答は正常値として返さない', async () => {
  const { port1, port2 } = new MessageChannel();
  const server = new DeliveryTransport(
    port2,
    async () => ({
      __deliveryHttp: {
        statusCode: 200,
        contentType: 'image/png',
        bytes: new Uint8Array(8 * 1024 * 1024 + 1),
        headers: {},
      },
    }),
    () => {},
  );
  const client = new DeliveryTransport(
    port1,
    async () => null,
    () => {},
  );
  try {
    await assert.rejects(
      client.call(randomUUID(), epoch, 'read.http', null, 5000, true),
      /payload_too_large/,
    );
    assert.equal(client.size, 0);
  } finally {
    client.close();
    server.close();
    port1.close();
    port2.close();
  }
});

test('8MiBちょうどの応答は全frameを受領して成功する', async () => {
  const { port1, port2 } = new MessageChannel();
  const server = new DeliveryTransport(
    port2,
    async () => ({
      __deliveryHttp: {
        statusCode: 200,
        contentType: 'image/png',
        bytes: new Uint8Array(8 * 1024 * 1024),
        headers: { 'content-type': 'image/png' },
      },
    }),
    () => {},
  );
  const client = new DeliveryTransport(
    port1,
    async () => null,
    () => {},
  );
  try {
    const result = await client.call<{ bytes: Uint8Array; release?: () => void }>(
      randomUUID(),
      epoch,
      'read.http',
      null,
      5000,
      true,
    );
    assert.equal(result.bytes.byteLength, 8 * 1024 * 1024);
    result.release?.();
    assert.equal(client.size, 0);
  } finally {
    client.close();
    server.close();
    port1.close();
    port2.close();
  }
});

test('256KiB-1と8MiB-1の提供応答は末尾frameまで受領し予約を解放する', async () => {
  const { port1, port2 } = new MessageChannel();
  const lengths: number[] = [];
  port1.on('message', (packet: { type: string; bytes?: Uint8Array }) => {
    if (packet.type === 'frame') lengths.push(packet.bytes!.byteLength);
  });
  let responseSize = 256 * 1024 - 1;
  const server = new DeliveryTransport(
    port2,
    async () => ({
      __deliveryHttp: {
        statusCode: 200,
        contentType: 'image/png',
        bytes: new Uint8Array(responseSize),
        headers: { 'content-type': 'image/png' },
      },
    }),
    () => {},
  );
  const client = new DeliveryTransport(
    port1,
    async () => null,
    () => {},
  );
  try {
    for (const size of [256 * 1024 - 1, 8 * 1024 * 1024 - 1]) {
      responseSize = size;
      const result = await client.call<{ bytes: Uint8Array; release: () => void }>(
        randomUUID(),
        epoch,
        'read.http',
        null,
        5000,
        true,
      );
      assert.equal(result.bytes.byteLength, size);
      assert.equal(lengths.at(-1), 256 * 1024 - 1);
      assert.equal(lengths.length, Math.ceil(size / (256 * 1024)));
      result.release();
      assert.equal(client.size, 0);
      lengths.length = 0;
    }
  } finally {
    client.close();
    server.close();
    port1.close();
    port2.close();
  }
});

test(
  'frame ACK途絶後は送受信のpending・frame・bytes予約をすべて解放する',
  { timeout: 8000 },
  async () => {
    const { port1, port2 } = new MessageChannel();
    const post = port1.postMessage.bind(port1);
    port1.postMessage = ((message: { type?: string }, transfer?: readonly ArrayBuffer[]) => {
      if (message.type !== 'ack') post(message, transfer as ArrayBuffer[]);
    }) as typeof port1.postMessage;
    const failures: string[] = [];
    const server = new DeliveryTransport(
      port2,
      async () => ({
        __deliveryHttp: {
          statusCode: 200,
          contentType: 'image/png',
          bytes: new Uint8Array(256 * 1024 + 1),
          headers: { 'content-type': 'image/png' },
        },
      }),
      (code) => failures.push(code),
    );
    const client = new DeliveryTransport(
      port1,
      async () => null,
      () => {},
    );
    const reservations = (transport: DeliveryTransport) =>
      transport as unknown as {
        pending: Map<string, unknown>;
        waiters: Map<string, unknown>;
        frameAcks: Map<string, unknown>;
        activeFrames: number;
        frameWaiters: unknown[];
        reservedBytes: number;
        sendingBytes: number;
        leases: Set<unknown>;
        inFlight: Set<string>;
      };
    const empty = (transport: DeliveryTransport) => {
      const state = reservations(transport);
      return (
        state.pending.size === 0 &&
        state.waiters.size === 0 &&
        state.frameAcks.size === 0 &&
        state.activeFrames === 0 &&
        state.frameWaiters.length === 0 &&
        state.reservedBytes === 0 &&
        state.sendingBytes === 0 &&
        state.leases.size === 0 &&
        state.inFlight.size === 0
      );
    };
    try {
      const result = await client.call<{ release: () => void }>(
        randomUUID(),
        epoch,
        'read.http',
        null,
        5000,
        true,
      );
      assert.equal(reservations(client).reservedBytes, 256 * 1024 + 1);
      result.release();
      const deadline = performance.now() + 6500;
      while (!failures.includes('handshake_timeout') || !empty(client) || !empty(server)) {
        assert.ok(performance.now() < deadline, 'ACK途絶後の予約が解放されません');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.deepEqual(failures, ['handshake_timeout', 'handshake_timeout']);
    } finally {
      client.close();
      server.close();
      port1.close();
      port2.close();
    }
  },
);

test('受領bytes予約はreleaseまで保持し、二重releaseは安全', async () => {
  const { port1, port2 } = new MessageChannel();
  let calls = 0;
  const server = new DeliveryTransport(
    port2,
    async () => ({
      __deliveryHttp: {
        statusCode: 200,
        contentType: 'image/png',
        bytes: new Uint8Array(++calls === 1 ? 8 * 1024 * 1024 : 1),
        headers: { 'content-type': 'image/png' },
      },
    }),
    () => {},
  );
  const client = new DeliveryTransport(
    port1,
    async () => null,
    () => {},
  );
  try {
    const first = await client.call<{ release: () => void }>(
      randomUUID(),
      epoch,
      'read.http',
      null,
      5000,
      true,
    );
    await assert.rejects(client.call(randomUUID(), epoch, 'read.http', null, 5000, true), /busy/);
    first.release();
    first.release();
    const third = await client.call<{ bytes: Uint8Array; release: () => void }>(
      randomUUID(),
      epoch,
      'read.http',
      null,
      5000,
      true,
    );
    assert.equal(third.bytes.byteLength, 1);
    third.release();
  } finally {
    client.close();
    server.close();
    port1.close();
    port2.close();
  }
});

test('通常64件と起動8件の受付上限を超える要求をbusyにする', async () => {
  const { port1, port2 } = new MessageChannel();
  const client = new DeliveryTransport(
    port1,
    async () => null,
    () => {},
  );
  try {
    const pending = Array.from({ length: 8 }, () =>
      client.call(randomUUID(), epoch, 'read', { kind: 'startup.project' }, 5000).catch(() => {}),
    );
    await assert.rejects(
      client.call(randomUUID(), epoch, 'read', { kind: 'startup.project' }, 5000),
      /busy/,
    );
    const ordinary = Array.from({ length: 56 }, () =>
      client.call(randomUUID(), epoch, 'read', { kind: 'weather.read' }, 5000).catch(() => {}),
    );
    assert.equal(client.size, 64);
    await assert.rejects(
      client.call(randomUUID(), epoch, 'read', { kind: 'weather.read' }, 5000),
      /busy/,
    );
    const control = client.call(randomUUID(), epoch, 'status.report', {}, 5000).catch(() => {});
    assert.equal(client.size, 65, '通常read満杯でも報告レーンを受け付ける');
    client.close();
    await Promise.all([...pending, ...ordinary, control]);
    assert.equal(client.size, 0);
  } finally {
    client.close();
    port1.close();
    port2.close();
  }
});

test('容量予約を拒否した場合は最初のframeも送らない', async () => {
  const { port1, port2 } = new MessageChannel();
  const server = new DeliveryTransport(
    port2,
    async () => ({
      __deliveryHttp: {
        statusCode: 200,
        contentType: 'image/png',
        bytes: new Uint8Array(300 * 1024),
        headers: { 'content-type': 'image/png' },
      },
    }),
    () => {},
  );
  let frames = 0;
  let rejectReply!: () => void;
  const replied = new Promise<void>((resolve) => {
    rejectReply = resolve;
  });
  port1.on('message', (packet: { type: string; id: string }) => {
    if (packet.type === 'begin')
      port1.postMessage({ type: 'reserve', id: packet.id, accepted: false });
    if (packet.type === 'frame') frames++;
    if (packet.type === 'reply') rejectReply();
  });
  try {
    port1.postMessage({
      type: 'call',
      id: 'reservation-refused',
      epoch,
      method: 'read.http',
      value: null,
    });
    await replied;
    assert.equal(frames, 0);
  } finally {
    server.close();
    port1.close();
    port2.close();
  }
});

test('異世代frameと256KiB超のframeを部分成功にしない', async () => {
  for (const defect of ['epoch', 'oversize'] as const) {
    const { port1, port2 } = new MessageChannel();
    const failures: string[] = [];
    const client = new DeliveryTransport(
      port1,
      async () => null,
      (code) => failures.push(code),
    );
    const id = randomUUID();
    try {
      const pending = client.call(id, epoch, 'read.http', null, 5000, true);
      port2.postMessage({
        type: 'begin',
        id,
        epoch,
        byteLength: 4,
        statusCode: 200,
        contentType: 'image/png',
        headers: { 'content-type': 'image/png' },
      });
      await new Promise<void>((resolve) => port2.once('message', () => resolve()));
      port2.postMessage({
        type: 'frame',
        id,
        epoch: defect === 'epoch' ? { ...epoch, readerEpoch: 'old-reader' } : epoch,
        index: 0,
        final: true,
        bytes: new Uint8Array(defect === 'oversize' ? 256 * 1024 + 1 : 4),
      });
      await assert.rejects(pending, /protocol_error/);
      assert.deepEqual(failures, ['protocol_error']);
      assert.equal(client.size, 0);
    } finally {
      client.close();
      port1.close();
      port2.close();
    }
  }
});

test('ACK未着では最大2frameまで送り、ACK後に次frameを送る', async () => {
  const { port1, port2 } = new MessageChannel();
  const server = new DeliveryTransport(
    port2,
    async () => ({
      __deliveryHttp: {
        statusCode: 200,
        contentType: 'image/png',
        bytes: new Uint8Array(700 * 1024),
        headers: { 'content-type': 'image/png' },
      },
    }),
    () => {},
  );
  const frames: number[] = [];
  let firstTwo!: () => void;
  let third!: () => void;
  const firstTwoReceived = new Promise<void>((resolve) => {
    firstTwo = resolve;
  });
  const thirdReceived = new Promise<void>((resolve) => {
    third = resolve;
  });
  port1.on('message', (packet: { type: string; id: string; index?: number }) => {
    if (packet.type === 'begin')
      port1.postMessage({ type: 'reserve', id: packet.id, accepted: true });
    if (packet.type === 'frame') {
      frames.push(packet.index!);
      if (frames.length === 2) firstTwo();
      if (frames.length === 3) third();
    }
  });
  try {
    port1.postMessage({ type: 'call', id: 'ack-window', epoch, method: 'read.http', value: null });
    await firstTwoReceived;
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(frames, [0, 1]);
    port1.postMessage({ type: 'ack', id: 'ack-window', index: 0 });
    port1.postMessage({ type: 'ack', id: 'ack-window', index: 1 });
    await thirdReceived;
    assert.deepEqual(frames, [0, 1, 2]);
    port1.postMessage({ type: 'ack', id: 'ack-window', index: 2 });
  } finally {
    server.close();
    port1.close();
    port2.close();
  }
});

test('取消でpendingと予約を解放し、後着frameを成功にしない', async () => {
  const { port1, port2 } = new MessageChannel();
  const client = new DeliveryTransport(
    port1,
    async () => null,
    () => {},
  );
  const id = randomUUID();
  try {
    const firstCall = waitPacket(port2, 'call', id);
    const pending = client.call(id, epoch, 'read.http', null, 5000, true);
    await firstCall;
    const firstReserve = waitPacket(port2, 'reserve', id);
    port2.postMessage({
      type: 'begin',
      id,
      epoch,
      byteLength: 4,
      statusCode: 200,
      contentType: 'image/png',
      headers: {},
    });
    await firstReserve;
    client.cancel(id);
    await assert.rejects(pending, /deadline_exceeded/);
    port2.postMessage({
      type: 'frame',
      id,
      epoch,
      index: 0,
      final: true,
      bytes: new Uint8Array(4),
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(client.size, 0);
    const nextId = randomUUID();
    const nextCall = waitPacket(port2, 'call', nextId);
    const next = client.call(nextId, epoch, 'read.http', null, 5000, true);
    await nextCall;
    const nextReserve = waitPacket(port2, 'reserve', nextId);
    port2.postMessage({
      type: 'begin',
      id: nextId,
      epoch,
      byteLength: 8 * 1024 * 1024,
      statusCode: 200,
      contentType: 'image/png',
      headers: {},
    });
    const reserve = await nextReserve;
    assert.equal(reserve.type, 'reserve');
    assert.equal(reserve.accepted, true, '取消後のbytes予約が残っていない');
    client.cancel(nextId);
    await assert.rejects(next, /deadline_exceeded/);
  } finally {
    client.close();
    port1.close();
    port2.close();
  }
});

test('ACKが届かないframeは5秒で失敗を報告し、次の要求へ枠を解放する', async () => {
  const { port1, port2 } = new MessageChannel();
  const failures: string[] = [];
  const server = new DeliveryTransport(
    port2,
    async () => ({
      __deliveryHttp: {
        statusCode: 200,
        contentType: 'image/png',
        bytes: new Uint8Array(300 * 1024),
        headers: { 'content-type': 'image/png' },
      },
    }),
    (code) => failures.push(code),
  );
  let frames = 0;
  let replied!: () => void;
  const response = new Promise<void>((resolve) => {
    replied = resolve;
  });
  port1.on('message', (packet: { type: string; id: string }) => {
    if (packet.type === 'begin')
      port1.postMessage({ type: 'reserve', id: packet.id, accepted: true });
    if (packet.type === 'frame') frames++;
    if (packet.type === 'reply') replied();
  });
  try {
    port1.postMessage({ type: 'call', id: 'ack-timeout', epoch, method: 'read.http', value: null });
    await response;
    assert.equal(frames, 2);
    assert.ok(failures.includes('handshake_timeout'));
    assert.equal(server.size, 0);
  } finally {
    server.close();
    port1.close();
    port2.close();
  }
});
