import type { TerminalMode } from '@wx-viewer-poc/shared';
import {
  noticesForRow,
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
  onConfirm: (feedKey: string) => void;
}) {
  const warnings = noticesForRow(state, mode, 'warning');
  const questions = noticesForRow(state, mode, 'question');
  const counts = notificationCounts(state, mode);
  return (
    <>
      <NoticeRow label="警報" notices={warnings} state={state} onConfirm={onConfirm} />
      <NoticeRow label="問いかけ" notices={questions} state={state} onConfirm={onConfirm} />
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
  label,
  notices,
  state,
  onConfirm,
}: {
  label: string;
  notices: ReturnType<typeof noticesForRow>;
  state: NotificationUiState;
  onConfirm: (feedKey: string) => void;
}) {
  const notice = notices.find((item) => !state.confirmedFeedKeys.has(item.feedKey)) ?? notices[0];
  return (
    <div
      className={`notice-row ${notice ? 'has-notice' : ''} ${label === '警報' ? 'warning-row' : 'question-row'}`}
    >
      <div
        className="notice-text"
        role="status"
        aria-live="polite"
        tabIndex={notice ? 0 : undefined}
      >
        {notice?.summary}
      </div>
      {notice && (
        <div className="notice-actions">
          {/* 詳細・関連・選択肢は許可済み構造化ディスクリプタを受け取る後続Issueで接続する。 */}
          <button type="button" onClick={() => onConfirm(notice.feedKey)}>
            確認
          </button>
        </div>
      )}
    </div>
  );
}
