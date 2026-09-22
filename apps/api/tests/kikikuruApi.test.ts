import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Server } from 'node:http';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import { openDatabase, runMigrations } from '../src/database/index.js';
import { createApp } from '../src/app.js';
import { KikikuruService } from '../src/polling/kikikuruService.js';
import {
  createKikikuruApiService as createKikikuruApiServiceImpl,
  type KikikuruApiServiceDependencies,
} from '../src/services/kikikuruApiService.js';
import { createStaticTileDeliveryProfileService } from '../src/services/tileDeliveryProfileService.js';
import { findRiskSnapshot, saveRiskSnapshot } from '../src/repositories/riskRepository.js';
import type { KikikuruLayer } from '../src/polling/kikikuruTypes.js';

const VALID_1X1_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const VALID_1X1_PNG = Buffer.from(VALID_1X1_PNG_BASE64, 'base64');
const proxyProfileService = createStaticTileDeliveryProfileService('proxy');

function createKikikuruApiService(
  dependencies: Omit<KikikuruApiServiceDependencies, 'tileDeliveryProfileService'>,
) {
  return createKikikuruApiServiceImpl({
    ...dependencies,
    tileDeliveryProfileService: proxyProfileService,
  });
}

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures/jma/kikikuru');
const syntheticJson = fs.readFileSync(
  path.join(FIXTURES_DIR, 'kikikuru_target_times_synthetic.json'),
  'utf-8',
);
const emptyJson = fs.readFileSync(
  path.join(FIXTURES_DIR, 'kikikuru_target_times_empty.json'),
  'utf-8',
);
const rainMeshOriginalMinimalJson = fs.readFileSync(
  path.join(FIXTURES_DIR, 'kikikuru_target_times_rain_mesh_original_minimal.json'),
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

function setupKikikuruEnv() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kikikuru-api-test-'));
  const connection = openDatabase(':memory:');
  const migrationsDir = path.join(import.meta.dirname, '../migrations');
  runMigrations(connection, migrationsDir);

  const cleanup = () => {
    connection.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };

  return { tmpDir, connection, cleanup };
}

test('B01: キキクル - 3 層に異なる自然キーと同 validTime の別 member/baseTime を保存し、全件を層別に返し、時間窓で削除せず、各時刻が保存値と一致', async () => {
  const { tmpDir, connection, cleanup } = setupKikikuruEnv();
  try {
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;

    // 手動で 3 層に異なる自然キー（同 validTime の別 member/baseTime を含む）を保存
    const validTime = '2026-09-07T03:30:00.000Z' as UtcIso8601String;

    // heavyrain
    saveRiskSnapshot(connection, {
      layer: 'heavyrain',
      metadata: {
        source: 'https://example.com/times',
        issuedAt: '2026-09-07T03:00:00.000Z',
        validAt: null,
        validFrom: '2026-09-07T03:00:00.000Z',
        validTo: '2026-09-07T05:00:00.000Z',
        fetchedAt: '2026-09-07T03:00:00.000Z',
        lastSuccessAt: '2026-09-07T03:00:00.000Z',
        availability: 'available',
        sourceVersion: 'ver1',
      },
      frames: [
        {
          baseTime: '2026-09-07T03:00:00.000Z',
          validTime,
          imageId: 'rain_mesh',
          member: 'none',
          sequence: 0,
        },
        {
          baseTime: '2026-09-07T02:50:00.000Z', // 別 baseTime
          validTime,
          imageId: 'rain_mesh',
          member: 'member_alt', // 別 member
          sequence: 1,
        },
      ],
    });

    // inund
    saveRiskSnapshot(connection, {
      layer: 'inund',
      metadata: {
        source: 'https://example.com/times',
        issuedAt: '2026-09-07T03:00:00.000Z',
        validAt: null,
        validFrom: '2026-09-07T03:00:00.000Z',
        validTo: '2026-09-07T05:00:00.000Z',
        fetchedAt: '2026-09-07T03:00:00.000Z',
        lastSuccessAt: '2026-09-07T03:00:00.000Z',
        availability: 'available',
        sourceVersion: 'ver2',
      },
      frames: [
        {
          baseTime: '2026-09-07T03:00:00.000Z',
          validTime,
          imageId: 'inund',
          member: 'none',
          sequence: 0,
        },
      ],
    });

    // land
    saveRiskSnapshot(connection, {
      layer: 'land',
      metadata: {
        source: 'https://example.com/times',
        issuedAt: '2026-09-07T03:00:00.000Z',
        validAt: null,
        validFrom: '2026-09-07T03:00:00.000Z',
        validTo: '2026-09-07T05:00:00.000Z',
        fetchedAt: '2026-09-07T03:00:00.000Z',
        lastSuccessAt: '2026-09-07T03:00:00.000Z',
        availability: 'available',
        sourceVersion: 'ver3',
      },
      frames: [
        {
          baseTime: '2026-09-07T03:00:00.000Z',
          validTime,
          imageId: 'land',
          member: 'none',
          sequence: 0,
        },
      ],
    });

    const service = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      clock,
    });

    const apiService = createKikikuruApiService({
      getService: () => service,
      enablePolling: true,
      clock,
    });
    const client = createTestClient(createApp({ kikikuruApi: apiService }));

    const res = await client.request(
      '/api/weather/kikikuru/times?terminalId=hkeagh01&controlStatus=normal',
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.status, 'ok');

    // heavyrain: 2 件保持され、削られない
    assert.equal(res.json.layers.heavyrain.data.frames.length, 2);
    assert.equal(res.json.layers.heavyrain.data.frames[0].validTime, validTime);
    assert.equal(res.json.layers.heavyrain.data.frames[1].validTime, validTime);
    assert.equal(res.json.layers.heavyrain.data.frames[1].member, 'member_alt');
    assert.equal(res.json.layers.heavyrain.metadata.issuedAt, '2026-09-07T03:00:00.000Z');

    // inund: 1 件
    assert.equal(res.json.layers.inund.data.frames.length, 1);
    assert.equal(res.json.layers.inund.data.frames[0].imageId, 'inund');

    // land: 1 件
    assert.equal(res.json.layers.land.data.frames.length, 1);
    assert.equal(res.json.layers.land.data.frames[0].imageId, 'land');
  } finally {
    cleanup();
  }
});

