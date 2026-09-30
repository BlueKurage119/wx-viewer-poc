import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerminalRegistry, parseStartupNotificationRequest } from '../src/index.ts';

test('起動通知 request は端末台帳と UUID v4 の厳密な入力だけを受理する', () => {
  const registry = createTerminalRegistry(
    [
      { id: 'hkeagh01', name: '東地区外務H1', mode: 'H', venueId: 'east' as never },
      { id: 'ktrcph01', name: 'TRC公共K1', mode: 'K', venueId: 'trc' as never },
    ],
    'test',
  );
  assert.equal(registry.resolveTerminal('hkeagh01')?.mode, 'H');
  assert.equal(registry.resolveTerminal('ktrcph01')?.venueId, 'trc');
  assert.equal(registry.resolveTerminal('unknown'), null);
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
