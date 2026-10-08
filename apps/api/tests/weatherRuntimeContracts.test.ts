import assert from 'node:assert/strict';
import test from 'node:test';
import { projectWeatherRuntimeStatus } from '@wx-viewer-poc/shared';
import {
  assertWeatherData,
  canSendPayloadFrame,
  type WeatherEpoch,
  type WeatherRequest,
} from '../src/runtime/weatherContracts.js';
import { WeatherRequestRegistry } from '../src/runtime/weatherRequestRegistry.js';
import { WeatherPublicationGate } from '../src/runtime/weatherPublication.js';
import {
  WeatherDecisionState,
  emptyDecisionCheckpoint,
} from '../src/runtime/weatherDecisionState.js';

const epoch: WeatherEpoch = {
  serverGenerationId: 'server',
  workerGeneration: 'worker',
  weatherDatabaseGenerationId: 'db',
  readerEpoch: 'reader',
};
const request = (id: string): WeatherRequest<'history.reception'> => ({
  protocolVersion: 1,
  requestId: id,
  epoch,
  deadlineAt: '2026-10-09T00:00:05.000Z',
  kind: 'history.reception',
  payload: { receptionId: 1, expectedDatabaseGenerationId: 'db' },
});
const base = Date.parse('2026-10-09T00:00:00.000Z');
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test('契約はJSON/cloneで往復し、クラス・関数・循環を拒否する', () => {
  const value = request('r');
  assertWeatherData(value);
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
  assert.deepEqual(structuredClone(value), value);
  for (const value of [
    new Error('秘密'),
    new Date(),
    new Map(),
    new Set(),
    new URL('https://example.com'),
    Buffer.from('x'),
    { run: () => 1 },
  ])
    assert.throws(() => assertWeatherData(value), TypeError);
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  assert.throws(() => assertWeatherData(cycle), TypeError);
  const bytes = new Uint8Array([1, 2, 3]);
  assertWeatherData(bytes);
  assert.deepEqual(structuredClone(bytes), bytes);
});
test('要求の合流・異payload・期限境界・reader再接続を区別する', async () => {
  let now = base;
  const registry = new WeatherRequestRegistry(epoch, () => now);
  const pending = deferred<null>();
  let calls = 0;
  const a = registry.request(request('r'), () => {
    calls++;
    return pending.promise;
  });
  const b = registry.request(request('r'), () => {
    calls++;
    return pending.promise;
  });
  assert.equal(a, b);
  assert.deepEqual(
    (
      await registry.request(
        { ...request('r'), payload: { receptionId: 2, expectedDatabaseGenerationId: 'db' } },
        async () => null,
      )
    ).result,
    { status: 'failed', code: 'invalid_request' },
  );
  await Promise.resolve();
  assert.equal(calls, 1);
  now = base + 5000;
  pending.resolve(null);
  assert.deepEqual((await a).result, { status: 'failed', code: 'deadline_exceeded' });
  now = base;
  const c = registry.request(request('s'), () => new Promise(() => {}));
  registry.replaceEpoch({ ...epoch, readerEpoch: 'reader2' });
  assert.deepEqual((await c).result, { status: 'failed', code: 'generation_changed' });
  assert.deepEqual(
    (
      await registry.request(
        { ...request('new'), epoch: { ...epoch, readerEpoch: 'reader2' } },
        async () => null,
      )
    ).result,
    { status: 'completed', value: null },
  );
});
test('提供要求の64件と起動投影8件を超える要求はbusyとなる', async () => {
  const registry = new WeatherRequestRegistry(epoch, () => base);
  const capacityBlock = deferred<null>();
  const entries = Array.from({ length: 64 }, (_, i) =>
    registry.request(request(String(i)), () => capacityBlock.promise),
  );
  assert.equal(registry.size, 64);
  assert.deepEqual((await registry.request(request('overflow'), async () => null)).result, {
    status: 'failed',
    code: 'busy',
  });
  registry.close();
  capacityBlock.resolve(null);
  await Promise.all(entries);
  await Promise.resolve();
  assert.equal(registry.size, 0);
  const starts = Array.from({ length: 8 }, (_, i) =>
    registry.request(
      {
        ...request(`startup${i}`),
        kind: 'startup.project',
        payload: {
          publicationToken: {
            id: 't',
            acquisitionEpoch: epoch,
            deliveryEpoch: epoch,
            revision: 0,
            expiresAt: request('r').deadlineAt,
          },
          venueId: 'tokyo' as never,
          inquiredAt: new Date(base).toISOString(),
        },
      },
      () => new Promise(() => {}),
    ),
  );
  const ninth = await registry.request(
    {
      ...request('ninth'),
      kind: 'startup.project',
      payload: {
        publicationToken: {
          id: 't',
          acquisitionEpoch: epoch,
          deliveryEpoch: epoch,
          revision: 0,
          expiresAt: request('r').deadlineAt,
        },
        venueId: 'tokyo' as never,
        inquiredAt: new Date(base).toISOString(),
      },
    },
    () => new Promise(() => {}),
  );
  assert.deepEqual(ninth.result, { status: 'failed', code: 'busy' });
  registry.close();
  await Promise.all(starts);
});
test('公開中は更新を待たせ、reader世代失効後の投影を破棄して更新を解放する', async () => {
  const gate = new WeatherPublicationGate(epoch, epoch, () => base);
  const pending = deferred<string>();
  const entered = deferred<void>();
  const order: string[] = [];
  const publication = gate.publish(async (token) => {
    order.push('pause');
    entered.resolve();
    const value = await pending.promise;
    gate.assertValid(token);
    return value;
  });
  await entered.promise;
  const update = gate.runUpdate(() => {
    order.push('update');
    return 2;
  });
  assert.deepEqual(order, ['pause']);
  gate.replaceEpochs(epoch, { ...epoch, readerEpoch: 'reader2' });
  await assert.rejects(publication, { message: 'generation_changed' });
  assert.equal(await update, 2);
  pending.resolve('old');
  assert.deepEqual(order, ['pause', 'update']);
  assert.equal(await gate.publish(async () => 'new'), 'new');
});
test('未受領単位の初回keyだけを消費し、他scopeと健全性を保持する', () => {
  const state = new WeatherDecisionState(epoch);
  state.begin({
    unitId: 'u',
    epoch,
    beforeRevision: 0,
    scopes: ['a'],
    initialWarningKeys: ['a|normal'],
    initialBosaiKeys: ['a|training'],
  });
  state.replaceEpoch({ ...epoch, workerGeneration: 'next' });
  assert.deepEqual(state.snapshot(), {
    ...emptyDecisionCheckpoint(),
    revision: 1,
    warningDoneKeys: ['a|normal'],
    bosaiCompletedKeys: ['a|training'],
  });
  assert.equal(state.getUnknownUnits().length, 1);
  assert.equal(state.pendingUnit, null);
});
test('報告鮮度は受領時刻で判定し、通常取得停止とは独立する', () => {
  const input = {
    role: 'acquisition' as const,
    mode: 'inline' as const,
    workerGeneration: 'w',
    lifecycle: 'ready' as const,
    reportedAt: '2099-01-01T00:00:00Z',
    receivedAt: null,
    stopReason: null,
    pendingRequests: 0,
  };
  assert.deepEqual(projectWeatherRuntimeStatus(input, new Date(base).toISOString()), {
    ...input,
    reportFreshness: 'unknown',
    restartAllowed: false,
  });
  const received = { ...input, receivedAt: new Date(base).toISOString() };
  assert.deepEqual(projectWeatherRuntimeStatus(received, new Date(base + 15000).toISOString()), {
    ...received,
    reportFreshness: 'fresh',
    restartAllowed: false,
  });
  assert.deepEqual(projectWeatherRuntimeStatus(received, new Date(base + 15001).toISOString()), {
    ...received,
    reportFreshness: 'stale',
    restartAllowed: true,
  });
});
test('bulkは送信前にframe/未ACK/role容量上限を確認する', () => {
  const frame = {
    requestId: 'r',
    workerGeneration: 'w',
    index: 0,
    final: false,
    bytes: new Uint8Array(256 * 1024),
  };
  assert.equal(canSendPayloadFrame(frame, 1, 0), true);
  assert.equal(canSendPayloadFrame(frame, 2, 0), false);
  assert.equal(
    canSendPayloadFrame({ ...frame, bytes: new Uint8Array(256 * 1024 + 1) }, 0, 0),
    false,
  );
  assert.equal(canSendPayloadFrame(frame, 0, 8 * 1024 * 1024), false);
});

