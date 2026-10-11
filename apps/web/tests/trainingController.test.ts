import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TRAINING_ITEMS,
  type TrainingGenerateResponse,
  type TrainingItemId,
  type TrainingTelegramPreview,
} from '@wx-viewer-poc/shared';
import {
  createTrainingController,
  type TrainingState,
} from '../src/training/trainingController.ts';

const itemsBody = { items: TRAINING_ITEMS, targetLabel: '東京ビッグサイト周辺' };

function telegram(id: string, itemId: TrainingItemId): TrainingTelegramPreview {
  return {
    id,
    itemIds: [itemId],
    telegramType: 'VPWW55',
    title: `電文${id}`,
    xml: `<Report>${id}</Report>`,
    reportDateTime: '2026-10-11T05:10:00.000Z',
    targetDateTime: '2026-10-11T05:10:00.000Z',
    validDateTime: null,
    areaNames: ['江東区'],
    provenance: 'synthetic',
    isTraining: true,
  };
}

function generation(id: string, itemId: TrainingItemId): TrainingGenerateResponse {
  return {
    generationId: id,
    generatedAt: '2026-10-11T05:10:30.000Z',
    telegrams: [telegram(`${id}:0`, itemId)],
  };
}

interface Pending {
  readonly url: string;
  readonly body: { terminalId: string; itemIds: string[] } | null;
  readonly signal: AbortSignal;
  resolve(response: Response): void;
  reject(error: unknown): void;
}

/** abortに反応しないfetch（古い応答が遅れて届く状況を再現する）。 */
function createFetch() {
  const pending: Pending[] = [];
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      pending.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
        signal: init!.signal as AbortSignal,
        resolve,
        reject,
      });
    })) as typeof fetch;
  return { fetcher, pending };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function ready() {
  const { fetcher, pending } = createFetch();
  const states: TrainingState[] = [];
  const controller = createTrainingController('kkeagh01', (state) => states.push(state), fetcher);
  controller.start();
  pending[0]!.resolve(Response.json(itemsBody));
  await tick();
  assert.equal(states.at(-1)!.load, 'ready');
  const last = () => states.at(-1)!;
  return { controller, pending, states, last };
}

test('項目の読込: terminalIdを付けて取得し、失敗時はfailed', async () => {
  const { fetcher, pending } = createFetch();
  const states: TrainingState[] = [];
  const controller = createTrainingController('kkeagh01', (state) => states.push(state), fetcher);
  controller.start();
  assert.equal(states.at(-1)!.load, 'loading');
  assert.equal(pending[0]!.url, '/api/training/items?terminalId=kkeagh01');
  pending[0]!.resolve(new Response('{}', { status: 403 }));
  await tick();
  assert.equal(states.at(-1)!.load, 'failed');
  controller.start();
  pending[1]!.resolve(Response.json(itemsBody));
  await tick();
  assert.equal(states.at(-1)!.load, 'ready');
  assert.equal(states.at(-1)!.targetLabel, '東京ビッグサイト周辺');
});

test('選択: 同一現象内は単一段階、異なる現象間は複数、選択不可・group違いは無視', async () => {
  const { controller, last } = await ready();
  controller.selectInGroup('rain', 'warning-10');
  controller.selectInGroup('rain', 'warning-43');
  controller.selectInGroup('thunder', 'warning-14');
  assert.deepEqual([...last().selected].sort(), ['warning-14', 'warning-43']);
  controller.selectInGroup('rain', null);
  assert.deepEqual(last().selected, ['warning-14']);
  controller.selectInGroup('landslide', 'warning-09'); // 選択不可
  controller.selectInGroup('rain', 'warning-14'); // group違い
  controller.selectInGroup('rain', 'warning-99' as TrainingItemId); // 未知
  assert.deepEqual(last().selected, ['warning-14']);
  controller.selectInGroup('thunder', null);
  assert.deepEqual(last().selected, []);
});

test('生成: 操作直後に送信中を描画し、応答で結果を保持、選択変更で旧結果を消す', async () => {
  const { controller, pending, last } = await ready();
  controller.generate();
  assert.equal(pending.length, 1, '未選択では送信しない');
  controller.selectInGroup('rain', 'warning-43');
  controller.generate();
  assert.equal(last().generation.phase, 'sending'); // 応答前に描画済み
  assert.equal(pending[1]!.url, '/api/training/preview');
  assert.deepEqual(pending[1]!.body, { terminalId: 'kkeagh01', itemIds: ['warning-43'] });
  controller.generate(); // 送信中の二重送信はしない
  assert.equal(pending.length, 2);
  pending[1]!.resolve(Response.json(generation('g1', 'warning-43')));
  await tick();
  const done = last().generation;
  assert.equal(done.phase, 'done');
  controller.selectInGroup('thunder', 'warning-14');
  assert.equal(last().generation.phase, 'idle');
});

