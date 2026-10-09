import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createServer, get, ServerResponse } from 'node:http';
import { MessageChannel } from 'node:worker_threads';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { createDeliveryApplicationRuntime } from '../src/runtime/createApplicationRuntime.js';
import { DeliveryTransport } from '../src/runtime/deliveryTransport.js';
import type { WeatherOperations } from '../src/runtime/weatherContracts.js';
import { initializeTestDatabases } from './helpers/databasePair.js';

test('cache missの取得待機中も別タイルと保存済みテキスト各20要求が進む', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'wx-miss-barrier-'));
  const pair = initializeTestDatabases({
    databasePath: join(directory, 'weather.sqlite3'),
    migrationsDirectory: join(import.meta.dirname, '../migrations'),
  });
  const now = new Date().toISOString();
  const terminal = { id: 'hkeagh01', name: '試験端末', mode: 'H', venueId: 'east' } as const;
  const registry = {
    listTerminals: () => [],
    resolveTerminal: (id: string) => (id === terminal.id ? terminal : null),
  };
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  let releaseEnsure!: () => void;
  let notifyEnsure!: () => void;
  const enteredEnsure = new Promise<void>((resolve) => {
    notifyEnsure = resolve;
  });
  const blockedEnsure = new Promise<void>((resolve) => {
    releaseEnsure = resolve;
  });
  let ensured = false;
  let ensureCalls = 0;
  let releasedTiles = 0;
  let releasedTexts = 0;
  const read = async <K extends keyof WeatherOperations>(
    kind: K,
    payload: WeatherOperations[K]['request'],
  ): Promise<WeatherOperations[K]['response']> => {
    if (kind === 'tile.read') {
      const coordinate = (payload as WeatherOperations['tile.read']['request']).coordinate;
      if (coordinate.tileX === 1 && !ensured) return { kind: 'miss' } as never;
      return {
        kind: 'hit',
        bytes: png,
        contentType: 'image/png',
        storedAt: now,
        catalogAvailability: 'available',
        release: () => {
          releasedTiles++;
        },
      } as never;
    }
    throw new Error(`想定外の読取: ${kind}`);
  };
  const runtime = createDeliveryApplicationRuntime({
    read,
    ensureTile: async () => {
      ensureCalls++;
      notifyEnsure();
      await blockedEnsure;
      ensured = true;
      return { kind: 'stored', tileResult: 'downloaded' };
    },
    retainedConnection: pair.retained.connection,
    terminalRegistry: registry as never,
    weatherDatabaseGenerationId: 'test-generation',
    now: () => now,
  });
  const http = createServer(
    createApp({
      ...runtime.dependencies,
      terminalRegistry: registry as never,
      weatherHttp: async () => ({
        statusCode: 200,
        contentType: 'application/json; charset=utf-8',
        bytes: Buffer.from('{"data":{"saved":true}}'),
        headers: {},
        release: () => {
          releasedTexts++;
        },
      }),
    }),
  );
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  assert.ok(address && typeof address !== 'string');
  const root = `http://127.0.0.1:${address.port}`;
  const tile = (x: number) =>
    `${root}/api/weather/nowcast/N1/tiles/10/${x}/${x}.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${now}&validTime=${now}`;
  const miss = fetch(tile(1));
  try {
    await enteredEnsure;
    const elapsed: number[] = [];
    for (let index = 0; index < 20; index++) {
      const started = performance.now();
      const [tileResponse, textResponse] = await Promise.all([
        fetch(tile(2)),
        fetch(`${root}/api/weather/warning-timeseries?terminalId=hkeagh01&controlStatus=normal`),
      ]);
      assert.equal(tileResponse.status, 200);
      assert.deepEqual(Buffer.from(await tileResponse.arrayBuffer()), png);
      assert.equal(textResponse.status, 200);
      assert.deepEqual(((await textResponse.json()) as { data: unknown }).data, { saved: true });
      const duration = performance.now() - started;
      elapsed.push(duration);
      assert.equal(duration < 2000, true);
    }
    elapsed.sort((a, b) => a - b);
    t.diagnostic(
      JSON.stringify({
        missBarrier: { count: elapsed.length, maximumMs: elapsed.at(-1), p95Ms: elapsed[18] },
      }),
    );
    assert.equal(ensureCalls, 1);
    assert.equal(releasedTiles, 20);
    assert.equal(releasedTexts, 20);
    releaseEnsure();
    assert.equal((await miss).status, 200);
    assert.equal(ensureCalls, 1);
    assert.equal(releasedTiles, 21);
    const direct = await runtime.dependencies.nowcastApi!.getTile(
      { product: 'N1', baseTime: now, validTime: now, element: 'hrpns', member: 'none' },
      { zoom: 10, tileX: 2, tileY: 2 },
    );
    assert.equal(direct.kind, 'success');
    if (direct.kind === 'success') {
      assert.equal(direct.buffer, png, '提供bytesをHTTPへ渡す前に複製しました');
      direct.release?.();
    }
    assert.equal(releasedTiles, 22);
  } finally {
    releaseEnsure();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    runtime.close();
    pair.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('遅いHTTPクライアントは5秒でsocketを閉じ送信予約を解放する', async () => {
  let released = 0;
  let releasedAt = 0;
  const registry = {
    resolveTerminal: (id: string) =>
      id === 'hkeagh01' ? { id, name: '試験端末', mode: 'H', venueId: 'east' } : null,
  };
  const http = createServer(
    createApp({
      terminalRegistry: registry as never,
      weatherApi: { getWarnings: () => null } as never,
      weatherHttp: async () => ({
        statusCode: 200,
        contentType: 'application/json; charset=utf-8',
        bytes: new Uint8Array(8 * 1024 * 1024),
        headers: {},
        release: () => {
          released++;
          releasedAt = performance.now();
        },
      }),
    }),
  );
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  assert.ok(address && typeof address !== 'string');
  const started = performance.now();
  const serverSocketClosed = new Promise<void>((resolve) => {
    http.once('connection', (socket) => socket.once('close', resolve));
  });
  try {
    const request = get(
      `http://127.0.0.1:${address.port}/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal`,
      (response) => response.pause(),
    );
    request.on('error', () => {});
    await Promise.race([
      serverSocketClosed,
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `送信期限内にserver socketが閉じません: released=${released}, after=${releasedAt - started}ms`,
              ),
            ),
          7000,
        ),
      ),
    ]);
    const elapsed = performance.now() - started;
    assert.equal(elapsed >= 4500 && elapsed < 7000, true, `${elapsed}ms`);
    assert.equal(released, 1);
  } finally {
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});

