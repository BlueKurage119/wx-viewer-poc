import Database from 'better-sqlite3';
import { appendFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { isMainThread, workerData } from 'node:worker_threads';

const acquisitionWorker = !isMainThread && workerData?.owner?.role === 'weather';
if (isMainThread) {
  const workerThreads = createRequire(import.meta.url)('node:worker_threads');
  const OriginalWorker = workerThreads.Worker;
  workerThreads.Worker = class extends OriginalWorker {
    constructor(entry, options = {}) {
      super(entry, {
        ...options,
        execArgv: [...(options.execArgv ?? []), '--import', import.meta.url],
      });
    }
  };
  syncBuiltinESMExports();
}

// 待受後の再処理だけを失敗させ、保持DBと監視用の読み取りは維持する。
const prepare = Database.prototype.prepare;
Database.prototype.prepare = function (sql, ...args) {
  if (
    acquisitionWorker &&
    typeof sql === 'string' &&
    sql.includes('telegram_reception') &&
    sql.includes('SELECT')
  ) {
    throw new Error('fixture initial sync failure');
  }
  return prepare.call(this, sql, ...args);
};
const close = Database.prototype.close;
Database.prototype.close = function (...args) {
  if (
    process.env.WX_TEST_CLOSE_MARKER &&
    [process.env.WX_VIEWER_WEATHER_DB_PATH, process.env.WX_VIEWER_RETAINED_DB_PATH].includes(
      this.name,
    )
  )
    appendFileSync(process.env.WX_TEST_CLOSE_MARKER, 'close\n');
  return close.apply(this, args);
};
