import { VENUE_IDS, isVenueId, type VenueId } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import {
  validateControlStatus,
  validateNonEmptyString,
  validateUtcIso8601String,
  validateUtcIso8601StringOrNull,
} from './snapshot.js';
import type {
  ControlStatus,
  ListTelegramReceptionsOptions,
  TelegramReception,
  TelegramReceptionAdoption,
  TelegramReceptionAdoptionInput,
  TelegramReceptionArea,
  TelegramReceptionInput,
  TelegramReceptionSummary,
  PendingWarningTelegramPage,
  WarningTelegramRebuildPage,
} from './types.js';

interface TelegramReceptionRow {
  readonly id: number;
  readonly fetch_attempt_id: number | null;
  readonly feed_kind: string | null;
  readonly feed_entry_id: string | null;
  readonly document_url: string;
  readonly telegram_type: string | null;
  readonly title: string | null;
  readonly control_status: string | null;
  readonly info_type: string | null;
  readonly event_id: string | null;
  readonly serial: string | null;
  readonly control_datetime: string | null;
  readonly report_datetime: string | null;
  readonly target_datetime: string | null;
  readonly received_at: string;
  readonly raw_body?: string | null;
  readonly has_raw_body?: number;
  readonly body_bytes: number | null;
  readonly content_hash: string | null;
}

interface TelegramReceptionAreaRow {
  readonly id: number;
  readonly reception_id: number;
  readonly area_code: string;
  readonly area_name: string | null;
  readonly code_type: string | null;
  readonly sequence: number;
}

interface TelegramReceptionAdoptionRow {
  readonly reception_id: number;
  readonly venue_id: string;
  readonly adoption_result: string | null;
  readonly adoption_reason: string | null;
  readonly adoption_decided_at: string | null;
}

function validateTelegramReceptionAdoptionInput(input: TelegramReceptionAdoptionInput): void {
  if (!isVenueId(input.venueId)) {
    throw new Error(`venueId must be a known VenueId: ${String(input.venueId)}`);
  }
  validateUtcIso8601StringOrNull(input.adoptionDecidedAt, 'adoptionDecidedAt');
  if (input.adoptionResult !== null && input.adoptionResult.trim().length === 0) {
    throw new Error('adoptionResult must be a non-empty string or null');
  }
}

function validateTelegramReceptionInput(input: TelegramReceptionInput): void {
  validateNonEmptyString(input.documentUrl, 'documentUrl');
  validateUtcIso8601String(input.receivedAt, 'receivedAt');

  if (input.fetchAttemptId !== null && !Number.isInteger(input.fetchAttemptId)) {
    throw new Error(`fetchAttemptId must be an integer or null: ${input.fetchAttemptId}`);
  }

  if (input.feedKind !== null && input.feedKind.trim().length === 0) {
    throw new Error('feedKind must be a non-empty string or null');
  }

  if (input.feedEntryId !== null && input.feedEntryId.trim().length === 0) {
    throw new Error('feedEntryId must be a non-empty string or null');
  }

  if (input.telegramType !== null && input.telegramType.trim().length === 0) {
    throw new Error('telegramType must be a non-empty string or null');
  }

  if (input.controlStatus !== null) {
    validateControlStatus(input.controlStatus);
  }

  validateUtcIso8601StringOrNull(input.controlDateTime, 'controlDateTime');
  validateUtcIso8601StringOrNull(input.reportDateTime, 'reportDateTime');
  validateUtcIso8601StringOrNull(input.targetDateTime, 'targetDateTime');

  if (input.bodyBytes !== null && (!Number.isInteger(input.bodyBytes) || input.bodyBytes < 0)) {
    throw new Error(`bodyBytes must be an integer >= 0 or null: ${input.bodyBytes}`);
  }

  for (const area of input.areas) {
    validateNonEmptyString(area.areaCode, 'area.areaCode');
    if (!Number.isInteger(area.sequence)) {
      throw new Error(`area.sequence must be an integer: ${area.sequence}`);
    }
  }

  for (const adoption of input.adoptions) {
    validateTelegramReceptionAdoptionInput(adoption);
  }
}

function mapAreaRow(row: TelegramReceptionAreaRow): TelegramReceptionArea {
  return {
    id: row.id,
    areaCode: row.area_code,
    areaName: row.area_name,
    codeType: row.code_type,
    sequence: row.sequence,
  };
}

