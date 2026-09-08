import type { DatabaseConnection } from '../database/index.js';
import {
  mapMetadataRow,
  validateMetadataInput,
  validateTileRelativePath,
  type SnapshotMetadataRow,
} from './snapshot.js';
import type {
  RadarFrame,
  RadarProduct,
  RadarSnapshot,
  RadarSnapshotInput,
  RadarTile,
} from './types.js';

interface RadarSnapshotRow extends SnapshotMetadataRow {
  readonly id: number;
  readonly product: string;
}

interface RadarFrameRow {
  readonly id: number;
  readonly snapshot_id: number;
  readonly base_time: string;
  readonly valid_time: string;
  readonly element: string;
  readonly member: string;
  readonly sequence: number;
}

interface RadarTileRow {
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

function validateProduct(product: string): asserts product is RadarProduct {
  if (product !== 'N1' && product !== 'N2') {
    throw new Error(`Invalid radar product: ${product}`);
  }
}

export function saveRadarSnapshot(
  connection: DatabaseConnection,
  input: RadarSnapshotInput,
): RadarSnapshot {
  validateProduct(input.product);
  validateMetadataInput(input.metadata);

  // タイルパス等のバリデーション
  for (const frame of input.frames) {
    if (frame.tiles) {
      for (const tile of frame.tiles) {
        validateTileRelativePath(tile.filePath);
      }
    }
  }

  const saveTx = connection.transaction(() => {
    const upsertStmt = connection.prepare(`
      INSERT INTO radar_snapshot (
        product, source, issued_at, valid_at, valid_from, valid_to,
        fetched_at, last_success_at, availability, source_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (product) DO UPDATE SET
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
      input.product,
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

    // frame 削除で tile も CASCADE される
    connection.prepare('DELETE FROM radar_frame WHERE snapshot_id = ?').run(snapshotId);

    const insertFrameStmt = connection.prepare(`
      INSERT INTO radar_frame (
        snapshot_id, base_time, valid_time, element, member, sequence
      ) VALUES (?, ?, ?, ?, ?, ?)
      RETURNING id
    `);

    const insertTileStmt = connection.prepare(`
      INSERT INTO radar_tile (
        frame_id, zoom, tile_x, tile_y, file_path, byte_size, content_hash, stored_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `);

    const frames: RadarFrame[] = input.frames.map((frame) => {
      const fRow = insertFrameStmt.get(
        snapshotId,
        frame.baseTime,
        frame.validTime,
        frame.element,
        frame.member,
        frame.sequence,
      ) as { id: number };

      const frameId = Number(fRow.id);
      const tiles: RadarTile[] = (frame.tiles ?? []).map((t) => {
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
        element: frame.element,
        member: frame.member,
        sequence: frame.sequence,
        tiles,
      };
    });

    return {
      id: snapshotId,
      product: input.product,
      metadata: input.metadata,
      frames,
    };
  });

  return saveTx();
}

export function findRadarSnapshot(
  connection: DatabaseConnection,
  product: RadarProduct,
): RadarSnapshot | null {
  validateProduct(product);

  const snapshotRow = connection
    .prepare(
      `
      SELECT * FROM radar_snapshot
      WHERE product = ?
    `,
    )
    .get(product) as RadarSnapshotRow | undefined;

  if (!snapshotRow) {
    return null;
  }

  const frameRows = connection
    .prepare(
      `
      SELECT * FROM radar_frame
      WHERE snapshot_id = ?
      ORDER BY sequence ASC, id ASC
    `,
    )
    .all(snapshotRow.id) as RadarFrameRow[];

  const frames: RadarFrame[] = frameRows.map((fRow) => {
    const tileRows = connection
      .prepare(
        `
        SELECT * FROM radar_tile
        WHERE frame_id = ?
        ORDER BY zoom ASC, tile_x ASC, tile_y ASC, id ASC
      `,
      )
      .all(fRow.id) as RadarTileRow[];

    const tiles: RadarTile[] = tileRows.map((tRow) => ({
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
      element: fRow.element,
      member: fRow.member,
      sequence: fRow.sequence,
      tiles,
    };
  });

  return {
    id: snapshotRow.id,
    product: snapshotRow.product as RadarProduct,
    metadata: mapMetadataRow(snapshotRow),
    frames,
  };
}

export function deleteRadarSnapshot(
  connection: DatabaseConnection,
  product: RadarProduct,
): boolean {
  validateProduct(product);

  const result = connection
    .prepare(
      `
      DELETE FROM radar_snapshot
      WHERE product = ?
    `,
    )
    .run(product);

  return result.changes > 0;
}
