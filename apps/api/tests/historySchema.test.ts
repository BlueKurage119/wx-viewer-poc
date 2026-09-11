import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeDatabase, openDatabase, runMigrations } from '../src/database/index.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

function createTempDbPath(): { databasePath: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-history-schema-test-'));
  const databasePath = join(directory, 'test.sqlite3');
  return {
    databasePath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test('1. 本番 migration をすべて適用すると fetch_attempt / telegram_reception / telegram_reception_area が存在し、適用件数が 12 件と一致する', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const expectedSqlFiles = readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    assert.equal(expectedSqlFiles.length, 17);
    assert.equal(context.migrationSummary.appliedVersions.length, 17);

    const tables = (
      context.connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);

    assert.ok(tables.includes('fetch_attempt'), 'fetch_attempt should exist');
    assert.ok(tables.includes('telegram_reception'), 'telegram_reception should exist');
    assert.ok(tables.includes('telegram_reception_area'), 'telegram_reception_area should exist');

    context.close();
  } finally {
    cleanup();
  }
});

test('2. 3 表の PRAGMA table_info が設計書 §4 の列名・型・NOT NULL 指定と完全一致する', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    // fetch_attempt
    const fetchColumns = context.connection
      .prepare('PRAGMA table_info(fetch_attempt)')
      .all() as Array<{
      name: string;
      notnull: number;
      type: string;
    }>;
    const expectedFetchColumns = [
      { name: 'id', type: 'INTEGER', notnull: 0 },
      { name: 'source_kind', type: 'TEXT', notnull: 1 },
      { name: 'target_ref', type: 'TEXT', notnull: 0 },
      { name: 'request_url', type: 'TEXT', notnull: 1 },
      { name: 'trigger_kind', type: 'TEXT', notnull: 1 },
      { name: 'attempt_no', type: 'INTEGER', notnull: 1 },
      { name: 'started_at', type: 'TEXT', notnull: 1 },
      { name: 'finished_at', type: 'TEXT', notnull: 1 },
      { name: 'duration_ms', type: 'INTEGER', notnull: 1 },
      { name: 'outcome', type: 'TEXT', notnull: 1 },
      { name: 'http_status', type: 'INTEGER', notnull: 0 },
      { name: 'response_bytes', type: 'INTEGER', notnull: 0 },
      { name: 'item_count', type: 'INTEGER', notnull: 0 },
      { name: 'failed_item_count', type: 'INTEGER', notnull: 0 },
      { name: 'content_hash', type: 'TEXT', notnull: 0 },
      { name: 'error_kind', type: 'TEXT', notnull: 0 },
      { name: 'error_message', type: 'TEXT', notnull: 0 },
    ];
    assert.equal(fetchColumns.length, expectedFetchColumns.length);
    for (const exp of expectedFetchColumns) {
      const col = fetchColumns.find((c) => c.name === exp.name);
      assert.ok(col, `fetch_attempt column ${exp.name} must exist`);
      assert.equal(col.type.toUpperCase(), exp.type);
      assert.equal(col.notnull, exp.notnull, `fetch_attempt column ${exp.name} notnull mismatch`);
    }

    // telegram_reception
    const telegramColumns = context.connection
      .prepare('PRAGMA table_info(telegram_reception)')
      .all() as Array<{
      name: string;
      notnull: number;
      type: string;
    }>;
    const expectedTelegramColumns = [
      { name: 'id', type: 'INTEGER', notnull: 0 },
      { name: 'fetch_attempt_id', type: 'INTEGER', notnull: 0 },
      { name: 'feed_kind', type: 'TEXT', notnull: 0 },
      { name: 'feed_entry_id', type: 'TEXT', notnull: 0 },
      { name: 'document_url', type: 'TEXT', notnull: 1 },
      { name: 'telegram_type', type: 'TEXT', notnull: 0 },
      { name: 'title', type: 'TEXT', notnull: 0 },
      { name: 'control_status', type: 'TEXT', notnull: 0 },
      { name: 'info_type', type: 'TEXT', notnull: 0 },
      { name: 'event_id', type: 'TEXT', notnull: 0 },
      { name: 'serial', type: 'TEXT', notnull: 0 },
      { name: 'control_datetime', type: 'TEXT', notnull: 0 },
      { name: 'report_datetime', type: 'TEXT', notnull: 0 },
      { name: 'target_datetime', type: 'TEXT', notnull: 0 },
      { name: 'received_at', type: 'TEXT', notnull: 1 },
      { name: 'adoption_result', type: 'TEXT', notnull: 0 },
      { name: 'adoption_reason', type: 'TEXT', notnull: 0 },
      { name: 'adoption_decided_at', type: 'TEXT', notnull: 0 },
      { name: 'raw_body', type: 'TEXT', notnull: 0 },
      { name: 'body_bytes', type: 'INTEGER', notnull: 0 },
      { name: 'content_hash', type: 'TEXT', notnull: 0 },
    ];
    assert.equal(telegramColumns.length, expectedTelegramColumns.length);
    for (const exp of expectedTelegramColumns) {
      const col = telegramColumns.find((c) => c.name === exp.name);
      assert.ok(col, `telegram_reception column ${exp.name} must exist`);
      assert.equal(col.type.toUpperCase(), exp.type);
      assert.equal(
        col.notnull,
        exp.notnull,
        `telegram_reception column ${exp.name} notnull mismatch`,
      );
    }

    // telegram_reception_area
    const areaColumns = context.connection
      .prepare('PRAGMA table_info(telegram_reception_area)')
      .all() as Array<{
      name: string;
      notnull: number;
      type: string;
    }>;
    const expectedAreaColumns = [
      { name: 'id', type: 'INTEGER', notnull: 0 },
      { name: 'reception_id', type: 'INTEGER', notnull: 1 },
      { name: 'area_code', type: 'TEXT', notnull: 1 },
      { name: 'area_name', type: 'TEXT', notnull: 0 },
      { name: 'code_type', type: 'TEXT', notnull: 0 },
      { name: 'sequence', type: 'INTEGER', notnull: 1 },
    ];
    assert.equal(areaColumns.length, expectedAreaColumns.length);
    for (const exp of expectedAreaColumns) {
      const col = areaColumns.find((c) => c.name === exp.name);
      assert.ok(col, `telegram_reception_area column ${exp.name} must exist`);
      assert.equal(col.type.toUpperCase(), exp.type);
      assert.equal(
        col.notnull,
        exp.notnull,
        `telegram_reception_area column ${exp.name} notnull mismatch`,
      );
    }

    context.close();
  } finally {
    cleanup();
  }
});

