import type { DatabaseConnection } from '../database/index.js';
import {
  getFeedDefinitionsForTrigger,
  type FeedPollResult,
  type JmaXmlFeedKind,
  type JmaXmlPollTrigger,
  type PollCycleResult,
} from './jmaXmlFeeds.js';
import { pollSingleFeed, type PollerContextOptions } from './jmaXmlPoller.js';
import { FeedBackoffManager, type FeedBackoffStatus } from './retryBackoff.js';

export interface JmaXmlPollingStatus {
  readonly isRunning: boolean;
  readonly lastCycleResult: PollCycleResult | null;
  readonly feedStatuses: Readonly<Record<JmaXmlFeedKind, FeedBackoffStatus>>;
}

export interface JmaXmlPollingServiceOptions extends PollerContextOptions {
  readonly intervalMs?: number;
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

  constructor(connection: DatabaseConnection, options?: JmaXmlPollingServiceOptions) {
    this.connection = connection;
    this.options = options ?? {};
    this.intervalMs = this.options.intervalMs ?? 60_000;
  }

  getStatus(): JmaXmlPollingStatus {
    const nowFn = this.options.clock ?? (() => new Date().toISOString());
    return {
      isRunning: this.isRunning,
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
      if (singleResult.isFeedFetchSuccess) {
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

  start(): void {
    if (this.isRunning) {
      // 二重 start() はタイマーを増やさない
      return;
    }

    this.isRunning = true;

    // 即時 1 回実行（待たずに開始）
    void this.pollOnce('scheduled').catch((err) => {
      console.error('[JmaXmlPollingService] 即時ポーリングでエラーが発生しました:', err);
    });

    this.scheduleNextPoll();
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
          this.scheduleNextPoll();
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
