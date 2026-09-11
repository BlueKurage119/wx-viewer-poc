import type { AmedasTarget, UtcIso8601String } from '@wx-viewer-poc/shared';
import type { AmedasObservationInput } from '../repositories/types.js';
import { resolveEstimatedElements, resolveUnsupportedElements } from './amedasSource.js';

export type AmedasParseResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

export interface AmedasBlockNormalization {
  /** 保存対象の観測行（観測時刻昇順・element 昇順）。 */
  readonly observations: readonly AmedasObservationInput[];
  /** ブロック内の最新観測時刻（UTC）。 */
  readonly latestObservedAt: UtcIso8601String;
  readonly observedTimeCount: number;
  /** value が null だった要素の件数（欠測）。AQC由来の欠測も含む。 */
  readonly missingValueCount: number;
  /**
   * AQC が 5 / 6 のため数値を捨てて欠測行にした件数（§3.4.2）。
   * missingValueCount の内数。実観測で 0 を超えたら §9 の前提が覆ったことを意味する。
   */
  readonly qualitySuppressedCount: number;
  /** elems 非対応・aqc null で除外した件数。 */
  readonly unsupportedElementCount: number;
  /** is_estimated = 1 を立てた行数（elems 桁が '2' の系列。§3.4.3）。 */
  readonly estimatedElementCount: number;
  /** 想定外の形で除外した件数。 */
  readonly unknownShapeCount: number;
}

const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** `2026-09-11T19:50:00+09:00` 形式の1行を UTC ISO 8601 へ正規化する（§2.3.1）。 */
export function parseAmedasLatestTime(bodyText: string): AmedasParseResult<UtcIso8601String> {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return { ok: false, reason: 'Empty latest time text' };
  }
  if (!ISO_8601_PATTERN.test(trimmed)) {
    return { ok: false, reason: `Invalid ISO 8601 format: "${trimmed}"` };
  }
  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) {
    return { ok: false, reason: `Invalid date: "${trimmed}"` };
  }
  const utcIso = new Date(timestamp).toISOString() as UtcIso8601String;
  return { ok: true, value: utcIso };
}

const TIME_KEY_PATTERN = /^\d{14}$/;

function jstKeyToUtcIso(key: string): UtcIso8601String {
  const year = parseInt(key.slice(0, 4), 10);
  const month = parseInt(key.slice(4, 6), 10);
  const day = parseInt(key.slice(6, 8), 10);
  const hour = parseInt(key.slice(8, 10), 10);
  const minute = parseInt(key.slice(10, 12), 10);
  const second = parseInt(key.slice(12, 14), 10);
  return new Date(
    Date.UTC(year, month - 1, day, hour - 9, minute, second),
  ).toISOString() as UtcIso8601String;
}

/**
 * ブロックJSON本文を正規化する。構造検証（§3.8.1）に失敗したら ok:false を返す。
 * target は必須。stationCode を地点照合に、elements を非対応要素の判定に使う（§3.4.1）。
 * 地点コード・elems の既定値を持たない（省略可能にすると特定地点が暗黙の既定に戻る）。
 */