test('B02: キキクル - snapshot なし・初回失敗・正常空を作り、data=null と data={frames:[]}、試行時刻の保持、lastSuccessAt=null の区別を完全一致で検証', async () => {
  const { tmpDir, connection, cleanup } = setupKikikuruEnv();
  try {
    let currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;

    // 1. snapshot なし
    const service1 = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      clock,
    });
    const apiService1 = createKikikuruApiService({
      getService: () => service1,
      enablePolling: true,
      clock,
    });
    const client1 = createTestClient(createApp({ kikikuruApi: apiService1 }));

    const res1 = await client1.request(
      '/api/weather/kikikuru/times?terminalId=hkeagh01&controlStatus=normal',
    );
    assert.equal(res1.statusCode, 200);
    assert.deepEqual(res1.json.layers.heavyrain, {
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
    const service2 = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: failFetch,
      clock,
    });
    await service2.refreshTimes();

    const apiService2 = createKikikuruApiService({
      getService: () => service2,
      enablePolling: true,
      clock,
    });
    const client2 = createTestClient(createApp({ kikikuruApi: apiService2 }));

    const res2 = await client2.request(
      '/api/weather/kikikuru/times?terminalId=hkeagh01&controlStatus=normal',
    );
    assert.equal(res2.statusCode, 200);
    assert.deepEqual(res2.json.layers.heavyrain, {
      metadata: {
        source: 'https://www.jma.go.jp/bosai/jmatile/data/risk/targetTimes.json',
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
    currentTime = '2026-09-07T03:05:00.000Z';
    const emptyFetch: typeof fetch = async () => new Response(emptyJson, { status: 200 });
    const service3 = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: emptyFetch,
      clock,
    });
    await service3.refreshTimes();

    const apiService3 = createKikikuruApiService({
      getService: () => service3,
      enablePolling: true,
      clock,
    });
    const client3 = createTestClient(createApp({ kikikuruApi: apiService3 }));

    const res3 = await client3.request(
      '/api/weather/kikikuru/times?terminalId=hkeagh01&controlStatus=normal',
    );
    assert.equal(res3.statusCode, 200);
    assert.equal(res3.json.layers.heavyrain.metadata.availability, 'available');
    assert.equal(res3.json.layers.heavyrain.metadata.lastSuccessAt, '2026-09-07T03:05:00.000Z');
    assert.deepEqual(res3.json.layers.heavyrain.data, { frames: [] });
  } finally {
    cleanup();
  }
});

