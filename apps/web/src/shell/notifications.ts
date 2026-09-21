import type { NotificationFeedItem, TerminalMode } from '@wx-viewer-poc/shared';
import {
  INITIAL_OPERATION_MESSAGE,
  isVisibleForTerminal,
} from '../notifications/notificationStore';

// storeを変更せず、シェル表示境界でのみ端末モードによる絞り込みを行う。
export function visibleNotices(
  notices: readonly NotificationFeedItem[],
  mode: TerminalMode,
): readonly NotificationFeedItem[] {
  return notices.filter((notice) => isVisibleForTerminal(notice, mode));
}

/** 監視API障害と通知受信の再試行状態を、片方を隠さず操作ガイドへ併記する。 */
export function operationGuideMessage(
  notificationMessage: string,
  monitoringFailed: boolean,
  notificationRetrying: boolean,
): string {
  if (!monitoringFailed) return notificationMessage;
  const monitoringMessage = '取得監視: 監視情報API取得不可';
  if (!notificationRetrying || notificationMessage === INITIAL_OPERATION_MESSAGE) {
    return monitoringMessage;
  }
  return `${monitoringMessage}｜通知受信: ${notificationMessage}`;
}
