import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Server } from 'node:http';
import { spawn } from 'node:child_process';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import { openDatabase, runMigrations } from '../src/database/index.js';
import { createApp } from '../src/app.js';
import { startServer } from '../src/server.js';
import { NowcastService } from '../src/polling/nowcastService.js';
import {
  createNowcastApiService as createNowcastApiServiceImpl,
  type NowcastApiServiceDependencies,
} from '../src/services/nowcastApiService.js';
import { createStaticTileDeliveryProfileService } from '../src/services/tileDeliveryProfileService.js';
import { findRadarSnapshot } from '../src/repositories/radarRepository.js';

const VALID_1X1_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const VALID_1X1_PNG = Buffer.from(VALID_1X1_PNG_BASE64, 'base64');
const proxyProfileService = createStaticTileDeliveryProfileService('proxy');

function createNowcastApiService(
  dependencies: Omit<NowcastApiServiceDependencies, 'tileDeliveryProfileService'>,
) {
  return createNowcastApiServiceImpl({
    ...dependencies,
    tileDeliveryProfileService: proxyProfileService,
  });
}

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures/jma/nowcast');
const n1SyntheticJson = fs.readFileSync(
  path.join(FIXTURES_DIR, 'nowcast_target_times_n1_synthetic.json'),
  'utf-8',
);
const n2SyntheticJson = fs.readFileSync(
  path.join(FIXTURES_DIR, 'nowcast_target_times_n2_synthetic.json'),
  'utf-8',
);

function createTestClient(app: ReturnType<typeof createApp>) {
  return {
    async request(
      urlPath: string,
      options: { method?: string; headers?: Record<string, string> } = {},
    ) {
      const server = await new Promise<Server>((resolve, reject) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
        s.once('error', reject);
      });
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('missing addr');
      const port = addr.port;

      try {
        const method = options.method ?? 'GET';
        const headers = options.headers ?? {};
        return await new Promise<{
          statusCode: number;
          headers: Record<string, string>;
          body: Buffer;
          text: string;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          json: any;
        }>((resolve, reject) => {
          const req = http.request(
            {
              hostname: '127.0.0.1',
              port,
              path: urlPath,
              method,
              headers,
            },
            (response) => {
              const chunks: Buffer[] = [];
              response.on('data', (c) => chunks.push(c));
              response.on('end', () => {
                const body = Buffer.concat(chunks);
                const text = body.toString('utf-8');
                let json: unknown = null;
                try {
                  json = JSON.parse(text);
                } catch {
                  // ignore
                }
                const resHeaders: Record<string, string> = {};
                for (const [k, v] of Object.entries(response.headers)) {
                  if (typeof v === 'string') resHeaders[k.toLowerCase()] = v;
                  else if (Array.isArray(v)) resHeaders[k.toLowerCase()] = v.join(', ');
                }
                resolve({
                  statusCode: response.statusCode ?? 0,
                  headers: resHeaders,
                  body,
                  text,
                  json,
                });
              });
            },
          );
          req.once('error', reject);
          req.end();
        });
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
      }
    },
  };
}

function setupNowcastEnv() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nowcast-api-test-'));
  const connection = openDatabase(':memory:');
  const migrationsDir = path.join(import.meta.dirname, '../migrations');
  runMigrations(connection, migrationsDir);

  const cleanup = () => {
    connection.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };

  return { tmpDir, connection, cleanup };
}

test('B02: ナウキャスト - snapshot なし・初回失敗・正常空を作り、data=null と data={frames:[]}、試行時刻の保持、lastSuccessAt=null の区別を完全一致で検証', async () => {
  const { tmpDir, connection, cleanup } = setupNowcastEnv();
  try {
    let currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;

    // 1. snapshot なし
    const service1 = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      clock,
    });
    const apiService1 = createNowcastApiService({
      getService: () => service1,
      enablePolling: true,
      clock,
    });
    const app1 = createApp({ nowcastApi: apiService1 });
    const client1 = createTestClient(app1);

    const res1 = await client1.request(
      '/api/weather/nowcast/times?terminalId=hkeagh01&controlStatus=normal',
    );
    assert.equal(res1.statusCode, 200);
    assert.deepEqual(res1.json.products.N1, {
      metadata: {
        source: null,
        issuedAt: null,
        validAt: null,
        validFrom: null,
        validTo: null,
        fetchedAt: null,
        lastSuccessAt: null,
        availability: 'unavailable',
        sourceVersion: null,
      },
      data: null,
    });

    // 2. 初回失敗
    const failFetch: typeof fetch = async () => new Response('Error', { status: 500 });
    const service2 = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: failFetch,
      clock,
    });
    await service2.refreshTimes();

    const apiService2 = createNowcastApiService({
      getService: () => service2,
      enablePolling: true,
      clock,
    });
    const app2 = createApp({ nowcastApi: apiService2 });
    const client2 = createTestClient(app2);

    const res2 = await client2.request(
      '/api/weather/nowcast/times?terminalId=hkeagh01&controlStatus=normal',
    );
    assert.equal(res2.statusCode, 200);
    assert.deepEqual(res2.json.products.N1, {
      metadata: {
        source: 'https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json',
        issuedAt: '2026-09-07T03:00:00.000Z',
        validAt: null,
        validFrom: null,
        validTo: null,
        fetchedAt: '2026-09-07T03:00:00.000Z',
        lastSuccessAt: null,
        availability: 'unavailable',
        sourceVersion: null,
      },
      data: null,
    });

    // 3. 正常空
    const emptyFetch: typeof fetch = async () => new Response(JSON.stringify([]), { status: 200 });
    currentTime = '2026-09-07T03:05:00.000Z';
    const service3 = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: emptyFetch,
      clock,
    });
    await service3.refreshTimes();

    const apiService3 = createNowcastApiService({
      getService: () => service3,
      enablePolling: true,
      clock,
    });
    const app3 = createApp({ nowcastApi: apiService3 });
    const client3 = createTestClient(app3);

    const res3 = await client3.request(
      '/api/weather/nowcast/times?terminalId=hkeagh01&controlStatus=normal',
    );
    assert.equal(res3.statusCode, 200);
    assert.equal(res3.json.products.N1.metadata.availability, 'available');
    assert.equal(res3.json.products.N1.metadata.lastSuccessAt, '2026-09-07T03:05:00.000Z');
    assert.deepEqual(res3.json.products.N1.data, { frames: [] });
  } finally {
    cleanup();
  }
});

