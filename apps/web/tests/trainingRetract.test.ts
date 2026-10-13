import './setupEnv.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TRAINING_ITEMS, type TrainingInjectionListItem } from '@wx-viewer-poc/shared';
import { TrainingContent } from '../src/training/TrainingView.tsx';
import { TrainingToolbar } from '../src/training/TrainingToolbar.tsx';
import { requestTrainingInjectionsHide, requestTrainingRetract } from '../src/api/training.ts';
import {
  INITIAL_TRAINING_STATE,
  createTrainingController,
  type TrainingState,
} from '../src/training/trainingController.ts';
import { createTrainingStockRepository, trainingStockKey } from '../src/training/trainingStock.ts';
import {
  canSelectTrainingOperation,
  isTrainingSendReady,
  trainingDeletingMessage,
  trainingRetractingMessage,
  trainingSelectionLabel,
  trainingToolbarDefinitions,
  TRAINING_RETRACTING_ALL_MESSAGE,
  type TrainingToolbarSelection,
} from '../src/training/trainingToolbarState.ts';
import type { TrainingToolbarModel } from '../src/training/useTrainingScreen.ts';
(globalThis as unknown as { React: typeof React }).React = React;

const TID_A = '11111111-1111-4111-8111-111111111111';
const TID_B = '22222222-2222-4222-8222-222222222222';
const TID_C = '33333333-3333-4333-8333-333333333333';
const RETRACTION_ID = '44444444-4444-4444-8444-444444444444';

const injection = (
  trainingId: string,
  index: number,
  retractedAt: string | null = null,
): TrainingInjectionListItem => ({
  trainingId,
  terminalId: 'kkeagh02',
  acceptedAt: `2026-10-12T10:00:0${index}.000Z`,
  retractedAt,
  telegrams: [{ sequence: 1, telegramType: 'VPWW55', title: '大雨警報', previewId: `p${index}:0` }],
});

const retractResponse = (scope: 'training' | 'all', trainingIds: string[]) => ({
  retractionId: RETRACTION_ID,
  scope,
  acceptedAt: '2026-10-12T10:05:00.000Z',
  trainingIds,
  telegrams: [],
});

// ---------------------------------------------------------------------------
// ツールバー状態
// ---------------------------------------------------------------------------

test('選択可否: 抹消は投入済み行のチェック1件以上、全抹消は一覧が空でも可。処理中はすべて不可', () => {
  const none = { checked: 0, stock: 0 };
  assert.equal(canSelectTrainingOperation('retract', none), false);
  assert.equal(canSelectTrainingOperation('retract', { ...none, checkedInjected: 1 }), true);
  assert.equal(
    canSelectTrainingOperation('retract', { ...none, checkedInjected: 1 }, true),
    false,
    '投入中・抹消中は選べない',
  );
  assert.equal(canSelectTrainingOperation('retractAll', none), true);
  assert.equal(canSelectTrainingOperation('retractAll', none, true), false);
  // ローカル行だけのとき: 投入・消去は選べ、抹消は選べない
  const localOnly = { checked: 2, stock: 3, checkedInjected: 0 };
  assert.equal(canSelectTrainingOperation('inject', localOnly), true);
  assert.equal(canSelectTrainingOperation('delete', localOnly), true);
  assert.equal(canSelectTrainingOperation('retract', localOnly), false);
  // 投入済みの行だけのとき: 抹消は選べ、投入・消去は選べない
  const injectedOnly = { checked: 0, stock: 0, checkedInjected: 2 };
  assert.equal(canSelectTrainingOperation('retract', injectedOnly), true);
  assert.equal(canSelectTrainingOperation('inject', injectedOnly), false);
  assert.equal(canSelectTrainingOperation('delete', injectedOnly), false);
  // 送信可否: 選択を維持したまま対象が0件になれば送信不可。全抹消は常に送信可
  assert.equal(isTrainingSendReady('retract', injectedOnly), true);
  assert.equal(isTrainingSendReady('retract', none), false);
  assert.equal(isTrainingSendReady('retractAll', none), true);
  assert.equal(isTrainingSendReady('retractAll', none, true), false);
});

