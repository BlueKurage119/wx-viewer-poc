import type { DatabaseConnection } from '../database/index.js';
import {
  mapMetadataRow,
  mapTelegramRow,
  validateControlStatus,
  validateMetadataInput,
  validateNonEmptyString,
  validateTelegramInput,
  validateUtcIso8601String,
  type SnapshotMetadataRow,
  type TelegramMetadataRow,
} from './snapshot.js';
import type {
  ControlStatus,
  EarlyWarningCell,
  EarlyWarningSegment,
  EarlyWarningSnapshot,
  EarlyWarningSnapshotInput,
  EarlyWarningTimeDefine,
} from './types.js';

interface EarlyWarningSnapshotRow extends SnapshotMetadataRow, TelegramMetadataRow {
  readonly id: number;
  readonly area_code: string;
  readonly area_name: string;
  readonly segment: string;
  readonly telegram_type: string;
}

interface EarlyWarningTimeDefineRow {
  readonly id: number;
  readonly snapshot_id: number;
  readonly time_id: string;
  readonly sequence: number;
  readonly time_from: string;
  readonly time_to: string;
  readonly duration: string | null;
}

interface EarlyWarningCellRow {
  readonly id: number;
  readonly snapshot_id: number;
  readonly ref_id: string;
  readonly phenomenon_code: string;
  readonly phenomenon_name: string;
  readonly rank_value: string | null;
  readonly condition: string | null;
}

function validateSegment(segment: string): asserts segment is EarlyWarningSegment {
  if (segment !== 'near' && segment !== 'far') {
    throw new Error(`Invalid segment: ${segment}`);
  }
}

