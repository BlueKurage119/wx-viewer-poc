import assert from 'node:assert/strict';
import test from 'node:test';
import { DeliveryReadLimiter } from '../src/runtime/deliveryReadLimiter.js';

const deadline = () => Date.now() + 10_000;

test('16実行、4PNG、48待機を超える要求はbusyとなり、解放順に進む', async () => {
  const limiter = new DeliveryReadLimiter();
  const releases = await Promise.all(
    Array.from({ length: 16 }, (_, index) =>
      limiter.acquire(`active-${index}`, index < 4, deadline()),
    ),
  );
  assert.deepEqual(limiter.status, { active: 16, tiles: 4, queued: 0 });
  const queued = Array.from({ length: 48 }, (_, index) => {
    const promise = limiter.acquire(`queued-${index}`, index === 0, deadline());
    void promise.catch(() => {});
    return promise;
  });
  assert.deepEqual(limiter.status, { active: 16, tiles: 4, queued: 48 });
  await assert.rejects(limiter.acquire('overflow', false, deadline()), /busy/);
  releases[4]!();
  assert.deepEqual(limiter.status, { active: 15, tiles: 4, queued: 48 });
  releases[0]!();
  const tile = await queued[0]!;
  const nonTile = await queued[1]!;
  assert.deepEqual(limiter.status, { active: 16, tiles: 4, queued: 46 });
  limiter.suspend();
  await Promise.all(queued.slice(2).map((promise) => assert.rejects(promise, /not_ready/)));
  assert.equal(limiter.status.queued, 0);
  for (const release of releases) release();
  tile();
  nonTile();
  await limiter.waitForIdle();
  assert.deepEqual(limiter.status, { active: 0, tiles: 0, queued: 0 });
});

test('待機中の取消と期限切れは即時に枠を戻し、実行中は完了まで保持する', async () => {
  const limiter = new DeliveryReadLimiter();
  const releases = await Promise.all(
    Array.from({ length: 16 }, (_, index) => limiter.acquire(`active-${index}`, false, deadline())),
  );
  const cancelled = limiter.acquire('cancelled', false, deadline());
  limiter.cancel('cancelled');
  await assert.rejects(cancelled, /deadline_exceeded/);
  const expired = limiter.acquire('expired', false, Date.now() + 10);
  await assert.rejects(expired, /deadline_exceeded/);
  assert.deepEqual(limiter.status, { active: 16, tiles: 0, queued: 0 });
  for (const release of releases) release();
  await limiter.waitForIdle();
  const before = await limiter.acquire('before', false, Date.now() + 1000);
  before();
  await assert.rejects(limiter.acquire('boundary', false, Date.now()), /deadline_exceeded/);
  await assert.rejects(limiter.acquire('late', false, Date.now() - 1), /deadline_exceeded/);
});

test('PNG枠で先頭が待つ間、後着の通常読取はFIFOを追い越さない', async () => {
  const limiter = new DeliveryReadLimiter();
  const tiles = await Promise.all(
    Array.from({ length: 4 }, (_, index) => limiter.acquire(`tile-${index}`, true, deadline())),
  );
  const queuedTile = limiter.acquire('tile-next', true, deadline());
  const queuedText = limiter.acquire('text-later', false, deadline());
  assert.deepEqual(limiter.status, { active: 4, tiles: 4, queued: 2 });
  tiles[0]!();
  const releaseTile = await queuedTile;
  const releaseText = await queuedText;
  assert.deepEqual(limiter.status, { active: 5, tiles: 4, queued: 0 });
  for (const release of tiles) release();
  releaseTile();
  releaseText();
  await limiter.waitForIdle();
});

test('固定時計の期限直前は受付け、期限到達後は待機を開始せず実行中枠を保持する', async (t) => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const limiter = new DeliveryReadLimiter();
  const active = await Promise.all(
    Array.from({ length: 16 }, (_, index) => limiter.acquire(`active-${index}`, false, 1001)),
  );
  const waiting = limiter.acquire('waiting', false, 1001);
  now = 1001;
  active[0]!();
  await assert.rejects(waiting, /deadline_exceeded/);
  await assert.rejects(limiter.acquire('at-deadline', false, 1001), /deadline_exceeded/);
  assert.deepEqual(limiter.status, { active: 15, tiles: 0, queued: 0 });
  for (const release of active) release();
  await limiter.waitForIdle();
  assert.deepEqual(limiter.status, { active: 0, tiles: 0, queued: 0 });
});
