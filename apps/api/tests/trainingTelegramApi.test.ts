import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import test from 'node:test';
import {
  TRAINING_ITEMS,
  type TrainingGenerateResponse,
  type TrainingItemsResponse,
} from '@wx-viewer-poc/shared';
import { createApp, type AppDependencies } from '../src/app.js';
import { createTrainingTelegramService } from '../src/services/trainingTelegramService.js';
import { testTerminalRegistry } from './helpers/venueConfigPreload.js';
import { parseXml, textAt } from './helpers/trainingTelegramXml.js';

const NOW = '2026-10-11T14:59:45.000Z';
const FIXED_ID = '123e4567-e89b-42d3-a456-426614174000';
const K_EAST = 'kkeagh01';
const K_TRC = 'ktrcph01';
const H_EAST = 'hkeagh01';

function makeService(overrides: { idFactory?: () => string; now?: () => string } = {}) {
  return createTrainingTelegramService({
    terminalRegistry: testTerminalRegistry,
    now: overrides.now ?? (() => NOW),
    idFactory: overrides.idFactory ?? (() => FIXED_ID),
  });
}

async function withServer<T>(
  dependencies: AppDependencies,
  run: (call: Caller) => Promise<T>,
): Promise<T> {
  const server = await new Promise<Server>((resolve, reject) => {
    const listening = createApp(dependencies).listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('missing TCP address');
  const base = `http://127.0.0.1:${address.port}`;
  const call: Caller = async (method, path, body, contentType = 'application/json') => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': contentType },
      body,
    });
    const raw = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(raw);
    } catch {
      // 非JSON応答（既存parserの413等）
    }
    return {
      status: response.status,
      cacheControl: response.headers.get('cache-control'),
      json,
      raw,
    };
  };
  try {
    return await run(call);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

type Caller = (
  method: 'GET' | 'POST',
  path: string,
  body?: string,
  contentType?: string,
) => Promise<{ status: number; cacheControl: string | null; json: unknown; raw: string }>;

function deps(extra: Partial<AppDependencies> = {}): AppDependencies {
  return { terminalRegistry: testTerminalRegistry, trainingTelegram: makeService(), ...extra };
}

const post = (call: Caller, body: unknown) =>
  call('POST', '/api/training/preview', JSON.stringify(body));

const MAX_SELECTION = [
  'warning-10',
  'warning-29',
  'warning-19',
  'warning-15',
  'warning-16',
  'warning-12',
  'warning-14',
  'warning-20',
  'warning-21',
  'warning-23',
  'warning-24',
  'warning-25',
  'warning-26',
  'bulletin-linear-occurrence',
  'bulletin-record-rain',
  'bulletin-tornado',
];

test('GET /api/training/items: K端末は項目表と対象ラベル、no-store', async () => {
  await withServer(deps(), async (call) => {
    const response = await call('GET', `/api/training/items?terminalId=${K_EAST}`);
    assert.equal(response.status, 200);
    assert.equal(response.cacheControl, 'no-store');
    const body = response.json as TrainingItemsResponse;
    assert.equal(body.targetLabel, '東京ビッグサイト周辺');
    assert.deepEqual(body.items, JSON.parse(JSON.stringify(TRAINING_ITEMS)));
    assert.equal(body.items.filter((item) => item.selectable).length, 33);
    const unavailable = body.items.filter((item) => !item.selectable);
    assert.equal(unavailable.length, 5);
    assert.ok(
      unavailable.every((item) => item.unavailableReason !== null && item.unavailableReason !== ''),
    );
  });
});

test('GET /api/training/items: H端末403、不明端末・不正queryは400、すべてno-store', async () => {
  await withServer(deps(), async (call) => {
    const forbidden = await call('GET', `/api/training/items?terminalId=${H_EAST}`);
    assert.equal(forbidden.status, 403);
    assert.deepEqual(forbidden.json, { status: 'error', code: 'forbidden_terminal' });
    assert.equal(forbidden.cacheControl, 'no-store');
    for (const query of [
      '',
      '?terminalId=',
      '?terminalId=unknown',
      `?terminalId=${K_EAST}&terminalId=${K_EAST}`,
      `?terminalId=${K_EAST}&mode=K`,
      `?terminalId[]=${K_EAST}`,
      '?other=1',
    ]) {
      const response = await call('GET', `/api/training/items${query}`);
      assert.equal(response.status, 400, query);
      assert.deepEqual(response.json, { status: 'error', code: 'invalid_request' }, query);
      assert.equal(response.cacheControl, 'no-store', query);
    }
  });
});

test('POST /api/training/preview: K端末は成功し、結果はTRCでも江東区/東京地方を示す', async () => {
  await withServer(deps(), async (call) => {
    for (const terminalId of [K_EAST, K_TRC]) {
      const response = await post(call, {
        terminalId,
        itemIds: ['warning-43', 'bulletin-tornado'],
      });
      assert.equal(response.status, 200);
      assert.equal(response.cacheControl, 'no-store');
      const body = response.json as TrainingGenerateResponse;
      assert.equal(body.generationId, FIXED_ID);
      assert.equal(body.generatedAt, NOW);
      assert.deepEqual(
        body.telegrams.map((telegram) => telegram.id),
        [`${FIXED_ID}:0`, `${FIXED_ID}:1`],
      );
      assert.deepEqual(
        body.telegrams.map((telegram) => telegram.telegramType),
        ['VPWW55', 'VPHW50'],
      );
      for (const telegram of body.telegrams) {
        assert.equal(telegram.provenance, 'synthetic');
        assert.equal(telegram.isTraining, true);
        assert.ok(telegram.areaNames.includes('江東区'));
        assert.ok(telegram.areaNames.includes('東京地方'));
        assert.equal(telegram.reportDateTime, '2026-10-11T14:59:00.000Z');
        assert.equal(textAt(parseXml(telegram.xml), 'Control', 'Status'), '訓練');
      }
      assert.equal(body.telegrams[0]!.validDateTime, null);
      assert.equal(body.telegrams[1]!.validDateTime, '2026-10-11T16:00:00.000Z');
      assert.ok(!JSON.stringify(body).includes('トレセン'));
    }
  });
});

test('POST: 選択可能な全項目を個別に生成できる', async () => {
  await withServer(deps(), async (call) => {
    for (const item of TRAINING_ITEMS.filter((entry) => entry.selectable)) {
      const response = await post(call, { terminalId: K_EAST, itemIds: [item.id] });
      assert.equal(response.status, 200, item.id);
      const body = response.json as TrainingGenerateResponse;
      assert.equal(body.telegrams.length, 1, item.id);
      assert.deepEqual(body.telegrams[0]!.itemIds, [item.id]);
    }
  });
});

test('POST: 無効項目（選択不可）はすべて400', async () => {
  await withServer(deps(), async (call) => {
    for (const item of TRAINING_ITEMS.filter((entry) => !entry.selectable)) {
      const response = await post(call, { terminalId: K_EAST, itemIds: [item.id] });
      assert.equal(response.status, 400, item.id);
      assert.deepEqual(response.json, { status: 'error', code: 'invalid_request' });
      assert.equal(response.cacheControl, 'no-store');
    }
  });
});

test('POST: 全16groupを同時選択した最大セットに成功する', async () => {
  await withServer(deps(), async (call) => {
    const response = await post(call, { terminalId: K_EAST, itemIds: MAX_SELECTION });
    assert.equal(response.status, 200);
    const body = response.json as TrainingGenerateResponse;
    assert.deepEqual(
      body.telegrams.map((telegram) => telegram.telegramType),
      [
        'VPWW55',
        'VPWW56',
        'VPWW57',
        'VPWW58',
        'VPWW59',
        'VPWW60',
        'VPWW61',
        'VPBS50',
        'VPBS50',
        'VPHW50',
      ],
    );
    assert.equal(body.telegrams.flatMap((telegram) => telegram.itemIds).length, 16);
  });
});

test('POST: 不正入力は400（空・重複・未知ID・17件・長いID・余分フィールド・非配列・不明端末・同group競合）', async () => {
  const seventeen = [
    ...MAX_SELECTION,
    'warning-03', // 同group（競合）にもなるが件数超過を確認する用途
  ];
  const cases: [string, unknown][] = [
    ['空配列', { terminalId: K_EAST, itemIds: [] }],
    ['重複', { terminalId: K_EAST, itemIds: ['warning-10', 'warning-10'] }],
    ['未知ID', { terminalId: K_EAST, itemIds: ['warning-99'] }],
    ['未知ID(bulletin)', { terminalId: K_EAST, itemIds: ['bulletin-flood'] }],
    ['17件', { terminalId: K_EAST, itemIds: seventeen }],
    ['64文字超ID', { terminalId: K_EAST, itemIds: [`warning-${'0'.repeat(60)}`] }],
    ['余分フィールド', { terminalId: K_EAST, itemIds: ['warning-10'], mode: 'K' }],
    ['日時の指定', { terminalId: K_EAST, itemIds: ['warning-10'], now: NOW }],
    ['生XMLの指定', { terminalId: K_EAST, itemIds: ['warning-10'], xml: '<a/>' }],
    ['itemIds欠落', { terminalId: K_EAST }],
    ['terminalId欠落', { itemIds: ['warning-10'] }],
    ['非配列', { terminalId: K_EAST, itemIds: 'warning-10' }],
    ['オブジェクト配列', { terminalId: K_EAST, itemIds: [{ id: 'warning-10' }] }],
    ['数値ID', { terminalId: K_EAST, itemIds: [10] }],
    ['空terminalId', { terminalId: '', itemIds: ['warning-10'] }],
    ['非文字列terminalId', { terminalId: 1, itemIds: ['warning-10'] }],
    ['不明端末', { terminalId: 'nosuchterminal', itemIds: ['warning-10'] }],
    ['同group競合(大雨)', { terminalId: K_EAST, itemIds: ['warning-10', 'warning-03'] }],
    ['同group競合(暴風と暴風雪)', { terminalId: K_EAST, itemIds: ['warning-05', 'warning-02'] }],
    [
      '同group競合(線状降水帯)',
      { terminalId: K_EAST, itemIds: ['bulletin-linear-occurrence', 'bulletin-linear-imminent'] },
    ],
    [
      '同group競合(竜巻)',
      { terminalId: K_EAST, itemIds: ['bulletin-tornado', 'bulletin-tornado-observed'] },
    ],
    ['配列ボディ', ['warning-10']],
    ['nullボディ', null],
    ['文字列ボディ', 'warning-10'],
  ];
  await withServer(deps(), async (call) => {
    for (const [label, body] of cases) {
      const response = await post(call, body);
      assert.equal(response.status, 400, label);
      assert.deepEqual(response.json, { status: 'error', code: 'invalid_request' }, label);
      assert.equal(response.cacheControl, 'no-store', label);
    }
    // 壊れたJSON（express.jsonが先に拒否）にもno-store
    const malformed = await call('POST', '/api/training/preview', '{"terminalId":');
    assert.equal(malformed.status, 400);
    assert.equal(malformed.cacheControl, 'no-store');
    // JSON以外のcontent-type
    const plain = await call('POST', '/api/training/preview', 'x', 'text/plain');
    assert.equal(plain.status, 400);
    assert.equal(plain.cacheControl, 'no-store');
    // query付きPOSTは未知パラメータとして拒否
    const withQuery = await call(
      'POST',
      '/api/training/preview?terminalId=kkeagh01',
      JSON.stringify({ terminalId: K_EAST, itemIds: ['warning-10'] }),
    );
    assert.equal(withQuery.status, 400);
    assert.equal(withQuery.cacheControl, 'no-store');
  });
});

test('POST: H端末は403、K端末は成功', async () => {
  await withServer(deps(), async (call) => {
    const forbidden = await post(call, { terminalId: H_EAST, itemIds: ['warning-10'] });
    assert.equal(forbidden.status, 403);
    assert.deepEqual(forbidden.json, { status: 'error', code: 'forbidden_terminal' });
    assert.equal(forbidden.cacheControl, 'no-store');
    const ok = await post(call, { terminalId: K_EAST, itemIds: ['warning-10'] });
    assert.equal(ok.status, 200);
  });
});

test('POST: 本文16KiB超は413 request_too_large（no-store）、境界内は通る', async () => {
  await withServer(deps(), async (call) => {
    const tooLarge = await call(
      'POST',
      '/api/training/preview',
      JSON.stringify({ terminalId: K_EAST, itemIds: ['warning-10'], pad: 'x'.repeat(17 * 1024) }),
    );
    assert.equal(tooLarge.status, 413);
    assert.deepEqual(tooLarge.json, { status: 'error', code: 'request_too_large' });
    assert.equal(tooLarge.cacheControl, 'no-store');
    // 全体のexpress.json上限（100kb）に先に拒否される場合もno-storeのまま413
    const huge = await call(
      'POST',
      '/api/training/preview',
      JSON.stringify({ terminalId: K_EAST, itemIds: ['warning-10'], pad: 'x'.repeat(200 * 1024) }),
    );
    assert.equal(huge.status, 413);
    assert.equal(huge.cacheControl, 'no-store');
    // 16KiB以下の余分フィールドは413ではなく400（形式不正）
    const small = await call(
      'POST',
      '/api/training/preview',
      JSON.stringify({ terminalId: K_EAST, itemIds: ['warning-10'], pad: 'x'.repeat(8 * 1024) }),
    );
    assert.equal(small.status, 400);
  });
});

test('サービス未構成は503、生成の内部失敗は500で部分成功やXMLを返さない', async () => {
  await withServer({ terminalRegistry: testTerminalRegistry }, async (call) => {
    const items = await call('GET', `/api/training/items?terminalId=${K_EAST}`);
    assert.equal(items.status, 503);
    assert.deepEqual(items.json, { status: 'error', code: 'training_unavailable' });
    assert.equal(items.cacheControl, 'no-store');
    const generated = await post(call, { terminalId: K_EAST, itemIds: ['warning-10'] });
    assert.equal(generated.status, 503);
    assert.equal(generated.cacheControl, 'no-store');
  });
  const failing = createTrainingTelegramService({
    terminalRegistry: testTerminalRegistry,
    now: () => NOW,
    idFactory: () => 'not-a-uuid',
  });
  await withServer(deps({ trainingTelegram: failing }), async (call) => {
    const response = await post(call, { terminalId: K_EAST, itemIds: ['warning-10'] });
    assert.equal(response.status, 500);
    assert.deepEqual(response.json, { status: 'error', code: 'training_generation_failed' });
    assert.equal(response.cacheControl, 'no-store');
    assert.ok(!response.raw.includes('<?xml'));
  });
});

test('同じ分に2回生成してもアプリIDとVPBS50 EventIDは別、警報のEventIDは空', async () => {
  await withServer(
    deps({ trainingTelegram: makeService({ idFactory: randomUUID }) }),
    async (call) => {
      const itemIds = ['warning-10', 'bulletin-record-rain'];
      const first = (await post(call, { terminalId: K_EAST, itemIds }))
        .json as TrainingGenerateResponse;
      const second = (await post(call, { terminalId: K_EAST, itemIds }))
        .json as TrainingGenerateResponse;
      assert.notEqual(first.generationId, second.generationId);
      assert.notEqual(first.telegrams[0]!.id, second.telegrams[0]!.id);
      const eventId = (response: TrainingGenerateResponse, index: number) =>
        textAt(parseXml(response.telegrams[index]!.xml), 'Head', 'EventID');
      assert.equal(eventId(first, 0), '');
      assert.equal(eventId(second, 0), '');
      assert.notEqual(eventId(first, 1), eventId(second, 1));
      // XML内の発表時刻は同じ（同じ分）
      assert.equal(first.telegrams[0]!.reportDateTime, second.telegrams[0]!.reportDateTime);
    },
  );
});

test('weather worker・DB・受信・通知が使えなくても生成でき、それらを一切呼ばない', async () => {
  const calls: string[] = [];
  const spy = (name: string) => () => {
    calls.push(name);
    throw new Error(`${name} が呼ばれました`);
  };
  const dependencies: AppDependencies = deps({
    weatherHttp: spy('weatherHttp') as never,
    weatherApi: {
      getWarnings: spy('getWarnings'),
      getWarningTimeseries: spy('getWarningTimeseries'),
      getEarlyWarning: spy('getEarlyWarning'),
      getAreaTimeseries: spy('getAreaTimeseries'),
      getAmedas: spy('getAmedas'),
      getBulletins: spy('getBulletins'),
    } as never,
    startupNotifications: { inquire: spy('startup') } as never,
    notificationDelta: { getDelta: spy('delta') } as never,
    monitoringProcessing: { getProcessing: spy('processing') } as never,
  });
  await withServer(dependencies, async (call) => {
    const response = await post(call, { terminalId: K_EAST, itemIds: MAX_SELECTION });
    assert.equal(response.status, 200);
    const items = await call('GET', `/api/training/items?terminalId=${K_EAST}`);
    assert.equal(items.status, 200);
  });
  assert.deepEqual(calls, []);
});

test('取消・解除・継続・注入の入口は存在しない', async () => {
  await withServer(deps(), async (call) => {
    for (const [method, path] of [
      ['POST', '/api/training/cancel'],
      ['POST', '/api/training/inject'],
      ['POST', '/api/training/release'],
      ['GET', '/api/training/preview'],
    ] as const) {
      const response = await call(method, path, method === 'POST' ? '{}' : undefined);
      assert.equal(response.status, 404, `${method} ${path}`);
      assert.equal(response.cacheControl, 'no-store');
    }
  });
});
