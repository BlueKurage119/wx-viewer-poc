import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMonitoringReceptionQuery } from '../src/monitoringHistory.js';

/**
 * レビュー指摘 #5: isValidUtcIso8601 が Date.parse ベースだったため、
 * タイムゾーン付きや日付だけの文字列も受理してしまっていた。
 * UtcIso8601String（Z終端のUTC限定）契約に沿った厳格な検証になっているかを確認する。
 */
test('receivedAtFrom は Z終端の厳密なUTC ISO8601形式のみ受理する', () => {
  const invalidValues = [
    '2024-01-01', // 日付のみ
    '2024-01-01T00:00:00+09:00', // タイムゾーンオフセット付き
    '2024-01-01T00:00:00', // タイムゾーン指定なし
    '2024-13-01T00:00:00Z', // 存在しない月
    'not-a-date',
    '',
  ];
  for (const value of invalidValues) {
    const result = parseMonitoringReceptionQuery({ receivedAtFrom: value });
    assert.equal(result, null, `should reject: ${value}`);
  }

  const validValues = ['2024-01-01T00:00:00Z', '2024-01-01T00:00:00.123Z'];
  for (const value of validValues) {
    const result = parseMonitoringReceptionQuery({ receivedAtFrom: value });
    assert.notEqual(result, null, `should accept: ${value}`);
    assert.equal(result?.receivedAtFrom, value);
  }
});