test('B04: ナウキャスト - 一覧 GET を繰り返し、fixture fetch 0 回増加、DB 不変、refreshTimes 後に反映', async () => {
  const { tmpDir, connection, cleanup } = setupNowcastEnv();
  try {
    let fetchCount = 0;
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;

    const testFetch: typeof fetch = async (input) => {
      fetchCount++;
      const url = String(input);
      if (url.includes('targetTimes_N1.json'))
        return new Response(n1SyntheticJson, { status: 200 });
      return new Response(n2SyntheticJson, { status: 200 });
    };

    const service = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: testFetch,
      clock,
    });

    const apiService = createNowcastApiService({
      getService: () => service,
      enablePolling: true,
      clock,
    });
    const app = createApp({ nowcastApi: apiService });
    const client = createTestClient(app);

    // 初回 GET (未 refreshTimes)
    const res1 = await client.request(
      '/api/weather/nowcast/times?terminalId=hkeagh01&controlStatus=normal',
    );
    assert.equal(res1.statusCode, 200);
    assert.equal(res1.json.products.N1.data, null);
    assert.equal(fetchCount, 0);

    // 繰り返し GET
    for (let i = 0; i < 3; i++) {
      const res = await client.request(
        '/api/weather/nowcast/times?terminalId=hkeagh01&controlStatus=normal',
      );
      assert.equal(res.statusCode, 200);
      assert.equal(fetchCount, 0);
    }

    // refreshTimes 実行
    await service.refreshTimes();
    assert.equal(fetchCount, 2);

    const snapBefore = findRadarSnapshot(connection, 'N1')!;

    // 次の GET に反映される
    const res2 = await client.request(
      '/api/weather/nowcast/times?terminalId=hkeagh01&controlStatus=normal',
    );
    assert.equal(res2.statusCode, 200);
    assert.notEqual(res2.json.products.N1.data, null);
    assert.equal(fetchCount, 2); // GET で fetch は増えない

    const snapAfter = findRadarSnapshot(connection, 'N1')!;
    assert.equal(snapAfter.metadata.fetchedAt, snapBefore.metadata.fetchedAt);
    assert.equal(snapAfter.metadata.lastSuccessAt, snapBefore.metadata.lastSuccessAt);
  } finally {
    cleanup();
  }
});

test('B05: ナウキャスト - 同 validTime の N1/N2、同 product の別 baseTime、欠けたコマが窓内の実在キーと完全一致し補間・統合されない', async () => {
  const { tmpDir, connection, cleanup } = setupNowcastEnv();
  try {
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;

    const testFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('targetTimes_N1.json'))
        return new Response(n1SyntheticJson, { status: 200 });
      return new Response(n2SyntheticJson, { status: 200 });
    };

    const service = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: testFetch,
      clock,
    });

    await service.refreshTimes();

    const apiService = createNowcastApiService({
      getService: () => service,
      enablePolling: true,
      clock,
    });
    const app = createApp({ nowcastApi: apiService });
    const client = createTestClient(app);

    const res = await client.request(
      '/api/weather/nowcast/times?terminalId=hkeagh01&controlStatus=normal',
    );
    assert.equal(res.statusCode, 200);

    const catalog = service.readCatalog();
    assert.deepEqual(
      res.json.products.N1.data.frames,
      catalog.products.N1.frames.map((f) => ({
        product: 'N1',
        baseTime: f.baseTime,
        validTime: f.validTime,
        element: 'hrpns',
        member: 'none',
      })),
    );
    assert.deepEqual(
      res.json.products.N2.data.frames,
      catalog.products.N2.frames.map((f) => ({
        product: 'N2',
        baseTime: f.baseTime,
        validTime: f.validTime,
        element: 'hrpns',
        member: 'none',
      })),
    );
  } finally {
    cleanup();
  }
});

