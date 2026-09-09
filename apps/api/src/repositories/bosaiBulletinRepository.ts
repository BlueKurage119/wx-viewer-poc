import type { DatabaseConnection } from '../database/index.js';
import {
  mapMetadataRow,
  validateControlStatus,
  validateMetadataInput,
  validateNonEmptyString,
  validateUtcIso8601String,
  type SnapshotMetadataRow,
} from './snapshot.js';
import type {
  BosaiBulletin,
  BosaiBulletinArea,
  BosaiBulletinInput,
  ControlStatus,
  ListBosaiBulletinsOptions,
} from './types.js';

interface BosaiBulletinRow extends SnapshotMetadataRow {
  readonly id: number;
  readonly event_id: string;
  readonly control_status: string;
  readonly info_type: string;
  readonly report_datetime: string;
  readonly control_datetime: string;
  readonly title: string;
  readonly headline_text: string;
  readonly information_tag: string;
  readonly is_cancelled: number;
}

interface BosaiBulletinAreaRow {
  readonly id: number;
  readonly bulletin_id: number;
  readonly area_code: string;
  readonly area_name: string;
  readonly code_type: string;
  readonly sequence: number;
}

export function saveBosaiBulletin(
  connection: DatabaseConnection,
  input: BosaiBulletinInput,
): BosaiBulletin {
  validateNonEmptyString(input.eventId, 'eventId');
  validateControlStatus(input.controlStatus);
  validateNonEmptyString(input.infoType, 'infoType');
  validateUtcIso8601String(input.reportDateTime, 'reportDateTime');
  validateUtcIso8601String(input.controlDateTime, 'controlDateTime');
  validateNonEmptyString(input.title, 'title');
  validateNonEmptyString(input.headlineText, 'headlineText');
  validateNonEmptyString(input.informationTag, 'informationTag');
  validateMetadataInput(input.metadata);

  const saveTx = connection.transaction(() => {
    const upsertStmt = connection.prepare(`
      INSERT INTO bosai_bulletin (
        event_id, control_status, info_type, report_datetime, control_datetime,
        title, headline_text, information_tag, is_cancelled,
        source, issued_at, valid_at, valid_from, valid_to,
        fetched_at, last_success_at, availability, source_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (event_id, control_status) DO UPDATE SET
        info_type = excluded.info_type,
        report_datetime = excluded.report_datetime,
        control_datetime = excluded.control_datetime,
        title = excluded.title,
        headline_text = excluded.headline_text,
        information_tag = excluded.information_tag,
        is_cancelled = excluded.is_cancelled,
        source = excluded.source,
        issued_at = excluded.issued_at,
        valid_at = excluded.valid_at,
        valid_from = excluded.valid_from,
        valid_to = excluded.valid_to,
        fetched_at = excluded.fetched_at,
        last_success_at = excluded.last_success_at,
        availability = excluded.availability,
        source_version = excluded.source_version
      RETURNING id
    `);

    const row = upsertStmt.get(
      input.eventId,
      input.controlStatus,
      input.infoType,
      input.reportDateTime,
      input.controlDateTime,
      input.title,
      input.headlineText,
      input.informationTag,
      input.isCancelled ? 1 : 0,
      input.metadata.source,
      input.metadata.issuedAt,
      input.metadata.validAt,
      input.metadata.validFrom,
      input.metadata.validTo,
      input.metadata.fetchedAt,
      input.metadata.lastSuccessAt,
      input.metadata.availability,
      input.metadata.sourceVersion,
    ) as { id: number };

    const bulletinId = Number(row.id);

    connection.prepare('DELETE FROM bosai_bulletin_area WHERE bulletin_id = ?').run(bulletinId);

    const insertAreaStmt = connection.prepare(`
      INSERT INTO bosai_bulletin_area (
        bulletin_id, area_code, area_name, code_type, sequence
      ) VALUES (?, ?, ?, ?, ?)
      RETURNING id
    `);

    const areas: BosaiBulletinArea[] = input.areas.map((area) => {
      const aRow = insertAreaStmt.get(
        bulletinId,
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

    return {
      id: bulletinId,
      eventId: input.eventId,
      controlStatus: input.controlStatus,
      infoType: input.infoType,
      reportDateTime: input.reportDateTime,
      controlDateTime: input.controlDateTime,
      title: input.title,
      headlineText: input.headlineText,
      informationTag: input.informationTag,
      isCancelled: input.isCancelled,
      metadata: input.metadata,
      areas,
    };
  });

  return saveTx();
}

export function findBosaiBulletin(
  connection: DatabaseConnection,
  eventId: string,
  controlStatus: ControlStatus,
): BosaiBulletin | null {
  validateControlStatus(controlStatus);
  validateNonEmptyString(eventId, 'eventId');

  const row = connection
    .prepare(
      `
      SELECT * FROM bosai_bulletin
      WHERE event_id = ? AND control_status = ?
    `,
    )
    .get(eventId, controlStatus) as BosaiBulletinRow | undefined;

  if (!row) {
    return null;
  }

  const areaRows = connection
    .prepare(
      `
      SELECT * FROM bosai_bulletin_area
      WHERE bulletin_id = ?
      ORDER BY sequence ASC, id ASC
    `,
    )
    .all(row.id) as BosaiBulletinAreaRow[];

  const areas: BosaiBulletinArea[] = areaRows.map((a) => ({
    id: a.id,
    areaCode: a.area_code,
    areaName: a.area_name,
    codeType: a.code_type,
    sequence: a.sequence,
  }));

  return {
    id: row.id,
    eventId: row.event_id,
    controlStatus: row.control_status as ControlStatus,
    infoType: row.info_type,
    reportDateTime: row.report_datetime,
    controlDateTime: row.control_datetime,
    title: row.title,
    headlineText: row.headline_text,
    informationTag: row.information_tag,
    isCancelled: row.is_cancelled === 1,
    metadata: mapMetadataRow(row),
    areas,
  };
}

export function listBosaiBulletins(
  connection: DatabaseConnection,
  options: ListBosaiBulletinsOptions,
): readonly BosaiBulletin[] {
  validateControlStatus(options.controlStatus);

  let rows: BosaiBulletinRow[];

  if (options.includedAreaCodes !== undefined) {
    if (options.includedAreaCodes.length === 0) {
      throw new Error('includedAreaCodes は空配列にできません');
    }
    const placeholders = options.includedAreaCodes.map(() => '?').join(', ');
    const query = `
      SELECT b.* FROM bosai_bulletin b
      WHERE b.control_status = ?
        AND EXISTS (
          SELECT 1 FROM bosai_bulletin_area a
          WHERE a.bulletin_id = b.id
            AND a.area_code IN (${placeholders})
        )
      ORDER BY b.report_datetime DESC, b.id DESC
    `;
    rows = connection
      .prepare(query)
      .all(options.controlStatus, ...options.includedAreaCodes) as BosaiBulletinRow[];
  } else {
    rows = connection
      .prepare(
        `
        SELECT * FROM bosai_bulletin
        WHERE control_status = ?
        ORDER BY report_datetime DESC, id DESC
      `,
      )
      .all(options.controlStatus) as BosaiBulletinRow[];
  }

  const areaStmt = connection.prepare(`
    SELECT * FROM bosai_bulletin_area
    WHERE bulletin_id = ?
    ORDER BY sequence ASC, id ASC
  `);

  return rows.map((row) => {
    const areaRows = areaStmt.all(row.id) as BosaiBulletinAreaRow[];
    const areas: BosaiBulletinArea[] = areaRows.map((a) => ({
      id: a.id,
      areaCode: a.area_code,
      areaName: a.area_name,
      codeType: a.code_type,
      sequence: a.sequence,
    }));

    return {
      id: row.id,
      eventId: row.event_id,
      controlStatus: row.control_status as ControlStatus,
      infoType: row.info_type,
      reportDateTime: row.report_datetime,
      controlDateTime: row.control_datetime,
      title: row.title,
      headlineText: row.headline_text,
      informationTag: row.information_tag,
      isCancelled: row.is_cancelled === 1,
      metadata: mapMetadataRow(row),
      areas,
    };
  });
}

export function deleteBosaiBulletin(
  connection: DatabaseConnection,
  eventId: string,
  controlStatus: ControlStatus,
): boolean {
  validateControlStatus(controlStatus);
  validateNonEmptyString(eventId, 'eventId');

  const result = connection
    .prepare(
      `
      DELETE FROM bosai_bulletin
      WHERE event_id = ? AND control_status = ?
    `,
    )
    .run(eventId, controlStatus);

  return result.changes > 0;
}
