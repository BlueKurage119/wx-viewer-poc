import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { initializeDatabase } from '../src/database/index.js';
import { createStartupNotificationRuntime, startServer } from '../src/server.js';
import { resolveVenueWarningContext } from '../src/venueForecastTargets.js';
import { recoverWarningCurrent } from '../src/polling/jmaWarningCurrentProcessor.js';

const migrationsDirectory = join(fileURLToPath(import.meta.url), '../../migrations');
const config = {
  delayedThresholdSeconds: 60,
  yieldEveryParsedReceptions: 25,
  candidatePageSize: 100,
};
const execFileAsync = promisify(execFile);

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'database-recovery-orchestration-'));
  const databasePath = join(directory, 'db.sqlite3');
  const context = initializeDatabase({ databasePath, migrationsDirectory });
  return { directory, databasePath, context };
}

interface RecoveryRow {
  readonly notification_id: string;
  readonly category: string;
  readonly change_type: string;
  readonly ack_required: number;
  readonly source_type: string;
  readonly source_version: string;
  readonly target_area_json: string;
}

function recoveryRows(
  connection: ReturnType<typeof initializeDatabase>['connection'],
): RecoveryRow[] {
  return connection
    .prepare(
      `SELECT notification_id, category, change_type, ack_required,
    source_type, source_version, target_area_json FROM notification_output_history
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
  const runtime = createStartupNotificationRuntime(context.connection, () => now, undefined, {
    setTimeout: ((cb: () => void) => {
      callback = cb;
      return 1 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout,
    clearTimeout: (() => undefined) as typeof clearTimeout,
    recover: (() => controlled) as never,
  });
  try {
    const promise = runtime.recoverVenue(resolveVenueWarningContext('east'), config);
    now = '2026-09-22T00:00:59.999Z';
    callback?.();
    assert.equal(recoveryRows(context.connection).length, 1);
    now = '2026-09-22T00:01:00.000Z';
    callback?.();
    callback?.();
    assert.equal(recoveryRows(context.connection).length, 2);
    resolveRecovery({ venueId: 'east', statuses: [], parsedReceptionCount: 0, elapsedMs: 60000 });
    await promise;
    callback?.();
    assert.deepEqual(
      recoveryRows(context.connection).map((row) => row.change_type),
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
  const runtime = createStartupNotificationRuntime(context.connection, () => now, undefined, {
    setTimeout: ((cb: () => void, delay: number) => {
      callback = cb;
      registeredDelay = delay;
      return 1 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout,
    clearTimeout: (() => undefined) as typeof clearTimeout,
    recover: (() => controlled) as never,
  });
  try {
    const promise = runtime.recoverVenue(resolveVenueWarningContext('east'), {
      ...config,
      delayedThresholdSeconds: 3,
    });
    assert.equal(registeredDelay, 3000);
    now = '2026-09-22T00:00:03.000Z';
    callback?.();
    assert.equal(recoveryRows(context.connection).at(-1)?.change_type, 'database_recovery_delayed');
    resolveRecovery({ venueId: 'east', statuses: [], parsedReceptionCount: 0, elapsedMs: 3000 });
    await promise;
  } finally {
    context.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('AC10/§3.1: 開始状態・開始通知の後に未処理再処理を行い、その後に現況復旧する', async () => {
  const { directory, context } = setup();
  const events: string[] = [];
  const runtime = createStartupNotificationRuntime(
    context.connection,
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
    await runtime.recoverVenue(resolveVenueWarningContext('east'), config, async () => {
      assert.equal(
        runtime.recoveryTracker.getStatus('east', '2026-09-22T00:00:00.001Z').status,
        'running',
      );
      assert.deepEqual(
        recoveryRows(context.connection).map((row) => row.change_type),
        ['database_recovery_started'],
      );
      events.push('reprocess');
    });
    assert.deepEqual(events, ['reprocess', 'recover']);
  } finally {
    context.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('AC10/11/15: 復旧中の監視APIと会場別deltaを実経路で取得できる', async () => {
  const { directory, databasePath, context } = setup();
  context.close();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const port = 34000 + Math.floor(Math.random() * 1000);
  const starting = startServer({
    config: { databasePath, migrationsDirectory },
    port,
    enablePolling: false,
    recoveryInternals: {
      recover: async (_connection, venue) => {
        if (venue.venueId === 'east') await gate;
        return { venueId: venue.venueId, statuses: [], parsedReceptionCount: 0, elapsedMs: 1 };
      },
    },
  });
  try {
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
      venues: Array<{ venueId: string; recovery: { status: string } }>;
    };
    assert.equal(
      monitoringBody.venues.find((venue) => venue.venueId === 'east')?.recovery.status,
      'running',
    );
    const eastDelta = (await (
      await fetch(`http://127.0.0.1:${port}/api/notifications/delta?terminalId=hkeagh01&cursor=0`)
    ).json()) as { notifications: Array<{ changeType: string }> };
    assert.deepEqual(
      eastDelta.notifications.map((item) => item.changeType),
      ['database_recovery_started'],
    );
    const trcDelta = (await (
      await fetch(`http://127.0.0.1:${port}/api/notifications/delta?terminalId=htrcph01&cursor=0`)
    ).json()) as { notifications: Array<{ changeType: string }> };
    assert.deepEqual(trcDelta.notifications, []);
    release();
    const server = await starting;
    await server.close();
  } finally {
    release();
    await starting.then((server) => server.close()).catch(() => undefined);
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const stage of ['validation', 'candidate', 'parse-reduce', 'commit'] as const) {
  test(`AC14: ${stage}段階の失敗は会場別questionを1件記録してfailedになる`, async () => {
    const { directory, context } = setup();
    const runtime = createStartupNotificationRuntime(
      context.connection,
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
        runtime.recoverVenue(resolveVenueWarningContext('trc'), config),
        new RegExp(stage),
      );
      assert.equal(
        runtime.recoveryTracker.getStatus('trc', '2026-09-22T00:00:01.000Z').status,
        'failed',
      );
      const rows = recoveryRows(context.connection);
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
    context.connection,
    () => '2026-09-22T00:00:00.000Z',
    undefined,
    {
      recover: (async () => {
        throw new Error('persistent failure');
      }) as never,
    },
  );
  await assert.rejects(runtime.recoverVenue(resolveVenueWarningContext('trc'), config));
  context.close();
  const reopened = initializeDatabase({ databasePath, migrationsDirectory });
  try {
    const failed = recoveryRows(reopened.connection).find(
      (row) => row.change_type === 'database_recovery_failed',
    );
    assert.ok(failed);
    assert.equal(failed.category, 'question');
    assert.equal(failed.ack_required, 1);
    assert.equal(JSON.parse(failed.target_area_json)[0].code, 'trc');
  } finally {
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('差し戻し1: 開始通知の記録失敗でもfailed化し、失敗通知を試行して専用ログを残す', async () => {
  const { directory, context } = setup();
  context.connection
    .exec(`CREATE TRIGGER reject_recovery_notifications BEFORE INSERT ON notification_output_history
    WHEN NEW.source_type = 'database_recovery' BEGIN SELECT RAISE(ABORT, 'simulated notification failure'); END;`);
  const runtime = createStartupNotificationRuntime(
    context.connection,
    () => '2026-09-22T00:00:00.000Z',
  );
  const logs: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args);
  };
  try {
    await assert.rejects(
      runtime.recoverVenue(resolveVenueWarningContext('east'), config),
      /simulated notification failure/,
    );
    assert.equal(
      runtime.recoveryTracker.getStatus('east', '2026-09-22T00:00:01.000Z').status,
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

test('AC17/18: 全会場復旧完了まで上流取得を開始せず、ポーリング無効でも復旧通知を記録する', async () => {
  const { directory, databasePath, context } = setup();
  context.close();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fetchCount = 0;
  const port = 33000 + Math.floor(Math.random() * 1000);
  const starting = startServer({
    config: { databasePath, migrationsDirectory },
    port,
    enablePolling: true,
    pollingServiceOptions: {
      fetchFn: async () => {
        fetchCount += 1;
        return new Response(
          '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>',
        );
      },
    },
    recoveryInternals: {
      recover: async (
        _connection: Parameters<typeof recoverWarningCurrent>[0],
        venue: Parameters<typeof recoverWarningCurrent>[1],
      ) => {
        await gate;
        return { venueId: venue.venueId, statuses: [], parsedReceptionCount: 0, elapsedMs: 1 };
      },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(fetchCount, 0);
  release();
  const server = await starting;
  assert.ok(fetchCount > 0);
  await server.close();

  const disabledDb = join(directory, 'disabled.sqlite3');
  const apiDirectory = join(fileURLToPath(import.meta.url), '../..');
  await execFileAsync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      `import { startServer } from './src/server.ts';
       const server = await startServer({ config: ${JSON.stringify({ databasePath: disabledDb, migrationsDirectory })}, port: 0 });
       await server.close();`,
    ],
    { cwd: apiDirectory, env: { ...process.env, DISABLE_POLLING: 'true' } },
  );
  const reopened = initializeDatabase({ databasePath: disabledDb, migrationsDirectory });
  try {
    assert.deepEqual(
      recoveryRows(reopened.connection).map((row) => row.change_type),
      [
        'database_recovery_started',
        'database_recovery_completed',
        'database_recovery_started',
        'database_recovery_completed',
      ],
    );
  } finally {
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
