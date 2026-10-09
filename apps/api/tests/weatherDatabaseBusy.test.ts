import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initializeRoleDatabase, openWeatherReader } from '../src/database/roleDatabase.js';
import {
  createTemporaryTestDatabaseFixture,
  createTestDatabasePairConfig,
} from './helpers/databasePair.js';

function setup() {
  const fixture = createTemporaryTestDatabaseFixture();
  const pair = createTestDatabasePairConfig(fixture.config);
  const writer = initializeRoleDatabase(pair, {
    pid: process.pid,
    role: 'weather',
    token: 'busy-test',
    startedAt: '2026-10-09T00:00:00.000Z',
    serverGenerationId: 'server',
    workerGeneration: 'worker',
    threadId: 1,
  });
  writer.connection.exec(
    'CREATE TABLE busy_probe (value INTEGER); INSERT INTO busy_probe VALUES (1)',
  );
  return { fixture, pair, writer };
}
function assertBusyWithinLimit(operation: () => unknown) {
  const started = performance.now();
  assert.throws(operation, { code: 'SQLITE_BUSY' });
  const elapsed = performance.now() - started;
  // SQLiteの100ms待機に、CI上のスケジューリング余裕を加えた実測上限。
  assert.ok(elapsed >= 75 && elapsed < 1000, `BUSY待機時間: ${elapsed}ms`);
}

test('weather writerは実書込競合で100ms後BUSY、WAL readerは同じ間も保存済み読取を返す', () => {
  const { fixture, pair, writer } = setup();
  const reader = openWeatherReader(pair.weather, writer.generation, writer.schemaVersion);
  const other = new Database(pair.weather.databasePath);
  try {
    assert.equal(writer.connection.pragma('busy_timeout', { simple: true }), 100);
    assert.equal(reader.pragma('busy_timeout', { simple: true }), 100);
    assert.equal(reader.pragma('query_only', { simple: true }), 1);
    other.exec('BEGIN IMMEDIATE; UPDATE busy_probe SET value=2');
    assertBusyWithinLimit(() => writer.connection.prepare('UPDATE busy_probe SET value=3').run());
    assert.deepEqual(reader.prepare('SELECT value FROM busy_probe').all(), [{ value: 1 }]);
    assert.throws(() => reader.prepare('UPDATE busy_probe SET value=4').run(), {
      code: 'SQLITE_READONLY',
    });
  } finally {
    if (other.inTransaction) other.exec('ROLLBACK');
    other.close();
    reader.close();
    writer.close();
    fixture.cleanup();
  }
});

test('readonly接続も実exclusiveロック競合で100ms後BUSYを返す', () => {
  const { fixture, pair, writer } = setup();
  const { generation, schemaVersion } = writer;
  writer.close();
  const locker = new Database(pair.weather.databasePath);
  // WALの通常writerはreaderを遮断しない。readerのBUSY検証だけrollback journalで競合を作る。
  locker.pragma('journal_mode = DELETE');
  const reader = openWeatherReader(pair.weather, generation, schemaVersion);
  try {
    assert.equal(reader.pragma('busy_timeout', { simple: true }), 100);
    locker.exec('BEGIN EXCLUSIVE; UPDATE busy_probe SET value=2');
    assertBusyWithinLimit(() => reader.prepare('SELECT value FROM busy_probe').all());
  } finally {
    if (locker.inTransaction) locker.exec('ROLLBACK');
    reader.close();
    locker.close();
    fixture.cleanup();
  }
});

test('長いreaderがWAL世代を保持しcheckpointがbusyでもcloseはsidecarを削除しない', async () => {
  const { fixture, pair, writer } = setup();
  const reader = openWeatherReader(pair.weather, writer.generation, writer.schemaVersion);
  try {
    reader.exec('BEGIN');
    assert.deepEqual(reader.prepare('SELECT value FROM busy_probe').all(), [{ value: 1 }]);
    writer.connection.exec('UPDATE busy_probe SET value=2');
    await new Promise((resolve) => setTimeout(resolve, 150));
    const checkpoint = writer.connection.pragma('wal_checkpoint(RESTART)') as { busy: number }[];
    assert.equal(checkpoint[0]!.busy, 1);
    const sidecars = ['-wal', '-shm'].map((suffix) => `${pair.weather.databasePath}${suffix}`);
    const inodes = sidecars.map((file) => statSync(file).ino);
    writer.close();
    assert.deepEqual(
      sidecars.map((file) => statSync(file).ino),
      inodes,
    );
    assert.deepEqual(reader.prepare('SELECT value FROM busy_probe').all(), [{ value: 1 }]);
    reader.exec('COMMIT');
    assert.deepEqual(reader.prepare('SELECT value FROM busy_probe').all(), [{ value: 2 }]);
  } finally {
    reader.close();
    writer.close();
    fixture.cleanup();
  }
});
