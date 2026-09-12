import crypto from 'node:crypto';
import type { Availability, UtcIso8601String } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import { evaluateFreshness } from './freshnessPolicy.js';
import { recordFetchAttempt } from '../repositories/fetchAttemptRepository.js';
import {
  findRadarSnapshot,
  mergeRadarSnapshot,
  saveRadarSnapshot,
  upsertRadarTile,
} from '../repositories/radarRepository.js';
import type {
  NowcastFrameKey,
  RadarProduct,
  RadarSnapshot,
  RadarTile,
} from '../repositories/types.js';
import { performHttpGet } from './httpGet.js';
import {
  calculateNowcastWindow,
  filterNowcastFramesByWindow,
  parseNowcastTargetTimes,
} from './nowcastParser.js';
import {
  buildNowcastTileRelativePath,
  buildNowcastTileUrl,
  getNowcastTargetTimesUrl,
} from './nowcastSource.js';
import { fetchPngBinary, NowcastTileStore, validatePngBuffer } from './nowcastTileStore.js';
import type {
  NowcastAttemptOptions,
  NowcastCatalog,
  NowcastOptions,
  NowcastTileResult,
  TileCoordinate,
} from './nowcastTypes.js';

export class NowcastService {
  readonly connection: DatabaseConnection;
  readonly options: NowcastOptions;
  readonly tileStore: NowcastTileStore;

  private queueN1: Promise<unknown> = Promise.resolve();
  private queueN2: Promise<unknown> = Promise.resolve();

  constructor(connection: DatabaseConnection, options: NowcastOptions) {
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

    if (typeof options.getCatalogAccess !== 'function') {
      throw new Error('getCatalogAccess must be a function');
    }
    if (typeof options.getImageAccess !== 'function') {
      throw new Error('getImageAccess must be a function');
    }
    if (
      !options.freshnessPolicy ||
      typeof options.freshnessPolicy.staleAfterSeconds !== 'number' ||
      !Number.isSafeInteger(options.freshnessPolicy.staleAfterSeconds) ||
      options.freshnessPolicy.staleAfterSeconds <= 0
    ) {
      throw new Error('freshnessPolicy.staleAfterSeconds must be a positive safe integer');
    }

    this.tileStore = new NowcastTileStore(options.cacheRoot);
    // 同期起動処理により、読出し・変更操作より先に清掃を完了させる。
    this.tileStore.cleanOrphanAndTempFiles(connection);
  }

  private getClock(): () => UtcIso8601String {
    return this.options.clock ?? (() => new Date().toISOString() as UtcIso8601String);
  }

  private enqueue<T>(product: RadarProduct, task: () => Promise<T>): Promise<T> {
    if (product === 'N1') {
      const next = this.queueN1.then(task, task);
      this.queueN1 = next.then(
        () => {},
        () => {},
      );
      return next;
    } else {
      const next = this.queueN2.then(task, task);
      this.queueN2 = next.then(
        () => {},
        () => {},
      );
      return next;
    }
  }

  async refreshTimes(options?: NowcastAttemptOptions): Promise<NowcastCatalog> {
    const catalogAccess = this.options.getCatalogAccess();
    if (!catalogAccess.allowed) {
      return this.readCatalog();
    }

    await Promise.all([
      this.refreshProductTimes('N1', options),
      this.refreshProductTimes('N2', options),
    ]);

    return this.readCatalog();
  }

