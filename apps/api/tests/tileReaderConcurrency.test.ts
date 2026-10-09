import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { NowcastService } from '../src/polling/nowcastService.js';
import { KikikuruService } from '../src/polling/kikikuruService.js';
import { NowcastTileStore } from '../src/polling/nowcastTileStore.js';
import { KikikuruTileStore } from '../src/polling/kikikuruTileStore.js';
import { mergeRadarSnapshot, upsertRadarTile } from '../src/repositories/radarRepository.js';
import { saveRiskSnapshot } from '../src/repositories/riskRepository.js';
import { initializeRoleDatabase, openWeatherReader } from '../src/database/roleDatabase.js';
import {
  createTemporaryTestDatabaseFixture,
  createTestDatabasePairConfig,
} from './helpers/databasePair.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
// 別の1x1 RGBA PNGを使用し、サイズとhashの異なる保存世代を作る。
const nextPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAD3RFWHRHZW5lcmF0aW9uAG5leHQ/AlBTAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64',
);
const now = '2026-10-09T00:00:00.000Z';
const coordinate = { zoom: 10, tileX: 1, tileY: 1 };
const relative = 'tile.png';
const metadata = {
  source: 'fixture',
  issuedAt: now,
  validAt: now,
  validFrom: now,
  validTo: now,
  fetchedAt: now,
  lastSuccessAt: now,
  availability: 'available' as const,
  sourceVersion: 'fixture',
};
const radarFrame = {
  product: 'N1' as const,
  baseTime: now,
  validTime: now,
  element: 'hrpns' as const,
  member: 'none' as const,
};
const riskFrame = {
  layer: 'heavyrain' as const,
  baseTime: now,
  validTime: now,
  imageId: 'rain_mesh' as const,
  member: 'none' as const,
};

async function setup(layer: 'nowcast' | 'kikikuru') {
  const fixture = createTemporaryTestDatabaseFixture();
  const pair = createTestDatabasePairConfig(fixture.config);
  const writer = initializeRoleDatabase(pair, {
    pid: process.pid,
    role: 'weather',
    token: 'tiles',
    startedAt: now,
    serverGenerationId: 'server',
    workerGeneration: 'worker',
    threadId: 1,
  });
  const root = path.join(path.dirname(fixture.config.databasePath), 'cache');
  const store = layer === 'nowcast' ? new NowcastTileStore(root) : new KikikuruTileStore(root);
  if (layer === 'nowcast')
    mergeRadarSnapshot(writer.connection, {
      product: 'N1',
      metadata,
      frames: [{ ...radarFrame, sequence: 0 }],
    });
  else
    saveRiskSnapshot(writer.connection, {
      layer: 'heavyrain',
      metadata,
      frames: [{ ...riskFrame, sequence: 0 }],
    });
  const write = async (buffer: Buffer) => {
    const saved = await store.saveTile(relative, buffer);
    const tile = {
      ...coordinate,
      filePath: relative,
      byteSize: saved.byteSize,
      contentHash: saved.contentHash,
      storedAt: now,
    };
    if (layer === 'nowcast') upsertRadarTile(writer.connection, radarFrame, tile);
    else
      saveRiskSnapshot(writer.connection, {
        layer: 'heavyrain',
        metadata,
        frames: [{ ...riskFrame, sequence: 0, tiles: [tile] }],
      });
  };
  await write(png);
  const orphan = path.join(root, 'orphan.png.tmp');
  fs.writeFileSync(orphan, png);
  const reader = openWeatherReader(pair.weather, writer.generation, writer.schemaVersion);
  const access = () => ({
    allowed: false,
    period: {
      start: '00:00',
      end: '24:00',
      xmlSeconds: 60,
      imageCatalogSeconds: 60,
      amedasSeconds: 60,
      nowcastEnabled: true,
      kikikuruEnabled: true,
    },
    nextAllowedAt: null,
  });
  const options = {
    cacheRoot: root,
    readOnly: true,
    allowedZooms: [10],
    getCatalogAccess: access,
    getImageAccess: access,
    freshnessPolicy: { staleAfterSeconds: 300 },
    clock: () => now,
    fetchFn: async () => {
      assert.fail('読取専用経路が上流通信しました');
    },
  };
  const service =
    layer === 'nowcast'
      ? new NowcastService(reader, options)
      : new KikikuruService(reader, options);
  return {
    store,
    reader,
    write,
    root,
    orphan,
    read: () =>
      service instanceof NowcastService
        ? service.readSavedTile(radarFrame, coordinate)
        : service.readSavedTile(riskFrame, coordinate),
    close() {
      reader.close();
      writer.close();
      fixture.cleanup();
    },
  };
}

function interceptOpen(
  t: TestContext,
  onOpen: (file: fs.promises.FileHandle, index: number) => Promise<void>,
) {
  const original = fs.promises.open.bind(fs.promises);
  let opened = 0;
  let closed = 0;
  t.mock.method(fs.promises, 'open', async (...args: Parameters<typeof fs.promises.open>) => {
    const file = await original(...args);
    const close = file.close.bind(file);
    t.mock.method(file, 'close', async () => {
      await close();
      closed++;
    });
    await onOpen(file, ++opened);
    return file;
  });
  return { opened: () => opened, closed: () => closed };
}

