import assert from 'node:assert/strict';
import test from 'node:test';
import { TileEnsureQueue } from '../src/runtime/tileEnsureQueue.js';
import type { TileInput, WeatherOperations } from '../src/runtime/weatherContracts.js';

type Result = WeatherOperations['tile.ensure']['response'];
const stored: Result = { kind: 'stored', tileResult: 'downloaded' };
function input(tileX: number): TileInput {
  return {
    layer: 'nowcast',
    frame: {
      product: 'N1',
      baseTime: '2026-10-09T00:00:00.000Z',
      validTime: '2026-10-09T00:00:00.000Z',
      element: 'hrpns',
      member: 'none',
    },
    coordinate: { zoom: 10, tileX, tileY: 1 },
  };
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
function gate() {
  let resolve!: (value: Result) => void;
  const promise = new Promise<Result>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('4取得を並列実行し、16論理要求まで同一キーを合流、17件目をbusyで拒否する', async () => {
  const queue = new TileEnsureQueue();
  const active = Array.from({ length: 4 }, gate);
  const starts: number[] = [];
  const requests = active.map((value, index) =>
    queue.ensure(input(index), () => {
      starts.push(index);
      return value.promise;
    }),
  );
  for (let i = 0; i < 10; i++)
    requests.push(
      queue.ensure(input(0), async () => {
        assert.fail('同一キーの上流取得が重複しました');
      }),
    );
  requests.push(
    queue.ensure(input(4), async () => {
      starts.push(4);
      return stored;
    }),
  );
  requests.push(
    queue.ensure(input(5), async () => {
      starts.push(5);
      return stored;
    }),
  );
  await assert.rejects(
    queue.ensure(input(0), async () => stored),
    { code: 'busy' },
  );
  assert.deepEqual(starts, [0, 1, 2, 3]);
  active[0]!.resolve(stored);
  await flush();
  assert.deepEqual(starts, [0, 1, 2, 3, 4, 5]);
  for (const value of active) value.resolve(stored);
  assert.deepEqual(
    await Promise.all(requests),
    Array.from({ length: 16 }, () => stored),
  );
  assert.deepEqual(await queue.ensure(input(0), async () => stored), stored);
});

test('active未完了のまま待機30秒で合流した全要求が終了し、空いた論理枠を再利用できる', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const queue = new TileEnsureQueue();
  const active = Array.from({ length: 4 }, gate);
  const requests = active.map((value, index) => queue.ensure(input(index), () => value.promise));
  let starts = 0;
  const work = async () => {
    starts++;
    return stored;
  };
  const waiting = queue.ensure(input(9), work);
  const coalesced = queue.ensure(input(9), work);
  let ended = false;
  const checked = Promise.all(
    [waiting, coalesced].map(async (p) => {
      await assert.rejects(p, { code: 'deadline_exceeded' });
    }),
  ).then(() => {
    ended = true;
  });
  t.mock.timers.tick(29_999);
  await flush();
  assert.equal(ended, false);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(ended, true, 'active解放前に待機が終了する必要があります');
  await checked;
  assert.equal(starts, 0);
  const next = queue.ensure(input(9), work);
  active[0]!.resolve(stored);
  assert.deepEqual(await next, stored);
  assert.equal(starts, 1);
  for (const value of active) value.resolve(stored);
  await Promise.all(requests);
});

test('closeはactive完了を待たず待機要求を拒否し、遅れて空いた枠でも新しい取得を開始しない', async () => {
  const queue = new TileEnsureQueue();
  const active = Array.from({ length: 4 }, gate);
  const requests = active.map((value, index) => queue.ensure(input(index), () => value.promise));
  const waiting = queue.ensure(input(9), async () => {
    assert.fail('close後に取得しました');
  });
  const checked = assert.rejects(waiting, { code: 'not_ready' });
  queue.close();
  await checked;
  await assert.rejects(
    queue.ensure(input(10), async () => stored),
    { code: 'not_ready' },
  );
  for (const value of active) value.resolve(stored);
  await Promise.all(requests);
});

test('上流失敗時にも取得枠と同一キーを解放し、FIFOで後続を開始する', async () => {
  const queue = new TileEnsureQueue();
  const active = Array.from({ length: 4 }, gate);
  const requests = active.map((value, index) => queue.ensure(input(index), () => value.promise));
  const starts: number[] = [];
  const failed = queue.ensure(input(4), async () => {
    starts.push(4);
    throw new Error('upstream');
  });
  const checked = assert.rejects(failed, /upstream/);
  const next = queue.ensure(input(5), async () => {
    starts.push(5);
    return stored;
  });
  active[0]!.resolve(stored);
  await checked;
  assert.deepEqual(await next, stored);
  assert.deepEqual(starts, [4, 5]);
  assert.deepEqual(await queue.ensure(input(4), async () => stored), stored);
  for (const value of active) value.resolve(stored);
  await Promise.all(requests);
});

test('未開始tileの最後の待機者が取消したら取得せず枠を戻す', async () => {
  const queue = new TileEnsureQueue();
  const active = Array.from({ length: 4 }, gate);
  const requests = active.map((value, index) => queue.ensure(input(index), () => value.promise));
  const controller = new AbortController();
  let started = 0;
  const waiting = queue.ensure(
    input(9),
    async () => {
      started++;
      return stored;
    },
    controller.signal,
  );
  controller.abort();
  await assert.rejects(waiting, { code: 'deadline_exceeded' });
  active[0]!.resolve(stored);
  await flush();
  assert.equal(started, 0);
  assert.deepEqual(await queue.ensure(input(9), async () => stored), stored);
  for (const value of active) value.resolve(stored);
  await Promise.all(requests);
});

test('合流した一人の取消では残る待機者の取得を維持する', async () => {
  const queue = new TileEnsureQueue();
  const active = Array.from({ length: 4 }, gate);
  const requests = active.map((value, index) => queue.ensure(input(index), () => value.promise));
  const controller = new AbortController();
  let started = 0;
  const cancelled = queue.ensure(
    input(9),
    async () => {
      started++;
      return stored;
    },
    controller.signal,
  );
  const retained = queue.ensure(input(9), async () => {
    assert.fail('同じtileの二重取得');
  });
  controller.abort();
  await assert.rejects(cancelled, { code: 'deadline_exceeded' });
  active[0]!.resolve(stored);
  assert.deepEqual(await retained, stored);
  assert.equal(started, 1);
  for (const value of active) value.resolve(stored);
  await Promise.all(requests);
});
