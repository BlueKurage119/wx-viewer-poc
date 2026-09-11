import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase, runMigrations } from '../src/database/index.js';
import {
  fetchPngBinary,
  NowcastTileStore,
  validatePngBuffer,
} from '../src/polling/nowcastTileStore.js';
import {
  findRadarSnapshot,
  mergeRadarSnapshot,
  upsertRadarTile,
} from '../src/repositories/radarRepository.js';
import type { NowcastFrameKey, RadarSnapshotInput } from '../src/repositories/types.js';

// 有効な 1x1 透明 PNG バイト列（Base64）
const VALID_1X1_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const VALID_1X1_PNG = Buffer.from(VALID_1X1_PNG_BASE64, 'base64');
const EXPECTED_BYTE_SIZE = VALID_1X1_PNG.byteLength; // 68 bytes
const EXPECTED_HASH = crypto.createHash('sha256').update(VALID_1X1_PNG).digest('hex');

test('1. 既知 PNG バイト列を取得し保存ファイルと完全一致、DB byteSize／hash も期待定数と一致。空・HTML・途中切断した PNG は保存されず invalid_png', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nowcast-store-test-1-'));
  try {
    const store = new NowcastTileStore(tmpDir);

    // fake fetch による取得
    const fakeFetch: typeof fetch = async (url) => {
      assert.strictEqual(url, 'https://example.com/tile.png');
      return new Response(VALID_1X1_PNG, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    };

    const fetchResult = await fetchPngBinary('https://example.com/tile.png', {
      fetchFn: fakeFetch,
    });
    assert.strictEqual(fetchResult.ok, true);
    assert.strictEqual(fetchResult.status, 200);
    assert.notStrictEqual(fetchResult.buffer, null);
    assert.deepStrictEqual(fetchResult.buffer, VALID_1X1_PNG);
    assert.strictEqual(fetchResult.responseBytes, EXPECTED_BYTE_SIZE);

    // 保存
    const relPath = 'radar/N1/20260907030000/20260907030500/10/909/404/sample.png';
    const saveResult = await store.saveTile(relPath, fetchResult.buffer!);
    assert.strictEqual(saveResult.byteSize, EXPECTED_BYTE_SIZE);
    assert.strictEqual(saveResult.contentHash, EXPECTED_HASH);

    // ファイル実体との完全一致
    const savedBytes = fs.readFileSync(saveResult.fullPath);
    assert.deepStrictEqual(savedBytes, VALID_1X1_PNG);

    // 検証
    const verifyResult = await store.verifyTile(relPath, EXPECTED_BYTE_SIZE, EXPECTED_HASH);
    assert.strictEqual(verifyResult.valid, true);
    assert.deepStrictEqual(verifyResult.buffer, VALID_1X1_PNG);

    // 空バッファ
    const emptyValidation = validatePngBuffer(Buffer.alloc(0));
    assert.strictEqual(emptyValidation.ok, false);
    assert.strictEqual(emptyValidation.errorKind, 'invalid_png');
    await assert.rejects(async () => {
      await store.saveTile('radar/N1/invalid_empty.png', Buffer.alloc(0));
    }, /Invalid PNG: Buffer too small/);

    // HTML バッファ
    const htmlBuffer = Buffer.from('<!DOCTYPE html><html><body>404 Not Found</body></html>');
    const htmlValidation = validatePngBuffer(htmlBuffer);
    assert.strictEqual(htmlValidation.ok, false);
    assert.strictEqual(htmlValidation.errorKind, 'invalid_png');
    await assert.rejects(async () => {
      await store.saveTile('radar/N1/invalid_html.png', htmlBuffer);
    }, /Invalid PNG: Invalid PNG signature/);

    // 途中切断した PNG（署名とIHDRのみ、IDAT/IEND欠損）
    const truncatedBuffer = VALID_1X1_PNG.subarray(0, 33);
    const truncatedValidation = validatePngBuffer(truncatedBuffer);
    assert.strictEqual(truncatedValidation.ok, false);
    assert.strictEqual(truncatedValidation.errorKind, 'invalid_png');
    await assert.rejects(async () => {
      await store.saveTile('radar/N1/invalid_trunc.png', truncatedBuffer);
    }, /Invalid PNG/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('2. ファイル欠損・改変の検出、書き込み障害時の後始末、トラバーサル拒否', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nowcast-store-test-2-'));
  try {
    const store = new NowcastTileStore(tmpDir);
    const relPath = 'radar/N1/20260907030000/20260907030500/10/909/404/sample.png';

    await store.saveTile(relPath, VALID_1X1_PNG);
    const fullPath = store.resolvePath(relPath);

    // 1. ファイル改変（1バイト書き換え）
    const modifiedBytes = Buffer.from(VALID_1X1_PNG);
    modifiedBytes[modifiedBytes.length - 1] ^= 0xff;
    fs.writeFileSync(fullPath, modifiedBytes);

    const verifyModified = await store.verifyTile(relPath, EXPECTED_BYTE_SIZE, EXPECTED_HASH);
    assert.strictEqual(verifyModified.valid, false);
    assert.strictEqual(verifyModified.buffer, null);

    // 2. ファイル欠損（削除）
    fs.unlinkSync(fullPath);
    const verifyDeleted = await store.verifyTile(relPath, EXPECTED_BYTE_SIZE, EXPECTED_HASH);
    assert.strictEqual(verifyDeleted.valid, false);
    assert.strictEqual(verifyDeleted.buffer, null);

    // 3. パストラバーサル防止
    assert.throws(() => {
      store.resolvePath('../outside.png');
    }, /parent directory traversal is not allowed|Directory traversal detected/);

    // 4. HTTP エラー・タイムアウトの fetchPngBinary 判定
    const notFoundFetch: typeof fetch = async () =>
      new Response('Not Found', { status: 404, statusText: 'Not Found' });
    const res404 = await fetchPngBinary('https://example.com/404.png', { fetchFn: notFoundFetch });
    assert.strictEqual(res404.ok, false);
    assert.strictEqual(res404.status, 404);
    assert.strictEqual(res404.errorKind, 'http_status');

    const serverErrFetch: typeof fetch = async () =>
      new Response('Server Error', { status: 500, statusText: 'Internal Error' });
    const res500 = await fetchPngBinary('https://example.com/500.png', { fetchFn: serverErrFetch });
    assert.strictEqual(res500.ok, false);
    assert.strictEqual(res500.status, 500);
    assert.strictEqual(res500.errorKind, 'http_status');

    const timeoutFetch: typeof fetch = async () => {
      const err = new DOMException('Timeout', 'TimeoutError');
      throw err;
    };
    const resTimeout = await fetchPngBinary('https://example.com/timeout.png', {
      fetchFn: timeoutFetch,
    });
    assert.strictEqual(resTimeout.ok, false);
    assert.strictEqual(resTimeout.status, null);
    assert.strictEqual(resTimeout.errorKind, 'timeout');

    const networkFetch: typeof fetch = async () => {
      throw new Error('Connection refused');
    };
    const resNetwork = await fetchPngBinary('https://example.com/network.png', {
      fetchFn: networkFetch,
    });
    assert.strictEqual(resNetwork.ok, false);
    assert.strictEqual(resNetwork.status, null);
    assert.strictEqual(resNetwork.errorKind, 'network');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('3. 一覧から消えたフレームの本体だけ削除され、参照中・stale 保持本体は残る。再生成時に孤児・一時ファイルが除去される。cacheRoot 外の sentinel は変更されない', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nowcast-store-test-3-'));
  const sentinelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nowcast-sentinel-'));
  const sentinelPath = path.join(sentinelDir, 'sentinel.txt');
  fs.writeFileSync(sentinelPath, 'SENTINEL_CONTENT');

  const connection = openDatabase(':memory:');
  const migrationsDir = path.join(import.meta.dirname, '../migrations');
  runMigrations(connection, migrationsDir);

  try {
    const store = new NowcastTileStore(tmpDir);

    // Frame 1: 03:00:00 (保持される)
    // Frame 2: 03:05:00 (次の更新で消える)
    const initialInput: RadarSnapshotInput = {
      product: 'N1',
      metadata: {
        source: 'https://example.com/N1.json',
        issuedAt: '2026-09-07T03:00:00.000Z',
        validAt: null,
        validFrom: '2026-09-07T03:00:00.000Z',
        validTo: '2026-09-07T03:05:00.000Z',
        fetchedAt: '2026-09-07T03:00:00.000Z',
        lastSuccessAt: '2026-09-07T03:00:00.000Z',
        availability: 'available',
        sourceVersion: 'hash1',
      },
      frames: [
        {
          baseTime: '2026-09-07T03:00:00.000Z',
          validTime: '2026-09-07T03:00:00.000Z',
          element: 'hrpns',
          member: 'none',
          sequence: 0,
        },
        {
          baseTime: '2026-09-07T03:00:00.000Z',
          validTime: '2026-09-07T03:05:00.000Z',
          element: 'hrpns',
          member: 'none',
          sequence: 1,
        },
      ],
    };

    mergeRadarSnapshot(connection, initialInput);

    // 各フレームにタイルを保存
    const relPath1 = 'radar/N1/20260907030000/20260907030000/10/909/404/tile1.png';
    const relPath2 = 'radar/N1/20260907030000/20260907030500/10/909/404/tile2.png';

    await store.saveTile(relPath1, VALID_1X1_PNG);
    await store.saveTile(relPath2, VALID_1X1_PNG);

    const frameKey1: NowcastFrameKey = {
      product: 'N1',
      baseTime: '2026-09-07T03:00:00.000Z',
      validTime: '2026-09-07T03:00:00.000Z',
      element: 'hrpns',
      member: 'none',
    };
    const frameKey2: NowcastFrameKey = {
      product: 'N1',
      baseTime: '2026-09-07T03:00:00.000Z',
      validTime: '2026-09-07T03:05:00.000Z',
      element: 'hrpns',
      member: 'none',
    };

    upsertRadarTile(connection, frameKey1, {
      zoom: 10,
      tileX: 909,
      tileY: 404,
      filePath: relPath1,
      byteSize: EXPECTED_BYTE_SIZE,
      contentHash: EXPECTED_HASH,
      storedAt: '2026-09-07T03:00:00.000Z',
    });

    upsertRadarTile(connection, frameKey2, {
      zoom: 10,
      tileX: 909,
      tileY: 404,
      filePath: relPath2,
      byteSize: EXPECTED_BYTE_SIZE,
      contentHash: EXPECTED_HASH,
      storedAt: '2026-09-07T03:00:00.000Z',
    });

    // 孤児ファイルと一時ファイルを手動で配置
    const orphanPath = path.join(tmpDir, 'radar/N1/orphan.png');
    fs.mkdirSync(path.dirname(orphanPath), { recursive: true });
    fs.writeFileSync(orphanPath, VALID_1X1_PNG);

    const tmpFilePath = path.join(tmpDir, 'radar/N1/sample.png.tmp.uuid123');
    fs.writeFileSync(tmpFilePath, VALID_1X1_PNG);

    // 次の一覧更新: Frame 2 が消え、Frame 1 だけになる
    const updatedInput: RadarSnapshotInput = {
      product: 'N1',
      metadata: {
        source: 'https://example.com/N1.json',
        issuedAt: '2026-09-07T03:05:00.000Z',
        validAt: null,
        validFrom: '2026-09-07T03:00:00.000Z',
        validTo: '2026-09-07T03:00:00.000Z',
        fetchedAt: '2026-09-07T03:05:00.000Z',
        lastSuccessAt: '2026-09-07T03:05:00.000Z',
        availability: 'available',
        sourceVersion: 'hash2',
      },
      frames: [
        {
          baseTime: '2026-09-07T03:00:00.000Z',
          validTime: '2026-09-07T03:00:00.000Z',
          element: 'hrpns',
          member: 'none',
          sequence: 0,
        },
      ],
    };

    mergeRadarSnapshot(connection, updatedInput);

    // DB 上、Frame 2 が消えたことを確認
    const snap = findRadarSnapshot(connection, 'N1');
    assert.strictEqual(snap?.frames.length, 1);
    assert.strictEqual(snap?.frames[0].validTime, '2026-09-07T03:00:00.000Z');

    // クリーンアップ実行
    await store.cleanProductUnreferencedTiles(connection, 'N1');

    // Frame 1 の本体は残っている
    assert.strictEqual(fs.existsSync(store.resolvePath(relPath1)), true);
    // Frame 2 の本体（消えたフレーム）は削除されている
    assert.strictEqual(fs.existsSync(store.resolvePath(relPath2)), false);
    // 孤児ファイル・一時ファイルも掃除されている
    assert.strictEqual(fs.existsSync(orphanPath), false);
    assert.strictEqual(fs.existsSync(tmpFilePath), false);

    // 起動時全クリーンアップの検証
    // 新たに孤児ファイルと一時ファイルを作成
    const orphan2 = path.join(tmpDir, 'radar/orphan2.png');
    fs.writeFileSync(orphan2, VALID_1X1_PNG);
    const tmp2 = path.join(tmpDir, 'radar/test.png.tmp.456');
    fs.writeFileSync(tmp2, VALID_1X1_PNG);

    await store.cleanOrphanAndTempFiles(connection);
    assert.strictEqual(fs.existsSync(orphan2), false);
    assert.strictEqual(fs.existsSync(tmp2), false);
    assert.strictEqual(fs.existsSync(store.resolvePath(relPath1)), true);

    // sentinel ファイルは一切変更されない
    assert.strictEqual(fs.existsSync(sentinelPath), true);
    assert.strictEqual(fs.readFileSync(sentinelPath, 'utf-8'), 'SENTINEL_CONTENT');
  } finally {
    connection.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(sentinelDir, { recursive: true, force: true });
  }
});
