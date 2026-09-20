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

test('K6: 稼働状態APIは health.sources の要素と lastDurationMs を検証する', async () => {
  const baseHealthSource = {
    sourceId: 'xml_regular',
    displayName: 'XML定時フィード',
    status: 'normal',
    lastAttemptAt: '2026-09-20T05:25:00.000Z',
    lastSuccessAt: '2026-09-20T05:25:00.000Z',
    consecutiveFailures: 0,
    intervalSeconds: 60,
    appliesElapsedCondition: true,
    lastDurationMs: 250,
    reasons: [],
  };

  const baseScheduledSource = {
    source: 'xml',
    state: 'waiting',
    intervalSeconds: 60,
    nextRunAt: '2026-09-20T05:26:00.000Z',
  };

  const validResponse = {
    ...monitoringResponseFixture,
    operation: {
      ...monitoringResponseFixture.operation,
      scheduledSources: [baseScheduledSource],
    },
    health: {
      ...monitoringResponseFixture.health,
      sources: [baseHealthSource],
      thresholds: {
        ...monitoringResponseFixture.health.thresholds,
        abnormalConsecutiveFailures: 5,
        delayedConsecutiveFailures: 2,
      },
    },
  };

  // 1. lastDurationMs が数値でも null でも受理する
  const clientWithNumber = createMonitoringStatusClient({
    fetch: async () => new Response(JSON.stringify(validResponse)),
  });
  const resNumber = await clientWithNumber.fetchMonitoringStatus('kkeagh01');
  assert.equal(resNumber.health.sources[0]?.lastDurationMs, 250);

  const clientWithNull = createMonitoringStatusClient({
    fetch: async () =>
      new Response(
        JSON.stringify({
          ...validResponse,
          health: {
            ...validResponse.health,
            sources: [{ ...baseHealthSource, lastDurationMs: null }],
          },
        }),
      ),
  });
  const resNull = await clientWithNull.fetchMonitoringStatus('kkeagh01');
  assert.equal(resNull.health.sources[0]?.lastDurationMs, null);

  // 2. 負数・文字列・未知enum を弾く
  const invalidCases: {
    readonly label: string;
    readonly mutate: (base: typeof validResponse) => unknown;
  }[] = [
    {
      label: 'lastDurationMs が負数',
      mutate: (b) => ({
        ...b,
        health: { ...b.health, sources: [{ ...baseHealthSource, lastDurationMs: -1 }] },
      }),
    },
    {
      label: 'lastDurationMs が文字列',
      mutate: (b) => ({
        ...b,
        health: { ...b.health, sources: [{ ...baseHealthSource, lastDurationMs: '100' }] },
      }),
    },
    {
      label: 'sourceId が未知',
      mutate: (b) => ({
        ...b,
        health: { ...b.health, sources: [{ ...baseHealthSource, sourceId: 'unknown_source' }] },
      }),
    },
    {
      label: 'status が未知のenum',
      mutate: (b) => ({
        ...b,
        health: { ...b.health, sources: [{ ...baseHealthSource, status: 'unknown_status' }] },
      }),
    },
    {
      label: 'consecutiveFailures が負数',
      mutate: (b) => ({
        ...b,
        health: { ...b.health, sources: [{ ...baseHealthSource, consecutiveFailures: -1 }] },
      }),
    },
    {
      label: 'scheduledSources.source が未知',
      mutate: (b) => ({
        ...b,
        operation: {
          ...b.operation,
          scheduledSources: [{ ...baseScheduledSource, source: 'unknown_scheduled' }],
        },
      }),
    },
    {
      label: 'scheduledSources.state が未知',
      mutate: (b) => ({
        ...b,
        operation: {
          ...b.operation,
          scheduledSources: [{ ...baseScheduledSource, state: 'unknown_state' }],
        },
      }),
    },
    {
      label: 'abnormalConsecutiveFailures が負数',
      mutate: (b) => ({
        ...b,
        health: {
          ...b.health,
          thresholds: { ...b.health.thresholds, abnormalConsecutiveFailures: -1 },
        },
      }),
    },
  ];

  for (const { label, mutate } of invalidCases) {
    const invalidClient = createMonitoringStatusClient({
      fetch: async () => new Response(JSON.stringify(mutate(validResponse))),
    });
    await assert.rejects(
      invalidClient.fetchMonitoringStatus('kkeagh01'),
      {
        message: '監視情報の応答形式が不正です',
      },
      `${label} で拒否されること`,
    );
  }
});
