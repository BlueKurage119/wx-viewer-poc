import { useEffect, useState } from 'react';
import type {
  MonitoringStatusResponse,
  WeatherRole,
  WeatherWorkerOperationHistoryResponse,
} from '@wx-viewer-poc/shared';
import { createWeatherWorkerClient } from '../api/weatherWorkers';
import { GbButton } from '../components/md';
import { formatJstDateTime } from './monitoringPresentation';
import { presentWorker } from './weatherWorkerPresentation';
import { restartReasonLabel, workerHistoryResult } from './weatherRestartResult';

const roles: readonly WeatherRole[] = ['acquisition', 'delivery'];
const roleNames: Record<WeatherRole, string> = { acquisition: '取得', delivery: '提供' };
const REQUEST_TIMEOUT_MS = 10_000;

/** 再起動履歴ダイアログの本文。現在の状態、結果不明scope、履歴一覧を示す。 */
export function WorkerRestartHistoryContent({
  data,
}: {
  readonly data: MonitoringStatusResponse | null;
}) {
  const [beforeId, setBeforeId] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [history, setHistory] = useState<WeatherWorkerOperationHistoryResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const abort = new AbortController();
    let disposed = false;
    setLoading(true);
    setFailed(false);
    const timer = window.setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
    void createWeatherWorkerClient({ fetch: window.fetch.bind(window) })
      .history(beforeId, abort.signal)
      .then((result) => {
        if (!disposed) setHistory(result);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [beforeId, attempt]);

  return (
    <div className="monitoring-worker-history-dialog">
      <section aria-label="現在の状態">
        {roles.map((role) => {
          const view = presentWorker(role, {
            data,
            monitoringFailed: data === null,
            restart: { phase: 'idle' },
            baselineGeneratedAt: null,
          });
          const scopes = data?.weatherRuntimes[role].unknownScopes ?? [];
          return (
            <p key={role}>
              {view.title}: {view.state}
              {scopes.length > 0 ? `／結果不明 ${scopes.length}件（${scopes.join('、')}）` : ''}
            </p>
          );
        })}
      </section>
      {loading ? (
        <p role="status">Worker履歴を読み込み中</p>
      ) : failed ? (
        <div role="alert">
          <p>Worker履歴を取得できません</p>
          <GbButton color="tonal" size="sm" onClick={() => setAttempt((value) => value + 1)}>
            再試行
          </GbButton>
        </div>
      ) : history ? (
        <>
          {history.items.length === 0 ? (
            <p>Worker履歴はありません</p>
          ) : (
            <div className="monitoring-worker-history-scroll">
              <table className="monitoring-worker-history-table">
                <thead>
                  <tr>
                    <th scope="col">要求時刻</th>
                    <th scope="col">対象</th>
                    <th scope="col">結果</th>
                    <th scope="col">完了時刻</th>
                    <th scope="col">理由</th>
                    <th scope="col">要求ID</th>
                  </tr>
                </thead>
                <tbody>
                  {history.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <time dateTime={item.requestedAt}>
                          {formatJstDateTime(item.requestedAt)}
                        </time>
                      </td>
                      <td>{roleNames[item.operation.role]}</td>
                      <td>{workerHistoryResult(item.operation)}</td>
                      <td>
                        {item.completedAt ? (
                          <time dateTime={item.completedAt}>
                            {formatJstDateTime(item.completedAt)}
                          </time>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {item.operation.status === 'completed'
                          ? (restartReasonLabel(item.operation.errorCode) ?? '—')
                          : '—'}
                      </td>
                      <td
                        title={`${item.operation.requestId}／世代 ${item.expectedWorkerGeneration}`}
                      >
                        {item.operation.requestId.slice(0, 8)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="monitoring-worker-history-actions">
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
    </div>
  );
}
