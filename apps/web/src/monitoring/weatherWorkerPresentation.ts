import {
  WEATHER_RUNTIME_REASON_LABELS,
  type WeatherRole,
  type WeatherRuntimeStatus,
  type MonitoringStatusResponse,
  type WeatherRestartOperation,
} from '@wx-viewer-poc/shared';
import { formatJstClock } from './monitoringTimeFormat';
import {
  composeRestartResult,
  SAMPLE_STALE_AFTER_MS,
  type RestartResult,
} from './weatherRestartResult';
import type { WeatherRestartState } from './weatherRestartController';

/** 停止・異常の理由の語（通知内容と同じ語）。 */
export const reasonLabels = WEATHER_RUNTIME_REASON_LABELS;

/** Workerカードの再開可否を、再起動ボタンの説明として参照する要素のID。 */
export function workerRestartabilityId(role: WeatherRole): string {
  return `monitoring-worker-${role}-restartability`;
}

export type WorkerTone = 'neutral' | 'normal' | 'attention' | 'error';

export interface WorkerDetailLine {
  readonly text: string;
  readonly kind: 'report' | 'sample' | 'restartability' | 'restart-result' | 'reason' | 'unknown';
}

export interface WorkerView {
  readonly role: WeatherRole;
  readonly title: string;
  readonly state: string;
  readonly tone: WorkerTone;
  /** 再起動ボタンを押せるか。サーバー投影値 restartAllowed を唯一の根拠とする。 */
  readonly canRestart: boolean;
  /** カードの再開可否の文言（ボタンの説明に使う）。 */
  readonly restartability: string;
  /** 詳細行（最大3行）。 */
  readonly lines: readonly WorkerDetailLine[];
  readonly result: RestartResult;
}

export interface WorkerPresentInput {
  readonly data: MonitoringStatusResponse | null;
  /** 監視取得が失敗中か。 */
  readonly monitoringFailed: boolean;
  readonly restart: WeatherRestartState;
  /** 提供の完了判定に使う、再起動完了受領後に最初に得た監視応答の generatedAt。 */
  readonly baselineGeneratedAt: string | null;
}

const roleTitle: Record<WeatherRole, string> = {
  acquisition: '取得Worker',
  delivery: '提供Worker',
};

function elapsedText(from: string, to: string): string {
  const seconds = Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / 1000));
  return seconds < 60 ? `${seconds}秒前` : `${Math.floor(seconds / 60)}分前`;
}

function reportLine(runtime: WeatherRuntimeStatus, generatedAt: string): string {
  return runtime.receivedAt
    ? `最終報告 ${formatJstClock(runtime.receivedAt)}（${elapsedText(runtime.receivedAt, generatedAt)}）`
    : '最終報告 —';
}

function sampleLine(data: MonitoringStatusResponse): string {
  const at = data.weatherSampleReceivedAt ?? null;
  if (at === null) return '集計 未受領';
  const stale = Date.parse(data.generatedAt) - Date.parse(at) > SAMPLE_STALE_AFTER_MS;
  return `集計受領 ${formatJstClock(at)}${stale ? '（鮮度低下）' : ''}`;
}

function reasonText(runtime: WeatherRuntimeStatus): string | null {
  const code = runtime.failureCode ?? runtime.stopReason;
  return code ? `理由 ${reasonLabels[code]}` : null;
}

interface StateDecision {
  readonly state: string;
  readonly tone: WorkerTone;
  readonly restartability: string;
  /** 再起動ボタンの押下可否をサーバー許可に委ねる状態か。 */
  readonly serverPermits: boolean;
  /** 詳細1行目を「応答を確認できません」に置換するか。 */
  readonly stale?: boolean;
  /** 最終報告などの行を持たない状態か。 */
  readonly bare?: boolean;
}

/** §4.2 の優先順位。役割ごとに上から最初に一致したものを状態とする。 */
function decide(
  runtime: WeatherRuntimeStatus | undefined,
  input: WorkerPresentInput,
): StateDecision {
  if (input.monitoringFailed || input.data === null || !runtime) {
    return {
      state: '状態不明',
      tone: 'neutral',
      restartability: '再起動不可: 監視の応答待ち',
      serverPermits: false,
      bare: true,
    };
  }
  if (runtime.mode === 'inline') {
    return {
      state: 'Worker未使用',
      tone: 'neutral',
      restartability: '再起動不可: Worker未使用',
      serverPermits: false,
      bare: true,
    };
  }
  if (
    input.restart.phase === 'sending' ||
    input.restart.phase === 'checking' ||
    runtime.lifecycle === 'restarting'
  ) {
    return {
      state: '再起動中',
      tone: 'attention',
      restartability: '再起動中',
      serverPermits: false,
    };
  }
  if (runtime.lifecycle === 'stopping') {
    return {
      state: '停止を確認中',
      tone: 'attention',
      restartability: '再起動不可: 停止確認中',
      serverPermits: false,
    };
  }
  const allowed = '再起動可';
  if (runtime.lifecycle === 'failed') {
    return { state: '異常停止', tone: 'error', restartability: allowed, serverPermits: true };
  }
  if (runtime.lifecycle === 'stopped') {
    return runtime.stopReason === 'requested'
      ? { state: '停止', tone: 'neutral', restartability: allowed, serverPermits: true }
      : { state: '異常停止', tone: 'error', restartability: allowed, serverPermits: true };
  }
  if (runtime.reportFreshness === 'stale') {
    return {
      state: '稼働中',
      tone: 'attention',
      restartability: allowed,
      serverPermits: true,
      stale: true,
    };
  }
  if (runtime.reportFreshness === 'unknown') {
    return {
      state: '報告待ち',
      tone: 'neutral',
      restartability: '再起動不可: 報告待ち',
      serverPermits: false,
    };
  }
  if (runtime.lifecycle === 'starting') {
    return {
      state: '準備中',
      tone: 'attention',
      restartability: '再起動不可: 準備中',
      serverPermits: false,
    };
  }
  return {
    state: '稼働中',
    tone: 'normal',
    restartability: '再起動不要（稼働中）',
    serverPermits: false,
  };
}

