import type { Availability, UtcIso8601String } from '@wx-viewer-poc/shared';
import type { UpstreamAccess } from '../config/pollingSchedule.js';
import type { FreshnessPolicy } from './freshnessPolicy.js';
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
  readonly catalogAccess: UpstreamAccess;
  readonly imageAccess: UpstreamAccess;
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
  readonly getCatalogAccess: () => UpstreamAccess;
  readonly getImageAccess: () => UpstreamAccess;
  readonly freshnessPolicy: FreshnessPolicy;
  readonly fetchFn?: typeof fetch;
  readonly clock?: () => UtcIso8601String;
  readonly timeoutMs?: number;
  /**
   * Issue #43 §9-A: 手動強制更新のときだけ夜間の索引取得ゲートを迂回するための参照先。
   * bypassScheduleStop===true かつ本関数が注入されているときだけ参照される。
   * 未注入なら従来どおり getCatalogAccess() にフォールバックする。
   */
  readonly getManualCatalogAccess?: () => UpstreamAccess;
}

export interface NowcastAttemptOptions {
  readonly triggerKind?: string; // 既定 manual
  readonly attemptNo?: number; // 既定1、C13から注入
  /**
   * Issue #43 §9-A: true のとき、時間帯由来の索引取得停止を迂回する
   * （getManualCatalogAccess が注入されている場合のみ有効。既定 false）。
   */
  readonly bypassScheduleStop?: boolean;
}
