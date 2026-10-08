import { StartupNotificationInitialization } from '../src/notifications/startupNotificationService.js';
import {
  initializeTestDatabases,
  createTestServerDatabaseOptions,
  createTestServerProcessEnv,
} from './helpers/databasePair.js';
import {
  eastVenueId,
  trcVenueId,
  testVenueRegistry,
  testTerminalRegistry,
} from './helpers/venueConfigPreload.js';
import test, { type TestContext } from 'node:test';
import { Server } from 'node:http';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  createStartupNotificationRuntime as createStartupNotificationRuntimeImpl,
  startServer,
  type StartServerOptions,
} from '../src/server.js';
import { resolveVenueWarningContext } from '../src/venueForecastTargets.js';
import { recoverWarningCurrent } from '../src/polling/jmaWarningCurrentProcessor.js';
import {
  createAlwaysOnTestPollingSchedule,
  createTestPollingSchedule,
} from './helpers/pollingSchedule.js';
import { createNotificationDeltaService } from '../src/notifications/index.js';
import type { SignalSource } from '../src/gracefulShutdown.js';
import {
  resolveNotificationMessage,
  toNotificationDeltaCursor,
  type SystemNotification,
} from '@wx-viewer-poc/shared';

const migrationsDirectory = join(fileURLToPath(import.meta.url), '../../migrations');
const createStartupNotificationRuntime = (
  context: ReturnType<typeof initializeTestDatabases>,
  clock: Parameters<typeof createStartupNotificationRuntimeImpl>[1],
  getFetchHealth?: Parameters<typeof createStartupNotificationRuntimeImpl>[3],
  recoveryInternals?: Parameters<typeof createStartupNotificationRuntimeImpl>[4],
) =>
  createStartupNotificationRuntimeImpl(
    context.weather.connection,
    clock,
    testVenueRegistry,
    getFetchHealth,
    recoveryInternals,
    testTerminalRegistry,
    context.retained.connection,
    context.weatherDatabaseGenerationId,
  );
