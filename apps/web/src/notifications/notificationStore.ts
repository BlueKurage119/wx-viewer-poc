import type {
  NotificationDeltaCursor,
  NotificationFeedItem,
  TerminalMode,
} from '@wx-viewer-poc/shared';

export type NotificationPhase = 'starting' | 'ready' | 'retrying';
export type ChimeCategory = 'warning' | 'question' | 'emergency';

export interface ChimeRequest {
  readonly category: ChimeCategory;
  readonly feedKey: string;
}

export interface NotificationUiState {
  readonly items: readonly NotificationFeedItem[];
  readonly cursor: NotificationDeltaCursor | null;
  readonly phase: NotificationPhase;
  readonly operationMessage: string;
  readonly confirmedFeedKeys: ReadonlySet<string>;
  readonly unreadFeedKeys: ReadonlySet<string>;
  readonly selectedQuestionFeedKey: string | null;
  readonly selectedQuestionChoice: string | null;
}

export const INITIAL_OPERATION_MESSAGE = '左のメニューから表示する画面を選択してください。';
export const RETRY_OPERATION_MESSAGE = '通知を受信できません。再試行します。';

export function createNotificationUiState(): NotificationUiState {
  return {
    items: [],
    cursor: null,
    phase: 'starting',
    operationMessage: INITIAL_OPERATION_MESSAGE,
    confirmedFeedKeys: new Set(),
    unreadFeedKeys: new Set(),
    selectedQuestionFeedKey: null,
    selectedQuestionChoice: null,
  };
}

function compareItems(a: NotificationFeedItem, b: NotificationFeedItem): number {
  if (a.occurredAt !== b.occurredAt) return b.occurredAt.localeCompare(a.occurredAt);
  if (a.sequence !== b.sequence) {
    if (a.sequence === null) return 1;
    if (b.sequence === null) return -1;
    return b.sequence - a.sequence;
  }
  return b.feedKey.localeCompare(a.feedKey);
}

export function isVisibleForTerminal(item: NotificationFeedItem, mode: TerminalMode): boolean {
  return mode === 'K' || item.origin !== 'system';
}

export function noticesForRow(
  state: NotificationUiState,
  mode: TerminalMode,
  row: 'warning' | 'question',
): readonly NotificationFeedItem[] {
  return state.items.filter(
    (item) =>
      isVisibleForTerminal(item, mode) &&
      (row === 'warning' ? item.category === 'warning' : item.category !== 'warning'),
  );
}

/** 行に実際に表示する通知。未確認を優先し、すべて確認済みなら最新を表示する。 */
export function displayedNoticeForRow(
  state: NotificationUiState,
  mode: TerminalMode,
  row: 'warning' | 'question',
): NotificationFeedItem | undefined {
  const notices = noticesForRow(state, mode, row);
  return notices.find((item) => !state.confirmedFeedKeys.has(item.feedKey)) ?? notices[0];
}

function markDisplayedRowsRead(
  state: NotificationUiState,
  mode: TerminalMode,
): ReadonlySet<string> {
  const unread = new Set(state.unreadFeedKeys);
  for (const row of ['warning', 'question'] as const) {
    const item = displayedNoticeForRow(state, mode, row);
    if (item) unread.delete(item.feedKey);
  }
  return unread;
}

export function receiveNotifications(
  state: NotificationUiState,
  incoming: readonly NotificationFeedItem[],
  mode: TerminalMode,
): { readonly state: NotificationUiState; readonly chime: ChimeRequest | null } {
  const existing = new Map(state.items.map((item) => [item.feedKey, item]));
  const newItems = incoming.filter((item) => !existing.has(item.feedKey));
  for (const item of incoming) existing.set(item.feedKey, item);
  const items = Array.from(existing.values()).sort(compareItems);
  const unreadFeedKeys = new Set(state.unreadFeedKeys);
  for (const item of newItems) unreadFeedKeys.add(item.feedKey);

  const hasQuestionInterruption = newItems.some(
    (item) => isVisibleForTerminal(item, mode) && item.category !== 'warning',
  );
  const next: NotificationUiState = {
    ...state,
    items,
    unreadFeedKeys,
    ...(hasQuestionInterruption
      ? { selectedQuestionFeedKey: null, selectedQuestionChoice: null }
      : {}),
  };
  const ranked = newItems.filter((item) => isVisibleForTerminal(item, mode));
  const chimeItem =
    ranked.find((item) => item.category === 'emergency') ??
    ranked.find((item) => item.category === 'question') ??
    ranked.find((item) => item.category === 'warning');
  const chime = chimeItem ? { category: chimeItem.category, feedKey: chimeItem.feedKey } : null;
  return { state: { ...next, unreadFeedKeys: markDisplayedRowsRead(next, mode) }, chime };
}

export function setNotificationCursor(
  state: NotificationUiState,
  cursor: NotificationDeltaCursor,
  operationMessage = INITIAL_OPERATION_MESSAGE,
): NotificationUiState {
  return { ...state, cursor, phase: 'ready', operationMessage };
}

export function setNotificationRetry(state: NotificationUiState): NotificationUiState {
  return { ...state, phase: 'retrying', operationMessage: RETRY_OPERATION_MESSAGE };
}

export function confirmNotification(
  state: NotificationUiState,
  feedKey: string,
  mode: TerminalMode,
): NotificationUiState {
  const confirmedFeedKeys = new Set(state.confirmedFeedKeys);
  confirmedFeedKeys.add(feedKey);
  const unreadFeedKeys = new Set(state.unreadFeedKeys);
  unreadFeedKeys.delete(feedKey);
  const next = {
    ...state,
    confirmedFeedKeys,
    unreadFeedKeys,
    selectedQuestionFeedKey: null,
    selectedQuestionChoice: null,
  };
  return { ...next, unreadFeedKeys: markDisplayedRowsRead(next, mode) };
}

export function notificationCounts(
  state: NotificationUiState,
  mode: TerminalMode,
): {
  readonly unread: number;
  readonly pending: number;
} {
  const visible = state.items.filter((item) => isVisibleForTerminal(item, mode));
  return {
    unread: visible.filter((item) => state.unreadFeedKeys.has(item.feedKey)).length,
    pending: visible.filter(
      (item) => item.ackRequired && !state.confirmedFeedKeys.has(item.feedKey),
    ).length,
  };
}