test('保持保存失敗でもcheckpointを確定し、ACK欠落・候補再受領で再保存しない', async () => {
  const { createTemporaryTestDatabaseFixture, initializeTestDatabases } =
    await import('./helpers/databasePair.js');
  const { RetainedNotificationSink } = await import('../src/runtime/retainedNotificationSink.js');
  const fixture = createTemporaryTestDatabaseFixture();
  const db = initializeTestDatabases(fixture.config);
  try {
    const state = new WeatherDecisionState(epoch);
    const sink = new RetainedNotificationSink(db.retained.connection, state);
    const unit = {
      unitId: 'u',
      epoch,
      beforeRevision: 0,
      scopes: ['a'],
      initialWarningKeys: ['a|normal'],
      initialBosaiKeys: [],
    };
    state.begin(unit);
    const record = {
      notificationId: 'n',
      category: 'warning' as const,
      sourceType: 'warning_current' as const,
      sourceVersion: null,
      targetAreaJson: null,
      occurredAt: new Date(base).toISOString(),
      detectedAt: new Date(base).toISOString(),
      changeType: 'new',
      ackRequired: false,
      summary: '試験',
      relatedRefsJson: '[]',
      origin: 'weather' as const,
      detectionContext: 'normal' as const,
      isTraining: false,
      messageDefinitionId: null,
      messageDefinitionVersion: null,
      weatherDatabaseGenerationId: db.weatherDatabaseGenerationId,
    };
    const batch = {
      eventId: 'e',
      unitId: 'u',
      epoch,
      beforeRevision: 0,
      after: { ...emptyDecisionCheckpoint(), revision: 1, warningDoneKeys: ['a|normal'] },
      groups: [{ groupId: 'g', records: [record] }],
    };
    db.retained.connection.exec(
      "CREATE TRIGGER fail_notification BEFORE INSERT ON notification_output_history BEGIN SELECT RAISE(ABORT, '試験'); END;",
    );
    const expected = {
      eventId: 'e',
      acceptedRevision: 1,
      groups: [{ groupId: 'g', outcome: 'record_failed' }],
    };
    assert.deepEqual(sink.receive(batch), expected);
    assert.deepEqual(state.snapshot(), batch.after);
    db.retained.connection.exec('DROP TRIGGER fail_notification');
    assert.deepEqual(sink.receive(batch), expected);
    assert.deepEqual(
      db.retained.connection.prepare('SELECT count(*) AS n FROM notification_output_history').get(),
      { n: 0 },
    );
    assert.throws(() => sink.receive({ ...batch, groups: [] }), /異なる内容/);
    state.replaceEpoch({ ...epoch, workerGeneration: 'next' });
    assert.deepEqual(state.snapshot(), batch.after);
    assert.deepEqual(state.getUnknownUnits(), []);
  } finally {
    db.close();
    fixture.cleanup();
  }
});

