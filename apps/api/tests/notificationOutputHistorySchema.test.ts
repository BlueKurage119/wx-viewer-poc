import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeDatabase, runMigrations } from '../src/database/index.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

function createTempDbPath(): { databasePath: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-notification-schema-test-'));
  const databasePath = join(directory, 'test.sqlite3');
  return {
    databasePath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test('1. 本番 migration をすべて適用すると notification_output_history が存在し、適用件数が 12 件と一致する', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const expectedSqlFiles = readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    assert.equal(expectedSqlFiles.length, 12);
    assert.equal(context.migrationSummary.appliedVersions.length, 12);

    const tables = (
      context.connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);

    assert.ok(
      tables.includes('notification_output_history'),
      'notification_output_history should exist',
    );

    context.close();
  } finally {
    cleanup();
  }
});

test('2. notification_output_history の PRAGMA table_info が設計書 §4.2 の 17 列と完全一致する', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const columns = context.connection
      .prepare('PRAGMA table_info(notification_output_history)')
      .all() as Array<{
      name: string;
      notnull: number;
      type: string;
      pk: number;
      dflt_value: string | null;
    }>;

    const expectedColumns = [
      { name: 'id', type: 'INTEGER', notnull: 0, pk: 1 },
      { name: 'notification_id', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'category', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'source_type', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'source_version', type: 'TEXT', notnull: 0, pk: 0 },
      { name: 'target_area_json', type: 'TEXT', notnull: 0, pk: 0 },
      { name: 'occurred_at', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'detected_at', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'change_type', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'ack_required', type: 'INTEGER', notnull: 1, pk: 0 },
      { name: 'summary', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'related_refs_json', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'origin', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'detection_context', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'is_training', type: 'INTEGER', notnull: 1, pk: 0 },
      { name: 'message_definition_id', type: 'TEXT', notnull: 0, pk: 0 },
      { name: 'message_definition_version', type: 'TEXT', notnull: 0, pk: 0 },
    ];

    assert.equal(columns.length, expectedColumns.length);

    for (let i = 0; i < expectedColumns.length; i++) {
      const actual = columns[i];
      const expected = expectedColumns[i];
      assert.equal(actual.name, expected.name, `Column index ${i} name mismatch`);
      assert.equal(
        actual.type.toUpperCase(),
        expected.type,
        `Column ${expected.name} type mismatch`,
      );
      assert.equal(actual.notnull, expected.notnull, `Column ${expected.name} notnull mismatch`);
      assert.equal(actual.pk, expected.pk, `Column ${expected.name} pk mismatch`);
    }

    context.close();
  } finally {
    cleanup();
  }
});

