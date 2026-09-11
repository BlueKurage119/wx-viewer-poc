import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import { openDatabase, runMigrations } from '../src/database/index.js';
import { KikikuruService } from '../src/polling/kikikuruService.js';
import type { KikikuruFrameKey, TileCoordinate } from '../src/polling/kikikuruTypes.js';
import { listFetchAttempts } from '../src/repositories/fetchAttemptRepository.js';
import { findRiskSnapshot } from '../src/repositories/riskRepository.js';

const VALID_1X1_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const VALID_1X1_PNG = Buffer.from(VALID_1X1_PNG_BASE64, 'base64');
const EXPECTED_HASH = '6b7fa434f92a8b80aab02d9bf1a12e49ffcae424e4013a1c4f68b67e3d2bbcd0';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures/jma/kikikuru');
const syntheticJson = fs.readFileSync(
  path.join(FIXTURES_DIR, 'kikikuru_target_times_synthetic.json'),
  'utf-8',
);
const emptyJson = fs.readFileSync(
  path.join(FIXTURES_DIR, 'kikikuru_target_times_empty.json'),
  'utf-8',
);

function setupTestEnv() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kikikuru-service-test-'));
  const connection = openDatabase(':memory:');
  const migrationsDir = path.join(import.meta.dirname, '../migrations');
  runMigrations(connection, migrationsDir);

  const cleanup = () => {
    connection.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };

  return { tmpDir, connection, cleanup };
}

test('1. 初回失敗は unavailable、成功後の一覧失敗は旧フレーム・最終成功時刻・版を保持した stale、閾値境界の再読出しも stale となる。正常空一覧は available', async () => {
  const { tmpDir, connection, cleanup } = setupTestEnv();
  try {
    let currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;

    // Case 1-1: 初回失敗 (HTTP 500)
    const failFetch: typeof fetch = async () =>
      new Response('Internal Server Error', { status: 500 });
    let service = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      staleAfterMs: { heavyrain: 300_000, inund: 300_000, land: 300_000 },
      fetchFn: failFetch,
      clock,
    });

    let catalog = await service.refreshTimes();
    assert.strictEqual(catalog.layers.heavyrain.availability, 'unavailable');
    assert.strictEqual(catalog.layers.inund.availability, 'unavailable');
    assert.strictEqual(catalog.layers.land.availability, 'unavailable');
    assert.strictEqual(catalog.layers.heavyrain.frames.length, 0);

    // 通信履歴が記録されていること
    const attempts = listFetchAttempts(connection, { sourceKind: 'risk_target_times' });
    assert.strictEqual(attempts.length, 1);
    assert.strictEqual(attempts[0]?.outcome, 'failure');
    assert.strictEqual(attempts[0]?.httpStatus, 500);

    // Case 1-2: 成功取得
    const successFetch: typeof fetch = async () => new Response(syntheticJson, { status: 200 });
    service = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      staleAfterMs: { heavyrain: 300_000, inund: 300_000, land: 300_000 },
      fetchFn: successFetch,
      clock,
    });

    catalog = await service.refreshTimes();
    assert.strictEqual(catalog.layers.heavyrain.availability, 'available');
    assert.strictEqual(catalog.layers.inund.availability, 'available');
    assert.strictEqual(catalog.layers.land.availability, 'available');
    assert.strictEqual(catalog.layers.heavyrain.frames.length, 2);
    assert.strictEqual(catalog.layers.inund.frames.length, 2);
    assert.strictEqual(catalog.layers.land.frames.length, 3);

    const prevHeavy = findRiskSnapshot(connection, 'heavyrain')!;
    const prevSuccessAt = prevHeavy.metadata.lastSuccessAt;
    const prevVersion = prevHeavy.metadata.sourceVersion;
    const prevFrames = prevHeavy.frames;

    // Case 1-3: 1回成功後に失敗させると、旧フレーム・最終成功・版が保持され stale
    currentTime = '2026-09-07T03:02:00.000Z' as UtcIso8601String;
    service = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      staleAfterMs: { heavyrain: 300_000, inund: 300_000, land: 300_000 },
      fetchFn: failFetch,
      clock,
    });

    catalog = await service.refreshTimes();
    assert.strictEqual(catalog.layers.heavyrain.availability, 'stale');
    assert.strictEqual(catalog.layers.inund.availability, 'stale');
    assert.strictEqual(catalog.layers.land.availability, 'stale');

    const staleHeavy = findRiskSnapshot(connection, 'heavyrain')!;
    assert.strictEqual(staleHeavy.metadata.availability, 'stale');
    assert.strictEqual(staleHeavy.metadata.lastSuccessAt, prevSuccessAt);
    assert.strictEqual(staleHeavy.metadata.sourceVersion, prevVersion);
    assert.strictEqual(staleHeavy.metadata.fetchedAt, '2026-09-07T03:02:00.000Z');
    assert.deepStrictEqual(
      staleHeavy.frames.map((f) => ({ baseTime: f.baseTime, validTime: f.validTime })),
      prevFrames.map((f) => ({ baseTime: f.baseTime, validTime: f.validTime })),
    );

    // Case 1-4: 閾値境界の再読出し（サービス再生成）
    const staleAfterMs = 300_000;
    // 成功時刻 03:00:00 から 299,999ms 後 -> 03:04:59.999 (available だった場合)
    // まず成功で復帰させる
    currentTime = '2026-09-07T03:03:00.000Z' as UtcIso8601String;
    service = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      staleAfterMs: { heavyrain: staleAfterMs, inund: staleAfterMs, land: staleAfterMs },
      fetchFn: successFetch,
      clock,
    });
    await service.refreshTimes();

    const service2 = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      staleAfterMs: { heavyrain: staleAfterMs, inund: staleAfterMs, land: staleAfterMs },
      fetchFn: successFetch,
      clock,
    });
    let readCat = service2.readCatalog();
    assert.strictEqual(readCat.layers.heavyrain.availability, 'available');

    // 閾値直前: 4分59秒999ms後 (03:03:00 + 300,000 - 1 ms)
    currentTime = new Date(
      new Date('2026-09-07T03:03:00.000Z').getTime() + staleAfterMs - 1,
    ).toISOString() as UtcIso8601String;
    readCat = service2.readCatalog();
    assert.strictEqual(readCat.layers.heavyrain.availability, 'available');

    // 閾値ちょうど: 5分00秒後 (03:03:00 + 300,000 ms)
    currentTime = new Date(
      new Date('2026-09-07T03:03:00.000Z').getTime() + staleAfterMs,
    ).toISOString() as UtcIso8601String;
    readCat = service2.readCatalog();
    assert.strictEqual(readCat.layers.heavyrain.availability, 'stale');

    // Case 1-5: 正常空一覧は available、issuedAt=fetchedAt
    const emptyFetch: typeof fetch = async () => new Response(emptyJson, { status: 200 });
    service = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      staleAfterMs: { heavyrain: staleAfterMs, inund: staleAfterMs, land: staleAfterMs },
      fetchFn: emptyFetch,
      clock,
    });
    catalog = await service.refreshTimes();
    assert.strictEqual(catalog.layers.heavyrain.availability, 'available');
    assert.strictEqual(catalog.layers.heavyrain.frames.length, 0);
    const emptySnap = findRiskSnapshot(connection, 'heavyrain')!;
    assert.strictEqual(emptySnap.metadata.issuedAt, currentTime);
  } finally {
    cleanup();
  }
});

