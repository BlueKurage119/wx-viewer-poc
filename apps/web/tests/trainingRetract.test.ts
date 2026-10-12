import './setupEnv.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TRAINING_ITEMS, type TrainingInjectionListItem } from '@wx-viewer-poc/shared';
import { TrainingContent } from '../src/training/TrainingView.tsx';
import { TrainingToolbar } from '../src/training/TrainingToolbar.tsx';
import { requestTrainingRetract } from '../src/api/training.ts';
import {
  INITIAL_TRAINING_STATE,
  createTrainingController,
  type TrainingState,
} from '../src/training/trainingController.ts';
import { createTrainingStockRepository } from '../src/training/trainingStock.ts';
import {
  canSelectTrainingOperation,
  isTrainingSendReady,
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

async function readyWithInjected(items: TrainingInjectionListItem[]) {
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
  const storage = new Map<string, string>();
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

test('チェック: 投入済みの行だけ切り替えられ、存在しない行・抹消済みの行は無視する', async () => {
  const { controller, last } = await readyWithInjected([
    injection(TID_A, 1),
    injection(TID_B, 2, '2026-10-12T10:03:00.000Z'),
  ]);
  controller.setCheckedInjected(TID_A, true);
  controller.setCheckedInjected(TID_B, true);
  controller.setCheckedInjected(TID_C, true);
  assert.deepEqual(last().checkedInjected, [TID_A]);
  controller.setCheckedInjected(TID_A, false);
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

test('再読込で一覧から消えた行・抹消済みになった行のチェックは外れる', async () => {
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
  assert.deepEqual(last().checkedInjected, []);
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

test('投入済みの行: チェック欄が出る。抹消済みは「抹消済み」でチェック欄が無く、新しい順の中に混ざる', () => {
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
  assert.ok(!/<input/.test(retracted), '抹消済みの行にチェック欄を置かない');
  assert.match(retracted, /training-row-check-spacer/, '列幅は空けて揃える');
  assert.match(retracted, /data-status="retracted">抹消済み</);
  assert.ok(!/<button/.test(retracted));
});

test('処理中（投入中・抹消中）は投入済みの行のチェック欄を押せない', () => {
  for (const patch of [{ retracting: true }, { injecting: true }]) {
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
