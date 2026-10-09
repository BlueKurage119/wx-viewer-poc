import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setup, until, delay } from './helpers/acquisitionWorkerHostFixture.js';

test(
  '実Workerの5秒受付期限後はfailedとなり、後着受付は許可・lease取得されない',
  { timeout: 10_000 },
  async () => {
    const fixture = setup('late-accept');
    try {
      const started = performance.now();
      await assert.rejects(fixture.host.start(), { message: 'initial_accept_timeout' });
      assert.equal(performance.now() - started >= 4_900, true);
      await until(() => fixture.events().some((event) => event.event === 'accept-rejected'));
      assert.deepEqual(fixture.failures, [
        { code: 'initial_accept_timeout', generation: fixture.host.epoch.workerGeneration },
      ]);
      assert.equal(fixture.host.status().failureCode, 'initial_accept_timeout');
      assert.equal(fixture.host.status().restartAllowed, true);
      assert.equal(fixture.host.status().exitConfirmed, false);
      assert.equal(existsSync(fixture.lock), false);
      assert.deepEqual(
        fixture.events().map((event) => event.event),
        ['spawn', 'accept-rejected'],
      );
    } finally {
      await fixture.close();
    }
  },
);

test('実Workerの未捕捉例外・exitを1件へ合流し、自動再起動せず旧exit確認後だけ再開する', async () => {
  const fixture = setup();
  try {
    await fixture.host.start();
    const old = fixture.host.epoch.workerGeneration;
    const info = await fixture.host.call<{ threadId: number; desiredRunning: boolean }>(
      'fixture.info',
      null,
    );
    assert.notEqual(info.threadId, 0);
    assert.equal(info.desiredRunning, false);
    await fixture.host.call('fixture.throw', null);
    await until(() => fixture.host.status().exitConfirmed);
    assert.deepEqual(fixture.failures, [{ code: 'unexpected_exit', generation: old }]);
    assert.equal(fixture.host.status().stopReason, 'unexpected_exit');
    await delay(1_100);
    assert.equal(fixture.events().filter((event) => event.event === 'spawn').length, 1);
    await fixture.host.restart();
    assert.notEqual(fixture.host.epoch.workerGeneration, old);
    assert.equal(fixture.readerCloses(), 1);
    assert.deepEqual(
      fixture
        .events()
        .filter((event) => ['spawn', 'exit'].includes(event.event))
        .map((event) => event.event),
      ['spawn', 'exit', 'spawn'],
    );
    assert.equal(
      (await fixture.host.call<{ desiredRunning: boolean }>('fixture.info', null)).desiredRunning,
      false,
    );
    assert.equal(fixture.events().filter((event) => event.event === 'lease').length, 2);
  } finally {
    await fixture.close();
  }
});

test('残留leaseの別token・不完全ownerは削除せず、新しいWorkerを起動しない', async () => {
  for (const mode of ['wrong-owner', 'incomplete-owner']) {
    const fixture = setup(mode);
    try {
      await fixture.host.start();
      await fixture.host.call('fixture.exit', null);
      await until(() => fixture.host.status().exitConfirmed);
      const before = readFileSync(join(fixture.lock, 'owner.json'), 'utf8');
      await assert.rejects(fixture.host.restart(), { message: 'lease_owner_unverified' });
      assert.equal(readFileSync(join(fixture.lock, 'owner.json'), 'utf8'), before);
      assert.equal(fixture.events().filter((event) => event.event === 'spawn').length, 1);
    } finally {
      await assert.rejects(fixture.close(), { message: 'lease_owner_unverified' });
    }
  }
});

test('実通信の旧DB世代statusを拒否し、新DB世代と最終報告を巻き戻さない', async () => {
  const fixture = setup();
  try {
    await fixture.host.start();
    await fixture.host.call('fixture.database', null);
    assert.equal(fixture.host.epoch.weatherDatabaseGenerationId, 'fixture-db');
    const before = fixture.reports();
    assert.equal(await fixture.host.call('fixture.old-status', null), 'generation_changed');
    assert.equal(fixture.host.epoch.weatherDatabaseGenerationId, 'fixture-db');
    assert.equal(fixture.reports(), before);
  } finally {
    await fixture.close();
  }
});

