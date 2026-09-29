import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMonitoringReceptionQuery,
  type MonitoringReceptionQuery,
} from '../src/monitoringHistory.js';

type IsSame<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;

// 履歴検索の会場 ID は現行レジストリの VenueId ではなく、保存済み ID をそのまま照会する文字列である。
const adoptionVenueIdIsPersistedId: IsSame<
  NonNullable<MonitoringReceptionQuery['adoptionVenueId']>,
  string
> = true;
void adoptionVenueIdIsPersistedId;

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
  }
});

/**
 * Codexレビュー指摘 #5（2回目レビュー）: isValidUtcIso8601 は小数部0〜3桁を受理するが、
 * DB保存形式（toISOString() 相当）は3桁固定である。桁数が異なるとSQLiteの文字列比較
 * （`>= ?` / `<= ?`）の辞書順がずれ、境界上の行が誤って除外/包含され得る。
 * SQLへ渡す前に3桁固定の小数へ正規化されていることを確認する。
 */
test('receivedAtFrom/To はSQL比較のためtoISOString()相当の3桁固定小数へ正規化される', () => {
  // 小数部なし → .000 を補う
  const noFraction = parseMonitoringReceptionQuery({ receivedAtFrom: '2024-01-01T00:00:00Z' });
  assert.equal(noFraction?.receivedAtFrom, '2024-01-01T00:00:00.000Z');

  // 1桁 → 3桁化（.1 は .100 であり .001 ではない）
  const oneDigit = parseMonitoringReceptionQuery({ receivedAtFrom: '2026-09-15T10:00:00.1Z' });
  assert.equal(oneDigit?.receivedAtFrom, '2026-09-15T10:00:00.100Z');

  // 2桁 → 3桁化
  const twoDigits = parseMonitoringReceptionQuery({ receivedAtTo: '2026-09-15T10:00:00.12Z' });
  assert.equal(twoDigits?.receivedAtTo, '2026-09-15T10:00:00.120Z');

  // 既に3桁ならそのまま
  const threeDigits = parseMonitoringReceptionQuery({
    reportDateTimeFrom: '2026-09-15T10:00:00.123Z',
  });
  assert.equal(threeDigits?.reportDateTimeFrom, '2026-09-15T10:00:00.123Z');

  // 正規化後、桁数の異なる同一時刻は文字列としても一致する
  // （修正前は '...00.1Z' のまま渡され、DB保存形式 '...00.100Z' と辞書順比較がずれていた）
  const normalized = parseMonitoringReceptionQuery({ receivedAtFrom: '2026-09-15T10:00:00.1Z' });
  assert.equal(normalized?.receivedAtFrom, '2026-09-15T10:00:00.100Z');
});

test('adoptionVenueId は削除済み会場の履歴 ID を文字列のまま受理する', () => {
  const result = parseMonitoringReceptionQuery({ adoptionVenueId: 'removed-venue' });
  assert.deepEqual(result, {
    adoptionVenueId: 'removed-venue',
    limit: 100,
    offset: 0,
  });
});
