import {
  WEATHER_RUNTIME_REASON_LABELS,
  type WeatherRole,
  type WeatherRuntimeStatus,
  type MonitoringStatusResponse,
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

export function workerRestartableBadgeId(role: WeatherRole): string {
  return `monitoring-worker-${role}-restartable-badge`;
}

export type WorkerTone = 'neutral' | 'normal' | 'attention' | 'error';

export interface WorkerDetailLine {
  readonly text: string;
  readonly kind: 'report' | 'restartability' | 'restart-result' | 'reason' | 'unknown';
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
  /** 詳細行（1行）。再起動結果・理由・結果不明・応答不明・最終報告のうち優先度の高い1つ。 */
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

/**
 * 気象集計の受領状況。画面全体の値の鮮度を表すため、Workerカードではなく更新行に出す。
 * 正常なとき、および提供Workerを使わないとき（inline）は何も出さない。
 */
export function presentSampleFreshness(
  data: MonitoringStatusResponse | null,
): { readonly text: string; readonly tone: 'attention' } | null {
  if (!data || data.weatherRuntimes.delivery.mode === 'inline') return null;
  const at = data.weatherSampleReceivedAt ?? null;
  if (at === null) return { text: '集計 未受領', tone: 'attention' };
  const stale = Date.parse(data.generatedAt) - Date.parse(at) > SAMPLE_STALE_AFTER_MS;
  return stale ? { text: '集計 鮮度低下', tone: 'attention' } : null;
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
  // 取得Workerは準備中に同期処理でイベントループが止まり、報告が途絶えることがある。
  // 準備中の途絶は「応答を確認できません」ではなく「準備中」を示す（再開可否はサーバー許可のまま）。
  if (
    runtime.role === 'acquisition' &&
    runtime.prepared === false &&
    runtime.reportFreshness === 'stale'
  ) {
    return {
      state: '準備中',
      tone: 'attention',
      restartability: allowed,
      serverPermits: true,
    };
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
  const reason = reasonText(runtime);
  const unknownCount = runtime.unknownScopes?.length ?? 0;
  // 詳細は1行。再起動結果 → 理由 → 結果不明 → 応答不明 → 最終報告の順で最初に当てはまる1つ。
  const line: WorkerDetailLine = result.cardText
    ? { text: result.cardText, kind: 'restart-result' }
    : reason
      ? { text: reason, kind: 'reason' }
      : unknownCount > 0
        ? { text: `結果不明 ${unknownCount}件`, kind: 'unknown' }
        : decision.stale
          ? {
              text: `応答を確認できません（最終報告 ${formatJstClock(runtime.receivedAt)}）`,
              kind: 'report',
            }
          : { text: reportLine(runtime, data.generatedAt), kind: 'report' };
  lines.push(line);
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
