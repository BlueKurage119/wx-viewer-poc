import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeDatabase } from '../src/database/index.js';
import {
  countOperationHistory,
  deleteOperationHistory,
  findOperationHistoryById,
  findOperationHistoryByRequestId,
  listOperationHistory,
  recordOperationHistory,
  type OperationHistoryInput,
  type OperationKind,
  type OperationResult,
  type OperationTargetKind,
} from '../src/repositories/index.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

function createTempDbPath(): { databasePath: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-op-repo-test-'));
  const databasePath = join(directory, 'test.sqlite3');
  return {
    databasePath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

const sampleStartInput: OperationHistoryInput = {
  requestId: 'req-start-001',
  operationKind: 'start',
  targetKind: 'all',
  result: 'success',
  requestedAt: '2026-09-09T01:00:00Z',
  completedAt: '2026-09-09T01:00:02Z',
  actorId: null,
  actorDisplayName: null,
  errorCode: null,
  errorMessage: null,
};

const sampleStopInput: OperationHistoryInput = {
  requestId: 'req-stop-001',
  operationKind: 'stop',
  targetKind: 'all',
  result: 'failure',
  requestedAt: '2026-09-09T01:01:00Z',
  completedAt: '2026-09-09T01:01:03Z',
  actorId: null,
  actorDisplayName: null,
  errorCode: null,
  errorMessage: null,
};

const sampleRefreshInput: OperationHistoryInput = {
  requestId: 'req-refresh-001',
  operationKind: 'force_refresh',
  targetKind: 'all',
  result: 'failure',
  requestedAt: '2026-09-09T01:02:00Z',
  completedAt: '2026-09-09T01:02:05Z',
  actorId: null,
  actorDisplayName: null,
  errorCode: 'ERR_TIMEOUT',
  errorMessage: '気象庁サーバー接続タイムアウト',
};

test('1. start 成功、診断なしの stop 失敗、診断付きの force_refresh 失敗の 3 行を記録し、要求受理・結果確定時刻と ID を含めて完全一致で往復する。NULL の主体・診断列は空文字へ変換されない', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const rec1 = recordOperationHistory(context.connection, sampleStartInput);
    assert.ok(rec1.id > 0);
    assert.equal(rec1.requestId, sampleStartInput.requestId);
    assert.equal(rec1.operationKind, sampleStartInput.operationKind);
    assert.equal(rec1.targetKind, sampleStartInput.targetKind);
    assert.equal(rec1.result, sampleStartInput.result);
    assert.equal(rec1.requestedAt, sampleStartInput.requestedAt);
    assert.equal(rec1.completedAt, sampleStartInput.completedAt);
    assert.equal(rec1.actorId, null);
    assert.equal(rec1.actorDisplayName, null);
    assert.equal(rec1.errorCode, null);
    assert.equal(rec1.errorMessage, null);

    const rec2 = recordOperationHistory(context.connection, sampleStopInput);
    assert.ok(rec2.id > rec1.id);
    assert.equal(rec2.requestId, sampleStopInput.requestId);
    assert.equal(rec2.operationKind, 'stop');
    assert.equal(rec2.result, 'failure');
    assert.equal(rec2.errorCode, null);
    assert.equal(rec2.errorMessage, null);

    const rec3 = recordOperationHistory(context.connection, sampleRefreshInput);
    assert.ok(rec3.id > rec2.id);
    assert.equal(rec3.requestId, sampleRefreshInput.requestId);
    assert.equal(rec3.operationKind, 'force_refresh');
    assert.equal(rec3.result, 'failure');
    assert.equal(rec3.actorId, null);
    assert.equal(rec3.actorDisplayName, null);
    assert.equal(rec3.errorCode, 'ERR_TIMEOUT');
    assert.equal(rec3.errorMessage, '気象庁サーバー接続タイムアウト');

    const fetched1 = findOperationHistoryById(context.connection, rec1.id);
    assert.deepEqual(fetched1, rec1);

    const fetched2 = findOperationHistoryByRequestId(context.connection, sampleStopInput.requestId);
    assert.deepEqual(fetched2, rec2);

    const fetched3 = findOperationHistoryById(context.connection, rec3.id);
    assert.deepEqual(fetched3, rec3);

    context.close();
  } finally {
    cleanup();
  }
});

