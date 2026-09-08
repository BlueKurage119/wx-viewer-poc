/**
 * 情報取得状態。`stale` は前回正常値を保持しつつ鮮度が低下している状態を表す。
 */
export type Availability = 'available' | 'stale' | 'unavailable';

/**
 * 呼び出し元が判定したデータの鮮度状態。
 */
export type FreshnessStatus = 'normal' | 'delayed' | 'abnormal';

/**
 * availability 判定の入力。
 */
export interface AvailabilityInput {
  hasLastNormalValue: boolean;
  freshness: FreshnessStatus;
}

/**
 * 保持値の有無と鮮度状態から availability を判定する純粋関数。
 *
 * - 保持値がない場合は鮮度にかかわらず 'unavailable'
 * - 保持値があり鮮度が normal の場合は 'available'
 * - 保持値があり鮮度が delayed または abnormal の場合は 'stale'
 */
export function resolveAvailability(input: AvailabilityInput): Availability {
  if (!input.hasLastNormalValue) {
    return 'unavailable';
  }

  if (input.freshness === 'normal') {
    return 'available';
  }

  return 'stale';
}