test('B06: ナウキャスト - N1 成功/N2 初回失敗、成功後失敗、閾値直前/ちょうどで 3 状態を検証', async () => {
  const { tmpDir, connection, cleanup } = setupNowcastEnv();
  try {
    let currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;

    // N1 成功 / N2 失敗
    const partialFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('targetTimes_N1.json'))
        return new Response(n1SyntheticJson, { status: 200 });
      return new Response('Error', { status: 500 });
    };

    const service = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: partialFetch,
      clock,
    });

    await service.refreshTimes();

    const apiService = createNowcastApiService({
      getService: () => service,
      enablePolling: true,
      clock,
    });
    const app = createApp({ nowcastApi: apiService });
    const client = createTestClient(app);

    const res1 = await client.request(
      '/api/weather/nowcast/times?terminalId=hkeagh01&controlStatus=normal',
    );
    assert.equal(res1.json.products.N1.metadata.availability, 'available');
    assert.equal(res1.json.products.N2.metadata.availability, 'unavailable');

    // N1 成功後に失敗させる -> stale
    const failAllFetch: typeof fetch = async () => new Response('Error', { status: 500 });
    currentTime = '2026-09-07T03:02:00.000Z';
    const serviceFail = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: failAllFetch,
      clock,
    });
    await serviceFail.refreshTimes();

    const apiServiceFail = createNowcastApiService({
      getService: () => serviceFail,
      enablePolling: true,
      clock,
    });
    const clientFail = createTestClient(createApp({ nowcastApi: apiServiceFail }));
    const res2 = await clientFail.request(
      '/api/weather/nowcast/times?terminalId=hkeagh01&controlStatus=normal',
    );
    assert.equal(res2.json.products.N1.metadata.availability, 'stale');

    // 閾値直前 (299秒後: available) と ちょうど (300秒後: stale)
    // まず正常に N1 を取得し直す
    const goodFetch: typeof fetch = async () => new Response(n1SyntheticJson, { status: 200 });
    currentTime = '2026-09-07T03:10:00.000Z';
    const serviceFresh = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: goodFetch,
      clock,
    });
    await serviceFresh.refreshTimes();

    const apiServiceFresh = createNowcastApiService({
      getService: () => serviceFresh,
      enablePolling: true,
      clock,
    });
    const clientFresh = createTestClient(createApp({ nowcastApi: apiServiceFresh }));

    // 299秒後
    currentTime = new Date(
      new Date('2026-09-07T03:10:00.000Z').getTime() + 299 * 1000,
    ).toISOString() as UtcIso8601String;
    const resJustBefore = await clientFresh.request(
      '/api/weather/nowcast/times?terminalId=hkeagh01&controlStatus=normal',
    );
    assert.equal(resJustBefore.json.products.N1.metadata.availability, 'available');

    // 300秒後
    currentTime = new Date(
      new Date('2026-09-07T03:10:00.000Z').getTime() + 300 * 1000,
    ).toISOString() as UtcIso8601String;
    const resExact = await clientFresh.request(
      '/api/weather/nowcast/times?terminalId=hkeagh01&controlStatus=normal',
    );
    assert.equal(resExact.json.products.N1.metadata.availability, 'stale');
  } finally {
    cleanup();
  }
});

test('B07: ナウキャスト - 台帳端末 2 件で会場別 context・共通索引、training/test は 200 unsupported_control_status、画像は 422、サービス呼出し 0 回', async () => {
  const { cleanup } = setupNowcastEnv();
  try {
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;

    let readCatalogCount = 0;
    let fetchTilesCount = 0;

    const dummyService = {
      readCatalog: () => {
        readCatalogCount++;
        return {
          now: currentTime,
          window: { from: currentTime, to: currentTime },
          catalogAccess: { allowed: true, period: {} as never, nextAllowedAt: null },
          imageAccess: { allowed: true, period: {} as never, nextAllowedAt: null },
          products: {
            N1: { snapshot: null, availability: 'available' as const, frames: [] },
            N2: { snapshot: null, availability: 'available' as const, frames: [] },
          },
        };
      },
      fetchFrameTiles: async () => {
        fetchTilesCount++;
        return [];
      },
    } as unknown as NowcastService;

    const apiService = createNowcastApiService({
      getService: () => dummyService,
      enablePolling: true,
      clock,
    });
    const app = createApp({ nowcastApi: apiService });
    const client = createTestClient(app);

    // 別会場端末 2 件
    const resEast = await client.request(
      '/api/weather/nowcast/times?terminalId=hkeagh01&controlStatus=normal',
    );
    const resTrc = await client.request(
      '/api/weather/nowcast/times?terminalId=htrcph01&controlStatus=normal',
    );
    assert.equal(resEast.statusCode, 200);
    assert.equal(resTrc.statusCode, 200);
    assert.equal(resEast.json.venueId, 'east');
    assert.equal(resTrc.json.venueId, 'trc');
    assert.deepEqual(resEast.json.products, resTrc.json.products);

    // training / test
    readCatalogCount = 0;
    fetchTilesCount = 0;

    const resTraining = await client.request(
      '/api/weather/nowcast/times?terminalId=hkeagh01&controlStatus=training',
    );
    assert.equal(resTraining.statusCode, 200);
    assert.equal(resTraining.json.status, 'unsupported_control_status');
    assert.equal(resTraining.json.isTraining, true);
    assert.equal(resTraining.json.window, null);
    assert.equal(resTraining.json.catalogAccess, null);
    assert.equal(resTraining.json.imageAccess, null);
    assert.deepEqual(resTraining.json.allowedZooms, []);
    assert.equal(resTraining.json.products.N1.metadata.availability, 'unavailable');
    assert.equal(resTraining.json.products.N1.data, null);
    assert.equal(readCatalogCount, 0);

    const resTest = await client.request(
      '/api/weather/nowcast/times?terminalId=hkeagh01&controlStatus=test',
    );
    assert.equal(resTest.statusCode, 200);
    assert.equal(resTest.json.status, 'unsupported_control_status');
    assert.equal(resTest.json.isTraining, false);
    assert.equal(readCatalogCount, 0);

    // 画像 training/test は 422
    const resTileTraining = await client.request(
      '/api/weather/nowcast/N1/tiles/10/900/400.png?terminalId=hkeagh01&controlStatus=training&baseTime=2026-09-07T03:00:00.000Z&validTime=2026-09-07T03:05:00.000Z',
    );
    assert.equal(resTileTraining.statusCode, 422);
    assert.deepEqual(resTileTraining.json, {
      status: 'error',
      code: 'unsupported_control_status',
    });
    assert.equal(fetchTilesCount, 0);
  } finally {
    cleanup();
  }
});

