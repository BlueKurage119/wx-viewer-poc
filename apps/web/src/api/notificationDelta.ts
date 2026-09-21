import {
  isNotificationDeltaCursor,
  type NotificationDeltaReadyResponse,
} from '@wx-viewer-poc/shared';

export type NotificationDeltaClientResult =
  | { readonly status: 'ready'; readonly response: NotificationDeltaReadyResponse }
  | { readonly status: 'cursor_out_of_range'; readonly cursor: string }
  | { readonly status: 'unavailable' };

function isReady(value: unknown): value is NotificationDeltaReadyResponse {
  if (!isRecord(value)) return false;
  const body = value;
  return (
    body.status === 'ready' &&
    typeof body.terminalId === 'string' &&
    typeof body.venueId === 'string' &&
    typeof body.serverGenerationId === 'string' &&
    typeof body.generatedAt === 'string' &&
    typeof body.skippedCount === 'number' &&
    Number.isSafeInteger(body.skippedCount) &&
    body.skippedCount >= 0 &&
    isNotificationDeltaCursor(body.cursor) &&
    Array.isArray(body.notifications) &&
    body.notifications.every(isNotification)
  );
}

function isNotification(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const item = value;
  const output = item.output;
  return (
    typeof item.notificationId === 'string' &&
    typeof item.sequence === 'number' &&
    Number.isSafeInteger(item.sequence) &&
    item.sequence >= 0 &&
    (item.category === 'warning' ||
      item.category === 'question' ||
      item.category === 'emergency') &&
    (item.origin === 'weather' || item.origin === 'system') &&
    (item.detectionContext === 'normal' || item.detectionContext === 'initial') &&
    typeof item.sourceType === 'string' &&
    (item.sourceVersion === null || typeof item.sourceVersion === 'string') &&
    typeof item.changeType === 'string' &&
    typeof item.occurredAt === 'string' &&
    typeof item.detectedAt === 'string' &&
    isTargets(item.targets) &&
    isRelatedRefs(item.relatedRefs) &&
    typeof item.isTraining === 'boolean' &&
    (item.venueScope === 'venue' ||
      item.venueScope === 'global' ||
      item.venueScope === 'unresolved') &&
    isOutput(output)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTargets(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (target) =>
        isRecord(target) &&
        (target.kind === 'area' || target.kind === 'point' || target.kind === 'equipment') &&
        typeof target.codeType === 'string' &&
        typeof target.code === 'string' &&
        typeof target.name === 'string',
    )
  );
}

function isRelatedRefs(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (ref) => isRecord(ref) && typeof ref.type === 'string' && typeof ref.ref === 'string',
    )
  );
}

function isOutput(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const definition = value.messageDefinition;
  return (
    typeof value.ackRequired === 'boolean' &&
    typeof value.summary === 'string' &&
    (definition === null ||
      (isRecord(definition) &&
        typeof definition.id === 'string' &&
        typeof definition.version === 'string'))
  );
}

function isCursorOutOfRange(value: unknown): value is { readonly cursor: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).status === 'error' &&
    (value as Record<string, unknown>).code === 'cursor_out_of_range' &&
    isNotificationDeltaCursor((value as Record<string, unknown>).cursor)
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
