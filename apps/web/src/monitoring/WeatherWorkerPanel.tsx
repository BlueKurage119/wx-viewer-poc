import {
  weatherWorkerLabel,
  weatherRestartResult,
  reasonLabels,
} from './weatherWorkerPresentation';
import { useEffect, useState } from 'react';
import type {
  MonitoringStatusResponse,
  WeatherWorkerOperationHistoryResponse,
} from '@wx-viewer-poc/shared';
import { GbButton, CircularProgress } from '../components/md';
import { createWeatherWorkerClient } from '../api/weatherWorkers';
import { formatJstDateTime } from './monitoringPresentation';
import type { WeatherRestartModel } from './useWeatherRestart';

const idleModel: WeatherRestartModel = {
  state: { phase: 'idle' },
  refreshVersion: 0,
  restart: () => undefined,
  recheck: () => undefined,
};
export function WeatherWorkerPanel({
  data,
  unavailable,
  model = idleModel,
}: {
  readonly data: MonitoringStatusResponse | null;
  readonly unavailable: boolean;
  readonly model?: WeatherRestartModel;
}) {
  const runtime = data?.weatherRuntimes.acquisition;
  const busy = model.state.phase === 'sending' || model.state.phase === 'checking';
  const canRestart =
    !unavailable &&
    !busy &&
    model.state.phase !== 'unverifiable' &&
    runtime?.mode === 'worker' &&
    runtime.workerGeneration !== null &&
    runtime.restartAllowed &&
    !['starting', 'stopping', 'restarting'].includes(runtime.lifecycle);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [beforeId, setBeforeId] = useState<number | null>(null);
  const [history, setHistory] = useState<WeatherWorkerOperationHistoryResponse | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  useEffect(() => {
    if (!historyOpen) return;
    const abort = new AbortController();
    let disposed = false;
    setHistoryLoading(true);
    setHistoryFailed(false);
    const timer = window.setTimeout(() => abort.abort(), 10_000);
    void createWeatherWorkerClient({ fetch: window.fetch.bind(window) })
      .history(beforeId, abort.signal)
      .then((result) => {
        if (!disposed) setHistory(result);
      })
      .catch(() => {
        if (!disposed) setHistoryFailed(true);
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (!disposed) setHistoryLoading(false);
      });
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [historyOpen, beforeId, model.refreshVersion]);
  const resultText =
    model.state.phase === 'completed'
      ? weatherRestartResult(model.state.operation, data)
      : busy
        ? '停止を確認中・再開中'
        : model.state.phase === 'unverifiable'
          ? '結果を確認できません'
          : model.state.phase === 'conflict'
            ? '状態が変わったため再開できません。最新の状態を確認してください'
            : model.state.phase === 'rejected'
              ? '再開要求を受け付けられませんでした'
              : '';
  return (
    <section className="monitoring-worker-section" aria-labelledby="monitoring-worker-heading">
      <h2 id="monitoring-worker-heading">取得Worker</h2>
      <dl className="monitoring-worker-status">
        <div>
          <dt>状態</dt>
          <dd>{weatherWorkerLabel(runtime)}</dd>
        </div>
        <div>
          <dt>最終報告</dt>
          <dd>{runtime?.receivedAt ? formatJstDateTime(runtime.receivedAt) : '—'}</dd>
        </div>
        <div>
          <dt>停止・異常理由</dt>
          <dd>
            {runtime?.failureCode
              ? reasonLabels[runtime.failureCode]
              : runtime?.stopReason
                ? reasonLabels[runtime.stopReason]
                : '—'}
          </dd>
        </div>
      </dl>
      {runtime?.unknownScopes?.length ? <p>結果不明: {runtime.unknownScopes.join('、')}</p> : null}
      <div className="monitoring-worker-actions">
        <GbButton
          color="filled"
          size="sm"
          softDisabled={!canRestart}
          onClick={() => {
            if (canRestart && runtime?.workerGeneration) model.restart(runtime.workerGeneration);
          }}
        >
          取得Workerを再開
        </GbButton>
        {busy ? <CircularProgress indeterminate aria-label="取得Workerを再開中" /> : null}
        {model.state.phase === 'unverifiable' ? (
          <GbButton color="tonal" size="sm" onClick={model.recheck}>
            結果を再確認
          </GbButton>
        ) : null}
      </div>
      <p className="monitoring-worker-result" aria-live="polite" role="status">
        {resultText}
      </p>
      <details onToggle={(event) => setHistoryOpen(event.currentTarget.open)}>
        <summary>再開履歴</summary>
        {historyLoading ? (
          <p role="status">再開履歴を読み込み中</p>
        ) : historyFailed ? (
          <p role="status">再開履歴を取得できません</p>
        ) : history ? (
          <>
            {history.items.length === 0 ? (
              <p>再開履歴はありません</p>
            ) : (
              <ul className="monitoring-worker-history">
                {history.items.map((item) => (
                  <li key={item.id}>
                    <time dateTime={item.requestedAt}>{formatJstDateTime(item.requestedAt)}</time>
                    <span>{weatherRestartResult(item.operation)}</span>
                    <span>世代 {item.expectedWorkerGeneration}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="monitoring-worker-actions">
              {beforeId !== null ? (
                <GbButton color="tonal" size="sm" onClick={() => setBeforeId(null)}>
                  最新の履歴
                </GbButton>
              ) : null}
              {history.nextBeforeId !== null ? (
                <GbButton color="tonal" size="sm" onClick={() => setBeforeId(history.nextBeforeId)}>
                  以前の履歴
                </GbButton>
              ) : null}
            </div>
          </>
        ) : null}
      </details>
    </section>
  );
}
