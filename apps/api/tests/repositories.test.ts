import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeDatabase, type DatabaseContext } from '../src/database/index.js';
import {
  saveWarningCurrentSnapshot,
  findWarningCurrentSnapshot,
  deleteWarningCurrentSnapshot,
  saveWarningTimeseriesSnapshot,
  findWarningTimeseriesSnapshot,
  deleteWarningTimeseriesSnapshot,
  saveEarlyWarningSnapshot,
  findEarlyWarningSnapshot,
  deleteEarlyWarningSnapshot,
  saveAreaTimeseriesSnapshot,
  findAreaTimeseriesSnapshot,
  deleteAreaTimeseriesSnapshot,
  saveRadarSnapshot,
  findRadarSnapshot,
  deleteRadarSnapshot,
  saveRiskSnapshot,
  findRiskSnapshot,
  deleteRiskSnapshot,
  saveAmedasSnapshot,
  findAmedasSnapshot,
  deleteAmedasSnapshot,
  saveBosaiBulletin,
  findBosaiBulletin,
  listBosaiBulletins,
  deleteBosaiBulletin,
} from '../src/repositories/index.js';
import type { SnapshotMetadataInput, TelegramMetadataInput } from '../src/repositories/types.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

function setupTestDb(): { context: DatabaseContext; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-repo-test-'));
  const databasePath = join(directory, 'test.sqlite3');
  const context = initializeDatabase({
    databasePath,
    migrationsDirectory,
  });
  return {
    context,
    cleanup: () => {
      context.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

const sampleMetadata: SnapshotMetadataInput = {
  source: 'jma_xml',
  issuedAt: '2026-09-09T00:00:00Z',
  validAt: null,
  validFrom: null,
  validTo: null,
  fetchedAt: '2026-09-09T00:05:00Z',
  lastSuccessAt: null,
  availability: 'available',
  sourceVersion: null,
};

const sampleTelegram: TelegramMetadataInput = {
  controlStatus: 'normal',
  infoType: '発表',
  eventId: '20260909000000_0_VPWW55_130000',
  reportDateTime: '2026-09-09T00:00:00Z',
  controlDateTime: '2026-09-09T00:00:00Z',
};

test('1. 現況警報 (WarningCurrent): CRUD, 置き換え, 訓練分離, 明細0件', () => {
  const { context, cleanup } = setupTestDb();
  try {
    // 1-1. 保存と完全一致の取得
    const saved = saveWarningCurrentSnapshot(context.connection, {
      areaCode: '1310800',
      areaName: '江東区',
      metadata: sampleMetadata,
      telegram: sampleTelegram,
      items: [
        {
          sequence: 1,
          kindCode: '03',
          kindName: '大雨警報',
          kindStatus: '発表',
          lastKindCode: null,
          lastKindName: null,
          significancyCode: '2',
          significancyName: '警報',
          warningLevel: '3',
          attentionText: '土砂災害に注意',
          kindIssuedAt: '2026-09-09T00:00:00Z',
          sourceTelegram: 'VPWW55',
        },
      ],
    });

    assert.ok(saved.id > 0);
    assert.equal(saved.items.length, 1);
    assert.equal(saved.items[0].kindCode, '03');

    const found = findWarningCurrentSnapshot(context.connection, '1310800', 'normal');
    assert.ok(found);
    assert.equal(found.id, saved.id);
    assert.equal(found.areaCode, '1310800');
    assert.equal(found.areaName, '江東区');
    assert.deepEqual(found.metadata, sampleMetadata);
    assert.deepEqual(found.telegram, sampleTelegram);
    assert.equal(found.items.length, 1);
    assert.equal(found.items[0].kindCode, '03');
    assert.equal(found.items[0].warningLevel, '3');

    // 1-2. 置き換え（同キーで新発表を保存すると親ID維持で明細が総入れ替え）
    const updated = saveWarningCurrentSnapshot(context.connection, {
      areaCode: '1310800',
      areaName: '江東区',
      metadata: { ...sampleMetadata, issuedAt: '2026-09-09T01:00:00Z' },
      telegram: { ...sampleTelegram, reportDateTime: '2026-09-09T01:00:00Z' },
      items: [
        {
          sequence: 1,
          kindCode: '05',
          kindName: '洪水警報',
          kindStatus: '発表',
          lastKindCode: null,
          lastKindName: null,
          significancyCode: '2',
          significancyName: '警報',
          warningLevel: '3',
          attentionText: null,
          kindIssuedAt: '2026-09-09T01:00:00Z',
          sourceTelegram: 'VPWW55',
        },
      ],
    });

    assert.equal(updated.id, saved.id, '親スナップショット行のIDは維持されること');
    const foundUpdated = findWarningCurrentSnapshot(context.connection, '1310800', 'normal');
    assert.ok(foundUpdated);
    assert.equal(foundUpdated.items.length, 1);
    assert.equal(
      foundUpdated.items[0].kindCode,
      '05',
      '古い明細は削除され新しい明細だけになること',
    );

    // 1-3. 訓練分離 (controlStatus='training' の保存が normal に影響しない)
    saveWarningCurrentSnapshot(context.connection, {
      areaCode: '1310800',
      areaName: '江東区',
      metadata: sampleMetadata,
      telegram: { ...sampleTelegram, controlStatus: 'training' },
      items: [
        {
          sequence: 1,
          kindCode: '04',
          kindName: '大雨特別警報',
          kindStatus: '発表',
          lastKindCode: null,
          lastKindName: null,
          significancyCode: '1',
          significancyName: '特別警報',
          warningLevel: '5',
          attentionText: null,
          kindIssuedAt: '2026-09-09T00:00:00Z',
          sourceTelegram: 'VPWW55',
        },
      ],
    });

    const normalAgain = findWarningCurrentSnapshot(context.connection, '1310800', 'normal');
    assert.ok(normalAgain);
    assert.equal(normalAgain.items[0].kindCode, '05');

    const training = findWarningCurrentSnapshot(context.connection, '1310800', 'training');
    assert.ok(training);
    assert.equal(training.items[0].kindCode, '04');

    // 1-3-2. stale 時の明細維持（空配列を渡しても既存明細が残る）
    const staleSaved = saveWarningCurrentSnapshot(context.connection, {
      areaCode: '1310800',
      areaName: '江東区',
      metadata: { ...sampleMetadata, availability: 'stale', fetchedAt: '2026-09-09T02:00:00Z' },
      telegram: { ...sampleTelegram, reportDateTime: '2026-09-09T01:00:00Z' },
      items: [],
    });
    assert.equal(staleSaved.metadata.availability, 'stale');
    assert.equal(staleSaved.items.length, 1);
    assert.equal(staleSaved.items[0].kindCode, '05');

    const foundStale = findWarningCurrentSnapshot(context.connection, '1310800', 'normal');
    assert.ok(foundStale);
    assert.equal(foundStale.metadata.availability, 'stale');
    assert.equal(foundStale.metadata.fetchedAt, '2026-09-09T02:00:00Z');
    assert.equal(foundStale.items.length, 1);
    assert.equal(foundStale.items[0].kindCode, '05');

    // 1-4. 明細0件かつ availability='available'（警報なしの正常状態）
    saveWarningCurrentSnapshot(context.connection, {
      areaCode: '1310800',
      areaName: '江東区',
      metadata: sampleMetadata,
      telegram: sampleTelegram,
      items: [],
    });

    const foundEmpty = findWarningCurrentSnapshot(context.connection, '1310800', 'normal');
    assert.ok(foundEmpty, 'スナップショットは存在する');
    assert.equal(foundEmpty.items.length, 0, '明細0件で取得できる');
    assert.equal(foundEmpty.metadata.availability, 'available');

    // 1-5. 削除
    const deleted = deleteWarningCurrentSnapshot(context.connection, '1310800', 'normal');
    assert.equal(deleted, true);
    assert.equal(findWarningCurrentSnapshot(context.connection, '1310800', 'normal'), null);
    // training は残っていること
    assert.ok(findWarningCurrentSnapshot(context.connection, '1310800', 'training'));
  } finally {
    cleanup();
  }
});

test('2. 警報等時系列 (WarningTimeseries): block_id による timeId 衝突防止, stale 時の明細維持', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const saved = saveWarningTimeseriesSnapshot(context.connection, {
      areaCode: '1310800',
      areaName: '江東区',
      metadata: sampleMetadata,
      telegram: sampleTelegram,
      timeDefines: [
        {
          blockId: 'block_rain',
          timeId: '1',
          sequence: 1,
          timeFrom: '2026-09-09T00:00:00Z',
          timeTo: '2026-09-09T03:00:00Z',
          duration: 'PT3H',
        },
        {
          blockId: 'block_wind',
          timeId: '1', // 同一 timeId '1' が別ブロックで共存
          sequence: 1,
          timeFrom: '2026-09-09T00:00:00Z',
          timeTo: '2026-09-09T06:00:00Z',
          duration: 'PT6H',
        },
      ],
      values: [
        {
          blockId: 'block_rain',
          refId: '1',
          kindCode: '03',
          kindName: '大雨警報',
          kindStatus: '継続',
          valueCategory: 'risk',
          propertyType: '雨',
          valueType: '警報級',
          valueText: '警報',
          unit: null,
          areaDivision: null,
          sequence: 1,
        },
        {
          blockId: 'block_wind',
          refId: '1',
          kindCode: '02',
          kindName: '暴風警報',
          kindStatus: '発表',
          valueCategory: 'quantity',
          propertyType: '風',
          valueType: '最大風速',
          valueText: '20',
          unit: 'm/s',
          areaDivision: '陸上',
          sequence: 1,
        },
      ],
    });

    assert.ok(saved.id > 0);
    assert.equal(saved.timeDefines.length, 2);
    assert.equal(saved.values.length, 2);

    const found = findWarningTimeseriesSnapshot(context.connection, '1310800', 'normal');
    assert.ok(found);
    assert.equal(found.timeDefines.length, 2);
    assert.equal(found.values.length, 2);
    assert.equal(found.values[0].blockId, 'block_rain');
    assert.equal(found.values[1].blockId, 'block_wind');
    assert.equal(found.values[1].valueText, '20');

    // stale で保存しても明細が保持されること（空配列を渡しても既存明細が残る）
    const staleSaved = saveWarningTimeseriesSnapshot(context.connection, {
      areaCode: '1310800',
      areaName: '江東区',
      metadata: { ...found.metadata, availability: 'stale', fetchedAt: '2026-09-09T01:00:00Z' },
      telegram: found.telegram,
      timeDefines: [],
      values: [],
    });
    assert.equal(staleSaved.metadata.availability, 'stale');
    assert.equal(staleSaved.timeDefines.length, 2);
    assert.equal(staleSaved.values.length, 2);

    const foundStale = findWarningTimeseriesSnapshot(context.connection, '1310800', 'normal');
    assert.ok(foundStale);
    assert.equal(foundStale.metadata.availability, 'stale');
    assert.equal(foundStale.metadata.fetchedAt, '2026-09-09T01:00:00Z');
    assert.equal(foundStale.timeDefines.length, 2);
    assert.equal(foundStale.values.length, 2);

    // 削除
    const deleted = deleteWarningTimeseriesSnapshot(context.connection, '1310800', 'normal');
    assert.equal(deleted, true);
    assert.equal(findWarningTimeseriesSnapshot(context.connection, '1310800', 'normal'), null);
  } finally {
    cleanup();
  }
});

test('3. 早期注意情報 (EarlyWarning): near / far の独立性, 「なし」と「値なし」の区別', () => {
  const { context, cleanup } = setupTestDb();
  try {
    // 3-1. near 保存 (rank_value='なし', condition=null)
    saveEarlyWarningSnapshot(context.connection, {
      areaCode: '130010',
      areaName: '東京地方',
      segment: 'near',
      telegramType: 'VPFD61',
      metadata: sampleMetadata,
      telegram: sampleTelegram,
      timeDefines: [
        {
          timeId: '1',
          sequence: 1,
          timeFrom: '2026-09-09T00:00:00Z',
          timeTo: '2026-09-10T00:00:00Z',
          duration: null,
        },
      ],
      cells: [
        {
          refId: '1',
          phenomenonCode: 'rain',
          phenomenonName: '大雨',
          rankValue: 'なし',
          condition: null,
        },
      ],
    });

    // 3-2. far 保存 (rank_value=null, condition='値なし')
    saveEarlyWarningSnapshot(context.connection, {
      areaCode: '130010',
      areaName: '東京地方',
      segment: 'far',
      telegramType: 'VPFW60',
      metadata: sampleMetadata,
      telegram: sampleTelegram,
      timeDefines: [
        {
          timeId: '1',
          sequence: 1,
          timeFrom: '2026-09-11T00:00:00Z',
          timeTo: '2026-09-12T00:00:00Z',
          duration: null,
        },
      ],
      cells: [
        {
          refId: '1',
          phenomenonCode: 'snow',
          phenomenonName: '大雪',
          rankValue: null,
          condition: '値なし',
        },
      ],
    });

    const near = findEarlyWarningSnapshot(context.connection, '130010', 'near', 'normal');
    assert.ok(near);
    assert.equal(near.cells.length, 1);
    assert.equal(near.cells[0].rankValue, 'なし');
    assert.equal(near.cells[0].condition, null);

    const far = findEarlyWarningSnapshot(context.connection, '130010', 'far', 'normal');
    assert.ok(far);
    assert.equal(far.cells.length, 1);
    assert.equal(far.cells[0].rankValue, null);
    assert.equal(far.cells[0].condition, '値なし');

    // 3-3. stale 時の明細維持（空配列を渡しても既存明細が残る）
    const staleSaved = saveEarlyWarningSnapshot(context.connection, {
      areaCode: '130010',
      areaName: '東京地方',
      segment: 'near',
      telegramType: 'VPFD61',
      metadata: { ...sampleMetadata, availability: 'stale', fetchedAt: '2026-09-09T01:00:00Z' },
      telegram: sampleTelegram,
      timeDefines: [],
      cells: [],
    });
    assert.equal(staleSaved.metadata.availability, 'stale');
    assert.equal(staleSaved.cells.length, 1);

    const foundNearStale = findEarlyWarningSnapshot(context.connection, '130010', 'near', 'normal');
    assert.ok(foundNearStale);
    assert.equal(foundNearStale.metadata.availability, 'stale');
    assert.equal(foundNearStale.metadata.fetchedAt, '2026-09-09T01:00:00Z');
    assert.equal(foundNearStale.cells.length, 1);
    assert.equal(foundNearStale.cells[0].rankValue, 'なし');

    // near の削除が far に影響しない
    deleteEarlyWarningSnapshot(context.connection, '130010', 'near', 'normal');
    assert.equal(findEarlyWarningSnapshot(context.connection, '130010', 'near', 'normal'), null);
    assert.ok(findEarlyWarningSnapshot(context.connection, '130010', 'far', 'normal'));
  } finally {
    cleanup();
  }
});

test('4. 地域時系列予報 (AreaTimeseries): block_id による天気・風・気温の分離', () => {
  const { context, cleanup } = setupTestDb();
  try {
    saveAreaTimeseriesSnapshot(context.connection, {
      areaCode: '130010',
      areaName: '東京地方',
      stationCode: '44132',
      stationName: '東京',
      metadata: sampleMetadata,
      telegram: sampleTelegram,
      timeDefines: [
        {
          blockId: 'weather',
          timeId: '1',
          sequence: 1,
          timeFrom: '2026-09-09T00:00:00Z',
          timeTo: '2026-09-09T03:00:00Z',
          duration: 'PT3H',
        },
        {
          blockId: 'temperature',
          timeId: '1',
          sequence: 1,
          timeFrom: '2026-09-09T00:00:00Z',
          timeTo: '2026-09-09T00:00:00Z',
          duration: null,
        },
      ],
      values: [
        {
          blockId: 'weather',
          refId: '1',
          element: 'weather',
          valueCode: '100',
          valueText: '晴れ',
          valueNumber: null,
          unit: null,
          sequence: 1,
        },
        {
          blockId: 'temperature',
          refId: '1',
          element: 'temperature',
          valueCode: null,
          valueText: null,
          valueNumber: 24.5,
          unit: 'degree',
          sequence: 1,
        },
      ],
    });

    const found = findAreaTimeseriesSnapshot(context.connection, '130010', '44132', 'normal');
    assert.ok(found);
    assert.equal(found.values.length, 2);
    assert.equal(found.values[0].valueText, '晴れ');
    assert.equal(found.values[1].valueNumber, 24.5);

    // 4-2. stale 時の明細維持（空配列を渡しても既存明細が残る）
    const staleSaved = saveAreaTimeseriesSnapshot(context.connection, {
      areaCode: '130010',
      areaName: '東京地方',
      stationCode: '44132',
      stationName: '東京',
      metadata: { ...sampleMetadata, availability: 'stale', fetchedAt: '2026-09-09T01:00:00Z' },
      telegram: sampleTelegram,
      timeDefines: [],
      values: [],
    });
    assert.equal(staleSaved.metadata.availability, 'stale');
    assert.equal(staleSaved.values.length, 2);

    const foundStale = findAreaTimeseriesSnapshot(context.connection, '130010', '44132', 'normal');
    assert.ok(foundStale);
    assert.equal(foundStale.metadata.availability, 'stale');
    assert.equal(foundStale.metadata.fetchedAt, '2026-09-09T01:00:00Z');
    assert.equal(foundStale.values.length, 2);

    deleteAreaTimeseriesSnapshot(context.connection, '130010', '44132', 'normal');
    assert.equal(findAreaTimeseriesSnapshot(context.connection, '130010', '44132', 'normal'), null);
  } finally {
    cleanup();
  }
});

test('5. レーダー (Radar): N1/N2 独立, 相対パス検証, CASCADE', () => {
  const { context, cleanup } = setupTestDb();
  try {
    saveRadarSnapshot(context.connection, {
      product: 'N1',
      metadata: sampleMetadata,
      frames: [
        {
          baseTime: '2026-09-09T00:00:00Z',
          validTime: '2026-09-09T00:00:00Z',
          element: 'hrpns',
          member: 'none',
          sequence: 1,
          tiles: [
            {
              zoom: 10,
              tileX: 909,
              tileY: 403,
              filePath: 'tiles/radar/N1/20260909000000/20260909000000/hrpns/10/909/403.png',
              byteSize: 1024,
              contentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              storedAt: '2026-09-09T00:02:00Z',
            },
          ],
        },
      ],
    });

    saveRadarSnapshot(context.connection, {
      product: 'N2',
      metadata: { ...sampleMetadata, availability: 'unavailable' },
      frames: [],
    });

    const n1 = findRadarSnapshot(context.connection, 'N1');
    assert.ok(n1);
    assert.equal(n1.metadata.availability, 'available');
    assert.equal(n1.frames.length, 1);
    assert.equal(n1.frames[0].tiles.length, 1);
    assert.equal(n1.frames[0].tiles[0].byteSize, 1024);

    const n2 = findRadarSnapshot(context.connection, 'N2');
    assert.ok(n2);
    assert.equal(n2.metadata.availability, 'unavailable');
    assert.equal(n2.frames.length, 0);

    // 不正なパス（絶対パスや ".."）の保存はリポジトリ層で拒絶される
    assert.throws(() => {
      saveRadarSnapshot(context.connection, {
        product: 'N1',
        metadata: sampleMetadata,
        frames: [
          {
            baseTime: '2026-09-09T00:00:00Z',
            validTime: '2026-09-09T00:00:00Z',
            element: 'hrpns',
            member: 'none',
            sequence: 1,
            tiles: [
              {
                zoom: 10,
                tileX: 909,
                tileY: 403,
                filePath: '/etc/passwd',
                byteSize: 1024,
                contentHash: 'hash',
                storedAt: '2026-09-09T00:02:00Z',
              },
            ],
          },
        ],
      });
    }, /Invalid file path/);

    assert.throws(() => {
      saveRadarSnapshot(context.connection, {
        product: 'N1',
        metadata: sampleMetadata,
        frames: [
          {
            baseTime: '2026-09-09T00:00:00Z',
            validTime: '2026-09-09T00:00:00Z',
            element: 'hrpns',
            member: 'none',
            sequence: 1,
            tiles: [
              {
                zoom: 10,
                tileX: 909,
                tileY: 403,
                filePath: 'tiles/../secret.png',
                byteSize: 1024,
                contentHash: 'hash',
                storedAt: '2026-09-09T00:02:00Z',
              },
            ],
          },
        ],
      });
    }, /Invalid file path/);

    // stale 時の明細維持（空配列を渡しても既存明細・タイルが残る）
    const staleSaved = saveRadarSnapshot(context.connection, {
      product: 'N1',
      metadata: { ...sampleMetadata, availability: 'stale', fetchedAt: '2026-09-09T00:10:00Z' },
      frames: [],
    });
    assert.equal(staleSaved.metadata.availability, 'stale');
    assert.equal(staleSaved.frames.length, 1);
    assert.equal(staleSaved.frames[0].tiles.length, 1);

    const foundStale = findRadarSnapshot(context.connection, 'N1');
    assert.ok(foundStale);
    assert.equal(foundStale.metadata.availability, 'stale');
    assert.equal(foundStale.metadata.fetchedAt, '2026-09-09T00:10:00Z');
    assert.equal(foundStale.frames.length, 1);
    assert.equal(foundStale.frames[0].tiles.length, 1);
    assert.equal(foundStale.frames[0].tiles[0].byteSize, 1024);

    // 削除でタイル含め消えること
    deleteRadarSnapshot(context.connection, 'N1');
    assert.equal(findRadarSnapshot(context.connection, 'N1'), null);
    const tileCount = context.connection.prepare('SELECT COUNT(*) as c FROM radar_tile').get() as {
      c: number;
    };
    assert.equal(tileCount.c, 0);
  } finally {
    cleanup();
  }
});

test('6. キキクル (Risk): レイヤー独立, タイル保存', () => {
  const { context, cleanup } = setupTestDb();
  try {
    saveRiskSnapshot(context.connection, {
      layer: 'heavyrain',
      metadata: sampleMetadata,
      frames: [
        {
          baseTime: '2026-09-09T00:00:00Z',
          validTime: '2026-09-09T00:00:00Z',
          imageId: 'rain_mesh',
          member: 'none',
          sequence: 1,
          tiles: [
            {
              zoom: 10,
              tileX: 909,
              tileY: 403,
              filePath:
                'tiles/risk/heavyrain/20260909000000/20260909000000/rain_mesh/none/10/909/403.png',
              byteSize: 2048,
              contentHash: 'abc123hash',
              storedAt: '2026-09-09T00:02:00Z',
            },
          ],
        },
      ],
    });

    const heavyrain = findRiskSnapshot(context.connection, 'heavyrain');
    assert.ok(heavyrain);
    assert.equal(heavyrain.frames.length, 1);
    assert.equal(heavyrain.frames[0].imageId, 'rain_mesh');
    assert.equal(heavyrain.frames[0].tiles[0].byteSize, 2048);

    // stale 時の明細維持（空配列を渡しても既存明細・タイルが残る）
    const staleSaved = saveRiskSnapshot(context.connection, {
      layer: 'heavyrain',
      metadata: { ...sampleMetadata, availability: 'stale', fetchedAt: '2026-09-09T00:10:00Z' },
      frames: [],
    });
    assert.equal(staleSaved.metadata.availability, 'stale');
    assert.equal(staleSaved.frames.length, 1);
    assert.equal(staleSaved.frames[0].tiles.length, 1);

    const foundStale = findRiskSnapshot(context.connection, 'heavyrain');
    assert.ok(foundStale);
    assert.equal(foundStale.metadata.availability, 'stale');
    assert.equal(foundStale.metadata.fetchedAt, '2026-09-09T00:10:00Z');
    assert.equal(foundStale.frames.length, 1);
    assert.equal(foundStale.frames[0].tiles.length, 1);
    assert.equal(foundStale.frames[0].tiles[0].byteSize, 2048);

    deleteRiskSnapshot(context.connection, 'heavyrain');
    assert.equal(findRiskSnapshot(context.connection, 'heavyrain'), null);
  } finally {
    cleanup();
  }
});

test('7. アメダス (Amedas): 欠測(NULL)と0の区別, 複数時刻保持', () => {
  const { context, cleanup } = setupTestDb();
  try {
    saveAmedasSnapshot(context.connection, {
      stationCode: '44136',
      stationName: '江戸川臨海',
      metadata: sampleMetadata,
      observations: [
        {
          observedAt: '2026-09-09T00:00:00Z',
          element: 'temp',
          valueNumber: 25.4,
          valueText: null,
          qualityFlag: 0,
        },
        {
          observedAt: '2026-09-09T00:00:00Z',
          element: 'precipitation10m',
          valueNumber: null, // 欠測
          valueText: null,
          qualityFlag: 8,
        },
        {
          observedAt: '2026-09-09T00:10:00Z',
          element: 'temp',
          valueNumber: 25.6,
          valueText: null,
          qualityFlag: 0,
        },
      ],
    });

    const found = findAmedasSnapshot(context.connection, '44136');
    assert.ok(found);
    assert.equal(found.observations.length, 3);

    const missingPrec = found.observations.find((o) => o.element === 'precipitation10m');
    assert.ok(missingPrec);
    assert.equal(missingPrec.valueNumber, null, '欠測は null のままであり 0 に変換されないこと');
    assert.equal(missingPrec.qualityFlag, 8);

    // stale 時の明細維持（空配列を渡しても既存明細が残る）
    const staleSaved = saveAmedasSnapshot(context.connection, {
      stationCode: '44136',
      stationName: '江戸川臨海',
      metadata: { ...sampleMetadata, availability: 'stale', fetchedAt: '2026-09-09T00:15:00Z' },
      observations: [],
    });
    assert.equal(staleSaved.metadata.availability, 'stale');
    assert.equal(staleSaved.observations.length, 3);

    const foundStale = findAmedasSnapshot(context.connection, '44136');
    assert.ok(foundStale);
    assert.equal(foundStale.metadata.availability, 'stale');
    assert.equal(foundStale.metadata.fetchedAt, '2026-09-09T00:15:00Z');
    assert.equal(foundStale.observations.length, 3);

    deleteAmedasSnapshot(context.connection, '44136');
    assert.equal(findAmedasSnapshot(context.connection, '44136'), null);
  } finally {
    cleanup();
  }
});

test('8. 気象防災速報 (BosaiBulletin): 複数EventIDの蓄積, 訂正UPSERT, 取消フラグ, 江東区包含判定(リポジトリ層)', () => {
  const { context, cleanup } = setupTestDb();
  try {
    // 8-1. 江東区直接 (1310800) の速報 A
    saveBosaiBulletin(context.connection, {
      eventId: '202609090001',
      controlStatus: 'normal',
      infoType: '発表',
      reportDateTime: '2026-09-09T00:00:00Z',
      controlDateTime: '2026-09-09T00:00:00Z',
      title: '気象防災速報（江東区）',
      headlineText: '江東区で猛烈な雨',
      informationTag: '雨',
      isCancelled: false,
      metadata: sampleMetadata,
      areas: [
        {
          areaCode: '1310800',
          areaName: '江東区',
          codeType: 'area',
          sequence: 1,
        },
      ],
    });

    // 8-2. 東京地方広域 (130010) の速報 B
    saveBosaiBulletin(context.connection, {
      eventId: '202609090002',
      controlStatus: 'normal',
      infoType: '発表',
      reportDateTime: '2026-09-09T00:01:00Z',
      controlDateTime: '2026-09-09T00:01:00Z',
      title: '気象防災速報（東京地方）',
      headlineText: '東京地方に竜巻注意情報',
      informationTag: '竜巻',
      isCancelled: false,
      metadata: sampleMetadata,
      areas: [
        {
          areaCode: '130010',
          areaName: '東京地方',
          codeType: 'area',
          sequence: 1,
        },
      ],
    });

    // 8-3. 伊豆諸島 (130020) だけの速報 C（江東区を含まない）
    saveBosaiBulletin(context.connection, {
      eventId: '202609090003',
      controlStatus: 'normal',
      infoType: '発表',
      reportDateTime: '2026-09-09T00:02:00Z',
      controlDateTime: '2026-09-09T00:02:00Z',
      title: '気象防災速報（伊豆諸島）',
      headlineText: '大島で大雨',
      informationTag: '雨',
      isCancelled: false,
      metadata: sampleMetadata,
      areas: [
        {
          areaCode: '130020',
          areaName: '伊豆諸島北部',
          codeType: 'area',
          sequence: 1,
        },
      ],
    });

    // 複数保存後も全て保持される（自動消去されない）
    const all = listBosaiBulletins(context.connection, { controlStatus: 'normal' });
    assert.equal(all.length, 3, '3件の速報が全て残っていること');

    // 江東区絞り込み (includesKoto: true) では A と B のみ返り、C は除外される
    const kotoList = listBosaiBulletins(context.connection, {
      controlStatus: 'normal',
      includesKoto: true,
    });
    assert.equal(kotoList.length, 2, '江東区を含む速報は2件（直接+広域）');
    const eventIds = kotoList.map((b) => b.eventId).sort();
    assert.deepEqual(eventIds, ['202609090001', '202609090002']);

    // 訂正 (同一 EventID で UPSERT)
    saveBosaiBulletin(context.connection, {
      eventId: '202609090001',
      controlStatus: 'normal',
      infoType: '訂正',
      reportDateTime: '2026-09-09T00:05:00Z',
      controlDateTime: '2026-09-09T00:05:00Z',
      title: '気象防災速報（江東区・訂正）',
      headlineText: '江東区で猛烈な雨（訂正）',
      informationTag: '雨',
      isCancelled: false,
      metadata: sampleMetadata,
      areas: [
        {
          areaCode: '1310800',
          areaName: '江東区',
          codeType: 'area',
          sequence: 1,
        },
      ],
    });

    const updated = findBosaiBulletin(context.connection, '202609090001', 'normal');
    assert.ok(updated);
    assert.equal(updated.infoType, '訂正');
    assert.equal(updated.headlineText, '江東区で猛烈な雨（訂正）');

    // 取消
    saveBosaiBulletin(context.connection, {
      ...updated,
      infoType: '取消',
      isCancelled: true,
    });

    const cancelled = findBosaiBulletin(context.connection, '202609090001', 'normal');
    assert.ok(cancelled);
    assert.equal(cancelled.isCancelled, true);

    // 削除
    const deleted = deleteBosaiBulletin(context.connection, '202609090001', 'normal');
    assert.equal(deleted, true);
    assert.equal(findBosaiBulletin(context.connection, '202609090001', 'normal'), null);
  } finally {
    cleanup();
  }
});

test('9. 時刻文字列の UTC ISO 8601 形式検証', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const invalidDateStrings = [
      '2026-09-09',
      '2026/09/09 12:00:00',
      '2026-09-09T12:00:00+09:00',
      '2026-09-09T12:00:00',
      '',
      '   ',
      'invalid',
      '2026-09-09T12:00:00.1234Z',
    ];

    // 9-1. 共通メタの issuedAt / fetchedAt
    for (const invalid of invalidDateStrings) {
      assert.throws(() => {
        saveWarningCurrentSnapshot(context.connection, {
          areaCode: '1310800',
          areaName: '江東区',
          metadata: { ...sampleMetadata, issuedAt: invalid as unknown as string },
          telegram: sampleTelegram,
          items: [],
        });
      }, /must be a UTC ISO 8601 string/);

      assert.throws(() => {
        saveWarningCurrentSnapshot(context.connection, {
          areaCode: '1310800',
          areaName: '江東区',
          metadata: { ...sampleMetadata, fetchedAt: invalid as unknown as string },
          telegram: sampleTelegram,
          items: [],
        });
      }, /must be a UTC ISO 8601 string/);
    }

    // 9-2. 共通メタの null 許容時刻列 (validAt, validFrom, validTo, lastSuccessAt)
    for (const invalid of ['2026-09-09', 'invalid', '2026/09/09 12:00:00']) {
      assert.throws(() => {
        saveWarningCurrentSnapshot(context.connection, {
          areaCode: '1310800',
          areaName: '江東区',
          metadata: { ...sampleMetadata, validAt: invalid },
          telegram: sampleTelegram,
          items: [],
        });
      }, /must be a UTC ISO 8601 string/);

      assert.throws(() => {
        saveWarningCurrentSnapshot(context.connection, {
          areaCode: '1310800',
          areaName: '江東区',
          metadata: { ...sampleMetadata, lastSuccessAt: invalid },
          telegram: sampleTelegram,
          items: [],
        });
      }, /must be a UTC ISO 8601 string/);
    }

    // 9-3. 電文メタ情報の reportDateTime / controlDateTime
    for (const invalid of ['2026-09-09', 'invalid', '2026/09/09 12:00:00']) {
      assert.throws(() => {
        saveWarningCurrentSnapshot(context.connection, {
          areaCode: '1310800',
          areaName: '江東区',
          metadata: sampleMetadata,
          telegram: { ...sampleTelegram, reportDateTime: invalid },
          items: [],
        });
      }, /must be a UTC ISO 8601 string/);

      assert.throws(() => {
        saveWarningCurrentSnapshot(context.connection, {
          areaCode: '1310800',
          areaName: '江東区',
          metadata: sampleMetadata,
          telegram: { ...sampleTelegram, controlDateTime: invalid },
          items: [],
        });
      }, /must be a UTC ISO 8601 string/);
    }

    // 9-4. 明細時刻列: 警報等時系列の timeFrom / timeTo
    for (const invalid of ['2026-09-09', 'invalid']) {
      assert.throws(() => {
        saveWarningTimeseriesSnapshot(context.connection, {
          areaCode: '1310800',
          areaName: '江東区',
          metadata: sampleMetadata,
          telegram: sampleTelegram,
          timeDefines: [
            {
              blockId: 'block_rain',
              timeId: '1',
              sequence: 1,
              timeFrom: invalid,
              timeTo: '2026-09-09T03:00:00Z',
              duration: 'PT3H',
            },
          ],
          values: [],
        });
      }, /must be a UTC ISO 8601 string/);

      assert.throws(() => {
        saveWarningTimeseriesSnapshot(context.connection, {
          areaCode: '1310800',
          areaName: '江東区',
          metadata: sampleMetadata,
          telegram: sampleTelegram,
          timeDefines: [
            {
              blockId: 'block_rain',
              timeId: '1',
              sequence: 1,
              timeFrom: '2026-09-09T00:00:00Z',
              timeTo: invalid,
              duration: 'PT3H',
            },
          ],
          values: [],
        });
      }, /must be a UTC ISO 8601 string/);
    }

    // 9-5. 明細時刻列: 現況警報の kindIssuedAt (null許容)
    assert.throws(() => {
      saveWarningCurrentSnapshot(context.connection, {
        areaCode: '1310800',
        areaName: '江東区',
        metadata: sampleMetadata,
        telegram: sampleTelegram,
        items: [
          {
            sequence: 1,
            kindCode: '03',
            kindName: '大雨警報',
            kindStatus: '発表',
            lastKindCode: null,
            lastKindName: null,
            significancyCode: '2',
            significancyName: '警報',
            warningLevel: '3',
            attentionText: null,
            kindIssuedAt: '2026-09-09',
            sourceTelegram: 'VPWW55',
          },
        ],
      });
    }, /must be a UTC ISO 8601 string/);

    // 9-6. 明細時刻列: アメダスの observedAt
    assert.throws(() => {
      saveAmedasSnapshot(context.connection, {
        stationCode: '44136',
        stationName: '江戸川臨海',
        metadata: sampleMetadata,
        observations: [
          {
            observedAt: '2026-09-09 12:00:00',
            element: 'temp',
            valueNumber: 25.0,
            valueText: null,
            qualityFlag: 0,
          },
        ],
      });
    }, /must be a UTC ISO 8601 string/);

    // 9-7. 気象防災速報の reportDateTime / controlDateTime
    assert.throws(() => {
      saveBosaiBulletin(context.connection, {
        eventId: '202609090001',
        controlStatus: 'normal',
        infoType: '発表',
        reportDateTime: '2026-09-09',
        controlDateTime: '2026-09-09T00:00:00Z',
        title: '気象防災速報',
        headlineText: '速報テキスト',
        informationTag: '雨',
        isCancelled: false,
        metadata: sampleMetadata,
        areas: [],
      });
    }, /must be a UTC ISO 8601 string/);

    assert.throws(() => {
      saveBosaiBulletin(context.connection, {
        eventId: '202609090001',
        controlStatus: 'normal',
        infoType: '発表',
        reportDateTime: '2026-09-09T00:00:00Z',
        controlDateTime: '2026-09-09',
        title: '気象防災速報',
        headlineText: '速報テキスト',
        informationTag: '雨',
        isCancelled: false,
        metadata: sampleMetadata,
        areas: [],
      });
    }, /must be a UTC ISO 8601 string/);

    // 9-8. 正常なUTC ISO 8601形式（秒まで、およびミリ秒付き、1桁ミリ秒）は例外にならない
    const validWithMillis = '2026-09-09T12:00:00.123Z';
    const validNoMillis = '2026-09-09T12:00:00Z';
    const validWithOneDigitMillis = '2026-09-09T12:00:00.1Z';

    const res1 = saveWarningCurrentSnapshot(context.connection, {
      areaCode: '1310800',
      areaName: '江東区',
      metadata: { ...sampleMetadata, issuedAt: validWithMillis, fetchedAt: validNoMillis },
      telegram: { ...sampleTelegram, reportDateTime: validWithOneDigitMillis },
      items: [],
    });
    assert.equal(res1.metadata.issuedAt, validWithMillis);
  } finally {
    cleanup();
  }
});
