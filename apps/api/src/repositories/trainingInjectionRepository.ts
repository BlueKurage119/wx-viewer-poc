import type { DatabaseConnection } from '../database/index.js';
import { mapRetractedTrainingIds } from './trainingRetractionRepository.js';

export type TrainingInjectionStatus = 'in_progress' | 'completed' | 'failed';
export type TrainingInjectionRole = 'requested' | 'baseline';

export interface TrainingInjectionRecord {
  readonly trainingId: string;
  readonly terminalId: string;
  readonly requestedAt: string;
  readonly acceptedAt: string;
  readonly finishedAt: string | null;
  readonly telegramCount: number;
  readonly status: TrainingInjectionStatus;
  readonly errorCode: string | null;
}

export interface TrainingInjectionReceptionRecord {
  readonly trainingId: string;
  readonly sequence: number;
  readonly receptionId: number;
  readonly role: TrainingInjectionRole;
  readonly previewId: string | null;
  readonly telegramType: string;
}

interface TrainingInjectionRow {
  readonly training_id: string;
  readonly terminal_id: string;
  readonly requested_at: string;
  readonly accepted_at: string;
  readonly finished_at: string | null;
  readonly telegram_count: number;
  readonly status: string;
  readonly error_code: string | null;
}

interface TrainingInjectionReceptionRow {
  readonly training_id: string;
  readonly sequence: number;
  readonly reception_id: number;
  readonly role: string;
  readonly preview_id: string | null;
  readonly telegram_type: string;
}

function mapInjectionRow(row: TrainingInjectionRow): TrainingInjectionRecord {
  return {
    trainingId: row.training_id,
    terminalId: row.terminal_id,
    requestedAt: row.requested_at,
    acceptedAt: row.accepted_at,
    finishedAt: row.finished_at,
    telegramCount: row.telegram_count,
    status: row.status as TrainingInjectionStatus,
    errorCode: row.error_code,
  };
}

function mapReceptionRow(row: TrainingInjectionReceptionRow): TrainingInjectionReceptionRecord {
  return {
    trainingId: row.training_id,
    sequence: row.sequence,
    receptionId: row.reception_id,
    role: row.role as TrainingInjectionRole,
    previewId: row.preview_id,
    telegramType: row.telegram_type,
  };
}

export function insertTrainingInjection(
  connection: DatabaseConnection,
  record: {
    readonly trainingId: string;
    readonly terminalId: string;
    readonly requestedAt: string;
    readonly acceptedAt: string;
    readonly telegramCount: number;
    readonly status: TrainingInjectionStatus;
    readonly errorCode?: string | null;
  },
): TrainingInjectionRecord {
  const row = connection
    .prepare(
      `
      INSERT INTO training_injection (
        training_id, terminal_id, requested_at, accepted_at, finished_at,
        telegram_count, status, error_code
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
      RETURNING *
    `,
    )
    .get(
      record.trainingId,
      record.terminalId,
      record.requestedAt,
      record.acceptedAt,
      record.telegramCount,
      record.status,
      record.errorCode ?? null,
    ) as TrainingInjectionRow;

  return mapInjectionRow(row);
}

export function updateTrainingInjectionStatus(
  connection: DatabaseConnection,
  trainingId: string,
  update: {
    readonly status: TrainingInjectionStatus;
    readonly finishedAt: string;
    readonly errorCode?: string | null;
  },
): void {
  connection
    .prepare(
      `
      UPDATE training_injection
      SET status = ?, finished_at = ?, error_code = ?
      WHERE training_id = ?
    `,
    )
    .run(update.status, update.finishedAt, update.errorCode ?? null, trainingId);
}

export function findTrainingInjection(
  connection: DatabaseConnection,
  trainingId: string,
): TrainingInjectionRecord | null {
  const row = connection
    .prepare('SELECT * FROM training_injection WHERE training_id = ?')
    .get(trainingId) as TrainingInjectionRow | undefined;

  return row ? mapInjectionRow(row) : null;
}

