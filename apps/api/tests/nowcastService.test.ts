import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import { openDatabase, runMigrations } from '../src/database/index.js';
import { NowcastService } from '../src/polling/nowcastService.js';
import { buildNowcastTileUrl } from '../src/polling/nowcastSource.js';
import { listFetchAttempts } from '../src/repositories/fetchAttemptRepository.js';
import { findRadarSnapshot } from '../src/repositories/radarRepository.js';
import type { NowcastFrameKey, TileCoordinate } from '../src/repositories/types.js';

const VALID_1X1_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const VALID_1X1_PNG = Buffer.from(VALID_1X1_PNG_BASE64, 'base64');
const EXPECTED_HASH = '6b7fa434f92a8b80aab02d9bf1a12e49ffcae424e4013a1c4f68b67e3d2bbcd0';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures/jma/nowcast');
const n1SyntheticJson = fs.readFileSync(
  path.join(FIXTURES_DIR, 'nowcast_target_times_n1_synthetic.json'),
  'utf-8',
);
const n2SyntheticJson = fs.readFileSync(
  path.join(FIXTURES_DIR, 'nowcast_target_times_n2_synthetic.json'),
  'utf-8',
);

function setupTestEnv() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nowcast-service-test-'));
  const connection = openDatabase(':memory:');
  const migrationsDir = path.join(import.meta.dirname, '../migrations');
  runMigrations(connection, migrationsDir);

  const cleanup = () => {
    connection.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };

  return { tmpDir, connection, cleanup };
}

test('1. N1 成功／N2 失敗、その逆、両方初回失敗。正常側を返し、失敗側のみ unavailable。1回成功後に失敗させ、旧フレーム・最終成功・版が保持され stale。空一覧成功は available', async () => {
  const { tmpDir, connection, cleanup } = setupTestEnv();
  try {
    let currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;

    // Case 1-1: N1 成功 / N2 失敗
    let fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('targetTimes_N1.json')) {
        return new Response(n1SyntheticJson, { status: 200 });
      }
      return new Response('Internal Server Error', { status: 500, statusText: 'Server Error' });
    };

    let service = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      staleAfterMs: { N1: 300_000, N2: 300_000 },
      fetchFn,
      clock,
    });

    let catalog = await service.refreshTimes();
    assert.strictEqual(catalog.products.N1.availability, 'available');
    assert.strictEqual(catalog.products.N1.frames.length > 0, true);
    assert.strictEqual(catalog.products.N2.availability, 'unavailable');
    assert.strictEqual(catalog.products.N2.frames.length, 0);

    // Case 1-2: 両方初回失敗（新しい DB で検証）
    const connFail = openDatabase(':memory:');
    runMigrations(connFail, path.join(import.meta.dirname, '../migrations'));
    try {
      const failFetch: typeof fetch = async () => new Response('Error', { status: 500 });
      const failService = new NowcastService(connFail, {
        cacheRoot: tmpDir,
        allowedZooms: [10],
        staleAfterMs: { N1: 300_000, N2: 300_000 },
        fetchFn: failFetch,
        clock,
      });
      const failCatalog = await failService.refreshTimes();
      assert.strictEqual(failCatalog.products.N1.availability, 'unavailable');
      assert.strictEqual(failCatalog.products.N2.availability, 'unavailable');
    } finally {
      connFail.close();
    }

    // Case 1-3: N1 は 1 回成功後に失敗させると、旧フレーム・最終成功・版が保持され stale
    const prevN1 = findRadarSnapshot(connection, 'N1')!;
    assert.notStrictEqual(prevN1, null);
    const prevSuccessAt = prevN1.metadata.lastSuccessAt;
    const prevVersion = prevN1.metadata.sourceVersion;
    const prevFrames = prevN1.frames;

    currentTime = '2026-09-07T03:02:00.000Z' as UtcIso8601String;
    // N1 を失敗させる
    fetchFn = async (input) => {
      const url = String(input);
      if (url.includes('targetTimes_N2.json')) {
        return new Response(n2SyntheticJson, { status: 200 });
      }
      return new Response('Timeout', { status: 504, statusText: 'Gateway Timeout' });
    };

    service = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      staleAfterMs: { N1: 300_000, N2: 300_000 },
      fetchFn,
      clock,
    });

    catalog = await service.refreshTimes();
    assert.strictEqual(catalog.products.N1.availability, 'stale');
    assert.strictEqual(catalog.products.N2.availability, 'available');

    const staleN1 = findRadarSnapshot(connection, 'N1')!;
    assert.strictEqual(staleN1.metadata.availability, 'stale');
    assert.strictEqual(staleN1.metadata.lastSuccessAt, prevSuccessAt);
    assert.strictEqual(staleN1.metadata.sourceVersion, prevVersion);
    assert.strictEqual(staleN1.metadata.fetchedAt, '2026-09-07T03:02:00.000Z');
    assert.deepStrictEqual(
      staleN1.frames.map((f) => ({ baseTime: f.baseTime, validTime: f.validTime })),
      prevFrames.map((f) => ({ baseTime: f.baseTime, validTime: f.validTime })),
    );

    // Case 1-4: 空一覧成功は available、issuedAt=fetchedAt
    fetchFn = async () => new Response('[]', { status: 200 });
    service = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      staleAfterMs: { N1: 300_000, N2: 300_000 },
      fetchFn,
      clock,
    });
    catalog = await service.refreshTimes();
    assert.strictEqual(catalog.products.N1.availability, 'available');
    assert.strictEqual(catalog.products.N1.frames.length, 0);
    const emptySnap = findRadarSnapshot(connection, 'N1')!;
    assert.strictEqual(emptySnap.metadata.issuedAt, '2026-09-07T03:02:00.000Z');
  } finally {
    cleanup();
  }
});

