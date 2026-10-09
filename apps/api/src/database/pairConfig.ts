import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseConfig } from './config.js';

export type DatabaseRole = 'weather' | 'retained';
export type RoleDatabaseConfig = DatabaseConfig & { readonly role: DatabaseRole };
export interface DatabasePairConfig {
  readonly weather: RoleDatabaseConfig;
  readonly retained: RoleDatabaseConfig;
}
const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function resolveDatabasePairConfig(
  env: NodeJS.ProcessEnv = process.env,
  isolated = false,
): DatabasePairConfig {
  if (env.WX_VIEWER_DB_PATH !== undefined)
    throw new Error(
      'WX_VIEWER_DB_PATH は廃止されました。WX_VIEWER_WEATHER_DB_PATH と WX_VIEWER_RETAINED_DB_PATH を使用してください。',
    );
  const make = (role: DatabaseRole): RoleDatabaseConfig => {
    const value =
      env[role === 'weather' ? 'WX_VIEWER_WEATHER_DB_PATH' : 'WX_VIEWER_RETAINED_DB_PATH'] ??
      `data/${role}.sqlite3`;
    validatePath(value);
    return {
      role,
      databasePath: resolve(apiDirectory, value),
      migrationsDirectory: resolve(apiDirectory, 'migrations', role),
    };
  };
  return (isolated ? validateDatabasePairPaths : validateDatabasePairConfig)({
    weather: make('weather'),
    retained: make('retained'),
  });
}
function validatePath(value: string): void {
  if (!value || value.includes('\0') || value.includes(':memory:') || value.startsWith('file:'))
    throw new Error('DB保存先には通常ファイルのパスが必要です。');
}
export function canonicalPath(value: string): string {
  const full = resolve(value);
  if (existsSync(full)) return realpathSync(full);
  const parent = dirname(full);
  return resolve(parent === full ? parent : canonicalPath(parent), basename(full));
}
export function databaseFiles(path: string): string[] {
  return [path, `${path}-wal`, `${path}-shm`, `${path}-journal`];
}
export function assertRegularFile(path: string): void {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1)
      throw new Error('DBまたは付随ファイルが通常の単一リンクファイルではありません。');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
export function validateDatabasePairConfig(config: DatabasePairConfig): DatabasePairConfig {
  for (const c of [config.weather, config.retained]) assertRegularFile(c.databasePath);
  const checked = validateDatabasePairPaths(config);
  return {
    weather: { ...checked.weather, databasePath: canonicalPath(checked.weather.databasePath) },
    retained: { ...checked.retained, databasePath: canonicalPath(checked.retained.databasePath) },
  };
}

/** 気象内容の検査を行わず、共有保存先の衝突だけを拒否する。 */
export function validateDatabasePairPaths(config: DatabasePairConfig): DatabasePairConfig {
  for (const role of ['weather', 'retained'] as const) {
    validatePath(config[role].databasePath);
    if (config[role].role !== role) throw new Error('DB role設定が不正です。');
  }
  const weather = { ...config.weather, databasePath: resolve(config.weather.databasePath) };
  // アクセス不能な気象パスはWorker側で拒否する。確認できた衝突はここで拒否する。
  try {
    weather.databasePath = canonicalPath(weather.databasePath);
  } catch (error) {
    if (!['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
  }
  const retained = {
    ...config.retained,
    databasePath: canonicalPath(config.retained.databasePath),
  };
  try {
    const a = lstatSync(weather.databasePath);
    const b = lstatSync(retained.databasePath);
    if (a.dev === b.dev && a.ino === b.ino) throw new Error('気象DBと保持DBが同一ファイルです。');
  } catch (error) {
    if (!['ENOENT', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? ''))
      throw error;
  }
  const paths = [weather, retained].flatMap((c) => [
    ...databaseFiles(c.databasePath),
    `${c.databasePath}.writer-lock`,
    `${c.databasePath}.reset.json`,
  ]);
  const keys = paths.map((path) => path.toLowerCase());
  if (new Set(keys).size !== keys.length)
    throw new Error('気象DBと保持DBの保存先または管理ファイルが重複しています。');
  for (const [owner, other] of [
    [weather, retained],
    [retained, weather],
  ]) {
    const target = other!.databasePath.toLowerCase();
    const base = owner!.databasePath.toLowerCase();
    if (target.startsWith(`${base}.writer-lock/`) || target.startsWith(`${base}.reset.json.`))
      throw new Error('DB保存先が他方の管理領域と重複しています。');
  }
  return {
    weather: { ...weather, databasePath: resolve(config.weather.databasePath) },
    retained: { ...retained, databasePath: resolve(config.retained.databasePath) },
  };
}

export function assertFixedDatabasePairConfig(config: DatabasePairConfig): void {
  const current = validateDatabasePairConfig(config);
  if (
    current.weather.databasePath !== config.weather.databasePath ||
    current.retained.databasePath !== config.retained.databasePath
  )
    throw new Error('DBの正規保存先が検査中に変更されました。');
}
