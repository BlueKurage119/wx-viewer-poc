import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSystemStatusColors,
  type SystemStatusColorToken,
} from '../src/theme/systemStatusColors.ts';

const EXPECTED_TOKENS: readonly SystemStatusColorToken[] = [
  '--wx-system-status-green-foreground',
  '--wx-system-status-green-on-foreground',
  '--wx-system-status-green-container',
  '--wx-system-status-green-on-container',
  '--wx-system-status-yellow-foreground',
  '--wx-system-status-yellow-on-foreground',
  '--wx-system-status-yellow-container',
  '--wx-system-status-yellow-on-container',
  '--wx-system-status-red-foreground',
  '--wx-system-status-red-on-foreground',
  '--wx-system-status-red-container',
  '--wx-system-status-red-on-container',
];

function relativeLuminance(hex: string): number {
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map(
    (part) => parseInt(part, 16) / 255,
  );
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test('K1: システム状態色は3シードそれぞれのMD3 primary系12トークンを生成する', () => {
  for (const dark of [false, true]) {
    const colors = createSystemStatusColors(dark);
    assert.deepEqual(Object.keys(colors).sort(), [...EXPECTED_TOKENS].sort());
    for (const color of ['green', 'yellow', 'red'] as const) {
      assert.ok(
        contrastRatio(
          colors[`--wx-system-status-${color}-on-container`],
          colors[`--wx-system-status-${color}-container`],
        ) >= 4.5,
      );
      assert.notEqual(
        colors[`--wx-system-status-${color}-foreground`],
        colors[`--wx-system-status-${color}-container`],
      );
    }
  }
});
