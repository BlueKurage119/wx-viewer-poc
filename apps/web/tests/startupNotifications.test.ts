import assert from 'node:assert/strict';
import test from 'node:test';
import { createStartupNotificationClient } from '../src/api/startupNotifications.ts';

const sessionA = '00000000-0000-4000-8000-000000000001';

test('AC12: StrictMode 相当の重複購読と abort でも同一端末への POST は一度で、端末ごとの session を維持する', async () => {
  const bodies: string[] = [];
  const client = createStartupNotificationClient({
    getSession: (terminalId) =>
      terminalId === 'broken'
        ? { status: 'unavailable', reason: 'random' }
        : {
            status: 'ready',
            sessionId: terminalId === 'a' ? sessionA : '00000000-0000-4000-8000-000000000002',
            persistence: 'memory',
          },
    fetch: async (_url, init) => {
      bodies.push(String(init?.body));
      return new Response(JSON.stringify({ status: 'initializing', venueId: 'east' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  const controller = new AbortController();
  const first = client.fetchStartupNotifications('a', controller.signal);
  controller.abort();
  const second = client.fetchStartupNotifications('a');
  assert.deepEqual(await first, { status: 'initializing', venueId: 'east' });
  assert.deepEqual(await second, { status: 'initializing', venueId: 'east' });
  await client.fetchStartupNotifications('a');
  await client.fetchStartupNotifications('b');
  assert.deepEqual(bodies, [
    JSON.stringify({ terminalId: 'a', sessionId: sessionA }),
    JSON.stringify({ terminalId: 'b', sessionId: '00000000-0000-4000-8000-000000000002' }),
  ]);
  assert.deepEqual(await client.fetchStartupNotifications('broken'), {
    status: 'unavailable',
    reason: 'session',
  });
});

test('ready 応答: cursor が存在する場合は ready として受理し、cursor 欠落時は unavailable(server) とする', async () => {
  const readyBodyWithCursor = {
    status: 'ready',
    terminalId: 'a',
    venueId: 'east',
    serverGenerationId: 'gen-1',
    generatedAt: '2026-09-14T10:00:00Z',
    session: { kind: 'startup', firstInquiredAt: '2026-09-14T10:00:00Z' },
    warningClaimed: true,
    notifications: [],
    cursor: '10',
  };
  const readyBodyWithoutCursor = {
    status: 'ready',
    terminalId: 'a',
    venueId: 'east',
    serverGenerationId: 'gen-1',
    generatedAt: '2026-09-14T10:00:00Z',
    session: { kind: 'startup', firstInquiredAt: '2026-09-14T10:00:00Z' },
    warningClaimed: true,
    notifications: [],
  };

  const clientWithCursor = createStartupNotificationClient({
    getSession: () => ({ status: 'ready', sessionId: sessionA, persistence: 'memory' }),
    fetch: async () =>
      new Response(JSON.stringify(readyBodyWithCursor), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  });

  const res1 = await clientWithCursor.fetchStartupNotifications('a');
  assert.deepEqual(res1, readyBodyWithCursor);

  const clientWithoutCursor = createStartupNotificationClient({
    getSession: () => ({ status: 'ready', sessionId: sessionA, persistence: 'memory' }),
    fetch: async () =>
      new Response(JSON.stringify(readyBodyWithoutCursor), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  });

  const res2 = await clientWithoutCursor.fetchStartupNotifications('a');
  assert.deepEqual(res2, { status: 'unavailable', reason: 'server' });
});

test('H2 AC6: targetsが空など契約外のready通知はunavailable(server)として再試行対象にする', async () => {
  const invalidReadyBody = {
    status: 'ready',
    terminalId: 'a',
    venueId: 'east',
    serverGenerationId: 'gen-1',
    generatedAt: '2026-09-14T10:00:00Z',
    session: { kind: 'startup', firstInquiredAt: '2026-09-14T10:00:00Z' },
    warningClaimed: true,
    cursor: '10',
    notifications: [{ outputId: 'output-1', targets: [] }],
  };
  const client = createStartupNotificationClient({
    getSession: () => ({ status: 'ready', sessionId: sessionA, persistence: 'memory' }),
    fetch: async () =>
      new Response(JSON.stringify(invalidReadyBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  });

  assert.deepEqual(await client.fetchStartupNotifications('a'), {
    status: 'unavailable',
    reason: 'server',
  });
});
