import type { NotificationFeedItem, TerminalMode } from '@wx-viewer-poc/shared';
import { isVisibleForTerminal } from '../notifications/notificationStore';

// storeを変更せず、シェル表示境界でのみ端末モードによる絞り込みを行う。
export function visibleNotices(
  notices: readonly NotificationFeedItem[],
  mode: TerminalMode,
): readonly NotificationFeedItem[] {
  return notices.filter((notice) => isVisibleForTerminal(notice, mode));
}