test('3. fetch_attempt.outcome に success / failure 以外を入れると CHECK 違反。2 値はいずれも保存できる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const insertSql = `
      INSERT INTO fetch_attempt (
        source_kind, request_url, trigger_kind, attempt_no, started_at, finished_at, duration_ms, outcome
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (const outcome of ['success', 'failure']) {
      context.connection
        .prepare(insertSql)
        .run(
          'xml_feed_regular',
          'https://example.com/feed',
          'scheduled',
          1,
          '2026-09-09T00:00:00Z',
          '2026-09-09T00:00:01Z',
          1000,
          outcome,
        );
    }

    assert.throws(() => {
      context.connection
        .prepare(insertSql)
        .run(
          'xml_feed_regular',
          'https://example.com/feed',
          'scheduled',
          1,
          '2026-09-09T00:00:00Z',
          '2026-09-09T00:00:01Z',
          1000,
          'invalid_outcome',
        );
    }, /CHECK constraint failed/);

    context.close();
  } finally {
    cleanup();
  }
});

test('4. telegram_reception.control_status に normal / training / test 以外を入れると CHECK 違反。3 値と NULL はいずれも保存できる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const insertSql = `
      INSERT INTO telegram_reception (
        document_url, received_at, control_status
      ) VALUES (?, ?, ?)
    `;

    for (const status of ['normal', 'training', 'test', null]) {
      context.connection
        .prepare(insertSql)
        .run('https://example.com/doc.xml', '2026-09-09T00:00:00Z', status);
    }

    assert.throws(() => {
      context.connection
        .prepare(insertSql)
        .run('https://example.com/doc.xml', '2026-09-09T00:00:00Z', 'invalid_status');
    }, /CHECK constraint failed/);

    context.close();
  } finally {
    cleanup();
  }
});

test('4b. fetch_attempt の item_count / failed_item_count に、両方 NULL・(12, 0)・(12, 3)・(12, 12) を INSERT でき、(12, 13)・(0, 0)・(12, -1) は CHECK 違反', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const insertSql = `
      INSERT INTO fetch_attempt (
        source_kind, request_url, trigger_kind, attempt_no, started_at, finished_at, duration_ms, outcome, item_count, failed_item_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    // 正常ケース
    const validPairs: Array<[number | null, number | null]> = [
      [null, null],
      [12, 0],
      [12, 3],
      [12, 12],
    ];
    for (const [itemCount, failedItemCount] of validPairs) {
      context.connection
        .prepare(insertSql)
        .run(
          'radar_tile_frame',
          'https://example.com/tile',
          'scheduled',
          1,
          '2026-09-09T00:00:00Z',
          '2026-09-09T00:00:01Z',
          1000,
          'success',
          itemCount,
          failedItemCount,
        );
    }

    // CHECK違反ケース: failed_item_count > item_count
    assert.throws(() => {
      context.connection
        .prepare(insertSql)
        .run(
          'radar_tile_frame',
          'https://example.com/tile',
          'scheduled',
          1,
          '2026-09-09T00:00:00Z',
          '2026-09-09T00:00:01Z',
          1000,
          'failure',
          12,
          13,
        );
    }, /CHECK constraint failed/);

    // CHECK違反ケース: item_count = 0
    assert.throws(() => {
      context.connection
        .prepare(insertSql)
        .run(
          'radar_tile_frame',
          'https://example.com/tile',
          'scheduled',
          1,
          '2026-09-09T00:00:00Z',
          '2026-09-09T00:00:01Z',
          1000,
          'failure',
          0,
          0,
        );
    }, /CHECK constraint failed/);

    // CHECK違反ケース: failed_item_count = -1
    assert.throws(() => {
      context.connection
        .prepare(insertSql)
        .run(
          'radar_tile_frame',
          'https://example.com/tile',
          'scheduled',
          1,
          '2026-09-09T00:00:00Z',
          '2026-09-09T00:00:01Z',
          1000,
          'failure',
          12,
          -1,
        );
    }, /CHECK constraint failed/);

    context.close();
  } finally {
    cleanup();
  }
});