test('2. 一覧に存在しないフレーム、別レイヤーへ差し替えたキー、未許可ズーム・不正 XYZ を要求しても外部 fetch が0回である', async () => {
  const { tmpDir, connection, cleanup } = setupTestEnv();
  try {
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const requestedUrls: string[] = [];

    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes('targetTimes.json')) return new Response(syntheticJson, { status: 200 });
      return new Response(VALID_1X1_PNG, { status: 200 });
    };

    const service = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      staleAfterMs: { heavyrain: 300_000, inund: 300_000, land: 300_000 },
      fetchFn: fakeFetch,
      clock: () => currentTime,
    });

    await service.refreshTimes();
    requestedUrls.length = 0; // 一覧取得 URL をクリア

    const validCoord: TileCoordinate = { zoom: 10, tileX: 909, tileY: 404 };

    // 1. 一覧にない時刻
    const notListedFrame: KikikuruFrameKey = {
      layer: 'heavyrain',
      baseTime: '2026-09-07T03:00:00.000Z',
      validTime: '2026-09-07T04:00:00.000Z', // 一覧にない
      imageId: 'rain_mesh',
      member: 'immed0',
    };
    const res1 = await service.fetchFrameTiles(notListedFrame, [validCoord]);
    assert.strictEqual(res1[0]?.kind, 'unavailable');
    assert.strictEqual(res1[0]?.errorKind, 'frame_not_available');
    assert.strictEqual(requestedUrls.length, 0);

    // 2. 別レイヤーへ差し替えたキー（heavyrain の時刻を land に渡す）
    const mismatchedLayerFrame: KikikuruFrameKey = {
      layer: 'land',
      baseTime: '2026-09-07T03:00:00.000Z',
      validTime: '2026-09-07T03:10:00.000Z', // heavyrain にはあるが land にはない
      imageId: 'land',
      member: 'immed1',
    };
    const res2 = await service.fetchFrameTiles(mismatchedLayerFrame, [validCoord]);
    assert.strictEqual(res2[0]?.kind, 'unavailable');
    assert.strictEqual(res2[0]?.errorKind, 'frame_not_available');
    assert.strictEqual(requestedUrls.length, 0);

    // 3. 有効なフレームだが未許可ズーム
    const validFrame: KikikuruFrameKey = {
      layer: 'heavyrain',
      baseTime: '2026-09-07T03:00:00.000Z',
      validTime: '2026-09-07T03:00:00.000Z',
      imageId: 'rain_mesh',
      member: 'immed0',
    };
    const unallowedZoomCoord: TileCoordinate = { zoom: 9, tileX: 454, tileY: 202 };
    const res3 = await service.fetchFrameTiles(validFrame, [unallowedZoomCoord]);
    assert.strictEqual(res3[0]?.kind, 'unavailable');
    assert.strictEqual(res3[0]?.errorKind, 'invalid_coordinate');
    assert.strictEqual(requestedUrls.length, 0);

    // 4. 不正 XYZ
    const invalidCoords: TileCoordinate[] = [
      { zoom: 10, tileX: -1, tileY: 404 },
      { zoom: 10, tileX: 1024, tileY: 404 },
      { zoom: 10, tileX: 909, tileY: 1025 },
    ];
    const res4 = await service.fetchFrameTiles(validFrame, invalidCoords);
    for (const r of res4) {
      assert.strictEqual(r.kind, 'unavailable');
      assert.strictEqual(r.errorKind, 'invalid_coordinate');
    }
    assert.strictEqual(requestedUrls.length, 0);
  } finally {
    cleanup();
  }
});

