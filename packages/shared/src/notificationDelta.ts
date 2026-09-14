import type {
  NotificationCategory,
  NotificationDetectionContext,
  NotificationMessageDefinitionRef,
  NotificationOrigin,
  NotificationRelatedRef,
  NotificationTarget,
} from './notification.js';
import type { NotificationDeltaCursor } from './notificationDeltaCursor.js';
import { isNotificationDeltaCursor } from './notificationDeltaCursor.js';
import type { UtcIso8601String } from './types.js';
import type { VenueId } from './venueForecastTargets.js';

export type NotificationDeltaVenueScope = 'venue' | 'global' | 'unresolved';

export interface NotificationDeltaItem {
  /** B4 の id。cursor と同じ採番空間。 */
  readonly sequence: number;
  /** B4 の notification_id。起動応答の outputId とは別空間。 */
  readonly notificationId: string;
  readonly category: NotificationCategory;
  /** H 端末はこの値だけで表示除外を判断する（AD-H069）。 */
  readonly origin: NotificationOrigin;
  /**
   * サーバー検知の文脈（normal / initial）。
   * 検知文脈であって端末起動の意味ではない。表示除外の判断に使ってはならない（AD-D015・AD-H069）。
   */
  readonly detectionContext: NotificationDetectionContext;
  readonly sourceType: string;
  readonly sourceVersion: string | null;
  readonly changeType: string;
  readonly targets: readonly [NotificationTarget, ...NotificationTarget[]];
  readonly occurredAt: UtcIso8601String;
  readonly detectedAt: UtcIso8601String;
  readonly relatedRefs: readonly NotificationRelatedRef[];
  readonly isTraining: boolean;
  readonly venueScope: NotificationDeltaVenueScope;
  readonly output: {
    readonly ackRequired: boolean;
    /** B4 に保存された確定済み文面をそのまま運ぶ。改行で機械的に再分割しない。 */
    readonly summary: string;
    /** 監査・デバッグ用。この id/version で文面を再解決してはならない。 */
    readonly messageDefinition: NotificationMessageDefinitionRef | null;
  };
}

export interface NotificationDeltaRequest {
  readonly terminalId: string;
  readonly cursor: NotificationDeltaCursor;
}

export interface NotificationDeltaReadyResponse {
  readonly status: 'ready';
  readonly terminalId: string;
  readonly venueId: VenueId;
  readonly serverGenerationId: string;
  readonly generatedAt: UtcIso8601String;
  /** 次回要求に渡す値。要求 cursor 以上で、走査した B4 の最大 sequence。 */
  readonly cursor: NotificationDeltaCursor;
  /** sequence 昇順。会場スコープ外の行は含まない。 */
  readonly notifications: readonly NotificationDeltaItem[];
  /** DTO を組み立てられず配信から除外した行数。cursor は進んでいる。 */
  readonly skippedCount: number;
}

export type NotificationDeltaErrorResponse =
  | {
      readonly status: 'error';
      readonly code: 'invalid_request' | 'terminal_not_found' | 'notification_delta_failed';
    }
  | {
      readonly status: 'error';
      readonly code: 'cursor_out_of_range';
      readonly cursor: NotificationDeltaCursor;
    };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * HTTP クエリの構造だけを検証する。端末台帳の照合は API 側で行う。
 */
export function parseNotificationDeltaQuery(query: unknown): NotificationDeltaRequest | null {
  if (!isPlainObject(query)) {
    return null;
  }
  const keys = Object.keys(query);
  if (keys.length !== 2 || !keys.includes('terminalId') || !keys.includes('cursor')) {
    return null;
  }
  const terminalId = query.terminalId;
  const cursor = query.cursor;

  if (typeof terminalId !== 'string' || terminalId.length === 0) {
    return null;
  }
  if (typeof cursor !== 'string' || !isNotificationDeltaCursor(cursor)) {
    return null;
  }

  return {
    terminalId,
    cursor,
  };
}
