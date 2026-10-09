import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  backToolbar,
  backToolbarToRoot,
  createToolbarLocalState,
  currentToolbar,
  navigateToolbar,
  openMonitoringDialog,
  resetToolbarToRoot,
  selectToolbarOperation,
  type ToolbarDefinition,
} from '../src/monitoring/monitoringToolbarState.ts';

const definitions: readonly ToolbarDefinition[] = [
  { id: 'root', title: '', groups: [] },
  { id: 'child', title: '子メニュー', groups: [] },
  { id: 'grandchild', title: '孫メニュー', groups: [] },
];

test('監視ツールバー階層: 既知の遷移だけを積み、戻る操作で選択を解除する', () => {
  let state = createToolbarLocalState('root');
  state = selectToolbarOperation(state, 'start');
  state = navigateToolbar(state, definitions, 'child');
  state = navigateToolbar(state, definitions, 'grandchild');
  assert.deepEqual(state.history, ['root', 'child', 'grandchild']);
  assert.equal(state.selectedOperation, null);
  assert.equal(currentToolbar(state, definitions).title, '孫メニュー');

  const unchanged = navigateToolbar(state, definitions, 'missing');
  assert.equal(unchanged, state);
  assert.equal(navigateToolbar(state, definitions, 'grandchild'), state);
  state = backToolbar(state);
  assert.deepEqual(state.history, ['root', 'child']);
  state = backToolbarToRoot(state);
  assert.deepEqual(state.history, ['root']);
  assert.equal(backToolbar(state), state);
});

test('C27: 監視画面を離れると階層・選択・ダイアログを捨ててルートへ戻る', () => {
  let state = createToolbarLocalState('root');
  state = navigateToolbar(state, definitions, 'child');
  state = navigateToolbar(state, definitions, 'grandchild');
  state = selectToolbarOperation(state, 'start');
  assert.deepEqual(resetToolbarToRoot(state), {
    history: ['root'],
    selectedOperation: null,
    openDialog: null,
  });
  const dialog = openMonitoringDialog(
    navigateToolbar(state, definitions, 'child'),
    'workerRestartHistory',
  );
  assert.deepEqual(resetToolbarToRoot(dialog).history, ['root']);
  assert.equal(resetToolbarToRoot(dialog).openDialog, null);
  // すでにルートで何も開いていなければ同じ参照を返す（不要な再描画をしない）
  const root = createToolbarLocalState('root');
  assert.equal(resetToolbarToRoot(root), root);
});
