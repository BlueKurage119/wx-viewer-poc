import type { DatabaseConnection } from '../database/index.js';

export type TrainingRetractionStatus = 'in_progress' | 'completed' | 'failed';
export type TrainingRetractionOutcome =
  'cancelled' | 'superseded' | 'already_cancelled' | 'baseline_not_owned';

export interface TrainingRetractionRecord {
  readonly retractionId: string;
  readonly scope: 'training' | 'all';
  readonly terminalId: string;
  readonly requestedAt: string;
  readonly acceptedAt: string;
  readonly finishedAt: string | null;
  readonly status: TrainingRetractionStatus;
  readonly errorCode: string | null;
}

export interface TrainingRetractionItemRecord {
  readonly retractionId: string;
  readonly itemNo: number;
  readonly targetReceptionId: number;
  readonly telegramType: string;
  readonly outcome: TrainingRetractionOutcome;
  readonly cancelReceptionId: number | null;
}

interface RetractionRow {
  readonly retraction_id: string;
  readonly scope: string;
  readonly terminal_id: string;
  readonly requested_at: string;
  readonly accepted_at: string;
  readonly finished_at: string | null;
  readonly status: string;
  readonly error_code: string | null;
}

interface ItemRow {
  readonly retraction_id: string;
  readonly item_no: number;
  readonly target_reception_id: number;
  readonly telegram_type: string;
  readonly outcome: string;
  readonly cancel_reception_id: number | null;
}

function mapRetraction(row: RetractionRow): TrainingRetractionRecord {
  return {
    retractionId: row.retraction_id,
    scope: row.scope as 'training' | 'all',
    terminalId: row.terminal_id,
    requestedAt: row.requested_at,
    acceptedAt: row.accepted_at,
    finishedAt: row.finished_at,
    status: row.status as TrainingRetractionStatus,
    errorCode: row.error_code,
  };
}

function mapItem(row: ItemRow): TrainingRetractionItemRecord {
  return {
    retractionId: row.retraction_id,
    itemNo: row.item_no,
    targetReceptionId: row.target_reception_id,
    telegramType: row.telegram_type,
    outcome: row.outcome as TrainingRetractionOutcome,
    cancelReceptionId: row.cancel_reception_id,
  };
}

export function insertTrainingRetraction(
  connection: DatabaseConnection,
  record: {
    readonly retractionId: string;
    readonly scope: 'training' | 'all';
    readonly terminalId: string;
    readonly requestedAt: string;
    readonly acceptedAt: string;
  },
): TrainingRetractionRecord {
  const row = connection
    .prepare(
      `
      INSERT INTO training_retraction (
        retraction_id, scope, terminal_id, requested_at, accepted_at, finished_at, status, error_code
      ) VALUES (?, ?, ?, ?, ?, NULL, 'in_progress', NULL)
      RETURNING *
    `,
    )
    .get(
      record.retractionId,
      record.scope,
      record.terminalId,
      record.requestedAt,
      record.acceptedAt,
    ) as RetractionRow;
  return mapRetraction(row);
}

export function updateTrainingRetractionStatus(
  connection: DatabaseConnection,
  retractionId: string,
  update: {
    readonly status: TrainingRetractionStatus;
    readonly finishedAt: string;
    readonly errorCode?: string | null;
  },
): void {
  connection
    .prepare(
      `
      UPDATE training_retraction
      SET status = ?, finished_at = ?, error_code = ?
      WHERE retraction_id = ?
    `,
    )
    .run(update.status, update.finishedAt, update.errorCode ?? null, retractionId);
}

export function findTrainingRetraction(
  connection: DatabaseConnection,
  retractionId: string,
): TrainingRetractionRecord | null {
  const row = connection
    .prepare('SELECT * FROM training_retraction WHERE retraction_id = ?')
    .get(retractionId) as RetractionRow | undefined;
  return row ? mapRetraction(row) : null;
}

export function insertTrainingRetractionTarget(
  connection: DatabaseConnection,
  retractionId: string,
  trainingId: string,
): void {
  connection
    .prepare('INSERT INTO training_retraction_target (retraction_id, training_id) VALUES (?, ?)')
    .run(retractionId, trainingId);
}

export function listTrainingRetractionTargets(
  connection: DatabaseConnection,
  retractionId: string,
): readonly string[] {
  return (
    connection
      .prepare(
        'SELECT training_id FROM training_retraction_target WHERE retraction_id = ? ORDER BY training_id ASC',
      )
      .all(retractionId) as { training_id: string }[]
  ).map((r) => r.training_id);
}

export function insertTrainingRetractionItem(
  connection: DatabaseConnection,
  record: {
    readonly retractionId: string;
    readonly itemNo: number;
    readonly targetReceptionId: number;
    readonly telegramType: string;
    readonly outcome: TrainingRetractionOutcome;
    readonly cancelReceptionId: number | null;
  },
): TrainingRetractionItemRecord {
  const row = connection
    .prepare(
      `
      INSERT INTO training_retraction_item (
        retraction_id, item_no, target_reception_id, telegram_type, outcome, cancel_reception_id
      ) VALUES (?, ?, ?, ?, ?, ?)
      RETURNING *
    `,
    )
    .get(
      record.retractionId,
      record.itemNo,
      record.targetReceptionId,
      record.telegramType,
      record.outcome,
      record.cancelReceptionId,
    ) as ItemRow;
  return mapItem(row);
}

export function listTrainingRetractionItems(
  connection: DatabaseConnection,
  retractionId: string,
): readonly TrainingRetractionItemRecord[] {
  return (
    connection
      .prepare(
        'SELECT * FROM training_retraction_item WHERE retraction_id = ? ORDER BY item_no ASC',
      )
      .all(retractionId) as ItemRow[]
  ).map(mapItem);
}

/** 完了した抹消の対象になった訓練ID → その最も早い抹消の受付時刻。 */
export function mapRetractedTrainingIds(
  connection: DatabaseConnection,
  trainingIds?: readonly string[],
): Map<string, string> {
  const rows = connection
    .prepare(
      `
      SELECT t.training_id AS training_id, MIN(r.accepted_at) AS retracted_at
      FROM training_retraction_target t
      JOIN training_retraction r ON r.retraction_id = t.retraction_id
      WHERE r.status = 'completed'
      GROUP BY t.training_id
    `,
    )
    .all() as { training_id: string; retracted_at: string }[];
  const filter = trainingIds ? new Set(trainingIds) : null;
  const result = new Map<string, string>();
  for (const row of rows) {
    if (filter === null || filter.has(row.training_id))
      result.set(row.training_id, row.retracted_at);
  }
  return result;
}
