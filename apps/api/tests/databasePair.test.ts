import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  linkSync,
  symlinkSync,
  existsSync,
  mkdirSync,
  copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  initializeDatabases,
  initializeDatabase,
  openDatabase,
  resolveDatabasePairConfig,
  type DatabasePairConfig,
} from '../src/database/index.js';
import { captureFiles, inspectDatabaseCopy } from '../src/database/pairSafety.js';
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'wx247-pair-'));
  const config = resolveDatabasePairConfig({
    WX_VIEWER_WEATHER_DB_PATH: join(directory, 'weather.sqlite3'),
    WX_VIEWER_RETAINED_DB_PATH: join(directory, 'retained.sqlite3'),
  });
  return { directory, config };
}
const retainedTables = [
  'notification_output_history',
  'operation_history',
  'startup_notification_inquiry',
  'startup_warning_claim',
  'terminal_session',
];
function tables(db: ReturnType<typeof initializeDatabases>['weather']) {
  return (
    db.connection.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
      name: string;
    }[]
  )
    .map((r) => r.name)
    .filter((n) => !n.startsWith('__') && !n.startsWith('sqlite_'))
    .sort();
}
test('物理2DB・最終DDL・保持5表・世代・checksumは再起動で不変', () => {
  const { directory, config } = fixture();
  try {
    const pair = initializeDatabases(config);
    const generation = pair.weatherDatabaseGenerationId;
    assert.deepEqual(tables(pair.retained), [...retainedTables, 'weather_worker_operation']);
    assert.equal(
      tables(pair.weather).some((t) => retainedTables.includes(t)),
      false,
    );
    const legacy = initializeDatabase({
      databasePath: join(directory, 'legacy.sqlite3'),
      migrationsDirectory: resolve(import.meta.dirname, '../migrations'),
    });
    for (const table of [...tables(pair.weather), ...retainedTables]) {
      const target = retainedTables.includes(table)
        ? pair.retained.connection
        : pair.weather.connection;
      const actual = target.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      const expected = legacy.connection.prepare(`PRAGMA table_info(${table})`).all();
      assert.deepEqual(
        actual.filter((r) => r.name !== 'weather_database_generation_id'),
        expected,
      );
      assert.deepEqual(
        target.prepare(`PRAGMA foreign_key_list(${table})`).all(),
        legacy.connection.prepare(`PRAGMA foreign_key_list(${table})`).all(),
      );
      assert.deepEqual(
        target.prepare(`PRAGMA index_list(${table})`).all(),
        legacy.connection.prepare(`PRAGMA index_list(${table})`).all(),
      );
    }
    legacy.close();
    pair.retained.connection.exec(
      "INSERT INTO terminal_session VALUES ('session','2026-10-07T00:00:00Z'); INSERT INTO startup_warning_claim VALUES ('generation','venue','2026-10-07T00:00:00Z','session'); INSERT INTO startup_notification_inquiry VALUES (17,'generation','venue','terminal','session','startup','2026-10-07T00:00:00Z',1,'{\"snapshot\":[]}'); INSERT INTO operation_history VALUES (19,'request','stop','all','success','2026-10-07T00:00:00Z','2026-10-07T00:00:01Z','actor','担当者',NULL,NULL);",
    );
    const rows = retainedTables.map((table) =>
      pair.retained.connection.prepare(`SELECT * FROM ${table}`).all(),
    );
    const metadata = pair.retained.connection.prepare('SELECT * FROM __schema_migrations').all();
    const retainedIdentity = pair.retained.connection
      .prepare('SELECT * FROM __database_identity')
      .all();
    pair.close();
    for (let i = 0; i < 2; i++) {
      const restart = initializeDatabases(config);
      assert.equal(restart.weatherDatabaseGenerationId, generation);
      assert.deepEqual(
        retainedTables.map((table) =>
          restart.retained.connection.prepare(`SELECT * FROM ${table}`).all(),
        ),
        rows,
      );
      assert.deepEqual(
        restart.retained.connection.prepare('SELECT * FROM __schema_migrations').all(),
        metadata,
      );
      assert.deepEqual(
        restart.retained.connection.prepare('SELECT * FROM __database_identity').all(),
        retainedIdentity,
      );
      restart.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('旧設定・alias・symlink・hardlink・case・付随ファイル衝突を拒否', () => {
  const { directory, config } = fixture();
  try {
    assert.throws(() => resolveDatabasePairConfig({ WX_VIEWER_DB_PATH: '' }));
    for (const value of ['', ':memory:', 'file:db', 'bad\0path'])
      assert.throws(() => resolveDatabasePairConfig({ WX_VIEWER_WEATHER_DB_PATH: value }));
    const pair = initializeDatabases(config);
    pair.close();
    for (const target of [
      config.weather.databasePath,
      join(directory, '..', directory.split('/').at(-1)!, 'weather.sqlite3'),
      `${config.weather.databasePath}-wal`,
      config.weather.databasePath.toUpperCase(),
    ])
      assert.throws(() =>
        initializeDatabases({ ...config, retained: { ...config.retained, databasePath: target } }),
      );
    symlinkSync(config.weather.databasePath, join(directory, 'symlink'));
    assert.throws(() =>
      initializeDatabases({
        ...config,
        weather: { ...config.weather, databasePath: join(directory, 'symlink') },
      }),
    );
    const originalBytes = readFileSync(config.weather.databasePath);
    linkSync(config.weather.databasePath, join(directory, 'hardlink'));
    assert.throws(() => initializeDatabases(config));
    assert.throws(() =>
      initializeDatabases({
        ...config,
        weather: { ...config.weather, databasePath: join(directory, 'hardlink') },
      }),
    );
    assert.deepEqual(readFileSync(config.weather.databasePath), originalBytes);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('旧DB/逆role/未知checksumは両元DBへ書き込む前に拒否', () => {
  const { directory, config } = fixture();
  try {
    const old = initializeDatabase({
      databasePath: config.retained.databasePath,
      migrationsDirectory: resolve(import.meta.dirname, '../migrations'),
    });
    old.close();
    const before = readFileSync(config.retained.databasePath);
    assert.throws(() => initializeDatabases(config));
    assert.equal(existsSync(config.weather.databasePath), false);
    assert.deepEqual(readFileSync(config.retained.databasePath), before);
    rmSync(config.retained.databasePath);
    const pair = initializeDatabases(config);
    pair.retained.connection.prepare("UPDATE __schema_migrations SET checksum='unknown'").run();
    pair.close();
    const weatherBefore = captureFiles(config.weather.databasePath);
    const retainedBefore = captureFiles(config.retained.databasePath);
    assert.throws(() => initializeDatabases(config));
    assert.deepEqual(captureFiles(config.weather.databasePath), weatherBefore);
    assert.deepEqual(captureFiles(config.retained.databasePath), retainedBefore);
    assert.throws(() => inspectDatabaseCopy({ ...config.weather, role: 'retained' }));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('lease競合・reset journalで起動拒否、失敗後lease解放', () => {
  const { directory, config } = fixture();
  try {
    const pair = initializeDatabases(config);
    assert.throws(() => initializeDatabases(config));
    pair.close();
    writeFileSync(`${config.weather.databasePath}.reset.json`, '{}');
    assert.throws(() => initializeDatabases(config));
    assert.equal(existsSync(`${config.weather.databasePath}.writer-lock`), false);
    assert.equal(existsSync(`${config.retained.databasePath}.writer-lock`), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('一方のopen失敗でも既存保持DBとleaseを保全', () => {
  const { directory, config } = fixture();
  try {
    const pair = initializeDatabases(config);
    pair.close();
    const before = captureFiles(config.retained.databasePath);
    const invalid: DatabasePairConfig = {
      ...config,
      weather: { ...config.weather, migrationsDirectory: join(directory, 'missing-migrations') },
    };
    assert.throws(() => initializeDatabases(invalid));
    assert.deepEqual(captureFiles(config.retained.databasePath), before);
    assert.equal(existsSync(`${config.weather.databasePath}.writer-lock`), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('正当な未適用migrationと他側異常ではmigration無実行、適用途中失敗でも両close', () => {
  const { directory, config } = fixture();
  try {
    const pair = initializeDatabases(config);
    pair.retained.connection.exec("INSERT INTO terminal_session VALUES ('saved', '2026-10-07')");
    pair.close();
    const weatherMigrations = join(directory, 'weather-migrations');
    const retainedMigrations = join(directory, 'retained-migrations');
    mkdirSync(weatherMigrations);
    mkdirSync(retainedMigrations);
    copyFileSync(
      join(config.weather.migrationsDirectory, '0001_baseline.sql'),
      join(weatherMigrations, '0001_baseline.sql'),
    );
    copyFileSync(
      join(config.retained.migrationsDirectory, '0001_baseline.sql'),
      join(retainedMigrations, '0001_baseline.sql'),
    );
    writeFileSync(
      join(weatherMigrations, '0002_pending.sql'),
      'CREATE TABLE pending_weather (id INTEGER);',
    );
    copyFileSync(
      join(config.retained.migrationsDirectory, '0002_weather_worker_operation.sql'),
      join(retainedMigrations, '0002_weather_worker_operation.sql'),
    );
    const corrupted = initializeDatabases(config);
    corrupted.retained.connection
      .prepare("UPDATE __schema_migrations SET checksum='bad' WHERE version=1")
      .run();
    corrupted.close();
    const weatherBefore = captureFiles(config.weather.databasePath);
    assert.throws(() =>
      initializeDatabases({
        ...config,
        weather: { ...config.weather, migrationsDirectory: weatherMigrations },
      }),
    );
    assert.deepEqual(captureFiles(config.weather.databasePath), weatherBefore);
    // 正しい保持baselineのchecksumへ戻し、事前検証後にだけ失敗する新migrationを用意する。
    const good = initializeDatabase({
      databasePath: join(directory, 'good.sqlite3'),
      migrationsDirectory: retainedMigrations,
    });
    const checksum = (
      good.connection.prepare('SELECT checksum FROM __schema_migrations WHERE version=1').get() as {
        checksum: string;
      }
    ).checksum;
    good.close();
    const retained = openDatabase(config.retained.databasePath);
    retained.prepare('UPDATE __schema_migrations SET checksum=? WHERE version=1').run(checksum);
    retained.close();
    writeFileSync(join(retainedMigrations, '0003_fail.sql'), 'INSERT INTO nonexistent VALUES (1);');
    const before = captureFiles(config.retained.databasePath);
    assert.throws(() =>
      initializeDatabases({
        ...config,
        retained: { ...config.retained, migrationsDirectory: retainedMigrations },
      }),
    );
    assert.deepEqual(captureFiles(config.retained.databasePath), before);
    assert.equal(existsSync(`${config.weather.databasePath}.writer-lock`), false);
    assert.equal(existsSync(`${config.retained.databasePath}.writer-lock`), false);
    const restored = initializeDatabases(config);
    assert.deepEqual(restored.retained.connection.prepare('SELECT * FROM terminal_session').all(), [
      { session_id: 'saved', first_inquired_at: '2026-10-07' },
    ]);
    restored.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
