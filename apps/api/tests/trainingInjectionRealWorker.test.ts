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
 * 実の取得 Worker（外部通信だけ空フィードを返す偽 fetch に差し替えた入口）を起動し、
 * 注入 → 出力履歴 → 通知差分API → 現況・速報API を HTTP 経由で一続きに確認する結合試験。
 * 設計書 Issue #70・#72 の「ランタイム関数の単体試験＋実Worker起動の結合試験」の後者。
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

test('実Worker: 速報の訓練通知が isTraining=true で出力履歴・通知差分APIに現れ、normal の応答は注入前後で同一', async () => {
  await withRealWorker(async (ctx) => {
    const normalPaths = [
      `/api/weather/bulletins?terminalId=${K_EAST}&controlStatus=normal`,
      `/api/weather/warnings?terminalId=${K_EAST}&controlStatus=normal`,
    ];
    const beforeNormal = await Promise.all(normalPaths.map((p) => ctx.get(p)));
    const beforeDelta = await ctx.deltaWeather();
    assert.equal(weatherItems(beforeDelta).length, 0);

    const injected = await ctx.inject(['bulletin-tornado'], nowIso(), GEN(1));
    assert.equal(injected.status, 200, JSON.stringify(injected.json));
    assert.equal(injected.json.baseline, null);
    assert.equal(injected.json.telegrams[0].sequence, 0);

    // 通知差分API: 訓練の通知が isTraining:true で1件
    const afterDelta = await ctx.deltaWeather();
    const notices = weatherItems(afterDelta);
    assert.equal(notices.length, 1);
    assert.equal(notices[0]!.isTraining, true);
    assert.equal(notices[0]!.sourceType, 'bosai_bulletin');
    assert.equal(notices[0]!.output.summary, '気象防災速報発表\n江東区\n竜巻注意');
    assert.ok(
      notices[0]!.relatedRefs.some(
        (r) =>
          r.type === 'telegram_reception' &&
          r.ref === String(injected.json.telegrams[0].receptionId),
      ),
    );

    // 出力履歴（保持DB）: is_training=1
    const databases = ctx.readWeather();
    try {
      const rows = databases.retained.connection
        .prepare(
          "SELECT is_training AS t, notification_id AS id FROM notification_output_history WHERE origin = 'weather'",
        )
        .all() as { t: number; id: string }[];
      // 会場ごとに1行ずつ記録される（会場数は設定に依る）。weather 由来はすべて訓練で、配信された通知を含む
      assert.ok(rows.length >= 1);
      assert.ok(rows.every((row) => row.t === 1));
      assert.ok(rows.some((row) => row.id === notices[0]!.notificationId));
    } finally {
      databases.close();
    }

    // 訓練の速報API
    const training = await ctx.get(
      `/api/weather/bulletins?terminalId=${K_EAST}&controlStatus=training`,
    );
    assert.equal(training.status, 200);
    assert.equal(training.json.controlStatus, 'training');
    assert.equal(training.json.isTraining, true);
    assert.equal(training.json.bulletins.length, 1);
    assert.equal(training.json.bulletins[0].telegramType, 'VPHW50');

    // normal は注入前後で同一（時刻項目を除く）
    const afterNormal = await Promise.all(normalPaths.map((p) => ctx.get(p)));
    assert.deepEqual(
      afterNormal.map((r) => withoutTimes(r.json)),
      beforeNormal.map((r) => withoutTimes(r.json)),
    );
    assert.equal(afterNormal[0]!.json.isTraining, false);
    // 通常の通知は増えていない（訓練以外の weather 通知は注入前後とも0件）
    assert.equal(weatherItems(afterDelta).filter((n) => !n.isTraining).length, 0);
  });
});

test('実Worker: 警報の基準電文(H1)・訓練現況・通知、再投入なし、normal 不変', async () => {
  await withRealWorker(async (ctx) => {
    const normalPaths = [
      `/api/weather/bulletins?terminalId=${K_EAST}&controlStatus=normal`,
      `/api/weather/warnings?terminalId=${K_EAST}&controlStatus=normal`,
    ];
    const beforeNormal = await Promise.all(normalPaths.map((p) => ctx.get(p)));
    const now = nowIso();

    const first = await ctx.inject(['warning-03'], now, GEN(2));
    assert.equal(first.status, 200, JSON.stringify(first.json));
    const baseline = first.json.baseline;
    assert.ok(baseline);
    assert.equal(baseline.sequence, 0);
    assert.equal(baseline.documentUrl, `training://${first.json.trainingId}/0_VPWS50_training.xml`);
    // 警報の発表時刻（生成時刻の分）の60秒前
    assert.equal(
      Date.parse(baseline.reportDateTime),
      Math.floor(Date.parse(now) / 60_000) * 60_000 - 60_000,
    );
    assert.equal(first.json.telegrams[0].sequence, 1);
    assert.equal(first.json.telegrams[0].telegramType, 'VPWW55');

    const training = await ctx.get(
      `/api/weather/warnings?terminalId=${K_EAST}&controlStatus=training`,
    );
    assert.equal(training.status, 200);
    assert.equal(training.json.isTraining, true);
    assert.deepEqual(
      JSON.stringify(training.json).includes('レベル３大雨警報'),
      true,
      JSON.stringify(training.json),
    );

    const delta = await ctx.deltaWeather();
    const notices = weatherItems(delta);
    // 「気象警報発表 江東区 レベル３大雨警報」が isTraining=true で1件、基準電文由来は0件
    assert.equal(notices.length, 1);
    assert.equal(notices[0]!.isTraining, true);
    assert.equal(notices[0]!.output.summary, '気象警報発表\n江東区\nレベル３大雨警報');
    assert.equal(
      notices.filter((n) =>
        n.relatedRefs.some(
          (r) => r.type === 'telegram_reception' && r.ref === String(baseline.receptionId),
        ),
      ).length,
      0,
    );

    // 再投入しない: より新しい雷注意報を注入すると baseline:null、現況は2件、解除通知なし
    const second = await ctx.inject(['warning-14'], nowIso(120_000), GEN(3));
    assert.equal(second.status, 200, JSON.stringify(second.json));
    assert.equal(second.json.baseline, null);
    assert.equal(second.json.telegrams[0].sequence, 0);
    const training2 = await ctx.get(
      `/api/weather/warnings?terminalId=${K_EAST}&controlStatus=training`,
    );
    const text = JSON.stringify(training2.json);
    assert.ok(text.includes('レベル３大雨警報') && text.includes('雷注意報'), text);
    const delta2 = await ctx.deltaWeather();
    assert.equal(weatherItems(delta2).filter((n) => n.output.summary.includes('解除')).length, 0);
    assert.ok(weatherItems(delta2).every((n) => n.isTraining));

    const afterNormal = await Promise.all(normalPaths.map((p) => ctx.get(p)));
    assert.deepEqual(
      afterNormal.map((r) => withoutTimes(r.json)),
      beforeNormal.map((r) => withoutTimes(r.json)),
    );
  });
});