export function saveEarlyWarningSnapshot(
  connection: DatabaseConnection,
  input: EarlyWarningSnapshotInput,
): EarlyWarningSnapshot {
  validateNonEmptyString(input.areaCode, 'areaCode');
  validateNonEmptyString(input.areaName, 'areaName');
  validateSegment(input.segment);
  validateNonEmptyString(input.telegramType, 'telegramType');
  validateMetadataInput(input.metadata);
  validateTelegramInput(input.telegram);

  const isStale = input.metadata.availability === 'stale';

  if (!isStale) {
    for (const td of input.timeDefines) {
      validateUtcIso8601String(td.timeFrom, 'timeDefine.timeFrom');
      validateUtcIso8601String(td.timeTo, 'timeDefine.timeTo');
    }
  }

  const saveTx = connection.transaction(() => {
    const upsertStmt = connection.prepare(`
      INSERT INTO early_warning_snapshot (
        area_code, area_name, segment, telegram_type,
        control_status, info_type, event_id, report_datetime, control_datetime,
        source, issued_at, valid_at, valid_from, valid_to, fetched_at, last_success_at, availability, source_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (area_code, segment, control_status) DO UPDATE SET
        area_name = excluded.area_name,
        telegram_type = excluded.telegram_type,
        info_type = excluded.info_type,
        event_id = excluded.event_id,
        report_datetime = excluded.report_datetime,
        control_datetime = excluded.control_datetime,
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
      input.areaCode,
      input.areaName,
      input.segment,
      input.telegramType,
      input.telegram.controlStatus,
      input.telegram.infoType,
      input.telegram.eventId,
      input.telegram.reportDateTime,
      input.telegram.controlDateTime,
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

    const snapshotId = Number(row.id);

    let timeDefines: EarlyWarningTimeDefine[];
    let cells: EarlyWarningCell[];

    if (isStale) {
      const tdRows = connection
        .prepare(
          `
          SELECT * FROM early_warning_time_define
          WHERE snapshot_id = ?
          ORDER BY sequence ASC, id ASC
        `,
        )
        .all(snapshotId) as EarlyWarningTimeDefineRow[];

      timeDefines = tdRows.map((tdRow) => ({
        id: tdRow.id,
        timeId: tdRow.time_id,
        sequence: tdRow.sequence,
        timeFrom: tdRow.time_from,
        timeTo: tdRow.time_to,
        duration: tdRow.duration,
      }));

      const cellRows = connection
        .prepare(
          `
          SELECT * FROM early_warning_cell
          WHERE snapshot_id = ?
          ORDER BY id ASC
        `,
        )
        .all(snapshotId) as EarlyWarningCellRow[];

      cells = cellRows.map((cellRow) => ({
        id: cellRow.id,
        refId: cellRow.ref_id,
        phenomenonCode: cellRow.phenomenon_code,
        phenomenonName: cellRow.phenomenon_name,
        rankValue: cellRow.rank_value,
        condition: cellRow.condition,
      }));
    } else {
      connection.prepare('DELETE FROM early_warning_cell WHERE snapshot_id = ?').run(snapshotId);
      connection
        .prepare('DELETE FROM early_warning_time_define WHERE snapshot_id = ?')
        .run(snapshotId);

      const insertTimeDefineStmt = connection.prepare(`
        INSERT INTO early_warning_time_define (
          snapshot_id, time_id, sequence, time_from, time_to, duration
        ) VALUES (?, ?, ?, ?, ?, ?)
        RETURNING id
      `);

      timeDefines = input.timeDefines.map((td) => {
        const tdRow = insertTimeDefineStmt.get(
          snapshotId,
          td.timeId,
          td.sequence,
          td.timeFrom,
          td.timeTo,
          td.duration,
        ) as { id: number };

        return {
          id: Number(tdRow.id),
          ...td,
        };
      });

      const insertCellStmt = connection.prepare(`
        INSERT INTO early_warning_cell (
          snapshot_id, ref_id, phenomenon_code, phenomenon_name, rank_value, condition
        ) VALUES (?, ?, ?, ?, ?, ?)
        RETURNING id
      `);

      cells = input.cells.map((c) => {
        const cRow = insertCellStmt.get(
          snapshotId,
          c.refId,
          c.phenomenonCode,
          c.phenomenonName,
          c.rankValue,
          c.condition,
        ) as { id: number };

        return {
          id: Number(cRow.id),
          ...c,
        };
      });
    }

    return {
      id: snapshotId,
      areaCode: input.areaCode,
      areaName: input.areaName,
      segment: input.segment,
      telegramType: input.telegramType,
      metadata: input.metadata,
      telegram: input.telegram,
      timeDefines,
      cells,
    };
  });

  return saveTx();
}

export function findEarlyWarningSnapshot(
  connection: DatabaseConnection,
  areaCode: string,
  segment: EarlyWarningSegment,
  controlStatus: ControlStatus,
): EarlyWarningSnapshot | null {
  validateSegment(segment);
  validateControlStatus(controlStatus);

  const snapshotRow = connection
    .prepare(
      `
      SELECT * FROM early_warning_snapshot
      WHERE area_code = ? AND segment = ? AND control_status = ?
    `,
    )
    .get(areaCode, segment, controlStatus) as EarlyWarningSnapshotRow | undefined;

  if (!snapshotRow) {
    return null;
  }

  const tdRows = connection
    .prepare(
      `
      SELECT * FROM early_warning_time_define
      WHERE snapshot_id = ?
      ORDER BY sequence ASC, id ASC
    `,
    )
    .all(snapshotRow.id) as EarlyWarningTimeDefineRow[];

  const timeDefines: EarlyWarningTimeDefine[] = tdRows.map((row) => ({
    id: row.id,
    timeId: row.time_id,
    sequence: row.sequence,
    timeFrom: row.time_from,
    timeTo: row.time_to,
    duration: row.duration,
  }));

  const cellRows = connection
    .prepare(
      `
      SELECT * FROM early_warning_cell
      WHERE snapshot_id = ?
      ORDER BY id ASC
    `,
    )
    .all(snapshotRow.id) as EarlyWarningCellRow[];

  const cells: EarlyWarningCell[] = cellRows.map((row) => ({
    id: row.id,
    refId: row.ref_id,
    phenomenonCode: row.phenomenon_code,
    phenomenonName: row.phenomenon_name,
    rankValue: row.rank_value,
    condition: row.condition,
  }));

  return {
    id: snapshotRow.id,
    areaCode: snapshotRow.area_code,
    areaName: snapshotRow.area_name,
    segment: snapshotRow.segment as EarlyWarningSegment,
    telegramType: snapshotRow.telegram_type,
    metadata: mapMetadataRow(snapshotRow),
    telegram: mapTelegramRow(snapshotRow),
    timeDefines,
    cells,
  };
}

export function deleteEarlyWarningSnapshot(
  connection: DatabaseConnection,
  areaCode: string,
  segment: EarlyWarningSegment,
  controlStatus: ControlStatus,
): boolean {
  validateSegment(segment);
  validateControlStatus(controlStatus);

  const result = connection
    .prepare(
      `
      DELETE FROM early_warning_snapshot
      WHERE area_code = ? AND segment = ? AND control_status = ?
    `,
    )
    .run(areaCode, segment, controlStatus);

  return result.changes > 0;
}