test('B03: キキクル - layer/imageId 不一致、危険な member、flood で 400、保存していない正常 member は 404、上流追加なし', async () => {
  const { tmpDir, connection, cleanup } = setupKikikuruEnv();
  try {
    let upstreamCalled = false;
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;

    const testFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('targetTimes.json')) return new Response(syntheticJson, { status: 200 });
      upstreamCalled = true;
      return new Response('ok');
    };

    const service = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: testFetch,
      clock,
    });
    await service.refreshTimes();
    const frame = service.readCatalog().layers.heavyrain.frames[0]!;

    const apiService = createKikikuruApiService({
      getService: () => service,
      enablePolling: true,
      clock,
    });
    const client = createTestClient(createApp({ kikikuruApi: apiService }));

    const baseValid = `/api/weather/kikikuru/heavyrain/tiles/10/800/300.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${encodeURIComponent(
      frame.baseTime,
    )}&validTime=${encodeURIComponent(frame.validTime)}&imageId=rain_mesh&member=none`;

    // 1. layer/imageId 不一致: 400
    const resMismatch = await client.request(
      baseValid.replace('imageId=rain_mesh', 'imageId=inund'),
    );
    assert.equal(resMismatch.statusCode, 400);

    // 2. 危険な member: 400
    const resTraversal = await client.request(baseValid.replace('member=none', 'member=../escape'));
    assert.equal(resTraversal.statusCode, 400);

    // 3. flood (非対応): 400
    const resFlood = await client.request(baseValid.replace('/heavyrain/', '/flood/'));
    assert.equal(resFlood.statusCode, 400);

    // 4. 保存していない正常形式の member: 404 (上流追加なし)
    upstreamCalled = false;
    const resUnsavedMember = await client.request(
      baseValid.replace('member=none', 'member=unsaved_member'),
    );
    assert.equal(resUnsavedMember.statusCode, 404);
    assert.equal(resUnsavedMember.json.code, 'frame_not_available');
    assert.equal(upstreamCalled, false);
  } finally {
    cleanup();
  }
});

test('B04: キキクル - 一覧 GET 繰り返しで fetch 0 回、DB 不変、refreshTimes 後に反映', async () => {
  const { tmpDir, connection, cleanup } = setupKikikuruEnv();
  try {
    let fetchCount = 0;
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;

    const testFetch: typeof fetch = async (input) => {
      fetchCount++;
      const url = String(input);
      if (url.includes('targetTimes.json')) return new Response(syntheticJson, { status: 200 });
      return new Response('ok');
    };

    const service = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: testFetch,
      clock,
    });

    const apiService = createKikikuruApiService({
      getService: () => service,
      enablePolling: true,
      clock,
    });
    const client = createTestClient(createApp({ kikikuruApi: apiService }));

    // 初回 GET (未 refreshTimes)
    const res1 = await client.request(
      '/api/weather/kikikuru/times?terminalId=hkeagh01&controlStatus=normal',
    );
    assert.equal(res1.statusCode, 200);
    assert.equal(res1.json.layers.heavyrain.data, null);
    assert.equal(fetchCount, 0);

    // 繰り返し GET
    for (let i = 0; i < 3; i++) {
      const res = await client.request(
        '/api/weather/kikikuru/times?terminalId=hkeagh01&controlStatus=normal',
      );
      assert.equal(res.statusCode, 200);
      assert.equal(fetchCount, 0);
    }

    // refreshTimes 実行
    await service.refreshTimes();
    assert.equal(fetchCount, 1);

    const snapBefore = findRiskSnapshot(connection, 'heavyrain')!;

    // 次の GET に反映される
    const res2 = await client.request(
      '/api/weather/kikikuru/times?terminalId=hkeagh01&controlStatus=normal',
    );
    assert.equal(res2.statusCode, 200);
    assert.notEqual(res2.json.layers.heavyrain.data, null);
    assert.equal(fetchCount, 1);

    const snapAfter = findRiskSnapshot(connection, 'heavyrain')!;
    assert.equal(snapAfter.metadata.fetchedAt, snapBefore.metadata.fetchedAt);
    assert.equal(snapAfter.metadata.lastSuccessAt, snapBefore.metadata.lastSuccessAt);
  } finally {
    cleanup();
  }
});

test('B05: キキクル - rain_mesh 一覧更新から時刻 API・最新フレーム・タイル URL までを一貫して正規化する', async () => {
  const { tmpDir, connection, cleanup } = setupKikikuruEnv();
  try {
    const currentTime = '2026-09-22T02:40:00.000Z' as UtcIso8601String;
    const requestedUrls: string[] = [];
    const testFetch: typeof fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes('targetTimes.json')) {
        return new Response(rainMeshOriginalMinimalJson, { status: 200 });
      }
      return new Response(VALID_1X1_PNG, { status: 200 });
    };
    const service = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: testFetch,
      clock: () => currentTime,
    });
    await service.refreshTimes();
    assert.deepStrictEqual(requestedUrls, [
      'https://www.jma.go.jp/bosai/jmatile/data/risk/targetTimes.json',
    ]);

    const apiService = createKikikuruApiService({
      getService: () => service,
      enablePolling: true,
      clock: () => currentTime,
    });
    const client = createTestClient(createApp({ kikikuruApi: apiService }));
    const timesResponse = await client.request(
      '/api/weather/kikikuru/times?terminalId=hkeagh01&controlStatus=normal',
    );

    assert.equal(timesResponse.statusCode, 200);
    assert.equal(timesResponse.json.status, 'ok');
    for (const layer of ['heavyrain', 'inund', 'land'] as const) {
      assert.equal(timesResponse.json.layers[layer].data.frames.length, 1);
    }
    const latestHeavyrainFrame = timesResponse.json.layers.heavyrain.data.frames.reduce(
      (latest: { validTime: string }, frame: { validTime: string }) =>
        frame.validTime > latest.validTime ? frame : latest,
    );
    assert.deepEqual(latestHeavyrainFrame, {
      layer: 'heavyrain',
      baseTime: '2026-09-22T02:30:00.000Z',
      validTime: '2026-09-22T02:30:00.000Z',
      imageId: 'rain_mesh',
      member: 'immed0',
    });

    requestedUrls.length = 0;
    const tileResponse = await client.request(
      `/api/weather/kikikuru/heavyrain/tiles/10/909/404.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${encodeURIComponent(
        latestHeavyrainFrame.baseTime,
      )}&validTime=${encodeURIComponent(latestHeavyrainFrame.validTime)}&imageId=${latestHeavyrainFrame.imageId}&member=${encodeURIComponent(latestHeavyrainFrame.member)}`,
    );
    assert.equal(tileResponse.statusCode, 200);
    assert.deepEqual(requestedUrls, [
      'https://www.jma.go.jp/bosai/jmatile/data/risk/20260922023000/immed0/20260922023000/surf/rain_mesh/10/909/404.png',
    ]);
  } finally {
    cleanup();
  }
});

