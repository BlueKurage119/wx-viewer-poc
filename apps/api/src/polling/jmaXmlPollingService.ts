import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import { sanitizeErrorMessage } from './httpGet.js';
import {
  getFeedDefinitionsForTrigger,
  type FeedPollResult,
  type JmaXmlFeedKind,
  type JmaXmlPollTrigger,
  type PollCycleResult,
} from './jmaXmlFeeds.js';
import { pollSingleFeed, type PollerContextOptions } from './jmaXmlPoller.js';
import { FeedBackoffManager, type FeedBackoffStatus } from './retryBackoff.js';

export type InitialFetchPhase = 'not_started' | 'running' | 'completed' | 'failed';

export interface InitialFetchResult {
  readonly completed: boolean;
  readonly startedAt: UtcIso8601String;
  readonly finishedAt: UtcIso8601String;
  readonly failedFeedKinds: readonly JmaXmlFeedKind[];
  readonly cycleResult: PollCycleResult | null;
  readonly errorReason: string | null;
}

export interface InitialFetchStatus {
  readonly phase: InitialFetchPhase;
  readonly result: InitialFetchResult | null;
}

export interface JmaXmlPollingStatus {
  readonly isRunning: boolean;
  readonly initialFetch: InitialFetchStatus;
  readonly lastCycleResult: PollCycleResult | null;
  readonly feedStatuses: Readonly<Record<JmaXmlFeedKind, FeedBackoffStatus>>;
}

export interface PollingTimerScheduler {
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
}

export interface JmaXmlPollingServiceOptions extends PollerContextOptions {
  readonly intervalMs?: number;
  readonly timerScheduler?: PollingTimerScheduler;
}

export const INITIAL_FEED_KINDS: readonly JmaXmlFeedKind[] = [
  'regular',
  'extra',
  'regular_l',
  'extra_l',
] as const;

export function evaluateInitialFetchResult(
  cycleResult: PollCycleResult,
  startedAt: UtcIso8601String,
  finishedAt: UtcIso8601String,
): InitialFetchResult {
  if (cycleResult.trigger !== 'initial') {
    return {
      completed: false,
      startedAt,
      finishedAt,
      failedFeedKinds: [...INITIAL_FEED_KINDS],
      cycleResult,
      errorReason: null,
    };
  }

  const kindCounts = new Map<JmaXmlFeedKind, number>();
  for (const r of cycleResult.feedResults) {
    kindCounts.set(r.feedKind, (kindCounts.get(r.feedKind) ?? 0) + 1);
  }

  const failedFeedKinds: JmaXmlFeedKind[] = [];

  for (const expectedKind of INITIAL_FEED_KINDS) {
    const count = kindCounts.get(expectedKind) ?? 0;
    if (count !== 1) {
      failedFeedKinds.push(expectedKind);
      continue;
    }
    const matchingFeed = cycleResult.feedResults.find((r) => r.feedKind === expectedKind);
    if (!matchingFeed || matchingFeed.feedFetchOutcome !== 'success') {
      failedFeedKinds.push(expectedKind);
    }
  }

  const hasUnexpectedFeeds = cycleResult.feedResults.some(
    (r) => !INITIAL_FEED_KINDS.includes(r.feedKind),
  );

  const completed = failedFeedKinds.length === 0 && !hasUnexpectedFeeds;

  return {
    completed,
    startedAt,
    finishedAt,
    failedFeedKinds,
    cycleResult,
    errorReason: null,
  };
}

const defaultTimerScheduler: PollingTimerScheduler = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (id) => clearTimeout(id),
};

export class JmaXmlPollingService {
  private readonly connection: DatabaseConnection;
  private readonly options: JmaXmlPollingServiceOptions;
  private readonly intervalMs: number;
  private readonly timerScheduler: PollingTimerScheduler;
  private readonly backoffManager = new FeedBackoffManager();

  private isRunning = false;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private inFlightPollPromise: Promise<PollCycleResult> | null = null;
  private lastCycleResult: PollCycleResult | null = null;

