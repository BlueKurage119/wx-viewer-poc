import type {
  MonitoredFetchSourceId,
  MonitoringStatusResponse,
  WeatherRole,
} from '@wx-viewer-poc/shared';
import { presentWorker, type WorkerDetailLine } from './weatherWorkerPresentation.js';
import type { WeatherRestartState } from './weatherRestartController.js';
import {
  formatElapsedTime,
  formatJstDateTime,
  formatJstMonthDayClock,
  formatJstTime,
} from './monitoringTimeFormat.js';

export { formatElapsedTime, formatJstDateTime, formatJstMonthDayClock, formatJstTime };

export type MonitoringTone = 'neutral' | 'normal' | 'active' | 'attention' | 'error';

export type MonitoringCardId = 'acquisitionWorker' | 'deliveryWorker' | 'autoFetch' | 'telegram';

export interface MonitoringCardDetail {
  readonly text: string;
  readonly tone?: MonitoringTone;
  /** 再起動結果の行は aria-live で通知する。 */
  readonly kind?: WorkerDetailLine['kind'];
}

export interface MonitoringCard {
  readonly id: MonitoringCardId;
  readonly title: string;
  readonly value: string;
  readonly details: readonly MonitoringCardDetail[];
  readonly tone: MonitoringTone;
  /** Worker カードのとき、ボタンの説明参照に使う再開可否の文言。 */
  readonly restartability?: string;
}

export interface MonitoringCardsInput {
  readonly data: MonitoringStatusResponse | null;
  /** 監視取得が失敗中か。 */
  readonly monitoringFailed: boolean;
  readonly restarts: Readonly<Record<WeatherRole, WeatherRestartState>>;
  readonly baselines: Readonly<Record<WeatherRole, string | null>>;
}

const IDLE_RESTARTS: MonitoringCardsInput['restarts'] = {
  acquisition: { phase: 'idle' },
  delivery: { phase: 'idle' },
};
const NO_BASELINES: MonitoringCardsInput['baselines'] = { acquisition: null, delivery: null };

function workerCard(role: WeatherRole, input: MonitoringCardsInput): MonitoringCard {
  const view = presentWorker(role, {
    data: input.data,
    monitoringFailed: input.monitoringFailed,
    restart: input.restarts[role],
    baselineGeneratedAt: input.baselines[role],
  });
  return {
    id: role === 'acquisition' ? 'acquisitionWorker' : 'deliveryWorker',
    title: view.title,
    value: view.state,
    details: view.lines.map((line) => ({ text: line.text, kind: line.kind })),
    tone: view.tone,
    restartability: view.restartability,
  };
}

function autoFetchCard(data: MonitoringStatusResponse | null): MonitoringCard {
  if (!data) {
    return {
      id: 'autoFetch',
      title: '自動取得',
      value: '—',
      details: [{ text: '—' }],
      tone: 'neutral',
    };
  }
  const reported = data.weatherRuntimes.acquisition.reportFreshness !== 'unknown';
  const activeIntervals = [
    data.operation.period.xmlSeconds,
    data.operation.period.imageCatalogSeconds,
    data.operation.period.amedasSeconds,
  ].filter((interval): interval is number => interval !== null);
  const details: MonitoringCardDetail[] =
    activeIntervals.length === 0
      ? [{ text: '定期取得の設定なし' }]
      : [
          {
            text: `${data.operation.period.start}–${data.operation.period.end}\u3000次 ${formatJstTime(data.operation.nextPeriodChangeAt)}`,
          },
        ];
  return {
    id: 'autoFetch',
    title: '自動取得',
    value: !reported ? '—' : data.operation.schedulerRunning ? '有効' : '停止',
    details,
    tone: reported && data.operation.schedulerRunning ? 'normal' : 'neutral',
  };
}

const syncStageLabels: Record<MonitoringStatusResponse['readiness']['initialFetchPhase'], string> =
  {
    not_started: '初回同期 未開始',
    running: '初回同期 実行中',
    completed: '初回同期 完了',
    failed: '初回同期 失敗',
  };