test('実Worker: 同時に開始した2つの警報注入は直列化され、基準電文は1件だけで両方の警報が残る', async () => {
  await withRealWorker(async (ctx) => {
    const now = nowIso();
    const [a, b] = await Promise.all([
      ctx.inject(['warning-03'], now, GEN(4)),
      ctx.inject(['warning-14'], now, GEN(5)),
    ]);
    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.equal(b.status, 200, JSON.stringify(b.json));
    const baselines = [a, b].filter((r) => r.json.baseline !== null);
    assert.equal(baselines.length, 1, '基準電文を投入した注入はちょうど1つ');
    assert.notEqual(a.json.trainingId, b.json.trainingId);

    const databases = ctx.readWeather();
    try {
      const rows = databases.weather.connection
        .prepare(
          'SELECT role, COUNT(*) AS c FROM training_injection_reception GROUP BY role ORDER BY role',
        )
        .all();
      assert.deepEqual(rows, [
        { role: 'baseline', c: 1 },
        { role: 'requested', c: 2 },
      ]);
      const vpws50 = databases.weather.connection
        .prepare("SELECT COUNT(*) AS c FROM telegram_reception WHERE telegram_type = 'VPWS50'")
        .get() as { c: number };
      assert.equal(vpws50.c, 1);
    } finally {
      databases.close();
    }
    const training = await ctx.get(
      `/api/weather/warnings?terminalId=${K_EAST}&controlStatus=training`,
    );
    const text = JSON.stringify(training.json);
    assert.ok(text.includes('レベル３大雨警報') && text.includes('雷注意報'), text);
  });
});

test('実Worker: 注入は監視の集計（採用件数・処理状況・取得元別テーブル）を変えない', async () => {
  await withRealWorker(async (ctx) => {
    const snapshot = async () => {
      const status = (await ctx.get(`/api/monitoring/status?terminalId=${K_EAST}`)).json;
      const processing = (await ctx.get(`/api/monitoring/processing?terminalId=${K_EAST}`)).json;
      return {
        recentAdoptions: status.venues.map((v: Json) => [v.venueId, v.recentAdoptions]),
        healthSources: status.health.sources,
        processing: {
          byAdoptionResult: processing.byAdoptionResult,
          recentFailures: processing.recentFailures,
        },
      };
    };
    const before = await snapshot();
    const injected = await ctx.inject(['bulletin-tornado'], nowIso(), GEN(6));
    assert.equal(injected.status, 200, JSON.stringify(injected.json));
    // 監視外の経路で確かに受信が記録されたことを確認する（除外が効いているのであって、受信が無いのではない）
    const databases = ctx.readWeather();
    try {
      const training = databases.weather.connection
        .prepare("SELECT COUNT(*) AS c FROM telegram_reception WHERE feed_kind = 'training'")
        .get() as { c: number };
      assert.equal(training.c, 1);
    } finally {
      databases.close();
    }
    const after = await snapshot();
    assert.deepEqual(after, before);
    assert.equal(before.processing.byAdoptionResult.length, 0);
  });
});

test('インライン起動(createApplicationRuntime)では注入APIが 503 training_injection_unavailable', async () => {
  const fixture = createTemporaryTestDatabaseFixture();
  const options = createTestServerDatabaseOptions(fixture.config);
  const server = await startInlineServer({
    ...options,
    port: 0,
    enablePolling: false,
    pollingSchedule: createTestPollingSchedule(),
  });
  try {
    const [telegram] = generateTrainingTelegrams(['warning-03'], {
      now: '2026-10-12T09:00:00.000Z',
      generationId: GEN(7),
    });
    const response = await fetch(`http://127.0.0.1:${server.port}/api/training/inject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        terminalId: K_EAST,
        telegrams: [
          {
            previewId: `${GEN(7)}:0`,
            generatedAt: '2026-10-12T09:00:00.000Z',
            itemIds: telegram!.itemIds,
            telegramType: telegram!.telegramType,
            xml: telegram!.xml,
          },
        ],
      }),
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      status: 'error',
      code: 'training_injection_unavailable',
    });
  } finally {
    await server.close();
    fixture.cleanup();
  }
});
