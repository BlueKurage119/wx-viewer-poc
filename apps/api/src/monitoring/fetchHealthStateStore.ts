import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import type { MonitoredFetchSourceId } from './fetchHealthSources.js';
import { MONITORED_FETCH_SOURCES } from './fetchHealthSources.js';
import type { FetchHealthStatus, FetchHealthAggregate } from './fetchHealthEvaluator.js';

/**
 * プロセス起動単位の前回値保持（非永続・メモリのみ）。process レベルのシングルトンにしない。
 * 【重要】状態は取得元ごとに独立して保持する。集約値の前回値は保持しない（集約は表示専用。§4.4）。
 */
export class FetchHealthStateStore {
  private readonly previousStatus = new Map<MonitoredFetchSourceId, FetchHealthStatus | null>();
  private readonly activeSinceAt = new Map<MonitoredFetchSourceId, UtcIso8601String | null>();

  constructor() {
    this.reset();
  }

  getPreviousStatus(sourceId: MonitoredFetchSourceId): FetchHealthStatus | null {
    return this.previousStatus.get(sourceId) ?? null;
  }

  getPreviousStatusBySource(): Readonly<Record<MonitoredFetchSourceId, FetchHealthStatus | null>> {
    const result = {} as Record<MonitoredFetchSourceId, FetchHealthStatus | null>;
    for (const def of MONITORED_FETCH_SOURCES) {
      result[def.id] = this.previousStatus.get(def.id) ?? null;
    }
    return result;
  }

  getActiveSinceAt(sourceId: MonitoredFetchSourceId): UtcIso8601String | null {
    return this.activeSinceAt.get(sourceId) ?? null;
  }

  commit(aggregate: FetchHealthAggregate): void {
    for (const sourceResult of aggregate.sources) {
      const sourceId = sourceResult.sourceId;
      const prevStatus = this.previousStatus.get(sourceId) ?? null;
      const prevActive = this.activeSinceAt.get(sourceId) ?? null;

      let newActiveSinceAt: UtcIso8601String;
      if (prevActive === null) {
        // 初回評価
        newActiveSinceAt = aggregate.evaluatedAt;
      } else if (prevStatus === 'suspended' && sourceResult.status !== 'suspended') {
        // 停止中から稼働へ復帰
        newActiveSinceAt = aggregate.evaluatedAt;
      } else {
        // 前回値保持
        newActiveSinceAt = prevActive;
      }

      this.activeSinceAt.set(sourceId, newActiveSinceAt);
      this.previousStatus.set(sourceId, sourceResult.status);
    }
  }

  reset(): void {
    this.previousStatus.clear();
    this.activeSinceAt.clear();
    for (const def of MONITORED_FETCH_SOURCES) {
      this.previousStatus.set(def.id, null);
      this.activeSinceAt.set(def.id, null);
    }
  }
}