/** 電文処理カード。準備失敗＞初回同期中＞再処理中＞未判定の順に主表示を決める。 */
function telegramCard(data: MonitoringStatusResponse | null): MonitoringCard {
  if (!data) {
    return {
      id: 'telegram',
      title: '電文処理',
      value: '—',
      details: [{ text: '—' }],
      tone: 'neutral',
    };
  }
  const venue = data.venues.find((v) => v.venueId === data.requestedVenueId);
  const failures = data.readiness.preparationFailures.filter(
    (failure) => failure.venueId === null || failure.venueId === data.requestedVenueId,
  );
  const hasReadError =
    data.warningTelegrams == null ||
    data.readErrors.some(
      (error) => error.venueId === null || error.venueId === data.requestedVenueId,
    );
  const pending = data.warningTelegrams ?? null;
  const reprocessing = venue?.reprocessing;
  const reprocessLabel = !reprocessing
    ? '—'
    : reprocessing.status === 'completed'
      ? '起動時再処理 完了'
      : '起動時再処理 未開始';
  const phase = data.readiness.initialFetchPhase;
  let value: string;
  let tone: MonitoringTone;
  let supplement: string;
  if (failures.length > 0 || phase === 'failed') {
    value = failures.length > 0 ? `準備失敗（${failures.length}件）` : '準備失敗';
    tone = 'error';
    supplement = data.readiness.errorReason ?? syncStageLabels[phase];
  } else if (phase === 'not_started' || phase === 'running') {
    value = '初回同期中';
    tone = 'attention';
    supplement = syncStageLabels[phase];
  } else if (reprocessing?.status === 'running') {
    value = `再処理中 ${reprocessing.processedCount}/${reprocessing.total}`;
    tone = 'attention';
    supplement = syncStageLabels[phase];
  } else if (pending === null) {
    value = '未判定 —';
    tone = 'neutral';
    supplement = reprocessLabel;
  } else if (pending.pendingCount >= 1) {
    value = `未判定 ${pending.pendingCount}件`;
    tone = 'attention';
    supplement = reprocessLabel;
  } else {
    value = '未判定なし';
    tone = 'normal';
    supplement = reprocessLabel;
  }
  // 詳細は1行。気象データの読取失敗があれば、それを優先する。
  const details: MonitoringCardDetail[] = [
    hasReadError ? { text: '気象データを読み取れません', tone: 'error' } : { text: supplement },
  ];
  return { id: 'telegram', title: '電文処理', value, details, tone };
}

/** DTOの状態をカード向けの表示語へ変換する。閾値や時刻からの再判定は行わない。 */
export function buildMonitoringCards(input: MonitoringCardsInput): readonly MonitoringCard[] {
  const demote = (card: MonitoringCard): MonitoringCard =>
    input.monitoringFailed && (card.tone === 'normal' || card.tone === 'active')
      ? { ...card, tone: 'neutral' }
      : card;
  return [
    workerCard('acquisition', input),
    workerCard('delivery', input),
    demote(autoFetchCard(input.data)),
    demote(telegramCard(input.data)),
  ];
}

export { IDLE_RESTARTS, NO_BASELINES };

export interface SourceStatusCell {
  /** 可視テキスト。欠測は '—'。 */
  readonly text: string;
  /** 色トークンの選択。省略時は装飾なし。 */
  readonly tone?: MonitoringTone;
  /** title 属性・視覚的非表示テキストで添える補足。 */
  readonly note?: string;
}

export interface SourceStatusRow {
  readonly sourceId: MonitoredFetchSourceId;
  /** 行見出し（K1の SOURCE_ROWS と同じ文字列）。 */
  readonly name: string;
  readonly state: SourceStatusCell;
  readonly interval: SourceStatusCell;
  readonly lastAttempt: SourceStatusCell;
  readonly lastSuccess: SourceStatusCell;
  readonly nextRun: SourceStatusCell;
  readonly duration: SourceStatusCell;
  readonly consecutiveFailures: SourceStatusCell;
}

