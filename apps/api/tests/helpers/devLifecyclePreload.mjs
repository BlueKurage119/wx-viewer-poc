import fs from 'node:fs';
import http from 'node:http';
import Database from 'better-sqlite3';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { isMainThread, threadId, workerData } from 'node:worker_threads';

const trace = (kind, extra = {}) =>
  fs.appendFileSync(
    process.env.WX_TEST_DEV_TRACE,
    JSON.stringify({ kind, pid: process.pid, threadId, isMainThread, at: Date.now(), ...extra }) +
      '\n',
  );
const apiProcess = isMainThread && process.argv[1]?.endsWith('/src/server.ts');
const acquisitionWorker =
  !isMainThread &&
  workerData?.owner?.role === 'weather' &&
  typeof workerData?.epoch?.workerGeneration === 'string';
if (apiProcess || acquisitionWorker) {
  trace(isMainThread ? 'api-process' : 'worker-process');
  const originalClose = Database.prototype.close;
  Database.prototype.close = function () {
    const role = ['weather', 'retained'].find((role) => {
      const target = process.env[`WX_VIEWER_${role.toUpperCase()}_DB_PATH`];
      return (
        target &&
        fs.existsSync(this.name) &&
        fs.existsSync(target) &&
        fs.realpathSync(target) === fs.realpathSync(this.name)
      );
    });
    const wasOpen = this.open;
    const result = originalClose.call(this);
    if (role && wasOpen && !this.open)
      trace('db-close', { name: this.name, role, readonly: this.readonly });
    return result;
  };
}
if (apiProcess) {
  // 製品がexecArgvを空にして起動する実Workerにも、接続所有者の観測だけを注入する。
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
  const originalListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function (...args) {
    this.once('listening', () => {
      const address = this.address();
      trace('listening');
      if (process.env.WX_TEST_EARLY_SIGNAL) {
        process.emit('SIGINT');
        return;
      }
      // HTTP先行起動ではlistenをDB準備完了とみなさず、実監視APIでreader成立を確認する。
      const checkReady = async () => {
        if (!this.listening || typeof address !== 'object' || !address) return;
        try {
          const response = await fetch(
            `http://127.0.0.1:${address.port}/api/monitoring/status?terminalId=kkeagh01`,
          );
          const body = await response.json();
          if (
            response.ok &&
            body.weatherRuntimes?.delivery.lifecycle === 'ready' &&
            body.weatherRuntimes?.acquisition.lifecycle === 'ready'
          ) {
            trace('ready', { port: address.port });
            if (process.env.WX_TEST_UNEXPECTED_API) setTimeout(() => process.exit(7), 300);
            return;
          }
        } catch {
          /* 初期化中は次の監視応答を待つ。 */
        }
        setTimeout(() => {
          void checkReady();
        }, 25);
      };
      void checkReady();
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
