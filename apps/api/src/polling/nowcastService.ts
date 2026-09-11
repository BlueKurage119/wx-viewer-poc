import crypto from 'node:crypto';
import {
  resolveAvailability,
  type Availability,
  type FreshnessStatus,
  type UtcIso8601String,
} from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
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
      if (!Number.isInteger(z) || z < 0) {
        throw new Error(`allowedZooms must contain only non-negative integers: ${z}`);
      }
    }

    if (
      !options.staleAfterMs ||
      typeof options.staleAfterMs.N1 !== 'number' ||
      !Number.isFinite(options.staleAfterMs.N1) ||
      options.staleAfterMs.N1 <= 0 ||
      typeof options.staleAfterMs.N2 !== 'number' ||
      !Number.isFinite(options.staleAfterMs.N2) ||
      options.staleAfterMs.N2 <= 0
    ) {
      throw new Error('staleAfterMs must define positive finite numbers for both N1 and N2');
    }

    this.tileStore = new NowcastTileStore(options.cacheRoot);
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

      const hasLastNormalValue = snap.metadata.lastSuccessAt !== null;
      let freshness: FreshnessStatus = 'normal';

      if (snap.metadata.availability === 'stale' || snap.metadata.availability === 'unavailable') {
        freshness = 'abnormal';
      } else if (snap.metadata.lastSuccessAt !== null) {
        const lastSuccessMs = new Date(snap.metadata.lastSuccessAt).getTime();
        const nowMs = new Date(nowIso).getTime();
        const elapsedMs = nowMs - lastSuccessMs;
        if (elapsedMs >= this.options.staleAfterMs[product]) {
          freshness = 'delayed';
        } else {
          freshness = 'normal';
        }
      } else {
        freshness = 'abnormal';
      }

      const availability = resolveAvailability({ hasLastNormalValue, freshness });

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
          Number.isInteger(coord.zoom) &&
          Number.isInteger(coord.tileX) &&
          Number.isInteger(coord.tileY) &&
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

        // キャッシュミス時の扱い
        if (productAvailability === 'stale') {
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

      const newlySavedFiles: string[] = [];
      const startedAt = clock();

      try {
        for (const coord of toFetch) {
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
        }
      } finally {
        // finally で実施済み GET を集約記録（保存処理前に記録）
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
          } catch {
            // 履歴自体の保存失敗はログ等で残すが、以後の保存例外と併記できるよう考慮
          }
        }
      }

      // 成功タイルの保存と結果反映
      try {
        for (const attempt of getAttempts) {
          const key = `${attempt.coord.zoom}/${attempt.coord.tileX}/${attempt.coord.tileY}`;
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
            newlySavedFiles.push(relPath);

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
          }
        }
      } catch (saveErr) {
        // 保存障害時のロールバック: 今回新規作成した本体を削除
        for (const f of newlySavedFiles) {
          await this.tileStore.deleteTile(f);
        }
        throw saveErr;
      }

      return coordinates.map((c) => resultsMap.get(`${c.zoom}/${c.tileX}/${c.tileY}`)!);
    });
  }
}
