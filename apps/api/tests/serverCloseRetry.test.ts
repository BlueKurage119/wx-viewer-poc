import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import test from 'node:test';
import { realpathSync } from 'node:fs';
import { createRetryableDatabaseClose } from '../src/serverClose.js';
import { startInlineServer as startServer } from '../src/server.js';
import {
  createTemporaryTestDatabaseFixture,
  createTestServerDatabaseOptions,
  readTestDatabases,
} from './helpers/databasePair.js';

test('closeは進行中Promiseを共有し停止完了前にDBを閉じず停止副作用を一度に保つ', async () => {
  let finishStop!: () => void;
  const gate = new Promise<void>((resolve) => {
    finishStop = resolve;
  });
  let stops = 0;
  let databaseCloses = 0;
  const failure = new Error('fixture DB close');
  const reasons: string[] = [];
  const close = createRetryableDatabaseClose(
    async (options) => {
      stops += 1;
      reasons.push(options?.reason ?? 'programmatic');
      await gate;
    },
    () => {
      databaseCloses += 1;
      if (databaseCloses === 1) throw failure;
    },
  );
  const first = close({ reason: 'signal' });
  const parallel = close();
  assert.equal(parallel, first);
  const rejected = assert.rejects(first, (error) => error === failure);
  await Promise.resolve();
  assert.equal(stops, 1);
  assert.equal(databaseCloses, 0);
  finishStop();
  await rejected;
  await close();
  await close({ reason: 'signal' });
  assert.equal(stops, 1);
  assert.equal(databaseCloses, 2);
  assert.deepEqual(reasons, ['signal']);
});

test('公開closeは開いたままのDB終了例外後に再試行しB5と停止通知を重複させない', async () => {
  const fixture = createTemporaryTestDatabaseFixture();
  const options = createTestServerDatabaseOptions(fixture.config);
  const server = await startServer({ ...options, port: 0, enablePolling: false });
  const weatherPath = realpathSync(options.config.weather.databasePath);
  const retainedPath = realpathSync(options.config.retained.databasePath);
  const originalClose = Database.prototype.close;
  const failure = new Error('fixture open connection close');
  const counts = new Map<string, number>();
  const failedConnections: Database.Database[] = [];
  try {
    // iterator等の具体原因を再現せず、接続が開いたままcloseが失敗する状態を代表する。
    Database.prototype.close = function () {
      const count = (counts.get(this.name) ?? 0) + 1;
      counts.set(this.name, count);
      if (this.name === weatherPath && count === 1) {
        failedConnections.push(this);
        throw failure;
      }
      return originalClose.call(this);
    };
    const first = server.close({ reason: 'signal' });
    assert.equal(server.close(), first);
    await assert.rejects(
      first,
      (error) => error instanceof AggregateError && error.errors.includes(failure),
    );
    assert.equal(failedConnections[0]?.open, true);
    await server.close();
    assert.equal(failedConnections[0]?.open, false);
    await server.close({ reason: 'signal' });
    assert.equal(counts.get(weatherPath), 2);
    assert.equal(counts.get(retainedPath), 1);
    Database.prototype.close = originalClose;
    const saved = readTestDatabases(fixture.config);
    try {
      assert.equal(
        saved.retained.connection
          .prepare(
            "SELECT COUNT(*) AS count FROM operation_history WHERE request_id LIKE 'shutdown-%'",
          )
          .pluck()
          .get(),
        1,
      );
      assert.equal(
        saved.retained.connection
          .prepare(
            "SELECT COUNT(*) AS count FROM notification_output_history WHERE message_definition_id = 'system-service-stopped'",
          )
          .pluck()
          .get(),
        1,
      );
    } finally {
      saved.close();
    }
    const restarted = await startServer({ ...options, port: 0, enablePolling: false });
    await restarted.close();
    await restarted.close();
  } finally {
    Database.prototype.close = originalClose;
    await server.close();
    fixture.cleanup();
  }
});