function mapAdoptionRow(row: TelegramReceptionAdoptionRow): TelegramReceptionAdoption {
  if (!isVenueId(row.venue_id)) {
    throw new Error(`telegram_reception_adoption.venue_id が未知の値です: ${row.venue_id}`);
  }
  return {
    receptionId: row.reception_id,
    venueId: row.venue_id,
    adoptionResult: row.adoption_result,
    adoptionReason: row.adoption_reason,
    adoptionDecidedAt: row.adoption_decided_at,
  };
}

function buildTelegramReceptionsFilter(options?: ListTelegramReceptionsOptions): {
  whereClause: string;
  params: unknown[];
} {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options) {
    if (options.controlStatus !== undefined) {
      validateControlStatus(options.controlStatus);
      conditions.push('t.control_status = ?');
      params.push(options.controlStatus);
    }
    if (options.telegramType !== undefined) {
      conditions.push('t.telegram_type = ?');
      params.push(options.telegramType);
    }
    if (options.infoType !== undefined) {
      conditions.push('t.info_type = ?');
      params.push(options.infoType);
    }
    if (options.areaCode !== undefined) {
      conditions.push(
        'EXISTS (SELECT 1 FROM telegram_reception_area a WHERE a.reception_id = t.id AND a.area_code = ?)',
      );
      params.push(options.areaCode);
    }
    if (options.documentUrl !== undefined) {
      conditions.push('t.document_url = ?');
      params.push(options.documentUrl);
    }
    if (options.adoptionVenueId !== undefined && options.adoptionResult !== undefined) {
      conditions.push(
        'EXISTS (SELECT 1 FROM telegram_reception_adoption a WHERE a.reception_id = t.id AND a.venue_id = ? AND a.adoption_result = ?)',
      );
      params.push(options.adoptionVenueId, options.adoptionResult);
    } else if (options.adoptionVenueId !== undefined) {
      conditions.push(
        'EXISTS (SELECT 1 FROM telegram_reception_adoption a WHERE a.reception_id = t.id AND a.venue_id = ?)',
      );
      params.push(options.adoptionVenueId);
    } else if (options.adoptionResult !== undefined) {
      conditions.push(
        'EXISTS (SELECT 1 FROM telegram_reception_adoption a WHERE a.reception_id = t.id AND a.adoption_result = ?)',
      );
      params.push(options.adoptionResult);
    }
    if (options.receivedAtFrom !== undefined) {
      validateUtcIso8601String(options.receivedAtFrom, 'receivedAtFrom');
      conditions.push('t.received_at >= ?');
      params.push(options.receivedAtFrom);
    }
    if (options.receivedAtTo !== undefined) {
      validateUtcIso8601String(options.receivedAtTo, 'receivedAtTo');
      conditions.push('t.received_at <= ?');
      params.push(options.receivedAtTo);
    }
    if (options.reportDateTimeFrom !== undefined) {
      validateUtcIso8601String(options.reportDateTimeFrom, 'reportDateTimeFrom');
      conditions.push('t.report_datetime >= ?');
      params.push(options.reportDateTimeFrom);
    }
    if (options.reportDateTimeTo !== undefined) {
      validateUtcIso8601String(options.reportDateTimeTo, 'reportDateTimeTo');
      conditions.push('t.report_datetime <= ?');
      params.push(options.reportDateTimeTo);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params };
}

function fetchAdoptions(
  connection: DatabaseConnection,
  receptionId: number,
): readonly TelegramReceptionAdoption[] {
  const rows = connection
    .prepare(
      'SELECT * FROM telegram_reception_adoption WHERE reception_id = ? ORDER BY venue_id ASC',
    )
    .all(receptionId) as TelegramReceptionAdoptionRow[];
  return rows.map(mapAdoptionRow);
}