test('2. サービスを同じ DB で再生成して前回正常値を取得できる。clock を注入閾値の直前／ちょうどに進め readCatalog だけ実行し available／stale の境界が期待どおり。進んだ窓から外れたコマは返さない', async () => {
  const { tmpDir, connection, cleanup } = setupTestEnv();
  try {
    let currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTime;

    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('targetTimes_N1.json')) {
        return new Response(n1SyntheticJson, { status: 200 });
      }
      return new Response(n2SyntheticJson, { status: 200 });
    };

    const staleAfterMs = 300_000; // 5分
    const service1 = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      staleAfterMs: { N1: staleAfterMs, N2: staleAfterMs },
      fetchFn: fakeFetch,
      clock,
    });

    await service1.refreshTimes();

    // サービスを同じ DB で再生成
    const service2 = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      staleAfterMs: { N1: staleAfterMs, N2: staleAfterMs },
      fetchFn: fakeFetch,
      clock,
    });

    // 直後は available
    let catalog = service2.readCatalog();
    assert.strictEqual(catalog.products.N1.availability, 'available');

    // 閾値直前: 4分59秒999ミリ秒後 (300_000 - 1 ms)
    currentTime = new Date(
      new Date('2026-09-07T03:00:00.000Z').getTime() + staleAfterMs - 1,
    ).toISOString() as UtcIso8601String;
    catalog = service2.readCatalog();
    assert.strictEqual(catalog.products.N1.availability, 'available');

    // 閾値ちょうど: 5分00秒後 (300_000 ms)
    currentTime = new Date(
      new Date('2026-09-07T03:00:00.000Z').getTime() + staleAfterMs,
    ).toISOString() as UtcIso8601String;
    catalog = service2.readCatalog();
    assert.strictEqual(catalog.products.N1.availability, 'stale');

    // 窓から外れたコマの除外確認:
    // now を 04:05:01 (03:00:00 から 65分1秒後) に進める
    // 03:00:00, 03:05:00 のフレームは窓 [03:05:01, 05:05:01] の外になるため返されない
    currentTime = '2026-09-07T04:05:01.000Z' as UtcIso8601String;
    catalog = service2.readCatalog();
    assert.strictEqual(
      catalog.products.N1.frames.some((f) => f.validTime === '2026-09-07T03:00:00.000Z'),
      false,
    );
    assert.strictEqual(
      catalog.products.N1.frames.some((f) => f.validTime === '2026-09-07T03:05:00.000Z'),
      false,
    );
  } finally {
    cleanup();
  }
});

