import path from 'node:path';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import {
  DEFAULT_POLLING_SCHEDULE,
  getNextJstTime,
  getNextModeChangeAt,
  resolvePollingMode,
  validatePollingScheduleConfig,
  type PollingMode,
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
import type { VenueId } from '@wx-viewer-poc/shared';

export interface ScheduledPollAdapter {
  readonly source: ScheduledSource;
  runScheduled(): Promise<void>;
}

export interface TimeBasedPollingSchedulerOptions {
  readonly schedule?: PollingScheduleConfig;
  readonly adapters: readonly ScheduledPollAdapter[];
  readonly xmlPollingService: JmaXmlPollingService;
  readonly now?: () => Date;
  readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer?: (id: unknown) => void;
}

export interface ScheduledPollStatus {
  readonly source: ScheduledSource;
  readonly mode: PollingMode;
  readonly state: 'waiting' | 'running' | 'scheduled_stopped';
  readonly intervalSeconds: number | null;
  readonly nextRunAt: UtcIso8601String | null;
}

export interface TimeBasedPollingStatus {
  readonly mode: PollingMode;
  readonly nextModeChangeAt: UtcIso8601String;
  readonly sources: Readonly<Record<ScheduledSource, ScheduledPollStatus>>;
}

const REQUIRED_ADAPTER_SOURCES: readonly ScheduledSource[] = [
  'nowcast',
  'kikikuru',
  'amedas',
] as const;

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
    this.schedule = validatePollingScheduleConfig(options.schedule ?? DEFAULT_POLLING_SCHEDULE);

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

  getStatus(): TimeBasedPollingStatus {
    const now = this.nowFn();
    const mode = resolvePollingMode(now, this.schedule);
    const nextModeChangeAt = getNextModeChangeAt(
      now,
      this.schedule,
    ).toISOString() as UtcIso8601String;
    const isOffHours = mode === 'off_hours';
    const next0400Iso = getNextJstTime(now, '04:00').toISOString() as UtcIso8601String;

    // XML ステータス
    let xmlState: 'waiting' | 'running' | 'scheduled_stopped' = 'waiting';
    let xmlNextRunAt: UtcIso8601String | null = null;
    const xmlIntervalSeconds = this.schedule.intervalsSeconds[mode].xml;

    if (!this.isRunning || isOffHours) {
      xmlState = 'scheduled_stopped';
      xmlNextRunAt = isOffHours ? next0400Iso : null;
    } else if (this.xmlPollingService.isExecuting()) {
      xmlState = 'running';
      xmlNextRunAt = this.xmlPollingService.getNextRunAt();
    } else {
      xmlState = 'waiting';
      xmlNextRunAt = this.xmlPollingService.getNextRunAt();
    }

    const xmlStatus: ScheduledPollStatus = {
      source: 'xml',
      mode,
      state: xmlState,
      intervalSeconds: xmlIntervalSeconds,
      nextRunAt: xmlNextRunAt,
    };

    const sourcesResult: Record<ScheduledSource, ScheduledPollStatus> = {
      xml: xmlStatus,
      nowcast: this.buildNonXmlStatus('nowcast', mode, isOffHours, next0400Iso),
      kikikuru: this.buildNonXmlStatus('kikikuru', mode, isOffHours, next0400Iso),
      amedas: this.buildNonXmlStatus('amedas', mode, isOffHours, next0400Iso),
    };

    return {
      mode,
      nextModeChangeAt,
      sources: sourcesResult,
    };
  }

  private buildNonXmlStatus(
    source: ScheduledSource,
    mode: PollingMode,
    isOffHours: boolean,
    next0400Iso: UtcIso8601String,
  ): ScheduledPollStatus {
    const intervalSeconds = this.schedule.intervalsSeconds[mode][source];
    let state: 'waiting' | 'running' | 'scheduled_stopped' = 'waiting';
    let nextRunAt: UtcIso8601String | null = null;

    if (!this.isRunning || isOffHours) {
      state = 'scheduled_stopped';
      nextRunAt = isOffHours ? next0400Iso : null;
    } else if (this.inFlightPromises.has(source)) {
      state = 'running';
      nextRunAt = this.nextRunAtMap.get(source) ?? null;
    } else {
      state = this.sourceStates.get(source) ?? 'waiting';
      nextRunAt = this.nextRunAtMap.get(source) ?? null;
    }

    return {
      source,
      mode,
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
    const mode = resolvePollingMode(now, this.schedule);

    this.scheduleBoundaryCheck(currentGen);

    if (mode === 'off_hours') {
      // 夜間起動: XML初期取得を含め、上流HTTP取得を一切実行しない
      const next0400 = getNextJstTime(now, '04:00').toISOString() as UtcIso8601String;
      for (const src of REQUIRED_ADAPTER_SOURCES) {
        this.sourceStates.set(src, 'scheduled_stopped');
        this.nextRunAtMap.set(src, next0400);
      }
      return;
    }

    // 運用時間帯: XMLサービスに通常周期を供給して起動
    this.xmlPollingService.setScheduledIntervalSeconds(this.schedule.intervalsSeconds[mode].xml);
    this.xmlInitialStarted = true;
    void this.xmlPollingService.start();

    // non-XMLの初回即時実行
    for (const source of REQUIRED_ADAPTER_SOURCES) {
      void this.triggerSourcePoll(source, currentGen);
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
    const nextBoundary = getNextModeChangeAt(now, this.schedule);
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
    const newMode = resolvePollingMode(now, this.schedule);

    this.generation++;
    const nextGen = this.generation;

    if (newMode === 'off_hours') {
      // 20:00 到達: 新規ジョブを投入せず、開始済みは中断せず待つ
      for (const tid of this.timerIds.values()) {
        this.clearTimerFn(tid);
      }
      this.timerIds.clear();

      void this.xmlPollingService.stop();

      const next0400 = getNextJstTime(now, '04:00').toISOString() as UtcIso8601String;
      for (const src of REQUIRED_ADAPTER_SOURCES) {
        this.sourceStates.set(src, 'scheduled_stopped');
        this.nextRunAtMap.set(src, next0400);
      }
    } else {
      // 運用時間帯への移行または運用時間帯同士の移行
      this.xmlPollingService.setScheduledIntervalSeconds(
        this.schedule.intervalsSeconds[newMode].xml,
      );

      if (!this.xmlInitialStarted) {
        // 夜間起動後の 04:00: XML 初期4フィードを一度実行
        this.xmlInitialStarted = true;
        void this.xmlPollingService.start();
      } else if (!this.xmlPollingService.getStatus().isRunning) {
        // 20:00 で stop() された後の 04:00: 通常取得を即時投入して再開
        void this.xmlPollingService.start({ immediateScheduled: true });
      }

      // non-XMLの即時投入または再スケジュール
      for (const source of REQUIRED_ADAPTER_SOURCES) {
        const existingTimer = this.timerIds.get(source);
        if (existingTimer !== undefined) {
          this.clearTimerFn(existingTimer);
          this.timerIds.delete(source);
        }

        const inFlight = this.inFlightPromises.get(source);
        if (inFlight) {
          // 境界前世代の完了処理は再予約せずに終了する。完了後に現在世代で
          // 新しいモードの周期を予約しないと、この source が次の境界まで停止する。
          void inFlight.then(() => {
            if (this.isRunning && this.generation === nextGen) {
              this.onPollCompleted(source, nextGen);
            }
          });
          continue;
        }

        const lastCompletedAt = this.lastCompletedAtMap.get(source);
        const intervalSec = this.schedule.intervalsSeconds[newMode][source];

        if (lastCompletedAt === undefined || intervalSec === null) {
          // 未実行または夜間明け: 即時投入
          void this.triggerSourcePoll(source, nextGen);
        } else {
          // 既に実行履歴がある日中移行: 新周期に合わせて再計算
          const intervalMs = intervalSec * 1000;
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

  private triggerSourcePoll(source: ScheduledSource, generation: number): Promise<void> {
    if (this.generation !== generation || !this.isRunning) {
      return Promise.resolve();
    }

    const currentMode = resolvePollingMode(this.nowFn(), this.schedule);
    if (currentMode === 'off_hours') {
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

    const currentMode = resolvePollingMode(this.nowFn(), this.schedule);
    if (currentMode === 'off_hours') {
      this.sourceStates.set(source, 'scheduled_stopped');
      this.nextRunAtMap.set(
        source,
        getNextJstTime(this.nowFn(), '04:00').toISOString() as UtcIso8601String,
      );
      return;
    }

    const intervalSeconds = this.schedule.intervalsSeconds[currentMode][source];
    if (intervalSeconds === null) {
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
}

export class KikikuruScheduledAdapter implements ScheduledPollAdapter {
  readonly source: ScheduledSource = 'kikikuru';
  constructor(private readonly service: KikikuruService) {}

  async runScheduled(): Promise<void> {
    await this.service.refreshTimes({ triggerKind: 'scheduled' });
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
    const isRecheckDue =
      this.lastPointFetchStartedAtMs === null ||
      currentNowMs - this.lastPointFetchStartedAtMs >= this.recheckIntervalMs;

    const pointFetchPolicy = isRecheckDue ? 'always' : 'onLatestTimeChange';

    const result = await runAmedasFetchCycle(this.connection, this.state, {
      ...this.fetchOptions,
      triggerKind: 'scheduled',
      pointFetchPolicy,
    });

    if (result.pointData.attempted) {
      this.lastPointFetchStartedAtMs = currentNowMs;
    }
  }
}

export interface CreateScheduledAdaptersOptions {
  readonly connection: DatabaseConnection;
  readonly nowcastService?: NowcastService;
  readonly kikikuruService?: KikikuruService;
  readonly amedasState?: AmedasFetchState;
  readonly amedasVenueId?: VenueId;
  readonly amedasPointRecheckSeconds?: number;
  readonly now?: () => Date;
  readonly nowcastOptions?: ConstructorParameters<typeof NowcastService>[1];
  readonly kikikuruOptions?: ConstructorParameters<typeof KikikuruService>[1];
  readonly amedasFetchOptions?: AmedasFetchOptions;
}

export function createScheduledAdapters(
  options: CreateScheduledAdaptersOptions,
): readonly ScheduledPollAdapter[] {
  const nowcast =
    options.nowcastService ??
    new NowcastService(
      options.connection,
      options.nowcastOptions ?? {
        cacheRoot: path.resolve(process.cwd(), 'data/cache/nowcast'),
        allowedZooms: [10],
        staleAfterMs: { N1: 300_000, N2: 300_000 },
      },
    );

  const kikikuru =
    options.kikikuruService ??
    new KikikuruService(
      options.connection,
      options.kikikuruOptions ?? {
        cacheRoot: path.resolve(process.cwd(), 'data/cache/kikikuru'),
        allowedZooms: [10],
        staleAfterMs: {
          heavyrain: 300_000,
          inund: 300_000,
          land: 300_000,
        },
      },
    );

  const amedasVenueId = options.amedasVenueId ?? 'east';
  const amedasState = options.amedasState ?? new AmedasFetchState(amedasVenueId);
  const amedas = new AmedasScheduledAdapter(
    options.connection,
    amedasState,
    options.amedasPointRecheckSeconds ?? 600,
    {
      fetchOptions: options.amedasFetchOptions,
      now: options.now,
    },
  );

  return [new NowcastScheduledAdapter(nowcast), new KikikuruScheduledAdapter(kikikuru), amedas];
}
