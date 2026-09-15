import type { WeatherControlStatus } from '@wx-viewer-poc/shared';
import type { NowcastFrame } from './nowcastCatalog';

/**
 * ナウキャストのコマ情報から Leaflet 用タイル URL テンプレートを生成する純関数 (§6.3)
 */
export function buildNowcastTileUrlTemplate(params: {
  readonly frame: NowcastFrame;
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
}): string {
  const query = new URLSearchParams({
    terminalId: params.terminalId,
    controlStatus: params.controlStatus,
    baseTime: params.frame.baseTime,
    validTime: params.frame.validTime,
  });

  return `/api/weather/nowcast/${params.frame.product}/tiles/{z}/{x}/{y}.png?${query.toString()}`;
}
