import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  backToolbar,
  backToolbarToRoot,
  createToolbarLocalState,
  currentToolbar,
  navigateToolbar,
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