test('3. 一覧にない時刻、N2 の baseTime を N1 の最新で置換したキー、窓外、非 hrpns、不正 XYZ、未許可 zoom を要求し、fake fetch の URL 配列が空であることを確認', async () => {
  const { tmpDir, connection, cleanup } = setupTestEnv();
  try {
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const requestedUrls: string[] = [];

    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes('targetTimes_N1.json'))
        return new Response(n1SyntheticJson, { status: 200 });
      if (url.includes('targetTimes_N2.json'))
        return new Response(n2SyntheticJson, { status: 200 });
      return new Response(VALID_1X1_PNG, { status: 200 });
    };

    const service = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      staleAfterMs: { N1: 300_000, N2: 300_000 },
      fetchFn: fakeFetch,
      clock: () => currentTime,
    });

    await service.refreshTimes();
    requestedUrls.length = 0; // 一覧取得の URL をクリア

    const validCoord: TileCoordinate = { zoom: 10, tileX: 909, tileY: 404 };

    // 1. 一覧にない時刻
    const notListedFrame: NowcastFrameKey = {
      product: 'N1',
      baseTime: '2026-09-07T03:00:00.000Z',
      validTime: '2026-09-07T03:25:00.000Z', // 一覧にない
      element: 'hrpns',
      member: 'none',
    };
    const res1 = await service.fetchFrameTiles(notListedFrame, [validCoord]);
    assert.strictEqual(res1[0]?.kind, 'unavailable');
    assert.strictEqual(res1[0]?.errorKind, 'frame_not_available');
    assert.strictEqual(requestedUrls.length, 0);

    // 2. N2 の baseTime を N1 の最新で置換したキー
    const replacedBaseFrame: NowcastFrameKey = {
      product: 'N2',
      baseTime: '2026-09-07T03:00:00.000Z', // 本来 N2 は 02:55:00
      validTime: '2026-09-07T03:55:00.000Z',
      element: 'hrpns',
      member: 'none',
    };
    const res2 = await service.fetchFrameTiles(replacedBaseFrame, [validCoord]);
    assert.strictEqual(res2[0]?.kind, 'unavailable');
    assert.strictEqual(res2[0]?.errorKind, 'frame_not_available');
    assert.strictEqual(requestedUrls.length, 0);

    // 3. 窓外（now ± 60分外）
    const outsideFrame: NowcastFrameKey = {
      product: 'N1',
      baseTime: '2026-09-07T03:00:00.000Z',
      validTime: '2026-09-07T01:50:00.000Z', // 70分前
      element: 'hrpns',
      member: 'none',
    };
    const res3 = await service.fetchFrameTiles(outsideFrame, [validCoord]);
    assert.strictEqual(res3[0]?.kind, 'unavailable');
    assert.strictEqual(res3[0]?.errorKind, 'frame_not_available');
    assert.strictEqual(requestedUrls.length, 0);

    // 4. 非 hrpns
    const nonHrpnsFrame = {
      product: 'N1',
      baseTime: '2026-09-07T03:00:00.000Z',
      validTime: '2026-09-07T03:00:00.000Z',
      element: 'thunder',
      member: 'none',
    } as unknown as NowcastFrameKey;
    const res4 = await service.fetchFrameTiles(nonHrpnsFrame, [validCoord]);
    assert.strictEqual(res4[0]?.kind, 'unavailable');
    assert.strictEqual(res4[0]?.errorKind, 'frame_not_available');
    assert.strictEqual(requestedUrls.length, 0);

    // 5. 不正 XYZ
    const validFrame: NowcastFrameKey = {
      product: 'N1',
      baseTime: '2026-09-07T03:00:00.000Z',
      validTime: '2026-09-07T03:00:00.000Z',
      element: 'hrpns',
      member: 'none',
    };
    const invalidCoords: TileCoordinate[] = [
      { zoom: 10, tileX: -1, tileY: 404 },
      { zoom: 10, tileX: 1024, tileY: 404 }, // 2^10 = 1024 なので範囲外
      { zoom: 10, tileX: 909, tileY: 1025 },
    ];
    const res5 = await service.fetchFrameTiles(validFrame, invalidCoords);
    for (const r of res5) {
      assert.strictEqual(r.kind, 'unavailable');
      assert.strictEqual(r.errorKind, 'invalid_coordinate');
    }
    assert.strictEqual(requestedUrls.length, 0);

    // 6. 未許可 zoom (allowedZooms: [10])
    const unallowedZoomCoord: TileCoordinate = { zoom: 9, tileX: 454, tileY: 202 };
    const res6 = await service.fetchFrameTiles(validFrame, [unallowedZoomCoord]);
    assert.strictEqual(res6[0]?.kind, 'unavailable');
    assert.strictEqual(res6[0]?.errorKind, 'invalid_coordinate');
    assert.strictEqual(requestedUrls.length, 0);
  } finally {
    cleanup();
  }
});

test('4. 1フレーム3座標（うち重複1つ）を要求すると異なる2 URL だけ GET。同じ要求を再実行すると GET 追加なし。別フレーム・未要求座標は取得しない', async () => {
  const { tmpDir, connection, cleanup } = setupTestEnv();
  try {
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const requestedUrls: string[] = [];

    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes('targetTimes_N1.json'))
        return new Response(n1SyntheticJson, { status: 200 });
      if (url.includes('targetTimes_N2.json'))
        return new Response(n2SyntheticJson, { status: 200 });
      return new Response(VALID_1X1_PNG, { status: 200 });
    };

    const service = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      staleAfterMs: { N1: 300_000, N2: 300_000 },
      fetchFn: fakeFetch,
      clock: () => currentTime,
    });

    await service.refreshTimes();
    requestedUrls.length = 0;

    const frame: NowcastFrameKey = {
      product: 'N1',
      baseTime: '2026-09-07T03:00:00.000Z',
      validTime: '2026-09-07T03:00:00.000Z',
      element: 'hrpns',
      member: 'none',
    };

    const coords: TileCoordinate[] = [
      { zoom: 10, tileX: 909, tileY: 404 },
      { zoom: 10, tileX: 909, tileY: 405 },
      { zoom: 10, tileX: 909, tileY: 404 }, // 重複
    ];

    const results = await service.fetchFrameTiles(frame, coords);
    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0]?.kind, 'downloaded');
    assert.strictEqual(results[1]?.kind, 'downloaded');
    assert.strictEqual(results[2]?.kind, 'downloaded');

    // 異なる 2 URL だけが GET されたこと
    assert.strictEqual(requestedUrls.length, 2);
    assert.strictEqual(
      requestedUrls[0],
      'https://www.jma.go.jp/bosai/jmatile/data/nowc/20260907030000/none/20260907030000/surf/hrpns/10/909/404.png',
    );
    assert.strictEqual(
      requestedUrls[1],
      'https://www.jma.go.jp/bosai/jmatile/data/nowc/20260907030000/none/20260907030000/surf/hrpns/10/909/405.png',
    );

    // 同じ要求を再実行
    requestedUrls.length = 0;
    const reResults = await service.fetchFrameTiles(frame, coords);
    assert.strictEqual(reResults.length, 3);
    assert.strictEqual(reResults[0]?.kind, 'cached');
    assert.strictEqual(reResults[1]?.kind, 'cached');
    assert.strictEqual(reResults[2]?.kind, 'cached');
    assert.strictEqual(requestedUrls.length, 0); // GET 追加なし
  } finally {
    cleanup();
  }
});

