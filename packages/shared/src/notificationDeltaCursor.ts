declare const notificationDeltaCursorBrand: unique symbol;

/**
 * サーバー発番の通知シーケンス番号を表すカーソル型。
 * 10進整数文字列（例: "0", "1234"）。
 */
export type NotificationDeltaCursor = string & {
  readonly [notificationDeltaCursorBrand]: 'NotificationDeltaCursor';
};

/**
 * カーソルの文字列表現パターン。
 * 0 または 1〜9 で始まる最大16桁の10進整数文字列。
 * 前ゼロ・符号・小数・空白・16桁超は不正。
 */
export const NOTIFICATION_DELTA_CURSOR_PATTERN = /^(0|[1-9][0-9]{0,15})$/;

/**
 * 値が有効な NotificationDeltaCursor であるかを判定する。
 */
export function isNotificationDeltaCursor(value: unknown): value is NotificationDeltaCursor {
  return typeof value === 'string' && NOTIFICATION_DELTA_CURSOR_PATTERN.test(value);
}

/**
 * 非負の安全整数を NotificationDeltaCursor に変換する。
 * 無検証キャストの唯一の代替経路。
 */
export function toNotificationDeltaCursor(sequence: number): NotificationDeltaCursor {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new RangeError(
      `Notification delta sequence must be a non-negative safe integer: ${sequence}`,
    );
  }
  return String(sequence) as NotificationDeltaCursor;
}

/**
 * NotificationDeltaCursor を sequence 番号（数値）に変換する。
 */
export function notificationDeltaCursorToSequence(cursor: NotificationDeltaCursor): number {
  if (!isNotificationDeltaCursor(cursor)) {
    throw new TypeError(`Invalid notification delta cursor: ${String(cursor)}`);
  }
  return Number(cursor);
}
