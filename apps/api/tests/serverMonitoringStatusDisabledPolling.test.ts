import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { startServer } from '../src/server.js';

/**
 * Issue #42/#43 レビュー指摘 #2 の回帰テスト。
 *
 * DISABLE_POLLING=true（enablePolling: false）起動時は scheduler・pollingService
 * インスタンスが生成されない。この状態で監視状態API(/api/monitoring/status)を
 * 呼ぶと、以前は依存側の getStatus() が例外を投げ 500 になっていた。
 * 停止中を表すスケジューラ状態(schedulerRunning: false 等)と readiness の
 * not_started 相当を返すことを確認する。
 */
test('ポーリング無効起動時、監視状態APIは500にならず停止中の状態を返す', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-monitoring-disabled-polling-'));
  const databasePath = path.join(tmpDir, 'test.sqlite3');
  const migrationsDirectory = path.join(import.meta.dirname, '../migrations');

  try {
    const server = await startServer({
      config: { databasePath, migrationsDirectory },
      port: 0,
      enablePolling: false,
    });

    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/monitoring/status?terminalId=hkeagh01`,
      );
      assert.equal(response.status, 200, 'ポーリング無効時も500にならない');
      const body = (await response.json()) as {
        operation: { schedulerRunning: boolean };
        readiness: { initialFetchPhase: string };
      };
      assert.equal(body.operation.schedulerRunning, false, 'stopped scheduler must report false');
      assert.equal(body.readiness.initialFetchPhase, 'not_started');
    } finally {
      await server.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
