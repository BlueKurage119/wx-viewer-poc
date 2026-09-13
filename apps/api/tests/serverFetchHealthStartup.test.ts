import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import { initializeDatabase } from '../src/database/index.js';
import { recordFetchAttempt, listNotificationOutputHistory } from '../src/repositories/index.js';
import { startServer } from '../src/server.js';

/**
 * PRレビュー指摘(#141 discussion r3998740636)の回帰テスト。
 *
 * server.ts の起動順序(scheduler.start() を await する前に呼び出してから
 * fetchHealthMonitorService.start() を呼ぶ)を実際の startServer() 経由で検証する。
 * FetchHealthMonitorService 単体のテスト(fetchHealthMonitorService.test.ts)は
 * runOnce()/start() を直接呼ぶだけで、server.ts 側の呼び出し順序そのものは
 * 検証できない。本テストはその隙間を埋める。
 *
 * server.ts の該当2箇所のどちらかが次のいずれかに退行すると失敗する:
 *   - fetchHealthMonitorService.start() を scheduler.start() の完了を待ってから呼ぶ
 *     (初回XML取得完了まで健全性判定が始まらない = D7 AC12の欠陥)
 *   - fetchHealthMonitorService.start() を scheduler.start() の呼び出しより前に呼ぶ
 *     (isRunning=false のまま初回評価され、全取得元が suspended と誤記録される)
 */
test('server.ts起動時、再起動前から継続する異常はsuspendedに埋もれずinitial検知される', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-fetch-health-startup-'));
  const databasePath = path.join(tmpDir, 'test.sqlite3');
  const migrationsDirectory = path.join(import.meta.dirname, '../migrations');

  try {
    // 再起動を模す: プロセス起動前から DB に kikikuru 時刻一覧の連続失敗5件(異常相当)が
    // 残っている。この取得元は下記の dummy adapter が何もしないため、実際の
    // ポーリング活動による fetch_attempt 行の混入がなく、判定結果を汚染しない。
    {
      const seedDb = initializeDatabase({ databasePath, migrationsDirectory });
      for (let i = 0; i < 5; i++) {
        recordFetchAttempt(seedDb.connection, {
          sourceKind: 'risk_target_times',
          targetRef: null,
          requestUrl: 'https://example.com/risk_target_times',
          triggerKind: 'scheduled',
          attemptNo: 1,
          startedAt: new Date(Date.now() - (5 - i) * 1000).toISOString() as UtcIso8601String,
          finishedAt: new Date(Date.now() - (5 - i) * 1000).toISOString() as UtcIso8601String,
          durationMs: 50,
          outcome: 'failure',
          httpStatus: 500,
          responseBytes: 0,
          itemCount: null,
          failedItemCount: null,
          contentHash: 'seed',
          errorKind: 'network_error',
          errorMessage: 'seeded failure (simulating pre-restart state)',
        });
      }
      seedDb.close();
    }

    // XML自体は本テストの対象外(空応答で即座に完了させ、初期取得を長引かせない)。
    const dummyFetch: typeof fetch = async () => new Response('Not found', { status: 404 });
    const dummyAdapter = (source: 'nowcast' | 'kikikuru' | 'amedas') => ({
      source,
      runScheduled: async () => {},
    });

    const server = await startServer({
      config: { databasePath, migrationsDirectory },
      port: 0,
      enablePolling: true,
      pollingServiceOptions: { fetchFn: dummyFetch },
      schedulerOptions: {
        adapters: [dummyAdapter('nowcast'), dummyAdapter('kikikuru'), dummyAdapter('amedas')],
        now: () => new Date('2026-09-07T12:00:00+09:00'),
        setTimer: () => 1,
        clearTimer: () => {},
      },
    });

    try {
      assert.ok(server.fetchHealthMonitorService, 'FetchHealthMonitorService が結線されていること');
      const aggregate = server.fetchHealthMonitorService!.getLastAggregate();
      assert.ok(aggregate, '起動完了時点で初回評価が完了していること');

      const kikikuru = aggregate!.sources.find((s) => s.sourceId === 'kikikuru_target_times');
      assert.equal(
        kikikuru?.status,
        'abnormal',
        'isRunning=true の状態で評価されるため suspended に誤判定されない',
      );

      // startServer() は接続をテストへ公開しないため、同じDBファイルへ別接続で
      // 検証する(SQLiteは複数接続からの読み取りを許す。#29 AC8 が前提とする性質と同じ)。
      const verifyDb = initializeDatabase({ databasePath, migrationsDirectory });
      try {
        const history = listNotificationOutputHistory(verifyDb.connection, { origin: 'system' });
        const kikikuruNotification = history.find((h) =>
          (JSON.parse(h.relatedRefsJson) as Array<{ type: string; ref: string }>).some(
            (ref) => ref.ref === 'kikikuru_target_times',
          ),
        );
        assert.ok(kikikuruNotification, 'kikikuru_target_times の通知が記録されていること');
        assert.equal(
          kikikuruNotification!.detectionContext,
          'initial',
          '再起動前から継続する異常は initial として検知される(suspended経由でnormal扱いにならない)',
        );
      } finally {
        verifyDb.close();
      }
    } finally {
      await server.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
