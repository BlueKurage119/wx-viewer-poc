import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDatabase, type DatabaseConnection } from './connection.js';
import type { DatabaseContext } from './index.js';
import { runMigrations } from './migrations.js';
import {
  resolveDatabasePairConfig,
  validateDatabasePairConfig,
  assertFixedDatabasePairConfig,
  type DatabasePairConfig,
  type RoleDatabaseConfig,
} from './pairConfig.js';
import {
  acquireWriterLeases,
  captureFiles,
  inspectDatabaseCopy,
  SCHEMA_FAMILY,
} from './pairSafety.js';
export interface DatabasePairContext {
  readonly weather: DatabaseContext;
  readonly retained: DatabaseContext;
  readonly weatherDatabaseGenerationId: string;
  close(): void;
}
function initializeRole(
  config: RoleDatabaseConfig,
  registerConnection: (connection: DatabaseConnection) => void,
): DatabaseContext {
  mkdirSync(dirname(config.databasePath), { recursive: true });
  const connection = openDatabase(config.databasePath);
  registerConnection(connection);
  const migrationSummary = connection
    .transaction(() => {
      const summary = runMigrations(connection, config.migrationsDirectory);
      connection.exec(
        "CREATE TABLE IF NOT EXISTS __database_identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), role TEXT NOT NULL CHECK(role IN ('weather','retained')), schema_family TEXT NOT NULL, instance_id TEXT NOT NULL, created_at TEXT NOT NULL)",
      );
      connection
        .prepare('INSERT OR IGNORE INTO __database_identity VALUES (1,?,?,?,?)')
        .run(config.role, SCHEMA_FAMILY, randomUUID(), new Date().toISOString());
      return summary;
    })
    .immediate();
  return {
    connection,
    migrationSummary,
    close() {
      if (connection.open) connection.close();
    },
  };
}
export function initializeDatabases(
  input: DatabasePairConfig = resolveDatabasePairConfig(),
): DatabasePairContext {
  const config = validateDatabasePairConfig(input);
  const release = acquireWriterLeases(config);
  const connections: DatabaseConnection[] = [];
  const registerConnection = (connection: DatabaseConnection) => connections.push(connection);
  let weather: DatabaseContext | undefined;
  let retained: DatabaseContext | undefined;
  try {
    assertFixedDatabasePairConfig(config);
    for (const c of [config.weather, config.retained])
      if (existsSync(`${c.databasePath}.reset.json`))
        throw new Error('未完了resetがあります。resumeで解消してください。');
    const before = [
      captureFiles(config.weather.databasePath),
      captureFiles(config.retained.databasePath),
    ];
    inspectDatabaseCopy(config.weather);
    inspectDatabaseCopy(config.retained);
    if (
      JSON.stringify(before) !==
      JSON.stringify([
        captureFiles(config.weather.databasePath),
        captureFiles(config.retained.databasePath),
      ])
    )
      throw new Error('起動検査中にDBが変更されました。');
    assertFixedDatabasePairConfig(config);
    weather = initializeRole(config.weather, registerConnection);
    assertFixedDatabasePairConfig(config);
    retained = initializeRole(config.retained, registerConnection);
    const generation = (
      weather.connection
        .prepare('SELECT instance_id FROM __database_identity WHERE singleton=1')
        .get() as { instance_id: string }
    ).instance_id;
    let closed = false;
    return {
      weather,
      retained,
      weatherDatabaseGenerationId: generation,
      close() {
        if (closed) return;
        const errors: unknown[] = [];
        for (const connection of connections)
          try {
            if (connection.open) connection.close();
          } catch (error) {
            errors.push(error);
          }
        try {
          release();
        } catch (error) {
          errors.push(error);
        }
        if (errors.length) throw new AggregateError(errors, 'DB/leaseを閉じられませんでした。');
        closed = true;
      },
    };
  } catch (error) {
    const errors: unknown[] = [error];
    for (const connection of connections) {
      try {
        if (connection.open) connection.close();
      } catch (closeError) {
        errors.push(closeError);
      }
    }
    try {
      release();
    } catch (releaseError) {
      errors.push(releaseError);
    }
    if (errors.length > 1)
      throw new AggregateError(errors, '起動失敗後のDB/lease終了にも失敗しました。');
    throw error;
  }
}
