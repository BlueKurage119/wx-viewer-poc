import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidTerminalId } from '../src/terminalConfig.ts';

test('端末 ID は登録可能な形式を受理する', () => {
  for (const id of ['a', 'hkeagh01', 'terminal-2', `a${'0'.repeat(31)}`]) {
    assert.equal(isValidTerminalId(id), true, id);
  }
});

test('静的配信パスと不正な端末 ID を拒否する', () => {
  for (const id of [
    'audio',
    'api',
    'assets',
    'config',
    'src',
    'node_modules',
    'public',
    '',
    'A',
    '-a',
    `a${'0'.repeat(32)}`,
    null,
  ]) {
    assert.equal(isValidTerminalId(id), false, String(id));
  }
});
