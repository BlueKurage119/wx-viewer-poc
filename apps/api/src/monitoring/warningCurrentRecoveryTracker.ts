import {
  VENUE_IDS,
  type MonitoringWarningRecoveryStatus,
  type UtcIso8601String,
  type VenueId,
} from '@wx-viewer-poc/shared';
import type {
  WarningCurrentRecoveryProgress,
  WarningCurrentRecoveryResult,
} from '../polling/jmaWarningCurrentProcessor.js';

export interface WarningCurrentRecoveryTracker {
  start(venueId: VenueId, startedAt: UtcIso8601String): void;
  progress(venueId: VenueId, progress: WarningCurrentRecoveryProgress): void;
  markDelayed(venueId: VenueId, delayedAt: UtcIso8601String): boolean;
  complete(
    venueId: VenueId,
    result: WarningCurrentRecoveryResult,
    finishedAt: UtcIso8601String,
  ): void;
  fail(venueId: VenueId, finishedAt: UtcIso8601String): void;
  getStatus(venueId: VenueId, now: UtcIso8601String): MonitoringWarningRecoveryStatus;
}

const idle = (): MonitoringWarningRecoveryStatus => ({
  status: 'idle',
  startedAt: null,
  finishedAt: null,
  delayedAt: null,
  elapsedMs: null,
  currentControlStatus: null,
  completedControlStatuses: [],
  reusedControlStatuses: [],
  rebuiltControlStatuses: [],
  parsedReceptionCount: 0,
  errorCode: null,
});

export class InMemoryWarningCurrentRecoveryTracker implements WarningCurrentRecoveryTracker {
  private readonly states = new Map<VenueId, MonitoringWarningRecoveryStatus>();
  constructor() {
    for (const venueId of VENUE_IDS) this.states.set(venueId, idle());
  }
  start(venueId: VenueId, startedAt: UtcIso8601String): void {
    this.states.set(venueId, { ...idle(), status: 'running', startedAt });
  }
  progress(venueId: VenueId, progress: WarningCurrentRecoveryProgress): void {
    const current = this.states.get(venueId) ?? idle();
    this.states.set(venueId, {
      ...current,
      currentControlStatus: progress.controlStatus,
      parsedReceptionCount: progress.parsedReceptionCount,
    });
  }
  markDelayed(venueId: VenueId, delayedAt: UtcIso8601String): boolean {
    const current = this.states.get(venueId) ?? idle();
    if (current.status !== 'running' || current.delayedAt !== null) return false;
    this.states.set(venueId, { ...current, delayedAt });
    return true;
  }
  complete(
    venueId: VenueId,
    result: WarningCurrentRecoveryResult,
    finishedAt: UtcIso8601String,
  ): void {
    const current = this.states.get(venueId) ?? idle();
    this.states.set(venueId, {
      ...current,
      status: 'completed',
      finishedAt,
      currentControlStatus: null,
      elapsedMs: result.elapsedMs,
      parsedReceptionCount: result.parsedReceptionCount,
      completedControlStatuses: result.statuses.map((s) => s.controlStatus),
      reusedControlStatuses: result.statuses
        .filter((s) => s.outcome === 'reused')
        .map((s) => s.controlStatus),
      rebuiltControlStatuses: result.statuses
        .filter((s) => s.outcome === 'rebuilt')
        .map((s) => s.controlStatus),
      errorCode: null,
    });
  }
  fail(venueId: VenueId, finishedAt: UtcIso8601String): void {
    const current = this.states.get(venueId) ?? idle();
    const started =
      current.startedAt === null ? null : Date.parse(finishedAt) - Date.parse(current.startedAt);
    this.states.set(venueId, {
      ...current,
      status: 'failed',
      finishedAt,
      elapsedMs: started,
      currentControlStatus: null,
      errorCode: 'warning_current_recovery_failed',
    });
  }
  getStatus(venueId: VenueId, now: UtcIso8601String): MonitoringWarningRecoveryStatus {
    const current = this.states.get(venueId) ?? idle();
    if (current.status !== 'running' || current.startedAt === null) return current;
    return { ...current, elapsedMs: Math.max(0, Date.parse(now) - Date.parse(current.startedAt)) };
  }
}
