import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeDatabase, openDatabase, runMigrations } from '../src/database/index.js';
import {
  findBosaiBulletin,
  saveBosaiBulletin,
} from '../src/repositories/bosaiBulletinRepository.js';
import { findAmedasSnapshot, saveAmedasSnapshot } from '../src/repositories/amedasRepository.js';

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

    assert.equal(expectedSqlFiles.length, 20);
    assert.equal(context.migrationSummary.appliedVersions.length, 20);

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
    assert.equal(context1.migrationSummary.appliedVersions.length, 20);
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

  assert.equal(sqlFiles.length, 20, '20 migration files should exist');

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

test('11. warning_timeseries_value の列定義が設計書 §4 と一致し、kind_code/kind_name が nullable である', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const columns = context.connection
      .prepare('PRAGMA table_info(warning_timeseries_value)')
      .all() as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
      pk: number;
    }>;

    const colMap = new Map(columns.map((c) => [c.name, c]));

    // 全18列
    assert.equal(columns.length, 18);

    // nullable に緩和された列
    assert.equal(colMap.get('kind_code')?.notnull, 0, 'kind_code は nullable であること');
    assert.equal(colMap.get('kind_name')?.notnull, 0, 'kind_name は nullable であること');

    // 新規追加された列
    assert.ok(colMap.has('kind_datetime'), 'kind_datetime 列が存在すること');
    assert.equal(colMap.get('kind_datetime')?.type, 'TEXT');
    assert.equal(colMap.get('kind_datetime')?.notnull, 0);

    assert.ok(colMap.has('value_code'), 'value_code 列が存在すること');
    assert.equal(colMap.get('value_code')?.type, 'TEXT');
    assert.equal(colMap.get('value_code')?.notnull, 0);

    assert.ok(colMap.has('description'), 'description 列が存在すること');
    assert.equal(colMap.get('description')?.type, 'TEXT');
    assert.equal(colMap.get('description')?.notnull, 0);

    assert.ok(colMap.has('condition'), 'condition 列が存在すること');
    assert.equal(colMap.get('condition')?.type, 'TEXT');
    assert.equal(colMap.get('condition')?.notnull, 0);

    context.close();
  } finally {
    cleanup();
  }
});

test('12. migration 0014 適用前に保存された warning_timeseries_value データが保持され、新列が null になる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    // 0013 までのマイグレーション用ディレクトリを作成
    const tempMigrationsDir = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-partial-migrations-'));
    const sqlFiles = readdirSync(migrationsDirectory)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    // 0001〜0013 までをコピー
    for (const f of sqlFiles.slice(0, 13)) {
      writeFileSync(join(tempMigrationsDir, f), readFileSync(join(migrationsDirectory, f)));
    }

    const connection = openDatabase(databasePath);
    const summary1 = runMigrations(connection, tempMigrationsDir);
    assert.equal(summary1.appliedVersions.length, 13);

    // 0013 までの状態でデータを投入
    connection.exec(`
      INSERT INTO warning_timeseries_snapshot (
        id, area_code, area_name, control_status, info_type, report_datetime, control_datetime,
        source, issued_at, fetched_at, availability
      ) VALUES (
        1, '1310800', '江東区', 'normal', '発表', '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z',
        'http://example.com/test.xml', '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z', 'available'
      );
      INSERT INTO warning_timeseries_time_define (
        id, snapshot_id, block_id, time_id, sequence, time_from, time_to, duration
      ) VALUES (
        1, 1, 'block-1', '1', 1, '2026-09-09T00:00:00Z', '2026-09-09T03:00:00Z', 'PT3H'
      );
      INSERT INTO warning_timeseries_value (
        id, snapshot_id, block_id, ref_id, kind_code, kind_name, kind_status,
        value_category, property_type, value_type, value_text, unit, area_division, sequence
      ) VALUES (
        1, 1, 'block-1', '1', '03', '大雨警報', '発表',
        'risk', '雨', '警報級', '警報', NULL, NULL, 1
      );
    `);

    // 0014 を追加して migration を実行
    writeFileSync(
      join(tempMigrationsDir, sqlFiles[13]!),
      readFileSync(join(migrationsDirectory, sqlFiles[13]!)),
    );
    const summary2 = runMigrations(connection, tempMigrationsDir);
    assert.equal(summary2.appliedVersions.length, 1);
    assert.equal(summary2.appliedVersions[0], 14);

    // データが保持されていることを確認
    const row = connection
      .prepare('SELECT * FROM warning_timeseries_value WHERE id = 1')
      .get() as Record<string, unknown>;

    assert.equal(row.id, 1);
    assert.equal(row.snapshot_id, 1);
    assert.equal(row.block_id, 'block-1');
    assert.equal(row.ref_id, '1');
    assert.equal(row.kind_code, '03');
    assert.equal(row.kind_name, '大雨警報');
    assert.equal(row.kind_status, '発表');
    assert.equal(row.kind_datetime, null, '新列 kind_datetime は null');
    assert.equal(row.value_code, null, '新列 value_code は null');
    assert.equal(row.description, null, '新列 description は null');
    assert.equal(row.condition, null, '新列 condition は null');
    assert.equal(row.value_text, '警報');

    // 外部キー制約が有効であることを確認（FOREIGN KEY エラーにならない）
    const fkCheck = connection.prepare('PRAGMA foreign_key_check').all();
    assert.equal(fkCheck.length, 0, '外部キー整合性が保たれていること');

    connection.close();
    rmSync(tempMigrationsDir, { recursive: true, force: true });
  } finally {
    cleanup();
  }
});