test('3. 3レイヤーの有効フレームに対する PNG をそれぞれ取得・検証・保存でき、同一座標の2回目はキャッシュを返して外部 fetch を増やさない。同時要求の重複なし', async () => {
  const { tmpDir, connection, cleanup } = setupTestEnv();
  try {
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const requestedUrls: string[] = [];

    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes('targetTimes.json')) return new Response(syntheticJson, { status: 200 });
      return new Response(VALID_1X1_PNG, { status: 200 });
    };

    const service = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      staleAfterMs: { heavyrain: 300_000, inund: 300_000, land: 300_000 },
      fetchFn: fakeFetch,
      clock: () => currentTime,
    });

    await service.refreshTimes();
    requestedUrls.length = 0;

    const coord1: TileCoordinate = { zoom: 10, tileX: 909, tileY: 404 };
    const coord2: TileCoordinate = { zoom: 10, tileX: 909, tileY: 405 };

    // 1. heavyrain の取得 (imageId=rain_mesh)
    const frameHeavy: KikikuruFrameKey = {
      layer: 'heavyrain',
      baseTime: '2026-09-07T03:00:00.000Z',
      validTime: '2026-09-07T03:00:00.000Z',
      imageId: 'rain_mesh',
      member: 'immed0',
    };
    const resHeavy = await service.fetchFrameTiles(frameHeavy, [coord1]);
    assert.strictEqual(resHeavy[0]?.kind, 'downloaded');
    assert.strictEqual(resHeavy[0]?.tile?.byteSize, VALID_1X1_PNG.byteLength);
    assert.strictEqual(
      requestedUrls[0],
      'https://www.jma.go.jp/bosai/jmatile/data/risk/20260907030000/immed0/20260907030000/surf/rain_mesh/10/909/404.png',
    );

    // 2. inund の取得 (imageId=inund, member=none)
    const frameInund: KikikuruFrameKey = {
      layer: 'inund',
      baseTime: '2026-09-07T03:00:00.000Z',
      validTime: '2026-09-07T03:20:00.000Z',
      imageId: 'inund',
      member: 'none',
    };
    const resInund = await service.fetchFrameTiles(frameInund, [coord1]);
    assert.strictEqual(resInund[0]?.kind, 'downloaded');
    assert.strictEqual(
      requestedUrls[1],
      'https://www.jma.go.jp/bosai/jmatile/data/risk/20260907030000/none/20260907032000/surf/inund/10/909/404.png',
    );

    // 3. land の取得 (imageId=land, member=immed0)
    const frameLand: KikikuruFrameKey = {
      layer: 'land',
      baseTime: '2026-09-07T03:00:00.000Z',
      validTime: '2026-09-07T02:50:00.000Z',
      imageId: 'land',
      member: 'immed0',
    };
    const resLand = await service.fetchFrameTiles(frameLand, [coord1]);
    assert.strictEqual(resLand[0]?.kind, 'downloaded');
    assert.strictEqual(
      requestedUrls[2],
      'https://www.jma.go.jp/bosai/jmatile/data/risk/20260907030000/immed0/20260907025000/surf/land/10/909/404.png',
    );

    // 2回目の同一要求 -> キャッシュを返して外部 fetch 追加なし
    requestedUrls.length = 0;
    const reHeavy = await service.fetchFrameTiles(frameHeavy, [coord1]);
    assert.strictEqual(reHeavy[0]?.kind, 'cached');
    assert.strictEqual(reHeavy[0]?.tile?.contentHash, EXPECTED_HASH);
    assert.strictEqual(requestedUrls.length, 0);

    // 同一フレームへの同時要求 -> 1つが downloaded、もう1つが cached、外部 fetch は 1 回
    const [simA, simB] = await Promise.all([
      service.fetchFrameTiles(frameHeavy, [coord2]),
      service.fetchFrameTiles(frameHeavy, [coord2]),
    ]);
    assert.strictEqual(simA[0]?.kind, 'downloaded');
    assert.strictEqual(simB[0]?.kind, 'cached');
    assert.strictEqual(requestedUrls.length, 1);
  } finally {
    cleanup();
  }
});

