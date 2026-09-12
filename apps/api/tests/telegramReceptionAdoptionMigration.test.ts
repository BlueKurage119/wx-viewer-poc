import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeDatabase, runMigrations, type DatabaseContext } from '../src/database/index.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const realMigrationsDirectory = join(apiRoot, 'migrations');

/** 実物の migrations ディレクトリから指定バージョン以下のファイルだけを一時ディレクトリへコピーする。 */
function copyMigrationsUpTo(destDirectory: string, maxVersion: number): void {
  const entries = readdirSync(realMigrationsDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.sql')) continue;
    const match = /^(\d{4})_/.exec(entry.name);
    if (!match) continue;
    const version = Number(match[1]);
    if (version <= maxVersion) {
      copyFileSync(join(realMigrationsDirectory, entry.name), join(destDirectory, entry.name));
    }
  }
}

function copySingleMigration(destDirectory: string, filename: string): void {
  copyFileSync(join(realMigrationsDirectory, filename), join(destDirectory, filename));
}

function setupPreMigrationDb(): {
  context: DatabaseContext;
  migrationsDirectory: string;
  cleanup: () => void;
} {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-adoption-migration-'));
  const migrationsDirectory = join(directory, 'migrations');
  mkdirSync(migrationsDirectory);
  copyMigrationsUpTo(migrationsDirectory, 17);
  const databasePath = join(directory, 'test.sqlite3');
  const context = initializeDatabase({ databasePath, migrationsDirectory });
  return {
    context,
    migrationsDirectory,
    cleanup: () => {
      context.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('0018 移行: 採用済み1件はvenue_id=eastとして値ごと引き継がれ、未判定行は作られず、旧3列は消える', () => {
  const { context, migrationsDirectory, cleanup } = setupPreMigrationDb();
  try {
    // 旧形式（0010〜0017適用時点）の telegram_reception へ直接 INSERT する。
    const insertReception = context.connection.prepare(`
      INSERT INTO telegram_reception (
        document_url, received_at, adoption_result, adoption_reason, adoption_decided_at
      ) VALUES (?, ?, ?, ?, ?)
      RETURNING id
    `);

    const adoptedRow = insertReception.get(
      'https://example.test/adopted.xml',
      '2026-09-01T00:00:00Z',
      '警報・注意報として解析済み',
      null,
      '2026-09-01T00:00:05Z',
    ) as { id: number };

    const pendingRow = insertReception.get(
      'https://example.test/pending.xml',
      '2026-09-01T00:01:00Z',
      null,
      null,
      null,
    ) as { id: number };

    // 0018 を適用する。
    copySingleMigration(migrationsDirectory, '0018_create_telegram_reception_adoption.sql');
    runMigrations(context.connection, migrationsDirectory);

    // (a) 採用済み1件が venue_id='east' の行として値ごと一致する
    const adoptedRows = context.connection
      .prepare(
        'SELECT reception_id, venue_id, adoption_result, adoption_reason, adoption_decided_at FROM telegram_reception_adoption WHERE reception_id = ?',
      )
      .all(adoptedRow.id) as Array<{
      reception_id: number;
      venue_id: string;
      adoption_result: string | null;
      adoption_reason: string | null;
      adoption_decided_at: string | null;
    }>;
    assert.deepEqual(adoptedRows, [
      {
        reception_id: adoptedRow.id,
        venue_id: 'east',
        adoption_result: '警報・注意報として解析済み',
        adoption_reason: null,
        adoption_decided_at: '2026-09-01T00:00:05Z',
      },
    ]);

    // (b) 未判定行の採用行は0件
    const pendingRows = context.connection
      .prepare('SELECT * FROM telegram_reception_adoption WHERE reception_id = ?')
      .all(pendingRow.id);
    assert.equal(pendingRows.length, 0);

    // (c) trc 行は作られない
    const trcRows = context.connection
      .prepare("SELECT * FROM telegram_reception_adoption WHERE venue_id = 'trc'")
      .all();
    assert.equal(trcRows.length, 0);

    // (d) telegram_reception から旧3列が消えている
    const columns = context.connection
      .prepare('PRAGMA table_info(telegram_reception)')
      .all() as Array<{ name: string }>;
    const columnNames = columns.map((c) => c.name);
    assert.equal(columnNames.includes('adoption_result'), false);
    assert.equal(columnNames.includes('adoption_reason'), false);
    assert.equal(columnNames.includes('adoption_decided_at'), false);
  } finally {
    cleanup();
  }
});
