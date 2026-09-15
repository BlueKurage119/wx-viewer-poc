import type { UtcIso8601String } from './types.js';

/**
 * Issue #43「E11. 取得制御API」§4.1 のリクエスト/レスポンス型。
 * ベースパスは /api/control/ に固定し、E10 の /api/monitoring/ とは混在させない（#42 §8.3）。
 */

export type FetchControlOperationKind = 'start' | 'stop' | 'force_refresh';
export type FetchControlState = 'starting' | 'running' | 'stopping' | 'stopped';

export interface FetchControlRequest {
  readonly requestId: string; // RFC4122 UUID 文字列（クライアント生成）
}

export interface FetchControlCompletedResponse {
  readonly status: 'completed';
  readonly requestId: string;
  readonly operationKind: FetchControlOperationKind;
  readonly targetKind: 'all';
  readonly result: 'success' | 'failure';
  readonly requestedAt: UtcIso8601String;
  readonly completedAt: UtcIso8601String;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  /** 既存記録の再生なら true。 */
  readonly duplicate: boolean;
  readonly fetchControlState: FetchControlState;
}

export interface FetchControlInProgressResponse {
  readonly status: 'in_progress';
  readonly requestId: string;
  readonly operationKind: FetchControlOperationKind;
  readonly targetKind: 'all';
  readonly requestedAt: UtcIso8601String;
  readonly fetchControlState: FetchControlState;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** パス変数 :requestId の検証にも使う。 */
export function isFetchControlRequestId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 本文が {requestId: <UUID>} ちょうど1キーでなければ null。 */
export function parseFetchControlRequest(value: unknown): FetchControlRequest | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || !keys.includes('requestId')) {
    return null;
  }
  if (!isFetchControlRequestId(value.requestId)) {
    return null;
  }
  return { requestId: value.requestId };
}
