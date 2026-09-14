import type { UtcIso8601String } from './types.js';
import type { VenueId } from './venueForecastTargets.js';

/**
 * Issue #42「E10. 監視画面向けAPI」§5.3・§7 の処理できなかった電文の診断API DTO。
 * 稼働状態API（GET /api/monitoring/status）とは別エンドポイントに分離する（確定事項7）。
 */

/**
 * 確定事項8: 実データでの妥当性は未検証のまま提案値を採用している。
 * 後続PRでの定数調整を想定し、サービス実装・テストの両方がこれらの定数を参照すること
 * （数値をコードへ直書きしない）。
 */
export const EXCERPT_MAX_CHARS = 2000;
export const PROCESSING_FAILURE_SAMPLE_LIMIT = 20;
export const PROCESSING_WINDOW_HOURS = 24;

export interface MonitoringRawExcerpt {
  /** 抜粋本文。最大 EXCERPT_MAX_CHARS 文字。 */
  readonly text: string;
  /** 抜粋の開始位置（原文先頭からの UTF-16 コードユニット数）。 */
  readonly startOffset: number;
  /** 原文全体の長さ（UTF-16 コードユニット数）。 */
  readonly totalLength: number;
  /** 原文の末尾まで含んでいるか。false なら以降が省略されている。 */
  readonly truncated: boolean;
  /** 抜粋位置の決め方。'head' = 先頭から（該当箇所を特定できなかった場合）。 */
  readonly anchor: 'head' | 'reason_match';
}

export interface MonitoringProcessingFailure {
  readonly receptionId: number;
  readonly venueId: VenueId;
  /** 理由コード。'未対応構造' | '未対応形式'。 */
  readonly adoptionResult: string;
  /** 詳細テキスト（自由文）。機械可読なコードではない。 */
  readonly adoptionReason: string | null;
  readonly telegramType: string | null;
  readonly documentUrl: string;
  readonly receivedAt: UtcIso8601String;
  readonly adoptionDecidedAt: UtcIso8601String | null;
  /** 原文の総バイト数。抜粋との対比で「どれだけ省いたか」を示す。 */
  readonly rawBodyBytes: number | null;
  /** 原文抜粋。原文が保存されていなければ null。 */
  readonly excerpt: MonitoringRawExcerpt | null;
}

export interface MonitoringProcessingResponse {
  readonly status: 'ready';
  readonly terminalId: string;
  readonly requestedVenueId: VenueId;
  readonly serverGenerationId: string;
  readonly generatedAt: UtcIso8601String;
  /** 集計対象の期間（generatedAt から遡った時間）。PROCESSING_WINDOW_HOURS。 */
  readonly windowHours: number;
  /** adoption_result の区分値ごとの件数。非採用・採用の両方を含む。全会場分（確定事項6）。 */
  readonly byAdoptionResult: readonly {
    readonly adoptionResult: string;
    readonly venueId: VenueId;
    readonly count: number;
  }[];
  /** 非採用（未対応構造・未対応形式）だけの直近サンプル。原文抜粋を含む。最大 PROCESSING_FAILURE_SAMPLE_LIMIT 件。 */
  readonly recentFailures: readonly MonitoringProcessingFailure[];
}

export interface MonitoringProcessingRequest {
  readonly terminalId: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseMonitoringProcessingQuery(query: unknown): MonitoringProcessingRequest | null {
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