export function insertTrainingInjectionReception(
  connection: DatabaseConnection,
  record: {
    readonly trainingId: string;
    readonly sequence: number;
    readonly receptionId: number;
    readonly role: TrainingInjectionRole;
    readonly previewId: string | null;
    readonly telegramType: string;
  },
): TrainingInjectionReceptionRecord {
  const row = connection
    .prepare(
      `
      INSERT INTO training_injection_reception (
        training_id, sequence, reception_id, role, preview_id, telegram_type
      ) VALUES (?, ?, ?, ?, ?, ?)
      RETURNING *
    `,
    )
    .get(
      record.trainingId,
      record.sequence,
      record.receptionId,
      record.role,
      record.previewId,
      record.telegramType,
    ) as TrainingInjectionReceptionRow;

  return mapReceptionRow(row);
}

export function listTrainingInjectionReceptions(
  connection: DatabaseConnection,
  trainingId: string,
): readonly TrainingInjectionReceptionRecord[] {
  const rows = connection
    .prepare(
      'SELECT * FROM training_injection_reception WHERE training_id = ? ORDER BY sequence ASC',
    )
    .all(trainingId) as TrainingInjectionReceptionRow[];

  return rows.map(mapReceptionRow);
}

export interface TrainingInjectionListTelegramRecord {
  readonly sequence: number;
  readonly telegramType: string;
  readonly title: string | null;
  readonly previewId: string;
}

export interface TrainingInjectionListRecord {
  readonly trainingId: string;
  readonly terminalId: string;
  readonly acceptedAt: string;
  /** 抹消（completed）の受付時刻のうち最も早いもの。未抹消は null。 */
  readonly retractedAt: string | null;
  readonly telegrams: readonly TrainingInjectionListTelegramRecord[];
}

/**
 * 指定端末が投入し status='completed' の注入記録を、新しい順（accepted_at 降順、同時刻は training_id 昇順）で返す。
 * telegrams は role='requested' のみ、sequence 昇順。基準電文は含めない。
 */
export function listCompletedTrainingInjections(
  connection: DatabaseConnection,
  terminalIds: readonly string[],
  limit: number,
): readonly TrainingInjectionListRecord[] {
  if (terminalIds.length === 0) return [];
  const placeholders = terminalIds.map(() => '?').join(', ');
  const injections = connection
    .prepare(
      `
      SELECT training_id, terminal_id, accepted_at
      FROM training_injection
      WHERE status = 'completed' AND terminal_id IN (${placeholders})
      ORDER BY accepted_at DESC, training_id ASC
      LIMIT ?
    `,
    )
    .all(...terminalIds, limit) as {
    training_id: string;
    terminal_id: string;
    accepted_at: string;
  }[];

  const telegramStatement = connection.prepare(
    `
    SELECT r.sequence AS sequence, r.telegram_type AS telegram_type, r.preview_id AS preview_id,
           t.title AS title
    FROM training_injection_reception r
    JOIN telegram_reception t ON t.id = r.reception_id
    WHERE r.training_id = ? AND r.role = 'requested'
    ORDER BY r.sequence ASC
  `,
  );
  const retractedAtByTraining = mapRetractedTrainingIds(
    connection,
    injections.map((injection) => injection.training_id),
  );
  return injections.map((injection) => ({
    trainingId: injection.training_id,
    terminalId: injection.terminal_id,
    acceptedAt: injection.accepted_at,
    retractedAt: retractedAtByTraining.get(injection.training_id) ?? null,
    telegrams: (
      telegramStatement.all(injection.training_id) as {
        sequence: number;
        telegram_type: string;
        preview_id: string;
        title: string | null;
      }[]
    ).map((row) => ({
      sequence: row.sequence,
      telegramType: row.telegram_type,
      title: row.title,
      previewId: row.preview_id,
    })),
  }));
}

export function listAllTrainingInjections(
  connection: DatabaseConnection,
): readonly TrainingInjectionRecord[] {
  return (
    connection
      .prepare('SELECT * FROM training_injection ORDER BY accepted_at ASC, training_id ASC')
      .all() as TrainingInjectionRow[]
  ).map(mapInjectionRow);
}

export function findTrainingInjectionReceptionByReceptionId(
  connection: DatabaseConnection,
  receptionId: number,
): TrainingInjectionReceptionRecord | null {
  const row = connection
    .prepare('SELECT * FROM training_injection_reception WHERE reception_id = ?')
    .get(receptionId) as TrainingInjectionReceptionRow | undefined;
  return row ? mapReceptionRow(row) : null;
}