export function recordTelegramReception(
  connection: DatabaseConnection,
  input: TelegramReceptionInput,
): TelegramReception {
  validateTelegramReceptionInput(input);

  const saveTx = connection.transaction(() => {
    const insertStmt = connection.prepare(`
      INSERT INTO telegram_reception (
        fetch_attempt_id, feed_kind, feed_entry_id, document_url,
        telegram_type, title, control_status, info_type, event_id,
        serial, control_datetime, report_datetime, target_datetime,
        received_at, raw_body, body_bytes, content_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `);

    const row = insertStmt.get(
      input.fetchAttemptId,
      input.feedKind,
      input.feedEntryId,
      input.documentUrl,
      input.telegramType,
      input.title,
      input.controlStatus,
      input.infoType,
      input.eventId,
      input.serial,
      input.controlDateTime,
      input.reportDateTime,
      input.targetDateTime,
      input.receivedAt,
      input.rawBody,
      input.bodyBytes,
      input.contentHash,
    ) as { id: number };

    const receptionId = Number(row.id);

    const insertAreaStmt = connection.prepare(`
      INSERT INTO telegram_reception_area (
        reception_id, area_code, area_name, code_type, sequence
      ) VALUES (?, ?, ?, ?, ?)
      RETURNING id
    `);

    // sequence 順に挿入
    const sortedAreas = [...input.areas].sort((a, b) => a.sequence - b.sequence);
    const areas: TelegramReceptionArea[] = sortedAreas.map((area) => {
      const aRow = insertAreaStmt.get(
        receptionId,
        area.areaCode,
        area.areaName,
        area.codeType,
        area.sequence,
      ) as { id: number };

      return {
        id: Number(aRow.id),
        ...area,
      };
    });

    const insertAdoptionStmt = connection.prepare(`
      INSERT INTO telegram_reception_adoption (
        reception_id, venue_id, adoption_result, adoption_reason, adoption_decided_at
      ) VALUES (?, ?, ?, ?, ?)
    `);

    for (const adoption of input.adoptions) {
      insertAdoptionStmt.run(
        receptionId,
        adoption.venueId,
        adoption.adoptionResult,
        adoption.adoptionReason,
        adoption.adoptionDecidedAt,
      );
    }

    const adoptions = fetchAdoptions(connection, receptionId);

    return {
      id: receptionId,
      fetchAttemptId: input.fetchAttemptId,
      feedKind: input.feedKind,
      feedEntryId: input.feedEntryId,
      documentUrl: input.documentUrl,
      telegramType: input.telegramType,
      title: input.title,
      controlStatus: input.controlStatus,
      infoType: input.infoType,
      eventId: input.eventId,
      serial: input.serial,
      controlDateTime: input.controlDateTime,
      reportDateTime: input.reportDateTime,
      targetDateTime: input.targetDateTime,
      receivedAt: input.receivedAt,
      rawBody: input.rawBody,
      hasRawBody: input.rawBody !== null,
      bodyBytes: input.bodyBytes,
      contentHash: input.contentHash,
      areas,
      adoptions,
    };
  });

  return saveTx();
}

export function findTelegramReceptionById(
  connection: DatabaseConnection,
  id: number,
): TelegramReception | null {
  const row = connection.prepare('SELECT * FROM telegram_reception WHERE id = ?').get(id) as
    TelegramReceptionRow | undefined;

  if (!row) {
    return null;
  }

  const areaRows = connection
    .prepare(
      'SELECT * FROM telegram_reception_area WHERE reception_id = ? ORDER BY sequence ASC, id ASC',
    )
    .all(row.id) as TelegramReceptionAreaRow[];

  const areas = areaRows.map(mapAreaRow);
  const adoptions = fetchAdoptions(connection, row.id);

  return {
    id: row.id,
    fetchAttemptId: row.fetch_attempt_id,
    feedKind: row.feed_kind,
    feedEntryId: row.feed_entry_id,
    documentUrl: row.document_url,
    telegramType: row.telegram_type,
    title: row.title,
    controlStatus: row.control_status as ControlStatus | null,
    infoType: row.info_type,
    eventId: row.event_id,
    serial: row.serial,
    controlDateTime: row.control_datetime,
    reportDateTime: row.report_datetime,
    targetDateTime: row.target_datetime,
    receivedAt: row.received_at,
    rawBody: row.raw_body ?? null,
    hasRawBody: row.raw_body !== null,
    bodyBytes: row.body_bytes,
    contentHash: row.content_hash,
    areas,
    adoptions,
  };
}

