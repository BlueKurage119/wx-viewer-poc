import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRetryableDatabaseClose } from '../src/serverClose.js';
import { releaseOwnedRoleLease, type WriterLeaseOwner } from '../src/database/roleDatabase.js';
import {
  acquireWriterLock,
  probeProcess,
  type ProcessProbe,
  type WriterLockDeps,
} from '../src/database/writerLock.js';

const HOST = hostname();
const OLD_STARTED = '2026-10-01T00:00:00.000Z';
const OLD_STARTED_MS = Date.parse(OLD_STARTED);

let dir: string;
let lock: string;
let warns: string[];
let errors: string[];

function owner(token: string, pid = 424242): WriterLeaseOwner {
  return {
    pid,
    role: 'retained',
    token,
    startedAt: '2026-10-01T00:00:01.000Z',
    serverGenerationId: 'gen',
    workerGeneration: null,
    threadId: null,
  };
}

function makeDeps(probe: ProcessProbe, extra: Partial<WriterLockDeps> = {}): WriterLockDeps {
  return {
    probeProcess: () => probe,
    currentIdentity: () => ({ processStartedAt: '2026-10-09T00:00:00.000Z', hostname: HOST }),
    log: {
      warn: (message: string) => void warns.push(message),
      error: (message: string) => void errors.push(message),
    },
    ...extra,
  };
}

function placeLock(path: string, record: Record<string, unknown> | string | null) {
  mkdirSync(path, { recursive: true });
  if (record === null) return;
  writeFileSync(
    join(path, 'owner.json'),
    typeof record === 'string' ? record : JSON.stringify(record),
  );
}

function oldRecord(token = 'T0token0-aaaa') {
  return { ...owner(token), processStartedAt: OLD_STARTED, hostname: HOST };
}

function readOwner(path: string) {
  return JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8')) as Record<string, unknown>;
}

function assertNoPaths() {
  for (const text of [...warns, ...errors]) {
    assert.ok(!text.includes(process.cwd()), text);
    assert.ok(!text.includes(homedir()), text);
    assert.ok(!text.includes(dir), text);
    assert.ok(!text.includes('\n'), text);
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'writer-lock-'));
  lock = join(dir, 'retained.sqlite3.writer-lock');
  warns = [];
  errors = [];
});
afterEach(() => {
  mock.restoreAll();
  rmSync(dir, { recursive: true, force: true });
});

