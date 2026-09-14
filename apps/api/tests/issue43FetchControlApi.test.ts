import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  isFetchControlRequestId,
  type FetchControlCompletedResponse,
  type FetchControlInProgressResponse,
  type UtcIso8601String,
} from '@wx-viewer-poc/shared';
import { initializeDatabase } from '../src/database/index.js';
import { createApp } from '../src/app.js';
import {
  createFetchControlService,
  ForceRefreshFailedError,
  RESUME_RECOVERY_THRESHOLD_MS,
  type FetchControlOutcome,
  type FetchControlTargets,
} from '../src/services/fetchControlService.js';
import { registerGracefulShutdown } from '../src/gracefulShutdown.js';
import {
  countNotificationOutputHistory,
  listNotificationOutputHistory,
} from '../src/repositories/notificationOutputHistoryRepository.js';
import { countOperationHistory } from '../src/repositories/operationHistoryRepository.js';
import { JmaXmlPollingService } from '../src/polling/jmaXmlPollingService.js';
import { TimeBasedPollingScheduler } from '../src/polling/timeBasedPollingScheduler.js';
import { NowcastService } from '../src/polling/nowcastService.js';
import { KikikuruService } from '../src/polling/kikikuruService.js';
import { resolvePollingPeriod, type PollingScheduleConfig } from '../src/config/pollingSchedule.js';
import { loadPollingScheduleConfig } from '../src/config/pollingScheduleLoader.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