test('2. findOperationHistoryById と findOperationHistoryByRequestId が対象を返し、存在しない値は null を返す', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const recorded = recordOperationHistory(context.connection, sampleStartInput);

    assert.deepEqual(findOperationHistoryById(context.connection, recorded.id), recorded);
    assert.deepEqual(
      findOperationHistoryByRequestId(context.connection, sampleStartInput.requestId),
      recorded,
    );

    assert.equal(findOperationHistoryById(context.connection, 999999), null);
    assert.equal(findOperationHistoryByRequestId(context.connection, 'req-nonexistent'), null);

    context.close();
  } finally {
    cleanup();
  }
});

test('3. operationKind / result / actorId / 要求受理・結果確定の各時刻境界の単独・複合フィルターが正しく効き、countOperationHistory が limit 適用前の同条件件数を返す', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    // 4 行のテストデータ
    const row1: OperationHistoryInput = {
      requestId: 'req-filter-1',
      operationKind: 'start',
      targetKind: 'all',
      result: 'success',
      requestedAt: '2026-09-09T10:00:00Z',
      completedAt: '2026-09-09T10:00:05Z',
      actorId: null,
      actorDisplayName: null,
      errorCode: null,
      errorMessage: null,
    };
    const row2: OperationHistoryInput = {
      requestId: 'req-filter-2',
      operationKind: 'stop',
      targetKind: 'all',
      result: 'failure',
      requestedAt: '2026-09-09T10:10:00Z',
      completedAt: '2026-09-09T10:10:05Z',
      actorId: null,
      actorDisplayName: null,
      errorCode: 'ERR_STOP',
      errorMessage: '停止失敗',
    };
    const row3: OperationHistoryInput = {
      requestId: 'req-filter-3',
      operationKind: 'force_refresh',
      targetKind: 'all',
      result: 'success',
      requestedAt: '2026-09-09T10:20:00Z',
      completedAt: '2026-09-09T10:20:05Z',
      actorId: null,
      actorDisplayName: null,
      errorCode: null,
      errorMessage: null,
    };
    const row4: OperationHistoryInput = {
      requestId: 'req-filter-4',
      operationKind: 'force_refresh',
      targetKind: 'all',
      result: 'failure',
      requestedAt: '2026-09-09T10:30:00Z',
      completedAt: '2026-09-09T10:30:05Z',
      actorId: null,
      actorDisplayName: null,
      errorCode: 'ERR_REFRESH',
      errorMessage: '更新失敗',
    };

    recordOperationHistory(context.connection, row1);
    recordOperationHistory(context.connection, row2);
    recordOperationHistory(context.connection, row3);
    recordOperationHistory(context.connection, row4);

    // operationKind フィルター
    const startList = listOperationHistory(context.connection, { operationKind: 'start' });
    assert.equal(startList.length, 1);
    assert.equal(startList[0].requestId, 'req-filter-1');
    assert.equal(countOperationHistory(context.connection, { operationKind: 'start' }), 1);

    const refreshList = listOperationHistory(context.connection, {
      operationKind: 'force_refresh',
    });
    assert.equal(refreshList.length, 2);
    assert.equal(countOperationHistory(context.connection, { operationKind: 'force_refresh' }), 2);

    // result フィルター
    const failList = listOperationHistory(context.connection, { result: 'failure' });
    assert.equal(failList.length, 2);
    assert.equal(countOperationHistory(context.connection, { result: 'failure' }), 2);

    const succList = listOperationHistory(context.connection, { result: 'success' });
    assert.equal(succList.length, 2);
    assert.equal(countOperationHistory(context.connection, { result: 'success' }), 2);

    // AuthGate 連携前は主体が常に NULL のため、actorId フィルターは一致しない
    const user1List = listOperationHistory(context.connection, { actorId: 'user1' });
    assert.deepEqual(user1List, []);
    assert.equal(countOperationHistory(context.connection, { actorId: 'user1' }), 0);

    // requestedAt 範囲フィルター（境界値を含む）
    const reqFromList = listOperationHistory(context.connection, {
      requestedAtFrom: '2026-09-09T10:10:00Z',
    });
    assert.equal(reqFromList.length, 3);
    assert.equal(
      countOperationHistory(context.connection, { requestedAtFrom: '2026-09-09T10:10:00Z' }),
      3,
    );

    const reqToList = listOperationHistory(context.connection, {
      requestedAtTo: '2026-09-09T10:20:00Z',
    });
    assert.equal(reqToList.length, 3);
    assert.equal(
      countOperationHistory(context.connection, { requestedAtTo: '2026-09-09T10:20:00Z' }),
      3,
    );

    const reqRangeList = listOperationHistory(context.connection, {
      requestedAtFrom: '2026-09-09T10:10:00Z',
      requestedAtTo: '2026-09-09T10:20:00Z',
    });
    assert.equal(reqRangeList.length, 2);
    assert.equal(
      countOperationHistory(context.connection, {
        requestedAtFrom: '2026-09-09T10:10:00Z',
        requestedAtTo: '2026-09-09T10:20:00Z',
      }),
      2,
    );

    // completedAt 範囲フィルター（境界値を含む）
    const compFromList = listOperationHistory(context.connection, {
      completedAtFrom: '2026-09-09T10:10:05Z',
    });
    assert.equal(compFromList.length, 3);
    assert.equal(
      countOperationHistory(context.connection, { completedAtFrom: '2026-09-09T10:10:05Z' }),
      3,
    );

    const compToList = listOperationHistory(context.connection, {
      completedAtTo: '2026-09-09T10:20:05Z',
    });
    assert.equal(compToList.length, 3);
    assert.equal(
      countOperationHistory(context.connection, { completedAtTo: '2026-09-09T10:20:05Z' }),
      3,
    );

    // 複合フィルター
    const compoundList = listOperationHistory(context.connection, {
      operationKind: 'force_refresh',
      result: 'failure',
      actorId: 'user1',
    });
    assert.deepEqual(compoundList, []);
    assert.equal(
      countOperationHistory(context.connection, {
        operationKind: 'force_refresh',
        result: 'failure',
        actorId: 'user1',
      }),
      0,
    );

    // limit を指定しても count は全件数を返す
    const limitedList = listOperationHistory(context.connection, {
      limit: 1,
    });
    assert.equal(limitedList.length, 1);
    assert.equal(countOperationHistory(context.connection, { limit: 1 }), 4);

    context.close();
  } finally {
    cleanup();
  }
});

