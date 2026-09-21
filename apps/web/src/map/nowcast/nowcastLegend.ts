import type { LayerPresentation } from '../types';
import type { DataColorScale } from '../tiles/dataColorScale';

export const NOWCAST_SOURCE_LABEL = '気象庁 高解像度降水ナウキャスト';
export const NOWCAST_LEGEND_TITLE = '雨雲ナウキャスト（降水強度）';

export const NOWCAST_COLOR_SCALE: DataColorScale = {
  unit: 'mm/h',
  sourceLabel: NOWCAST_SOURCE_LABEL,
  steps: [
    { token: '--wx-data-nowcast-1', label: '0〜1' },
    { token: '--wx-data-nowcast-2', label: '1〜5' },
    { token: '--wx-data-nowcast-3', label: '5〜10' },
    { token: '--wx-data-nowcast-4', label: '10〜20' },
    { token: '--wx-data-nowcast-5', label: '20〜30' },
    { token: '--wx-data-nowcast-6', label: '30〜50' },
    { token: '--wx-data-nowcast-7', label: '50〜80' },
    { token: '--wx-data-nowcast-8', label: '80 以上' },
  ],
};

export const NOWCAST_LEGEND_ITEMS = NOWCAST_COLOR_SCALE.steps.map((step) => ({
  label: `${step.label} ${NOWCAST_COLOR_SCALE.unit}`,
  swatchToken: `var(${step.token})`,
}));

export const NOWCAST_PRESENTATION: LayerPresentation = {
  id: 'nowcast',
  label: '雨雲ナウキャスト',
  legendTitle: NOWCAST_LEGEND_TITLE,
  legendItems: [...NOWCAST_LEGEND_ITEMS],
  sourceLabel: NOWCAST_SOURCE_LABEL,
};