describe('writerLock 取得', () => {
  it('新規取得で owner.json に processStartedAt と hostname を書く', () => {
    acquireWriterLock(lock, owner('new-token-1'), makeDeps({ state: 'absent' }));
    const written = readOwner(lock);
    assert.equal(written.token, 'new-token-1');
    assert.equal(written.processStartedAt, '2026-10-09T00:00:00.000Z');
    assert.equal(written.hostname, HOST);
    assert.deepEqual([...warns, ...errors], []);
  });

  it('pid不在の残留ロックを引き継ぎ、旧ownerを退避先に残す', () => {
    placeLock(lock, oldRecord());
    acquireWriterLock(lock, owner('new-token-1'), makeDeps({ state: 'absent' }));
    assert.equal(readOwner(lock).token, 'new-token-1');
    assert.equal(readOwner(`${lock}.stale-T0token0-aaaa`).token, 'T0token0-aaaa');
    assert.ok(existsSync(join(`${lock}.stale-T0token0-aaaa`, 'taken-over.json')));
    const takeover = warns.filter((w) => w.startsWith('[writer-lock] takeover '));
    assert.equal(takeover.length, 1);
    assert.match(takeover[0] as string, /reason=pid_not_found/);
    assert.match(takeover[0] as string, /oldPid=424242/);
    assert.match(takeover[0] as string, /lock=retained\.sqlite3\.writer-lock/);
    assertNoPaths();
  });

  it('pid再利用(起動時刻が2秒超ずれる)なら引き継ぐ', () => {
    placeLock(lock, oldRecord());
    acquireWriterLock(
      lock,
      owner('new-token-1'),
      makeDeps({ state: 'present', startedAtMs: OLD_STARTED_MS + 3000 }),
    );
    assert.equal(readOwner(lock).token, 'new-token-1');
    assert.ok(warns.some((w) => /takeover .*reason=pid_reused/.test(w)));
    assertNoPaths();
  });

  const refusals: [string, Record<string, unknown> | string | null, ProcessProbe, string][] = [
    [
      'owner_alive',
      oldRecord(),
      { state: 'present', startedAtMs: OLD_STARTED_MS + 1000 },
      'owner_alive',
    ],
    ['legacy_owner', { ...owner('T0token0-aaaa') }, { state: 'absent' }, 'legacy_owner'],
    ['owner.json破損', '{', { state: 'absent' }, 'owner_unreadable'],
    ['owner.jsonなし', null, { state: 'absent' }, 'owner_unreadable'],
    ['判定不能', oldRecord(), { state: 'unknown', detail: 'x' }, 'probe_failed'],
    ['同一pid', { ...oldRecord(), pid: process.pid }, { state: 'absent' }, 'same_process'],
    ['別ホスト', { ...oldRecord(), hostname: `${HOST}-other` }, { state: 'absent' }, 'other_host'],
  ];
  for (const [name, record, probe, reason] of refusals) {
    it(`奪わず EEXIST で失敗する: ${name}`, () => {
      placeLock(lock, record);
      const before = existsSync(join(lock, 'owner.json'))
        ? readFileSync(join(lock, 'owner.json'), 'utf8')
        : null;
      assert.throws(
        () => acquireWriterLock(lock, owner('new-token-1'), makeDeps(probe)),
        (error: NodeJS.ErrnoException) => error.code === 'EEXIST',
      );
      const after = existsSync(join(lock, 'owner.json'))
        ? readFileSync(join(lock, 'owner.json'), 'utf8')
        : null;
      assert.equal(after, before);
      assert.deepEqual(
        readdirSync(dir).filter((n) => n.includes('.stale-')),
        [],
      );
      assert.equal(errors.length, 1);
      assert.match(errors[0] as string, new RegExp(`takeover_refused .*reason=${reason}`));
      assertNoPaths();
    });
  }

  it('ABA防御: 判定後に別プロセスが引き継いでいたら rename が ENOTEMPTY で失敗し新lockは不変', () => {
    placeLock(lock, oldRecord('T0token0-aaaa'));
    const probe = (): ProcessProbe => {
      // 判定(旧T0を読んだ後)に別プロセスが引き継ぎ済みの状態を再現する
      mkdirSync(`${lock}.stale-T0token0-aaaa`);
      writeFileSync(join(`${lock}.stale-T0token0-aaaa`, 'owner.json'), JSON.stringify(oldRecord()));
      rmSync(lock, { recursive: true });
      placeLock(lock, { ...oldRecord('T1token1-bbbb') });
      return { state: 'absent' };
    };
    assert.throws(
      () =>
        acquireWriterLock(
          lock,
          owner('new-token-1'),
          makeDeps({ state: 'absent' }, { probeProcess: probe }),
        ),
      (error: NodeJS.ErrnoException) => error.code === 'EEXIST',
    );
    assert.equal(readOwner(lock).token, 'T1token1-bbbb');
    assert.ok(warns.some((w) => /takeover_lost .*step=rename .*code=ENOTEMPTY/.test(w)));
    assertNoPaths();
  });

  it('退避後に旧tokenと違うownerだったら戻して失敗する(takeover_aborted)', () => {
    placeLock(lock, oldRecord('T0token0-aaaa'));
    const probe = (): ProcessProbe => {
      // 判定後に owner.json だけ別トークンへ差し替わった
      writeFileSync(join(lock, 'owner.json'), JSON.stringify(oldRecord('T9token9-zzzz')));
      return { state: 'absent' };
    };
    assert.throws(() =>
      acquireWriterLock(
        lock,
        owner('new-token-1'),
        makeDeps({ state: 'absent' }, { probeProcess: probe }),
      ),
    );
    assert.equal(readOwner(lock).token, 'T9token9-zzzz');
    assert.ok(errors.some((e) => /takeover_aborted .*restored=true/.test(e)));
  });
});

