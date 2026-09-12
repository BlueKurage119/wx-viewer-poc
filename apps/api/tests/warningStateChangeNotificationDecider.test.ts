import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideWarningStateChangeNotification,
  isWarningStateChangeDecisionInput,
  WarningStateChangeDecisionError,
  type WarningStateChangeDecisionInput,
  type WarningStateChangeNotificationDecision,
} from '../src/notifications/warningStateChangeNotificationDecider.js';
import { classifyWarningNotificationCategory } from '../src/notifications/warningNotificationCategoryClassifier.js';
import { WARNING_CODE_TABLE } from '../src/polling/jmaWarningCurrentReducer.js';
import type {
  WarningCurrentChange,
  WarningCurrentItemInput,
  WarningPhenomenonKey,
} from '../src/repositories/types.js';

const KIND_NAMES: Record<string, string> = {
  '10': '大雨注意報',
  '03': '大雨警報',
  '43': '大雨危険警報',
  '33': '大雨特別警報',
  '29': '土砂災害注意報',
  '09': '土砂災害警報',
  '49': '土砂災害危険警報',
  '39': '土砂災害特別警報',
  '19': '高潮注意報',
  '08': '高潮警報',
  '48': '高潮危険警報',
  '38': '高潮特別警報',
  '13': '風雪注意報',
  '02': '暴風雪警報',
  '32': '暴風雪特別警報',
  '15': '強風注意報',
  '05': '暴風警報',
  '35': '暴風特別警報',
  '16': '波浪注意報',
  '07': '波浪警報',
  '37': '波浪特別警報',
  '12': '大雪注意報',
  '06': '大雪警報',
  '36': '大雪特別警報',
  '14': '雷注意報',
  '17': '融雪注意報',
  '20': '濃霧注意報',
  '21': '乾燥注意報',
  '22': 'なだれ注意報',
  '23': '低温注意報',
  '24': '霜注意報',
  '25': '着氷注意報',
  '26': '着雪注意報',
  '27': 'その他注意報',
  '00': '解除',
  '99': 'テスト用未対応コード',
};

function createWarningItem(
  kindCode: string,
  overrides: Partial<WarningCurrentItemInput> = {},
): WarningCurrentItemInput {
  return {
    sequence: 1,
    kindCode,
    kindName: KIND_NAMES[kindCode] ?? '警報・注意報',
    kindStatus: '発表',
    lastKindCode: null,
    lastKindName: null,
    significancyCode: null,
    significancyName: null,
    warningLevel: null,
    attentionText: null,
    kindIssuedAt: '2026-09-13T00:00:00.000Z',
    sourceTelegram: 'VPWW55',
    ...overrides,
  };
}

test('AC1: §7.5 の例（緩和・解除）', () => {
  // 43 -> 03 (weakened)
  const heavyRainWeakened43to03: WarningStateChangeDecisionInput = {
    phenomenonKey: 'heavy_rain',
    changeType: 'weakened',
    before: createWarningItem('43'),
    after: createWarningItem('03'),
  };
  const expectedWeakened43to03: WarningStateChangeNotificationDecision = {
    notify: true,
    changeType: 'weakened',
    phenomenonKey: 'heavy_rain',
    category: 'question',
    ackRequired: true,
    categoryBasis: 'after_kind_code',
    basisKindCode: '03',
  };
  assert.deepEqual(
    decideWarningStateChangeNotification(heavyRainWeakened43to03),
    expectedWeakened43to03,
  );

  // 03 -> 10 (weakened)
  const heavyRainWeakened03to10: WarningStateChangeDecisionInput = {
    phenomenonKey: 'heavy_rain',
    changeType: 'weakened',
    before: createWarningItem('03'),
    after: createWarningItem('10'),
  };
  const expectedWeakened03to10: WarningStateChangeNotificationDecision = {
    notify: true,
    changeType: 'weakened',
    phenomenonKey: 'heavy_rain',
    category: 'question',
    ackRequired: true,
    categoryBasis: 'after_kind_code',
    basisKindCode: '10',
  };
  assert.deepEqual(
    decideWarningStateChangeNotification(heavyRainWeakened03to10),
    expectedWeakened03to10,
  );

  // heavy_rain released (before='03', after=null)
  const heavyRainReleased: WarningStateChangeDecisionInput = {
    phenomenonKey: 'heavy_rain',
    changeType: 'released',
    before: createWarningItem('03'),
    after: null,
  };
  const expectedReleased: WarningStateChangeNotificationDecision = {
    notify: true,
    changeType: 'released',
    phenomenonKey: 'heavy_rain',
    category: 'warning',
    ackRequired: false,
    categoryBasis: 'release_rule',
    basisKindCode: null,
  };
  assert.deepEqual(decideWarningStateChangeNotification(heavyRainReleased), expectedReleased);
});

