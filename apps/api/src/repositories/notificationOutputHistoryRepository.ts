import type { DatabaseConnection } from '../database/index.js';
import { validateNonEmptyString, validateUtcIso8601String } from './snapshot.js';
import type {
  ListNotificationOutputHistoryOptions,
  NotificationDetectionContext,
  NotificationOutputHistory,
  NotificationOutputHistoryInput,
  NotificationOutputOrigin,
} from './types.js';

interface NotificationOutputHistoryRow {
  readonly id: number;
  readonly notification_id: string;
  readonly category: string;
  readonly source_type: string;
  readonly source_version: string | null;
  readonly target_area_json: string | null;
  readonly occurred_at: string;
  readonly detected_at: string;
  readonly change_type: string;
  readonly ack_required: number;
  readonly summary: string;
  readonly related_refs_json: string;
  readonly origin: string;
  readonly detection_context: string;
  readonly is_training: number;
  readonly message_definition_id: string | null;
  readonly message_definition_version: string | null;
}

function validateNotificationOutputOrigin(
  origin: string,
): asserts origin is NotificationOutputOrigin {
  if (origin !== 'weather' && origin !== 'system') {
    throw new Error(`Invalid notification origin: ${origin}`);
  }
}

function validateNotificationDetectionContext(
  context: string,
): asserts context is NotificationDetectionContext {
  if (context !== 'normal' && context !== 'initial') {
    throw new Error(`Invalid notification detectionContext: ${context}`);
  }
}

