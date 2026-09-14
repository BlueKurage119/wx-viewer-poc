import type { MapLayerId, LayerPresentation, TimelineViewModel, TimelineFrame } from './types';

export const LAYER_PRESENTATIONS: Readonly<Record<MapLayerId, LayerPresentation>> = {
  nowcast: {
    id: 'nowcast',
    label: '雨雲ナウキャスト',
    legendTitle: '雨雲ナウキャスト（降水強度）',
    legendItems: [
      { label: '80mm/h以上 (猛烈な雨)', swatchToken: 'var(--md-sys-color-error)' },
      { label: '50〜80mm/h (非常に激しい雨)', swatchToken: 'var(--md-sys-color-tertiary)' },
      { label: '30〜50mm/h (激しい雨)', swatchToken: 'var(--md-sys-color-primary)' },
      { label: '10〜30mm/h (やや強い雨)', swatchToken: 'var(--md-sys-color-secondary)' },
      { label: '1〜10mm/h (雨)', swatchToken: 'var(--md-sys-color-outline)' },
    ],
    sourceLabel: '気象庁',
  },
  'kikikuru-heavyrain': {
    id: 'kikikuru-heavyrain',
    label: 'キキクル（大雨）',
    legendTitle: '大雨警報（浸水害）の危険度分布',
    legendItems: [
      {
        label: '極めて危険 (警戒レベル5相当)',
        swatchToken: 'var(--wx-alert-level-5-container, var(--md-sys-color-error))',
      },
      {
        label: '非常に危険 (警戒レベル4相当)',
        swatchToken: 'var(--wx-alert-level-4-container, var(--md-sys-color-error))',
      },
      {
        label: '警戒 (警戒レベル3相当)',
        swatchToken: 'var(--wx-alert-level-3-container, var(--md-sys-color-tertiary))',
      },
      {
        label: '注意 (警戒レベル2相当)',
        swatchToken: 'var(--wx-alert-level-2-container, var(--md-sys-color-secondary))',
      },
    ],
    sourceLabel: '気象庁',
  },
  'kikikuru-inund': {
    id: 'kikikuru-inund',
    label: 'キキクル（浸水）',
    legendTitle: '浸水害危険度分布',
    legendItems: [
      {
        label: '極めて危険 (警戒レベル5相当)',
        swatchToken: 'var(--wx-alert-level-5-container, var(--md-sys-color-error))',
      },
      {
        label: '非常に危険 (警戒レベル4相当)',
        swatchToken: 'var(--wx-alert-level-4-container, var(--md-sys-color-error))',
      },
      {
        label: '警戒 (警戒レベル3相当)',
        swatchToken: 'var(--wx-alert-level-3-container, var(--md-sys-color-tertiary))',
      },
      {
        label: '注意 (警戒レベル2相当)',
        swatchToken: 'var(--wx-alert-level-2-container, var(--md-sys-color-secondary))',
      },
    ],
    sourceLabel: '気象庁',
  },
  'kikikuru-land': {
    id: 'kikikuru-land',
    label: 'キキクル（土砂）',
    legendTitle: '土砂災害警戒判定メッシュ',
    legendItems: [
      {
        label: '極めて危険 (警戒レベル5相当)',
        swatchToken: 'var(--wx-alert-level-5-container, var(--md-sys-color-error))',
      },
      {
        label: '非常に危険 (警戒レベル4相当)',
        swatchToken: 'var(--wx-alert-level-4-container, var(--md-sys-color-error))',
      },
      {
        label: '警戒 (警戒レベル3相当)',
        swatchToken: 'var(--wx-alert-level-3-container, var(--md-sys-color-tertiary))',
      },
      {
        label: '注意 (警戒レベル2相当)',
        swatchToken: 'var(--wx-alert-level-2-container, var(--md-sys-color-secondary))',
      },
    ],
    sourceLabel: '気象庁',
  },
};

const nowcastFrames: readonly TimelineFrame[] = [
  { id: 'nc-01', displayTime: '01:10', kind: 'observed', enabled: true },
  { id: 'nc-02', displayTime: '01:15', kind: 'observed', enabled: true },
  { id: 'nc-03', displayTime: '01:20', kind: 'observed', enabled: true },
  { id: 'nc-04', displayTime: '01:25', kind: 'observed', enabled: true },
  { id: 'nc-05', displayTime: '01:30', kind: 'observed', enabled: true },
  { id: 'nc-06', displayTime: '01:35', kind: 'forecast', enabled: true },
  { id: 'nc-07', displayTime: '01:40', kind: 'forecast', enabled: true },
  { id: 'nc-08', displayTime: '01:45', kind: 'forecast', enabled: true },
  { id: 'nc-09', displayTime: '01:50', kind: 'forecast', enabled: true },
  { id: 'nc-10', displayTime: '01:55', kind: 'forecast', enabled: true },
  { id: 'nc-11', displayTime: '02:00', kind: 'forecast', enabled: true },
];

export const sampleNowcastTimeline: TimelineViewModel = {
  layerLabel: '雨雲ナウキャスト',
  selectedFrameId: 'nc-05',
  selectedFrameLabel: '09/15 01:30',
  frames: nowcastFrames,
  playing: false,
  latestAvailable: true,
};

const kikikuruFrames: readonly TimelineFrame[] = [
  { id: 'kk-ref', displayTime: '01:00', kind: 'reference', enabled: true },
  { id: 'kk-01', displayTime: '01:10', kind: 'observed', enabled: true },
  { id: 'kk-02', displayTime: '01:20', kind: 'observed', enabled: true },
  { id: 'kk-03', displayTime: '01:30', kind: 'observed', enabled: true },
];

export const sampleKikikuruTimeline: TimelineViewModel = {
  layerLabel: 'キキクル（大雨）',
  selectedFrameId: 'kk-03',
  selectedFrameLabel: '09/15 01:30',
  frames: kikikuruFrames,
  playing: false,
  latestAvailable: true,
};

export const emptyTimeline: TimelineViewModel = {
  layerLabel: '雨雲ナウキャスト',
  selectedFrameId: null,
  selectedFrameLabel: '',
  frames: [],
  playing: false,
  latestAvailable: false,
};
