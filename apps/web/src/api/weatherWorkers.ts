import type {
  WeatherRestartOperation,
  WeatherRestartRequest,
  WeatherWorkerOperationHistoryResponse,
  WeatherRole,
} from '@wx-viewer-poc/shared';

export type WeatherRestartReply =
  | { readonly kind: 'operation'; readonly operation: WeatherRestartOperation }
  | { readonly kind: 'conflict' | 'rejected' | 'unverifiable' };

export interface WeatherWorkerClient {
  restart(
    role: WeatherRole,
    request: WeatherRestartRequest,
    signal: AbortSignal,
  ): Promise<WeatherRestartReply>;
  find(
    role: WeatherRole,
    request: WeatherRestartRequest,
    signal: AbortSignal,
  ): Promise<WeatherRestartReply>;
  history(
    beforeId: number | null,
    signal: AbortSignal,
  ): Promise<WeatherWorkerOperationHistoryResponse>;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isoDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function operation(value: unknown): value is WeatherRestartOperation {
  return (
    record(value) &&
    typeof value.requestId === 'string' &&
    /^[A-Za-z0-9_-]{1,128}$/.test(value.requestId) &&
    (value.role === 'acquisition' || value.role === 'delivery') &&
    typeof value.historyRecorded === 'boolean' &&
    (value.status === 'in_progress' ||
      (value.status === 'completed' &&
        ['success', 'failure', 'unknown'].includes(String(value.result)) &&
        (value.workerGeneration === null || typeof value.workerGeneration === 'string') &&
        (value.errorCode === null || typeof value.errorCode === 'string') &&
        (value.desiredRunning === undefined || typeof value.desiredRunning === 'boolean')))
  );
}
export function parseWeatherRestartReply(
  status: number,
  body: unknown,
  requestId: string,
  role: WeatherRole = 'acquisition',
): WeatherRestartReply {
  if (
    (status === 200 || status === 202) &&
    operation(body) &&
    body.requestId === requestId &&
    body.role === role
  ) {
    return { kind: 'operation', operation: body };
  }
  if (status === 409) return { kind: 'conflict' };
  if (status === 400) return { kind: 'rejected' };
  return { kind: 'unverifiable' };
}
export function createWeatherWorkerClient(deps: {
  readonly fetch: typeof fetch;
}): WeatherWorkerClient {
  async function send(
    role: WeatherRole,
    request: WeatherRestartRequest,
    signal: AbortSignal,
    method: 'POST' | 'GET',
  ): Promise<WeatherRestartReply> {
    try {
      const response = await deps.fetch(
        method === 'POST'
          ? `/api/control/weather-workers/${role}/restart`
          : `/api/control/weather-workers/operations/${encodeURIComponent(request.requestId)}`,
        {
          method,
          signal,
          cache: 'no-store',
          ...(method === 'POST'
            ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }
            : {}),
        },
      );
      return parseWeatherRestartReply(
        response.status,
        await response.json(),
        request.requestId,
        role,
      );
    } catch {
      return { kind: 'unverifiable' };
    }
  }
  return {
    restart: (role, request, signal) => send(role, request, signal, 'POST'),
    find: (role, request, signal) => send(role, request, signal, 'GET'),
    async history(beforeId, signal) {
      const response = await deps.fetch(
        `/api/monitoring/weather-worker-operations?limit=20${beforeId === null ? '' : `&beforeId=${beforeId}`}`,
        { signal, cache: 'no-store' },
      );
      if (!response.ok) throw new Error('再開履歴を取得できません');
      const body: unknown = await response.json();
      if (
        !record(body) ||
        body.status !== 'ready' ||
        !isoDate(body.generatedAt) ||
        !(
          body.nextBeforeId === null ||
          (Number.isInteger(body.nextBeforeId) && Number(body.nextBeforeId) > 0)
        ) ||
        !Array.isArray(body.items) ||
        !body.items.every(
          (item: unknown) =>
            record(item) &&
            Number.isInteger(item.id) &&
            Number(item.id) > 0 &&
            operation(item.operation) &&
            item.operation.historyRecorded &&
            typeof item.expectedWorkerGeneration === 'string' &&
            typeof item.serverGenerationId === 'string' &&
            isoDate(item.requestedAt) &&
            (item.completedAt === null || isoDate(item.completedAt)),
        )
      ) {
        throw new Error('再開履歴の応答形式が不正です');
      }
      return body as unknown as WeatherWorkerOperationHistoryResponse;
    },
  };
}
