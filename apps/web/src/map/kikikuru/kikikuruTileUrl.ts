import type {
  WeatherControlStatus,
  KikikuruApiLayer,
  TileDeliveryProfile,
} from '@wx-viewer-poc/shared';

export interface BuildKikikuruTileUrlParams {
  readonly frame: {
    readonly layer: KikikuruApiLayer;
    readonly baseTime: string;
    readonly validTime: string;
    readonly imageId: 'rain_mesh' | 'inund' | 'land';
    readonly member: string;
  };
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly tileDeliveryProfile: TileDeliveryProfile;
}

/**
 * キキクルのコマ情報から Leaflet 用タイル URL テンプレートを生成する純関数 (§7.1)
 * クエリパラメータはちょうど 6 キー (terminalId, controlStatus, baseTime, validTime, imageId, member)
 */
export function buildKikikuruTileUrlTemplate(params: BuildKikikuruTileUrlParams): string | null {
  const { frame, terminalId, controlStatus } = params;
  if (params.tileDeliveryProfile === 'jma-direct') {
    const baseTime = toJmaTimestamp(frame.baseTime);
    const validTime = toJmaTimestamp(frame.validTime);
    if (!baseTime || !validTime) return null;
    return `https://www.jma.go.jp/bosai/jmatile/data/risk/${baseTime}/${frame.member}/${validTime}/surf/${frame.imageId}/{z}/{x}/{y}.png`;
  }

  const query = new URLSearchParams({
    terminalId,
    controlStatus,
    baseTime: frame.baseTime,
    validTime: frame.validTime,
    imageId: frame.imageId,
    member: frame.member,
  });

  return `/api/weather/kikikuru/${frame.layer}/tiles/{z}/{x}/{y}.png?${query.toString()}`;
}

function toJmaTimestamp(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) return null;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}
