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
  WarningTimeseriesSnapshot,
  WarningTimeseriesSnapshotInput,
  WarningTimeseriesTimeDefine,
  WarningTimeseriesValue,
} from './types.js';

interface WarningTimeseriesSnapshotRow extends SnapshotMetadataRow, TelegramMetadataRow {
  readonly id: number;
  readonly area_code: string;
  readonly area_name: string;
}

interface WarningTimeseriesTimeDefineRow {
  readonly id: number;
  readonly snapshot_id: number;
  readonly block_id: string;
  readonly time_id: string;
  readonly sequence: number;
  readonly time_from: string;
  readonly time_to: string;
  readonly duration: string | null;
}

interface WarningTimeseriesValueRow {
  readonly id: number;
  readonly snapshot_id: number;
  readonly block_id: string;
  readonly ref_id: string;
  readonly kind_code: string | null;
  readonly kind_name: string | null;
  readonly kind_status: string;
  readonly kind_datetime: string | null;
  readonly value_category: string;
  readonly property_type: string;
  readonly value_type: string;
  readonly value_code: string | null;
  readonly value_text: string;
  readonly unit: string | null;
  readonly description: string | null;
  readonly condition: string | null;
  readonly area_division: string | null;
  readonly sequence: number;
}

export function saveWarningTimeseriesSnapshot(
  connection: DatabaseConnection,
  input: WarningTimeseriesSnapshotInput,
): WarningTimeseriesSnapshot {
  validateNonEmptyString(input.areaCode, 'areaCode');
  validateNonEmptyString(input.areaName, 'areaName');
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
      INSERT INTO warning_timeseries_snapshot (
        area_code, area_name, control_status, info_type, event_id, report_datetime, control_datetime,
        source, issued_at, valid_at, valid_from, valid_to, fetched_at, last_success_at, availability, source_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (area_code, control_status) DO UPDATE SET
        area_name = excluded.area_name,
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

    let timeDefines: WarningTimeseriesTimeDefine[];
    let values: WarningTimeseriesValue[];

    if (isStale) {
      const tdRows = connection
        .prepare(
          `
          SELECT * FROM warning_timeseries_time_define
          WHERE snapshot_id = ?
          ORDER BY sequence ASC, id ASC
        `,
        )
        .all(snapshotId) as WarningTimeseriesTimeDefineRow[];

      timeDefines = tdRows.map((tdRow) => ({
        id: tdRow.id,
        blockId: tdRow.block_id,
        timeId: tdRow.time_id,
        sequence: tdRow.sequence,
        timeFrom: tdRow.time_from,
        timeTo: tdRow.time_to,
        duration: tdRow.duration,
      }));

      const valueRows = connection
        .prepare(
          `
          SELECT * FROM warning_timeseries_value
          WHERE snapshot_id = ?
          ORDER BY sequence ASC, id ASC
        `,
        )
        .all(snapshotId) as WarningTimeseriesValueRow[];

      values = valueRows.map((vRow) => ({
        id: vRow.id,
        blockId: vRow.block_id,
        refId: vRow.ref_id,
        kindCode: vRow.kind_code,
        kindName: vRow.kind_name,
        kindStatus: vRow.kind_status,
        kindDateTime: vRow.kind_datetime,
        valueCategory: vRow.value_category,
        propertyType: vRow.property_type,
        valueType: vRow.value_type,
        valueCode: vRow.value_code,
        valueText: vRow.value_text,
        unit: vRow.unit,
        description: vRow.description,
        condition: vRow.condition,
        areaDivision: vRow.area_division,
        sequence: vRow.sequence,
      }));
    } else {
      // 明細全削除（time_define 削除で value も CASCADE されるが、明示的に削除）
      connection
        .prepare('DELETE FROM warning_timeseries_value WHERE snapshot_id = ?')
        .run(snapshotId);
      connection
        .prepare('DELETE FROM warning_timeseries_time_define WHERE snapshot_id = ?')
        .run(snapshotId);

      const insertTimeDefineStmt = connection.prepare(`
        INSERT INTO warning_timeseries_time_define (
          snapshot_id, block_id, time_id, sequence, time_from, time_to, duration
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING id
      `);

      timeDefines = input.timeDefines.map((td) => {
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
        INSERT INTO warning_timeseries_value (
          snapshot_id, block_id, ref_id, kind_code, kind_name, kind_status, kind_datetime,
          value_category, property_type, value_type, value_code, value_text, unit, description, condition, area_division, sequence
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
      `);

      values = input.values.map((v) => {
        const vRow = insertValueStmt.get(
          snapshotId,
          v.blockId,
          v.refId,
          v.kindCode ?? null,
          v.kindName ?? null,
          v.kindStatus,
          v.kindDateTime ?? null,
          v.valueCategory,
          v.propertyType,
          v.valueType,
          v.valueCode ?? null,
          v.valueText,
          v.unit,
          v.description ?? null,
          v.condition ?? null,
          v.areaDivision,
          v.sequence,
        ) as { id: number };

        return {
          ...v,
          id: Number(vRow.id),
          kindCode: v.kindCode ?? null,
          kindName: v.kindName ?? null,
          kindDateTime: v.kindDateTime ?? null,
          valueCode: v.valueCode ?? null,
          description: v.description ?? null,
          condition: v.condition ?? null,
        };
      });
    }

    return {
      id: snapshotId,
      areaCode: input.areaCode,
      areaName: input.areaName,
      metadata: input.metadata,
      telegram: input.telegram,
      timeDefines,
      values,
    };
  });

  return saveTx();
}

export function findWarningTimeseriesSnapshot(
  connection: DatabaseConnection,
  areaCode: string,
  controlStatus: ControlStatus,
): WarningTimeseriesSnapshot | null {
  validateControlStatus(controlStatus);

  const snapshotRow = connection
    .prepare(
      `
      SELECT * FROM warning_timeseries_snapshot
      WHERE area_code = ? AND control_status = ?
    `,
    )
    .get(areaCode, controlStatus) as WarningTimeseriesSnapshotRow | undefined;

  if (!snapshotRow) {
    return null;
  }

  const tdRows = connection
    .prepare(
      `
      SELECT * FROM warning_timeseries_time_define
      WHERE snapshot_id = ?
      ORDER BY sequence ASC, id ASC
    `,
    )
    .all(snapshotRow.id) as WarningTimeseriesTimeDefineRow[];

  const timeDefines: WarningTimeseriesTimeDefine[] = tdRows.map((row) => ({
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
      SELECT * FROM warning_timeseries_value
      WHERE snapshot_id = ?
      ORDER BY sequence ASC, id ASC
    `,
    )
    .all(snapshotRow.id) as WarningTimeseriesValueRow[];

  const values: WarningTimeseriesValue[] = valueRows.map((row) => ({
    id: row.id,
    blockId: row.block_id,
    refId: row.ref_id,
    kindCode: row.kind_code,
    kindName: row.kind_name,
    kindStatus: row.kind_status,
    kindDateTime: row.kind_datetime,
    valueCategory: row.value_category,
    propertyType: row.property_type,
    valueType: row.value_type,
    valueCode: row.value_code,
    valueText: row.value_text,
    unit: row.unit,
    description: row.description,
    condition: row.condition,
    areaDivision: row.area_division,
    sequence: row.sequence,
  }));

  return {
    id: snapshotRow.id,
    areaCode: snapshotRow.area_code,
    areaName: snapshotRow.area_name,
    metadata: mapMetadataRow(snapshotRow),
    telegram: mapTelegramRow(snapshotRow),
    timeDefines,
    values,
  };
}

export function deleteWarningTimeseriesSnapshot(
  connection: DatabaseConnection,
  areaCode: string,
  controlStatus: ControlStatus,
): boolean {
  validateControlStatus(controlStatus);
  const result = connection
    .prepare(
      `
      DELETE FROM warning_timeseries_snapshot
      WHERE area_code = ? AND control_status = ?
    `,
    )
    .run(areaCode, controlStatus);

  return result.changes > 0;
}
