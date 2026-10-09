import Database from 'better-sqlite3';
import { existsSync, writeFileSync } from 'node:fs';
import { workerData } from 'node:worker_threads';
import type { AcquisitionWorkerData } from '../../../src/runtime/acquisitionWorker.js';
const data = workerData as AcquisitionWorkerData;
const marker = `${data.settings.nowcastCacheRoot}.scope-startup`;
const prepare = Database.prototype.prepare;
let paused = false;
let failedLocalRead = false;
Database.prototype.prepare = function (this: Database.Database, sql: string) {
  if (
    !paused &&
    sql.includes('SELECT id FROM telegram_reception') &&
    sql.includes('ORDER BY report_datetime DESC')
  ) {
    paused = true;
    writeFileSync(`${marker}.paused`, '準備中');
    const deadline = Date.now() + 10000;
    while (!existsSync(`${marker}.release`)) {
      if (Date.now() >= deadline) throw new Error('検証用待機期限');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  if (existsSync(`${marker}.fault`) && sql.includes('FROM early_warning_snapshot')) {
    failedLocalRead = true;
    throw new Error('保存済み早期注意情報の検証失敗');
  }
  if (
    failedLocalRead &&
    existsSync(`${marker}.abort`) &&
    sql.includes('FROM warning_current_snapshot')
  )
    throw new Error('ローカル検証後の初回判定失敗');
  return prepare.call(this, sql);
} as typeof Database.prototype.prepare;
await import('../../../src/runtime/acquisitionWorker.js');