test('実startServerの気象・times・reception・processingはplain requestで提供portを通る', async () => {
  const { createTemporaryTestDatabaseFixture, createTestServerDatabaseOptions } =
    await import('./helpers/databasePair.js');
  const { startServer } = await import('../src/server.js');
  const fixture = createTemporaryTestDatabaseFixture();
  const calls: string[] = [];
  const server = await startServer({
    ...createTestServerDatabaseOptions(fixture.config),
    port: 0,
    enablePolling: false,
    weatherRequestObserver: (request) => {
      assertWeatherData(request);
      calls.push(request.kind);
    },
  });
  try {
    const root = `http://127.0.0.1:${server.port}`;
    const paths = [
      'warnings',
      'warning-timeseries',
      'early-warning',
      'area-timeseries',
      'amedas',
      'bulletins',
      'nowcast/times',
      'kikikuru/times',
    ];
    for (const path of paths) {
      const response = await fetch(
        `${root}/api/weather/${path}?terminalId=kkeagh01&controlStatus=normal`,
      );
      assert.equal(response.status, 200, path);
    }
    for (const path of ['receptions', 'processing?terminalId=kkeagh01']) {
      const response = await fetch(`${root}/api/monitoring/${path}`);
      assert.equal(response.status, 200, path);
    }
    const detail = await fetch(`${root}/api/monitoring/receptions/1`);
    assert.equal(detail.status, 404);
    const before = calls.length;
    const monitor = await fetch(`${root}/api/monitoring/status?terminalId=kkeagh01`);
    assert.equal(monitor.status, 200);
    assert.deepEqual(calls.slice(before), []);
    // 定期サンプルは別レーンで走るため、要求順比較からサンプルだけを除外する。
    assert.deepEqual(
      calls.filter((kind) => kind !== 'monitoring.sample'),
      [
        'weather.read',
        'weather.read',
        'weather.read',
        'weather.read',
        'weather.read',
        'weather.read',
        'image.times',
        'image.times',
        'history.receptions',
        'monitoring.processing',
        'history.reception',
      ],
    );
  } finally {
    await server.close();
    fixture.cleanup();
  }
});

test('起動公開は非同期投影後にだけsession/claim/監査を一括記録し、中断では何も記録しない', async () => {
  const { createTemporaryTestDatabaseFixture, initializeTestDatabases } =
    await import('./helpers/databasePair.js');
  const { testVenueRegistry, testTerminalRegistry, eastVenueId } =
    await import('./helpers/venueConfigPreload.js');
  const { createStartupNotificationRuntime } = await import('../src/server.js');
  const fixture = createTemporaryTestDatabaseFixture();
  const db = initializeTestDatabases(fixture.config);
  const calls: string[] = [];
  const runtime = createStartupNotificationRuntime(
    db.weather.connection,
    () => new Date(base).toISOString(),
    testVenueRegistry,
    undefined,
    undefined,
    testTerminalRegistry,
    db.retained.connection,
    db.weatherDatabaseGenerationId,
    (request) => calls.push(request.kind),
  );
  try {
    runtime.initialization.setInitialFetchPhase('completed');
    runtime.initialization.markVenueEvaluated(eastVenueId);
    const input = {
      terminalId: 'kkeagh01',
      venueId: eastVenueId,
      sessionId: '00000000-0000-4000-8000-000000000256',
      serverGenerationId: runtime.serverGenerationId,
      inquiredAt: new Date(base).toISOString(),
    };
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      Promise.resolve(runtime.startupNotifications.inquireWithSignal(input, controller.signal)),
      /deadline_exceeded/,
    );
    const response = await runtime.startupNotifications.inquire(input);
    assert.equal(response.status, 'ready');
    if (response.status !== 'ready') throw new Error('readyを期待');
    assert.equal(response.warningClaimed, true);
    assert.deepEqual(response.notifications, []);
    assert.deepEqual(calls, ['startup.project']);
    const again = await runtime.startupNotifications.inquire({
      ...input,
      sessionId: '00000000-0000-4000-8000-000000000257',
    });
    assert.equal(again.status === 'ready' ? again.warningClaimed : null, false);
  } finally {
    runtime.markStopped();
    db.close();
    fixture.cleanup();
  }
});