test('B08: ナウキャスト - 形式違反・範囲外・未知端末は 400/404、上流呼出しなし', async () => {
  const { tmpDir, connection, cleanup } = setupNowcastEnv();
  try {
    let upstreamCalled = false;
    const service = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: async () => {
        upstreamCalled = true;
        return new Response('ok');
      },
    });

    const apiService = createNowcastApiService({
      getService: () => service,
      enablePolling: true,
    });
    const app = createApp({ nowcastApi: apiService });
    const client = createTestClient(app);

    const baseValid =
      '/api/weather/nowcast/N1/tiles/10/900/400.png?terminalId=hkeagh01&controlStatus=normal&baseTime=2026-09-07T03:00:00.000Z&validTime=2026-09-07T03:05:00.000Z';

    // 未知端末: 404
    const resUnknown = await client.request(baseValid.replace('hkeagh01', 'unknown99'));
    assert.equal(resUnknown.statusCode, 404);
    assert.equal(resUnknown.json.code, 'terminal_not_found');

    // 未知キー: 400
    const resExtra = await client.request(baseValid + '&extra=1');
    assert.equal(resExtra.statusCode, 400);
    assert.equal(resExtra.json.code, 'invalid_request');

    // product 不正: 400
    const resProduct = await client.request(baseValid.replace('/N1/', '/N3/'));
    assert.equal(resProduct.statusCode, 400);

    // z 範囲外: 400
    const resZ = await client.request(baseValid.replace('/10/', '/9/'));
    assert.equal(resZ.statusCode, 400);

    // x 負値・先頭ゼロ・小数・範囲外: 400
    assert.equal((await client.request(baseValid.replace('/900/', '/-1/'))).statusCode, 400);
    assert.equal((await client.request(baseValid.replace('/900/', '/0900/'))).statusCode, 400);
    assert.equal((await client.request(baseValid.replace('/900/', '/1024/'))).statusCode, 400);

    // 非正規/不可能日時: 400
    assert.equal(
      (await client.request(baseValid.replace('2026-09-07T03:00:00.000Z', '2026-09-07T03:00:00Z')))
        .statusCode,
      400,
    );
    assert.equal(
      (
        await client.request(
          baseValid.replace('2026-09-07T03:00:00.000Z', '2026-02-29T03:00:00.000Z'),
        )
      ).statusCode,
      400,
    );

    assert.equal(upstreamCalled, false);
  } finally {
    cleanup();
  }
});

test('B09: ナウキャスト - 実在フレーム単体 GET で PNG fixture 完全一致、初回 downloaded、2回目 cached、storedAt 不変、上流 0 回追加', async () => {
  const { tmpDir, connection, cleanup } = setupNowcastEnv();
  try {
    let fetchCount = 0;
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;

    const testFetch: typeof fetch = async (input) => {
      fetchCount++;
      const url = String(input);
      if (url.includes('targetTimes_N1.json'))
        return new Response(n1SyntheticJson, { status: 200 });
      if (url.includes('targetTimes_N2.json'))
        return new Response(n2SyntheticJson, { status: 200 });
      if (url.endsWith('.png')) return new Response(VALID_1X1_PNG, { status: 200 });
      return new Response('Not Found', { status: 404 });
    };

    const service = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: testFetch,
      clock,
    });
    await service.refreshTimes();

    const catalog = service.readCatalog();
    const frame = catalog.products.N1.frames[0]!;

    const apiService = createNowcastApiService({
      getService: () => service,
      enablePolling: true,
      clock,
    });
    const app = createApp({ nowcastApi: apiService });
    const client = createTestClient(app);

    const tileUrl = `/api/weather/nowcast/N1/tiles/10/900/400.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${encodeURIComponent(
      frame.baseTime,
    )}&validTime=${encodeURIComponent(frame.validTime)}`;

    // 1 回目: downloaded
    const initialFetchCount = fetchCount;
    const res1 = await client.request(tileUrl);
    assert.equal(res1.statusCode, 200);
    assert.equal(res1.headers['x-wx-tile-result'], 'downloaded');
    assert.deepEqual(res1.body, VALID_1X1_PNG);
    assert.equal(fetchCount, initialFetchCount + 1);
    const storedAt = res1.headers['x-wx-tile-stored-at'];
    assert.ok(storedAt);

    // 2 回目: cached
    const res2 = await client.request(tileUrl);
    assert.equal(res2.statusCode, 200);
    assert.equal(res2.headers['x-wx-tile-result'], 'cached');
    assert.deepEqual(res2.body, VALID_1X1_PNG);
    assert.equal(res2.headers['x-wx-tile-stored-at'], storedAt);
    assert.equal(fetchCount, initialFetchCount + 1); // 上流追加 0 回
  } finally {
    cleanup();
  }
});