test('表示名と処理中メッセージ', () => {
  assert.equal(trainingSelectionLabel('retract'), '抹消');
  assert.equal(trainingSelectionLabel('retractAll'), '全抹消');
  assert.equal(trainingRetractingMessage(3), '3件の訓練を抹消中');
  assert.equal(TRAINING_RETRACTING_ALL_MESSAGE, '訓練データを全抹消中');
});

// ---------------------------------------------------------------------------
// API 呼出し
// ---------------------------------------------------------------------------

test('requestTrainingRetract: 要求の形・失敗の文言（400/403/404/409/503/504/500/通信失敗）', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const respond = (status: number, body: unknown = {}) =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return Response.json(body, { status });
    }) as typeof fetch;

  const ok = await requestTrainingRetract(
    { terminalId: 'kkeagh01', scope: 'training', trainingIds: [TID_A] },
    undefined,
    respond(200, retractResponse('training', [TID_A])),
  );
  assert.equal(ok.scope, 'training');
  assert.deepEqual(calls[0], {
    url: '/api/training/retract',
    body: { terminalId: 'kkeagh01', scope: 'training', trainingIds: [TID_A] },
  });

  const cases: [number, string][] = [
    [400, '抹消できませんでした（要求が不正です）'],
    [403, '抹消できませんでした（この端末では操作できません）'],
    [404, '抹消できませんでした（対象の訓練が見つかりません）'],
    [409, '抹消できませんでした（既に抹消済みです）'],
    [503, '抹消できませんでした（取得処理が利用できません）'],
    [504, '抹消の結果を確認できませんでした'],
    [500, '抹消できませんでした'],
  ];
  for (const [status, message] of cases) {
    await assert.rejects(
      requestTrainingRetract({ terminalId: 'kkeagh01', scope: 'all' }, undefined, respond(status)),
      { message },
      String(status),
    );
  }
  await assert.rejects(
    requestTrainingRetract({ terminalId: 'kkeagh01', scope: 'all' }, undefined, (async () => {
      throw new TypeError('network');
    }) as typeof fetch),
    { message: '抹消できませんでした' },
  );
  // 200 でも形式不正は失敗
  await assert.rejects(
    requestTrainingRetract(
      { terminalId: 'kkeagh01', scope: 'all' },
      undefined,
      respond(200, { a: 1 }),
    ),
    { message: '抹消できませんでした' },
  );
});

// ---------------------------------------------------------------------------
// コントローラ
// ---------------------------------------------------------------------------

interface Pending {
  readonly url: string;
  readonly body: unknown;
  resolve(response: Response): void;
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function readyWithInjected(
  items: TrainingInjectionListItem[],
  preload: Record<string, string> = {},
) {
  const pending: Pending[] = [];
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve) => {
      pending.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
        resolve,
      });
    })) as typeof fetch;
  const states: TrainingState[] = [];
  const storage = new Map<string, string>(Object.entries(preload));
  const controller = createTrainingController(
    'kkeagh01',
    (state) => states.push(state),
    fetcher,
    createTrainingStockRepository(() => ({
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    })),
  );
  const last = () => states.at(-1)!;
  controller.start();
  pending[0]!.resolve(Response.json({ items: TRAINING_ITEMS, targetLabel: 'x' }));
  await tick();
  controller.loadInjected();
  pending[1]!.resolve(Response.json({ injections: items }));
  await tick();
  return { controller, pending, last, states };
}

test('チェック: 投入済みの行（抹消済みを含む）だけ切り替えられ、存在しない行は無視する', async () => {
  const { controller, last } = await readyWithInjected([
    injection(TID_A, 1),
    injection(TID_B, 2, '2026-10-12T10:03:00.000Z'),
  ]);
  controller.setCheckedInjected(TID_A, true);
  controller.setCheckedInjected(TID_B, true);
  controller.setCheckedInjected(TID_C, true);
  assert.deepEqual(last().checkedInjected, [TID_A, TID_B]);
  controller.setCheckedInjected(TID_A, false);
  controller.setCheckedInjected(TID_B, false);
  assert.deepEqual(last().checkedInjected, []);
  controller.dispose();
});