test('4. 一覧更新を跨いでも既存タイルが保持され、一覧から消えたフレームのファイルキャッシュだけが削除される', async () => {
  const { tmpDir, connection, cleanup } = setupTestEnv();
  try {
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('targetTimes.json')) return new Response(syntheticJson, { status: 200 });
      return new Response(VALID_1X1_PNG, { status: 200 });
    };

    const service = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      staleAfterMs: { heavyrain: 300_000, inund: 300_000, land: 300_000 },
      fetchFn: fakeFetch,
      clock: () => currentTime,
    });

    await service.refreshTimes();

    const frameHeavy: KikikuruFrameKey = {
      layer: 'heavyrain',
      baseTime: '2026-09-07T03:00:00.000Z',
      validTime: '2026-09-07T03:00:00.000Z',
      imageId: 'rain_mesh',
      member: 'immed0',
    };
    const coord: TileCoordinate = { zoom: 10, tileX: 909, tileY: 404 };
    const dlResult = await service.fetchFrameTiles(frameHeavy, [coord]);
    assert.strictEqual(dlResult[0]?.kind, 'downloaded');
    assert.ok(dlResult[0].tile);
    const tileFilePath = dlResult[0].tile.filePath;
    assert.strictEqual(fs.existsSync(path.join(tmpDir, tileFilePath)), true);

    // 再度一覧更新を実行（同じフレームが含まれる）
    await service.refreshTimes();

    // 継続フレームのタイルが保持されている
    const snapAfter = findRiskSnapshot(connection, 'heavyrain')!;
    const matchedFrame = snapAfter.frames.find(
      (f) => f.baseTime === frameHeavy.baseTime && f.validTime === frameHeavy.validTime,
    )!;
    assert.strictEqual(matchedFrame.tiles.length, 1);
    assert.strictEqual(matchedFrame.tiles[0]?.filePath, tileFilePath);
    assert.strictEqual(fs.existsSync(path.join(tmpDir, tileFilePath)), true);

    // 空一覧で更新 -> フレームが消えるため、非参照となったファイルキャッシュが削除される
    const emptyService = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      staleAfterMs: { heavyrain: 300_000, inund: 300_000, land: 300_000 },
      fetchFn: async () => new Response(emptyJson, { status: 200 }),
      clock: () => currentTime,
    });
    await emptyService.refreshTimes();

    assert.strictEqual(fs.existsSync(path.join(tmpDir, tileFilePath)), false);
  } finally {
    cleanup();
  }
});

