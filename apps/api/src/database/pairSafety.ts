import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import BetterSqlite3 from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import {
  assertRegularFile,
  databaseFiles,
  type DatabasePairConfig,
  type RoleDatabaseConfig,
} from './pairConfig.js';
import { verifyExistingMigrations } from './migrations.js';

export const SCHEMA_FAMILY = 'wx-viewer-split-v1';
export interface DatabaseIdentity {
  role: string;
  schema_family: string;
  instance_id: string;
  created_at: string;
}
export interface FileIdentity {
  path: string;
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  hash: string;
}
export function fileIdentity(path: string): FileIdentity | null {
  assertRegularFile(path);
  if (!existsSync(path)) return null;
  const s = lstatSync(path);
  return {
    path,
    dev: s.dev,
    ino: s.ino,
    size: s.size,
    mtimeMs: s.mtimeMs,
    hash: createHash('sha256').update(readFileSync(path)).digest('hex'),
  };
}
export function captureFiles(path: string): (FileIdentity | null)[] {
  return databaseFiles(path).map(fileIdentity);
}
export function assertFilesUnchanged(path: string, before: (FileIdentity | null)[]): void {
  if (JSON.stringify(before) !== JSON.stringify(captureFiles(path)))
    throw new Error('検査中に元DBが変更されました。');
}
export function inspectDatabaseCopy(config: RoleDatabaseConfig): DatabaseIdentity | null {
  const before = captureFiles(config.databasePath);
  if (!before[0]) {
    if (before.some(Boolean)) throw new Error('主DBのない付随ファイルは帰属を確認できません。');
    return null;
  }
  const directory = mkdtempSync(join(tmpdir(), 'wx-db-inspect-'));
  let db: BetterSqlite3.Database | undefined;
  try {
    for (const file of before)
      if (file) copyFileSync(file.path, join(directory, basename(file.path)));
    db = new BetterSqlite3(join(directory, basename(config.databasePath)));
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    if (tables.length === 0) {
      if (before[0].size !== 0) throw new Error('識別情報のない既存DBは利用できません。');
      return null;
    }
    if (!tables.some((t) => t.name === '__database_identity'))
      throw new Error('旧DBまたは識別情報のないDBは利用できません。');
    const identities = db
      .prepare('SELECT role, schema_family, instance_id, created_at FROM __database_identity')
      .all() as DatabaseIdentity[];
    const identity = identities[0];
    if (
      identities.length !== 1 ||
      identity?.role !== config.role ||
      identity.schema_family !== SCHEMA_FAMILY ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(identity.instance_id)
    )
      throw new Error('DBのrole/family/instanceが不正です。');
    verifyExistingMigrations(db, config.migrationsDirectory);
    if (db.pragma('quick_check', { simple: true }) !== 'ok')
      throw new Error('DB整合性検査に失敗しました。');
    return identity;
  } finally {
    try {
      db?.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    assertFilesUnchanged(config.databasePath, before);
  }
}
export function acquireWriterLeases(config: DatabasePairConfig): () => void {
  const token = randomUUID();
  const owned: string[] = [];
  try {
    for (const c of [config.weather, config.retained].sort((a, b) =>
      a.databasePath.localeCompare(b.databasePath),
    )) {
      const lock = `${c.databasePath}.writer-lock`;
      mkdirSync(dirname(lock), { recursive: true });
      mkdirSync(lock);
      owned.push(lock);
      writeFileSync(
        join(lock, 'owner.json'),
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
          token,
          role: c.role,
        }),
        { flag: 'wx' },
      );
    }
  } catch (error) {
    for (const lock of owned) rmSync(lock, { recursive: true });
    throw error;
  }
  return () => {
    for (const lock of owned) {
      const owner = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8')) as { token: string };
      if (owner.token !== token) throw new Error('writer lease所有tokenが一致しません。');
      rmSync(lock, { recursive: true });
    }
  };
}
export function assertStopped(config: DatabasePairConfig): void {
  const files = [config.weather, config.retained]
    .flatMap((c) => databaseFiles(c.databasePath))
    .filter(existsSync);
  const commandAvailable = (process.env.PATH ?? '').split(delimiter).some((directory) => {
    try {
      accessSync(join(directory, 'lsof'), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  if (!commandAvailable) throw new Error('対象DBの停止検査コマンドが利用できません。');
  if (files.length === 0) return;
  const result = spawnSync('lsof', ['-F', 'p', '--', ...files], { encoding: 'utf8' });
  if (
    result.error ||
    result.signal ||
    result.status === null ||
    (result.status !== 0 && result.status !== 1) ||
    result.stderr.trim()
  )
    throw new Error('対象DBの停止確認ができません。');
  if (result.status === 0 || result.stdout.trim())
    throw new Error('対象DBを開いているプロセスがあります。');
}