test('retractChecked: scope=training とチェックした訓練IDで要求し、200 で件数メッセージ・チェック解除・一覧再読込', async () => {
  const { controller, pending, last } = await readyWithInjected([
    injection(TID_A, 1),
    injection(TID_B, 2),
    injection(TID_C, 3),
  ]);
  controller.setCheckedInjected(TID_A, true);
  controller.setCheckedInjected(TID_C, true);
  const promise = controller.retractChecked();
  assert.equal(last().retracting, true);
  assert.equal(pending[2]!.url, '/api/training/retract');
  assert.deepEqual(pending[2]!.body, {
    terminalId: 'kkeagh01',
    scope: 'training',
    trainingIds: [TID_A, TID_C],
  });
  // 抹消中は二重送信・投入ができない
  assert.deepEqual(await controller.retractChecked(), {
    success: false,
    message: '抹消できませんでした',
  });
  assert.equal(pending.length, 3);
  pending[2]!.resolve(Response.json(retractResponse('training', [TID_A, TID_C])));
  const result = await promise;
  await tick();
  assert.deepEqual(result, { success: true, message: '2件の訓練を抹消しました' });
  assert.equal(last().retracting, false);
  assert.deepEqual(last().checkedInjected, []);
  assert.equal(pending[3]!.url, '/api/training/injections?terminalId=kkeagh01');
  // 再読込で該当行が抹消済みになる
  pending[3]!.resolve(
    Response.json({
      injections: [
        injection(TID_A, 1, '2026-10-12T10:05:00.000Z'),
        injection(TID_B, 2),
        injection(TID_C, 3, '2026-10-12T10:05:00.000Z'),
      ],
    }),
  );
  await tick();
  assert.deepEqual(
    last().injected.map((i) => [i.trainingId, i.retractedAt !== null]),
    [
      [TID_A, true],
      [TID_B, false],
      [TID_C, true],
    ],
  );
  controller.dispose();
});

test('retractAll: scope=all で要求し、200 で全抹消メッセージ。ブザー・通知に関わる通信は一切しない', async () => {
  const { controller, pending, last } = await readyWithInjected([injection(TID_A, 1)]);
  controller.setCheckedInjected(TID_A, true);
  const promise = controller.retractAll();
  assert.deepEqual(pending[2]!.body, { terminalId: 'kkeagh01', scope: 'all' });
  pending[2]!.resolve(Response.json(retractResponse('all', [TID_A])));
  assert.deepEqual(await promise, { success: true, message: '訓練データを全抹消しました' });
  await tick();
  assert.deepEqual(last().checkedInjected, []);
  // 抹消の200応答でブザーの鳴動要求は発生しない: 通信は抹消と一覧再読込だけで、通知差分APIには触れない
  const urls = pending.map((p) => p.url);
  assert.deepEqual(urls.slice(2), [
    '/api/training/retract',
    '/api/training/injections?terminalId=kkeagh01',
  ]);
  assert.ok(urls.every((url) => !url.includes('/api/notifications')));
  const source = readFileSync(
    new URL('../src/training/trainingController.ts', import.meta.url),
    'utf8',
  );
  assert.ok(!/notificationStore|useHeaderBuzzer|ChimeRequest|chime/i.test(source));
  controller.dispose();
});

test('retract 失敗: 日本語の文言を返し、チェックを維持して一覧を再読込する', async () => {
  const cases: [number, string][] = [
    [404, '抹消できませんでした（対象の訓練が見つかりません）'],
    [409, '抹消できませんでした（既に抹消済みです）'],
    [503, '抹消できませんでした（取得処理が利用できません）'],
    [504, '抹消の結果を確認できませんでした'],
    [500, '抹消できませんでした'],
  ];
  for (const [status, message] of cases) {
    const { controller, pending, last } = await readyWithInjected([injection(TID_A, 1)]);
    controller.setCheckedInjected(TID_A, true);
    const promise = controller.retractChecked();
    pending[2]!.resolve(Response.json({}, { status }));
    const result = await promise;
    await tick();
    assert.deepEqual(result, { success: false, message }, String(status));
    assert.deepEqual(last().checkedInjected, [TID_A], 'チェックを維持');
    assert.equal(last().retracting, false);
    assert.equal(pending[3]!.url, '/api/training/injections?terminalId=kkeagh01', '再読込');
    controller.dispose();
  }
});

