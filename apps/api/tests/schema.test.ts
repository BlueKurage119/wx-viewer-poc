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
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-schema-test-'));
  const databasePath = join(directory, 'test.sqlite3');
  return {
    databasePath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test('1. 本番 migration をすべて適用すると全テーブルが存在し、__schema_migrations の件数が一致する', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const expectedSqlFiles = readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    assert.equal(expectedSqlFiles.length, 13);
    assert.equal(context.migrationSummary.appliedVersions.length, 13);

    const tables = (
      context.connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);

    const expectedTables = [
      '__schema_migrations',
      'warning_current_snapshot',
      'warning_current_item',
      'warning_timeseries_snapshot',
      'warning_timeseries_time_define',
      'warning_timeseries_value',
      'early_warning_snapshot',
      'early_warning_time_define',
      'early_warning_cell',
      'area_timeseries_snapshot',
      'area_timeseries_time_define',
      'area_timeseries_value',
      'radar_snapshot',
      'radar_frame',
      'radar_tile',
      'risk_snapshot',
      'risk_frame',
      'risk_tile',
      'amedas_snapshot',
      'amedas_observation',
      'bosai_bulletin',
      'bosai_bulletin_area',
    ];

    for (const table of expectedTables) {
      assert.ok(tables.includes(table), `Table ${table} should exist in sqlite_master`);
    }

    context.close();
  } finally {
    cleanup();
  }
});

test('2. 8種別のスナップショット表とbosai_bulletinが共通メタ列をすべて持つ', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const snapshotTables = [
      'warning_current_snapshot',
      'warning_timeseries_snapshot',
      'early_warning_snapshot',
      'area_timeseries_snapshot',
      'radar_snapshot',
      'risk_snapshot',
      'amedas_snapshot',
      'bosai_bulletin',
    ];

    const expectedCommonColumns = [
      { name: 'source', notnull: 1 },
      { name: 'issued_at', notnull: 1 },
      { name: 'valid_at', notnull: 0 },
      { name: 'valid_from', notnull: 0 },
      { name: 'valid_to', notnull: 0 },
      { name: 'fetched_at', notnull: 1 },
      { name: 'last_success_at', notnull: 0 },
      { name: 'availability', notnull: 1 },
      { name: 'source_version', notnull: 0 },
    ];

    for (const tableName of snapshotTables) {
      const columns = context.connection.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
        name: string;
        notnull: number;
        type: string;
      }>;

      for (const expected of expectedCommonColumns) {
        const found = columns.find((c) => c.name === expected.name);
        assert.ok(found, `Column ${expected.name} should exist in ${tableName}`);
        assert.equal(
          found.notnull,
          expected.notnull,
          `Column ${expected.name} in ${tableName} notnull mismatch`,
        );
        assert.equal(
          found.type.toUpperCase(),
          'TEXT',
          `Column ${expected.name} in ${tableName} type should be TEXT`,
        );
      }
    }

    context.close();
  } finally {
    cleanup();
  }
});

test('3. availability に不正値を挿入すると CHECK 違反になり、3値は保存できる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const insertSql = `
      INSERT INTO warning_current_snapshot (
        area_code, area_name, control_status, info_type, report_datetime, control_datetime,
        source, issued_at, fetched_at, availability
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    // 正常値の保存
    for (const avail of ['available', 'stale', 'unavailable']) {
      context.connection
        .prepare(insertSql)
        .run(
          `area-${avail}`,
          'テスト区域',
          'normal',
          '発表',
          '2026-09-09T00:00:00Z',
          '2026-09-09T00:00:00Z',
          'jma',
          '2026-09-09T00:00:00Z',
          '2026-09-09T00:00:00Z',
          avail,
        );
    }

    // 不正値の挿入は CHECK 制約違反
    assert.throws(() => {
      context.connection
        .prepare(insertSql)
        .run(
          'area-invalid',
          'テスト区域',
          'normal',
          '発表',
          '2026-09-09T00:00:00Z',
          '2026-09-09T00:00:00Z',
          'jma',
          '2026-09-09T00:00:00Z',
          '2026-09-09T00:00:00Z',
          'invalid_status',
        );
    }, /CHECK constraint failed/);

    context.close();
  } finally {
    cleanup();
  }
});

