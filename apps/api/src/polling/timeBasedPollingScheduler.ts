import {
  VENUE_IDS,
  type AmedasTarget,
  type UtcIso8601String,
  type VenueId,
} from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import {
  getNextEnabledAt,
  getNextPeriodChangeAt,
  resolvePollingPeriod,
  validatePollingScheduleConfig,
  type PollingPeriod,
  type PollingScheduleConfig,
  type ScheduledSource,
} from '../config/pollingSchedule.js';
import type { JmaXmlPollingService } from './jmaXmlPollingService.js';
import { NowcastService } from './nowcastService.js';
import { KikikuruService } from './kikikuruService.js';
import {
  AmedasFetchState,
  runAmedasFetchCycle,
  type AmedasFetchOptions,
} from './amedasFetchService.js';
import { resolveAmedasTarget } from '../venueForecastTargets.js';

export interface ScheduledPollAdapter {
  readonly source: ScheduledSource;
  runScheduled(): Promise<void>;
  /** 強制更新用の単発実行。未実装のアダプタは runScheduled と同じ取得を triggerKind:'manual' で行う。 */
  runManual(): Promise<void>;
}

export interface ManualRunResult {
  /** 例外が起きた取得元（順不同）。空なら全件正常終了。 */
  readonly failedSources: readonly (ScheduledSource | 'xml')[];
}

export interface TimeBasedPollingSchedulerOptions {
  readonly schedule: PollingScheduleConfig;
  readonly adapters: readonly ScheduledPollAdapter[];
  readonly xmlPollingService: JmaXmlPollingService;
  readonly now?: () => Date;
  readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer?: (id: unknown) => void;
}

export interface ScheduledPollStatus {
  readonly source: ScheduledSource;
  readonly period: PollingPeriod;
  readonly state: 'waiting' | 'running' | 'scheduled_stopped';
  readonly intervalSeconds: number | null;
  readonly nextRunAt: UtcIso8601String | null;
}

export interface TimeBasedPollingStatus {
  readonly period: PollingPeriod;
  readonly nextPeriodChangeAt: UtcIso8601String;
  readonly sources: Readonly<Record<ScheduledSource, ScheduledPollStatus>>;
}

const REQUIRED_ADAPTER_SOURCES: readonly ScheduledSource[] = [
  'nowcast',
  'kikikuru',
  'amedas',
] as const;

const ALL_SCHEDULED_SOURCES: readonly ScheduledSource[] = ['xml', 'nowcast', 'kikikuru', 'amedas'];

/**
 * Issue #42/#43 レビュー指摘 #2: ポーリング無効起動時・初期化中は scheduler インスタンスが
 * 存在しない。監視状態APIがその間も「停止中」を安全に表現できるよう、
 * scheduler.getStatus() が !isRunning のときに返す形と同じ形の既定値を、
 * インスタンスなしで構築する。
 */
export function buildStoppedPollingStatus(
  now: Date,
  schedule: PollingScheduleConfig,
): TimeBasedPollingStatus {
  const period = resolvePollingPeriod(now, schedule);
  const nextPeriodChangeAt = getNextPeriodChangeAt(now, schedule).toISOString() as UtcIso8601String;

  const sources = Object.fromEntries(
    ALL_SCHEDULED_SOURCES.map((source) => [
      source,
      {
        source,
        period,
        state: 'scheduled_stopped' as const,
        intervalSeconds: getIntervalSecondsForSource(period, source),
        nextRunAt: null,
      },
    ]),
  ) as Record<ScheduledSource, ScheduledPollStatus>;

  return { period, nextPeriodChangeAt, sources };
}

export function getIntervalSecondsForSource(
  period: PollingPeriod,
  source: ScheduledSource,
): number | null {
  switch (source) {
    case 'xml':
      return period.xmlSeconds;
    case 'nowcast':
    case 'kikikuru':
      return period.imageCatalogSeconds;
    case 'amedas':
      return period.amedasSeconds;
  }
}

export class TimeBasedPollingScheduler {
  private readonly schedule: PollingScheduleConfig;
  private readonly xmlPollingService: JmaXmlPollingService;
  private readonly adapterMap = new Map<ScheduledSource, ScheduledPollAdapter>();
  private readonly nowFn: () => Date;
  private readonly setTimerFn: (callback: () => void, delayMs: number) => unknown;
  private readonly clearTimerFn: (id: unknown) => void;

