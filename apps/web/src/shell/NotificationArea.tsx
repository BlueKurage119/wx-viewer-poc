import { GbButton } from '../components/md';
import type { TerminalMode } from '@wx-viewer-poc/shared';
import {
  displayedNoticeForRow,
  notificationCounts,
  type NotificationUiState,
} from '../notifications/notificationStore';
export function NotificationArea({
  state,
  mode,
  operationTitle,
  onSelectQuestionConfirmation,
  onConfirm,
}: {
  state: NotificationUiState;
  mode: TerminalMode;
  /** 操作行が省略されたときの全文（複数件の操作を併記する）。 */
  operationTitle?: string;
  onSelectQuestionConfirmation?: (feedKey: string) => void;
  onConfirm?: (feedKey: string) => void;
}) {
  const counts = notificationCounts(state, mode);
  return (
    <>
      <NoticeRow
        row="warning"
        notice={displayedNoticeForRow(state, mode, 'warning')}
        autoConfirm={
          state.warningPresentationByFeedKey[
            displayedNoticeForRow(state, mode, 'warning')?.feedKey ?? ''
          ]?.policy.tone === 'level2'
        }
        onConfirm={onConfirm}
      />
      <NoticeRow
        row="question"
        notice={displayedNoticeForRow(state, mode, 'question')}
        selectedQuestionFeedKey={state.selectedQuestionFeedKey}
        selectedQuestionChoice={state.selectedQuestionChoice}
        onSelectQuestionConfirmation={onSelectQuestionConfirmation}
        onConfirm={onConfirm}
      />
      <div className="notice-row operation-row">
        <div
          className="notice-text"
          role="status"
          aria-live="polite"
          tabIndex={0}
          title={operationTitle}
        >
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
  autoConfirm = false,
  selectedQuestionFeedKey,
  selectedQuestionChoice,
  onSelectQuestionConfirmation,
  onConfirm,
}: {
  row: 'warning' | 'question';
  autoConfirm?: boolean;
  notice: ReturnType<typeof displayedNoticeForRow>;
  selectedQuestionFeedKey?: string | null;
  selectedQuestionChoice?: string | null;
  onSelectQuestionConfirmation?: (feedKey: string) => void;
  onConfirm?: (feedKey: string) => void;
}) {
  const rowClass =
    row === 'warning'
      ? `warning-row ${autoConfirm ? 'warning-auto-row' : 'warning-manual-row'}`
      : notice?.category === 'emergency'
        ? 'emergency-row'
        : 'question-row';
  const isQuestion = notice?.category === 'question' || notice?.category === 'emergency';
  const isConfirmationSelected =
    isQuestion &&
    notice?.feedKey === selectedQuestionFeedKey &&
    selectedQuestionChoice === 'confirm';
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
            <NotificationActionButton
              type="button"
              aria-pressed={isConfirmationSelected ? 'true' : 'false'}
              disabled={!notice || !onSelectQuestionConfirmation}
              onClick={() => notice && onSelectQuestionConfirmation?.(notice.feedKey)}
            >
              確認
            </NotificationActionButton>
          </div>
        )}
        <div className="notice-actions">
          {actions.map((label, index) => (
            <NotificationActionButton
              key={`${label}-${index}`}
              type="button"
              sendReady={label === '送信'}
              disabled={
                !notice ||
                (label === '確認'
                  ? !onConfirm
                  : label === '送信'
                    ? !onConfirm || !isConfirmationSelected
                    : true)
              }
              onClick={() =>
                notice &&
                (label === '確認' || (label === '送信' && isConfirmationSelected)) &&
                onConfirm?.(notice.feedKey)
              }
            >
              {label}
            </NotificationActionButton>
          ))}
        </div>
      </div>
    </div>
  );
}

// 配布物のtoggle/selected APIは、通知の選択ボタンに限って型を拡張する。
const NotificationGbButton = GbButton as React.ForwardRefExoticComponent<
  Omit<React.ComponentProps<typeof GbButton>, 'type'> & {
    readonly type: 'button' | 'toggle';
    readonly selected?: boolean;
  }
>;

function NotificationActionButton({
  children,
  onClick,
  disabled,
  sendReady = false,
  'aria-pressed': pressed,
  ...props
}: Omit<React.ComponentProps<typeof GbButton>, 'color' | 'size' | 'square'> & {
  readonly sendReady?: boolean;
}) {
  const selectable = pressed !== undefined;
  const selected = pressed === 'true' || pressed === true;
  return (
    <NotificationGbButton
      {...props}
      disabled={disabled}
      type={selectable ? 'toggle' : 'button'}
      selected={selectable ? selected : undefined}
      color="filled"
      size="sm"
      square
      className={`notification-action-button${selected ? ' notification-action-selected' : ''}${sendReady && !disabled ? ' notification-send-ready' : ''}`}
      aria-label={typeof children === 'string' && children ? children : undefined}
      onClick={(event) => {
        // 選択は通知storeで管理する。配布物の既定トグルによる解除を抑制する。
        if (selectable) event.preventDefault();
        onClick?.(event);
      }}
    >
      <span aria-hidden="true" className="notification-action-container" slot="container" />
      <span className="notification-action-content">{children}</span>
    </NotificationGbButton>
  );
}
