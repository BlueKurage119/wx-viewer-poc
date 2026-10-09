import type {
  AmedasResponse,
  AreaTimeseriesResponse,
  BulletinsResponse,
  EarlyWarningResponse,
  KikikuruApiFrame,
  KikikuruTimesResponse,
  MonitoringProcessingResponse,
  MonitoringReceptionDetailResponse,
  MonitoringReceptionListResponse,
  MonitoringReceptionQuery,
  MonitoringStatusResponse,
  NotificationReceptionReference,
  NowcastApiFrame,
  NowcastTimesResponse,
  StartupCurrentNotification,
  TerminalDefinition,
  TileCoordinate,
  TileApiError,
  UtcIso8601String,
  VenueId,
  WarningTimeseriesResponse,
  WarningsResponse,
  WeatherControlStatus,
} from '@wx-viewer-poc/shared';
import type { NotificationOutputHistoryInput } from '../repositories/types.js';
import type { FetchHealthStatus } from '../monitoring/fetchHealthEvaluator.js';
import type { MonitoredFetchSourceId } from '../monitoring/fetchHealthSources.js';

export interface WeatherEpoch {
  readonly serverGenerationId: string;
  readonly workerGeneration: string;
  readonly weatherDatabaseGenerationId: string | null;
  readonly readerEpoch: string | null;
}
export type WeatherFailureCode =
  | 'invalid_request'
  | 'not_ready'
  | 'busy'
  | 'deadline_exceeded'
  | 'generation_changed'
  | 'database_unavailable'
  | 'read_failed'
  | 'payload_too_large'
  | 'operation_result_unknown';
export interface DecisionCheckpoint {
  readonly revision: number;
  readonly warningDoneKeys: readonly string[];
  readonly bosaiCompletedKeys: readonly string[];
  readonly bosaiCollecting: boolean;
  readonly fetchHealth: {
    readonly previousStatusBySource: Readonly<
      Record<MonitoredFetchSourceId, FetchHealthStatus | null>
    >;
    readonly activeSinceAtBySource: Readonly<
      Record<MonitoredFetchSourceId, UtcIso8601String | null>
    >;
  };
}
export interface DecisionBatch {
  readonly eventId: string;
  readonly unitId: string;
  readonly epoch: WeatherEpoch;
  readonly beforeRevision: number;
  readonly after: DecisionCheckpoint;
  readonly groups: readonly {
    readonly groupId: string;
    readonly records: readonly NotificationOutputHistoryInput[];
  }[];
}
export interface DecisionReceipt {
  readonly eventId: string;
  readonly acceptedRevision: number;
  readonly groups: readonly {
    readonly groupId: string;
    readonly outcome: 'recorded' | 'record_failed';
  }[];
}
export interface PublicationToken {
  readonly id: string;
  readonly acquisitionEpoch: WeatherEpoch;
  readonly deliveryEpoch: WeatherEpoch;
  readonly revision: number;
  readonly expiresAt: UtcIso8601String;
}
type Operation<Q, R> = { readonly request: Q; readonly response: R };
export type WeatherReadKind =
  'warnings' | 'warning-timeseries' | 'early-warning' | 'area-timeseries' | 'amedas' | 'bulletins';
export interface WeatherResponses {
  readonly warnings: WarningsResponse;
  readonly 'warning-timeseries': WarningTimeseriesResponse;
  readonly 'early-warning': EarlyWarningResponse;
  readonly 'area-timeseries': AreaTimeseriesResponse;
  readonly amedas: AmedasResponse;
  readonly bulletins: BulletinsResponse;
}
export type TileInput =
  | {
      readonly layer: 'nowcast';
      readonly frame: NowcastApiFrame;
      readonly coordinate: TileCoordinate;
    }
  | {
      readonly layer: 'kikikuru';
      readonly frame: KikikuruApiFrame;
      readonly coordinate: TileCoordinate;
    };
