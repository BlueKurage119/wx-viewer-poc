import {
  EMPTY_NOTIFICATION_PREFERENCES,
  resolveWarningPresentationPolicy,
  type NotificationPreferences,
  type WarningPresentationPolicy,
} from './notificationPreferences';
import type { NotificationTransportState } from './notificationFeedController';
import type {
  NotificationDeltaCursor,
  NotificationFeedItem,
  TerminalMode,
} from '@wx-viewer-poc/shared';
import {
  mergeWarningHistory,
  pruneWarningHistory,
  type WarningHistoryEntry,
} from '../warnings/warningListModel';

export type NotificationPhase = 'starting' | 'ready' | 'retrying';
export type ChimeCategory = 'warning' | 'question' | 'emergency';

export type ChimeLevel = 2 | 3 | 4 | 5;
export type ConfirmationCause = 'manual' | 'automatic';
export interface WarningPresentationState {
  readonly policy: WarningPresentationPolicy;
  readonly autoConfirmDeadlineMs: number | null;
}

export interface ChimeRequest {
  readonly category: ChimeCategory;
  readonly level: ChimeLevel;
  readonly feedKey: string;
}

export interface NotificationUiState {
  readonly warningPresentationByFeedKey: Readonly<Record<string, WarningPresentationState>>;
  readonly items: readonly NotificationFeedItem[];
  readonly warningHistory: readonly WarningHistoryEntry[];
  readonly cursors: Readonly<Record<'system' | 'weather', NotificationDeltaCursor | null>>;
  readonly transport: Readonly<Record<'system' | 'weather', NotificationTransportState['phase']>>;
  readonly phase: NotificationPhase;
  readonly operationMessage: string;
  readonly confirmedFeedKeys: ReadonlySet<string>;
  readonly unreadFeedKeys: ReadonlySet<string>;
  readonly selectedQuestionFeedKey: string | null;
  readonly selectedQuestionChoice: string | null;
}

export const INITIAL_OPERATION_MESSAGE = '';
export const RETRY_OPERATION_MESSAGE = '通知を受信できません。再試行します。';

