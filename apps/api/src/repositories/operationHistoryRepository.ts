import type { DatabaseConnection } from '../database/index.js';
import { validateNonEmptyString, validateUtcIso8601String } from './snapshot.js';
import type {
  ListOperationHistoryOptions,
  OperationHistory,
  OperationHistoryInput,
  OperationKind,
  OperationResult,
  OperationTargetKind,
} from './types.js';

interface OperationHistoryRow {
  readonly id: number;
  readonly request_id: string;
  readonly operation_kind: string;
  readonly target_kind: string;
  readonly result: string;
  readonly requested_at: string;
  readonly completed_at: string;
  readonly actor_id: string | null;
  readonly actor_display_name: string | null;
  readonly error_code: string | null;
  readonly error_message: string | null;
}

function validateOperationKind(kind: string): asserts kind is OperationKind {
  if (kind !== 'start' && kind !== 'stop' && kind !== 'force_refresh') {
    throw new Error(`Invalid operationKind: ${kind}`);
  }
}

function validateOperationTargetKind(target: string): asserts target is OperationTargetKind {
  if (target !== 'all') {
    throw new Error(`Invalid targetKind: ${target}`);
  }
}

function validateOperationResult(result: string): asserts result is OperationResult {
  if (result !== 'success' && result !== 'failure') {
    throw new Error(`Invalid operation result: ${result}`);
  }
}

function validateOperationHistoryInput(input: OperationHistoryInput): void {
  validateNonEmptyString(input.requestId, 'requestId');
  validateOperationKind(input.operationKind);
  validateOperationTargetKind(input.targetKind);
  validateOperationResult(input.result);
  validateUtcIso8601String(input.requestedAt, 'requestedAt');
  validateUtcIso8601String(input.completedAt, 'completedAt');

  const requestedTime = Date.parse(input.requestedAt);
  const completedTime = Date.parse(input.completedAt);
  if (requestedTime > completedTime) {
    throw new Error(
      `requestedAt must be less than or equal to completedAt: requestedAt=${input.requestedAt}, completedAt=${input.completedAt}`,
    );
  }

  if (input.actorId !== null || input.actorDisplayName !== null) {
    throw new Error('actorId and actorDisplayName must both be null before AuthGate integration');
  }

  if (input.errorCode !== null) {
    validateNonEmptyString(input.errorCode, 'errorCode');
  }

  if (input.errorMessage !== null && typeof input.errorMessage !== 'string') {
    throw new Error(`errorMessage must be a string or null: ${String(input.errorMessage)}`);
  }
}

function mapOperationHistoryRow(row: OperationHistoryRow): OperationHistory {
  validateNonEmptyString(row.request_id, 'request_id');
  validateOperationKind(row.operation_kind);
  validateOperationTargetKind(row.target_kind);
  validateOperationResult(row.result);
  validateUtcIso8601String(row.requested_at, 'requested_at');
  validateUtcIso8601String(row.completed_at, 'completed_at');

  if (row.actor_id !== null) {
    validateNonEmptyString(row.actor_id, 'actor_id');
  }
  if (row.actor_display_name !== null) {
    validateNonEmptyString(row.actor_display_name, 'actor_display_name');
  }
  if (row.error_code !== null) {
    validateNonEmptyString(row.error_code, 'error_code');
  }

  return {
    id: row.id,
    requestId: row.request_id,
    operationKind: row.operation_kind,
    targetKind: row.target_kind,
    result: row.result,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
    actorId: row.actor_id,
    actorDisplayName: row.actor_display_name,
    errorCode: row.error_code,
    errorMessage: row.error_message,
  };
}

