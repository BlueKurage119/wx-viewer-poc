import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase, runMigrations } from '../src/database/index.js';
import {
  fetchPngBinary,
  KikikuruTileStore,
  validatePngBuffer,
} from '../src/polling/kikikuruTileStore.js';
import { saveRiskSnapshot } from '../src/repositories/riskRepository.js';

const VALID_1X1_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const VALID_1X1_PNG = Buffer.from(VALID_1X1_PNG_BASE64, 'base64');
const EXPECTED_HASH = '6b7fa434f92a8b80aab02d9bf1a12e49ffcae424e4013a1c4f68b67e3d2bbcd0';

function setupTestEnv() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kikikuru-tilestore-test-'));
  const connection = openDatabase(':memory:');
  const migrationsDir = path.join(import.meta.dirname, '../migrations');
  runMigrations(connection, migrationsDir);

  const cleanup = () => {
    connection.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };

  return { tmpDir, connection, cleanup };
}

test('1. 既知 PNG バイト列の取得・検証・保存、ファイル内容と byteSize/hash の完全一致。不正 PNG は保存拒否', async () => {
  const { tmpDir, cleanup } = setupTestEnv();
  try {
    const store = new KikikuruTileStore(tmpDir);

    // 正常 PNG の検証
    const validRes = validatePngBuffer(VALID_1X1_PNG);
    assert.strictEqual(validRes.ok, true);
    assert.strictEqual(validRes.errorKind, null);

    // 保存
    const relPath =
      'risk/heavyrain/20260907030000/immed0/20260907030000/rain_mesh/10/909/404/sample.png';
    const saveRes = await store.saveTile(relPath, VALID_1X1_PNG);
    assert.strictEqual(saveRes.byteSize, VALID_1X1_PNG.byteLength);
    assert.strictEqual(saveRes.contentHash, EXPECTED_HASH);
    assert.strictEqual(fs.existsSync(saveRes.fullPath), true);
    assert.deepStrictEqual(fs.readFileSync(saveRes.fullPath), VALID_1X1_PNG);

    // 不正 PNG (空バッファ)
    const emptyBuf = Buffer.alloc(0);
    assert.strictEqual(validatePngBuffer(emptyBuf).ok, false);
    assert.strictEqual(validatePngBuffer(emptyBuf).errorKind, 'invalid_png');
    await assert.rejects(store.saveTile('risk/heavyrain/test/empty.png', emptyBuf), {
      message: /Invalid PNG/,
    });

    // 不正 PNG (HTML 本文)
    const htmlBuf = Buffer.from('<html><body>404 Not Found</body></html>');
    assert.strictEqual(validatePngBuffer(htmlBuf).ok, false);
    assert.strictEqual(validatePngBuffer(htmlBuf).errorKind, 'invalid_png');
    await assert.rejects(store.saveTile('risk/heavyrain/test/html.png', htmlBuf), {
      message: /Invalid PNG/,
    });

    // 不正 PNG (途中で切断されたバッファ)
    const truncatedBuf = VALID_1X1_PNG.subarray(0, 16);
    assert.strictEqual(validatePngBuffer(truncatedBuf).ok, false);
    assert.strictEqual(validatePngBuffer(truncatedBuf).errorKind, 'invalid_png');
    await assert.rejects(store.saveTile('risk/heavyrain/test/trunc.png', truncatedBuf), {
      message: /Invalid PNG/,
    });
  } finally {
    cleanup();
  }
});

test('2. ファイル欠損・改変の検出、ディレクトリトラバーサルの拒否、fetchPngBinary のタイムアウト・HTTP エラー', async () => {
  const { tmpDir, cleanup } = setupTestEnv();
  try {
    const store = new KikikuruTileStore(tmpDir);
    const relPath = 'risk/inund/20260907030000/none/20260907032000/inund/10/909/404/tile.png';

    await store.saveTile(relPath, VALID_1X1_PNG);

    // 正常な検証
    const verified = await store.verifyTile(relPath, VALID_1X1_PNG.byteLength, EXPECTED_HASH);
    assert.strictEqual(verified.valid, true);
    assert.deepStrictEqual(verified.buffer, VALID_1X1_PNG);

    // ファイル欠損の検出
    const missing = await store.verifyTile(
      'risk/inund/nonexistent.png',
      VALID_1X1_PNG.byteLength,
      EXPECTED_HASH,
    );
    assert.strictEqual(missing.valid, false);

    // サイズ改変の検出
    const wrongSize = await store.verifyTile(relPath, VALID_1X1_PNG.byteLength + 1, EXPECTED_HASH);
    assert.strictEqual(wrongSize.valid, false);

    // ハッシュ改変の検出
    const wrongHash = await store.verifyTile(
      relPath,
      VALID_1X1_PNG.byteLength,
      '0000000000000000000000000000000000000000000000000000000000000000',
    );
    assert.strictEqual(wrongHash.valid, false);

    // ディレクトリトラバーサル拒否
    assert.throws(
      () => {
        store.resolvePath('../outside.png');
      },
      { message: /parent directory traversal/ },
    );
    assert.throws(
      () => {
        store.resolvePath('/absolute/path.png');
      },
      { message: /absolute path is not allowed/ },
    );

    // fetchPngBinary の検証
    const fake404Fetch: typeof fetch = async () =>
      new Response('Not Found', { status: 404, statusText: 'Not Found' });
    const res404 = await fetchPngBinary('https://example.com/notfound.png', {
      fetchFn: fake404Fetch,
    });
    assert.strictEqual(res404.ok, false);
    assert.strictEqual(res404.errorKind, 'http_status');
    assert.strictEqual(res404.status, 404);
  } finally {
    cleanup();
  }
});

