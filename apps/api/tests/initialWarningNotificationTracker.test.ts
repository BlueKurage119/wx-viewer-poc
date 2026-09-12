import test from 'node:test';
import assert from 'node:assert/strict';
import { InitialWarningNotificationTracker } from '../src/notifications/initialWarningNotificationTracker.js';

test('InitialWarningNotificationTracker: 初期状態は isPending が true で markDone 後に false になる', () => {
  const tracker = new InitialWarningNotificationTracker();

  assert.equal(tracker.isPending('1310800', 'normal'), true);
  assert.equal(tracker.isPending('1310800', 'training'), true);
  assert.equal(tracker.isPending('1311100', 'normal'), true);

  tracker.markDone('1310800', 'normal');

  assert.equal(tracker.isPending('1310800', 'normal'), false);
  assert.equal(tracker.isPending('1310800', 'training'), true);
  assert.equal(tracker.isPending('1311100', 'normal'), true);
});

test('InitialWarningNotificationTracker: reset で全キーが pending に戻る', () => {
  const tracker = new InitialWarningNotificationTracker();

  tracker.markDone('1310800', 'normal');
  tracker.markDone('1311100', 'training');
  assert.equal(tracker.isPending('1310800', 'normal'), false);
  assert.equal(tracker.isPending('1311100', 'training'), false);

  tracker.reset();

  assert.equal(tracker.isPending('1310800', 'normal'), true);
  assert.equal(tracker.isPending('1311100', 'training'), true);
});
