import type { TerminalMode } from '@wx-viewer-poc/shared';
import { confirmNotification, isSettled, type NotificationUiState } from './notificationStore';

export function nextAutoConfirmationDeadline(state: NotificationUiState): number | null {
  const deadlines = Object.entries(state.warningPresentationByFeedKey)
    .filter(
      ([key, presentation]) =>
        !isSettled(state, key) && presentation.autoConfirmDeadlineMs !== null,
    )
    .map(([, presentation]) => presentation.autoConfirmDeadlineMs as number);
  return deadlines.length ? Math.min(...deadlines) : null;
}

export function advanceAutoConfirmation(
  state: NotificationUiState,
  mode: TerminalMode,
  nowMs: number,
): {
  readonly state: NotificationUiState;
  readonly automaticallyConfirmedFeedKeys: readonly string[];
} {
  let next = state;
  const automaticallyConfirmedFeedKeys: string[] = [];
  for (const [feedKey, presentation] of Object.entries(state.warningPresentationByFeedKey)) {
    if (presentation.autoConfirmDeadlineMs === null || presentation.autoConfirmDeadlineMs > nowMs)
      continue;
    const confirmed = confirmNotification(next, feedKey, mode, 'automatic');
    if (confirmed !== next) automaticallyConfirmedFeedKeys.push(feedKey);
    next = confirmed;
  }
  return { state: next, automaticallyConfirmedFeedKeys };
}
