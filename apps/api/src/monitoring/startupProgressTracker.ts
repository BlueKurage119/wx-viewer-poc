import {
  VENUE_IDS,
  type MonitoringVenueReprocessingStatus,
  type UtcIso8601String,
  type VenueId,
} from '@wx-viewer-poc/shared';

export interface StartupProgressTracker {
  startVenueReprocessing(venueId: VenueId, total: number, startedAt?: UtcIso8601String): void;
  updateVenueReprocessing(venueId: VenueId, processedCount: number): void;
  completeVenueReprocessing(
    venueId: VenueId,
    processedCount: number,
    elapsedMs: number,
    finishedAt?: UtcIso8601String,
  ): void;
  getVenueReprocessingStatus(venueId: VenueId): MonitoringVenueReprocessingStatus;
}

export class InMemoryStartupProgressTracker implements StartupProgressTracker {
  private readonly statusMap = new Map<VenueId, MonitoringVenueReprocessingStatus>();

  constructor(
    private readonly nowFn: () => UtcIso8601String = () =>
      new Date().toISOString() as UtcIso8601String,
  ) {
    for (const venueId of VENUE_IDS) {
      this.statusMap.set(venueId, {
        status: 'idle',
        total: 0,
        processedCount: 0,
        startedAt: null,
        finishedAt: null,
        elapsedMs: null,
      });
    }
  }

  startVenueReprocessing(venueId: VenueId, total: number, startedAt?: UtcIso8601String): void {
    const current = this.getVenueReprocessingStatus(venueId);
    this.statusMap.set(venueId, {
      ...current,
      status: total === 0 ? 'completed' : 'running',
      total,
      processedCount: 0,
      startedAt: startedAt ?? this.nowFn(),
      finishedAt: total === 0 ? (startedAt ?? this.nowFn()) : null,
      elapsedMs: total === 0 ? 0 : null,
    });
  }

  updateVenueReprocessing(venueId: VenueId, processedCount: number): void {
    const current = this.getVenueReprocessingStatus(venueId);
    this.statusMap.set(venueId, {
      ...current,
      processedCount,
    });
  }

  completeVenueReprocessing(
    venueId: VenueId,
    processedCount: number,
    elapsedMs: number,
    finishedAt?: UtcIso8601String,
  ): void {
    const current = this.getVenueReprocessingStatus(venueId);
    this.statusMap.set(venueId, {
      ...current,
      status: 'completed',
      processedCount,
      finishedAt: finishedAt ?? this.nowFn(),
      elapsedMs,
    });
  }

  getVenueReprocessingStatus(venueId: VenueId): MonitoringVenueReprocessingStatus {
    return (
      this.statusMap.get(venueId) ?? {
        status: 'idle',
        total: 0,
        processedCount: 0,
        startedAt: null,
        finishedAt: null,
        elapsedMs: null,
      }
    );
  }
}
