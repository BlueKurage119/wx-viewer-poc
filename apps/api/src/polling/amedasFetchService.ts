import crypto from 'node:crypto';
import {
  resolveAvailability,
  type Availability,
  type UtcIso8601String,
  type VenueId,
} from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import { findAmedasSnapshot, saveAmedasSnapshot } from '../repositories/amedasRepository.js';
import { recordFetchAttempt } from '../repositories/fetchAttemptRepository.js';
import type {
  AmedasObservationInput,
  AmedasSnapshot,
  FetchAttemptInput,
} from '../repositories/types.js';
import { resolveAmedasTarget } from '../venueForecastTargets.js';
import {
  parseAmedasLatestTime,
  parseAmedasPointBlock,
  type AmedasBlockNormalization,
} from './amedasParser.js';
import {
  AMEDAS_LATEST_TIME_SOURCE_KIND,
  AMEDAS_LATEST_TIME_URL,
  AMEDAS_POINT_SOURCE_KIND,
  buildPointBlockUrl,
  resolveBlockKey,
} from './amedasSource.js';
import { performHttpGet, sanitizeUrl } from './httpGet.js';

export interface AmedasStreamStatus {
  readonly availability: Availability;
  readonly attempted: boolean;
  readonly succeeded: boolean;
  readonly attemptedAt: UtcIso8601String | null;
  readonly lastSuccessAt: UtcIso8601String | null;
  readonly consecutiveFailures: number;
  readonly errorKind: string | null;
  readonly errorMessage: string | null;
  readonly fetchAttemptId: number | null;
}

export type AmedasPointSkipReason = 'latest_time_failed' | 'latest_time_unchanged' | null;

export interface AmedasFetchCycleResult {
  readonly latestTime: AmedasStreamStatus & { readonly value: UtcIso8601String | null };
  readonly pointData: AmedasStreamStatus & {
    readonly blockKey: string | null;
    readonly skipReason: AmedasPointSkipReason;
    readonly normalization: AmedasBlockNormalization | null;
    /** マージ・保持期間適用後に DB へ書いた観測行数。 */
    readonly savedObservationCount: number | null;
    /** 保持期間超過で落とした行数。 */
    readonly prunedObservationCount: number | null;
  };
  readonly snapshot: AmedasSnapshot | null;
}

export interface AmedasFetchOptions {
  readonly fetchFn?: typeof fetch;
  readonly clock?: () => UtcIso8601String;
  readonly timeoutMs?: number; // 既定 10_000（取得方法レポート §6）
  readonly retentionHours?: number; // 既定 25（§3.7）
  readonly staleAfterSeconds?: number; // 既定 600（§3.3.1）
  readonly pointFetchPolicy?: 'always' | 'onLatestTimeChange'; // 既定 'always'
  readonly backfillBlocks?: number; // 既定 0、上限 8（§3.7）
  readonly triggerKind?: string; // fetch_attempt.trigger_kind。既定 'manual'
}

/** プロセス内に持つ取得状態。C14 が地点ごとに1インスタンスを保持し、渡し続ける。 */
export class AmedasFetchState {
  readonly venueId: VenueId;
  private latestTime: UtcIso8601String | null = null;
  private latestTimeStatus: {
    lastSuccessAt: UtcIso8601String | null;
    consecutiveFailures: number;
  } = {
    lastSuccessAt: null,
    consecutiveFailures: 0,
  };
  private pointDataStatus: {
    lastSuccessAt: UtcIso8601String | null;
    consecutiveFailures: number;
  } = {
    lastSuccessAt: null,
    consecutiveFailures: 0,
  };

  /** 既定 'east'（Issue #109 §3.2 と同じ「east 既定・明示注入」）。 */
  constructor(venueId: VenueId = 'east') {
    this.venueId = venueId;
  }

  getLatestTime(): UtcIso8601String | null {
    return this.latestTime;
  }

  setLatestTime(time: UtcIso8601String | null): void {
    this.latestTime = time;
  }