function validateJson(value: string, fieldName: string): void {
  try {
    JSON.parse(value);
  } catch (error) {
    throw new Error(
      `${fieldName} must be a valid JSON string: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function validateNotificationOutputHistoryInput(input: NotificationOutputHistoryInput): void {
  validateNonEmptyString(input.notificationId, 'notificationId');
  validateNonEmptyString(input.category, 'category');
  validateNonEmptyString(input.sourceType, 'sourceType');

  if (input.sourceVersion !== null) {
    validateNonEmptyString(input.sourceVersion, 'sourceVersion');
  }

  if (input.targetAreaJson !== null) {
    validateNonEmptyString(input.targetAreaJson, 'targetAreaJson');
    validateJson(input.targetAreaJson, 'targetAreaJson');
  }

  validateUtcIso8601String(input.occurredAt, 'occurredAt');
  validateUtcIso8601String(input.detectedAt, 'detectedAt');
  validateNonEmptyString(input.changeType, 'changeType');

  if (typeof input.ackRequired !== 'boolean') {
    throw new Error(`ackRequired must be a boolean: ${String(input.ackRequired)}`);
  }

  validateNonEmptyString(input.summary, 'summary');
  validateNonEmptyString(input.relatedRefsJson, 'relatedRefsJson');
  validateJson(input.relatedRefsJson, 'relatedRefsJson');

  validateNotificationOutputOrigin(input.origin);
  validateNotificationDetectionContext(input.detectionContext);

  if (typeof input.isTraining !== 'boolean') {
    throw new Error(`isTraining must be a boolean: ${String(input.isTraining)}`);
  }

  if (
    (input.messageDefinitionId === null && input.messageDefinitionVersion !== null) ||
    (input.messageDefinitionId !== null && input.messageDefinitionVersion === null)
  ) {
    throw new Error(
      'messageDefinitionId and messageDefinitionVersion must both be null or both non-null',
    );
  }

  if (input.messageDefinitionId !== null) {
    validateNonEmptyString(input.messageDefinitionId, 'messageDefinitionId');
  }
  if (input.messageDefinitionVersion !== null) {
    validateNonEmptyString(input.messageDefinitionVersion, 'messageDefinitionVersion');
  }
}

function mapNotificationOutputHistoryRow(
  row: NotificationOutputHistoryRow,
): NotificationOutputHistory {
  validateNotificationOutputOrigin(row.origin);
  validateNotificationDetectionContext(row.detection_context);

  if (row.ack_required !== 0 && row.ack_required !== 1) {
    throw new Error(`Invalid ack_required in DB: ${row.ack_required}`);
  }
  if (row.is_training !== 0 && row.is_training !== 1) {
    throw new Error(`Invalid is_training in DB: ${row.is_training}`);
  }

  validateUtcIso8601String(row.occurred_at, 'occurred_at');
  validateUtcIso8601String(row.detected_at, 'detected_at');

  if (row.target_area_json !== null) {
    validateJson(row.target_area_json, 'target_area_json');
  }
  validateJson(row.related_refs_json, 'related_refs_json');
  validateNonEmptyString(row.summary, 'summary');

  if (
    (row.message_definition_id === null && row.message_definition_version !== null) ||
    (row.message_definition_id !== null && row.message_definition_version === null)
  ) {
    throw new Error(
      'message_definition_id and message_definition_version must both be null or both non-null',
    );
  }

  return {
    id: row.id,
    notificationId: row.notification_id,
    category: row.category,
    sourceType: row.source_type,
    sourceVersion: row.source_version,
    targetAreaJson: row.target_area_json,
    occurredAt: row.occurred_at,
    detectedAt: row.detected_at,
    changeType: row.change_type,
    ackRequired: row.ack_required === 1,
    summary: row.summary,
    relatedRefsJson: row.related_refs_json,
    origin: row.origin,
    detectionContext: row.detection_context,
    isTraining: row.is_training === 1,
    messageDefinitionId: row.message_definition_id,
    messageDefinitionVersion: row.message_definition_version,
  };
}

function buildNotificationOutputHistoryFilter(options?: ListNotificationOutputHistoryOptions): {
  whereClause: string;
  params: unknown[];
} {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options) {
    if (options.category !== undefined) {
      validateNonEmptyString(options.category, 'category');
      conditions.push('category = ?');
      params.push(options.category);
    }
    if (options.sourceType !== undefined) {
      validateNonEmptyString(options.sourceType, 'sourceType');
      conditions.push('source_type = ?');
      params.push(options.sourceType);
    }
    if (options.changeType !== undefined) {
      validateNonEmptyString(options.changeType, 'changeType');
      conditions.push('change_type = ?');
      params.push(options.changeType);
    }
    if (options.origin !== undefined) {
      validateNotificationOutputOrigin(options.origin);
      conditions.push('origin = ?');
      params.push(options.origin);
    }
    if (options.detectionContext !== undefined) {
      validateNotificationDetectionContext(options.detectionContext);
      conditions.push('detection_context = ?');
      params.push(options.detectionContext);
    }
    if (options.isTraining !== undefined) {
      if (typeof options.isTraining !== 'boolean') {
        throw new Error(`isTraining must be a boolean: ${String(options.isTraining)}`);
      }
      conditions.push('is_training = ?');
      params.push(options.isTraining ? 1 : 0);
    }
    if (options.detectedAtFrom !== undefined) {
      validateUtcIso8601String(options.detectedAtFrom, 'detectedAtFrom');
      conditions.push('detected_at >= ?');
      params.push(options.detectedAtFrom);
    }
    if (options.detectedAtTo !== undefined) {
      validateUtcIso8601String(options.detectedAtTo, 'detectedAtTo');
      conditions.push('detected_at <= ?');
      params.push(options.detectedAtTo);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params };
}

export function recordNotificationOutputHistory(
  connection: DatabaseConnection,
  input: NotificationOutputHistoryInput,
): NotificationOutputHistory {
  validateNotificationOutputHistoryInput(input);

  const stmt = connection.prepare(`
    INSERT INTO notification_output_history (
      notification_id, category, source_type, source_version, target_area_json,
      occurred_at, detected_at, change_type, ack_required, summary,
      related_refs_json, origin, detection_context, is_training,
      message_definition_id, message_definition_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `);

  const result = stmt.get(
    input.notificationId,
    input.category,
    input.sourceType,
    input.sourceVersion,
    input.targetAreaJson,
    input.occurredAt,
    input.detectedAt,
    input.changeType,
    input.ackRequired ? 1 : 0,
    input.summary,
    input.relatedRefsJson,
    input.origin,
    input.detectionContext,
    input.isTraining ? 1 : 0,
    input.messageDefinitionId,
    input.messageDefinitionVersion,
  ) as { id: number };

  return {
    ...input,
    id: Number(result.id),
  };
}

export function findNotificationOutputHistoryById(
  connection: DatabaseConnection,
  id: number,
): NotificationOutputHistory | null {
  const row = connection
    .prepare('SELECT * FROM notification_output_history WHERE id = ?')
    .get(id) as NotificationOutputHistoryRow | undefined;

  if (!row) {
    return null;
  }

  return mapNotificationOutputHistoryRow(row);
}

export function findNotificationOutputHistoryByNotificationId(
  connection: DatabaseConnection,
  notificationId: string,
): NotificationOutputHistory | null {
  const row = connection
    .prepare('SELECT * FROM notification_output_history WHERE notification_id = ?')
    .get(notificationId) as NotificationOutputHistoryRow | undefined;

  if (!row) {
    return null;
  }

  return mapNotificationOutputHistoryRow(row);
}

export function listNotificationOutputHistory(
  connection: DatabaseConnection,
  options?: ListNotificationOutputHistoryOptions,
): readonly NotificationOutputHistory[] {
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

  const { whereClause, params } = buildNotificationOutputHistoryFilter(options);
  const sql = `
    SELECT * FROM notification_output_history
    ${whereClause}
    ORDER BY detected_at DESC, id DESC
    LIMIT ? OFFSET ?
  `;

  const rows = connection
    .prepare(sql)
    .all(...params, limit, offset) as NotificationOutputHistoryRow[];
  return rows.map(mapNotificationOutputHistoryRow);
}

export function countNotificationOutputHistory(
  connection: DatabaseConnection,
  options?: ListNotificationOutputHistoryOptions,
): number {
  const { whereClause, params } = buildNotificationOutputHistoryFilter(options);
  const sql = `SELECT COUNT(*) as count FROM notification_output_history ${whereClause}`;
  const result = connection.prepare(sql).get(...params) as { count: number };
  return Number(result.count);
}

export function deleteNotificationOutputHistory(
  connection: DatabaseConnection,
  id: number,
): boolean {
  const result = connection.prepare('DELETE FROM notification_output_history WHERE id = ?').run(id);
  return result.changes > 0;
}
