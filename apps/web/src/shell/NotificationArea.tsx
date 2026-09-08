import type { ShellNotice } from './notifications';
export function NotificationArea({
  notices,
  operation,
}: {
  notices: readonly ShellNotice[];
  operation: string;
}) {
  const warnings = notices.filter((notice) => notice.category === 'warning');
  const questions = notices.filter((notice) => notice.category !== 'warning');
  return (
    <>
      <NoticeRow label="警報" notices={warnings} />
      <NoticeRow label="問いかけ" notices={questions} />
      <div className="notice-row operation-row">
        <div className="notice-text" role="status" tabIndex={0}>
          {operation}
        </div>
        <span className="notice-count">
          未読 {notices.filter((notice) => notice.unread).length}・未対応{' '}
          {notices.filter((notice) => notice.pending).length}
        </span>
      </div>
    </>
  );
}
function NoticeRow({ label, notices }: { label: string; notices: readonly ShellNotice[] }) {
  const notice = notices[0];
  return (
    <div
      className={`notice-row ${notice ? 'has-notice' : ''} ${label === '警報' ? 'warning-row' : 'question-row'}`}
    >
      <div className="notice-text" role="status" tabIndex={notice ? 0 : undefined}>
        {notice?.summary}
      </div>
      <div className="notice-actions">
        <button disabled title="通知の詳細・確認操作は後続実装">
          詳細
        </button>
        {/* 問いかけの選択肢は通知側が都度提供する。選択肢なしの確認のみの場合は[確認]→[送信]の2段階とする(後続実装)。 */}
        <button disabled>{label === '警報' ? '確認' : '送信'}</button>
      </div>
    </div>
  );
}