test('再読込で一覧から消えた行のチェックは外れ、抹消済みになった行のチェックは残る', async () => {
  const { controller, pending, last } = await readyWithInjected([
    injection(TID_A, 1),
    injection(TID_B, 2),
  ]);
  controller.setCheckedInjected(TID_A, true);
  controller.setCheckedInjected(TID_B, true);
  controller.loadInjected();
  pending[2]!.resolve(
    Response.json({ injections: [injection(TID_A, 1, '2026-10-12T10:05:00.000Z')] }),
  );
  await tick();
  assert.deepEqual(last().checkedInjected, [TID_A]);
  controller.dispose();
});

test('離脱後の抹消結果は状態を変えない', async () => {
  const { controller, pending, last, states } = await readyWithInjected([injection(TID_A, 1)]);
  controller.setCheckedInjected(TID_A, true);
  const promise = controller.retractChecked();
  const before = states.length;
  controller.dispose();
  pending[2]!.resolve(Response.json(retractResponse('training', [TID_A])));
  await promise;
  assert.equal(states.length, before);
  assert.deepEqual(last().checkedInjected, [TID_A]);
  assert.equal(pending.length, 3, '離脱後は再読込もしない');
});

// ---------------------------------------------------------------------------
// 表示
// ---------------------------------------------------------------------------

const ready: TrainingState = {
  ...INITIAL_TRAINING_STATE,
  load: 'ready',
  items: TRAINING_ITEMS,
};
const render = (state: TrainingState) =>
  renderToStaticMarkup(
    React.createElement(TrainingContent, {
      state,
      onSelect: () => {},
      onGenerate: () => {},
      onReset: () => {},
      onReload: () => {},
      onSetChecked: () => {},
      onSetCheckedInjected: () => {},
      onOpenEntry: () => {},
    }),
  );
const rowOf = (html: string, trainingId: string) =>
  html.match(new RegExp(`<li[^>]*data-training-id="${trainingId}">.*?</li>`))![0];

