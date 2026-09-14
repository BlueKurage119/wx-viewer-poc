import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isNotificationDeltaCursor,
  notificationDeltaCursorToSequence,
  toNotificationDeltaCursor,
  NOTIFICATION_DELTA_CURSOR_PATTERN,
  type NotificationDeltaCursor,
} from '../src/notificationDeltaCursor.js';

test('NOTIFICATION_DELTA_CURSOR_PATTERN / isNotificationDeltaCursor: 正当なカーソル文字列を受理する', () => {
  assert.equal(NOTIFICATION_DELTA_CURSOR_PATTERN.test('0'), true);
  assert.equal(isNotificationDeltaCursor('0'), true);
  assert.equal(isNotificationDeltaCursor('1'), true);
  assert.equal(isNotificationDeltaCursor('42'), true);
  assert.equal(isNotificationDeltaCursor('1234567890123456'), true); // 16桁
});

test('isNotificationDeltaCursor: 不正なカーソル文字列を拒絶する', () => {
  assert.equal(isNotificationDeltaCursor(''), false); // 空文字
  assert.equal(isNotificationDeltaCursor('01'), false); // 前ゼロ
  assert.equal(isNotificationDeltaCursor('00'), false); // 前ゼロ
  assert.equal(isNotificationDeltaCursor('-1'), false); // 負数
  assert.equal(isNotificationDeltaCursor('+1'), false); // プラス符号
  assert.equal(isNotificationDeltaCursor('1.5'), false); // 小数
  assert.equal(isNotificationDeltaCursor(' 1'), false); // 前空白
  assert.equal(isNotificationDeltaCursor('1 '), false); // 後空白
  assert.equal(isNotificationDeltaCursor('１'), false); // 全角数字
  assert.equal(isNotificationDeltaCursor('12345678901234567'), false); // 17桁
  assert.equal(isNotificationDeltaCursor('abc'), false);
  assert.equal(isNotificationDeltaCursor(null), false);
  assert.equal(isNotificationDeltaCursor(undefined), false);
  assert.equal(isNotificationDeltaCursor(0), false);
  assert.equal(isNotificationDeltaCursor({}), false);
});

test('toNotificationDeltaCursor: 非負の安全整数を NotificationDeltaCursor に変換する', () => {
  assert.equal(toNotificationDeltaCursor(0), '0');
  assert.equal(toNotificationDeltaCursor(1), '1');
  assert.equal(toNotificationDeltaCursor(1234), '1234');
  assert.equal(toNotificationDeltaCursor(Number.MAX_SAFE_INTEGER), String(Number.MAX_SAFE_INTEGER));
});

test('toNotificationDeltaCursor: 負数・小数・非安全整数・NaN では例外を投げる', () => {
  assert.throws(() => toNotificationDeltaCursor(-1), RangeError);
  assert.throws(() => toNotificationDeltaCursor(1.5), RangeError);
  assert.throws(() => toNotificationDeltaCursor(Number.NaN), RangeError);
  assert.throws(() => toNotificationDeltaCursor(Number.POSITIVE_INFINITY), RangeError);
  assert.throws(() => toNotificationDeltaCursor(Number.MAX_SAFE_INTEGER + 1), RangeError);
});

test('notificationDeltaCursorToSequence: カーソルを数値 sequence に変換する', () => {
  assert.equal(notificationDeltaCursorToSequence(toNotificationDeltaCursor(0)), 0);
  assert.equal(notificationDeltaCursorToSequence(toNotificationDeltaCursor(1234)), 1234);
});

test('notificationDeltaCursorToSequence: 不正なカーソル値では例外を投げる', () => {
  assert.throws(
    () => notificationDeltaCursorToSequence('invalid' as unknown as NotificationDeltaCursor),
    TypeError,
  );
  assert.throws(
    () => notificationDeltaCursorToSequence('-1' as unknown as NotificationDeltaCursor),
    TypeError,
  );
});