export function listTelegramReceptions(
  connection: DatabaseConnection,
  options?: ListTelegramReceptionsOptions,
): readonly TelegramReceptionSummary[] {
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

  const { whereClause, params } = buildTelegramReceptionsFilter(options);
  const sql = `
    SELECT
      t.id, t.fetch_attempt_id, t.feed_kind, t.feed_entry_id, t.document_url,
      t.telegram_type, t.title, t.control_status, t.info_type, t.event_id,
      t.serial, t.control_datetime, t.report_datetime, t.target_datetime,
      t.received_at,
      (t.raw_body IS NOT NULL) AS has_raw_body,
      t.body_bytes, t.content_hash
    FROM telegram_reception t
    ${whereClause}
    ORDER BY t.received_at DESC, t.id DESC
    LIMIT ? OFFSET ?
  `;

  const rows = connection.prepare(sql).all(...params, limit, offset) as TelegramReceptionRow[];

  const areaStmt = connection.prepare(
    'SELECT * FROM telegram_reception_area WHERE reception_id = ? ORDER BY sequence ASC, id ASC',
  );

  return rows.map((row) => {
    const areaRows = areaStmt.all(row.id) as TelegramReceptionAreaRow[];
    const areas = areaRows.map(mapAreaRow);
    const adoptions = fetchAdoptions(connection, row.id);

    return {
      id: row.id,
      fetchAttemptId: row.fetch_attempt_id,
      feedKind: row.feed_kind,
      feedEntryId: row.feed_entry_id,
      documentUrl: row.document_url,
      telegramType: row.telegram_type,
      title: row.title,
      controlStatus: row.control_status as ControlStatus | null,
      infoType: row.info_type,
      eventId: row.event_id,
      serial: row.serial,
      controlDateTime: row.control_datetime,
      reportDateTime: row.report_datetime,
      targetDateTime: row.target_datetime,
      receivedAt: row.received_at,
      hasRawBody: row.has_raw_body === 1,
      bodyBytes: row.body_bytes,
      contentHash: row.content_hash,
      areas,
      adoptions,
    };
  });
}

export function countTelegramReceptions(
  connection: DatabaseConnection,
  options?: ListTelegramReceptionsOptions,
): number {
  const { whereClause, params } = buildTelegramReceptionsFilter(options);
  const sql = `SELECT COUNT(*) as count FROM telegram_reception t ${whereClause}`;
  const result = connection.prepare(sql).get(...params) as { count: number };
  return Number(result.count);
}

const WARNING_TELEGRAM_TYPES = [
  'VPWW55',
  'VPWW56',
  'VPWW57',
  'VPWW58',
  'VPWW59',
  'VPWW60',
  'VPWW61',
  'VPWS50',
] as const;

export function listPendingWarningTelegramReceptions(
  connection: DatabaseConnection,
  venueId: VenueId,
  options?: {
    readonly after?: { readonly receivedAt: string; readonly id: number };
    readonly limit?: number;
  },
): PendingWarningTelegramPage {
  if (!isVenueId(venueId)) {
    throw new Error(`venueId must be a known VenueId: ${String(venueId)}`);
  }
  const limit = options?.limit ?? 100;
  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new Error(`limit must be an integer between 1 and 100: ${limit}`);
  }
  if (options?.after && (!Number.isInteger(options.after.id) || options.after.id <= 0)) {
    throw new Error(`after.id must be a positive integer: ${options.after.id}`);
  }
  const typePlaceholders = WARNING_TELEGRAM_TYPES.map(() => '?').join(', ');
  const cursorClause = options?.after
    ? 'AND (received_at > ? OR (received_at = ? AND id > ?))'
    : '';
  const cursorParams = options?.after
    ? [options.after.receivedAt, options.after.receivedAt, options.after.id]
    : [];
  const rows = connection
    .prepare(
      `SELECT id FROM telegram_reception t
       WHERE telegram_type IN (${typePlaceholders})
         AND NOT EXISTS (
           SELECT 1 FROM telegram_reception_adoption a
           WHERE a.reception_id = t.id AND a.venue_id = ? AND a.adoption_decided_at IS NOT NULL
         )
         ${cursorClause}
       ORDER BY received_at ASC, id ASC
       LIMIT ?`,
    )
    .all(...WARNING_TELEGRAM_TYPES, venueId, ...cursorParams, limit) as { id: number }[];
  const receptions = rows.map((row) => {
    const reception = findTelegramReceptionById(connection, row.id);
    if (!reception) throw new Error(`telegram_reception が見つかりません: ${row.id}`);
    return reception;
  });
  const last = receptions.at(-1);
  return {
    receptions,
    nextCursor:
      receptions.length === limit && last ? { receivedAt: last.receivedAt, id: last.id } : null,
  };
}

