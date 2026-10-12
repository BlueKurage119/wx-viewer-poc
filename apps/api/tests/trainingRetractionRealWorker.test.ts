import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import type { NotificationDeltaReadyResponse } from '@wx-viewer-poc/shared';
import { startInlineServer, startServer } from '../src/server.js';
import { generateTrainingTelegrams } from '../src/training/trainingTelegramGenerator.js';
import {
  createTemporaryTestDatabaseFixture,
  createTestServerDatabaseOptions,
  readTestDatabases,
} from './helpers/databasePair.js';
import {
  createAlwaysOnTestPollingSchedule,
  createTestPollingSchedule,
} from './helpers/pollingSchedule.js';

/**
 * 実の取得 Worker を起動し、注入 → 抹消（行・全）→ 再注入を HTTP 経由で一続きに確認する結合試験。
 * 設計書 Issue #71・#73「通知の抑止（Q1）」の確認。抹消では通知・出力履歴が増えず、画面の現況から訓練表示が消える。
 */

const K_EAST = 'kkeagh01';
const GEN = (n: number) =>
  `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function withRealWorker<T>(
  run: (ctx: {
    root: string;
    dbPath: string;
    get: (path: string) => Promise<{ status: number; cacheControl: string | null; json: Json }>;
    inject: (
      itemIds: string[],
      now: string,
      generationId: string,
    ) => Promise<{ status: number; json: Json }>;
    retract: (body: unknown) => Promise<{ status: number; json: Json }>;
    readWeather: () => ReturnType<typeof readTestDatabases>;
    deltaWeather: () => Promise<NotificationDeltaReadyResponse>;
  }) => Promise<T>,
): Promise<T> {
  const fixture = createTemporaryTestDatabaseFixture();
  const options = createTestServerDatabaseOptions(fixture.config);
  const server = await startServer({
    ...options,
    port: 0,
    enablePolling: true,
    pollingSchedule: createAlwaysOnTestPollingSchedule(),
    nowcastCacheRoot: join(fixture.config.databasePath, '..', 'nowcast'),
    kikikuruCacheRoot: join(fixture.config.databasePath, '..', 'kikikuru'),
    acquisitionWorkerEntry: new URL('./fixtures/worker/training-fetch-stub.ts', import.meta.url),
  });
  const root = `http://127.0.0.1:${server.port}`;
  const get = async (path: string) => {
    const response = await fetch(`${root}${path}`);
    const text = await response.text();
    let json: Json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // JSON でない応答
    }
    return { status: response.status, cacheControl: response.headers.get('cache-control'), json };
  };
  const inject = async (itemIds: string[], now: string, generationId: string) => {
    const [telegram] = generateTrainingTelegrams(itemIds as never, { now, generationId });
    const response = await fetch(`${root}/api/training/inject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        terminalId: K_EAST,
        telegrams: [
          {
            previewId: `${generationId}:0`,
            generatedAt: now,
            itemIds: telegram!.itemIds,
            telegramType: telegram!.telegramType,
            xml: telegram!.xml,
          },
        ],
      }),
    });
    return { status: response.status, json: await response.json() };
  };
  const retract = async (body: unknown) => {
    const response = await fetch(`${root}/api/training/retract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() };
  };
  const deltaWeather = async (): Promise<NotificationDeltaReadyResponse> => {
    const system = (await get(`/api/notifications/delta?terminalId=${K_EAST}&origin=system`)).json;
    const weather = await get(
      `/api/notifications/delta?terminalId=${K_EAST}&origin=weather&cursor=0&serverGenerationId=${system.serverGenerationId}`,
    );
    assert.equal(weather.status, 200, JSON.stringify(weather.json));
    return weather.json as NotificationDeltaReadyResponse;
  };
  try {
    assert.equal((await server.weatherPrepared).status, 'ready');
    // 初期取得（空フィード）が完了し、天気由来通知の配信が ready になるまで待つ
    for (let attempt = 0; ; attempt += 1) {
      const system = (await get(`/api/notifications/delta?terminalId=${K_EAST}&origin=system`))
        .json;
      const weather = await get(
        `/api/notifications/delta?terminalId=${K_EAST}&origin=weather&cursor=0&serverGenerationId=${system.serverGenerationId}`,
      );
      if (weather.status === 200) break;
      assert.ok(attempt < 100, '天気由来通知の配信が ready になりません');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return await run({
      root,
      dbPath: fixture.config.databasePath,
      get,
      inject,
      retract,
      readWeather: () => readTestDatabases(fixture.config),
      deltaWeather,
    });
  } finally {
    await server.close();
    fixture.cleanup();
  }
}