test('B07: キキクル - 台帳端末 2 件で会場別 context・共通索引、training/test は 200 unsupported_control_status、画像は 422、呼出し 0 回', async () => {
  const { cleanup } = setupKikikuruEnv();
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
          catalogAccess: { allowed: true, period: {} as never, nextAllowedAt: null },
          imageAccess: { allowed: true, period: {} as never, nextAllowedAt: null },
          layers: {
            heavyrain: { snapshot: null, availability: 'available' as const, frames: [] },
            inund: { snapshot: null, availability: 'available' as const, frames: [] },
            land: { snapshot: null, availability: 'available' as const, frames: [] },
          },
        };
      },
      fetchFrameTiles: async () => {
        fetchTilesCount++;
        return [];
      },
    } as unknown as KikikuruService;

    const apiService = createKikikuruApiService({
      getService: () => dummyService,
      enablePolling: true,
      clock,
    });
    const client = createTestClient(createApp({ kikikuruApi: apiService }));

    // 別会場端末 2 件
    const resEast = await client.request(
      '/api/weather/kikikuru/times?terminalId=hkeagh01&controlStatus=normal',
    );
    const resTrc = await client.request(
      '/api/weather/kikikuru/times?terminalId=htrcph01&controlStatus=normal',
    );
    assert.equal(resEast.statusCode, 200);
    assert.equal(resTrc.statusCode, 200);
    assert.equal(resEast.json.venueId, 'east');
    assert.equal(resTrc.json.venueId, 'trc');
    assert.deepEqual(resEast.json.layers, resTrc.json.layers);

    // training / test
    readCatalogCount = 0;
    fetchTilesCount = 0;

    const resTraining = await client.request(
      '/api/weather/kikikuru/times?terminalId=hkeagh01&controlStatus=training',
    );
    assert.equal(resTraining.statusCode, 200);
    assert.equal(resTraining.json.status, 'unsupported_control_status');
    assert.equal(resTraining.json.isTraining, true);
    assert.equal(resTraining.json.catalogAccess, null);
    assert.equal(resTraining.json.imageAccess, null);
    assert.deepEqual(resTraining.json.allowedZooms, []);
    assert.equal(resTraining.json.layers.heavyrain.metadata.availability, 'unavailable');
    assert.equal(resTraining.json.layers.heavyrain.data, null);
    assert.equal(readCatalogCount, 0);

    const resTest = await client.request(
      '/api/weather/kikikuru/times?terminalId=hkeagh01&controlStatus=test',
    );
    assert.equal(resTest.statusCode, 200);
    assert.equal(resTest.json.status, 'unsupported_control_status');
    assert.equal(resTest.json.isTraining, false);
    assert.equal(readCatalogCount, 0);

    // 画像 training/test は 422
    const resTileTraining = await client.request(
      '/api/weather/kikikuru/heavyrain/tiles/10/800/300.png?terminalId=hkeagh01&controlStatus=training&baseTime=2026-09-07T03:00:00.000Z&validTime=2026-09-07T03:05:00.000Z&imageId=rain_mesh&member=none',
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

test('B08: キキクル - 形式違反・範囲外・未知端末は 400/404、上流呼出しなし', async () => {
  const { tmpDir, connection, cleanup } = setupKikikuruEnv();
  try {
    let upstreamCalled = false;
    const service = new KikikuruService(connection, {
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

    const apiService = createKikikuruApiService({
      getService: () => service,
      enablePolling: true,
    });
    const client = createTestClient(createApp({ kikikuruApi: apiService }));

    const baseValid =
      '/api/weather/kikikuru/heavyrain/tiles/10/800/300.png?terminalId=hkeagh01&controlStatus=normal&baseTime=2026-09-07T03:00:00.000Z&validTime=2026-09-07T03:05:00.000Z&imageId=rain_mesh&member=none';

    // 未知端末: 404
    const resUnknown = await client.request(baseValid.replace('hkeagh01', 'unknown99'));
    assert.equal(resUnknown.statusCode, 404);
    assert.equal(resUnknown.json.code, 'terminal_not_found');

    // 未知キー: 400
    const resExtra = await client.request(baseValid + '&extra=1');
    assert.equal(resExtra.statusCode, 400);

    // layer 不正: 400
    const resLayer = await client.request(baseValid.replace('/heavyrain/', '/invalid/'));
    assert.equal(resLayer.statusCode, 400);

    // z 範囲外: 400
    const resZ = await client.request(baseValid.replace('/10/', '/9/'));
    assert.equal(resZ.statusCode, 400);

    // x 範囲外: 400
    assert.equal((await client.request(baseValid.replace('/800/', '/1024/'))).statusCode, 400);

    // 日時不正: 400
    assert.equal(
      (await client.request(baseValid.replace('2026-09-07T03:00:00.000Z', '2026-09-07T03:00:00Z')))
        .statusCode,
      400,
    );

    assert.equal(upstreamCalled, false);
  } finally {
    cleanup();
  }
});

test('B09: キキクル - 3 層それぞれで単体 GET、PNG バイト列 fixture 完全一致、初回 downloaded、2回目 cached、storedAt 不変、上流 0 回追加', async () => {
  const { tmpDir, connection, cleanup } = setupKikikuruEnv();
  try {
    let fetchCount = 0;
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;

    const testFetch: typeof fetch = async (input) => {
      fetchCount++;
      const url = String(input);
      if (url.includes('targetTimes.json')) return new Response(syntheticJson, { status: 200 });
      if (url.endsWith('.png')) return new Response(VALID_1X1_PNG, { status: 200 });
      return new Response('Not Found', { status: 404 });
    };

    const service = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: testFetch,
      clock,
    });
    await service.refreshTimes();

    const apiService = createKikikuruApiService({
      getService: () => service,
      enablePolling: true,
      clock,
    });
    const client = createTestClient(createApp({ kikikuruApi: apiService }));

    const catalog = service.readCatalog();
    const testCases: { layer: KikikuruLayer; imageId: string }[] = [
      { layer: 'heavyrain', imageId: 'rain_mesh' },
      { layer: 'inund', imageId: 'inund' },
      { layer: 'land', imageId: 'land' },
    ];

    for (const { layer, imageId } of testCases) {
      const frame = catalog.layers[layer].frames[0]!;
      const tileUrl = `/api/weather/kikikuru/${layer}/tiles/10/800/300.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${encodeURIComponent(
        frame.baseTime,
      )}&validTime=${encodeURIComponent(frame.validTime)}&imageId=${imageId}&member=${encodeURIComponent(
        frame.member,
      )}`;

      const initialCount = fetchCount;

      // 1 回目: downloaded
      const res1 = await client.request(tileUrl);
      assert.equal(res1.statusCode, 200);
      assert.equal(res1.headers['x-wx-tile-result'], 'downloaded');
      assert.deepEqual(res1.body, VALID_1X1_PNG);
      assert.equal(fetchCount, initialCount + 1);
      const storedAt = res1.headers['x-wx-tile-stored-at'];
      assert.ok(storedAt);

      // 2 回目: cached
      const res2 = await client.request(tileUrl);
      assert.equal(res2.statusCode, 200);
      assert.equal(res2.headers['x-wx-tile-result'], 'cached');
      assert.deepEqual(res2.body, VALID_1X1_PNG);
      assert.equal(res2.headers['x-wx-tile-stored-at'], storedAt);
      assert.equal(fetchCount, initialCount + 1); // 上流追加なし
    }
  } finally {
    cleanup();
  }
});

test('B10: キキクル - 3 層の独立性（成功・初回失敗・成功後失敗・閾値直前/ちょうど）、catalogAccess と imageAccess の独立性', async () => {
  const { tmpDir, connection, cleanup } = setupKikikuruEnv();
  try {
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;

    // heavyrain: 成功 (available)
    saveRiskSnapshot(connection, {
      layer: 'heavyrain',
      metadata: {
        source: 'https://example.com/times',
        issuedAt: currentTime,
        validAt: null,
        validFrom: currentTime,
        validTo: currentTime,
        fetchedAt: currentTime,
        lastSuccessAt: currentTime,
        availability: 'available',
        sourceVersion: 'v1',
      },
      frames: [],
    });

    // inund: 初回失敗 (unavailable)
    saveRiskSnapshot(connection, {
      layer: 'inund',
      metadata: {
        source: 'https://example.com/times',
        issuedAt: currentTime,
        validAt: null,
        validFrom: null,
        validTo: null,
        fetchedAt: currentTime,
        lastSuccessAt: null,
        availability: 'unavailable',
        sourceVersion: null,
      },
      frames: [],
    });

    // land: 成功後失敗 (stale)
    saveRiskSnapshot(connection, {
      layer: 'land',
      metadata: {
        source: 'https://example.com/times',
        issuedAt: currentTime,
        validAt: null,
        validFrom: currentTime,
        validTo: currentTime,
        fetchedAt: currentTime,
        lastSuccessAt: '2026-09-07T02:50:00.000Z',
        availability: 'stale',
        sourceVersion: 'v2',
      },
      frames: [],
    });

    // 索引許可=false / 画像許可=true の独立性注入
    let catalogAllowed = false;
    let imageAllowed = true;

    const service = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({
        allowed: catalogAllowed,
        period: {} as never,
        nextAllowedAt: null,
      }),
      getImageAccess: () => ({ allowed: imageAllowed, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      clock,
    });

    const apiService = createKikikuruApiService({
      getService: () => service,
      enablePolling: true,
      clock,
    });
    const client = createTestClient(createApp({ kikikuruApi: apiService }));

    const res1 = await client.request(
      '/api/weather/kikikuru/times?terminalId=hkeagh01&controlStatus=normal',
    );
    assert.equal(res1.statusCode, 200);
    assert.equal(res1.json.layers.heavyrain.metadata.availability, 'available');
    assert.equal(res1.json.layers.inund.metadata.availability, 'unavailable');
    assert.equal(res1.json.layers.land.metadata.availability, 'stale');
    assert.equal(res1.json.catalogAccess.allowed, false);
    assert.equal(res1.json.imageAccess.allowed, true);

    // 逆の状態（索引許可=true / 画像許可=false）
    catalogAllowed = true;
    imageAllowed = false;
    const res2 = await client.request(
      '/api/weather/kikikuru/times?terminalId=hkeagh01&controlStatus=normal',
    );
    assert.equal(res2.json.catalogAccess.allowed, true);
    assert.equal(res2.json.imageAccess.allowed, false);
  } finally {
    cleanup();
  }
});

test('B11: キキクル - stale かつ画像許可でミス 200、停止時キャッシュ 200、停止時ミス 503 (disabled/scheduled_stopped)', async () => {
  const { tmpDir, connection, cleanup } = setupKikikuruEnv();
  try {
    let currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;
    let allowImage = true;

    const testFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('targetTimes.json')) return new Response(syntheticJson, { status: 200 });
      if (url.endsWith('.png')) return new Response(VALID_1X1_PNG, { status: 200 });
      return new Response('Not Found', { status: 404 });
    };

    const service = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: allowImage, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: testFetch,
      clock,
    });
    await service.refreshTimes();
    const frame = service.readCatalog().layers.heavyrain.frames[0]!;

    // 1. stale かつ画像許可でミス要求 -> 200
    currentTime = '2026-09-07T03:06:00.000Z';
    const apiService = createKikikuruApiService({
      getService: () => service,
      enablePolling: true,
      clock,
    });
    const client = createTestClient(createApp({ kikikuruApi: apiService }));

    const tileUrl1 = `/api/weather/kikikuru/heavyrain/tiles/10/800/300.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${encodeURIComponent(
      frame.baseTime,
    )}&validTime=${encodeURIComponent(frame.validTime)}&imageId=rain_mesh&member=${encodeURIComponent(
      frame.member,
    )}`;

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
    const tileUrl2 = `/api/weather/kikikuru/heavyrain/tiles/10/801/300.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${encodeURIComponent(
      frame.baseTime,
    )}&validTime=${encodeURIComponent(frame.validTime)}&imageId=rain_mesh&member=${encodeURIComponent(
      frame.member,
    )}`;
    const res3 = await client.request(tileUrl2);
    assert.equal(res3.statusCode, 503);
    assert.equal(res3.json.code, 'acquisition_stopped');
    assert.equal(res3.json.catalogAvailability, 'stale');
    assert.equal(res3.json.imageAccess.reason, 'scheduled_stopped');

    // 4. enablePolling=false -> reason=disabled
    const apiServiceDisabled = createKikikuruApiService({
      getService: () => service,
      enablePolling: false,
      clock,
    });
    const clientDisabled = createTestClient(createApp({ kikikuruApi: apiServiceDisabled }));
    const res4 = await clientDisabled.request(tileUrl2);
    assert.equal(res4.statusCode, 503);
    assert.equal(res4.json.imageAccess.reason, 'disabled');
  } finally {
    cleanup();
  }
});

