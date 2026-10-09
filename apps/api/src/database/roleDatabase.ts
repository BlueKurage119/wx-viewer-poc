import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { initializeRole } from './pair.js';
import {
  assertRegularFile,
  databaseFiles,
  validateDatabasePairPaths,
  type DatabasePairConfig,
  type RoleDatabaseConfig,
} from './pairConfig.js';
import { acquireWriterLock, logReleaseFailed } from './writerLock.js';
import { inspectDatabaseCopy, SCHEMA_FAMILY } from './pairSafety.js';
import { verifyExistingMigrations } from './migrations.js';
import type { DatabaseConnection } from './connection.js';

export interface WriterLeaseOwner {
  readonly pid: number;
  readonly role: 'weather' | 'retained';
  readonly token: string;
  readonly startedAt: string;
  readonly serverGenerationId: string;
  readonly workerGeneration: string | null;
  readonly threadId: number | null;
}
export function releaseOwnedRoleLease(config: RoleDatabaseConfig, owner: WriterLeaseOwner): void {
  const lock = `${config.databasePath}.writer-lock`;
  if (!existsSync(lock)) return;
  let actual: WriterLeaseOwner;
  try {
    actual = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8')) as WriterLeaseOwner;
  } catch {
    logReleaseFailed(lock, owner, 'lease_owner_unverified');
    throw new Error('lease_owner_unverified');
  }
  if (
    Object.keys(owner).some(
      (key) => actual[key as keyof WriterLeaseOwner] !== owner[key as keyof WriterLeaseOwner],
    )
  ) {
    logReleaseFailed(lock, owner, 'lease_owner_unverified');
    throw new Error('lease_owner_unverified');
  }
  try {
    rmSync(lock, { recursive: true });
  } catch (error) {
    logReleaseFailed(lock, owner, (error as NodeJS.ErrnoException).code ?? 'unknown');
    throw error;
  }
}
export function initializeRoleDatabase(pair: DatabasePairConfig, owner: WriterLeaseOwner) {
  const config = pair[owner.role];
  const validate = () => {
    const checked = validateDatabasePairPaths(pair);
    if (checked[owner.role].databasePath !== config.databasePath)
      throw new Error('DB保存先が変更されました。');
    for (const path of databaseFiles(config.databasePath)) assertRegularFile(path);
    if (existsSync(`${config.databasePath}.reset.json`)) throw new Error('未完了resetがあります。');
  };
  validate();
  const lock = `${config.databasePath}.writer-lock`;
  mkdirSync(dirname(lock), { recursive: true });
  acquireWriterLock(lock, owner);
  let connection: DatabaseConnection | undefined;
  try {
    validate();
    inspectDatabaseCopy(config);
    validate();
    const database = initializeRole(config, (value) => {
      connection = value;
    });
    if (owner.role === 'weather') {
      if (database.connection.pragma('journal_mode = WAL', { simple: true }) !== 'wal')
        throw new Error('WALを有効化できません。');
      database.connection.pragma('synchronous = FULL');
      database.connection.pragma('busy_timeout = 100');
      database.connection.pragma('wal_autocheckpoint = 1000');
    }
    const identity = database.connection
      .prepare('SELECT instance_id FROM __database_identity WHERE singleton=1')
      .get() as { instance_id: string };
    const version = database.connection
      .prepare('SELECT COALESCE(MAX(version),0) AS version FROM __schema_migrations')
      .get() as { version: number };
    let closed = false;
    return {
      connection: database.connection,
      generation: identity.instance_id,
      schemaVersion: version.version,
      close() {
        if (closed) return;
        if (database.connection.open) {
          if (owner.role === 'weather') database.connection.pragma('wal_checkpoint(PASSIVE)');
          database.close();
        }
        releaseOwnedRoleLease(config, owner);
        closed = true;
      },
    };
  } catch (error) {
    if (connection?.open) connection.close();
    releaseOwnedRoleLease(config, owner);
    throw error;
  }
}
export function openWeatherReader(
  config: RoleDatabaseConfig,
  generation: string,
  schemaVersion: number,
): DatabaseConnection {
  const connection = new BetterSqlite3(config.databasePath, {
    readonly: true,
    fileMustExist: true,
    timeout: 100,
  });
  try {
    connection.pragma('query_only = ON');
    connection.pragma('busy_timeout = 100');
    const identity = connection
      .prepare('SELECT role, schema_family, instance_id FROM __database_identity')
      .all() as { role: string; schema_family: string; instance_id: string }[];
    if (
      identity.length !== 1 ||
      identity[0]?.role !== 'weather' ||
      identity[0]?.schema_family !== SCHEMA_FAMILY ||
      identity[0]?.instance_id !== generation
    )
      throw new Error('readerのDB識別情報が一致しません。');
    verifyExistingMigrations(connection, config.migrationsDirectory);
    const version = connection
      .prepare('SELECT COALESCE(MAX(version),0) AS version FROM __schema_migrations')
      .get() as { version: number };
    if (version.version !== schemaVersion) throw new Error('readerのschema世代が一致しません。');
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}
