import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import BetterSqlite3 from 'better-sqlite3';
import {
  initializeDatabases,
  resolveDatabasePairConfig,
} from '../src/database/index.js';
import {
  assertFilesUnchanged,
  captureFiles,
  fileIdentity,
} from '../src/database/pairSafety.js';
import {
  runInteractiveReset,
  type ResetIo,
  type InteractiveResetDeps,
} from '../src/database/resetInteractive.js';
import { resetWeatherDatabase, type ResetPlan } from '../src/database/resetWeatherDatabase.js';
import { probeProcess } from '../src/database/writerLock.js';

class FakeResetIo implements ResetIo {
  outputs: string[] = [];
  questions: string[] = [];
  private answers: (string | ((question: string) => string | Promise<string>))[];

  constructor(answers: (string | ((question: string) => string | Promise<string>))[]) {
    this.answers = [...answers];
  }

  print(text: string): void {
    this.outputs.push(text);
  }

  async ask(question: string): Promise<string> {
    this.questions.push(question);
    const answer = this.answers.shift();
    if (answer === undefined) {
      throw new Error(`予期しないask呼び出し: ${question}`);
    }
    if (typeof answer === 'function') {
      return await answer(question);
    }
    return answer;
  }
}

describe('resetInteractive 受け入れ条件 (AC-1〜6, 11, 12, N1, S2)', () => {
  let dir: string;
  const childProcesses: ReturnType<typeof spawn>[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wx293-interactive-'));
  });

  afterEach(() => {
    for (const cp of childProcesses) {
      try {
        cp.kill('SIGKILL');
      } catch {
        // 無視
      }
    }
    childProcesses.length = 0;
    rmSync(dir, { recursive: true, force: true });
  });

  function setupFixture() {
    const config = resolveDatabasePairConfig({
      WX_VIEWER_WEATHER_DB_PATH: join(dir, 'weather.sqlite3'),
      WX_VIEWER_RETAINED_DB_PATH: join(dir, 'retained.sqlite3'),
    });
    const pair = initializeDatabases(config);

    // 保持5表のデータを挿入
    pair.retained.connection.exec(
      "INSERT INTO terminal_session VALUES ('session','2026-10-07');" +
        "INSERT INTO startup_warning_claim VALUES ('server','venue','2026-10-07','session');" +
        "INSERT INTO startup_notification_inquiry VALUES (17,'server','venue','terminal','session','startup','2026-10-07',1,'{\"snapshot\":[]}');" +
        "INSERT INTO operation_history VALUES (19,'request','stop','all','success','2026-10-07','2026-10-07','actor','担当者',NULL,NULL);",
    );
    for (const origin of ['weather', 'system']) {
      pair.retained.connection
        .prepare(
          "INSERT INTO notification_output_history (notification_id,category,source_type,occurred_at,detected_at,change_type,ack_required,summary,related_refs_json,origin,detection_context,is_training,weather_database_generation_id) VALUES (?, 'warning','telegram','2026-10-07','2026-10-07','new',1,?,'[]',?,'normal',0,?)",
        )
        .run(origin, origin, origin, origin === 'weather' ? pair.weatherDatabaseGenerationId : null);
    }

    const generation = pair.weatherDatabaseGenerationId;
    const tables = [
      'operation_history',
      'notification_output_history',
      'terminal_session',
      'startup_warning_claim',
      'startup_notification_inquiry',
    ];
    const initialRows = tables.map((t) =>
      pair.retained.connection.prepare(`SELECT * FROM ${t}`).all(),
    );
    pair.close();

    // タイルcacheや無関係ファイルを作成
    const cacheDir = join(dir, 'cache');
    mkdirSync(cacheDir);
    const tilePath = join(cacheDir, 'tile.bin');
    writeFileSync(tilePath, 'tile data');
    const unrelatedPath = join(dir, 'unrelated.sqlite3');
    writeFileSync(unrelatedPath, 'unrelated');

    return {
      config,
      generation,
      tables,
      initialRows,
      tilePath,
      unrelatedPath,
    };
  }

  function assertRetainedIntact(
    f: ReturnType<typeof setupFixture>,
    retainedBefore: ReturnType<typeof captureFiles>,
  ) {
    // 保持DB主・付随ファイルの dev/ino/size/mtime/hash が完全一致
    assertFilesUnchanged(f.config.retained.databasePath, retainedBefore);

    // 保持5表全行が実行前と完全一致
    const pair = initializeDatabases(f.config);
    try {
      for (let i = 0; i < f.tables.length; i++) {
        const rows = pair.retained.connection.prepare(`SELECT * FROM ${f.tables[i]}`).all();
        assert.deepEqual(rows, f.initialRows[i], `表 ${f.tables[i]} の内容が一致すること`);
      }
    } finally {
      pair.close();
    }

    // タイルcache・無関係ファイルが不変
    assert.equal(readFileSync(f.tilePath, 'utf8'), 'tile data');
    assert.equal(readFileSync(f.unrelatedPath, 'utf8'), 'unrelated');
  }

  describe('AC-1: 1コマンド完了', () => {
    it('停止済み一時DBに対し y->y で実行すると気象DBが削除され保持側とcacheが保全される', async () => {
      const f = setupFixture();
      const retainedBefore = captureFiles(f.config.retained.databasePath);
      const weatherBefore = captureFiles(f.config.weather.databasePath);
      assert.ok(weatherBefore[0] !== null, '実行前は気象主DBが存在する');

      const io = new FakeResetIo(['y', 'y']);
      const result = await runInteractiveReset(f.config, io);
      assert.equal(result, 'completed');

      // 気象主DBと存在した付随ファイルだけが消え、.reset.json が残らない
      assert.deepEqual(captureFiles(f.config.weather.databasePath), [null, null, null, null]);
      assert.equal(existsSync(`${f.config.weather.databasePath}.reset.json`), false);

      // 保持DBおよびcacheの保全
      assertRetainedIntact(f, retainedBefore);

      // 表示内容の検証
      const outputText = io.outputs.join('\n');
      assert.ok(outputText.includes('削除対象ファイル:'), '削除対象一覧が表示される');
      assert.ok(outputText.includes('instance_id:'), 'weather instance_id が表示される');
      assert.ok(
        outputText.includes('バックアップは作成しません'),
        'バックアップは作成しませんが含まれる',
      );
      assert.ok(
        outputText.includes('保持DB(操作記録・通知履歴・session・起動claim・応答監査)とタイルcacheは対象外です'),
        '保持DBとタイルcacheが対象外である旨が含まれる',
      );
      assert.ok(
        !io.questions.some((q) => q.toLowerCase().includes('digest')),
        'digestの入力を求める問いが無い',
      );
    });
  });

  describe('AC-2: 中止', () => {
    const testCases: { name: string; answers: string[] }[] = [
      { name: '停止申告で n', answers: ['n'] },
      { name: '停止申告で 空文字(空白)', answers: ['   '] },
      { name: '停止申告で EOF相当()', answers: [''] },
      { name: '実行確認で n', answers: ['y', 'n'] },
      { name: '実行確認で 空文字(空白)', answers: ['y', '   '] },
      { name: '実行確認で EOF相当()', answers: ['y', ''] },
    ];

    for (const tc of testCases) {
      it(`${tc.name} で cancelled、全ファイル不変、journal・lockなし`, async () => {
        const f = setupFixture();
        const weatherBefore = captureFiles(f.config.weather.databasePath);
        const retainedBefore = captureFiles(f.config.retained.databasePath);

        const io = new FakeResetIo(tc.answers);
        const result = await runInteractiveReset(f.config, io);
        assert.equal(result, 'cancelled');

        // 全対象ファイルの identity/hash 不変
        assert.deepEqual(captureFiles(f.config.weather.databasePath), weatherBefore);
        assert.deepEqual(captureFiles(f.config.retained.databasePath), retainedBefore);
        assert.equal(existsSync(`${f.config.weather.databasePath}.reset.json`), false);
        assert.equal(existsSync(`${f.config.weather.databasePath}.writer-lock`), false);
        assert.equal(existsSync(`${f.config.retained.databasePath}.writer-lock`), false);
        assert.ok(io.outputs.includes('中止しました。変更はありません。'));
      });
    }
  });

  describe('AC-3: 確認後の対象変化', () => {
    it('plan表示後・確認前に気象DBへ書き込むと digest 不一致で拒否され再実行案内が出る', async () => {
      const f = setupFixture();
      const weatherBefore = captureFiles(f.config.weather.databasePath);
      const retainedBefore = captureFiles(f.config.retained.databasePath);

      const io = new FakeResetIo([
        'y', // 停止申告
        () => {
          // 実行確認の直前に気象DBへ1行書き込む
          const db = new BetterSqlite3(f.config.weather.databasePath);
          try {
            db.exec('CREATE TABLE IF NOT EXISTS test_tamper (id INT); INSERT INTO test_tamper VALUES (1);');
          } finally {
            db.close();
          }
          return 'y';
        },
      ]);

      await assert.rejects(
        () => runInteractiveReset(f.config, io),
        /planDigestが一致しません/,
      );

      // 表示に再実行案内が出る
      const outputText = io.outputs.join('\n');
      assert.ok(
        outputText.includes('対象が変わりました。もう一度実行してください。'),
        '再実行案内が含まれること',
      );
      assert.equal(existsSync(`${f.config.weather.databasePath}.reset.json`), false);
    });
  });

  describe('AC-4: 稼働中の自動拒否', () => {
    function spawnAliveChild(): { pid: number; startedAtMs: number } {
      const cp = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
      childProcesses.push(cp);
      assert.ok(cp.pid);
      const probe = probeProcess(cp.pid);
      assert.equal(probe.state, 'present');
      return { pid: cp.pid, startedAtMs: probe.startedAtMs };
    }

    it('(a) 生存中の子プロセスが #266 形式で気象lockを保持していると停止申告前に拒否', async () => {
      const f = setupFixture();
      const weatherBefore = captureFiles(f.config.weather.databasePath);
      const alive = spawnAliveChild();
      const lockPath = `${f.config.weather.databasePath}.writer-lock`;
      mkdirSync(lockPath);
      writeFileSync(
        join(lockPath, 'owner.json'),
        JSON.stringify({
          pid: alive.pid,
          token: 'token-a',
          role: 'weather',
          processStartedAt: new Date(alive.startedAtMs).toISOString(),
          hostname: hostname(),
        }),
      );

      const io = new FakeResetIo(['y', 'y']);
      await assert.rejects(
        () => runInteractiveReset(f.config, io),
        /writer lock が存在し、プロセスが稼働中です/,
      );
      assert.equal(io.questions.length, 0, '停止申告の問いより前に拒否されること');
      assert.deepEqual(captureFiles(f.config.weather.databasePath), weatherBefore);
    });

    it('(b) 生存中の子プロセスが #266 形式で保持lockを保持していると停止申告前に拒否', async () => {
      const f = setupFixture();
      const weatherBefore = captureFiles(f.config.weather.databasePath);
      const alive = spawnAliveChild();
      const lockPath = `${f.config.retained.databasePath}.writer-lock`;
      mkdirSync(lockPath);
      writeFileSync(
        join(lockPath, 'owner.json'),
        JSON.stringify({
          pid: alive.pid,
          token: 'token-b',
          role: 'retained',
          processStartedAt: new Date(alive.startedAtMs).toISOString(),
          hostname: hostname(),
        }),
      );

      const io = new FakeResetIo(['y', 'y']);
      await assert.rejects(
        () => runInteractiveReset(f.config, io),
        /writer lock が存在し、プロセスが稼働中です/,
      );
      assert.equal(io.questions.length, 0, '停止申告の問いより前に拒否されること');
      assert.deepEqual(captureFiles(f.config.weather.databasePath), weatherBefore);
    });

    it('(c) lease を持たず気象DBを開いたままの子プロセスがある場合は lsof で拒否', async () => {
      const f = setupFixture();
      const weatherBefore = captureFiles(f.config.weather.databasePath);

      // 気象DBを開いたままにする子プロセス
      const holderScript = `
        const BetterSqlite3 = (await import('better-sqlite3')).default;
        const db = new BetterSqlite3(process.argv[1]);
        setInterval(() => {}, 1000);
      `;
      const cp = spawn(process.execPath, ['--input-type=module', '-e', holderScript, f.config.weather.databasePath]);
      childProcesses.push(cp);

      // 子プロセスがファイルを開くまで少し待機
      await new Promise((resolve) => setTimeout(resolve, 500));

      const io = new FakeResetIo(['y', 'y']);
      await assert.rejects(
        () => runInteractiveReset(f.config, io),
        /対象DBを開いているプロセスがあります/,
      );
      assert.deepEqual(captureFiles(f.config.weather.databasePath), weatherBefore);
    });
  });

  describe('AC-5: 停止検査不能', () => {
    it('PATH から lsof を除いた環境では拒否され全ファイル不変', async () => {
      const f = setupFixture();
      const weatherBefore = captureFiles(f.config.weather.databasePath);
      const retainedBefore = captureFiles(f.config.retained.databasePath);

      const originalPath = process.env.PATH;
      try {
        process.env.PATH = ''; // lsof が見つからない状態にする
        const io = new FakeResetIo(['y', 'y']);
        await assert.rejects(
          () => runInteractiveReset(f.config, io),
          /対象DBの停止検査コマンドが利用できません/,
        );
        assert.deepEqual(captureFiles(f.config.weather.databasePath), weatherBefore);
        assert.deepEqual(captureFiles(f.config.retained.databasePath), retainedBefore);
      } finally {
        process.env.PATH = originalPath;
      }
    });
  });

  describe('AC-6: 対象なし', () => {
    it('気象主・付随・journalが全て無い状態で実行すると nothing_to_do で保持側不変', async () => {
      const f = setupFixture();
      // 気象主DBと付随ファイルをすべて削除
      for (const file of captureFiles(f.config.weather.databasePath)) {
        if (file && existsSync(file.path)) rmSync(file.path);
      }
      const retainedBefore = captureFiles(f.config.retained.databasePath);

      const io = new FakeResetIo(['y']);
      const result = await runInteractiveReset(f.config, io);
      assert.equal(result, 'nothing_to_do');
      assert.deepEqual(captureFiles(f.config.retained.databasePath), retainedBefore);
      assert.ok(io.outputs.includes('初期化対象がありません。'));
    });

    it('主なし付随ファイルだけが残り journal が無い場合は無変更で拒否', async () => {
      const f = setupFixture();
      // 気象主DBだけを削除し、wal ファイルを作成
      rmSync(f.config.weather.databasePath);
      writeFileSync(`${f.config.weather.databasePath}-wal`, 'orphan-wal');
      const retainedBefore = captureFiles(f.config.retained.databasePath);

      const io = new FakeResetIo(['y']);
      await assert.rejects(
        () => runInteractiveReset(f.config, io),
        /主DBのない付随ファイルは帰属を確認できません/,
      );
      assert.deepEqual(captureFiles(f.config.retained.databasePath), retainedBefore);
      assert.equal(existsSync(`${f.config.weather.databasePath}-wal`), true);
    });
  });

  describe('AC-11: 途中失敗と自動再開', () => {
    it('afterUnlink での中断後に再開案内が表示され、同じコマンドで再開して完了できる', async () => {
      const f = setupFixture();
      const retainedBefore = captureFiles(f.config.retained.databasePath);
      const journalPath = `${f.config.weather.databasePath}.reset.json`;

      // 障害注入 deps: 1つ目の unlink 後に例外発生
      let faultInjected = false;
      const faultDeps: Partial<InteractiveResetDeps> = {
        reset: (cfg, opts, hooks) => {
          if (opts.mode === 'apply' && !faultInjected) {
            faultInjected = true;
            return resetWeatherDatabase(cfg, opts, {
              afterUnlink: (path) => {
                throw new Error(`障害注入: afterUnlink ${path}`);
              },
            });
          }
          return resetWeatherDatabase(cfg, opts, hooks);
        },
      };

      const io1 = new FakeResetIo(['y', 'y']);
      await assert.rejects(
        () => runInteractiveReset(f.config, io1, faultDeps),
        /障害注入: afterUnlink/,
      );

      // 表示に再実行案内があり、--resume の記載が無い
      const out1 = io1.outputs.join('\n');
      assert.ok(
        out1.includes('同じコマンド npm run db:reset:weather を再実行すると再開します。'),
        '再実行案内が含まれること',
      );
      assert.ok(!out1.includes('--resume'), '--resume の記載が無いこと');

      // journal が残り、アプリ起動は拒否される
      assert.equal(existsSync(journalPath), true, 'journalが残る');
      assert.throws(
        () => initializeDatabases(f.config),
        /未完了resetがあります/,
      );

      // 続けて同じ runInteractiveReset を y/y で実行すると再開
      const io2 = new FakeResetIo(['y', 'y']);
      const result2 = await runInteractiveReset(f.config, io2);
      assert.equal(result2, 'resumed');

      // 残りのファイルも削除され journal が消える
      assert.deepEqual(captureFiles(f.config.weather.databasePath), [null, null, null, null]);
      assert.equal(existsSync(journalPath), false);
      assertRetainedIntact(f, retainedBefore);
    });
  });

  describe('AC-12: journal改変・別inodeの拒否', () => {
    it('journal 改変または削除予定パスに別inodeのファイルを置いた場合、再開は拒否され不変', async () => {
      const f = setupFixture();
      const journalPath = `${f.config.weather.databasePath}.reset.json`;

      // 障害注入で journal を残す
      let faultInjected = false;
      const faultDeps: Partial<InteractiveResetDeps> = {
        reset: (cfg, opts, hooks) => {
          if (opts.mode === 'apply' && !faultInjected) {
            faultInjected = true;
            return resetWeatherDatabase(cfg, opts, {
              afterUnlink: () => {
                throw new Error('fault');
              },
            });
          }
          return resetWeatherDatabase(cfg, opts, hooks);
        },
      };

      const io1 = new FakeResetIo(['y', 'y']);
      await assert.rejects(() => runInteractiveReset(f.config, io1, faultDeps));
      assert.equal(existsSync(journalPath), true);

      // ケース1: journal を改変 (planDigest を偽造)
      const originalJournalStr = readFileSync(journalPath, 'utf8');
      const tampered = JSON.parse(originalJournalStr);
      tampered.plan.planDigest = '0000000000000000000000000000000000000000000000000000000000000000';
      writeFileSync(journalPath, JSON.stringify(tampered));

      const io2 = new FakeResetIo(['y', 'y']);
      await assert.rejects(
        () => runInteractiveReset(f.config, io2),
        /reset journalの対象・進捗を検証できません/,
      );

      // ケース2: 削除予定パスに別inodeのファイルを置く (元のjournalを復元してから)
      writeFileSync(journalPath, originalJournalStr);
      // 主DBは1回目のapplyでunlinkされたため、同じパスに新しいファイルを置くことで別inodeにする
      writeFileSync(f.config.weather.databasePath, 'different-inode-file');

      const io3 = new FakeResetIo(['y', 'y']);
      await assert.rejects(
        () => runInteractiveReset(f.config, io3),
        /reset journalの対象・進捗を検証できません/,
      );
      assert.equal(existsSync(journalPath), true, 'journalは保持される');
    });
  });

  describe('AC-N1: 非対話環境の拒否', () => {
    it('実 npm run db:reset:weather を stdin パイプで引数なし実行すると終了コード1・無変更で非対話手段の案内を出す', () => {
      const f = setupFixture();
      const weatherBefore = captureFiles(f.config.weather.databasePath);
      const retainedBefore = captureFiles(f.config.retained.databasePath);

      const result = spawnSync('npm', ['run', 'db:reset:weather'], {
        cwd: resolve(import.meta.dirname, '../../..'),
        env: {
          ...process.env,
          WX_VIEWER_WEATHER_DB_PATH: f.config.weather.databasePath,
          WX_VIEWER_RETAINED_DB_PATH: f.config.retained.databasePath,
        },
        stdio: ['pipe', 'pipe', 'pipe'], // stdin をパイプにする
        encoding: 'utf8',
      });

      assert.equal(result.status, 1, `終了コードが1であること (stderr: ${result.stderr})`);
      assert.ok(
        result.stderr.includes('非対話環境です。引数を指定して実行してください'),
        '非対話手段の案内が出ること',
      );
      assert.deepEqual(captureFiles(f.config.weather.databasePath), weatherBefore, '気象DB不変');
      assert.deepEqual(captureFiles(f.config.retained.databasePath), retainedBefore, '保持DB不変');
    });
  });

  describe('AC-S2: 安全性の非後退', () => {
    it('同一パスの設定で実行すると問いを出す前に拒否され全対象不変', async () => {
      const f = setupFixture();
      const weatherBefore = captureFiles(f.config.weather.databasePath);
      const samePathConfig = {
        weather: f.config.weather,
        retained: { ...f.config.retained, databasePath: f.config.weather.databasePath },
      };

      const io = new FakeResetIo([]);
      await assert.rejects(
        () => runInteractiveReset(samePathConfig, io),
        /気象DBと保持DBが同一ファイルです/,
      );
      assert.equal(io.questions.length, 0);
      assert.deepEqual(captureFiles(f.config.weather.databasePath), weatherBefore);
    });

    it('hardlink の設定で実行すると拒否され全対象不変', async () => {
      const f = setupFixture();
      const weatherContent = readFileSync(f.config.weather.databasePath);
      const hardlinkPath = join(dir, 'hardlink-retained.sqlite3');
      linkSync(f.config.weather.databasePath, hardlinkPath);
      const hardlinkConfig = {
        weather: f.config.weather,
        retained: { ...f.config.retained, databasePath: hardlinkPath },
      };

      const io = new FakeResetIo([]);
      await assert.rejects(
        () => runInteractiveReset(hardlinkConfig, io),
        /通常の単一リンクファイルではありません/,
      );
      assert.equal(io.questions.length, 0);
      rmSync(hardlinkPath);
      assert.deepEqual(readFileSync(f.config.weather.databasePath), weatherContent);
    });

    it('symlink の設定で実行すると拒否され全対象不変', async () => {
      const f = setupFixture();
      const weatherBefore = captureFiles(f.config.weather.databasePath);
      const symlinkPath = join(dir, 'symlink-weather.sqlite3');
      symlinkSync(f.config.weather.databasePath, symlinkPath);
      const symlinkConfig = {
        weather: { ...f.config.weather, databasePath: symlinkPath },
        retained: f.config.retained,
      };

      const io = new FakeResetIo([]);
      await assert.rejects(
        () => runInteractiveReset(symlinkConfig, io),
        /通常の単一リンクファイルではありません/,
      );
      assert.equal(io.questions.length, 0);
      assert.deepEqual(captureFiles(f.config.weather.databasePath), weatherBefore);
    });

    it('role 違いの設定で実行すると拒否され全対象不変', async () => {
      const f = setupFixture();
      const weatherBefore = captureFiles(f.config.weather.databasePath);
      const wrongRoleConfig = {
        weather: { ...f.config.weather, role: 'invalid_role' as any },
        retained: f.config.retained,
      };

      const io = new FakeResetIo([]);
      await assert.rejects(
        () => runInteractiveReset(wrongRoleConfig, io),
        /DB role設定が不正です/,
      );
      assert.equal(io.questions.length, 0);
      assert.deepEqual(captureFiles(f.config.weather.databasePath), weatherBefore);
    });
  });
});
