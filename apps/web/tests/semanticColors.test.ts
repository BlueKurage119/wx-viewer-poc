import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSemanticColors, type SemanticColorToken } from '../src/theme/semanticColors.ts';
import { applyMd3Theme } from '../src/theme/applyTheme.ts';

const EXPECTED_TOKENS: SemanticColorToken[] = [
  '--wx-alert-level-2-container',
  '--wx-alert-level-2-on-container',
  '--wx-alert-level-2-outline',
  '--wx-alert-level-3-container',
  '--wx-alert-level-3-on-container',
  '--wx-alert-level-3-outline',
  '--wx-alert-level-4-container',
  '--wx-alert-level-4-on-container',
  '--wx-alert-level-4-outline',
  '--wx-alert-level-5-container',
  '--wx-alert-level-5-on-container',
  '--wx-alert-level-5-outline',
  '--wx-notice-warning-container',
  '--wx-notice-warning-on-container',
  '--wx-notice-warning-outline',
  '--wx-notice-question-container',
  '--wx-notice-question-on-container',
  '--wx-notice-question-outline',
  '--wx-notice-emergency-container',
  '--wx-notice-emergency-on-container',
  '--wx-notice-emergency-outline',
];

/** 設計書 §2.6 の表から転記した golden 値 (light モード) */
const GOLDEN_LIGHT: Record<SemanticColorToken, string> = {
  '--wx-alert-level-2-container': '#ead723',
  '--wx-alert-level-2-on-container': '#201c00',
  '--wx-alert-level-2-outline': '#695f00',
  '--wx-alert-level-3-container': '#b4271f',
  '--wx-alert-level-3-on-container': '#ffffff',
  '--wx-alert-level-3-outline': '#ffb4aa',
  '--wx-alert-level-4-container': '#8c33b3',
  '--wx-alert-level-4-on-container': '#ffffff',
  '--wx-alert-level-4-outline': '#ebb2ff',
  '--wx-alert-level-5-container': '#210031',
  '--wx-alert-level-5-on-container': '#ead723',
  '--wx-alert-level-5-outline': '#a84fce',
  '--wx-notice-warning-container': '#f9e534',
  '--wx-notice-warning-on-container': '#201c00',
  '--wx-notice-warning-outline': '#847800',
  '--wx-notice-question-container': '#ffdad5',
  '--wx-notice-question-on-container': '#410001',
  '--wx-notice-question-outline': '#d74034',
  '--wx-notice-emergency-container': '#9200dc',
  '--wx-notice-emergency-on-container': '#ffffff',
  '--wx-notice-emergency-outline': '#f4d9ff',
};

/** 設計書 §2.6 の表から転記した golden 値 (dark モード) */
const GOLDEN_DARK: Record<SemanticColorToken, string> = {
  '--wx-alert-level-2-container': '#ead723',
  '--wx-alert-level-2-on-container': '#201c00',
  '--wx-alert-level-2-outline': '#695f00',
  '--wx-alert-level-3-container': '#b4271f',
  '--wx-alert-level-3-on-container': '#ffffff',
  '--wx-alert-level-3-outline': '#ffb4aa',
  '--wx-alert-level-4-container': '#8c33b3',
  '--wx-alert-level-4-on-container': '#ffffff',
  '--wx-alert-level-4-outline': '#ebb2ff',
  '--wx-alert-level-5-container': '#210031',
  '--wx-alert-level-5-on-container': '#ead723',
  '--wx-alert-level-5-outline': '#a84fce',
  '--wx-notice-warning-container': '#4f4800',
  '--wx-notice-warning-on-container': '#f9e534',
  '--wx-notice-warning-outline': '#dbc90a',
  '--wx-notice-question-container': '#910809',
  '--wx-notice-question-on-container': '#ffdad5',
  '--wx-notice-question-outline': '#ffb4aa',
  '--wx-notice-emergency-container': '#9200dc',
  '--wx-notice-emergency-on-container': '#ffffff',
  '--wx-notice-emergency-outline': '#f4d9ff',
};

/** sRGB 相対輝度計算 (WCAG 2.1 準拠、ライブラリ API 非依存) */
function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** コントラスト比計算 */
function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** setProperty を記録する最小限の root stub */
function createRootStub() {
  const properties = new Map<string, string>();
  return {
    style: {
      setProperty(property: string, value: string) {
        properties.set(property, value);
      },
      getPropertyValue(property: string) {
        return properties.get(property) ?? '';
      },
      colorScheme: '',
    },
    properties,
  } as unknown as HTMLElement & { properties: Map<string, string> };
}

