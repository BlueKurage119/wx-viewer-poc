import type { LayerPresentation } from '../types';

export const NOWCAST_LEGEND_ITEMS = [
  { label: '0〜1 mm/h', swatchToken: 'var(--wx-data-nowcast-1)' },
  { label: '1〜5 mm/h', swatchToken: 'var(--wx-data-nowcast-2)' },
  { label: '5〜10 mm/h', swatchToken: 'var(--wx-data-nowcast-3)' },
  { label: '10〜20 mm/h', swatchToken: 'var(--wx-data-nowcast-4)' },
  { label: '20〜30 mm/h', swatchToken: 'var(--wx-data-nowcast-5)' },
  { label: '30〜50 mm/h', swatchToken: 'var(--wx-data-nowcast-6)' },
  { label: '50〜80 mm/h', swatchToken: 'var(--wx-data-nowcast-7)' },
  { label: '80 以上 mm/h', swatchToken: 'var(--wx-data-nowcast-8)' },
] as const;

export const NOWCAST_SOURCE_LABEL = '気象庁 高解像度降水ナウキャスト';
export const NOWCAST_LEGEND_TITLE = '雨雲ナウキャスト（降水強度）';

export const NOWCAST_PRESENTATION: LayerPresentation = {
  id: 'nowcast',
  label: '雨雲ナウキャスト',
  legendTitle: NOWCAST_LEGEND_TITLE,
  legendItems: [...NOWCAST_LEGEND_ITEMS],
  sourceLabel: NOWCAST_SOURCE_LABEL,
};
