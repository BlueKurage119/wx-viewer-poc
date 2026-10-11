import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TRAINING_ITEMS,
  TRAINING_MAX_ITEMS,
  findTrainingItem,
  parseTrainingGenerateRequest,
  parseTrainingItemIds,
  parseTrainingItemsQuery,
} from '../src/trainingTelegram.js';

const valid = { terminalId: 'kkeagh01', itemIds: ['warning-10', 'bulletin-record-rain'] };

test('項目表: group数は警報注意報13+速報3の16、最大選択数と一致する', () => {
  const groups = new Set(TRAINING_ITEMS.map((item) => item.group));
  assert.equal(groups.size - 2, 16, 'snowmelt/avalanche は選択不可のみのgroup');
  const selectableGroups = new Set(
    TRAINING_ITEMS.filter((item) => item.selectable).map((item) => item.group),
  );
  assert.equal(selectableGroups.size, TRAINING_MAX_ITEMS);
  assert.equal(new Set(TRAINING_ITEMS.map((item) => item.id)).size, TRAINING_ITEMS.length);
  for (const item of TRAINING_ITEMS) {
    assert.equal(item.selectable, item.unavailableReason === null, item.id);
  }
  assert.equal(findTrainingItem('warning-09')?.selectable, false);
  assert.equal(findTrainingItem('warning-04'), null, '洪水警報は項目化しない');
  assert.equal(findTrainingItem('warning-18'), null, '洪水注意報は項目化しない');
  assert.equal(findTrainingItem('warning-27'), null, 'その他注意報は項目化しない');
});

test('parseTrainingGenerateRequest: 正常系と厳密な拒否', () => {
  assert.deepEqual(parseTrainingGenerateRequest(valid), valid);
  const rejected: unknown[] = [
    null,
    [],
    'x',
    {},
    { terminalId: 'k' },
    { ...valid, extra: 1 },
    { ...valid, terminalId: '' },
    { ...valid, terminalId: 1 },
    { ...valid, itemIds: [] },
    { ...valid, itemIds: 'warning-10' },
    { ...valid, itemIds: ['warning-10', 'warning-10'] },
    { ...valid, itemIds: ['warning-10', 'warning-03'] },
    { ...valid, itemIds: ['warning-09'] },
    { ...valid, itemIds: ['warning-99'] },
    { ...valid, itemIds: ['x'.repeat(65)] },
    { ...valid, itemIds: [1] },
    Object.create({ terminalId: 'k', itemIds: ['warning-10'] }),
  ];
  for (const value of rejected) assert.equal(parseTrainingGenerateRequest(value), null);
});

test('parseTrainingItemIds: 16件まで、17件は拒否', () => {
  const onePerGroup = TRAINING_ITEMS.filter(
    (item, index, all) =>
      item.selectable &&
      all.findIndex((other) => other.selectable && other.group === item.group) === index,
  ).map((item) => item.id);
  assert.equal(onePerGroup.length, 16);
  assert.deepEqual(parseTrainingItemIds(onePerGroup), onePerGroup);
  assert.equal(parseTrainingItemIds([...onePerGroup, 'warning-03']), null);
});

test('parseTrainingItemsQuery: terminalIdだけを許可する', () => {
  assert.deepEqual(parseTrainingItemsQuery({ terminalId: 'kkeagh01' }), { terminalId: 'kkeagh01' });
  assert.deepEqual(
    parseTrainingItemsQuery(Object.assign(Object.create(null), { terminalId: 'k' })),
    {
      terminalId: 'k',
    },
  );
  for (const value of [
    null,
    {},
    { terminalId: '' },
    { terminalId: ['a', 'b'] },
    { terminalId: 'a', x: '1' },
    { x: '1' },
  ]) {
    assert.equal(parseTrainingItemsQuery(value), null);
  }
});
