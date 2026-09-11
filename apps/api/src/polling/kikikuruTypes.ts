import type { Availability, UtcIso8601String } from '@wx-viewer-poc/shared';
import type { RiskSnapshot, RiskTile } from '../repositories/types.js';

export type KikikuruLayer = 'heavyrain' | 'inund' | 'land';

export interface KikikuruFrameKey {
  readonly layer: KikikuruLayer;
  readonly baseTime: UtcIso8601String;
  readonly validTime: UtcIso8601String;
  readonly imageId: string;
  readonly member: string;
}

export interface TileCoordinate {
  readonly zoom: number;
  readonly tileX: number;
  readonly tileY: number;
}

export interface KikikuruCatalog {
  readonly now: UtcIso8601String;
  readonly layers: Readonly<
    Record<
      KikikuruLayer,
      {
        readonly snapshot: RiskSnapshot | null;
        readonly availability: Availability;
        readonly frames: readonly KikikuruFrameKey[];
      }
    >
  >;
}

export type KikikuruTileResult = {
  readonly coordinate: TileCoordinate;
  readonly availability: Availability;
} & (
  | { readonly kind: 'downloaded' | 'cached'; readonly tile: RiskTile }
  | { readonly kind: 'unavailable'; readonly tile: null; readonly errorKind: string }
);

export interface KikikuruOptions {
  readonly cacheRoot: string;
  readonly allowedZooms: readonly number[];
  readonly staleAfterMs: Readonly<Record<KikikuruLayer, number>>;
  readonly fetchFn?: typeof fetch;
  readonly clock?: () => UtcIso8601String;
  readonly timeoutMs?: number;
}

export interface KikikuruAttemptOptions {
  readonly triggerKind?: string; // 既定 manual
  readonly attemptNo?: number; // 既定 1
}
