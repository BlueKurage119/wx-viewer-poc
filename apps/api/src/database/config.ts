import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, resolve } from 'node:path';

export interface DatabaseConfig {
  readonly databasePath: string;
  readonly migrationsDirectory: string;
}

const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_DATABASE_PATH = resolve(apiDirectory, 'data', 'wx-viewer.sqlite3');
const MIGRATIONS_DIRECTORY = resolve(apiDirectory, 'migrations');

export function resolveDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const configuredPath = env.WX_VIEWER_DB_PATH;

  if (configuredPath === '') {
    throw new Error('WX_VIEWER_DB_PATH must not be empty.');
  }
  if (configuredPath?.includes('\0')) {
    throw new Error('WX_VIEWER_DB_PATH must not contain a NUL character.');
  }

  return {
    databasePath:
      configuredPath === undefined
        ? DEFAULT_DATABASE_PATH
        : isAbsolute(configuredPath)
          ? configuredPath
          : resolve(apiDirectory, configuredPath),
    migrationsDirectory: MIGRATIONS_DIRECTORY,
  };
}