test('5. 制御可能な fetch Promise で同時要求と一覧更新を重ね、同じタイルの GET が1回、保存済み別座標が消えず、自然キー継続時に frame ID が保持され、消えたフレームへ tile 行が復活しないことを検証', async () => {
  const { tmpDir, connection, cleanup } = setupTestEnv();
  try {
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const getCountMap = new Map<string, number>();

    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('targetTimes_N1.json'))
        return new Response(n1SyntheticJson, { status: 200 });
      if (url.includes('targetTimes_N2.json'))
        return new Response(n2SyntheticJson, { status: 200 });

      getCountMap.set(url, (getCountMap.get(url) ?? 0) + 1);
      return new Response(VALID_1X1_PNG, { status: 200 });
    };

    const service = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      staleAfterMs: { N1: 300_000, N2: 300_000 },
      fetchFn: fakeFetch,
      clock: () => currentTime,
    });

    await service.refreshTimes();

    const snapBefore = findRadarSnapshot(connection, 'N1')!;
    const frameIdBefore = snapBefore.frames.find(
      (f) => f.validTime === '2026-09-07T03:00:00.000Z',
    )!.id;

    const frame: NowcastFrameKey = {
      product: 'N1',
      baseTime: '2026-09-07T03:00:00.000Z',
      validTime: '2026-09-07T03:00:00.000Z',
      element: 'hrpns',
      member: 'none',
    };

    // 同時要求を2本並行実行
    const coord: TileCoordinate = { zoom: 10, tileX: 909, tileY: 404 };
    const [resA, resB] = await Promise.all([
      service.fetchFrameTiles(frame, [coord]),
      service.fetchFrameTiles(frame, [coord]),
    ]);

    // 直列化キューにより、先行が downloaded、後続が cached となり、GET は 1 回のみ
    assert.strictEqual(resA[0]?.kind, 'downloaded');
    assert.strictEqual(resB[0]?.kind, 'cached');
    assert.strictEqual(getCountMap.size, 1);
    const tileUrl = buildNowcastTileUrl(frame.baseTime, frame.validTime, 10, 909, 404);
    assert.strictEqual(getCountMap.get(tileUrl), 1);

    // 別座標を追加
    await service.fetchFrameTiles(frame, [{ zoom: 10, tileX: 909, tileY: 405 }]);

    // 一覧更新を実行（同じ自然キーを含む）
    await service.refreshTimes();

    const snapAfter = findRadarSnapshot(connection, 'N1')!;
    const frameAfter = snapAfter.frames.find((f) => f.validTime === '2026-09-07T03:00:00.000Z')!;

    // 自然キー継続時に frame ID が保持されている
    assert.strictEqual(frameAfter.id, frameIdBefore);
    // 保存済み別座標（404, 405）が消えていない
    assert.strictEqual(frameAfter.tiles.length, 2);
    assert.strictEqual(
      frameAfter.tiles.some((t) => t.tileY === 404),
      true,
    );
    assert.strictEqual(
      frameAfter.tiles.some((t) => t.tileY === 405),
      true,
    );
  } finally {
    cleanup();
  }
});

