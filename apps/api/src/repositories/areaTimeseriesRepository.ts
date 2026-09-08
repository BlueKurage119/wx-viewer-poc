import type { DatabaseConnection } from '../database/index.js';
import {
  mapMetadataRow,
  mapTelegramRow,
  validateControlStatus,
  validateMetadataInput,
  validateNonEmptyString,
  validateTelegramInput,
  type SnapshotMetadataRow,
  type TelegramMetadataRow,
} from './snapshot.js';
import type {
  AreaTimeseriesSnapshot,
  AreaTimeseriesSnapshotInput,
  AreaTimeseriesTimeDefine,
  AreaTimeseriesValue,
  ControlStatus,
} from './types.js';

interface AreaTimeseriesSnapshotRow extends SnapshotMetadataRow, TelegramMetadataRow {
  readonly id: number;
  readonly area_code: string;
  readonly area_name: string;
  readonly station_code: string;
  readonly station_name: string;
}

interface AreaTimeseriesTimeDefineRow {
  readonly id: number;
  readonly snapshot_id: number;
  readonly block_id: string;
  readonly time_id: string;
  readonly sequence: number;
  readonly time_from: string;
  readonly time_to: string;
  readonly duration: string | null;
}

interface AreaTimeseriesValueRow {
  readonly id: number;
  readonly snapshot_id: number;
  readonly block_id: string;
  readonly ref_id: string;
  readonly element: string;
  readonly value_code: string | null;
  readonly value_text: string | null;
  readonly value_number: number | null;
  readonly unit: string | null;
  readonly sequence: number;
}

export function saveAreaTimeseriesSnapshot(
  connection: DatabaseConnection,
  input: AreaTimeseriesSnapshotInput,
): AreaTimeseriesSnapshot {
  validateNonEmptyString(input.areaCode, 'areaCode');
  validateNonEmptyString(input.areaName, 'areaName');
  validateNonEmptyString(input.stationCode, 'stationCode');
  validateNonEmptyString(input.stationName, 'stationName');
  validateMetadataInput(input.metadata);
  validateTelegramInput(input.telegram);

  const saveTx = connection.transaction(() => {
    const upsertStmt = connection.prepare(`
      INSERT INTO area_timeseries_snapshot (
        area_code, area_name, station_code, station_name,
        control_status, info_type, event_id, report_datetime, control_datetime,
        source, issued_at, valid_at, valid_from, valid_to, fetched_at, last_success_at, availability, source_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (area_code, station_code, control_status) DO UPDATE SET
        area_name = excluded.area_name,
        station_name = excluded.station_name,
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
      input.stationCode,
      input.stationName,
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

    connection.prepare('DELETE FROM area_timeseries_value WHERE snapshot_id = ?').run(snapshotId);
    connection
      .prepare('DELETE FROM area_timeseries_time_define WHERE snapshot_id = ?')
      .run(snapshotId);

    const insertTimeDefineStmt = connection.prepare(`
      INSERT INTO area_timeseries_time_define (
        snapshot_id, block_id, time_id, sequence, time_from, time_to, duration
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `);

    const timeDefines: AreaTimeseriesTimeDefine[] = input.timeDefines.map((td) => {
      const tdRow = insertTimeDefineStmt.get(
        snapshotId,
        td.blockId,
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

    const insertValueStmt = connection.prepare(`
      INSERT INTO area_timeseries_value (
        snapshot_id, block_id, ref_id, element, value_code, value_text, value_number, unit, sequence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `);

    const values: AreaTimeseriesValue[] = input.values.map((v) => {
      const vRow = insertValueStmt.get(
        snapshotId,
        v.blockId,
        v.refId,
        v.element,
        v.valueCode,
        v.valueText,
        v.valueNumber,
        v.unit,
        v.sequence,
      ) as { id: number };

      return {
        id: Number(vRow.id),
        ...v,
      };
    });

    return {
      id: snapshotId,
      areaCode: input.areaCode,
      areaName: input.areaName,
      stationCode: input.stationCode,
      stationName: input.stationName,
      metadata: input.metadata,
      telegram: input.telegram,
      timeDefines,
      values,
    };
  });

  return saveTx();
}

export function findAreaTimeseriesSnapshot(
  connection: DatabaseConnection,
  areaCode: string,
  stationCode: string,
  controlStatus: ControlStatus,
): AreaTimeseriesSnapshot | null {
  validateControlStatus(controlStatus);

  const snapshotRow = connection
    .prepare(
      `
      SELECT * FROM area_timeseries_snapshot
      WHERE area_code = ? AND station_code = ? AND control_status = ?
    `,
    )
    .get(areaCode, stationCode, controlStatus) as AreaTimeseriesSnapshotRow | undefined;

  if (!snapshotRow) {
    return null;
  }

  const tdRows = connection
    .prepare(
      `
      SELECT * FROM area_timeseries_time_define
      WHERE snapshot_id = ?
      ORDER BY sequence ASC, id ASC
    `,
    )
    .all(snapshotRow.id) as AreaTimeseriesTimeDefineRow[];

  const timeDefines: AreaTimeseriesTimeDefine[] = tdRows.map((row) => ({
    id: row.id,
    blockId: row.block_id,
    timeId: row.time_id,
    sequence: row.sequence,
    timeFrom: row.time_from,
    timeTo: row.time_to,
    duration: row.duration,
  }));

  const valueRows = connection
    .prepare(
      `
      SELECT * FROM area_timeseries_value
      WHERE snapshot_id = ?
      ORDER BY sequence ASC, id ASC
    `,
    )
    .all(snapshotRow.id) as AreaTimeseriesValueRow[];

  const values: AreaTimeseriesValue[] = valueRows.map((row) => ({
    id: row.id,
    blockId: row.block_id,
    refId: row.ref_id,
    element: row.element,
    valueCode: row.value_code,
    valueText: row.value_text,
    valueNumber: row.value_number,
    unit: row.unit,
    sequence: row.sequence,
  }));

  return {
    id: snapshotRow.id,
    areaCode: snapshotRow.area_code,
    areaName: snapshotRow.area_name,
    stationCode: snapshotRow.station_code,
    stationName: snapshotRow.station_name,
    metadata: mapMetadataRow(snapshotRow),
    telegram: mapTelegramRow(snapshotRow),
    timeDefines,
    values,
  };
}

export function deleteAreaTimeseriesSnapshot(
  connection: DatabaseConnection,
  areaCode: string,
  stationCode: string,
  controlStatus: ControlStatus,
): boolean {
  validateControlStatus(controlStatus);

  const result = connection
    .prepare(
      `
      DELETE FROM area_timeseries_snapshot
      WHERE area_code = ? AND station_code = ? AND control_status = ?
    `,
    )
    .run(areaCode, stationCode, controlStatus);

  return result.changes > 0;
}
