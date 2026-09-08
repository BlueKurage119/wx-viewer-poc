import {
  argbFromHex,
  hexFromArgb,
  themeFromSourceColor,
  type TonalPalette,
} from '@material/material-color-utilities';

export type AlertLevel = 2 | 3 | 4 | 5;
export type NoticeColorCategory = 'warning' | 'question' | 'emergency';
export type SemanticColorRole = 'container' | 'on-container' | 'outline';
export type SemanticColorToken =
  | `--wx-alert-level-${AlertLevel}-${SemanticColorRole}`
  | `--wx-notice-${NoticeColorCategory}-${SemanticColorRole}`;

/**
 * カテゴリ専用シード定数。
 * Material 標準パレット由来のシードであり、HEX リテラルはこの4つのみに限定する (設計書 §2.1)。
 */
const SEED_ALERT_YELLOW = '#FFEB3B'; // Material Yellow 500
const SEED_ALERT_RED = '#B3261E'; // Material 3 baseline error
const SEED_ALERT_PURPLE = '#7B1FA2'; // Material Purple 700
const SEED_NOTICE_EMERGENCY = '#AA00FF'; // Material Purple A700

/** シードごとの primary TonalPalette をメモ化するキャッシュ */
const paletteCache = new Map<string, TonalPalette>();

function getPrimaryPalette(seed: string): TonalPalette {
  let palette = paletteCache.get(seed);
  if (!palette) {
    palette = themeFromSourceColor(argbFromHex(seed)).palettes.primary;
    paletteCache.set(seed, palette);
  }
  return palette;
}

/**
 * カテゴリ専用シードのみから警戒レベル・通知区分のセマンティックカラーを生成する。
 * アプリのテーマシードには依存しない。
 * 呼び出しごとに新しいオブジェクトを返す。
 */
export function createSemanticColors(dark: boolean): Record<SemanticColorToken, string> {
  const yellow = getPrimaryPalette(SEED_ALERT_YELLOW);
  const red = getPrimaryPalette(SEED_ALERT_RED);
  const purple = getPrimaryPalette(SEED_ALERT_PURPLE);
  const emergency = getPrimaryPalette(SEED_NOTICE_EMERGENCY);

  // 警戒レベル 2〜5 および非常ブザーはモード非依存 (light/dark 同値)
  const modeIndependentColors: Record<
    | `--wx-alert-level-${AlertLevel}-${SemanticColorRole}`
    | `--wx-notice-emergency-${SemanticColorRole}`,
    string
  > = {
    // 警戒レベル2 (黄): 明色コンテナ + 暗色文字
    '--wx-alert-level-2-container': hexFromArgb(yellow.tone(85)),
    '--wx-alert-level-2-on-container': hexFromArgb(yellow.tone(10)),
    '--wx-alert-level-2-outline': hexFromArgb(yellow.tone(40)),

    // 警戒レベル3 (赤): 塗りつぶし型
    '--wx-alert-level-3-container': hexFromArgb(red.tone(40)),
    '--wx-alert-level-3-on-container': hexFromArgb(red.tone(100)),
    '--wx-alert-level-3-outline': hexFromArgb(red.tone(80)),

    // 警戒レベル4 (紫): 塗りつぶし型
    '--wx-alert-level-4-container': hexFromArgb(purple.tone(40)),
    '--wx-alert-level-4-on-container': hexFromArgb(purple.tone(100)),
    '--wx-alert-level-4-outline': hexFromArgb(purple.tone(80)),

    // 警戒レベル5 (黒紫): 黒紫中間の塗り + 黄文字 + 紫縁取り
    '--wx-alert-level-5-container': hexFromArgb(purple.tone(5)),
    '--wx-alert-level-5-on-container': hexFromArgb(yellow.tone(85)),
    '--wx-alert-level-5-outline': hexFromArgb(purple.tone(50)),

    // 通知・非常ブザー (紫): 塗りつぶし型、レベル4 outline との重複回避で outline は tone 90
    '--wx-notice-emergency-container': hexFromArgb(emergency.tone(40)),
    '--wx-notice-emergency-on-container': hexFromArgb(emergency.tone(100)),
    '--wx-notice-emergency-outline': hexFromArgb(emergency.tone(90)),
  };

  // 通知 (警報・問いかけ) のみ dark パラメータでトーンを分岐する (設計書 §2.4)
  const modeDependentColors: Record<
    `--wx-notice-warning-${SemanticColorRole}` | `--wx-notice-question-${SemanticColorRole}`,
    string
  > = dark
    ? {
        // dark: container tone 30, on-container tone 90, outline tone 80
        '--wx-notice-warning-container': hexFromArgb(yellow.tone(30)),
        '--wx-notice-warning-on-container': hexFromArgb(yellow.tone(90)),
        '--wx-notice-warning-outline': hexFromArgb(yellow.tone(80)),

        '--wx-notice-question-container': hexFromArgb(red.tone(30)),
        '--wx-notice-question-on-container': hexFromArgb(red.tone(90)),
        '--wx-notice-question-outline': hexFromArgb(red.tone(80)),
      }
    : {
        // light: container tone 90, on-container tone 10, outline tone 50
        '--wx-notice-warning-container': hexFromArgb(yellow.tone(90)),
        '--wx-notice-warning-on-container': hexFromArgb(yellow.tone(10)),
        '--wx-notice-warning-outline': hexFromArgb(yellow.tone(50)),

        '--wx-notice-question-container': hexFromArgb(red.tone(90)),
        '--wx-notice-question-on-container': hexFromArgb(red.tone(10)),
        '--wx-notice-question-outline': hexFromArgb(red.tone(50)),
      };

  return {
    ...modeIndependentColors,
    ...modeDependentColors,
  };
}
