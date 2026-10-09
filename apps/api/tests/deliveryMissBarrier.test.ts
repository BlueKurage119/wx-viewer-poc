import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, get } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { createDeliveryApplicationRuntime } from '../src/runtime/createApplicationRuntime.js';
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