test('投入済みの行: チェック欄が出る。抹消済みも「抹消済み」でチェック欄があり、新しい順の中に混ざる', () => {
  const html = render({
    ...ready,
    injected: [
      injection(TID_A, 3),
      injection(TID_B, 2, '2026-10-12T10:05:00.000Z'),
      injection(TID_C, 1),
    ],
    checkedInjected: [TID_C],
  });
  const order = [...html.matchAll(/data-training-id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, [TID_A, TID_B, TID_C]);
  const normal = rowOf(html, TID_A);
  assert.match(
    normal,
    /<input[^>]*class="training-row-check"[^>]*aria-label="19:00:03 VPWW55 を選択"/,
  );
  assert.match(normal, /data-status="injected">投入済み</);
  assert.doesNotMatch(normal, /checked=""/);
  assert.match(rowOf(html, TID_C), /<input[^>]*checked=""/);
  const retracted = rowOf(html, TID_B);
  assert.match(retracted, /<input[^>]*type="checkbox"/, '抹消済みの行にもチェック欄がある');
  assert.ok(!retracted.includes('training-row-check-spacer'));
  assert.match(retracted, /data-status="retracted">抹消済み</);
  assert.ok(!/<button/.test(retracted));
});

test('処理中（投入中・抹消中・一覧から外す処理中）は投入済みの行のチェック欄を押せない', () => {
  for (const patch of [{ retracting: true }, { injecting: true }, { hiding: true }]) {
    const html = render({ ...ready, injected: [injection(TID_A, 1)], ...patch });
    assert.match(rowOf(html, TID_A), /<input[^>]*disabled=""/);
  }
});

function toolbarModel(
  selection: TrainingToolbarSelection | null,
  counts: { checked: number; stock: number; checkedInjected: number },
  busy = false,
): TrainingToolbarModel {
  const noop = () => undefined;
  return {
    navigation: {
      localState: { history: ['training-root'], selectedOperation: selection, openDialog: null },
      setLocalState: noop,
      currentToolbar: trainingToolbarDefinitions[0]!,
      definitions: trainingToolbarDefinitions,
      clearSelection: noop,
      navigate: noop,
      back: noop,
      backToRoot: noop,
    } as never,
    counts,
    selection,
    sendReady: isTrainingSendReady(selection, counts, busy),
    selectOperation: noop,
    clear: noop,
    send: noop,
  };
}
const toolbar = (model: TrainingToolbarModel) =>
  renderToStaticMarkup(React.createElement(TrainingToolbar, { model }));
const buttonChunk = (html: string, label: string) =>
  html
    .split('<md-gb-button')
    .find((chunk) => chunk.includes(`monitoring-toolbar-button-content">${label}</span>`))!;

test('ツールバー: 電文抹消は投入済みの行のチェック、電文全抹消は一覧が空でも押せる。送信ラベルは「抹消を送信」「全抹消を送信」', () => {
  const empty = toolbar(toolbarModel(null, { checked: 0, stock: 0, checkedInjected: 0 }));
  assert.match(buttonChunk(empty, '電文抹消'), /soft-disabled=""/);
  assert.ok(!/soft-disabled/.test(buttonChunk(empty, '電文全抹消')));
  const injectedChecked = toolbar(toolbarModel(null, { checked: 0, stock: 0, checkedInjected: 1 }));
  assert.ok(!/soft-disabled/.test(buttonChunk(injectedChecked, '電文抹消')));
  assert.match(buttonChunk(injectedChecked, '電文投入'), /soft-disabled=""/);
  assert.match(buttonChunk(injectedChecked, 'リスト消去'), /soft-disabled=""/);
  const localChecked = toolbar(toolbarModel(null, { checked: 1, stock: 1, checkedInjected: 0 }));
  assert.ok(!/soft-disabled/.test(buttonChunk(localChecked, '電文投入')));
  assert.match(buttonChunk(localChecked, '電文抹消'), /soft-disabled=""/);

  const retract = toolbar(toolbarModel('retract', { checked: 0, stock: 0, checkedInjected: 1 }));
  assert.match(retract, /aria-label="電文抹消、選択中"/);
  assert.match(retract, /aria-label="抹消を送信"/);
  assert.match(retract, /monitoring-send-ready/);
  const all = toolbar(toolbarModel('retractAll', { checked: 0, stock: 0, checkedInjected: 0 }));
  assert.match(all, /aria-label="電文全抹消、選択中"/);
  assert.match(all, /aria-label="全抹消を送信"/);
  assert.match(all, /monitoring-send-ready/);
  // 処理中は送信できない
  const busy = toolbar(
    toolbarModel('retractAll', { checked: 0, stock: 0, checkedInjected: 0 }, true),
  );
  assert.ok(!busy.includes('monitoring-send-ready'));
});

test('抹消済みの色はトークンのみ、行高48pxは変わらない', () => {
  const css = readFileSync(new URL('../src/training/training.css', import.meta.url), 'utf8');
  const block = css.match(/\.training-row-status\[data-status='retracted'\][^{]*\{[^}]*\}/)![0];
  assert.match(block, /var\(--md-sys-color-on-surface-variant\)/);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(block));
  assert.match(css, /\.training-row \{[^}]*block-size: 48px/);
});

// ---------------------------------------------------------------------------
// 抹消済みの行を一覧から外す（リスト消去・リスト全消）
// ---------------------------------------------------------------------------

const RETRACTED_AT = '2026-10-12T10:05:00.000Z';
const entryFor = (id: string) => ({
  id,
  generatedAt: '2026-10-11T06:12:04.000Z',
  itemLabels: ['x'],
  telegram: {
    id,
    itemIds: ['bulletin-tornado' as const],
    telegramType: 'VPHW50' as const,
    title: 't',
    xml: '<Report/>',
    reportDateTime: '2026-10-11T05:10:00.000Z',
    targetDateTime: '2026-10-11T05:10:00.000Z',
    validDateTime: null,
    areaNames: [],
    provenance: 'synthetic' as const,
    isTraining: true as const,
  },
  injectionStatus: 'pending' as const,
});

async function readyWithLocal(items: TrainingInjectionListItem[]) {
  const stored = JSON.stringify({ version: 3, entries: [entryFor('l:0'), entryFor('l:1')] });
  return readyWithInjected(items, { [trainingStockKey('kkeagh01')]: stored });
}