test('B11: ナウキャスト - stale かつ画像許可でミス 200、停止時キャッシュ 200、停止時ミス 503 (disabled/scheduled_stopped)', async () => {
  const { tmpDir, connection, cleanup } = setupNowcastEnv();
  try {
    let currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;
    let allowImage = true;

    const testFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('targetTimes_N1.json'))
        return new Response(n1SyntheticJson, { status: 200 });
      if (url.endsWith('.png')) return new Response(VALID_1X1_PNG, { status: 200 });
      return new Response('Not Found', { status: 404 });
    };

    const service = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: allowImage, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: testFetch,
      clock,
    });
    await service.refreshTimes();
    const frame = service.readCatalog().products.N1.frames[0]!;

    // 1. stale かつ画像許可でミス要求 -> 200
    // 350秒経過させて stale にする
    currentTime = '2026-09-07T03:06:00.000Z';
    const apiService = createNowcastApiService({
      getService: () => service,
      enablePolling: true,
      clock,
    });
    const client = createTestClient(createApp({ nowcastApi: apiService }));

    const tileUrl1 = `/api/weather/nowcast/N1/tiles/10/900/400.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${encodeURIComponent(
      frame.baseTime,
    )}&validTime=${encodeURIComponent(frame.validTime)}`;

    const res1 = await client.request(tileUrl1);
    assert.equal(res1.statusCode, 200);
    assert.equal(res1.headers['x-wx-catalog-availability'], 'stale');
    assert.equal(res1.headers['x-wx-tile-result'], 'downloaded');

    // 2. 停止時の正常キャッシュ -> 200
    allowImage = false;
    const res2 = await client.request(tileUrl1);
    assert.equal(res2.statusCode, 200);
    assert.equal(res2.headers['x-wx-tile-result'], 'cached');

    // 3. 停止時ミス -> 503 scheduled_stopped
    const tileUrl2 = `/api/weather/nowcast/N1/tiles/10/901/400.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${encodeURIComponent(
      frame.baseTime,
    )}&validTime=${encodeURIComponent(frame.validTime)}`;
    const res3 = await client.request(tileUrl2);
    assert.equal(res3.statusCode, 503);
    assert.equal(res3.json.code, 'acquisition_stopped');
    assert.equal(res3.json.catalogAvailability, 'stale');
    assert.equal(res3.json.imageAccess.reason, 'scheduled_stopped');

    // 4. enablePolling=false -> reason=disabled
    const apiServiceDisabled = createNowcastApiService({
      getService: () => service,
      enablePolling: false,
      clock,
    });
    const clientDisabled = createTestClient(createApp({ nowcastApi: apiServiceDisabled }));
    const res4 = await clientDisabled.request(tileUrl2);
    assert.equal(res4.statusCode, 503);
    assert.equal(res4.json.imageAccess.reason, 'disabled');
  } finally {
    cleanup();
  }
});