test('4. control_status に不正値を挿入すると CHECK 違反になり、normal/training/test は保存できる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const insertSql = `
      INSERT INTO warning_current_snapshot (
        area_code, area_name, control_status, info_type, report_datetime, control_datetime,
        source, issued_at, fetched_at, availability
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (const status of ['normal', 'training', 'test']) {
      context.connection
        .prepare(insertSql)
        .run(
          '1310800',
          '江東区',
          status,
          '発表',
          '2026-09-09T00:00:00Z',
          '2026-09-09T00:00:00Z',
          'jma',
          '2026-09-09T00:00:00Z',
          '2026-09-09T00:00:00Z',
          'available',
        );
    }

    assert.throws(() => {
      context.connection
        .prepare(insertSql)
        .run(
          '1310800',
          '江東区',
          'other',
          '発表',
          '2026-09-09T00:00:00Z',
          '2026-09-09T00:00:00Z',
          'jma',
          '2026-09-09T00:00:00Z',
          '2026-09-09T00:00:00Z',
          'available',
        );
    }, /CHECK constraint failed/);

    context.close();
  } finally {
    cleanup();
  }
});

test('5. 親スナップショットを削除すると明細行が ON DELETE CASCADE で削除される', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const foreignKeys = context.connection.prepare('PRAGMA foreign_keys').get() as {
      foreign_keys: number;
    };
    assert.equal(foreignKeys.foreign_keys, 1, 'PRAGMA foreign_keys must be 1');

    const result = context.connection
      .prepare(
        `
      INSERT INTO warning_current_snapshot (
        area_code, area_name, control_status, info_type, report_datetime, control_datetime,
        source, issued_at, fetched_at, availability
      ) VALUES ('1310800', '江東区', 'normal', '発表', '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z', 'jma', '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z', 'available')
    `,
      )
      .run();

    const snapshotId = Number(result.lastInsertRowid);

    context.connection
      .prepare(
        `
      INSERT INTO warning_current_item (
        snapshot_id, sequence, kind_code, kind_name, kind_status, source_telegram
      ) VALUES (?, 1, '03', '大雨警報', '発表', 'VPWW55')
    `,
      )
      .run(snapshotId);

    const countBefore = context.connection
      .prepare('SELECT COUNT(*) as c FROM warning_current_item WHERE snapshot_id = ?')
      .get(snapshotId) as { c: number };
    assert.equal(countBefore.c, 1);

    context.connection.prepare('DELETE FROM warning_current_snapshot WHERE id = ?').run(snapshotId);

    const countAfter = context.connection
      .prepare('SELECT COUNT(*) as c FROM warning_current_item WHERE snapshot_id = ?')
      .get(snapshotId) as { c: number };
    assert.equal(countAfter.c, 0, 'Items should be cascaded on snapshot deletion');

    context.close();
  } finally {
    cleanup();
  }
});

test('6. 親不在の明細挿入は外部キー違反になる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    assert.throws(() => {
      context.connection
        .prepare(
          `
          INSERT INTO warning_current_item (
            snapshot_id, sequence, kind_code, kind_name, kind_status, source_telegram
          ) VALUES (999999, 1, '03', '大雨警報', '発表', 'VPWW55')
        `,
        )
        .run();
    }, /FOREIGN KEY constraint failed/);

    context.close();
  } finally {
    cleanup();
  }
});

test('7. 自動削除トリガーが存在しない（sqlite_master の type=trigger が 0 件）', () => {
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

test('8. migration を2回適用しても再実行されない', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context1 = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });
    assert.equal(context1.migrationSummary.appliedVersions.length, 13);
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

test('9. migration ファイル内に BEGIN / COMMIT / ROLLBACK が含まれない', () => {
  const sqlFiles = readdirSync(migrationsDirectory).filter((file) => file.endsWith('.sql'));

  assert.equal(sqlFiles.length, 13, '13 migration files should exist');

  const forbiddenPattern = /^\s*(BEGIN|COMMIT|ROLLBACK)\b/im;
  for (const file of sqlFiles) {
    const content = readFileSync(join(migrationsDirectory, file), 'utf-8');
    assert.ok(
      !forbiddenPattern.test(content),
      `Migration ${file} must not contain BEGIN/COMMIT/ROLLBACK statements`,
    );
  }
});

test('10. bosai_bulletin_area に relation 列が存在しない', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const columns = context.connection
      .prepare('PRAGMA table_info(bosai_bulletin_area)')
      .all() as Array<{ name: string }>;

    const hasRelation = columns.some((c) => c.name === 'relation');
    assert.equal(hasRelation, false, 'bosai_bulletin_area must not have a relation column');

    context.close();
  } finally {
    cleanup();
  }
});
