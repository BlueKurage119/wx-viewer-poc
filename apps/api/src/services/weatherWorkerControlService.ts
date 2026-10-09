import type {
  WeatherRestartOperation,
  WeatherRestartRequest,
  WeatherRuntimeStatus,
  WeatherWorkerOperationHistoryItem,
  WeatherWorkerOperationHistoryResponse,
} from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';

const MEMORY_LIMIT = 200;
interface OperationRow {
  id: number;
  request_id: string;
  role: 'acquisition' | 'delivery';
  expected_worker_generation: string;
  new_worker_generation: string | null;
  server_generation_id: string;
  status: 'in_progress' | 'completed';
  result: 'success' | 'failure' | 'unknown' | null;
  requested_at: string;
  completed_at: string | null;
  error_code: string | null;
  desired_running: number | null;
}
interface MemoryEntry {
  readonly request: WeatherRestartRequest;
  readonly operation: WeatherRestartOperation;
}
interface ErrorBody {
  readonly status: 'error';
  readonly code: string;
}
export interface WeatherWorkerControlReply {
  readonly statusCode: number;
  readonly body: WeatherRestartOperation | ErrorBody;
}
export class WeatherWorkerRestartError extends Error {
  constructor(
    readonly result: 'failure' | 'unknown',
    readonly code: string,
  ) {
    super(code);
    this.name = 'WeatherWorkerRestartError';
  }
}
export interface WeatherWorkerControlDependencies {
  readonly connection: DatabaseConnection;
  readonly serverGenerationId: string;
  readonly now?: () => string;
  readonly getRuntimeStatus: () => WeatherRuntimeStatus;
  readonly restart: () => Promise<void>;
  readonly getDesiredRunning: () => boolean;
}
function error(statusCode: number, code: string): WeatherWorkerControlReply {
  return { statusCode, body: { status: 'error', code } };
}
function isRequest(body: unknown): body is WeatherRestartRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  const value = body as Record<string, unknown>;
  return (
    Object.keys(value).length === 2 &&
    typeof value.requestId === 'string' &&
    /^[A-Za-z0-9_-]{1,128}$/.test(value.requestId) &&
    typeof value.expectedWorkerGeneration === 'string' &&
    value.expectedWorkerGeneration.length > 0 &&
    value.expectedWorkerGeneration.length <= 128
  );
}
function toOperation(row: OperationRow): WeatherRestartOperation {
  if (row.status === 'in_progress')
    return {
      status: 'in_progress',
      requestId: row.request_id,
      role: row.role,
      historyRecorded: true,
    };
  return {
    status: 'completed',
    requestId: row.request_id,
    role: row.role,
    historyRecorded: true,
    result: row.result!,
    workerGeneration: row.new_worker_generation,
    errorCode: row.error_code,
    ...(row.desired_running === null ? {} : { desiredRunning: row.desired_running === 1 }),
  };
}
function reply(operation: WeatherRestartOperation): WeatherWorkerControlReply {
  return { statusCode: operation.status === 'in_progress' ? 202 : 200, body: operation };
}

