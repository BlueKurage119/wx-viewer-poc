/**
 * 本パネル専用 16方位→矢羽根回転角の固定表 (Issue #58 §4.1a、確定事項17)。
 *
 * #55 の `classifyWindDirection`（`warningTimeSeriesModel.ts`、8方位専用）は変更しない。
 * 本パネルでは `unit` が「８方位漢字」「１６方位漢字」のいずれでも、方位文字がこの
 * 16方位表にあれば回転角を返す。8方位の角度は #55 の `WIND_DIRECTION_ROTATION` と
 * 一致させる（北=180°等、navigation は回転0度で北を指すため風下=方位角+180°）。
 */
export const WIND_DIRECTION_16_ROTATION: Readonly<Record<string, number>> = Object.freeze({
  北: 180,
  北北東: 202.5,
  北東: 225,
  東北東: 247.5,
  東: 270,
  東南東: 292.5,
  南東: 315,
  南南東: 337.5,
  南: 0,
  南南西: 22.5,
  南西: 45,
  西南西: 67.5,
  西: 90,
  西北西: 112.5,
  北西: 135,
  北北西: 157.5,
});

const DIRECTIONAL_TEXT_PATTERN = /^[北東南西]+$/;

/**
 * 値が方位文字（「北」「東」「南」「西」だけで構成される文字列）かどうかを判定する
 * (§4.1a、§2.3「方向なしの風向」)。方向なしの語は列挙せず、この規則で判定する。
 */
export function isDirectionalText(valueText: string): boolean {
  return valueText.length > 0 && DIRECTIONAL_TEXT_PATTERN.test(valueText);
}

/**
 * `unit` が「８方位漢字」「１６方位漢字」のいずれかで、`valueText` が16方位表にあれば
 * 回転角を返す。それ以外（16方位表に無い方位文字、上記以外の `unit`）は
 * null（推測で回転しない）。
 */
export function classifyWindDirection16(valueText: string, unit: string | null): number | null {
  if (unit !== '８方位漢字' && unit !== '１６方位漢字') {
    return null;
  }
  return WIND_DIRECTION_16_ROTATION[valueText] ?? null;
}