describe('writerLock 同時引き継ぎ(実プロセス)', () => {
  it('4プロセス同時でも成功はちょうど1で、ownerは成功した子のpid', async () => {
    const child = fileURLToPath(new URL('./helpers/writerLockChild.ts', import.meta.url));
    for (let round = 0; round < 20; round += 1) {
      rmSync(lock, { recursive: true, force: true });
      for (const name of readdirSync(dir)) rmSync(join(dir, name), { recursive: true });
      const dead = spawnSync(process.execPath, ['-e', '']);
      assert.ok(dead.pid);
      placeLock(lock, {
        ...owner(`dead-${round}-token`, dead.pid),
        processStartedAt: OLD_STARTED,
        hostname: HOST,
      });
      const procs = Array.from({ length: 4 }, () =>
        spawn(process.execPath, ['--import', 'tsx', child, lock], {
          stdio: ['pipe', 'pipe', 'ignore'],
        }),
      );
      const outputs = procs.map((proc) => {
        const state = { out: '', ready: undefined as (() => void) | undefined };
        const readyPromise = new Promise<void>((resolve) => (state.ready = resolve));
        proc.stdout.on('data', (chunk: Buffer) => {
          state.out += chunk.toString();
          if (state.out.includes('READY')) state.ready?.();
        });
        const done = new Promise<string>((resolve) => {
          proc.stdout.on('data', () => {
            const result = /(OK \d+|FAIL \w+)/.exec(state.out);
            if (result) resolve(result[1] as string);
          });
        });
        return { readyPromise, done };
      });
      await Promise.all(outputs.map((o) => o.readyPromise));
      const startAt = Date.now() + 300;
      for (const proc of procs) proc.stdin.write(`${startAt}\n`);
      const results = await Promise.all(outputs.map((o) => o.done));
      for (const proc of procs) proc.kill('SIGKILL');
      const successes = results.filter((r) => r.startsWith('OK '));
      assert.equal(successes.length, 1, `round ${round}: ${results.join(' | ')}`);
      assert.equal(readOwner(lock).pid, Number((successes[0] as string).slice(3)));
    }
  });
});

describe('writerLock 古い退避先の削除', () => {
  function stale(name: string, takenOverAgoMs: number | null) {
    const path = join(dir, name);
    mkdirSync(path);
    writeFileSync(join(path, 'owner.json'), '{}');
    if (takenOverAgoMs !== null) {
      writeFileSync(
        join(path, 'taken-over.json'),
        JSON.stringify({ takenOverAt: new Date(Date.now() - takenOverAgoMs).toISOString() }),
      );
    } else {
      const old = new Date(Date.now() - 2 * 3600_000);
      utimesSync(join(path, 'owner.json'), old, old);
      utimesSync(path, old, old);
    }
    return path;
  }

  it('1時間超だけ削除し、他の名前は触らない', () => {
    const a = stale('retained.sqlite3.writer-lock.stale-A', 2 * 3600_000);
    const b = stale('retained.sqlite3.writer-lock.stale-B', 10 * 60_000);
    const x = stale('other.sqlite3.writer-lock.stale-X', 2 * 3600_000);
    // C: taken-over.json なし。ctime は直前の作成で新しいため大きい方=新しい扱いで残る
    const c = stale('retained.sqlite3.writer-lock.stale-C', null);
    acquireWriterLock(lock, owner('new-token-1'), makeDeps({ state: 'absent' }));
    assert.ok(!existsSync(a));
    assert.ok(existsSync(b));
    assert.ok(existsSync(x));
    assert.ok(existsSync(c), 'ctime が新しいので削除しない側に倒れる');
    const removed = warns.filter((w) => w.startsWith('[writer-lock] stale_removed'));
    assert.equal(removed.length, 1);
    assert.match(removed[0] as string, /stale=retained\.sqlite3\.writer-lock\.stale-A/);
    assertNoPaths();
  });

  it('削除に失敗しても取得は成功し stale_remove_failed を1行出す', () => {
    const a = stale('retained.sqlite3.writer-lock.stale-A', 2 * 3600_000);
    acquireWriterLock(
      lock,
      owner('new-token-1'),
      makeDeps(
        { state: 'absent' },
        {
          removeDir: () => {
            throw Object.assign(new Error('x'), { code: 'EACCES' });
          },
        },
      ),
    );
    assert.equal(readOwner(lock).token, 'new-token-1');
    assert.ok(existsSync(a));
    const failed = warns.filter((w) => w.startsWith('[writer-lock] stale_remove_failed'));
    assert.equal(failed.length, 1);
    assert.match(failed[0] as string, /code=EACCES/);
  });
});

