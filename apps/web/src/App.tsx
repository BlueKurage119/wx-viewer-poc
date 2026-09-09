import { useEffect, useState } from 'react';
import { FilledButton } from './components/md';
import { AppShell } from './shell/AppShell';
import { resolveTerminal, resolveView, views, type Terminal, type ViewId } from './shell/config';
import { NotificationArea } from './shell/NotificationArea';
import { visibleNotices } from './shell/notifications';
import { previewNotices, scenarios, type PreviewScenario } from './shell/fixtures';

const VIEW_PLACEHOLDER: Record<ViewId, { symbol: string; heading: string; description: string }> = {
  weather: {
    symbol: '☁',
    heading: '気象情報の表示領域',
    description: '地図・情報パネルは今後実装します。',
  },
  warnings: {
    symbol: '≡',
    heading: '警報一覧の表示領域',
    description: '一覧・フィルターは今後実装します。',
  },
  monitor: {
    symbol: '▤',
    heading: '取得監視の表示領域',
    description: '取得状況・履歴・取得操作は今後実装します。',
  },
  training: {
    symbol: '◎',
    heading: '訓練通知の表示領域',
    description: 'サンプル電文の注入・抹消操作は今後実装します。',
  },
};

export function App() {
  const terminal = resolveTerminal(window.location.pathname);
  if (!terminal)
    return (
      <main className="entry-message">
        <h1>
          {window.location.pathname === '/'
            ? '端末が指定されていません'
            : '許可されていない端末です'}
        </h1>
        <p>指定された端末URLでアクセスしてください。</p>
      </main>
    );
  return <TerminalApp terminal={terminal} />;
}
function TerminalApp({ terminal }: { terminal: Terminal }) {
  const [view, setView] = useState(() => resolveView(window.location.hash, terminal.mode));
  const [now, setNow] = useState(() => new Date());
  const preview =
    import.meta.env.DEV && new URLSearchParams(window.location.search).get('shellPreview') === '1';
  const [scenario, setScenario] = useState<PreviewScenario>('empty');
  const [notices, setNotices] = useState(() => previewNotices('empty'));
  const [operation, setOperation] = useState('左のメニューから表示する画面を選択してください。');
  useEffect(() => {
    const syncView = () => {
      // 本文へのスキップリンクはビュー状態として扱わない。
      if (window.location.hash === '#view-content') return;
      const next = resolveView(window.location.hash, terminal.mode);
      setView(next);
      const canonical = `/${terminal.id}${window.location.search}#${next}`;
      if (
        `${window.location.pathname}${window.location.search}${window.location.hash}` !== canonical
      )
        window.history.replaceState(null, '', canonical);
    };
    syncView();
    window.addEventListener('hashchange', syncView);
    return () => window.removeEventListener('hashchange', syncView);
  }, [terminal]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const current = views.find((item) => item.id === view)!;
  const displayed = visibleNotices(notices, terminal.mode);
  const selectScenario = (next: PreviewScenario) => {
    setScenario(next);
    setNotices(previewNotices(next));
    setOperation(
      next === 'result'
        ? '【表示サンプル】操作が完了しました。'
        : '左のメニューから表示する画面を選択してください。',
    );
  };
  return (
    <AppShell
      terminal={terminal}
      title={current.title}
      view={view}
      navigation={views.filter((item) => item.modes.includes(terminal.mode))}
      now={now}
      connection={{ failed: preview && scenario === 'connection', lastSuccessAt: null }}
      notifications={<NotificationArea notices={displayed} operation={operation} />}
      toolbar={
        preview ? (
          <>
            <span className="preview-label">表示確認用</span>
            <label>
              通知の状態{' '}
              <select
                value={scenario}
                onChange={(event) => selectScenario(event.target.value as PreviewScenario)}
              >
                {scenarios.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <FilledButton
              onClick={() => setOperation('【表示サンプル】新しい操作結果で置き換えました。')}
            >
              操作結果を表示
            </FilledButton>
          </>
        ) : undefined
      }
    >
      <div className="view-placeholder">
        <span className="placeholder-symbol" aria-hidden="true">
          {VIEW_PLACEHOLDER[view].symbol}
        </span>
        <h3>{VIEW_PLACEHOLDER[view].heading}</h3>
        <p>{VIEW_PLACEHOLDER[view].description}</p>
        {view === 'weather' && (
          <dl>
            <div>
              <dt>対象市区町村</dt>
              <dd>{terminal.venue.weatherTargets.warning.displayName}</dd>
            </div>
            <div>
              <dt>アメダス</dt>
              <dd>{terminal.venue.weatherTargets.amedas.displayName}</dd>
            </div>
          </dl>
        )}
      </div>
    </AppShell>
  );
}
