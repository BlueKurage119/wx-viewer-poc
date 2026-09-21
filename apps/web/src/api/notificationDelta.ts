import type { NotificationDeltaReadyResponse } from '@wx-viewer-poc/shared';

export type NotificationDeltaClientResult =
  | { readonly status: 'ready'; readonly response: NotificationDeltaReadyResponse }
  | { readonly status: 'cursor_out_of_range'; readonly cursor: string }
  | { readonly status: 'unavailable' };

function isReady(value: unknown): value is NotificationDeltaReadyResponse {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    body.status === 'ready' &&
    typeof body.cursor === 'string' &&
    Array.isArray(body.notifications) &&
    body.notifications.every(isNotification)
  );
}

function isNotification(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  const output = item.output;
  return (
    typeof item.notificationId === 'string' &&
    typeof item.sequence === 'number' &&
    Number.isSafeInteger(item.sequence) &&
    (item.category === 'warning' ||
      item.category === 'question' ||
      item.category === 'emergency') &&
    (item.origin === 'weather' || item.origin === 'system') &&
    typeof item.occurredAt === 'string' &&
    typeof item.detectedAt === 'string' &&
    Array.isArray(item.targets) &&
    typeof output === 'object' &&
    output !== null &&
    typeof (output as Record<string, unknown>).summary === 'string' &&
    typeof (output as Record<string, unknown>).ackRequired === 'boolean'
  );
}

function isCursorOutOfRange(value: unknown): value is { readonly cursor: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).status === 'error' &&
    (value as Record<string, unknown>).code === 'cursor_out_of_range' &&
    typeof (value as Record<string, unknown>).cursor === 'string'
  );
}

/** 通常差分を取得し、UIが扱う三つの結果だけに正規化する。 */
export async function fetchNotificationDelta(
  terminalId: string,
  cursor: string,
  signal?: AbortSignal,
): Promise<NotificationDeltaClientResult> {
  try {
    const query = new URLSearchParams({ terminalId, cursor });
    const response = await window.fetch(`/api/notifications/delta?${query}`, { signal });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: 'unavailable' };
    }
    if (response.ok && isReady(body)) return { status: 'ready', response: body };
    if (response.status === 409 && isCursorOutOfRange(body)) {
      return { status: 'cursor_out_of_range', cursor: body.cursor };
    }
    return { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}
