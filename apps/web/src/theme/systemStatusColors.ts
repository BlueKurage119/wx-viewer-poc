import {
  argbFromHex,
  hexFromArgb,
  themeFromSourceColor,
  type Theme,
} from '@material/material-color-utilities';

export type SystemStatusColor = 'green' | 'yellow' | 'red';
export type SystemStatusColorRole = 'foreground' | 'on-foreground' | 'container' | 'on-container';
export type SystemStatusColorToken =
  `--wx-system-status-${SystemStatusColor}-${SystemStatusColorRole}`;

/** 監視画面の意味色シード。表示にはMD3スキームから得たトークンを使用する。 */
const SYSTEM_STATUS_SEEDS: Readonly<Record<SystemStatusColor, string>> = {
  green: '#34be4d',
  yellow: '#ffce22',
  red: '#ff6240',
};

const themeCache = new Map<SystemStatusColor, Theme>();

function themeFor(color: SystemStatusColor): Theme {
  const cached = themeCache.get(color);
  if (cached) return cached;
  const theme = themeFromSourceColor(argbFromHex(SYSTEM_STATUS_SEEDS[color]));
  themeCache.set(color, theme);
  return theme;
}

/**
 * 監視画面の意味色を、アプリ全体のテーマとは独立した各シードのMD3スキームから生成する。
 */
export function createSystemStatusColors(dark: boolean): Record<SystemStatusColorToken, string> {
  const result = {} as Record<SystemStatusColorToken, string>;
  for (const color of ['green', 'yellow', 'red'] as const) {
    const scheme = dark ? themeFor(color).schemes.dark : themeFor(color).schemes.light;
    result[`--wx-system-status-${color}-foreground`] = hexFromArgb(scheme.primary);
    result[`--wx-system-status-${color}-on-foreground`] = hexFromArgb(scheme.onPrimary);
    result[`--wx-system-status-${color}-container`] = hexFromArgb(scheme.primaryContainer);
    result[`--wx-system-status-${color}-on-container`] = hexFromArgb(scheme.onPrimaryContainer);
  }
  return result;
}