describe('probeProcess 実プロセス', () => {
  it('自プロセスは present で起動時刻が uptime と2秒以内', () => {
    const probe = probeProcess(process.pid);
    assert.equal(probe.state, 'present');
    if (probe.state !== 'present') return;
    const expected = Date.now() - process.uptime() * 1000;
    assert.ok(
      Math.abs(probe.startedAtMs - expected) <= 2000,
      `${probe.startedAtMs} vs ${expected}`,
    );
  });

  it('終了済み子プロセスのpidは absent', () => {
    const dead = spawnSync(process.execPath, ['-e', '']);
    assert.ok(dead.pid);
    assert.deepEqual(probeProcess(dead.pid), { state: 'absent' });
  });
});

describe('解放失敗ログ', () => {
  it('owner不一致で lease_owner_unverified を投げ release_failed を1行出す', () => {
    const errorMock = mock.method(console, 'error', () => undefined);
    acquireWriterLock(lock, owner('new-token-1'), makeDeps({ state: 'absent' }));
    writeFileSync(join(lock, 'owner.json'), JSON.stringify({ ...owner('other-token'), x: 1 }));
    const config = { databasePath: join(dir, 'retained.sqlite3') } as never;
    assert.throws(
      () => releaseOwnedRoleLease(config, owner('new-token-1')),
      /lease_owner_unverified/,
    );
    const lines = errorMock.mock.calls.map((c) => String(c.arguments[0]));
    assert.equal(lines.length, 1);
    assert.match(
      lines[0] as string,
      /^\[writer-lock\] release_failed lock=retained\.sqlite3\.writer-lock role=retained reason=lease_owner_unverified pid=424242 threadId=null$/,
    );
    assert.ok(!lines[0]?.includes(homedir()));
  });

  it('owner.jsonが null でも lease_owner_unverified を投げ release_failed を1行出す', () => {
    const errorMock = mock.method(console, 'error', () => undefined);
    acquireWriterLock(lock, owner('new-token-1'), makeDeps({ state: 'absent' }));
    writeFileSync(join(lock, 'owner.json'), 'null');
    const config = { databasePath: join(dir, 'retained.sqlite3') } as never;
    assert.throws(
      () => releaseOwnedRoleLease(config, owner('new-token-1')),
      /lease_owner_unverified/,
    );
    const lines = errorMock.mock.calls.map((c) => String(c.arguments[0]));
    assert.equal(lines.length, 1);
    assert.match(lines[0] as string, /release_failed .*reason=lease_owner_unverified/);
  });
});

describe('API終了ログ', () => {
  function capture() {
    const w = mock.method(console, 'warn', () => undefined);
    const e = mock.method(console, 'error', () => undefined);
    return {
      warns: () => w.mock.calls.map((c) => String(c.arguments[0])),
      errors: () => e.mock.calls.map((c) => String(c.arguments[0])),
    };
  }

  it('成功時は start と complete elapsedMs', async () => {
    const logs = capture();
    await createRetryableDatabaseClose(
      async () => undefined,
      () => undefined,
    )({ reason: 'signal' });
    assert.equal(logs.warns()[0], '[api-shutdown] start reason=signal');
    assert.match(logs.warns()[1] as string, /^\[api-shutdown\] complete elapsedMs=\d+$/);
    assert.deepEqual(logs.errors(), []);
  });

  it('stop 失敗は stage=stop、パスは置換される', async () => {
    const logs = capture();
    const close = createRetryableDatabaseClose(
      async () => {
        throw new Error(`失敗 ${process.cwd()}/a ${homedir()}/b`);
      },
      () => undefined,
    );
    await assert.rejects(close());
    const text = logs.errors()[0] as string;
    assert.match(text, /^\[api-shutdown\] stage_failed stage=stop error=/);
    assert.ok(text.includes('./a'));
    assert.ok(!text.includes(process.cwd()));
    assert.ok(!text.includes(homedir()));
    assert.ok(!logs.warns().some((w) => w.includes('complete')));
  });

  it('closeDatabase 失敗は stage=close_database', async () => {
    const logs = capture();
    const close = createRetryableDatabaseClose(
      async () => undefined,
      () => {
        throw new Error('close失敗');
      },
    );
    await assert.rejects(close());
    assert.match(logs.errors()[0] as string, /stage_failed stage=close_database error="close失敗"/);
    assert.ok(!logs.warns().some((w) => w.includes('complete')));
  });
});
