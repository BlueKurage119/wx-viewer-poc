import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatJstDateTime,
  formatJstMonthDayClock,
  formatJstTime,
} from '../src/monitoring/monitoringTimeFormat.ts';

test('formatJstMonthDayClock: JST日時の MM/DD HH:mm:ss 書式整形（年を含まない）', () => {
  // 昼の時刻
  assert.equal(formatJstMonthDayClock('2026-09-21T03:15:30.000Z'), '09/21 12:15:30');
});

test('formatJstMonthDayClock: UTCからJSTへの日付繰り上がり', () => {
  // UTC 2026-09-21 15:00:00 は JST 2026-09-22 00:00:00
  assert.equal(formatJstMonthDayClock('2026-09-21T15:00:00.000Z'), '09/22 00:00:00');
  // UTC 2026-09-21 23:59:59 は JST 2026-09-22 08:59:59
  assert.equal(formatJstMonthDayClock('2026-09-21T23:59:59.000Z'), '09/22 08:59:59');
});

test('formatJstMonthDayClock: null・空文字・不正文字列のときは — を返す', () => {
  assert.equal(formatJstMonthDayClock(null), '—');
  assert.equal(formatJstMonthDayClock(''), '—');
  assert.equal(formatJstMonthDayClock('invalid-date'), '—');
});

test('formatJstTime: HH:mm 書式整形', () => {
  assert.equal(formatJstTime('2026-09-21T03:15:30.000Z'), '12:15');
  assert.equal(formatJstTime(''), '—');
});

test('formatJstDateTime: YYYY/MM/DD HH:mm:ss 書式整形', () => {
  assert.equal(formatJstDateTime('2026-09-21T03:15:30.000Z'), '2026/09/21 12:15:30');
  assert.equal(formatJstDateTime(''), '—');
});