  private isRunning = false;
  private generation = 0;
  private boundaryTimerId: unknown | null = null;
  private readonly timerIds = new Map<ScheduledSource, unknown>();
  private readonly inFlightPromises = new Map<ScheduledSource, Promise<void>>();
  private readonly nextRunAtMap = new Map<ScheduledSource, UtcIso8601String | null>();
  private readonly sourceStates = new Map<
    ScheduledSource,
    'waiting' | 'running' | 'scheduled_stopped'
  >();
  private readonly lastCompletedAtMap = new Map<ScheduledSource, number>();
  private xmlInitialStarted = false;

  constructor(options: TimeBasedPollingSchedulerOptions) {
    if (!options.schedule) {
      throw new Error('schedule は必須です');
    }
    this.schedule = validatePollingScheduleConfig(options.schedule);

    if (!options.xmlPollingService) {
      throw new Error('xmlPollingService は必須です');
    }
    this.xmlPollingService = options.xmlPollingService;

    if (!Array.isArray(options.adapters)) {
      throw new TypeError('adapters は配列である必要があります');
    }

    const seenSources = new Set<ScheduledSource>();
    for (const adapter of options.adapters) {
      if (adapter.source === 'xml') {
        throw new Error('xml は adapters ではなく xmlPollingService で管理されます');
      }
      if (!REQUIRED_ADAPTER_SOURCES.includes(adapter.source)) {
        throw new Error(`未知の ScheduledSource です: ${adapter.source}`);
      }
      if (seenSources.has(adapter.source)) {
        throw new Error(`adapter ソース "${adapter.source}" が重複しています`);
      }
      seenSources.add(adapter.source);
      this.adapterMap.set(adapter.source, adapter);
    }

    for (const req of REQUIRED_ADAPTER_SOURCES) {
      if (!seenSources.has(req)) {
        throw new Error(`adapter ソース "${req}" が不足しています`);
      }
    }

    this.nowFn = options.now ?? (() => new Date());
    this.setTimerFn =
      options.setTimer ?? ((cb: () => void, ms: number) => setTimeout(cb, ms) as unknown);
    this.clearTimerFn =
      options.clearTimer ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  }

  /**
   * Issue #43 §4.3: 定期タイマー・世代・lastCompletedAt を一切変更せずに全取得元を1回実行する。
   * 夜間帯でも実行する（索引の夜間ゲート迂回は各アダプタの runManual 実装が担う）。
   */
  async runManualOnce(): Promise<ManualRunResult> {
    const failedSources: (ScheduledSource | 'xml')[] = [];

    const xmlTask = (async () => {
      try {
        const result = await this.xmlPollingService.pollOnce('manual');
        // レビュー指摘 #1: pollOnce は上流の取得失敗（HTTP異常・不正JSON等）で例外を
        // 投げず、feedResults に失敗を記録するだけの場合がある。ここを検査しないと
        // failedSources が常に空になり、強制更新APIが誤って success を返してしまう。
        const hasFailedFeed = result.feedResults.some(
          (feedResult) => feedResult.feedFetchOutcome === 'failure',
        );
        if (hasFailedFeed) {
          failedSources.push('xml');
        }
      } catch (err) {
        failedSources.push('xml');
        console.error('[TimeBasedPollingScheduler] manual xml poll failed:', err);
      }
    })();

    const nonXmlTasks = REQUIRED_ADAPTER_SOURCES.map((source) =>
      (async () => {
        try {
          // 定期実行中のものがあれば合流し、上流取得を1回にまとめる。
          const inFlight = this.inFlightPromises.get(source);
          if (inFlight) {
            await inFlight;
            return;
          }
          const adapter = this.adapterMap.get(source);
          if (!adapter) {
            return;
          }
          await adapter.runManual();
        } catch (err) {
          failedSources.push(source);
          console.error(`[TimeBasedPollingScheduler] manual ${source} poll failed:`, err);
        }
      })(),
    );

    await Promise.allSettled([xmlTask, ...nonXmlTasks]);

    return { failedSources };
  }