const config = {
  delayedThresholdSeconds: 60,
  yieldEveryParsedReceptions: 25,
  candidatePageSize: 100,
};
const execFileAsync = promisify(execFile);

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      assert.fail(`waitUntil timeout: ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'database-recovery-orchestration-'));
  const databasePath = join(directory, 'db.sqlite3');
  const context = initializeTestDatabases({ databasePath, migrationsDirectory });
  return { directory, databasePath, context };
}

type StartupOutcome =
  | { status: 'fulfilled'; server: Awaited<ReturnType<typeof startServer>> }
  | { status: 'rejected'; error: unknown };

interface StartupState {
  starting?: ReturnType<typeof startServer>;
  outcome?: Promise<StartupOutcome>;
  httpServer?: Server;
  listenCalls?: number;
  requestedPort?: unknown;
  release?: () => void;
  restoreListen?: () => void;
}

function registerStartupCleanup(
  t: TestContext,
  state: StartupState,
  { context, directory }: ReturnType<typeof setup>,
): void {
  t.after(async () => {
    const errors: unknown[] = [];
    state.release?.();
    try {
      state.restoreListen?.();
    } catch (error) {
      errors.push(error);
    }
    let contextClosed = true;
    try {
      context.close();
    } catch (error) {
      errors.push(error);
      contextClosed = false;
    }
    const outcome = await state.outcome;
    if (outcome?.status === 'fulfilled') {
      // close失敗時はDBの解放を保証できないため、ディレクトリを削除しない。
      await outcome.server.close();
    } else if (outcome?.status === 'rejected') {
      errors.push(outcome.error);
    }
    if (state.httpServer) assert.equal(state.httpServer.listening, false);
    if (contextClosed) rmSync(directory, { recursive: true, force: true });
    if (errors.length > 0) throw new AggregateError(errors, '起動資源の後始末に失敗した');
  });
}

function captureStartingServer(
  t: TestContext,
  options: StartServerOptions,
  state: StartupState,
): void {
  const listen = t.mock.method(Server.prototype, 'listen');
  state.restoreListen = () => listen.mock.restore();
  let capturedThis: unknown;
  let capturedResult: unknown;
  try {
    state.starting = startServer({ ...options, port: 0 });
    state.outcome = state.starting.then(
      (server): StartupOutcome => ({ status: 'fulfilled', server }),
      (error: unknown): StartupOutcome => ({ status: 'rejected', error }),
    );
    const calls = listen.mock.calls;
    state.listenCalls = calls.length;
    capturedThis = calls[0]?.this;
    capturedResult = calls[0]?.result;
    if (capturedThis instanceof Server) state.httpServer = capturedThis;
    state.requestedPort = calls[0]?.arguments[0];
  } finally {
    listen.mock.restore();
    state.restoreListen = undefined;
  }
  assert.equal(state.listenCalls, 1);
  assert.equal(state.requestedPort, 0);
  assert.ok(capturedThis instanceof Server);
  assert.equal(capturedThis, capturedResult);
}

async function waitForAssignedPort(
  httpServer: Server,
  outcome: Promise<StartupOutcome>,
): Promise<number> {
  let settled: StartupOutcome | undefined;
  void outcome.then((result) => {
    settled = result;
  });
  await waitUntil(
    () => {
      if (settled?.status === 'rejected') throw settled.error;
      return httpServer.listening;
    },
    5000,
    '復旧中のHTTP待受開始',
  );
  const address = httpServer.address();
  assert.ok(address !== null && typeof address !== 'string');
  assert.ok(address.port > 0);
  return address.port;
}

class RecoverySignalSource implements SignalSource {
  private readonly listeners = new Map<'SIGTERM' | 'SIGINT', () => void>();
  once(event: 'SIGTERM' | 'SIGINT', listener: () => void): void {
    this.listeners.set(event, listener);
  }
  trigger(event: 'SIGTERM' | 'SIGINT'): void {
    this.listeners.get(event)?.();
  }
}

interface RecoveryRow {
  readonly id: number;
  readonly notification_id: string;
  readonly category: string;
  readonly change_type: string;
  readonly ack_required: number;
  readonly source_type: string;
  readonly source_version: string;
  readonly target_area_json: string;
  readonly message_definition_id: string;
}

function recoveryRows(
  connection: ReturnType<typeof initializeTestDatabases>['weather']['connection'],
): RecoveryRow[] {
  return connection
    .prepare(
      `SELECT id, notification_id, category, change_type, ack_required,
    source_type, source_version, target_area_json, message_definition_id FROM notification_output_history
    WHERE source_type = 'database_recovery' ORDER BY id`,
    )
    .all() as RecoveryRow[];
}

test('AC12: 59,999msでは遅延せず60,000msで会場別に1回だけ通知し、完了後は増えない', async () => {
  const { directory, context } = setup();
  let now = '2026-09-22T00:00:00.000Z';
  let callback: (() => void) | undefined;
  let resolveRecovery!: (
    value: Awaited<
      ReturnType<
        typeof import('../src/polling/jmaWarningCurrentProcessor.js').recoverWarningCurrent
      >
    >,
  ) => void;
  const controlled = new Promise<never>((resolve) => {
    resolveRecovery = resolve as never;
  });
  const runtime = createStartupNotificationRuntime(context, () => now, undefined, {
    setTimeout: ((cb: () => void) => {
      callback = cb;
      return 1 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout,
    clearTimeout: (() => undefined) as typeof clearTimeout,
    recover: (() => controlled) as never,
  });
  try {
    const promise = runtime.recoverVenue(
      resolveVenueWarningContext(testVenueRegistry, eastVenueId),
      config,
    );
    now = '2026-09-22T00:00:59.999Z';
    callback?.();
    assert.equal(recoveryRows(context.retained.connection).length, 1);
    now = '2026-09-22T00:01:00.000Z';
    callback?.();
    callback?.();
    assert.equal(recoveryRows(context.retained.connection).length, 2);
    resolveRecovery({
      venueId: eastVenueId,
      statuses: [],
      parsedReceptionCount: 0,
      elapsedMs: 60000,
    });
    await promise;
    callback?.();
    assert.deepEqual(
      recoveryRows(context.retained.connection).map((row) => row.change_type),
      ['database_recovery_started', 'database_recovery_delayed', 'database_recovery_completed'],
    );
  } finally {
    context.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('AC12: 設定値3秒を実際のタイマー待ち時間と遅延判定に使う', async () => {
  const { directory, context } = setup();
  let now = '2026-09-22T00:00:00.000Z';
  let registeredDelay: number | undefined;
  let callback: (() => void) | undefined;
  let resolveRecovery!: (value: Awaited<ReturnType<typeof recoverWarningCurrent>>) => void;
  const controlled = new Promise<Awaited<ReturnType<typeof recoverWarningCurrent>>>((resolve) => {
    resolveRecovery = resolve;
  });
  const runtime = createStartupNotificationRuntime(context, () => now, undefined, {
    setTimeout: ((cb: () => void, delay: number) => {
      callback = cb;
      registeredDelay = delay;
      return 1 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout,
    clearTimeout: (() => undefined) as typeof clearTimeout,
    recover: (() => controlled) as never,
  });
  try {
    const promise = runtime.recoverVenue(
      resolveVenueWarningContext(testVenueRegistry, eastVenueId),
      {
        ...config,
        delayedThresholdSeconds: 3,
      },
    );
    assert.equal(registeredDelay, 3000);
    now = '2026-09-22T00:00:03.000Z';
    callback?.();
    assert.equal(
      recoveryRows(context.retained.connection).at(-1)?.change_type,
      'database_recovery_delayed',
    );
    resolveRecovery({
      venueId: eastVenueId,
      statuses: [],
      parsedReceptionCount: 0,
      elapsedMs: 3000,
    });
    await promise;
  } finally {
    context.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('AC12: 会場別timerは独立し、失敗後のcallbackでは通知を追加せずclearされる', async () => {
  const { directory, context } = setup();
  const callbacks: Array<() => void> = [];
  let clearCount = 0;
  const runtime = createStartupNotificationRuntime(
    context,
    () => '2026-09-22T00:01:00.000Z',
    undefined,
    {
      setTimeout: ((callback: () => void) => {
        callbacks.push(callback);
        return callbacks.length as unknown as NodeJS.Timeout;
      }) as typeof setTimeout,
      clearTimeout: (() => {
        clearCount += 1;
      }) as typeof clearTimeout,
      recover: (async (_connection, venue) => {
        if (venue.venueId === eastVenueId) throw new Error('east failure');
        return { venueId: venue.venueId, statuses: [], parsedReceptionCount: 0, elapsedMs: 1 };
      }) as typeof recoverWarningCurrent,
    },
  );
  try {
    await assert.rejects(
      runtime.recoverVenue(resolveVenueWarningContext(testVenueRegistry, eastVenueId), config),
    );
    const afterFailure = recoveryRows(context.retained.connection).length;
    callbacks[0]?.();
    assert.equal(recoveryRows(context.retained.connection).length, afterFailure);
    assert.equal(clearCount, 1);
    await runtime.recoverVenue(resolveVenueWarningContext(testVenueRegistry, trcVenueId), config);
    assert.equal(clearCount, 2);
    assert.deepEqual(
      recoveryRows(context.retained.connection).map((row) => [
        row.change_type,
        JSON.parse(row.target_area_json)[0].code,
      ]),
      [
        ['database_recovery_started', eastVenueId],
        ['database_recovery_failed', eastVenueId],
        ['database_recovery_started', trcVenueId],
        ['database_recovery_completed', trcVenueId],
      ],
    );
  } finally {
    context.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test(
  'AC13: 実serverオーケストレーションで3秒後に会場別遅延通知を配信する',
  { timeout: 15000 },
  async (t) => {
    const { directory, databasePath, context } = setup();
    const state: StartupState = {};
    registerStartupCleanup(t, state, { directory, databasePath, context });
    context.close();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
      state.release = resolve;
    });
    const schedule = createTestPollingSchedule();
    captureStartingServer(
      t,
      {
        ...createTestServerDatabaseOptions({ databasePath, migrationsDirectory }),
        port: 0,
        enablePolling: false,
        pollingSchedule: {
          ...schedule,
          startupRecovery: { ...schedule.startupRecovery, delayedThresholdSeconds: 3 },
        },
        recoveryInternals: {
          recover: async (_connection, venue) => {
            if (venue.venueId === eastVenueId) await gate;
            return {
              venueId: venue.venueId,
              statuses: [],
              parsedReceptionCount: 0,
              elapsedMs: 3000,
            };
          },
        },
      },
      state,
    );
    const port = await waitForAssignedPort(state.httpServer!, state.outcome!);
    const starting = state.starting!;

    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break;
      } catch {
        // 待受開始まで再試行する。
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setTimeout(resolve, 3100));
    const delta = (await (
      await fetch(
        `http://127.0.0.1:${port}/api/notifications/delta?origin=system&terminalId=hkeagh01`,
      )
    ).json()) as { notifications: Array<{ changeType: string }> };
    assert.deepEqual(
      delta.notifications.map((item) => item.changeType),
      ['database_recovery_started', 'database_recovery_delayed'],
    );
    release();
    await starting;
  },
);