test('3. クリーンアップ: 一覧から消えたフレームの本体だけ削除され、参照中本体は残る。起動時の孤児・一時ファイル除去。sentinel保持', async () => {
  const { tmpDir, connection, cleanup } = setupTestEnv();
  try {
    const store = new KikikuruTileStore(tmpDir);

    // 外部 sentinel ファイル（cacheRoot 外）
    const sentinelOutside = path.join(tmpDir, 'sentinel_outside.txt');
    fs.writeFileSync(sentinelOutside, 'sentinel');

    // DB にスナップショットとタイルを登録
    const relPathRetained =
      'risk/land/20260907030000/immed0/20260907030000/land/10/909/404/hash1.png';
    const relPathDeleted =
      'risk/land/20260907030000/immed0/20260907031000/land/10/909/404/hash2.png';

    await store.saveTile(relPathRetained, VALID_1X1_PNG);
    await store.saveTile(relPathDeleted, VALID_1X1_PNG);

    // 残留一時ファイルと孤児ファイルを作成
    const tmpFile = path.join(tmpDir, 'risk/land/stray.tmp.12345');
    fs.writeFileSync(tmpFile, 'temp data');
    const orphanFile = path.join(tmpDir, 'risk/land/orphan.png');
    fs.writeFileSync(orphanFile, VALID_1X1_PNG);

    // DB には relPathRetained だけを登録
    saveRiskSnapshot(connection, {
      layer: 'land',
      metadata: {
        source: 'https://example.com/targetTimes.json',
        issuedAt: '2026-09-07T03:00:00.000Z',
        validAt: null,
        validFrom: '2026-09-07T03:00:00.000Z',
        validTo: '2026-09-07T03:00:00.000Z',
        fetchedAt: '2026-09-07T03:00:00.000Z',
        lastSuccessAt: '2026-09-07T03:00:00.000Z',
        availability: 'available',
        sourceVersion: 'ver1',
      },
      frames: [
        {
          baseTime: '2026-09-07T03:00:00.000Z',
          validTime: '2026-09-07T03:00:00.000Z',
          imageId: 'land',
          member: 'immed0',
          sequence: 0,
          tiles: [
            {
              zoom: 10,
              tileX: 909,
              tileY: 404,
              filePath: relPathRetained,
              byteSize: VALID_1X1_PNG.byteLength,
              contentHash: crypto.createHash('sha256').update(VALID_1X1_PNG).digest('hex'),
              storedAt: '2026-09-07T03:00:00.000Z',
            },
          ],
        },
      ],
    });

    // レイヤークリーンアップを実行
    await store.cleanLayerUnreferencedTiles(connection, 'land');

    // 参照中タイルは残る
    assert.strictEqual(fs.existsSync(path.join(tmpDir, relPathRetained)), true);
    // 非参照タイルは削除される
    assert.strictEqual(fs.existsSync(path.join(tmpDir, relPathDeleted)), false);
    // 孤児・一時ファイルも削除される
    assert.strictEqual(fs.existsSync(tmpFile), false);
    assert.strictEqual(fs.existsSync(orphanFile), false);
    // 外部 sentinel は残る
    assert.strictEqual(fs.existsSync(sentinelOutside), true);

    // 新たにゴミを作成し、起動時同期清掃を検証
    const strayTmp = path.join(tmpDir, 'risk/land/stray2.tmp.999');
    fs.writeFileSync(strayTmp, 'temp data 2');
    store.cleanOrphanAndTempFiles(connection);
    assert.strictEqual(fs.existsSync(strayTmp), false);
    assert.strictEqual(fs.existsSync(path.join(tmpDir, relPathRetained)), true);
  } finally {
    cleanup();
  }
});
