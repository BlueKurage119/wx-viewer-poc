import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import { validateNonEmptyString, validateUtcIso8601String } from './snapshot.js';
import type {
  FetchAttempt,
  FetchAttemptInput,
  FetchOutcome,
  FetchStreamHealthSummary,
  ListFetchAttemptsOptions,
} from './types.js';

interface FetchAttemptRow {
  readonly id: number;
  readonly source_kind: string;
  readonly target_ref: string | null;
  readonly request_url: string;
  readonly trigger_kind: string;
  readonly attempt_no: number;
  readonly started_at: string;
  readonly finished_at: string;
  readonly duration_ms: number;
  readonly outcome: string;
  readonly http_status: number | null;
  readonly response_bytes: number | null;
  readonly item_count: number | null;
  readonly failed_item_count: number | null;
  readonly content_hash: string | null;
  readonly error_kind: string | null;
  readonly error_message: string | null;
}

function validateFetchOutcome(outcome: string): asserts outcome is FetchOutcome {
  if (outcome !== 'success' && outcome !== 'failure') {
    throw new Error(`Invalid fetch outcome: ${outcome}`);
  }
}

function validateFetchAttemptInput(input: FetchAttemptInput): void {
  validateNonEmptyString(input.sourceKind, 'sourceKind');
  validateNonEmptyString(input.requestUrl, 'requestUrl');
  validateNonEmptyString(input.triggerKind, 'triggerKind');

  if (!Number.isInteger(input.attemptNo) || input.attemptNo < 1) {
    throw new Error(`attemptNo must be an integer >= 1: ${input.attemptNo}`);
  }

  validateUtcIso8601String(input.startedAt, 'startedAt');
  validateUtcIso8601String(input.finishedAt, 'finishedAt');

  if (!Number.isInteger(input.durationMs) || input.durationMs < 0) {
    throw new Error(`durationMs must be an integer >= 0: ${input.durationMs}`);
  }

  validateFetchOutcome(input.outcome);

  if (input.httpStatus !== null && !Number.isInteger(input.httpStatus)) {
    throw new Error(`httpStatus must be an integer or null: ${input.httpStatus}`);
  }

  if (
    input.responseBytes !== null &&
    (!Number.isInteger(input.responseBytes) || input.responseBytes < 0)
  ) {
    throw new Error(`responseBytes must be an integer >= 0 or null: ${input.responseBytes}`);
  }

  if (
    (input.itemCount === null && input.failedItemCount !== null) ||
    (input.itemCount !== null && input.failedItemCount === null)
  ) {
    throw new Error(
      `itemCount and failedItemCount must both be null or both non-null: itemCount=${input.itemCount}, failedItemCount=${input.failedItemCount}`,
    );
  }

  if (input.itemCount !== null && input.failedItemCount !== null) {
    if (!Number.isInteger(input.itemCount) || input.itemCount < 1) {
      throw new Error(`itemCount must be an integer >= 1: ${input.itemCount}`);
    }
    if (!Number.isInteger(input.failedItemCount) || input.failedItemCount < 0) {
      throw new Error(`failedItemCount must be an integer >= 0: ${input.failedItemCount}`);
    }
    if (input.failedItemCount > input.itemCount) {
      throw new Error(
        `failedItemCount (${input.failedItemCount}) cannot exceed itemCount (${input.itemCount})`,
      );
    }
  }

  if (input.errorKind !== null && input.errorKind.trim().length === 0) {
    throw new Error('errorKind must be a non-empty string or null');
  }
}

function mapFetchAttemptRow(row: FetchAttemptRow): FetchAttempt {
  validateFetchOutcome(row.outcome);
  return {
    id: row.id,
    sourceKind: row.source_kind,
    targetRef: row.target_ref,
    requestUrl: row.request_url,
    triggerKind: row.trigger_kind,
    attemptNo: row.attempt_no,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    outcome: row.outcome,
    httpStatus: row.http_status,
    responseBytes: row.response_bytes,
    itemCount: row.item_count,
    failedItemCount: row.failed_item_count,
    contentHash: row.content_hash,
    errorKind: row.error_kind,
    errorMessage: row.error_message,
  };
}

function buildFetchAttemptsFilter(options?: ListFetchAttemptsOptions): {
  whereClause: string;
  params: unknown[];
} {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options) {
    if (options.sourceKind !== undefined) {
      conditions.push('source_kind = ?');
      params.push(options.sourceKind);
    }
    if (options.outcome !== undefined) {
      validateFetchOutcome(options.outcome);
      conditions.push('outcome = ?');
      params.push(options.outcome);
    }
    if (options.startedAtFrom !== undefined) {
      validateUtcIso8601String(options.startedAtFrom, 'startedAtFrom');
      conditions.push('started_at >= ?');
      params.push(options.startedAtFrom);
    }
    if (options.startedAtTo !== undefined) {
      validateUtcIso8601String(options.startedAtTo, 'startedAtTo');
      conditions.push('started_at <= ?');
      params.push(options.startedAtTo);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params };
}

