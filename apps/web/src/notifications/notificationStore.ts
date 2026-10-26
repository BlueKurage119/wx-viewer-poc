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
  readonly historyOnlyFeedKeys: ReadonlySet<string>;
  readonly alertedFeedKeys: ReadonlySet<string>;
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
    historyOnlyFeedKeys: new Set(),
    alertedFeedKeys: new Set(),
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

/** 通知エリア・未読・件数・ブザーの対象外か(確認済み、履歴のみ、または鳴動済み)。 */
export function isSettled(state: NotificationUiState, feedKey: string): boolean {
  return state.confirmedFeedKeys.has(feedKey) || state.historyOnlyFeedKeys.has(feedKey);
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
  return notices.find((item) => !isSettled(state, item.feedKey));
}

export function nextUnconfirmedChime(
  state: NotificationUiState,
  mode: TerminalMode,
): ChimeRequest | null {
  return selectNewArrivalChime(
    state.items.filter((item) => !isSettled(state, item.feedKey)),
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

function notificationTargetKey(item: NotificationFeedItem): string {
  const targets = item.targets
    .map((t) => `${t.codeType}:${t.code}`)
    .sort()
    .join(';');
  return `${item.sourceType}|${targets}`;
}

function canResolveAbnormal(
  abnormal: NotificationFeedItem,
  resolver: NotificationFeedItem,
): boolean {
  if (abnormal.origin !== 'system' || resolver.origin !== 'system') return false;
  if (abnormal.sourceType !== resolver.sourceType) return false;

  if (abnormal.sourceType === 'fetch_health') {
    return (
      (abnormal.changeType === 'fetch_abnormal' || abnormal.changeType === 'fetch_delayed') &&
      resolver.changeType === 'fetch_recovered'
    );
  }

  if (abnormal.sourceType === 'database_recovery') {
    return (
      abnormal.changeType === 'database_recovery_delayed' &&
      resolver.changeType === 'database_recovery_completed'
    );
  }

  if (abnormal.sourceType === 'weather_worker') {
    return (
      abnormal.changeType !== 'restart_completed' && resolver.changeType === 'restart_completed'
    );
  }

  return false;
}

function isOccurredAfter(later: NotificationFeedItem, earlier: NotificationFeedItem): boolean {
  if (later.occurredAt !== earlier.occurredAt) {
    return later.occurredAt > earlier.occurredAt;
  }
  const seqLater = later.sequence ?? -1;
  const seqEarlier = earlier.sequence ?? -1;
  return seqLater > seqEarlier;
}

/** 同一取得分の中に、後続の解消通知がある異常の feedKey を返す。 */
export function resolvedAbnormalFeedKeys(
  items: readonly NotificationFeedItem[],
): ReadonlySet<string> {
  const resolved = new Set<string>();
  for (const abnormal of items) {
    if (abnormal.origin !== 'system') continue;
    const targetKey = notificationTargetKey(abnormal);
    const hasResolver = items.some(
      (resolver) =>
        resolver.origin === 'system' &&
        notificationTargetKey(resolver) === targetKey &&
        canResolveAbnormal(abnormal, resolver) &&
        isOccurredAfter(resolver, abnormal),
    );
    if (hasResolver) {
      resolved.add(abnormal.feedKey);
    }
  }
  return resolved;
}

export function markAlerted(
  state: NotificationUiState,
  feedKeys: readonly string[],
): NotificationUiState {
  if (feedKeys.length === 0) return state;
  const alertedFeedKeys = new Set(state.alertedFeedKeys);
  let changed = false;
  for (const key of feedKeys) {
    if (!alertedFeedKeys.has(key)) {
      alertedFeedKeys.add(key);
      changed = true;
    }
  }
  return changed ? { ...state, alertedFeedKeys } : state;
}

export function restoreAlertedFeedKeys(
  state: NotificationUiState,
  feedKeys: readonly string[],
): NotificationUiState {
  if (feedKeys.length === 0) return state;
  const alertedFeedKeys = new Set(state.alertedFeedKeys);
  for (const key of feedKeys) {
    alertedFeedKeys.add(key);
  }
  return { ...state, alertedFeedKeys };
}

export function discardPreviousGeneration(
  state: NotificationUiState,
  mode: TerminalMode,
): NotificationUiState {
  const systemFeedKeysInItems = new Set(
    state.items.filter((item) => item.origin === 'system').map((item) => item.feedKey),
  );
  const systemFeedKeysInHistory = new Set(
    state.warningHistory
      .filter((entry) => entry.item.origin === 'system')
      .map((entry) => entry.item.feedKey),
  );

  const isTargetFeedKey = (feedKey: string) =>
    systemFeedKeysInItems.has(feedKey) ||
    systemFeedKeysInHistory.has(feedKey) ||
    state.alertedFeedKeys.has(feedKey) ||
    state.historyOnlyFeedKeys.has(feedKey);

  const items = state.items.filter((item) => item.origin !== 'system');
  const warningHistory = state.warningHistory.filter((entry) => entry.item.origin !== 'system');

  const warningPresentationByFeedKey: Record<string, WarningPresentationState> = {};
  for (const [key, value] of Object.entries(state.warningPresentationByFeedKey)) {
    if (!isTargetFeedKey(key)) {
      warningPresentationByFeedKey[key] = value;
    }
  }

  const confirmedFeedKeys = new Set(
    Array.from(state.confirmedFeedKeys).filter((key) => !isTargetFeedKey(key)),
  );
  const unreadFeedKeys = new Set(
    Array.from(state.unreadFeedKeys).filter((key) => !isTargetFeedKey(key)),
  );
  const historyOnlyFeedKeys = new Set(
    Array.from(state.historyOnlyFeedKeys).filter((key) => !isTargetFeedKey(key)),
  );
  const alertedFeedKeys = new Set(
    Array.from(state.alertedFeedKeys).filter((key) => !isTargetFeedKey(key)),
  );

  const questionRemoved =
    state.selectedQuestionFeedKey !== null && isTargetFeedKey(state.selectedQuestionFeedKey);

  const next: NotificationUiState = {
    ...state,
    items,
    warningHistory,
    warningPresentationByFeedKey,
    confirmedFeedKeys,
    unreadFeedKeys,
    historyOnlyFeedKeys,
    alertedFeedKeys,
    ...(questionRemoved ? { selectedQuestionFeedKey: null, selectedQuestionChoice: null } : {}),
  };

  return { ...next, unreadFeedKeys: markDisplayedRowsRead(next, mode) };
}

export function receiveNotifications(
  state: NotificationUiState,
  incoming: readonly NotificationFeedItem[],
  mode: TerminalMode,
  receivedAtMs: number,
  preferences: NotificationPreferences = EMPTY_NOTIFICATION_PREFERENCES,
  options: { readonly initialFetch?: boolean } = {},
): { readonly state: NotificationUiState; readonly chime: ChimeRequest | null } {
  const existing = new Map(state.items.map((item) => [item.feedKey, item]));
  const newItems = [
    ...new Map(
      incoming.filter((item) => !existing.has(item.feedKey)).map((item) => [item.feedKey, item]),
    ).values(),
  ];

  const historyOnlyFeedKeys = new Set(state.historyOnlyFeedKeys);
  for (const item of newItems) {
    if (state.alertedFeedKeys.has(item.feedKey)) {
      historyOnlyFeedKeys.add(item.feedKey);
    }
  }
  if (options.initialFetch === true) {
    const resolvedKeys = resolvedAbnormalFeedKeys(newItems);
    for (const key of resolvedKeys) {
      historyOnlyFeedKeys.add(key);
    }
  }

  const alertEligibleNewItems = newItems.filter(
    (item) => !historyOnlyFeedKeys.has(item.feedKey) && !state.alertedFeedKeys.has(item.feedKey),
  );

  const warningPresentationByFeedKey = { ...state.warningPresentationByFeedKey };
  for (const item of alertEligibleNewItems) {
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
  for (const item of alertEligibleNewItems) unreadFeedKeys.add(item.feedKey);

  const hasQuestionInterruption = alertEligibleNewItems.some(
    (item) => isVisibleForTerminal(item, mode) && item.category !== 'warning',
  );
  const intermediateState: NotificationUiState = {
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
    historyOnlyFeedKeys,
    ...(hasQuestionInterruption
      ? { selectedQuestionFeedKey: null, selectedQuestionChoice: null }
      : {}),
  };

  const chimeCandidates = alertEligibleNewItems
    .filter((item) => isVisibleForTerminal(item, mode))
    .sort(compareItems);
  const chime = selectNewArrivalChime(alertEligibleNewItems, intermediateState, mode);

  // 鳴動の記録: ブザーの対象にした時点(確定 U-1)。
  // receiveNotifications で chime 候補になった新着の system 通知すべてを記録する
  const systemCandidatesToAlert = chimeCandidates
    .filter((item) => item.origin === 'system')
    .map((item) => item.feedKey);

  const stateWithAlerted =
    systemCandidatesToAlert.length > 0
      ? markAlerted(intermediateState, systemCandidatesToAlert)
      : intermediateState;

  return {
    state: { ...stateWithAlerted, unreadFeedKeys: markDisplayedRowsRead(stateWithAlerted, mode) },
    chime,
  };
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
    isSettled(state, feedKey) ||
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
    pending: visible.filter((item) => item.ackRequired && !isSettled(state, item.feedKey)).length,
  };
}
