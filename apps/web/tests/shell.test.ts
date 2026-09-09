import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveTerminal, resolveView, terminals } from '../src/shell/config.ts';
import { visibleNotices } from '../src/shell/notifications.ts';
import { previewNotices } from '../src/shell/fixtures.ts';
import { isUnknownTerminalDocument } from '../src/shell/terminalRouting.ts';

test('登録端末のみを解決し、H/Kで同じ会場を共有する', () => {
  for (const terminal of terminals) {
    assert.equal(resolveTerminal(`/${terminal.id}`), terminal);
    assert.equal(resolveTerminal(`/${terminal.id}/`), terminal);
  }
  for (const path of [
    '/',
    '/hunknown',
    '/HKEAGH01',
    '/hkeagh01/extra',
    '//hkeagh01',
    '/constructor',
    '/toString',
  ])
    assert.equal(resolveTerminal(path), undefined);
  assert.equal(terminals[0]!.venue, terminals[1]!.venue);
  assert.equal(terminals[2]!.venue, terminals[3]!.venue);
  assert.notEqual(terminals[0]!.venue, terminals[2]!.venue);
  assert.equal(terminals[0]!.venue.weatherTargets, terminals[1]!.venue.weatherTargets);
  assert.deepEqual(terminals[0]!.venue.weatherTargets.mapReference, {
    latitude: 35.63159368010876,
    longitude: 139.79281040119963,
  });
  assert.deepEqual(terminals[2]!.venue.weatherTargets.mapReference, {
    latitude: 35.58138,
    longitude: 139.748119,
  });
  assert.deepEqual(terminals[0]!.venue.weatherTargets.warning, {
    municipalCode: '1310800',
    displayName: '江東区',
    prefectureCode: '130000',
  });
  assert.deepEqual(terminals[2]!.venue.weatherTargets.amedas, {
    stationCode: '44166',
    displayName: '羽田',
    elements: '11110000',
  });
});
test('H端末の監視・訓練通知直指定や未知ビューは防災気象情報へ戻す', () => {
  assert.equal(resolveView('#monitor', 'H'), 'weather');
  assert.equal(resolveView('#monitor', 'K'), 'monitor');
  assert.equal(resolveView('#training', 'H'), 'weather');
  assert.equal(resolveView('#training', 'K'), 'training');
  for (const mode of ['H', 'K'] as const) {
    assert.equal(resolveView('#warnings', mode), 'warnings');
    assert.equal(resolveView('#unknown', mode), 'weather');
    assert.equal(resolveView('', mode), 'weather');
  }
});
test('H表示の絞り込みは通知の生成・保持やK表示を破壊しない', () => {
  const notices = Object.freeze(previewNotices('mixed').map(Object.freeze));
  const h = visibleNotices(notices, 'H');
  assert.equal(h.length, 3);
  assert.equal(h.filter((notice) => notice.pending).length, 2);
  assert.equal(visibleNotices(notices, 'K').length, 4);
  assert.equal(notices.length, 4);
  assert.ok(h.some((notice) => notice.category === 'emergency'));
});
test('未登録HTMLアクセスのみ404対象とし、APIやモジュールを妨げない', () => {
  assert.equal(isUnknownTerminalDocument('/unknown', 'text/html'), true);
  assert.equal(isUnknownTerminalDocument('/hkeagh01/extra', 'text/html'), true);
  for (const path of [
    '/',
    '/hkeagh01/',
    '/kkeagh01?shellPreview=1',
    '/api/health',
    '/@vite/client',
  ])
    assert.equal(isUnknownTerminalDocument(path, 'text/html'), false);
  assert.equal(isUnknownTerminalDocument('/src/main.tsx', '*/*'), false);
});
