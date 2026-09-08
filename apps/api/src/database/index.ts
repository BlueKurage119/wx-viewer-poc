import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { openDatabase, type DatabaseConnection } from './connection.js';
import { resolveDatabaseConfig, type DatabaseConfig } from './config.js';
import { runMigrations, type MigrationSummary } from './migrations.js';

export type { DatabaseConfig, DatabaseConnection, MigrationSummary };
export { openDatabase, resolveDatabaseConfig, runMigrations };

export interface DatabaseContext {
  readonly connection: DatabaseConnection;
  readonly migrationSummary: MigrationSummary;
  close(): void;
}

export function initializeDatabase(
  config: DatabaseConfig = resolveDatabaseConfig(),
): DatabaseContext {
  mkdirSync(dirname(config.databasePath), { recursive: true });
  const connection = openDatabase(config.databasePath);
  let closed = false;

  try {
    const migrationSummary = runMigrations(connection, config.migrationsDirectory);
    return {
      connection,
      migrationSummary,
      close() {
        if (!closed) {
          closed = true;
          connection.close();
        }
      },
    };
  } catch (error) {
    connection.close();
    throw error;
  }
}
