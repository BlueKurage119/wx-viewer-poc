import type { MapLayerId, LayerPresentation, TimelineViewModel, TimelineFrame } from './types';
import { NOWCAST_PRESENTATION } from './nowcast/nowcastLegend';

export const LAYER_PRESENTATIONS: Readonly<Record<MapLayerId, LayerPresentation>> = {
  nowcast: NOWCAST_PRESENTATION,
  'kikikuru-heavyrain': {
    id: 'kikikuru-heavyrain',
    label: 'キキクル（大雨）',
    legendTitle: '浸水害・洪水の危険度分布（統合）',
    legendItems: [
      {
        label: '災害切迫',
        swatchToken: 'var(--wx-data-kikikuru-imminent)',
      },
      {
        label: '危険',
        swatchToken: 'var(--wx-data-kikikuru-danger)',
      },
      {
        label: '警戒',
        swatchToken: 'var(--wx-data-kikikuru-warning)',
      },
      {
        label: '注意',
        swatchToken: 'var(--wx-data-kikikuru-caution)',
      },
      {
        label: '今後の情報等に留意',
        swatchToken: 'var(--wx-data-kikikuru-none)',
      },
    ],
    sourceLabel: '気象庁',
  },
  'kikikuru-inund': {
    id: 'kikikuru-inund',
    label: 'キキクル（浸水）',
    legendTitle: '大雨警報（浸水害）の危険度分布',
    legendItems: [
      {
        label: '災害切迫 (警戒レベル5相当)',
        swatchToken: 'var(--wx-data-kikikuru-imminent)',
      },
      {
        label: '危険',
        swatchToken: 'var(--wx-data-kikikuru-danger)',
      },
      {
        label: '警戒',
        swatchToken: 'var(--wx-data-kikikuru-warning)',
      },
      {
        label: '注意',
        swatchToken: 'var(--wx-data-kikikuru-caution)',
      },
      {
        label: '今後の情報等に留意',
        swatchToken: 'var(--wx-data-kikikuru-none)',
      },
    ],
    sourceLabel: '気象庁',
  },
  'kikikuru-land': {
    id: 'kikikuru-land',
    label: 'キキクル（土砂）',
    legendTitle: '大雨警報（土砂災害）の危険度分布',
    legendItems: [
      {
        label: '災害切迫 (警戒レベル5相当)',
        swatchToken: 'var(--wx-data-kikikuru-imminent)',
      },
      {
        label: '危険 (警戒レベル4相当)',
        swatchToken: 'var(--wx-data-kikikuru-danger)',
      },
      {
        label: '警戒 (警戒レベル3相当)',
        swatchToken: 'var(--wx-data-kikikuru-warning)',
      },
      {
        label: '注意 (警戒レベル2相当)',
        swatchToken: 'var(--wx-data-kikikuru-caution)',
      },
      {
        label: '今後の情報等に留意',
        swatchToken: 'var(--wx-data-kikikuru-none)',
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
  { id: 'kk-latest', displayTime: '01:30', kind: 'reference', enabled: true },
];

export const sampleKikikuruTimeline: TimelineViewModel = {
  layerLabel: 'キキクル（大雨）',
  selectedFrameId: 'kk-latest',
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
