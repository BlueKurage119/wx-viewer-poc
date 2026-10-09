import Database from 'better-sqlite3';
import { appendFileSync, existsSync } from 'node:fs';
import { workerData } from 'node:worker_threads';
import type { AcquisitionWorkerData } from '../../../src/runtime/acquisitionWorker.js';

const data = workerData as AcquisitionWorkerData;
const marker = `${data.settings.nowcastCacheRoot}.recovery-fault`;
const prepare = Database.prototype.prepare;
Database.prototype.prepare = function (this: Database.Database, sql: string) {
  if (
    existsSync(marker) &&
    sql.includes('SELECT id FROM telegram_reception') &&
    sql.includes('ORDER BY report_datetime DESC')
  ) {
    appendFileSync(`${marker}.observed`, 'recovery-throw\n');
    throw new Error('固定fixtureのDB復旧例外');
  }
  return prepare.call(this, sql);
} as typeof Database.prototype.prepare;
await import('../../../src/runtime/acquisitionWorker.js');
