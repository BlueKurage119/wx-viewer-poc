import type { UtcIso8601String } from './types.js';
import type { Availability } from './availability.js';
import type { VenueId } from './venueForecastTargets.js';

/**
 * Issue #42「E10. 監視画面向けAPI」§5.1 の稼働状態API DTO。
 * 設計の確定事項1（AD-H063）に従い、各セクションを分離したまま返す。
 * これらを集約した単一のステータス値（overallStatus 等）を追加してはならない。
 */

export type MonitoringHealthStatus = 'normal' | 'delayed' | 'abnormal' | 'suspended';

export type MonitoredFetchSourceId =
  | 'xml_regular'
  | 'xml_extra'
  | 'nowcast_target_times'
  | 'kikikuru_target_times'
  | 'amedas_latest_time'
  | 'amedas_point';

export interface MonitoringScheduledSourceStatus {
  readonly source: 'xml' | 'nowcast' | 'kikikuru' | 'amedas';
  readonly state: 'waiting' | 'running' | 'scheduled_stopped';
  readonly intervalSeconds: number | null;
  readonly nextRunAt: UtcIso8601String | null;
}

export interface MonitoringOperationSection {
  /** 取得ジョブが動いているか。健全性とは独立（基本設計 §8.2）。 */
  readonly schedulerRunning: boolean;
  /** 現在の時間帯設定。config/polling.yaml の periods の該当要素。 */
  readonly period: {
    readonly start: string; // "HH:mm" (JST)
    readonly end: string; // "HH:mm" (JST)
    readonly xmlSeconds: number | null;
    readonly imageCatalogSeconds: number | null;
    readonly amedasSeconds: number | null;
    readonly nowcastEnabled: boolean;
    readonly kikikuruEnabled: boolean;
  };
  readonly nextPeriodChangeAt: UtcIso8601String;
  readonly scheduledSources: readonly MonitoringScheduledSourceStatus[];
}

export interface MonitoringHealthReason {
  readonly kind: 'consecutive_failures' | 'last_success_elapsed';
  readonly status: 'delayed' | 'abnormal';
  readonly sourceKind: string;
  readonly text: string;
}

export interface MonitoringHealthSource {
  readonly sourceId: MonitoredFetchSourceId;
  readonly displayName: string;
  readonly status: MonitoringHealthStatus | null;
  readonly lastAttemptAt: UtcIso8601String | null;
  readonly lastSuccessAt: UtcIso8601String | null;
  readonly consecutiveFailures: number | null;
  readonly intervalSeconds: number | null;
  /**
   * 経過時間条件（周期×3・固定10分）を適用する系列か。
   * amedas_point だけ false。AD-H003 のとおり到達時間は保証されない（K6/L2 で判断）。
   */
  readonly appliesElapsedCondition: boolean;
  /**
   * 直近の試行 1 件の所要時間（ミリ秒）。K6 #79 で追加。
   * 直近試行が無い／健全性未評価の場合は null。null を 0 に丸めない。
   * 平均・合計ではなく「最後の 1 回」。複数 sourceKind を持つ系列は
   * lastAttemptAt が最も新しいストリームの値を採る。
   */
  readonly lastDurationMs: number | null;
  readonly reasons: readonly MonitoringHealthReason[];
}

export interface MonitoringHealthThresholds {
  readonly evaluationIntervalSeconds: number;
  readonly delayedConsecutiveFailures: number;
  readonly delayedIntervalMultiplier: number;
  readonly abnormalConsecutiveFailures: number;
  readonly abnormalElapsedSeconds: number;
  readonly maxScanAttempts: number;
}

export interface MonitoringHealthSection {
  /**
   * まだ一度も評価していない場合 null。
   * 【重要】null を 'normal' に丸めない。監視画面は「判定待ち」と表示する（基本設計 §8.2）。
   */
  readonly evaluatedAt: UtcIso8601String | null;
  /**
   * 表示用の最悪値。まだ評価していなければ null。
   * 【重要】通知の区分決定に使ってはならない。
   */
  readonly worstStatus: MonitoringHealthStatus | null;
  readonly worstSourceIds: readonly MonitoredFetchSourceId[];
  /** MONITORED_FETCH_SOURCES の固定順で常に6要素。評価前は status が null。 */
  readonly sources: readonly MonitoringHealthSource[];
  /** config/polling.yaml の fetchHealth の現行値。AD-H041 のとおり表示のみで、ここから判定し直さない。 */
  readonly thresholds: MonitoringHealthThresholds;
}

export interface MonitoringReadinessSection {
  readonly initialFetchPhase: 'not_started' | 'running' | 'completed' | 'failed';
  readonly startedAt: UtcIso8601String | null;
  readonly finishedAt: UtcIso8601String | null;
  /** 初期取得の4フィード。成功・失敗を feed 別に返す。 */
  readonly feeds: readonly {
    readonly feedKind: 'regular' | 'extra' | 'regular_l' | 'extra_l';
    readonly succeeded: boolean | null; // 未実施・実施中は null
  }[];
  readonly errorReason: string | null;
}

