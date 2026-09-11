import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
const EXPECTED_HASH = crypto.createHash('sha256').update(VALID_1X1_PNG).digest('hex');

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
