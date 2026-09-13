import type { Availability } from '@wx-viewer-poc/shared';

export interface WeatherAvailabilityEvaluationInput {
  /** DB に snapshot レコードが存在するか */
  readonly hasSnapshot: boolean;
  /** snapshot.metadata.availability */
  readonly savedAvailability: Availability | null;
  /** 定時 (regular) / 随時 (extra) のフィード鮮度状態 */
  readonly feedFreshness: {
    readonly regular: Availability;
    readonly extra: Availability;
  } | null;
  /**
   * timeDefines の最大 timeTo (UTC ISO 8601 文字列)。
   * #33 では undefined、#34/#35 では計算結果（timeDefines が空なら null）
   */
  readonly maxTimeTo?: string | null;
  /** 評価時点の UTC ISO 8601 時刻 */
  readonly nowIso: string;
  /** 新しい未対応構造の解析失敗履歴が存在するか (hasNewerWeatherParseFailure) */
  readonly hasParseFailure: boolean;
}

/**
 * 設計書 §4 に基づき、気象 API レスポンスの availability を判定する純粋関数。
 *
 * 1. snapshot がなければ 'unavailable'。
 * 2. 保存 metadata の availability が 'available' でなければ保持値を返し 'stale'。
 * 3. regular/extra の feedFreshness が両方 'available' でなければ 'stale'。
 * 4. #33 はここまで通れば available（発表後300秒で失効させない）。
 * 5. #34/#35 は now < max(timeTo) なら available、now >= max(timeTo) なら stale。
 *    正常空で時間定義もない場合は期間による失効を判定しない。
 * 6. 指定された条件を満たすより新しい解析失敗があれば 'stale'。
 */
export function evaluateWeatherAvailability(
  input: WeatherAvailabilityEvaluationInput,
): Availability {
  // 1. snapshot なし
  if (!input.hasSnapshot) {
    return 'unavailable';
  }

  // 2. 保存 availability
  if (input.savedAvailability !== 'available') {
    return 'stale';
  }

  // 3. フィード鮮度 (regular / extra の両方が available であること)
  if (
    !input.feedFreshness ||
    input.feedFreshness.regular !== 'available' ||
    input.feedFreshness.extra !== 'available'
  ) {
    return 'stale';
  }

  // 5. 時系列・早期注意の終了時刻判定
  if (input.maxTimeTo !== undefined && input.maxTimeTo !== null) {
    const nowMs = new Date(input.nowIso).getTime();
    const maxToMs = new Date(input.maxTimeTo).getTime();
    if (!Number.isNaN(nowMs) && !Number.isNaN(maxToMs)) {
      if (nowMs >= maxToMs) {
        return 'stale';
      }
    }
  }

  // 6. 解析失敗履歴
  if (input.hasParseFailure) {
    return 'stale';
  }

  return 'available';
}
