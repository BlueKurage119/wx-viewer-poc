import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  initializeDatabase,
  openDatabase,
  resolveDatabaseConfig,
  runMigrations,
} from '../src/database/index.js';
import { startServer } from '../src/server.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'wx-viewer-api-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeMigration(directory: string, name: string, sql: string): Promise<void> {
  await writeFile(join(directory, name), sql, 'utf8');
}

async function createFixtureMigrations(directory: string): Promise<void> {
  await writeMigration(
    directory,
    '0001_create_probe.sql',
    'CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL);',
  );
  await writeMigration(
    directory,
    '0002_insert_probe.sql',
    "INSERT INTO probe (id, value) VALUES (1, 'fixture');",
  );
}

test('初期化は親ディレクトリとDBを作成し、外部キー制約を有効にする', async () => {
  const directory = await createTemporaryDirectory();
  const databasePath = join(directory, 'nested', 'database.sqlite3');
  const migrationsDirectory = join(directory, 'migrations');
  await mkdir(migrationsDirectory);

  const database = initializeDatabase({ databasePath, migrationsDirectory });
  try {
    assert.equal(database.connection.pragma('foreign_keys', { simple: true }), 1);
    assert.deepEqual(database.migrationSummary.appliedVersions, []);
    assert.equal(await readFile(databasePath).then(() => true), true);
  } finally {
    database.close();
  }
});

test('migrationと保存行は再初期化後も完全に保持され、再適用されない', async () => {
  const directory = await createTemporaryDirectory();
  const migrationsDirectory = join(directory, 'migrations');
  await mkdir(migrationsDirectory);
  await createFixtureMigrations(migrationsDirectory);
  const config = { databasePath: join(directory, 'state.sqlite3'), migrationsDirectory };

  const first = initializeDatabase(config);
  try {
    assert.deepEqual(first.migrationSummary.appliedVersions, [1, 2]);
    first.connection.prepare('INSERT INTO probe (id, value) VALUES (?, ?)').run(2, 'persisted');
  } finally {
    first.close();
  }

  const second = initializeDatabase(config);
  try {
    assert.deepEqual(second.migrationSummary.appliedVersions, []);
    assert.deepEqual(second.connection.prepare('SELECT id, value FROM probe ORDER BY id').all(), [
      { id: 1, value: 'fixture' },
      { id: 2, value: 'persisted' },
    ]);
    assert.equal(
      second.connection.prepare('SELECT count(*) AS count FROM __schema_migrations').get().count,
      2,
    );
  } finally {
    second.close();
    second.close();
  }
});

test('migrationは番号順に適用され、履歴はファイル名とSHA-256を保持する', async () => {
  const directory = await createTemporaryDirectory();
  const migrationsDirectory = join(directory, 'migrations');
  await mkdir(migrationsDirectory);
  await createFixtureMigrations(migrationsDirectory);
  const database = initializeDatabase({
    databasePath: join(directory, 'state.sqlite3'),
    migrationsDirectory,
  });
  try {
    const firstSql = await readFile(join(migrationsDirectory, '0001_create_probe.sql'));
    const secondSql = await readFile(join(migrationsDirectory, '0002_insert_probe.sql'));
    assert.deepEqual(
      database.connection
        .prepare('SELECT version, name, checksum FROM __schema_migrations ORDER BY version')
        .all(),
      [
        {
          version: 1,
          name: '0001_create_probe',
          checksum: createHash('sha256').update(firstSql).digest('hex'),
        },
        {
          version: 2,
          name: '0002_insert_probe',
          checksum: createHash('sha256').update(secondSql).digest('hex'),
        },
      ],
    );
  } finally {
    database.close();
  }
});

test('不正なmigrationファイルを拒否する', async () => {
  for (const [name, sql] of [
    ['invalid.sql', 'SELECT 1;'],
    ['0001_empty.sql', ''],
  ]) {
    const directory = await createTemporaryDirectory();
    const migrationsDirectory = join(directory, 'migrations');
    await mkdir(migrationsDirectory);
    await writeMigration(migrationsDirectory, name, sql);
    assert.throws(
      () =>
        initializeDatabase({ databasePath: join(directory, 'state.sqlite3'), migrationsDirectory }),
      undefined,
      `初期化は ${name} を拒否する必要がある`,
    );
  }
});

