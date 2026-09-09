import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeDatabase } from '../src/database/index.js';
import {
  deleteWarningCurrentStreams,
  findWarningCurrentSnapshot,
  findWarningCurrentStream,
  listWarningCurrentStreams,
  saveWarningCurrentSnapshot,
  upsertWarningCurrentStream,
  type WarningCurrentSnapshotInput,
  type WarningCurrentStreamInput,
} from '../src/repositories/index.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

function createTempDb(): {
  connection: ReturnType<typeof initializeDatabase>['connection'];
  cleanup: () => void;
} {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-warning-stream-schema-'));
  const databasePath = join(directory, 'test.sqlite3');
  const context = initializeDatabase({ databasePath, migrationsDirectory });
  return {
    connection: context.connection,
    cleanup: () => {
      context.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('1. warning_current_stream テーブルが作成され、列定義と型が設計書 §4.1 と一致する', () => {
  const { connection, cleanup } = createTempDb();
  try {
    const columns = connection.prepare('PRAGMA table_info(warning_current_stream)').all() as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
      pk: number;
    }>;

    const columnMap = new Map(columns.map((col) => [col.name, col]));

    const expectedColumns = [
      { name: 'id', type: 'INTEGER', notnull: 0, pk: 1 },
      { name: 'prefecture_code', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'area_code', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'control_status', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'telegram_type', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'reception_id', type: 'INTEGER', notnull: 1, pk: 0 },
      { name: 'report_datetime', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'control_datetime', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'received_at', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'content_hash', type: 'TEXT', notnull: 1, pk: 0 },
    ];

    assert.equal(columns.length, expectedColumns.length, 'Column count must match');
    for (const exp of expectedColumns) {
      const actual = columnMap.get(exp.name);
      assert.ok(actual, `Column ${exp.name} should exist`);
      assert.equal(actual.type, exp.type, `Column ${exp.name} type mismatch`);
      assert.equal(actual.notnull, exp.notnull, `Column ${exp.name} notnull mismatch`);
      assert.equal(actual.pk, exp.pk, `Column ${exp.name} pk mismatch`);
    }

    // EventID / Serial 列が存在しないことを明示確認
    assert.equal(columnMap.has('event_id'), false, 'event_id must not exist');
    assert.equal(columnMap.has('serial'), false, 'serial must not exist');
  } finally {
    cleanup();
  }
});

test('2. CHECK 制約: 空文字・不正値の挿入が拒否される', () => {
  const { connection, cleanup } = createTempDb();
  try {
    const validRow = {
      prefecture_code: '130000',
      area_code: '1310800',
      control_status: 'normal',
      telegram_type: 'VPWW55',
      reception_id: 1,
      report_datetime: '2026-09-09T00:00:00Z',
      control_datetime: '2026-09-09T00:00:00Z',
      received_at: '2026-09-09T00:00:01Z',
      content_hash: 'hash1',
    };

    const insertSql = `
      INSERT INTO warning_current_stream (
        prefecture_code, area_code, control_status, telegram_type,
        reception_id, report_datetime, control_datetime, received_at, content_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    // 正常系
    connection
      .prepare(insertSql)
      .run(
        validRow.prefecture_code,
        validRow.area_code,
        validRow.control_status,
        validRow.telegram_type,
        validRow.reception_id,
        validRow.report_datetime,
        validRow.control_datetime,
        validRow.received_at,
        validRow.content_hash,
      );

    // prefecture_code 空文字 CHECK 違反
    assert.throws(() => {
      connection
        .prepare(insertSql)
        .run(
          '',
          validRow.area_code,
          'training',
          validRow.telegram_type,
          2,
          validRow.report_datetime,
          validRow.control_datetime,
          validRow.received_at,
          'hash2',
        );
    }, /CHECK constraint failed/);

    // area_code 空文字 CHECK 違反
    assert.throws(() => {
      connection
        .prepare(insertSql)
        .run(
          validRow.prefecture_code,
          '',
          'training',
          validRow.telegram_type,
          2,
          validRow.report_datetime,
          validRow.control_datetime,
          validRow.received_at,
          'hash2',
        );
    }, /CHECK constraint failed/);

    // control_status 不正値 CHECK 違反
    assert.throws(() => {
      connection
        .prepare(insertSql)
        .run(
          validRow.prefecture_code,
          validRow.area_code,
          'invalid_status',
          validRow.telegram_type,
          2,
          validRow.report_datetime,
          validRow.control_datetime,
          validRow.received_at,
          'hash2',
        );
    }, /CHECK constraint failed/);

    // telegram_type 不正値 CHECK 違反
    assert.throws(() => {
      connection
        .prepare(insertSql)
        .run(
          validRow.prefecture_code,
          validRow.area_code,
          'training',
          'VPWW99',
          2,
          validRow.report_datetime,
          validRow.control_datetime,
          validRow.received_at,
          'hash2',
        );
    }, /CHECK constraint failed/);

    // content_hash 空文字 CHECK 違反
    assert.throws(() => {
      connection
        .prepare(insertSql)
        .run(
          validRow.prefecture_code,
          validRow.area_code,
          'training',
          validRow.telegram_type,
          2,
          validRow.report_datetime,
          validRow.control_datetime,
          validRow.received_at,
          '',
        );
    }, /CHECK constraint failed/);
  } finally {
    cleanup();
  }
});

test('3. 一意キー: (prefecture_code, area_code, control_status, telegram_type) で衝突し、他列の違いでは回避できない', () => {
  const { connection, cleanup } = createTempDb();
  try {
    const insertSql = `
      INSERT INTO warning_current_stream (
        prefecture_code, area_code, control_status, telegram_type,
        reception_id, report_datetime, control_datetime, received_at, content_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    connection
      .prepare(insertSql)
      .run(
        '130000',
        '1310800',
        'normal',
        'VPWW55',
        1,
        '2026-09-09T00:00:00Z',
        '2026-09-09T00:00:00Z',
        '2026-09-09T00:00:01Z',
        'hash1',
      );

    // 同一キーの再INSERTはUNIQUE違反
    assert.throws(() => {
      connection
        .prepare(insertSql)
        .run(
          '130000',
          '1310800',
          'normal',
          'VPWW55',
          2,
          '2026-09-09T01:00:00Z',
          '2026-09-09T01:00:00Z',
          '2026-09-09T01:00:01Z',
          'hash2',
        );
    }, /UNIQUE constraint failed/);

    // 異なる telegram_type は保存可能
    connection
      .prepare(insertSql)
      .run(
        '130000',
        '1310800',
        'normal',
        'VPWS50',
        3,
        '2026-09-09T00:00:00Z',
        '2026-09-09T00:00:00Z',
        '2026-09-09T00:00:01Z',
        'hash3',
      );

    // 異なる control_status は保存可能
    connection
      .prepare(insertSql)
      .run(
        '130000',
        '1310800',
        'training',
        'VPWW55',
        4,
        '2026-09-09T00:00:00Z',
        '2026-09-09T00:00:00Z',
        '2026-09-09T00:00:01Z',
        'hash4',
      );

    // 異なる area_code は保存可能
    connection
      .prepare(insertSql)
      .run(
        '130000',
        '1310900',
        'normal',
        'VPWW55',
        5,
        '2026-09-09T00:00:00Z',
        '2026-09-09T00:00:00Z',
        '2026-09-09T00:00:01Z',
        'hash5',
      );
  } finally {
    cleanup();
  }
});

test('4. warningCurrentStreamRepository の CRUD 操作', () => {
  const { connection, cleanup } = createTempDb();
  try {
    const input1: WarningCurrentStreamInput = {
      prefectureCode: '130000',
      areaCode: '1310800',
      controlStatus: 'normal',
      telegramType: 'VPWW55',
      receptionId: 10,
      reportDateTime: '2026-09-09T01:00:00Z',
      controlDateTime: '2026-09-09T01:00:00Z',
      receivedAt: '2026-09-09T01:00:05Z',
      contentHash: 'hash-stream-1',
    };

    const saved1 = upsertWarningCurrentStream(connection, input1);
    assert.equal(saved1.receptionId, 10);
    assert.equal(saved1.contentHash, 'hash-stream-1');

    // find
    const found1 = findWarningCurrentStream(connection, '130000', '1310800', 'normal', 'VPWW55');
    assert.ok(found1);
    assert.equal(found1.id, saved1.id);
    assert.equal(found1.reportDateTime, '2026-09-09T01:00:00Z');

    // upsert 更新
    const input1Update: WarningCurrentStreamInput = {
      ...input1,
      receptionId: 20,
      reportDateTime: '2026-09-09T02:00:00Z',
      contentHash: 'hash-stream-1-v2',
    };
    const saved1Update = upsertWarningCurrentStream(connection, input1Update);
    assert.equal(saved1Update.id, saved1.id, 'ID must be preserved on upsert');
    assert.equal(saved1Update.receptionId, 20);
    assert.equal(saved1Update.reportDateTime, '2026-09-09T02:00:00Z');

    // list
    const input2: WarningCurrentStreamInput = {
      prefectureCode: '130000',
      areaCode: '1310800',
      controlStatus: 'normal',
      telegramType: 'VPWS50',
      receptionId: 15,
      reportDateTime: '2026-09-09T01:30:00Z',
      controlDateTime: '2026-09-09T01:30:00Z',
      receivedAt: '2026-09-09T01:30:05Z',
      contentHash: 'hash-stream-2',
    };
    upsertWarningCurrentStream(connection, input2);

    const list = listWarningCurrentStreams(connection, '130000', '1310800', 'normal');
    assert.equal(list.length, 2);

    // delete
    const deletedCount = deleteWarningCurrentStreams(connection, '130000', '1310800', 'normal');
    assert.equal(deletedCount, 2);
    const listAfter = listWarningCurrentStreams(connection, '130000', '1310800', 'normal');
    assert.equal(listAfter.length, 0);
  } finally {
    cleanup();
  }
});

test('5. warningCurrentRepository: sourceVersion 一致時は明細の削除・再挿入を行わず無変更で返す', () => {
  const { connection, cleanup } = createTempDb();
  try {
    const input: WarningCurrentSnapshotInput = {
      areaCode: '1310800',
      areaName: '江東区',
      metadata: {
        source: 'jma_xml_warning_current',
        issuedAt: '2026-09-09T00:00:00Z',
        validAt: null,
        validFrom: null,
        validTo: null,
        fetchedAt: '2026-09-09T00:00:05Z',
        lastSuccessAt: '2026-09-09T00:00:05Z',
        availability: 'available',
        sourceVersion: 'version-hash-aaa',
      },
      telegram: {
        controlStatus: 'normal',
        infoType: '発表',
        eventId: null,
        reportDateTime: '2026-09-09T00:00:00Z',
        controlDateTime: '2026-09-09T00:00:00Z',
      },
      items: [
        {
          sequence: 1,
          kindCode: '03',
          kindName: '大雨警報',
          kindStatus: '発表',
          lastKindCode: null,
          lastKindName: null,
          significancyCode: null,
          significancyName: null,
          warningLevel: null,
          attentionText: null,
          kindIssuedAt: '2026-09-09T00:00:00Z',
          sourceTelegram: 'VPWW55',
        },
      ],
    };

    const first = saveWarningCurrentSnapshot(connection, input);
    assert.equal(first.items.length, 1);
    const firstItemId = first.items[0]!.id;

    // 別のエリアのスナップショットを保存して warning_current_item の ID を進める
    const otherInput: WarningCurrentSnapshotInput = {
      ...input,
      areaCode: '1310900',
      metadata: { ...input.metadata, sourceVersion: 'version-other' },
      items: [{ ...input.items[0]!, kindCode: '04' }],
    };
    saveWarningCurrentSnapshot(connection, otherInput);

    // 同じ sourceVersion で再度 saveWarningCurrentSnapshot
    const second = saveWarningCurrentSnapshot(connection, input);
    assert.equal(second.items.length, 1);
    // 明細が再生成されていなければ item id は同じ
    assert.equal(
      second.items[0]!.id,
      firstItemId,
      'Item ID should be preserved when sourceVersion matches',
    );

    // DB から直接再読み込みしても同じ
    const found = findWarningCurrentSnapshot(connection, '1310800', 'normal');
    assert.ok(found);
    assert.equal(found.items[0]!.id, firstItemId);
  } finally {
    cleanup();
  }
});