  getStreamStatus(kind: 'latestTime' | 'pointData'): {
    lastSuccessAt: UtcIso8601String | null;
    consecutiveFailures: number;
  } {
    return kind === 'latestTime' ? { ...this.latestTimeStatus } : { ...this.pointDataStatus };
  }

  recordSuccess(kind: 'latestTime' | 'pointData', successAt: UtcIso8601String): void {
    const status = kind === 'latestTime' ? this.latestTimeStatus : this.pointDataStatus;
    status.lastSuccessAt = successAt;
    status.consecutiveFailures = 0;
  }

  recordFailure(kind: 'latestTime' | 'pointData'): void {
    const status = kind === 'latestTime' ? this.latestTimeStatus : this.pointDataStatus;
    status.consecutiveFailures++;
  }
}

/**
 * 単発実行の入口（確定事項#2）。同一インスタンスを渡し続けると連続失敗数・前回時刻が引き継がれる。
 * 取得対象は state.venueId から解決する（引数に地点を持たせない＝取り違えの余地を作らない）。
 */
export async function runAmedasFetchCycle(
  connection: DatabaseConnection,
  state: AmedasFetchState,
  options?: AmedasFetchOptions,
): Promise<AmedasFetchCycleResult> {
  const clock = options?.clock ?? (() => new Date().toISOString() as UtcIso8601String);
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const retentionHours = options?.retentionHours ?? 25;
  const staleAfterSeconds = options?.staleAfterSeconds ?? 600;
  const pointFetchPolicy = options?.pointFetchPolicy ?? 'always';
  const triggerKind = options?.triggerKind ?? 'manual';

  const target = resolveAmedasTarget(state.venueId);

  // 1. latest_time.txt を GET
  const latestStartedAt = clock();
  const latestStartTimeMs = Date.now();
  const sanitizedLatestUrl = sanitizeUrl(AMEDAS_LATEST_TIME_URL);

  const latestHttpRes = await performHttpGet(sanitizedLatestUrl, {
    fetchFn: options?.fetchFn,
    timeoutMs,
    accept: 'application/json, text/plain, */*',
  });
  const latestFinishedAt = clock();
  const latestDurationMs = Math.max(0, Date.now() - latestStartTimeMs);

  let latestTimeSucceeded = false;
  let parsedLatestTime: UtcIso8601String | null = null;
  let latestTimeErrorKind: string | null = null;
  let latestTimeErrorMessage: string | null = null;
  let latestAttemptId: number | null = null;

  if (!latestHttpRes.ok || !latestHttpRes.bodyText) {
    latestTimeErrorKind = latestHttpRes.errorKind;
    latestTimeErrorMessage = latestHttpRes.errorMessage;
  } else {
    const parseRes = parseAmedasLatestTime(latestHttpRes.bodyText);
    if (!parseRes.ok) {
      latestTimeErrorKind = 'parse';
      latestTimeErrorMessage = parseRes.reason;
    } else {
      latestTimeSucceeded = true;
      parsedLatestTime = parseRes.value;
    }
  }

  if (!latestTimeSucceeded) {
    state.recordFailure('latestTime');
    const attemptInput: FetchAttemptInput = {
      sourceKind: AMEDAS_LATEST_TIME_SOURCE_KIND,
      targetRef: null,
      requestUrl: sanitizedLatestUrl,
      triggerKind,
      attemptNo: 1,
      startedAt: latestStartedAt,
      finishedAt: latestFinishedAt,
      durationMs: latestDurationMs,
      outcome: 'failure',
      httpStatus: latestHttpRes.status,
      responseBytes: latestHttpRes.responseBytes,
      itemCount: null,
      failedItemCount: null,
      contentHash: latestHttpRes.bodyText
        ? crypto.createHash('sha256').update(latestHttpRes.bodyText).digest('hex')
        : null,
      errorKind: latestTimeErrorKind,
      errorMessage: latestTimeErrorMessage,
    };
    latestAttemptId = recordFetchAttempt(connection, attemptInput).id;

    const hasLastNormalValue = state.getLatestTime() !== null;
    const latestAvailability = resolveAvailability({
      hasLastNormalValue,
      freshness: 'abnormal',
    });

    // 地点系統は試行しない（skipReason = 'latest_time_failed'）
    const existingSnapshot = findAmedasSnapshot(connection, target.stationCode);
    let currentSnapshot: AmedasSnapshot | null = existingSnapshot;
    let pointAvailability: Availability;

    if (existingSnapshot && existingSnapshot.observations.length > 0) {
      const lastSuccess =
        existingSnapshot.metadata.lastSuccessAt ?? existingSnapshot.metadata.fetchedAt;
      const elapsedSeconds = Math.floor(
        (Date.parse(latestStartedAt) - Date.parse(lastSuccess)) / 1000,
      );
      if (elapsedSeconds > staleAfterSeconds) {
        currentSnapshot = saveAmedasSnapshot(connection, {
          stationCode: target.stationCode,
          stationName: target.displayName,
          metadata: {
            ...existingSnapshot.metadata,
            availability: 'stale',
            fetchedAt: latestStartedAt,
          },
          observations: [],
        });
      }
      pointAvailability = currentSnapshot
        ? currentSnapshot.metadata.availability
        : existingSnapshot.metadata.availability;
    } else {
      // 初回で既存行がない状態で失敗した場合
      currentSnapshot = saveAmedasSnapshot(connection, {
        stationCode: target.stationCode,
        stationName: target.displayName,
        metadata: {
          source: sanitizedLatestUrl,
          issuedAt: latestStartedAt,
          validAt: null,
          validFrom: null,
          validTo: null,
          fetchedAt: latestStartedAt,
          lastSuccessAt: null,
          availability: 'unavailable',
          sourceVersion: null,
        },
        observations: [],
      });
      pointAvailability = 'unavailable';
    }

    const latestStreamStatus = state.getStreamStatus('latestTime');
    const pointStreamStatus = state.getStreamStatus('pointData');

    return {
      latestTime: {
        value: state.getLatestTime(),
        availability: latestAvailability,
        attempted: true,
        succeeded: false,
        attemptedAt: latestStartedAt,
        lastSuccessAt: latestStreamStatus.lastSuccessAt,
        consecutiveFailures: latestStreamStatus.consecutiveFailures,
        errorKind: latestTimeErrorKind,
        errorMessage: latestTimeErrorMessage,
        fetchAttemptId: latestAttemptId,
      },
      pointData: {
        blockKey: null,
        skipReason: 'latest_time_failed',
        normalization: null,
        savedObservationCount: null,
        prunedObservationCount: null,
        availability: pointAvailability,
        attempted: false,
        succeeded: false,
        attemptedAt: null,
        lastSuccessAt: pointStreamStatus.lastSuccessAt,
        consecutiveFailures: pointStreamStatus.consecutiveFailures,
        errorKind: null,
        errorMessage: null,
        fetchAttemptId: null,
      },
      snapshot: currentSnapshot,
    };
  }

  // 最新時刻取得成功
  const latestContentHash = crypto
    .createHash('sha256')
    .update(latestHttpRes.bodyText!)
    .digest('hex');
  const latestAttemptSuccessInput: FetchAttemptInput = {
    sourceKind: AMEDAS_LATEST_TIME_SOURCE_KIND,
    targetRef: null,
    requestUrl: sanitizedLatestUrl,
    triggerKind,
    attemptNo: 1,
    startedAt: latestStartedAt,
    finishedAt: latestFinishedAt,
    durationMs: latestDurationMs,
    outcome: 'success',
    httpStatus: latestHttpRes.status,
    responseBytes: latestHttpRes.responseBytes,
    itemCount: null,
    failedItemCount: null,
    contentHash: latestContentHash,
    errorKind: null,
    errorMessage: null,
  };
  latestAttemptId = recordFetchAttempt(connection, latestAttemptSuccessInput).id;
  state.recordSuccess('latestTime', latestFinishedAt);

  const prevLatestTime = state.getLatestTime();
  const latestTimeChanged = prevLatestTime !== parsedLatestTime;
  state.setLatestTime(parsedLatestTime);

  const latestTimeStatus = state.getStreamStatus('latestTime');
  const latestStreamResult: AmedasFetchCycleResult['latestTime'] = {
    value: parsedLatestTime,
    availability: resolveAvailability({ hasLastNormalValue: true, freshness: 'normal' }),
    attempted: true,
    succeeded: true,
    attemptedAt: latestStartedAt,
    lastSuccessAt: latestTimeStatus.lastSuccessAt,
    consecutiveFailures: latestTimeStatus.consecutiveFailures,
    errorKind: null,
    errorMessage: null,
    fetchAttemptId: latestAttemptId,
  };

  // 2. pointFetchPolicy によるスキップ判定
  if (pointFetchPolicy === 'onLatestTimeChange' && !latestTimeChanged) {
    const existingSnapshot = findAmedasSnapshot(connection, target.stationCode);
    const pointStatus = state.getStreamStatus('pointData');
    return {
      latestTime: latestStreamResult,
      pointData: {
        blockKey: null,
        skipReason: 'latest_time_unchanged',
        normalization: null,
        savedObservationCount: null,
        prunedObservationCount: null,
        availability: existingSnapshot?.metadata.availability ?? 'unavailable',
        attempted: false,
        succeeded: false,
        attemptedAt: null,
        lastSuccessAt: pointStatus.lastSuccessAt,
        consecutiveFailures: pointStatus.consecutiveFailures,
        errorKind: null,
        errorMessage: null,
        fetchAttemptId: null,
      },
      snapshot: existingSnapshot,
    };
  }

  // 3. ブロックキー算出
  const blockKey = resolveBlockKey(parsedLatestTime!);

  // 4. 地点ブロックJSON の GET
  const pointUrl = buildPointBlockUrl(target.stationCode, blockKey);
  const sanitizedPointUrl = sanitizeUrl(pointUrl);
  const pointStartedAt = clock();
  const pointStartTimeMs = Date.now();

  const pointHttpRes = await performHttpGet(sanitizedPointUrl, {
    fetchFn: options?.fetchFn,
    timeoutMs,
    accept: 'application/json, text/plain, */*',
  });
  const pointFinishedAt = clock();
  const pointDurationMs = Math.max(0, Date.now() - pointStartTimeMs);

  let pointAttemptId: number | null = null;
  const existingSnapshot = findAmedasSnapshot(connection, target.stationCode);
  const hasLastNormalValue = existingSnapshot !== null && existingSnapshot.observations.length > 0;

  if (!pointHttpRes.ok || !pointHttpRes.bodyText) {
    state.recordFailure('pointData');
    const pointAttemptInput: FetchAttemptInput = {
      sourceKind: AMEDAS_POINT_SOURCE_KIND,
      targetRef: target.stationCode,
      requestUrl: sanitizedPointUrl,
      triggerKind,
      attemptNo: 1,
      startedAt: pointStartedAt,
      finishedAt: pointFinishedAt,
      durationMs: pointDurationMs,
      outcome: 'failure',
      httpStatus: pointHttpRes.status,
      responseBytes: pointHttpRes.responseBytes,
      itemCount: null,
      failedItemCount: null,
      contentHash: null,
      errorKind: pointHttpRes.errorKind,
      errorMessage: pointHttpRes.errorMessage,
    };
    pointAttemptId = recordFetchAttempt(connection, pointAttemptInput).id;

    const availability = resolveAvailability({
      hasLastNormalValue,
      freshness: 'abnormal',
    });

    let savedSnapshot: AmedasSnapshot;
    if (hasLastNormalValue) {
      savedSnapshot = saveAmedasSnapshot(connection, {
        stationCode: target.stationCode,
        stationName: target.displayName,
        metadata: {
          ...existingSnapshot.metadata,
          availability: 'stale',
          fetchedAt: pointStartedAt,
        },
        observations: [],
      });
    } else {
      savedSnapshot = saveAmedasSnapshot(connection, {
        stationCode: target.stationCode,
        stationName: target.displayName,
        metadata: {
          source: sanitizedPointUrl,
          issuedAt: parsedLatestTime!,
          validAt: null,
          validFrom: null,
          validTo: null,
          fetchedAt: pointStartedAt,
          lastSuccessAt: null,
          availability: 'unavailable',
          sourceVersion: null,
        },
        observations: [],
      });
    }

    const pointStreamStatus = state.getStreamStatus('pointData');
    return {
      latestTime: latestStreamResult,
      pointData: {
        blockKey,
        skipReason: null,
        normalization: null,
        savedObservationCount: null,
        prunedObservationCount: null,
        availability,
        attempted: true,
        succeeded: false,
        attemptedAt: pointStartedAt,
        lastSuccessAt: pointStreamStatus.lastSuccessAt,
        consecutiveFailures: pointStreamStatus.consecutiveFailures,
        errorKind: pointHttpRes.errorKind,
        errorMessage: pointHttpRes.errorMessage,
        fetchAttemptId: pointAttemptId,
      },
      snapshot: savedSnapshot,
    };
  }

  // HTTP GET 成功 -> パースと正規化
  const pointContentHash = crypto.createHash('sha256').update(pointHttpRes.bodyText).digest('hex');
  const parseResult = parseAmedasPointBlock(pointHttpRes.bodyText, target);

  if (!parseResult.ok) {
    // 構造異常
    state.recordFailure('pointData');
    const pointAttemptInput: FetchAttemptInput = {
      sourceKind: AMEDAS_POINT_SOURCE_KIND,
      targetRef: target.stationCode,
      requestUrl: sanitizedPointUrl,
      triggerKind,
      attemptNo: 1,
      startedAt: pointStartedAt,
      finishedAt: pointFinishedAt,
      durationMs: pointDurationMs,
      outcome: 'failure',
      httpStatus: pointHttpRes.status,
      responseBytes: pointHttpRes.responseBytes,
      itemCount: null,
      failedItemCount: null,
      contentHash: pointContentHash,
      errorKind: 'invalid_structure',
      errorMessage: parseResult.reason,
    };
    pointAttemptId = recordFetchAttempt(connection, pointAttemptInput).id;

    const availability = resolveAvailability({
      hasLastNormalValue,
      freshness: 'abnormal',
    });

    let savedSnapshot: AmedasSnapshot;
    if (hasLastNormalValue) {
      savedSnapshot = saveAmedasSnapshot(connection, {
        stationCode: target.stationCode,
        stationName: target.displayName,
        metadata: {
          ...existingSnapshot.metadata,
          availability: 'stale',
          fetchedAt: pointStartedAt,
        },
        observations: [],
      });
    } else {
      savedSnapshot = saveAmedasSnapshot(connection, {
        stationCode: target.stationCode,
        stationName: target.displayName,
        metadata: {
          source: sanitizedPointUrl,
          issuedAt: parsedLatestTime!,
          validAt: null,
          validFrom: null,
          validTo: null,
          fetchedAt: pointStartedAt,
          lastSuccessAt: null,
          availability: 'unavailable',
          sourceVersion: null,
        },
        observations: [],
      });
    }

    const pointStreamStatus = state.getStreamStatus('pointData');
    return {
      latestTime: latestStreamResult,
      pointData: {
        blockKey,
        skipReason: null,
        normalization: null,
        savedObservationCount: null,
        prunedObservationCount: null,
        availability,
        attempted: true,
        succeeded: false,
        attemptedAt: pointStartedAt,
        lastSuccessAt: pointStreamStatus.lastSuccessAt,
        consecutiveFailures: pointStreamStatus.consecutiveFailures,
        errorKind: 'invalid_structure',
        errorMessage: parseResult.reason,
        fetchAttemptId: pointAttemptId,
      },
      snapshot: savedSnapshot,
    };
  }

  // 取得・正規化ともに成功
  state.recordSuccess('pointData', pointFinishedAt);
  const normalization = parseResult.value;

  const pointAttemptInput: FetchAttemptInput = {
    sourceKind: AMEDAS_POINT_SOURCE_KIND,
    targetRef: target.stationCode,
    requestUrl: sanitizedPointUrl,
    triggerKind,
    attemptNo: 1,
    startedAt: pointStartedAt,
    finishedAt: pointFinishedAt,
    durationMs: pointDurationMs,
    outcome: 'success',
    httpStatus: pointHttpRes.status,
    responseBytes: pointHttpRes.responseBytes,
    itemCount: normalization.observations.length,
    failedItemCount: 0,
    contentHash: pointContentHash,
    errorKind: null,
    errorMessage: null,
  };
  pointAttemptId = recordFetchAttempt(connection, pointAttemptInput).id;

  // freshness 判定
  const isDelayed = normalization.latestObservedAt < parsedLatestTime!;
  const freshness = isDelayed ? 'delayed' : 'normal';

  // マージと保持時間幅の適用
  const obsMap = new Map<string, AmedasObservationInput>();
  for (const obs of existingSnapshot?.observations ?? []) {
    obsMap.set(`${obs.observedAt}__${obs.element}`, {
      observedAt: obs.observedAt,
      element: obs.element,
      valueNumber: obs.valueNumber,
      valueText: obs.valueText,
      qualityFlag: obs.qualityFlag,
      isEstimated: obs.isEstimated,
    });
  }
  for (const obs of normalization.observations) {
    obsMap.set(`${obs.observedAt}__${obs.element}`, obs);
  }

  // 最大 observedAt の特定
  let maxObservedAt = normalization.latestObservedAt;
  for (const obs of obsMap.values()) {
    if (obs.observedAt > maxObservedAt) {
      maxObservedAt = obs.observedAt;
    }
  }

  const cutoffTimeMs = Date.parse(maxObservedAt) - retentionHours * 60 * 60 * 1000;
  const keptObservations: AmedasObservationInput[] = [];
  let prunedObservationCount = 0;

  for (const obs of obsMap.values()) {
    if (Date.parse(obs.observedAt) >= cutoffTimeMs) {
      keptObservations.push(obs);
    } else {
      prunedObservationCount++;
    }
  }

  keptObservations.sort((a, b) => {
    if (a.observedAt < b.observedAt) return -1;
    if (a.observedAt > b.observedAt) return 1;
    if (a.element < b.element) return -1;
    if (a.element > b.element) return 1;
    return 0;
  });

  const validFrom = keptObservations[0]?.observedAt ?? null;
  const validTo = keptObservations[keptObservations.length - 1]?.observedAt ?? null;
  const validAt = validTo;

  const availability = resolveAvailability({
    hasLastNormalValue: keptObservations.length > 0,
    freshness,
  });

  const sourceVersion = `${blockKey}:${pointContentHash.slice(0, 12)}`;

  const savedSnapshot = saveAmedasSnapshot(connection, {
    stationCode: target.stationCode,
    stationName: target.displayName,
    metadata: {
      source: sanitizedPointUrl,
      issuedAt: parsedLatestTime!,
      validAt,
      validFrom,
      validTo,
      fetchedAt: pointStartedAt,
      lastSuccessAt: pointFinishedAt,
      availability,
      sourceVersion,
    },
    observations: keptObservations,
  });

  const pointStreamStatus = state.getStreamStatus('pointData');

  return {
    latestTime: latestStreamResult,
    pointData: {
      blockKey,
      skipReason: null,
      normalization,
      savedObservationCount: keptObservations.length,
      prunedObservationCount,
      availability,
      attempted: true,
      succeeded: true,
      attemptedAt: pointStartedAt,
      lastSuccessAt: pointStreamStatus.lastSuccessAt,
      consecutiveFailures: pointStreamStatus.consecutiveFailures,
      errorKind: null,
      errorMessage: null,
      fetchAttemptId: pointAttemptId,
    },
    snapshot: savedSnapshot,
  };
}