function createDb() {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-fetchcontrol-'));
  const context = initializeDatabase({
    databasePath: join(directory, 'test.sqlite3'),
    migrationsDirectory,
  });
  return { context, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';

function makeDeferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface StubTargets extends FetchControlTargets {
  startCalls: number;
  stopCalls: number;
  forceRefreshCalls: number;
  runRecoveryCalls: number;
  running: boolean;
  upstreamAllowed: boolean;
}

function createStubTargets(overrides?: Partial<StubTargets>): StubTargets {
  const target: StubTargets = {
    startCalls: 0,
    stopCalls: 0,
    forceRefreshCalls: 0,
    runRecoveryCalls: 0,
    running: false,
    upstreamAllowed: true,
    async start() {
      target.startCalls += 1;
      target.running = true;
    },
    async stop() {
      target.stopCalls += 1;
      target.running = false;
    },
    async forceRefresh() {
      target.forceRefreshCalls += 1;
    },
    async runRecovery() {
      target.runRecoveryCalls += 1;
    },
    isRunning: () => target.running,
    isUpstreamAllowedNow: () => target.upstreamAllowed,
    ...overrides,
  };
  return target;
}

function assertCompleted(outcome: FetchControlOutcome): FetchControlCompletedResponse {
  assert.equal(outcome.kind, 'completed');
  return (outcome as { kind: 'completed'; response: FetchControlCompletedResponse }).response;
}

function assertInProgress(outcome: FetchControlOutcome): FetchControlInProgressResponse {
  assert.equal(outcome.kind, 'in_progress');
  return (outcome as { kind: 'in_progress'; response: FetchControlInProgressResponse }).response;
}

test('UUID検証: isFetchControlRequestId が正しい形式だけを受理する', () => {
  assert.equal(isFetchControlRequestId(UUID_A), true);
  assert.equal(isFetchControlRequestId('not-a-uuid'), false);
  assert.equal(isFetchControlRequestId(''), false);
  assert.equal(isFetchControlRequestId(123), false);
});

test('受け入れ条件3: 開始操作の記録', async () => {
  const { context, cleanup } = createDb();
  try {
    const targets = createStubTargets();
    const service = createFetchControlService({
      connection: context.connection,
      targets,
      now: () => new Date().toISOString() as UtcIso8601String,
    });

    const outcome = await service.request('start', UUID_A);
    const response = assertCompleted(outcome);
    assert.equal(response.result, 'success');
    assert.equal(response.duplicate, false);
    assert.equal(response.operationKind, 'start');
    assert.equal(response.targetKind, 'all');

    const row = context.connection
      .prepare('SELECT * FROM operation_history WHERE request_id = ?')
      .get(UUID_A) as Record<string, unknown>;
    assert.equal(row.operation_kind, 'start');
    assert.equal(row.target_kind, 'all');
    assert.equal(row.actor_id, null);
    assert.equal(row.actor_display_name, null);
    assert.ok((row.requested_at as string) <= (row.completed_at as string));
    assert.match(row.requested_at as string, /Z$/);
    assert.match(row.completed_at as string, /Z$/);
  } finally {
    cleanup();
  }
});

test('受け入れ条件4: 停止操作の記録', async () => {
  const { context, cleanup } = createDb();
  try {
    const targets = createStubTargets({ running: true });
    const service = createFetchControlService({
      connection: context.connection,
      targets,
      now: () => new Date().toISOString() as UtcIso8601String,
    });

    const outcome = await service.request('stop', UUID_A);
    const response = assertCompleted(outcome);
    assert.equal(response.result, 'success');
    assert.equal(targets.isRunning(), false);

    const count = countOperationHistory(context.connection, { operationKind: 'stop' });
    assert.equal(count, 1);
  } finally {
    cleanup();
  }
});

test('受け入れ条件5: 重複防止（同一requestIdでジョブを増やさない）', async () => {
  const { context, cleanup } = createDb();
  try {
    const targets = createStubTargets();
    const service = createFetchControlService({
      connection: context.connection,
      targets,
      now: () => new Date().toISOString() as UtcIso8601String,
    });

    const first = assertCompleted(await service.request('start', UUID_A));
    assert.equal(first.duplicate, false);
    const second = assertCompleted(await service.request('start', UUID_A));
    assert.equal(second.duplicate, true);
    const third = assertCompleted(await service.request('start', UUID_A));
    assert.equal(third.duplicate, true);

    assert.equal(targets.startCalls, 1);
    const count = countOperationHistory(context.connection, {});
    assert.equal(count, 1);
  } finally {
    cleanup();
  }
});

test('受け入れ条件6: 実行中の重複要求は202を返しジョブを増やさない', async () => {
  const { context, cleanup } = createDb();
  try {
    const deferred = makeDeferred<void>();
    let callCount = 0;
    const targets = createStubTargets({
      async start() {
        callCount += 1;
        await deferred.promise;
      },
    });
    const service = createFetchControlService({
      connection: context.connection,
      targets,
      now: () => new Date().toISOString() as UtcIso8601String,
    });

    const firstPromise = service.request('start', UUID_A);
    // 先行呼び出しが inProgress に登録されるまで1マイクロタスク待つ。
    await Promise.resolve();
    const secondOutcome = await service.request('start', UUID_A);
    const inProgress = assertInProgress(secondOutcome);
    assert.equal(inProgress.requestId, UUID_A);
    assert.equal(callCount, 1);

    deferred.resolve();
    const firstOutcome = assertCompleted(await firstPromise);
    assert.equal(firstOutcome.duplicate, false);
  } finally {
    cleanup();
  }
});

test('受け入れ条件7: 強制更新の同時実行集約（別requestId）', async () => {
  const { context, cleanup } = createDb();
  try {
    const deferred = makeDeferred<void>();
    let forceCallCount = 0;
    const targets = createStubTargets({
      async forceRefresh() {
        forceCallCount += 1;
        await deferred.promise;
      },
    });
    const service = createFetchControlService({
      connection: context.connection,
      targets,
      now: () => new Date().toISOString() as UtcIso8601String,
    });

    const firstPromise = service.request('force_refresh', UUID_A);
    await Promise.resolve();
    const secondPromise = service.request('force_refresh', UUID_B);
    await Promise.resolve();

    deferred.resolve();
    const [firstOutcome, secondOutcome] = await Promise.all([firstPromise, secondPromise]);
    const first = assertCompleted(firstOutcome);
    const second = assertCompleted(secondOutcome);

    assert.equal(forceCallCount, 1);
    assert.equal(first.completedAt, second.completedAt);
    assert.equal(first.result, second.result);

    const rows = context.connection
      .prepare('SELECT request_id, requested_at FROM operation_history ORDER BY request_id')
      .all() as { request_id: string; requested_at: string }[];
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.request_id).sort(), [UUID_A, UUID_B].sort());
  } finally {
    cleanup();
  }
});

