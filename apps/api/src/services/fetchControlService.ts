import crypto from 'node:crypto';
import type {
  FetchControlCompletedResponse,
  FetchControlInProgressResponse,
  FetchControlOperationKind,
  FetchControlState,
  UtcIso8601String,
} from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import {
  findOperationHistoryByRequestId,
  recordOperationHistory,
} from '../repositories/operationHistoryRepository.js';
import type { OperationHistory, OperationResult } from '../repositories/types.js';
import { sanitizeErrorMessage } from '../polling/httpGet.js';
import { emitOperationNotification } from '../notifications/operationNotificationEmitter.js';
import {
  planOperationNotification,
  planServiceStoppedNotification,
} from '../notifications/operationNotificationPlanner.js';

/** §9-B 確定事項(5): 停止時間が30分以上なら開始操作に伴う復旧を実行する。固定値。 */
export const RESUME_RECOVERY_THRESHOLD_MS = 30 * 60_000;

const MAX_ERROR_MESSAGE_LENGTH = 200;
const COMPLETED_MEMORY_LIMIT = 200;

/** §4.6: 強制更新が停止・シャットダウンによる中断で完了しなかったときの専用エラー。 */
export class ForceRefreshAbortedError extends Error {
  constructor(readonly abortedSources: readonly string[]) {
    super(`force refresh aborted for: ${abortedSources.join(',')}`);
    this.name = 'ForceRefreshAbortedError';
  }
}

/** §5.6: 強制更新が失敗したとき、失敗した取得元を運ぶための専用エラー。 */
export class ForceRefreshFailedError extends Error {
  constructor(readonly failedSources: readonly string[]) {
    super(`force refresh failed for: ${failedSources.join(',')}`);
    this.name = 'ForceRefreshFailedError';
  }
}

export interface FetchControlTargets {
  /** scheduler.start() 相当。冪等。 */
  start(): Promise<void>;
  /** scheduler.stop() 相当。新規投入を止め、実行中のXML取得サイクルを電文境界で打ち切ってから戻る。非XMLの実行中ジョブは完了を待つ。冪等。 */
  stop(): Promise<void>;
  /** 定期予定に影響しない全取得元の単発実行。夜間帯でも実行する（§9-A）。失敗時は ForceRefreshFailedError を投げる。 */
  forceRefresh(): Promise<void>;
  /** 長期フィードを含む復旧取得を1回行う（§9-B）。scheduler.runRecoveryOnce() 相当。 */
  runRecovery(): Promise<void>;
  /** 現在の運転状態（スケジューラの isRunning 由来）。 */
  isRunning(): boolean;
  /** 現在時刻が上流取得を許す時間帯か（resolvePollingPeriod(now).xmlSeconds !== null）。§9-B の復旧判定に使う。 */
  isUpstreamAllowedNow(): boolean;
}

export interface FetchControlServiceDependencies {
  readonly connection: DatabaseConnection;
  /** ポーリング無効起動などでスケジューラが存在しない場合は null。 */
  readonly targets: FetchControlTargets | null;
  readonly now: () => UtcIso8601String;
  readonly notificationIdFactory?: () => string; // 既定 crypto.randomUUID
}

export type FetchControlOutcome =
  | { readonly kind: 'completed'; readonly response: FetchControlCompletedResponse }
  | { readonly kind: 'in_progress'; readonly response: FetchControlInProgressResponse }
  | { readonly kind: 'conflict'; readonly recordedOperationKind: FetchControlOperationKind }
  | { readonly kind: 'not_found' };

export interface FetchControlService {
  request(kind: FetchControlOperationKind, requestId: string): Promise<FetchControlOutcome>;
  find(requestId: string): FetchControlOutcome;
  getState(): FetchControlState;
  /** ポーリング無効起動などでスケジューラが存在せず、操作を受け付けられない場合 false。 */
  isAvailable(): boolean;
  /** graceful shutdown 用。B5記録 + サービス停止通知を1回だけ行う。 */
  recordShutdown(): Promise<void>;
}