  /**
   * Issue #43 §4.3・§9-B: 長期フィードを含む復旧取得を1回行う（XMLのみ）。
   * 定期タイマー・世代・nextRunAt を変更しない。
   */
  async runRecoveryOnce(): Promise<void> {
    await this.xmlPollingService.pollFeeds('recovery');
  }

  /** Issue #43: FetchControlTargets.isRunning() の実体。全体の運転状態を返す。 */
  isRunningNow(): boolean {
    return this.isRunning;
  }

  getStatus(): TimeBasedPollingStatus {
    const now = this.nowFn();
    const period = resolvePollingPeriod(now, this.schedule);
    const nextPeriodChangeAt = getNextPeriodChangeAt(
      now,
      this.schedule,
    ).toISOString() as UtcIso8601String;

    // XML ステータス
    let xmlState: 'waiting' | 'running' | 'scheduled_stopped' = 'waiting';
    let xmlNextRunAt: UtcIso8601String | null = null;
    const xmlIntervalSeconds = period.xmlSeconds;

    if (!this.isRunning || xmlIntervalSeconds === null) {
      xmlState = 'scheduled_stopped';
      if (this.isRunning) {
        const nextEnabled = getNextEnabledAt(
          { kind: 'scheduled', source: 'xml' },
          now,
          this.schedule,
        );
        xmlNextRunAt = nextEnabled ? (nextEnabled.toISOString() as UtcIso8601String) : null;
      } else {
        xmlNextRunAt = null;
      }
    } else if (this.xmlPollingService.isExecuting()) {
      xmlState = 'running';
      xmlNextRunAt = this.xmlPollingService.getNextRunAt();
    } else {
      xmlState = 'waiting';
      xmlNextRunAt = this.xmlPollingService.getNextRunAt();
    }

    const xmlStatus: ScheduledPollStatus = {
      source: 'xml',
      period,
      state: xmlState,
      intervalSeconds: xmlIntervalSeconds,
      nextRunAt: xmlNextRunAt,
    };

    const sourcesResult: Record<ScheduledSource, ScheduledPollStatus> = {
      xml: xmlStatus,
      nowcast: this.buildNonXmlStatus('nowcast', period, now),
      kikikuru: this.buildNonXmlStatus('kikikuru', period, now),
      amedas: this.buildNonXmlStatus('amedas', period, now),
    };

    return {
      period,
      nextPeriodChangeAt,
      sources: sourcesResult,
    };
  }