export interface SourceRowDefinition {
  readonly sourceId: MonitoredFetchSourceId;
  readonly name: string;
  readonly scheduledSource: 'xml' | 'nowcast' | 'kikikuru' | 'amedas';
}

export const SOURCE_ROW_DEFINITIONS: readonly SourceRowDefinition[] = [
  { sourceId: 'xml_regular', name: 'XML定時フィード', scheduledSource: 'xml' },
  { sourceId: 'xml_extra', name: 'XML随時フィード', scheduledSource: 'xml' },
  { sourceId: 'nowcast_target_times', name: '雨雲時刻一覧', scheduledSource: 'nowcast' },
  { sourceId: 'kikikuru_target_times', name: 'キキクル時刻一覧', scheduledSource: 'kikikuru' },
  { sourceId: 'amedas_latest_time', name: 'アメダス最新時刻', scheduledSource: 'amedas' },
  { sourceId: 'amedas_point', name: 'アメダス地点データ', scheduledSource: 'amedas' },
] as const;

/** 秒を「n分」「n秒」へ。null は '—'。 */
export function formatIntervalSeconds(seconds: number | null): string {
  if (seconds === null) {
    return '—';
  }
  if (seconds > 0 && seconds % 60 === 0) {
    return `${Math.floor(seconds / 60)}分`;
  }
  return `${seconds}秒`;
}

/** ミリ秒を「n ms」または 1000ms 以上なら「n.n 秒」へ。null は '—'、0 は '0 ms'。 */
export function formatDurationMs(durationMs: number | null): string {
  if (durationMs === null) {
    return '—';
  }
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }
  return `${(durationMs / 1000).toFixed(1)} 秒`;
}

/**
 * 稼働状態APIから取得元表の6行を作る純粋関数。
 * 閾値・経過時間からの再判定は行わない。data が null のとき全セル '—' の6行を返す。
 * 雨雲時刻一覧・キキクル時刻一覧の行は、§4.4 に従い
 * interval / duration / consecutiveFailures を常に '—' のセルにする。
 */