/** メインだけが保持DBと再開直列レーンを所有する。起動時の不明操作は再実行しない。 */
export function createWeatherWorkerControlService(deps: WeatherWorkerControlDependencies) {
  const now = deps.now ?? (() => new Date().toISOString());
  const memory = new Map<string, MemoryEntry>();
  let active: Promise<void> | null = null;
  let accepting = true;
  let recovered = false;
  try {
    deps.connection
      .prepare(
        `UPDATE weather_worker_operation SET status = 'completed', result = 'unknown',
      completed_at = ?, error_code = 'server_restarted', error_message = '再開結果を確認できません'
      WHERE status = 'in_progress'`,
      )
      .run(now());
    recovered = true;
  } catch {
    // 前世代の操作が照合できないときは新しい再開を許可しない。
  }
  function find(requestId: string): MemoryEntry | null {
    const cached = memory.get(requestId);
    if (cached) return cached;
    const row = deps.connection
      .prepare('SELECT * FROM weather_worker_operation WHERE request_id = ?')
      .get(requestId) as OperationRow | undefined;
    return row
      ? {
          request: { requestId, expectedWorkerGeneration: row.expected_worker_generation },
          operation: toOperation(row),
        }
      : null;
  }
  function pruneRecorded() {
    for (const [id, entry] of memory) {
      if (memory.size < MEMORY_LIMIT) break;
      if (entry.operation.status === 'completed' && entry.operation.historyRecorded)
        memory.delete(id);
    }
  }
  async function execute(request: WeatherRestartRequest, recorded: boolean) {
    let result: 'success' | 'failure' | 'unknown' = 'success';
    let errorCode: string | null = null;
    try {
      await deps.restart();
    } catch (cause) {
      result = cause instanceof WeatherWorkerRestartError ? cause.result : 'failure';
      errorCode = cause instanceof WeatherWorkerRestartError ? cause.code : 'restart_failed';
    }
    const runtime = deps.getRuntimeStatus();
    // 受付成功を返す実装契約が崩れた場合も成功と偽らない。
    if (
      result === 'success' &&
      (runtime.workerGeneration === null ||
        runtime.workerGeneration === request.expectedWorkerGeneration)
    ) {
      result = 'unknown';
      errorCode = 'restart_generation_unconfirmed';
    }
    const desiredRunning = deps.getDesiredRunning();
    const operation: WeatherRestartOperation = {
      status: 'completed',
      requestId: request.requestId,
      role: 'acquisition',
      result,
      workerGeneration: runtime.workerGeneration,
      errorCode,
      historyRecorded: recorded,
      desiredRunning,
    };
    if (recorded) {
      try {
        const updated = deps.connection
          .prepare(
            `UPDATE weather_worker_operation SET status = 'completed', result = ?,
          new_worker_generation = ?, completed_at = ?, error_code = ?, error_message = ?, desired_running = ?
          WHERE request_id = ? AND status = 'in_progress'`,
          )
          .run(
            result,
            runtime.workerGeneration,
            now(),
            errorCode,
            result === 'success'
              ? null
              : result === 'unknown'
                ? '再開結果を確認できません'
                : '取得Workerを再開できませんでした',
            desiredRunning ? 1 : 0,
            request.requestId,
          );
        recorded = updated.changes === 1;
      } catch {
        recorded = false;
      }
    }
    memory.set(request.requestId, {
      request,
      operation: { ...operation, historyRecorded: recorded },
    });
  }
  return {
    request(body: unknown): WeatherWorkerControlReply {
      if (!isRequest(body)) return error(400, 'invalid_request');
      let existing: MemoryEntry | null;
      try {
        existing = find(body.requestId);
      } catch {
        return error(503, 'weather_worker_history_unavailable');
      }
      if (existing)
        return existing.request.expectedWorkerGeneration === body.expectedWorkerGeneration
          ? reply(existing.operation)
          : error(409, 'request_conflict');
      if (!accepting) return error(503, 'weather_worker_control_unavailable');
      if (!recovered) return error(503, 'weather_worker_history_unavailable');
      const runtime = deps.getRuntimeStatus();
      if (
        active !== null ||
        runtime.workerGeneration !== body.expectedWorkerGeneration ||
        !runtime.restartAllowed ||
        runtime.mode !== 'worker' ||
        runtime.role !== 'acquisition' ||
        runtime.lifecycle === 'restarting' ||
        runtime.lifecycle === 'stopping'
      )
        return error(409, 'restart_conflict');
      pruneRecorded();
      if (memory.size >= MEMORY_LIMIT) return error(503, 'weather_worker_history_capacity');
      let recorded = true;
      try {
        deps.connection
          .prepare(
            `INSERT INTO weather_worker_operation (request_id, role, expected_worker_generation,
          server_generation_id, status, requested_at) VALUES (?, 'acquisition', ?, ?, 'in_progress', ?)`,
          )
          .run(body.requestId, body.expectedWorkerGeneration, deps.serverGenerationId, now());
      } catch {
        // UNIQUE衝突と書込み失敗を区別し、既存操作を再実行しない。
        try {
          const conflict = find(body.requestId);
          if (conflict)
            return conflict.request.expectedWorkerGeneration === body.expectedWorkerGeneration
              ? reply(conflict.operation)
              : error(409, 'request_conflict');
        } catch {
          return error(503, 'weather_worker_history_unavailable');
        }
        recorded = false;
      }
      const operation: WeatherRestartOperation = {
        status: 'in_progress',
        requestId: body.requestId,
        role: 'acquisition',
        historyRecorded: recorded,
      };
      memory.set(body.requestId, { request: body, operation });
      // request内で同期予約し、別IDの再開が同時に入る隙間を作らない。
      active = Promise.resolve()
        .then(() => execute(body, recorded))
        .finally(() => {
          active = null;
        });
      return reply(operation);
    },
    get(requestId: string): WeatherWorkerControlReply {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) return error(400, 'invalid_request');
      try {
        const entry = find(requestId);
        return entry ? reply(entry.operation) : error(404, 'unknown_request');
      } catch {
        return error(503, 'weather_worker_history_unavailable');
      }
    },
    history(options: { readonly limit?: number; readonly beforeId?: number | null } = {}): {
      readonly statusCode: number;
      readonly body: WeatherWorkerOperationHistoryResponse | ErrorBody;
    } {
      const limit = options.limit ?? 20;
      const beforeId = options.beforeId ?? null;
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 200 ||
        (beforeId !== null && (!Number.isInteger(beforeId) || beforeId < 1))
      )
        return { statusCode: 400, body: { status: 'error', code: 'invalid_request' } };
      try {
        const rows = (
          beforeId === null
            ? deps.connection
                .prepare('SELECT * FROM weather_worker_operation ORDER BY id DESC LIMIT ?')
                .all(limit + 1)
            : deps.connection
                .prepare(
                  'SELECT * FROM weather_worker_operation WHERE id < ? ORDER BY id DESC LIMIT ?',
                )
                .all(beforeId, limit + 1)
        ) as OperationRow[];
        const items: WeatherWorkerOperationHistoryItem[] = rows.slice(0, limit).map((row) => ({
          id: row.id,
          operation: toOperation(row),
          expectedWorkerGeneration: row.expected_worker_generation,
          serverGenerationId: row.server_generation_id,
          requestedAt: row.requested_at,
          completedAt: row.completed_at,
        }));
        return {
          statusCode: 200,
          body: {
            status: 'ready',
            generatedAt: now(),
            items,
            nextBeforeId: rows.length > limit ? items.at(-1)!.id : null,
          },
        };
      } catch {
        return {
          statusCode: 503,
          body: { status: 'error', code: 'weather_worker_history_unavailable' },
        };
      }
    },
    stopAccepting() {
      accepting = false;
    },
    async waitForIdle() {
      await active;
    },
  };
}
export type WeatherWorkerControlService = ReturnType<typeof createWeatherWorkerControlService>;