test(
  '遅いPNGクライアントは8MiB予約を保持し、5秒後に解放して次のtileを通す',
  { timeout: 12_000 },
  async () => {
    const { port1, port2 } = new MessageChannel();
    const epoch = {
      serverGenerationId: 'server',
      workerGeneration: 'worker',
      weatherDatabaseGenerationId: 'database',
      readerEpoch: 'reader',
    };
    const serverTransport = new DeliveryTransport(
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
    const clientTransport = new DeliveryTransport(
      port1,
      async () => null,
      () => {},
    );
    const reserved = () => (clientTransport as unknown as { reservedBytes: number }).reservedBytes;
    let currentBytes: Uint8Array | undefined;
    const sameBytesAtSend: boolean[] = [];
    const originalEnd = ServerResponse.prototype.end;
    ServerResponse.prototype.end = function (
      this: ServerResponse,
      chunk?: unknown,
      ...args: unknown[]
    ) {
      if (chunk instanceof Uint8Array && chunk.byteLength === 8 * 1024 * 1024)
        sameBytesAtSend.push(chunk === currentBytes);
      return originalEnd.apply(this, [chunk, ...args] as Parameters<typeof originalEnd>);
    } as typeof originalEnd;
    const terminalRegistry = {
      resolveTerminal: (id: string) =>
        id === 'hkeagh01' ? { id, name: '試験端末', mode: 'H', venueId: 'east' } : null,
    };
    const http = createServer(
      createApp({
        terminalRegistry: terminalRegistry as never,
        nowcastApi: {
          async getTile() {
            const response = await clientTransport.call<{
              bytes: Uint8Array;
              release: () => void;
            }>(randomUUID(), epoch, 'read.http', null, 5000, true);
            currentBytes = response.bytes;
            return {
              kind: 'success',
              buffer: response.bytes,
              catalogAvailability: 'available',
              tileResult: 'cached',
              storedAt: '2026-10-09T00:00:00.000Z',
              release: response.release,
            };
          },
        } as never,
      }),
    );
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/api/weather/nowcast/N1/tiles/10/1/1.png?terminalId=hkeagh01&controlStatus=normal&baseTime=2026-10-09T00:00:00.000Z&validTime=2026-10-09T00:00:00.000Z`;
    const socketClosed = new Promise<void>((resolve) => {
      http.once('connection', (socket) => socket.once('close', resolve));
    });
    const started = performance.now();
    try {
      const slow = get(url, (response) => response.pause());
      slow.on('error', () => {});
      const deadline = performance.now() + 3000;
      while (reserved() !== 8 * 1024 * 1024) {
        assert.ok(performance.now() < deadline, 'PNG予約が成立しません');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal((await fetch(url)).status, 503);
      assert.equal(reserved(), 8 * 1024 * 1024);
      await socketClosed;
      const elapsed = performance.now() - started;
      assert.equal(elapsed >= 4500 && elapsed < 7500, true, `${elapsed}ms`);
      assert.equal(reserved(), 0);
      const next = await fetch(url);
      assert.equal(next.status, 200);
      assert.equal((await next.arrayBuffer()).byteLength, 8 * 1024 * 1024);
      const finishDeadline = performance.now() + 1000;
      while (reserved() !== 0) {
        assert.ok(performance.now() < finishDeadline, '送信完了後のPNG予約が解放されません');
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.equal(reserved(), 0);
      assert.deepEqual(sameBytesAtSend, [true, true], 'HTTP送信前にPNG bytesを複製しました');
    } finally {
      ServerResponse.prototype.end = originalEnd;
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      clientTransport.close();
      serverTransport.close();
      port1.close();
      port2.close();
    }
  },
);