test('13. migration 0015 適用で bosai_bulletin の headline_text / information_tag が nullable になり、既存データとFK関係が保持される', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    // 0014 までのマイグレーション用ディレクトリを作成
    const tempMigrationsDir = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-partial-migrations-0014-'));
    const sqlFiles = readdirSync(migrationsDirectory)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    // 0001〜0014 までをコピー
    for (const f of sqlFiles.slice(0, 14)) {
      writeFileSync(join(tempMigrationsDir, f), readFileSync(join(migrationsDirectory, f)));
    }

    const connection = openDatabase(databasePath);
    const summary1 = runMigrations(connection, tempMigrationsDir);
    assert.equal(summary1.appliedVersions.length, 14);

    // 0014 までの状態で親1行・子1行を投入
    connection.exec(`
      INSERT INTO bosai_bulletin (
        id, event_id, control_status, info_type, report_datetime, control_datetime,
        title, headline_text, information_tag, is_cancelled,
        source, issued_at, fetched_at, availability
      ) VALUES (
        1, 'EVENT_001', 'normal', '発表', '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z',
        '気象防災速報テスト', '本文テキスト', '線状降水帯発生', 0,
        'http://example.com/test.xml', '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z', 'available'
      );
      INSERT INTO bosai_bulletin_area (
        id, bulletin_id, area_code, area_name, code_type, sequence
      ) VALUES (
        1, 1, '1310800', '江東区', '気象・地震・火山情報／市町村等', 0
      );
    `);

    // 0015 を追加して migration を実行
    writeFileSync(
      join(tempMigrationsDir, sqlFiles[14]!),
      readFileSync(join(migrationsDirectory, sqlFiles[14]!)),
    );
    const summary2 = runMigrations(connection, tempMigrationsDir);
    assert.equal(summary2.appliedVersions.length, 1);
    assert.equal(summary2.appliedVersions[0], 15);

    // 親1行・子1行のデータが保持されていることを確認
    const parentRow = connection
      .prepare('SELECT * FROM bosai_bulletin WHERE id = 1')
      .get() as Record<string, unknown>;
    assert.equal(parentRow.id, 1);
    assert.equal(parentRow.event_id, 'EVENT_001');
    assert.equal(parentRow.headline_text, '本文テキスト');
    assert.equal(parentRow.information_tag, '線状降水帯発生');

    const childRow = connection
      .prepare('SELECT * FROM bosai_bulletin_area WHERE id = 1')
      .get() as Record<string, unknown>;
    assert.equal(childRow.id, 1);
    assert.equal(childRow.bulletin_id, 1);
    assert.equal(childRow.area_code, '1310800');

    // FK 参照先が bosai_bulletin になっていることを確認
    const areaSqlRow = connection
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='bosai_bulletin_area'")
      .get() as { sql: string };
    assert.ok(
      areaSqlRow.sql.includes('REFERENCES "bosai_bulletin"') ||
        areaSqlRow.sql.includes('REFERENCES bosai_bulletin('),
      `FK 参照先が bosai_bulletin であること (sql: ${areaSqlRow.sql})`,
    );

    // 外部キー整合性が保たれていること
    const fkCheck = connection.prepare('PRAGMA foreign_key_check').all();
    assert.equal(fkCheck.length, 0, '外部キー整合性が保たれていること');

    // headline_text / information_tag が NULL の行を INSERT できること
    connection.exec(`
      INSERT INTO bosai_bulletin (
        id, event_id, control_status, info_type, report_datetime, control_datetime,
        title, headline_text, information_tag, is_cancelled,
        source, issued_at, fetched_at, availability
      ) VALUES (
        2, 'EVENT_002', 'normal', '取消', '2026-09-09T01:00:00Z', '2026-09-09T01:00:00Z',
        '気象防災速報取消テスト', NULL, NULL, 1,
        'http://example.com/test2.xml', '2026-09-09T01:00:00Z', '2026-09-09T01:00:00Z', 'available'
      );
    `);
    const nullRow = connection
      .prepare('SELECT headline_text, information_tag FROM bosai_bulletin WHERE id = 2')
      .get() as Record<string, unknown>;
    assert.equal(nullRow.headline_text, null);
    assert.equal(nullRow.information_tag, null);

    connection.close();
    rmSync(tempMigrationsDir, { recursive: true, force: true });
  } finally {
    cleanup();
  }
});