export function recordFetchAttempt(
  connection: DatabaseConnection,
  input: FetchAttemptInput,
): FetchAttempt {
  validateFetchAttemptInput(input);

  const stmt = connection.prepare(`
    INSERT INTO fetch_attempt (
      source_kind, target_ref, request_url, trigger_kind, attempt_no,
      started_at, finished_at, duration_ms, outcome, http_status,
      response_bytes, item_count, failed_item_count, content_hash,
      error_kind, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `);

  const result = stmt.get(
    input.sourceKind,
    input.targetRef,
    input.requestUrl,
    input.triggerKind,
    input.attemptNo,
    input.startedAt,
    input.finishedAt,
    input.durationMs,
    input.outcome,
    input.httpStatus,
    input.responseBytes,
    input.itemCount,
    input.failedItemCount,
    input.contentHash,
    input.errorKind,
    input.errorMessage,
  ) as { id: number };

  return {
    ...input,
    id: Number(result.id),
  };
}

export function findFetchAttemptById(
  connection: DatabaseConnection,
  id: number,
): FetchAttempt | null {
  const row = connection.prepare('SELECT * FROM fetch_attempt WHERE id = ?').get(id) as
    FetchAttemptRow | undefined;

  if (!row) {
    return null;
  }

  return mapFetchAttemptRow(row);
}

export function listFetchAttempts(
  connection: DatabaseConnection,
  options?: ListFetchAttemptsOptions,
): readonly FetchAttempt[] {
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

  const { whereClause, params } = buildFetchAttemptsFilter(options);
  const sql = `
    SELECT * FROM fetch_attempt
    ${whereClause}
    ORDER BY started_at DESC, id DESC
    LIMIT ? OFFSET ?
  `;

  const rows = connection.prepare(sql).all(...params, limit, offset) as FetchAttemptRow[];
  return rows.map(mapFetchAttemptRow);
}

export function countFetchAttempts(
  connection: DatabaseConnection,
  options?: ListFetchAttemptsOptions,
): number {
  const { whereClause, params } = buildFetchAttemptsFilter(options);
  const sql = `SELECT COUNT(*) as count FROM fetch_attempt ${whereClause}`;
  const result = connection.prepare(sql).get(...params) as { count: number };
  return Number(result.count);
}

export function deleteFetchAttempt(connection: DatabaseConnection, id: number): boolean {
  const result = connection.prepare('DELETE FROM fetch_attempt WHERE id = ?').run(id);
  return result.changes > 0;
}

export function summarizeFetchStreamHealth(
  connection: DatabaseConnection,
  sourceKind: string,
  maxScanAttempts: number,
): FetchStreamHealthSummary {
  validateNonEmptyString(sourceKind, 'sourceKind');
  if (!Number.isSafeInteger(maxScanAttempts) || maxScanAttempts <= 0) {
    throw new Error(`maxScanAttempts must be a positive integer: ${maxScanAttempts}`);
  }

  const sql = `
    SELECT id, started_at, outcome
    FROM fetch_attempt
    WHERE source_kind = ?
    ORDER BY started_at DESC, id DESC
    LIMIT ?
  `;

  interface WindowRow {
    readonly id: number;
    readonly started_at: string;
    readonly outcome: string;
  }

  const rows = connection.prepare(sql).all(sourceKind, maxScanAttempts) as WindowRow[];

  if (rows.length === 0) {
    return {
      sourceKind,
      lastAttemptAt: null,
      lastSuccessAt: null,
      consecutiveFailures: 0,
      consecutiveFailuresCapped: false,
    };
  }

  // ミリ秒の有無等で SQL の辞書順と実時刻順がずれる可能性があるため JS 側で Date.parse 降順ソート
  const sorted = [...rows].sort((a, b) => {
    const timeA = Date.parse(a.started_at);
    const timeB = Date.parse(b.started_at);
    if (timeA !== timeB) {
      return timeB - timeA;
    }
    return b.id - a.id;
  });

  const firstRow = sorted[0];
  if (!firstRow) {
    return {
      sourceKind,
      lastAttemptAt: null,
      lastSuccessAt: null,
      consecutiveFailures: 0,
      consecutiveFailuresCapped: false,
    };
  }
  const lastAttemptAt = firstRow.started_at as UtcIso8601String;

  let consecutiveFailures = 0;
  for (const row of sorted) {
    if (row.outcome === 'failure') {
      consecutiveFailures++;
    } else {
      break;
    }
  }

  const consecutiveFailuresCapped =
    sorted.length === maxScanAttempts && consecutiveFailures === maxScanAttempts;

  let lastSuccessAt: UtcIso8601String | null = null;
  const firstSuccess = sorted.find((r) => r.outcome === 'success');
  if (firstSuccess) {
    lastSuccessAt = firstSuccess.started_at as UtcIso8601String;
  } else {
    // 窓内に成功がない場合、窓外の過去の成功を取得
    const outsideSuccessSql = `
      SELECT started_at
      FROM fetch_attempt
      WHERE source_kind = ? AND outcome = 'success'
      ORDER BY started_at DESC, id DESC
      LIMIT 1
    `;
    const outsideRow = connection.prepare(outsideSuccessSql).get(sourceKind) as
      { started_at: string } | undefined;
    if (outsideRow) {
      lastSuccessAt = outsideRow.started_at as UtcIso8601String;
    }
  }

  return {
    sourceKind,
    lastAttemptAt,
    lastSuccessAt,
    consecutiveFailures,
    consecutiveFailuresCapped,
  };
}