test('6. stale の正常キャッシュは stale と実時刻付きで返り、stale のキャッシュミスは GET せず catalog_stale（§10 承認後）。キャッシュ画像と選択時刻が完全一致する', async () => {
  const { tmpDir, connection, cleanup } = setupTestEnv();
  try {
    let currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const requestedUrls: string[] = [];

    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes('targetTimes_N1.json'))
        return new Response(n1SyntheticJson, { status: 200 });
      if (url.includes('targetTimes_N2.json'))
        return new Response(n2SyntheticJson, { status: 200 });
      return new Response(VALID_1X1_PNG, { status: 200 });
    };

    const service = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      staleAfterMs: { N1: 300_000, N2: 300_000 },
      fetchFn: fakeFetch,
      clock: () => currentTime,
    });

    await service.refreshTimes();

    const frame: NowcastFrameKey = {
      product: 'N1',
      baseTime: '2026-09-07T03:00:00.000Z',
      validTime: '2026-09-07T03:00:00.000Z',
      element: 'hrpns',
      member: 'none',
    };

    // 座標 909, 404 を事前にキャッシュへ取得
    const coordSaved: TileCoordinate = { zoom: 10, tileX: 909, tileY: 404 };
    await service.fetchFrameTiles(frame, [coordSaved]);

    // 時間を経過させて stale にする (6分後)
    currentTime = '2026-09-07T03:06:00.000Z' as UtcIso8601String;
    const catalog = service.readCatalog();
    assert.strictEqual(catalog.products.N1.availability, 'stale');

    requestedUrls.length = 0;

    // 座標 909, 404 (キャッシュあり) と 909, 405 (キャッシュなし) を同時に要求
    const coordMissing: TileCoordinate = { zoom: 10, tileX: 909, tileY: 405 };
    const results = await service.fetchFrameTiles(frame, [coordSaved, coordMissing]);

    // キャッシュあり: availability='stale', kind='cached'
    assert.strictEqual(results[0]?.kind, 'cached');
    assert.strictEqual(results[0]?.availability, 'stale');
    if (results[0]?.kind === 'cached') {
      assert.strictEqual(results[0].tile.contentHash, EXPECTED_HASH);
    }

    // キャッシュなし: GET を抑止し catalog_stale
    assert.strictEqual(results[1]?.kind, 'unavailable');
    assert.strictEqual(results[1]?.availability, 'stale');
    assert.strictEqual(results[1]?.errorKind, 'catalog_stale');

    // fake fetch にタイル取得 URL が一切呼ばれていないことを確認
    assert.strictEqual(requestedUrls.length, 0);
  } finally {
    cleanup();
  }
});

test('7. 同じフレームの2 GET 中1失敗は履歴1行、itemCount=2／failedItemCount=1／outcome=failure（§10 承認後）。完全キャッシュ・空要求は履歴0行。時刻一覧の正常空配列でも CHECK 制約に違反しない', async () => {
  const { tmpDir, connection, cleanup } = setupTestEnv();
  try {
    const currentTime = '2026-09-07T03:00:00.000Z' as UtcIso8601String;

    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('targetTimes_N1.json'))
        return new Response(n1SyntheticJson, { status: 200 });
      if (url.includes('targetTimes_N2.json'))
        return new Response(n2SyntheticJson, { status: 200 });

      // 404 座標だけ 404 を返す
      if (url.includes('10/909/404.png')) {
        return new Response(VALID_1X1_PNG, { status: 200 });
      }
      return new Response('Not Found', { status: 404, statusText: 'Not Found' });
    };

    const service = new NowcastService(connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      staleAfterMs: { N1: 300_000, N2: 300_000 },
      fetchFn: fakeFetch,
      clock: () => currentTime,
    });

    await service.refreshTimes();

    const frame: NowcastFrameKey = {
      product: 'N1',
      baseTime: '2026-09-07T03:00:00.000Z',
      validTime: '2026-09-07T03:00:00.000Z',
      element: 'hrpns',
      member: 'none',
    };

    // 2 GET 中 1 失敗
    const coords: TileCoordinate[] = [
      { zoom: 10, tileX: 909, tileY: 404 }, // 成功
      { zoom: 10, tileX: 909, tileY: 405 }, // 404 失敗
    ];

    const results = await service.fetchFrameTiles(frame, coords);
    assert.strictEqual(results[0]?.kind, 'downloaded');
    assert.strictEqual(results[1]?.kind, 'unavailable');
    assert.strictEqual(results[1]?.errorKind, 'http_status');

    const attemptsAfter = listFetchAttempts(connection, { sourceKind: 'radar_tile' });
    assert.strictEqual(attemptsAfter.length, 1);
    const tileAttempt = attemptsAfter[0]!;
    assert.strictEqual(tileAttempt.itemCount, 2);
    assert.strictEqual(tileAttempt.failedItemCount, 1);
    assert.strictEqual(tileAttempt.outcome, 'failure'); // §10 承認事項
    assert.strictEqual(
      tileAttempt.targetRef,
      'N1:2026-09-07T03:00:00.000Z:2026-09-07T03:00:00.000Z:hrpns:none',
    );
    assert.strictEqual(tileAttempt.httpStatus, null); // 200 と 404 で混在するため null
    assert.strictEqual(tileAttempt.contentHash, null);

    // 完全キャッシュの場合の呼び出し
    const cachedCoords: TileCoordinate[] = [{ zoom: 10, tileX: 909, tileY: 404 }];
    await service.fetchFrameTiles(frame, cachedCoords);
    const attemptsCached = listFetchAttempts(connection, { sourceKind: 'radar_tile' });
    assert.strictEqual(attemptsCached.length, 1); // 履歴行が増えていない

    // 空要求
    await service.fetchFrameTiles(frame, []);
    const attemptsEmpty = listFetchAttempts(connection, { sourceKind: 'radar_tile' });
    assert.strictEqual(attemptsEmpty.length, 1); // 履歴行が増えていない
  } finally {
    cleanup();
  }
});