test('公開境界の101/102/103: U1現況とcursor101、system102、解放後weather103を整合させる', async () => {
  const { createTemporaryTestDatabaseFixture, initializeTestDatabases } =
    await import('./helpers/databasePair.js');
  const { testVenueRegistry, testTerminalRegistry, eastVenueId } =
    await import('./helpers/venueConfigPreload.js');
  const { createStartupNotificationRuntime } = await import('../src/server.js');
  const { saveWarningCurrentSnapshot, recordNotificationOutputHistory } =
    await import('../src/repositories/index.js');
  const { toNotificationDeltaCursor } = await import('@wx-viewer-poc/shared');
  const fixture = createTemporaryTestDatabaseFixture();
  const db = initializeTestDatabases(fixture.config);
  const now = new Date(base).toISOString();
  const notification = (id: string, origin: 'weather' | 'system') => ({
    notificationId: id,
    category: 'warning',
    sourceType: 'warning_current',
    sourceVersion: id,
    targetAreaJson: JSON.stringify([
      { kind: 'area', codeType: 'jma_municipal_warning_area', code: '1310800', name: '江東区' },
    ]),
    occurredAt: now,
    detectedAt: now,
    changeType: 'new',
    ackRequired: false,
    summary: '試験通知',
    relatedRefsJson: '[]',
    origin,
    detectionContext: 'normal' as const,
    isTraining: false,
    messageDefinitionId: null,
    messageDefinitionVersion: null,
    weatherDatabaseGenerationId: origin === 'weather' ? db.weatherDatabaseGenerationId : null,
  });
  function save(version: string) {
    saveWarningCurrentSnapshot(db.weather.connection, {
      areaCode: '1310800',
      areaName: '江東区',
      metadata: {
        source: 'test',
        issuedAt: now,
        validAt: null,
        validFrom: null,
        validTo: null,
        fetchedAt: now,
        lastSuccessAt: now,
        availability: 'available',
        sourceVersion: version,
      },
      telegram: {
        controlStatus: 'normal',
        infoType: '発表',
        eventId: version,
        reportDateTime: now,
        controlDateTime: now,
      },
      items: [
        {
          sequence: 1,
          kindCode: '02',
          kindName: '暴風警報',
          kindStatus: '発表',
          lastKindCode: null,
          lastKindName: null,
          significancyCode: null,
          significancyName: null,
          warningLevel: null,
          attentionText: null,
          kindIssuedAt: now,
          sourceTelegram: 'VPWW53',
        },
      ],
    });
  }
  recordNotificationOutputHistory(db.retained.connection, notification('seed', 'system'));
  db.retained.connection.exec('UPDATE notification_output_history SET id = 100');
  let following: Promise<void> | undefined;
  const runtime = createStartupNotificationRuntime(
    db.weather.connection,
    () => now,
    testVenueRegistry,
    undefined,
    undefined,
    testTerminalRegistry,
    db.retained.connection,
    db.weatherDatabaseGenerationId,
    (request) => {
      if (request.kind !== 'startup.project') return;
      recordNotificationOutputHistory(db.retained.connection, notification('system102', 'system'));
      following = runtime.runWeatherUpdate(() => {
        save('U2');
        runtime.decisions.recordSink.record([notification('N2', 'weather')]);
      });
    },
  );
  try {
    runtime.initialization.setInitialFetchPhase('completed');
    runtime.initialization.markVenueEvaluated(eastVenueId);
    await runtime.runWeatherUpdate(() => {
      save('U1');
      runtime.decisions.recordSink.record([notification('N1', 'weather')]);
    });
    const response = await runtime.startupNotifications.inquire({
      terminalId: 'hkeagh01',
      venueId: eastVenueId,
      sessionId: '00000000-0000-4000-8000-000000000258',
      serverGenerationId: runtime.serverGenerationId,
      inquiredAt: now,
    });
    assert.equal(response.status, 'ready');
    if (response.status !== 'ready') throw new Error('readyを期待');
    assert.equal(response.cursor, '101');
    assert.deepEqual(
      response.notifications.map((n) => n.sourceVersion),
      ['U1'],
    );
    await following;
    const weather = runtime.notificationDelta.query({
      origin: 'weather',
      serverGenerationId: runtime.serverGenerationId,
      terminalId: 'hkeagh01',
      venueId: eastVenueId,
      cursor: response.cursor,
      requestedAt: now,
    });
    const system = runtime.notificationDelta.query({
      origin: 'system',
      serverGenerationId: runtime.serverGenerationId,
      terminalId: 'hkeagh01',
      venueId: eastVenueId,
      cursor: toNotificationDeltaCursor(100),
      requestedAt: now,
    });
    assert.equal(weather.status, 'ready');
    assert.equal(system.status, 'ready');
    if (weather.status !== 'ready' || system.status !== 'ready') throw new Error('readyを期待');
    assert.deepEqual(
      weather.notifications.map((n) => n.notificationId),
      ['N2'],
    );
    assert.deepEqual(
      system.notifications.map((n) => n.notificationId),
      ['system102'],
    );
    assert.deepEqual(
      db.retained.connection
        .prepare('SELECT id, notification_id FROM notification_output_history ORDER BY id')
        .all(),
      [
        { id: 100, notification_id: 'seed' },
        { id: 101, notification_id: 'N1' },
        { id: 102, notification_id: 'system102' },
        { id: 103, notification_id: 'N2' },
      ],
    );
    const audit = db.retained.connection
      .prepare('SELECT response_json FROM startup_notification_inquiry')
      .get() as { response_json: string };
    assert.deepEqual(JSON.parse(audit.response_json), response);
  } finally {
    runtime.markStopped();
    db.close();
    fixture.cleanup();
  }
});