export type MonitoringReprocessingPhase = 'idle' | 'running' | 'completed';

export interface MonitoringVenueReprocessingStatus {
  /** 再処理の進行フェーズ */
  readonly status: MonitoringReprocessingPhase;
  /** 再処理対象の未処理電文総数（0件の場合は0） */
  readonly total: number;
  /** 処理済み件数 */
  readonly processedCount: number;
  /** 再処理開始時刻（未開始時は null） */
  readonly startedAt: UtcIso8601String | null;
  /** 再処理完了時刻（未完了時は null） */
  readonly finishedAt: UtcIso8601String | null;
  /** 再処理所要時間（ミリ秒、未完了時は null） */
  readonly elapsedMs: number | null;
}

export interface MonitoringVenueSection {
  readonly venueId: VenueId;
  /** StartupNotificationInitialization.isReady(venueId) と同値。起動時評価が済んだか。 */
  readonly startupEvaluated: boolean;
  /** 会場ごとの未処理電文再処理ステータス */
  readonly reprocessing: MonitoringVenueReprocessingStatus;
  /**
   * 直近の採用判定の集計。adoption_result の区分値ごとの件数。
   * 【重要】会場ごとに独立。片方の会場の失敗を全体成功に隠さない（基本設計 §8.2）。
   */
  readonly recentAdoptions: readonly {
    readonly adoptionResult: string;
    readonly count: number;
    readonly latestDecidedAt: UtcIso8601String | null;
  }[];
  /** 集計対象の期間（generatedAt から遡った時間）。既定 24 時間。 */
  readonly adoptionWindowHours: number;
}

export type MonitoringInformationKind =
  | 'bosai_bulletin'
  | 'warning'
  | 'warning_timeseries'
  | 'early_warning'
  | 'amedas'
  | 'area_timeseries'
  | 'nowcast'
  | 'kikikuru';

export interface MonitoringInformationSection {
  readonly kind: MonitoringInformationKind;
  readonly venueId: VenueId;
  /** 3状態をそのまま返す。boolean へ縮退させない（07-wx-data-protocol.md 必須）。 */
  readonly availability: Availability;
  readonly issuedAt: UtcIso8601String | null;
  readonly validAt: UtcIso8601String | null;
  readonly fetchedAt: UtcIso8601String | null;
  readonly lastSuccessAt: UtcIso8601String | null;
  /** 保存済み正規化データから得た件数等の要約。取得できない場合 null。 */
  readonly summaryCount: number | null;
}

export interface MonitoringTilesLayer {
  readonly layer: 'nowcast' | 'kikikuru';
  /** 索引（時刻一覧）の availability。索引は6系列健全性の監視対象であり、画像本体は対象外。 */
  readonly catalogAvailability: Availability;
  readonly catalogUpdatedAt: UtcIso8601String | null;
  readonly availableFrameCount: number;
  /** その時間帯で画像本体の上流取得が許可されているか（config/polling.yaml）。 */
  readonly upstreamFetchAllowed: boolean;
  readonly nextUpstreamAllowedAt: UtcIso8601String | null;
}

export interface MonitoringTilesSection {
  /** 6系列健全性監視の対象外であること。常に false。 */
  readonly healthMonitored: false;
  /** 判定基準が未決であること。K6 #79 / L2 #84 で決める。常に 'undecided'。 */
  readonly healthCriteriaStatus: 'undecided';
  readonly layers: readonly MonitoringTilesLayer[];
}

export interface MonitoringStatusResponse {
  readonly status: 'ready';
  readonly terminalId: string;
  readonly requestedVenueId: VenueId;
  readonly serverGenerationId: string;
  /** この応答を組み立てた時刻。監視画面の「最終表示更新時刻」の基準(基本設計 §8.2)。 */
  readonly generatedAt: UtcIso8601String;

  readonly operation: MonitoringOperationSection;
  readonly health: MonitoringHealthSection;
  readonly readiness: MonitoringReadinessSection;
  readonly venues: readonly MonitoringVenueSection[];
  readonly information: readonly MonitoringInformationSection[];
  readonly tiles: MonitoringTilesSection;
}

export interface MonitoringStatusRequest {
  readonly terminalId: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** terminalId のみを受理する。キー数完全一致で、それ以外のキーがあれば null（呼び出し側で400）。 */
export function parseMonitoringStatusQuery(query: unknown): MonitoringStatusRequest | null {
  if (!isPlainObject(query)) {
    return null;
  }
  const keys = Object.keys(query);
  if (keys.length !== 1 || !keys.includes('terminalId')) {
    return null;
  }
  const terminalId = query.terminalId;
  if (typeof terminalId !== 'string' || terminalId.length === 0) {
    return null;
  }
  return { terminalId };
}
