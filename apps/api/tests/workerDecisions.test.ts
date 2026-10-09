import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../src/database/index.js';
import { WeatherDecisionState } from '../src/runtime/weatherDecisionState.js';
import type { WeatherUpdateUnit } from '../src/runtime/weatherDecisionState.js';
import { RetainedNotificationSink } from '../src/runtime/retainedNotificationSink.js';
import { WeatherTransport } from '../src/runtime/weatherTransport.js';
import type { DecisionBatch, WeatherEpoch } from '../src/runtime/weatherContracts.js';
import type { FetchHealthNotificationEmitResult } from '../src/notifications/fetchHealthNotificationEmitter.js';

const initialHealth = {
  previousStatusBySource: {
    xml_regular: null,
    xml_extra: null,
    nowcast_target_times: null,
    kikikuru_target_times: null,
    amedas_latest_time: null,
    amedas_point: null,
  },
  activeSinceAtBySource: {
    xml_regular: null,
    xml_extra: null,
    nowcast_target_times: null,
    kikikuru_target_times: null,
    amedas_latest_time: null,
    amedas_point: null,
  },
};
const firstEpoch: WeatherEpoch = {
  serverGenerationId: 'same-server',
  workerGeneration: 'worker-first',
  weatherDatabaseGenerationId: 'same-weather-db',
  readerEpoch: null,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'wx-worker-decisions-'));
  const weatherPath = join(directory, 'weather.sqlite');
  const weather = new Database(weatherPath);
  weather.exec('CREATE TABLE fixture_commit (id INTEGER PRIMARY KEY, target TEXT NOT NULL)');
  weather.close();
  const retained = initializeDatabase({
    databasePath: join(directory, 'retained.sqlite'),
    migrationsDirectory: join(import.meta.dirname, '../migrations/retained'),
  });
  const state = new WeatherDecisionState(firstEpoch);
  const sink = new RetainedNotificationSink(retained.connection, state);
  const workers = new Set<{ worker: Worker; transport: WeatherTransport; release: () => void }>();
  function commits() {
    const reader = new Database(weatherPath, { readonly: true });
    try {
      return (
        reader.prepare('SELECT target FROM fixture_commit ORDER BY id').all() as {
          target: string;
        }[]
      ).map((row) => row.target);
    } finally {
      reader.close();
    }
  }
  function saved() {
    return retained.connection
      .prepare(
        'SELECT notification_id, source_type, change_type FROM notification_output_history ORDER BY id',
      )
      .all() as { notification_id: string; source_type: string; change_type: string }[];
  }
  async function start(epoch: WeatherEpoch, stage: string | null = null) {
    const ready = deferred<void>();
    const reached = deferred<string>();
    const hold = deferred<void>();
    const worker = new Worker(
      new URL('./fixtures/acquisition-worker/decisions-fixture.mjs', import.meta.url),
      { execArgv: [], workerData: { weatherPath, epoch, stage, checkpoint: state.snapshot() } },
    );
    const transport = new WeatherTransport(
      worker,
      epoch.workerGeneration,
      async (method, value) => {
        if (method === 'fixture.ready') {
          ready.resolve();
          return null;
        }
        if (method === 'fixture.latch') {
          reached.resolve((value as { stage: string }).stage);
          return null;
        }
        if (method === 'update.begin') {
          state.begin(value as WeatherUpdateUnit);
          return null;
        }
        if (method === 'decision.batch') {
          const result = sink.receive(value as DecisionBatch);
          if (stage === 'after_received') {
            reached.resolve(stage);
            await hold.promise;
          }
          return result;
        }
        if (method === 'update.complete') {
          state.complete((value as { unitId: string }).unitId);
          return null;
        }
        throw new Error('invalid_request');
      },
      () => {},
    );
    const entry = { worker, transport, release: () => hold.resolve() };
    workers.add(entry);
    await Promise.race([
      ready.promise,
      new Promise<never>((_, reject) => {
        worker.once('error', reject);
      }),
    ]);
    return {
      transport,
      reached: reached.promise,
      async terminate() {
        await worker.terminate();
        transport.close();
        hold.resolve();
        workers.delete(entry);
      },
    };
  }
  return {
    state,
    start,
    commits,
    saved,
    retained,
    async close() {
      for (const entry of workers) {
        await entry.worker.terminate();
        entry.transport.close();
        entry.release();
      }
      retained.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

for (const [stage, commitCount, savedCount, revision, keys, collecting, unknown] of [
  ['before_begin', 0, 0, 0, [], true, []],
  ['after_begin', 0, 0, 1, ['east|normal'], true, ['east']],
  ['after_commit', 1, 0, 1, ['east|normal'], true, ['east']],
  ['after_received', 1, 2, 1, ['east|normal'], false, []],
  ['after_ack', 1, 2, 1, ['east|normal'], false, []],
  ['after_complete', 1, 2, 1, ['east|normal'], false, []],
] as const) {
  test(
    `実Worker終了窓 ${stage}: checkpoint・保存数・scopeを引継ぎ対象外会場は通常初回判定`,
    { timeout: 8_000 },
    async () => {
      const fixture = setup();
      try {
        const first = await fixture.start(firstEpoch, stage);
        const command = first.transport.call('fixture.run', { target: 'east' }).catch(() => null);
        assert.equal(await first.reached, stage);
        await first.terminate();
        await command;
        const nextEpoch = { ...firstEpoch, workerGeneration: 'worker-next' };
        fixture.state.replaceEpoch(nextEpoch);
        assert.deepEqual(
          fixture.commits(),
          Array.from({ length: commitCount }, () => 'east'),
        );
        assert.equal(fixture.saved().length, savedCount);
        assert.deepEqual(fixture.state.snapshot(), {
          revision,
          warningDoneKeys: keys,
          bosaiCompletedKeys: keys,
          bosaiCollecting: collecting,
          fetchHealth: initialHealth,
        });
        assert.deepEqual(
          fixture.state.getUnknownUnits().flatMap((unit) => unit.scopes),
          unknown,
        );
        assert.equal(fixture.state.pendingUnit, null);
        const next = await fixture.start(nextEpoch);
        assert.deepEqual(
          await next.transport.call('fixture.run', { target: 'east' }),
          stage === 'before_begin' ? ['warning', 'bosai'] : [],
        );
        assert.deepEqual(await next.transport.call('fixture.run', { target: 'trc' }), [
          'warning',
          'bosai',
        ]);
        assert.equal(fixture.saved().length, savedCount + (stage === 'before_begin' ? 4 : 2));
        assert.deepEqual(
          fixture
            .saved()
            .slice(-2)
            .map((row) => row.notification_id),
          ['worker-next-trc-warning', 'worker-next-trc-bosai'],
        );
      } finally {
        await fixture.close();
      }
    },
  );
}

test('実Workerの候補保存失敗後ACK喪失でも初回通知を補完せず、新会場だけを判定する', async () => {
  const fixture = setup();
  try {
    fixture.retained.connection.exec(
      "CREATE TRIGGER fail_notification BEFORE INSERT ON notification_output_history BEGIN SELECT RAISE(FAIL, '試験'); END",
    );
    const first = await fixture.start(firstEpoch, 'after_received');
    const command = first.transport.call('fixture.run', { target: 'east' }).catch(() => null);
    await first.reached;
    await first.terminate();
    await command;
    fixture.retained.connection.exec('DROP TRIGGER fail_notification');
    const nextEpoch = { ...firstEpoch, workerGeneration: 'worker-next' };
    fixture.state.replaceEpoch(nextEpoch);
    assert.deepEqual(fixture.saved(), []);
    assert.deepEqual(fixture.state.snapshot(), {
      revision: 1,
      warningDoneKeys: ['east|normal'],
      bosaiCompletedKeys: ['east|normal'],
      bosaiCollecting: false,
      fetchHealth: initialHealth,
    });
    assert.deepEqual(fixture.state.getUnknownUnits(), []);
    const next = await fixture.start(nextEpoch);
    assert.deepEqual(await next.transport.call('fixture.run', { target: 'east' }), []);
    assert.deepEqual(await next.transport.call('fixture.run', { target: 'trc' }), [
      'warning',
      'bosai',
    ]);
    assert.deepEqual(
      fixture.saved().map((row) => row.notification_id),
      ['worker-next-trc-warning', 'worker-next-trc-bosai'],
    );
  } finally {
    await fixture.close();
  }
});

test('実Worker再開で健全性の同じ異常を再通知せず、回復と次の異常は通常通知する', async () => {
  const fixture = setup();
  try {
    const first = await fixture.start(firstEpoch);
    const initial = await first.transport.call<FetchHealthNotificationEmitResult>(
      'fixture.health',
      { status: 'delayed' },
    );
    assert.equal(initial.recorded.length, 1);
    await first.terminate();
    const nextEpoch = { ...firstEpoch, workerGeneration: 'worker-next' };
    fixture.state.replaceEpoch(nextEpoch);
    assert.deepEqual(fixture.state.snapshot(), {
      revision: 1,
      warningDoneKeys: [],
      bosaiCompletedKeys: [],
      bosaiCollecting: true,
      fetchHealth: {
        previousStatusBySource: { ...initialHealth.previousStatusBySource, xml_regular: 'delayed' },
        activeSinceAtBySource: {
          ...initialHealth.activeSinceAtBySource,
          xml_regular: '2026-10-09T01:00:00.000Z',
        },
      },
    });
    const next = await fixture.start(nextEpoch);
    const repeated = await next.transport.call<FetchHealthNotificationEmitResult>(
      'fixture.health',
      { status: 'delayed' },
    );
    assert.deepEqual(repeated.recorded, []);
    await next.transport.call('fixture.health', { status: 'normal' });
    await next.transport.call('fixture.health', { status: 'delayed' });
    assert.deepEqual(
      fixture.saved().map((row) => [row.notification_id, row.change_type]),
      [
        ['worker-first-health-1', 'fetch_delayed'],
        ['worker-next-health-1', 'fetch_recovered'],
        ['worker-next-health-2', 'fetch_delayed'],
      ],
    );
  } finally {
    await fixture.close();
  }
});

test('実Workerの健全性保存失敗をACKで通知結果へ反映し、再開後も同異常を補完しない', async () => {
  const fixture = setup();
  try {
    fixture.retained.connection.exec(
      "CREATE TRIGGER fail_notification BEFORE INSERT ON notification_output_history BEGIN SELECT RAISE(FAIL, '試験'); END",
    );
    const first = await fixture.start(firstEpoch);
    const failed = await first.transport.call<FetchHealthNotificationEmitResult>('fixture.health', {
      status: 'delayed',
    });
    assert.deepEqual(failed.recorded, []);
    assert.deepEqual(failed.recordFailedSourceIds, ['xml_regular']);
    await first.terminate();
    fixture.retained.connection.exec('DROP TRIGGER fail_notification');
    const nextEpoch = { ...firstEpoch, workerGeneration: 'worker-next' };
    fixture.state.replaceEpoch(nextEpoch);
    const next = await fixture.start(nextEpoch);
    const repeated = await next.transport.call<FetchHealthNotificationEmitResult>(
      'fixture.health',
      { status: 'delayed' },
    );
    assert.deepEqual(repeated.recorded, []);
    assert.deepEqual(repeated.recordFailedSourceIds, []);
    assert.deepEqual(fixture.saved(), []);
  } finally {
    await fixture.close();
  }
});

test('実Workerのpauseは先行更新後のrevisionを返し、後続更新は正しいtokenのreleaseまでFIFOで遮断する', async () => {
  const fixture = setup();
  try {
    const worker = await fixture.start(firstEpoch);
    const preceding = worker.transport.call('fixture.run', { target: 'east' });
    const paused = worker.transport.call('fixture.pause', {
      token: 'p1',
      expiresAt: new Date(Date.now() + 3_000).toISOString(),
    });
    const following = worker.transport.call('fixture.run', { target: 'trc' });
    assert.deepEqual(await preceding, ['warning', 'bosai']);
    assert.deepEqual(await paused, { revision: 1 });
    await delay(50);
    assert.deepEqual(fixture.commits(), ['east']);
    assert.equal(fixture.saved().length, 2);
    assert.equal(fixture.state.pendingUnit, null);
    assert.deepEqual(await worker.transport.call('fixture.release', { token: 'wrong' }), {
      released: false,
    });
    await delay(50);
    assert.deepEqual(fixture.commits(), ['east']);
    assert.deepEqual(await worker.transport.call('fixture.release', { token: 'p1' }), {
      released: true,
    });
    assert.deepEqual(await following, ['warning', 'bosai']);
    assert.deepEqual(fixture.commits(), ['east', 'trc']);
    assert.equal(fixture.state.snapshot().revision, 2);
  } finally {
    await fixture.close();
  }
});

test('実Workerのpause期限失効で後続更新を解放し、期限切れpauseは拒否する', async () => {
  const fixture = setup();
  try {
    const worker = await fixture.start(firstEpoch);
    await assert.rejects(
      worker.transport.call('fixture.pause', {
        token: 'expired',
        expiresAt: '2000-01-01T00:00:00.000Z',
      }),
      { message: 'deadline_exceeded' },
    );
    const expires = Date.now() + 150;
    assert.deepEqual(
      await worker.transport.call('fixture.pause', {
        token: 'p1',
        expiresAt: new Date(expires).toISOString(),
      }),
      { revision: 0 },
    );
    const following = worker.transport.call('fixture.run', { target: 'east' });
    await delay(50);
    assert.deepEqual(fixture.commits(), []);
    await following;
    assert.equal(Date.now() >= expires, true);
    assert.deepEqual(fixture.commits(), ['east']);
  } finally {
    await fixture.close();
  }
});
