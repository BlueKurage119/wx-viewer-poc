import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canSelectTrainingOperation,
  isTrainingSendReady,
  trainingDeletedMessage,
  trainingInjectingMessage,
  trainingSelectionLabel,
  trainingToolbarDefinitions,
} from '../src/training/trainingToolbarState.ts';

test('定義: ルート1段・空タイトル、3グループ[リスト消去・リスト全消][電文投入][電文抹消・電文全抹消]の選択型項目', () => {
  assert.equal(trainingToolbarDefinitions.length, 1);
  const root = trainingToolbarDefinitions[0]!;
  assert.equal(root.id, 'training-root');
  assert.equal(root.title, '');
  assert.deepEqual(
    root.groups.map((group) => group.map((item) => [item.kind, item.label])),
    [
      [
        ['select', 'リスト消去'],
        ['select', 'リスト全消'],
      ],
      [['select', '電文投入']],
      [
        ['select', '電文抹消'],
        ['select', '電文全抹消'],
      ],
    ],
  );
});

test('選択可否: 投入・削除はチェック1件以上かつ投入中でない、全削除は一覧1件以上かつ投入中でない', () => {
  assert.equal(canSelectTrainingOperation('inject', { checked: 0, stock: 5 }, false), false);
  assert.equal(canSelectTrainingOperation('inject', { checked: 1, stock: 5 }, false), true);
  assert.equal(canSelectTrainingOperation('inject', { checked: 1, stock: 5 }, true), false);

  assert.equal(canSelectTrainingOperation('delete', { checked: 0, stock: 5 }, false), false);
  assert.equal(canSelectTrainingOperation('delete', { checked: 1, stock: 5 }, false), true);
  assert.equal(canSelectTrainingOperation('delete', { checked: 1, stock: 5 }, true), false);

  assert.equal(canSelectTrainingOperation('deleteAll', { checked: 0, stock: 0 }, false), false);
  assert.equal(canSelectTrainingOperation('deleteAll', { checked: 0, stock: 1 }, false), true);
  assert.equal(canSelectTrainingOperation('deleteAll', { checked: 0, stock: 1 }, true), false);
});

test('送信可否: 未選択や投入中は不可、選択中でも対象が0件になれば不可(選択は維持)', () => {
  assert.equal(isTrainingSendReady(null, { checked: 3, stock: 3 }, false), false);
  assert.equal(isTrainingSendReady('inject', { checked: 1, stock: 3 }, false), true);
  assert.equal(isTrainingSendReady('inject', { checked: 0, stock: 3 }, false), false);
  assert.equal(isTrainingSendReady('inject', { checked: 1, stock: 3 }, true), false);

  assert.equal(isTrainingSendReady('delete', { checked: 1, stock: 3 }, false), true);
  assert.equal(isTrainingSendReady('delete', { checked: 0, stock: 3 }, false), false);
  assert.equal(isTrainingSendReady('delete', { checked: 1, stock: 3 }, true), false);

  assert.equal(isTrainingSendReady('deleteAll', { checked: 0, stock: 3 }, false), true);
  assert.equal(isTrainingSendReady('deleteAll', { checked: 0, stock: 0 }, false), false);
  assert.equal(isTrainingSendReady('deleteAll', { checked: 0, stock: 3 }, true), false);
});

test('表示名と送信後・処理中メッセージ', () => {
  assert.equal(trainingSelectionLabel('inject'), '電文投入');
  assert.equal(trainingSelectionLabel('delete'), 'リスト消去');
  assert.equal(trainingSelectionLabel('deleteAll'), 'リスト全消');
  assert.equal(trainingDeletedMessage(3), '3件をリストから消去しました');
  assert.equal(trainingDeletedMessage(0), '0件をリストから消去しました');
  assert.equal(trainingInjectingMessage(2), '2通を電文投入中');
});
