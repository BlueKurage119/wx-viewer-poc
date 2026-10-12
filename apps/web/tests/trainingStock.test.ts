import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TrainingTelegramPreview } from '@wx-viewer-poc/shared';
import {
  TRAINING_STOCK_LIMIT,
  createTrainingStockRepository,
  parseTrainingStock,
  trainingStockKey,
  type TrainingStockEntry,
} from '../src/training/trainingStock.ts';

const telegram = (id: string): TrainingTelegramPreview => ({
  id,
  itemIds: ['warning-10'],
  telegramType: 'VPWW55',
  title: '東京都大雨警報・注意報',
  xml: '<Report/>',
  reportDateTime: '2026-10-11T05:10:00.000Z',
  targetDateTime: '2026-10-11T05:10:00.000Z',
  validDateTime: null,
  areaNames: ['江東区'],
  provenance: 'synthetic',
  isTraining: true,
});
const entry = (id: string): TrainingStockEntry => ({
  id,
  generatedAt: '2026-10-11T05:10:30.000Z',
  itemLabels: ['レベル２大雨注意報'],
  telegram: telegram(id),
  injectionStatus: 'pending',
});
const entries = (count: number) => Array.from({ length: count }, (_, i) => entry(`e${i}`));

function memory(initial?: string) {
  const KEY = trainingStockKey('kkeagh01');
  const data = new Map<string, string>(initial === undefined ? [] : [[KEY, initial]]);
  const calls = { remove: 0, set: 0 };
  const fail = { get: false, set: false, remove: false, accessor: false };
  const storage = {
    getItem(key: string) {
      if (fail.get) throw new Error('get');
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      calls.set += 1;
      if (fail.set) throw new Error('set');
      data.set(key, value);
    },
    removeItem(key: string) {
      calls.remove += 1;
      if (fail.remove) throw new Error('remove');
      data.delete(key);
    },
  };
  const repository = createTrainingStockRepository(() => {
    if (fail.accessor) throw new Error('SecurityError');
    return storage;
  });
  return { data, calls, fail, repository, KEY };
}

test('キーは端末ごと・v1', () => {
  assert.equal(trainingStockKey('kkeagh01'), 'wx-viewer:training-stock:v1:kkeagh01');
  assert.notEqual(trainingStockKey('kkeagh01'), trainingStockKey('ktrcph01'));
});

test('保存と読込: {version:3, entries} を往復し、順序と内容が一致する', () => {
  const m = memory();
  assert.deepEqual(m.repository.load('kkeagh01'), []);
  assert.deepEqual(m.repository.save('kkeagh01', entries(3)), { saved: true });
  assert.deepEqual(JSON.parse(m.data.get(m.KEY)!), { version: 3, entries: entries(3) });
  assert.deepEqual(m.repository.load('kkeagh01'), entries(3));
  assert.deepEqual(m.repository.load('ktrcph01'), [], '別端末のキーには混ざらない');
  // 空配列も保存する（キーを消さない）
  m.repository.save('kkeagh01', []);
  assert.deepEqual(JSON.parse(m.data.get(m.KEY)!), { version: 3, entries: [] });
});

test('壊れたデータは全体を捨てて空から始め、キーを消す', () => {
  const bad: string[] = [
    '{"version":1,"entries":',
    'not json',
    JSON.stringify({ version: 4, entries: entries(1) }),
    JSON.stringify({ version: 3, entries: [{ ...entry('a'), injectionStatus: 'injected' }] }),
    JSON.stringify({ version: 3, entries: [{ ...entry('a'), injectionStatus: undefined }] }),
    JSON.stringify({ version: 2, entries: [{ ...entry('a'), injectionStatus: 'done' }] }),
    JSON.stringify({ version: 2, entries: [{ ...entry('a'), injectionStatus: undefined }] }),
    JSON.stringify({ entries: entries(1) }),
    JSON.stringify({ version: 1, entries: 'x' }),
    JSON.stringify([]),
    'null',
    JSON.stringify({ version: 1, entries: [...entries(2), { id: 'x' }] }),
    JSON.stringify({
      version: 1,
      entries: [{ ...entry('a'), telegram: { ...telegram('a'), isTraining: false } }],
    }),
    JSON.stringify({
      version: 1,
      entries: [{ ...entry('a'), telegram: { ...telegram('a'), provenance: 'real' } }],
    }),
    JSON.stringify({
      version: 1,
      entries: [{ ...entry('a'), telegram: { ...telegram('a'), telegramType: 'VPFD51' } }],
    }),
    JSON.stringify({ version: 1, entries: [{ ...entry('a'), itemLabels: [1] }] }),
    JSON.stringify({
      version: 1,
      entries: [{ ...entry('a'), telegram: { ...telegram('a'), xml: 1 } }],
    }),
  ];
  for (const raw of bad) {
    const m = memory(raw);
    assert.deepEqual(m.repository.load('kkeagh01'), [], raw);
    assert.equal(m.data.has(m.KEY), false, `キーを消す: ${raw}`);
    assert.equal(m.calls.remove, 1);
  }
  assert.equal(parseTrainingStock({ version: 3, entries: entries(2) })!.entries.length, 2);
});

