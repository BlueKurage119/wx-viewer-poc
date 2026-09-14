import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { startServer } from '../src/server.js';
import type { SignalSource } from '../src/gracefulShutdown.js';

/**
 * Issue #42/#43 レビュー指摘 #6 の回帰テスト。
 *
 * startServer() 内の `close` は `const close = async (...) => {...}` として、
 * 初回XML取得(実測17分超かかりうる)を含む長い await の後で初期化される。
 * registerGracefulShutdown(...) をその `close` 定義より前で呼んでいた場合、
 * 初期化中にシグナルが届くと `close` はまだ TDZ にあり、ReferenceError で
 * クラッシュする。close 定義後に登録することで、初期化中のシグナルでも
 * 例外を投げないことを確認する。
 */
class FakeSignalSource implements SignalSource {
  private readonly listeners = new Map<'SIGTERM' | 'SIGINT', () => void>();

  once(event: 'SIGTERM' | 'SIGINT', listener: () => void): void {
    this.listeners.set(event, listener);
  }

  /** 登録済みならシグナルハンドラを同期的に呼ぶ。未登録なら何もせず false を返す。 */
  trigger(event: 'SIGTERM' | 'SIGINT'): boolean {
    const listener = this.listeners.get(event);
    if (!listener) {
      return false;
    }
    listener();
    return true;
  }
}

function makeDeferredResponse(): {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
} {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

test('レビュー指摘#6: 初期化中(初回XML取得の待機中)にシグナルが届いてもクラッシュしない', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-graceful-shutdown-timing-'));
  const databasePath = path.join(tmpDir, 'test.sqlite3');
  const migrationsDirectory = path.join(import.meta.dirname, '../migrations');

  try {
    const deferred = makeDeferredResponse();
    const signalSource = new FakeSignalSource();
    const dummyAdapter = (source: 'nowcast' | 'kikikuru' | 'amedas') => ({
      source,
      runScheduled: async () => {},
      runManual: async () => {},
    });

    const startPromise = startServer({
      config: { databasePath, migrationsDirectory },
      port: 0,
      enablePolling: true,
      shutdownSignalSource: signalSource,
      // 初回XML取得を意図的に完了させず、close() が未初期化な期間を作る。
      pollingServiceOptions: { fetchFn: () => deferred.promise },
      schedulerOptions: {
        adapters: [dummyAdapter('nowcast'), dummyAdapter('kikikuru'), dummyAdapter('amedas')],
        setTimer: () => 1,
        clearTimer: () => {},
      },
    });

    // startServer() は最初の await(HTTP待受)まで同期的に進む。この時点で
    // シグナル登録が close 定義前に行われていた場合、trigger() は
    // ReferenceError を同期的に投げる(修正前の挙動)。
    assert.doesNotThrow(
      () => signalSource.trigger('SIGTERM'),
      '初期化中のシグナルで ReferenceError が発生してはならない',
    );

    // 初回取得を完了させ、起動を終わらせる。
    deferred.resolve(new Response('', { status: 500 }));
    const server = await startPromise;
    // 起動完了後は close 定義後に登録が済んでおり、シグナルで正しく購読される。
    const triggered = signalSource.trigger('SIGTERM');
    assert.equal(triggered, true, '起動完了後はシグナルハンドラが登録されていること');
    // signalSource.trigger() は close() を待たずに発火するだけなので、
    // バックグラウンドの close() 完了(DB書き込み含む)を待ってから一時ディレクトリを片付ける。
    await new Promise((resolve) => setTimeout(resolve, 100));
    await server.close().catch(() => {});
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
