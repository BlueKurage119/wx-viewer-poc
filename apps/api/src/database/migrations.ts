import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DatabaseConnection } from './connection.js';

export interface MigrationSummary {
  readonly appliedVersions: readonly number[];
}

interface Migration {
  readonly checksum: string;
  readonly name: string;
  readonly sql: string;
  readonly version: number;
}

interface AppliedMigration {
  readonly checksum: string;
  readonly name: string;
  readonly version: number;
}

const migrationFilename = /^(?<version>[0-9]{4})_(?<name>[a-z0-9_]+)\.sql$/;
const transactionControl = /(?:^|;)\s*(?:BEGIN|COMMIT|ROLLBACK)\b/i;

function discoverMigrations(migrationsDirectory: string): readonly Migration[] {
  const entries = readdirSync(migrationsDirectory, { withFileTypes: true });
  const migrations: Migration[] = [];
  const versions = new Set<number>();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.sql')) {
      continue;
    }

    const match = migrationFilename.exec(entry.name);
    if (!match?.groups) {
      throw new Error(`Invalid migration filename: ${entry.name}`);
    }

    const version = Number(match.groups.version);
    if (version === 0 || versions.has(version)) {
      throw new Error(`Duplicate or invalid migration version: ${match.groups.version}`);
    }
    versions.add(version);

    const content = readFileSync(join(migrationsDirectory, entry.name));
    if (content.length === 0) {
      throw new Error(`Migration must not be empty: ${entry.name}`);
    }
    const sql = content.toString('utf8');
    if (transactionControl.test(sql)) {
      throw new Error(`Migration must not control transactions: ${entry.name}`);
    }

    migrations.push({
      checksum: createHash('sha256').update(content).digest('hex'),
      name: entry.name.slice(0, -'.sql'.length),
      sql,
      version,
    });
  }

  return migrations.sort((left, right) => left.version - right.version);
}

function createMetadataTable(connection: DatabaseConnection): void {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS __schema_migrations (
      version INTEGER PRIMARY KEY CHECK (version > 0),
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

function verifyAppliedMigrations(
  migrations: readonly Migration[],
  appliedMigrations: readonly AppliedMigration[],
): void {
  const migrationByVersion = new Map(migrations.map((migration) => [migration.version, migration]));

  for (const applied of appliedMigrations) {
    const migration = migrationByVersion.get(applied.version);
    if (
      migration === undefined ||
      migration.name !== applied.name ||
      migration.checksum !== applied.checksum
    ) {
      throw new Error(`Applied migration does not match its file: ${applied.version}`);
    }
  }
}

export function runMigrations(
  connection: DatabaseConnection,
  migrationsDirectory: string,
): MigrationSummary {
  const migrations = discoverMigrations(migrationsDirectory);
  createMetadataTable(connection);
  const appliedMigrations = connection
    .prepare('SELECT version, name, checksum FROM __schema_migrations ORDER BY version')
    .all() as AppliedMigration[];
  verifyAppliedMigrations(migrations, appliedMigrations);

  const appliedVersions = new Set(appliedMigrations.map((migration) => migration.version));
  const maximumAppliedVersion = appliedMigrations.at(-1)?.version ?? 0;
  const unapplied = migrations.filter((migration) => !appliedVersions.has(migration.version));

  if (unapplied.some((migration) => migration.version <= maximumAppliedVersion)) {
    throw new Error('Cannot insert an unapplied migration before the latest applied version.');
  }

  const insertMigration = connection.prepare(
    'INSERT INTO __schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
  );
  const appliedThisRun: number[] = [];
  const applyMigration = connection.transaction((migration: Migration) => {
    connection.exec(migration.sql);
    insertMigration.run(
      migration.version,
      migration.name,
      migration.checksum,
      new Date().toISOString(),
    );
  });

  for (const migration of unapplied) {
    applyMigration.immediate(migration);
    appliedThisRun.push(migration.version);
  }

  return { appliedVersions: appliedThisRun };
}
