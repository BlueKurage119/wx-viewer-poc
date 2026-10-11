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
  TRAINING_HISTORY_LIMIT,
  createTrainingController,
  prependHistory,
  type TrainingHistoryEntry,
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

function generation(id: string, itemId: TrainingItemId, count = 1): TrainingGenerateResponse {
  return {
    generationId: id,
    generatedAt: '2026-10-11T05:10:30.000Z',
    telegrams: Array.from({ length: count }, (_, index) => telegram(`${id}:${index}`, itemId)),
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

test('項目の読込: terminalIdを付けて取得し、失敗時はfailedから再読込できる', async () => {
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
  assert.equal(states.at(-1)!.items.length, 33);
});

test('選択: 同一現象内は単一段階、異なる現象間は複数、group違い・未知は無視', async () => {
  const { controller, last } = await ready();
  controller.selectInGroup('rain', 'warning-10');
  controller.selectInGroup('rain', 'warning-43');
  controller.selectInGroup('thunder', 'warning-14');
  assert.deepEqual([...last().selected].sort(), ['warning-14', 'warning-43']);
  controller.selectInGroup('rain', null);
  assert.deepEqual(last().selected, ['warning-14']);
  controller.selectInGroup('rain', 'warning-14'); // group違い
  controller.selectInGroup('rain', 'warning-99' as TrainingItemId); // 未知
  controller.selectInGroup('landslide', 'warning-09' as TrainingItemId); // 削除済み
  assert.deepEqual(last().selected, ['warning-14']);
  controller.selectInGroup('thunder', null);
  assert.deepEqual(last().selected, []);
});

test('生成: 押下即実行で送信中を描画し、成功で一覧の先頭へ追加・先頭行を自動選択する', async () => {
  const { controller, pending, last } = await ready();
  controller.generate();
  assert.equal(pending.length, 1, '未選択では送信しない');
  controller.selectInGroup('rain', 'warning-43');
  controller.generate();
  assert.equal(last().generation.phase, 'sending'); // 応答前に描画済み
  assert.equal(pending[1]!.url, '/api/training/preview');
  assert.deepEqual(pending[1]!.body, { terminalId: 'kkeagh01', itemIds: ['warning-43'] });
  controller.generate(); // 送信中の二重送信はしない
  controller.selectInGroup('thunder', 'warning-14'); // 送信中は選択を変えられない
  controller.reset(); // 送信中はリセットできない
  assert.equal(pending.length, 2);
  assert.deepEqual(last().selected, ['warning-43']);
  pending[1]!.resolve(Response.json(generation('g1', 'warning-43')));
  await tick();
  assert.equal(last().generation.phase, 'idle');
  assert.equal(last().history.length, 1);
  const entry = last().history[0]!;
  assert.equal(entry.id, 'g1:0');
  assert.equal(entry.generatedAt, '2026-10-11T05:10:30.000Z');
  assert.deepEqual(entry.itemLabels, ['レベル４大雨危険警報']);
  assert.equal(last().selectedEntryId, 'g1:0');
  // 選択は維持され、選択変更で一覧は消えない
  assert.deepEqual(last().selected, ['warning-43']);
  controller.selectInGroup('thunder', 'warning-14');
  assert.equal(last().history.length, 1);
});

test('1回の生成の複数通は先頭にAPI順で入り、新しい生成はさらに前に積まれる', async () => {
  const { controller, pending, last } = await ready();
  controller.selectInGroup('rain', 'warning-43');
  controller.generate();
  pending[1]!.resolve(Response.json(generation('a', 'warning-43', 2)));
  await tick();
  assert.deepEqual(
    last().history.map((e) => e.id),
    ['a:0', 'a:1'],
  );
  controller.generate();
  pending[2]!.resolve(Response.json(generation('b', 'warning-43', 3)));
  await tick();
  assert.deepEqual(
    last().history.map((e) => e.id),
    ['b:0', 'b:1', 'b:2', 'a:0', 'a:1'],
  );
  assert.equal(last().selectedEntryId, 'b:0');
});

test('一覧は最大20件: 20件・21件・複数通同時投入の境界で最古から消える', async () => {
  const mk = (id: string): TrainingHistoryEntry => ({
    id,
    generatedAt: '2026-10-11T05:10:30.000Z',
    itemLabels: [],
    telegram: telegram(id, 'warning-10'),
  });
  const twenty = Array.from({ length: 20 }, (_, i) => mk(`o${i}`));
  assert.equal(prependHistory(twenty.slice(0, 19), [mk('n0')]).length, 20);
  const afterOne = prependHistory(twenty, [mk('n0')]);
  assert.equal(afterOne.length, TRAINING_HISTORY_LIMIT);
  assert.equal(afterOne[0]!.id, 'n0');
  assert.equal(afterOne.at(-1)!.id, 'o18', '最古のo19だけが消える');
  const afterThree = prependHistory(twenty, [mk('n0'), mk('n1'), mk('n2')]);
  assert.deepEqual(
    afterThree.slice(0, 3).map((e) => e.id),
    ['n0', 'n1', 'n2'],
  );
  assert.equal(afterThree.length, 20);
  assert.equal(afterThree.at(-1)!.id, 'o16');
  assert.equal(
    prependHistory(
      [],
      Array.from({ length: 10 }, (_, i) => mk(`x${i}`)),
    ).length,
    10,
  );

  // 状態機械でも21通目で最古が消え、選択中の古い行は選択解除（新しい先頭行へ移る）
  const { controller, pending, last } = await ready();
  controller.selectInGroup('rain', 'warning-43');
  for (let round = 0; round < 3; round += 1) {
    controller.generate();
    pending[pending.length - 1]!.resolve(Response.json(generation(`r${round}`, 'warning-43', 7)));
    await tick();
  }
  assert.equal(last().history.length, 20);
  assert.deepEqual(
    last()
      .history.map((e) => e.id)
      .slice(0, 2),
    ['r2:0', 'r2:1'],
  );
  assert.ok(!last().history.some((e) => e.id === 'r0:6'), '最古の1通が押し出される');
  assert.equal(last().history.at(-1)!.id, 'r0:5');
});

test('行の選択: 単一選択で、存在しない行は無視、リセット・選択変更では変わらない', async () => {
  const { controller, pending, last } = await ready();
  controller.selectInGroup('rain', 'warning-43');
  controller.generate();
  pending[1]!.resolve(Response.json(generation('g', 'warning-43', 2)));
  await tick();
  controller.selectEntry('g:1');
  assert.equal(last().selectedEntryId, 'g:1');
  controller.selectEntry('nope');
  assert.equal(last().selectedEntryId, 'g:1');
  controller.reset();
  assert.equal(last().selectedEntryId, 'g:1');
  assert.equal(last().history.length, 2);
  controller.selectEntry(null);
  assert.equal(last().selectedEntryId, null);
});

test('リセット: 選択を全解除し一覧は変えない。未選択では何もしない', async () => {
  const { controller, pending, last, states } = await ready();
  const before = states.length;
  controller.reset();
  assert.equal(states.length, before, '未選択では何もしない');
  controller.selectInGroup('rain', 'warning-43');
  controller.selectInGroup('thunder', 'warning-14');
  controller.generate();
  pending[1]!.resolve(Response.json(generation('g', 'warning-43')));
  await tick();
  controller.reset();
  assert.deepEqual(last().selected, []);
  assert.equal(last().history.length, 1);
  controller.generate(); // 未選択では送信しない
  assert.equal(pending.length, 2);
});

test('失敗: 選択と一覧を維持して日本語のエラーを示し、「生成」の再押下で再試行、成功で表示が消える', async () => {
  const { controller, pending, last } = await ready();
  controller.selectInGroup('rain', 'warning-43');
  controller.generate();
  pending[1]!.resolve(Response.json(generation('g', 'warning-43')));
  await tick();
  controller.generate();
  pending[2]!.resolve(new Response('{}', { status: 500 }));
  await tick();
  const failed = last().generation;
  assert.equal(failed.phase === 'failed' && failed.message, '訓練電文を生成できませんでした。');
  assert.deepEqual(last().selected, ['warning-43']);
  assert.equal(last().history.length, 1, '一覧は維持');
  assert.equal(pending.length, 3, '自動再送しない');
  controller.generate(); // 再試行
  assert.equal(last().generation.phase, 'sending', '次の生成開始で失敗表示が消える');
  pending[3]!.reject(new TypeError('Failed to fetch'));
  await tick();
  assert.equal(last().generation.phase, 'failed');
  controller.reset(); // リセットでも失敗表示が消える
  assert.equal(last().generation.phase, 'idle');
  controller.selectInGroup('rain', 'warning-10');
  controller.generate();
  pending[4]!.resolve(Response.json(generation('h', 'warning-10')));
  await tick();
  assert.equal(last().history.length, 2);
  assert.equal(last().history[0]!.id, 'h:0');
});

test('形式不正な応答は失敗扱いで一覧に追加しない', async () => {
  const { controller, pending, last } = await ready();
  controller.selectInGroup('rain', 'warning-43');
  controller.generate();
  pending[1]!.resolve(Response.json({ generationId: 'x', generatedAt: 'y', telegrams: [{}] }));
  await tick();
  assert.equal(last().generation.phase, 'failed');
  assert.equal(last().history.length, 0);
});

test('離脱・端末切替後の旧成功/旧失敗は一覧にも状態にも反映されない', async () => {
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
  oldController.dispose(); // 端末切替・画面離脱
  assert.equal(first.pending[1]!.signal.aborted, true);
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
  assert.equal(secondStates.at(-1)!.history.length, 0);
  assert.deepEqual(secondStates.at(-1)!.selected, []);
  // 旧失敗も復活しない
  const third = createFetch();
  const thirdStates: TrainingState[] = [];
  const c3 = createTrainingController('kkeagh01', (s) => thirdStates.push(s), third.fetcher);
  c3.start();
  third.pending[0]!.resolve(Response.json(itemsBody));
  await tick();
  c3.selectInGroup('rain', 'warning-43');
  c3.generate();
  c3.dispose();
  const n3 = thirdStates.length;
  third.pending[1]!.reject(new TypeError('x'));
  await tick();
  assert.equal(thirdStates.length, n3);
});

test('通信は項目取得と生成だけ（保存系APIを呼ばない）', async () => {
  const { controller, pending } = await ready();
  controller.selectInGroup('rain', 'warning-43');
  controller.generate();
  pending[1]!.resolve(Response.json(generation('g', 'warning-43')));
  await tick();
  assert.deepEqual(
    pending.map((p) => p.url.split('?')[0]),
    ['/api/training/items', '/api/training/preview'],
  );
});