export function buildSourceStatusRows(
  data: MonitoringStatusResponse | null,
  isFailed: boolean = false,
): readonly SourceStatusRow[] {
  if (!data) {
    return SOURCE_ROW_DEFINITIONS.map((def) => ({
      sourceId: def.sourceId,
      name: def.name,
      state: { text: '—' },
      interval: { text: '—' },
      lastAttempt: { text: '—' },
      lastSuccess: { text: '—' },
      nextRun: { text: '—' },
      duration: { text: '—' },
      consecutiveFailures: { text: '—' },
    }));
  }

  const healthSourceMap = new Map(data.health.sources.map((s) => [s.sourceId, s]));
  const scheduledSourceMap = new Map(data.operation.scheduledSources.map((s) => [s.source, s]));

  return SOURCE_ROW_DEFINITIONS.map((def) => {
    const healthSource = healthSourceMap.get(def.sourceId);
    const scheduledSource = scheduledSourceMap.get(def.scheduledSource);

    if (!healthSource) {
      return {
        sourceId: def.sourceId,
        name: def.name,
        state: { text: '—' },
        interval: { text: '—' },
        lastAttempt: { text: '—' },
        lastSuccess: { text: '—' },
        nextRun: { text: '—' },
        duration: { text: '—' },
        consecutiveFailures: { text: '—' },
      };
    }

    // 状態列 (§4.2)
    // 1. health.sources[i].status === null -> 判定待ち (neutral)
    // 2. status === 'abnormal' -> 異常 (error)
    // 3. status === 'delayed' -> 遅延 (attention)
    // 4. operation.schedulerRunning === false -> 停止 (neutral)
    // 5. status === 'suspended' または scheduledSources.state === 'scheduled_stopped' -> スケジュール停止 (neutral)
    // 6. scheduledSources.state === 'running' -> 取得中 (active)
    // 7. それ以外 -> 待機 (normal)
    let stateCell: SourceStatusCell;
    if (healthSource.status === null) {
      stateCell = { text: '判定待ち', tone: 'neutral' };
    } else if (healthSource.status === 'abnormal') {
      stateCell = { text: '異常', tone: 'error' };
    } else if (healthSource.status === 'delayed') {
      stateCell = { text: '遅延', tone: 'attention' };
    } else if (data.weatherRuntimes.acquisition.reportFreshness === 'unknown') {
      stateCell = { text: '未確認', tone: 'neutral' };
    } else if (!data.operation.schedulerRunning) {
      stateCell = { text: '停止', tone: 'neutral' };
    } else if (
      healthSource.status === 'suspended' ||
      scheduledSource?.state === 'scheduled_stopped'
    ) {
      stateCell = { text: 'スケジュール停止', tone: 'neutral' };
    } else if (scheduledSource?.state === 'running') {
      stateCell = { text: '取得中', tone: isFailed ? 'neutral' : 'active' };
    } else {
      stateCell = { text: '待機', tone: isFailed ? 'neutral' : 'normal' };
    }

    const isTileTimesSource =
      def.sourceId === 'nowcast_target_times' || def.sourceId === 'kikikuru_target_times';

    // 適用周期: 雨雲・キキクルは常に '—' (§4.4)
    const intervalCell: SourceStatusCell = isTileTimesSource
      ? { text: '—' }
      : { text: formatIntervalSeconds(healthSource.intervalSeconds) };

    // 最終試行: formatJstMonthDayClock
    const lastAttemptCell: SourceStatusCell = {
      text: formatJstMonthDayClock(healthSource.lastAttemptAt),
    };

    // 最終成功: formatJstMonthDayClock
    const lastSuccessCell: SourceStatusCell = {
      text: formatJstMonthDayClock(healthSource.lastSuccessAt),
    };

    // 次回予定:
    // amedas_point は常に '—' (§4.3)
    // その他は scheduledSource.nextRunAt を formatJstMonthDayClock
    const nextRunCell: SourceStatusCell =
      def.sourceId === 'amedas_point'
        ? { text: '—' }
        : { text: formatJstMonthDayClock(scheduledSource?.nextRunAt ?? null) };

    // 直近処理時間: 雨雲・キキクルは常に '—' (§4.4)
    const durationCell: SourceStatusCell = isTileTimesSource
      ? { text: '—' }
      : { text: formatDurationMs(healthSource.lastDurationMs) };

    // 連続失敗回数: 雨雲・キキクルは常に '—' (§4.4)
    let consecutiveFailuresCell: SourceStatusCell;
    if (isTileTimesSource) {
      consecutiveFailuresCell = { text: '—' };
    } else if (healthSource.consecutiveFailures === null) {
      consecutiveFailuresCell = { text: '—' };
    } else {
      const n = healthSource.consecutiveFailures;
      const abnormalThreshold = data.health.thresholds.abnormalConsecutiveFailures;
      const delayedThreshold = data.health.thresholds.delayedConsecutiveFailures;

      let tone: MonitoringTone | undefined;
      if (n >= abnormalThreshold) {
        tone = 'error';
      } else if (n >= delayedThreshold) {
        tone = 'attention';
      }

      const note =
        def.sourceId === 'amedas_point'
          ? '経過時間による判定は行わない（失敗回数のみで判定）'
          : undefined;

      consecutiveFailuresCell = {
        text: `${n} / ${abnormalThreshold}`,
        tone,
        note,
      };
    }

    return {
      sourceId: def.sourceId,
      name: def.name,
      state: stateCell,
      interval: intervalCell,
      lastAttempt: lastAttemptCell,
      lastSuccess: lastSuccessCell,
      nextRun: nextRunCell,
      duration: durationCell,
      consecutiveFailures: consecutiveFailuresCell,
    };
  });
}
