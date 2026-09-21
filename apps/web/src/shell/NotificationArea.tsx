import type { TerminalMode } from '@wx-viewer-poc/shared';
import {
  displayedNoticeForRow,
  notificationCounts,
  type NotificationUiState,
} from '../notifications/notificationStore';
export function NotificationArea({
  state,
  mode,
  onConfirm,
}: {
  state: NotificationUiState;
  mode: TerminalMode;
  onConfirm?: (feedKey: string) => void;
}) {
  const counts = notificationCounts(state, mode);
  return (
    <>
      <NoticeRow
        row="warning"
        notice={displayedNoticeForRow(state, mode, 'warning')}
        onConfirm={onConfirm}
      />
      <NoticeRow
        row="question"
        notice={displayedNoticeForRow(state, mode, 'question')}
        onConfirm={onConfirm}
      />
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
function NoticeRow({
  row,
  notice,
  onConfirm,
}: {
  row: 'warning' | 'question';
  notice: ReturnType<typeof displayedNoticeForRow>;
  onConfirm?: (feedKey: string) => void;
}) {
  const rowClass =
    row === 'warning'
      ? 'warning-row'
      : notice?.category === 'emergency'
        ? 'emergency-row'
        : 'question-row';
  const isQuestion = notice?.category === 'question' || notice?.category === 'emergency';
  const actions = notice
    ? notice.category === 'warning'
      ? ['詳細', '確認']
      : ['詳細', '送信']
    : ['', ''];
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
      <div className="notice-controls">
        {isQuestion && (
          <div className="notice-question-choices">
            <button
              type="button"
              disabled={!notice || !onConfirm}
              onClick={() => notice && onConfirm?.(notice.feedKey)}
            >
              確認
            </button>
          </div>
        )}
        <div className="notice-actions">
          {actions.map((label, index) => (
            <button
              key={`${label}-${index}`}
              type="button"
              disabled={!notice || !onConfirm || label !== '確認'}
              onClick={() => notice && label === '確認' && onConfirm?.(notice.feedKey)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
