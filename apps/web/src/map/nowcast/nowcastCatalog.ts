import type {
  NowcastTimesResponse,
  WeatherContext,
  TileUpstreamAccess,
  UtcIso8601String,
  NowcastApiProduct,
} from '@wx-viewer-poc/shared';

export type NowcastFrameKind = 'observed' | 'forecast';

export interface NowcastFrame {
  /** `${product}:${baseTime}:${validTime}`。表示・再生・タイル URL の一意キー */
  readonly id: string;
  readonly product: 'N1' | 'N2';
  readonly kind: NowcastFrameKind;
  readonly baseTime: UtcIso8601String;
  readonly validTime: UtcIso8601String;
  /** 同じ validTime に別 product のコマが存在するか (§4.3) */
  readonly hasSameValidTimeAlternative: boolean;
  /** スライダーの目盛り・表示の代表か。重複時は N1 側が true (§4.3 案 A) */
  readonly representative: boolean;
}

export interface NowcastCatalog {
  readonly context: WeatherContext;
  readonly window: { readonly from: UtcIso8601String; readonly to: UtcIso8601String } | null;
  readonly allowedZooms: readonly number[];
  readonly imageAccess: TileUpstreamAccess | null;
  readonly products: Readonly<Record<'N1' | 'N2', NowcastApiProduct>>;
  /** 表示窓で絞り、validTime 昇順に並べたコマ。欠けは詰めない */
  readonly frames: readonly NowcastFrame[];
  /** 表示窓外・重複により除外したコマ数 (F8 の状態表示用に保持のみ) */
  readonly excludedCount: number;
}

const MAX_WINDOW_SPAN_MS = 120 * 60 * 1000; // 120 分
const WINDOW_CLAMP_HALF_SPAN_MS = 60 * 60 * 1000; // 60 分

/**
 * NowcastTimesResponse から NowcastCatalog を生成する純関数 (§4.1〜§4.4)
 */
export function buildNowcastCatalog(response: NowcastTimesResponse): NowcastCatalog {
  const context: WeatherContext = {
    terminalId: response.terminalId,
    venueId: response.venueId,
    controlStatus: response.controlStatus,
    isTraining: response.isTraining,
    evaluatedAt: response.evaluatedAt,
  };

  if (response.status === 'unsupported_control_status' || response.window === null) {
    return {
      context,
      window: null,
      allowedZooms: [],
      imageAccess: response.imageAccess ?? null,
      products: response.products,
      frames: [],
      excludedCount: 0,
    };
  }

  // 表示窓の健全性検査とクランプ (§4.2)
  let windowFrom = response.window.from;
  let windowTo = response.window.to;
  const fromMs = new Date(windowFrom).getTime();
  const toMs = new Date(windowTo).getTime();
  const evalMs = new Date(response.evaluatedAt).getTime();

  const isExceedingSpan = toMs - fromMs > MAX_WINDOW_SPAN_MS;
  const isEvaluatedAtOutside = evalMs < fromMs || evalMs > toMs;

  if (isExceedingSpan || isEvaluatedAtOutside) {
    windowFrom = new Date(evalMs - WINDOW_CLAMP_HALF_SPAN_MS).toISOString();
    windowTo = new Date(evalMs + WINDOW_CLAMP_HALF_SPAN_MS).toISOString();
  }

  const effectiveFromMs = new Date(windowFrom).getTime();
  const effectiveToMs = new Date(windowTo).getTime();

  let excludedCount = 0;

  // N1 コマの収集と窓判定
  const rawN1Frames = response.products.N1?.data?.frames ?? [];
  const inWindowN1 = rawN1Frames.filter((f) => {
    const vMs = new Date(f.validTime).getTime();
    const inWindow = vMs >= effectiveFromMs && vMs <= effectiveToMs;
    if (!inWindow) excludedCount += 1;
    return inWindow;
  });

  // N2 コマの収集と窓判定
  const rawN2Frames = response.products.N2?.data?.frames ?? [];
  const inWindowN2 = rawN2Frames.filter((f) => {
    const vMs = new Date(f.validTime).getTime();
    const inWindow = vMs >= effectiveFromMs && vMs <= effectiveToMs;
    if (!inWindow) excludedCount += 1;
    return inWindow;
  });

  // 重複 validTime の特定 (§4.3 案 A: N1 実況優先)
  const n1ValidTimes = new Set(inWindowN1.map((f) => f.validTime));
  const n2ValidTimes = new Set(inWindowN2.map((f) => f.validTime));

  const allFrames: NowcastFrame[] = [];

  for (const f of inWindowN1) {
    const isDuplicate = n2ValidTimes.has(f.validTime);
    allFrames.push({
      id: `N1:${f.baseTime}:${f.validTime}`,
      product: 'N1',
      kind: 'observed',
      baseTime: f.baseTime,
      validTime: f.validTime,
      hasSameValidTimeAlternative: isDuplicate,
      representative: true, // 重複時も N1 が代表
    });
  }

  for (const f of inWindowN2) {
    const isDuplicate = n1ValidTimes.has(f.validTime);
    allFrames.push({
      id: `N2:${f.baseTime}:${f.validTime}`,
      product: 'N2',
      kind: 'forecast',
      baseTime: f.baseTime,
      validTime: f.validTime,
      hasSameValidTimeAlternative: isDuplicate,
      representative: !isDuplicate, // 重複時は N2 は非代表
    });
  }

  // validTime 昇順にソート。同一 validTime では N1 を先に配置
  allFrames.sort((a, b) => {
    const tA = new Date(a.validTime).getTime();
    const tB = new Date(b.validTime).getTime();
    if (tA !== tB) return tA - tB;
    return a.product === 'N1' ? -1 : 1;
  });

  return {
    context,
    window: { from: windowFrom, to: windowTo },
    allowedZooms: response.allowedZooms,
    imageAccess: response.imageAccess ?? null,
    products: response.products,
    frames: allFrames,
    excludedCount,
  };
}