test('AC10/§3.1: 開始状態・開始通知の後に未処理再処理を行い、その後に現況復旧する', async () => {
  const { directory, context } = setup();
  const events: string[] = [];
  const runtime = createStartupNotificationRuntime(
    context,
    () => '2026-09-22T00:00:00.000Z',
    undefined,
    {
      recover: (async (_connection, venue) => {
        events.push('recover');
        return { venueId: venue.venueId, statuses: [], parsedReceptionCount: 0, elapsedMs: 1 };
      }) as typeof recoverWarningCurrent,
    },
  );
  try {
    await runtime.recoverVenue(
      resolveVenueWarningContext(testVenueRegistry, eastVenueId),
      config,
      async () => {
        assert.equal(
          runtime.recoveryTracker.getStatus(eastVenueId, '2026-09-22T00:00:00.001Z').status,
          'running',
        );
        assert.deepEqual(
          recoveryRows(context.retained.connection).map((row) => row.change_type),
          ['database_recovery_started'],
        );
        events.push('reprocess');
      },
    );
    assert.deepEqual(events, ['reprocess', 'recover']);
  } finally {
    context.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('AC15: 不正設定・DB open失敗・migration失敗はいずれも待受前で通知を試みない', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'database-recovery-prelisten-'));
  try {
    const invalidConfigDb = join(directory, 'invalid-config.sqlite3');
    const schedule = createTestPollingSchedule();
    await assert.rejects(
      startServer({
        ...createTestServerDatabaseOptions({ databasePath: invalidConfigDb, migrationsDirectory }),
        port: 0,
        pollingSchedule: {
          ...schedule,
          startupRecovery: { ...schedule.startupRecovery, delayedThresholdSeconds: 0 },
        },
      }),
      /delayedThresholdSeconds/,
    );
    assert.equal(existsSync(invalidConfigDb), false, '設定失敗ではDBも作らない');

    await assert.rejects(
      startServer({
        ...createTestServerDatabaseOptions({ databasePath: directory, migrationsDirectory }),
        port: 0,
        pollingSchedule: createTestPollingSchedule(),
      }),
    );

    const brokenMigrations = join(directory, 'migrations');
    cpSync(migrationsDirectory, brokenMigrations, { recursive: true });
    writeFileSync(join(brokenMigrations, 'weather', '0025_broken.sql'), 'CREATE TABLE broken (');
    const migrationDb = join(directory, 'migration.sqlite3');
    await assert.rejects(
      startServer({
        ...createTestServerDatabaseOptions({
          databasePath: migrationDb,
          migrationsDirectory: brokenMigrations,
        }),
        port: 0,
        pollingSchedule: createTestPollingSchedule(),
      }),
    );
    const migrated = initializeTestDatabases({
      databasePath: migrationDb,
      migrationsDirectory,
    });
    try {
      assert.deepEqual(recoveryRows(migrated.retained.connection), []);
    } finally {
      migrated.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test(
  'AC10/11/15: 復旧中の監視APIと会場別deltaを実経路で取得できる',
  { timeout: 15000 },
  async (t) => {
    const { directory, databasePath, context } = setup();
    const state: StartupState = {};
    registerStartupCleanup(t, state, { directory, databasePath, context });
    context.close();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
      state.release = resolve;
    });
    captureStartingServer(
      t,
      {
        ...createTestServerDatabaseOptions({ databasePath, migrationsDirectory }),
        port: 0,
        enablePolling: false,
        pollingSchedule: createTestPollingSchedule(),
        recoveryInternals: {
          recover: async (_connection, venue) => {
            if (venue.venueId === eastVenueId) await gate;
            return {
              venueId: venue.venueId,
              statuses: [
                {
                  controlStatus: 'normal' as const,
                  outcome: 'reused' as const,
                  parsedReceptionCount: 2,
                  selectedReceptionIds: [],
                },
                {
                  controlStatus: 'training' as const,
                  outcome: 'rebuilt' as const,
                  parsedReceptionCount: 3,
                  selectedReceptionIds: [],
                },
                {
                  controlStatus: 'test' as const,
                  outcome: 'uninitialized' as const,
                  parsedReceptionCount: 0,
                  selectedReceptionIds: [],
                },
              ],
              parsedReceptionCount: 5,
              elapsedMs: 1,
            };
          },
        },
      },
      state,
    );
    const port = await waitForAssignedPort(state.httpServer!, state.outcome!);
    const starting = state.starting!;

    let healthOk = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        healthOk = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok;
        if (healthOk) break;
      } catch {
        // HTTP待受開始まで再試行する。
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(healthOk, true);
    const monitoring = await fetch(
      `http://127.0.0.1:${port}/api/monitoring/status?terminalId=hkeagh01`,
    );
    assert.equal(monitoring.status, 200);
    const monitoringBody = (await monitoring.json()) as {
      venues: Array<{
        venueId: string;
        recovery: {
          status: string;
          startedAt: string | null;
          finishedAt: string | null;
          delayedAt: string | null;
          elapsedMs: number | null;
          currentControlStatus: string | null;
          completedControlStatuses: string[];
          reusedControlStatuses: string[];
          rebuiltControlStatuses: string[];
          parsedReceptionCount: number;
          errorCode: string | null;
        };
      }>;
    };
    const running = monitoringBody.venues.find((venue) => venue.venueId === eastVenueId)!.recovery;
    assert.equal(running.status, 'running');
    assert.ok(running.startedAt);
    assert.equal(running.finishedAt, null);
    assert.equal(running.delayedAt, null);
    assert.ok(running.elapsedMs !== null && running.elapsedMs >= 0);
    assert.equal(running.currentControlStatus, null);
    assert.deepEqual(running.completedControlStatuses, []);
    assert.deepEqual(running.reusedControlStatuses, []);
    assert.deepEqual(running.rebuiltControlStatuses, []);
    assert.equal(running.parsedReceptionCount, 0);
    assert.equal(running.errorCode, null);
    const eastDelta = (await (
      await fetch(
        `http://127.0.0.1:${port}/api/notifications/delta?origin=system&terminalId=hkeagh01`,
      )
    ).json()) as { notifications: Array<{ changeType: string }> };
    assert.deepEqual(
      eastDelta.notifications.map((item) => item.changeType),
      ['database_recovery_started'],
    );
    const trcDelta = (await (
      await fetch(
        `http://127.0.0.1:${port}/api/notifications/delta?origin=system&terminalId=htrcph01`,
      )
    ).json()) as { notifications: Array<{ changeType: string }> };
    assert.deepEqual(trcDelta.notifications, []);
    release();
    await starting;
    const completedResponse = await fetch(
      `http://127.0.0.1:${port}/api/monitoring/status?terminalId=hkeagh01`,
    );
    const completedBody = (await completedResponse.json()) as typeof monitoringBody;
    const completed = completedBody.venues.find((venue) => venue.venueId === eastVenueId)!.recovery;
    assert.equal(completed.status, 'completed');
    assert.ok(completed.startedAt);
    assert.ok(completed.finishedAt);
    assert.equal(completed.delayedAt, null);
    assert.ok(completed.elapsedMs !== null && completed.elapsedMs >= 0);
    assert.equal(completed.currentControlStatus, null);
    assert.deepEqual(completed.completedControlStatuses, ['normal', 'training', 'test']);
    assert.deepEqual(completed.reusedControlStatuses, ['normal']);
    assert.deepEqual(completed.rebuiltControlStatuses, ['training']);
    assert.equal(completed.parsedReceptionCount, 5);
    assert.equal(completed.errorCode, null);
    for (const [terminalId, expectedVenue] of [
      ['hkeagh01', eastVenueId],
      ['htrcph01', trcVenueId],
    ] as const) {
      const delta = (await (
        await fetch(
          `http://127.0.0.1:${port}/api/notifications/delta?origin=system&terminalId=${terminalId}`,
        )
      ).json()) as {
        notifications: Array<{ changeType: string; targets: Array<{ code: string }> }>;
      };
      assert.deepEqual(
        delta.notifications.map((item) => [item.changeType, item.targets[0]?.code]),
        [
          ['database_recovery_started', expectedVenue],
          ['database_recovery_completed', expectedVenue],
        ],
      );
    }
  },
);

for (const stage of ['validation', 'candidate', 'parse-reduce', 'commit'] as const) {
  test(`AC14: ${stage}段階の失敗は会場別questionを1件記録してfailedになる`, async () => {
    const { directory, context } = setup();
    const runtime = createStartupNotificationRuntime(
      context,
      () => '2026-09-22T00:00:00.000Z',
      undefined,
      {
        recover: (async () => {
          throw new Error(`simulated ${stage} failure`);
        }) as never,
      },
    );
    try {
      await assert.rejects(
        runtime.recoverVenue(resolveVenueWarningContext(testVenueRegistry, trcVenueId), config),
        new RegExp(stage),
      );
      const failedStatus = runtime.recoveryTracker.getStatus(
        trcVenueId,
        '2026-09-22T00:00:01.000Z',
      );
      assert.equal(failedStatus.status, 'failed');
      assert.ok(failedStatus.startedAt);
      assert.ok(failedStatus.finishedAt);
      assert.equal(failedStatus.delayedAt, null);
      assert.ok(failedStatus.elapsedMs !== null && failedStatus.elapsedMs >= 0);
      assert.equal(failedStatus.currentControlStatus, null);
      assert.deepEqual(failedStatus.completedControlStatuses, []);
      assert.deepEqual(failedStatus.reusedControlStatuses, []);
      assert.deepEqual(failedStatus.rebuiltControlStatuses, []);
      assert.equal(failedStatus.parsedReceptionCount, 0);
      assert.equal(failedStatus.errorCode, 'warning_current_recovery_failed');
      const rows = recoveryRows(context.retained.connection);
      assert.deepEqual(
        rows.map((row) => [row.category, row.change_type, row.ack_required]),
        [
          ['warning', 'database_recovery_started', 0],
          ['question', 'database_recovery_failed', 1],
        ],
      );
    } finally {
      context.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('AC16: 失敗通知はcommit後のDB再オープンでも会場別questionとして配送可能', async () => {
  const { directory, databasePath, context } = setup();
  const runtime = createStartupNotificationRuntime(
    context,
    () => '2026-09-22T00:00:00.000Z',
    undefined,
    {
      recover: (async () => {
        throw new Error('persistent failure');
      }) as never,
    },
  );
  await assert.rejects(
    runtime.recoverVenue(resolveVenueWarningContext(testVenueRegistry, trcVenueId), config),
  );
  const startedCursor = recoveryRows(context.retained.connection).find(
    (row) => row.change_type === 'database_recovery_started',
  )!.id;
  context.close();
  const reopened = initializeTestDatabases({ databasePath, migrationsDirectory });
  try {
    const failed = recoveryRows(reopened.retained.connection).find(
      (row) => row.change_type === 'database_recovery_failed',
    );
    assert.ok(failed);
    assert.equal(failed.category, 'question');
    assert.equal(failed.ack_required, 1);
    assert.equal(JSON.parse(failed.target_area_json)[0].code, trcVenueId);
    assert.equal(failed.message_definition_id, 'system-database-initialization-failed');
    const delta = createNotificationDeltaService({
      serverStartCursor: toNotificationDeltaCursor(0),
      initialization: new StartupNotificationInitialization(),
      venueRegistry: testVenueRegistry,
      connection: reopened.retained.connection,
      serverGenerationId: 'reopened-generation',
    }).query({
      origin: 'system',
      serverGenerationId: 'reopened-generation',
      terminalId: 'htrcph01',
      venueId: trcVenueId,
      cursor: toNotificationDeltaCursor(startedCursor),
      requestedAt: '2026-09-22T00:00:01.000Z',
    });
    assert.equal(delta.status, 'ready');
    if (delta.status !== 'ready') assert.fail('delta must be ready');
    assert.deepEqual(
      delta.notifications.map((item) => [item.changeType, item.output.ackRequired]),
      [['database_recovery_failed', true]],
    );
    const notification: SystemNotification = {
      notificationId: failed.notification_id,
      category: 'question',
      origin: 'system',
      changeType: 'database_recovery_failed',
      sourceType: 'database_recovery',
      sourceVersion: failed.source_version,
      targets: JSON.parse(failed.target_area_json),
      occurredAt: '2026-09-22T00:00:00.000Z',
      detectedAt: '2026-09-22T00:00:00.000Z',
      relatedRefs: [],
      detectionContext: 'initial',
      isTraining: false,
    };
    assert.deepEqual(
      resolveNotificationMessage(notification, {
        definitionId: 'system-database-initialization-failed',
      }).action,
      { kind: 'acknowledge', label: '確認' },
    );
  } finally {
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('差し戻し1: 開始通知の記録失敗でもfailed化し、失敗通知を試行して専用ログを残す', async () => {
  const { directory, context } = setup();
  context.retained.connection
    .exec(`CREATE TRIGGER reject_recovery_notifications BEFORE INSERT ON notification_output_history
    WHEN NEW.source_type = 'database_recovery' BEGIN SELECT RAISE(ABORT, 'simulated notification failure'); END;`);
  const runtime = createStartupNotificationRuntime(context, () => '2026-09-22T00:00:00.000Z');
  const logs: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args);
  };
  try {
    await assert.rejects(
      runtime.recoverVenue(resolveVenueWarningContext(testVenueRegistry, eastVenueId), config),
      /simulated notification failure/,
    );
    assert.equal(
      runtime.recoveryTracker.getStatus(eastVenueId, '2026-09-22T00:00:01.000Z').status,
      'failed',
    );
    assert.equal(
      logs.some((args) => String(args[0]).includes('DB復旧または状態通知に失敗')),
      true,
    );
    assert.equal(
      logs.some((args) => String(args[0]).includes('DB復旧失敗通知の記録に失敗')),
      true,
    );
  } finally {
    console.error = original;
    context.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const [jstTime, fixedNow] of [
  ['12:00', '2026-09-22T03:00:00.000Z'],
  ['22:00', '2026-09-22T13:00:00.000Z'],
] as const) {
  test(`AC17/18: 全会場復旧完了まで上流取得を開始せず、ポーリング無効でも復旧通知を記録する（JST ${jstTime}）`, async (t) => {
    const { directory, databasePath, context } = setup();
    context.close();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fetchCount = 0;
    const dummyAdapter = (source: 'nowcast' | 'kikikuru' | 'amedas') => ({
      source,
      runScheduled: async () => {},
      runManual: async () => {},
    });
    const originalFetch = globalThis.fetch;
    let unintendedFetchCount = 0;
    globalThis.fetch = async () => {
      unintendedFetchCount += 1;
      throw new Error('AC17/18の対象外アダプターはHTTP取得してはならない');
    };
    const startup: { promise?: ReturnType<typeof startServer> } = {};
    t.after(async () => {
      try {
        release();
        await startup.promise?.then((server) => server.close()).catch(() => undefined);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
    const waitingVenues = new Set<string>();
    const alwaysOnSchedule = createAlwaysOnTestPollingSchedule();
    const starting = startServer({
      ...createTestServerDatabaseOptions({ databasePath, migrationsDirectory }),
      port: 0,
      enablePolling: true,
      pollingSchedule: alwaysOnSchedule,
      pollingServiceOptions: {
        clock: () => fixedNow,
        fetchFn: async () => {
          fetchCount += 1;
          return new Response(
            '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>',
          );
        },
      },
      schedulerOptions: {
        now: () => new Date(fixedNow),
        adapters: [dummyAdapter('nowcast'), dummyAdapter('kikikuru'), dummyAdapter('amedas')],
      },
      recoveryInternals: {
        recover: async (
          _connection: Parameters<typeof recoverWarningCurrent>[0],
          venue: Parameters<typeof recoverWarningCurrent>[1],
        ) => {
          waitingVenues.add(venue.venueId);
          await gate;
          return { venueId: venue.venueId, statuses: [], parsedReceptionCount: 0, elapsedMs: 1 };
        },
      },
    });
    startup.promise = starting;
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    // server.ts の起動時復旧は会場レジストリを for...of で逐次 await するため、
    // 会場は同時にではなく1つずつ recover を呼び出す(2会場が同時にゲート待機することはない)。
    // 先頭会場が recover ゲートで待機した時点で、ループは次の会場へ進めず、
    // 全会場のrecoverVenue完了を待つ evaluateVenues / 初期取得開始にも到達できないため、
    // 「全会場復旧完了まで上流取得を開始しない」検証としてはこれで十分である。
    await waitUntil(() => waitingVenues.size >= 1, 5000, '会場がrecoverゲートで待機する');
    assert.equal(fetchCount, 0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(fetchCount, 0);
    release();
    const server = await starting;
    await waitUntil(() => fetchCount > 0, 5000, '全会場復旧完了後に上流取得が開始する');
    await server.close();
    assert.equal(unintendedFetchCount, 0, '対象外アダプターがHTTP取得を試みないこと');

    const disabledDb = join(directory, 'disabled.sqlite3');
    const disabledResult = await execFileAsync(
      process.execPath,
      [
        '--import',
        import.meta.resolve('tsx'),
        '--input-type=module',
        '--eval',
        `import { startServer } from ${JSON.stringify(new URL('../src/server.ts', import.meta.url).href)};
       import { createTestPollingSchedule } from ${JSON.stringify(new URL('./helpers/pollingSchedule.ts', import.meta.url).href)};
       const server = await startServer({ ${JSON.stringify(createTestServerDatabaseOptions({ databasePath: disabledDb, migrationsDirectory })).slice(1, -1)}, port: 0, pollingSchedule: createTestPollingSchedule() });
       const status = await (await fetch('http://127.0.0.1:' + server.port + '/api/monitoring/status?terminalId=hkeagh01')).json();
       console.log('RECOVERY_STATUS:' + JSON.stringify(status.venues.map((venue) => [venue.venueId, venue.recovery.status])));
       await server.close();`,
      ],
      {
        cwd: directory,
        env: {
          ...createTestServerProcessEnv({ databasePath: disabledDb, migrationsDirectory }),
          DISABLE_POLLING: 'true',
        },
      },
    );
    const statusLine = disabledResult.stdout
      .split('\n')
      .find((line) => line.startsWith('RECOVERY_STATUS:'));
    assert.ok(statusLine);
    assert.deepEqual(JSON.parse(statusLine.slice('RECOVERY_STATUS:'.length)), [
      [eastVenueId, 'completed'],
      [trcVenueId, 'completed'],
    ]);
    const reopened = initializeTestDatabases({ databasePath: disabledDb, migrationsDirectory });
    try {
      assert.deepEqual(
        recoveryRows(reopened.retained.connection).map((row) => row.change_type),
        [
          'database_recovery_started',
          'database_recovery_completed',
          'database_recovery_started',
          'database_recovery_completed',
        ],
      );
    } finally {
      reopened.close();
    }
  });
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  test(`AC18: ${signal}を復旧中に受けてもfailed状態・失敗通知を作らずtimerをclearする`, async () => {
    const { directory, databasePath, context } = setup();
    context.close();
    const signalSource = new RecoverySignalSource();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let clearCount = 0;
    const starting = startServer({
      ...createTestServerDatabaseOptions({ databasePath, migrationsDirectory }),
      port: 0,
      enablePolling: false,
      pollingSchedule: createTestPollingSchedule(),
      shutdownSignalSource: signalSource,
      recoveryInternals: {
        setTimeout: (() => 1 as unknown as NodeJS.Timeout) as unknown as typeof setTimeout,
        clearTimeout: (() => {
          clearCount += 1;
        }) as typeof clearTimeout,
        recover: async (_connection, venue) => {
          if (venue.venueId === eastVenueId) await gate;
          return { venueId: venue.venueId, statuses: [], parsedReceptionCount: 0, elapsedMs: 1 };
        },
      },
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      signalSource.trigger(signal);
      release();
      const server = await starting;
      await new Promise((resolve) => setTimeout(resolve, 30));
      await server.close().catch(() => undefined);
      assert.equal(clearCount, 2, '両会場の遅延timerをclearする');
      const reopened = initializeTestDatabases({ databasePath, migrationsDirectory });
      try {
        const rows = recoveryRows(reopened.retained.connection);
        assert.equal(
          rows.some((row) => row.change_type === 'database_recovery_failed'),
          false,
        );
        assert.deepEqual(
          rows.map((row) => row.change_type),
          [
            'database_recovery_started',
            'database_recovery_completed',
            'database_recovery_started',
            'database_recovery_completed',
          ],
        );
      } finally {
        reopened.close();
      }
    } finally {
      release();
      await starting.then((server) => server.close()).catch(() => undefined);
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