test('21件以上は新しい20件だけ採用して書き戻す', () => {
  const m = memory(JSON.stringify({ version: 3, entries: entries(25) }));
  const loaded = m.repository.load('kkeagh01');
  assert.equal(loaded.length, TRAINING_STOCK_LIMIT);
  assert.equal(loaded[0]!.id, 'e0');
  assert.equal(loaded.at(-1)!.id, 'e19');
  assert.equal(JSON.parse(m.data.get(m.KEY)!).entries.length, 20);
  const exact = memory(JSON.stringify({ version: 3, entries: entries(20) }));
  exact.repository.load('kkeagh01');
  assert.equal(exact.calls.set, 0, '20件ちょうどは書き戻さない');
});

test('getItem・setItem・removeItem・ストレージ取得が例外でも投げず、安全側に倒れる', () => {
  const m = memory(JSON.stringify({ version: 1, entries: entries(2) }));
  m.fail.get = true;
  assert.deepEqual(m.repository.load('kkeagh01'), []);
  assert.equal(m.calls.remove, 0, '読めなかっただけでは消さない');
  m.fail.get = false;
  m.fail.set = true;
  assert.deepEqual(m.repository.save('kkeagh01', entries(1)), { saved: false });
  const broken = memory('bad json');
  broken.fail.remove = true;
  assert.deepEqual(broken.repository.load('kkeagh01'), []);
  const noStorage = memory();
  noStorage.fail.accessor = true;
  assert.deepEqual(noStorage.repository.load('kkeagh01'), []);
  assert.deepEqual(noStorage.repository.save('kkeagh01', entries(1)), { saved: false });
  const trimmed = memory(JSON.stringify({ version: 1, entries: entries(22) }));
  trimmed.fail.set = true;
  assert.equal(trimmed.repository.load('kkeagh01').length, 20, '書戻し失敗でも20件を返す');
});

test('version 1 は破棄せず全行「未投入」で読み、直ちに version 3 で書き戻す', () => {
  const v1 = entries(3).map((e) => {
    const { injectionStatus, ...rest } = e;
    void injectionStatus;
    return rest;
  });
  const m = memory(JSON.stringify({ version: 1, entries: v1 }));
  assert.deepEqual(m.repository.load('kkeagh01'), entries(3));
  assert.equal(m.calls.remove, 0);
  assert.deepEqual(JSON.parse(m.data.get(m.KEY)!), { version: 3, entries: entries(3) });
});

test('version 2 は pending・failed を残し injected の行を捨て、直ちに version 3 で書き戻す', () => {
  const statuses = ['pending', 'injected', 'failed', 'injected', 'pending'] as const;
  const v2 = entries(5).map((e, i) => ({ ...e, injectionStatus: statuses[i]! }));
  const m = memory(JSON.stringify({ version: 2, entries: v2 }));
  const loaded = m.repository.load('kkeagh01');
  assert.deepEqual(
    loaded.map((e) => [e.id, e.injectionStatus]),
    [
      ['e0', 'pending'],
      ['e2', 'failed'],
      ['e4', 'pending'],
    ],
  );
  assert.equal(m.calls.remove, 0);
  const written = JSON.parse(m.data.get(m.KEY)!);
  assert.equal(written.version, 3);
  assert.deepEqual(
    written.entries.map((e: TrainingStockEntry) => e.id),
    ['e0', 'e2', 'e4'],
  );
});

test('version 2 の injectionStatus が不正なら全体を捨ててキーを消す', () => {
  const m = memory(
    JSON.stringify({ version: 2, entries: [{ ...entry('a'), injectionStatus: 'done' }] }),
  );
  assert.deepEqual(m.repository.load('kkeagh01'), []);
  assert.equal(m.data.has(m.KEY), false);
});

test('injectionStatus の2値(pending・failed)は往復で保持される', () => {
  const m = memory();
  const mixed = entries(3).map((e, i) => ({
    ...e,
    injectionStatus: (['pending', 'failed', 'pending'] as const)[i]!,
  }));
  m.repository.save('kkeagh01', mixed);
  assert.deepEqual(m.repository.load('kkeagh01'), mixed);
});
