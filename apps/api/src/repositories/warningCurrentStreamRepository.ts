import type { DatabaseConnection } from '../database/index.js';
import {
  validateControlStatus,
  validateNonEmptyString,
  validateUtcIso8601String,
} from './snapshot.js';
import {
  WARNING_TELEGRAM_TYPES,
  type ControlStatus,
  type WarningCurrentStream,
  type WarningCurrentStreamInput,
  type WarningTelegramType,
} from './types.js';

interface WarningCurrentStreamRow {
  readonly id: number;
  readonly prefecture_code: string;
  readonly area_code: string;
  readonly control_status: string;
  readonly telegram_type: string;
  readonly reception_id: number;
  readonly report_datetime: string;
  readonly control_datetime: string;
  readonly received_at: string;
  readonly content_hash: string;
}

function validateWarningCurrentStreamInput(input: WarningCurrentStreamInput): void {
  validateNonEmptyString(input.prefectureCode, 'prefectureCode');
  validateNonEmptyString(input.areaCode, 'areaCode');
  validateControlStatus(input.controlStatus);
  if (!WARNING_TELEGRAM_TYPES.includes(input.telegramType)) {
    throw new Error(`Invalid telegramType: ${input.telegramType}`);
  }
  if (!Number.isInteger(input.receptionId)) {
    throw new Error(`receptionId must be an integer: ${input.receptionId}`);
  }
  validateUtcIso8601String(input.reportDateTime, 'reportDateTime');
  validateUtcIso8601String(input.controlDateTime, 'controlDateTime');
  validateUtcIso8601String(input.receivedAt, 'receivedAt');
  validateNonEmptyString(input.contentHash, 'contentHash');
}

function mapStreamRow(row: WarningCurrentStreamRow): WarningCurrentStream {
  return {
    id: row.id,
    prefectureCode: row.prefecture_code,
    areaCode: row.area_code,
    controlStatus: row.control_status as ControlStatus,
    telegramType: row.telegram_type as WarningTelegramType,
    receptionId: row.reception_id,
    reportDateTime: row.report_datetime,
    controlDateTime: row.control_datetime,
    receivedAt: row.received_at,
    contentHash: row.content_hash,
  };
}

export function upsertWarningCurrentStream(
  connection: DatabaseConnection,
  input: WarningCurrentStreamInput,
): WarningCurrentStream {
  validateWarningCurrentStreamInput(input);

  const row = connection
    .prepare(
      `
      INSERT INTO warning_current_stream (
        prefecture_code, area_code, control_status, telegram_type,
        reception_id, report_datetime, control_datetime, received_at, content_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (prefecture_code, area_code, control_status, telegram_type) DO UPDATE SET
        reception_id = excluded.reception_id,
        report_datetime = excluded.report_datetime,
        control_datetime = excluded.control_datetime,
        received_at = excluded.received_at,
        content_hash = excluded.content_hash
      RETURNING *
    `,
    )
    .get(
      input.prefectureCode,
      input.areaCode,
      input.controlStatus,
      input.telegramType,
      input.receptionId,
      input.reportDateTime,
      input.controlDateTime,
      input.receivedAt,
      input.contentHash,
    ) as WarningCurrentStreamRow;

  return mapStreamRow(row);
}

export function findWarningCurrentStream(
  connection: DatabaseConnection,
  prefectureCode: string,
  areaCode: string,
  controlStatus: ControlStatus,
  telegramType: WarningTelegramType,
): WarningCurrentStream | null {
  validateNonEmptyString(prefectureCode, 'prefectureCode');
  validateNonEmptyString(areaCode, 'areaCode');
  validateControlStatus(controlStatus);

  const row = connection
    .prepare(
      `
      SELECT * FROM warning_current_stream
      WHERE prefecture_code = ? AND area_code = ? AND control_status = ? AND telegram_type = ?
    `,
    )
    .get(prefectureCode, areaCode, controlStatus, telegramType) as
    WarningCurrentStreamRow | undefined;

  return row ? mapStreamRow(row) : null;
}

export function listWarningCurrentStreams(
  connection: DatabaseConnection,
  prefectureCode: string,
  areaCode: string,
  controlStatus: ControlStatus,
): readonly WarningCurrentStream[] {
  validateNonEmptyString(prefectureCode, 'prefectureCode');
  validateNonEmptyString(areaCode, 'areaCode');
  validateControlStatus(controlStatus);

  const rows = connection
    .prepare(
      `
      SELECT * FROM warning_current_stream
      WHERE prefecture_code = ? AND area_code = ? AND control_status = ?
      ORDER BY id ASC
    `,
    )
    .all(prefectureCode, areaCode, controlStatus) as WarningCurrentStreamRow[];

  return rows.map(mapStreamRow);
}

export function deleteWarningCurrentStreams(
  connection: DatabaseConnection,
  prefectureCode: string,
  areaCode: string,
  controlStatus: ControlStatus,
): number {
  validateNonEmptyString(prefectureCode, 'prefectureCode');
  validateNonEmptyString(areaCode, 'areaCode');
  validateControlStatus(controlStatus);

  const result = connection
    .prepare(
      `
      DELETE FROM warning_current_stream
      WHERE prefecture_code = ? AND area_code = ? AND control_status = ?
    `,
    )
    .run(prefectureCode, areaCode, controlStatus);

  return result.changes;
}