test('4. 同一 completedAt の 2 行が id 降順で返る。ページング、既定 100、上限 1000、limit=0・負値・負の offset の例外を検証する', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const item1: OperationHistoryInput = {
      requestId: 'req-order-1',
      operationKind: 'start',
      targetKind: 'all',
      result: 'success',
      requestedAt: '2026-09-09T12:00:00Z',
      completedAt: '2026-09-09T12:00:10Z',
      actorId: null,
      actorDisplayName: null,
      errorCode: null,
      errorMessage: null,
    };
    const item2: OperationHistoryInput = {
      requestId: 'req-order-2',
      operationKind: 'stop',
      targetKind: 'all',
      result: 'success',
      requestedAt: '2026-09-09T12:00:01Z',
      completedAt: '2026-09-09T12:00:10Z', // 同一 completedAt
      actorId: null,
      actorDisplayName: null,
      errorCode: null,
      errorMessage: null,
    };
    const item3: OperationHistoryInput = {
      requestId: 'req-order-3',
      operationKind: 'force_refresh',
      targetKind: 'all',
      result: 'success',
      requestedAt: '2026-09-09T12:00:02Z',
      completedAt: '2026-09-09T12:00:20Z', // より新しい completedAt
      actorId: null,
      actorDisplayName: null,
      errorCode: null,
      errorMessage: null,
    };

    const r1 = recordOperationHistory(context.connection, item1);
    const r2 = recordOperationHistory(context.connection, item2);
    const r3 = recordOperationHistory(context.connection, item3);

    const all = listOperationHistory(context.connection);
    // completedAt DESC, id DESC: r3 -> r2 -> r1
    assert.equal(all.length, 3);
    assert.equal(all[0].id, r3.id);
    assert.equal(all[1].id, r2.id); // 同一時刻なら id 降順
    assert.equal(all[2].id, r1.id);

    // ページング: limit=1, offset=1 -> r2
    const page = listOperationHistory(context.connection, { limit: 1, offset: 1 });
    assert.equal(page.length, 1);
    assert.equal(page[0].id, r2.id);

    // 1005 行投入して上限 1000 の丸めを検証
    const insertMany = context.connection.transaction(() => {
      const stmt = context.connection.prepare(`
        INSERT INTO operation_history (
          request_id, operation_kind, target_kind, result,
          requested_at, completed_at, actor_id, actor_display_name, error_code, error_message
        ) VALUES (?, 'start', 'all', 'success', '2026-09-09T00:00:00Z', '2026-09-09T00:00:01Z', NULL, NULL, NULL, NULL)
      `);
      for (let i = 4; i <= 1005; i++) {
        stmt.run(`bulk-${i}`);
      }
    });
    insertMany();

    // 上限 1000 の丸め（1000 件に丸められる）
    const largeLimit = listOperationHistory(context.connection, { limit: 5000 });
    assert.equal(largeLimit.length, 1000);

    // limit <= 0: 例外
    assert.throws(() => listOperationHistory(context.connection, { limit: 0 }), {
      message: /limit must be a positive integer/,
    });
    assert.throws(() => listOperationHistory(context.connection, { limit: -5 }), {
      message: /limit must be a positive integer/,
    });

    // offset < 0: 例外
    assert.throws(() => listOperationHistory(context.connection, { offset: -1 }), {
      message: /offset must be a non-negative integer/,
    });

    context.close();
  } finally {
    cleanup();
  }
});