export interface WeatherOperations {
  readonly 'weather.read': Operation<
    {
      readonly kind: WeatherReadKind;
      readonly terminal: TerminalDefinition;
      readonly controlStatus: WeatherControlStatus;
      readonly requestedAt: UtcIso8601String;
    },
    WeatherResponses[WeatherReadKind]
  >;
  readonly 'image.times': Operation<
    {
      readonly layer: 'nowcast' | 'kikikuru';
      readonly terminal: TerminalDefinition;
      readonly controlStatus: WeatherControlStatus;
      readonly requestedAt: UtcIso8601String;
    },
    NowcastTimesResponse | KikikuruTimesResponse
  >;
  readonly 'tile.read': Operation<
    TileInput,
    | {
        readonly kind: 'hit';
        readonly bytes: Uint8Array;
        readonly contentType: 'image/png';
        readonly storedAt: UtcIso8601String;
        readonly catalogAvailability: 'available' | 'stale' | 'unavailable';
        /** メイン内でHTTP送信完了までbytes予約を保持する。Workerには渡さない。 */
        readonly release?: () => void;
      }
    | { readonly kind: 'miss' }
  >;
  readonly 'tile.ensure': Operation<
    TileInput & { readonly explicit: boolean },
    | { readonly kind: 'stored'; readonly tileResult: 'cached' | 'downloaded' }
    | { readonly kind: 'unavailable'; readonly error: TileApiError; readonly httpStatus: number }
  >;
  readonly 'history.receptions': Operation<
    MonitoringReceptionQuery,
    MonitoringReceptionListResponse
  >;
  readonly 'history.reception': Operation<
    { readonly receptionId: number; readonly expectedDatabaseGenerationId: string },
    MonitoringReceptionDetailResponse | null
  >;
  readonly 'history.references': Operation<
    readonly {
      readonly weatherDatabaseGenerationId: string | null;
      readonly receptionId: number;
    }[],
    readonly NotificationReceptionReference[]
  >;
  readonly 'monitoring.processing': Operation<
    { readonly terminal: TerminalDefinition },
    MonitoringProcessingResponse
  >;
  readonly 'monitoring.sample': Operation<
    { readonly terminal: TerminalDefinition; readonly requestedAt: UtcIso8601String },
    MonitoringStatusResponse
  >;
  readonly 'startup.project': Operation<
    {
      readonly publicationToken: PublicationToken;
      readonly venueId: VenueId;
      readonly inquiredAt: UtcIso8601String;
    },
    {
      readonly notifications: readonly StartupCurrentNotification[];
      readonly publicationToken: PublicationToken;
      readonly weatherDatabaseGenerationId: string;
    }
  >;
  readonly 'fetch.execute': Operation<
    {
      readonly operationId: string;
      readonly operation: 'start' | 'stop' | 'force_refresh' | 'recovery';
    },
    {
      readonly completed: boolean;
      readonly running: boolean;
      readonly failure: 'failed' | 'aborted' | null;
      readonly sources: readonly string[];
    }
  >;
  readonly 'publication.pause': Operation<
    { readonly token: string; readonly expiresAt: UtcIso8601String },
    { readonly revision: number }
  >;
  readonly 'publication.release': Operation<
    { readonly token: string },
    { readonly released: boolean }
  >;
  readonly 'runtime.prepare': Operation<
    {
      readonly settings: Readonly<Record<string, unknown>>;
      readonly checkpoint: DecisionCheckpoint;
    },
    { readonly accepted: boolean }
  >;
  readonly 'runtime.close': Operation<
    { readonly reason: 'requested' | 'shutdown' },
    { readonly closed: boolean }
  >;
}
export interface WeatherRequest<K extends keyof WeatherOperations = keyof WeatherOperations> {
  readonly protocolVersion: 1;
  readonly requestId: string;
  readonly epoch: WeatherEpoch;
  readonly deadlineAt: UtcIso8601String;
  readonly kind: K;
  readonly payload: WeatherOperations[K]['request'];
}
export interface WeatherReply<K extends keyof WeatherOperations = keyof WeatherOperations> {
  readonly protocolVersion: 1;
  readonly requestId: string;
  readonly epoch: WeatherEpoch;
  readonly result:
    | { readonly status: 'completed'; readonly value: WeatherOperations[K]['response'] }
    | { readonly status: 'failed'; readonly code: WeatherFailureCode }
    | { readonly status: 'unknown'; readonly code: 'operation_result_unknown' };
}
export interface WeatherPort {
  request<K extends keyof WeatherOperations>(input: WeatherRequest<K>): Promise<WeatherReply<K>>;
}
export type WeatherReadPort = WeatherPort;
export type WeatherAcquisitionPort = WeatherPort;

/** クラス実体や循環参照を境界に持ち込まず、バイナリの所有も独立させる。 */
export function assertWeatherData(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object') throw new TypeError('境界データがplain dataではありません');
  if (value instanceof Uint8Array && Object.getPrototypeOf(value) === Uint8Array.prototype) return;
  if (seen.has(value)) throw new TypeError('境界データに循環参照があります');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)
    throw new TypeError('境界にクラス実体は渡せません');
  seen.add(value);
  for (const item of Object.values(value)) assertWeatherData(item, seen);
  seen.delete(value);
}
export function sameWeatherEpoch(a: WeatherEpoch, b: WeatherEpoch): boolean {
  return (
    a.serverGenerationId === b.serverGenerationId &&
    a.workerGeneration === b.workerGeneration &&
    a.weatherDatabaseGenerationId === b.weatherDatabaseGenerationId &&
    a.readerEpoch === b.readerEpoch
  );
}
export interface PayloadFrame {
  readonly requestId: string;
  readonly workerGeneration: string;
  readonly index: number;
  readonly final: boolean;
  readonly bytes: Uint8Array;
}
export const WEATHER_LIMITS = Object.freeze({
  readTimeoutMs: 5000,
  gateTimeoutMs: 2000,
  requests: 64,
  startups: 8,
  frameBytes: 256 * 1024,
  unackedFrames: 2,
  bulkBytes: 8 * 1024 * 1024,
});
export function canSendPayloadFrame(
  frame: PayloadFrame,
  unackedFrames: number,
  outstandingBytes: number,
): boolean {
  return (
    Number.isSafeInteger(frame.index) &&
    frame.index >= 0 &&
    frame.bytes.byteLength <= WEATHER_LIMITS.frameBytes &&
    unackedFrames < WEATHER_LIMITS.unackedFrames &&
    outstandingBytes + frame.bytes.byteLength <= WEATHER_LIMITS.bulkBytes
  );
}
