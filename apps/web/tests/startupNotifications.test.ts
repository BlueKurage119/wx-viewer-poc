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
