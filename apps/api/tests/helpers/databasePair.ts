import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  initializeDatabases,
  type DatabaseConfig,
  type DatabasePairConfig,
} from '../../src/database/index.js';

export function createTestDatabasePairConfig(config: DatabaseConfig): DatabasePairConfig {
  const insideTemporaryRoot = [tmpdir(), '/tmp'].some((root) => {
    const location = relative(resolve(root), resolve(config.databasePath));
    return (
      location !== '' && location !== '..' && !location.startsWith('../') && !isAbsolute(location)
    );
  });
  if (!isAbsolute(config.databasePath) || !insideTemporaryRoot) {
    throw new Error('テスト用DBとcacheは専用一時ディレクトリに指定してください。');
  }
  return {
    weather: {
      role: 'weather',
      databasePath: config.databasePath,
      migrationsDirectory: join(config.migrationsDirectory, 'weather'),
    },
    retained: {
      role: 'retained',
      databasePath: `${config.databasePath}.retained`,
      migrationsDirectory: join(import.meta.dirname, '../../migrations/retained'),
    },
  };
}

export function initializeTestDatabases(config: DatabaseConfig) {
  const directory =
    config.databasePath === ':memory:'
      ? mkdtempSync(join(tmpdir(), 'wx-pair-fixture-'))
      : undefined;
  const pair = initializeDatabases(
    createTestDatabasePairConfig(
      directory ? { ...config, databasePath: join(directory, 'weather.sqlite3') } : config,
    ),
  );
  return {
    ...pair,
    close() {
      pair.close();
      if (directory) rmSync(directory, { recursive: true, force: true });
    },
  };
}

export function readTestDatabases(config: DatabaseConfig) {
  const pair = createTestDatabasePairConfig(config);
  const weather = new Database(pair.weather.databasePath, { readonly: true });
  const retained = new Database(pair.retained.databasePath, { readonly: true });
  return {
    weather: { connection: weather },
    retained: { connection: retained },
    close() {
      weather.close();
      retained.close();
    },
  };
}

export function createTestServerDatabaseOptions(config: DatabaseConfig) {
  return {
    config: createTestDatabasePairConfig(config),
    nowcastCacheRoot: join(`${config.databasePath}.test-cache`, 'nowcast'),
    kikikuruCacheRoot: join(`${config.databasePath}.test-cache`, 'kikikuru'),
  };
}

export function createTestServerProcessEnv(config: DatabaseConfig): NodeJS.ProcessEnv {
  const pair = createTestDatabasePairConfig(config);
  return {
    ...process.env,
    WX_VIEWER_DB_PATH: undefined,
    WX_VIEWER_WEATHER_DB_PATH: pair.weather.databasePath,
    WX_VIEWER_RETAINED_DB_PATH: pair.retained.databasePath,
  };
}

export function createTemporaryTestDatabaseFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'wx-server-fixture-'));
  const config = {
    databasePath: join(directory, 'weather.sqlite3'),
    migrationsDirectory: join(import.meta.dirname, '../../migrations'),
  };
  return { config, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
