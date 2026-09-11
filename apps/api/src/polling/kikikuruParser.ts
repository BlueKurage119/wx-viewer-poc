import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import { parse14DigitUtcToIso } from './kikikuruSource.js';
import type { KikikuruFrameKey, KikikuruLayer } from './kikikuruTypes.js';

export interface ParsedKikikuruFrame {
  readonly key: KikikuruFrameKey;
  readonly sequence: number;
}

export type ParseKikikuruTargetTimesResult =
  | {
      readonly ok: true;
      readonly framesByLayer: Readonly<Record<KikikuruLayer, readonly ParsedKikikuruFrame[]>>;
    }
  | {
      readonly ok: false;
      readonly errorKind: 'invalid_json' | 'invalid_structure';
      readonly errorMessage: string;
    };

interface LayerConfig {
  readonly element: string;
  readonly layer: KikikuruLayer;
  readonly imageId: string;
}

const SUPPORTED_ELEMENTS: readonly LayerConfig[] = [
  { element: 'heavyrain', layer: 'heavyrain', imageId: 'rain_mesh' },
  { element: 'inund', layer: 'inund', imageId: 'inund' },
  { element: 'land', layer: 'land', imageId: 'land' },
];

export function parseKikikuruTargetTimes(jsonText: string): ParseKikikuruTargetTimesResult {
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

  const rawCandidates: KikikuruFrameKey[] = [];

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (typeof item !== 'object' || item === null) {
      return {
        ok: false,
        errorKind: 'invalid_structure',
        errorMessage: `Item at index ${i} is not an object`,
      };
    }

    const { basetime, validtime, member, elements } = item as Record<string, unknown>;

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
    if (typeof member !== 'string' || member.trim().length === 0) {
      return {
        ok: false,
        errorKind: 'invalid_structure',
        errorMessage: `Item at index ${i} has invalid member`,
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

    for (const config of SUPPORTED_ELEMENTS) {
      if (elements.includes(config.element)) {
        rawCandidates.push({
          layer: config.layer,
          baseTime: baseTimeIso,
          validTime: validTimeIso,
          imageId: config.imageId,
          member,
        });
      }
    }
  }

  const uniqueCandidatesByLayer: Record<KikikuruLayer, Map<string, KikikuruFrameKey>> = {
    heavyrain: new Map(),
    inund: new Map(),
    land: new Map(),
  };

  for (const c of rawCandidates) {
    const key = `${c.layer}|${c.baseTime}|${c.validTime}|${c.imageId}|${c.member}`;
    const map = uniqueCandidatesByLayer[c.layer];
    if (!map.has(key)) {
      map.set(key, c);
    }
  }

  const sortFrames = (a: KikikuruFrameKey, b: KikikuruFrameKey) => {
    if (a.validTime !== b.validTime) {
      return a.validTime.localeCompare(b.validTime);
    }
    if (a.baseTime !== b.baseTime) {
      return a.baseTime.localeCompare(b.baseTime);
    }
    if (a.member !== b.member) {
      return a.member.localeCompare(b.member);
    }
    return a.imageId.localeCompare(b.imageId);
  };

  const framesByLayer: Record<KikikuruLayer, readonly ParsedKikikuruFrame[]> = {
    heavyrain: Array.from(uniqueCandidatesByLayer.heavyrain.values())
      .sort(sortFrames)
      .map((key, index) => ({ key, sequence: index })),
    inund: Array.from(uniqueCandidatesByLayer.inund.values())
      .sort(sortFrames)
      .map((key, index) => ({ key, sequence: index })),
    land: Array.from(uniqueCandidatesByLayer.land.values())
      .sort(sortFrames)
      .map((key, index) => ({ key, sequence: index })),
  };

  return {
    ok: true,
    framesByLayer,
  };
}
