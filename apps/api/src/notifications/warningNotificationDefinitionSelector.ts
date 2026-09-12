import type { NotificationMessageDefinitionId } from '@wx-viewer-poc/shared';

/**
 * 特別警報コード (7種)
 * D2 で emergency と判定される。
 */
const SPECIAL_WARNING_CODES = new Set(['32', '33', '35', '36', '37', '38', '39']);

/**
 * 警報・危険警報コード (11種)
 * 43, 48, 49 は emergency、02〜09 は question。
 * 注: 04（洪水警報）は WARNING_CODE_TABLE に存在しない（C3 未採用）ため到達不能であるが、D2 整合のため明示表に含める。
 */
const WARNING_CODES = new Set([
  '43',
  '48',
  '49',
  '02',
  '03',
  '04', // 到達不能（C3未採用）
  '05',
  '06',
  '07',
  '08',
  '09',
]);

/**
 * 注意報コード (18種)
 * 10, 19, 29 は question、その他は warning。
 * 注: 18（洪水注意報）は WARNING_CODE_TABLE に存在しない（C3 未採用）ため到達不能であるが、D2 整合のため明示表に含める。
 */
const ADVISORY_CODES = new Set([
  '10',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18', // 到達不能（C3未採用）
  '19',
  '20',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
  '27',
  '29',
]);

/**
 * §4.4 の明示表。表に無いコードは null。
 */
export function selectIssuedNotificationDefinitionId(
  kindCode: string,
): NotificationMessageDefinitionId | null {
  if (SPECIAL_WARNING_CODES.has(kindCode)) {
    return 'weather-special-warning-issued';
  }
  if (WARNING_CODES.has(kindCode)) {
    return 'weather-warning-issued';
  }
  if (ADVISORY_CODES.has(kindCode)) {
    return 'weather-advisory-issued';
  }
  return null;
}

/**
 * 状態変化 → 定義 ID。new は selectIssuedNotificationDefinitionId に委譲する。
 */
export function selectWarningNotificationDefinitionId(
  changeType: 'new' | 'strengthened' | 'weakened' | 'released' | 'corrected' | 'cancelled',
  kindCode: string | null,
): NotificationMessageDefinitionId | null {
  switch (changeType) {
    case 'new':
      return kindCode === null ? null : selectIssuedNotificationDefinitionId(kindCode);
    case 'strengthened':
      return 'weather-warning-strengthened';
    case 'weakened':
      return 'weather-warning-weakened';
    case 'released':
      return 'weather-warning-released';
    case 'corrected':
      return 'weather-warning-corrected';
    case 'cancelled':
      return 'weather-warning-cancelled';
    default:
      return null;
  }
}
