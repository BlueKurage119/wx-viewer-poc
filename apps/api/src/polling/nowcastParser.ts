import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import type { NowcastFrameKey, RadarProduct } from '../repositories/types.js';
import { parse14DigitUtcToIso } from './nowcastSource.js';

export interface ParsedNowcastFrame {
  readonly key: NowcastFrameKey;
  readonly sequence: number;
}

export type ParseNowcastTargetTimesResult =
  | {
      readonly ok: true;
      readonly frames: readonly ParsedNowcastFrame[];
    }
  | {
      readonly ok: false;
      readonly errorKind: 'invalid_json' | 'invalid_structure';
      readonly errorMessage: string;
    };

export function parseNowcastTargetTimes(
  jsonText: string,
  product: RadarProduct,
): ParseNowcastTargetTimesResult {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch (err: unknown) {
    return {
      ok: false,
      errorKind: 'invalid_json',
      errorMessage: `Failed to parse target times JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!Array.isArray(data)) {
    return {
      ok: false,
      errorKind: 'invalid_structure',
      errorMessage: 'Root of target times JSON must be an array',
    };
  }

  const rawCandidates: { baseTime: UtcIso8601String; validTime: UtcIso8601String }[] = [];

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (typeof item !== 'object' || item === null) {
      return {
        ok: false,
        errorKind: 'invalid_structure',
        errorMessage: `Item at index ${i} is not an object`,
      };
    }

    const { basetime, validtime, elements } = item as Record<string, unknown>;

    if (typeof basetime !== 'string') {
      return {
        ok: false,
        errorKind: 'invalid_structure',
        errorMessage: `Item at index ${i} has invalid basetime`,
      };
    }
    if (typeof validtime !== 'string') {
      return {
        ok: false,
        errorKind: 'invalid_structure',
        errorMessage: `Item at index ${i} has invalid validtime`,
      };
    }

    let baseTimeIso: UtcIso8601String;
    let validTimeIso: UtcIso8601String;
    try {
      baseTimeIso = parse14DigitUtcToIso(basetime);
      validTimeIso = parse14DigitUtcToIso(validtime);
    } catch (err: unknown) {
      return {
        ok: false,
        errorKind: 'invalid_structure',
        errorMessage: `Item at index ${i} has invalid date/time format: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (!Array.isArray(elements) || !elements.every((element) => typeof element === 'string')) {
      return {
        ok: false,
        errorKind: 'invalid_structure',
        errorMessage: `Item at index ${i} has invalid elements`,
      };
    }

    const hasHrpns = elements.some((el) => el === 'hrpns');
    if (hasHrpns) {
      rawCandidates.push({ baseTime: baseTimeIso, validTime: validTimeIso });
    }
  }

  const uniqueMap = new Map<string, { baseTime: UtcIso8601String; validTime: UtcIso8601String }>();
  for (const c of rawCandidates) {
    const key = `${product}|${c.baseTime}|${c.validTime}|hrpns|none`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, c);
    }
  }

  const sorted = Array.from(uniqueMap.values()).sort((a, b) => {
    if (a.validTime !== b.validTime) {
      return a.validTime.localeCompare(b.validTime);
    }
    return a.baseTime.localeCompare(b.baseTime);
  });

  const frames: ParsedNowcastFrame[] = sorted.map((item, index) => ({
    key: {
      product,
      baseTime: item.baseTime,
      validTime: item.validTime,
      element: 'hrpns',
      member: 'none',
    },
    sequence: index,
  }));

  return {
    ok: true,
    frames,
  };
}

const SIXTY_MINUTES_MS = 60 * 60 * 1000;

export function calculateNowcastWindow(nowIso: UtcIso8601String): {
  from: UtcIso8601String;
  to: UtcIso8601String;
} {
  const nowMs = new Date(nowIso).getTime();
  const fromMs = nowMs - SIXTY_MINUTES_MS;
  const toMs = nowMs + SIXTY_MINUTES_MS;
  return {
    from: new Date(fromMs).toISOString() as UtcIso8601String,
    to: new Date(toMs).toISOString() as UtcIso8601String,
  };
}

export function filterNowcastFramesByWindow<T extends { readonly validTime: UtcIso8601String }>(
  frames: readonly T[],
  nowIso: UtcIso8601String,
): readonly T[] {
  const nowMs = new Date(nowIso).getTime();
  const fromMs = nowMs - SIXTY_MINUTES_MS;
  const toMs = nowMs + SIXTY_MINUTES_MS;

  return frames.filter((f) => {
    const validMs = new Date(f.validTime).getTime();
    return validMs >= fromMs && validMs <= toMs;
  });
}
