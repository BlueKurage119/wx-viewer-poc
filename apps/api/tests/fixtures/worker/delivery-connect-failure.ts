import { existsSync } from 'node:fs';
import { workerData } from 'node:worker_threads';
import BetterSqlite3 from 'better-sqlite3';
import type { DeliveryWorkerData } from '../../../src/runtime/deliveryWorker.js';

const data = workerData as DeliveryWorkerData;
const marker = `${data.settings.nowcastCacheRoot}.fail-reader-connect`;
const prepare = BetterSqlite3.prototype.prepare;
BetterSqlite3.prototype.prepare = function (this: BetterSqlite3.Database, sql: string) {
  if (this.readonly && sql.includes('FROM __database_identity') && existsSync(marker))
    throw new Error('database is locked');
  return prepare.call(this, sql);
} as typeof BetterSqlite3.prototype.prepare;

await import('../../../src/runtime/deliveryWorker.js');
