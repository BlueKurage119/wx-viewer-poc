import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyWarningNotificationCategory,
  type WarningNotificationCategoryResult,
} from '../src/notifications/warningNotificationCategoryClassifier.js';
import { WARNING_CODE_TABLE } from '../src/polling/jmaWarningCurrentReducer.js';

test('AC1: 全 36 コードが独立した固定期待値と完全一致する', () => {
  // emergency: 10件
  const emergencyCodes = ['32', '33', '35', '36', '37', '38', '39', '43', '48', '49'];
  assert.equal(emergencyCodes.length, 10);
  for (const code of emergencyCodes) {
    const expected: WarningNotificationCategoryResult = {
      kind: 'classified',
      category: 'emergency',
    };
    assert.deepEqual(classifyWarningNotificationCategory(code), expected);
  }

  // question: 11件
  const questionCodes = ['02', '03', '04', '05', '06', '07', '08', '09', '10', '19', '29'];
  assert.equal(questionCodes.length, 11);
  for (const code of questionCodes) {
    const expected: WarningNotificationCategoryResult = {
      kind: 'classified',
      category: 'question',
    };
    assert.deepEqual(classifyWarningNotificationCategory(code), expected);
  }

  // warning: 15件
  const warningCodes = [
    '12',
    '13',
    '14',
    '15',
    '16',
    '17',
    '18',
    '20',
    '21',
    '22',
    '23',
    '24',
    '25',
    '26',
    '27',
  ];
  assert.equal(warningCodes.length, 15);
  for (const code of warningCodes) {
    const expected: WarningNotificationCategoryResult = {
      kind: 'classified',
      category: 'warning',
    };
    assert.deepEqual(classifyWarningNotificationCategory(code), expected);
  }

  // 合計 36 コードの重複なき確認
  const allCodes = new Set([...emergencyCodes, ...questionCodes, ...warningCodes]);
  assert.equal(allCodes.size, 36);
});

test('AC2: 解除・未対応の判定、category の非混入、および冪等性', () => {
  // 00 は release
  const releaseResult = classifyWarningNotificationCategory('00');
  assert.deepEqual(releaseResult, { kind: 'release' });
  assert.equal('category' in releaseResult, false);

  // 未対応コード一覧
  const unsupportedInputs = [
    '42',
    '45',
    '46',
    '47',
    '99',
    '01',
    '11',
    '28',
    '30',
    '31',
    '34',
    '40',
    '41',
    '44',
    '',
    '2',
    '0',
    '002',
    ' 02 ',
    '０２',
    '2e0',
    'toString',
    '__proto__',
  ];

  for (const input of unsupportedInputs) {
    const res = classifyWarningNotificationCategory(input);
    assert.deepEqual(res, { kind: 'unsupported' });
    assert.equal('category' in res, false);
  }

  // 既知コードを複数回呼んでも結果が一致する（副作用なし・冪等性）
  const testCodes = ['00', '03', '10', '15', '33', '99', 'toString'];
  for (const code of testCodes) {
    const first = classifyWarningNotificationCategory(code);
    const second = classifyWarningNotificationCategory(code);
    const third = classifyWarningNotificationCategory(code);
    assert.deepEqual(first, second);
    assert.deepEqual(second, third);
  }
});

test('AC5: D2 と C3 の意味整合 - C3 の全 34 対応コードが独立した期待 category と完全一致する', () => {
  // C3 (WARNING_CODE_TABLE) の全 34 キーに対する独立した期待値
  const c3ExpectedCategories: Record<string, 'emergency' | 'question' | 'warning'> = {
    // heavy_rain: 10(注意報), 03(警報), 43(危険警報), 33(特別警報)
    '10': 'question',
    '03': 'question',
    '43': 'emergency',
    '33': 'emergency',
    // landslide: 29(注意報), 09(警報), 49(危険警報), 39(特別警報)
    '29': 'question',
    '09': 'question',
    '49': 'emergency',
    '39': 'emergency',
    // storm_surge: 19(注意報), 08(警報), 48(危険警報), 38(特別警報)
    '19': 'question',
    '08': 'question',
    '48': 'emergency',
    '38': 'emergency',
    // snowstorm: 13(注意報), 02(警報), 32(特別警報)
    '13': 'warning',
    '02': 'question',
    '32': 'emergency',
    // storm: 15(注意報), 05(警報), 35(特別警報)
    '15': 'warning',
    '05': 'question',
    '35': 'emergency',
    // waves: 16(注意報), 07(警報), 37(特別警報)
    '16': 'warning',
    '07': 'question',
    '37': 'emergency',
    // heavy_snow: 12(注意報), 06(警報), 36(特別警報)
    '12': 'warning',
    '06': 'question',
    '36': 'emergency',
    // VPWW61 独立注意報: すべて warning
    '14': 'warning',
    '17': 'warning',
    '20': 'warning',
    '21': 'warning',
    '22': 'warning',
    '23': 'warning',
    '24': 'warning',
    '25': 'warning',
    '26': 'warning',
    '27': 'warning',
  };

  const c3Keys = Object.keys(WARNING_CODE_TABLE);
  assert.equal(c3Keys.length, 34);

  for (const code of c3Keys) {
    const expectedCategory = c3ExpectedCategories[code];
    assert.ok(expectedCategory, `Code ${code} must have expected category`);
    const actual = classifyWarningNotificationCategory(code);
    assert.deepEqual(actual, {
      kind: 'classified',
      category: expectedCategory,
    });
  }

  // 大雨 10→03→43→33 は question→question→emergency→emergency
  const heavyRainCategories = ['10', '03', '43', '33'].map(
    (c) =>
      (classifyWarningNotificationCategory(c) as { kind: 'classified'; category: string }).category,
  );
  assert.deepEqual(heavyRainCategories, ['question', 'question', 'emergency', 'emergency']);

  // 強風 15→05→35 は warning→question→emergency
  const stormCategories = ['15', '05', '35'].map(
    (c) =>
      (classifyWarningNotificationCategory(c) as { kind: 'classified'; category: string }).category,
  );
  assert.deepEqual(stormCategories, ['warning', 'question', 'emergency']);
});