test('選択可否: リスト消去はローカル行または抹消済みの行のチェック、リスト全消は両方の件数。未抹消の投入済みだけでは選べない', () => {
  const base = { checked: 0, stock: 0, checkedInjected: 0, checkedRetracted: 0, retracted: 0 };
  assert.equal(canSelectTrainingOperation('delete', { ...base, checkedInjected: 2 }), false);
  assert.equal(canSelectTrainingOperation('delete', { ...base, checkedRetracted: 1 }), true);
  assert.equal(canSelectTrainingOperation('delete', { ...base, checked: 1 }), true);
  assert.equal(canSelectTrainingOperation('deleteAll', base), false);
  assert.equal(canSelectTrainingOperation('deleteAll', { ...base, retracted: 1 }), true);
  assert.equal(canSelectTrainingOperation('deleteAll', { ...base, stock: 1 }), true);
  assert.equal(canSelectTrainingOperation('delete', { ...base, checkedRetracted: 1 }, true), false);
  // 電文抹消は抹消済みの行を数えない
  assert.equal(canSelectTrainingOperation('retract', { ...base, checkedRetracted: 2 }), false);
  assert.equal(trainingDeletingMessage(3), '3件をリストから消去中');
});

test('requestTrainingInjectionsHide: 要求の形と失敗の文言', async () => {
  const calls: unknown[] = [];
  const respond = (status: number, body: unknown = {}) =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([String(input), JSON.parse(String(init?.body))]);
      return Response.json(body, { status });
    }) as typeof fetch;
  assert.deepEqual(
    await requestTrainingInjectionsHide(
      'kkeagh01',
      [TID_A],
      undefined,
      respond(200, { hiddenTrainingIds: [TID_A] }),
    ),
    [TID_A],
  );
  assert.deepEqual(calls[0], [
    '/api/training/injections/hide',
    { terminalId: 'kkeagh01', trainingIds: [TID_A] },
  ]);
  const cases: [number, string][] = [
    [404, 'リストから消去できませんでした（対象の訓練が見つかりません）'],
    [409, 'リストから消去できませんでした（電文抹消が済んでいない訓練があります）'],
    [503, 'リストから消去できませんでした（取得処理が利用できません）'],
    [400, 'リストから消去できませんでした'],
    [500, 'リストから消去できませんでした'],
  ];
  for (const [status, message] of cases) {
    await assert.rejects(
      requestTrainingInjectionsHide('kkeagh01', [TID_A], undefined, respond(status)),
      { message },
    );
  }
  await assert.rejects(
    requestTrainingInjectionsHide('kkeagh01', [TID_A], undefined, (async () => {
      throw new TypeError('x');
    }) as typeof fetch),
    { message: 'リストから消去できませんでした' },
  );
});

test('clearList(checked): 抹消済みの行をチェックして消去すると hide が呼ばれ、成功後に一覧を再読込する', async () => {
  const { controller, pending, last } = await readyWithLocal([
    injection(TID_A, 1, RETRACTED_AT),
    injection(TID_B, 2),
  ]);
  controller.setCheckedInjected(TID_A, true);
  const promise = controller.clearList('checked');
  assert.equal(last().hiding, true);
  assert.equal(pending[2]!.url, '/api/training/injections/hide');
  assert.deepEqual(pending[2]!.body, { terminalId: 'kkeagh01', trainingIds: [TID_A] });
  pending[2]!.resolve(Response.json({ hiddenTrainingIds: [TID_A] }));
  assert.deepEqual(await promise, { success: true, message: '1件をリストから消去しました' });
  await tick();
  assert.equal(last().hiding, false);
  assert.deepEqual(last().checkedInjected, []);
  assert.equal(pending[3]!.url, '/api/training/injections?terminalId=kkeagh01');
  controller.dispose();
});

