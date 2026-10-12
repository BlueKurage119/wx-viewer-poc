import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatTrainingInjectSuccessMessage,
  formatTrainingJst,
  formatTrainingJstTime,
} from '../src/training/trainingFormat.ts';

test('formatTrainingJst / formatTrainingJstTime: JST 整形', () => {
  const iso = '2026-10-12T01:05:09.000Z';
  assert.equal(formatTrainingJst(iso), '2026/10/12 10:05');
  assert.equal(formatTrainingJstTime(iso), '10:05:09');

  assert.equal(formatTrainingJst('invalid'), 'invalid');
  assert.equal(formatTrainingJstTime('invalid'), 'invalid');
});

test('formatTrainingInjectSuccessMessage: 会場採用結果メッセージの整形', () => {
  // 1. 会場未指定の場合
  const res1 = {
    telegrams: [
      {
        adoptions: [
          { venueId: 'bigsight', adoptionResult: '警報として解析済み', adoptionReason: null },
        ],
      },
      {
        adoptions: [
          { venueId: 'bigsight', adoptionResult: '警報として解析済み', adoptionReason: null },
        ],
      },
    ],
  };
  assert.equal(formatTrainingInjectSuccessMessage(res1), '2通を投入しました');

  // 2. 指定会場ですべて採用された場合
  assert.equal(formatTrainingInjectSuccessMessage(res1, 'bigsight'), '2通を投入しました');

  // 3. 指定会場で一部不採用がある場合
  const res2 = {
    telegrams: [
      {
        adoptions: [
          { venueId: 'bigsight', adoptionResult: '警報として解析済み', adoptionReason: null },
        ],
      },
      {
        adoptions: [
          { venueId: 'bigsight', adoptionResult: '対象外のため不採用', adoptionReason: null },
        ],
      },
      { adoptions: [{ venueId: 'bigsight', adoptionResult: null, adoptionReason: 'エラー' }] },
    ],
  };
  assert.equal(
    formatTrainingInjectSuccessMessage(res2, 'bigsight'),
    '3通を投入しました（2通は会場で採用されませんでした）',
  );

  // 4. 指定会場のエントリがない場合（不採用としてカウント）
  const res3 = {
    telegrams: [
      {
        adoptions: [{ venueId: 'trc', adoptionResult: '警報として解析済み', adoptionReason: null }],
      },
    ],
  };
  assert.equal(
    formatTrainingInjectSuccessMessage(res3, 'bigsight'),
    '1通を投入しました（1通は会場で採用されませんでした）',
  );
});