for (const layer of ['nowcast', 'kikikuru'] as const) {
  test(`${layer}: 8MiB超のstatをreadFile前に拒否する`, async (t) => {
    const f = await setup(layer);
    try {
      fs.writeFileSync(path.join(f.root, relative), Buffer.alloc(8 * 1024 * 1024 + 1));
      const originalOpen = fs.promises.open.bind(fs.promises);
      t.mock.method(fs.promises, 'open', async (...args: Parameters<typeof fs.promises.open>) => {
        const file = await originalOpen(...args);
        t.mock.method(file, 'readFile', async () => {
          assert.fail('過大statの後にreadFileを実行しました');
        });
        return file;
      });
      const verified = await f.store.verifyTile(
        relative,
        8 * 1024 * 1024 + 1,
        crypto.createHash('sha256').update(png).digest('hex'),
      );
      assert.deepEqual(verified, { valid: false, buffer: null });
    } finally {
      f.close();
    }
  });
  test(`${layer}: descriptor取得後のrename・unlinkで索引を再照合し、完全な新PNGまたは有限missを返す`, async (t) => {
    const f = await setup(layer);
    try {
      let phase: 'replace' | 'delete' | 'none' = 'replace';
      const io = interceptOpen(t, async () => {
        assert.equal(
          f.reader.inTransaction,
          false,
          '非同期ファイルIOをDBトランザクション内で待機しました',
        );
        if (phase === 'replace') {
          phase = 'none';
          await f.write(nextPng);
        } else if (phase === 'delete') {
          phase = 'none';
          await f.store.deleteTile(relative);
        }
      });
      assert.deepEqual((await f.read())?.buffer, nextPng);
      assert.deepEqual((await f.read())?.buffer, nextPng);
      phase = 'delete';
      assert.deepEqual((await f.read())?.buffer, nextPng);
      assert.equal(await f.read(), null);
      assert.equal(io.opened(), 4);
      assert.equal(io.closed(), 4);
      assert.deepEqual(fs.readFileSync(f.orphan), png, 'readonly起動または読取で清掃しました');
    } finally {
      f.close();
    }
  });

  test(`${layer}: metadata取得後にファイル世代が変わるとmetadataを再取得し1回だけ再試行する`, async (t) => {
    const f = await setup(layer);
    try {
      const original = fs.promises.open.bind(fs.promises);
      let attempts = 0;
      let closes = 0;
      t.mock.method(fs.promises, 'open', async (...args: Parameters<typeof fs.promises.open>) => {
        attempts++;
        if (attempts === 1) await f.write(nextPng);
        const file = await original(...args);
        const close = file.close.bind(file);
        t.mock.method(file, 'close', async () => {
          await close();
          closes++;
        });
        return file;
      });
      assert.deepEqual((await f.read())?.buffer, nextPng);
      assert.equal(attempts, 2);
      assert.equal(closes, 2);
      // 同じサイズでhashだけ異なる破損は、無限補完せず2回でmissへ戻す。
      const corrupt = Buffer.from(nextPng);
      corrupt[0] = 0;
      fs.writeFileSync(path.join(f.root, relative), corrupt);
      attempts = 2;
      assert.equal(await f.read(), null);
      assert.equal(attempts, 4);
      assert.equal(closes, 4);
      assert.notEqual(
        crypto.createHash('sha256').update(corrupt).digest('hex'),
        crypto.createHash('sha256').update(nextPng).digest('hex'),
      );
    } finally {
      f.close();
    }
  });

  test(`${layer}: descriptor読取直後の索引差替え・削除でも旧bytesを公開せず必ずcloseする`, async (t) => {
    const f = await setup(layer);
    try {
      const originalOpen = fs.promises.open.bind(fs.promises);
      let phase: 'replace' | 'delete' | 'none' = 'replace';
      let opens = 0;
      let closes = 0;
      t.mock.method(fs.promises, 'open', async (...args: Parameters<typeof fs.promises.open>) => {
        const file = await originalOpen(...args);
        opens++;
        const readFile = file.readFile.bind(file);
        const close = file.close.bind(file);
        t.mock.method(file, 'readFile', async () => {
          const bytes = await readFile();
          if (phase === 'replace') {
            phase = 'none';
            await f.write(nextPng);
          } else if (phase === 'delete') {
            phase = 'none';
            await f.write(png);
            await f.store.deleteTile(relative);
          }
          return bytes;
        });
        t.mock.method(file, 'close', async () => {
          await close();
          closes++;
        });
        return file;
      });
      assert.deepEqual((await f.read())?.buffer, nextPng);
      assert.equal(opens, 2);
      assert.equal(closes, 2);
      phase = 'delete';
      assert.equal(await f.read(), null);
      assert.equal(opens, 3);
      assert.equal(closes, 3);
    } finally {
      f.close();
    }
  });

  test(`${layer}: byteSize・SHA-256・PNGの各不一致をsuccessにせずdescriptorを閉じる`, async (t) => {
    const f = await setup(layer);
    try {
      const io = interceptOpen(t, async () => {});
      const hash = crypto.createHash('sha256').update(png).digest('hex');
      assert.deepEqual(await f.store.verifyTile(relative, png.byteLength + 1, hash), {
        valid: false,
        buffer: null,
      });
      assert.deepEqual(await f.store.verifyTile(relative, png.byteLength, '0'.repeat(64)), {
        valid: false,
        buffer: null,
      });
      const invalid = Buffer.alloc(png.byteLength, 0);
      fs.writeFileSync(path.join(f.root, relative), invalid);
      assert.deepEqual(
        await f.store.verifyTile(
          relative,
          invalid.byteLength,
          crypto.createHash('sha256').update(invalid).digest('hex'),
        ),
        { valid: false, buffer: null },
      );
      assert.equal(io.opened(), 3);
      assert.equal(io.closed(), 3);
    } finally {
      f.close();
    }
  });
}
