import { useWeatherRestart } from './monitoring/useWeatherRestart';
import type { WeatherDangerLevel } from './weather/weatherDangerModel';
import { resolvePanelControlStatus, useWeatherDangerData } from './weather/useWeatherDangerData';
import { useCallback, useEffect, useState } from 'react';
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
  isVisibleForTerminal,
  notificationChimeLevel,
  type NotificationUiState,
  receiveNotifications,
  selectQuestionConfirmation,
} from './notifications/notificationStore';
import { useNotificationFeed } from './notifications/useNotificationFeed';
import {
  advanceAutoConfirmation,
  nextAutoConfirmationDeadline,
} from './notifications/autoConfirmation';
import { createNotificationPreferencesRepository } from './notifications/notificationPreferences';
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
import { TrainingView } from './training/TrainingView';
import { TrainingToolbar } from './training/TrainingToolbar';
import { useTrainingScreen } from './training/useTrainingScreen';
import { createWarningListSearchState } from './warnings/warningListFilterModel';
import './warnings/warningList.css';
import './training/training.css';

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
  const [preferencesRepository] = useState(createNotificationPreferencesRepository);
  const [notificationPreferences, setNotificationPreferences] = useState(() =>
    preferencesRepository.load(),
  );
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
  // ?controlStatus=training（K端末のみ）で6パネルを訓練の読み出しに切り替える。ナビの危険度バッジ・地図レイヤーは normal 固定。
  const panelControlStatus = resolvePanelControlStatus(window.location.search, terminal.mode);
  const trainingPanelDanger = useWeatherDangerData({
    terminalId: terminal.id,
    controlStatus: panelControlStatus,
    nowMs: now.getTime(),
    enabled: panelControlStatus !== 'normal',
  });
  const dangerPanels =
    panelControlStatus === 'normal' ? weatherDanger.panels : trainingPanelDanger.panels;
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
  const training = useTrainingScreen(
    terminal.id,
    view === 'training' && terminal.mode === 'K',
    terminal.venue.id,
  );
  const buzzer = useHeaderBuzzer();
  const { confirmLevel } = buzzer;
  const onConfirmed = useCallback(
    (state: NotificationUiState, feedKeys: readonly string[]) => {
      for (const feedKey of feedKeys) {
        const item = state.items.find((item) => item.feedKey === feedKey);
        if (item && isVisibleForTerminal(item, terminal.mode))
          confirmLevel(notificationChimeLevel(state, item));
      }
    },
    [confirmLevel, terminal.mode],
  );
  const notificationFeed = useNotificationFeed({
    terminalId: terminal.id,
    mode: terminal.mode,
    enabled: !preview,
    onChimeRequest: buzzer.request,
    onConfirmed,
    preferences: notificationPreferences,
    nowMs: now.getTime(),
  });
  useEffect(() => {
    if (!preview) return;
    const advance = () => {
      const result = advanceAutoConfirmation(previewState, terminal.mode, Date.now());
      if (result.state !== previewState) {
        setPreviewState(result.state);
        onConfirmed(result.state, result.automaticallyConfirmedFeedKeys);
      }
    };
    const deadline = nextAutoConfirmationDeadline(previewState);
    const timer =
      deadline === null ? null : window.setTimeout(advance, Math.max(0, deadline - Date.now()));
    document.addEventListener('visibilitychange', advance);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', advance);
    };
  }, [preview, previewState, terminal.mode, onConfirmed]);
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
      notificationPreferences,
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
  const monitoringOperationLine = selectOperationLine(monitoringToolbar.localState, [
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
  // 訓練画面では、訓練ツールバーの選択案内・削除結果を操作行に出す。
  const operationLine = view === 'training' ? training.operationLine : monitoringOperationLine;
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
    if (!preview) {
      notificationFeed.confirm(feedKey);
      return;
    }
    const advanced = advanceAutoConfirmation(previewState, terminal.mode, Date.now());
    onConfirmed(advanced.state, advanced.automaticallyConfirmedFeedKeys);
    const nextState = confirmNotificationState(advanced.state, feedKey, terminal.mode);
    if (nextState !== advanced.state) onConfirmed(nextState, [feedKey]);
    setPreviewState(nextState);
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
        ) : view === 'training' ? (
          <TrainingToolbar model={training.toolbar} />
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
          dangerPanelData={dangerPanels}
          panelControlStatus={panelControlStatus}
          venue={terminal.venue}
          terminalId={terminal.id}
          selectedLayerId={selectedLayerId}
          onLayerSelect={setSelectedLayerId}
        />
      ) : view === 'warnings' ? (
        <WarningListView
          notificationPreferences={notificationPreferences}
          onSaveNotificationPreferences={(next) => {
            if (!preferencesRepository.save(next).saved) return false;
            setNotificationPreferences(next);
            return true;
          }}
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
        <TrainingView state={training.state} actions={training.actions} />
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
