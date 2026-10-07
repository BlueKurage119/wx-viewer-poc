import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { initializeDatabases, resolveDatabasePairConfig } from '../src/database/index.js';
import { acquireWriterLeases } from '../src/database/pairSafety.js';
import { tmpdir } from 'node:os';

function fixture() {
  const directory = fs.mkdtempSync(join(tmpdir(), 'wx-pair-cleanup-'));
  const config = resolveDatabasePairConfig({
    WX_VIEWER_WEATHER_DB_PATH: join(directory, 'weather.sqlite3'),
    WX_VIEWER_RETAINED_DB_PATH: join(directory, 'retained.sqlite3'),
  });
  return { directory, config };
}
function flatten(error: unknown): unknown[] {
  return error instanceof AggregateError ? error.errors.flatMap(flatten) : [error];
}

test('closeは両接続と両leaseを試行し、失敗分だけ再試行し成功後はno-op', () => {
  const { directory, config } = fixture();
  const pair = initializeDatabases(config);
  const originalClose = Database.prototype.close;
  const originalRm = fs.rmSync;
  const closeError = new Error('fixture close');
  const releaseError = new Error('fixture release');
  const failedLock = `${config.retained.databasePath}.writer-lock`;
  const attempts: string[] = [];
  try {
    Database.prototype.close = function () {
      attempts.push(this.name);
      if (this.name === config.weather.databasePath) throw closeError;
      return originalClose.call(this);
    };
    fs.rmSync = ((path, ...args) => {
      if (String(path) === failedLock) throw releaseError;
      return Reflect.apply(originalRm, fs, [path, ...args]);
    }) as typeof originalRm;
    syncBuiltinESMExports();
    assert.throws(
      () => pair.close(),
      (error) => {
        assert.deepEqual(flatten(error), [closeError, releaseError]);
        return true;
      },
    );
    assert.deepEqual(attempts, [config.weather.databasePath, config.retained.databasePath]);
    assert.equal(pair.retained.connection.open, false);
    assert.equal(fs.existsSync(`${config.weather.databasePath}.writer-lock`), false);
    assert.equal(fs.existsSync(failedLock), true);
    fs.rmSync = originalRm;
    syncBuiltinESMExports();
    Database.prototype.close = originalClose;
    pair.close();
    pair.close();
    assert.equal(pair.weather.connection.open, false);
    assert.equal(fs.existsSync(failedLock), false);
    const reopened = initializeDatabases(config);
    reopened.close();
  } finally {
    Database.prototype.close = originalClose;
    fs.rmSync = originalRm;
    syncBuiltinESMExports();
    pair.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('migration失敗の接続も登録済みとしてcloseし元例外と終了例外を集約する', () => {
  const { directory, config } = fixture();
  const originalExec = Database.prototype.exec;
  const originalClose = Database.prototype.close;
  const migrationError = new Error('fixture migration');
  const closeError = new Error('fixture migration close');
  const closed: string[] = [];
  try {
    Database.prototype.exec = function (sql) {
      if (this.name === config.retained.databasePath) throw migrationError;
      return originalExec.call(this, sql);
    };
    Database.prototype.close = function () {
      closed.push(this.name);
      originalClose.call(this);
      if (this.name === config.retained.databasePath) throw closeError;
      return this;
    };
    assert.throws(
      () => initializeDatabases(config),
      (error) => {
        assert.deepEqual(flatten(error), [migrationError, closeError]);
        return true;
      },
    );
    assert.deepEqual(closed, [config.weather.databasePath, config.retained.databasePath]);
    for (const c of [config.weather, config.retained])
      assert.equal(fs.existsSync(`${c.databasePath}.writer-lock`), false);
    Database.prototype.exec = originalExec;
    Database.prototype.close = originalClose;
    const reopened = initializeDatabases(config);
    reopened.close();
  } finally {
    Database.prototype.exec = originalExec;
    Database.prototype.close = originalClose;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('lease解放は片側失敗でも他方を試行し成功分を再削除しない', () => {
  const { directory, config } = fixture();
  const release = acquireWriterLeases(config);
  const originalRm = fs.rmSync;
  const locks = [config.weather, config.retained]
    .map((c) => `${c.databasePath}.writer-lock`)
    .sort();
  const attempts: string[] = [];
  try {
    fs.rmSync = ((path, ...args) => {
      attempts.push(String(path));
      if (String(path) === locks[0]) throw new Error('fixture first release');
      return Reflect.apply(originalRm, fs, [path, ...args]);
    }) as typeof originalRm;
    syncBuiltinESMExports();
    assert.throws(release, AggregateError);
    assert.deepEqual(attempts, locks);
    assert.equal(fs.existsSync(locks[1]!), false);
    fs.rmSync = originalRm;
    syncBuiltinESMExports();
    release();
    release();
    assert.equal(fs.existsSync(locks[0]!), false);
  } finally {
    fs.rmSync = originalRm;
    syncBuiltinESMExports();
    release();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('初期化失敗は元例外・接続close失敗・lease解放失敗をすべて保持する', () => {
  const { directory, config } = fixture();
  const originalExec = Database.prototype.exec;
  const originalClose = Database.prototype.close;
  const originalRm = fs.rmSync;
  const primary = new Error('fixture initialize');
  const closeFailure = new Error('fixture close after initialize');
  const releaseFailure = new Error('fixture release after initialize');
  const blocked = `${config.retained.databasePath}.writer-lock`;
  try {
    Database.prototype.exec = function (sql) {
      if (this.name === config.retained.databasePath) throw primary;
      return originalExec.call(this, sql);
    };
    Database.prototype.close = function () {
      originalClose.call(this);
      if (this.name === config.retained.databasePath) throw closeFailure;
      return this;
    };
    fs.rmSync = ((path, ...args) => {
      if (String(path) === blocked) throw releaseFailure;
      return Reflect.apply(originalRm, fs, [path, ...args]);
    }) as typeof originalRm;
    syncBuiltinESMExports();
    assert.throws(
      () => initializeDatabases(config),
      (error) => {
        assert.deepEqual(flatten(error), [primary, closeFailure, releaseFailure]);
        return true;
      },
    );
    assert.equal(fs.existsSync(`${config.weather.databasePath}.writer-lock`), false);
    assert.equal(fs.existsSync(blocked), true);
  } finally {
    Database.prototype.exec = originalExec;
    Database.prototype.close = originalClose;
    fs.rmSync = originalRm;
    syncBuiltinESMExports();
    // 注入で削除を拒否したfixtureのleaseだけを後片付けする。
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