test('受け入れ条件10: 停止中の強制更新は成功し、自動取得は再開しない', async () => {
  const { context, cleanup } = createDb();
  try {
    const targets = createStubTargets({ running: false });
    const service = createFetchControlService({
      connection: context.connection,
      targets,
      now: () => new Date().toISOString() as UtcIso8601String,
    });

    const outcome = assertCompleted(await service.request('force_refresh', UUID_A));
    assert.equal(outcome.result, 'success');
    assert.equal(targets.isRunning(), false);
  } finally {
    cleanup();
  }
});

test('受け入れ条件12: 結果照会（完了・未知・実行中）', async () => {
  const { context, cleanup } = createDb();
  try {
    const deferred = makeDeferred<void>();
    const targets = createStubTargets({
      async stop() {
        await deferred.promise;
      },
    });
    const service = createFetchControlService({
      connection: context.connection,
      targets,
      now: () => new Date().toISOString() as UtcIso8601String,
    });

    const startOutcome = assertCompleted(await service.request('start', UUID_A));

    const foundStart = assertCompleted(service.find(UUID_A));
    assert.equal(foundStart.result, startOutcome.result);
    assert.equal(foundStart.requestedAt, startOutcome.requestedAt);
    assert.equal(foundStart.completedAt, startOutcome.completedAt);

    const unknown = service.find(UUID_C);
    assert.equal(unknown.kind, 'not_found');

    const stopPromise = service.request('stop', UUID_B);
    await Promise.resolve();
    const inProgress = service.find(UUID_B);
    assert.equal(inProgress.kind, 'in_progress');

    deferred.resolve();
    await stopPromise;
  } finally {
    cleanup();
  }
});