export function listWarningTelegramReceptionsForRebuild(
  connection: DatabaseConnection,
  options?: {
    readonly after?: {
      readonly reportDateTime: string;
      readonly controlDateTime: string;
      readonly id: number;
    };
    readonly limit?: number;
  },
): WarningTelegramRebuildPage {
  const limit = options?.limit ?? 100;
  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new Error(`limit must be an integer between 1 and 100: ${limit}`);
  }
  if (options?.after && (!Number.isInteger(options.after.id) || options.after.id <= 0)) {
    throw new Error(`after.id must be a positive integer: ${options.after.id}`);
  }
  const typePlaceholders = WARNING_TELEGRAM_TYPES.map(() => '?').join(', ');
  const cursorClause = options?.after
    ? `AND (
        report_datetime > ?
        OR (report_datetime = ? AND control_datetime > ?)
        OR (report_datetime = ? AND control_datetime = ? AND id > ?)
      )`
    : '';
  const cursorParams = options?.after
    ? [
        options.after.reportDateTime,
        options.after.reportDateTime,
        options.after.controlDateTime,
        options.after.reportDateTime,
        options.after.controlDateTime,
        options.after.id,
      ]
    : [];

  const rows = connection
    .prepare(
      `SELECT id FROM telegram_reception
       WHERE telegram_type IN (${typePlaceholders})
         AND raw_body IS NOT NULL
         AND report_datetime IS NOT NULL
         AND control_datetime IS NOT NULL
         ${cursorClause}
       ORDER BY report_datetime ASC, control_datetime ASC, id ASC
       LIMIT ?`,
    )
    .all(...WARNING_TELEGRAM_TYPES, ...cursorParams, limit) as { id: number }[];

  const receptions = rows.map((row) => {
    const reception = findTelegramReceptionById(connection, row.id);
    if (!reception) throw new Error(`telegram_reception が見つかりません: ${row.id}`);
    return reception;
  });

  const last = receptions.at(-1);
  return {
    receptions,
    nextCursor:
      receptions.length === limit && last && last.reportDateTime && last.controlDateTime
        ? {
            reportDateTime: last.reportDateTime,
            controlDateTime: last.controlDateTime,
            id: last.id,
          }
        : null,
  };
}

export function upsertTelegramReceptionAdoption(
  connection: DatabaseConnection,
  receptionId: number,
  input: TelegramReceptionAdoptionInput,
): TelegramReceptionAdoption {
  validateTelegramReceptionAdoptionInput(input);

  const row = connection
    .prepare(
      `
      INSERT INTO telegram_reception_adoption (
        reception_id, venue_id, adoption_result, adoption_reason, adoption_decided_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (reception_id, venue_id) DO UPDATE SET
        adoption_result = excluded.adoption_result,
        adoption_reason = excluded.adoption_reason,
        adoption_decided_at = excluded.adoption_decided_at
      RETURNING reception_id, venue_id, adoption_result, adoption_reason, adoption_decided_at
    `,
    )
    .get(
      receptionId,
      input.venueId,
      input.adoptionResult,
      input.adoptionReason,
      input.adoptionDecidedAt,
    ) as TelegramReceptionAdoptionRow;

  return mapAdoptionRow(row);
}

/** 会場によって対象が変わらない判定を、全 VenueId の行として複製して記録する（§3.3.1）。 */
export function upsertTelegramReceptionAdoptionForAllVenues(
  connection: DatabaseConnection,
  receptionId: number,
  input: Omit<TelegramReceptionAdoptionInput, 'venueId'>,
): readonly TelegramReceptionAdoption[] {
  const tx = connection.transaction(() => {
    return VENUE_IDS.map((venueId) =>
      upsertTelegramReceptionAdoption(connection, receptionId, { ...input, venueId }),
    );
  });
  return tx();
}

export function findTelegramReceptionAdoption(
  connection: DatabaseConnection,
  receptionId: number,
  venueId: VenueId,
): TelegramReceptionAdoption | null {
  if (!isVenueId(venueId)) {
    throw new Error(`venueId must be a known VenueId: ${String(venueId)}`);
  }
  const row = connection
    .prepare('SELECT * FROM telegram_reception_adoption WHERE reception_id = ? AND venue_id = ?')
    .get(receptionId, venueId) as TelegramReceptionAdoptionRow | undefined;
  return row ? mapAdoptionRow(row) : null;
}

export function listTelegramReceptionAdoptions(
  connection: DatabaseConnection,
  receptionId: number,
): readonly TelegramReceptionAdoption[] {
  return fetchAdoptions(connection, receptionId);
}

export function deleteTelegramReception(connection: DatabaseConnection, id: number): boolean {
  const result = connection.prepare('DELETE FROM telegram_reception WHERE id = ?').run(id);
  return result.changes > 0;
}

export function hasTelegramReception(connection: DatabaseConnection, documentUrl: string): boolean {
  validateNonEmptyString(documentUrl, 'documentUrl');
  const row = connection
    .prepare('SELECT 1 FROM telegram_reception WHERE document_url = ? LIMIT 1')
    .get(documentUrl);
  return row !== undefined;
}
