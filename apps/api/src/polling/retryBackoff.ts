import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import type { JmaXmlFeedKind } from './jmaXmlFeeds.js';

export interface FeedBackoffStatus {
  readonly feedKind: JmaXmlFeedKind;
  readonly consecutiveFailures: number;
  readonly isWaiting: boolean;
  readonly waitingReason: string | null;
  readonly nextAllowedFetchAt: UtcIso8601String | null;
  readonly lastAttemptAt: UtcIso8601String | null;
  readonly lastSuccessAt: UtcIso8601String | null;
  readonly lastFailureAt: UtcIso8601String | null;
}

interface FeedBackoffInternalState {
  consecutiveFailures: number;
  waitingReason: string | null;
  nextAllowedFetchAt: UtcIso8601String | null;
  lastAttemptAt: UtcIso8601String | null;
  lastSuccessAt: UtcIso8601String | null;
  lastFailureAt: UtcIso8601String | null;
}

export function calculateBackoffDelaySeconds(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) {
    return 0;
  }
  const delay = 60 * Math.pow(2, consecutiveFailures - 1);
  return Math.min(delay, 300);
}

export class FeedBackoffManager {
  private readonly states = new Map<JmaXmlFeedKind, FeedBackoffInternalState>();

  private getOrCreateState(feedKind: JmaXmlFeedKind): FeedBackoffInternalState {
    let state = this.states.get(feedKind);
    if (!state) {
      state = {
        consecutiveFailures: 0,
        waitingReason: null,
        nextAllowedFetchAt: null,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
      };
      this.states.set(feedKind, state);
    }
    return state;
  }

  recordAttempt(feedKind: JmaXmlFeedKind, at: UtcIso8601String): void {
    const state = this.getOrCreateState(feedKind);
    state.lastAttemptAt = at;
  }

  recordSuccess(feedKind: JmaXmlFeedKind, at: UtcIso8601String): void {
    const state = this.getOrCreateState(feedKind);
    state.consecutiveFailures = 0;
    state.waitingReason = null;
    state.nextAllowedFetchAt = null;
    state.lastSuccessAt = at;
  }

  recordFailure(feedKind: JmaXmlFeedKind, at: UtcIso8601String, errorReason: string): void {
    const state = this.getOrCreateState(feedKind);
    state.consecutiveFailures += 1;
    state.lastFailureAt = at;
    const delaySeconds = calculateBackoffDelaySeconds(state.consecutiveFailures);
    const nextAllowedDate = new Date(new Date(at).getTime() + delaySeconds * 1000);
    state.nextAllowedFetchAt = nextAllowedDate.toISOString();
    state.waitingReason = `連続${state.consecutiveFailures}回失敗のため${delaySeconds}秒待機中: ${errorReason}`;
  }

  isWaiting(feedKind: JmaXmlFeedKind, now: UtcIso8601String): boolean {
    const state = this.getOrCreateState(feedKind);
    if (!state.nextAllowedFetchAt) {
      return false;
    }
    return new Date(now).getTime() < new Date(state.nextAllowedFetchAt).getTime();
  }

  getStatus(feedKind: JmaXmlFeedKind, now: UtcIso8601String): FeedBackoffStatus {
    const state = this.getOrCreateState(feedKind);
    const isWaiting =
      state.nextAllowedFetchAt !== null &&
      new Date(now).getTime() < new Date(state.nextAllowedFetchAt).getTime();

    return {
      feedKind,
      consecutiveFailures: state.consecutiveFailures,
      isWaiting,
      waitingReason: isWaiting ? state.waitingReason : null,
      nextAllowedFetchAt: state.nextAllowedFetchAt,
      lastAttemptAt: state.lastAttemptAt,
      lastSuccessAt: state.lastSuccessAt,
      lastFailureAt: state.lastFailureAt,
    };
  }

  getAllStatuses(now: UtcIso8601String): Record<JmaXmlFeedKind, FeedBackoffStatus> {
    const kinds: readonly JmaXmlFeedKind[] = ['regular', 'extra', 'regular_l', 'extra_l'];
    const result = {} as Record<JmaXmlFeedKind, FeedBackoffStatus>;
    for (const kind of kinds) {
      result[kind] = this.getStatus(kind, now);
    }
    return result;
  }
}
