import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { initializeDatabase, openDatabase } from '../src/database/index.js';
import {
  recordTerminalSessionInquiry,
  type TerminalSessionInquiryResult,
} from '../src/repositories/terminalSessionRepository.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

function createTempDbPath(): { databasePath: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-terminal-session-test-'));
  const databasePath = join(directory, 'test.sqlite3');
  return {
    databasePath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function countRows(connection: ReturnType<typeof openDatabase>): number {
  const row = connection.prepare('SELECT COUNT(*) as cnt FROM terminal_session').get() as {
    cnt: number;
  };
  return row.cnt;
}

test('AC6 DB & AC7 再起動: 新規ファイルDBへの初回判定・継続判定・行数・再起動後の初回時刻維持', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });
    const connection = context.connection;

    const idA = '00000000-0000-4000-8000-000000000001';
    const timeA1 = '2026-09-13T00:00:00.000Z';

    // ID A の初回問い合わせ -> startup
    const resA1 = recordTerminalSessionInquiry(connection, idA, timeA1);
    assert.deepStrictEqual(resA1, {
      sessionId: idA,
      kind: 'startup',
      firstInquiredAt: timeA1,
    });
    assert.strictEqual(countRows(connection), 1);

    // ID A の別時刻の再問い合わせ -> continuation, 初回時刻は timeA1 を保持
    const timeA2 = '2026-09-13T01:00:00.000Z';
    const resA2 = recordTerminalSessionInquiry(connection, idA, timeA2);
    assert.deepStrictEqual(resA2, {
      sessionId: idA,
      kind: 'continuation',
      firstInquiredAt: timeA1,
    });
    assert.strictEqual(countRows(connection), 1);

    // ID B の初回問い合わせ -> startup, 全行数は 2
    const idB = '00000000-0000-4000-8000-000000000002';
    const timeB1 = '2026-09-13T02:00:00.000Z';
    const resB1 = recordTerminalSessionInquiry(connection, idB, timeB1);
    assert.deepStrictEqual(resB1, {
      sessionId: idB,
      kind: 'startup',
      firstInquiredAt: timeB1,
    });
    assert.strictEqual(countRows(connection), 2);

    // --- AC7 再起動 ---
    // 一度 DB を閉じる
    context.close();

    // 同じファイルを initializeDatabase で開き直す（サーバー再起動相当、メモリDB代用ではない）
    const reopenedContext = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });
    const reopenedConnection = reopenedContext.connection;

    // ID A は continuation かつ元の初回時刻 timeA1
    const timeA3 = '2026-09-13T03:00:00.000Z';
    const resA3 = recordTerminalSessionInquiry(reopenedConnection, idA, timeA3);
    assert.deepStrictEqual(resA3, {
      sessionId: idA,
      kind: 'continuation',
      firstInquiredAt: timeA1,
    });
    assert.strictEqual(countRows(reopenedConnection), 2);

    reopenedContext.close();
  } finally {
    cleanup();
  }
});

test('AC8 競合: 複数 worker から同一ファイル・独立接続・同一 ID への同時問い合わせで startup は 1 つ、残りは continuation、保存行は 1 つ', async () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });
    context.close();

    const sessionId = '00000000-0000-4000-8000-000000000088';
    const concurrency = 4;
    const workerPath = join(fileURLToPath(import.meta.url), '../terminalSessionWorker.ts');

    const syncBuffer = new SharedArrayBuffer(4);
    const syncArray = new Int32Array(syncBuffer);
    syncArray[0] = 0; // wait

    const workers: Worker[] = [];
    const resultsPromise = Promise.all(
      Array.from({ length: concurrency }, (_, index) => {
        return new Promise<TerminalSessionInquiryResult>((resolve, reject) => {
          const worker = new Worker(workerPath, {
            execArgv: ['--import', 'tsx'],
            workerData: {
              databasePath,
              sessionId,
              inquiredAt: `2026-09-13T10:00:0${index}.000Z`,
              syncBuffer,
            },
          });
          workers.push(worker);
          worker.on('message', resolve);
          worker.on('error', reject);
          worker.on('exit', (code) => {
            if (code !== 0) {
              reject(new Error(`Worker exited with code ${code}`));
            }
          });
        });
      }),
    );

    // すべての worker が Atomics.wait でブロックするまで少し待機
    await new Promise((r) => setTimeout(r, 100));

    // 開始シグナルを同期送信
    Atomics.store(syncArray, 0, 1);
    Atomics.notify(syncArray, 0);

    const results = await resultsPromise;

    // 成功した結果のうち startup は 1 つ、残りは continuation
    const startupCount = results.filter((r) => r.kind === 'startup').length;
    const continuationCount = results.filter((r) => r.kind === 'continuation').length;

    assert.strictEqual(startupCount, 1, 'Exactly one inquiry must be startup');
    assert.strictEqual(
      continuationCount,
      concurrency - 1,
      'All other inquiries must be continuation',
    );

    // 全ての result の sessionId が一致し、firstInquiredAt は startup のものと一致する
    const startupResult = results.find((r) => r.kind === 'startup')!;
    for (const r of results) {
      assert.strictEqual(r.sessionId, sessionId);
      assert.strictEqual(r.firstInquiredAt, startupResult.firstInquiredAt);
    }

    // 保存行数は 1 行
    const verifyConnection = openDatabase(databasePath);
    assert.strictEqual(countRows(verifyConnection), 1);
    verifyConnection.close();
  } finally {
    cleanup();
  }
});

test('AC9 rollback: 外側 transaction 内の throw で行数 0・次回同 ID は startup。不正 ID・不正時刻でも行数は変化しない', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });
    const connection = context.connection;

    const idC = '00000000-0000-4000-8000-000000000009';
    const timeC1 = '2026-09-13T05:00:00.000Z';

    // 1. 外側 transaction 内で新規 ID を記録した後、意図的に throw する
    const outerTx = connection.transaction(() => {
      recordTerminalSessionInquiry(connection, idC, timeC1);
      throw new Error('Forced rollback in outer transaction');
    });

    assert.throws(() => outerTx(), {
      name: 'Error',
      message: 'Forced rollback in outer transaction',
    });

    // 行数は 0
    assert.strictEqual(countRows(connection), 0);

    // 2. 次回同 ID は startup
    const timeC2 = '2026-09-13T06:00:00.000Z';
    const resC2 = recordTerminalSessionInquiry(connection, idC, timeC2);
    assert.deepStrictEqual(resC2, {
      sessionId: idC,
      kind: 'startup',
      firstInquiredAt: timeC2,
    });
    assert.strictEqual(countRows(connection), 1);

    // 3. 不正 ID では例外になり、行数は変化しない
    assert.throws(
      () =>
        recordTerminalSessionInquiry(connection, 'invalid-session-id', '2026-09-13T07:00:00.000Z'),
      {
        name: 'Error',
      },
    );
    assert.strictEqual(countRows(connection), 1);

    // 4. 不正時刻（UTC ISO 8601 でない、JSTオフセット付き等）では例外になり、行数は変化しない
    const idD = '00000000-0000-4000-8000-000000000010';
    assert.throws(() => recordTerminalSessionInquiry(connection, idD, '2026-09-13 07:00:00'), {
      name: 'Error',
    });
    assert.throws(
      () => recordTerminalSessionInquiry(connection, idD, '2026-09-13T16:00:00+09:00'),
      {
        name: 'Error',
      },
    );
    assert.strictEqual(countRows(connection), 1);

    context.close();
  } finally {
    cleanup();
  }
});