test('14. migration 0016 適用で has_sighting 列が追加され、既存行は NULL になり、CHECK 制約および読み戻しが正しく動作する', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    // 0015 までのマイグレーション用ディレクトリを作成
    const tempMigrationsDir = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-partial-migrations-0015-'));
    const sqlFiles = readdirSync(migrationsDirectory)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    // 0001〜0015 までをコピー
    for (const f of sqlFiles.slice(0, 15)) {
      writeFileSync(join(tempMigrationsDir, f), readFileSync(join(migrationsDirectory, f)));
    }

    const connection = openDatabase(databasePath);
    const summary1 = runMigrations(connection, tempMigrationsDir);
    assert.equal(summary1.appliedVersions.length, 15);

    // 0015 までの状態で親1行・子1行を投入
    connection.exec(`
      INSERT INTO bosai_bulletin (
        id, event_id, control_status, info_type, report_datetime, control_datetime,
        title, headline_text, information_tag, is_cancelled,
        source, issued_at, fetched_at, availability
      ) VALUES (
        1, 'EVENT_001', 'normal', '発表', '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z',
        '気象防災速報テスト', '本文テキスト', '線状降水帯発生', 0,
        'http://example.com/test.xml', '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z', 'available'
      );
      INSERT INTO bosai_bulletin_area (
        id, bulletin_id, area_code, area_name, code_type, sequence
      ) VALUES (
        1, 1, '1310800', '江東区', '気象・地震・火山情報／市町村等', 0
      );
    `);

    // 0016 を追加して migration を実行
    writeFileSync(
      join(tempMigrationsDir, sqlFiles[15]!),
      readFileSync(join(migrationsDirectory, sqlFiles[15]!)),
    );
    const summary2 = runMigrations(connection, tempMigrationsDir);
    assert.equal(summary2.appliedVersions.length, 1);
    assert.equal(summary2.appliedVersions[0], 16);

    // 親1行・子1行のデータが保持され、既存行の has_sighting が NULL であること
    const parentRow = connection
      .prepare('SELECT * FROM bosai_bulletin WHERE id = 1')
      .get() as Record<string, unknown>;
    assert.equal(parentRow.id, 1);
    assert.equal(parentRow.event_id, 'EVENT_001');
    assert.equal(parentRow.has_sighting, null);

    const childRow = connection
      .prepare('SELECT * FROM bosai_bulletin_area WHERE id = 1')
      .get() as Record<string, unknown>;
    assert.equal(childRow.id, 1);
    assert.equal(childRow.bulletin_id, 1);

    // PRAGMA foreign_key_check が無出力であること
    const fkCheck = connection.prepare('PRAGMA foreign_key_check').all();
    assert.equal(fkCheck.length, 0, '外部キー整合性が保たれていること');

    // has_sighting に 1 / 0 / NULL を保存でき、findBosaiBulletin で true / false / null として読み戻せること
    saveBosaiBulletin(connection, {
      eventId: 'EVENT_SIGHTING_1',
      controlStatus: 'normal',
      infoType: '発表',
      reportDateTime: '2026-09-09T00:00:00Z',
      controlDateTime: '2026-09-09T00:00:00Z',
      title: '竜巻速報1',
      headlineText: '竜巻目撃あり',
      informationTag: '竜巻注意情報',
      hasSighting: true,
      isCancelled: false,
      metadata: {
        source: 'http://example.com/test_vphw.xml',
        issuedAt: '2026-09-09T00:00:00Z',
        validAt: '2026-09-09T01:00:00Z',
        validFrom: null,
        validTo: null,
        fetchedAt: '2026-09-09T00:00:00Z',
        lastSuccessAt: '2026-09-09T00:00:00Z',
        availability: 'available',
        sourceVersion: '1.1_0',
      },
      areas: [],
    });
    const found1 = findBosaiBulletin(connection, 'EVENT_SIGHTING_1', 'normal');
    assert.ok(found1);
    assert.equal(found1.hasSighting, true);

    saveBosaiBulletin(connection, {
      eventId: 'EVENT_SIGHTING_0',
      controlStatus: 'normal',
      infoType: '発表',
      reportDateTime: '2026-09-09T00:00:00Z',
      controlDateTime: '2026-09-09T00:00:00Z',
      title: '竜巻速報0',
      headlineText: '竜巻目撃なし',
      informationTag: '竜巻注意情報',
      hasSighting: false,
      isCancelled: false,
      metadata: {
        source: 'http://example.com/test_vphw.xml',
        issuedAt: '2026-09-09T00:00:00Z',
        validAt: '2026-09-09T01:00:00Z',
        validFrom: null,
        validTo: null,
        fetchedAt: '2026-09-09T00:00:00Z',
        lastSuccessAt: '2026-09-09T00:00:00Z',
        availability: 'available',
        sourceVersion: '1.1_0',
      },
      areas: [],
    });
    const found0 = findBosaiBulletin(connection, 'EVENT_SIGHTING_0', 'normal');
    assert.ok(found0);
    assert.equal(found0.hasSighting, false);

    saveBosaiBulletin(connection, {
      eventId: 'EVENT_SIGHTING_NULL',
      controlStatus: 'normal',
      infoType: '発表',
      reportDateTime: '2026-09-09T00:00:00Z',
      controlDateTime: '2026-09-09T00:00:00Z',
      title: '竜巻速報NULL',
      headlineText: '判定不能',
      informationTag: '竜巻注意情報',
      hasSighting: null,
      isCancelled: false,
      metadata: {
        source: 'http://example.com/test_vphw.xml',
        issuedAt: '2026-09-09T00:00:00Z',
        validAt: '2026-09-09T01:00:00Z',
        validFrom: null,
        validTo: null,
        fetchedAt: '2026-09-09T00:00:00Z',
        lastSuccessAt: '2026-09-09T00:00:00Z',
        availability: 'available',
        sourceVersion: '1.0_0',
      },
      areas: [],
    });
    const foundNull = findBosaiBulletin(connection, 'EVENT_SIGHTING_NULL', 'normal');
    assert.ok(foundNull);
    assert.equal(foundNull.hasSighting, null);

    // has_sighting = 5 を直接 SQL で INSERT すると CHECK constraint failed で拒否されること
    assert.throws(() => {
      connection.exec(`
        INSERT INTO bosai_bulletin (
          id, event_id, control_status, info_type, report_datetime, control_datetime,
          title, headline_text, information_tag, has_sighting, is_cancelled,
          source, issued_at, fetched_at, availability
        ) VALUES (
          99, 'EVENT_CHECK_FAIL', 'normal', '発表', '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z',
          'CHECKテスト', '本文', '竜巻注意情報', 5, 0,
          'http://example.com/test.xml', '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z', 'available'
        );
      `);
    }, /CHECK constraint failed: has_sighting IN \(0, 1\)/);

    connection.close();
    rmSync(tempMigrationsDir, { recursive: true, force: true });
  } finally {
    cleanup();
  }
});

