import {
  WEATHER_REPORT_STALE_AFTER_MS,
  WEATHER_RUNTIME_REASON_LABELS,
  type MonitoringStatusResponse,
  type WeatherRestartOperation,
  type WeatherRole,
} from '@wx-viewer-poc/shared';
import type { WeatherRestartState } from './weatherRestartController';

/** 集計鮮度の判定に使う閾値。サーバーの報告鮮度（15秒）と同じ値。 */
export const SAMPLE_STALE_AFTER_MS = WEATHER_REPORT_STALE_AFTER_MS;

export type RestartResultStage =
  'none' | 'accepted' | 'preparing' | 'completed' | 'failed' | 'conflict' | 'unknown';

export interface RestartResult {
  readonly stage: RestartResultStage;
  /** Workerカードの結果行。結果がなければ null。 */
  readonly cardText: string | null;
  /** 通知領域最下段の行（選択中を除く）。結果がなければ null。 */
  readonly rowText: string | null;
}

const NONE: RestartResult = { stage: 'none', cardText: null, rowText: null };

const roleLabel: Record<WeatherRole, string> = { acquisition: '取得', delivery: '提供' };

const errorCodeLabels: Readonly<Record<string, string>> = {
  ...WEATHER_RUNTIME_REASON_LABELS,
  restart_not_allowed: 'サーバーが許可していません',
  exit_unconfirmed: '終了を確認できません',
};

export function restartReasonLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return errorCodeLabels[code] ?? null;
}

/** 受付後の接続失敗（同じ世代が failed）の理由。 */
function failedReason(runtime: { failureCode: string | null; stopReason: string | null }) {
  return restartReasonLabel(runtime.failureCode ?? runtime.stopReason);
}

/**
 * 受付後の完了判定。サーバーの再起動完了通知と同じ定義で書く。
 * 取得: 自動取得が有効なら初回同期完了、停止のままなら準備完了(prepared)。
 * 提供: 世代一致・ready・再起動後に作られた集計（基準時刻より後で、鮮度15秒以内）の受領。
 */
export function isRestartCompleted(
  role: WeatherRole,
  operation: Extract<WeatherRestartOperation, { status: 'completed' }>,
  data: MonitoringStatusResponse,
  baselineGeneratedAt: string | null,
): boolean {
  const runtime = data.weatherRuntimes[role];
  if (
    operation.workerGeneration === null ||
    runtime.workerGeneration !== operation.workerGeneration
  )
    return false;
  if (runtime.lifecycle === 'failed') return false;
  if (role === 'acquisition') {
    return operation.desiredRunning === false
      ? runtime.prepared === true
      : data.readiness.initialFetchPhase === 'completed';
  }
  const sampleAt = data.weatherSampleReceivedAt;
  if (runtime.lifecycle !== 'ready' || !sampleAt || baselineGeneratedAt === null) return false;
  const sample = Date.parse(sampleAt);
  const generated = Date.parse(data.generatedAt);
  return sample > Date.parse(baselineGeneratedAt) && generated - sample <= SAMPLE_STALE_AFTER_MS;
}

/** 再起動の経過（restart 状態と監視の現在状態の合成）。ボタン押下だけで成功にしない。 */
export function composeRestartResult(
  role: WeatherRole,
  restart: WeatherRestartState,
  data: MonitoringStatusResponse | null,
  baselineGeneratedAt: string | null,
): RestartResult {
  const label = roleLabel[role];
  switch (restart.phase) {
    case 'idle':
      return NONE;
    case 'sending':
    case 'checking':
      return {
        stage: 'accepted',
        cardText: '再起動を確認中',
        rowText: `${label}再起動: 受付済み`,
      };
    case 'unverifiable':
      return {
        stage: 'unknown',
        cardText: '再起動結果不明',
        rowText: `${label}再起動: 結果不明`,
      };
    case 'conflict':
      return {
        stage: 'conflict',
        cardText: '状態が変わったため再起動せず',
        rowText: `${label}再起動: 実行できません`,
      };
    case 'rejected':
      return {
        stage: 'failed',
        cardText: '再起動要求を受付不可',
        rowText: `${label}再起動が失敗しました`,
      };
    case 'completed':
      break;
  }
  const operation = restart.operation;
  if (operation.status !== 'completed') return NONE;
  const suffix = operation.historyRecorded ? '' : '・履歴未記録';
  if (operation.result === 'unknown') {
    return {
      stage: 'unknown',
      cardText: `再起動結果不明${suffix}`,
      rowText: `${label}再起動: 結果不明${suffix}`,
    };
  }
  if (operation.result === 'failure') {
    const reason = restartReasonLabel(operation.errorCode);
    return {
      stage: 'failed',
      cardText: `再起動失敗${reason ? `（${reason}）` : ''}${suffix}`,
      rowText: `${label}再起動が失敗しました${suffix}`,
    };
  }
  const runtime = data?.weatherRuntimes[role];
  const sameGeneration =
    runtime !== undefined &&
    operation.workerGeneration !== null &&
    runtime.workerGeneration === operation.workerGeneration;
  if (!data || !runtime || operation.workerGeneration === null) {
    return {
      stage: 'preparing',
      cardText: `起動済み${suffix}`,
      rowText: `${label}再起動: 準備中${suffix}`,
    };
  }
  if (!sameGeneration) {
    return {
      stage: 'preparing',
      cardText: `起動済み${suffix}`,
      rowText: `${label}再起動: 準備中${suffix}`,
    };
  }
  if (runtime.lifecycle === 'failed') {
    const reason = failedReason(runtime);
    return {
      stage: 'failed',
      cardText: `起動済み・接続に失敗${reason ? `（${reason}）` : ''}${suffix}`,
      rowText: `${label}再起動が失敗しました${suffix}`,
    };
  }
  if (isRestartCompleted(role, operation, data, baselineGeneratedAt)) {
    const card =
      role === 'delivery'
        ? '起動済み・提供中'
        : operation.desiredRunning === false
          ? '起動済み・自動取得は停止のまま'
          : '起動済み・準備完了';
    return {
      stage: 'completed',
      cardText: `${card}${suffix}`,
      rowText: `${label}再起動が完了しました${suffix}`,
    };
  }
  const preparing =
    role === 'delivery'
      ? '起動済み・提供準備中'
      : data.readiness.initialFetchPhase === 'failed' ||
          data.readiness.preparationFailures.length > 0
        ? '起動済み・気象準備に失敗'
        : '起動済み・気象準備中';
  return {
    stage: 'preparing',
    cardText: `${preparing}${suffix}`,
    rowText: `${label}再起動: 準備中${suffix}`,
  };
}

/** 履歴1件の結果。現在の監視状態とは合成せず、記録された結果だけを示す。 */
export function workerHistoryResult(operation: WeatherRestartOperation): string {
  if (operation.status === 'in_progress') return '再起動中';
  if (operation.result === 'unknown') return '再起動結果不明';
  if (operation.result === 'failure') return '再起動失敗';
  return '起動済み';
}
