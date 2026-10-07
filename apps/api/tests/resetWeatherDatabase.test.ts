import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  linkSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  initializeDatabases,
  initializeDatabase,
  openDatabase,
  resolveDatabasePairConfig,
} from '../src/database/index.js';
import { resetWeatherDatabase } from '../src/database/resetWeatherDatabase.js';
import { captureFiles, assertStopped, inspectDatabaseCopy } from '../src/database/pairSafety.js';
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'wx247-reset-'));
  const config = resolveDatabasePairConfig({
    WX_VIEWER_WEATHER_DB_PATH: join(directory, 'weather.sqlite3'),
    WX_VIEWER_RETAINED_DB_PATH: join(directory, 'retained.sqlite3'),
  });
  const pair = initializeDatabases(config);
  pair.retained.connection.exec(
    "INSERT INTO terminal_session VALUES ('session','2026-10-07'); INSERT INTO startup_warning_claim VALUES ('server','venue','2026-10-07','session'); INSERT INTO startup_notification_inquiry VALUES (17,'server','venue','terminal','session','startup','2026-10-07',1,'{\"snapshot\":[]}'); INSERT INTO operation_history VALUES (19,'request','stop','all','success','2026-10-07','2026-10-07','actor','担当者',NULL,NULL);",
  );
  for (const origin of ['weather', 'system'])
    pair.retained.connection
      .prepare(
        "INSERT INTO notification_output_history (notification_id,category,source_type,occurred_at,detected_at,change_type,ack_required,summary,related_refs_json,origin,detection_context,is_training,weather_database_generation_id) VALUES (?, 'warning','telegram','2026-10-07','2026-10-07','new',1,?,'[]',?,'normal',0,?)",
      )
      .run(origin, origin, origin, origin === 'weather' ? pair.weatherDatabaseGenerationId : null);
  const generation = pair.weatherDatabaseGenerationId;
  const retainedIdentity = pair.retained.connection
    .prepare('SELECT * FROM __database_identity')
    .all();
  const tables = [
    'operation_history',
    'notification_output_history',
    'terminal_session',
    'startup_warning_claim',
    'startup_notification_inquiry',
  ];
  const rows = tables.map((t) => pair.retained.connection.prepare(`SELECT * FROM ${t}`).all());
  pair.close();
  return { directory, config, generation, retainedIdentity, tables, rows };
}
const planOptions = { mode: 'plan' as const, confirmStopped: true };
function npmReset(directory: string, args: string[]) {
  return spawnSync('npm', ['run', 'db:reset:weather', '--', ...args], {
    cwd: resolve(import.meta.dirname, '../../..'),
    env: {
      ...process.env,
      WX_VIEWER_DB_PATH: undefined,
      WX_VIEWER_WEATHER_DB_PATH: join(directory, 'weather.sqlite3'),
      WX_VIEWER_RETAINED_DB_PATH: join(directory, 'retained.sqlite3'),
    },
    encoding: 'utf8',
  });
}
test('実npm plan/applyは保持5表・hash/mtime・cache・無関係DBを保全し再applyはno-op', () => {
  const f = fixture();
  try {
    const before = captureFiles(f.config.retained.databasePath);
    mkdirSync(join(f.directory, 'cache'));
    writeFileSync(join(f.directory, 'cache', 'tile'), 'tile');
    writeFileSync(join(f.directory, 'settings'), 'settings');
    writeFileSync(join(f.directory, 'unrelated.sqlite3'), 'sentinel');
    const output = npmReset(f.directory, ['--plan', '--confirm-stopped']);
    assert.equal(output.status, 0, output.stderr);
    const json = JSON.parse(output.stdout.slice(output.stdout.indexOf('{'))) as {
      planDigest: string;
    };
    const apply = npmReset(f.directory, [
      '--apply',
      '--confirm',
      json.planDigest,
      '--confirm-stopped',
    ]);
    assert.equal(apply.status, 0, apply.stderr);
    assert.deepEqual(captureFiles(f.config.weather.databasePath), [null, null, null, null]);
    assert.deepEqual(captureFiles(f.config.retained.databasePath), before);
    assert.equal(readFileSync(join(f.directory, 'cache', 'tile'), 'utf8'), 'tile');
    assert.equal(readFileSync(join(f.directory, 'settings'), 'utf8'), 'settings');
    assert.equal(readFileSync(join(f.directory, 'unrelated.sqlite3'), 'utf8'), 'sentinel');
    assert.equal(
      npmReset(f.directory, ['--apply', '--confirm', json.planDigest, '--confirm-stopped']).status,
      0,
    );
    const restart = initializeDatabases(f.config);
    assert.notEqual(restart.weatherDatabaseGenerationId, f.generation);
    assert.deepEqual(
      restart.retained.connection.prepare('SELECT * FROM __database_identity').all(),
      f.retainedIdentity,
    );
    assert.deepEqual(
      f.tables.map((t) => restart.retained.connection.prepare(`SELECT * FROM ${t}`).all()),
      f.rows,
    );
    restart.close();
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});
test('確認flag/digest不一致と保持role・旧DB・alias・link・orphan sidecarは無変更拒否', () => {
  const f = fixture();
  try {
    const before = captureFiles(f.config.weather.databasePath),
      retained = captureFiles(f.config.retained.databasePath);
    assert.throws(() => resetWeatherDatabase(f.config, { mode: 'plan', confirmStopped: false }));
    assert.throws(() => resetWeatherDatabase(f.config, { mode: 'apply', confirmStopped: true }));
    assert.throws(() =>
      resetWeatherDatabase(f.config, { mode: 'apply', confirmStopped: true, confirm: 'wrong' }),
    );
    assert.deepEqual(captureFiles(f.config.weather.databasePath), before);
    assert.deepEqual(captureFiles(f.config.retained.databasePath), retained);
    for (const path of [
      f.config.retained.databasePath,
      `${f.config.retained.databasePath}-wal`,
      f.config.retained.databasePath.toUpperCase(),
    ])
      assert.throws(() =>
        resetWeatherDatabase(
          { ...f.config, weather: { ...f.config.weather, databasePath: path } },
          planOptions,
        ),
      );
    symlinkSync(f.config.weather.databasePath, join(f.directory, 'link'));
    assert.throws(() =>
      resetWeatherDatabase(
        { ...f.config, weather: { ...f.config.weather, databasePath: join(f.directory, 'link') } },
        planOptions,
      ),
    );
    linkSync(f.config.weather.databasePath, join(f.directory, 'hard'));
    const bytes = readFileSync(f.config.weather.databasePath);
    assert.throws(() => resetWeatherDatabase(f.config, planOptions));
    assert.deepEqual(readFileSync(f.config.weather.databasePath), bytes);
    rmSync(join(f.directory, 'hard'));
    const old = initializeDatabase({
      databasePath: join(f.directory, 'old.sqlite3'),
      migrationsDirectory: resolve(import.meta.dirname, '../migrations'),
    });
    old.close();
    assert.throws(() =>
      resetWeatherDatabase(
        {
          ...f.config,
          weather: { ...f.config.weather, databasePath: join(f.directory, 'old.sqlite3') },
        },
        planOptions,
      ),
    );
    rmSync(f.config.weather.databasePath);
    writeFileSync(`${f.config.weather.databasePath}-wal`, 'orphan');
    assert.throws(() => resetWeatherDatabase(f.config, planOptions));
    assert.equal(readFileSync(`${f.config.weather.databasePath}-wal`, 'utf8'), 'orphan');
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});
test('主削除直後と進捗更新失敗は起動拒否、同journal resumeのみ許容', () => {
  for (const fault of ['unlink', 'progress']) {
    const f = fixture();
    try {
      const before = captureFiles(f.config.retained.databasePath);
      const plan = resetWeatherDatabase(f.config, planOptions);
      let calls = 0;
      const hooks =
        fault === 'unlink'
          ? {
              afterUnlink() {
                if (calls++ === 0) throw new Error('injected');
              },
            }
          : {
              beforeProgressWrite() {
                if (calls++ === 0) throw new Error('injected');
              },
            };
      assert.throws(() =>
        resetWeatherDatabase(
          f.config,
          { mode: 'apply', confirmStopped: true, confirm: plan.planDigest },
          hooks,
        ),
      );
      assert.equal(existsSync(`${f.config.weather.databasePath}.reset.json`), true);
      assert.throws(() => initializeDatabases(f.config));
      assert.throws(() =>
        resetWeatherDatabase(f.config, { mode: 'resume', confirmStopped: true, confirm: 'wrong' }),
      );
      resetWeatherDatabase(f.config, {
        mode: 'resume',
        confirmStopped: true,
        confirm: plan.planDigest,
      });
      assert.deepEqual(captureFiles(f.config.weather.databasePath), [null, null, null, null]);
      assert.deepEqual(captureFiles(f.config.retained.databasePath), before);
      assert.equal(existsSync(`${f.config.weather.databasePath}.reset.json`), false);
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  }
});
test('途中で再生成した別inodeと改変journalを削除しない', () => {
  const f = fixture();
  try {
    const plan = resetWeatherDatabase(f.config, planOptions);
    assert.throws(() =>
      resetWeatherDatabase(
        f.config,
        { mode: 'apply', confirmStopped: true, confirm: plan.planDigest },
        {
          afterUnlink() {
            throw new Error('stop');
          },
        },
      ),
    );
    writeFileSync(f.config.weather.databasePath, 'new DB');
    assert.throws(() =>
      resetWeatherDatabase(f.config, {
        mode: 'resume',
        confirmStopped: true,
        confirm: plan.planDigest,
      }),
    );
    assert.equal(readFileSync(f.config.weather.databasePath, 'utf8'), 'new DB');
    rmSync(f.config.weather.databasePath);
    const journalPath = `${f.config.weather.databasePath}.reset.json`;
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      plan: { retainedPath: string };
    };
    journal.plan.retainedPath = 'tampered';
    writeFileSync(journalPath, JSON.stringify(journal));
    assert.throws(() =>
      resetWeatherDatabase(f.config, {
        mode: 'resume',
        confirmStopped: true,
        confirm: plan.planDigest,
      }),
    );
    assert.equal(existsSync(journalPath), true);
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});
test('lease writerと非協調open子processを停止検査で拒否、検査不能も拒否', async () => {
  const f = fixture();
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const pair = initializeDatabases(f.config);
    assert.throws(() => resetWeatherDatabase(f.config, planOptions));
    pair.close();
    child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import Database from 'better-sqlite3';const db=new Database(process.argv[1]);process.stdout.write('ready');setInterval(()=>{},1000);",
        f.config.weather.databasePath,
      ],
      { cwd: resolve(import.meta.dirname, '../../..'), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    await once(child.stdout!, 'data');
    assert.throws(() => resetWeatherDatabase(f.config, planOptions));
    child.kill();
    await once(child, 'exit');
    child = undefined;
    const path = process.env.PATH;
    process.env.PATH = f.directory;
    try {
      assert.throws(() => assertStopped(f.config));
    } finally {
      process.env.PATH = path;
    }
  } finally {
    child?.kill();
    rmSync(f.directory, { recursive: true, force: true });
  }
});
test('コードrollback用別空DBの往復でも新保持5表・hashは不変', () => {
  const f = fixture();
  try {
    const before = captureFiles(f.config.retained.databasePath);
    copyFileSync(f.config.retained.databasePath, join(f.directory, 'retained-backup.sqlite3'));
    const legacy = initializeDatabase({
      databasePath: join(f.directory, 'rollback-old.sqlite3'),
      migrationsDirectory: resolve(import.meta.dirname, '../migrations'),
    });
    legacy.close();
    assert.deepEqual(captureFiles(f.config.retained.databasePath), before);
    assert.deepEqual(
      readFileSync(join(f.directory, 'retained-backup.sqlite3')),
      readFileSync(f.config.retained.databasePath),
    );
    const restart = initializeDatabases(f.config);
    assert.deepEqual(
      f.tables.map((t) => restart.retained.connection.prepare(`SELECT * FROM ${t}`).all()),
      f.rows,
    );
    restart.close();
    assert.deepEqual(captureFiles(f.config.retained.databasePath), before);
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test('停止済みWALのSHMあり/なしとhot journalをコピーだけで検査し元stat/hash不変', () => {
  for (const mode of ['wal-shm', 'wal-no-shm', 'journal']) {
    const f = fixture();
    try {
      const program =
        mode === 'journal'
          ? "import Database from 'better-sqlite3'; const db=new Database(process.argv[1]);db.pragma('journal_mode=DELETE');db.pragma('cache_size=1');db.exec(\"BEGIN IMMEDIATE;CREATE TABLE uncommitted(value TEXT);INSERT INTO uncommitted VALUES (hex(randomblob(1000000)));UPDATE __database_identity SET created_at='uncommitted';\");process.exit(0);"
          : "import Database from 'better-sqlite3'; const db=new Database(process.argv[1]);db.pragma('journal_mode=WAL');db.pragma('user_version=7');process.exit(0);";
      const child = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', program, f.config.weather.databasePath],
        { cwd: resolve(import.meta.dirname, '../../..'), encoding: 'utf8' },
      );
      assert.equal(child.status, 0, child.stderr);
      if (mode === 'wal-no-shm') rmSync(`${f.config.weather.databasePath}-shm`);
      assert.equal(
        existsSync(`${f.config.weather.databasePath}${mode === 'journal' ? '-journal' : '-wal'}`),
        true,
      );
      const before = captureFiles(f.config.weather.databasePath);
      const identity = inspectDatabaseCopy(f.config.weather);
      assert.equal(identity?.instance_id, f.generation);
      assert.deepEqual(captureFiles(f.config.weather.databasePath), before);
      const plan = resetWeatherDatabase(f.config, planOptions);
      assert.deepEqual(captureFiles(f.config.weather.databasePath), before);
      resetWeatherDatabase(f.config, {
        mode: 'apply',
        confirmStopped: true,
        confirm: plan.planDigest,
      });
      assert.deepEqual(captureFiles(f.config.weather.databasePath), [null, null, null, null]);
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  }
});

test('WAL主削除直後の中断は残sidecarを元journalから再開する', () => {
  const f = fixture();
  try {
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import Database from 'better-sqlite3';const db=new Database(process.argv[1]);db.pragma('journal_mode=WAL');db.pragma('user_version=7');process.exit(0);",
        f.config.weather.databasePath,
      ],
      { cwd: resolve(import.meta.dirname, '../../..'), encoding: 'utf8' },
    );
    assert.equal(child.status, 0, child.stderr);
    const plan = resetWeatherDatabase(f.config, planOptions);
    assert.throws(() =>
      resetWeatherDatabase(
        f.config,
        { mode: 'apply', confirmStopped: true, confirm: plan.planDigest },
        {
          afterUnlink() {
            throw new Error('interrupted');
          },
        },
      ),
    );
    assert.equal(existsSync(f.config.weather.databasePath), false);
    assert.equal(existsSync(`${f.config.weather.databasePath}-wal`), true);
    resetWeatherDatabase(f.config, {
      mode: 'resume',
      confirmStopped: true,
      confirm: plan.planDigest,
    });
    assert.deepEqual(captureFiles(f.config.weather.databasePath), [null, null, null, null]);
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test('保持側の逆role・旧schema・未知checksumはplan/apply/resume全入口で無変更拒否', () => {
  const f = fixture();
  try {
    const plan = resetWeatherDatabase(f.config, planOptions);
    // 正当な途中journalを残してから保持側を破損させる。
    assert.throws(() =>
      resetWeatherDatabase(
        f.config,
        { mode: 'apply', confirmStopped: true, confirm: plan.planDigest },
        {
          beforeProgressWrite() {
            throw new Error('injected');
          },
        },
      ),
    );
    const original = readFileSync(f.config.retained.databasePath);
    const replacement = join(f.directory, 'replacement.sqlite3');
    const legacy = initializeDatabase({
      databasePath: replacement,
      migrationsDirectory: resolve(import.meta.dirname, '../migrations'),
    });
    legacy.close();
    copyFileSync(replacement, f.config.retained.databasePath);
    const before = captureFiles(f.config.retained.databasePath);
    for (const mode of ['plan', 'apply', 'resume'] as const)
      assert.throws(() =>
        resetWeatherDatabase(f.config, { mode, confirmStopped: true, confirm: plan.planDigest }),
      );
    assert.deepEqual(captureFiles(f.config.retained.databasePath), before);
    writeFileSync(f.config.retained.databasePath, original);
    resetWeatherDatabase(f.config, {
      mode: 'resume',
      confirmStopped: true,
      confirm: plan.planDigest,
    });
    const restart = initializeDatabases(f.config);
    restart.retained.connection.prepare("UPDATE __database_identity SET role='weather'").run();
    restart.close();
    const reverse = captureFiles(f.config.retained.databasePath);
    assert.throws(() => resetWeatherDatabase(f.config, planOptions));
    assert.deepEqual(captureFiles(f.config.retained.databasePath), reverse);
    const retained = openDatabase(f.config.retained.databasePath);
    retained.prepare("UPDATE __database_identity SET role='retained'").run();
    retained.prepare("UPDATE __schema_migrations SET checksum='unknown'").run();
    retained.close();
    const unknown = captureFiles(f.config.retained.databasePath);
    assert.throws(() => resetWeatherDatabase(f.config, planOptions));
    assert.deepEqual(captureFiles(f.config.retained.databasePath), unknown);
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test('CLIは途中journalの完了/未完了対象を報告しjournalと保持DBを残す', () => {
  const f = fixture();
  try {
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import Database from 'better-sqlite3';const db=new Database(process.argv[1]);db.pragma('journal_mode=WAL');db.pragma('user_version=7');process.exit(0);",
        f.config.weather.databasePath,
      ],
      { cwd: resolve(import.meta.dirname, '../../..'), encoding: 'utf8' },
    );
    assert.equal(child.status, 0, child.stderr);
    const plan = resetWeatherDatabase(f.config, planOptions);
    assert.throws(() =>
      resetWeatherDatabase(
        f.config,
        { mode: 'apply', confirmStopped: true, confirm: plan.planDigest },
        {
          afterUnlink() {
            throw new Error('CLI故障fixture');
          },
        },
      ),
    );
    const before = captureFiles(f.config.retained.databasePath);
    const failed = npmReset(f.directory, [
      '--apply',
      '--confirm',
      plan.planDigest,
      '--confirm-stopped',
    ]);
    assert.equal(failed.status, 1);
    const output = JSON.parse(failed.stderr.split('\n').find((line) => line.startsWith('{'))!) as {
      resetIncomplete: boolean;
      planDigest: string;
      journalPath: string;
      completedPaths: string[];
      remainingPaths: string[];
      notice: string;
    };
    assert.deepEqual(output, {
      resetIncomplete: true,
      journalPath: `${f.config.weather.databasePath}.reset.json`,
      planDigest: plan.planDigest,
      completedPaths: [f.config.weather.databasePath, `${f.config.weather.databasePath}-journal`],
      remainingPaths: [
        `${f.config.weather.databasePath}-wal`,
        `${f.config.weather.databasePath}-shm`,
      ],
      notice:
        'journalを保持しました。同じ対象・元digestで --resume --confirm-stopped を実行してください。',
    });
    assert.equal(existsSync(`${f.config.weather.databasePath}.reset.json`), true);
    assert.deepEqual(captureFiles(f.config.retained.databasePath), before);
    assert.equal(
      npmReset(f.directory, ['--resume', '--confirm', plan.planDigest, '--confirm-stopped']).status,
      0,
    );
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});