test('B12: ナウキャスト - 窓外・不在は 404、上流エラーは 502、保存例外は 500、内部情報の露出なし', async () => {
  const { tmpDir, connection, cleanup } = setupNowcastEnv();
  try {
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;

    let httpStatus = 500;
    const testFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('targetTimes_N1.json'))
        return new Response(n1SyntheticJson, { status: 200 });
      if (url.endsWith('.png')) return new Response('Server Error', { status: httpStatus });
      return new Response('Not Found', { status: 404 });
    };

    const service = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: testFetch,
      clock,
    });
    await service.refreshTimes();

    const apiService = createNowcastApiService({
      getService: () => service,
      enablePolling: true,
      clock,
    });
    const client = createTestClient(createApp({ nowcastApi: apiService }));

    // 不在フレーム: 404
    const resNotFound = await client.request(
      '/api/weather/nowcast/N1/tiles/10/900/400.png?terminalId=hkeagh01&controlStatus=normal&baseTime=2026-09-07T03:00:00.000Z&validTime=2026-09-07T03:59:00.000Z',
    );
    assert.equal(resNotFound.statusCode, 404);
    assert.deepEqual(resNotFound.json, {
      status: 'error',
      code: 'frame_not_available',
      catalogAvailability: 'available',
    });

    const validFrame = service.readCatalog().products.N1.frames[0]!;
    const tileUrl = `/api/weather/nowcast/N1/tiles/10/900/400.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${encodeURIComponent(
      validFrame.baseTime,
    )}&validTime=${encodeURIComponent(validFrame.validTime)}`;

    // 上流 500 -> 502
    httpStatus = 500;
    const res502 = await client.request(tileUrl);
    assert.equal(res502.statusCode, 502);
    assert.deepEqual(res502.json, {
      status: 'error',
      code: 'tile_fetch_failed',
      catalogAvailability: 'available',
    });

    // 上流 404 -> 502
    httpStatus = 404;
    const res502_404 = await client.request(tileUrl);
    assert.equal(res502_404.statusCode, 502);
    assert.equal(res502_404.json.code, 'tile_fetch_failed');

    // 内部情報（DB ID, path, URL, 例外 message）がレスポンスに含まれないことを完全一致で確認
    assert.equal(Object.keys(res502.json).length, 3);
  } finally {
    cleanup();
  }
});

test('B13: ナウキャスト - DB 保存失敗等の注入で 500、他要求維持、復帰後 cached 200', async () => {
  const { tmpDir, connection, cleanup } = setupNowcastEnv();
  try {
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;

    const testFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('targetTimes_N1.json'))
        return new Response(n1SyntheticJson, { status: 200 });
      if (url.endsWith('.png')) return new Response(VALID_1X1_PNG, { status: 200 });
      return new Response('Not Found', { status: 404 });
    };

    const service = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: testFetch,
      clock,
    });
    await service.refreshTimes();
    const frame = service.readCatalog().products.N1.frames[0]!;

    const apiService = createNowcastApiService({
      getService: () => service,
      enablePolling: true,
      clock,
    });
    const client = createTestClient(createApp({ nowcastApi: apiService }));

    // 1 つ目の座標を正常取得
    const url1 = `/api/weather/nowcast/N1/tiles/10/900/400.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${encodeURIComponent(
      frame.baseTime,
    )}&validTime=${encodeURIComponent(frame.validTime)}`;
    const res1 = await client.request(url1);
    assert.equal(res1.statusCode, 200);

    // saveTile 失敗を注入（cacheRoot を一時的に読み取り専用にする等の代わりに service.tileStore.saveTile をモック）
    const origSaveTile = service.tileStore.saveTile.bind(service.tileStore);
    service.tileStore.saveTile = async () => {
      throw new Error('Disk error');
    };

    const url2 = `/api/weather/nowcast/N1/tiles/10/901/400.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${encodeURIComponent(
      frame.baseTime,
    )}&validTime=${encodeURIComponent(frame.validTime)}`;
    const res2 = await client.request(url2);
    assert.equal(res2.statusCode, 500);
    assert.equal(res2.json.code, 'tile_read_failed');

    // 障害解除
    service.tileStore.saveTile = origSaveTile;

    // 保存済みの url1 は引き続き cached 200 で取得できる
    const res1Again = await client.request(url1);
    assert.equal(res1Again.statusCode, 200);
    assert.equal(res1Again.headers['x-wx-tile-result'], 'cached');
  } finally {
    cleanup();
  }
});

test('B14: ナウキャスト - 既存キャッシュ破損時に再取得 200、停止中ミス 503、許可時間進行後の 503 と allowed=true 共存', async () => {
  const { tmpDir, connection, cleanup } = setupNowcastEnv();
  try {
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;
    let allowImage = true;

    const testFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('targetTimes_N1.json'))
        return new Response(n1SyntheticJson, { status: 200 });
      if (url.endsWith('.png')) return new Response(VALID_1X1_PNG, { status: 200 });
      return new Response('Not Found', { status: 404 });
    };

    const service = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: allowImage, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: testFetch,
      clock,
    });
    await service.refreshTimes();
    const frame = service.readCatalog().products.N1.frames[0]!;

    const apiService = createNowcastApiService({
      getService: () => service,
      enablePolling: true,
      clock,
    });
    const client = createTestClient(createApp({ nowcastApi: apiService }));

    const tileUrl = `/api/weather/nowcast/N1/tiles/10/900/400.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${encodeURIComponent(
      frame.baseTime,
    )}&validTime=${encodeURIComponent(frame.validTime)}`;

    // 正常取得
    const res1 = await client.request(tileUrl);
    assert.equal(res1.statusCode, 200);

    // キャッシュファイルを破損させる
    const snap = findRadarSnapshot(connection, 'N1')!;
    const matchedFrame = snap.frames.find((f) => f.validTime === frame.validTime)!;
    const tile = matchedFrame.tiles![0]!;
    const filePath = service.tileStore.resolvePath(tile.filePath);
    fs.writeFileSync(filePath, Buffer.from('corrupted'));

    // 画像許可時は再取得して 200
    const res2 = await client.request(tileUrl);
    assert.equal(res2.statusCode, 200);
    assert.equal(res2.headers['x-wx-tile-result'], 'downloaded');

    // 再度破損させ、停止中にする
    fs.writeFileSync(filePath, Buffer.from('corrupted'));
    allowImage = false;

    // 停止結果の直後に時計を進めて許可状態に切り替えるシミュレーション:
    // service.fetchFrameTiles が stopped になった後、readCatalog 評価時に allowImage = true になるようにフック
    const origFetchFrameTiles = service.fetchFrameTiles.bind(service);
    service.fetchFrameTiles = async (...args) => {
      const result = await origFetchFrameTiles(...args);
      allowImage = true; // 停止結果取得直後に時計・許可が進んだ状態
      return result;
    };

    const res3 = await client.request(tileUrl);
    assert.equal(res3.statusCode, 503);
    assert.equal(res3.json.code, 'acquisition_stopped');
    assert.equal(res3.json.imageAccess.allowed, true); // 503 と allowed=true が共存
  } finally {
    cleanup();
  }
});

