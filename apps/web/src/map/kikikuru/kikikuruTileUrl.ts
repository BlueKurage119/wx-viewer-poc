import type { WeatherControlStatus, KikikuruApiLayer } from '@wx-viewer-poc/shared';

export interface BuildKikikuruTileUrlParams {
  readonly frame: {
    readonly layer: KikikuruApiLayer;
    readonly baseTime: string;
    readonly validTime: string;
    readonly imageId: 'rain_mesh' | 'inund' | 'land';
    readonly member: string;
  };
  readonly terminalId: string;
  readonly controlStatus?: WeatherControlStatus;
}

/**
 * キキクルのコマ情報から Leaflet 用タイル URL テンプレートを生成する純関数 (§7.1)
 * クエリパラメータはちょうど 6 キー (terminalId, controlStatus, baseTime, validTime, imageId, member)
 */
export function buildKikikuruTileUrlTemplate(params: BuildKikikuruTileUrlParams): string;
export function buildKikikuruTileUrlTemplate(
  frame: BuildKikikuruTileUrlParams['frame'],
  terminalId: string,
  controlStatus?: WeatherControlStatus,
): string;
export function buildKikikuruTileUrlTemplate(
  paramsOrFrame: BuildKikikuruTileUrlParams | BuildKikikuruTileUrlParams['frame'],
  maybeTerminalId?: string,
  maybeControlStatus?: WeatherControlStatus,
): string {
  let frame: BuildKikikuruTileUrlParams['frame'];
  let terminalId: string;
  let controlStatus: WeatherControlStatus;

  if (maybeTerminalId !== undefined) {
    frame = paramsOrFrame as BuildKikikuruTileUrlParams['frame'];
    terminalId = maybeTerminalId;
    controlStatus = maybeControlStatus ?? 'normal';
  } else {
    const params = paramsOrFrame as BuildKikikuruTileUrlParams;
    frame = params.frame;
    terminalId = params.terminalId;
    controlStatus = params.controlStatus ?? 'normal';
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
