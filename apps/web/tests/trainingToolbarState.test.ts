import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canSelectTrainingOperation,
  isTrainingSendReady,
  trainingDeletedMessage,
  trainingSelectionLabel,
  trainingToolbarDefinitions,
} from '../src/training/trainingToolbarState.ts';

test('定義: ルート1段・空タイトル、1グループに「削除」「全削除」の順の選択型項目だけ', () => {
  assert.equal(trainingToolbarDefinitions.length, 1);
  const root = trainingToolbarDefinitions[0]!;
  assert.equal(root.id, 'training-root');
  assert.equal(root.title, '');
  assert.deepEqual(
    root.groups.map((group) => group.map((item) => [item.kind, item.label])),
    [
      [
        ['select', '削除'],
        ['select', '全削除'],
      ],
    ],
  );
});

test('選択可否: 削除はチェック1件以上、全削除は一覧1件以上(チェック不要)', () => {
  assert.equal(canSelectTrainingOperation('delete', { checked: 0, stock: 5 }), false);
  assert.equal(canSelectTrainingOperation('delete', { checked: 1, stock: 5 }), true);
  assert.equal(canSelectTrainingOperation('deleteAll', { checked: 0, stock: 0 }), false);
  assert.equal(canSelectTrainingOperation('deleteAll', { checked: 0, stock: 1 }), true);
});

test('送信可否: 未選択は不可、選択中でも対象が0件になれば不可(選択は維持)', () => {
  assert.equal(isTrainingSendReady(null, { checked: 3, stock: 3 }), false);
  assert.equal(isTrainingSendReady('delete', { checked: 1, stock: 3 }), true);
  assert.equal(isTrainingSendReady('delete', { checked: 0, stock: 3 }), false);
  assert.equal(isTrainingSendReady('deleteAll', { checked: 0, stock: 3 }), true);
  assert.equal(isTrainingSendReady('deleteAll', { checked: 0, stock: 0 }), false);
});

test('表示名と送信後メッセージ', () => {
  assert.equal(trainingSelectionLabel('delete'), '削除');
  assert.equal(trainingSelectionLabel('deleteAll'), '全削除');
  assert.equal(trainingDeletedMessage(3), '3件を削除しました');
  assert.equal(trainingDeletedMessage(0), '0件を削除しました');
});