test('実inline状態機械の異常終了5窓でcommit・受領・初回keyの寿命を検証する', async () => {
  const { createTemporaryTestDatabaseFixture, initializeTestDatabases } =
    await import('./helpers/databasePair.js');
  const { createWeatherDecisionRuntime } = await import('../src/runtime/weatherDecisionRuntime.js');
  for (const stage of [
    'before_register',
    'registered',
    'weather_committed',
    'received',
    'acknowledged',
  ] as const) {
    const fixture = createTemporaryTestDatabaseFixture();
    const db = initializeTestDatabases(fixture.config);
    const gate = new WeatherPublicationGate(epoch, epoch);
    let failing = true;
    const runtime = createWeatherDecisionRuntime(db.retained.connection, epoch, gate, (at) => {
      if (failing && at === stage) throw new Error(stage);
    });
    try {
      db.weather.connection.exec('CREATE TABLE test_commit (value TEXT)');
      const scope = {
        scopes: ['a'],
        initialWarningKeys: ['a|normal'],
        initialBosaiKeys: ['a|normal'],
      };
      const record = {
        notificationId: stage,
        category: 'warning',
        sourceType: 'warning_current',
        sourceVersion: null,
        targetAreaJson: null,
        occurredAt: new Date(base).toISOString(),
        detectedAt: new Date(base).toISOString(),
        changeType: 'new',
        ackRequired: false,
        summary: '試験',
        relatedRefsJson: '[]',
        origin: 'weather' as const,
        detectionContext: 'initial' as const,
        isTraining: false,
        messageDefinitionId: null,
        messageDefinitionVersion: null,
        weatherDatabaseGenerationId: db.weatherDatabaseGenerationId,
      };
      await assert.rejects(
        runtime.runUpdate(scope, () => {
          db.weather.connection.prepare('INSERT INTO test_commit VALUES (?)').run('U1');
          runtime.recordSink.record([record]);
          runtime.warning.markDone('a', 'normal');
        }),
        { message: stage },
      );
      const expected = {
        before_register: [0, 0, true, 0],
        registered: [0, 0, false, 1],
        weather_committed: [1, 0, false, 1],
        received: [1, 1, false, 0],
        acknowledged: [1, 1, false, 0],
      }[stage];
      const commitCount = (
        db.weather.connection.prepare('SELECT count(*) AS n FROM test_commit').get() as {
          n: number;
        }
      ).n;
      const notificationCount = (
        db.retained.connection
          .prepare('SELECT count(*) AS n FROM notification_output_history')
          .get() as { n: number }
      ).n;
      assert.deepEqual(
        [
          commitCount,
          notificationCount,
          runtime.warning.isPending('a', 'normal'),
          runtime.state.getUnknownUnits().length,
        ],
        expected,
        stage,
      );
      failing = false;
      runtime.replaceEpoch({ ...epoch, workerGeneration: 'next' });
      assert.equal(runtime.warning.isPending('untouched', 'normal'), true);
      if (stage !== 'before_register')
        assert.equal(runtime.warning.isPending('a', 'normal'), false);
      assert.equal(
        (
          db.retained.connection
            .prepare('SELECT count(*) AS n FROM notification_output_history')
            .get() as { n: number }
        ).n,
        notificationCount,
      );
    } finally {
      db.close();
      fixture.cleanup();
    }
  }
});

