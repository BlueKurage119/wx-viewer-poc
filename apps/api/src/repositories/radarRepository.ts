import type { DatabaseConnection } from '../database/index.js';
import {
  mapMetadataRow,
  validateMetadataInput,
  validateNonEmptyString,
  validateTileRelativePath,
  validateUtcIso8601String,
  type SnapshotMetadataRow,
} from './snapshot.js';
import type {
  NowcastFrameKey,
  RadarFrame,
  RadarProduct,
  RadarSnapshot,
  RadarSnapshotInput,
  RadarTile,
  RadarTileInput,
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

  const isStale = input.metadata.availability === 'stale';

  if (!isStale) {
    for (const frame of input.frames) {
      validateUtcIso8601String(frame.baseTime, 'frame.baseTime');
      validateUtcIso8601String(frame.validTime, 'frame.validTime');
      if (frame.tiles) {
        for (const tile of frame.tiles) {
          validateUtcIso8601String(tile.storedAt, 'tile.storedAt');
          validateTileRelativePath(tile.filePath);
        }
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

    let frames: RadarFrame[];

    if (isStale) {
      const frameRows = connection
        .prepare(
          `
          SELECT * FROM radar_frame
          WHERE snapshot_id = ?
          ORDER BY sequence ASC, id ASC
        `,
        )
        .all(snapshotId) as RadarFrameRow[];

      const tileStmt = connection.prepare(`
        SELECT * FROM radar_tile
        WHERE frame_id = ?
        ORDER BY zoom ASC, tile_x ASC, tile_y ASC, id ASC
      `);

      frames = frameRows.map((fRow) => {
        const tileRows = tileStmt.all(fRow.id) as RadarTileRow[];
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
    } else {
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

      frames = input.frames.map((frame) => {
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
    }

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

function validateRadarTileInput(tile: RadarTileInput): void {
  if (!Number.isInteger(tile.zoom) || tile.zoom < 0) {
    throw new Error(`zoom must be a non-negative integer: ${tile.zoom}`);
  }
  if (!Number.isInteger(tile.tileX) || tile.tileX < 0) {
    throw new Error(`tileX must be a non-negative integer: ${tile.tileX}`);
  }
  if (!Number.isInteger(tile.tileY) || tile.tileY < 0) {
    throw new Error(`tileY must be a non-negative integer: ${tile.tileY}`);
  }
  if (!Number.isInteger(tile.byteSize) || tile.byteSize < 0) {
    throw new Error(`byteSize must be a non-negative integer: ${tile.byteSize}`);
  }
  validateNonEmptyString(tile.contentHash, 'tile.contentHash');
  validateUtcIso8601String(tile.storedAt, 'tile.storedAt');
  validateTileRelativePath(tile.filePath);
}

export function mergeRadarSnapshot(
  connection: DatabaseConnection,
  input: RadarSnapshotInput,
): RadarSnapshot {
  validateProduct(input.product);
  validateMetadataInput(input.metadata);

  for (const frame of input.frames) {
    validateUtcIso8601String(frame.baseTime, 'frame.baseTime');
    validateUtcIso8601String(frame.validTime, 'frame.validTime');
    if (frame.tiles) {
      for (const tile of frame.tiles) {
        validateRadarTileInput(tile);
      }
    }
  }

  const mergeTx = connection.transaction(() => {
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

    const existingFrames = connection
      .prepare(
        `
        SELECT * FROM radar_frame
        WHERE snapshot_id = ?
      `,
      )
      .all(snapshotId) as RadarFrameRow[];

    const existingFrameMap = new Map<string, RadarFrameRow>();
    for (const f of existingFrames) {
      const key = `${f.base_time}|${f.valid_time}|${f.element}|${f.member}`;
      existingFrameMap.set(key, f);
    }

    const insertFrameStmt = connection.prepare(`
      INSERT INTO radar_frame (
        snapshot_id, base_time, valid_time, element, member, sequence
      ) VALUES (?, ?, ?, ?, ?, ?)
      RETURNING id
    `);

    const updateFrameSeqStmt = connection.prepare(`
      UPDATE radar_frame
      SET sequence = ?
      WHERE id = ?
    `);

    const insertTileStmt = connection.prepare(`
      INSERT INTO radar_tile (
        frame_id, zoom, tile_x, tile_y, file_path, byte_size, content_hash, stored_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (frame_id, zoom, tile_x, tile_y) DO UPDATE SET
        file_path = excluded.file_path,
        byte_size = excluded.byte_size,
        content_hash = excluded.content_hash,
        stored_at = excluded.stored_at
      RETURNING id
    `);

    const retainedFrameIds = new Set<number>();

    for (const frame of input.frames) {
      const key = `${frame.baseTime}|${frame.validTime}|${frame.element}|${frame.member}`;
      const existing = existingFrameMap.get(key);

      let frameId: number;
      if (existing) {
        frameId = existing.id;
        if (existing.sequence !== frame.sequence) {
          updateFrameSeqStmt.run(frame.sequence, frameId);
        }
      } else {
        const fRow = insertFrameStmt.get(
          snapshotId,
          frame.baseTime,
          frame.validTime,
          frame.element,
          frame.member,
          frame.sequence,
        ) as { id: number };
        frameId = Number(fRow.id);
      }

      retainedFrameIds.add(frameId);

      if (frame.tiles) {
        for (const t of frame.tiles) {
          insertTileStmt.run(
            frameId,
            t.zoom,
            t.tileX,
            t.tileY,
            t.filePath,
            t.byteSize,
            t.contentHash,
            t.storedAt,
          );
        }
      }
    }

    for (const existing of existingFrames) {
      if (!retainedFrameIds.has(existing.id)) {
        connection.prepare('DELETE FROM radar_frame WHERE id = ?').run(existing.id);
      }
    }

    const finalFrameRows = connection
      .prepare(
        `
        SELECT * FROM radar_frame
        WHERE snapshot_id = ?
        ORDER BY sequence ASC, id ASC
      `,
      )
      .all(snapshotId) as RadarFrameRow[];

    const tileStmt = connection.prepare(`
      SELECT * FROM radar_tile
      WHERE frame_id = ?
      ORDER BY zoom ASC, tile_x ASC, tile_y ASC, id ASC
    `);

    const frames: RadarFrame[] = finalFrameRows.map((fRow) => {
      const tileRows = tileStmt.all(fRow.id) as RadarTileRow[];
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
      id: snapshotId,
      product: input.product,
      metadata: input.metadata,
      frames,
    };
  });

  return mergeTx();
}

export function upsertRadarTile(
  connection: DatabaseConnection,
  frame: NowcastFrameKey,
  tile: RadarTileInput,
): RadarTile | null {
  validateProduct(frame.product);
  validateUtcIso8601String(frame.baseTime, 'frame.baseTime');
  validateUtcIso8601String(frame.validTime, 'frame.validTime');
  validateRadarTileInput(tile);

  const upsertTx = connection.transaction(() => {
    const frameRow = connection
      .prepare(
        `
        SELECT rf.id FROM radar_frame rf
        JOIN radar_snapshot rs ON rf.snapshot_id = rs.id
        WHERE rs.product = ? AND rf.base_time = ? AND rf.valid_time = ? AND rf.element = ? AND rf.member = ?
      `,
      )
      .get(frame.product, frame.baseTime, frame.validTime, frame.element, frame.member) as
      { id: number } | undefined;

    if (!frameRow) {
      return null;
    }

    const frameId = Number(frameRow.id);

    const stmt = connection.prepare(`
      INSERT INTO radar_tile (
        frame_id, zoom, tile_x, tile_y, file_path, byte_size, content_hash, stored_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (frame_id, zoom, tile_x, tile_y) DO UPDATE SET
        file_path = excluded.file_path,
        byte_size = excluded.byte_size,
        content_hash = excluded.content_hash,
        stored_at = excluded.stored_at
      RETURNING id
    `);

    const result = stmt.get(
      frameId,
      tile.zoom,
      tile.tileX,
      tile.tileY,
      tile.filePath,
      tile.byteSize,
      tile.contentHash,
      tile.storedAt,
    ) as { id: number };

    return {
      id: Number(result.id),
      ...tile,
    };
  });

  return upsertTx();
}