/** 時刻の揺れる項目を落とした比較用の写し。 */
function withoutTimes(value: Json): Json {
  const volatile = new Set(['evaluatedAt', 'generatedAt', 'fetchedAt', 'lastSuccessAt']);
  return JSON.parse(JSON.stringify(value), (key, v) => (volatile.has(key) ? undefined : v));
}

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function weatherItems(delta: NotificationDeltaReadyResponse) {
  return delta.notifications.filter((n) => n.origin === 'weather');
}

function historyCount(databases: ReturnType<typeof readTestDatabases>): number {
  return (
    databases.retained.connection
      .prepare('SELECT COUNT(*) AS c FROM notification_output_history')
      .get() as { c: number }
  ).c;
}

test('実Worker: 抹消では通知・出力履歴が増えず訓練表示が消え、再注入では新規の訓練通知が出る。注入と抹消は直列', async () => {
  await withRealWorker(async (ctx) => {
    const warnings = () =>
      ctx.get(`/api/weather/warnings?terminalId=${K_EAST}&controlStatus=training`);
    const bulletins = () =>
      ctx.get(`/api/weather/bulletins?terminalId=${K_EAST}&controlStatus=training`);
    const normalPaths = [
      `/api/weather/bulletins?terminalId=${K_EAST}&controlStatus=normal`,
      `/api/weather/warnings?terminalId=${K_EAST}&controlStatus=normal`,
    ];
    const beforeNormal = await Promise.all(normalPaths.map((p) => ctx.get(p)));

    // 警報・速報（VPBS50・VPHW50）を別の訓練として注入する
    const warning = await ctx.inject(['warning-03'], nowIso(), GEN(1));
    const bulletin = await ctx.inject(['bulletin-tornado'], nowIso(), GEN(2));
    const linear = await ctx.inject(['bulletin-linear-occurrence'], nowIso(), GEN(3));
    for (const r of [warning, bulletin, linear])
      assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(JSON.stringify((await warnings()).json).includes('レベル３大雨警報'));
    assert.equal((await bulletins()).json.bulletins.length, 2);

    const injectionNotices = weatherItems(await ctx.deltaWeather());
    assert.equal(injectionNotices.length, 3, '注入時の訓練通知は従来どおり記録されている');
    assert.ok(injectionNotices.every((n) => n.isTraining));
    let databases = ctx.readWeather();
    const historyAfterInjection = historyCount(databases);
    databases.close();
    assert.ok(historyAfterInjection >= 3);

    // 行抹消（速報2件の訓練）
    const rowRetract = await ctx.retract({
      terminalId: K_EAST,
      scope: 'training',
      trainingIds: [bulletin.json.trainingId, linear.json.trainingId],
    });
    assert.equal(rowRetract.status, 200, JSON.stringify(rowRetract.json));
    assert.deepEqual(
      rowRetract.json.telegrams.map((t: Json) => t.outcome),
      ['cancelled', 'cancelled'],
    );
    // 速報は取消済み（isCancelled）として返り、速報パネルは取消を表示対象から外す
    const cancelledBulletins = (await bulletins()).json.bulletins as { isCancelled: boolean }[];
    assert.equal(cancelledBulletins.length, 2);
    assert.ok(cancelledBulletins.every((b) => b.isCancelled));
    assert.ok(JSON.stringify((await warnings()).json).includes('レベル３大雨警報'));

    // 全抹消
    const allRetract = await ctx.retract({ terminalId: K_EAST, scope: 'all' });
    assert.equal(allRetract.status, 200, JSON.stringify(allRetract.json));
    assert.equal(allRetract.json.telegrams.at(-1).role, 'baseline');
    assert.equal(allRetract.json.telegrams.at(-1).outcome, 'cancelled');
    assert.ok(!JSON.stringify((await warnings()).json).includes('レベル３大雨警報'));

    // 抹消の前後で出力履歴の行数が変わらず、通知差分API に新しい通知が出ない
    databases = ctx.readWeather();
    try {
      assert.equal(historyCount(databases), historyAfterInjection);
      const cancelReceptions = databases.weather.connection
        .prepare(
          "SELECT COUNT(*) AS c FROM telegram_reception WHERE document_url LIKE 'training://%/r%'",
        )
        .get() as { c: number };
      assert.equal(cancelReceptions.c, 4, '取消電文は通常経路で受信・記録されている');
    } finally {
      databases.close();
    }
    const afterRetractNotices = weatherItems(await ctx.deltaWeather());
    assert.deepEqual(
      afterRetractNotices.map((n) => n.notificationId),
      injectionNotices.map((n) => n.notificationId),
    );

    // 抹消後に同じ内容の警報を再注入すると、is_training の新規通知が記録される
    const again = await ctx.inject(['warning-03'], nowIso(120_000), GEN(4));
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.ok(again.json.baseline, '全抹消後は基準電文が再投入される');
    assert.ok(JSON.stringify((await warnings()).json).includes('レベル３大雨警報'));
    const afterAgain = weatherItems(await ctx.deltaWeather());
    assert.equal(afterAgain.length, injectionNotices.length + 1);
    const fresh = afterAgain.filter(
      (n) => !injectionNotices.some((old) => old.notificationId === n.notificationId),
    );
    assert.equal(fresh.length, 1);
    assert.equal(fresh[0]!.isTraining, true);
    assert.equal(fresh[0]!.output.summary, '気象警報発表\n江東区\nレベル３大雨警報');

    // 通常（normal）の応答は一連の操作の前後で同一
    const afterNormal = await Promise.all(normalPaths.map((p) => ctx.get(p)));
    assert.deepEqual(
      afterNormal.map((r) => withoutTimes(r.json)),
      beforeNormal.map((r) => withoutTimes(r.json)),
    );

    // 注入と抹消を同時に呼んでも直列に処理される（実行区間が重ならない）
    const [injected, retracted] = await Promise.all([
      ctx.inject(['warning-14'], nowIso(240_000), GEN(5)),
      ctx.retract({ terminalId: K_EAST, scope: 'all' }),
    ]);
    assert.equal(injected.status, 200, JSON.stringify(injected.json));
    assert.equal(retracted.status, 200, JSON.stringify(retracted.json));
    databases = ctx.readWeather();
    try {
      const inj = databases.weather.connection
        .prepare(
          'SELECT accepted_at AS a, finished_at AS f FROM training_injection WHERE training_id = ?',
        )
        .get(injected.json.trainingId) as { a: string; f: string };
      const ret = databases.weather.connection
        .prepare(
          'SELECT accepted_at AS a, finished_at AS f FROM training_retraction WHERE retraction_id = ?',
        )
        .get(retracted.json.retractionId) as { a: string; f: string };
      assert.ok(inj.f <= ret.a || ret.f <= inj.a, JSON.stringify({ inj, ret }));
    } finally {
      databases.close();
    }
  });
});

