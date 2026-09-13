import type { TimeseriesScope } from '@wx-viewer-poc/shared';
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
  WarningTimeseriesAddition,
  WarningTimeseriesSnapshot,
  WarningTimeseriesSnapshotInput,
  WarningTimeseriesTimeDefine,
  WarningTimeseriesValue,
} from './types.js';

interface WarningTimeseriesSnapshotRow extends SnapshotMetadataRow, TelegramMetadataRow {
  readonly id: number;
  readonly area_code: string;
  readonly area_name: string;
  readonly additions_parsed?: number;
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
  readonly kind_index: number | null;
  readonly property_index: number | null;
  readonly part_name: string | null;
  readonly part_index: number | null;
  readonly base_index: number | null;
  readonly local_index: number | null;
}

interface WarningTimeseriesAdditionRow {
  readonly id: number;
  readonly snapshot_id: number;
  readonly block_id: string;
  readonly kind_index: number;
  readonly property_index: number;
  readonly part_name: string;
  readonly part_index: number;
  readonly base_index: number;
  readonly local_index: number | null;
  readonly property_type: string;
  readonly kind_status: string;
  readonly kind_datetime: string | null;
  readonly area_division: string | null;
  readonly addition_index: number;
  readonly note_index: number;
  readonly text: string;
}

function mapValueScope(row: WarningTimeseriesValueRow): TimeseriesScope | null {
  if (
    row.kind_index === null ||
    row.property_index === null ||
    row.part_name === null ||
    row.part_index === null ||
    row.base_index === null
  ) {
    return null;
  }
  return {
    kindIndex: row.kind_index,
    propertyIndex: row.property_index,
    partName: row.part_name,
    partIndex: row.part_index,
    baseIndex: row.base_index,
    localIndex: row.local_index,
  };
}

function mapAdditionRow(row: WarningTimeseriesAdditionRow): WarningTimeseriesAddition {
  return {
    id: row.id,
    blockId: row.block_id,
    scope: {
      kindIndex: row.kind_index,
      propertyIndex: row.property_index,
      partName: row.part_name,
      partIndex: row.part_index,
      baseIndex: row.base_index,
      localIndex: row.local_index,
    },
    propertyType: row.property_type,
    kindStatus: row.kind_status,
    kindDateTime: row.kind_datetime,
    areaDivision: row.area_division,
    additionIndex: row.addition_index,
    noteIndex: row.note_index,
    text: row.text,
  };
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

  const additionsParsedValue =
    input.additionsParsed !== undefined
      ? input.additionsParsed
        ? 1
        : 0
      : input.additions !== undefined
        ? 1
        : 0;

  const saveTx = connection.transaction(() => {
    const upsertStmt = connection.prepare(`
      INSERT INTO warning_timeseries_snapshot (
        area_code, area_name, control_status, info_type, event_id, report_datetime, control_datetime,
        source, issued_at, valid_at, valid_from, valid_to, fetched_at, last_success_at, availability, source_version,
        additions_parsed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        source_version = excluded.source_version,
        additions_parsed = CASE
          WHEN excluded.availability = 'stale' THEN warning_timeseries_snapshot.additions_parsed
          ELSE excluded.additions_parsed
        END
      RETURNING id, additions_parsed
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
      additionsParsedValue,
    ) as { id: number; additions_parsed: number };

    const snapshotId = Number(row.id);
    const effectiveAdditionsParsed = row.additions_parsed === 1;

    let timeDefines: WarningTimeseriesTimeDefine[];
    let values: WarningTimeseriesValue[];
    let additions: WarningTimeseriesAddition[] | null;

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
        scope: mapValueScope(vRow),
      }));

      if (!effectiveAdditionsParsed) {
        additions = null;
      } else {
        const additionRows = connection
          .prepare(
            `
            SELECT * FROM warning_timeseries_addition
            WHERE snapshot_id = ?
            ORDER BY id ASC
          `,
          )
          .all(snapshotId) as WarningTimeseriesAdditionRow[];
        additions = additionRows.map(mapAdditionRow);
      }
    } else {
      // 明細全削除
      connection
        .prepare('DELETE FROM warning_timeseries_addition WHERE snapshot_id = ?')
        .run(snapshotId);
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
          value_category, property_type, value_type, value_code, value_text, unit, description, condition, area_division, sequence,
          kind_index, property_index, part_name, part_index, base_index, local_index
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
      `);

      values = input.values.map((v) => {
        const vScope = v.scope ?? null;
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
          vScope?.kindIndex ?? null,
          vScope?.propertyIndex ?? null,
          vScope?.partName ?? null,
          vScope?.partIndex ?? null,
          vScope?.baseIndex ?? null,
          vScope?.localIndex ?? null,
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
          scope: vScope,
        };
      });

      if (!effectiveAdditionsParsed) {
        additions = null;
      } else {
        const insertAdditionStmt = connection.prepare(`
          INSERT INTO warning_timeseries_addition (
            snapshot_id, block_id, kind_index, property_index, part_name, part_index, base_index, local_index,
            property_type, kind_status, kind_datetime, area_division, addition_index, note_index, text
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING id
        `);

        additions = (input.additions ?? []).map((add) => {
          const aRow = insertAdditionStmt.get(
            snapshotId,
            add.blockId,
            add.scope.kindIndex,
            add.scope.propertyIndex,
            add.scope.partName,
            add.scope.partIndex,
            add.scope.baseIndex,
            add.scope.localIndex,
            add.propertyType,
            add.kindStatus,
            add.kindDateTime ?? null,
            add.areaDivision,
            add.additionIndex,
            add.noteIndex,
            add.text,
          ) as { id: number };

          return {
            ...add,
            id: Number(aRow.id),
          };
        });
      }
    }

    return {
      id: snapshotId,
      areaCode: input.areaCode,
      areaName: input.areaName,
      metadata: input.metadata,
      telegram: input.telegram,
      timeDefines,
      values,
      additionsParsed: effectiveAdditionsParsed,
      additions,
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
    scope: mapValueScope(row),
  }));

  const additionsParsed = snapshotRow.additions_parsed === 1;
  let additions: WarningTimeseriesAddition[] | null = null;
  if (additionsParsed) {
    const additionRows = connection
      .prepare(
        `
        SELECT * FROM warning_timeseries_addition
        WHERE snapshot_id = ?
        ORDER BY id ASC
      `,
      )
      .all(snapshotRow.id) as WarningTimeseriesAdditionRow[];
    additions = additionRows.map(mapAdditionRow);
  }

  return {
    id: snapshotRow.id,
    areaCode: snapshotRow.area_code,
    areaName: snapshotRow.area_name,
    metadata: mapMetadataRow(snapshotRow),
    telegram: mapTelegramRow(snapshotRow),
    timeDefines,
    values,
    additionsParsed,
    additions,
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
