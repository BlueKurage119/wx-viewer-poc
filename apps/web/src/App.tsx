import { useEffect, useState } from 'react';
import { FilledButton } from './components/md/Button';
import { AppShell } from './shell/AppShell';
import { resolveTerminal, resolveView, views, type Terminal, type ViewId } from './shell/config';
import { NotificationArea } from './shell/NotificationArea';
import { previewNotices, scenarios, type PreviewScenario } from './shell/fixtures';
import {
  confirmNotification as confirmNotificationState,
  createNotificationUiState,
  receiveNotifications,
} from './notifications/notificationStore';
import { useNotificationFeed } from './notifications/useNotificationFeed';
import { useHeaderBuzzer } from './notifications/useHeaderBuzzer';
import { operationGuideMessage } from './shell/notifications';
import { WeatherMapView } from './map/WeatherMapView';
import { MonitoringDashboard } from './monitoring/MonitoringDashboard';
import { MonitoringToolbar } from './monitoring/MonitoringToolbar';
import type { MonitoringLoadState } from './monitoring/useMonitoringStatus';

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
  return <TerminalApp key={terminal.id} terminal={terminal} />;
}
function TerminalApp({ terminal }: { terminal: Terminal }) {
  const [view, setView] = useState(() => resolveView(window.location.hash, terminal.mode));
  const [now, setNow] = useState(() => new Date());
  const preview =
    import.meta.env.DEV && new URLSearchParams(window.location.search).get('shellPreview') === '1';
  const [scenario, setScenario] = useState<PreviewScenario>('empty');
  const [previewState, setPreviewState] = useState(() => createNotificationUiState());
  const [monitoringState, setMonitoringState] = useState<MonitoringLoadState | null>(null);
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
  const buzzer = useHeaderBuzzer();
  const notificationFeed = useNotificationFeed({
    terminalId: terminal.id,
    mode: terminal.mode,
    enabled: !preview,
    onChimeRequest: buzzer.request,
  });
  const current = views.find((item) => item.id === view)!;
  const selectScenario = (next: PreviewScenario) => {
    setScenario(next);
    const initialState = createNotificationUiState();
    const receivedResult = receiveNotifications(initialState, previewNotices(next), terminal.mode);
    const received = receivedResult.state;
    if (receivedResult.chime) buzzer.request(receivedResult.chime);
    setPreviewState({
      ...received,
      operationMessage:
        next === 'result' ? '【表示サンプル】操作が完了しました。' : received.operationMessage,
    });
  };

  const isMonitoringFailed = view === 'monitor' && monitoringState?.phase === 'failed';
  const connection = isMonitoringFailed
    ? {
        failed: true,
        lastSuccessAt: monitoringState?.data ? new Date(monitoringState.data.generatedAt) : null,
      }
    : { failed: preview && scenario === 'connection', lastSuccessAt: null };
  const visibleNotificationState = preview ? previewState : notificationFeed.state;
  const notificationState = {
    ...visibleNotificationState,
    operationMessage: operationGuideMessage(
      visibleNotificationState.operationMessage,
      isMonitoringFailed,
      visibleNotificationState.phase === 'retrying',
    ),
  };
  const stopBuzzer = () => {
    if (buzzer.state.feedKey) notificationFeed.confirm(buzzer.state.feedKey);
    buzzer.stop();
  };
  const confirmNotification = (feedKey: string) => {
    if (preview) {
      setPreviewState((currentState) =>
        confirmNotificationState(currentState, feedKey, terminal.mode),
      );
    } else notificationFeed.confirm(feedKey);
    if (buzzer.state.feedKey === feedKey) buzzer.stop();
  };

  return (
    <AppShell
      terminal={terminal}
      title={current.title}
      view={view}
      navigation={views.filter((item) => item.modes.includes(terminal.mode))}
      now={now}
      connection={connection}
      buzzer={buzzer.state}
      onStopBuzzer={buzzer.state.category ? stopBuzzer : undefined}
      notifications={
        <NotificationArea
          state={notificationState}
          mode={terminal.mode}
          onConfirm={confirmNotification}
        />
      }
      toolbar={
        view === 'monitor' ? (
          <MonitoringToolbar />
        ) : preview ? (
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
              onClick={() =>
                setPreviewState((currentState) => ({
                  ...currentState,
                  operationMessage: '【表示サンプル】新しい操作結果で置き換えました。',
                }))
              }
            >
              操作結果を表示
            </FilledButton>
          </>
        ) : undefined
      }
    >
      {view === 'weather' ? (
        <WeatherMapView venue={terminal.venue} />
      ) : view === 'monitor' ? (
        <MonitoringDashboard terminalId={terminal.id} onLoadStateChange={setMonitoringState} />
      ) : (
        <div className="view-placeholder">
          <span className="placeholder-symbol" aria-hidden="true">
            {VIEW_PLACEHOLDER[view].symbol}
          </span>
          <h3>{VIEW_PLACEHOLDER[view].heading}</h3>
          <p>{VIEW_PLACEHOLDER[view].description}</p>
        </div>
      )}
    </AppShell>
  );
}
