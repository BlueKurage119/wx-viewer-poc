import type { BulletinsResponse, WeatherControlStatus } from '@wx-viewer-poc/shared';
import { fetchTileCatalog, type TileCatalogResult } from './tileCatalogClient';

/**
 * 応答の最低限の実行時検証。不正なら null。controlStatus が要求値と違う場合も null。
 *
 * 検証項目 (§3.2):
 * - ルートがオブジェクト
 * - controlStatus === requested
 * - isTraining === (requested === 'training')
 * - availability が 'available' | 'stale' のいずれか。速報APIは 'unavailable' を返さない契約（E6 §4.3）のため、
 *   'unavailable' は契約違反として取得失敗扱いにし、前回値に縮退させない
 * - bulletins が配列
 * - 各要素の eventId・title・reportDateTime が非空文字列
 * - isCancelled が boolean
 * - telegramType が文字列または null（値の範囲は検証しない）
 * - hasSighting が boolean または null
 * - headlineText が文字列または null
 * - areas が配列（各要素の areaName が文字列、informationType が文字列または null、sequence が数値）
 * - metadata がオブジェクトで validAt が文字列または null
 */
export function parseBulletinsResponse(
  body: unknown,
  requested: WeatherControlStatus,
): BulletinsResponse | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null;
  }

  const record = body as Record<string, unknown>;

  if (record.controlStatus !== requested) {
    return null;
  }

  if (record.isTraining !== (requested === 'training')) {
    return null;
  }

  if (record.availability !== 'available' && record.availability !== 'stale') {
    return null;
  }

  if (!Array.isArray(record.bulletins)) {
    return null;
  }

  for (const b of record.bulletins) {
    if (typeof b !== 'object' || b === null || Array.isArray(b)) {
      return null;
    }
    const item = b as Record<string, unknown>;

    if (typeof item.eventId !== 'string' || item.eventId.length === 0) {
      return null;
    }
    if (typeof item.title !== 'string' || item.title.length === 0) {
      return null;
    }
    if (typeof item.reportDateTime !== 'string' || item.reportDateTime.length === 0) {
      return null;
    }
    if (typeof item.isCancelled !== 'boolean') {
      return null;
    }
    if (typeof item.telegramType !== 'string' && item.telegramType !== null) {
      return null;
    }
    if (typeof item.hasSighting !== 'boolean' && item.hasSighting !== null) {
      return null;
    }
    if (typeof item.headlineText !== 'string' && item.headlineText !== null) {
      return null;
    }
    if (!Array.isArray(item.areas)) {
      return null;
    }
    for (const area of item.areas) {
      if (typeof area !== 'object' || area === null || Array.isArray(area)) {
        return null;
      }
      const a = area as Record<string, unknown>;
      if (typeof a.areaName !== 'string') {
        return null;
      }
      if (typeof a.informationType !== 'string' && a.informationType !== null) {
        return null;
      }
      if (typeof a.sequence !== 'number') {
        return null;
      }
    }
    if (
      typeof item.metadata !== 'object' ||
      item.metadata === null ||
      Array.isArray(item.metadata)
    ) {
      return null;
    }
    const meta = item.metadata as Record<string, unknown>;
    if (typeof meta.validAt !== 'string' && meta.validAt !== null) {
      return null;
    }
  }

  return body as BulletinsResponse;
}

export function fetchBosaiBulletins(params: {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly signal: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}): Promise<TileCatalogResult<BulletinsResponse>> {
  return fetchTileCatalog({
    path: '/api/weather/bulletins',
    terminalId: params.terminalId,
    controlStatus: params.controlStatus,
    signal: params.signal,
    parse: (body) => parseBulletinsResponse(body, params.controlStatus),
    fetchImpl: params.fetchImpl,
  });
}
