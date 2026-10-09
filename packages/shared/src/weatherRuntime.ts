import type { UtcIso8601String } from './types.js';

export type WeatherRole = 'acquisition' | 'delivery';
export interface WeatherRuntimeStatus {
  readonly role: WeatherRole;
  readonly mode: 'inline' | 'worker';
  readonly workerGeneration: string | null;
  readonly lifecycle: 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed' | 'restarting';
  readonly reportedAt: UtcIso8601String | null;
  readonly receivedAt: UtcIso8601String | null;
  readonly reportFreshness: 'unknown' | 'fresh' | 'stale';
  readonly stopReason: 'requested' | 'unexpected_exit' | 'initialization_failed' | null;
  readonly restartAllowed: boolean;
  readonly pendingRequests: number;
  readonly exitConfirmed: boolean;
  /** 完了の応答が失われ、結果が分からない範囲。画面の「結果不明」はこれだけを数える。 */
  readonly unknownScopes?: readonly string[];
  /** いま処理中の更新の対象範囲。読み出しの公開ゲートでは unknownScopes と同様にブロックする。 */
  readonly pendingScopes?: readonly string[];
  /** 取得Workerが準備完了（prepared）を報告済みか。提供Workerでは省略される。 */
  readonly prepared?: boolean;
  readonly failureCode:
    | 'initial_accept_timeout'
    | 'handshake_timeout'
    | 'protocol_error'
    | 'payload_too_large'
    | 'report_stale'
    | 'unexpected_exit'
    | 'initialization_failed'
    | null;
}
/** 報告の受領からこの時間を超えると応答不明（stale）とする。 */
export const WEATHER_REPORT_STALE_AFTER_MS = 15_000;

/** 停止・異常の理由の画面・通知用の語。failureCode ?? stopReason で引く。 */
export const WEATHER_RUNTIME_REASON_LABELS = {
  requested: '停止要求',
  unexpected_exit: '予期しない終了',
  initialization_failed: '初期化失敗',
  initial_accept_timeout: '初回受付を確認できません',
  handshake_timeout: '更新応答の期限超過',
  protocol_error: '通信手順の異常',
  payload_too_large: '通信容量の上限超過',
  report_stale: '応答を確認できません',
} as const;
export type WeatherRuntimeReasonCode = keyof typeof WEATHER_RUNTIME_REASON_LABELS;

export interface WeatherRestartRequest {
  readonly requestId: string;
  readonly expectedWorkerGeneration: string;
}
export type WeatherRestartOperation =
  | {
      readonly status: 'in_progress';
      readonly requestId: string;
      readonly role: WeatherRole;
      readonly historyRecorded: boolean;
    }
  | {
      readonly status: 'completed';
      readonly requestId: string;
      readonly role: WeatherRole;
      readonly historyRecorded: boolean;
      readonly result: 'success' | 'failure' | 'unknown';
      readonly workerGeneration: string | null;
      readonly errorCode: string | null;
      /** 再開時点でメインが保持している取得運転の意図。 */
      readonly desiredRunning?: boolean;
    };

/** 報告時刻ではなく、メインの受領時刻で鮮度を判定する。 */
export function projectWeatherRuntimeStatus(
  input: Omit<WeatherRuntimeStatus, 'reportFreshness' | 'restartAllowed'>,
  now: UtcIso8601String,
): WeatherRuntimeStatus {
  const reportFreshness =
    input.receivedAt === null
      ? 'unknown'
      : Date.parse(now) - Date.parse(input.receivedAt) > WEATHER_REPORT_STALE_AFTER_MS
        ? 'stale'
        : 'fresh';
  return {
    ...input,
    reportFreshness,
    restartAllowed:
      input.lifecycle !== 'restarting' &&
      input.lifecycle !== 'stopping' &&
      (input.lifecycle === 'failed' ||
        input.lifecycle === 'stopped' ||
        reportFreshness === 'stale'),
  };
}
export function canRestartWeatherRuntime(
  status: WeatherRuntimeStatus,
  request: WeatherRestartRequest,
): boolean {
  return (
    /^[A-Za-z0-9_-]{1,128}$/.test(request.requestId) &&
    status.workerGeneration === request.expectedWorkerGeneration &&
    status.restartAllowed
  );
}

/** 保持DBへ記録済みの再開操作。メモリfallbackは一覧へ混入させない。 */
export interface WeatherWorkerOperationHistoryItem {
  readonly id: number;
  readonly operation: WeatherRestartOperation;
  readonly expectedWorkerGeneration: string;
  readonly serverGenerationId: string;
  readonly requestedAt: UtcIso8601String;
  readonly completedAt: UtcIso8601String | null;
}
export interface WeatherWorkerOperationHistoryResponse {
  readonly status: 'ready';
  readonly generatedAt: UtcIso8601String;
  readonly items: readonly WeatherWorkerOperationHistoryItem[];
  readonly nextBeforeId: number | null;
}