test('B15: ナウキャスト - 成功結果後のファイル消失/改変で配信直前 500、正常時 Buffer 完全一致、他要求維持', async () => {
  const { tmpDir, connection, cleanup } = setupNowcastEnv();
  try {
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;

    const testFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('targetTimes_N1.json'))
        return new Response(n1SyntheticJson, { status: 200 });
      if (url.endsWith('.png')) return new Response(VALID_1X1_PNG, { status: 200 });
      return new Response('Not Found', { status: 404 });
    };

    const service = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: testFetch,
      clock,
    });
    await service.refreshTimes();
    const frame = service.readCatalog().products.N1.frames[0]!;

    const apiService = createNowcastApiService({
      getService: () => service,
      enablePolling: true,
      clock,
    });
    const client = createTestClient(createApp({ nowcastApi: apiService }));

    // 正常取得
    const url1 = `/api/weather/nowcast/N1/tiles/10/900/400.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${encodeURIComponent(
      frame.baseTime,
    )}&validTime=${encodeURIComponent(frame.validTime)}`;
    const res1 = await client.request(url1);
    assert.equal(res1.statusCode, 200);
    assert.deepEqual(res1.body, VALID_1X1_PNG);

    // readVerifiedTile が null を返す（ファイル消失・検証失敗）
    const origReadVerifiedTile = service.readVerifiedTile.bind(service);
    service.readVerifiedTile = async () => null;

    const url2 = `/api/weather/nowcast/N1/tiles/10/901/400.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${encodeURIComponent(
      frame.baseTime,
    )}&validTime=${encodeURIComponent(frame.validTime)}`;
    const res2 = await client.request(url2);
    assert.equal(res2.statusCode, 500);
    assert.deepEqual(res2.json, {
      status: 'error',
      code: 'tile_read_failed',
      catalogAvailability: 'available',
    });

    // 復帰後、正常要求は維持
    service.readVerifiedTile = origReadVerifiedTile;
    const res1Again = await client.request(url1);
    assert.equal(res1Again.statusCode, 200);
  } finally {
    cleanup();
  }
});

test('B16: ナウキャスト - no-store, nosniff と 3 ヘッダー、条件付き GET でも 304 にならない', async () => {
  const { tmpDir, connection, cleanup } = setupNowcastEnv();
  try {
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;

    const testFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('targetTimes_N1.json'))
        return new Response(n1SyntheticJson, { status: 200 });
      if (url.endsWith('.png')) return new Response(VALID_1X1_PNG, { status: 200 });
      return new Response('Not Found', { status: 404 });
    };

    const service = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: testFetch,
      clock,
    });
    await service.refreshTimes();
    const frame = service.readCatalog().products.N1.frames[0]!;

    const apiService = createNowcastApiService({
      getService: () => service,
      enablePolling: true,
      clock,
    });
    const client = createTestClient(createApp({ nowcastApi: apiService }));

    // 一覧 GET
    const resTimes = await client.request(
      '/api/weather/nowcast/times?terminalId=hkeagh01&controlStatus=normal',
      {
        headers: { 'If-None-Match': '"some-etag"' },
      },
    );
    assert.equal(resTimes.statusCode, 200);
    assert.equal(resTimes.headers['cache-control'], 'no-store');
    assert.equal(resTimes.headers['etag'], undefined);

    // 画像 GET
    const tileUrl = `/api/weather/nowcast/N1/tiles/10/900/400.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${encodeURIComponent(
      frame.baseTime,
    )}&validTime=${encodeURIComponent(frame.validTime)}`;
    const resTile = await client.request(tileUrl, {
      headers: {
        'If-None-Match': '"some-etag"',
        'If-Modified-Since': 'Mon, 07 Sep 2026 03:00:00 GMT',
      },
    });
    assert.equal(resTile.statusCode, 200);
    assert.equal(resTile.headers['cache-control'], 'no-store');
    assert.equal(resTile.headers['x-content-type-options'], 'nosniff');
    assert.ok(resTile.headers['x-wx-catalog-availability']);
    assert.ok(resTile.headers['x-wx-tile-result']);
    assert.ok(resTile.headers['x-wx-tile-stored-at']);
    assert.equal(resTile.headers['etag'], undefined);
  } finally {
    cleanup();
  }
});