test('受け入れ条件13: 入力検証（HTTP層）', async () => {
  const { context, cleanup } = createDb();
  try {
    const targets = createStubTargets();
    const fetchControl = createFetchControlService({
      connection: context.connection,
      targets,
      now: () => new Date().toISOString() as UtcIso8601String,
    });
    const app = createApp({ fetchControl });
    const server = app.listen(0);
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const baseUrl = `http://localhost:${port}`;

    try {
      const bodies: (string | undefined)[] = [
        undefined,
        JSON.stringify({}),
        JSON.stringify({ requestId: 'abc' }),
        JSON.stringify({ requestId: UUID_A, extra: 1 }),
      ];
      for (const body of bodies) {
        const res = await fetch(`${baseUrl}/api/control/fetch/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        assert.equal(res.status, 400, `body=${body}`);
        assert.deepEqual(await res.json(), { status: 'error', code: 'invalid_request' });
      }

      const count = countOperationHistory(context.connection, {});
      assert.equal(count, 0);

      const badQuery = await fetch(`${baseUrl}/api/control/operations/not-a-uuid`);
      assert.equal(badQuery.status, 400);
    } finally {
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    }
  } finally {
    cleanup();
  }
});

test('受け入れ条件14: 操作種別の衝突（409）', async () => {
  const { context, cleanup } = createDb();
  try {
    const targets = createStubTargets();
    const service = createFetchControlService({
      connection: context.connection,
      targets,
      now: () => new Date().toISOString() as UtcIso8601String,
    });

    await service.request('start', UUID_A);
    const conflict = await service.request('force_refresh', UUID_A);
    assert.equal(conflict.kind, 'conflict');
    if (conflict.kind === 'conflict') {
      assert.equal(conflict.recordedOperationKind, 'start');
    }
    const count = countOperationHistory(context.connection, {});
    assert.equal(count, 1);
  } finally {
    cleanup();
  }
});

test('受け入れ条件15・16: 通知生成とAD-H068の分離', async () => {
  const { context, cleanup } = createDb();
  try {
    const targets = createStubTargets();
    const service = createFetchControlService({
      connection: context.connection,
      targets,
      now: () => new Date().toISOString() as UtcIso8601String,
    });

    await service.request('start', UUID_A);
    await service.request('stop', UUID_B);
    await service.request('force_refresh', UUID_C);

    const notifications = listNotificationOutputHistory(context.connection, {});
    const started = notifications.find(
      (n) => n.messageDefinitionId === 'system-fetch-manually-started',
    );
    const stopped = notifications.find(
      (n) => n.messageDefinitionId === 'system-fetch-manually-stopped',
    );
    const forceCompleted = notifications.find(
      (n) => n.messageDefinitionId === 'system-force-fetch-completed',
    );
    assert.ok(started);
    assert.ok(stopped);
    assert.ok(forceCompleted);
    assert.equal(started!.origin, 'system');
    assert.equal(started!.isTraining, false);
    for (const n of [started, stopped, forceCompleted]) {
      const refs = JSON.parse(n!.relatedRefsJson) as { type: string; ref: string }[];
      assert.ok(refs.some((r) => r.type === 'operation_request'));
    }

    const serviceStoppedCount = countNotificationOutputHistory(context.connection, {
      changeType: 'service_stopped',
    });
    assert.equal(serviceStoppedCount, 0);

    // 強制更新の失敗通知
    const failTargets = createStubTargets({
      async forceRefresh() {
        throw new ForceRefreshFailedError(['xml_regular', 'xml_extra']);
      },
    });
    const failService = createFetchControlService({
      connection: context.connection,
      targets: failTargets,
      now: () => new Date().toISOString() as UtcIso8601String,
    });
    await failService.request('force_refresh', '44444444-4444-4444-8444-444444444444');
    const failed = listNotificationOutputHistory(context.connection, {
      changeType: 'force_fetch_failed',
    });
    assert.equal(failed.length, 1);
    assert.equal(failed[0]!.ackRequired, true);
  } finally {
    cleanup();
  }
});

test('受け入れ条件17: 停止フック（graceful shutdown）', async () => {
  const { context, cleanup } = createDb();
  try {
    const targets = createStubTargets({ running: true });
    const service = createFetchControlService({
      connection: context.connection,
      targets,
      now: () => new Date().toISOString() as UtcIso8601String,
    });

    const emitter = new EventEmitter();
    let handled = 0;
    registerGracefulShutdown(emitter, async () => {
      handled += 1;
      await service.recordShutdown();
    });

    emitter.emit('SIGTERM');
    // ハンドラは非同期。イベントループを1周させて完了を待つ。
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    emitter.emit('SIGTERM');
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(handled, 1);

    const stopRows = context.connection
      .prepare("SELECT * FROM operation_history WHERE operation_kind = 'stop'")
      .all() as { request_id: string }[];
    assert.equal(stopRows.length, 1);
    assert.match(stopRows[0]!.request_id, /^shutdown-/);

    const serviceStoppedCount = countNotificationOutputHistory(context.connection, {
      changeType: 'service_stopped',
    });
    assert.equal(serviceStoppedCount, 1);
  } finally {
    cleanup();
  }
});

test('受け入れ条件18: 通知記録失敗の隔離', async () => {
  const { context, cleanup } = createDb();
  try {
    const targets = createStubTargets();
    const originalPrepare = context.connection.prepare.bind(context.connection);
    let sabotage = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (context.connection as any).prepare = (sql: string) => {
      if (sabotage && sql.includes('INSERT INTO notification_output_history')) {
        throw new Error('injected notification failure');
      }
      return originalPrepare(sql);
    };

    const service = createFetchControlService({
      connection: context.connection,
      targets,
      now: () => new Date().toISOString() as UtcIso8601String,
    });

    sabotage = true;
    const outcome = assertCompleted(await service.request('start', UUID_A));
    assert.equal(outcome.result, 'success');

    const count = countOperationHistory(context.connection, {});
    assert.equal(count, 1);
  } finally {
    cleanup();
  }
});

test('受け入れ条件19: ポーリング無効時は503', async () => {
  const { context, cleanup } = createDb();
  try {
    const fetchControl = createFetchControlService({
      connection: context.connection,
      targets: null,
      now: () => new Date().toISOString() as UtcIso8601String,
    });
    const app = createApp({ fetchControl });
    const server = app.listen(0);
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const baseUrl = `http://localhost:${port}`;

    try {
      const res = await fetch(`${baseUrl}/api/control/fetch/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: UUID_A }),
      });
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { status: 'error', code: 'fetch_control_unavailable' });

      const count = countOperationHistory(context.connection, {});
      assert.equal(count, 0);
    } finally {
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    }
  } finally {
    cleanup();
  }
});

test('受け入れ条件20: 境界（削除・認証・異常終了検知・個別操作エンドポイントが存在しない）', async () => {
  const { context, cleanup } = createDb();
  try {
    const targets = createStubTargets();
    const fetchControl = createFetchControlService({
      connection: context.connection,
      targets,
      now: () => new Date().toISOString() as UtcIso8601String,
    });
    const app = createApp({ fetchControl });
    const server = app.listen(0);
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const baseUrl = `http://localhost:${port}`;
    try {
      const unexpectedPaths = [
        '/api/control/fetch/xml/start',
        '/api/control/fetch/delete',
        '/api/control/auth',
      ];
      for (const path of unexpectedPaths) {
        const res = await fetch(`${baseUrl}${path}`, { method: 'POST' });
        assert.ok(res.status === 404 || res.status === 405, path);
      }
    } finally {
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    }
  } finally {
    cleanup();
  }
});

test('受け入れ条件23: 再開時の復旧（しきい値30分）', async () => {
  const { context, cleanup } = createDb();
  try {
    let currentIso = '2026-09-15T10:00:00.000Z';
    const targets = createStubTargets({ upstreamAllowed: true });
    const service = createFetchControlService({
      connection: context.connection,
      targets,
      now: () => currentIso as UtcIso8601String,
    });

    // 停止
    await service.request('stop', UUID_A);

    // 29分後の開始: 復旧しない
    currentIso = new Date(Date.parse(currentIso) + 29 * 60_000).toISOString();
    await service.request('start', UUID_B);
    assert.equal(targets.runRecoveryCalls, 0);

    // 停止し直す
    currentIso = new Date(Date.parse(currentIso) + 1000).toISOString();
    await service.request('stop', '55555555-5555-4555-8555-555555555555');

    // 30分ちょうど後の開始: 復旧する
    // §9-B 確定事項(5): しきい値30分は固定値。実装の定数からではなくリテラル値からコピーして、
    // 定数の値が変わってもテストが追従してしまわないようにする。
    currentIso = new Date(Date.parse(currentIso) + 30 * 60 * 1000).toISOString();
    await service.request('start', '66666666-6666-4666-8666-666666666666');
    assert.equal(targets.runRecoveryCalls, 1);

    // 続けて同条件の開始をもう一度行っても復旧は再実行されない
    currentIso = new Date(Date.parse(currentIso) + 1000).toISOString();
    await service.request('start', '77777777-7777-4777-8777-777777777777');
    assert.equal(targets.runRecoveryCalls, 1);
  } finally {
    cleanup();
  }
});

test('受け入れ条件24: 復旧失敗の隔離', async () => {
  const { context, cleanup } = createDb();
  try {
    let currentIso = '2026-09-15T10:00:00.000Z';
    const targets = createStubTargets({
      upstreamAllowed: true,
      async runRecovery() {
        throw new Error('recovery boom');
      },
    });
    const service = createFetchControlService({
      connection: context.connection,
      targets,
      now: () => currentIso as UtcIso8601String,
    });

    await service.request('stop', UUID_A);
    currentIso = new Date(Date.parse(currentIso) + RESUME_RECOVERY_THRESHOLD_MS).toISOString();
    const outcome = assertCompleted(await service.request('start', UUID_B));
    assert.equal(outcome.result, 'success');
    assert.equal(outcome.errorCode, null);
  } finally {
    cleanup();
  }
});

test('受け入れ条件25: 夜間の開始操作と保留（確定事項6）', async () => {
  const { context, cleanup } = createDb();
  try {
    let currentIso = '2026-09-15T20:30:00.000Z'; // 05:30 JST 翌日ではなく 20:30 JST(夜間) を意図
    // 20:30 JST = 11:30 UTC。夜間帯であることを直接 upstreamAllowed=false で表現する。
    let isNight = true;
    const targets = createStubTargets({
      isUpstreamAllowedNow: () => !isNight,
    });
    const service = createFetchControlService({
      connection: context.connection,
      targets,
      now: () => currentIso as UtcIso8601String,
    });

    await service.request('stop', UUID_A);
    currentIso = new Date(Date.parse(currentIso) + RESUME_RECOVERY_THRESHOLD_MS).toISOString();

    // 夜間帯の開始操作: 復旧しない
    await service.request('start', UUID_B);
    assert.equal(targets.runRecoveryCalls, 0);

    // 開始操作を行わずに疑似時計だけを夜間明けへ進めても、復旧は走らない
    isNight = false;
    currentIso = new Date(Date.parse(currentIso) + 60 * 60_000).toISOString();
    assert.equal(targets.runRecoveryCalls, 0);

    // 改めて開始操作を行うと、保留されていた復旧が実行される
    const finalOutcome = assertCompleted(await service.request('start', UUID_C));
    assert.equal(finalOutcome.result, 'success');
    assert.equal(targets.runRecoveryCalls, 1);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// スケジューラ層: バックオフ割り込み(AC8)・定期予定への非影響(AC9)
// ---------------------------------------------------------------------------

const defaultXmlFreshnessPolicy = { staleAfterSeconds: 300 };

function dummyAdapter(source: 'nowcast' | 'kikikuru' | 'amedas') {
  return {
    source,
    runScheduled: async () => {},
    runManual: async () => {},
  };
}

test('受け入れ条件8: バックオフ割り込み（manual固有）', async () => {
  const { context, cleanup } = createDb();
  try {
    const fetchCalls: string[] = [];
    const now = () => '2026-09-15T10:00:00.000Z';
    const fetchFn: typeof fetch = async (url) => {
      fetchCalls.push(String(url));
      return new Response('', { status: 500 });
    };

    const xmlService = new JmaXmlPollingService(context.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn,
      clock: now,
    });

    await xmlService.pollFeeds('scheduled');
    const afterFirstScheduled = fetchCalls.length;
    assert.ok(afterFirstScheduled >= 2);

    // 同じ時刻のまま再度 scheduled を回すとバックオフ待機中でスキップされる
    await xmlService.pollFeeds('scheduled');
    assert.equal(fetchCalls.length, afterFirstScheduled);

    // manual は待機中でも割り込んで実行する
    const beforeManual = fetchCalls.length;
    await xmlService.pollOnce('manual');
    assert.ok(fetchCalls.length > beforeManual);
  } finally {
    cleanup();
  }
});

test('受け入れ条件9: 強制更新の実行前後で定期予定(nextRunAt・period)が変化しない', async () => {
  const { context, cleanup } = createDb();
  try {
    for (const [label, iso] of [
      ['日中帯', '2026-09-15T10:00:00.000Z'],
      ['夜間帯', '2026-09-15T21:00:00+09:00'],
    ] as const) {
      const fetchFn: typeof fetch = async () => new Response('', { status: 500 });
      const nowFn = () => new Date(iso);
      const xmlService = new JmaXmlPollingService(context.connection, {
        freshnessPolicy: defaultXmlFreshnessPolicy,
        fetchFn,
        clock: () => nowFn().toISOString(),
      });

      const schedule: PollingScheduleConfig = loadPollingScheduleConfig();
      const scheduler = new TimeBasedPollingScheduler({
        schedule,
        adapters: [dummyAdapter('nowcast'), dummyAdapter('kikikuru'), dummyAdapter('amedas')],
        xmlPollingService: xmlService,
        now: nowFn,
        setTimer: () => 1,
        clearTimer: () => {},
      });

      await scheduler.start();
      const before = scheduler.getStatus();

      await scheduler.runManualOnce();

      const after = scheduler.getStatus();
      assert.deepEqual(after.period, before.period, label);
      for (const source of ['xml', 'nowcast', 'kikikuru', 'amedas'] as const) {
        assert.equal(
          after.sources[source].nextRunAt,
          before.sources[source].nextRunAt,
          `${label} ${source}`,
        );
      }

      await scheduler.stop();
    }
  } finally {
    cleanup();
  }
});

test('受け入れ条件23(c): 復旧は長期フィード(regular_l/extra_l)を含み、manualトリガーには含まれない', async () => {
  const { context, cleanup } = createDb();
  try {
    const now = () => '2026-09-15T10:00:00.000Z';

    const recoveryUrls: string[] = [];
    const recoveryFetchFn: typeof fetch = async (url) => {
      recoveryUrls.push(String(url));
      return new Response('', { status: 500 });
    };
    const recoveryXmlService = new JmaXmlPollingService(context.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: recoveryFetchFn,
      clock: now,
    });
    await recoveryXmlService.pollFeeds('recovery');
    assert.ok(
      recoveryUrls.some((u) => u.includes('regular_l.xml')),
      'recovery は regular_l を含む',
    );
    assert.ok(
      recoveryUrls.some((u) => u.includes('extra_l.xml')),
      'recovery は extra_l を含む',
    );

    const manualUrls: string[] = [];
    const manualFetchFn: typeof fetch = async (url) => {
      manualUrls.push(String(url));
      return new Response('', { status: 500 });
    };
    const manualXmlService = new JmaXmlPollingService(context.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: manualFetchFn,
      clock: now,
    });
    await manualXmlService.pollOnce('manual');
    assert.equal(
      manualUrls.some((u) => u.includes('regular_l.xml') || u.includes('extra_l.xml')),
      false,
      'manual トリガーは長期フィードを含まない',
    );
  } finally {
    cleanup();
  }
});

test('受け入れ条件11: 手動停止は時間帯境界を跨いでも維持される', async () => {
  const { context, cleanup } = createDb();
  try {
    // 19:59:50 JST から開始し、20:00・翌04:00 の時間帯境界を跨いで検証する。
    let nowIso = '2026-09-15T19:59:50+09:00';
    const nowFn = () => new Date(nowIso);
    const fetchFn: typeof fetch = async () => new Response('', { status: 500 });
    const xmlService = new JmaXmlPollingService(context.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn,
      clock: () => nowFn().toISOString(),
    });

    const callCounts = { nowcast: 0, kikikuru: 0, amedas: 0 };
    function countingAdapter(source: 'nowcast' | 'kikikuru' | 'amedas') {
      return {
        source,
        runScheduled: async () => {
          callCounts[source] += 1;
        },
        runManual: async () => {
          callCounts[source] += 1;
        },
      };
    }

    const timers = new Map<number, () => void>();
    let nextTimerId = 1;
    const setTimer = (cb: () => void) => {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, cb);
      return id;
    };
    const clearTimer = (id: unknown) => {
      timers.delete(id as number);
    };

    const schedule: PollingScheduleConfig = loadPollingScheduleConfig();
    const scheduler = new TimeBasedPollingScheduler({
      schedule,
      adapters: [
        countingAdapter('nowcast'),
        countingAdapter('kikikuru'),
        countingAdapter('amedas'),
      ],
      xmlPollingService: xmlService,
      now: nowFn,
      setTimer,
      clearTimer,
    });

    await scheduler.start();
    await new Promise((resolve) => setImmediate(resolve));
    // start() 直後に登録されたタイマー(境界タイマーを含む)のスナップショットを取る。
    const timersAtStart = new Map(timers);
    const before = { ...callCounts };

    // 手動停止（境界タイマーも解除される想定）
    await scheduler.stop();
    assert.equal(scheduler.isRunningNow(), false);

    // 疑似時計を 20:00 → 翌04:00 の境界を跨いで進める
    nowIso = '2026-09-15T20:00:00+09:00';
    assert.equal(scheduler.isRunningNow(), false);
    nowIso = '2026-09-16T04:00:00+09:00';
    assert.equal(scheduler.isRunningNow(), false);

    // 回帰確認: stop() は稼働中に登録されていた全タイマー(境界タイマーを含む)を
    // 実際に解除している。解除されていなければ、実タイマーの環境では境界到来時に
    // コールバックが発火して定期取得が再開してしまう。
    for (const id of timersAtStart.keys()) {
      assert.equal(timers.has(id), false, `timer ${id} が stop() 後も残っている`);
    }
    assert.equal(timers.size, 0, 'stop() 後に未解除のタイマーが残っている');

    assert.equal(scheduler.isRunningNow(), false);
    assert.deepEqual(callCounts, before);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 索引取得サービス層: 夜間帯の強制更新迂回(AC21・AC22)
// ---------------------------------------------------------------------------

test('受け入れ条件21・22: 夜間帯の強制更新は索引を迂回して取得し、既定経路・画像取得・無効起動は迂回しない', async () => {
  const { context, cleanup } = createDb();
  try {
    const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-fetchcontrol-cache-'));
    try {
      const nightNow = () => new Date('2026-09-15T21:00:00+09:00');
      const schedule: PollingScheduleConfig = loadPollingScheduleConfig();

      const requestedUrls: string[] = [];
      const fetchFn: typeof fetch = async (url) => {
        requestedUrls.push(String(url));
        return new Response('{}', { status: 200 });
      };

      // enablePolling: true, isClosed: false の想定で getManualCatalogAccess を組み立てる
      // (imageServices.ts の実装と同じ規則をテスト内で再現する)
      const getCatalogAccess = () => {
        const period = resolvePollingPeriod(nightNow(), schedule);
        return { allowed: period.imageCatalogSeconds !== null, period, nextAllowedAt: null };
      };
      const getManualCatalogAccess = () => {
        const period = resolvePollingPeriod(nightNow(), schedule);
        return { allowed: true, period, nextAllowedAt: nightNow().toISOString() };
      };
      const getImageAccess = () => {
        const period = resolvePollingPeriod(nightNow(), schedule);
        return { allowed: false, period, nextAllowedAt: null };
      };

      const nowcastService = new NowcastService(context.connection, {
        cacheRoot: join(directory, 'nowcast'),
        allowedZooms: [10],
        getCatalogAccess,
        getImageAccess,
        freshnessPolicy: schedule.freshness.imageCatalog,
        fetchFn,
        clock: () => nightNow().toISOString(),
        getManualCatalogAccess,
      });

      const kikikuruService = new KikikuruService(context.connection, {
        cacheRoot: join(directory, 'kikikuru'),
        allowedZooms: [10],
        getCatalogAccess,
        getImageAccess,
        freshnessPolicy: schedule.freshness.imageCatalog,
        fetchFn,
        clock: () => nightNow().toISOString(),
        getManualCatalogAccess,
      });

      // (a) 引数なし(定期経路)は夜間ゲートを迂回せず 0 回のまま
      await nowcastService.refreshTimes();
      await kikikuruService.refreshTimes();
      assert.equal(requestedUrls.length, 0, '定期経路は夜間ゲートを迂回しない(#24 AC13の非退行)');

      // (b) 手動強制更新は夜間でも索引取得を行う
      await nowcastService.refreshTimes({ triggerKind: 'manual', bypassScheduleStop: true });
      await kikikuruService.refreshTimes({ triggerKind: 'manual', bypassScheduleStop: true });
      assert.ok(requestedUrls.some((u) => u.includes('N1') || u.includes('nowcast')));
      assert.ok(requestedUrls.length >= 2);

      // (c) enablePolling:false 相当(isClosed/enablePolling=false)では迂回できない
      const disabledManualCatalogAccess = () => {
        const period = resolvePollingPeriod(nightNow(), schedule);
        return { allowed: false, period, nextAllowedAt: null };
      };
      const disabledUrls: string[] = [];
      const disabledFetchFn: typeof fetch = async (url) => {
        disabledUrls.push(String(url));
        return new Response('{}', { status: 200 });
      };
      const disabledNowcast = new NowcastService(context.connection, {
        cacheRoot: join(directory, 'nowcast-disabled'),
        allowedZooms: [10],
        getCatalogAccess,
        getImageAccess,
        freshnessPolicy: schedule.freshness.imageCatalog,
        fetchFn: disabledFetchFn,
        clock: () => nightNow().toISOString(),
        getManualCatalogAccess: disabledManualCatalogAccess,
      });
      await disabledNowcast.refreshTimes({ triggerKind: 'manual', bypassScheduleStop: true });
      assert.equal(
        disabledUrls.length,
        0,
        'enablePolling:false 相当では強制更新も索引を取得しない',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  } finally {
    cleanup();
  }
});
