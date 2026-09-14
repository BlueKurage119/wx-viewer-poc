import type { UtcIso8601String } from './types.js';
import type { VenueId } from './venueForecastTargets.js';
import { isVenueId } from './venueForecastTargets.js';

/**
 * Issue #42「E10. 監視画面向けAPI」§6 の履歴検索API DTO。
 * 確定事項3（AD-H065）: デフォルトで訓練／本番フィルタをかけず全件を返す。
 * 一覧レスポンスには電文原文を含めず、詳細取得時のみ返す。最大件数に上限を設ける。
 */

export type MonitoringControlStatus = 'normal' | 'training' | 'test';

export const MONITORING_HISTORY_LIMIT_DEFAULT = 100;
export const MONITORING_HISTORY_LIMIT_MAX = 200;

// ---------------------------------------------------------------------------
// 受信履歴
// ---------------------------------------------------------------------------

export interface MonitoringReceptionSummary {
  readonly id: number;
  readonly fetchAttemptId: number | null;
  readonly feedKind: string | null;
  readonly documentUrl: string;
  readonly telegramType: string | null;
  readonly title: string | null;
  /** 'normal' | 'training' | 'test' | null。null は不明であり、normal とみなさない。 */
  readonly controlStatus: MonitoringControlStatus | null;
  readonly infoType: string | null;
  readonly eventId: string | null;
  readonly serial: string | null;
  readonly controlDateTime: UtcIso8601String | null;
  readonly reportDateTime: UtcIso8601String | null;
  readonly targetDateTime: UtcIso8601String | null;
  readonly receivedAt: UtcIso8601String;
  /** 原文は一覧に含めない（確定事項3）。有無とサイズだけを返す。 */
  readonly hasRawBody: boolean;
  readonly bodyBytes: number | null;
  readonly contentHash: string | null;
  readonly areas: readonly {
    readonly areaCode: string;
    readonly areaName: string | null;
    readonly codeType: string | null;
  }[];
  /** 会場ごとの採用判定。片方の会場の非採用を隠さない。 */
  readonly adoptions: readonly {
    readonly venueId: VenueId;
    readonly adoptionResult: string | null;
    readonly adoptionReason: string | null;
    readonly adoptionDecidedAt: UtcIso8601String | null;
  }[];
}

export interface MonitoringReceptionListResponse {
  readonly status: 'ready';
  readonly generatedAt: UtcIso8601String;
  readonly totalCount: number;
  readonly limit: number;
  readonly offset: number;
  readonly items: readonly MonitoringReceptionSummary[];
}

export interface MonitoringReceptionDetailResponse {
  readonly status: 'ready';
  readonly generatedAt: UtcIso8601String;
  readonly reception: MonitoringReceptionSummary & {
    /** 電文原文。保存されていなければ null。 */
    readonly rawBody: string | null;
  };
}

export interface MonitoringReceptionQuery {
  readonly controlStatus?: MonitoringControlStatus;
  readonly telegramType?: string;
  readonly infoType?: string;
  readonly areaCode?: string;
  readonly documentUrl?: string;
  readonly adoptionResult?: string;
  readonly adoptionVenueId?: VenueId;
  readonly receivedAtFrom?: UtcIso8601String;
  readonly receivedAtTo?: UtcIso8601String;
  readonly reportDateTimeFrom?: UtcIso8601String;
  readonly reportDateTimeTo?: UtcIso8601String;
  readonly limit: number;
  readonly offset: number;
}

// ---------------------------------------------------------------------------
// 通知出力履歴
// ---------------------------------------------------------------------------

export interface MonitoringNotificationOutputQuery {
  readonly category?: string;
  readonly sourceType?: string;
  readonly changeType?: string;
  readonly origin?: 'weather' | 'system';
  readonly detectionContext?: 'normal' | 'initial';
  readonly isTraining?: boolean;
  readonly detectedAtFrom?: UtcIso8601String;
  readonly detectedAtTo?: UtcIso8601String;
  readonly limit: number;
  readonly offset: number;
}

// ---------------------------------------------------------------------------
// 操作記録
// ---------------------------------------------------------------------------

export interface MonitoringOperationQuery {
  readonly operationKind?: 'start' | 'stop' | 'force_refresh';
  readonly result?: 'success' | 'failure';
  readonly actorId?: string;
  readonly requestedAtFrom?: UtcIso8601String;
  readonly requestedAtTo?: UtcIso8601String;
  readonly completedAtFrom?: UtcIso8601String;
  readonly completedAtTo?: UtcIso8601String;
  readonly limit: number;
  readonly offset: number;
}

// ---------------------------------------------------------------------------
// パース共通処理
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const LIMIT_PATTERN = /^[1-9][0-9]*$/;
const OFFSET_PATTERN = /^(0|[1-9][0-9]*)$/;
const MAX_OFFSET = 100000;

