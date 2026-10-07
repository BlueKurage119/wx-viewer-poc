import express from 'express';
import Database from 'better-sqlite3';
import { appendFileSync } from 'node:fs';

// 失敗位置と両接続の終了を専用fixtureへ記録する。
const originalClose = Database.prototype.close;
Database.prototype.close = function (...args) {
  appendFileSync(process.env.WX_TEST_CLOSE_MARKER, 'close\n');
  return originalClose.apply(this, args);
};
const method = process.env.WX_TEST_STARTUP_FAILURE;
express.application[method] = function () {
  throw new Error(`fixture synchronous ${method} failure`);
};