test('同一productのcache miss取得中も保存済みPNGの提供portは取得レーンを待たない', async () => {
  const { createTemporaryTestDatabaseFixture, initializeTestDatabases } =
    await import('./helpers/databasePair.js');
  const { NowcastService } = await import('../src/polling/nowcastService.js');
  const { createInlineWeatherRead } = await import('../src/runtime/inlineWeatherRead.js');
  const { readFileSync } = await import('node:fs');
  const fixture = createTemporaryTestDatabaseFixture();
  const db = initializeTestDatabases(fixture.config);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  const blocked = deferred<void>();
  const entered = deferred<void>();
  let blockFetch = false;
  const period = {
    start: '00:00',
    end: '24:00',
    xmlSeconds: 60,
    imageCatalogSeconds: 60,
    amedasSeconds: 60,
    nowcastEnabled: true,
    kikikuruEnabled: true,
  };
  const service = new NowcastService(db.weather.connection, {
    cacheRoot: `${fixture.config.databasePath}.cache`,
    allowedZooms: [10],
    getCatalogAccess: () => ({ allowed: true, period, nextAllowedAt: null }),
    getImageAccess: () => ({ allowed: true, period, nextAllowedAt: null }),
    freshnessPolicy: { staleAfterSeconds: 300 },
    clock: () => '2026-09-07T03:00:00.000Z',
    fetchFn: async (input) => {
      const url = String(input);
      if (url.includes('targetTimes'))
        return new Response(
          readFileSync(
            new URL(
              './fixtures/jma/nowcast/nowcast_target_times_n1_synthetic.json',
              import.meta.url,
            ),
            'utf8',
          ),
        );
      if (blockFetch) {
        entered.resolve();
        await blocked.promise;
      }
      return new Response(new Uint8Array(png));
    },
  });
  let pending: Promise<unknown> | undefined;
  const reader = createInlineWeatherRead(
    epoch,
    {
      'tile.read': async (input) => {
        if (input.layer !== 'nowcast') return { kind: 'miss' };
        const result = await service.readSavedTile(input.frame, input.coordinate);
        return result === null
          ? { kind: 'miss' }
          : {
              kind: 'hit',
              bytes: new Uint8Array(result.buffer),
              contentType: 'image/png',
              storedAt: result.storedAt,
              catalogAvailability: result.catalogAvailability,
            };
      },
    },
    () => base,
  );
  try {
    const catalog = await service.refreshTimes();
    const frame = catalog.products.N1.frames[0]!;
    const cached = { zoom: 10, tileX: 910, tileY: 401 };
    const missing = { ...cached, tileX: 911 };
    await service.fetchFrameTiles(frame, [cached]);
    blockFetch = true;
    pending = service.fetchFrameTiles(frame, [missing]);
    await entered.promise;
    const result = await reader.request({
      protocolVersion: 1,
      requestId: 'saved',
      epoch,
      kind: 'tile.read',
      deadlineAt: new Date(base + 5000).toISOString(),
      payload: { layer: 'nowcast', frame, coordinate: cached },
    });
    assert.equal(result.result.status, 'completed');
    if (result.result.status !== 'completed') throw new Error('保存済み読取が失敗');
    assert.deepEqual(result.result.value, {
      kind: 'hit',
      bytes: new Uint8Array(png),
      contentType: 'image/png',
      storedAt: '2026-09-07T03:00:00.000Z',
      catalogAvailability: 'available',
    });
  } finally {
    blocked.resolve();
    await pending;
    reader.registry.close();
    db.close();
    fixture.cleanup();
  }
});

test('期限応答後も未完了executeの枠を保持し、64件を超える実行を受け付けない', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let now = base;
  const registry = new WeatherRequestRegistry(epoch, () => now);
  const blocker = deferred<null>();
  let executions = 0;
  const responses = Array.from({ length: 64 }, (_, i) =>
    registry.request(request(`timeout${i}`), () => {
      executions++;
      return blocker.promise;
    }),
  );
  await Promise.resolve();
  assert.equal(executions, 64);
  now += 5000;
  context.mock.timers.tick(5000);
  assert.deepEqual(
    (await Promise.all(responses)).map((reply) => reply.result),
    Array.from({ length: 64 }, () => ({ status: 'failed', code: 'deadline_exceeded' })),
  );
  assert.equal(registry.size, 64);
  const fresh = {
    ...request('overflow-after-timeout'),
    deadlineAt: new Date(now + 5000).toISOString(),
  };
  assert.deepEqual((await registry.request(fresh, async () => null)).result, {
    status: 'failed',
    code: 'busy',
  });
  blocker.resolve(null);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(registry.size, 0);
  assert.deepEqual((await registry.request(fresh, async () => null)).result, {
    status: 'completed',
    value: null,
  });
});