test('freshのままprotocol異常でもfailed・専用再開可へ進み、通知は世代内1回', async () => {
  const fixture = setup();
  try {
    await fixture.host.start();
    await until(() => fixture.host.status().reportFreshness === 'fresh');
    await fixture.host.call('fixture.protocol', null);
    await until(() => fixture.host.status().lifecycle === 'failed');
    await delay(450);
    assert.equal(fixture.host.status().reportFreshness, 'fresh');
    assert.equal(fixture.host.status().restartAllowed, true);
    assert.equal(fixture.host.status().exitConfirmed, false);
    assert.deepEqual(fixture.failures, [
      { code: 'protocol_error', generation: fixture.host.epoch.workerGeneration },
    ]);
    await assert.rejects(fixture.host.call('fixture.info', null), { message: 'not_ready' });
  } finally {
    await fixture.close();
  }
});

test('実通信の64要求上限と8MiB超過を有限失敗とし、pendingを残さない', async () => {
  const fixture = setup();
  try {
    await fixture.host.start();
    const pending = Array.from({ length: 64 }, () => fixture.host.call('fixture.wait', null));
    await assert.rejects(fixture.host.call('fixture.wait', null), { message: 'busy' });
    assert.deepEqual(
      await Promise.all(pending),
      Array.from({ length: 64 }, () => true),
    );
    assert.equal(fixture.host.status().pendingRequests, 0);
    const value = 'x'.repeat(8 * 1024 * 1024);
    await assert.rejects(fixture.host.call('fixture.echo', value), {
      message: 'payload_too_large',
    });
    // 容量超過後のruntime.fail制御ACKを含め、ホストの後処理が完了してから照合する。
    await until(() => fixture.host.status().pendingRequests === 0);
    assert.equal(fixture.host.status().pendingRequests, 0);
    assert.equal(fixture.host.status().failureCode, 'payload_too_large');
    assert.deepEqual(fixture.failures, [
      { code: 'payload_too_large', generation: fixture.host.epoch.workerGeneration },
    ]);
  } finally {
    await fixture.close();
  }
});

test(
  '準備完了後の同期負荷中はheartbeatだけがstaleとなり、メインのタイマーが進み、応答不明を1件通知する',
  { timeout: 25_000 },
  async () => {
    const fixture = setup();
    try {
      await fixture.host.start();
      await fixture.host.call('fixture.prepared', null);
      await until(() => fixture.host.status().prepared === true);
      await until(() => fixture.host.status().reportFreshness === 'fresh');
      await fixture.host.call('fixture.block', { duration: 17_000 });
      await until(() => fixture.events().some((event) => event.event === 'block-start'));
      let ticks = 0;
      const timer = setInterval(() => ticks++, 50);
      try {
        await until(() => fixture.host.status().reportFreshness === 'stale', 18_000);
        assert.equal(
          fixture.events().some((event) => event.event === 'block-end'),
          false,
        );
        assert.equal(ticks >= 200, true);
        assert.equal(fixture.host.status().restartAllowed, true);
        await until(() => fixture.failures.some((event) => event.code === 'report_stale'));
        assert.deepEqual(fixture.failures, [
          { code: 'report_stale', generation: fixture.host.epoch.workerGeneration },
        ]);
        await until(() => fixture.events().some((event) => event.event === 'block-end'), 4_000);
        await until(() => fixture.host.status().reportFreshness === 'fresh');
        assert.equal(
          fixture.events().find((event) => event.event === 'block-end')!.processed! > 0,
          true,
        );
      } finally {
        clearInterval(timer);
      }
    } finally {
      await fixture.close();
    }
  },
);

test(
  '準備完了前の同期負荷でstaleになっても応答不明を通知せず、状態・再開可否は変えない',
  { timeout: 25_000 },
  async () => {
    const fixture = setup();
    try {
      await fixture.host.start();
      await until(() => fixture.host.status().reportFreshness === 'fresh');
      assert.equal(fixture.host.status().prepared, false);
      await fixture.host.call('fixture.block', { duration: 17_000 });
      await until(() => fixture.host.status().reportFreshness === 'stale', 18_000);
      // 通知の判定周期（1秒）を少なくとも1回またぐ。
      await delay(1_500);
      assert.equal(fixture.host.status().prepared, false);
      assert.equal(fixture.host.status().restartAllowed, true);
      assert.deepEqual(fixture.failures, []);
      await until(() => fixture.events().some((event) => event.event === 'block-end'), 4_000);
      await until(() => fixture.host.status().reportFreshness === 'fresh');
      assert.deepEqual(fixture.failures, []);
    } finally {
      await fixture.close();
    }
  },
);

test('database.readyの受領ACK前に新DB世代update.beginを受理しない', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = setup('normal', () => pending);
  try {
    await fixture.host.start();
    const result = await fixture.host.call('fixture.early-unit', null);
    assert.equal(result, 'generation_changed');
    assert.equal(fixture.host.decisions.pendingUnit, null);
  } finally {
    release();
    await fixture.close();
  }
});
