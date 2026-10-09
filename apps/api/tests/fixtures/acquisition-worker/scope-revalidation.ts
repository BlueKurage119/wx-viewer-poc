import Database from 'better-sqlite3';
import { appendFileSync, existsSync } from 'node:fs';
import { workerData } from 'node:worker_threads';
import type { AcquisitionWorkerData } from '../../../src/runtime/acquisitionWorker.js';
const data = workerData as AcquisitionWorkerData;
const marker = `${data.settings.nowcastCacheRoot}.revalidation`;
globalThis.fetch = async () => {
  appendFileSync(`${marker}.fetch`, 'fetch\n');
  throw new Error('停止意図での上流取得は禁止');
};
const prepare = Database.prototype.prepare;
Database.prototype.prepare = function (this: Database.Database, sql: string) {
  if (existsSync(`${marker}.fault`) && sql.includes('FROM early_warning_snapshot')) {
    appendFileSync(`${marker}.observed`, 'read-failed\n');
    throw new Error('早期注意情報の保存済み読取に失敗');
  }
  return prepare.call(this, sql);
} as typeof Database.prototype.prepare;
await import('../../../src/runtime/acquisitionWorker.js');