test('実初回警報経路の通常失敗は他会場・速報の初回keyを消費しない', async () => {
  const { createTemporaryTestDatabaseFixture, initializeTestDatabases } =
    await import('./helpers/databasePair.js');
  const { testVenueRegistry, testTerminalRegistry, eastVenueId } =
    await import('./helpers/venueConfigPreload.js');
  const { resolveVenueWarningContext } = await import('../src/venueForecastTargets.js');
  const { createStartupNotificationRuntime } = await import('../src/server.js');
  const fixture = createTemporaryTestDatabaseFixture();
  const db = initializeTestDatabases(fixture.config);
  const runtime = createStartupNotificationRuntime(
    db.weather.connection,
    () => new Date(base).toISOString(),
    testVenueRegistry,
    undefined,
    undefined,
    testTerminalRegistry,
    db.retained.connection,
    db.weatherDatabaseGenerationId,
  );
  try {
    const before = runtime.decisions.state.snapshot();
    // 当該会場の実初回評価だけを失敗させる。DBはこの試験専用。
    db.weather.connection.exec(
      'ALTER TABLE warning_current_snapshot RENAME TO unavailable_warning_snapshot',
    );
    await assert.rejects(
      runtime.evaluateInitialWarning(resolveVenueWarningContext(testVenueRegistry, eastVenueId)),
    );
    assert.deepEqual(runtime.decisions.state.snapshot(), {
      ...before,
      revision: before.revision + 1,
    });
    assert.deepEqual(runtime.decisions.state.getUnknownUnits(), []);
    assert.deepEqual(runtime.decisions.warning.exportSnapshot(), []);
    assert.deepEqual(runtime.decisions.bosai.exportSnapshot(), {
      completedKeys: [],
      collecting: true,
    });
  } finally {
    runtime.markStopped();
    db.close();
    fixture.cleanup();
  }
});

test('提供読取が失敗しても保持履歴全件を返し、原文欠落と読取不能を区別する', async () => {
  const { createTemporaryTestDatabaseFixture, initializeTestDatabases } =
    await import('./helpers/databasePair.js');
  const { createRetainedMonitoringHistory } =
    await import('../src/runtime/retainedMonitoringHistory.js');
  const { recordNotificationOutputHistory } = await import('../src/repositories/index.js');
  const fixture = createTemporaryTestDatabaseFixture();
  const db = initializeTestDatabases(fixture.config);
  const now = new Date(base).toISOString();
  const record = {
    notificationId: 'retained',
    category: 'warning',
    sourceType: 'warning_current',
    sourceVersion: null,
    targetAreaJson: null,
    occurredAt: now,
    detectedAt: now,
    changeType: 'new',
    ackRequired: false,
    summary: '保存済み履歴',
    relatedRefsJson: JSON.stringify([{ type: 'telegram_reception', ref: '1' }]),
    origin: 'weather' as const,
    detectionContext: 'normal' as const,
    isTraining: false,
    messageDefinitionId: null,
    messageDefinitionVersion: null,
    weatherDatabaseGenerationId: db.weatherDatabaseGenerationId,
  };
  try {
    recordNotificationOutputHistory(db.retained.connection, record);
    const history = createRetainedMonitoringHistory(
      db.retained.connection,
      async () => {
        throw new Error('提供停止');
      },
      () => now,
    );
    assert.deepEqual(await history.listNotificationOutputs({ limit: 100, offset: 0 }), {
      status: 'ready',
      generatedAt: now,
      totalCount: 1,
      limit: 100,
      offset: 0,
      items: [
        {
          ...record,
          id: 1,
          receptionReference: { status: 'unavailable', reason: 'weather_unavailable' },
        },
      ],
    });
    assert.deepEqual(await history.getNotificationReceptionById(1), {
      kind: 'unavailable',
      reason: 'weather_unavailable',
    });
  } finally {
    db.close();
    fixture.cleanup();
  }
});

test('保持sinkの保存失敗を実健全性通知結果へ反映し、世代交代後も再通知しない', async () => {
  const { createTemporaryTestDatabaseFixture, initializeTestDatabases } =
    await import('./helpers/databasePair.js');
  const { createWeatherDecisionRuntime } = await import('../src/runtime/weatherDecisionRuntime.js');
  const { aggregateFetchHealth } = await import('../src/monitoring/fetchHealthEvaluator.js');
  const { emitFetchHealthNotification } =
    await import('../src/notifications/fetchHealthNotificationEmitter.js');
  const fixture = createTemporaryTestDatabaseFixture();
  const db = initializeTestDatabases(fixture.config);
  const gate = new WeatherPublicationGate(epoch, epoch);
  const runtime = createWeatherDecisionRuntime(db.retained.connection, epoch, gate);
  const now = () => new Date(base).toISOString();
  const scope = { scopes: [], initialWarningKeys: [], initialBosaiKeys: [] };
  const evaluate = (status: 'normal' | 'delayed') =>
    runtime.runSync(scope, () =>
      emitFetchHealthNotification(
        undefined,
        aggregateFetchHealth(
          [
            {
              sourceId: 'xml_regular',
              status,
              reasons:
                status === 'normal'
                  ? []
                  : [
                      {
                        kind: 'consecutive_failures',
                        status,
                        sourceKind: 'xml_regular',
                        text: '連続失敗',
                      },
                    ],
              lastAttemptAt: now(),
              lastSuccessAt: now(),
              maxConsecutiveFailures: status === 'normal' ? 0 : 2,
              intervalSeconds: 60,
              lastDurationMs: 100,
            },
          ],
          now(),
        ),
        runtime.health,
        { now, recordSink: runtime.recordSink },
      ),
    );
  try {
    evaluate('normal');
    db.retained.connection.exec(
      "CREATE TRIGGER fail_notification BEFORE INSERT ON notification_output_history BEGIN SELECT RAISE(ABORT, '試験'); END",
    );
    const failed = evaluate('delayed');
    assert.deepEqual(failed.recorded, []);
    assert.deepEqual(failed.recordFailedSourceIds, ['xml_regular']);
    db.retained.connection.exec('DROP TRIGGER fail_notification');
    runtime.replaceEpoch({ ...epoch, workerGeneration: 'replacement' });
    const repeated = evaluate('delayed');
    assert.deepEqual(repeated.recorded, []);
    assert.deepEqual(repeated.recordFailedSourceIds, []);
    assert.equal(runtime.state.snapshot().revision, 3);
  } finally {
    db.close();
    fixture.cleanup();
  }
});

