/**
 * 気象データ色トークン定義 (MD3 準拠 / 気象庁公式配色)
 *
 * 06-ui-md3-protocol §例外 1〜4 に基づき、気象庁公式配色をそのままデータ色トークン値として定義する。
 * HEX リテラルを記述してよい唯一のモジュールである。
 */

export const KIKIKURU_DATA_COLORS = {
  imminent: '#0C000C',
  danger: '#AA00AA',
  warning: '#FF2800',
  caution: '#F2E700',
  none: '#FFFFFF',
} as const;

export const KIKIKURU_COLOR_TOKENS: Readonly<Record<string, string>> = {
  '--wx-data-kikikuru-imminent': KIKIKURU_DATA_COLORS.imminent,
  '--wx-data-kikikuru-danger': KIKIKURU_DATA_COLORS.danger,
  '--wx-data-kikikuru-warning': KIKIKURU_DATA_COLORS.warning,
  '--wx-data-kikikuru-caution': KIKIKURU_DATA_COLORS.caution,
  '--wx-data-kikikuru-none': KIKIKURU_DATA_COLORS.none,
};

/**
 * キキクルデータ色トークンを DOM ルート要素へ書き出す
 */
export function applyDataColors(root: HTMLElement = document.documentElement): void {
  for (const [token, color] of Object.entries(KIKIKURU_COLOR_TOKENS)) {
    root.style.setProperty(token, color);
  }
}