function parseLimit(raw: unknown): number | null {
  if (raw === undefined) {
    return MONITORING_HISTORY_LIMIT_DEFAULT;
  }
  if (typeof raw !== 'string' || !LIMIT_PATTERN.test(raw)) {
    return null;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > MONITORING_HISTORY_LIMIT_MAX) {
    return null;
  }
  return value;
}

function parseOffset(raw: unknown): number | null {
  if (raw === undefined) {
    return 0;
  }
  if (typeof raw !== 'string' || !OFFSET_PATTERN.test(raw)) {
    return null;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > MAX_OFFSET) {
    return null;
  }
  return value;
}

function isValidUtcIso8601(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length === 0) {
    return false;
  }
  return !Number.isNaN(Date.parse(raw));
}

function parseNonEmptyString(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  return raw;
}

// ---------------------------------------------------------------------------
// parseMonitoringReceptionQuery
// ---------------------------------------------------------------------------

const RECEPTION_QUERY_KEYS = new Set([
  'controlStatus',
  'telegramType',
  'infoType',
  'areaCode',
  'documentUrl',
  'adoptionResult',
  'adoptionVenueId',
  'receivedAtFrom',
  'receivedAtTo',
  'reportDateTimeFrom',
  'reportDateTimeTo',
  'limit',
  'offset',
]);

export function parseMonitoringReceptionQuery(query: unknown): MonitoringReceptionQuery | null {
  if (!isPlainObject(query)) {
    return null;
  }
  for (const key of Object.keys(query)) {
    if (!RECEPTION_QUERY_KEYS.has(key)) {
      return null;
    }
  }

  const result: {
    controlStatus?: MonitoringControlStatus;
    telegramType?: string;
    infoType?: string;
    areaCode?: string;
    documentUrl?: string;
    adoptionResult?: string;
    adoptionVenueId?: VenueId;
    receivedAtFrom?: UtcIso8601String;
    receivedAtTo?: UtcIso8601String;
    reportDateTimeFrom?: UtcIso8601String;
    reportDateTimeTo?: UtcIso8601String;
  } = {};

  if ('controlStatus' in query) {
    const raw = query.controlStatus;
    if (raw !== 'normal' && raw !== 'training' && raw !== 'test') {
      return null;
    }
    result.controlStatus = raw;
  }
  if ('telegramType' in query) {
    const v = parseNonEmptyString(query.telegramType);
    if (v === null) return null;
    result.telegramType = v;
  }
  if ('infoType' in query) {
    const v = parseNonEmptyString(query.infoType);
    if (v === null) return null;
    result.infoType = v;
  }
  if ('areaCode' in query) {
    const v = parseNonEmptyString(query.areaCode);
    if (v === null) return null;
    result.areaCode = v;
  }
  if ('documentUrl' in query) {
    const v = parseNonEmptyString(query.documentUrl);
    if (v === null) return null;
    result.documentUrl = v;
  }
  if ('adoptionResult' in query) {
    const v = parseNonEmptyString(query.adoptionResult);
    if (v === null) return null;
    result.adoptionResult = v;
  }
  if ('adoptionVenueId' in query) {
    const raw = query.adoptionVenueId;
    if (!isVenueId(raw)) return null;
    result.adoptionVenueId = raw;
  }
  if ('receivedAtFrom' in query) {
    if (!isValidUtcIso8601(query.receivedAtFrom)) return null;
    result.receivedAtFrom = query.receivedAtFrom;
  }
  if ('receivedAtTo' in query) {
    if (!isValidUtcIso8601(query.receivedAtTo)) return null;
    result.receivedAtTo = query.receivedAtTo;
  }
  if ('reportDateTimeFrom' in query) {
    if (!isValidUtcIso8601(query.reportDateTimeFrom)) return null;
    result.reportDateTimeFrom = query.reportDateTimeFrom;
  }
  if ('reportDateTimeTo' in query) {
    if (!isValidUtcIso8601(query.reportDateTimeTo)) return null;
    result.reportDateTimeTo = query.reportDateTimeTo;
  }

  const limit = parseLimit(query.limit);
  if (limit === null) return null;
  const offset = parseOffset(query.offset);
  if (offset === null) return null;

  return { ...result, limit, offset };
}

// ---------------------------------------------------------------------------
// parseMonitoringReceptionIdParam
// ---------------------------------------------------------------------------

const RECEPTION_ID_PATTERN = /^[1-9][0-9]*$/;

/** :id パスパラメータの検証。前ゼロ・負数・小数・全角数字・空を拒否する。 */
export function parseMonitoringReceptionIdParam(param: unknown): number | null {
  if (typeof param !== 'string' || !RECEPTION_ID_PATTERN.test(param)) {
    return null;
  }
  const value = Number(param);
  if (!Number.isSafeInteger(value)) {
    return null;
  }
  return value;
}

// ---------------------------------------------------------------------------
// parseMonitoringNotificationOutputQuery
// ---------------------------------------------------------------------------

const NOTIFICATION_OUTPUT_QUERY_KEYS = new Set([
  'category',
  'sourceType',
  'changeType',
  'origin',
  'detectionContext',
  'isTraining',
  'detectedAtFrom',
  'detectedAtTo',
  'limit',
  'offset',
]);

