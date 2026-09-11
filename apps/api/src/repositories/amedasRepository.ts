import type { DatabaseConnection } from '../database/index.js';
import {
  mapMetadataRow,
  validateMetadataInput,
  validateNonEmptyString,
  validateUtcIso8601String,
  type SnapshotMetadataRow,
} from './snapshot.js';
import type { AmedasObservation, AmedasSnapshot, AmedasSnapshotInput } from './types.js';

interface AmedasSnapshotRow extends SnapshotMetadataRow {
  readonly id: number;
  readonly station_code: string;
  readonly station_name: string;
}

interface AmedasObservationRow {
  readonly id: number;
  readonly snapshot_id: number;
  readonly observed_at: string;
  readonly element: string;
  readonly value_number: number | null;
  readonly value_text: string | null;
  readonly quality_flag: number | null;
  readonly is_estimated: number;
}

export function saveAmedasSnapshot(
  connection: DatabaseConnection,
  input: AmedasSnapshotInput,
): AmedasSnapshot {
  validateNonEmptyString(input.stationCode, 'stationCode');
  validateNonEmptyString(input.stationName, 'stationName');
  validateMetadataInput(input.metadata);

  const isStale = input.metadata.availability === 'stale';

  if (!isStale) {
    for (const obs of input.observations) {
      validateUtcIso8601String(obs.observedAt, 'observation.observedAt');
    }
  }

  const saveTx = connection.transaction(() => {
    const upsertStmt = connection.prepare(`
      INSERT INTO amedas_snapshot (
        station_code, station_name, source, issued_at, valid_at, valid_from, valid_to,
        fetched_at, last_success_at, availability, source_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (station_code) DO UPDATE SET
        station_name = excluded.station_name,
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
      input.stationCode,
      input.stationName,
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

    let observations: AmedasObservation[];

    if (isStale) {
      const obsRows = connection
        .prepare(
          `
          SELECT * FROM amedas_observation
          WHERE snapshot_id = ?
          ORDER BY observed_at ASC, element ASC, id ASC
        `,
        )
        .all(snapshotId) as AmedasObservationRow[];

      observations = obsRows.map((obsRow) => ({
        id: obsRow.id,
        observedAt: obsRow.observed_at,
        element: obsRow.element,
        valueNumber: obsRow.value_number,
        valueText: obsRow.value_text,
        qualityFlag: obsRow.quality_flag,
        isEstimated: obsRow.is_estimated === 1,
      }));
    } else {
      connection.prepare('DELETE FROM amedas_observation WHERE snapshot_id = ?').run(snapshotId);

      const insertObsStmt = connection.prepare(`
        INSERT INTO amedas_observation (
          snapshot_id, observed_at, element, value_number, value_text, quality_flag, is_estimated
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING id
      `);

      observations = input.observations.map((obs) => {
        const obsRow = insertObsStmt.get(
          snapshotId,
          obs.observedAt,
          obs.element,
          obs.valueNumber,
          obs.valueText,
          obs.qualityFlag,
          obs.isEstimated ? 1 : 0,
        ) as { id: number };

        return {
          id: Number(obsRow.id),
          ...obs,
        };
      });
    }

    return {
      id: snapshotId,
      stationCode: input.stationCode,
      stationName: input.stationName,
      metadata: input.metadata,
      observations,
    };
  });

  return saveTx();
}

export function findAmedasSnapshot(
  connection: DatabaseConnection,
  stationCode: string,
): AmedasSnapshot | null {
  validateNonEmptyString(stationCode, 'stationCode');

  const snapshotRow = connection
    .prepare(
      `
      SELECT * FROM amedas_snapshot
      WHERE station_code = ?
    `,
    )
    .get(stationCode) as AmedasSnapshotRow | undefined;

  if (!snapshotRow) {
    return null;
  }

  const obsRows = connection
    .prepare(
      `
      SELECT * FROM amedas_observation
      WHERE snapshot_id = ?
      ORDER BY observed_at ASC, element ASC, id ASC
    `,
    )
    .all(snapshotRow.id) as AmedasObservationRow[];

  const observations: AmedasObservation[] = obsRows.map((row) => ({
    id: row.id,
    observedAt: row.observed_at,
    element: row.element,
    valueNumber: row.value_number,
    valueText: row.value_text,
    qualityFlag: row.quality_flag,
    isEstimated: row.is_estimated === 1,
  }));

  return {
    id: snapshotRow.id,
    stationCode: snapshotRow.station_code,
    stationName: snapshotRow.station_name,
    metadata: mapMetadataRow(snapshotRow),
    observations,
  };
}

export function deleteAmedasSnapshot(connection: DatabaseConnection, stationCode: string): boolean {
  validateNonEmptyString(stationCode, 'stationCode');

  const result = connection
    .prepare(
      `
      DELETE FROM amedas_snapshot
      WHERE station_code = ?
    `,
    )
    .run(stationCode);

  return result.changes > 0;
}
