import type { Availability } from './availability.js';

/**
 * UTC の ISO 8601 形式でシリアライズされた時刻文字列。
 *
 * 通信境界では Date を直接受け渡しせず、この形式を使用する。
 */
export type UtcIso8601String = string;

/**
 * 情報種別単位の API レスポンスに共通する取得・鮮度メタ情報。
 */
export interface CommonMetadata {
  source: string;
  issuedAt: UtcIso8601String;
  validAt: UtcIso8601String | null;
  validFrom: UtcIso8601String | null;
  validTo: UtcIso8601String | null;
  fetchedAt: UtcIso8601String;
  lastSuccessAt: UtcIso8601String | null;
  availability: Availability;
  sourceVersion: string | null;
}