// 1. キー網羅
test('§5-1 キー網羅: createSemanticColors(false)/(true) の各キー集合が期待する21キーと完全一致すること', () => {
  for (const dark of [false, true]) {
    const colors = createSemanticColors(dark);
    const keys = Object.keys(colors).sort();
    const expected = [...EXPECTED_TOKENS].sort();
    assert.deepEqual(keys, expected);
    assert.equal(keys.length, 21);
  }
});

// 2. golden 値
test('§5-2 golden値: 各トークンの生成値が設計書§2.6の表から転記した固定期待値と完全一致すること', () => {
  const lightColors = createSemanticColors(false);
  const darkColors = createSemanticColors(true);

  for (const token of EXPECTED_TOKENS) {
    assert.equal(
      lightColors[token],
      GOLDEN_LIGHT[token],
      `light token mismatch for ${token}: got ${lightColors[token]}, expected ${GOLDEN_LIGHT[token]}`,
    );
    assert.equal(
      darkColors[token],
      GOLDEN_DARK[token],
      `dark token mismatch for ${token}: got ${darkColors[token]}, expected ${GOLDEN_DARK[token]}`,
    );
  }
});

// 3. モード非依存性
test('§5-3 モード非依存性: alert-level と notice-emergency は同値、warning/question は異なること', () => {
  const lightColors = createSemanticColors(false);
  const darkColors = createSemanticColors(true);

  // 警戒レベル 2〜5 (12トークン) と notice-emergency (3トークン) は light/dark 同値
  const modeIndependentTokens = EXPECTED_TOKENS.filter(
    (token) => token.startsWith('--wx-alert-level-') || token.startsWith('--wx-notice-emergency-'),
  );
  assert.equal(modeIndependentTokens.length, 15);

  for (const token of modeIndependentTokens) {
    assert.equal(
      lightColors[token],
      darkColors[token],
      `Mode independent token ${token} should have same value in light and dark`,
    );
  }

  // notice-warning / notice-question (6トークン) は light/dark で異なること
  const modeDependentTokens = EXPECTED_TOKENS.filter(
    (token) =>
      token.startsWith('--wx-notice-warning-') || token.startsWith('--wx-notice-question-'),
  );
  assert.equal(modeDependentTokens.length, 6);

  for (const token of modeDependentTokens) {
    assert.notEqual(
      lightColors[token],
      darkColors[token],
      `Mode dependent token ${token} must differ between light and dark`,
    );
  }
});

// 3-2. 非重複 (5周目で追加)
test('§5-3-2 非重複: notice-emergency の container/outline が alert-level-4/5 のいずれとも異なること', () => {
  for (const dark of [false, true]) {
    const colors = createSemanticColors(dark);

    const emergencyContainer = colors['--wx-notice-emergency-container'];
    const emergencyOutline = colors['--wx-notice-emergency-outline'];
    const level4Container = colors['--wx-alert-level-4-container'];
    const level4Outline = colors['--wx-alert-level-4-outline'];
    const level5Container = colors['--wx-alert-level-5-container'];
    const level5Outline = colors['--wx-alert-level-5-outline'];

    assert.notEqual(
      emergencyContainer,
      level4Container,
      'notice-emergency-container must not equal alert-level-4-container',
    );
    assert.notEqual(
      emergencyContainer,
      level5Container,
      'notice-emergency-container must not equal alert-level-5-container',
    );
    assert.notEqual(
      emergencyOutline,
      level4Outline,
      'notice-emergency-outline must not equal alert-level-4-outline',
    );
    assert.notEqual(
      emergencyOutline,
      level5Outline,
      'notice-emergency-outline must not equal alert-level-5-outline',
    );
  }
});