const FIX_FRAME: NowcastFrameKey = {
  product: 'N1',
  baseTime: '2026-09-07T03:00:00.000Z',
  validTime: '2026-09-07T03:00:00.000Z',
  element: 'hrpns',
  member: 'none',
};
const FIX_COORDS = [404, 405, 406].map((tileY) => ({ zoom: 10, tileX: 909, tileY }));
const FIX_URLS = [
  'https://www.jma.go.jp/bosai/jmatile/data/nowc/20260907030000/none/20260907030000/surf/hrpns/10/909/404.png',
  'https://www.jma.go.jp/bosai/jmatile/data/nowc/20260907030000/none/20260907030000/surf/hrpns/10/909/405.png',
  'https://www.jma.go.jp/bosai/jmatile/data/nowc/20260907030000/none/20260907030000/surf/hrpns/10/909/406.png',
];
function makeRepairEnv() {
  const env = setupTestEnv();
  const urls: string[] = [];
  const state = {
    now: '2026-09-07T03:00:00.000Z' as UtcIso8601String,
    n1: n1SyntheticJson,
    fail: false,
  };
  const options = {
    cacheRoot: env.tmpDir,
    allowedZooms: [10],
    staleAfterMs: { N1: 300_000, N2: 300_000 },
    clock: () => state.now,
    fetchFn: (async (input) => {
      const url = String(input);
      if (url.endsWith('.json'))
        return new Response(
          state.fail ? 'error' : url.includes('N1') ? state.n1 : n2SyntheticJson,
          { status: state.fail ? 500 : 200 },
        );
      urls.push(url);
      return new Response(VALID_1X1_PNG);
    }) as typeof fetch,
  };
  return { ...env, urls, state, options, service: new NowcastService(env.connection, options) };
}
function storedRows(connection: ReturnType<typeof openDatabase>) {
  return connection
    .prepare(
      'SELECT frame_id, zoom, tile_x, tile_y, file_path, byte_size, content_hash, stored_at FROM radar_tile ORDER BY tile_y',
    )
    .all();
}
function pngFiles(root: string): string[] {
  return fs
    .readdirSync(root, { recursive: true })
    .filter((entry) => String(entry).endsWith('.png') || String(entry).includes('.tmp.'))
    .map(String)
    .sort();
}
for (const failure of ['write', 'rename', 'database'] as const) {
  test(`修正: 2座標目の${failure}障害は後続GETを止め、先行DBと画像を保持し実施済み履歴だけ記録`, async (t) => {
    const env = makeRepairEnv();
    try {
      await env.service.refreshTimes();
      if (failure === 'database') {
        env.connection.exec(
          "CREATE TRIGGER fail_tile BEFORE INSERT ON radar_tile WHEN NEW.tile_y = 405 BEGIN SELECT RAISE(FAIL, 'database failure'); END",
        );
      } else {
        const original = fs.promises[failure === 'write' ? 'writeFile' : 'rename'];
        const method = failure === 'write' ? 'writeFile' : 'rename';
        t.mock.method(fs.promises, method, async (...args: Parameters<typeof original>) => {
          if (String(args[0]).includes('/405/')) throw new Error(`${failure} failure`);
          // writeFile と rename の共通ラッパーで実処理を維持する。
          return Reflect.apply(original, fs.promises, args);
        });
      }
      await assert.rejects(env.service.fetchFrameTiles(FIX_FRAME, FIX_COORDS), {
        message: `${failure} failure`,
      });
      assert.deepStrictEqual(env.urls, FIX_URLS.slice(0, 2));
      const frameId = findRadarSnapshot(env.connection, 'N1')!.frames[0].id;
      const expectedPath = `radar/N1/20260907030000/20260907030000/10/909/404/${EXPECTED_HASH}.png`;
      assert.deepStrictEqual(
        storedRows(env.connection).map((row) => ({ ...row })),
        [
          {
            frame_id: frameId,
            zoom: 10,
            tile_x: 909,
            tile_y: 404,
            file_path: expectedPath,
            byte_size: 70,
            content_hash: EXPECTED_HASH,
            stored_at: '2026-09-07T03:00:00.000Z',
          },
        ],
      );
      assert.deepStrictEqual(pngFiles(env.tmpDir), [expectedPath]);
      assert.deepStrictEqual(fs.readFileSync(path.join(env.tmpDir, expectedPath)), VALID_1X1_PNG);
      assert.deepStrictEqual(
        listFetchAttempts(env.connection, { sourceKind: 'radar_tile' }).map((a) => ({
          itemCount: a.itemCount,
          failedItemCount: a.failedItemCount,
          outcome: a.outcome,
          responseBytes: a.responseBytes,
          httpStatus: a.httpStatus,
          requestUrl: a.requestUrl,
        })),
        [
          {
            itemCount: 2,
            failedItemCount: 0,
            outcome: 'success',
            responseBytes: 140,
            httpStatus: 200,
            requestUrl: FIX_URLS[0],
          },
        ],
      );
    } finally {
      t.mock.restoreAll();
      env.cleanup();
    }
  });
}
for (const saveFails of [false, true]) {
  test(`修正: 履歴保存失敗を通知し保存エラー併記=${saveFails}`, async () => {
    const env = makeRepairEnv();
    try {
      await env.service.refreshTimes();
      env.connection.exec(
        "CREATE TRIGGER fail_history BEFORE INSERT ON fetch_attempt BEGIN SELECT RAISE(FAIL, 'history failure'); END",
      );
      if (saveFails)
        env.connection.exec(
          "CREATE TRIGGER fail_tile BEFORE INSERT ON radar_tile BEGIN SELECT RAISE(FAIL, 'save failure'); END",
        );
      await assert.rejects(
        env.service.fetchFrameTiles(FIX_FRAME, [FIX_COORDS[0]]),
        (error: unknown) => {
          if (saveFails) {
            assert.ok(error instanceof AggregateError);
            assert.deepStrictEqual(
              error.errors.map((e: Error) => e.message),
              ['save failure', 'history failure'],
            );
          } else {
            assert.ok(error instanceof Error);
            assert.strictEqual(error.message, 'history failure');
          }
          return true;
        },
      );
      assert.deepStrictEqual(env.urls, [FIX_URLS[0]]);
      assert.strictEqual(storedRows(env.connection).length, saveFails ? 0 : 1);
      assert.strictEqual(pngFiles(env.tmpDir).length, saveFails ? 0 : 1);
    } finally {
      env.cleanup();
    }
  });
}

