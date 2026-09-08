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
  ControlStatus,
  WarningCurrentItem,
  WarningCurrentSnapshot,
  WarningCurrentSnapshotInput,
} from './types.js';

interface WarningCurrentSnapshotRow extends SnapshotMetadataRow, TelegramMetadataRow {
  readonly id: number;
  readonly area_code: string;
  readonly area_name: string;
}

interface WarningCurrentItemRow {
  readonly id: number;
  readonly snapshot_id: number;
  readonly sequence: number;
  readonly kind_code: string;
  readonly kind_name: string;
  readonly kind_status: string;
  readonly last_kind_code: string | null;
  readonly last_kind_name: string | null;
  readonly significancy_code: string | null;
  readonly significancy_name: string | null;
  readonly warning_level: string | null;
  readonly attention_text: string | null;
  readonly kind_issued_at: string | null;
  readonly source_telegram: string;
}

export function saveWarningCurrentSnapshot(
  connection: DatabaseConnection,
  input: WarningCurrentSnapshotInput,
): WarningCurrentSnapshot {
  validateNonEmptyString(input.areaCode, 'areaCode');
  validateNonEmptyString(input.areaName, 'areaName');
  validateMetadataInput(input.metadata);
  validateTelegramInput(input.telegram);

  const saveTx = connection.transaction(() => {
    const upsertStmt = connection.prepare(`
      INSERT INTO warning_current_snapshot (
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

    connection.prepare('DELETE FROM warning_current_item WHERE snapshot_id = ?').run(snapshotId);

    const insertItemStmt = connection.prepare(`
      INSERT INTO warning_current_item (
        snapshot_id, sequence, kind_code, kind_name, kind_status,
        last_kind_code, last_kind_name, significancy_code, significancy_name,
        warning_level, attention_text, kind_issued_at, source_telegram
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `);

    const items: WarningCurrentItem[] = input.items.map((item) => {
      const itemRow = insertItemStmt.get(
        snapshotId,
        item.sequence,
        item.kindCode,
        item.kindName,
        item.kindStatus,
        item.lastKindCode,
        item.lastKindName,
        item.significancyCode,
        item.significancyName,
        item.warningLevel,
        item.attentionText,
        item.kindIssuedAt,
        item.sourceTelegram,
      ) as { id: number };

      return {
        id: Number(itemRow.id),
        ...item,
      };
    });

    return {
      id: snapshotId,
      areaCode: input.areaCode,
      areaName: input.areaName,
      metadata: input.metadata,
      telegram: input.telegram,
      items,
    };
  });

  return saveTx();
}

export function findWarningCurrentSnapshot(
  connection: DatabaseConnection,
  areaCode: string,
  controlStatus: ControlStatus,
): WarningCurrentSnapshot | null {
  validateControlStatus(controlStatus);

  const snapshotRow = connection
    .prepare(
      `
      SELECT * FROM warning_current_snapshot
      WHERE area_code = ? AND control_status = ?
    `,
    )
    .get(areaCode, controlStatus) as WarningCurrentSnapshotRow | undefined;

  if (!snapshotRow) {
    return null;
  }

  const itemRows = connection
    .prepare(
      `
      SELECT * FROM warning_current_item
      WHERE snapshot_id = ?
      ORDER BY sequence ASC, id ASC
    `,
    )
    .all(snapshotRow.id) as WarningCurrentItemRow[];

  const items: WarningCurrentItem[] = itemRows.map((row) => ({
    id: row.id,
    sequence: row.sequence,
    kindCode: row.kind_code,
    kindName: row.kind_name,
    kindStatus: row.kind_status,
    lastKindCode: row.last_kind_code,
    lastKindName: row.last_kind_name,
    significancyCode: row.significancy_code,
    significancyName: row.significancy_name,
    warningLevel: row.warning_level,
    attentionText: row.attention_text,
    kindIssuedAt: row.kind_issued_at,
    sourceTelegram: row.source_telegram,
  }));

  return {
    id: snapshotRow.id,
    areaCode: snapshotRow.area_code,
    areaName: snapshotRow.area_name,
    metadata: mapMetadataRow(snapshotRow),
    telegram: mapTelegramRow(snapshotRow),
    items,
  };
}

export function deleteWarningCurrentSnapshot(
  connection: DatabaseConnection,
  areaCode: string,
  controlStatus: ControlStatus,
): boolean {
  validateControlStatus(controlStatus);
  const result = connection
    .prepare(
      `
      DELETE FROM warning_current_snapshot
      WHERE area_code = ? AND control_status = ?
    `,
    )
    .run(areaCode, controlStatus);

  return result.changes > 0;
}
