import type {
  NotificationCategory,
  NotificationRelatedRef,
  NotificationTarget,
  ResolvedNotificationOutputSnapshot,
} from './notification.js';
import type { TerminalSessionId, TerminalSessionInquiryKind } from './terminalSession.js';
import { isTerminalSessionId } from './terminalSession.js';
import type { UtcIso8601String } from './types.js';
import type { VenueId } from './venueForecastTargets.js';

export type StartupCurrentSource = 'warning_current' | 'bosai_bulletin';

export interface StartupNotificationRequest {
  readonly terminalId: string;
  readonly sessionId: TerminalSessionId;
}

export interface StartupCurrentNotification {
  readonly outputId: string;
  readonly category: NotificationCategory;
  readonly origin: 'weather';
  readonly sourceType: StartupCurrentSource;
  readonly sourceVersion: string | null;
  readonly targets: readonly [NotificationTarget, ...NotificationTarget[]];
  readonly occurredAt: UtcIso8601String;
  readonly relatedRefs: readonly NotificationRelatedRef[];
  readonly isTraining: boolean;
  readonly output: ResolvedNotificationOutputSnapshot;
}

export interface StartupNotificationReadyResponse {
  readonly status: 'ready';
  readonly terminalId: string;
  readonly venueId: VenueId;
  readonly serverGenerationId: string;
  readonly generatedAt: UtcIso8601String;
  readonly session: {
    readonly kind: TerminalSessionInquiryKind;
    readonly firstInquiredAt: UtcIso8601String;
  };
  readonly warningClaimed: boolean;
  readonly notifications: readonly StartupCurrentNotification[];
}

export type StartupNotificationErrorResponse = {
  readonly status: 'error';
  readonly code: 'invalid_request' | 'terminal_not_found' | 'startup_notification_failed';
};

export interface StartupNotificationInitializingResponse {
  readonly status: 'initializing';
  readonly venueId: VenueId;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** HTTP body の構造だけを検証する。端末台帳の照合は API 側で行う。 */
export function parseStartupNotificationRequest(value: unknown): StartupNotificationRequest | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('terminalId') || !keys.includes('sessionId')) {
    return null;
  }
  if (typeof value.terminalId !== 'string' || value.terminalId.length === 0) {
    return null;
  }
  if (!isTerminalSessionId(value.sessionId)) {
    return null;
  }
  return { terminalId: value.terminalId, sessionId: value.sessionId };
}
