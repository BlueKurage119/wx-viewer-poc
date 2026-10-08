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
}
export interface WeatherRestartRequest {
  readonly requestId: string;
  readonly expectedWorkerGeneration: string;
}
export type WeatherRestartOperation =
  | { readonly status: 'in_progress'; readonly requestId: string; readonly role: WeatherRole }
  | {
      readonly status: 'completed';
      readonly requestId: string;
      readonly role: WeatherRole;
      readonly result: 'success' | 'failure' | 'unknown';
      readonly workerGeneration: string | null;
      readonly errorCode: string | null;
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
