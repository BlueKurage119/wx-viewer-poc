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
  readonly unknownScopes?: readonly string[];
  readonly failureCode:
    'initial_accept_timeout' | 'handshake_timeout' | 'protocol_error' | 'payload_too_large' | null;
}
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
      : Date.parse(now) - Date.parse(input.receivedAt) > 15_000
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