test('番号重複、編集、改名、削除、過去番号への後挿しを拒否する', async () => {
  const cases: Array<{
    readonly operation: (migrationsDirectory: string) => Promise<void>;
    readonly label: string;
  }> = [
    {
      label: '番号重複',
      operation: async (migrationsDirectory) => {
        await writeMigration(migrationsDirectory, '0001_other.sql', 'SELECT 1;');
      },
    },
    {
      label: '編集',
      operation: async (migrationsDirectory) => {
        await writeMigration(
          migrationsDirectory,
          '0002_insert_probe.sql',
          "INSERT INTO probe (id, value) VALUES (9, 'changed');",
        );
      },
    },
    {
      label: '改名',
      operation: async (migrationsDirectory) => {
        await rename(
          join(migrationsDirectory, '0002_insert_probe.sql'),
          join(migrationsDirectory, '0002_renamed.sql'),
        );
      },
    },
    {
      label: '削除',
      operation: async (migrationsDirectory) => {
        await unlink(join(migrationsDirectory, '0002_insert_probe.sql'));
      },
    },
    {
      label: '過去番号への後挿し',
      operation: async (migrationsDirectory) => {
        await writeMigration(migrationsDirectory, '0001_after.sql', 'SELECT 1;');
      },
    },
  ];

  for (const { label, operation } of cases) {
    const directory = await createTemporaryDirectory();
    const migrationsDirectory = join(directory, 'migrations');
    await mkdir(migrationsDirectory);
    await createFixtureMigrations(migrationsDirectory);
    const config = { databasePath: join(directory, 'state.sqlite3'), migrationsDirectory };
    const initial = initializeDatabase(config);
    initial.close();
    await operation(migrationsDirectory);
    assert.throws(() => initializeDatabase(config), undefined, label);
  }
});

test('不正SQLのmigrationは原子的にロールバックされ、後続migrationを適用しない', async () => {
  const directory = await createTemporaryDirectory();
  const migrationsDirectory = join(directory, 'migrations');
  await mkdir(migrationsDirectory);
  await writeMigration(
    migrationsDirectory,
    '0001_create_stable.sql',
    'CREATE TABLE stable (id INTEGER PRIMARY KEY);',
  );
  await writeMigration(
    migrationsDirectory,
    '0002_fail.sql',
    'CREATE TABLE rolled_back (id INTEGER PRIMARY KEY);\nTHIS IS INVALID SQL;',
  );
  await writeMigration(
    migrationsDirectory,
    '0003_not_run.sql',
    'CREATE TABLE not_run (id INTEGER PRIMARY KEY);',
  );
  const databasePath = join(directory, 'state.sqlite3');

  assert.throws(() => initializeDatabase({ databasePath, migrationsDirectory }));
  const database = openDatabase(databasePath);
  try {
    assert.deepEqual(
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all(),
      [{ name: '__schema_migrations' }, { name: 'stable' }],
    );
    assert.deepEqual(
      database.prepare('SELECT version FROM __schema_migrations ORDER BY version').all(),
      [{ version: 1 }],
    );
  } finally {
    database.close();
  }
});

test('環境変数の相対パスはAPI workspace基準で解決し、不正値を拒否する', () => {
  const config = resolveDatabaseConfig({ WX_VIEWER_DB_PATH: 'custom.sqlite3' });
  assert.equal(config.databasePath.endsWith('/apps/api/custom.sqlite3'), true);
  assert.throws(() => resolveDatabaseConfig({ WX_VIEWER_DB_PATH: '' }));
  assert.throws(() => resolveDatabaseConfig({ WX_VIEWER_DB_PATH: 'bad\0path' }));
});

test('DB初期化を完了してからhealth endpointを公開し、終了後に同じDBを開ける', async () => {
  const directory = await createTemporaryDirectory();
  const config = {
    databasePath: join(directory, 'state.sqlite3'),
    migrationsDirectory: join(directory, 'migrations'),
  };
  await mkdir(config.migrationsDirectory);
  const server = await startServer({ config, port: 0 });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  } finally {
    await server.close();
  }
  const database = initializeDatabase(config);
  database.close();
});

test('不正migrationではHTTP待受の前に起動を失敗させる', async () => {
  const directory = await createTemporaryDirectory();
  const migrationsDirectory = join(directory, 'migrations');
  await mkdir(migrationsDirectory);
  await writeMigration(migrationsDirectory, '0001_invalid.sql', 'THIS IS INVALID SQL;');
  const config = { databasePath: join(directory, 'state.sqlite3'), migrationsDirectory };

  await assert.rejects(() => startServer({ config, port: 0 }));
  const database = openDatabase(config.databasePath);
  database.close();
});

test('runMigrationsは開始・終了トランザクションをmigrationファイルに許可しない', async () => {
  const directory = await createTemporaryDirectory();
  const migrationsDirectory = join(directory, 'migrations');
  await mkdir(migrationsDirectory);
  await writeMigration(
    migrationsDirectory,
    '0001_transaction.sql',
    'BEGIN; CREATE TABLE rejected (id INTEGER); COMMIT;',
  );
  const emptyMigrationsDirectory = join(directory, 'empty');
  await mkdir(emptyMigrationsDirectory);
  const database = initializeDatabase({
    databasePath: join(directory, 'state.sqlite3'),
    migrationsDirectory: emptyMigrationsDirectory,
  });
  try {
    assert.throws(() => runMigrations(database.connection, migrationsDirectory));
  } finally {
    database.close();
  }
});