test('AC2: 強化・緩和は after で決まる（§4 の表の全 9 パターン）', () => {
  interface TestCase {
    readonly name: string;
    readonly phenomenonKey: WarningPhenomenonKey;
    readonly changeType: 'strengthened' | 'weakened';
    readonly beforeCode: string;
    readonly afterCode: string;
    readonly expectedCategory: 'warning' | 'question' | 'emergency';
    readonly expectedAckRequired: boolean;
    readonly expectedCategoryBasis: 'after_kind_code';
    readonly expectedBasisKindCode: string;
  }

  const testCases: readonly TestCase[] = [
    {
      name: 'レベル4危険警報 → レベル3警報（緩和）',
      phenomenonKey: 'heavy_rain',
      changeType: 'weakened',
      beforeCode: '43',
      afterCode: '03',
      expectedCategory: 'question',
      expectedAckRequired: true,
      expectedCategoryBasis: 'after_kind_code',
      expectedBasisKindCode: '03',
    },
    {
      name: 'レベル3警報 → レベル2注意報（緩和）',
      phenomenonKey: 'heavy_rain',
      changeType: 'weakened',
      beforeCode: '03',
      afterCode: '10',
      expectedCategory: 'question',
      expectedAckRequired: true,
      expectedCategoryBasis: 'after_kind_code',
      expectedBasisKindCode: '10',
    },
    {
      name: 'レベル2注意報 → レベル3警報（強化）',
      phenomenonKey: 'heavy_rain',
      changeType: 'strengthened',
      beforeCode: '10',
      afterCode: '03',
      expectedCategory: 'question',
      expectedAckRequired: true,
      expectedCategoryBasis: 'after_kind_code',
      expectedBasisKindCode: '03',
    },
    {
      name: '大雨警報 → 大雨特別警報（強化）',
      phenomenonKey: 'heavy_rain',
      changeType: 'strengthened',
      beforeCode: '03',
      afterCode: '33',
      expectedCategory: 'emergency',
      expectedAckRequired: true,
      expectedCategoryBasis: 'after_kind_code',
      expectedBasisKindCode: '33',
    },
    {
      name: '大雨特別警報 → 大雨注意報（緩和）',
      phenomenonKey: 'heavy_rain',
      changeType: 'weakened',
      beforeCode: '33',
      afterCode: '10',
      expectedCategory: 'question',
      expectedAckRequired: true,
      expectedCategoryBasis: 'after_kind_code',
      expectedBasisKindCode: '10',
    },
    {
      name: '強風注意報 → 暴風警報（強化）',
      phenomenonKey: 'storm',
      changeType: 'strengthened',
      beforeCode: '15',
      afterCode: '05',
      expectedCategory: 'question',
      expectedAckRequired: true,
      expectedCategoryBasis: 'after_kind_code',
      expectedBasisKindCode: '05',
    },
    {
      name: '暴風警報 → 強風注意報（緩和）',
      phenomenonKey: 'storm',
      changeType: 'weakened',
      beforeCode: '05',
      afterCode: '15',
      expectedCategory: 'warning',
      expectedAckRequired: false,
      expectedCategoryBasis: 'after_kind_code',
      expectedBasisKindCode: '15',
    },
    {
      name: '大雪注意報 → 大雪警報（強化）',
      phenomenonKey: 'heavy_snow',
      changeType: 'strengthened',
      beforeCode: '12',
      afterCode: '06',
      expectedCategory: 'question',
      expectedAckRequired: true,
      expectedCategoryBasis: 'after_kind_code',
      expectedBasisKindCode: '06',
    },
    {
      name: '波浪特別警報 → 波浪注意報（緩和）',
      phenomenonKey: 'waves',
      changeType: 'weakened',
      beforeCode: '37',
      afterCode: '16',
      expectedCategory: 'warning',
      expectedAckRequired: false,
      expectedCategoryBasis: 'after_kind_code',
      expectedBasisKindCode: '16',
    },
  ];

  for (const tc of testCases) {
    const input: WarningStateChangeDecisionInput = {
      phenomenonKey: tc.phenomenonKey,
      changeType: tc.changeType,
      before: createWarningItem(tc.beforeCode),
      after: createWarningItem(tc.afterCode),
    };
    const expected: WarningStateChangeNotificationDecision = {
      notify: true,
      changeType: tc.changeType,
      phenomenonKey: tc.phenomenonKey,
      category: tc.expectedCategory,
      ackRequired: tc.expectedAckRequired,
      categoryBasis: tc.expectedCategoryBasis,
      basisKindCode: tc.expectedBasisKindCode,
    };
    const actual = decideWarningStateChangeNotification(input);
    assert.deepEqual(actual, expected, `Failed for case: ${tc.name}`);
  }
});