/** Workerカードの表示状態を、監視応答・再起動状態から純関数で導く。 */
export function presentWorker(role: WeatherRole, input: WorkerPresentInput): WorkerView {
  const runtime = input.data?.weatherRuntimes[role];
  const decision = decide(runtime, input);
  const result = composeRestartResult(role, input.restart, input.data, input.baselineGeneratedAt);
  let restartability = decision.restartability;
  let canRestart = false;
  if (decision.serverPermits && runtime) {
    if (input.restart.phase === 'unverifiable') {
      restartability = '再起動不可: 結果確認待ち（再読込で解除）';
    } else if (!runtime.restartAllowed || runtime.workerGeneration === null) {
      restartability = '再起動不可: サーバーが許可していません';
    } else {
      canRestart = true;
    }
  } else if (
    runtime &&
    input.restart.phase === 'unverifiable' &&
    !['状態不明', 'Worker未使用', '再起動中', '停止を確認中'].includes(decision.state)
  ) {
    restartability = '再起動不可: 結果確認待ち（再読込で解除）';
  }

  const lines: WorkerDetailLine[] = [];
  if (decision.bare || !runtime || !input.data) {
    lines.push({ text: restartability, kind: 'restartability' });
    return finalize(role, decision, canRestart, restartability, lines, result);
  }
  const data = input.data;
  const first: WorkerDetailLine = decision.stale
    ? {
        text: `応答を確認できません（最終報告 ${formatJstClock(runtime.receivedAt)}）`,
        kind: 'report',
      }
    : { text: reportLine(runtime, data.generatedAt), kind: 'report' };
  const reason = reasonText(runtime);
  const unknownCount = runtime.unknownScopes?.length ?? 0;
  const resultLine: WorkerDetailLine | null = result.cardText
    ? { text: result.cardText, kind: 'restart-result' }
    : null;
  if (role === 'acquisition') {
    const third =
      resultLine ??
      (reason ? { text: reason, kind: 'reason' as const } : null) ??
      (unknownCount > 0 ? { text: `結果不明 ${unknownCount}件`, kind: 'unknown' as const } : null);
    lines.push(first, { text: restartability, kind: 'restartability' });
    if (third) lines.push(third);
  } else {
    lines.push(first, { text: sampleLine(data), kind: 'sample' });
    const third =
      resultLine ??
      (!canRestart ? { text: restartability, kind: 'restartability' as const } : null) ??
      (reason ? { text: reason, kind: 'reason' as const } : null);
    if (third) lines.push(third);
  }
  return finalize(role, decision, canRestart, restartability, lines, result);
}

function finalize(
  role: WeatherRole,
  decision: StateDecision,
  canRestart: boolean,
  restartability: string,
  lines: readonly WorkerDetailLine[],
  result: RestartResult,
): WorkerView {
  return {
    role,
    title: roleTitle[role],
    state: decision.state,
    tone: decision.tone,
    canRestart,
    restartability,
    lines,
    result,
  };
}

// --- 以下は仮UI（WeatherWorkerPanel）だけが参照する旧表現。新しい監視画面では使わない。 ---
const lifecycleLabels: Record<WeatherRuntimeStatus['lifecycle'], string> = {
  starting: '準備中',
  ready: '稼働中',
  stopping: '停止を確認中',
  stopped: 'Worker停止',
  failed: 'Worker異常',
  restarting: '停止を確認中・再開中',
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
  if (operation.role === 'delivery') {
    if (operation.result === 'failure') return `提供Workerを再開できませんでした${suffix}`;
    const runtime = data?.weatherRuntimes.delivery;
    return runtime?.lifecycle === 'ready'
      ? `提供Workerを再開しました${suffix}`
      : `提供Workerの再開を受け付けました。接続は準備中です${suffix}`;
  }
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
