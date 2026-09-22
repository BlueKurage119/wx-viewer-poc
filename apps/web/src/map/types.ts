export type TimelineFrameKind = 'observed' | 'forecast' | 'reference';

export type TimelineFrame = Readonly<{
  id: string;
  displayTime: string;
  kind: TimelineFrameKind;
  enabled: boolean;
}>;

export type TimelineViewModel = Readonly<{
  layerLabel: string;
  selectedFrameId: string | null;
  selectedFrameLabel: string;
  /** ナウキャストの表示サマリー専用。画像と同じ settled コマの種別を持つ。 */
  selectedFrameKind?: TimelineFrameKind | null;
  frames: readonly TimelineFrame[];
  playing: boolean;
  latestAvailable: boolean;
}>;

export type TimelineIntent =
  | { type: 'select-frame'; frameId: string }
  | { type: 'previous-frame' }
  | { type: 'toggle-play' }
  | { type: 'next-frame' }
  | { type: 'select-latest' };

export type MapLayerId = 'nowcast' | 'kikikuru-heavyrain' | 'kikikuru-inund' | 'kikikuru-land';

export type LegendItem = Readonly<{ label: string; swatchToken: string }>;

export type LayerPresentation = Readonly<{
  id: MapLayerId;
  label: string;
  legendTitle: string;
  legendItems: readonly LegendItem[];
  sourceLabel: string;
}>;

export type ViewPlacement = 'initial' | 'manual' | 'returning';

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export interface PixelPoint {
  readonly x: number;
  readonly y: number;
}

export interface ViewportRect {
  readonly width: number;
  readonly height: number;
}

export interface MapAdjustedDimensions {
  readonly containerWidth: number;
  readonly containerHeight: number;
  readonly rightColumnWidth: number;
  readonly bottomCardHeight: number;
}
