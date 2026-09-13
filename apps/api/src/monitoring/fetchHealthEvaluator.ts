import type { FreshnessStatus, UtcIso8601String } from '@wx-viewer-poc/shared';
import type { FetchHealthConfig } from './fetchHealthConfig.js';
import type { MonitoredFetchSourceId } from './fetchHealthSources.js';
import { MONITORED_FETCH_SOURCES } from './fetchHealthSources.js';
import type { FetchStreamHealthSummary } from '../repositories/types.js';

/** §8.1 の「正常/遅延/異常」＋「停止中」。語彙は shared の FreshnessStatus を再利用する。 */
export type FetchHealthStatus = FreshnessStatus | 'suspended';

/** 判定理由。監視画面（E 系）と通知本文の detail に使う。 */
export type FetchHealthReasonKind =
  | 'consecutive_failures' // 連続失敗回数による
  | 'last_success_elapsed'; // 最終成功からの経過時間による

export interface FetchHealthReason {
  readonly kind: FetchHealthReasonKind;
  readonly status: 'delayed' | 'abnormal';
  readonly sourceKind: string;
  /** 通知本文へ載せる 1 行テキスト（改行を含めない）。例: '連続5回失敗' / '最終成功から11分経過' */
  readonly text: string;
}

export type { FetchStreamHealthSummary };

export interface EvaluateFetchSourceInput {
  readonly sourceId: MonitoredFetchSourceId;
  readonly now: UtcIso8601String;
  /** 取得停止中（手動停止・スケジュール停止）か。true なら閾値判定を行わない。 */
  readonly suspended: boolean;
  /** その時間帯の適用周期。suspended のとき null。 */
  readonly intervalSeconds: number | null;
  /** 経過時間条件（周期×3・固定10分）を適用するか。false なら連続失敗回数条件だけで判定する（§4.1）。 */
  readonly appliesElapsedCondition: boolean;
  /** この取得元が「最後に稼働状態へ入った時刻」。経過時間判定の下限に使う（§4.3）。 */
  readonly activeSinceAt: UtcIso8601String;
  readonly streams: readonly FetchStreamHealthSummary[];
}

export interface FetchSourceHealthResult {
  readonly sourceId: MonitoredFetchSourceId;
  readonly status: FetchHealthStatus;
  readonly reasons: readonly FetchHealthReason[];
  readonly lastAttemptAt: UtcIso8601String | null;
  readonly lastSuccessAt: UtcIso8601String | null;
  readonly maxConsecutiveFailures: number;
  readonly intervalSeconds: number | null;
}

function formatElapsedText(elapsedSeconds: number): string {
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes > 0) {
    return `最終成功から${minutes}分経過`;
  }
  return `最終成功から${Math.floor(elapsedSeconds)}秒経過`;
}

