import type { NotificationRecordSink } from '../runtime/retainedNotificationSink.js';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import type { TimeBasedPollingStatus } from '../polling/timeBasedPollingScheduler.js';
import type { FetchHealthConfig } from './fetchHealthConfig.js';
import { MONITORED_FETCH_SOURCES } from './fetchHealthSources.js';
import {
  evaluateFetchSourceHealth,
  aggregateFetchHealth,
  type FetchHealthAggregate,
  type FetchSourceHealthResult,
} from './fetchHealthEvaluator.js';
import { FetchHealthStateStore } from './fetchHealthStateStore.js';
import {
  emitFetchHealthNotification,
  type FetchHealthNotificationEmitResult,
} from '../notifications/fetchHealthNotificationEmitter.js';
import { summarizeFetchStreamHealth } from '../repositories/fetchAttemptRepository.js';

export interface FetchHealthStatusProvider {
  getStatus(): TimeBasedPollingStatus;
}

export interface FetchHealthMonitorServiceOptions {
  readonly connection: DatabaseConnection;
  readonly retainedConnection?: DatabaseConnection;
  readonly recordSink?: NotificationRecordSink;
  readonly runDecisionAsync?: (work: () => void) => Promise<void>;
  readonly runDecision?: <T>(work: () => T) => T;
  readonly statusProvider: FetchHealthStatusProvider;
  readonly config: FetchHealthConfig;
  readonly store?: FetchHealthStateStore;
  readonly now?: () => UtcIso8601String;
  readonly notificationIdFactory?: () => string;
  readonly setTimer?: (cb: () => void, ms: number) => unknown;
  readonly clearTimer?: (id: unknown) => void;
}

export class FetchHealthMonitorService {
  private readonly store: FetchHealthStateStore;
  private readonly setTimer: (cb: () => void, ms: number) => unknown;
  private readonly clearTimer: (id: unknown) => void;
  private timerId: unknown = null;
  private isRunning = false;
  private lastAggregate: FetchHealthAggregate | null = null;

  constructor(private readonly options: FetchHealthMonitorServiceOptions) {
    this.store = options.store ?? new FetchHealthStateStore();
    this.setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimer = options.clearTimer ?? ((id) => clearTimeout(id as NodeJS.Timeout));
  }

  /** 1 回だけ評価して通知判定まで行う。テストの主入口。 */
  private evaluateOnce(): {
    readonly aggregate: FetchHealthAggregate;
    readonly emit: FetchHealthNotificationEmitResult;
  } {
    const now: UtcIso8601String = this.options.now
      ? this.options.now()
      : (new Date().toISOString() as UtcIso8601String);

    const pollingStatus = this.options.statusProvider.getStatus();

    const sourceResults: FetchSourceHealthResult[] = [];

    for (const sourceDef of MONITORED_FETCH_SOURCES) {
      const scheduledSource = sourceDef.scheduledSource;
      const scheduledStatus = pollingStatus.sources[scheduledSource];

      const suspended = scheduledStatus.state === 'scheduled_stopped';
      const intervalSeconds = scheduledStatus.intervalSeconds;
      const activeSinceAt = this.store.resolveActiveSinceAt(sourceDef.id, now, suspended);

      const streams = sourceDef.sourceKinds.map((sourceKind) =>
        summarizeFetchStreamHealth(
          this.options.connection,
          sourceKind,
          this.options.config.maxScanAttempts,
        ),
      );

      const sourceResult = evaluateFetchSourceHealth(
        {
          sourceId: sourceDef.id,
          now,
          suspended,
          intervalSeconds,
          appliesElapsedCondition: sourceDef.appliesElapsedCondition,
          activeSinceAt,
          streams,
        },
        this.options.config,
      );

      sourceResults.push(sourceResult);
    }

    const aggregate = aggregateFetchHealth(sourceResults, now);
    this.lastAggregate = aggregate;

    const emit = emitFetchHealthNotification(
      this.options.retainedConnection,
      aggregate,
      this.store,
      {
        recordSink: this.options.recordSink,
        now: () => now,
        notificationIdFactory: this.options.notificationIdFactory,
      },
    );

    return { aggregate, emit };
  }

  runOnce(): ReturnType<FetchHealthMonitorService['evaluateOnce']> {
    return this.options.runDecision
      ? this.options.runDecision(() => this.evaluateOnce())
      : this.evaluateOnce();
  }

  private runOnceSafe(): void {
    try {
      if (this.options.runDecisionAsync) {
        void this.options
          .runDecisionAsync(() => {
            this.evaluateOnce();
          })
          .catch((error) => console.error('取得健全性判定に失敗しました:', error));
        return;
      }
      this.runOnce();
    } catch (error) {
      console.error('FetchHealthMonitorService runOnce failed:', error);
    }
  }

  start(): void {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    this.runOnceSafe();
    this.scheduleNext();
  }

  private scheduleNext(): void {
    if (!this.isRunning) {
      return;
    }
    const ms = this.options.config.evaluationIntervalSeconds * 1000;
    this.timerId = this.setTimer(() => {
      if (this.isRunning) {
        this.runOnceSafe();
        this.scheduleNext();
      }
    }, ms);
  }

  stop(): void {
    this.isRunning = false;
    if (this.timerId !== null) {
      this.clearTimer(this.timerId);
      this.timerId = null;
    }
  }

  /** E 系監視画面向け。最後の評価結果（未評価なら null）。 */
  getLastAggregate(): FetchHealthAggregate | null {
    return this.lastAggregate;
  }
}
