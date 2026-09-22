import type {
  KikikuruApiFrame,
  KikikuruApiLayer,
  KikikuruApiDataset,
  KikikuruTimesResponse,
  WeatherContext,
  TileUpstreamAccess,
  TileDeliveryProfile,
} from '@wx-viewer-poc/shared';
import type { MapLayerId, TimelineFrame } from '../types';

export type KikikuruMapLayerId = 'kikikuru-heavyrain' | 'kikikuru-inund' | 'kikikuru-land';

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
 * 索引の最新 validTime の1コマだけを TimelineFrame (KikikuruFrameRef) へ変換する（§6.4）
 */
export function toTimelineFrames(frames: readonly KikikuruApiFrame[]): readonly KikikuruFrameRef[] {
  if (!frames || frames.length === 0) {
    return [];
  }

  const validTimes = frames.map((f) => Date.parse(f.validTime)).filter((ms) => !Number.isNaN(ms));

  if (validTimes.length === 0) {
    return [];
  }

  const latestMs = Math.max(...validTimes);
  return frames
    .filter((f) => Date.parse(f.validTime) === latestMs)
    .map((f) => ({
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
  readonly tileDeliveryProfile: TileDeliveryProfile;
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
      tileDeliveryProfile: response.tileDeliveryProfile,
      context,
      allowedZooms: [],
      catalogAccess: response.catalogAccess ?? null,
      imageAccess: response.imageAccess ?? null,
      layers: response.layers,
    };
  }

  return {
    tileDeliveryProfile: response.tileDeliveryProfile,
    context,
    allowedZooms: response.allowedZooms,
    catalogAccess: response.catalogAccess ?? null,
    imageAccess: response.imageAccess ?? null,
    layers: response.layers,
  };
}

export { buildKikikuruTileUrlTemplate } from './kikikuruTileUrl';
