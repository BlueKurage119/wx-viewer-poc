/**
 * #59 天気文字→Material Symbols 固定対応表 (Issue #59 §3.3)。
 *
 * 3時間区間の卓越天気文字から完全一致でのみアイコン名を引く。
 * 表にない文字・空文字は icon: null (文字代替)。
 */
export const WEATHER_ICON_TABLE: Readonly<Record<string, string>> = Object.freeze({
  晴れ: 'sunny',
  くもり: 'cloud',
  雨: 'rainy',
  雪: 'weather_snowy',
  雨または雪: 'rainy_snow',
  雨か雪: 'rainy_snow',
  雪か雨: 'rainy_snow',
});

export type WeatherView =
  | { readonly kind: 'missing' }
  | { readonly kind: 'text'; readonly text: string; readonly icon: string | null };

export function buildWeatherView(valueText: string | null): WeatherView {
  if (valueText === null) {
    return { kind: 'missing' };
  }
  return {
    kind: 'text',
    text: valueText,
    icon: WEATHER_ICON_TABLE[valueText] ?? null,
  };
}