test('3. origin は weather / system を保存でき、それ以外は CHECK 違反になる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const baseSql = `
      INSERT INTO notification_output_history (
        notification_id, category, source_type, source_version, target_area_json,
        occurred_at, detected_at, change_type, ack_required, summary,
        related_refs_json, origin, detection_context, is_training,
        message_definition_id, message_definition_version
      ) VALUES (?, 'warning', 'warning_current', NULL, NULL, '2026-09-09T00:00:00Z', '2026-09-09T00:00:01Z', 'new', 0, '警報発表', '[]', ?, 'normal', 0, NULL, NULL)
    `;

    // weather: OK
    context.connection.prepare(baseSql).run('nid-weather', 'weather');

    // system: OK
    context.connection.prepare(baseSql).run('nid-system', 'system');

    // 列挙外: CHECK 違反
    assert.throws(
      () => {
        context.connection.prepare(baseSql).run('nid-invalid', 'equipment');
      },
      { message: /CHECK constraint failed/ },
    );

    context.close();
  } finally {
    cleanup();
  }
});

test('4. detection_context は normal / initial を保存でき、それ以外は CHECK 違反になる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const baseSql = `
      INSERT INTO notification_output_history (
        notification_id, category, source_type, source_version, target_area_json,
        occurred_at, detected_at, change_type, ack_required, summary,
        related_refs_json, origin, detection_context, is_training,
        message_definition_id, message_definition_version
      ) VALUES (?, 'warning', 'warning_current', NULL, NULL, '2026-09-09T00:00:00Z', '2026-09-09T00:00:01Z', 'new', 0, '警報発表', '[]', 'weather', ?, 0, NULL, NULL)
    `;

    // normal: OK
    context.connection.prepare(baseSql).run('nid-normal', 'normal');

    // initial: OK
    context.connection.prepare(baseSql).run('nid-initial', 'initial');

    // 列挙外: CHECK 違反
    assert.throws(
      () => {
        context.connection.prepare(baseSql).run('nid-invalid-context', 'startup');
      },
      { message: /CHECK constraint failed/ },
    );

    context.close();
  } finally {
    cleanup();
  }
});

test('5. ack_required / is_training は 0 / 1 を保存でき、それ以外は CHECK 違反になる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const baseSql = `
      INSERT INTO notification_output_history (
        notification_id, category, source_type, source_version, target_area_json,
        occurred_at, detected_at, change_type, ack_required, summary,
        related_refs_json, origin, detection_context, is_training,
        message_definition_id, message_definition_version
      ) VALUES (?, 'warning', 'warning_current', NULL, NULL, '2026-09-09T00:00:00Z', '2026-09-09T00:00:01Z', 'new', ?, '警報発表', '[]', 'weather', 'normal', ?, NULL, NULL)
    `;

    // 0, 0: OK
    context.connection.prepare(baseSql).run('nid-0-0', 0, 0);
    // 1, 1: OK
    context.connection.prepare(baseSql).run('nid-1-1', 1, 1);

    // ack_required = 2: CHECK 違反
    assert.throws(
      () => {
        context.connection.prepare(baseSql).run('nid-ack-2', 2, 0);
      },
      { message: /CHECK constraint failed/ },
    );

    // ack_required = -1: CHECK 違反
    assert.throws(
      () => {
        context.connection.prepare(baseSql).run('nid-ack-neg', -1, 0);
      },
      { message: /CHECK constraint failed/ },
    );

    // is_training = 2: CHECK 違反
    assert.throws(
      () => {
        context.connection.prepare(baseSql).run('nid-train-2', 0, 2);
      },
      { message: /CHECK constraint failed/ },
    );

    // is_training = -1: CHECK 違反
    assert.throws(
      () => {
        context.connection.prepare(baseSql).run('nid-train-neg', 0, -1);
      },
      { message: /CHECK constraint failed/ },
    );

    context.close();
  } finally {
    cleanup();
  }
});

test('6. message_definition_id / message_definition_version は両方 NULL または両方非 NULL を保存でき、片方だけは CHECK 違反になる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const baseSql = `
      INSERT INTO notification_output_history (
        notification_id, category, source_type, source_version, target_area_json,
        occurred_at, detected_at, change_type, ack_required, summary,
        related_refs_json, origin, detection_context, is_training,
        message_definition_id, message_definition_version
      ) VALUES (?, 'warning', 'warning_current', NULL, NULL, '2026-09-09T00:00:00Z', '2026-09-09T00:00:01Z', 'new', 0, '警報発表', '[]', 'weather', 'normal', 0, ?, ?)
    `;

    // 両方 NULL: OK
    context.connection.prepare(baseSql).run('nid-both-null', null, null);

    // 両方非 NULL: OK
    context.connection.prepare(baseSql).run('nid-both-present', 'def-001', 'v1.0');

    // ID だけ非 NULL: CHECK 違反
    assert.throws(
      () => {
        context.connection.prepare(baseSql).run('nid-id-only', 'def-001', null);
      },
      { message: /CHECK constraint failed/ },
    );

    // Version だけ非 NULL: CHECK 違反
    assert.throws(
      () => {
        context.connection.prepare(baseSql).run('nid-ver-only', null, 'v1.0');
      },
      { message: /CHECK constraint failed/ },
    );

    context.close();
  } finally {
    cleanup();
  }
});

test('7. 同じ notification_id を 2 回 INSERT すると UNIQUE 違反になり、先の 1 行が変化しない', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const baseSql = `
      INSERT INTO notification_output_history (
        notification_id, category, source_type, source_version, target_area_json,
        occurred_at, detected_at, change_type, ack_required, summary,
        related_refs_json, origin, detection_context, is_training,
        message_definition_id, message_definition_version
      ) VALUES (?, 'warning', 'warning_current', NULL, NULL, '2026-09-09T00:00:00Z', '2026-09-09T00:00:01Z', 'new', 0, ?, '[]', 'weather', 'normal', 0, NULL, NULL)
    `;

    context.connection.prepare(baseSql).run('nid-dup', '最初のサマリ');

    assert.throws(
      () => {
        context.connection.prepare(baseSql).run('nid-dup', '2回目のサマリ');
      },
      { message: /UNIQUE constraint failed/ },
    );

    const row = context.connection
      .prepare('SELECT summary FROM notification_output_history WHERE notification_id = ?')
      .get('nid-dup') as { summary: string };
    assert.equal(row.summary, '最初のサマリ');

    context.close();
  } finally {
    cleanup();
  }
});

test('8. 同じ source_type / source_version の別 notification_id は 2 行保存できる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const baseSql = `
      INSERT INTO notification_output_history (
        notification_id, category, source_type, source_version, target_area_json,
        occurred_at, detected_at, change_type, ack_required, summary,
        related_refs_json, origin, detection_context, is_training,
        message_definition_id, message_definition_version
      ) VALUES (?, 'warning', 'warning_current', 'ver-1.0', NULL, '2026-09-09T00:00:00Z', '2026-09-09T00:00:01Z', 'new', 0, '警報発表', '[]', 'weather', 'normal', 0, NULL, NULL)
    `;

    context.connection.prepare(baseSql).run('nid-1');
    context.connection.prepare(baseSql).run('nid-2');

    const count = context.connection
      .prepare(
        'SELECT COUNT(*) as count FROM notification_output_history WHERE source_type = ? AND source_version = ?',
      )
      .get('warning_current', 'ver-1.0') as { count: number };
    assert.equal(count.count, 2);

    context.close();
  } finally {
    cleanup();
  }
});

test('9. sqlite_master に本表を対象とする trigger がなく、自動削除・自動更新がない', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const triggers = context.connection
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'notification_output_history'",
      )
      .all();
    assert.equal(triggers.length, 0);

    context.close();
  } finally {
    cleanup();
  }
});

test('10. PRAGMA foreign_key_list(notification_output_history) が 0 件で、B2／B3／Issue #103 の実装へ依存しない', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const foreignKeys = context.connection
      .prepare('PRAGMA foreign_key_list(notification_output_history)')
      .all();
    assert.equal(foreignKeys.length, 0);

    context.close();
  } finally {
    cleanup();
  }
});

test('11. migration を 2 回実行すると 2 回目の appliedVersions が空で、1 回目に保存した行が残る', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const insertSql = `
      INSERT INTO notification_output_history (
        notification_id, category, source_type, source_version, target_area_json,
        occurred_at, detected_at, change_type, ack_required, summary,
        related_refs_json, origin, detection_context, is_training,
        message_definition_id, message_definition_version
      ) VALUES ('nid-idempotent', 'warning', 'warning_current', NULL, NULL, '2026-09-09T00:00:00Z', '2026-09-09T00:00:01Z', 'new', 0, '警報発表', '[]', 'weather', 'normal', 0, NULL, NULL)
    `;
    context.connection.prepare(insertSql).run();

    // 2 回目の migration 実行
    const secondRun = runMigrations(context.connection, migrationsDirectory);
    assert.equal(secondRun.appliedVersions.length, 0);

    const row = context.connection
      .prepare('SELECT summary FROM notification_output_history WHERE notification_id = ?')
      .get('nid-idempotent') as { summary: string };
    assert.equal(row.summary, '警報発表');

    context.close();
  } finally {
    cleanup();
  }
});
