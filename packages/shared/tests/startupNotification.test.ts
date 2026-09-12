import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStartupNotificationRequest, resolveTerminalDefinition } from '../src/index.ts';

test('起動通知 request は端末台帳と UUID v4 の厳密な入力だけを受理する', () => {
  assert.deepEqual(resolveTerminalDefinition('hkeagh01'), {
    id: 'hkeagh01',
    mode: 'H',
    venueId: 'east',
  });
  assert.deepEqual(resolveTerminalDefinition('ktrcph01'), {
    id: 'ktrcph01',
    mode: 'K',
    venueId: 'trc',
  });
  assert.equal(resolveTerminalDefinition('unknown'), null);
  assert.deepEqual(
    parseStartupNotificationRequest({
      terminalId: 'hkeagh01',
      sessionId: '00000000-0000-4000-8000-000000000001',
    }),
    {
      terminalId: 'hkeagh01',
      sessionId: '00000000-0000-4000-8000-000000000001',
    },
  );
  for (const invalid of [
    null,
    [],
    { terminalId: '', sessionId: '00000000-0000-4000-8000-000000000001' },
    { terminalId: 'hkeagh01', sessionId: '00000000-0000-4000-8000-000000000001', extra: 1 },
    { terminalId: 'hkeagh01', sessionId: '00000000-0000-4000-8000-00000000000A' },
  ]) {
    assert.equal(parseStartupNotificationRequest(invalid), null);
  }
});
