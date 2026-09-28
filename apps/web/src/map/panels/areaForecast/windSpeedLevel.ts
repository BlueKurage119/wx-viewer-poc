/**
 * 風速階級固定対応表 (Issue #58 §3.4, §5.1)。
 *
 * valueCode が '1'〜'6' に完全一致する場合のみ known とし、
 * ナウキャスト凡例データ色トークンを矢羽根の塗りに転用する。
 */
export type WindSpeedRank = 1 | 2 | 3 | 4 | 5 | 6;

export interface KnownLevelInfo {
  readonly level: WindSpeedRank;
  readonly rangeLabel: string;
  readonly colorVar: string;
}

export const WIND_SPEED_LEVEL_TABLE: Readonly<Record<WindSpeedRank, KnownLevelInfo>> =
  Object.freeze({
    1: Object.freeze({ level: 1, rangeLabel: '0-2', colorVar: 'var(--wx-data-nowcast-1)' }),
    2: Object.freeze({ level: 2, rangeLabel: '3-5', colorVar: 'var(--wx-data-nowcast-2)' }),
    3: Object.freeze({ level: 3, rangeLabel: '6-9', colorVar: 'var(--wx-data-nowcast-4)' }),
    4: Object.freeze({ level: 4, rangeLabel: '10-14', colorVar: 'var(--wx-data-nowcast-5)' }),
    5: Object.freeze({ level: 5, rangeLabel: '15-19', colorVar: 'var(--wx-data-nowcast-6)' }),
    6: Object.freeze({ level: 6, rangeLabel: '20以上', colorVar: 'var(--wx-data-nowcast-7)' }),
  });

export type LevelView =
  | { readonly kind: 'missing' }
  | {
      readonly kind: 'known';
      readonly level: WindSpeedRank;
      readonly rangeLabel: string;
      readonly colorVar: string;
    }
  | { readonly kind: 'unknown'; readonly raw: string };

export function buildLevelView(valueCode: string | null): LevelView {
  if (valueCode === null) {
    return { kind: 'missing' };
  }
  if (valueCode === '1') return { kind: 'known', ...WIND_SPEED_LEVEL_TABLE[1] };
  if (valueCode === '2') return { kind: 'known', ...WIND_SPEED_LEVEL_TABLE[2] };
  if (valueCode === '3') return { kind: 'known', ...WIND_SPEED_LEVEL_TABLE[3] };
  if (valueCode === '4') return { kind: 'known', ...WIND_SPEED_LEVEL_TABLE[4] };
  if (valueCode === '5') return { kind: 'known', ...WIND_SPEED_LEVEL_TABLE[5] };
  if (valueCode === '6') return { kind: 'known', ...WIND_SPEED_LEVEL_TABLE[6] };
  return { kind: 'unknown', raw: valueCode };
}
