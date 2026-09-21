import type {
  KikikuruApiFrame,
  KikikuruApiLayer,
  KikikuruApiDataset,
  KikikuruTimesResponse,
  WeatherContext,
  TileUpstreamAccess,
} from '@wx-viewer-poc/shared';
import type { MapLayerId, TimelineFrame } from '../types';

export type KikikuruMapLayerId = 'kikikuru-heavyrain' | 'kikikuru-inund' | 'kikikuru-land';

export const KIKIKURU_DISPLAY_WINDOW_MS = 3 * 60 * 60 * 1000; // 過去 3 時間 (180 分)

export function isKikikuruLayer(id: MapLayerId): id is KikikuruMapLayerId {
  return id === 'kikikuru-heavyrain' || id === 'kikikuru-inund' || id === 'kikikuru-land';
}

export function toApiLayer(id: KikikuruMapLayerId): KikikuruApiLayer {
  switch (id) {
    case 'kikikuru-heavyrain':
      return 'heavyrain';
    case 'kikikuru-inund':
      return 'inund';
    case 'kikikuru-land':
      return 'land';
  }
}

export function toMapLayerId(layer: KikikuruApiLayer): KikikuruMapLayerId {
  switch (layer) {
    case 'heavyrain':
      return 'kikikuru-heavyrain';
    case 'inund':
      return 'kikikuru-inund';
    case 'land':
      return 'kikikuru-land';
  }
}

/** 表示に使う 1 コマ。member は索引更新のたびに再解決する（§6.3） */
export type KikikuruFrameRef = Readonly<
  TimelineFrame & {
    /** frameId は validTime のみから作る。member を含めない */
    layer: KikikuruApiLayer;
    baseTime: string;
    validTime: string;
    imageId: 'rain_mesh' | 'inund' | 'land';
    member: string;
  }
>;

/**
 * ISO 8601 UTC 文字列を JST の HH:mm 表記に変換する
 */
export function formatJstTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  const jstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const hours = String(jstDate.getUTCHours()).padStart(2, '0');
  const minutes = String(jstDate.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * ISO 8601 UTC 文字列を JST の MM/dd HH:mm 表記に変換する
 */
export function formatJstMonthDateTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  const jstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const month = String(jstDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jstDate.getUTCDate()).padStart(2, '0');
  const hours = String(jstDate.getUTCHours()).padStart(2, '0');
  const minutes = String(jstDate.getUTCMinutes()).padStart(2, '0');
  return `${month}/${day} ${hours}:${minutes}`;
}

/**
 * 表示窓（過去 3 時間）を適用したうえで TimelineFrame (KikikuruFrameRef) へ変換する（§6.4）
 * 窓の基準は「索引が持つ最新 validTime」であり、クライアントの時計ではない。
 * 引数 now はインターフェース互換のために受けるが、窓の計算には使用しない。
 */
export function toTimelineFrames(
  frames: readonly KikikuruApiFrame[],
  _now?: Date,
): readonly KikikuruFrameRef[] {
  void _now;
  if (!frames || frames.length === 0) {
    return [];
  }

  const validTimes = frames.map((f) => Date.parse(f.validTime)).filter((ms) => !Number.isNaN(ms));

  if (validTimes.length === 0) {
    return [];
  }

  const latestMs = Math.max(...validTimes);
  const visible = frames.filter((f) => {
    const ms = Date.parse(f.validTime);
    // 境界は以上・以下の閉区間とし、ちょうど 3 時間前のコマを含める
    return !Number.isNaN(ms) && latestMs - ms <= KIKIKURU_DISPLAY_WINDOW_MS;
  });

  // validTime 昇順にソート
  const sorted = [...visible].sort((a, b) => {
    return Date.parse(a.validTime) - Date.parse(b.validTime);
  });

  return sorted.map((f) => ({
    id: f.validTime,
    layer: f.layer,
    baseTime: f.baseTime,
    validTime: f.validTime,
    imageId: f.imageId,
    member: f.member,
    displayTime: formatJstTime(f.validTime),
    kind: 'reference' as const,
    enabled: true,
  }));
}

/**
 * 最新の索引から validTime でコマを引き直す（§6.3 member 再解決）
 */
export function resolveKikikuruFrame(
  frames: readonly KikikuruApiFrame[],
  validTime: string,
): KikikuruApiFrame | null {
  return frames.find((f) => f.validTime === validTime) ?? null;
}

export interface KikikuruCatalog {
  readonly context: WeatherContext;
  readonly allowedZooms: readonly number[];
  readonly catalogAccess: TileUpstreamAccess | null;
  readonly imageAccess: TileUpstreamAccess | null;
  readonly layers: Readonly<Record<KikikuruApiLayer, KikikuruApiDataset>>;
}

/**
 * KikikuruTimesResponse から KikikuruCatalog を生成する純関数
 */
export function buildKikikuruCatalog(response: KikikuruTimesResponse): KikikuruCatalog {
  const context: WeatherContext = {
    terminalId: response.terminalId,
    venueId: response.venueId,
    controlStatus: response.controlStatus,
    isTraining: response.isTraining,
    evaluatedAt: response.evaluatedAt,
  };

  if (response.status === 'unsupported_control_status') {
    return {
      context,
      allowedZooms: [],
      catalogAccess: response.catalogAccess ?? null,
      imageAccess: response.imageAccess ?? null,
      layers: response.layers,
    };
  }

  return {
    context,
    allowedZooms: response.allowedZooms,
    catalogAccess: response.catalogAccess ?? null,
    imageAccess: response.imageAccess ?? null,
    layers: response.layers,
  };
}

export { buildKikikuruTileUrlTemplate } from './kikikuruTileUrl';