  private initialFetchPhase: InitialFetchPhase = 'not_started';
  private initialFetchResult: InitialFetchResult | null = null;
  private inFlightStartPromise: Promise<InitialFetchResult> | null = null;
  private readonly successfulInitialFeedKinds = new Set<JmaXmlFeedKind>();
  private nextScheduledPollAtMs: number | null = null;
  private scheduledPollDueOnNextRun = false;

  constructor(connection: DatabaseConnection, options?: JmaXmlPollingServiceOptions) {
    this.connection = connection;
    this.options = options ?? {};
    this.intervalMs = this.options.intervalMs ?? 60_000;
    this.timerScheduler = this.options.timerScheduler ?? defaultTimerScheduler;
  }

  getStatus(): JmaXmlPollingStatus {
    const nowFn = this.options.clock ?? (() => new Date().toISOString());
    return {
      isRunning: this.isRunning,
      initialFetch: {
        phase: this.initialFetchPhase,
        result: this.initialFetchResult,
      },
      lastCycleResult: this.lastCycleResult,
      feedStatuses: this.backoffManager.getAllStatuses(nowFn()),
    };
  }

  pollOnce(trigger: JmaXmlPollTrigger): Promise<PollCycleResult> {
    return this.pollFeeds(trigger);
  }

  pollFeeds(
    trigger: JmaXmlPollTrigger,
    targetFeedKinds?: readonly JmaXmlFeedKind[],
  ): Promise<PollCycleResult> {
    // 同一サービス内でサイクルが実行中なら同じ in-flight Promise を返す（集約）
    if (this.inFlightPollPromise) {
      return this.inFlightPollPromise;
    }

    const pollPromise = this.executePollCycle(trigger, targetFeedKinds)
      .then((result) => {
        this.lastCycleResult = result;
        return result;
      })
      .finally(() => {
        this.inFlightPollPromise = null;
      });

    this.inFlightPollPromise = pollPromise;
    return pollPromise;
  }

  private async executePollCycle(
    trigger: JmaXmlPollTrigger,
    targetFeedKinds?: readonly JmaXmlFeedKind[],
  ): Promise<PollCycleResult> {
    const nowFn = this.options.clock ?? (() => new Date().toISOString());
    const cycleStartedAt = nowFn();

    const allFeedDefs = getFeedDefinitionsForTrigger(trigger);
    const feedDefs = targetFeedKinds
      ? allFeedDefs.filter((f) => targetFeedKinds.includes(f.kind))
      : allFeedDefs;

    const feedResults: FeedPollResult[] = [];
    const processedUrlsInCycle = new Set<string>();

    for (const feedDef of feedDefs) {
      const currentNow = nowFn();

      // scheduled または recovery の場合、バックオフ待機中のフィードはスキップ
      if (
        (trigger === 'scheduled' || trigger === 'recovery') &&
        this.backoffManager.isWaiting(feedDef.kind, currentNow)
      ) {
        // 待機中フィードは開始せず
        continue;
      }

      this.backoffManager.recordAttempt(feedDef.kind, currentNow);
      const consecutiveFailures = this.backoffManager.getStatus(
        feedDef.kind,
        currentNow,
      ).consecutiveFailures;
      const attemptNo = consecutiveFailures + 1;

      const singleResult = await pollSingleFeed(
        this.connection,
        feedDef,
        trigger,
        attemptNo,
        processedUrlsInCycle,
        this.options,
      );

      feedResults.push(singleResult.feedResult);

      const finishedNow = nowFn();
      if (singleResult.feedResult.feedFetchOutcome === 'success') {
        this.backoffManager.recordSuccess(feedDef.kind, finishedNow);
      } else {
        this.backoffManager.recordFailure(
          feedDef.kind,
          finishedNow,
          singleResult.errorReason ?? '不明なエラー',
        );
      }
    }

    const cycleFinishedAt = nowFn();

    return {
      trigger,
      startedAt: cycleStartedAt,
      finishedAt: cycleFinishedAt,
      feedResults,
    };
  }

