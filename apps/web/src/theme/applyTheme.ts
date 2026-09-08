import {
  argbFromHex,
  hexFromArgb,
  themeFromSourceColor,
  type Theme,
} from '@material/material-color-utilities';
import { createSemanticColors } from './semanticColors';

/**
 * `@material/material-color-utilities` 0.3.0 の `applyTheme()` は
 * Material Web 2.5系が参照する `surface-container-*` 等を書き出さないため使用しない。
 * CSS変数への書き出しは全て自前実装とする(設計書 §3.4.1)。
 */

/** シードHEXごとにテーマ生成をメモ化する */
const themeCache = new Map<string, Theme>();

function themeForSeed(seed: string): Theme {
  let theme = themeCache.get(seed);
  if (!theme) {
    theme = themeFromSourceColor(argbFromHex(seed));
    themeCache.set(seed, theme);
  }
  return theme;
}

/** camelCase → kebab-case (例: onPrimaryContainer → on-primary-container) */
function kebabCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

const SURFACE_CONTAINER_TONES = {
  dark: {
    surfaceDim: 6,
    surfaceBright: 24,
    surfaceContainerLowest: 4,
    surfaceContainerLow: 10,
    surfaceContainer: 12,
    surfaceContainerHigh: 17,
    surfaceContainerHighest: 22,
  },
  light: {
    surfaceDim: 87,
    surfaceBright: 98,
    surfaceContainerLowest: 100,
    surfaceContainerLow: 96,
    surfaceContainer: 94,
    surfaceContainerHigh: 92,
    surfaceContainerHighest: 90,
  },
} as const;

/**
 * シードからlight/dark片方のスキームを生成し、:root(document.documentElement)へ
 * `--md-sys-color-*` CSSカスタムプロパティとして反映する。
 */
export function applyMd3Theme(
  seed: string,
  dark: boolean,
  root: HTMLElement = document.documentElement,
): void {
  const theme = themeForSeed(seed);
  const scheme = dark ? theme.schemes.dark : theme.schemes.light;

  // 1. scheme.toJSON()の全キーを --md-sys-color-{kebab} で書き出す
  const schemeJson = scheme.toJSON();
  for (const [key, value] of Object.entries(schemeJson)) {
    root.style.setProperty(`--md-sys-color-${kebabCase(key)}`, hexFromArgb(value));
  }

  // 2. neutral paletteからsurface-container系8トークンを現行MD3仕様のトーンで合成する
  const neutral = theme.palettes.neutral;
  const tones = dark ? SURFACE_CONTAINER_TONES.dark : SURFACE_CONTAINER_TONES.light;

  root.style.setProperty('--md-sys-color-surface-dim', hexFromArgb(neutral.tone(tones.surfaceDim)));
  root.style.setProperty(
    '--md-sys-color-surface-bright',
    hexFromArgb(neutral.tone(tones.surfaceBright)),
  );
  root.style.setProperty(
    '--md-sys-color-surface-container-lowest',
    hexFromArgb(neutral.tone(tones.surfaceContainerLowest)),
  );
  root.style.setProperty(
    '--md-sys-color-surface-container-low',
    hexFromArgb(neutral.tone(tones.surfaceContainerLow)),
  );
  root.style.setProperty(
    '--md-sys-color-surface-container',
    hexFromArgb(neutral.tone(tones.surfaceContainer)),
  );
  root.style.setProperty(
    '--md-sys-color-surface-container-high',
    hexFromArgb(neutral.tone(tones.surfaceContainerHigh)),
  );
  root.style.setProperty(
    '--md-sys-color-surface-container-highest',
    hexFromArgb(neutral.tone(tones.surfaceContainerHighest)),
  );

  // 3. primaryと同値のsurface-tint
  root.style.setProperty('--md-sys-color-surface-tint', hexFromArgb(schemeJson.primary));

  // 4. surface/backgroundを現行MD3仕様のトーンへ補正する(29キー書き出しの後勝ち)
  const surfaceTone = dark ? 6 : 98;
  const surfaceHex = hexFromArgb(neutral.tone(surfaceTone));
  root.style.setProperty('--md-sys-color-surface', surfaceHex);
  root.style.setProperty('--md-sys-color-background', surfaceHex);

  // 5. 警戒レベル・通知区分のセマンティックトークン書き出し(設計書 §4.1)
  const semanticColors = createSemanticColors(dark);
  for (const [token, color] of Object.entries(semanticColors)) {
    root.style.setProperty(token, color);
  }

  // ネイティブUI・スクロールバーをテーマへ追従させる
  root.style.colorScheme = dark ? 'dark' : 'light';
}