test('5. adoption_result に任意の文字列を保存できる。PRAGMA table_info と DDL に IN ( 制約が存在しない', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const insertSql = `
      INSERT INTO telegram_reception (
        document_url, received_at, adoption_result
      ) VALUES (?, ?, ?)
    `;

    for (const result of ['採用', '未対応形式', 'adopted-by-aggregate']) {
      context.connection
        .prepare(insertSql)
        .run('https://example.com/doc.xml', '2026-09-09T00:00:00Z', result);
    }

    const ddlRow = context.connection
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'telegram_reception'")
      .get() as { sql: string };
    assert.ok(!ddlRow.sql.includes('adoption_result IN ('));

    context.close();
  } finally {
    cleanup();
  }
});

test('6. telegram_reception を削除すると telegram_reception_area が ON DELETE CASCADE で消える。PRAGMA foreign_keys が 1', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const foreignKeys = context.connection.prepare('PRAGMA foreign_keys').get() as {
      foreign_keys: number;
    };
    assert.equal(foreignKeys.foreign_keys, 1, 'foreign_keys must be enabled');

    const res = context.connection
      .prepare(
        "INSERT INTO telegram_reception (document_url, received_at) VALUES ('https://example.com/doc.xml', '2026-09-09T00:00:00Z')",
      )
      .run();
    const receptionId = Number(res.lastInsertRowid);

    context.connection
      .prepare(
        'INSERT INTO telegram_reception_area (reception_id, area_code, area_name, sequence) VALUES (?, ?, ?, ?)',
      )
      .run(receptionId, '1310800', '江東区', 1);

    const countBefore = context.connection
      .prepare('SELECT COUNT(*) as c FROM telegram_reception_area WHERE reception_id = ?')
      .get(receptionId) as { c: number };
    assert.equal(countBefore.c, 1);

    context.connection.prepare('DELETE FROM telegram_reception WHERE id = ?').run(receptionId);

    const countAfter = context.connection
      .prepare('SELECT COUNT(*) as c FROM telegram_reception_area WHERE reception_id = ?')
      .get(receptionId) as { c: number };
    assert.equal(countAfter.c, 0, 'telegram_reception_area should be cascade deleted');

    context.close();
  } finally {
    cleanup();
  }
});

test('7. telegram_reception_area を親不在で挿入すると外部キー違反になる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    assert.throws(() => {
      context.connection
        .prepare(
          'INSERT INTO telegram_reception_area (reception_id, area_code, area_name, sequence) VALUES (?, ?, ?, ?)',
        )
        .run(999999, '1310800', '江東区', 1);
    }, /FOREIGN KEY constraint failed/);

    context.close();
  } finally {
    cleanup();
  }
});

