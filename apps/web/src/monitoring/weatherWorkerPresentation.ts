import type {
  WeatherRuntimeStatus,
  MonitoringStatusResponse,
  WeatherRestartOperation,
} from '@wx-viewer-poc/shared';

const lifecycleLabels: Record<WeatherRuntimeStatus['lifecycle'], string> = {
  starting: '準備中',
  ready: '稼働中',
  stopping: '停止を確認中',
  stopped: 'Worker停止',
  failed: 'Worker異常',
  restarting: '停止を確認中・再開中',
};
export const reasonLabels = {
  requested: '停止要求',
  unexpected_exit: '予期しない終了',
  initialization_failed: '初期化失敗',
  initial_accept_timeout: '初回受付を確認できません',
  handshake_timeout: '更新応答の期限超過',
  protocol_error: '通信手順の異常',
  payload_too_large: '通信容量の上限超過',
};
export function weatherWorkerLabel(runtime: WeatherRuntimeStatus | undefined): string {
  if (!runtime) return '状態不明';
  if (
    runtime.lifecycle === 'failed' ||
    runtime.lifecycle === 'stopped' ||
    runtime.lifecycle === 'stopping' ||
    runtime.lifecycle === 'restarting'
  )
    return lifecycleLabels[runtime.lifecycle];
  if (runtime.reportFreshness === 'stale') return '応答を確認できません';
  if (runtime.reportFreshness === 'unknown') return '報告待ち';
  return lifecycleLabels[runtime.lifecycle];
}
export function weatherRestartResult(
  operation: WeatherRestartOperation,
  data?: MonitoringStatusResponse | null,
): string {
  const suffix = operation.historyRecorded ? '' : '（履歴未記録）';
  if (operation.status === 'in_progress') return `停止を確認中・再開中${suffix}`;
  if (operation.result === 'unknown') return `再開結果は不明です${suffix}`;
  if (operation.result === 'failure') return `取得Workerを再開できませんでした${suffix}`;
  if (operation.desiredRunning === false)
    return `取得Workerを再開しました。取得は停止したままです${suffix}`;
  if (!data) return `取得Workerを再開しました${suffix}`;
  if (
    data.readiness.initialFetchPhase === 'failed' ||
    data.readiness.preparationFailures.length > 0
  )
    return `取得Workerを再開しました。気象情報の準備に失敗しています${suffix}`;
  if (data.readiness.initialFetchPhase !== 'completed')
    return `取得Workerを再開しました。気象情報は準備中です${suffix}`;
  return `取得Workerを再開しました${suffix}`;
}
