import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchNotificationDelta } from '../src/api/notificationDelta.ts';

test('H2 AC6: targetsが空など契約外のdelta ready応答をunavailableとして再試行対象にする', async () => {
  const originalFetch = window.fetch;
  window.fetch = async () =>
    new Response(
      JSON.stringify({
        status: 'ready',
        terminalId: 'a',
        venueId: 'east',
        serverGenerationId: 'gen-1',
        generatedAt: '2026-09-14T10:00:00Z',
        cursor: '10',
        skippedCount: 0,
        notifications: [{ notificationId: 'notification-1', sequence: 1, targets: [] }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  try {
    assert.deepEqual(await fetchNotificationDelta('a', '0'), { status: 'unavailable' });
  } finally {
    window.fetch = originalFetch;
  }
});
