import type { DatabaseConnection } from '../database/index.js';
import {
  mapMetadataRow,
  validateMetadataInput,
  validateTileRelativePath,
  type SnapshotMetadataRow,
} from './snapshot.js';
import type { RiskFrame, RiskLayer, RiskSnapshot, RiskSnapshotInput, RiskTile } from './types.js';

interface RiskSnapshotRow extends SnapshotMetadataRow {
  readonly id: number;
  readonly layer: string;
}

interface RiskFrameRow {
  readonly id: number;
  readonly snapshot_id: number;
  readonly base_time: string;
  readonly valid_time: string;
  readonly image_id: string;
  readonly member: string;
  readonly sequence: number;
}

interface RiskTileRow {
  readonly id: number;
  readonly frame_id: number;
  readonly zoom: number;
  readonly tile_x: number;
  readonly tile_y: number;
  readonly file_path: string;
  readonly byte_size: number;
  readonly content_hash: string;
  readonly stored_at: string;
}

const VALID_LAYERS: ReadonlySet<string> = new Set<RiskLayer>([
  'heavyrain',
  'inund',
  'land',
  'flood',
]);

function validateLayer(layer: string): asserts layer is RiskLayer {
  if (!VALID_LAYERS.has(layer)) {
    throw new Error(`Invalid risk layer: ${layer}`);
  }
}

export function saveRiskSnapshot(
  connection: DatabaseConnection,
  input: RiskSnapshotInput,
): RiskSnapshot {
  validateLayer(input.layer);
  validateMetadataInput(input.metadata);

  for (const frame of input.frames) {
    if (frame.tiles) {
      for (const tile of frame.tiles) {
        validateTileRelativePath(tile.filePath);
      }
    }
  }

  const saveTx = connection.transaction(() => {
    const upsertStmt = connection.prepare(`
      INSERT INTO risk_snapshot (
        layer, source, issued_at, valid_at, valid_from, valid_to,
        fetched_at, last_success_at, availability, source_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (layer) DO UPDATE SET
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
      input.layer,
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

    connection.prepare('DELETE FROM risk_frame WHERE snapshot_id = ?').run(snapshotId);

    const insertFrameStmt = connection.prepare(`
      INSERT INTO risk_frame (
        snapshot_id, base_time, valid_time, image_id, member, sequence
      ) VALUES (?, ?, ?, ?, ?, ?)
      RETURNING id
    `);

    const insertTileStmt = connection.prepare(`
      INSERT INTO risk_tile (
        frame_id, zoom, tile_x, tile_y, file_path, byte_size, content_hash, stored_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `);

    const frames: RiskFrame[] = input.frames.map((frame) => {
      const fRow = insertFrameStmt.get(
        snapshotId,
        frame.baseTime,
        frame.validTime,
        frame.imageId,
        frame.member,
        frame.sequence,
      ) as { id: number };

      const frameId = Number(fRow.id);
      const tiles: RiskTile[] = (frame.tiles ?? []).map((t) => {
        const tRow = insertTileStmt.get(
          frameId,
          t.zoom,
          t.tileX,
          t.tileY,
          t.filePath,
          t.byteSize,
          t.contentHash,
          t.storedAt,
        ) as { id: number };

        return {
          id: Number(tRow.id),
          ...t,
        };
      });

      return {
        id: frameId,
        baseTime: frame.baseTime,
        validTime: frame.validTime,
        imageId: frame.imageId,
        member: frame.member,
        sequence: frame.sequence,
        tiles,
      };
    });

    return {
      id: snapshotId,
      layer: input.layer,
      metadata: input.metadata,
      frames,
    };
  });

  return saveTx();
}

export function findRiskSnapshot(
  connection: DatabaseConnection,
  layer: RiskLayer,
): RiskSnapshot | null {
  validateLayer(layer);

  const snapshotRow = connection
    .prepare(
      `
      SELECT * FROM risk_snapshot
      WHERE layer = ?
    `,
    )
    .get(layer) as RiskSnapshotRow | undefined;

  if (!snapshotRow) {
    return null;
  }

  const frameRows = connection
    .prepare(
      `
      SELECT * FROM risk_frame
      WHERE snapshot_id = ?
      ORDER BY sequence ASC, id ASC
    `,
    )
    .all(snapshotRow.id) as RiskFrameRow[];

  const frames: RiskFrame[] = frameRows.map((fRow) => {
    const tileRows = connection
      .prepare(
        `
        SELECT * FROM risk_tile
        WHERE frame_id = ?
        ORDER BY zoom ASC, tile_x ASC, tile_y ASC, id ASC
      `,
      )
      .all(fRow.id) as RiskTileRow[];

    const tiles: RiskTile[] = tileRows.map((tRow) => ({
      id: tRow.id,
      zoom: tRow.zoom,
      tileX: tRow.tile_x,
      tileY: tRow.tile_y,
      filePath: tRow.file_path,
      byteSize: tRow.byte_size,
      contentHash: tRow.content_hash,
      storedAt: tRow.stored_at,
    }));

    return {
      id: fRow.id,
      baseTime: fRow.base_time,
      validTime: fRow.valid_time,
      imageId: fRow.image_id,
      member: fRow.member,
      sequence: fRow.sequence,
      tiles,
    };
  });

  return {
    id: snapshotRow.id,
    layer: snapshotRow.layer as RiskLayer,
    metadata: mapMetadataRow(snapshotRow),
    frames,
  };
}

export function deleteRiskSnapshot(connection: DatabaseConnection, layer: RiskLayer): boolean {
  validateLayer(layer);

  const result = connection
    .prepare(
      `
      DELETE FROM risk_snapshot
      WHERE layer = ?
    `,
    )
    .run(layer);

  return result.changes > 0;
}