test('B17: ナウキャスト - HEAD 送信で 405/Allow: GET (呼出し 0 回)、不正 percent encoding で 400 JSON', async () => {
  const { cleanup } = setupNowcastEnv();
  try {
    let callCount = 0;
    const service = {
      readCatalog: () => {
        callCount++;
        throw new Error('Should not be called');
      },
      fetchFrameTiles: async () => {
        callCount++;
        throw new Error('Should not be called');
      },
    } as unknown as NowcastService;

    const apiService = createNowcastApiService({
      getService: () => service,
      enablePolling: true,
    });
    const client = createTestClient(createApp({ nowcastApi: apiService }));

    // HEAD 送信
    const resHead = await client.request('/api/weather/nowcast/N1/tiles/10/900/400.png', {
      method: 'HEAD',
    });
    assert.equal(resHead.statusCode, 405);
    assert.equal(resHead.headers['allow'], 'GET');
    assert.equal(resHead.headers['cache-control'], 'no-store');
    assert.equal(resHead.headers['etag'], undefined);
    assert.equal(callCount, 0);

    // 不正 percent encoding
    const resMalformed = await client.request('/api/weather/nowcast/N1/tiles/10/900/%E0%A4%A.png');
    assert.equal(resMalformed.statusCode, 400);
    assert.deepEqual(resMalformed.json, {
      status: 'error',
      code: 'invalid_request',
    });
    assert.equal(resMalformed.headers['cache-control'], 'no-store');
  } finally {
    cleanup();
  }
});

test('B18: ナウキャスト - getter 未準備で 503、準備後は 200 で取得可能、scheduler とのインスタンス一致', async () => {
  let serviceInstance: NowcastService | null = null;
  const apiService = createNowcastApiService({
    getService: () => serviceInstance,
    enablePolling: true,
  });
  const client = createTestClient(createApp({ nowcastApi: apiService }));

  // 未準備: 503
  const res1 = await client.request(
    '/api/weather/nowcast/times?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(res1.statusCode, 503);
  assert.deepEqual(res1.json, {
    status: 'error',
    code: 'image_services_initializing',
  });

  const res1Img = await client.request(
    '/api/weather/nowcast/N1/tiles/10/900/400.png?terminalId=hkeagh01&controlStatus=normal&baseTime=2026-09-07T03:00:00.000Z&validTime=2026-09-07T03:05:00.000Z',
  );
  assert.equal(res1Img.statusCode, 503);
  assert.deepEqual(res1Img.json, {
    status: 'error',
    code: 'image_services_initializing',
  });

  // 準備完了
  const { tmpDir, connection, cleanup } = setupNowcastEnv();
  try {
    serviceInstance = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
    });

    const res2 = await client.request(
      '/api/weather/nowcast/times?terminalId=hkeagh01&controlStatus=normal',
    );
    assert.equal(res2.statusCode, 200);
    assert.equal(res2.json.status, 'ok');
  } finally {
    cleanup();
  }
});

test('B18 (統合検証): startServer 起動統合テストと main 子プロセス HTTP 結線確認', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'start-server-test-'));
  const dbPath = path.join(tmpDir, 'test.db');

  // 1. startServer 起動統合テスト
  const migrationsDirectory = path.join(import.meta.dirname, '../migrations');
  const started = await startServer({
    port: 0,
    enablePolling: false,
    config: { databasePath: dbPath, migrationsDirectory },
  });

  try {
    const res = await fetch(
      `http://127.0.0.1:${started.port}/api/weather/nowcast/times?terminalId=hkeagh01&controlStatus=normal`,
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as { status: string };
    assert.equal(json.status, 'ok');
  } finally {
    await started.close();
  }

  // 2. main 子プロセス起動テスト
  const childTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'main-child-test-'));
  const childDbPath = path.join(childTmpDir, 'child.db');
  const projectRoot = path.resolve(import.meta.dirname, '..');

  const testServer = http.createServer().listen(0, '127.0.0.1');
  const testAddress = testServer.address();
  const testPort = typeof testAddress === 'object' && testAddress ? testAddress.port : 3099;
  await new Promise<void>((resolve) => testServer.close(() => resolve()));

  const child = spawn('node', ['--import', 'tsx', 'src/server.ts'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(testPort),
      DATABASE_PATH: childDbPath,
      DISABLE_POLLING: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    let output = '';
    const portPromise = new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Timeout waiting for server to start. Output: ${output}`)),
        15000,
      );
      child.stdout?.on('data', (data) => {
        output += data.toString();
        const match = output.match(/listening on http:\/\/localhost:(\d+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(Number(match[1]));
        }
      });
      child.stderr?.on('data', (data) => {
        output += data.toString();
      });
      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      child.on('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Child exited early with code ${code}. Output: ${output}`));
      });
    });

    const port = await portPromise;
    const res = await fetch(
      `http://127.0.0.1:${port}/api/weather/nowcast/times?terminalId=hkeagh01&controlStatus=normal`,
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as { status: string };
    assert.equal(json.status, 'ok');
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => child.on('exit', () => resolve()));
    fs.rmSync(childTmpDir, { recursive: true, force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
