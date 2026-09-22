import type { TileDeliveryProfile, WeatherControlStatus } from '@wx-viewer-poc/shared';
import type { NowcastFrame } from './nowcastCatalog';

/**
 * ナウキャストのコマ情報から Leaflet 用タイル URL テンプレートを生成する純関数 (§6.3)
 */
export function buildNowcastTileUrlTemplate(params: {
  readonly frame: NowcastFrame;
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly tileDeliveryProfile: TileDeliveryProfile;
}): string | null {
  if (params.tileDeliveryProfile === 'jma-direct') {
    const baseTime = toJmaTimestamp(params.frame.baseTime);
    const validTime = toJmaTimestamp(params.frame.validTime);
    if (!baseTime || !validTime) return null;
    return `https://www.jma.go.jp/bosai/jmatile/data/nowc/${baseTime}/none/${validTime}/surf/hrpns/{z}/{x}/{y}.png`;
  }
  const query = new URLSearchParams({
    terminalId: params.terminalId,
    controlStatus: params.controlStatus,
    baseTime: params.frame.baseTime,
    validTime: params.frame.validTime,
  });

  return `/api/weather/nowcast/${params.frame.product}/tiles/{z}/{x}/{y}.png?${query.toString()}`;
}

function toJmaTimestamp(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) return null;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}