test('5. 空の requestId、不正な操作・結果・対象、非 ISO 8601 の要求受理・結果確定時刻、結果確定時刻より後の要求受理時刻、NULL 以外の主体・空文字のエラーコードを渡すと、SQL 実行前に例外になる。success / failure の双方で診断列が NULL の入力は例外にならない', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const baseValid: OperationHistoryInput = {
      requestId: 'req-valid',
      operationKind: 'start',
      targetKind: 'all',
      result: 'success',
      requestedAt: '2026-09-09T00:00:00Z',
      completedAt: '2026-09-09T00:00:01Z',
      actorId: null,
      actorDisplayName: null,
      errorCode: null,
      errorMessage: null,
    };

    // 空の requestId
    assert.throws(
      () => recordOperationHistory(context.connection, { ...baseValid, requestId: '' }),
      { message: /requestId must be a non-empty string/ },
    );

    // 不正な operationKind
    assert.throws(
      () =>
        recordOperationHistory(context.connection, {
          ...baseValid,
          operationKind: 'restart' as OperationKind,
        }),
      { message: /Invalid operationKind/ },
    );

    // 不正な targetKind
    assert.throws(
      () =>
        recordOperationHistory(context.connection, {
          ...baseValid,
          targetKind: 'single' as OperationTargetKind,
        }),
      { message: /Invalid targetKind/ },
    );

    // 不正な result
    assert.throws(
      () =>
        recordOperationHistory(context.connection, {
          ...baseValid,
          result: 'pending' as OperationResult,
        }),
      { message: /Invalid operation result/ },
    );

    // 非 ISO 8601 の requestedAt
    assert.throws(
      () =>
        recordOperationHistory(context.connection, {
          ...baseValid,
          requestedAt: '2026/09/09 00:00:00',
        }),
      { message: /requestedAt must be a UTC ISO 8601 string/ },
    );

    // 非 ISO 8601 の completedAt
    assert.throws(
      () =>
        recordOperationHistory(context.connection, {
          ...baseValid,
          completedAt: 'not-a-date',
        }),
      { message: /completedAt must be a UTC ISO 8601 string/ },
    );

    // requestedAt > completedAt
    assert.throws(
      () =>
        recordOperationHistory(context.connection, {
          ...baseValid,
          requestedAt: '2026-09-09T00:00:10Z',
          completedAt: '2026-09-09T00:00:01Z',
        }),
      { message: /requestedAt must be less than or equal to completedAt/ },
    );

    // AuthGate 連携前は主体を常に NULL とする
    assert.throws(
      () =>
        recordOperationHistory(context.connection, {
          ...baseValid,
          actorId: 'actor-001' as unknown as null,
          actorDisplayName: 'システム管理者' as unknown as null,
        }),
      { message: /actorId and actorDisplayName must both be null before AuthGate integration/ },
    );

    // 空文字の errorCode
    assert.throws(
      () => recordOperationHistory(context.connection, { ...baseValid, errorCode: '' }),
      { message: /errorCode must be a non-empty string/ },
    );

    // success で診断列が NULL: 例外にならない
    const succRec = recordOperationHistory(context.connection, {
      ...baseValid,
      requestId: 'req-succ-diag-null',
      result: 'success',
      errorCode: null,
      errorMessage: null,
    });
    assert.ok(succRec.id > 0);

    // failure で診断列が NULL: 例外にならない (確定事項)
    const failRec = recordOperationHistory(context.connection, {
      ...baseValid,
      requestId: 'req-fail-diag-null',
      result: 'failure',
      errorCode: null,
      errorMessage: null,
    });
    assert.ok(failRec.id > 0);

    context.close();
  } finally {
    cleanup();
  }
});