test('実構成の提供64件でstartupもbusyとなり、空きが戻るまでsession・claim・監査を保存しない', async () => {
  const { createTemporaryTestDatabaseFixture, initializeTestDatabases } =
    await import('./helpers/databasePair.js');
  const { testVenueRegistry, testTerminalRegistry, eastVenueId } =
    await import('./helpers/venueConfigPreload.js');
  const { createStartupNotificationRuntime } = await import('../src/server.js');
  const { createApplicationRuntime } = await import('../src/runtime/createApplicationRuntime.js');
  const { createWeatherApiService } = await import('../src/services/weatherApiService.js');
  const fixture = createTemporaryTestDatabaseFixture();
  const db = initializeTestDatabases(fixture.config);
  const now = () => new Date().toISOString();
  const blocked = deferred<null>();
  const unused = () => {
    throw new Error('この試験では呼び出さない');
  };
  const startup = createStartupNotificationRuntime(
    db.weather.connection,
    now,
    testVenueRegistry,
    undefined,
    undefined,
    testTerminalRegistry,
    db.retained.connection,
    db.weatherDatabaseGenerationId,
  );
  const runtime = createApplicationRuntime({
    deliveryEpoch: startup.deliveryEpoch,
    deliveryRegistry: startup.deliveryRegistry,
    acquisitionEpoch: startup.acquisitionEpoch,
    serverGenerationId: startup.serverGenerationId,
    weatherDatabaseGenerationId: db.weatherDatabaseGenerationId,
    weatherConnection: db.weather.connection,
    retainedConnection: db.retained.connection,
    weatherApi: createWeatherApiService({
      connection: db.weather.connection,
      venueRegistry: testVenueRegistry,
    }),
    nowcastApi: { getTimes: unused, getTile: unused, readTile: () => blocked.promise },
    kikikuruApi: { getTimes: unused, getTile: unused },
    monitoringProcessing: { getProcessing: unused },
  });
  const reads = Array.from({ length: 64 }, (_, i) =>
    runtime.readPort.request({
      protocolVersion: 1,
      requestId: `capacity${i}`,
      epoch: startup.deliveryEpoch,
      deadlineAt: new Date(Date.now() + 5000).toISOString(),
      kind: 'tile.read',
      payload: {
        layer: 'nowcast',
        frame: {
          product: 'N1',
          baseTime: now(),
          validTime: now(),
          element: 'hrpns',
          member: 'none',
        },
        coordinate: { zoom: 10, tileX: 910, tileY: 401 },
      },
    }),
  );
  const counts = () =>
    ['terminal_session', 'startup_warning_claim', 'startup_notification_inquiry'].map(
      (table) =>
        (
          db.retained.connection.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
            n: number;
          }
        ).n,
    );
  const input = {
    terminalId: 'kkeagh01',
    venueId: eastVenueId,
    sessionId: '00000000-0000-4000-8000-000000000900',
    serverGenerationId: startup.serverGenerationId,
    inquiredAt: now(),
  };
  try {
    startup.initialization.setInitialFetchPhase('completed');
    startup.initialization.markVenueEvaluated(eastVenueId);
    assert.equal(runtime.runtimeStatus('delivery').pendingRequests, 64);
    assert.deepEqual(counts(), [0, 0, 0]);
    await assert.rejects(Promise.resolve(startup.startupNotifications.inquire(input)), {
      code: 'busy',
    });
    assert.deepEqual(counts(), [0, 0, 0]);
    assert.equal(startup.deliveryRegistry.size, 64);
    blocked.resolve(null);
    const responses = await Promise.all(reads);
    assert.ok(responses.every((response) => response.result.status === 'completed'));
    assert.equal(startup.deliveryRegistry.size, 0);
    const accepted = await startup.startupNotifications.inquire(input);
    assert.equal(accepted.status, 'ready');
    assert.equal(accepted.status === 'ready' && accepted.warningClaimed, true);
    assert.deepEqual(counts(), [1, 1, 1]);
  } finally {
    blocked.resolve(null);
    await Promise.allSettled(reads);
    runtime.close();
    startup.markStopped();
    db.close();
    fixture.cleanup();
  }
});