export function evaluateFetchSourceHealth(
  input: EvaluateFetchSourceInput,
  config: FetchHealthConfig,
): FetchSourceHealthResult {
  let latestAttemptAt: UtcIso8601String | null = null;
  let latestSuccessAt: UtcIso8601String | null = null;
  let maxConsecutiveFailures = 0;

  for (const stream of input.streams) {
    if (stream.lastAttemptAt !== null) {
      if (
        latestAttemptAt === null ||
        Date.parse(stream.lastAttemptAt) > Date.parse(latestAttemptAt)
      ) {
        latestAttemptAt = stream.lastAttemptAt;
      }
    }
    if (stream.lastSuccessAt !== null) {
      if (
        latestSuccessAt === null ||
        Date.parse(stream.lastSuccessAt) > Date.parse(latestSuccessAt)
      ) {
        latestSuccessAt = stream.lastSuccessAt;
      }
    }
    if (stream.consecutiveFailures > maxConsecutiveFailures) {
      maxConsecutiveFailures = stream.consecutiveFailures;
    }
  }

  if (input.suspended) {
    return {
      sourceId: input.sourceId,
      status: 'suspended',
      reasons: [],
      lastAttemptAt: latestAttemptAt,
      lastSuccessAt: latestSuccessAt,
      maxConsecutiveFailures,
      intervalSeconds: input.intervalSeconds,
    };
  }

  const nowMs = Date.parse(input.now);
  const activeSinceAtMs = Date.parse(input.activeSinceAt);

  let worstStatus: 'normal' | 'delayed' | 'abnormal' = 'normal';
  const allReasons: FetchHealthReason[] = [];

  for (const stream of input.streams) {
    const streamReasons: FetchHealthReason[] = [];
    let streamStatus: 'normal' | 'delayed' | 'abnormal' = 'normal';

    // 1. 異常判定 (abnormal)
    // 連続失敗 5 回以上
    const abnormalByFailures = stream.consecutiveFailures >= config.abnormalConsecutiveFailures;
    if (abnormalByFailures) {
      streamReasons.push({
        kind: 'consecutive_failures',
        status: 'abnormal',
        sourceKind: stream.sourceKind,
        text: `連続${stream.consecutiveFailures}回失敗`,
      });
    }

    // 固定 10 分 (abnormalElapsedSeconds) を超えて更新されていない
    if (input.appliesElapsedCondition) {
      const baselineAtMs = Math.max(
        stream.lastSuccessAt !== null ? Date.parse(stream.lastSuccessAt) : 0,
        activeSinceAtMs,
      );
      const elapsedSec = (nowMs - baselineAtMs) / 1000;
      if (elapsedSec > config.abnormalElapsedSeconds) {
        streamReasons.push({
          kind: 'last_success_elapsed',
          status: 'abnormal',
          sourceKind: stream.sourceKind,
          text: formatElapsedText(elapsedSec),
        });
      }
    }

    if (streamReasons.length > 0) {
      streamStatus = 'abnormal';
    } else {
      // 2. 遅延判定 (delayed)
      // 連続失敗 2 回以上
      const delayedByFailures = stream.consecutiveFailures >= config.delayedConsecutiveFailures;
      if (delayedByFailures) {
        streamReasons.push({
          kind: 'consecutive_failures',
          status: 'delayed',
          sourceKind: stream.sourceKind,
          text: `連続${stream.consecutiveFailures}回失敗`,
        });
      }

      // 適用周期×3 を超えて更新されていない
      if (input.appliesElapsedCondition && input.intervalSeconds !== null) {
        const baselineAtMs = Math.max(
          stream.lastSuccessAt !== null ? Date.parse(stream.lastSuccessAt) : 0,
          activeSinceAtMs,
        );
        const elapsedSec = (nowMs - baselineAtMs) / 1000;
        if (elapsedSec > input.intervalSeconds * config.delayedIntervalMultiplier) {
          streamReasons.push({
            kind: 'last_success_elapsed',
            status: 'delayed',
            sourceKind: stream.sourceKind,
            text: formatElapsedText(elapsedSec),
          });
        }
      }

      if (streamReasons.length > 0) {
        streamStatus = 'delayed';
      }
    }

    if (streamStatus === 'abnormal') {
      worstStatus = 'abnormal';
      allReasons.push(...streamReasons);
    } else if (streamStatus === 'delayed') {
      if (worstStatus !== 'abnormal') {
        worstStatus = 'delayed';
      }
      allReasons.push(...streamReasons);
    }
  }

  // reasons は worstStatus に合致するものだけにフィルタする
  const filteredReasons =
    worstStatus === 'normal' ? [] : allReasons.filter((r) => r.status === worstStatus);

  return {
    sourceId: input.sourceId,
    status: worstStatus,
    reasons: filteredReasons,
    lastAttemptAt: latestAttemptAt,
    lastSuccessAt: latestSuccessAt,
    maxConsecutiveFailures,
    intervalSeconds: input.intervalSeconds,
  };
}

/**
 * E 系（監視画面）が読む表示専用の集約。
 * 【重要】これは通知の生成単位ではない。通知は sources の各要素ごとに独立に生成される（§4.5）。
 * status は §8.1 の「全体状態カードの取得健全性」＝最悪値の表示のためだけに存在する。
 */
export interface FetchHealthAggregate {
  /** 表示用の最悪値。通知の区分決定に使ってはならない。 */
  readonly status: FetchHealthStatus;
  /** 固定順（MONITORED_FETCH_SOURCES の順）で全 6 取得元を含む。通知はこの各要素から作る。 */
  readonly sources: readonly FetchSourceHealthResult[];
  /** status と同じ状態にある取得元（監視画面の「現在の異常」カードの強調表示用）。 */
  readonly worstSourceIds: readonly MonitoredFetchSourceId[];
  readonly evaluatedAt: UtcIso8601String;
}

export function aggregateFetchHealth(
  results: readonly FetchSourceHealthResult[],
  evaluatedAt: UtcIso8601String,
): FetchHealthAggregate {
  // MONITORED_FETCH_SOURCES の固定順に並べる
  const sourceMap = new Map<MonitoredFetchSourceId, FetchSourceHealthResult>();
  for (const r of results) {
    sourceMap.set(r.sourceId, r);
  }

  const orderedSources: FetchSourceHealthResult[] = [];
  for (const def of MONITORED_FETCH_SOURCES) {
    const r = sourceMap.get(def.id);
    if (r) {
      orderedSources.push(r);
    }
  }

  // 1. suspended の取得元を除外した集合 active を作る
  const active = orderedSources.filter((s) => s.status !== 'suspended');

  // 2. active が空なら status = 'suspended', worstSourceIds = []
  if (active.length === 0) {
    return {
      status: 'suspended',
      sources: orderedSources,
      worstSourceIds: [],
      evaluatedAt,
    };
  }

  // 3. 優先順位 abnormal > delayed > normal
  let aggregateStatus: FetchHealthStatus = 'normal';
  if (active.some((s) => s.status === 'abnormal')) {
    aggregateStatus = 'abnormal';
  } else if (active.some((s) => s.status === 'delayed')) {
    aggregateStatus = 'delayed';
  }

  // 4. worstSourceIds = status と一致する状態の取得元 id（status が normal なら空配列）
  const worstSourceIds: MonitoredFetchSourceId[] =
    aggregateStatus === 'normal'
      ? []
      : orderedSources.filter((s) => s.status === aggregateStatus).map((s) => s.sourceId);

  return {
    status: aggregateStatus,
    sources: orderedSources,
    worstSourceIds,
    evaluatedAt,
  };
}
