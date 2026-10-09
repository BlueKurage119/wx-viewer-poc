import assert from 'node:assert/strict';
import test from 'node:test';
import { setup, until } from './helpers/acquisitionWorkerHostFixture.js';

test('停止送信後ACK前に実Workerが終了しても停止意図を再開世代に引き継ぐ', async () => {
  const f = setup();
  try {
    await f.host.start();
    await f.host.execute('start', 'start-1');
    assert.equal(f.host.desiredRunning, true);
    await assert.rejects(f.host.execute('stop', 'exit-before-ack-stop'), {
      message: 'operation_result_unknown',
    });
    assert.equal(f.host.desiredRunning, false);
    await until(() => f.host.status().exitConfirmed);
    await f.host.restart();
    assert.equal(
      (await f.host.call<{ desiredRunning: boolean }>('fixture.info', null)).desiredRunning,
      false,
    );
    assert.equal(
      f.events().filter((e) => e.event === 'operation-executed' && e.operation === 'stop').length,
      1,
    );
  } finally {
    await f.close();
  }
});

test(
  '受付ACK喪失は同じoperationIdを照合し二重実行せず、完了ACK喪失は専用unknownになる',
  { timeout: 15_000 },
  async () => {
    const f = setup();
    try {
      await f.host.start();
      await f.host.execute('start', 'lost-accept-start');
      assert.equal(f.host.desiredRunning, true);
      const events = f.events().filter((e) => e.operationId === 'lost-accept-start');
      assert.deepEqual(
        events.map((e) => e.event),
        ['execute-received', 'operation-executed', 'operation-query'],
      );
      await assert.rejects(f.host.execute('stop', 'lost-complete-stop'), {
        message: 'operation_result_unknown',
      });
      assert.equal(f.host.desiredRunning, false);
      assert.equal(
        f
          .events()
          .filter((e) => e.event === 'execute-received' && e.operationId === 'lost-complete-stop')
          .length,
        1,
      );
      await assert.rejects(f.host.execute('start', 'query-unknown-start'), {
        message: 'operation_result_unknown',
      });
      assert.equal(f.host.desiredRunning, true, '送信済みの結果不明意図は保持します');
    } finally {
      await f.close();
    }
  },
);

test('後着した古い開始ACKと古い明示拒否は新しい停止意図を上書きしない', async () => {
  const f = setup();
  try {
    await f.host.start();
    const start = f.host.execute('start', 'late-accept-start');
    await until(() => f.events().some((e) => e.operationId === 'late-accept-start'));
    await f.host.execute('stop', 'new-stop');
    await f.host.call('fixture.release-operation', { operationId: 'late-accept-start' });
    await start;
    assert.equal(f.host.desiredRunning, false);
    await f.host.execute('start', 'start-again');
    const rejected = assert.rejects(f.host.execute('stop', 'reject-late-stop'), {
      message: 'busy',
    });
    await until(() => f.events().some((e) => e.operationId === 'reject-late-stop'));
    await f.host.execute('stop', 'latest-stop');
    await f.host.call('fixture.release-operation', { operationId: 'reject-late-stop' });
    await rejected;
    assert.equal(f.host.desiredRunning, false);
    await assert.rejects(f.host.execute('start', 'reject-start'), { message: 'busy' });
    assert.equal(f.host.desiredRunning, false, '最新の未実行拒否だけ直前意図へ戻します');
  } finally {
    await f.close();
  }
});

test('制御8枠飽和で未送信の停止は意図を戻しWorker実行0、枠解放後は受付可能', async () => {
  const f = setup();
  try {
    await f.host.start();
    await f.host.execute('start', 'start-running');
    const queries = Array.from({ length: 8 }, (_, i) =>
      f.host.call('operation.query', { operationId: `hold-query-${i}`, operation: 'stop' }),
    );
    await until(
      () => f.events().filter((e) => e.operationId?.startsWith('hold-query')).length === 8,
    );
    await assert.rejects(f.host.execute('stop', 'unsent-stop'), { message: 'busy' });
    assert.equal(f.host.desiredRunning, true);
    assert.equal(
      f.events().some((e) => e.operationId === 'unsent-stop'),
      false,
    );
    for (let i = 0; i < 8; i++)
      await f.host.call('fixture.release-operation', { operationId: `hold-query-${i}` });
    await Promise.all(queries);
    await f.host.execute('stop', 'accepted-stop');
    assert.equal(f.host.desiredRunning, false);
  } finally {
    await f.close();
  }
});

test('実行受付後の照会busy/not_readyは停止意図を巻き戻さず結果不明として返す', async () => {
  const f = setup();
  try {
    await f.host.start();
    for (const prefix of ['query-busy', 'query-not-ready']) {
      await f.host.execute('start', `start-running-${prefix}`);
      const operationId = `${prefix}-stop`;
      await assert.rejects(f.host.execute('stop', operationId), {
        message: 'operation_result_unknown',
      });
      assert.equal(f.host.desiredRunning, false);
      assert.equal(
        f.events().filter((e) => e.event === 'operation-executed' && e.operationId === operationId)
          .length,
        1,
      );
    }
  } finally {
    await f.close();
  }
});

test(
  '停止受付ACK喪失を同IDで照会中に終了しても再開後は停止意図を維持する',
  { timeout: 9000 },
  async () => {
    const f = setup();
    try {
      await f.host.start();
      await f.host.execute('start', 'start-running');
      await assert.rejects(f.host.execute('stop', 'lost-accept-exit-stop'), {
        message: 'operation_result_unknown',
      });
      assert.equal(f.host.desiredRunning, false);
      await until(() => f.host.status().exitConfirmed);
      assert.deepEqual(
        f
          .events()
          .filter((e) => e.operationId === 'lost-accept-exit-stop')
          .map((e) => e.event),
        ['execute-received', 'operation-executed', 'operation-query'],
      );
      await f.host.restart();
      assert.equal(
        (await f.host.call<{ desiredRunning: boolean }>('fixture.info', null)).desiredRunning,
        false,
      );
    } finally {
      await f.close();
    }
  },
);
