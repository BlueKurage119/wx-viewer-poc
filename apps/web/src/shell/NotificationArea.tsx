import type { TerminalMode } from '@wx-viewer-poc/shared';
import {
  displayedNoticeForRow,
  notificationCounts,
  type NotificationUiState,
} from '../notifications/notificationStore';
export function NotificationArea({
  state,
  mode,
}: {
  state: NotificationUiState;
  mode: TerminalMode;
}) {
  const counts = notificationCounts(state, mode);
  return (
    <>
      <NoticeRow notice={displayedNoticeForRow(state, mode, 'warning')} />
      <NoticeRow notice={displayedNoticeForRow(state, mode, 'question')} />
      <div className="notice-row operation-row">
        <div className="notice-text" role="status" aria-live="polite" tabIndex={0}>
          {state.operationMessage}
        </div>
        <span className="notice-count">
          未読 {counts.unread}・未対応 {counts.pending}
        </span>
      </div>
    </>
  );
}
function NoticeRow({ notice }: { notice: ReturnType<typeof displayedNoticeForRow> }) {
  const rowClass = notice?.category === 'warning' ? 'warning-row' : 'question-row';
  return (
    <div className={`notice-row ${notice ? 'has-notice' : ''} ${rowClass}`}>
      <div
        className="notice-text"
        role="status"
        aria-live="polite"
        tabIndex={notice ? 0 : undefined}
      >
        {notice?.summary}
      </div>
      <div className="notice-actions">
        <button type="button" disabled>
          確認（送信）
        </button>
        <button type="button" disabled>
          関連（詳細）
        </button>
      </div>
    </div>
  );
}
