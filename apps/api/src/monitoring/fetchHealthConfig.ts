export interface FetchHealthConfig {
  readonly evaluationIntervalSeconds: number;
  readonly delayedConsecutiveFailures: number;
  readonly delayedIntervalMultiplier: number;
  readonly abnormalConsecutiveFailures: number;
  readonly abnormalElapsedSeconds: number;
  readonly maxScanAttempts: number;
}

const EXPECTED_FETCH_HEALTH_KEYS = new Set([
  'evaluationIntervalSeconds',
  'delayedConsecutiveFailures',
  'delayedIntervalMultiplier',
  'abnormalConsecutiveFailures',
  'abnormalElapsedSeconds',
  'maxScanAttempts',
]);

export function validateFetchHealthConfig(value: unknown): FetchHealthConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('fetchHealth はオブジェクトである必要があります');
  }

  const obj = value as Record<string, unknown>;

  const keys = Object.keys(obj);
  for (const key of keys) {
    if (!EXPECTED_FETCH_HEALTH_KEYS.has(key)) {
      throw new Error(`未知の fetchHealth 設定キーです: ${key}`);
    }
  }

  for (const key of EXPECTED_FETCH_HEALTH_KEYS) {
    if (!(key in obj)) {
      throw new Error(`必須 fetchHealth 設定キーが不足しています: ${key}`);
    }
  }

  const checkPositiveSafeInteger = (key: string, val: unknown): number => {
    if (typeof val !== 'number' || !Number.isSafeInteger(val) || val <= 0) {
      throw new Error(`fetchHealth.${key} は正の有限整数である必要があります: ${String(val)}`);
    }
    return val;
  };

  const evaluationIntervalSeconds = checkPositiveSafeInteger(
    'evaluationIntervalSeconds',
    obj.evaluationIntervalSeconds,
  );
  const delayedConsecutiveFailures = checkPositiveSafeInteger(
    'delayedConsecutiveFailures',
    obj.delayedConsecutiveFailures,
  );
  const delayedIntervalMultiplier = checkPositiveSafeInteger(
    'delayedIntervalMultiplier',
    obj.delayedIntervalMultiplier,
  );
  const abnormalConsecutiveFailures = checkPositiveSafeInteger(
    'abnormalConsecutiveFailures',
    obj.abnormalConsecutiveFailures,
  );
  const abnormalElapsedSeconds = checkPositiveSafeInteger(
    'abnormalElapsedSeconds',
    obj.abnormalElapsedSeconds,
  );
  const maxScanAttempts = checkPositiveSafeInteger('maxScanAttempts', obj.maxScanAttempts);

  if (delayedConsecutiveFailures < 2) {
    throw new Error(
      `fetchHealth.delayedConsecutiveFailures は 2 以上である必要があります: ${delayedConsecutiveFailures}`,
    );
  }

  if (abnormalConsecutiveFailures < delayedConsecutiveFailures) {
    throw new Error(
      `fetchHealth.abnormalConsecutiveFailures (${abnormalConsecutiveFailures}) は delayedConsecutiveFailures (${delayedConsecutiveFailures}) 以上である必要があります`,
    );
  }

  if (maxScanAttempts <= abnormalConsecutiveFailures) {
    throw new Error(
      `fetchHealth.maxScanAttempts (${maxScanAttempts}) は abnormalConsecutiveFailures (${abnormalConsecutiveFailures}) より大きい必要があります`,
    );
  }

  return {
    evaluationIntervalSeconds,
    delayedConsecutiveFailures,
    delayedIntervalMultiplier,
    abnormalConsecutiveFailures,
    abnormalElapsedSeconds,
    maxScanAttempts,
  };
}
