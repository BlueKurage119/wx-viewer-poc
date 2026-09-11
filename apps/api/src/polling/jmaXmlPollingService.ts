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

export interface JmaXmlPollingServiceOptions extends PollerContextOptions {
  readonly intervalMs?: number;
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

export class JmaXmlPollingService {
  private readonly connection: DatabaseConnection;
  private readonly options: JmaXmlPollingServiceOptions;
  private readonly intervalMs: number;
  private readonly backoffManager = new FeedBackoffManager();

  private isRunning = false;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private inFlightPollPromise: Promise<PollCycleResult> | null = null;
  private lastCycleResult: PollCycleResult | null = null;

  private initialFetchPhase: InitialFetchPhase = 'not_started';
  private initialFetchResult: InitialFetchResult | null = null;
  private inFlightStartPromise: Promise<InitialFetchResult> | null = null;

  constructor(connection: DatabaseConnection, options?: JmaXmlPollingServiceOptions) {
    this.connection = connection;
    this.options = options ?? {};
    this.intervalMs = this.options.intervalMs ?? 60_000;
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
    // 同一サービス内でサイクルが実行中なら同じ in-flight Promise を返す（集約）
    if (this.inFlightPollPromise) {
      return this.inFlightPollPromise;
    }

    const pollPromise = this.executePollCycle(trigger)
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

  private async executePollCycle(trigger: JmaXmlPollTrigger): Promise<PollCycleResult> {
    const nowFn = this.options.clock ?? (() => new Date().toISOString());
    const cycleStartedAt = nowFn();

    const feedDefs = getFeedDefinitionsForTrigger(trigger);
    const feedResults: FeedPollResult[] = [];
    const processedUrlsInCycle = new Set<string>();

    for (const feedDef of feedDefs) {
      const currentNow = nowFn();

      // 通常サイクル (scheduled) の場合、バックオフ待機中のフィードはスキップ
      if (trigger === 'scheduled' && this.backoffManager.isWaiting(feedDef.kind, currentNow)) {
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

    // 既に初期取得が実行済み（stop() 後の再 start()）の場合
    if (this.initialFetchPhase === 'completed' || this.initialFetchPhase === 'failed') {
      this.scheduleNextPoll();
      return Promise.resolve(this.initialFetchResult!);
    }

    // 初回 start()
    const nowFn = this.options.clock ?? (() => new Date().toISOString());
    const startedAt = nowFn();
    this.initialFetchPhase = 'running';
    this.initialFetchResult = null;

    const startPromise = (async () => {
      try {
        const cycleResult = await this.pollOnce('initial');
        const finishedAt = nowFn();
        const initialResult = evaluateInitialFetchResult(cycleResult, startedAt, finishedAt);
        this.initialFetchPhase = initialResult.completed ? 'completed' : 'failed';
        this.initialFetchResult = initialResult;

        if (this.isRunning) {
          this.scheduleNextPoll();
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

  private scheduleNextPoll(): void {
    if (!this.isRunning) {
      return;
    }

    this.timerId = setTimeout(() => {
      if (!this.isRunning) {
        return;
      }
      void this.pollOnce('scheduled')
        .catch((err) => {
          console.error('[JmaXmlPollingService] 定期ポーリングでエラーが発生しました:', err);
        })
        .finally(() => {
          if (this.isRunning) {
            this.scheduleNextPoll();
          }
        });
    }, this.intervalMs);
  }

  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    // 実行中サイクルがあれば完了を待つ
    if (this.inFlightPollPromise) {
      try {
        await this.inFlightPollPromise;
      } catch {
        // エラーは無視して終了
      }
    }
  }
}
