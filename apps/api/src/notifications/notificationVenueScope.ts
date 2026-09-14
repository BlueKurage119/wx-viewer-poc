import {
  isVenueId,
  VENUE_FORECAST_TARGETS,
  VENUE_IDS,
  type NotificationTarget,
  type VenueId,
} from '@wx-viewer-poc/shared';

export type NotificationVenueScopeResolution =
  | { readonly kind: 'venue'; readonly venueIds: readonly VenueId[] }
  | { readonly kind: 'global' }
  | { readonly kind: 'unresolved' };

/**
 * targets から会場適用範囲を導出する純関数（設計書 §4.2）。
 *
 * 1. codeType === 'venue' かつ code が有効な VenueId
 * 2. codeType === 'jma_municipal_warning_area' かつ 会場の市町村コードに一致
 * 3. 全要素が kind === 'equipment'
 * 4. それ以外（未知の codeType、空等）は unresolved
 */
export function resolveNotificationVenueScope(
  targets: readonly NotificationTarget[],
): NotificationVenueScopeResolution {
  if (!Array.isArray(targets) || targets.length === 0) {
    return { kind: 'unresolved' };
  }

  // 1. targets に codeType === 'venue' の要素があり、その code が有効な VenueId である（速報通知 D10）
  const venueCodeMatches: VenueId[] = [];
  for (const target of targets) {
    if (target.codeType === 'venue' && isVenueId(target.code)) {
      if (!venueCodeMatches.includes(target.code)) {
        venueCodeMatches.push(target.code);
      }
    }
  }
  if (venueCodeMatches.length > 0) {
    return { kind: 'venue', venueIds: venueCodeMatches };
  }

  // 2. targets に codeType === 'jma_municipal_warning_area' の要素があり、その code に一致する会場がある（警報・注意報通知 D4）
  const municipalMatches: VenueId[] = [];
  for (const target of targets) {
    if (target.codeType === 'jma_municipal_warning_area') {
      for (const venueId of VENUE_IDS) {
        if (VENUE_FORECAST_TARGETS[venueId].warning.municipalCode === target.code) {
          if (!municipalMatches.includes(venueId)) {
            municipalMatches.push(venueId);
          }
        }
      }
    }
  }
  if (municipalMatches.length > 0) {
    return { kind: 'venue', venueIds: municipalMatches };
  }

  // 3. targets の全要素が kind === 'equipment' である（装置異常系 D7）
  if (targets.every((target) => target.kind === 'equipment')) {
    return { kind: 'global' };
  }

  // 4. 上記のいずれにも当たらない
  return { kind: 'unresolved' };
}
