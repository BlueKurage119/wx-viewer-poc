import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { WriterLeaseOwner } from './roleDatabase.js';

/** owner.json に追記する拡張フィールド(WriterLeaseOwner 型自体は変えない) */
export interface WriterLockProcessIdentity {
  readonly processStartedAt: string | null;
  readonly hostname: string;
}

export type ProcessProbe =
  | { readonly state: 'absent' }
  | { readonly state: 'present'; readonly startedAtMs: number }
  | { readonly state: 'unknown'; readonly detail: string };

export interface WriterLockDeps {
  probeProcess(pid: number): ProcessProbe;
  currentIdentity(): WriterLockProcessIdentity;
  log: Pick<Console, 'warn' | 'error'>;
  /** 古い退避先の削除(テストで失敗を差し込むため。既定は rmSync) */
  removeDir?: (path: string) => void;
}

export const STALE_RETENTION_MS = 60 * 60 * 1000;
export const START_TIME_TOLERANCE_MS = 2000;

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

function readProcessStartMs(pid: number): { ms: number } | { detail: string } {
  let output: string;
  try {
    output = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' },
      timeout: 2000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (error) {
    return { detail: `ps_failed:${(error as { status?: number }).status ?? 'error'}` };
  }
  const text = output.trim();
  if (text === '') return { detail: 'ps_empty' };
  const match = /^\w{3} (\w{3}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(text);
  const month = match ? MONTHS[match[1] as string] : undefined;
  if (!match || month === undefined) return { detail: 'ps_unparsable' };
  return {
    ms: Date.UTC(
      Number(match[6]),
      month,
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
    ),
  };
}

export function probeProcess(pid: number): ProcessProbe {
  try {
    process.kill(pid, 0);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return { state: 'absent' };
    if (code !== 'EPERM') return { state: 'unknown', detail: `kill_${code ?? 'error'}` };
  }
  const result = readProcessStartMs(pid);
  if ('detail' in result) return { state: 'unknown', detail: result.detail };
  return { state: 'present', startedAtMs: result.ms };
}

let cachedIdentity: WriterLockProcessIdentity | undefined;

export function currentIdentity(): WriterLockProcessIdentity {
  if (cachedIdentity) return cachedIdentity;
  const result = readProcessStartMs(process.pid);
  cachedIdentity = {
    processStartedAt: 'ms' in result ? new Date(result.ms).toISOString() : null,
    hostname: hostname(),
  };
  return cachedIdentity;
}

const defaultDeps: WriterLockDeps = { probeProcess, currentIdentity, log: console };

function formatValue(value: unknown): string {
  const text = String(value);
  return /[\s"=]/.test(text) || text === '' ? JSON.stringify(text) : text;
}

function line(event: string, fields: Record<string, unknown>): string {
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`);
  return `[writer-lock] ${event}${parts.length > 0 ? ' ' : ''}${parts.join(' ')}`;
}

/** 解放失敗ログ(roleDatabase.ts から使う)。 */
export function logReleaseFailed(
  lockPath: string,
  owner: WriterLeaseOwner,
  reason: string,
  log: Pick<Console, 'error'> = console,
): void {
  log.error(
    line('release_failed', {
      lock: basename(lockPath),
      role: owner.role,
      reason,
      pid: owner.pid,
      threadId: owner.threadId,
    }),
  );
}

function eexist(lockPath: string, cause?: unknown): Error {
  const error = new Error(
    `EEXIST: ${basename(lockPath)} は既に存在します`,
  ) as NodeJS.ErrnoException;
  error.code = 'EEXIST';
  if (cause) error.cause = cause;
  return error;
}

function shortToken(token: unknown): string {
  return typeof token === 'string' ? token.slice(0, 8) : 'unknown';
}

function readOwnerFile(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.pid !== 'number' || typeof record.token !== 'string') return null;
    return record;
  } catch {
    return null;
  }
}

function writeOwner(
  lockPath: string,
  owner: WriterLeaseOwner,
  identity: WriterLockProcessIdentity,
) {
  try {
    writeFileSync(join(lockPath, 'owner.json'), JSON.stringify({ ...owner, ...identity }), {
      flag: 'wx',
    });
  } catch (error) {
    try {
      rmSync(lockPath, { recursive: true });
    } catch {
      // 後始末の失敗は元の例外を優先する
    }
    throw error;
  }
}

function cleanupStale(lockPath: string, deps: WriterLockDeps): void {
  const dir = dirname(lockPath);
  const prefix = `${basename(lockPath)}.stale-`;
  const remove = deps.removeDir ?? ((path: string) => rmSync(path, { recursive: true }));
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((name) => name.startsWith(prefix))
      .sort();
  } catch (error) {
    deps.log.warn(
      line('stale_remove_failed', {
        lock: basename(lockPath),
        stale: '*',
        code: (error as NodeJS.ErrnoException).code ?? 'unknown',
      }),
    );
    return;
  }
  const now = Date.now();
  for (const name of names) {
    const path = join(dir, name);
    try {
      const stat = statSync(path);
      if (!stat.isDirectory()) continue;
      let takenOverMs: number | undefined;
      try {
        const parsed = JSON.parse(readFileSync(join(path, 'taken-over.json'), 'utf8')) as {
          takenOverAt?: unknown;
        };
        const parsedMs =
          typeof parsed.takenOverAt === 'string' ? Date.parse(parsed.takenOverAt) : NaN;
        if (Number.isFinite(parsedMs)) takenOverMs = parsedMs;
      } catch {
        // mtime/ctime にフォールバックする
      }
      const at = takenOverMs ?? Math.max(stat.mtimeMs, stat.ctimeMs);
      const ageMs = now - at;
      if (ageMs <= STALE_RETENTION_MS) continue;
      remove(path);
      deps.log.warn(
        line('stale_removed', { lock: basename(lockPath), stale: name, ageMs: Math.round(ageMs) }),
      );
    } catch (error) {
      deps.log.warn(
        line('stale_remove_failed', {
          lock: basename(lockPath),
          stale: name,
          code: (error as NodeJS.ErrnoException).code ?? 'unknown',
        }),
      );
    }
  }
}

/** lock を取得し owner.json を書く。失敗時は従来どおり EEXIST 系の例外を投げる。 */
export function acquireWriterLock(
  lockPath: string,
  owner: WriterLeaseOwner,
  deps: WriterLockDeps = defaultDeps,
): void {
  const identity = deps.currentIdentity();
  if (identity.processStartedAt === null) {
    deps.log.warn(line('start_time_unavailable', { pid: process.pid, detail: 'ps_unavailable' }));
  }
  try {
    mkdirSync(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    takeOverStale(lockPath, owner, identity, deps, error);
    cleanupStale(lockPath, deps);
    return;
  }
  writeOwner(lockPath, owner, identity);
  cleanupStale(lockPath, deps);
}

function takeOverStale(
  lockPath: string,
  owner: WriterLeaseOwner,
  identity: WriterLockProcessIdentity,
  deps: WriterLockDeps,
  original: unknown,
): void {
  const lock = basename(lockPath);
  const old = readOwnerFile(join(lockPath, 'owner.json'));
  const refuse = (reason: string, extra: Record<string, unknown> = {}): never => {
    deps.log.error(
      line('takeover_refused', {
        lock,
        role: owner.role,
        reason,
        oldPid: old?.pid,
        ...extra,
      }),
    );
    throw original;
  };
  if (!old) return refuse('owner_unreadable');
  const oldStartedAt = old.processStartedAt;
  if (typeof oldStartedAt !== 'string') return refuse('legacy_owner');
  const recordedMs = Date.parse(oldStartedAt);
  if (!Number.isFinite(recordedMs)) return refuse('legacy_owner');
  if (old.hostname !== identity.hostname) return refuse('other_host');
  if (old.pid === process.pid) return refuse('same_process');
  const oldPid = old.pid as number;
  const probe = deps.probeProcess(oldPid);
  let reason: 'pid_not_found' | 'pid_reused';
  let currentProcessStartedAt: string | undefined;
  if (probe.state === 'unknown') return refuse('probe_failed', { detail: probe.detail });
  if (probe.state === 'absent') {
    reason = 'pid_not_found';
  } else if (Math.abs(recordedMs - probe.startedAtMs) <= START_TIME_TOLERANCE_MS) {
    return refuse('owner_alive');
  } else {
    reason = 'pid_reused';
    currentProcessStartedAt = new Date(probe.startedAtMs).toISOString();
  }

  const oldToken = old.token as string;
  const stalePath = `${lockPath}.stale-${oldToken}`;
  const lost = (step: 'rename' | 'mkdir', error: unknown): never => {
    deps.log.warn(
      line('takeover_lost', {
        lock,
        role: owner.role,
        step,
        code: (error as NodeJS.ErrnoException).code ?? 'unknown',
      }),
    );
    throw eexist(lockPath, error);
  };
  try {
    renameSync(lockPath, stalePath);
  } catch (error) {
    return lost('rename', error);
  }
  const moved = readOwnerFile(join(stalePath, 'owner.json'));
  if (!moved || moved.token !== oldToken) {
    let restored = false;
    try {
      renameSync(stalePath, lockPath);
      restored = true;
    } catch (error) {
      deps.log.error(
        line('takeover_aborted', {
          lock,
          role: owner.role,
          expectedToken: shortToken(oldToken),
          actualToken: moved ? shortToken(moved.token) : 'unreadable',
          restored,
          restoreCode: (error as NodeJS.ErrnoException).code ?? 'unknown',
        }),
      );
      throw eexist(lockPath);
    }
    deps.log.error(
      line('takeover_aborted', {
        lock,
        role: owner.role,
        expectedToken: shortToken(oldToken),
        actualToken: moved ? shortToken(moved.token) : 'unreadable',
        restored,
      }),
    );
    throw eexist(lockPath);
  }
  try {
    mkdirSync(lockPath);
  } catch (error) {
    return lost('mkdir', error);
  }
  writeOwner(lockPath, owner, identity);
  try {
    writeFileSync(
      join(stalePath, 'taken-over.json'),
      JSON.stringify({ takenOverAt: new Date().toISOString() }),
    );
  } catch (error) {
    deps.log.warn(
      line('takeover_record_failed', {
        lock,
        stale: basename(stalePath),
        code: (error as NodeJS.ErrnoException).code ?? 'unknown',
      }),
    );
  }
  deps.log.warn(
    line('takeover', {
      lock,
      role: owner.role,
      reason,
      stale: basename(stalePath),
      oldPid,
      oldRole: old.role,
      oldToken: shortToken(oldToken),
      oldStartedAt: old.startedAt,
      oldProcessStartedAt: oldStartedAt,
      oldServerGenerationId: old.serverGenerationId,
      oldWorkerGeneration: old.workerGeneration,
      oldThreadId: old.threadId,
      currentProcessStartedAt,
    }),
  );
}
