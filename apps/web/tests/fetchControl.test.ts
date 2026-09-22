import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFetchControlClient, parseFetchControlReply } from '../src/api/fetchControl.ts';
import type { SubmittedOperation } from '../src/monitoring/monitoringOperationController.ts';

const request: SubmittedOperation = {
  requestId: '123e4567-e89b-42d3-a456-426614174000',
  operationKind: 'stop',
};
const inProgress = {
  status: 'in_progress',
  requestId: request.requestId,
  operationKind: request.operationKind,
  targetKind: 'all',
  requestedAt: '2026-09-22T01:02:03.000Z',
  fetchControlState: 'stopping',
};
const completed = {
  ...inProgress,
  status: 'completed',
  result: 'success',
  completedAt: '2026-09-22T01:02:04.000Z',
  duplicate: false,
  errorCode: null,
  errorMessage: null,
};

test('E11応答: HTTP状態・ID・実在日時を組み合わせて検証し、未知キーは許容する', () => {
  assert.deepEqual(parseFetchControlReply(202, { ...inProgress, future: true }, request, 'POST'), {
    kind: 'in_progress',
    response: { ...inProgress, future: true },
  });
  assert.equal(
    parseFetchControlReply(
      200,
      { ...completed, requestId: '123e4567-e89b-42d3-a456-426614174001' },
      request,
      'GET',
    ).kind,
    'unverifiable',
  );
  assert.equal(
    parseFetchControlReply(
      200,
      { ...completed, completedAt: '2026-02-30T01:02:04.000Z' },
      request,
      'GET',
    ).kind,
    'unverifiable',
  );
  assert.deepEqual(
    parseFetchControlReply(404, { status: 'error', code: 'unknown_request' }, request, 'GET'),
    {
      kind: 'unknown',
    },
  );
});

test('E11クライアント: 操作別POSTと同一IDのGETを同一オリジン契約で送る', async () => {
  const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
  const client = createFetchControlClient({
    fetch: async (input, init) => {
      calls.push({ input: String(input), init });
      return { status: 200, json: async () => completed } as Response;
    },
  });
  assert.equal((await client.submit(request, new AbortController().signal)).kind, 'completed');
  assert.equal((await client.find(request, new AbortController().signal)).kind, 'completed');
  assert.deepEqual(calls, [
    {
      input: '/api/control/fetch/stop',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: request.requestId }),
        signal: calls[0]?.init?.signal,
      },
    },
    {
      input: `/api/control/operations/${request.requestId}`,
      init: { cache: 'no-store', signal: calls[1]?.init?.signal },
    },
  ]);
});