test('AC3: 区分が同じでも通知対象（notify: true 固定）', () => {
  const sameCategoryTransitions: readonly {
    readonly phenomenonKey: WarningPhenomenonKey;
    readonly changeType: 'strengthened' | 'weakened';
    readonly beforeCode: string;
    readonly afterCode: string;
    readonly expectedCategory: 'question' | 'emergency';
  }[] = [
    {
      phenomenonKey: 'heavy_rain',
      changeType: 'strengthened',
      beforeCode: '10',
      afterCode: '03',
      expectedCategory: 'question',
    },
    {
      phenomenonKey: 'heavy_rain',
      changeType: 'weakened',
      beforeCode: '03',
      afterCode: '10',
      expectedCategory: 'question',
    },
    {
      phenomenonKey: 'landslide',
      changeType: 'strengthened',
      beforeCode: '29',
      afterCode: '09',
      expectedCategory: 'question',
    },
    {
      phenomenonKey: 'landslide',
      changeType: 'weakened',
      beforeCode: '09',
      afterCode: '29',
      expectedCategory: 'question',
    },
    {
      phenomenonKey: 'heavy_rain',
      changeType: 'strengthened',
      beforeCode: '43',
      afterCode: '33',
      expectedCategory: 'emergency',
    },
    {
      phenomenonKey: 'heavy_rain',
      changeType: 'weakened',
      beforeCode: '33',
      afterCode: '43',
      expectedCategory: 'emergency',
    },
  ];

  for (const tr of sameCategoryTransitions) {
    const input: WarningStateChangeDecisionInput = {
      phenomenonKey: tr.phenomenonKey,
      changeType: tr.changeType,
      before: createWarningItem(tr.beforeCode),
      after: createWarningItem(tr.afterCode),
    };
    const result = decideWarningStateChangeNotification(input);
    assert.equal(result.notify, true);
    assert.equal(result.category, tr.expectedCategory);
  }
});

test('AC4: 解除は changeType のみで判定 & C3 全 34 コードの整合回帰', () => {
  const c3Codes = Object.keys(WARNING_CODE_TABLE);
  assert.equal(c3Codes.length, 34);

  // 1. C3 の 34 コードすべてが before に入った released 入力で、category: 'warning', ackRequired: false, basisKindCode: null
  for (const code of c3Codes) {
    const def = WARNING_CODE_TABLE[code];
    const input: WarningStateChangeDecisionInput = {
      phenomenonKey: def.phenomenonKey,
      changeType: 'released',
      before: createWarningItem(code),
      after: null,
    };
    const expected: WarningStateChangeNotificationDecision = {
      notify: true,
      changeType: 'released',
      phenomenonKey: def.phenomenonKey,
      category: 'warning',
      ackRequired: false,
      categoryBasis: 'release_rule',
      basisKindCode: null,
    };
    const actual = decideWarningStateChangeNotification(input);
    assert.deepEqual(actual, expected);
  }

  // 2. C3 の全 34 コードが D2 で classified になる（release / unsupported が 0 件）
  for (const code of c3Codes) {
    const classification = classifyWarningNotificationCategory(code);
    assert.equal(
      classification.kind,
      'classified',
      `C3 code ${code} must be classified by D2, got kind: ${classification.kind}`,
    );
  }
});

test('AC5: ackRequired の対応（warning=false, question=true, emergency=true）', () => {
  // warning -> ackRequired: false
  const warningDec = decideWarningStateChangeNotification({
    phenomenonKey: 'storm',
    changeType: 'weakened',
    before: createWarningItem('05'),
    after: createWarningItem('15'),
  });
  assert.equal(warningDec.category, 'warning');
  assert.equal(warningDec.ackRequired, false);

  const wavesWarningDec = decideWarningStateChangeNotification({
    phenomenonKey: 'waves',
    changeType: 'weakened',
    before: createWarningItem('37'),
    after: createWarningItem('16'),
  });
  assert.equal(wavesWarningDec.category, 'warning');
  assert.equal(wavesWarningDec.ackRequired, false);

  // question -> ackRequired: true
  const questionDec = decideWarningStateChangeNotification({
    phenomenonKey: 'heavy_rain',
    changeType: 'weakened',
    before: createWarningItem('43'),
    after: createWarningItem('03'),
  });
  assert.equal(questionDec.category, 'question');
  assert.equal(questionDec.ackRequired, true);

  // emergency -> ackRequired: true
  const emergencyDec = decideWarningStateChangeNotification({
    phenomenonKey: 'heavy_rain',
    changeType: 'strengthened',
    before: createWarningItem('03'),
    after: createWarningItem('33'),
  });
  assert.equal(emergencyDec.category, 'emergency');
  assert.equal(emergencyDec.ackRequired, true);
});

