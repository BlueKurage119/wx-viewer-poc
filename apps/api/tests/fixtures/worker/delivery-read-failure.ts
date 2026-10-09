import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { workerData } from 'node:worker_threads';
import BetterSqlite3 from 'better-sqlite3';
import type { DeliveryWorkerData } from '../../../src/runtime/deliveryWorker.js';

const data = workerData as DeliveryWorkerData;
const marker = join(data.settings.nowcastCacheRoot, 'fail-startup-project');
const prepare = BetterSqlite3.prototype.prepare;
BetterSqlite3.prototype.prepare = function (this: BetterSqlite3.Database, sql: string) {
  if (this.readonly && sql.includes('warning_current') && existsSync(marker))
    throw new Error('読取障害fixture');
  return prepare.call(this, sql);
} as typeof BetterSqlite3.prototype.prepare;

await import('../../../src/runtime/deliveryWorker.js');
