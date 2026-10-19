import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  probeProcess,
  currentIdentity,
  START_TIME_TOLERANCE_MS,
  type ProcessProbe,
  type WriterLockProcessIdentity,
} from './writerLock.js';

export type WriterLockInspection =
  | { state: 'absent' }
  | {
      state: 'alive';
      pid: number;
      role?: string;
      reason: 'owner_alive' | 'pid_present_unverifiable';
    }
  | {
      state: 'stale';
      pid: number;
      token: string;
      role?: string;
      startedAt?: string;
      processStartedAt?: string;
      currentProcessStartedAt?: string;
      reason: 'pid_not_found' | 'pid_reused';
    }
  | {
      state: 'undeterminable';
      reason: 'owner_unreadable' | 'other_host' | 'probe_failed' | 'not_directory';
    };

export interface WriterLockInspectionDeps {
  probeProcess: (pid: number) => ProcessProbe;
  currentIdentity: () => WriterLockProcessIdentity;
}

const defaultDeps: WriterLockInspectionDeps = {
  probeProcess,
  currentIdentity,
};

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

export function inspectWriterLock(
  lockPath: string,
  deps?: Partial<WriterLockInspectionDeps>,
): WriterLockInspection {
  const effectiveDeps: WriterLockInspectionDeps = { ...defaultDeps, ...deps };

  if (!existsSync(lockPath)) {
    return { state: 'absent' };
  }

  let stat;
  try {
    stat = lstatSync(lockPath);
  } catch {
    return { state: 'undeterminable', reason: 'not_directory' };
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return { state: 'undeterminable', reason: 'not_directory' };
  }

  const owner = readOwnerFile(join(lockPath, 'owner.json'));
  if (!owner) {
    return { state: 'undeterminable', reason: 'owner_unreadable' };
  }

  const identity = effectiveDeps.currentIdentity();
  if (typeof owner.hostname === 'string' && owner.hostname !== identity.hostname) {
    return { state: 'undeterminable', reason: 'other_host' };
  }

  const probe = effectiveDeps.probeProcess(owner.pid as number);
  if (probe.state === 'unknown') {
    return { state: 'undeterminable', reason: 'probe_failed' };
  }

  const pid = owner.pid as number;
  const token = owner.token as string;
  const role = typeof owner.role === 'string' ? owner.role : undefined;
  const startedAt = typeof owner.startedAt === 'string' ? owner.startedAt : undefined;

  if (probe.state === 'present') {
    if (typeof owner.processStartedAt !== 'string') {
      return { state: 'alive', pid, role, reason: 'pid_present_unverifiable' };
    }
    const recordedMs = Date.parse(owner.processStartedAt);
    if (!Number.isFinite(recordedMs)) {
      return { state: 'alive', pid, role, reason: 'pid_present_unverifiable' };
    }
    if (Math.abs(recordedMs - probe.startedAtMs) <= START_TIME_TOLERANCE_MS) {
      return { state: 'alive', pid, role, reason: 'owner_alive' };
    }
    return {
      state: 'stale',
      pid,
      token,
      role,
      startedAt,
      processStartedAt: owner.processStartedAt,
      currentProcessStartedAt: new Date(probe.startedAtMs).toISOString(),
      reason: 'pid_reused',
    };
  }

  // probe.state === 'absent'
  return {
    state: 'stale',
    pid,
    token,
    role,
    startedAt,
    processStartedAt:
      typeof owner.processStartedAt === 'string' ? owner.processStartedAt : undefined,
    reason: 'pid_not_found',
  };
}

export function quarantineStaleWriterLock(lockPath: string, expectedToken: string): void {
  const lock = basename(lockPath);
  const stalePath = `${lockPath}.stale-${expectedToken}`;

  renameSync(lockPath, stalePath);

  const movedOwner = readOwnerFile(join(stalePath, 'owner.json'));
  if (!movedOwner || movedOwner.token !== expectedToken) {
    let restored = false;
    try {
      renameSync(stalePath, lockPath);
      restored = true;
    } catch {
      // 復元失敗
    }
    throw new Error(
      `残留lockの退避に失敗しました(token不一致)。復元: ${restored ? '成功' : '失敗'}`,
    );
  }

  try {
    writeFileSync(
      join(stalePath, 'taken-over.json'),
      JSON.stringify({ takenOverAt: new Date().toISOString() }),
    );
  } catch {
    // 記録失敗は許容
  }

  const role = typeof movedOwner.role === 'string' ? movedOwner.role : undefined;
  const oldPid = movedOwner.pid as number;
  const shortToken = expectedToken.slice(0, 8);
  console.warn(
    `[writer-lock] reset_quarantine lock=${lock}${role ? ` role=${role}` : ''} oldPid=${oldPid} oldToken=${shortToken}`,
  );
}
