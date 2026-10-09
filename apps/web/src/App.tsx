import { useWeatherRestart } from './monitoring/useWeatherRestart';
import type { WeatherDangerLevel } from './weather/weatherDangerModel';
import { useWeatherDangerData } from './weather/useWeatherDangerData';
import { useEffect, useState } from 'react';
import { FilledButton } from './components/md/Button';
import { AppShell } from './shell/AppShell';
import {
  createTerminals,
  resolveTerminal,
  views,
  type Terminal,
  type ViewId,
} from './shell/config';
import { NotificationArea } from './shell/NotificationArea';
import { previewNotices, scenarios, type PreviewScenario } from './shell/fixtures';
import {
  confirmNotification as confirmNotificationState,
  createNotificationUiState,
  expireWarningHistory,
  nextUnconfirmedChime,
  receiveNotifications,
  selectQuestionConfirmation,
} from './notifications/notificationStore';
import { useNotificationFeed } from './notifications/useNotificationFeed';
import { useHeaderBuzzer } from './notifications/useHeaderBuzzer';
import { operationGuideMessage } from './shell/notifications';
import { WeatherMapView } from './map/WeatherMapView';
import type { MapLayerId } from './map/types';
import { MonitoringDashboard } from './monitoring/MonitoringDashboard';
import { MonitoringDialogHost } from './monitoring/MonitoringDialogHost';
import { MonitoringToolbar } from './monitoring/MonitoringToolbar';
import {
  fetchOperationText,
  restartChangeToken,
  selectOperationLine,
} from './monitoring/monitoringOperationMessage';
import { presentWorker, workerRestartabilityId } from './monitoring/weatherWorkerPresentation';
import {
  useChangeSequence,
  useRestartBaselines,
  useRestartCompletions,
} from './monitoring/useRestartCompletion';
import { WorkerRestartHistoryContent } from './monitoring/WorkerRestartHistoryDialog';
import type { WeatherRole } from '@wx-viewer-poc/shared';
import { restartRequestId } from './monitoring/weatherRestartResult';
import { useMonitoringToolbar } from './monitoring/useMonitoringToolbar';
import type { MonitoringLoadState } from './monitoring/useMonitoringStatus';
import { useVenueRegistry } from './venueRegistryContext';
import { useTerminalRegistry } from './terminalRegistryContext';
import { WarningListView } from './warnings/WarningListView';
import { createWarningListSearchState } from './warnings/warningListFilterModel';
import './warnings/warningList.css';

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
  const terminals = createTerminals(useVenueRegistry(), useTerminalRegistry());
  const terminal = resolveTerminal(window.location.pathname, terminals);
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
  const [view, setView] = useState<ViewId>('weather');
  const [now, setNow] = useState(() => new Date());
  const preview =
    import.meta.env.DEV && new URLSearchParams(window.location.search).get('shellPreview') === '1';
  const [scenario, setScenario] = useState<PreviewScenario>('empty');
  const [previewState, setPreviewState] = useState(() => createNotificationUiState());
  const [warningSearch, setWarningSearch] = useState(createWarningListSearchState);
  const [monitoringState, setMonitoringState] = useState<MonitoringLoadState | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<MapLayerId>('nowcast');
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (preview) setPreviewState((state) => expireWarningHistory(state, now.getTime()));
  }, [now, preview]);
  const weatherDanger = useWeatherDangerData({
    terminalId: terminal.id,
    controlStatus: 'normal',
    nowMs: now.getTime(),
  });
  // 開発時の視認性確認専用。通常の気象データ取得・パネルには影響しない。
  const dangerPreview = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get('navDangerFixture')
    : null;
  const previewDangerLevel =
    dangerPreview === 'none'
      ? null
      : dangerPreview && /^[1-5]$/.test(dangerPreview)
        ? (Number(dangerPreview) as WeatherDangerLevel)
        : weatherDanger.level;
  const buzzer = useHeaderBuzzer();
  const notificationFeed = useNotificationFeed({
    terminalId: terminal.id,
    mode: terminal.mode,
    enabled: !preview,
    onChimeRequest: buzzer.request,
    nowMs: now.getTime(),
  });
  const workerRestart = useWeatherRestart();
  const deliveryRestart = useWeatherRestart('delivery');
  const restartModels = { acquisition: workerRestart, delivery: deliveryRestart };
  const restartBaselines = useRestartBaselines(
    { acquisition: workerRestart.state, delivery: deliveryRestart.state },
    monitoringState?.data ?? null,
  );
  const restartCompletions = useRestartCompletions(
    { acquisition: workerRestart.state, delivery: deliveryRestart.state },
    monitoringState?.data ?? null,
    restartBaselines,
  );
  const workerViews = Object.fromEntries(
    (['acquisition', 'delivery'] as const).map((role) => [
      role,
      presentWorker(role, {
        data: monitoringState?.data ?? null,
        monitoringFailed: monitoringState?.phase === 'failed' || !monitoringState?.data,
        restart: restartModels[role].state,
        baselineGeneratedAt: restartBaselines[role],
        completedRequestId: restartCompletions[role],
      }),
    ]),
  ) as Record<WeatherRole, ReturnType<typeof presentWorker>>;
  const monitoringToolbar = useMonitoringToolbar({
    active: view === 'monitor',
    submitWorkerRestart: (role) => {
      // 選択後に状態が変わっていた場合は送らない。世代はサーバー投影値だけを使う。
      const generation = monitoringState?.data?.weatherRuntimes[role].workerGeneration;
      if (!workerViews[role].canRestart || !generation) return;
      restartModels[role].restart(generation);
    },
  });
  const current = views.find((item) => item.id === view)!;
  const selectScenario = (next: PreviewScenario) => {
    setScenario(next);
    const initialState = createNotificationUiState();
    const receivedResult = receiveNotifications(
      initialState,
      previewNotices(next),
      terminal.mode,
      Date.now(),
    );
    const received = receivedResult.state;
    if (receivedResult.chime) buzzer.request(receivedResult.chime);
    setPreviewState({
      ...received,
      phase: 'ready',
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
  const fetchText = fetchOperationText(monitoringToolbar.operationState);
  const acquisitionRow = workerViews.acquisition.result.rowText;
  const deliveryRow = workerViews.delivery.result.rowText;
  const changedSeq = useChangeSequence({
    fetch: fetchText,
    acquisition: restartChangeToken(
      workerViews.acquisition.result.stage,
      restartRequestId(workerRestart.state),
      acquisitionRow,
    ),
    delivery: restartChangeToken(
      workerViews.delivery.result.stage,
      restartRequestId(deliveryRestart.state),
      deliveryRow,
    ),
  });
  const restartInProgress = (role: WeatherRole) =>
    ['accepted', 'preparing'].includes(workerViews[role].result.stage);
  const operationLine = selectOperationLine(monitoringToolbar.localState, [
    { text: fetchText, changedSeq: changedSeq('fetch') },
    {
      text: acquisitionRow,
      changedSeq: changedSeq('acquisition'),
      active: restartInProgress('acquisition'),
    },
    {
      text: deliveryRow,
      changedSeq: changedSeq('delivery'),
      active: restartInProgress('delivery'),
    },
  ]);
  const operationMessage = operationLine?.text ?? null;
  const notificationState = {
    ...visibleNotificationState,
    operationMessage: operationGuideMessage(
      visibleNotificationState.operationMessage,
      isMonitoringFailed,
      visibleNotificationState.phase === 'retrying',
      operationMessage,
    ),
  };
  const confirmNotification = (feedKey: string) => {
    const nextState = confirmNotificationState(visibleNotificationState, feedKey, terminal.mode);
    if (preview) {
      setPreviewState(nextState);
    } else notificationFeed.confirm(feedKey);
    if (buzzer.state.feedKey === feedKey) {
      buzzer.stop();
      const nextChime = nextUnconfirmedChime(nextState, terminal.mode);
      if (nextChime) buzzer.request(nextChime);
    }
  };
  const selectQuestion = (feedKey: string) => {
    if (preview) {
      setPreviewState((currentState) => selectQuestionConfirmation(currentState, feedKey));
    } else notificationFeed.selectQuestionConfirmation(feedKey);
  };
  const stopBuzzer = () => {
    buzzer.stop();
  };

  return (
    <AppShell
      weatherDangerLevel={previewDangerLevel}
      terminal={terminal}
      title={current.title}
      view={view}
      onViewChange={setView}
      navigation={views.filter((item) => item.modes.includes(terminal.mode))}
      now={now}
      connection={connection}
      buzzer={buzzer.state}
      onStopBuzzer={buzzer.state.category ? stopBuzzer : undefined}
      notifications={
        <NotificationArea
          state={notificationState}
          mode={terminal.mode}
          operationTitle={operationLine?.title}
          onSelectQuestionConfirmation={selectQuestion}
          onConfirm={confirmNotification}
        />
      }
      toolbar={
        view === 'monitor' ? (
          <MonitoringToolbar
            model={monitoringToolbar}
            workerRestart={{
              acquisition: {
                canRestart: workerViews.acquisition.canRestart,
                describedBy: workerRestartabilityId('acquisition'),
              },
              delivery: {
                canRestart: workerViews.delivery.canRestart,
                describedBy: workerRestartabilityId('delivery'),
              },
            }}
          />
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
        <WeatherMapView
          dangerPanelData={weatherDanger.panels}
          venue={terminal.venue}
          terminalId={terminal.id}
          selectedLayerId={selectedLayerId}
          onLayerSelect={setSelectedLayerId}
        />
      ) : view === 'warnings' ? (
        <WarningListView
          entries={visibleNotificationState.warningHistory}
          mode={terminal.mode}
          nowMs={now.getTime()}
          phase={visibleNotificationState.phase}
          search={warningSearch}
          onSearchChange={setWarningSearch}
        />
      ) : view === 'monitor' ? (
        <MonitoringDashboard
          terminalId={terminal.id}
          onLoadStateChange={setMonitoringState}
          workerModel={workerRestart}
          deliveryModel={deliveryRestart}
          restartBaselines={restartBaselines}
          restartCompletions={restartCompletions}
        />
      ) : (
        <div className="view-placeholder">
          <span className="placeholder-symbol" aria-hidden="true">
            {VIEW_PLACEHOLDER[view].symbol}
          </span>
          <h3>{VIEW_PLACEHOLDER[view].heading}</h3>
          <p>{VIEW_PLACEHOLDER[view].description}</p>
        </div>
      )}
      <MonitoringDialogHost
        dialogId={monitoringToolbar.localState.openDialog}
        onClose={monitoringToolbar.closeDialog}
        renderContent={({ dialogId }) =>
          dialogId === 'workerRestartHistory' ? (
            <WorkerRestartHistoryContent data={monitoringState?.data ?? null} />
          ) : undefined
        }
      />
    </AppShell>
  );
}