export function parseMonitoringNotificationOutputQuery(
  query: unknown,
): MonitoringNotificationOutputQuery | null {
  if (!isPlainObject(query)) {
    return null;
  }
  for (const key of Object.keys(query)) {
    if (!NOTIFICATION_OUTPUT_QUERY_KEYS.has(key)) {
      return null;
    }
  }

  const result: {
    category?: string;
    sourceType?: string;
    changeType?: string;
    origin?: 'weather' | 'system';
    detectionContext?: 'normal' | 'initial';
    isTraining?: boolean;
    detectedAtFrom?: UtcIso8601String;
    detectedAtTo?: UtcIso8601String;
  } = {};

  if ('category' in query) {
    const v = parseNonEmptyString(query.category);
    if (v === null) return null;
    result.category = v;
  }
  if ('sourceType' in query) {
    const v = parseNonEmptyString(query.sourceType);
    if (v === null) return null;
    result.sourceType = v;
  }
  if ('changeType' in query) {
    const v = parseNonEmptyString(query.changeType);
    if (v === null) return null;
    result.changeType = v;
  }
  if ('origin' in query) {
    const raw = query.origin;
    if (raw !== 'weather' && raw !== 'system') return null;
    result.origin = raw;
  }
  if ('detectionContext' in query) {
    const raw = query.detectionContext;
    if (raw !== 'normal' && raw !== 'initial') return null;
    result.detectionContext = raw;
  }
  if ('isTraining' in query) {
    const raw = query.isTraining;
    if (raw !== 'true' && raw !== 'false') return null;
    result.isTraining = raw === 'true';
  }
  if ('detectedAtFrom' in query) {
    if (!isValidUtcIso8601(query.detectedAtFrom)) return null;
    result.detectedAtFrom = query.detectedAtFrom;
  }
  if ('detectedAtTo' in query) {
    if (!isValidUtcIso8601(query.detectedAtTo)) return null;
    result.detectedAtTo = query.detectedAtTo;
  }

  const limit = parseLimit(query.limit);
  if (limit === null) return null;
  const offset = parseOffset(query.offset);
  if (offset === null) return null;

  return { ...result, limit, offset };
}

// ---------------------------------------------------------------------------
// parseMonitoringOperationQuery
// ---------------------------------------------------------------------------

const OPERATION_QUERY_KEYS = new Set([
  'operationKind',
  'result',
  'actorId',
  'requestedAtFrom',
  'requestedAtTo',
  'completedAtFrom',
  'completedAtTo',
  'limit',
  'offset',
]);

export function parseMonitoringOperationQuery(query: unknown): MonitoringOperationQuery | null {
  if (!isPlainObject(query)) {
    return null;
  }
  for (const key of Object.keys(query)) {
    if (!OPERATION_QUERY_KEYS.has(key)) {
      return null;
    }
  }

  const result: {
    operationKind?: 'start' | 'stop' | 'force_refresh';
    result?: 'success' | 'failure';
    actorId?: string;
    requestedAtFrom?: UtcIso8601String;
    requestedAtTo?: UtcIso8601String;
    completedAtFrom?: UtcIso8601String;
    completedAtTo?: UtcIso8601String;
  } = {};

  if ('operationKind' in query) {
    const raw = query.operationKind;
    if (raw !== 'start' && raw !== 'stop' && raw !== 'force_refresh') return null;
    result.operationKind = raw;
  }
  if ('result' in query) {
    const raw = query.result;
    if (raw !== 'success' && raw !== 'failure') return null;
    result.result = raw;
  }
  if ('actorId' in query) {
    const v = parseNonEmptyString(query.actorId);
    if (v === null) return null;
    result.actorId = v;
  }
  if ('requestedAtFrom' in query) {
    if (!isValidUtcIso8601(query.requestedAtFrom)) return null;
    result.requestedAtFrom = query.requestedAtFrom;
  }
  if ('requestedAtTo' in query) {
    if (!isValidUtcIso8601(query.requestedAtTo)) return null;
    result.requestedAtTo = query.requestedAtTo;
  }
  if ('completedAtFrom' in query) {
    if (!isValidUtcIso8601(query.completedAtFrom)) return null;
    result.completedAtFrom = query.completedAtFrom;
  }
  if ('completedAtTo' in query) {
    if (!isValidUtcIso8601(query.completedAtTo)) return null;
    result.completedAtTo = query.completedAtTo;
  }

  const limit = parseLimit(query.limit);
  if (limit === null) return null;
  const offset = parseOffset(query.offset);
  if (offset === null) return null;

  return { ...result, limit, offset };
}

// ---------------------------------------------------------------------------
// 通知出力履歴・操作記録の一覧応答
// ---------------------------------------------------------------------------

export interface MonitoringListResponse<T> {
  readonly status: 'ready';
  readonly generatedAt: UtcIso8601String;
  readonly totalCount: number;
  readonly limit: number;
  readonly offset: number;
  readonly items: readonly T[];
}
