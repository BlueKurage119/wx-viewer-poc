import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  backToolbar,
  backToolbarToRoot,
  clearToolbarSelection,
  createToolbarLocalState,
  currentToolbar,
  navigateToolbar,
  resetToolbarToRoot,
  toggleToolbarSelection,
  type ToolbarDefinition,
  type ToolbarLocalState,
} from '../src/toolbar/operationToolbarState.ts';
import { selectOperationLineFor } from '../src/toolbar/operationLine.ts';
import { toolbarFocusKey } from '../src/toolbar/toolbarFocus.ts';

// 訓練画面を想定した仮定義（画面固有の型を持たない）。
type Item =
  | { kind: 'select'; label: string; id: 'delete' | 'deleteAll' }
  | { kind: 'navigate'; label: string; toolbarId: string };
type Selection = 'delete' | 'deleteAll';
type State = ToolbarLocalState<Selection, never>;
const definitions: readonly ToolbarDefinition<Item>[] = [
  {
    id: 'training-root',
    title: '',
    groups: [
      [
        { kind: 'select', label: '削除', id: 'delete' },
        { kind: 'select', label: '全削除', id: 'deleteAll' },
      ],
      [{ kind: 'navigate', label: '投入', toolbarId: 'training-inject' }],
    ],
  },
  {
    id: 'training-inject',
    title: '投入',
    groups: [[{ kind: 'select', label: '投入先', id: 'delete' }]],
  },
];
const isNavigateTo = (item: Item, id: string) => item.kind === 'navigate' && item.toolbarId === id;

test('共通状態: 選択はトグルで1つだけ、同じ項目の再押下で解除、別項目で移る（排他）', () => {
  let state: State = createToolbarLocalState('training-root');
  state = toggleToolbarSelection(state, 'delete');
  assert.equal(state.selectedOperation, 'delete');
  state = toggleToolbarSelection(state, 'deleteAll');
  assert.equal(state.selectedOperation, 'deleteAll');
  state = toggleToolbarSelection(state, 'deleteAll');
  assert.equal(state.selectedOperation, null);
  state = toggleToolbarSelection(state, 'delete');
  assert.equal(clearToolbarSelection(state).selectedOperation, null);
});

test('共通状態: navigateで子階層へ進み、戻り・最初へ戻る・画面離脱で選択を破棄する', () => {
  let state: State = toggleToolbarSelection(createToolbarLocalState('training-root'), 'delete');
  const moved = navigateToolbar(state, definitions, 'training-inject');
  assert.deepEqual(moved.history, ['training-root', 'training-inject']);
  assert.equal(moved.selectedOperation, null);
  assert.equal(currentToolbar(moved, definitions).title, '投入');
  assert.equal(navigateToolbar(moved, definitions, 'unknown'), moved);
  assert.equal(navigateToolbar(moved, definitions, 'training-inject'), moved);
  state = toggleToolbarSelection(moved, 'deleteAll');
  const back = backToolbar(state);
  assert.deepEqual(back.history, ['training-root']);
  assert.equal(back.selectedOperation, null);
  assert.equal(backToolbar(back), back, 'ルートでは戻れない');
  assert.deepEqual(backToolbarToRoot(moved).history, ['training-root']);
  // 画面離脱: 階層・選択を破棄
  const away = resetToolbarToRoot(toggleToolbarSelection(moved, 'delete'));
  assert.deepEqual(away.history, ['training-root']);
  assert.equal(away.selectedOperation, null);
  const root: State = createToolbarLocalState('training-root');
  assert.equal(resetToolbarToRoot(root), root);
  assert.throws(() => currentToolbar({ history: ['none'] }, definitions));
});

test('共通フォーカス: 進むときは先頭項目、戻るときは移動元のnavigate項目', () => {
  assert.equal(
    toolbarFocusKey(definitions, ['training-root'], { kind: 'first' }, isNavigateTo),
    'training-root:削除',
  );
  assert.equal(
    toolbarFocusKey(
      definitions,
      ['training-root', 'training-inject'],
      { kind: 'first' },
      isNavigateTo,
    ),
    'training-inject:投入先',
  );
  assert.equal(
    toolbarFocusKey(
      definitions,
      ['training-root'],
      { kind: 'navigate', fromId: 'training-inject' },
      isNavigateTo,
    ),
    'training-root:投入',
  );
  assert.equal(
    toolbarFocusKey(
      definitions,
      ['training-root'],
      { kind: 'navigate', fromId: 'x' },
      isNavigateTo,
    ),
    null,
  );
});

test('共通操作行: 選択中は最優先、それ以外は進行中・最新の行', () => {
  assert.deepEqual(selectOperationLineFor('削除', [{ text: '他', changedSeq: 9 }]), {
    text: '削除を選択中／送信で実行',
  });
  assert.equal(selectOperationLineFor(null, []), null);
  assert.deepEqual(selectOperationLineFor(null, [{ text: '3件を削除しました', changedSeq: 1 }]), {
    text: '3件を削除しました',
  });
  const both = selectOperationLineFor(null, [
    { text: 'a', changedSeq: 5 },
    { text: 'b', changedSeq: 2, active: true },
  ]);
  assert.equal(both?.text, 'b');
  assert.equal(both?.title, 'a／b');
});
