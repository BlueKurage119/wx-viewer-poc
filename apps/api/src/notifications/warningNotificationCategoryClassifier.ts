import type { NotificationCategory } from '@wx-viewer-poc/shared';

export type WarningNotificationCategoryResult =
  | { readonly kind: 'classified'; readonly category: NotificationCategory }
  | { readonly kind: 'release' }
  | { readonly kind: 'unsupported' };

const EMERGENCY_CODES = new Set(['32', '33', '35', '36', '37', '38', '39', '43', '48', '49']);

const QUESTION_CODES = new Set(['02', '03', '04', '05', '06', '07', '08', '09', '10', '19', '29']);

const WARNING_CODES = new Set([
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '20',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
  '27',
]);

/**
 * 警報等情報要素の Kind/Code から確定した通知区分を判定する純粋関数。
 * 入力は 2 桁の ASCII 数字文字列のみを受け付ける。
 */
export function classifyWarningNotificationCategory(
  code: string,
): WarningNotificationCategoryResult {
  if (code === '00') {
    return { kind: 'release' };
  }
  if (EMERGENCY_CODES.has(code)) {
    return { kind: 'classified', category: 'emergency' };
  }
  if (QUESTION_CODES.has(code)) {
    return { kind: 'classified', category: 'question' };
  }
  if (WARNING_CODES.has(code)) {
    return { kind: 'classified', category: 'warning' };
  }
  return { kind: 'unsupported' };
}