test('修正: availableの欠落・改変は再GETしstaleの欠落・改変はGETしない', async () => {
  const env = makeRepairEnv();
  try {
    await env.service.refreshTimes();
    const original = await env.service.fetchFrameTiles(FIX_FRAME, FIX_COORDS);
    const tile0 = original[0].tile!;
    const tile1 = original[1].tile!;
    const damage = () => {
      fs.unlinkSync(path.join(env.tmpDir, tile0.filePath));
      const changed = Buffer.from(VALID_1X1_PNG);
      changed[changed.length - 1] ^= 0xff;
      fs.writeFileSync(path.join(env.tmpDir, tile1.filePath), changed);
    };
    damage();
    env.urls.length = 0;
    const restored = await env.service.fetchFrameTiles(FIX_FRAME, FIX_COORDS);
    assert.deepStrictEqual(
      restored.map((r) => r.kind),
      ['downloaded', 'downloaded', 'cached'],
    );
    assert.deepStrictEqual(env.urls, FIX_URLS.slice(0, 2));
    assert.deepStrictEqual(fs.readFileSync(path.join(env.tmpDir, tile0.filePath)), VALID_1X1_PNG);
    assert.deepStrictEqual(fs.readFileSync(path.join(env.tmpDir, tile1.filePath)), VALID_1X1_PNG);
    damage();
    env.urls.length = 0;
    env.state.now = '2026-09-07T03:05:00.000Z';
    const stale = await env.service.fetchFrameTiles(FIX_FRAME, FIX_COORDS);
    assert.deepStrictEqual(stale, [
      {
        coordinate: FIX_COORDS[0],
        availability: 'stale',
        kind: 'unavailable',
        tile: null,
        errorKind: 'catalog_stale',
      },
      {
        coordinate: FIX_COORDS[1],
        availability: 'stale',
        kind: 'unavailable',
        tile: null,
        errorKind: 'catalog_stale',
      },
      { coordinate: FIX_COORDS[2], availability: 'stale', kind: 'cached', tile: original[2].tile },
    ]);
    assert.deepStrictEqual(env.urls, []);
  } finally {
    env.cleanup();
  }
});