  private buildNonXmlStatus(
    source: ScheduledSource,
    period: PollingPeriod,
    now: Date,
  ): ScheduledPollStatus {
    const intervalSeconds = getIntervalSecondsForSource(period, source);
    let state: 'waiting' | 'running' | 'scheduled_stopped' = 'waiting';
    let nextRunAt: UtcIso8601String | null = null;

    if (!this.isRunning || intervalSeconds === null) {
      state = 'scheduled_stopped';
      if (this.isRunning) {
        const nextEnabled = getNextEnabledAt({ kind: 'scheduled', source }, now, this.schedule);
        nextRunAt = nextEnabled ? (nextEnabled.toISOString() as UtcIso8601String) : null;
      } else {
        nextRunAt = null;
      }
    } else if (this.inFlightPromises.has(source)) {
      state = 'running';
      nextRunAt = this.nextRunAtMap.get(source) ?? null;
    } else {
      state = this.sourceStates.get(source) ?? 'waiting';
      nextRunAt = this.nextRunAtMap.get(source) ?? null;
    }

    return {
      source,
      period,
      state,
      intervalSeconds,
      nextRunAt,
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.generation++;
    const currentGen = this.generation;

    const now = this.nowFn();
    const period = resolvePollingPeriod(now, this.schedule);

    this.scheduleBoundaryCheck(currentGen);

    // non-XML を先に投入（XML初期完了を待たずに即時開始）
    for (const source of REQUIRED_ADAPTER_SOURCES) {
      const intervalSec = getIntervalSecondsForSource(period, source);
      if (intervalSec !== null) {
        void this.triggerSourcePoll(source, currentGen);
      } else {
        this.sourceStates.set(source, 'scheduled_stopped');
        const nextEnabled = getNextEnabledAt({ kind: 'scheduled', source }, now, this.schedule);
        this.nextRunAtMap.set(
          source,
          nextEnabled ? (nextEnabled.toISOString() as UtcIso8601String) : null,
        );
      }
    }

    // XML
    if (period.xmlSeconds !== null) {
      this.xmlPollingService.setScheduledIntervalSeconds(period.xmlSeconds);
      const hadStartedXml = this.xmlInitialStarted;
      this.xmlInitialStarted = true;
      await this.xmlPollingService.start(hadStartedXml ? { immediateScheduled: true } : undefined);
    } else {
      this.xmlPollingService.setScheduledIntervalSeconds(null);
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.generation++;

    if (this.boundaryTimerId !== null) {
      this.clearTimerFn(this.boundaryTimerId);
      this.boundaryTimerId = null;
    }

    for (const tid of this.timerIds.values()) {
      this.clearTimerFn(tid);
    }
    this.timerIds.clear();

    await this.xmlPollingService.stop();

    // 実行中ジョブの完了を待機
    await Promise.all(Array.from(this.inFlightPromises.values()));

    this.sourceStates.clear();
    this.nextRunAtMap.clear();
  }

  private scheduleBoundaryCheck(generation: number): void {
    if (!this.isRunning || this.generation !== generation) {
      return;
    }

    if (this.boundaryTimerId !== null) {
      this.clearTimerFn(this.boundaryTimerId);
      this.boundaryTimerId = null;
    }

    const now = this.nowFn();
    const nextBoundary = getNextPeriodChangeAt(now, this.schedule);
    const delayMs = Math.max(0, nextBoundary.getTime() - now.getTime());

    this.boundaryTimerId = this.setTimerFn(() => {
      this.boundaryTimerId = null;
      if (!this.isRunning || this.generation !== generation) {
        return;
      }
      this.handleBoundaryTriggered();
    }, delayMs);
  }

  private handleBoundaryTriggered(): void {
    const now = this.nowFn();
    const newPeriod = resolvePollingPeriod(now, this.schedule);

    this.generation++;
    const nextGen = this.generation;

    // XML 周期切替・開始・停止
    const newXmlSec = newPeriod.xmlSeconds;
    if (newXmlSec === null) {
      void this.xmlPollingService.stop();
    } else {
      this.xmlPollingService.setScheduledIntervalSeconds(newXmlSec);
      if (!this.xmlInitialStarted) {
        this.xmlInitialStarted = true;
        this.startXmlAfterBoundary(nextGen);
      } else if (!this.xmlPollingService.getStatus().isRunning) {
        this.startXmlAfterBoundary(nextGen, { immediateScheduled: true });
      }
    }

    // non-XML
    for (const source of REQUIRED_ADAPTER_SOURCES) {
      const existingTimer = this.timerIds.get(source);
      if (existingTimer !== undefined) {
        this.clearTimerFn(existingTimer);
        this.timerIds.delete(source);
      }

      const inFlight = this.inFlightPromises.get(source);
      if (inFlight) {
        // 境界前世代の完了処理は再予約せずに終了する。完了後に現在世代で
        // 新しいモードの周期を予約しないと、この source が次の境界まで停止する。(cfc1105)
        void inFlight.then(() => {
          if (this.isRunning && this.generation === nextGen) {
            this.onPollCompleted(source, nextGen);
          }
        });
        continue;
      }

      const newIntervalSec = getIntervalSecondsForSource(newPeriod, source);
      if (newIntervalSec === null) {
        this.sourceStates.set(source, 'scheduled_stopped');
        const nextEnabled = getNextEnabledAt({ kind: 'scheduled', source }, now, this.schedule);
        this.nextRunAtMap.set(
          source,
          nextEnabled ? (nextEnabled.toISOString() as UtcIso8601String) : null,
        );
      } else {
        const lastCompletedAt = this.lastCompletedAtMap.get(source);
        if (lastCompletedAt === undefined) {
          // 未実行: 即時投入
          void this.triggerSourcePoll(source, nextGen);
        } else {
          // 既に実行履歴がある場合: 新周期に合わせて再計算
          const intervalMs = newIntervalSec * 1000;
          const nextRunMs = lastCompletedAt + intervalMs;
          const remainingMs = Math.max(0, nextRunMs - now.getTime());

          if (remainingMs === 0) {
            void this.triggerSourcePoll(source, nextGen);
          } else {
            this.nextRunAtMap.set(source, new Date(nextRunMs).toISOString() as UtcIso8601String);
            this.sourceStates.set(source, 'waiting');
            const tid = this.setTimerFn(() => {
              this.timerIds.delete(source);
              if (this.generation !== nextGen || !this.isRunning) {
                return;
              }
              void this.triggerSourcePoll(source, nextGen);
            }, remainingMs);
            this.timerIds.set(source, tid);
          }
        }
      }
    }

    this.scheduleBoundaryCheck(nextGen);
  }

  private startXmlAfterBoundary(
    generation: number,
    options?: { immediateScheduled?: boolean },
  ): void {
    void this.xmlPollingService.start(options).catch((error: unknown) => {
      console.error('[TimeBasedPollingScheduler] XML start failed at period boundary:', error);

      if (!this.isRunning || this.generation !== generation) {
        return;
      }

      // 初期取得の例外後は JmaXmlPollingService が failed 状態を保持する。
      // start() を再度呼ぶと同サービスの既存 recovery timer が登録される。
      void this.xmlPollingService.start().catch((recoveryError: unknown) => {
        console.error('[TimeBasedPollingScheduler] XML recovery scheduling failed:', recoveryError);
      });
    });
  }

  private triggerSourcePoll(source: ScheduledSource, generation: number): Promise<void> {
    if (this.generation !== generation || !this.isRunning) {
      return Promise.resolve();
    }

    const currentPeriod = resolvePollingPeriod(this.nowFn(), this.schedule);
    const intervalSec = getIntervalSecondsForSource(currentPeriod, source);
    if (intervalSec === null) {
      return Promise.resolve();
    }

    // 既に実行中ならその Promise を共有して二重起動を防止
    const existingInFlight = this.inFlightPromises.get(source);
    if (existingInFlight) {
      return existingInFlight;
    }

    const adapter = this.adapterMap.get(source);
    if (!adapter) {
      return Promise.resolve();
    }

    const existingTimer = this.timerIds.get(source);
    if (existingTimer !== undefined) {
      this.clearTimerFn(existingTimer);
      this.timerIds.delete(source);
    }

    this.sourceStates.set(source, 'running');

    const pollPromise = (async () => {
      try {
        await adapter.runScheduled();
      } catch (err) {
        console.error(`[TimeBasedPollingScheduler] ${source} scheduled poll failed:`, err);
      } finally {
        this.inFlightPromises.delete(source);
        this.onPollCompleted(source, generation);
      }
    })();

    this.inFlightPromises.set(source, pollPromise);
    return pollPromise;
  }

  private onPollCompleted(source: ScheduledSource, generation: number): void {
    const completedAtMs = this.nowFn().getTime();
    this.lastCompletedAtMap.set(source, completedAtMs);

    if (this.generation !== generation || !this.isRunning) {
      return;
    }

    const currentPeriod = resolvePollingPeriod(this.nowFn(), this.schedule);
    const intervalSeconds = getIntervalSecondsForSource(currentPeriod, source);
    if (intervalSeconds === null) {
      this.sourceStates.set(source, 'scheduled_stopped');
      const nextEnabled = getNextEnabledAt(
        { kind: 'scheduled', source },
        this.nowFn(),
        this.schedule,
      );
      this.nextRunAtMap.set(
        source,
        nextEnabled ? (nextEnabled.toISOString() as UtcIso8601String) : null,
      );
      return;
    }

    const delayMs = intervalSeconds * 1000;
    const nextRunDate = new Date(completedAtMs + delayMs);
    this.nextRunAtMap.set(source, nextRunDate.toISOString() as UtcIso8601String);
    this.sourceStates.set(source, 'waiting');

    const tid = this.setTimerFn(() => {
      this.timerIds.delete(source);
      if (this.generation !== generation || !this.isRunning) {
        return;
      }
      void this.triggerSourcePoll(source, generation);
    }, delayMs);

    this.timerIds.set(source, tid);
  }
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

export class NowcastScheduledAdapter implements ScheduledPollAdapter {
  readonly source: ScheduledSource = 'nowcast';
  constructor(private readonly service: NowcastService) {}

  async runScheduled(): Promise<void> {
    await this.service.refreshTimes({ triggerKind: 'scheduled' });
  }

  /**
   * Issue #43 §9-A: 手動強制更新は夜間帯の索引取得ゲートを迂回する。
   * レビュー指摘 #1: 上流取得・解析が失敗していれば例外を投げ、runManualOnce() の
   * failedSources 検知が機能するようにする（NowcastCatalog は前回正常値を保持し
   * 縮退させないため、catalog の availability だけでは今回の失敗を判定できない）。
   */
  async runManual(): Promise<void> {
    await this.service.refreshTimes({ triggerKind: 'manual', bypassScheduleStop: true });
    if (this.service.hasLastRefreshFailed()) {
      throw new Error('nowcast の時刻一覧取得または解析に失敗しました');
    }
  }
}

export class KikikuruScheduledAdapter implements ScheduledPollAdapter {
  readonly source: ScheduledSource = 'kikikuru';
  constructor(private readonly service: KikikuruService) {}

  async runScheduled(): Promise<void> {
    await this.service.refreshTimes({ triggerKind: 'scheduled' });
  }

  /**
   * Issue #43 §9-A: 手動強制更新は夜間帯の索引取得ゲートを迂回する。
   * レビュー指摘 #1: 失敗時に例外を投げ、runManualOnce() の failedSources 検知を機能させる。
   */
  async runManual(): Promise<void> {
    await this.service.refreshTimes({ triggerKind: 'manual', bypassScheduleStop: true });
    if (this.service.hasLastRefreshFailed()) {
      throw new Error('kikikuru の時刻一覧取得または解析に失敗しました');
    }
  }
}

export class AmedasScheduledAdapter implements ScheduledPollAdapter {
  readonly source: ScheduledSource = 'amedas';
  private readonly connection: DatabaseConnection;
  private readonly state: AmedasFetchState;
  private readonly recheckIntervalMs: number;
  private readonly nowFn: () => number;
  private readonly fetchOptions?: AmedasFetchOptions;
  private lastPointFetchStartedAtMs: number | null = null;

  constructor(
    connection: DatabaseConnection,
    state: AmedasFetchState,
    recheckSeconds: number = 600,
    options?: {
      fetchOptions?: AmedasFetchOptions;
      now?: () => Date;
    },
  ) {
    this.connection = connection;
    this.state = state;
    this.recheckIntervalMs = recheckSeconds * 1000;
    this.nowFn = () => (options?.now ? options.now().getTime() : Date.now());
    this.fetchOptions = options?.fetchOptions;
  }

  async runScheduled(): Promise<void> {
    const currentNowMs = this.nowFn();
    const consecutiveFailures = this.state.getStreamStatus('pointData').consecutiveFailures;
    const isRecheckDue =
      this.lastPointFetchStartedAtMs === null ||
      consecutiveFailures >= 1 ||
      currentNowMs - this.lastPointFetchStartedAtMs >= this.recheckIntervalMs;

    const pointFetchPolicy = isRecheckDue ? 'always' : 'onLatestTimeChange';

    const result = await runAmedasFetchCycle(this.connection, this.state, {
      ...this.fetchOptions,
      triggerKind: 'scheduled',
      backfillBlocks: 0,
      pointFetchPolicy,
    });

    if (result.pointData.attempted) {
      this.lastPointFetchStartedAtMs = currentNowMs;
    }
  }

  /**
   * Issue #43 §4.3: lastPointFetchStartedAtMs を更新しない単発実行。
   * レビュー指摘 #1: 最新時刻・地点データのいずれかが失敗していれば例外を投げ、
   * runManualOnce() の failedSources 検知が機能するようにする。
   * pointData は latest_time 失敗時のみ意図的に未試行（skipReason: 'latest_time_failed'）
   * になるため、attempted な場合だけ succeeded を確認する。
   */
  async runManual(): Promise<void> {
    const result = await runAmedasFetchCycle(this.connection, this.state, {
      ...this.fetchOptions,
      triggerKind: 'manual',
      backfillBlocks: 0,
      pointFetchPolicy: 'always',
    });
    if (!result.latestTime.succeeded) {
      throw new Error(
        `アメダス最新時刻の取得に失敗しました: ${result.latestTime.errorMessage ?? '不明なエラー'}`,
      );
    }
    if (result.pointData.attempted && !result.pointData.succeeded) {
      throw new Error(
        `アメダス地点データの取得に失敗しました: ${result.pointData.errorMessage ?? '不明なエラー'}`,
      );
    }
  }
}

export class MultiVenueAmedasScheduledAdapter implements ScheduledPollAdapter {
  readonly source: ScheduledSource = 'amedas';
  constructor(private readonly adapters: readonly AmedasScheduledAdapter[]) {}

  async runScheduled(): Promise<void> {
    const results = await Promise.allSettled(
      this.adapters.map((adapter) => adapter.runScheduled()),
    );
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (rejected.length > 0) {
      if (rejected.length === 1) {
        throw rejected[0]!.reason;
      }
      throw new AggregateError(
        rejected.map((r) => r.reason),
        `${rejected.length} 件のアメダスアダプター実行で例外が発生しました`,
      );
    }
  }

  async runManual(): Promise<void> {
    const results = await Promise.allSettled(this.adapters.map((adapter) => adapter.runManual()));
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (rejected.length > 0) {
      if (rejected.length === 1) {
        throw rejected[0]!.reason;
      }
      throw new AggregateError(
        rejected.map((r) => r.reason),
        `${rejected.length} 件のアメダスアダプター実行で例外が発生しました`,
      );
    }
  }
}

export function resolveUniqueAmedasVenues(
  venueIds: readonly VenueId[],
  resolveTarget?: (venueId: VenueId) => AmedasTarget,
): readonly VenueId[] {
  const resolver = resolveTarget ?? resolveAmedasTarget;
  const seenStationCodes = new Map<string, { venueId: VenueId; target: AmedasTarget }>();
  const uniqueVenues: VenueId[] = [];

  for (const venueId of venueIds) {
    const target = resolver(venueId);
    const existing = seenStationCodes.get(target.stationCode);
    if (existing) {
      if (
        existing.target.displayName !== target.displayName ||
        existing.target.elements !== target.elements
      ) {
        throw new Error(
          `同一地点 (${target.stationCode}) に対する会場定義が一致しません: ` +
            `[${existing.venueId}: displayName=${existing.target.displayName}, elements=${existing.target.elements}] vs ` +
            `[${venueId}: displayName=${target.displayName}, elements=${target.elements}]`,
        );
      }
    } else {
      seenStationCodes.set(target.stationCode, { venueId, target });
      uniqueVenues.push(venueId);
    }
  }

  return uniqueVenues;
}

export interface CreateScheduledAdaptersOptions {
  readonly connection: DatabaseConnection;
  readonly nowcastService?: NowcastService;
  readonly kikikuruService?: KikikuruService;
  readonly amedasState?: AmedasFetchState;
  readonly amedasVenueId?: VenueId;
  readonly amedasPointRecheckSeconds?: number;
  readonly now?: () => Date;
  readonly amedasFetchOptions?: AmedasFetchOptions;
  readonly schedule?: PollingScheduleConfig;
}

export function createScheduledAdapters(
  options: CreateScheduledAdaptersOptions,
): readonly ScheduledPollAdapter[] {
  if (!options.nowcastService || !options.kikikuruService) {
    throw new Error(
      'nowcastService と kikikuruService は必須です (共用インスタンスを注入してください)',
    );
  }

  let amedasAdapter: ScheduledPollAdapter;

  if (options.amedasState !== undefined || options.amedasVenueId !== undefined) {
    const amedasVenueId = options.amedasVenueId ?? 'east';
    const amedasState = options.amedasState ?? new AmedasFetchState(amedasVenueId);
    amedasAdapter = new AmedasScheduledAdapter(
      options.connection,
      amedasState,
      options.amedasPointRecheckSeconds ?? 600,
      {
        fetchOptions: options.amedasFetchOptions,
        now: options.now,
      },
    );
  } else {
    const uniqueVenues = resolveUniqueAmedasVenues(VENUE_IDS);
    const adapters = uniqueVenues.map((venueId) => {
      const state = new AmedasFetchState(venueId);
      return new AmedasScheduledAdapter(
        options.connection,
        state,
        options.amedasPointRecheckSeconds ?? 600,
        {
          fetchOptions: options.amedasFetchOptions,
          now: options.now,
        },
      );
    });
    amedasAdapter = new MultiVenueAmedasScheduledAdapter(adapters);
  }

  return [
    new NowcastScheduledAdapter(options.nowcastService),
    new KikikuruScheduledAdapter(options.kikikuruService),
    amedasAdapter,
  ];
}
