import fs from 'node:fs';
import http from 'node:http';
import Database from 'better-sqlite3';

const trace = (kind, extra = {}) =>
  fs.appendFileSync(
    process.env.WX_TEST_DEV_TRACE,
    JSON.stringify({ kind, pid: process.pid, at: Date.now(), ...extra }) + '\n',
  );
if (process.argv[1]?.endsWith('/src/server.ts')) {
  trace('api-process');
  const originalClose = Database.prototype.close;
  Database.prototype.close = function () {
    if (
      [process.env.WX_VIEWER_WEATHER_DB_PATH, process.env.WX_VIEWER_RETAINED_DB_PATH].some(
        (path) => fs.realpathSync(path) === this.name,
      )
    )
      trace('db-close', { name: this.name });
    return originalClose.call(this);
  };
  const originalListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function (...args) {
    this.once('listening', () => {
      trace('ready');
      if (process.env.WX_TEST_UNEXPECTED_API) setTimeout(() => process.exit(7), 300);
      if (process.env.WX_TEST_EARLY_SIGNAL) process.emit('SIGINT');
    });
    return originalListen.apply(this, args);
  };
  const close = http.Server.prototype.close;
  http.Server.prototype.close = function (...args) {
    trace('http-stop');
    setTimeout(() => close.apply(this, args), 250);
    return this;
  };
  const emit = process.emit;
  process.emit = function (event, ...args) {
    if (event === 'SIGINT' || event === 'SIGTERM') trace('signal', { signal: event });
    return emit.call(this, event, ...args);
  };
  if (process.env.WX_TEST_FAIL_API_EXIT)
    process.on('beforeExit', () => {
      process.exitCode = 7;
    });
  process.on('exit', (code) => trace('exit', { code }));
}
if (process.argv[1]?.endsWith('/scripts/dev.mjs') && process.env.WX_TEST_SHORT_WARNING) {
  const original = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => original(fn, ms === 30000 ? 50 : ms, ...args);
}

if (process.argv[1]?.endsWith('/scripts/dev.mjs')) {
  trace('runner-process');
  process.on('exit', (code) => trace('runner-exit', { code }));
}
if (process.argv[1]?.endsWith('/vite.js')) {
  trace('web-process');
  const originalListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function (...args) {
    this.once('listening', () => {
      const address = this.address();
      trace('web-ready', { port: typeof address === 'object' ? address?.port : undefined });
    });
    return originalListen.apply(this, args);
  };
}