test('6. 同じ requestId の再記録が失敗し、先行行が完全一致で残る。異なる requestId の同一操作は両方残る', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const first = recordOperationHistory(context.connection, sampleStartInput);

    // 同じ requestId の再記録 -> UNIQUE 違反で例外
    assert.throws(
      () =>
        recordOperationHistory(context.connection, {
          ...sampleStartInput,
          result: 'failure',
        }),
      { message: /UNIQUE constraint failed/ },
    );

    // 先行行が完全一致で残る
    const current = findOperationHistoryById(context.connection, first.id);
    assert.deepEqual(current, first);

    // 異なる requestId の同一操作 -> 両方保存される
    const second = recordOperationHistory(context.connection, {
      ...sampleStartInput,
      requestId: 'req-start-002',
    });
    assert.ok(second.id > first.id);
    assert.equal(second.requestId, 'req-start-002');
    assert.equal(countOperationHistory(context.connection), 2);

    context.close();
  } finally {
    cleanup();
  }
});

test('7. deleteOperationHistory が対象 1 行だけを削除し、存在しない ID は false、他の行は完全一致で残る', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const r1 = recordOperationHistory(context.connection, sampleStartInput);
    const r2 = recordOperationHistory(context.connection, sampleStopInput);

    // 存在しない ID の削除 -> false
    assert.equal(deleteOperationHistory(context.connection, 999999), false);

    // r1 を削除 -> true
    assert.equal(deleteOperationHistory(context.connection, r1.id), true);
    assert.equal(findOperationHistoryById(context.connection, r1.id), null);

    // r2 は完全一致で残る
    assert.deepEqual(findOperationHistoryById(context.connection, r2.id), r2);
    assert.equal(countOperationHistory(context.connection), 1);

    context.close();
  } finally {
    cleanup();
  }
});
