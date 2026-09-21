import { argbFromHex, hexFromArgb, themeFromSourceColor } from '@material/material-color-utilities';

type BuzzerNoticeCategory = 'warning' | 'question' | 'emergency';
type BuzzerNoticeRole = 'container' | 'on-container' | 'outline';
type BuzzerNoticeColorToken = `--wx-buzzer-notice-${BuzzerNoticeCategory}-${BuzzerNoticeRole}`;
type BuzzerHeaderColorToken =
  | '--wx-buzzer-header-emergency-container'
  | '--wx-buzzer-header-emergency-on-container'
  | '--wx-buzzer-header-emergency-container-dark'
  | '--wx-buzzer-header-emergency-on-container-dark';
export type BuzzerColorToken = BuzzerNoticeColorToken | BuzzerHeaderColorToken;

const SEED_BUZZER_WARNING = '#FFEB3B'; // Material Yellow 500
const SEED_BUZZER_RED = '#B3261E'; // Material 3 baseline error

const warning = themeFromSourceColor(argbFromHex(SEED_BUZZER_WARNING)).palettes.primary;
const red = themeFromSourceColor(argbFromHex(SEED_BUZZER_RED)).palettes.primary;

/** Issue #63 のブザー表示専用色。Issue #90 の一覧向け通知色とは独立して生成する。 */
export function createBuzzerNoticeColors(dark: boolean): Record<BuzzerColorToken, string> {
  const warningTones = dark
    ? { container: 30, onContainer: 90, outline: 80 }
    : { container: 90, onContainer: 10, outline: 50 };

  return {
    '--wx-buzzer-notice-warning-container': hexFromArgb(warning.tone(warningTones.container)),
    '--wx-buzzer-notice-warning-on-container': hexFromArgb(warning.tone(warningTones.onContainer)),
    '--wx-buzzer-notice-warning-outline': hexFromArgb(warning.tone(warningTones.outline)),
    '--wx-buzzer-notice-question-container': hexFromArgb(red.tone(90)),
    '--wx-buzzer-notice-question-on-container': hexFromArgb(red.tone(10)),
    '--wx-buzzer-notice-question-outline': hexFromArgb(red.tone(50)),
    '--wx-buzzer-notice-emergency-container': hexFromArgb(red.tone(40)),
    '--wx-buzzer-notice-emergency-on-container': hexFromArgb(red.tone(100)),
    '--wx-buzzer-notice-emergency-outline': hexFromArgb(red.tone(80)),
    '--wx-buzzer-header-emergency-container': hexFromArgb(red.tone(40)),
    '--wx-buzzer-header-emergency-on-container': hexFromArgb(red.tone(100)),
    '--wx-buzzer-header-emergency-container-dark': hexFromArgb(red.tone(30)),
    '--wx-buzzer-header-emergency-on-container-dark': hexFromArgb(red.tone(90)),
  };
}
