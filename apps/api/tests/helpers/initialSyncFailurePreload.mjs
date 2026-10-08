import Database from 'better-sqlite3';
import { appendFileSync } from 'node:fs';

// 待受後の再処理だけを失敗させ、保持DBと監視用の読み取りは維持する。
const prepare = Database.prototype.prepare;
Database.prototype.prepare = function (sql, ...args) {
  if (typeof sql === 'string' && sql.includes('telegram_reception') && sql.includes('SELECT')) {
    throw new Error('fixture initial sync failure');
  }
  return prepare.call(this, sql, ...args);
};
const close = Database.prototype.close;
Database.prototype.close = function (...args) {
  if (process.env.WX_TEST_CLOSE_MARKER) appendFileSync(process.env.WX_TEST_CLOSE_MARKER, 'close\n');
  return close.apply(this, args);
};
