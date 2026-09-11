import crypto from 'node:crypto';
import {
  resolveAvailability,
  type Availability,
  type FreshnessStatus,
  type UtcIso8601String,
} from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import { recordFetchAttempt } from '../repositories/fetchAttemptRepository.js';
import { findRiskSnapshot, saveRiskSnapshot } from '../repositories/riskRepository.js';
import type { RiskTile } from '../repositories/types.js';
import { performHttpGet } from './httpGet.js';
import { parseKikikuruTargetTimes } from './kikikuruParser.js';
import {
  buildKikikuruTileRelativePath,
  buildKikikuruTileUrl,
  KIKIKURU_TARGET_TIMES_URL,
} from './kikikuruSource.js';
import { fetchPngBinary, KikikuruTileStore, validatePngBuffer } from './kikikuruTileStore.js';
import type {
  KikikuruAttemptOptions,
  KikikuruCatalog,
  KikikuruFrameKey,
  KikikuruLayer,
  KikikuruOptions,
  KikikuruTileResult,
  TileCoordinate,
} from './kikikuruTypes.js';

const ALL_LAYERS: readonly KikikuruLayer[] = ['heavyrain', 'inund', 'land'];

export class KikikuruService {
  readonly connection: DatabaseConnection;
  readonly options: KikikuruOptions;
  readonly tileStore: KikikuruTileStore;

  private queueHeavyrain: Promise<unknown> = Promise.resolve();
  private queueInund: Promise<unknown> = Promise.resolve();
  private queueLand: Promise<unknown> = Promise.resolve();
  private queueTimes: Promise<unknown> = Promise.resolve();

  constructor(connection: DatabaseConnection, options: KikikuruOptions) {
    this.connection = connection;
    this.options = options;

    if (!Array.isArray(options.allowedZooms) || options.allowedZooms.length === 0) {
      throw new Error('allowedZooms must be a non-empty array');
    }
    for (const z of options.allowedZooms) {
      if (!Number.isSafeInteger(z) || z < 0 || !Number.isSafeInteger(2 ** z)) {
        throw new Error(`allowedZooms must contain only non-negative integers: ${z}`);
      }
    }

    if (
      !options.staleAfterMs ||
      typeof options.staleAfterMs.heavyrain !== 'number' ||
      !Number.isFinite(options.staleAfterMs.heavyrain) ||
      options.staleAfterMs.heavyrain <= 0 ||
      typeof options.staleAfterMs.inund !== 'number' ||
      !Number.isFinite(options.staleAfterMs.inund) ||
      options.staleAfterMs.inund <= 0 ||
      typeof options.staleAfterMs.land !== 'number' ||
      !Number.isFinite(options.staleAfterMs.land) ||
      options.staleAfterMs.land <= 0
    ) {
      throw new Error(
        'staleAfterMs must define positive finite numbers for heavyrain, inund, and land',
      );
    }

    this.tileStore = new KikikuruTileStore(options.cacheRoot);
    this.tileStore.cleanOrphanAndTempFiles(connection);
  }

  private getClock(): () => UtcIso8601String {
    return this.options.clock ?? (() => new Date().toISOString() as UtcIso8601String);
  }

  private enqueue<T>(layer: KikikuruLayer, task: () => Promise<T>): Promise<T> {
    let queue: Promise<unknown>;
    if (layer === 'heavyrain') queue = this.queueHeavyrain;
    else if (layer === 'inund') queue = this.queueInund;
    else queue = this.queueLand;

    const next = queue.then(task, task);
    const reset = next.then(
      () => {},
      () => {},
    );

    if (layer === 'heavyrain') this.queueHeavyrain = reset;
    else if (layer === 'inund') this.queueInund = reset;
    else this.queueLand = reset;

    return next;
  }