export function parseAmedasPointBlock(
  bodyText: string,
  target: AmedasTarget,
): AmedasParseResult<AmedasBlockNormalization> {
  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return { ok: false, reason: 'Invalid JSON' };
  }

  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { ok: false, reason: 'Top-level JSON is not an object' };
  }

  const entries = Object.entries(json as Record<string, unknown>);
  if (entries.length === 0) {
    return { ok: false, reason: 'Empty point block data' };
  }

  for (const [timeKey, val] of entries) {
    if (!TIME_KEY_PATTERN.test(timeKey)) {
      return { ok: false, reason: `Invalid observation time key: "${timeKey}"` };
    }
    if (typeof val !== 'object' || val === null || Array.isArray(val)) {
      return { ok: false, reason: `Invalid observation entry for key: "${timeKey}"` };
    }
    const rec = val as Record<string, unknown>;
    if (typeof rec.prefNumber !== 'number' || typeof rec.observationNumber !== 'number') {
      return { ok: false, reason: `Missing prefNumber or observationNumber in key "${timeKey}"` };
    }
    const stationCode = `${rec.prefNumber}${String(rec.observationNumber).padStart(3, '0')}`;
    if (stationCode !== target.stationCode) {
      return {
        ok: false,
        reason: `Station code mismatch: expected "${target.stationCode}", found "${stationCode}" in key "${timeKey}"`,
      };
    }
  }

  const unsupportedElements = resolveUnsupportedElements(target.elements);
  const estimatedElements = resolveEstimatedElements(target.elements);

  let missingValueCount = 0;
  let qualitySuppressedCount = 0;
  let unsupportedElementCount = 0;
  let estimatedElementCount = 0;
  let unknownShapeCount = 0;

  const observations: AmedasObservationInput[] = [];

  const sortedKeys = Object.keys(json as Record<string, unknown>).sort();
  const latestKey = sortedKeys[sortedKeys.length - 1]!;
  const latestObservedAt = jstKeyToUtcIso(latestKey);
  const observedTimeCount = sortedKeys.length;

  for (const timeKey of sortedKeys) {
    const observedAt = jstKeyToUtcIso(timeKey);
    const rec = (json as Record<string, unknown>)[timeKey] as Record<string, unknown>;

    for (const [key, rawVal] of Object.entries(rec)) {
      if (key === 'prefNumber' || key === 'observationNumber') {
        continue;
      }

      const isEstimated = estimatedElements.has(key);

      // 形状 1: [value, aqc] 配列
      if (Array.isArray(rawVal) && rawVal.length === 2) {
        const [val, aqc] = rawVal as [unknown, unknown];

        // 規則 1: elems 由来の非対応
        if (unsupportedElements.has(key)) {
          unsupportedElementCount++;
          continue;
        }

        // AQC は null または数値だけを受け入れる。文字列などを null 扱いすると、
        // 壊れた上流データを通常観測値として保存してしまう。
        if (aqc !== null && typeof aqc !== 'number') {
          unknownShapeCount++;
          continue;
        }

        // 規則 2: aqc === null
        if (aqc === null) {
          unsupportedElementCount++;
          continue;
        }

        // 規則 3: aqc === 5 または 6（AQC由来の欠測化）
        if (aqc === 5 || aqc === 6) {
          missingValueCount++;
          qualitySuppressedCount++;
          if (isEstimated) {
            estimatedElementCount++;
          }
          observations.push({
            observedAt,
            element: key,
            valueNumber: null,
            valueText: null,
            qualityFlag: aqc,
            isEstimated,
          });
          continue;
        }

        // 規則 4: 通常の欠測（val === null）
        if (val === null) {
          missingValueCount++;
          if (isEstimated) {
            estimatedElementCount++;
          }
          observations.push({
            observedAt,
            element: key,
            valueNumber: null,
            valueText: null,
            qualityFlag: typeof aqc === 'number' ? aqc : null,
            isEstimated,
          });
          continue;
        }

        // 規則 5: 通常の数値観測値
        if (typeof val === 'number') {
          if (isEstimated) {
            estimatedElementCount++;
          }
          observations.push({
            observedAt,
            element: key,
            valueNumber: val,
            valueText: null,
            qualityFlag: typeof aqc === 'number' ? aqc : null,
            isEstimated,
          });
          continue;
        }

        unknownShapeCount++;
        continue;
      }

      // 形状 2: { hour, minute } オブジェクト（極値発生時刻）
      if (
        typeof rawVal === 'object' &&
        rawVal !== null &&
        !Array.isArray(rawVal) &&
        'hour' in rawVal &&
        'minute' in rawVal &&
        typeof (rawVal as { hour: unknown }).hour === 'number' &&
        typeof (rawVal as { minute: unknown }).minute === 'number'
      ) {
        if (unsupportedElements.has(key)) {
          unsupportedElementCount++;
          continue;
        }
        const { hour, minute } = rawVal as { hour: number; minute: number };
        const valueText = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        if (isEstimated) {
          estimatedElementCount++;
        }
        observations.push({
          observedAt,
          element: key,
          valueNumber: null,
          valueText,
          qualityFlag: null,
          isEstimated,
        });
        continue;
      }

      unknownShapeCount++;
    }
  }

  // 観測行を (observedAt 昇順, element 昇順) でソート
  observations.sort((a, b) => {
    if (a.observedAt < b.observedAt) return -1;
    if (a.observedAt > b.observedAt) return 1;
    if (a.element < b.element) return -1;
    if (a.element > b.element) return 1;
    return 0;
  });

  return {
    ok: true,
    value: {
      observations,
      latestObservedAt,
      observedTimeCount,
      missingValueCount,
      qualitySuppressedCount,
      unsupportedElementCount,
      estimatedElementCount,
      unknownShapeCount,
    },
  };
}