interface CompletedLike {
  readonly requestId: string;
  readonly operationKind: FetchControlOperationKind;
  readonly result: OperationResult;
  readonly requestedAt: UtcIso8601String;
  readonly completedAt: UtcIso8601String;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

interface InProgressEntry {
  readonly operationKind: FetchControlOperationKind;
  readonly requestedAt: UtcIso8601String;
}

interface RunOutcome {
  readonly completedAt: UtcIso8601String;
  readonly result: OperationResult;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function toOperationHistoryLike(history: OperationHistory): CompletedLike {
  return {
    requestId: history.requestId,
    operationKind: history.operationKind,
    result: history.result,
    requestedAt: history.requestedAt,
    completedAt: history.completedAt,
    errorCode: history.errorCode,
    errorMessage: history.errorMessage,
  };
}

export function createFetchControlService(
  deps: FetchControlServiceDependencies,
): FetchControlService {
  const notificationIdFactory = deps.notificationIdFactory ?? (() => crypto.randomUUID());

  const inProgress = new Map<string, InProgressEntry>();
  const completedMemory = new Map<string, CompletedLike>();
  const completedOrder: string[] = [];

  let lane: Promise<unknown> = Promise.resolve();
  let activeForceRefresh: {
    readonly promise: Promise<RunOutcome>;
  } | null = null;
  let lastStoppedAt: UtcIso8601String | null = null;
  let shutdownRecorded = false;

  function rememberCompleted(record: CompletedLike): void {
    completedMemory.set(record.requestId, record);
    completedOrder.push(record.requestId);
    if (completedOrder.length > COMPLETED_MEMORY_LIMIT) {
      const evictId = completedOrder.shift();
      if (evictId !== undefined) {
        completedMemory.delete(evictId);
      }
    }
  }

  function findCompleted(requestId: string): CompletedLike | null {
    const fromDb = findOperationHistoryByRequestId(deps.connection, requestId);
    if (fromDb) {
      return toOperationHistoryLike(fromDb);
    }
    return completedMemory.get(requestId) ?? null;
  }

  function getState(): FetchControlState {
    for (const entry of inProgress.values()) {
      if (entry.operationKind === 'start') {
        return 'starting';
      }
    }
    for (const entry of inProgress.values()) {
      if (entry.operationKind === 'stop') {
        return 'stopping';
      }
    }
    if (deps.targets === null) {
      return 'stopped';
    }
    return deps.targets.isRunning() ? 'running' : 'stopped';
  }

  function toCompletedResponse(
    record: CompletedLike,
    duplicate: boolean,
  ): FetchControlCompletedResponse {
    return {
      status: 'completed',
      requestId: record.requestId,
      operationKind: record.operationKind,
      targetKind: 'all',
      result: record.result,
      requestedAt: record.requestedAt,
      completedAt: record.completedAt,
      errorCode: record.errorCode,
      errorMessage: record.errorMessage,
      duplicate,
      fetchControlState: getState(),
    };
  }

  function toInProgressResponse(
    requestId: string,
    entry: InProgressEntry,
  ): FetchControlInProgressResponse {
    return {
      status: 'in_progress',
      requestId,
      operationKind: entry.operationKind,
      targetKind: 'all',
      requestedAt: entry.requestedAt,
      fetchControlState: getState(),
    };
  }

  async function runStartOrStop(
    kind: 'start' | 'stop',
    requestedAt: UtcIso8601String,
  ): Promise<RunOutcome> {
    const targets = deps.targets;
    if (targets === null) {
      const completedAt = deps.now();
      return {
        completedAt,
        result: 'failure',
        errorCode: kind === 'start' ? 'start_failed' : 'stop_failed',
        errorMessage: 'fetch control is unavailable',
      };
    }

    try {
      if (kind === 'start') {
        await targets.start();

        if (lastStoppedAt !== null) {
          const elapsedMs = new Date(requestedAt).getTime() - new Date(lastStoppedAt).getTime();
          if (elapsedMs >= RESUME_RECOVERY_THRESHOLD_MS && targets.isUpstreamAllowedNow()) {
            try {
              await targets.runRecovery();
            } catch (error) {
              // §5.6: 復旧の失敗は開始操作の failure にしない。
              console.error('開始操作に伴う復旧取得に失敗しました:', error);
            } finally {
              lastStoppedAt = null;
            }
          }
          // 夜間帯なら lastStoppedAt を保持したまま次の明示的な開始操作まで保留する（§9-B 確定事項(6)）。
        }

        const completedAt = deps.now();
        return { completedAt, result: 'success', errorCode: null, errorMessage: null };
      }

      await targets.stop();
      const completedAt = deps.now();
      lastStoppedAt = completedAt;
      return { completedAt, result: 'success', errorCode: null, errorMessage: null };
    } catch (error) {
      const completedAt = deps.now();
      return {
        completedAt,
        result: 'failure',
        errorCode: kind === 'start' ? 'start_failed' : 'stop_failed',
        errorMessage: truncate(sanitizeErrorMessage(String(error)), MAX_ERROR_MESSAGE_LENGTH),
      };
    }
  }

  async function runForceRefresh(): Promise<RunOutcome> {
    const targets = deps.targets;
    if (targets === null) {
      const completedAt = deps.now();
      return {
        completedAt,
        result: 'failure',
        errorCode: 'force_refresh_failed',
        errorMessage: 'fetch control is unavailable',
      };
    }
    try {
      await targets.forceRefresh();
      const completedAt = deps.now();
      return { completedAt, result: 'success', errorCode: null, errorMessage: null };
    } catch (error) {
      const completedAt = deps.now();
      if (error instanceof ForceRefreshAbortedError) {
        return {
          completedAt,
          result: 'failure',
          errorCode: 'force_refresh_aborted',
          errorMessage: truncate(error.abortedSources.join(','), MAX_ERROR_MESSAGE_LENGTH),
        };
      }
      if (error instanceof ForceRefreshFailedError) {
        return {
          completedAt,
          result: 'failure',
          errorCode: 'force_refresh_failed',
          errorMessage: truncate(error.failedSources.join(','), MAX_ERROR_MESSAGE_LENGTH),
        };
      }
      return {
        completedAt,
        result: 'failure',
        errorCode: 'force_refresh_failed',
        errorMessage: truncate(sanitizeErrorMessage(String(error)), MAX_ERROR_MESSAGE_LENGTH),
      };
    }
  }

  function finalizeOperation(
    kind: FetchControlOperationKind,
    requestId: string,
    requestedAt: UtcIso8601String,
    outcome: RunOutcome,
  ): FetchControlOutcome {
    inProgress.delete(requestId);

    let recorded: OperationHistory;
    try {
      recorded = recordOperationHistory(deps.connection, {
        requestId,
        operationKind: kind,
        targetKind: 'all',
        result: outcome.result,
        requestedAt,
        completedAt: outcome.completedAt,
        actorId: null,
        actorDisplayName: null,
        errorCode: outcome.errorCode,
        errorMessage: outcome.errorMessage,
      });
    } catch {
      // B5 の request_id UNIQUE 制約違反、または書き込み失敗。
      const existing = findOperationHistoryByRequestId(deps.connection, requestId);
      if (existing) {
        if (existing.operationKind !== kind) {
          return { kind: 'conflict', recordedOperationKind: existing.operationKind };
        }
        const like = toOperationHistoryLike(existing);
        rememberCompleted(like);
        return { kind: 'completed', response: toCompletedResponse(like, true) };
      }
      // B5書き込み自体が失敗した場合のフォールバック（§5.5 メモリ完了表）。
      const memoryOnly: CompletedLike = {
        requestId,
        operationKind: kind,
        result: outcome.result,
        requestedAt,
        completedAt: outcome.completedAt,
        errorCode: outcome.errorCode,
        errorMessage: outcome.errorMessage,
      };
      rememberCompleted(memoryOnly);
      return { kind: 'completed', response: toCompletedResponse(memoryOnly, false) };
    }

    const planned = planOperationNotification({
      operationKind: kind,
      result: outcome.result,
      requestId,
      completedAt: outcome.completedAt,
      notificationIdFactory,
      failureDetail: outcome.errorMessage ?? undefined,
      errorCode: outcome.errorCode,
    });
    emitOperationNotification(deps.connection, planned);

    const like = toOperationHistoryLike(recorded);
    rememberCompleted(like);
    return { kind: 'completed', response: toCompletedResponse(like, false) };
  }

  return {
    async request(
      kind: FetchControlOperationKind,
      requestId: string,
    ): Promise<FetchControlOutcome> {
      const existingCompleted = findCompleted(requestId);
      if (existingCompleted) {
        if (existingCompleted.operationKind !== kind) {
          return { kind: 'conflict', recordedOperationKind: existingCompleted.operationKind };
        }
        return { kind: 'completed', response: toCompletedResponse(existingCompleted, true) };
      }

      const existingInProgress = inProgress.get(requestId);
      if (existingInProgress) {
        if (existingInProgress.operationKind !== kind) {
          return { kind: 'conflict', recordedOperationKind: existingInProgress.operationKind };
        }
        return {
          kind: 'in_progress',
          response: toInProgressResponse(requestId, existingInProgress),
        };
      }

      const requestedAt = deps.now();
      inProgress.set(requestId, { operationKind: kind, requestedAt });

      if (kind === 'force_refresh') {
        if (activeForceRefresh) {
          // レビュー指摘 #3・設計§5.4-3: 実行中（レーン待機中を含む）の強制更新へ合流する。
          // この分岐だけは共有レーンを新たに取らない。
          const outcome = await activeForceRefresh.promise;
          return finalizeOperation(kind, requestId, requestedAt, outcome);
        }
        // レビュー指摘 #3・設計§5.4-4: 新規の強制更新は共有レーンに乗せ、開始・停止と直列化する。
        // activeForceRefresh はレーンの順番が回ってくるのを待たず「この場で」同期的に登録する
        // ことで、レーン待機中に届いた別 requestId の強制更新も正しくこの sharedPromise へ
        // 合流できるようにする（レーン内で登録すると、その順番が来るまでの間に届いた要求が
        // 合流できず、開始・停止を挟んで上流取得が複数回走ってしまう）。
        const sharedPromise = lane.then(() => runForceRefresh());
        activeForceRefresh = { promise: sharedPromise };
        lane = sharedPromise.then(
          () => undefined,
          () => undefined,
        );
        let outcome: RunOutcome;
        try {
          outcome = await sharedPromise;
        } finally {
          activeForceRefresh = null;
        }
        return finalizeOperation(kind, requestId, requestedAt, outcome);
      }

      const runPromise = lane.then(() => runStartOrStop(kind, requestedAt));
      lane = runPromise.then(
        () => undefined,
        () => undefined,
      );
      const outcome = await runPromise;
      return finalizeOperation(kind, requestId, requestedAt, outcome);
    },

    find(requestId: string): FetchControlOutcome {
      const completed = findCompleted(requestId);
      if (completed) {
        return { kind: 'completed', response: toCompletedResponse(completed, true) };
      }
      const entry = inProgress.get(requestId);
      if (entry) {
        return { kind: 'in_progress', response: toInProgressResponse(requestId, entry) };
      }
      return { kind: 'not_found' };
    },

    getState,

    isAvailable(): boolean {
      return deps.targets !== null;
    },

    async recordShutdown(): Promise<void> {
      if (shutdownRecorded) {
        return;
      }
      shutdownRecorded = true;

      const requestedAt = deps.now();
      const requestId = `shutdown-${crypto.randomUUID()}`;
      const completedAt = deps.now();

      try {
        recordOperationHistory(deps.connection, {
          requestId,
          operationKind: 'stop',
          targetKind: 'all',
          result: 'success',
          requestedAt,
          completedAt,
          actorId: null,
          actorDisplayName: null,
          errorCode: null,
          errorMessage: null,
        });
      } catch (error) {
        console.error('graceful shutdown の操作記録に失敗しました:', error);
      }

      lastStoppedAt = completedAt;

      const planned = planServiceStoppedNotification({ completedAt, notificationIdFactory });
      emitOperationNotification(deps.connection, planned);
    },
  };
}