test('B12: キキクル - 不在フレーム 404、上流エラー 502、保存例外 500、内部情報露出なし', async () => {
  const { tmpDir, connection, cleanup } = setupKikikuruEnv();
  try {
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;

    let httpStatus = 500;
    const testFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('targetTimes.json')) return new Response(syntheticJson, { status: 200 });
      if (url.endsWith('.png')) return new Response('Server Error', { status: httpStatus });
      return new Response('Not Found', { status: 404 });
    };

    const service = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: testFetch,
      clock,
    });
    await service.refreshTimes();

    const apiService = createKikikuruApiService({
      getService: () => service,
      enablePolling: true,
      clock,
    });
    const client = createTestClient(createApp({ kikikuruApi: apiService }));

    // 不在フレーム: 404
    const resNotFound = await client.request(
      '/api/weather/kikikuru/heavyrain/tiles/10/800/300.png?terminalId=hkeagh01&controlStatus=normal&baseTime=2026-09-07T03:00:00.000Z&validTime=2026-09-07T03:59:00.000Z&imageId=rain_mesh&member=none',
    );
    assert.equal(resNotFound.statusCode, 404);
    assert.deepEqual(resNotFound.json, {
      status: 'error',
      code: 'frame_not_available',
      catalogAvailability: 'available',
    });

    const validFrame = service.readCatalog().layers.heavyrain.frames[0]!;
    const tileUrl = `/api/weather/kikikuru/heavyrain/tiles/10/800/300.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${encodeURIComponent(
      validFrame.baseTime,
    )}&validTime=${encodeURIComponent(
      validFrame.validTime,
    )}&imageId=rain_mesh&member=${encodeURIComponent(validFrame.member)}`;

    // 上流 500 -> 502
    httpStatus = 500;
    const res502 = await client.request(tileUrl);
    assert.equal(res502.statusCode, 502);
    assert.deepEqual(res502.json, {
      status: 'error',
      code: 'tile_fetch_failed',
      catalogAvailability: 'available',
    });
  } finally {
    cleanup();
  }
});