test('5. stale のキャッシュミスは GET せず catalog_stale。stale のキャッシュありは stale で返す', async () => {
  const { tmpDir, connection, cleanup } = setupTestEnv();
  try {
    let currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const requestedUrls: string[] = [];

    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes('targetTimes.json')) return new Response(syntheticJson, { status: 200 });
      return new Response(VALID_1X1_PNG, { status: 200 });
    };

    const staleAfterMs = 300_000;
    const service = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      staleAfterMs: { heavyrain: staleAfterMs, inund: staleAfterMs, land: staleAfterMs },
      fetchFn: fakeFetch,
      clock: () => currentTime,
    });

    await service.refreshTimes();

    const frame: KikikuruFrameKey = {
      layer: 'heavyrain',
      baseTime: '2026-09-07T03:00:00.000Z',
      validTime: '2026-09-07T03:00:00.000Z',
      imageId: 'rain_mesh',
      member: 'immed0',
    };

    // 座標 909, 404 を事前にキャッシュ
    const coordSaved: TileCoordinate = { zoom: 10, tileX: 909, tileY: 404 };
    await service.fetchFrameTiles(frame, [coordSaved]);

    // 時間を経過させて stale にする (6分後)
    currentTime = '2026-09-07T03:06:00.000Z' as UtcIso8601String;
    const catalog = service.readCatalog();
    assert.strictEqual(catalog.layers.heavyrain.availability, 'stale');

    requestedUrls.length = 0;

    // 座標 909, 404 (キャッシュあり) と 909, 405 (キャッシュなし) を要求
    const coordMissing: TileCoordinate = { zoom: 10, tileX: 909, tileY: 405 };
    const results = await service.fetchFrameTiles(frame, [coordSaved, coordMissing]);

    // キャッシュあり: availability='stale', kind='cached'
    assert.strictEqual(results[0]?.kind, 'cached');
    assert.strictEqual(results[0]?.availability, 'stale');

    // キャッシュなし: GET 抑止、catalog_stale
    assert.strictEqual(results[1]?.kind, 'unavailable');
    assert.strictEqual(results[1]?.availability, 'stale');
    assert.strictEqual(results[1]?.errorKind, 'catalog_stale');

    // 外部 fetch が一切呼ばれていないこと
    assert.strictEqual(requestedUrls.length, 0);
  } finally {
    cleanup();
  }
});

test('6. PNG 以外の本文や HTTP 失敗は保存されない。2 GET 中 1 失敗時は通信履歴 outcome=failure、itemCount=2、failedItemCount=1。完全キャッシュ・空要求は履歴0行', async () => {
  const { tmpDir, connection, cleanup } = setupTestEnv();
  try {
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;

    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('targetTimes.json')) return new Response(syntheticJson, { status: 200 });
      if (url.includes('10/909/404.png')) return new Response(VALID_1X1_PNG, { status: 200 });
      // 405 は 404 Not Found
      return new Response('Not Found', { status: 404, statusText: 'Not Found' });
    };

    const service = new KikikuruService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      staleAfterMs: { heavyrain: 300_000, inund: 300_000, land: 300_000 },
      fetchFn: fakeFetch,
      clock: () => currentTime,
    });

    await service.refreshTimes();

    const frame: KikikuruFrameKey = {
      layer: 'heavyrain',
      baseTime: '2026-09-07T03:00:00.000Z',
      validTime: '2026-09-07T03:00:00.000Z',
      imageId: 'rain_mesh',
      member: 'immed0',
    };

    const coords: TileCoordinate[] = [
      { zoom: 10, tileX: 909, tileY: 404 }, // 成功
      { zoom: 10, tileX: 909, tileY: 405 }, // 失敗
    ];

    const results = await service.fetchFrameTiles(frame, coords);
    assert.strictEqual(results[0]?.kind, 'downloaded');
    assert.strictEqual(results[1]?.kind, 'unavailable');
    assert.strictEqual(results[1]?.errorKind, 'http_status');

    const attempts = listFetchAttempts(connection, { sourceKind: 'risk_tile' });
    assert.strictEqual(attempts.length, 1);
    assert.strictEqual(attempts[0]?.itemCount, 2);
    assert.strictEqual(attempts[0]?.failedItemCount, 1);
    assert.strictEqual(attempts[0]?.outcome, 'failure');
    assert.strictEqual(
      attempts[0]?.targetRef,
      'heavyrain:2026-09-07T03:00:00.000Z:2026-09-07T03:00:00.000Z:rain_mesh:immed0',
    );

    // 完全キャッシュでの呼び出し -> 履歴は増えない
    await service.fetchFrameTiles(frame, [{ zoom: 10, tileX: 909, tileY: 404 }]);
    const attempts2 = listFetchAttempts(connection, { sourceKind: 'risk_tile' });
    assert.strictEqual(attempts2.length, 1);

    // 空要求 -> 履歴は増えない
    await service.fetchFrameTiles(frame, []);
    const attempts3 = listFetchAttempts(connection, { sourceKind: 'risk_tile' });
    assert.strictEqual(attempts3.length, 1);
  } finally {
    cleanup();
  }
});