test('clearList(all): 抹消済みの行すべてを hide に送り、未抹消の行は送らない。ローカル行だけなら API を呼ばない', async () => {
  const { controller, pending } = await readyWithLocal([
    injection(TID_A, 1, RETRACTED_AT),
    injection(TID_B, 2),
    injection(TID_C, 3, RETRACTED_AT),
  ]);
  const promise = controller.clearList('all');
  assert.deepEqual(pending[2]!.body, { terminalId: 'kkeagh01', trainingIds: [TID_A, TID_C] });
  pending[2]!.resolve(Response.json({ hiddenTrainingIds: [TID_A, TID_C] }));
  assert.deepEqual(await promise, { success: true, message: '4件をリストから消去しました' });
  controller.dispose();

  const second = await readyWithLocal([injection(TID_B, 2)]);
  const result = await second.controller.clearList('all');
  assert.deepEqual(result, { success: true, message: '2件をリストから消去しました' });
  assert.equal(
    second.pending.length,
    2,
    '対象がローカル行だけ（または無し）のときは hide API を呼ばない',
  );
  second.controller.dispose();
});

test('clearList: 409・503・通信失敗では文言を返し、チェックを維持して、ローカル行も消さない', async () => {
  const cases: [number, string][] = [
    [409, 'リストから消去できませんでした（電文抹消が済んでいない訓練があります）'],
    [503, 'リストから消去できませんでした（取得処理が利用できません）'],
    [500, 'リストから消去できませんでした'],
  ];
  for (const [status, message] of cases) {
    const { controller, pending, last } = await readyWithLocal([injection(TID_A, 1, RETRACTED_AT)]);
    controller.setCheckedInjected(TID_A, true);
    const promise = controller.clearList('checked');
    pending[2]!.resolve(Response.json({}, { status }));
    assert.deepEqual(await promise, { success: false, message });
    await tick();
    assert.deepEqual(last().checkedInjected, [TID_A]);
    assert.equal(last().hiding, false);
    assert.equal(pending[3]!.url, '/api/training/injections?terminalId=kkeagh01');
    controller.dispose();
  }
});

test('clearList: 外す処理中は投入・抹消・二重の消去を受け付けない', async () => {
  const { controller, pending } = await readyWithLocal([injection(TID_A, 1, RETRACTED_AT)]);
  controller.setCheckedInjected(TID_A, true);
  const promise = controller.clearList('checked');
  assert.equal((await controller.clearList('checked')).success, false);
  assert.equal((await controller.retractAll()).success, false);
  assert.equal((await controller.injectChecked()).success, false);
  assert.equal(pending.length, 3);
  pending[2]!.resolve(Response.json({ hiddenTrainingIds: [TID_A] }));
  await promise;
  controller.dispose();
});

test('retractChecked は抹消済みの行を送らない', async () => {
  const { controller, pending } = await readyWithLocal([
    injection(TID_A, 1, RETRACTED_AT),
    injection(TID_B, 2),
  ]);
  controller.setCheckedInjected(TID_A, true);
  controller.setCheckedInjected(TID_B, true);
  const promise = controller.retractChecked();
  assert.deepEqual(pending[2]!.body, {
    terminalId: 'kkeagh01',
    scope: 'training',
    trainingIds: [TID_B],
  });
  pending[2]!.resolve(Response.json(retractResponse('training', [TID_B])));
  await promise;
  controller.dispose();
});

test('clearList: ローカル行と抹消済みの行を混ぜると、成功後に両方が消え、未抹消の行は残る。失敗時はローカル行も残る', async () => {
  const mixed = async (status: number) => {
    const ctx = await readyWithLocal([injection(TID_A, 1, RETRACTED_AT), injection(TID_B, 2)]);
    assert.equal(ctx.last().history.length, 2);
    ctx.controller.setChecked('l:0', true);
    ctx.controller.setCheckedInjected(TID_A, true);
    ctx.controller.setCheckedInjected(TID_B, true);
    const promise = ctx.controller.clearList('checked');
    // 外す処理が終わるまでローカル行は消えない
    assert.equal(ctx.last().history.length, 2);
    ctx.pending[2]!.resolve(
      status === 200
        ? Response.json({ hiddenTrainingIds: [TID_A] })
        : Response.json({}, { status }),
    );
    return { ...ctx, result: await promise };
  };
  const ok = await mixed(200);
  assert.deepEqual(ok.result, { success: true, message: '2件をリストから消去しました' });
  assert.deepEqual(
    ok.last().history.map((e) => e.id),
    ['l:1'],
  );
  assert.deepEqual(ok.last().checkedInjected, [TID_B], '未抹消のチェックは残る');
  assert.deepEqual(ok.pending[2]!.body, { terminalId: 'kkeagh01', trainingIds: [TID_A] });
  ok.controller.dispose();
  const ng = await mixed(409);
  assert.equal(ng.result.success, false);
  assert.deepEqual(
    ng.last().history.map((e) => e.id),
    ['l:0', 'l:1'],
  );
  assert.deepEqual(ng.last().checked, ['l:0']);
  ng.controller.dispose();
});

