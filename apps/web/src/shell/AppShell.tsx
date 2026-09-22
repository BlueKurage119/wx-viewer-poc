import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { applyMd3Theme } from '../theme/applyTheme';
import { DEFAULT_THEME_SEED } from '../theme/seeds';
import type { Terminal, ViewId } from './config';
import { Icon } from './Icon';
import type { HeaderBuzzerState } from '../notifications/useHeaderBuzzer';

interface ShellProps {
  terminal: Terminal;
  title: string;
  view: ViewId;
  onViewChange: (view: ViewId) => void;
  navigation: readonly {
    id: ViewId;
    label: string;
    icon: 'weather' | 'warnings' | 'monitor' | 'training';
  }[];
  now: Date;
  connection: { failed: boolean; lastSuccessAt: Date | null };
  onStopBuzzer?: () => void;
  buzzer?: HeaderBuzzerState;
  children: ReactNode;
  toolbar?: ReactNode;
  notifications: ReactNode;
}
const dateFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const timeFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
export function AppShell({
  terminal,
  title,
  view,
  navigation,
  onViewChange,
  now,
  connection,
  onStopBuzzer,
  buzzer,
  children,
  toolbar,
  notifications,
}: ShellProps) {
  const mainRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (headerRef.current) applyMd3Theme(DEFAULT_THEME_SEED, false, headerRef.current);
  }, []);
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#view-content"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        本文へ移動
      </a>
      <header
        className="app-header"
        ref={headerRef}
        data-buzzer-category={buzzer?.category ?? undefined}
        onClick={onStopBuzzer}
        onKeyDown={(event) => {
          if (!onStopBuzzer || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          onStopBuzzer();
        }}
        role={onStopBuzzer ? 'button' : undefined}
        tabIndex={onStopBuzzer ? 0 : undefined}
        aria-label={onStopBuzzer ? 'アラーム停止' : undefined}
      >
        <h1>{title}</h1>
        <div className="header-state">
          {connection.failed && (
            <span className="connection-error">
              <svg
                className="connection-error-icon"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" fill="currentColor" />
                <rect x="11" y="6" width="2" height="8" rx="1" fill="var(--md-sys-color-error)" />
                <rect x="11" y="16" width="2" height="2" rx="1" fill="var(--md-sys-color-error)" />
              </svg>
              受信異常
              <span>
                ｜最終更新:{' '}
                {connection.lastSuccessAt
                  ? timeFormat.format(connection.lastSuccessAt)
                  : '通信成功なし'}
              </span>
            </span>
          )}
        </div>
        <div className="header-right">
          <time dateTime={now.toISOString()}>{dateFormat.format(now)}</time>
          <span className={`terminal-name terminal-${terminal.mode.toLowerCase()}`}>
            端末名: {terminal.name}
          </span>
        </div>
      </header>
      <nav className="nav-rail" aria-label="画面切替">
        {navigation.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onViewChange(item.id)}
            aria-current={view === item.id ? 'page' : undefined}
          >
            <span className="nav-icon">
              <Icon kind={item.icon} />
            </span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <main
        id="view-content"
        ref={mainRef}
        tabIndex={-1}
        className={`view-content ${view === 'weather' ? 'view-content-map' : ''} ${view === 'monitor' ? 'view-content-monitor' : ''}`}
      >
        {children}
      </main>
      {toolbar && (
        <div
          className={`view-toolbar ${view === 'monitor' ? 'view-toolbar-monitor' : ''}`}
          aria-label="画面操作"
        >
          {toolbar}
        </div>
      )}
      <section className="notification-area" aria-label="共通通知">
        {notifications}
      </section>
    </div>
  );
}
