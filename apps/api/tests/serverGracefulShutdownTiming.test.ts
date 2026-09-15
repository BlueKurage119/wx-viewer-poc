import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { startServer } from '../src/server.js';
import { initializeDatabase } from '../src/database/index.js';
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

/**
 * Codexレビュー指摘#6（2回目レビュー）の回帰テスト。
 *
 * 1回目の修正は「close定義後に登録する」ことでReferenceErrorは防いだが、
 * その結果、シグナル購読自体が長い初期化(初回XML取得)の完了を待つようになり、
 * 初期化中に届いたシグナルは未購読のまま失われていた(実プロセスではNodeの既定動作で
 * 即終了し、停止処理・B5記録・停止通知が一切行われない)。
 * 本テストは、初期化中でもシグナルが即座に捕捉され(listenerが登録済みであること)、
 * 初期化完了後にB5へ停止記録が反映されることを確認する。
 */
test('レビュー指摘#6（2回目）: 初期化中に届いたシグナルも捕捉され、初期化完了後に停止記録される', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-graceful-shutdown-pending-'));
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
      // 初回XML取得を意図的に完了させず、初期化が終わっていない期間を作る。
      pollingServiceOptions: { fetchFn: () => deferred.promise },
      schedulerOptions: {
        adapters: [dummyAdapter('nowcast'), dummyAdapter('kikikuru'), dummyAdapter('amedas')],
        setTimer: () => 1,
        clearTimer: () => {},
      },
    });

    // startServer() はHTTP待受までは同期的に進む。この時点で既にシグナル購読が
    // 済んでいる（＝listenerが登録済みでtriggerがtrueを返す）ことを確認する。
    const triggeredDuringInit = signalSource.trigger('SIGTERM');
    assert.equal(
      triggeredDuringInit,
      true,
      '初期化完了を待たずにシグナルハンドラが登録済みであること（修正前は未登録でfalse）',
    );

    // 初期化を完了させる。保留していたシグナルはここで close({reason:'signal'}) として反映される。
    deferred.resolve(new Response('', { status: 500 }));
    const server = await startPromise;

    // close() はバックグラウンドで進む（DB書き込み含む）ため完了を待つ。
    await new Promise((resolve) => setTimeout(resolve, 300));

    // close 済みのため、別コネクションでDBファイルを開いて検証する。
    const readback = initializeDatabase({ databasePath, migrationsDirectory });
    try {
      const stopRows = readback.connection
        .prepare("SELECT * FROM operation_history WHERE operation_kind = 'stop'")
        .all() as { request_id: string }[];
      assert.equal(
        stopRows.length,
        1,
        '初期化中に届いたシグナルは、初期化完了後にB5へ停止記録として反映されること',
      );
      assert.match(stopRows[0]!.request_id, /^shutdown-/);

      const notificationRows = readback.connection
        .prepare(
          "SELECT * FROM notification_output_history WHERE message_definition_id = 'system-service-stopped'",
        )
        .all();
      assert.equal(notificationRows.length, 1);
    } finally {
      readback.close();
    }

    // close() は既に完了済み（冪等）。テスト用に安全に呼んでおく。
    await server.close().catch(() => {});
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
