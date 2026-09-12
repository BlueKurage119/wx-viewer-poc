import {
  resolveAvailability,
  type Availability,
  type FreshnessStatus,
  type UtcIso8601String,
} from '@wx-viewer-poc/shared';

export interface FreshnessPolicy {
  readonly staleAfterSeconds: number;
}

export interface FreshnessConfig {
  readonly xml: FreshnessPolicy;
  readonly imageCatalog: FreshnessPolicy;
}

export interface FreshnessInput {
  readonly now: UtcIso8601String;
  readonly lastSuccessAt: UtcIso8601String | null;
  readonly latestAttemptFailed: boolean;
}

/**
 * 鮮度判定を行う純粋関数。
 *
 * 優先順位:
 * 1. lastSuccessAt が null なら unavailable (初期未取得・初回失敗)。
 * 2. 正常取得歴があり latestAttemptFailed が true なら経過時間にかかわらず stale。
 * 3. それ以外は now - lastSuccessAt が staleAfterSeconds * 1,000 以上なら stale、未満なら available。
 *    (負の経過時間も閾値未満として available 扱い)
 */
export function evaluateFreshness(input: FreshnessInput, policy: FreshnessPolicy): Availability {
  if (input.lastSuccessAt === null) {
    return resolveAvailability({
      hasLastNormalValue: false,
      freshness: 'abnormal',
    });
  }

  if (input.latestAttemptFailed) {
    return resolveAvailability({
      hasLastNormalValue: true,
      freshness: 'abnormal',
    });
  }

  const nowMs = new Date(input.now).getTime();
  const lastSuccessMs = new Date(input.lastSuccessAt).getTime();
  const elapsedMs = nowMs - lastSuccessMs;
  const staleThresholdMs = policy.staleAfterSeconds * 1000;

  let freshness: FreshnessStatus;
  if (elapsedMs >= staleThresholdMs) {
    freshness = 'delayed';
  } else {
    freshness = 'normal';
  }

  return resolveAvailability({
    hasLastNormalValue: true,
    freshness,
  });
}
