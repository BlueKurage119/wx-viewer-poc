import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  initializeDatabases,
  resolveDatabasePairConfig,
} from '../src/database/index.js';
import {
  acquireWriterLeases,
  captureFiles,
} from '../src/database/pairSafety.js';
import {
  runInteractiveReset,
  type ResetIo,
} from '../src/database/resetInteractive.js';
import {
  inspectWriterLock,
  quarantineStaleWriterLock,
} from '../src/database/writerLockInspection.js';
import {
  currentIdentity,
  probeProcess,
} from '../src/database/writerLock.js';
import { initializeRoleDatabase } from '../src/database/roleDatabase.js';

class FakeResetIo implements ResetIo {
  outputs: string[] = [];
  questions: string[] = [];
  private answers: string[];

  constructor(answers: string[]) {
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
    return answer;
  }
}

describe('writerLockInspection & 残留lock受け入れ条件', () => {
  let dir: string;
  const childProcesses: ReturnType<typeof spawn>[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wx293-lock-test-'));
  });

  afterEach(() => {
    for (const cp of childProcesses) {
      try {
        cp.kill('SIGKILL');
      } catch {
        // すでに終了していれば無視
      }
    }
    childProcesses.length = 0;
    rmSync(dir, { recursive: true, force: true });
  });

  function spawnAliveChild(): { pid: number; startedAtMs: number } {
    const cp = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    childProcesses.push(cp);
    assert.ok(cp.pid);
    const probe = probeProcess(cp.pid);
    assert.equal(probe.state, 'present');
    return { pid: cp.pid, startedAtMs: probe.startedAtMs };
  }

  function getDeadPid(): number {
    const dead = spawnSync(process.execPath, ['-e', '']);
    assert.ok(dead.pid);
    const probe = probeProcess(dead.pid);
    assert.equal(probe.state, 'absent');
    return dead.pid;
  }

  function setupDatabases() {
    const config = resolveDatabasePairConfig({
      WX_VIEWER_WEATHER_DB_PATH: join(dir, 'weather.sqlite3'),
      WX_VIEWER_RETAINED_DB_PATH: join(dir, 'retained.sqlite3'),
    });
    const pair = initializeDatabases(config);
    pair.close();
    return config;
  }

  describe('inspectWriterLock 基本判定', () => {
    it('lockが存在しない場合は absent', () => {
      const lockPath = join(dir, 'weather.sqlite3.writer-lock');
      const result = inspectWriterLock(lockPath);
      assert.deepEqual(result, { state: 'absent' });
    });

    it('ディレクトリでない/symlinkの場合は not_directory', () => {
      const filePath = join(dir, 'file.lock');
      writeFileSync(filePath, 'not a dir');
      assert.deepEqual(inspectWriterLock(filePath), {
        state: 'undeterminable',
        reason: 'not_directory',
      });

      const symlinkPath = join(dir, 'symlink.lock');
      symlinkSync(filePath, symlinkPath);
      assert.deepEqual(inspectWriterLock(symlinkPath), {
        state: 'undeterminable',
        reason: 'not_directory',
      });
    });

    it('owner.json が読めない/壊れている場合は owner_unreadable', () => {
      const lockPath = join(dir, 'corrupt.lock');
      mkdirSync(lockPath);
      assert.deepEqual(inspectWriterLock(lockPath), {
        state: 'undeterminable',
        reason: 'owner_unreadable',
      });

      writeFileSync(join(lockPath, 'owner.json'), 'not json');
      assert.deepEqual(inspectWriterLock(lockPath), {
        state: 'undeterminable',
        reason: 'owner_unreadable',
      });

      writeFileSync(join(lockPath, 'owner.json'), JSON.stringify({ pid: 'not-a-number' }));
      assert.deepEqual(inspectWriterLock(lockPath), {
        state: 'undeterminable',
        reason: 'owner_unreadable',
      });
    });

    it('hostname が異なる場合は other_host', () => {
      const lockPath = join(dir, 'other-host.lock');
      mkdirSync(lockPath);
      writeFileSync(
        join(lockPath, 'owner.json'),
        JSON.stringify({ pid: 1234, token: 'token-1', hostname: 'remote-server' }),
      );
      assert.deepEqual(
        inspectWriterLock(lockPath, {
          currentIdentity: () => ({ processStartedAt: null, hostname: 'local-server' }),
        }),
        { state: 'undeterminable', reason: 'other_host' },
      );
    });

    it('probeProcess が unknown の場合は probe_failed', () => {
      const lockPath = join(dir, 'probe-fail.lock');
      mkdirSync(lockPath);
      writeFileSync(
        join(lockPath, 'owner.json'),
        JSON.stringify({ pid: 1234, token: 'token-1', hostname: hostname() }),
      );
      assert.deepEqual(
        inspectWriterLock(lockPath, {
          probeProcess: () => ({ state: 'unknown', detail: 'test' }),
        }),
        { state: 'undeterminable', reason: 'probe_failed' },
      );
    });
  });

  describe('AC-7: stale解除', () => {
    it('(a) 終了済み子プロセスのPIDを記録した #266形式lock を解除して完了できる', async () => {
      const config = setupDatabases();
      const lockPath = `${config.weather.databasePath}.writer-lock`;
      const deadPid = getDeadPid();
      const token = 'token-dead-266';
      mkdirSync(lockPath);
      writeFileSync(
        join(lockPath, 'owner.json'),
        JSON.stringify({
          pid: deadPid,
          token,
          role: 'weather',
          startedAt: new Date().toISOString(),
          processStartedAt: '2026-10-01T00:00:00.000Z',
          hostname: hostname(),
        }),
      );

      const io = new FakeResetIo(['y', 'y', 'y']); // 1: stale解除, 2: 停止申告, 3: 削除実行
      const result = await runInteractiveReset(config, io);
      assert.equal(result, 'completed');

      assert.equal(existsSync(lockPath), false, 'lockは元のパスに存在しない');
      const stalePath = `${lockPath}.stale-${token}`;
      assert.equal(existsSync(stalePath), true, 'lockは退避先に存在する');
      assert.equal(existsSync(join(stalePath, 'taken-over.json')), true, 'taken-over.jsonがある');
      assert.deepEqual(captureFiles(config.weather.databasePath), [null, null, null, null]);
    });

    it('(b) 終了済み子プロセスのPIDで hostname・processStartedAt の無い旧形式lock を解除して完了できる', async () => {
      const config = setupDatabases();
      const lockPath = `${config.weather.databasePath}.writer-lock`;
      const deadPid = getDeadPid();
      const token = 'token-dead-legacy';
      mkdirSync(lockPath);
      writeFileSync(
        join(lockPath, 'owner.json'),
        JSON.stringify({
          pid: deadPid,
          token,
          role: 'weather',
          startedAt: new Date().toISOString(),
        }),
      );

      const io = new FakeResetIo(['y', 'y', 'y']);
      const result = await runInteractiveReset(config, io);
      assert.equal(result, 'completed');

      assert.equal(existsSync(lockPath), false);
      const stalePath = `${lockPath}.stale-${token}`;
      assert.equal(existsSync(stalePath), true);
      assert.equal(existsSync(join(stalePath, 'taken-over.json')), true);
    });

    it('(c) 生存中PIDだが起動時刻が2秒超異なるPID再利用lockで、時刻を表示して解除できる', async () => {
      const config = setupDatabases();
      const lockPath = `${config.weather.databasePath}.writer-lock`;
      const alive = spawnAliveChild();
      const recordedStartedAt = new Date(alive.startedAtMs - 10000).toISOString(); // 10秒前
      const token = 'token-reused-pid';
      mkdirSync(lockPath);
      writeFileSync(
        join(lockPath, 'owner.json'),
        JSON.stringify({
          pid: alive.pid,
          token,
          role: 'weather',
          startedAt: new Date().toISOString(),
          processStartedAt: recordedStartedAt,
          hostname: hostname(),
        }),
      );

      const io = new FakeResetIo(['y', 'y', 'y']);
      const result = await runInteractiveReset(config, io);
      assert.equal(result, 'completed');

      // 記録時刻と現在の起動時刻が表示されていることの検証
      const outputText = io.outputs.join('\n');
      assert.ok(
        outputText.includes(recordedStartedAt),
        '記録された起動時刻が表示に含まれていること',
      );
      assert.ok(
        outputText.includes('現在のプロセス起動時刻'),
        '現在のプロセス起動時刻が表示に含まれていること',
      );

      assert.equal(existsSync(lockPath), false);
      const stalePath = `${lockPath}.stale-${token}`;
      assert.equal(existsSync(stalePath), true);
      assert.equal(existsSync(join(stalePath, 'taken-over.json')), true);
    });

    it('解除確認で n なら lock・DBとも不変', async () => {
      const config = setupDatabases();
      const beforeWeather = captureFiles(config.weather.databasePath);
      const lockPath = `${config.weather.databasePath}.writer-lock`;
      const deadPid = getDeadPid();
      const token = 'token-cancelled';
      mkdirSync(lockPath);
      writeFileSync(
        join(lockPath, 'owner.json'),
        JSON.stringify({
          pid: deadPid,
          token,
          role: 'weather',
          startedAt: new Date().toISOString(),
          processStartedAt: '2026-10-01T00:00:00.000Z',
          hostname: hostname(),
        }),
      );

      const io = new FakeResetIo(['n']);
      const result = await runInteractiveReset(config, io);
      assert.equal(result, 'cancelled');

      assert.equal(existsSync(lockPath), true, 'lockは元の位置に残る');
      assert.deepEqual(captureFiles(config.weather.databasePath), beforeWeather, 'DBは不変');
    });
  });

  describe('AC-8: 生存PIDおよび判定不能lockは拒否', () => {
    it('(a) 生存中の子プロセスPID・正しい起動時刻のlockは解除の問いを出さずに拒否', async () => {
      const config = setupDatabases();
      const beforeWeather = captureFiles(config.weather.databasePath);
      const lockPath = `${config.weather.databasePath}.writer-lock`;
      const alive = spawnAliveChild();
      mkdirSync(lockPath);
      writeFileSync(
        join(lockPath, 'owner.json'),
        JSON.stringify({
          pid: alive.pid,
          token: 'token-alive',
          role: 'weather',
          processStartedAt: new Date(alive.startedAtMs).toISOString(),
          hostname: hostname(),
        }),
      );

      const io = new FakeResetIo([]);
      await assert.rejects(
        () => runInteractiveReset(config, io),
        /writer lock が存在し、プロセスが稼働中です/,
      );
      assert.equal(io.questions.length, 0, '問いを出していないこと');
      assert.equal(existsSync(lockPath), true);
      assert.deepEqual(captureFiles(config.weather.databasePath), beforeWeather);
    });

    it('(b) 生存中の子プロセスPIDを記録した旧形式(起動時刻なし)は拒否', async () => {
      const config = setupDatabases();
      const beforeWeather = captureFiles(config.weather.databasePath);
      const lockPath = `${config.weather.databasePath}.writer-lock`;
      const alive = spawnAliveChild();
      mkdirSync(lockPath);
      writeFileSync(
        join(lockPath, 'owner.json'),
        JSON.stringify({
          pid: alive.pid,
          token: 'token-alive-legacy',
          role: 'weather',
        }),
      );

      const io = new FakeResetIo([]);
      await assert.rejects(
        () => runInteractiveReset(config, io),
        /writer lock が存在し、プロセスが稼働中です/,
      );
      assert.equal(io.questions.length, 0);
      assert.equal(existsSync(lockPath), true);
      assert.deepEqual(captureFiles(config.weather.databasePath), beforeWeather);
    });

    it('(c) hostname が異なるlockは拒否', async () => {
      const config = setupDatabases();
      const beforeWeather = captureFiles(config.weather.databasePath);
      const lockPath = `${config.weather.databasePath}.writer-lock`;
      mkdirSync(lockPath);
      writeFileSync(
        join(lockPath, 'owner.json'),
        JSON.stringify({
          pid: 99999,
          token: 'token-other-host',
          role: 'weather',
          hostname: 'different-host-name',
        }),
      );

      const io = new FakeResetIo([]);
      await assert.rejects(
        () => runInteractiveReset(config, io),
        /writer lock の状態を判定できません/,
      );
      assert.equal(io.questions.length, 0);
      assert.equal(existsSync(lockPath), true);
      assert.deepEqual(captureFiles(config.weather.databasePath), beforeWeather);
    });

    it('(d) owner.json 破損は拒否', async () => {
      const config = setupDatabases();
      const beforeWeather = captureFiles(config.weather.databasePath);
      const lockPath = `${config.weather.databasePath}.writer-lock`;
      mkdirSync(lockPath);
      writeFileSync(join(lockPath, 'owner.json'), 'not valid json');

      const io = new FakeResetIo([]);
      await assert.rejects(
        () => runInteractiveReset(config, io),
        /writer lock の状態を判定できません/,
      );
      assert.equal(io.questions.length, 0);
      assert.equal(existsSync(lockPath), true);
      assert.deepEqual(captureFiles(config.weather.databasePath), beforeWeather);
    });

    it('(e) probeProcess が unknown の場合は拒否', async () => {
      const config = setupDatabases();
      const beforeWeather = captureFiles(config.weather.databasePath);
      const lockPath = `${config.weather.databasePath}.writer-lock`;
      mkdirSync(lockPath);
      writeFileSync(
        join(lockPath, 'owner.json'),
        JSON.stringify({
          pid: 99999,
          token: 'token-probe-unknown',
          role: 'weather',
          hostname: hostname(),
        }),
      );

      const io = new FakeResetIo([]);
      await assert.rejects(
        () =>
          runInteractiveReset(config, io, {
            inspectLock: (p) =>
              inspectWriterLock(p, {
                probeProcess: () => ({ state: 'unknown', detail: 'test' }),
              }),
          }),
        /writer lock の状態を判定できません/,
      );
      assert.equal(io.questions.length, 0);
      assert.equal(existsSync(lockPath), true);
      assert.deepEqual(captureFiles(config.weather.databasePath), beforeWeather);
    });
  });

  describe('AC-9: 解除の競合', () => {
    it('退避前にlockが別tokenへ差し替えられた場合、token不一致で拒否され新lockが元の位置に残る', () => {
      const lockPath = join(dir, 'competing.writer-lock');
      mkdirSync(lockPath);
      writeFileSync(
        join(lockPath, 'owner.json'),
        JSON.stringify({
          pid: 1234,
          token: 'token-original',
          role: 'weather',
        }),
      );

      // quarantineStaleWriterLock を呼ぶが、期待トークンを別にして呼ぶ
      assert.throws(
        () => quarantineStaleWriterLock(lockPath, 'token-different'),
        /残留lockの退避に失敗しました\(token不一致\)/,
      );

      // 元の位置に lock が残っていること
      assert.equal(existsSync(lockPath), true);
      const ownerJson = JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8'));
      assert.equal(ownerJson.token, 'token-original');
      assert.equal(existsSync(`${lockPath}.stale-token-different`), false);
    });
  });

  describe('AC-10: reset由来lockの判定', () => {
    it('acquireWriterLeases が書く owner.json に processStartedAt と hostname が含まれ、終了後に #266 で引き継ぎ可能かつ対話で stale 判定される', () => {
      const config = setupDatabases();
      const release = acquireWriterLeases(config);
      const weatherLockPath = `${config.weather.databasePath}.writer-lock`;
      const ownerContent = JSON.parse(
        readFileSync(join(weatherLockPath, 'owner.json'), 'utf8'),
      ) as Record<string, unknown>;

      // 1. 各フィールドの存在確認
      assert.equal(typeof ownerContent.pid, 'number');
      assert.equal(typeof ownerContent.startedAt, 'string');
      assert.equal(typeof ownerContent.token, 'string');
      assert.equal(ownerContent.role, 'weather');
      assert.equal(typeof ownerContent.hostname, 'string');
      assert.ok(
        ownerContent.processStartedAt === null || typeof ownerContent.processStartedAt === 'string',
      );

      // release は実行せず、プロセス終了をシミュレートするため終了済みPIDのlockを作る
      release(); // いったん正常解放してクリーンアップ

      // 改めて acquireWriterLeases で書かれる内容と同等の owner.json を deadPid で配置
      const deadPid = getDeadPid();
      const identity = currentIdentity();
      mkdirSync(weatherLockPath);
      writeFileSync(
        join(weatherLockPath, 'owner.json'),
        JSON.stringify({
          pid: deadPid,
          startedAt: new Date().toISOString(),
          token: 'reset-origin-token',
          role: 'weather',
          processStartedAt: identity.processStartedAt ?? '2026-10-01T00:00:00.000Z',
          hostname: identity.hostname,
        }),
      );

      // 2. 対話判定で stale と判定されること
      const inspection = inspectWriterLock(weatherLockPath);
      assert.equal(inspection.state, 'stale');
      assert.equal(inspection.reason, 'pid_not_found');

      // 3. initializeRoleDatabase (#266 経路) が legacy_owner で拒否せず引き継げること
      const newOwner = {
        pid: process.pid,
        role: 'weather' as const,
        token: 'new-owner-token',
        startedAt: new Date().toISOString(),
        serverGenerationId: 'gen-1',
        workerGeneration: null,
        threadId: null,
      };
      const roleDb = initializeRoleDatabase(config, newOwner);
      roleDb.close();
      assert.equal(existsSync(weatherLockPath), false, 'roleDb が正常に引き継ぎ・解放した');
      assert.equal(
        existsSync(`${weatherLockPath}.stale-reset-origin-token`),
        true,
        'stale lock に退避された',
      );
    });
  });
});