test('15. migration 0017 適用で amedas_observation に is_estimated 列が追加され、既存行は 0 になり、CHECK 制約および読み戻しが正しく動作する', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    // 0016 までのマイグレーション用ディレクトリを作成
    const tempMigrationsDir = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-partial-migrations-0016-'));
    const sqlFiles = readdirSync(migrationsDirectory)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    // 0001〜0016 までをコピー
    for (const f of sqlFiles.slice(0, 16)) {
      writeFileSync(join(tempMigrationsDir, f), readFileSync(join(migrationsDirectory, f)));
    }

    const connection = openDatabase(databasePath);
    const summary1 = runMigrations(connection, tempMigrationsDir);
    assert.equal(summary1.appliedVersions.length, 16);

    // 0016 までの状態で親1行・子1行を投入
    connection.exec(`
      INSERT INTO amedas_snapshot (
        id, station_code, station_name, source, issued_at, fetched_at, availability
      ) VALUES (
        1, '44136', '江戸川臨海', 'http://example.com/test.json',
        '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z', 'available'
      );
      INSERT INTO amedas_observation (
        id, snapshot_id, observed_at, element, value_number, quality_flag
      ) VALUES (
        1, 1, '2026-09-09T00:00:00Z', 'temp', 25.4, 0
      );
    `);

    // 0017 を追加して migration を実行
    writeFileSync(
      join(tempMigrationsDir, sqlFiles[16]!),
      readFileSync(join(migrationsDirectory, sqlFiles[16]!)),
    );
    const summary2 = runMigrations(connection, tempMigrationsDir);
    assert.equal(summary2.appliedVersions.length, 1);
    assert.equal(summary2.appliedVersions[0], 17);

    // 既存行の is_estimated が 0 であること
    const obsRow = connection
      .prepare('SELECT * FROM amedas_observation WHERE id = 1')
      .get() as Record<string, unknown>;
    assert.equal(obsRow.id, 1);
    assert.equal(obsRow.element, 'temp');
    assert.equal(obsRow.is_estimated, 0);

    // PRAGMA table_info(amedas_observation) の検証
    const tableInfo = connection.prepare('PRAGMA table_info(amedas_observation)').all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
    }>;
    const isEstimatedCol = tableInfo.find((col) => col.name === 'is_estimated');
    assert.ok(isEstimatedCol);
    assert.equal(isEstimatedCol.notnull, 1);
    assert.equal(String(isEstimatedCol.dflt_value), '0');

    // PRAGMA foreign_key_check が無出力であること
    const fkCheck = connection.prepare('PRAGMA foreign_key_check').all();
    assert.equal(fkCheck.length, 0, '外部キー整合性が保たれていること');

    // isEstimated に true / false を保存でき、findAmedasSnapshot で読み戻せること
    saveAmedasSnapshot(connection, {
      stationCode: '44136',
      stationName: '江戸川臨海',
      metadata: {
        source: 'http://example.com/test.json',
        issuedAt: '2026-09-09T01:00:00Z',
        validAt: '2026-09-09T01:00:00Z',
        validFrom: null,
        validTo: null,
        fetchedAt: '2026-09-09T01:00:00Z',
        lastSuccessAt: '2026-09-09T01:00:00Z',
        availability: 'available',
        sourceVersion: null,
      },
      observations: [
        {
          observedAt: '2026-09-09T01:00:00Z',
          element: 'sun10m',
          valueNumber: 10,
          valueText: null,
          qualityFlag: 0,
          isEstimated: true,
        },
        {
          observedAt: '2026-09-09T01:00:00Z',
          element: 'temp',
          valueNumber: 26.0,
          valueText: null,
          qualityFlag: 0,
          isEstimated: false,
        },
      ],
    });

    const found = findAmedasSnapshot(connection, '44136');
    assert.ok(found);
    const sunObs = found.observations.find((o) => o.element === 'sun10m');
    assert.ok(sunObs);
    assert.equal(sunObs.isEstimated, true);
    const tempObs = found.observations.find((o) => o.element === 'temp');
    assert.ok(tempObs);
    assert.equal(tempObs.isEstimated, false);

    // is_estimated = 2 を直接 SQL で INSERT すると CHECK constraint failed で拒否されること
    assert.throws(() => {
      connection.exec(`
        INSERT INTO amedas_observation (
          id, snapshot_id, observed_at, element, value_number, quality_flag, is_estimated
        ) VALUES (
          99, 1, '2026-09-09T02:00:00Z', 'temp', 27.0, 0, 2
        );
      `);
    }, /CHECK constraint failed/);

    connection.close();
    rmSync(tempMigrationsDir, { recursive: true, force: true });
  } finally {
    cleanup();
  }
});