test('レスポンス順を逆転しても、新しい選択の結果だけが表示される', async () => {
  const { controller, pending, last } = await ready();
  controller.selectInGroup('rain', 'warning-43');
  controller.generate(); // 要求A
  controller.selectInGroup('rain', 'warning-10'); // 選択変更でAを無効化
  assert.equal(pending[1]!.signal.aborted, true);
  controller.generate(); // 要求B
  pending[2]!.resolve(Response.json(generation('B', 'warning-10'))); // Bが先に返る
  await tick();
  pending[1]!.resolve(Response.json(generation('A', 'warning-43'))); // Aが遅れて返る
  await tick();
  const state = last().generation;
  assert.equal(state.phase, 'done');
  if (state.phase === 'done') assert.equal(state.result.generationId, 'B');
  assert.deepEqual(last().selected, ['warning-10']);
});

test('旧失敗・旧成功は復活しない（選択変更・離脱後）', async () => {
  const { controller, pending, last, states } = await ready();
  controller.selectInGroup('rain', 'warning-43');
  controller.generate(); // 要求A
  controller.selectInGroup('rain', null); // 選択変更
  pending[1]!.reject(new TypeError('network')); // 旧失敗
  await tick();
  assert.equal(last().generation.phase, 'idle');
  controller.selectInGroup('rain', 'warning-10');
  controller.generate(); // 要求B
  pending[2]!.resolve(Response.json(generation('B', 'warning-10')));
  await tick();
  pending[1]!.resolve(Response.json(generation('A', 'warning-43'))); // 旧成功が遅れて届く
  await tick();
  const state = last().generation;
  assert.equal(state.phase === 'done' && state.result.generationId, 'B');
  // 離脱（dispose）後は何も反映しない
  controller.selectInGroup('thunder', 'warning-14');
  controller.generate(); // 要求C
  const before = states.length;
  controller.dispose();
  assert.equal(pending[3]!.signal.aborted, true);
  pending[3]!.resolve(Response.json(generation('C', 'warning-14')));
  await tick();
  assert.equal(states.length, before);
});

test('端末切替: 旧端末のコントローラの応答は新端末の状態へ反映されない', async () => {
  const first = createFetch();
  const firstStates: TrainingState[] = [];
  const oldController = createTrainingController(
    'kkeagh01',
    (s) => firstStates.push(s),
    first.fetcher,
  );
  oldController.start();
  first.pending[0]!.resolve(Response.json(itemsBody));
  await tick();
  oldController.selectInGroup('rain', 'warning-43');
  oldController.generate();
  oldController.dispose(); // 端末切替で旧画面を破棄
  const second = createFetch();
  const secondStates: TrainingState[] = [];
  const newController = createTrainingController(
    'ktrcph01',
    (s) => secondStates.push(s),
    second.fetcher,
  );
  newController.start();
  second.pending[0]!.resolve(Response.json(itemsBody));
  await tick();
  const count = firstStates.length;
  first.pending[1]!.resolve(Response.json(generation('old', 'warning-43')));
  await tick();
  assert.equal(firstStates.length, count);
  assert.deepEqual(secondStates.at(-1)!.selected, []);
  assert.equal(secondStates.at(-1)!.generation.phase, 'idle');
});

test('失敗時は選択を維持し、日本語のエラーを示して再実行できる', async () => {
  const { controller, pending, last } = await ready();
  controller.selectInGroup('rain', 'warning-43');
  controller.generate();
  pending[1]!.resolve(new Response('{}', { status: 500 }));
  await tick();
  const failed = last().generation;
  assert.equal(failed.phase, 'failed');
  if (failed.phase === 'failed') assert.match(failed.message, /電文の生成に失敗しました（500）/);
  assert.deepEqual(last().selected, ['warning-43']);
  // 自動再送しない
  assert.equal(pending.length, 2);
  controller.generate(); // 再実行
  assert.equal(last().generation.phase, 'sending');
  pending[2]!.reject(new TypeError('Failed to fetch'));
  await tick();
  const second = last().generation;
  assert.equal(
    second.phase === 'failed' && second.message,
    '電文の生成に失敗しました（通信エラー）',
  );
});

test('形式不正な応答は失敗扱い', async () => {
  const { controller, pending, last } = await ready();
  controller.selectInGroup('rain', 'warning-43');
  controller.generate();
  pending[1]!.resolve(Response.json({ generationId: 'x', generatedAt: 'y', telegrams: [{}] }));
  await tick();
  assert.equal(last().generation.phase, 'failed');
});