test('実Worker: 抹消の直後に送った「一覧から外す」は同じキューで抹消の完了後に処理され、200になる', async () => {
  await withRealWorker(async (ctx) => {
    const injected = await ctx.inject(['warning-03'], nowIso(), GEN(8));
    assert.equal(injected.status, 200, JSON.stringify(injected.json));
    const trainingIds = [injected.json.trainingId];
    const post = async (path: string, body: unknown) => {
      const response = await fetch(`${ctx.root}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: response.status, json: await response.json() };
    };
    const retracting = ctx.retract({ terminalId: K_EAST, scope: 'training', trainingIds });
    await new Promise((resolve) => setTimeout(resolve, 3));
    const hiding = post('/api/training/injections/hide', { terminalId: K_EAST, trainingIds });
    const [retracted, hidden] = await Promise.all([retracting, hiding]);
    assert.equal(retracted.status, 200, JSON.stringify(retracted.json));
    assert.equal(hidden.status, 200, JSON.stringify(hidden.json));
    assert.deepEqual(hidden.json, { hiddenTrainingIds: trainingIds });
    const list = await ctx.get(`/api/training/injections?terminalId=${K_EAST}`);
    assert.deepEqual(list.json.injections, []);
  });
});

test('インライン起動(createApplicationRuntime)では抹消APIが 503 training_retraction_unavailable', async () => {
  const fixture = createTemporaryTestDatabaseFixture();
  const options = createTestServerDatabaseOptions(fixture.config);
  const server = await startInlineServer({
    ...options,
    port: 0,
    enablePolling: false,
    pollingSchedule: createTestPollingSchedule(),
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/training/retract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ terminalId: K_EAST, scope: 'all' }),
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      status: 'error',
      code: 'training_retraction_unavailable',
    });
  } finally {
    await server.close();
    fixture.cleanup();
  }
});