test('8. 2 表の独立性: fetch_attempt 行を削除しても telegram_reception 行が残り値が変わらない。存在しない fetch_attempt_id を挿入できる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    // 存在しない fetch_attempt_id で telegram_reception を挿入可能
    const resOrphan = context.connection
      .prepare(
        'INSERT INTO telegram_reception (fetch_attempt_id, document_url, received_at) VALUES (?, ?, ?)',
      )
      .run(999999, 'https://example.com/orphan.xml', '2026-09-09T00:00:00Z');
    assert.ok(resOrphan.lastInsertRowid > 0);

    // fetch_attempt を作成し、それに紐づく telegram_reception を作成
    const fetchRes = context.connection
      .prepare(
        `
        INSERT INTO fetch_attempt (
          source_kind, request_url, trigger_kind, attempt_no, started_at, finished_at, duration_ms, outcome
        ) VALUES ('xml_document', 'https://example.com/doc1.xml', 'scheduled', 1, '2026-09-09T00:00:00Z', '2026-09-09T00:00:01Z', 1000, 'success')
      `,
      )
      .run();
    const fetchId = Number(fetchRes.lastInsertRowid);

    const telRes = context.connection
      .prepare(
        'INSERT INTO telegram_reception (fetch_attempt_id, document_url, received_at) VALUES (?, ?, ?)',
      )
      .run(fetchId, 'https://example.com/doc1.xml', '2026-09-09T00:00:01Z');
    const telId = Number(telRes.lastInsertRowid);

    // fetch_attempt を削除
    context.connection.prepare('DELETE FROM fetch_attempt WHERE id = ?').run(fetchId);

    // telegram_reception は残っており、fetch_attempt_id もそのまま
    const telRow = context.connection
      .prepare('SELECT * FROM telegram_reception WHERE id = ?')
      .get(telId) as { id: number; fetch_attempt_id: number; document_url: string };
    assert.ok(telRow, 'telegram_reception must remain after fetch_attempt deletion');
    assert.equal(telRow.fetch_attempt_id, fetchId);
    assert.equal(telRow.document_url, 'https://example.com/doc1.xml');

    context.close();
  } finally {
    cleanup();
  }
});

test('9. B2 からの独立性: 0009 / 0010 の DDL に B2 のテーブル名が現れない', () => {
  const sql0009 = readFileSync(join(migrationsDirectory, '0009_create_fetch_attempt.sql'), 'utf-8');
  const sql0010 = readFileSync(
    join(migrationsDirectory, '0010_create_telegram_reception.sql'),
    'utf-8',
  );
  const combined = `${sql0009}\n${sql0010}`;

  const b2Pattern = /_snapshot|bosai_bulletin|warning_current|radar_frame|risk_frame|amedas_/i;
  assert.ok(!b2Pattern.test(combined), '0009/0010 must not reference B2 tables');
});

test('10. 3 表に自動削除の仕組み（トリガー）が存在しない（sqlite_master の type=trigger が 0 件）', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const triggers = context.connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
      .all();
    assert.equal(triggers.length, 0, 'No triggers should be defined in database');

    context.close();
  } finally {
    cleanup();
  }
});

test('11. 同一 document_url の行を 2 件挿入でき、UNIQUE 制約に阻まれない（追記ログ性）', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const insertSql = `
      INSERT INTO telegram_reception (
        document_url, received_at
      ) VALUES (?, ?)
    `;

    const res1 = context.connection
      .prepare(insertSql)
      .run('https://example.com/same.xml', '2026-09-09T00:00:00Z');
    const res2 = context.connection
      .prepare(insertSql)
      .run('https://example.com/same.xml', '2026-09-09T00:05:00Z');

    assert.notEqual(res1.lastInsertRowid, res2.lastInsertRowid);

    const count = context.connection
      .prepare('SELECT COUNT(*) as c FROM telegram_reception WHERE document_url = ?')
      .get('https://example.com/same.xml') as { c: number };
    assert.equal(count.c, 2);

    context.close();
  } finally {
    cleanup();
  }
});

test('12. migration を 2 回適用しても再実行されない（appliedVersions が空配列）', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context1 = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });
    assert.equal(context1.migrationSummary.appliedVersions.length, 17);
    context1.close();

    const connection = openDatabase(databasePath);
    const summary2 = runMigrations(connection, migrationsDirectory);
    assert.equal(
      summary2.appliedVersions.length,
      0,
      'No new migrations should be applied on second run',
    );
    connection.close();
  } finally {
    cleanup();
  }
});