  private async refreshProductTimes(
    product: RadarProduct,
    options?: NowcastAttemptOptions,
  ): Promise<void> {
    return this.enqueue(product, async () => {
      const clock = this.getClock();
      const startedAt = clock();
      const startTime = Date.now();
      const url = getNowcastTargetTimesUrl(product);

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
          errorKind: 'network',
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
        parsedResult = parseNowcastTargetTimes(httpRes.bodyText, product);
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

      // 通信履歴の記録
      recordFetchAttempt(this.connection, {
        sourceKind: `radar_times_${product}`,
        targetRef: product,
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

      if (outcome === 'success' && parsedResult?.ok) {
        const frames = parsedResult.frames;
        let issuedAt: UtcIso8601String;
        let validFrom: UtcIso8601String | null = null;
        let validTo: UtcIso8601String | null = null;

        if (frames.length > 0 && frames[0]) {
          // issuedAt: 採用行の最大 baseTime
          let maxBase = frames[0].key.baseTime;
          let minValid = frames[0].key.validTime;
          let maxValid = frames[0].key.validTime;
          for (const f of frames) {
            if (f.key.baseTime > maxBase) maxBase = f.key.baseTime;
            if (f.key.validTime < minValid) minValid = f.key.validTime;
            if (f.key.validTime > maxValid) maxValid = f.key.validTime;
          }
          issuedAt = maxBase;
          validFrom = minValid;
          validTo = maxValid;
        } else {
          // 空一覧の場合: issuedAt = fetchedAt（設計規約）
          issuedAt = nowIso;
        }

        mergeRadarSnapshot(this.connection, {
          product,
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
          frames: frames.map((f) => ({
            ...f.key,
            sequence: f.sequence,
          })),
        });

        // 不要になったキャッシュの削除
        await this.tileStore.cleanProductUnreferencedTiles(this.connection, product);
      } else {
        // 失敗時: 前回正常値があれば stale で保持
        const prev = findRadarSnapshot(this.connection, product);
        if (prev && prev.metadata.lastSuccessAt !== null) {
          saveRadarSnapshot(this.connection, {
            product,
            metadata: {
              ...prev.metadata,
              fetchedAt: nowIso,
              availability: 'stale',
            },
            frames: prev.frames,
          });
        } else {
          // 初回失敗: 空の unavailable スナップショットを保存
          saveRadarSnapshot(this.connection, {
            product,
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
    });
  }

  readCatalog(): NowcastCatalog {
    const clock = this.getClock();
    const nowIso = clock();
    const window = calculateNowcastWindow(nowIso);
    const catalogAccess = this.options.getCatalogAccess();
    const imageAccess = this.options.getImageAccess();

    const snapN1 = findRadarSnapshot(this.connection, 'N1');
    const snapN2 = findRadarSnapshot(this.connection, 'N2');

    const evalProduct = (product: RadarProduct, snap: RadarSnapshot | null) => {
      if (!snap) {
        return {
          snapshot: null,
          availability: 'unavailable' as Availability,
          frames: [] as readonly NowcastFrameKey[],
        };
      }

      const latestAttemptFailed = snap.metadata.availability === 'stale';
      const availability = evaluateFreshness(
        {
          now: nowIso,
          lastSuccessAt: snap.metadata.lastSuccessAt,
          latestAttemptFailed,
        },
        this.options.freshnessPolicy,
      );

      // 表示窓（now ± 60分）でフィルタ
      const inWindowFrames = filterNowcastFramesByWindow(snap.frames, nowIso);
      const frames: NowcastFrameKey[] = inWindowFrames.map((f) => ({
        product,
        baseTime: f.baseTime,
        validTime: f.validTime,
        element: 'hrpns',
        member: 'none',
      }));

      return {
        snapshot: snap,
        availability,
        frames,
      };
    };

    return {
      now: nowIso,
      window,
      catalogAccess,
      imageAccess,
      products: {
        N1: evalProduct('N1', snapN1),
        N2: evalProduct('N2', snapN2),
      },
    };
  }

  async fetchFrameTiles(
    frame: NowcastFrameKey,
    coordinates: readonly TileCoordinate[],
    options?: NowcastAttemptOptions,
  ): Promise<readonly NowcastTileResult[]> {
    return this.enqueue(frame.product, async () => {
      const clock = this.getClock();
      const nowIso = clock();

      const catalog = this.readCatalog();
      const productCatalog = catalog.products[frame.product];
      const productAvailability = productCatalog.availability;

      // 1. フレーム検証: 表示窓内・当該 product 保存済み一覧に完全一致・hrpns/none
      const validMs = new Date(frame.validTime).getTime();
      const fromMs = new Date(catalog.window.from).getTime();
      const toMs = new Date(catalog.window.to).getTime();
      const inWindow = validMs >= fromMs && validMs <= toMs;

      const frameExists = productCatalog.frames.some(
        (f) =>
          f.baseTime === frame.baseTime &&
          f.validTime === frame.validTime &&
          f.element === frame.element &&
          f.member === frame.member,
      );

      if (!inWindow || !frameExists || frame.element !== 'hrpns' || frame.member !== 'none') {
        return coordinates.map((coord) => ({
          coordinate: coord,
          availability: productAvailability,
          kind: 'unavailable' as const,
          tile: null,
          errorKind: 'frame_not_available',
        }));
      }

      if (coordinates.length === 0) {
        return [];
      }

      // 2. 座標重複除去（入力順序維持）と検証
      const uniqueCoords: TileCoordinate[] = [];
      const seenCoords = new Set<string>();
      for (const c of coordinates) {
        const key = `${c.zoom}/${c.tileX}/${c.tileY}`;
        if (!seenCoords.has(key)) {
          seenCoords.add(key);
          uniqueCoords.push(c);
        }
      }

      const resultsMap = new Map<string, NowcastTileResult>();
      const toFetch: TileCoordinate[] = [];

      // DB の既存タイル
      const snap = findRadarSnapshot(this.connection, frame.product);
      const matchedFrame = snap?.frames.find(
        (f) => f.baseTime === frame.baseTime && f.validTime === frame.validTime,
      );
      const existingTilesMap = new Map<string, RadarTile>();
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
            availability: productAvailability,
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
              availability: productAvailability,
              kind: 'cached',
              tile: existingTile,
            });
            continue;
          }
        }

        toFetch.push(coord);
      }

      if (toFetch.length === 0) {
        return coordinates.map((c) => resultsMap.get(`${c.zoom}/${c.tileX}/${c.tileY}`)!);
      }

      // 3. オンデマンド GET
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
          const key = `${coord.zoom}/${coord.tileX}/${coord.tileY}`;
          const currentImageAccess = this.options.getImageAccess();
          if (!currentImageAccess.allowed) {
            resultsMap.set(key, {
              coordinate: coord,
              availability: productAvailability,
              kind: 'unavailable',
              tile: null,
              errorKind: 'scheduled_stopped',
            });
            continue;
          }

          const tileUrl = buildNowcastTileUrl(
            frame.baseTime,
            frame.validTime,
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
          if (attempt.errorKind !== null || !attempt.buffer) {
            resultsMap.set(key, {
              coordinate: attempt.coord,
              availability: productAvailability,
              kind: 'unavailable',
              tile: null,
              errorKind: attempt.errorKind ?? 'fetch_failed',
            });
          } else {
            const hash = crypto.createHash('sha256').update(attempt.buffer).digest('hex');
            const relPath = buildNowcastTileRelativePath(
              frame.product,
              frame.baseTime,
              frame.validTime,
              attempt.coord.zoom,
              attempt.coord.tileX,
              attempt.coord.tileY,
              hash,
            );

            const saveResult = await this.tileStore.saveTile(relPath, attempt.buffer);
            try {
              const inserted = upsertRadarTile(this.connection, frame, {
                zoom: attempt.coord.zoom,
                tileX: attempt.coord.tileX,
                tileY: attempt.coord.tileY,
                filePath: relPath,
                byteSize: saveResult.byteSize,
                contentHash: saveResult.contentHash,
                storedAt: nowIso,
              });

              if (!inserted) {
                if (saveResult.created)
                  await this.tileStore.deleteTileIfUnreferenced(this.connection, relPath);
                // フレームが消えた場合
                resultsMap.set(key, {
                  coordinate: attempt.coord,
                  availability: productAvailability,
                  kind: 'unavailable',
                  tile: null,
                  errorKind: 'frame_not_available',
                });
              } else {
                resultsMap.set(key, {
                  coordinate: attempt.coord,
                  availability: productAvailability,
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
        // 保存障害でも実施済み GET のみ記録する。後続 GET は行わない。
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
              sourceKind: 'radar_tile',
              targetRef: `${frame.product}:${frame.baseTime}:${frame.validTime}:${frame.element}:${frame.member}`,
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

  async waitForIdle(): Promise<void> {
    await Promise.all([this.queueN1, this.queueN2]);
  }
}
