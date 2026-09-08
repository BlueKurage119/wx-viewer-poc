import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveAvailability,
  type Availability,
  type AvailabilityInput,
  type FreshnessStatus,
} from '../src/index.ts';

describe('resolveAvailability', () => {
  interface TestCase {
    hasLastNormalValue: boolean;
    freshness: FreshnessStatus;
    expected: Availability;
    description: string;
  }

  const tableTestCases: TestCase[] = [
    {
      hasLastNormalValue: false,
      freshness: 'normal',
      expected: 'unavailable',
      description: '保持値なし・鮮度normal => unavailable',
    },
    {
      hasLastNormalValue: false,
      freshness: 'delayed',
      expected: 'unavailable',
      description: '保持値なし・鮮度delayed => unavailable',
    },
    {
      hasLastNormalValue: false,
      freshness: 'abnormal',
      expected: 'unavailable',
      description: '保持値なし・鮮度abnormal => unavailable',
    },
    {
      hasLastNormalValue: true,
      freshness: 'normal',
      expected: 'available',
      description: '保持値あり・鮮度normal => available',
    },
    {
      hasLastNormalValue: true,
      freshness: 'delayed',
      expected: 'stale',
      description: '保持値あり・鮮度delayed => stale',
    },
    {
      hasLastNormalValue: true,
      freshness: 'abnormal',
      expected: 'stale',
      description: '保持値あり・鮮度abnormal => stale',
    },
  ];

  describe('設計書 §3.2 判定表の6ケースをテーブル駆動で完全一致検証', () => {
    for (const { hasLastNormalValue, freshness, expected, description } of tableTestCases) {
      it(description, () => {
        const input: AvailabilityInput = { hasLastNormalValue, freshness };
        const actual = resolveAvailability(input);
        assert.strictEqual(actual, expected);
      });
    }
  });

  describe('個別性質の検証', () => {
    it('hasLastNormalValue: false の三ケースはすべて unavailable になる', () => {
      const freshnessValues: FreshnessStatus[] = ['normal', 'delayed', 'abnormal'];
      for (const freshness of freshnessValues) {
        assert.strictEqual(
          resolveAvailability({ hasLastNormalValue: false, freshness }),
          'unavailable',
        );
      }
    });

    it('hasLastNormalValue: true の delayed と abnormal は、いずれも stale になる', () => {
      assert.strictEqual(
        resolveAvailability({ hasLastNormalValue: true, freshness: 'delayed' }),
        'stale',
      );
      assert.strictEqual(
        resolveAvailability({ hasLastNormalValue: true, freshness: 'abnormal' }),
        'stale',
      );
    });

    it('normal かつ保持値ありだけが available になる', () => {
      assert.strictEqual(
        resolveAvailability({ hasLastNormalValue: true, freshness: 'normal' }),
        'available',
      );
      assert.notStrictEqual(
        resolveAvailability({ hasLastNormalValue: false, freshness: 'normal' }),
        'available',
      );
    });
  });
});