  start(): Promise<InitialFetchResult> {
    if (this.isRunning) {
      if (this.inFlightStartPromise) {
        return this.inFlightStartPromise;
      }
      if (this.initialFetchResult) {
        return Promise.resolve(this.initialFetchResult);
      }
    }

    this.isRunning = true;

    // stop() 後の再 start()
    if (this.initialFetchPhase === 'completed') {
      this.nextScheduledPollAtMs = null;
      this.scheduleNextCycle();
      return Promise.resolve(this.initialFetchResult!);
    }
    if (this.initialFetchPhase === 'failed') {
      this.scheduleNextCycle();
      return Promise.resolve(this.initialFetchResult!);
    }

    // 初回 start()
    const nowFn = this.options.clock ?? (() => new Date().toISOString());
    const startedAt = nowFn();
    this.initialFetchPhase = 'running';
    this.initialFetchResult = null;

    const startPromise = (async () => {
      try {
        const cycleResult = await this.pollFeeds('initial', INITIAL_FEED_KINDS);
        const finishedAt = nowFn();

        for (const r of cycleResult.feedResults) {
          if (r.feedFetchOutcome === 'success') {
            this.successfulInitialFeedKinds.add(r.feedKind);
          }
        }

        const failedFeedKinds = INITIAL_FEED_KINDS.filter(
          (k) => !this.successfulInitialFeedKinds.has(k),
        );
        const completed = failedFeedKinds.length === 0;

        const initialResult: InitialFetchResult = {
          completed,
          startedAt,
          finishedAt,
          failedFeedKinds,
          cycleResult,
          errorReason: null,
        };

        this.initialFetchPhase = completed ? 'completed' : 'failed';
        this.initialFetchResult = initialResult;

        if (this.isRunning) {
          this.scheduleNextCycle();
        }

        return initialResult;
      } catch (error: unknown) {
        const finishedAt = nowFn();
        const errorReason = sanitizeErrorMessage(String(error));
        const failedResult: InitialFetchResult = {
          completed: false,
          startedAt,
          finishedAt,
          failedFeedKinds: [...INITIAL_FEED_KINDS],
          cycleResult: null,
          errorReason,
        };
        this.initialFetchPhase = 'failed';
        this.initialFetchResult = failedResult;
        throw error;
      } finally {
        this.inFlightStartPromise = null;
      }
    })();

    this.inFlightStartPromise = startPromise;
    return startPromise;
  }

  private scheduleNextCycle(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.timerId !== null) {
      this.timerScheduler.clearTimeout(this.timerId);
      this.timerId = null;
    }

    const nowFn = this.options.clock ?? (() => new Date().toISOString());
    const nowIso = nowFn();
    const nowMs = new Date(nowIso).getTime();

    let delayMs = this.intervalMs;
    this.scheduledPollDueOnNextRun = false;

    if (this.initialFetchPhase === 'failed') {
      const pendingFeeds = INITIAL_FEED_KINDS.filter(
        (k) => !this.successfulInitialFeedKinds.has(k),
      );

      let minPendingDelayMs = Infinity;
      for (const feedKind of pendingFeeds) {
        const status = this.backoffManager.getStatus(feedKind, nowIso);
        if (status.nextAllowedFetchAt) {
          const allowedMs = new Date(status.nextAllowedFetchAt).getTime();
          minPendingDelayMs = Math.min(minPendingDelayMs, Math.max(0, allowedMs - nowMs));
        } else {
          minPendingDelayMs = 0;
        }
      }

      delayMs = minPendingDelayMs === Infinity ? 0 : minPendingDelayMs;
    } else if (this.initialFetchPhase === 'completed') {
      const scheduledFeeds: readonly JmaXmlFeedKind[] = ['regular', 'extra'];
      if (this.nextScheduledPollAtMs === null) {
        this.nextScheduledPollAtMs = nowMs + this.intervalMs;
      }
      let minRetryDelayMs = Infinity;

      for (const feedKind of scheduledFeeds) {
        const status = this.backoffManager.getStatus(feedKind, nowIso);
        if (status.isWaiting && status.nextAllowedFetchAt) {
          const allowedMs = new Date(status.nextAllowedFetchAt).getTime();
          minRetryDelayMs = Math.min(minRetryDelayMs, Math.max(0, allowedMs - nowMs));
        }
      }

      const scheduledDelayMs = Math.max(0, this.nextScheduledPollAtMs - nowMs);
      this.scheduledPollDueOnNextRun = scheduledDelayMs <= minRetryDelayMs;
      delayMs = Math.min(scheduledDelayMs, minRetryDelayMs);
    }

