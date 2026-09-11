import type { Availability, UtcIso8601String } from '@wx-viewer-poc/shared';
import type {
  NowcastFrameKey,
  RadarProduct,
  RadarSnapshot,
  RadarTile,
} from '../repositories/types.js';

export interface TileCoordinate {
  readonly zoom: number;
  readonly tileX: number;
  readonly tileY: number;
}

export interface NowcastCatalog {
  readonly now: UtcIso8601String;
  readonly window: { readonly from: UtcIso8601String; readonly to: UtcIso8601String };
  readonly products: Readonly<
    Record<
      RadarProduct,
      {
        readonly snapshot: RadarSnapshot | null;
        readonly availability: Availability;
        readonly frames: readonly NowcastFrameKey[];
      }
    >
  >;
}

export type NowcastTileResult = {
  readonly coordinate: TileCoordinate;
  readonly availability: Availability;
} & (
  | { readonly kind: 'downloaded' | 'cached'; readonly tile: RadarTile }
  | { readonly kind: 'unavailable'; readonly tile: null; readonly errorKind: string }
);

export interface NowcastOptions {
  readonly cacheRoot: string;
  readonly allowedZooms: readonly number[];
  readonly staleAfterMs: Readonly<Record<RadarProduct, number>>;
  readonly fetchFn?: typeof fetch;
  readonly clock?: () => UtcIso8601String;
  readonly timeoutMs?: number;
}

export interface NowcastAttemptOptions {
  readonly triggerKind?: string; // 既定 manual
  readonly attemptNo?: number; // 既定1、C13から注入
}