export function createNotificationUiState(): NotificationUiState {
  return {
    items: [],
    warningPresentationByFeedKey: {},
    warningHistory: [],
    cursors: { system: null, weather: null },
    transport: { system: 'starting', weather: 'starting' },
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

/** 行に実際に表示する通知。未確認のみを表示し、すべて確認済みなら空欄にする。 */
export function displayedNoticeForRow(
  state: NotificationUiState,
  mode: TerminalMode,
  row: 'warning' | 'question',
): NotificationFeedItem | undefined {
  const notices = noticesForRow(state, mode, row);
  return notices.find((item) => !state.confirmedFeedKeys.has(item.feedKey));
}

export function nextUnconfirmedChime(
  state: NotificationUiState,
  mode: TerminalMode,
): ChimeRequest | null {
  return selectNewArrivalChime(
    state.items.filter((item) => !state.confirmedFeedKeys.has(item.feedKey)),
    state,
    mode,
  );
}

export function notificationChimeLevel(
  state: NotificationUiState,
  item: NotificationFeedItem,
): ChimeLevel {
  return item.category === 'emergency'
    ? 5
    : item.category === 'question'
      ? 4
      : state.warningPresentationByFeedKey[item.feedKey]?.policy.tone === 'level2'
        ? 2
        : 3;
}

export function selectNewArrivalChime(
  newItems: readonly NotificationFeedItem[],
  state: NotificationUiState,
  mode: TerminalMode,
): ChimeRequest | null {
  const candidates = newItems.filter((item) => isVisibleForTerminal(item, mode)).sort(compareItems);
  let request: ChimeRequest | null = null;
  for (const item of candidates) {
    const level = notificationChimeLevel(state, item);
    if (request === null || level > request.level)
      request = { category: item.category, feedKey: item.feedKey, level };
  }
  return request;
}

export function confirmationSoundDecision(
  currentLevel: ChimeLevel | null,
  confirmedLevel: ChimeLevel,
): 'stop' | 'keep' {
  return currentLevel === confirmedLevel ? 'stop' : 'keep';
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
  receivedAtMs: number,
  preferences: NotificationPreferences = EMPTY_NOTIFICATION_PREFERENCES,
): { readonly state: NotificationUiState; readonly chime: ChimeRequest | null } {
  const existing = new Map(state.items.map((item) => [item.feedKey, item]));
  const newItems = [
    ...new Map(
      incoming.filter((item) => !existing.has(item.feedKey)).map((item) => [item.feedKey, item]),
    ).values(),
  ];
  const warningPresentationByFeedKey = { ...state.warningPresentationByFeedKey };
  for (const item of newItems) {
    const policy = resolveWarningPresentationPolicy(item, preferences);
    if (policy)
      warningPresentationByFeedKey[item.feedKey] = {
        policy,
        autoConfirmDeadlineMs:
          policy.autoConfirmAfterMs === null ? null : receivedAtMs + policy.autoConfirmAfterMs,
      };
  }
  const newFeedKeys = new Set(newItems.map((item) => item.feedKey));
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
    warningPresentationByFeedKey,
    // 件数超過・期限切れで外れた既知通知を再受信しても初回受信を延長しない。
    warningHistory: mergeWarningHistory(
      state.warningHistory,
      incoming.filter(
        (item) =>
          newFeedKeys.has(item.feedKey) ||
          state.warningHistory.some((entry) => entry.item.feedKey === item.feedKey),
      ),
      receivedAtMs,
    ),
    unreadFeedKeys,
    ...(hasQuestionInterruption
      ? { selectedQuestionFeedKey: null, selectedQuestionChoice: null }
      : {}),
  };
  const chime = selectNewArrivalChime(newItems, next, mode);
  return { state: { ...next, unreadFeedKeys: markDisplayedRowsRead(next, mode) }, chime };
}

export function expireWarningHistory(
  state: NotificationUiState,
  nowMs: number,
): NotificationUiState {
  const warningHistory = pruneWarningHistory(state.warningHistory, nowMs);
  return warningHistory === state.warningHistory ? state : { ...state, warningHistory };
}

export function setNotificationTransport(
  state: NotificationUiState,
  update: NotificationTransportState,
): NotificationUiState {
  const cursors = { ...state.cursors, [update.origin]: update.cursor };
  const transport = { ...state.transport, [update.origin]: update.phase };
  const failed = (['system', 'weather'] as const).filter(
    (origin) => transport[origin] === 'retrying',
  );
  const operationMessage = failed.length
    ? `${failed.map((origin) => (origin === 'system' ? 'システム通知' : '気象通知')).join('・')}を受信できません。再試行します。`
    : (update.message ?? INITIAL_OPERATION_MESSAGE);
  return {
    ...state,
    cursors,
    transport,
    phase: failed.length ? 'retrying' : transport.system === 'ready' ? 'ready' : 'starting',
    operationMessage,
  };
}

export function setNotificationCursor(
  state: NotificationUiState,
  cursor: NotificationDeltaCursor,
  operationMessage = INITIAL_OPERATION_MESSAGE,
): NotificationUiState {
  return setNotificationTransport(state, {
    origin: 'weather',
    cursor,
    phase: 'ready',
    message: operationMessage,
  });
}

export function setNotificationRetry(state: NotificationUiState): NotificationUiState {
  return setNotificationTransport(state, {
    origin: 'weather',
    cursor: state.cursors.weather,
    phase: 'retrying',
  });
}

export function selectQuestionConfirmation(
  state: NotificationUiState,
  feedKey: string,
): NotificationUiState {
  const notice = state.items.find((item) => item.feedKey === feedKey);
  if (!notice || notice.category === 'warning') return state;
  return {
    ...state,
    selectedQuestionFeedKey: feedKey,
    selectedQuestionChoice: 'confirm',
  };
}

export function confirmNotification(
  state: NotificationUiState,
  feedKey: string,
  mode: TerminalMode,
  cause: ConfirmationCause = 'manual',
): NotificationUiState {
  const item = state.items.find((item) => item.feedKey === feedKey);
  if (
    !item ||
    state.confirmedFeedKeys.has(feedKey) ||
    (cause === 'automatic' &&
      (item.category !== 'warning' ||
        state.warningPresentationByFeedKey[feedKey]?.policy.autoConfirmAfterMs !== 5000))
  )
    return state;
  const confirmedFeedKeys = new Set(state.confirmedFeedKeys);
  confirmedFeedKeys.add(feedKey);
  const unreadFeedKeys = new Set(state.unreadFeedKeys);
  unreadFeedKeys.delete(feedKey);
  const next = {
    ...state,
    confirmedFeedKeys,
    unreadFeedKeys,
    ...(cause === 'manual' ? { selectedQuestionFeedKey: null, selectedQuestionChoice: null } : {}),
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