test('clearList は this に依存しない（分割代入して呼んでも動く）', async () => {
  const { controller, pending, last } = await readyWithLocal([injection(TID_A, 1, RETRACTED_AT)]);
  const { clearList, setChecked, setCheckedInjected } = controller;
  setChecked('l:0', true);
  setCheckedInjected(TID_A, true);
  const promise = clearList('checked');
  pending[2]!.resolve(Response.json({ hiddenTrainingIds: [TID_A] }));
  assert.deepEqual(await promise, { success: true, message: '2件をリストから消去しました' });
  assert.deepEqual(
    last().history.map((e) => e.id),
    ['l:1'],
  );
  const { clearList: again } = controller;
  assert.deepEqual(await again('checked'), {
    success: true,
    message: '0件をリストから消去しました',
  });
  controller.dispose();
});

test('retract 成功: 送った未抹消の行のチェックだけ外し、抹消済みの行のチェックは維持する', async () => {
  const items = [injection(TID_A, 1, RETRACTED_AT), injection(TID_B, 2), injection(TID_C, 3)];
  // 行抹消: 未抹消の B だけ送り、チェック済みの抹消済み A は残る
  const one = await readyWithInjected(items);
  one.controller.setCheckedInjected(TID_A, true);
  one.controller.setCheckedInjected(TID_B, true);
  const p1 = one.controller.retractChecked();
  assert.deepEqual((one.pending[2]!.body as { trainingIds: string[] }).trainingIds, [TID_B]);
  one.pending[2]!.resolve(Response.json(retractResponse('training', [TID_B])));
  await p1;
  assert.deepEqual(one.last().checkedInjected, [TID_A]);
  one.controller.dispose();
  // 全抹消: 全未抹消分のチェックを外し、抹消済みの A は残る
  const all = await readyWithInjected(items);
  for (const id of [TID_A, TID_B, TID_C]) all.controller.setCheckedInjected(id, true);
  const p2 = all.controller.retractAll();
  all.pending[2]!.resolve(Response.json(retractResponse('all', [TID_B, TID_C])));
  await p2;
  assert.deepEqual(all.last().checkedInjected, [TID_A]);
  all.controller.dispose();
});

test('clearList: hide の待機中に生成された新しい行は消さない（対象は await 前に確定する）', async () => {
  for (const scope of ['checked', 'all'] as const) {
    const { controller, pending, last } = await readyWithLocal([injection(TID_A, 1, RETRACTED_AT)]);
    controller.setChecked('l:0', true);
    controller.setCheckedInjected(TID_A, true);
    const promise = controller.clearList(scope);
    assert.equal(pending[2]!.url, '/api/training/injections/hide');
    // 待機中に電文が生成されて一覧の先頭へ増える
    controller.selectInGroup('rain', 'warning-43');
    controller.generate();
    pending[3]!.resolve(
      Response.json({
        generationId: 'n',
        generatedAt: '2026-10-11T05:10:30.000Z',
        telegrams: [entryFor('n:0').telegram],
      }),
    );
    await tick();
    assert.deepEqual(
      last().history.map((e) => e.id),
      ['n:0', 'l:0', 'l:1'],
    );
    pending[2]!.resolve(Response.json({ hiddenTrainingIds: [TID_A] }));
    const result = await promise;
    const remaining = last().history.map((e) => e.id);
    if (scope === 'checked') {
      assert.deepEqual(remaining, ['n:0', 'l:1']);
      assert.equal(result.message, '2件をリストから消去しました');
    } else {
      assert.deepEqual(remaining, ['n:0']);
      assert.equal(result.message, '3件をリストから消去しました');
    }
    controller.dispose();
  }
});
