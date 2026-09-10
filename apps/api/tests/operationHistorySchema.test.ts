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
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-op-schema-test-'));
  const databasePath = join(directory, 'test.sqlite3');
  return {
    databasePath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test('1. 本番 migration をすべて適用すると operation_history が存在し、適用件数が 12 件と一致する', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const expectedSqlFiles = readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    assert.equal(expectedSqlFiles.length, 15);
    assert.equal(context.migrationSummary.appliedVersions.length, 15);

    const tables = (
      context.connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);

    assert.ok(tables.includes('operation_history'), 'operation_history should exist');

    context.close();
  } finally {
    cleanup();
  }
});

test('2. operation_history の PRAGMA table_info が設計書 §4.2 の 11 列と完全一致する', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const columns = context.connection
      .prepare('PRAGMA table_info(operation_history)')
      .all() as Array<{
      name: string;
      notnull: number;
      type: string;
      pk: number;
      dflt_value: string | null;
    }>;

    const expectedColumns = [
      { name: 'id', type: 'INTEGER', notnull: 0, pk: 1 },
      { name: 'request_id', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'operation_kind', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'target_kind', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'result', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'requested_at', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'completed_at', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'actor_id', type: 'TEXT', notnull: 0, pk: 0 },
      { name: 'actor_display_name', type: 'TEXT', notnull: 0, pk: 0 },
      { name: 'error_code', type: 'TEXT', notnull: 0, pk: 0 },
      { name: 'error_message', type: 'TEXT', notnull: 0, pk: 0 },
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

test('3. operation_kind は start / stop / force_refresh を、result は success / failure を保存でき、列挙外は CHECK 違反になる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const baseSql = `
      INSERT INTO operation_history (
        request_id, operation_kind, target_kind, result,
        requested_at, completed_at, actor_id, actor_display_name, error_code, error_message
      ) VALUES (?, ?, 'all', ?, '2026-09-09T00:00:00Z', '2026-09-09T00:00:01Z', NULL, NULL, NULL, NULL)
    `;

    // operation_kind: 3種別 OK
    context.connection.prepare(baseSql).run('req-start', 'start', 'success');
    context.connection.prepare(baseSql).run('req-stop', 'stop', 'success');
    context.connection.prepare(baseSql).run('req-refresh', 'force_refresh', 'failure');

    // 不正な operation_kind
    assert.throws(
      () => {
        context.connection.prepare(baseSql).run('req-invalid-kind', 'restart', 'success');
      },
      { message: /CHECK constraint failed/ },
    );

    // 不正な result
    assert.throws(
      () => {
        context.connection.prepare(baseSql).run('req-invalid-result', 'start', 'pending');
      },
      { message: /CHECK constraint failed/ },
    );

    context.close();
  } finally {
    cleanup();
  }
});

test('4. target_kind=all は保存でき、他値は CHECK 違反になる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const insertSql = `
      INSERT INTO operation_history (
        request_id, operation_kind, target_kind, result,
        requested_at, completed_at, actor_id, actor_display_name, error_code, error_message
      ) VALUES (?, 'start', ?, 'success', '2026-09-09T00:00:00Z', '2026-09-09T00:00:01Z', NULL, NULL, NULL, NULL)
    `;

    // target_kind = 'all': OK
    context.connection.prepare(insertSql).run('req-all', 'all');

    // target_kind != 'all': CHECK 違反
    assert.throws(
      () => {
        context.connection.prepare(insertSql).run('req-single', 'single');
      },
      { message: /CHECK constraint failed/ },
    );

    assert.throws(
      () => {
        context.connection.prepare(insertSql).run('req-warning', 'warning');
      },
      { message: /CHECK constraint failed/ },
    );

    context.close();
  } finally {
    cleanup();
  }
});

test('5. request_id の重複は UNIQUE 違反になり、異なる request_id の同種操作は 2 行保存できる。空文字は CHECK 違反', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const baseSql = `
      INSERT INTO operation_history (
        request_id, operation_kind, target_kind, result,
        requested_at, completed_at, actor_id, actor_display_name, error_code, error_message
      ) VALUES (?, 'force_refresh', 'all', 'success', '2026-09-09T00:00:00Z', '2026-09-09T00:00:01Z', NULL, NULL, NULL, NULL)
    `;

    // 1件目
    context.connection.prepare(baseSql).run('req-1');

    // 同一 request_id の重複: UNIQUE 違反
    assert.throws(
      () => {
        context.connection.prepare(baseSql).run('req-1');
      },
      { message: /UNIQUE constraint failed/ },
    );

    // 異なる request_id: 同種操作でも保存可能
    context.connection.prepare(baseSql).run('req-2');

    // 空文字 request_id: CHECK 違反
    assert.throws(
      () => {
        context.connection.prepare(baseSql).run('');
      },
      { message: /CHECK constraint failed/ },
    );

    const count = (
      context.connection.prepare('SELECT COUNT(*) as c FROM operation_history').get() as {
        c: number;
      }
    ).c;
    assert.equal(count, 2);

    context.close();
  } finally {
    cleanup();
  }
});

test('6. success / failure のいずれも error_code / error_message がともに NULL の行を保存できる。診断を保存する失敗行も保存でき、error_code・actor_id・actor_display_name の空文字は CHECK 違反', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const insertSql = `
      INSERT INTO operation_history (
        request_id, operation_kind, target_kind, result,
        requested_at, completed_at, actor_id, actor_display_name, error_code, error_message
      ) VALUES (?, 'start', 'all', ?, '2026-09-09T00:00:00Z', '2026-09-09T00:00:01Z', ?, ?, ?, ?)
    `;

    // success かつ error_code/error_message NULL
    context.connection.prepare(insertSql).run('req-succ-null', 'success', null, null, null, null);

    // failure かつ error_code/error_message NULL (確定事項)
    context.connection.prepare(insertSql).run('req-fail-null', 'failure', null, null, null, null);

    // failure かつ診断付き
    context.connection
      .prepare(insertSql)
      .run('req-fail-diag', 'failure', null, null, 'ERR_TIMEOUT', 'Connection timed out');

    // error_code の空文字: CHECK 違反
    assert.throws(
      () => {
        context.connection
          .prepare(insertSql)
          .run('req-err-empty', 'failure', null, null, '', 'Some error');
      },
      { message: /CHECK constraint failed/ },
    );

    // actor_id の空文字: CHECK 違反
    assert.throws(
      () => {
        context.connection
          .prepare(insertSql)
          .run('req-actor-empty', 'success', '', null, null, null);
      },
      { message: /CHECK constraint failed/ },
    );

    // actor_display_name の空文字: CHECK 違反
    assert.throws(
      () => {
        context.connection
          .prepare(insertSql)
          .run('req-actordisp-empty', 'success', null, '', null, null);
      },
      { message: /CHECK constraint failed/ },
    );

    // actor_id, actor_display_name の非空値は保存可能
    context.connection
      .prepare(insertSql)
      .run('req-actor-valid', 'success', 'user-001', '管理者A', null, null);

    context.close();
  } finally {
    cleanup();
  }
});

test('7. 外部キーが 0 件であり、表を対象とする trigger がない', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const foreignKeys = context.connection
      .prepare('PRAGMA foreign_key_list(operation_history)')
      .all();
    assert.equal(foreignKeys.length, 0);

    const triggers = context.connection
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'operation_history'",
      )
      .all();
    assert.equal(triggers.length, 0);

    context.close();
  } finally {
    cleanup();
  }
});

test('8. migration を 2 回実行すると 2 回目の appliedVersions が空で、1 回目の行が完全一致で残る', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    context.connection
      .prepare(
        `
        INSERT INTO operation_history (
          request_id, operation_kind, target_kind, result,
          requested_at, completed_at, actor_id, actor_display_name, error_code, error_message
        ) VALUES (
          'req-persist', 'stop', 'all', 'success',
          '2026-09-09T00:00:00Z', '2026-09-09T00:00:01Z',
          NULL, NULL, NULL, NULL
        )
      `,
      )
      .run();

    const secondSummary = runMigrations(context.connection, migrationsDirectory);

    assert.equal(secondSummary.appliedVersions.length, 0);

    const row = context.connection
      .prepare('SELECT * FROM operation_history WHERE request_id = ?')
      .get('req-persist') as Record<string, unknown>;

    assert.equal(row.request_id, 'req-persist');
    assert.equal(row.operation_kind, 'stop');
    assert.equal(row.target_kind, 'all');
    assert.equal(row.result, 'success');
    assert.equal(row.requested_at, '2026-09-09T00:00:00Z');
    assert.equal(row.completed_at, '2026-09-09T00:00:01Z');
    assert.equal(row.actor_id, null);
    assert.equal(row.actor_display_name, null);
    assert.equal(row.error_code, null);
    assert.equal(row.error_message, null);

    context.close();
  } finally {
    cleanup();
  }
});
