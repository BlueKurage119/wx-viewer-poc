import type { NotificationFeedItem, TerminalMode } from '@wx-viewer-poc/shared';
import { isVisibleForTerminal } from '../notifications/notificationStore';

export interface WarningHistoryEntry {
  readonly item: NotificationFeedItem;
  readonly firstReceivedAtMs: number;
}

export const WARNING_HISTORY_DURATION_MS = 24 * 60 * 60 * 1000;
export const WARNING_HISTORY_LIMIT = 500;

function compareEntries(a: WarningHistoryEntry, b: WarningHistoryEntry): number {
  if (a.item.occurredAt !== b.item.occurredAt)
    return b.item.occurredAt.localeCompare(a.item.occurredAt);
  if (a.item.sequence !== b.item.sequence) {
    if (a.item.sequence === null) return 1;
    if (b.item.sequence === null) return -1;
    return b.item.sequence - a.item.sequence;
  }
  return b.item.feedKey.localeCompare(a.item.feedKey);
}

/** 一覧だけを期限・件数で制限する。共通通知の確認対象は削らない。 */
export function pruneWarningHistory(
  entries: readonly WarningHistoryEntry[],
  nowMs: number,
): readonly WarningHistoryEntry[] {
  const retained = entries
    .filter(
      ({ item, firstReceivedAtMs }) =>
        item.source === 'startup' || firstReceivedAtMs >= nowMs - WARNING_HISTORY_DURATION_MS,
    )
    .sort(compareEntries)
    .slice(0, WARNING_HISTORY_LIMIT);
  return retained.length === entries.length && retained.every((entry, i) => entry === entries[i])
    ? entries
    : retained;
}

export function mergeWarningHistory(
  existing: readonly WarningHistoryEntry[],
  incoming: readonly NotificationFeedItem[],
  receivedAtMs: number,
): readonly WarningHistoryEntry[] {
  const entries = new Map(existing.map((entry) => [entry.item.feedKey, entry]));
  for (const item of incoming) {
    entries.set(item.feedKey, {
      item,
      firstReceivedAtMs: entries.get(item.feedKey)?.firstReceivedAtMs ?? receivedAtMs,
    });
  }
  return pruneWarningHistory([...entries.values()], receivedAtMs);
}

export function selectWarningHistory(
  entries: readonly WarningHistoryEntry[],
  mode: TerminalMode,
  nowMs: number,
): readonly NotificationFeedItem[] {
  return pruneWarningHistory(entries, nowMs)
    .map((entry) => entry.item)
    .filter((item) => isVisibleForTerminal(item, mode));
}

const sourceTypeLabels: Readonly<Record<string, string>> = {
  warning_current: '気象警報・注意報',
  bosai_bulletin: '防災気象情報',
  fetch_health: '取得状態',
  fetch_control: '取得操作',
  database_recovery: 'データベース復旧',
};

export function warningSourceTypeLabel(sourceType: string): string {
  return Object.hasOwn(sourceTypeLabels, sourceType) ? sourceTypeLabels[sourceType]! : sourceType;
}

const dateFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function formatWarningOccurredAt(occurredAt: string): string {
  return dateFormat.format(new Date(occurredAt));
}
