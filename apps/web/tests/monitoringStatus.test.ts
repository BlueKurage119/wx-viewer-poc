import assert from 'node:assert/strict';
import test from 'node:test';
import { createMonitoringStatusClient } from '../src/api/monitoringStatus.ts';
import { monitoringResponseFixture } from './monitoringFixture.ts';

test('K1: 監視状態APIは端末IDをエンコードして読み取り、端末不一致を受理しない', async () => {
  const requests: { readonly url: string; readonly signal: AbortSignal | null | undefined }[] = [];
  const client = createMonitoringStatusClient({
    fetch: async (url, init) => {
      requests.push({ url: String(url), signal: init?.signal });
      return new Response(JSON.stringify(monitoringResponseFixture));
    },
  });
  const controller = new AbortController();

  assert.deepEqual(
    await client.fetchMonitoringStatus('kkeagh01', controller.signal),
    monitoringResponseFixture,
  );
  assert.deepEqual(requests, [
    { url: '/api/monitoring/status?terminalId=kkeagh01', signal: controller.signal },
  ]);

  const mismatched = createMonitoringStatusClient({
    fetch: async () =>
      new Response(JSON.stringify({ ...monitoringResponseFixture, terminalId: 'hkeagh01' })),
  });
  await assert.rejects(mismatched.fetchMonitoringStatus('kkeagh01'), {
    message: '監視情報の応答形式が不正です',
  });
});