test('AC6: 対象外 changeType（new / continued / 未知値）の例外検査', () => {
  const newChange = {
    phenomenonKey: 'heavy_rain',
    changeType: 'new',
    before: null,
    after: createWarningItem('03'),
  } as unknown as WarningStateChangeDecisionInput;

  assert.throws(
    () => decideWarningStateChangeNotification(newChange),
    (err: unknown) => {
      assert.ok(err instanceof WarningStateChangeDecisionError);
      assert.equal(err.reason, 'unsupported_change_type');
      return true;
    },
  );

  const continuedChange = {
    phenomenonKey: 'heavy_rain',
    changeType: 'continued',
    before: createWarningItem('03'),
    after: createWarningItem('03'),
  } as unknown as WarningStateChangeDecisionInput;

  assert.throws(
    () => decideWarningStateChangeNotification(continuedChange),
    (err: unknown) => {
      assert.ok(err instanceof WarningStateChangeDecisionError);
      assert.equal(err.reason, 'unsupported_change_type');
      return true;
    },
  );

  const unknownChange = {
    phenomenonKey: 'heavy_rain',
    changeType: 'foo',
    before: createWarningItem('03'),
    after: createWarningItem('03'),
  } as unknown as WarningStateChangeDecisionInput;

  assert.throws(
    () => decideWarningStateChangeNotification(unknownChange),
    (err: unknown) => {
      assert.ok(err instanceof WarningStateChangeDecisionError);
      assert.equal(err.reason, 'unsupported_change_type');
      return true;
    },
  );
});

test('AC7: 型ガード isWarningStateChangeDecisionInput & 合成差分配列の絞り込み', () => {
  const validStrengthened: WarningCurrentChange = {
    phenomenonKey: 'heavy_rain',
    changeType: 'strengthened',
    before: createWarningItem('10'),
    after: createWarningItem('03'),
  };
  const validWeakened: WarningCurrentChange = {
    phenomenonKey: 'heavy_rain',
    changeType: 'weakened',
    before: createWarningItem('03'),
    after: createWarningItem('10'),
  };
  const validReleased: WarningCurrentChange = {
    phenomenonKey: 'heavy_rain',
    changeType: 'released',
    before: createWarningItem('03'),
    after: null,
  };
  const invalidNew: WarningCurrentChange = {
    phenomenonKey: 'heavy_rain',
    changeType: 'new',
    before: null,
    after: createWarningItem('03'),
  };
  const invalidContinued: WarningCurrentChange = {
    phenomenonKey: 'heavy_rain',
    changeType: 'continued',
    before: createWarningItem('03'),
    after: createWarningItem('03'),
  };
  const malformedStrengthened: WarningCurrentChange = {
    phenomenonKey: 'heavy_rain',
    changeType: 'strengthened',
    before: createWarningItem('10'),
    after: null,
  };
  const malformedWeakened: WarningCurrentChange = {
    phenomenonKey: 'heavy_rain',
    changeType: 'weakened',
    before: null,
    after: createWarningItem('10'),
  };
  const malformedReleasedWithAfter: WarningCurrentChange = {
    phenomenonKey: 'heavy_rain',
    changeType: 'released',
    before: createWarningItem('03'),
    after: createWarningItem('10'),
  };
  const malformedReleasedNullBefore: WarningCurrentChange = {
    phenomenonKey: 'heavy_rain',
    changeType: 'released',
    before: null,
    after: null,
  };

  assert.equal(isWarningStateChangeDecisionInput(validStrengthened), true);
  assert.equal(isWarningStateChangeDecisionInput(validWeakened), true);
  assert.equal(isWarningStateChangeDecisionInput(validReleased), true);
  assert.equal(isWarningStateChangeDecisionInput(invalidNew), false);
  assert.equal(isWarningStateChangeDecisionInput(invalidContinued), false);
  assert.equal(isWarningStateChangeDecisionInput(malformedStrengthened), false);
  assert.equal(isWarningStateChangeDecisionInput(malformedWeakened), false);
  assert.equal(isWarningStateChangeDecisionInput(malformedReleasedWithAfter), false);
  assert.equal(isWarningStateChangeDecisionInput(malformedReleasedNullBefore), false);

  // 合成差分配列のフィルタリングと判定関数実行
  const mixedChanges: readonly WarningCurrentChange[] = [
    invalidNew,
    validStrengthened,
    invalidContinued,
    validWeakened,
    validReleased,
    malformedStrengthened,
    malformedReleasedWithAfter,
  ];

  const filtered = mixedChanges.filter(isWarningStateChangeDecisionInput);
  assert.equal(filtered.length, 3);

  for (const change of filtered) {
    // 例外なく判定できることを確認
    const dec = decideWarningStateChangeNotification(change);
    assert.equal(dec.notify, true);
  }
});

