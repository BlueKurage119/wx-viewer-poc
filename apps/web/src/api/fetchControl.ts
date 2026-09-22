import {
  isFetchControlRequestId,
  type FetchControlCompletedResponse,
  type FetchControlInProgressResponse,
  type FetchControlOperationKind,
} from '@wx-viewer-poc/shared';
import type {
  FetchControlClient,
  FetchControlReply,
  SubmittedOperation,
} from '../monitoring/monitoringOperationController';

type Method = 'POST' | 'GET';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUtcIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3]) &&
    date.getUTCHours() === Number(match[4]) &&
    date.getUTCMinutes() === Number(match[5]) &&
    date.getUTCSeconds() === Number(match[6])
  );
}

function hasBaseResponse(value: Record<string, unknown>, expected: SubmittedOperation): boolean {
  return (
    isFetchControlRequestId(value.requestId) &&
    value.requestId === expected.requestId &&
    value.operationKind === expected.operationKind &&
    value.targetKind === 'all' &&
    ['starting', 'running', 'stopping', 'stopped'].includes(String(value.fetchControlState)) &&
    isUtcIsoDate(value.requestedAt)
  );
}

function isCompletedResponse(
  value: unknown,
  expected: SubmittedOperation,
): value is FetchControlCompletedResponse {
  if (!isRecord(value) || value.status !== 'completed' || !hasBaseResponse(value, expected))
    return false;
  return (
    isUtcIsoDate(value.completedAt) &&
    (value.result === 'success' || value.result === 'failure') &&
    typeof value.duplicate === 'boolean' &&
    (typeof value.errorCode === 'string' || value.errorCode === null) &&
    (typeof value.errorMessage === 'string' || value.errorMessage === null)
  );
}

function isInProgressResponse(
  value: unknown,
  expected: SubmittedOperation,
): value is FetchControlInProgressResponse {
  return isRecord(value) && value.status === 'in_progress' && hasBaseResponse(value, expected);
}

function isErrorEnvelope(value: unknown, code: string): boolean {
  return isRecord(value) && value.status === 'error' && value.code === code;
}

/** E11の応答をHTTP状態と本文の組で検証し、画面へ渡す分類だけを返す。 */
export function parseFetchControlReply(
  httpStatus: number,
  body: unknown,
  expected: SubmittedOperation,
  method: Method,
): FetchControlReply {
  if (httpStatus === 200 && isCompletedResponse(body, expected)) {
    return { kind: 'completed', response: body };
  }
  if (httpStatus === 202 && isInProgressResponse(body, expected)) {
    return { kind: 'in_progress', response: body };
  }
  if (httpStatus === 404 && isErrorEnvelope(body, 'unknown_request')) return { kind: 'unknown' };

  const rejection =
    (httpStatus === 400 && isErrorEnvelope(body, 'invalid_request')) ||
    (httpStatus === 409 && isErrorEnvelope(body, 'operation_kind_conflict')) ||
    (httpStatus === 503 && isErrorEnvelope(body, 'fetch_control_unavailable'));
  if (rejection) {
    if (method === 'POST')
      return { kind: 'rejected', code: String((body as Record<string, unknown>).code) };
    return { kind: 'unverifiable', reason: 'server_error' };
  }
  if (httpStatus >= 500) return { kind: 'unverifiable', reason: 'server_error' };
  return { kind: 'unverifiable', reason: 'invalid_response' };
}

function operationPath(kind: FetchControlOperationKind): string {
  if (kind === 'force_refresh') return '/api/control/fetch/force-refresh';
  return `/api/control/fetch/${kind}`;
}

/** 同一オリジンのE11 APIだけを呼び出すクライアント。 */
export function createFetchControlClient(deps: {
  readonly fetch: typeof fetch;
}): FetchControlClient {
  async function sendRequest(
    method: Method,
    request: SubmittedOperation,
    signal: AbortSignal,
  ): Promise<FetchControlReply> {
    try {
      const response =
        method === 'POST'
          ? await deps.fetch(operationPath(request.operationKind), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ requestId: request.requestId }),
              signal,
            })
          : await deps.fetch(`/api/control/operations/${encodeURIComponent(request.requestId)}`, {
              cache: 'no-store',
              signal,
            });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { kind: 'unverifiable', reason: 'invalid_response' };
      }
      return parseFetchControlReply(response.status, body, request, method);
    } catch {
      return { kind: 'unverifiable', reason: 'network' };
    }
  }
  return {
    submit: (request, signal) => sendRequest('POST', request, signal),
    find: (request, signal) => sendRequest('GET', request, signal),
  };
}
