import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { arch, cpus, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Worker } from 'node:worker_threads';
import { startServer } from '../src/server.js';
import { NowcastTileStore } from '../src/polling/nowcastTileStore.js';
import { KikikuruTileStore } from '../src/polling/kikikuruTileStore.js';
import {
  mergeRadarSnapshot,
  saveWarningTimeseriesSnapshot,
  upsertRadarTile,
} from '../src/repositories/index.js';
import { saveRiskSnapshot } from '../src/repositories/riskRepository.js';
import { recordTelegramReception } from '../src/repositories/telegramReceptionRepository.js';
import { recordNotificationOutputHistory } from '../src/repositories/notificationOutputHistoryRepository.js';
import {
  createAlwaysOnTestPollingSchedule,
  createTestPollingSchedule,
} from './helpers/pollingSchedule.js';
import {
  createTestServerDatabaseOptions,
  initializeTestDatabases,
} from './helpers/databasePair.js';

test('実取得Workerのcache miss保留中も提供Workerの保存済みtileとtextが進む', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'wx-real-miss-'));
  const options = createTestServerDatabaseOptions({
    databasePath: join(directory, 'weather.sqlite3'),
    migrationsDirectory: join(import.meta.dirname, '../migrations'),
  });
  const now = new Date().toISOString();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  const frame = {
    product: 'N1' as const,
    baseTime: now,
    validTime: now,
    element: 'hrpns' as const,
    member: 'none' as const,
  };
  let trainingReceptionId = 0;
  const seed = initializeTestDatabases({
    databasePath: options.config.weather.databasePath,
    migrationsDirectory: join(import.meta.dirname, '../migrations'),
  });
  try {
    const reception = recordTelegramReception(seed.weather.connection, {
      fetchAttemptId: null,
      feedKind: 'regular',
      feedEntryId: 'delivery-reference',
      documentUrl: 'https://example.test/delivery-reference',
      telegramType: 'VPWS50',
      title: null,
      controlStatus: 'normal',
      infoType: null,
      eventId: null,
      serial: null,
      controlDateTime: null,
      reportDateTime: null,
      targetDateTime: null,
      receivedAt: now,
      rawBody: '<Report>提供Worker原文</Report>',
      bodyBytes: Buffer.byteLength('<Report>提供Worker原文</Report>'),
      contentHash: null,
      areas: [],
      adoptions: [],
    });
    recordNotificationOutputHistory(seed.retained.connection, {
      notificationId: 'delivery-reference',
      category: 'warning',
      sourceType: 'weather_warning',
      sourceVersion: null,
      targetAreaJson: null,
      occurredAt: now,
      detectedAt: now,
      changeType: 'issued',
      ackRequired: false,
      summary: '提供Worker原文参照',
      relatedRefsJson: JSON.stringify([{ type: 'telegram_reception', ref: String(reception.id) }]),
      origin: 'weather',
      detectionContext: 'normal',
      isTraining: false,
      messageDefinitionId: null,
      messageDefinitionVersion: null,
      weatherDatabaseGenerationId: seed.weatherDatabaseGenerationId,
    });
    const trainingReception = recordTelegramReception(seed.weather.connection, {
      fetchAttemptId: null,
      feedKind: 'regular',
      feedEntryId: 'delivery-training-reference',
      documentUrl: 'https://example.test/delivery-training-reference',
      telegramType: 'VPWS50',
      title: null,
      controlStatus: 'training',
      infoType: null,
      eventId: null,
      serial: null,
      controlDateTime: null,
      reportDateTime: null,
      targetDateTime: null,
      receivedAt: now,
      rawBody: '<Report>訓練提供Worker原文</Report>',
      bodyBytes: Buffer.byteLength('<Report>訓練提供Worker原文</Report>'),
      contentHash: null,
      areas: [],
      adoptions: [],
    });
    trainingReceptionId = trainingReception.id;
    recordNotificationOutputHistory(seed.retained.connection, {
      notificationId: 'delivery-training-reference',
      category: 'warning',
      sourceType: 'weather_warning',
      sourceVersion: null,
      targetAreaJson: null,
      occurredAt: now,
      detectedAt: now,
      changeType: 'issued',
      ackRequired: false,
      summary: '訓練提供Worker原文参照',
      relatedRefsJson: JSON.stringify([
        { type: 'telegram_reception', ref: String(trainingReception.id) },
      ]),
      origin: 'weather',
      detectionContext: 'normal',
      isTraining: true,
      messageDefinitionId: null,
      messageDefinitionVersion: null,
      weatherDatabaseGenerationId: seed.weatherDatabaseGenerationId,
    });
    saveWarningTimeseriesSnapshot(seed.weather.connection, {
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
        sourceVersion: 'barrier-fixture',
      },
      telegram: {
        controlStatus: 'normal',
        infoType: '発表',
        eventId: null,
        reportDateTime: now,
        controlDateTime: now,
      },
      timeDefines: [],
      values: [],
    });
    mergeRadarSnapshot(seed.weather.connection, {
      product: 'N1',
      metadata: {
        source: 'test',
        issuedAt: now,
        validAt: now,
        validFrom: now,
        validTo: now,
        fetchedAt: now,
        lastSuccessAt: now,
        availability: 'available',
        sourceVersion: 'barrier-fixture',
      },
      frames: [{ ...frame, sequence: 0 }],
    });
    const saved = await new NowcastTileStore(options.nowcastCacheRoot).saveTile('hit.png', png);
    upsertRadarTile(seed.weather.connection, frame, {
      zoom: 10,
      tileX: 1,
      tileY: 1,
      filePath: 'hit.png',
      byteSize: saved.byteSize,
      contentHash: saved.contentHash,
      storedAt: now,
    });
    const riskSaved = await new KikikuruTileStore(options.kikikuruCacheRoot).saveTile(
      'hit-risk.png',
      png,
    );
    saveRiskSnapshot(seed.weather.connection, {
      layer: 'heavyrain',
      metadata: {
        source: 'test',
        issuedAt: now,
        validAt: now,
        validFrom: now,
        validTo: now,
        fetchedAt: now,
        lastSuccessAt: now,
        availability: 'available',
        sourceVersion: 'barrier-fixture',
      },
      frames: [
        {
          baseTime: now,
          validTime: now,
          imageId: 'rain_mesh',
          member: 'none',
          sequence: 0,
          tiles: [
            {
              zoom: 10,
              tileX: 1,
              tileY: 1,
              filePath: 'hit-risk.png',
              byteSize: riskSaved.byteSize,
              contentHash: riskSaved.contentHash,
              storedAt: now,
            },
          ],
        },
      ],
    });
  } finally {
    seed.close();
  }
  let worker: Worker | undefined;
  let deliveryWorker: Worker | undefined;
  const observed: string[] = [];
  let entered!: (value: number) => void;
  let tileFetches = 0;
  const waitingForEnsure = new Promise<number>((resolve) => {
    entered = resolve;
  });
  const server = await startServer({
    ...options,
    port: 0,
    enablePolling: true,
    pollingSchedule: createAlwaysOnTestPollingSchedule(),
    pollingServiceOptions: { clock: () => now },
    weatherRequestObserver: (request) => {
      observed.push(request.kind);
    },
    onDeliveryWorkerCreated: (value) => {
      deliveryWorker = value;
    },
    acquisitionWorkerEntry: new URL(
      './fixtures/worker/acquisition-tile-barrier.ts',
      import.meta.url,
    ),
    onAcquisitionWorkerCreated: (value) => {
      worker = value;
      value.on('message', (message) => {
        if (message.test === 'tile-ensure-entered') {
          tileFetches = message.tileFetches;
          entered(message.tileFetches);
        }
      });
    },
  });
  const root = `http://127.0.0.1:${server.port}`;
  const tile = (x: number) =>
    `${root}/api/weather/nowcast/N1/tiles/10/${x}/${x}.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${now}&validTime=${now}`;
  const riskTile = `${root}/api/weather/kikikuru/heavyrain/tiles/10/1/1.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${now}&validTime=${now}&imageId=rain_mesh&member=none`;
  try {
    assert.equal((await server.weatherPrepared).status, 'ready');
    const routes = [
      ...[
        'warnings',
        'warning-timeseries',
        'early-warning',
        'area-timeseries',
        'amedas',
        'bulletins',
      ].map((kind) => `${root}/api/weather/${kind}?terminalId=hkeagh01&controlStatus=normal`),
      `${root}/api/weather/nowcast/times?terminalId=hkeagh01&controlStatus=normal`,
      `${root}/api/weather/kikikuru/times?terminalId=hkeagh01&controlStatus=normal`,
      `${root}/api/monitoring/processing?terminalId=hkeagh01`,
      `${root}/api/monitoring/receptions`,
      `${root}/api/monitoring/receptions/1`,
      `${root}/api/monitoring/notification-outputs/1/reception`,
      tile(1),
      riskTile,
    ];
    for (const route of routes) {
      const result = await fetch(route);
      assert.equal(result.status, 200, `${route}: ${result.status}`);
      assert.equal(result.headers.get('cache-control'), 'no-store', route);
      if (route === tile(1) || route === riskTile) {
        assert.equal(result.headers.get('content-type'), 'image/png');
        assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(result.headers.get('x-wx-tile-result'), 'cached');
        assert.equal(result.headers.get('x-wx-tile-stored-at'), now);
      } else if (!route.includes('/notification-outputs/1/reception')) {
        assert.equal(result.headers.get('content-type')?.includes('application/json'), true);
      }
      const body = await result.arrayBuffer();
      if (route === tile(1) || route === riskTile) assert.deepEqual(Buffer.from(body), png);
      if (route.includes('/notification-outputs/1/reception'))
        assert.equal(Buffer.from(body).toString().includes('提供Worker原文'), true);
    }
    for (const controlStatus of ['normal', 'training', 'test'] as const) {
      for (const endpoint of [
        'warnings',
        'warning-timeseries',
        'early-warning',
        'area-timeseries',
        'amedas',
        'bulletins',
        'nowcast/times',
        'kikikuru/times',
      ]) {
        const response = await fetch(
          `${root}/api/weather/${endpoint}?terminalId=hkeagh01&controlStatus=${controlStatus}`,
        );
        assert.equal(response.status, 200, `${endpoint}:${controlStatus}`);
        const body = (await response.json()) as {
          controlStatus: string;
          isTraining: boolean;
        };
        assert.equal(body.controlStatus, controlStatus, endpoint);
        assert.equal(body.isTraining, controlStatus === 'training', endpoint);
      }
    }
    const trainingHistory = (await (
      await fetch(`${root}/api/monitoring/receptions?controlStatus=training`)
    ).json()) as { totalCount: number; items: { controlStatus: string }[] };
    assert.equal(trainingHistory.totalCount, 1);
    assert.equal(trainingHistory.items[0]?.controlStatus, 'training');
    const trainingDetail = (await (
      await fetch(`${root}/api/monitoring/receptions/${trainingReceptionId}`)
    ).json()) as { reception: { controlStatus: string; rawBody: string } };
    assert.equal(trainingDetail.reception.controlStatus, 'training');
    assert.equal(trainingDetail.reception.rawBody, '<Report>訓練提供Worker原文</Report>');
    const trainingOutputs = (await (
      await fetch(`${root}/api/monitoring/notification-outputs?isTraining=true`)
    ).json()) as { totalCount: number; items: { id: number; isTraining: boolean }[] };
    assert.equal(trainingOutputs.totalCount, 1);
    assert.equal(trainingOutputs.items[0]?.isTraining, true);
    const trainingReference = await fetch(
      `${root}/api/monitoring/notification-outputs/${trainingOutputs.items[0]!.id}/reception`,
    );
    assert.equal(trainingReference.status, 200);
    assert.equal((await trainingReference.text()).includes('訓練提供Worker原文'), true);
    const startup = await fetch(`${root}/api/notifications/startup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        terminalId: 'hkeagh01',
        sessionId: randomUUID(),
        serverGenerationId: server.acquisitionHost.epoch.serverGenerationId,
      }),
    });
    assert.equal([200, 202].includes(startup.status), true);
    await startup.arrayBuffer();
    for (const kind of [
      'weather.read',
      'image.times',
      'monitoring.processing',
      'history.receptions',
      'history.reception',
      'tile.read',
    ])
      assert.equal(observed.includes(kind), true, `${kind}が提供Workerへ送られていません`);
    assert.equal(server.deliveryHost.status().mode, 'worker');
    assert.equal((deliveryWorker?.threadId ?? 0) > 0, true);
    assert.equal(observed.includes('monitoring.sample'), true);
    const miss = fetch(tile(2));
    const fetches = await Promise.race([
      waitingForEnsure,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('ensure未到達')), 5000)),
    ]);
    assert.equal(fetches, 1);
    const joinedController = new AbortController();
    const joined = fetch(tile(2), { signal: joinedController.signal });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(tileFetches, 1);
    joinedController.abort();
    await assert.rejects(joined);
    const elapsed: number[] = [];
    for (let index = 0; index < 20; index++) {
      const started = performance.now();
      const [tileResponse, textResponse] = await Promise.all([
        fetch(tile(1)),
        fetch(`${root}/api/weather/warning-timeseries?terminalId=hkeagh01&controlStatus=normal`),
      ]);
      assert.equal(tileResponse.status, 200);
      assert.deepEqual(Buffer.from(await tileResponse.arrayBuffer()), png);
      assert.equal(textResponse.status, 200);
      assert.equal(((await textResponse.json()) as { data: unknown }).data !== null, true);
      const duration = performance.now() - started;
      elapsed.push(duration);
      assert.equal(duration < 2000, true);
    }
    elapsed.sort((a, b) => a - b);
    t.diagnostic(
      JSON.stringify({
        realMissBarrier: {
          count: elapsed.length,
          maximumMs: elapsed.at(-1),
          p95Ms: elapsed[18],
          tileFetches: fetches,
        },
      }),
    );
    worker!.postMessage({ test: 'release-tile' });
    const response = await miss;
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    const deadlineStarted = performance.now();
    const expired = fetch(tile(3));
    while (tileFetches < 2) {
      if (performance.now() - deadlineStarted > 5000) throw new Error('2件目のensure未到達');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const expiredResponse = await expired;
    assert.equal(expiredResponse.status >= 400, true);
    assert.equal(performance.now() - deadlineStarted < 30000, true);
    assert.equal(tileFetches, 2);
    const controller = new AbortController();
    const aborted = fetch(tile(4), { signal: controller.signal });
    const abortStarted = performance.now();
    while (tileFetches < 3) {
      if (performance.now() - abortStarted > 5000) throw new Error('3件目のensure未到達');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    controller.abort();
    await assert.rejects(aborted);
    while (server.acquisitionHost.status().pendingRequests > 0) {
      if (performance.now() - abortStarted > 5000) throw new Error('取得予約が解除されません');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(tileFetches, 3);
    worker!.postMessage({ test: 'release-tile' });
    const activeTiles = [5, 6, 7, 8].map((x) => fetch(tile(x)));
    const queuedStarted = performance.now();
    while (server.acquisitionHost.status().pendingRequests < 4) {
      if (performance.now() - queuedStarted > 5000)
        throw new Error('4件の取得要求が登録されません');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const queuedController = new AbortController();
    const queuedTile = fetch(tile(9), { signal: queuedController.signal });
    while (server.acquisitionHost.status().pendingRequests < 5) {
      if (performance.now() - queuedStarted > 5000) throw new Error('取得待機要求が登録されません');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    queuedController.abort();
    await assert.rejects(queuedTile);
    while (server.acquisitionHost.status().pendingRequests > 4) {
      if (performance.now() - queuedStarted > 5000) throw new Error('取得待機要求が解除されません');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    worker!.postMessage({ test: 'release-all' });
    for (const activeTile of activeTiles) {
      const activeResponse = await activeTile;
      assert.equal(activeResponse.status, 200);
      assert.deepEqual(Buffer.from(await activeResponse.arrayBuffer()), png);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(tileFetches, 7, '中断した未開始タイルは上流取得しない');
    const stopResponse = await fetch(`${root}/api/control/fetch/stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: randomUUID() }),
    });
    assert.equal(stopResponse.status, 200);
    assert.equal(server.acquisitionHost.desiredRunning, false);
    const paths = [
      ['health', `${root}/api/health`, 500],
      ['monitoring', `${root}/api/monitoring/status?terminalId=hkeagh01`, 1000],
      ['system', `${root}/api/notifications/delta?origin=system&terminalId=hkeagh01`, 2000],
      [
        'text',
        `${root}/api/weather/warning-timeseries?terminalId=hkeagh01&controlStatus=normal`,
        2000,
      ],
      ['tile', tile(1), 2000],
    ] as const;
    const measure = async (scenario: string) => {
      const timings: Record<string, { count: number; maximumMs: number; p95Ms: number }> = {};
      for (const [name, url, bound] of paths) {
        const values: number[] = [];
        for (let index = 0; index < 20; index++) {
          const started = performance.now();
          const response = await fetch(url);
          assert.equal(response.status, 200, `${scenario}:${name}`);
          if (name === 'tile') assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
          else {
            const body = (await response.json()) as { data?: unknown };
            if (name === 'text') assert.equal(body.data !== null, true);
          }
          values.push(performance.now() - started);
        }
        values.sort((a, b) => a - b);
        assert.equal(values.at(-1)! < bound, true, `${scenario}:${name}=${values.at(-1)}ms`);
        timings[name] = { count: values.length, maximumMs: values.at(-1)!, p95Ms: values[18]! };
      }
      t.diagnostic(
        JSON.stringify({
          scenario,
          timings,
          platform: platform(),
          arch: arch(),
          cpu: cpus()[0]?.model,
          cpuCount: cpus().length,
          fixture: {
            warningSnapshots: 1,
            radarFrames: 1,
            cachedTiles: 1,
            pngBytes: png.byteLength,
          },
        }),
      );
    };
    await measure('normal-stop');
    const stoppedMissStarted = performance.now();
    const stoppedMiss = await fetch(tile(9));
    assert.equal(stoppedMiss.status >= 400, true);
    assert.equal(performance.now() - stoppedMissStarted < 30_000, true);
    assert.equal(tileFetches, 7, '停止中のmissで上流取得しない');
    await worker!.terminate();
    const exitStarted = performance.now();
    while (!server.acquisitionHost.status().exitConfirmed) {
      if (performance.now() - exitStarted > 5000) throw new Error('取得Workerのexit未確認');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await measure('unexpected-exit');
    const failedMissStarted = performance.now();
    const failedMiss = await fetch(tile(9));
    assert.equal(failedMiss.status >= 400, true);
    assert.equal(performance.now() - failedMissStarted < 30_000, true);
    assert.equal(tileFetches, 7, '取得Worker異常終了後のmissで上流取得しない');
  } finally {
    worker?.postMessage({ test: 'release-tile' });
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('夜間相当の取得停止中は保存済みhitを返し、未保存missは上流取得せず有限503', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'wx-night-miss-'));
  const options = createTestServerDatabaseOptions({
    databasePath: join(directory, 'weather.sqlite3'),
    migrationsDirectory: join(import.meta.dirname, '../migrations'),
  });
  const now = new Date().toISOString();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  const frame = {
    product: 'N1' as const,
    baseTime: now,
    validTime: now,
    element: 'hrpns' as const,
    member: 'none' as const,
  };
  const seed = initializeTestDatabases({
    databasePath: options.config.weather.databasePath,
    migrationsDirectory: join(import.meta.dirname, '../migrations'),
  });
  try {
    mergeRadarSnapshot(seed.weather.connection, {
      product: 'N1',
      metadata: {
        source: 'test',
        issuedAt: now,
        validAt: now,
        validFrom: now,
        validTo: now,
        fetchedAt: now,
        lastSuccessAt: now,
        availability: 'available',
        sourceVersion: 'night-fixture',
      },
      frames: [{ ...frame, sequence: 0 }],
    });
    const saved = await new NowcastTileStore(options.nowcastCacheRoot).saveTile('night.png', png);
    upsertRadarTile(seed.weather.connection, frame, {
      zoom: 10,
      tileX: 1,
      tileY: 1,
      filePath: 'night.png',
      byteSize: saved.byteSize,
      contentHash: saved.contentHash,
      storedAt: now,
    });
  } finally {
    seed.close();
  }
  let tileFetches = 0;
  const schedule = createTestPollingSchedule();
  const server = await startServer({
    ...options,
    enablePolling: true,
    port: 0,
    pollingSchedule: {
      ...schedule,
      periods: schedule.periods.map((period) => ({
        ...period,
        xmlSeconds: null,
        imageCatalogSeconds: null,
        amedasSeconds: null,
        nowcastEnabled: false,
        kikikuruEnabled: false,
      })),
    },
    pollingServiceOptions: { clock: () => now },
    acquisitionWorkerEntry: new URL(
      './fixtures/worker/acquisition-tile-barrier.ts',
      import.meta.url,
    ),
    onAcquisitionWorkerCreated: (worker) => {
      worker.on('message', (message) => {
        if (message.test === 'tile-ensure-entered') tileFetches++;
      });
    },
  });
  const root = `http://127.0.0.1:${server.port}`;
  const tile = (x: number) =>
    `${root}/api/weather/nowcast/N1/tiles/10/${x}/${x}.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${now}&validTime=${now}`;
  try {
    assert.equal((await server.weatherPrepared).status, 'ready');
    const cached = await fetch(tile(1));
    assert.equal(cached.status, 200);
    assert.deepEqual(Buffer.from(await cached.arrayBuffer()), png);
    const started = performance.now();
    const missing = await fetch(tile(2));
    assert.equal(missing.status, 503);
    assert.equal(performance.now() - started < 30_000, true);
    assert.equal(tileFetches, 0);
  } finally {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