test('AC8: 不整合入力の例外検査（malformed_change & unclassifiable_kind_code）', () => {
  // strengthened で after: null
  const strengthenedNullAfter = {
    phenomenonKey: 'heavy_rain',
    changeType: 'strengthened',
    before: createWarningItem('10'),
    after: null,
  } as unknown as WarningStateChangeDecisionInput;
  assert.throws(
    () => decideWarningStateChangeNotification(strengthenedNullAfter),
    (err: unknown) => {
      assert.ok(err instanceof WarningStateChangeDecisionError);
      assert.equal(err.reason, 'malformed_change');
      return true;
    },
  );

  // weakened で before: null
  const weakenedNullBefore = {
    phenomenonKey: 'heavy_rain',
    changeType: 'weakened',
    before: null,
    after: createWarningItem('10'),
  } as unknown as WarningStateChangeDecisionInput;
  assert.throws(
    () => decideWarningStateChangeNotification(weakenedNullBefore),
    (err: unknown) => {
      assert.ok(err instanceof WarningStateChangeDecisionError);
      assert.equal(err.reason, 'malformed_change');
      return true;
    },
  );

  // released で after 非 null
  const releasedNonNullAfter = {
    phenomenonKey: 'heavy_rain',
    changeType: 'released',
    before: createWarningItem('03'),
    after: createWarningItem('10'),
  } as unknown as WarningStateChangeDecisionInput;
  assert.throws(
    () => decideWarningStateChangeNotification(releasedNonNullAfter),
    (err: unknown) => {
      assert.ok(err instanceof WarningStateChangeDecisionError);
      assert.equal(err.reason, 'malformed_change');
      return true;
    },
  );

  // released で before null
  const releasedNullBefore = {
    phenomenonKey: 'heavy_rain',
    changeType: 'released',
    before: null,
    after: null,
  } as unknown as WarningStateChangeDecisionInput;
  assert.throws(
    () => decideWarningStateChangeNotification(releasedNullBefore),
    (err: unknown) => {
      assert.ok(err instanceof WarningStateChangeDecisionError);
      assert.equal(err.reason, 'malformed_change');
      return true;
    },
  );

  // strengthened で after.kindCode が未対応コード '99'
  const unclassifiable99: WarningStateChangeDecisionInput = {
    phenomenonKey: 'heavy_rain',
    changeType: 'strengthened',
    before: createWarningItem('10'),
    after: createWarningItem('99'),
  };
  assert.throws(
    () => decideWarningStateChangeNotification(unclassifiable99),
    (err: unknown) => {
      assert.ok(err instanceof WarningStateChangeDecisionError);
      assert.equal(err.reason, 'unclassifiable_kind_code');
      return true;
    },
  );

  // strengthened で after.kindCode が '00' (release)
  const unclassifiable00: WarningStateChangeDecisionInput = {
    phenomenonKey: 'heavy_rain',
    changeType: 'strengthened',
    before: createWarningItem('10'),
    after: createWarningItem('00'),
  };
  assert.throws(
    () => decideWarningStateChangeNotification(unclassifiable00),
    (err: unknown) => {
      assert.ok(err instanceof WarningStateChangeDecisionError);
      assert.equal(err.reason, 'unclassifiable_kind_code');
      return true;
    },
  );
});

test('AC9: 純粋性の検証（同一結果・引数不変・副作用なし）', () => {
  const input: WarningStateChangeDecisionInput = {
    phenomenonKey: 'storm',
    changeType: 'strengthened',
    before: createWarningItem('15'),
    after: createWarningItem('05'),
  };

  const inputSnapshot = JSON.parse(JSON.stringify(input));

  const result1 = decideWarningStateChangeNotification(input);
  const result2 = decideWarningStateChangeNotification(input);

  // 2 回呼んで完全に一致する
  assert.deepEqual(result1, result2);

  // 入力オブジェクトが変更されていない
  assert.deepEqual(input, inputSnapshot);
});
