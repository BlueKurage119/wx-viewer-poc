import { parentPort } from 'node:worker_threads';
import Database from 'better-sqlite3';

if (!parentPort) throw new Error('取得Worker試験専用入口です');
const port = parentPort;
const originalExec = Database.prototype.exec;
Database.prototype.exec = function (sql: string) {
  if (!sql.includes('CREATE TABLE migration_close_probe')) return originalExec.call(this, sql);
  const insert = sql.indexOf('INSERT INTO migration_close_probe');
  if (insert < 0) throw new Error('migration試験SQLの境界がありません');
  originalExec.call(this, sql.slice(0, insert));
  const signal = new Int32Array(new SharedArrayBuffer(4));
  port.postMessage({
    type: 'test',
    id: 'fixture-control',
    test: 'migration-entered',
    signal: signal.buffer,
  });
  if (Atomics.wait(signal, 0, 0, 20_000) !== 'ok')
    throw new Error('migration試験の解除待ちが失敗しました');
  return originalExec.call(this, sql.slice(insert));
};

await import('../../../src/runtime/acquisitionWorker.js');