  async refreshTimes(options?: KikikuruAttemptOptions): Promise<KikikuruCatalog> {
    const task = async () => {
      const clock = this.getClock();
      const startedAt = clock();
      const startTime = Date.now();
      const url = KIKIKURU_TARGET_TIMES_URL;

      let httpRes;
      try {
        httpRes = await performHttpGet(url, {
          fetchFn: this.options.fetchFn,
          timeoutMs: this.options.timeoutMs ?? 10_000,
          accept: 'application/json, */*',
        });
      } catch (err: unknown) {
        httpRes = {
          ok: false,
          status: null,
          bodyText: null,
          responseBytes: null,
          errorKind: 'network' as const,
          errorMessage: String(err),
        };
      }

      const durationMs = Date.now() - startTime;
      const finishedAt = clock();
      const triggerKind = options?.triggerKind ?? 'manual';
      const attemptNo = options?.attemptNo ?? 1;

      let outcome: 'success' | 'failure' = 'failure';
      let errorKind: string | null = httpRes.errorKind;
      let errorMessage: string | null = httpRes.errorMessage;
      let contentHash: string | null = null;
      let parsedResult = null;

      if (httpRes.ok && httpRes.bodyText !== null) {
        contentHash = crypto.createHash('sha256').update(httpRes.bodyText).digest('hex');
        parsedResult = parseKikikuruTargetTimes(httpRes.bodyText);
        if (parsedResult.ok) {
          outcome = 'success';
          errorKind = null;
          errorMessage = null;
        } else {
          outcome = 'failure';
          errorKind = parsedResult.errorKind;
          errorMessage = parsedResult.errorMessage;
        }
      }

      // 通信履歴の記録（時刻一覧1回）
      recordFetchAttempt(this.connection, {
        sourceKind: 'risk_target_times',
        targetRef: 'targetTimes',
        requestUrl: url,
        triggerKind,
        attemptNo,
        startedAt,
        finishedAt,
        durationMs,
        outcome,
        httpStatus: httpRes.status,
        responseBytes: httpRes.responseBytes,
        itemCount: null,
        failedItemCount: null,
        contentHash,
        errorKind,
        errorMessage,
      });

      const nowIso = clock();

      await Promise.all(
        ALL_LAYERS.map((layer) =>
          this.enqueue(layer, async () => {
            if (outcome === 'success' && parsedResult?.ok) {
              const layerFrames = parsedResult.framesByLayer[layer];
              let issuedAt: UtcIso8601String;
              let validFrom: UtcIso8601String | null = null;
              let validTo: UtcIso8601String | null = null;

              if (layerFrames.length > 0 && layerFrames[0]) {
                let maxBase = layerFrames[0].key.baseTime;
                let minValid = layerFrames[0].key.validTime;
                let maxValid = layerFrames[0].key.validTime;
                for (const f of layerFrames) {
                  if (f.key.baseTime > maxBase) maxBase = f.key.baseTime;
                  if (f.key.validTime < minValid) minValid = f.key.validTime;
                  if (f.key.validTime > maxValid) maxValid = f.key.validTime;
                }
                issuedAt = maxBase;
                validFrom = minValid;
                validTo = maxValid;
              } else {
                issuedAt = nowIso;
              }

              // 既存スナップショットから既存タイルを引き継ぐ
              const prev = findRiskSnapshot(this.connection, layer);
              const prevTilesMap = new Map<string, readonly RiskTile[]>();
              if (prev?.frames) {
                for (const pf of prev.frames) {
                  const key = `${pf.baseTime}|${pf.validTime}|${pf.imageId}|${pf.member}`;
                  if (pf.tiles && pf.tiles.length > 0) {
                    prevTilesMap.set(key, pf.tiles);
                  }
                }
              }

              saveRiskSnapshot(this.connection, {
                layer,
                metadata: {
                  source: url,
                  issuedAt,
                  validAt: null,
                  validFrom,
                  validTo,
                  fetchedAt: nowIso,
                  lastSuccessAt: nowIso,
                  availability: 'available',
                  sourceVersion: contentHash,
                },
                frames: layerFrames.map((f) => {
                  const key = `${f.key.baseTime}|${f.key.validTime}|${f.key.imageId}|${f.key.member}`;
                  const existingTiles = prevTilesMap.get(key);
                  return {
                    baseTime: f.key.baseTime,
                    validTime: f.key.validTime,
                    imageId: f.key.imageId,
                    member: f.key.member,
                    sequence: f.sequence,
                    tiles: existingTiles?.map((t) => ({
                      zoom: t.zoom,
                      tileX: t.tileX,
                      tileY: t.tileY,
                      filePath: t.filePath,
                      byteSize: t.byteSize,
                      contentHash: t.contentHash,
                      storedAt: t.storedAt,
                    })),
                  };
                }),
              });

              await this.tileStore.cleanLayerUnreferencedTiles(this.connection, layer);
            } else {
              // 失敗時: 前回正常値があれば stale で保持
              const prev = findRiskSnapshot(this.connection, layer);
              if (prev && prev.metadata.lastSuccessAt !== null) {
                saveRiskSnapshot(this.connection, {
                  layer,
                  metadata: {
                    ...prev.metadata,
                    fetchedAt: nowIso,
                    availability: 'stale',
                  },
                  frames: prev.frames,
                });
              } else {
                // 初回失敗: 空の unavailable スナップショットを保存
                saveRiskSnapshot(this.connection, {
                  layer,
                  metadata: {
                    source: url,
                    issuedAt: nowIso,
                    validAt: null,
                    validFrom: null,
                    validTo: null,
                    fetchedAt: nowIso,
                    lastSuccessAt: null,
                    availability: 'unavailable',
                    sourceVersion: null,
                  },
                  frames: [],
                });
              }
            }
          }),
        ),
      );

      return this.readCatalog();
    };

    const next = this.queueTimes.then(task, task);
    this.queueTimes = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  readCatalog(): KikikuruCatalog {
    const clock = this.getClock();
    const nowIso = clock();

    const evalLayer = (layer: KikikuruLayer) => {
      const snap = findRiskSnapshot(this.connection, layer);
      if (!snap) {
        return {
          snapshot: null,
          availability: 'unavailable' as Availability,
          frames: [] as readonly KikikuruFrameKey[],
        };
      }

      const hasLastNormalValue = snap.metadata.lastSuccessAt !== null;
      let freshness: FreshnessStatus = 'normal';

      if (snap.metadata.availability === 'stale' || snap.metadata.availability === 'unavailable') {
        freshness = 'abnormal';
      } else if (snap.metadata.lastSuccessAt !== null) {
        const lastSuccessMs = new Date(snap.metadata.lastSuccessAt).getTime();
        const nowMs = new Date(nowIso).getTime();
        const elapsedMs = nowMs - lastSuccessMs;
        if (elapsedMs >= this.options.staleAfterMs[layer]) {
          freshness = 'delayed';
        } else {
          freshness = 'normal';
        }
      } else {
        freshness = 'abnormal';
      }

      const availability = resolveAvailability({ hasLastNormalValue, freshness });

      // 全フレームを返す（3時間窓などの絞り込みはしない）
      const frames: KikikuruFrameKey[] = snap.frames.map((f) => ({
        layer,
        baseTime: f.baseTime,
        validTime: f.validTime,
        imageId: f.imageId,
        member: f.member,
      }));

      return {
        snapshot: snap,
        availability,
        frames,
      };
    };

    return {
      now: nowIso,
      layers: {
        heavyrain: evalLayer('heavyrain'),
        inund: evalLayer('inund'),
        land: evalLayer('land'),
      },
    };
  }

  async fetchFrameTiles(
    frame: KikikuruFrameKey,
    coordinates: readonly TileCoordinate[],
    options?: KikikuruAttemptOptions,
  ): Promise<readonly KikikuruTileResult[]> {
    return this.enqueue(frame.layer, async () => {
      const clock = this.getClock();
      const nowIso = clock();

      const catalog = this.readCatalog();
      const layerCatalog = catalog.layers[frame.layer];
      const layerAvailability = layerCatalog.availability;

      // フレーム検証: 保存済み一覧に完全一致して存在するか
      const frameExists = layerCatalog.frames.some(
        (f) =>
          f.baseTime === frame.baseTime &&
          f.validTime === frame.validTime &&
          f.imageId === frame.imageId &&
          f.member === frame.member,
      );

      if (!frameExists) {
        return coordinates.map((coord) => ({
          coordinate: coord,
          availability: layerAvailability,
          kind: 'unavailable' as const,
          tile: null,
          errorKind: 'frame_not_available',
        }));
      }

      if (coordinates.length === 0) {
        return [];
      }

      // 座標重複除去（入力順序維持）と検証
      const uniqueCoords: TileCoordinate[] = [];
      const seenCoords = new Set<string>();
      for (const c of coordinates) {
        const key = `${c.zoom}/${c.tileX}/${c.tileY}`;
        if (!seenCoords.has(key)) {
          seenCoords.add(key);
          uniqueCoords.push(c);
        }
      }

      const resultsMap = new Map<string, KikikuruTileResult>();
      const toFetch: TileCoordinate[] = [];

      // DB の既存タイル
      const snap = findRiskSnapshot(this.connection, frame.layer);
      const matchedFrame = snap?.frames.find(
        (f) =>
          f.baseTime === frame.baseTime &&
          f.validTime === frame.validTime &&
          f.imageId === frame.imageId &&
          f.member === frame.member,
      );
      const existingTilesMap = new Map<string, RiskTile>();
      if (matchedFrame?.tiles) {
        for (const t of matchedFrame.tiles) {
          existingTilesMap.set(`${t.zoom}/${t.tileX}/${t.tileY}`, t);
        }
      }

      for (const coord of uniqueCoords) {
        const key = `${coord.zoom}/${coord.tileX}/${coord.tileY}`;

        // 座標形式検証
        const isZoomAllowed = this.options.allowedZooms.includes(coord.zoom);
        const maxCoord = 2 ** coord.zoom;
        const isCoordValid =
          Number.isSafeInteger(coord.zoom) &&
          Number.isSafeInteger(coord.tileX) &&
          Number.isSafeInteger(coord.tileY) &&
          isZoomAllowed &&
          coord.tileX >= 0 &&
          coord.tileX < maxCoord &&
          coord.tileY >= 0 &&
          coord.tileY < maxCoord;

        if (!isCoordValid) {
          resultsMap.set(key, {
            coordinate: coord,
            availability: layerAvailability,
            kind: 'unavailable',
            tile: null,
            errorKind: 'invalid_coordinate',
          });
          continue;
        }

        // キャッシュ確認
        const existingTile = existingTilesMap.get(key);
        if (existingTile) {
          const verified = await this.tileStore.verifyTile(
            existingTile.filePath,
            existingTile.byteSize,
            existingTile.contentHash,
          );
          if (verified.valid) {
            resultsMap.set(key, {
              coordinate: coord,
              availability: layerAvailability,
              kind: 'cached',
              tile: existingTile,
            });
            continue;
          }
        }

        // キャッシュミス時の扱い
        if (layerAvailability === 'stale') {
          // 一覧が stale の場合のキャッシュミスは新規 GET を抑止し catalog_stale
          resultsMap.set(key, {
            coordinate: coord,
            availability: 'stale',
            kind: 'unavailable',
            tile: null,
            errorKind: 'catalog_stale',
          });
          continue;
        }

        toFetch.push(coord);
      }

      if (toFetch.length === 0) {
        return coordinates.map((c) => resultsMap.get(`${c.zoom}/${c.tileX}/${c.tileY}`)!);
      }

      // オンデマンド GET
      const getAttempts: {
        coord: TileCoordinate;
        url: string;
        durationMs: number;
        status: number | null;
        bytes: number | null;
        buffer: Buffer | null;
        errorKind: string | null;
        errorMessage: string | null;
      }[] = [];

      const operationErrors: unknown[] = [];
      const startedAt = clock();

      try {
        for (const coord of toFetch) {
          const tileUrl = buildKikikuruTileUrl(
            frame.baseTime,
            frame.validTime,
            frame.member,
            frame.imageId,
            coord.zoom,
            coord.tileX,
            coord.tileY,
          );

          const res = await fetchPngBinary(tileUrl, {
            fetchFn: this.options.fetchFn,
            timeoutMs: this.options.timeoutMs,
          });

          if (res.ok && res.buffer) {
            const pngValid = validatePngBuffer(res.buffer);
            if (!pngValid.ok) {
              getAttempts.push({
                coord,
                url: tileUrl,
                durationMs: res.durationMs,
                status: res.status,
                bytes: res.responseBytes,
                buffer: null,
                errorKind: 'invalid_png',
                errorMessage: pngValid.reason ?? 'Invalid PNG',
              });
            } else {
              getAttempts.push({
                coord,
                url: tileUrl,
                durationMs: res.durationMs,
                status: res.status,
                bytes: res.responseBytes,
                buffer: res.buffer,
                errorKind: null,
                errorMessage: null,
              });
            }
          } else {
            getAttempts.push({
              coord,
              url: tileUrl,
              durationMs: res.durationMs,
              status: res.status,
              bytes: res.responseBytes,
              buffer: null,
              errorKind: res.errorKind,
              errorMessage: res.errorMessage,
            });
          }

          const attempt = getAttempts[getAttempts.length - 1]!;
          const key = `${attempt.coord.zoom}/${attempt.coord.tileX}/${attempt.coord.tileY}`;

          if (attempt.errorKind !== null || !attempt.buffer) {
            resultsMap.set(key, {
              coordinate: attempt.coord,
              availability: layerAvailability,
              kind: 'unavailable',
              tile: null,
              errorKind: attempt.errorKind ?? 'fetch_failed',
            });
          } else {
            const hash = crypto.createHash('sha256').update(attempt.buffer).digest('hex');
            const relPath = buildKikikuruTileRelativePath(
              frame.layer,
              frame.baseTime,
              frame.member,
              frame.validTime,
              frame.imageId,
              attempt.coord.zoom,
              attempt.coord.tileX,
              attempt.coord.tileY,
              hash,
            );

            const saveResult = await this.tileStore.saveTile(relPath, attempt.buffer);
            try {
              const upsertTx = this.connection.transaction(() => {
                const frameRow = this.connection
                  .prepare(
                    `
                    SELECT rf.id FROM risk_frame rf
                    JOIN risk_snapshot rs ON rf.snapshot_id = rs.id
                    WHERE rs.layer = ? AND rf.base_time = ? AND rf.valid_time = ? AND rf.image_id = ? AND rf.member = ?
                  `,
                  )
                  .get(
                    frame.layer,
                    frame.baseTime,
                    frame.validTime,
                    frame.imageId,
                    frame.member,
                  ) as { id: number } | undefined;

                if (!frameRow) {
                  return null;
                }

                const frameId = Number(frameRow.id);
                const stmt = this.connection.prepare(`
                  INSERT INTO risk_tile (
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
                  attempt.coord.zoom,
                  attempt.coord.tileX,
                  attempt.coord.tileY,
                  relPath,
                  saveResult.byteSize,
                  saveResult.contentHash,
                  nowIso,
                ) as { id: number };

                const tile: RiskTile = {
                  id: Number(result.id),
                  zoom: attempt.coord.zoom,
                  tileX: attempt.coord.tileX,
                  tileY: attempt.coord.tileY,
                  filePath: relPath,
                  byteSize: saveResult.byteSize,
                  contentHash: saveResult.contentHash,
                  storedAt: nowIso,
                };
                return tile;
              });

              const inserted = upsertTx();

              if (!inserted) {
                if (saveResult.created) {
                  await this.tileStore.deleteTileIfUnreferenced(this.connection, relPath);
                }
                resultsMap.set(key, {
                  coordinate: attempt.coord,
                  availability: layerAvailability,
                  kind: 'unavailable',
                  tile: null,
                  errorKind: 'frame_not_available',
                });
              } else {
                resultsMap.set(key, {
                  coordinate: attempt.coord,
                  availability: layerAvailability,
                  kind: 'downloaded',
                  tile: inserted,
                });
              }
            } catch (error) {
              if (saveResult.created) {
                try {
                  await this.tileStore.deleteTileIfUnreferenced(this.connection, relPath);
                } catch (cleanupError) {
                  throw new AggregateError(
                    [error, cleanupError],
                    'タイル保存と後始末に失敗しました',
                  );
                }
              }
              throw error;
            }
          }
        }
      } catch (error) {
        operationErrors.push(error);
      } finally {
        if (getAttempts.length > 0 && getAttempts[0]) {
          const finishedAt = clock();
          const totalDurationMs = getAttempts.reduce((sum, a) => sum + a.durationMs, 0);
          const failedCount = getAttempts.filter((a) => a.errorKind !== null).length;
          const totalBytes = getAttempts.reduce(
            (sum, a) => (a.bytes !== null ? sum + a.bytes : sum),
            0,
          );
          const allBytesNull = getAttempts.every((a) => a.bytes === null);

          const firstStatus = getAttempts[0].status;
          const allSameStatus = getAttempts.every(
            (a) => a.status !== null && a.status === firstStatus,
          );
          const httpStatus = allSameStatus ? firstStatus : null;

          const firstFailure = getAttempts.find((a) => a.errorKind !== null);

          try {
            recordFetchAttempt(this.connection, {
              sourceKind: 'risk_tile_frame',
              targetRef: `${frame.layer}:${frame.baseTime}:${frame.validTime}:${frame.imageId}:${frame.member}`,
              requestUrl: getAttempts[0].url,
              triggerKind: options?.triggerKind ?? 'manual',
              attemptNo: options?.attemptNo ?? 1,
              startedAt,
              finishedAt,
              durationMs: totalDurationMs,
              outcome: failedCount > 0 ? 'failure' : 'success',
              httpStatus,
              responseBytes: allBytesNull ? null : totalBytes,
              itemCount: getAttempts.length,
              failedItemCount: failedCount,
              contentHash: null,
              errorKind: firstFailure?.errorKind ?? null,
              errorMessage: firstFailure?.errorMessage ?? null,
            });
          } catch (historyError) {
            operationErrors.push(historyError);
          }
        }
      }

      if (operationErrors.length > 1) {
        throw new AggregateError(operationErrors, 'タイル保存と通信履歴の保存に失敗しました');
      }
      if (operationErrors.length === 1) throw operationErrors[0];
      return coordinates.map((c) => resultsMap.get(`${c.zoom}/${c.tileX}/${c.tileY}`)!);
    });
  }
}