test('B16: キキクル - no-store, nosniff と 3 ヘッダー、条件付き GET でも 304 にならない', async () => {
  const { tmpDir, connection, cleanup } = setupKikikuruEnv();
  try {
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;

    const testFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('targetTimes.json')) return new Response(syntheticJson, { status: 200 });
      if (url.endsWith('.png')) return new Response(VALID_1X1_PNG, { status: 200 });
      return new Response('Not Found', { status: 404 });
    };

    const service = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: testFetch,
      clock,
    });
    await service.refreshTimes();
    const frame = service.readCatalog().layers.heavyrain.frames[0]!;

    const apiService = createKikikuruApiService({
      getService: () => service,
      enablePolling: true,
      clock,
    });
    const client = createTestClient(createApp({ kikikuruApi: apiService }));

    // 一覧 GET
    const resTimes = await client.request(
      '/api/weather/kikikuru/times?terminalId=hkeagh01&controlStatus=normal',
      {
        headers: { 'If-None-Match': '"some-etag"' },
      },
    );
    assert.equal(resTimes.statusCode, 200);
    assert.equal(resTimes.headers['cache-control'], 'no-store');
    assert.equal(resTimes.headers['etag'], undefined);

    // 画像 GET
    const tileUrl = `/api/weather/kikikuru/heavyrain/tiles/10/800/300.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${encodeURIComponent(
      frame.baseTime,
    )}&validTime=${encodeURIComponent(frame.validTime)}&imageId=rain_mesh&member=${encodeURIComponent(
      frame.member,
    )}`;
    const resTile = await client.request(tileUrl, {
      headers: {
        'If-None-Match': '"some-etag"',
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

test('B13: キキクル - saveTile 失敗・DB 保存失敗・履歴保存失敗で 500、他要求維持、復帰後 cached 200', async () => {
  const { tmpDir, connection, cleanup } = setupKikikuruEnv();
  try {
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;

    const testFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('targetTimes.json')) return new Response(syntheticJson, { status: 200 });
      if (url.endsWith('.png')) return new Response(VALID_1X1_PNG, { status: 200 });
      return new Response('Not Found', { status: 404 });
    };

    const service = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: testFetch,
      clock,
    });
    await service.refreshTimes();
    const frame = service.readCatalog().layers.heavyrain.frames[0]!;

    const apiService = createKikikuruApiService({
      getService: () => service,
      enablePolling: true,
      clock,
    });
    const client = createTestClient(createApp({ kikikuruApi: apiService }));

    // 1 つ目の座標を正常取得
    const url1 = `/api/weather/kikikuru/heavyrain/tiles/10/800/300.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${encodeURIComponent(
      frame.baseTime,
    )}&validTime=${encodeURIComponent(frame.validTime)}&imageId=rain_mesh&member=${encodeURIComponent(
      frame.member,
    )}`;
    const res1 = await client.request(url1);
    assert.equal(res1.statusCode, 200);

    // saveTile 失敗を注入
    const origSaveTile = service.tileStore.saveTile.bind(service.tileStore);
    service.tileStore.saveTile = async () => {
      throw new Error('Disk error');
    };

    const url2 = `/api/weather/kikikuru/heavyrain/tiles/10/801/300.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${encodeURIComponent(
      frame.baseTime,
    )}&validTime=${encodeURIComponent(frame.validTime)}&imageId=rain_mesh&member=${encodeURIComponent(
      frame.member,
    )}`;
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

test('B14: キキクル - 既存キャッシュ破損時に再取得 200、停止中ミス 503、許可時間進行後の 503 と allowed=true 共存', async () => {
  const { tmpDir, connection, cleanup } = setupKikikuruEnv();
  try {
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;
    let allowImage = true;

    const testFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('targetTimes.json')) return new Response(syntheticJson, { status: 200 });
      if (url.endsWith('.png')) return new Response(VALID_1X1_PNG, { status: 200 });
      return new Response('Not Found', { status: 404 });
    };

    const service = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: allowImage, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: testFetch,
      clock,
    });
    await service.refreshTimes();
    const frame = service.readCatalog().layers.heavyrain.frames[0]!;

    const apiService = createKikikuruApiService({
      getService: () => service,
      enablePolling: true,
      clock,
    });
    const client = createTestClient(createApp({ kikikuruApi: apiService }));

    const tileUrl = `/api/weather/kikikuru/heavyrain/tiles/10/800/300.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${encodeURIComponent(
      frame.baseTime,
    )}&validTime=${encodeURIComponent(frame.validTime)}&imageId=rain_mesh&member=${encodeURIComponent(
      frame.member,
    )}`;

    // 正常取得
    const res1 = await client.request(tileUrl);
    assert.equal(res1.statusCode, 200);

    // キャッシュファイルを破損させる
    const snap = findRiskSnapshot(connection, 'heavyrain')!;
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

    // 停止結果の直後に時計を進めて許可状態に切り替えるシミュレーション
    const origFetchFrameTiles = service.fetchFrameTiles.bind(service);
    service.fetchFrameTiles = async (...args) => {
      const result = await origFetchFrameTiles(...args);
      allowImage = true;
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

test('B15: キキクル - 成功結果後のファイル消失/改変で配信直前 500、正常時 Buffer 完全一致、他要求維持', async () => {
  const { tmpDir, connection, cleanup } = setupKikikuruEnv();
  try {
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;

    const testFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('targetTimes.json')) return new Response(syntheticJson, { status: 200 });
      if (url.endsWith('.png')) return new Response(VALID_1X1_PNG, { status: 200 });
      return new Response('Not Found', { status: 404 });
    };

    const service = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      getCatalogAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      getImageAccess: () => ({ allowed: true, period: {} as never, nextAllowedAt: null }),
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: testFetch,
      clock,
    });
    await service.refreshTimes();
    const frame = service.readCatalog().layers.heavyrain.frames[0]!;

    const apiService = createKikikuruApiService({
      getService: () => service,
      enablePolling: true,
      clock,
    });
    const client = createTestClient(createApp({ kikikuruApi: apiService }));

    // 正常取得
    const url1 = `/api/weather/kikikuru/heavyrain/tiles/10/800/300.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${encodeURIComponent(
      frame.baseTime,
    )}&validTime=${encodeURIComponent(frame.validTime)}&imageId=rain_mesh&member=${encodeURIComponent(
      frame.member,
    )}`;
    const res1 = await client.request(url1);
    assert.equal(res1.statusCode, 200);
    assert.deepEqual(res1.body, VALID_1X1_PNG);

    // readVerifiedTile が null を返す（ファイル消失・検証失敗）
    const origReadVerifiedTile = service.readVerifiedTile.bind(service);
    service.readVerifiedTile = async () => null;

    const url2 = `/api/weather/kikikuru/heavyrain/tiles/10/801/300.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${encodeURIComponent(
      frame.baseTime,
    )}&validTime=${encodeURIComponent(frame.validTime)}&imageId=rain_mesh&member=${encodeURIComponent(
      frame.member,
    )}`;
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

test('B17: キキクル - HEAD 送信で 405/Allow: GET (呼出し 0 回)、不正 percent encoding で 400 JSON', async () => {
  const { cleanup } = setupKikikuruEnv();
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
    } as unknown as KikikuruService;

    const apiService = createKikikuruApiService({
      getService: () => service,
      enablePolling: true,
    });
    const client = createTestClient(createApp({ kikikuruApi: apiService }));

    // HEAD 送信
    const resHead = await client.request('/api/weather/kikikuru/heavyrain/tiles/10/800/300.png', {
      method: 'HEAD',
    });
    assert.equal(resHead.statusCode, 405);
    assert.equal(resHead.headers['allow'], 'GET');
    assert.equal(resHead.headers['cache-control'], 'no-store');
    assert.equal(resHead.headers['etag'], undefined);
    assert.equal(callCount, 0);

    // 不正 percent encoding
    const resMalformed = await client.request(
      '/api/weather/kikikuru/heavyrain/tiles/10/800/%E0%A4%A.png',
    );
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