test('修正: サービス再生成だけで孤児・一時ファイルを清掃しstale参照画像と外部sentinelを保持', async () => {
  const env = makeRepairEnv();
  const sentinel = path.join(path.dirname(env.tmpDir), `${path.basename(env.tmpDir)}-sentinel`);
  try {
    fs.writeFileSync(sentinel, 'outside');
    await env.service.refreshTimes();
    const result = await env.service.fetchFrameTiles(FIX_FRAME, [FIX_COORDS[0]]);
    env.state.fail = true;
    await env.service.refreshTimes();
    const before = env.service.readCatalog();
    fs.writeFileSync(path.join(env.tmpDir, 'radar/orphan.png'), VALID_1X1_PNG);
    fs.writeFileSync(path.join(env.tmpDir, 'radar/orphan.png.tmp.test'), VALID_1X1_PNG);
    env.urls.length = 0;
    const recreated = new NowcastService(env.connection, env.options);
    assert.deepStrictEqual(recreated.readCatalog(), before);
    assert.deepStrictEqual(pngFiles(env.tmpDir), [result[0].tile!.filePath]);
    assert.deepStrictEqual(await recreated.fetchFrameTiles(FIX_FRAME, [FIX_COORDS[0]]), [
      { ...result[0], kind: 'cached', availability: 'stale' },
    ]);
    assert.deepStrictEqual(env.urls, []);
    assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), 'outside');
  } finally {
    fs.rmSync(sentinel, { force: true });
    env.cleanup();
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
test('修正: 制御PromiseでGET中に一覧更新と同座標要求を重ね継続IDと別座標を保持、削除後は復活しない', async () => {
  const env = makeRepairEnv();
  try {
    const started = deferred<void>();
    const release = deferred<void>();
    let pause = false;
    const originalFetch = env.options.fetchFn;
    const service = new NowcastService(env.connection, {
      ...env.options,
      fetchFn: async (input, init) => {
        if (pause && String(input) === FIX_URLS[1]) {
          started.resolve();
          await release.promise;
        }
        return originalFetch(input, init);
      },
    });
    await service.refreshTimes();
    await service.fetchFrameTiles(FIX_FRAME, [FIX_COORDS[0]]);
    const before = findRadarSnapshot(env.connection, 'N1')!.frames[0];
    pause = true;
    const first = service.fetchFrameTiles(FIX_FRAME, [FIX_COORDS[1]]);
    await started.promise;
    const update = service.refreshTimes();
    const second = service.fetchFrameTiles(FIX_FRAME, [FIX_COORDS[1]]);
    release.resolve();
    const [a, , b] = await Promise.all([first, update, second]);
    assert.deepStrictEqual([a[0].kind, b[0].kind], ['downloaded', 'cached']);
    assert.deepStrictEqual(env.urls, FIX_URLS.slice(0, 2));
    const after = findRadarSnapshot(env.connection, 'N1')!.frames[0];
    assert.strictEqual(after.id, before.id);
    assert.deepStrictEqual(after.tiles, [before.tiles[0], a[0].tile]);
    // 更新が先にキューへ入った場合、消えたフレームへの後続要求はGETせず拒否。
    const updateStarted = deferred<void>();
    const updateRelease = deferred<void>();
    const deleting = new NowcastService(env.connection, {
      ...env.options,
      fetchFn: async (input, init) => {
        if (String(input).includes('N1.json')) {
          updateStarted.resolve();
          await updateRelease.promise;
          return new Response('[]');
        }
        return originalFetch(input, init);
      },
    });
    const removing = deleting.refreshTimes();
    await updateStarted.promise;
    const queued = deleting.fetchFrameTiles(FIX_FRAME, [FIX_COORDS[2]]);
    updateRelease.resolve();
    await removing;
    assert.deepStrictEqual(await queued, [
      {
        coordinate: FIX_COORDS[2],
        availability: 'available',
        kind: 'unavailable',
        tile: null,
        errorKind: 'frame_not_available',
      },
    ]);
    assert.deepStrictEqual(storedRows(env.connection), []);
    assert.deepStrictEqual(pngFiles(env.tmpDir), []);
    assert.deepStrictEqual(env.urls, FIX_URLS.slice(0, 2));
  } finally {
    env.cleanup();
  }
});

test('修正: 安全なXYZ計算範囲外の許可ズームは構築時に拒否', () => {
  const env = makeRepairEnv();
  try {
    for (const zoom of [-1, 1.5, 53, 1024, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(
        () => new NowcastService(env.connection, { ...env.options, allowedZooms: [zoom] }),
      );
    }
  } finally {
    env.cleanup();
  }
});

test('修正: DB保存失敗でも既存本体を削除せず、後始末失敗でも元の保存エラーを保持', async (t) => {
  const env = makeRepairEnv();
  try {
    await env.service.refreshTimes();
    const first = await env.service.fetchFrameTiles(FIX_FRAME, [FIX_COORDS[0]]);
    // DBメタだけ破損し本体は正常という再取得ケース。
    env.connection.exec('UPDATE radar_tile SET byte_size = 1');
    env.connection.exec(
      "CREATE TRIGGER fail_tile BEFORE INSERT ON radar_tile BEGIN SELECT RAISE(FAIL, 'save failure'); END",
    );
    const before = storedRows(env.connection);
    await assert.rejects(env.service.fetchFrameTiles(FIX_FRAME, [FIX_COORDS[0]]), {
      message: 'save failure',
    });
    assert.deepStrictEqual(storedRows(env.connection), before);
    assert.deepStrictEqual(
      fs.readFileSync(path.join(env.tmpDir, first[0].tile!.filePath)),
      VALID_1X1_PNG,
    );
    t.mock.method(env.service.tileStore, 'deleteTileIfUnreferenced', async () => {
      throw new Error('cleanup failure');
    });
    await assert.rejects(
      env.service.fetchFrameTiles(FIX_FRAME, [FIX_COORDS[1]]),
      (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.deepStrictEqual(
          error.errors.map((e: Error) => e.message),
          ['save failure', 'cleanup failure'],
        );
        return true;
      },
    );
  } finally {
    t.mock.restoreAll();
    env.cleanup();
  }
});