// 4. コントラスト
test('§5-4 コントラスト: 設計書§2.6の9組すべてで文字/背景>=4.5、境界/背景>=3.0を満たすこと', () => {
  const lightColors = createSemanticColors(false);
  const darkColors = createSemanticColors(true);

  // 9組の定義 (bg, text, border)
  const contrastPairs: Array<{
    name: string;
    bg: string;
    text: string;
    border: string;
  }> = [
    {
      name: 'alert-level-2',
      bg: lightColors['--wx-alert-level-2-container'],
      text: lightColors['--wx-alert-level-2-on-container'],
      border: lightColors['--wx-alert-level-2-outline'],
    },
    {
      name: 'alert-level-3',
      bg: lightColors['--wx-alert-level-3-container'],
      text: lightColors['--wx-alert-level-3-on-container'],
      border: lightColors['--wx-alert-level-3-outline'],
    },
    {
      name: 'alert-level-4',
      bg: lightColors['--wx-alert-level-4-container'],
      text: lightColors['--wx-alert-level-4-on-container'],
      border: lightColors['--wx-alert-level-4-outline'],
    },
    {
      name: 'alert-level-5',
      bg: lightColors['--wx-alert-level-5-container'],
      text: lightColors['--wx-alert-level-5-on-container'],
      border: lightColors['--wx-alert-level-5-outline'],
    },
    {
      name: 'notice-warning (light)',
      bg: lightColors['--wx-notice-warning-container'],
      text: lightColors['--wx-notice-warning-on-container'],
      border: lightColors['--wx-notice-warning-outline'],
    },
    {
      name: 'notice-warning (dark)',
      bg: darkColors['--wx-notice-warning-container'],
      text: darkColors['--wx-notice-warning-on-container'],
      border: darkColors['--wx-notice-warning-outline'],
    },
    {
      name: 'notice-question (light)',
      bg: lightColors['--wx-notice-question-container'],
      text: lightColors['--wx-notice-question-on-container'],
      border: lightColors['--wx-notice-question-outline'],
    },
    {
      name: 'notice-question (dark)',
      bg: darkColors['--wx-notice-question-container'],
      text: darkColors['--wx-notice-question-on-container'],
      border: darkColors['--wx-notice-question-outline'],
    },
    {
      name: 'notice-emergency',
      bg: lightColors['--wx-notice-emergency-container'],
      text: lightColors['--wx-notice-emergency-on-container'],
      border: lightColors['--wx-notice-emergency-outline'],
    },
  ];

  for (const pair of contrastPairs) {
    const textContrast = contrastRatio(pair.bg, pair.text);
    const borderContrast = contrastRatio(pair.bg, pair.border);

    assert.ok(
      textContrast >= 4.5,
      `Text contrast for ${pair.name} must be >= 4.5, got ${textContrast.toFixed(2)} (${pair.text} on ${pair.bg})`,
    );
    assert.ok(
      borderContrast >= 3.0,
      `Border contrast for ${pair.name} must be >= 3.0, got ${borderContrast.toFixed(2)} (${pair.border} on ${pair.bg})`,
    );
  }
});

// 5. 書き出し
test('§5-5 書き出し: applyMd3Theme で21トークンが書き出され、シード非依存・モード追従すること', () => {
  const root = createRootStub();

  // (a) 21 トークンが全て書かれること
  applyMd3Theme('#1A73E8', false, root);
  const lightColors = createSemanticColors(false);
  for (const token of EXPECTED_TOKENS) {
    assert.equal(
      root.properties.get(token),
      lightColors[token],
      `Token ${token} should be written to root by applyMd3Theme in light mode`,
    );
  }

  // (b) 異なる2つのシード (#1A73E8 と #B3261E) で意味色の値が完全一致すること
  const rootOtherSeed = createRootStub();
  applyMd3Theme('#B3261E', false, rootOtherSeed);
  for (const token of EXPECTED_TOKENS) {
    assert.equal(
      rootOtherSeed.properties.get(token),
      root.properties.get(token),
      `Token ${token} must remain identical regardless of theme seed`,
    );
  }

  // (c) light → dark → light で値が切り替わり元に戻ること (設計書 §5-5)
  // dark モード適用で dark の値に切り替わること (かつモード依存トークンが変化すること)
  applyMd3Theme('#1A73E8', true, root);
  for (const token of EXPECTED_TOKENS) {
    assert.equal(
      root.properties.get(token),
      GOLDEN_DARK[token],
      `Token ${token} should reflect dark mode golden value`,
    );
  }

  // light モードへ戻したときに light の値に正しく復元されること
  applyMd3Theme('#1A73E8', false, root);
  for (const token of EXPECTED_TOKENS) {
    assert.equal(
      root.properties.get(token),
      GOLDEN_LIGHT[token],
      `Token ${token} should revert to light mode golden value`,
    );
  }
});