    this.timerId = this.timerScheduler.setTimeout(() => {
      this.timerId = null;
      if (!this.isRunning) {
        return;
      }
      void this.runScheduledOrRetryCycle();
    }, delayMs);
  }

  private async runScheduledOrRetryCycle(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    const nowFn = this.options.clock ?? (() => new Date().toISOString());
    const nowIso = nowFn();

    try {
      if (this.initialFetchPhase === 'failed') {
        const pendingFeeds = INITIAL_FEED_KINDS.filter(
          (k) => !this.successfulInitialFeedKinds.has(k),
        );
        const readyFeeds = pendingFeeds.filter((k) => !this.backoffManager.isWaiting(k, nowIso));

        if (readyFeeds.length > 0) {
          const cycleResult = await this.pollFeeds('recovery', readyFeeds);
          for (const feedRes of cycleResult.feedResults) {
            if (feedRes.feedFetchOutcome === 'success') {
              this.successfulInitialFeedKinds.add(feedRes.feedKind);
            }
          }

          const remainingFailed = INITIAL_FEED_KINDS.filter(
            (k) => !this.successfulInitialFeedKinds.has(k),
          );

          if (remainingFailed.length === 0) {
            this.initialFetchPhase = 'completed';
            this.initialFetchResult = {
              completed: true,
              startedAt: this.initialFetchResult?.startedAt ?? cycleResult.startedAt,
              finishedAt: cycleResult.finishedAt,
              failedFeedKinds: [],
              cycleResult,
              errorReason: null,
            };
          } else {
            this.initialFetchResult = {
              completed: false,
              startedAt: this.initialFetchResult?.startedAt ?? cycleResult.startedAt,
              finishedAt: cycleResult.finishedAt,
              failedFeedKinds: remainingFailed,
              cycleResult,
              errorReason: null,
            };
          }
        }
      } else if (this.initialFetchPhase === 'completed') {
        const scheduledFeeds: readonly JmaXmlFeedKind[] = ['regular', 'extra'];
        const nowMs = new Date(nowIso).getTime();
        const isScheduledPollDue =
          this.scheduledPollDueOnNextRun ||
          (this.nextScheduledPollAtMs !== null && nowMs >= this.nextScheduledPollAtMs);
        this.scheduledPollDueOnNextRun = false;
        const retryFeeds = scheduledFeeds.filter((feedKind) => {
          const status = this.backoffManager.getStatus(feedKind, nowIso);
          return status.consecutiveFailures > 0 && !status.isWaiting;
        });
        const targetFeeds = isScheduledPollDue ? scheduledFeeds : retryFeeds;

        if (targetFeeds.length > 0) {
          await this.pollFeeds('scheduled', targetFeeds);
        }
        if (isScheduledPollDue) {
          this.nextScheduledPollAtMs = nowMs + this.intervalMs;
        }
      }
    } catch (err) {
      console.error('[JmaXmlPollingService] ポーリング実行中にエラーが発生しました:', err);
    } finally {
      if (this.isRunning) {
        this.scheduleNextCycle();
      }
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.timerId !== null) {
      this.timerScheduler.clearTimeout(this.timerId);
      this.timerId = null;
    }

    if (this.inFlightPollPromise) {
      try {
        await this.inFlightPollPromise;
      } catch {
        // エラーは無視して終了
      }
    }
  }
}