function buildOperationHistoryFilter(options?: ListOperationHistoryOptions): {
  whereClause: string;
  params: unknown[];
} {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options) {
    if (options.operationKind !== undefined) {
      validateOperationKind(options.operationKind);
      conditions.push('operation_kind = ?');
      params.push(options.operationKind);
    }
    if (options.result !== undefined) {
      validateOperationResult(options.result);
      conditions.push('result = ?');
      params.push(options.result);
    }
    if (options.actorId !== undefined) {
      validateNonEmptyString(options.actorId, 'actorId');
      conditions.push('actor_id = ?');
      params.push(options.actorId);
    }
    if (options.requestedAtFrom !== undefined) {
      validateUtcIso8601String(options.requestedAtFrom, 'requestedAtFrom');
      conditions.push('requested_at >= ?');
      params.push(options.requestedAtFrom);
    }
    if (options.requestedAtTo !== undefined) {
      validateUtcIso8601String(options.requestedAtTo, 'requestedAtTo');
      conditions.push('requested_at <= ?');
      params.push(options.requestedAtTo);
    }
    if (options.completedAtFrom !== undefined) {
      validateUtcIso8601String(options.completedAtFrom, 'completedAtFrom');
      conditions.push('completed_at >= ?');
      params.push(options.completedAtFrom);
    }
    if (options.completedAtTo !== undefined) {
      validateUtcIso8601String(options.completedAtTo, 'completedAtTo');
      conditions.push('completed_at <= ?');
      params.push(options.completedAtTo);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params };
}

export function recordOperationHistory(
  connection: DatabaseConnection,
  input: OperationHistoryInput,
): OperationHistory {
  validateOperationHistoryInput(input);

  const stmt = connection.prepare(`
    INSERT INTO operation_history (
      request_id, operation_kind, target_kind, result,
      requested_at, completed_at, actor_id, actor_display_name,
      error_code, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `);

  const result = stmt.get(
    input.requestId,
    input.operationKind,
    input.targetKind,
    input.result,
    input.requestedAt,
    input.completedAt,
    null,
    null,
    input.errorCode,
    input.errorMessage,
  ) as { id: number };

  return {
    ...input,
    id: Number(result.id),
  };
}

export function findOperationHistoryById(
  connection: DatabaseConnection,
  id: number,
): OperationHistory | null {
  const row = connection.prepare('SELECT * FROM operation_history WHERE id = ?').get(id) as
    OperationHistoryRow | undefined;

  if (!row) {
    return null;
  }

  return mapOperationHistoryRow(row);
}

export function findOperationHistoryByRequestId(
  connection: DatabaseConnection,
  requestId: string,
): OperationHistory | null {
  validateNonEmptyString(requestId, 'requestId');

  const row = connection
    .prepare('SELECT * FROM operation_history WHERE request_id = ?')
    .get(requestId) as OperationHistoryRow | undefined;

  if (!row) {
    return null;
  }

  return mapOperationHistoryRow(row);
}

export function listOperationHistory(
  connection: DatabaseConnection,
  options?: ListOperationHistoryOptions,
): readonly OperationHistory[] {
  let limit = 100;
  let offset = 0;

  if (options) {
    if (options.limit !== undefined) {
      if (!Number.isInteger(options.limit) || options.limit <= 0) {
        throw new Error(`limit must be a positive integer: ${options.limit}`);
      }
      limit = Math.min(options.limit, 1000);
    }
    if (options.offset !== undefined) {
      if (!Number.isInteger(options.offset) || options.offset < 0) {
        throw new Error(`offset must be a non-negative integer: ${options.offset}`);
      }
      offset = options.offset;
    }
  }

  const { whereClause, params } = buildOperationHistoryFilter(options);
  const sql = `
    SELECT * FROM operation_history
    ${whereClause}
    ORDER BY completed_at DESC, id DESC
    LIMIT ? OFFSET ?
  `;

  const rows = connection.prepare(sql).all(...params, limit, offset) as OperationHistoryRow[];
  return rows.map(mapOperationHistoryRow);
}

export function countOperationHistory(
  connection: DatabaseConnection,
  options?: ListOperationHistoryOptions,
): number {
  const { whereClause, params } = buildOperationHistoryFilter(options);
  const sql = `SELECT COUNT(*) as count FROM operation_history ${whereClause}`;
  const result = connection.prepare(sql).get(...params) as { count: number };
  return Number(result.count);
}

export function deleteOperationHistory(connection: DatabaseConnection, id: number): boolean {
  const result = connection.prepare('DELETE FROM operation_history WHERE id = ?').run(id);
  return result.changes > 0;
}
