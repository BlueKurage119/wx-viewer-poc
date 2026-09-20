import type {
  MonitoredFetchSourceId,
  MonitoringHealthStatus,
  MonitoringStatusResponse,
  VenueId,
} from '@wx-viewer-poc/shared';
import {
  formatJstDateTime,
  formatJstMonthDayClock,
  formatJstTime,
} from './monitoringTimeFormat.js';

export { formatJstDateTime, formatJstMonthDayClock, formatJstTime };

export type MonitoringTone = 'neutral' | 'normal' | 'active' | 'attention' | 'error';

export interface MonitoringCard {
  readonly id: 'operation' | 'health' | 'schedule' | 'processing';
  readonly title: string;
  readonly value: string;
  readonly details: readonly string[];
  readonly tone: MonitoringTone;
  readonly detailTone?: MonitoringTone;
}

const VENUE_NAMES: Readonly<Record<VenueId, string>> = {
  east: '東地区',
  trc: 'TRC',
};

function healthPresentation(status: MonitoringHealthStatus | null): {
  readonly value: string;
  readonly tone: MonitoringTone;
} {
  switch (status) {
    case 'normal':
      return { value: '正常', tone: 'normal' };
    case 'delayed':
      return { value: '遅延', tone: 'attention' };
    case 'abnormal':
      return { value: '異常', tone: 'error' };
    case 'suspended':
      return { value: '停止中（評価対象外）', tone: 'neutral' };
    case null:
      return { value: '判定待ち', tone: 'neutral' };
  }
}

function readinessPresentation(phase: MonitoringStatusResponse['readiness']['initialFetchPhase']): {
  readonly label: string;
  readonly tone: MonitoringTone;
} {
  switch (phase) {
    case 'not_started':
      return { label: '初回同期 未開始', tone: 'neutral' };
    case 'running':
      return { label: '初回同期中', tone: 'active' };
    case 'completed':
      return { label: '初回同期完了', tone: 'normal' };
    case 'failed':
      return { label: '初回同期失敗', tone: 'error' };
  }
}

function processingPresentation(
  response: MonitoringStatusResponse,
): Pick<MonitoringCard, 'value' | 'details' | 'tone'> {
  const details = response.venues.map((venue) => {
    const name = VENUE_NAMES[venue.venueId];
    const { reprocessing } = venue;
    switch (reprocessing.status) {
      case 'idle':
        return `${name} 未開始`;
      case 'running':
        return `${name} 再処理中 ${reprocessing.processedCount} / ${reprocessing.total}`;
      case 'completed':
        return `${name} 再処理完了 ${reprocessing.processedCount}件`;
    }
  });
  const tone: MonitoringTone = response.venues.some(
    (venue) => venue.reprocessing.status === 'running',
  )
    ? 'active'
    : response.venues.length > 0 &&
        response.venues.every((venue) => venue.reprocessing.status === 'completed')
      ? 'normal'
      : 'neutral';
  return { value: '起動時再処理', details, tone };
}

/** DTOの状態をカード向けの表示語へ変換する。閾値や時刻からの再判定は行わない。 */
export function buildMonitoringCards(data: MonitoringStatusResponse): readonly MonitoringCard[] {
  const readiness = readinessPresentation(data.readiness.initialFetchPhase);
  const health = healthPresentation(data.health.worstStatus);
  const activeIntervals = [
    data.operation.period.xmlSeconds,
    data.operation.period.imageCatalogSeconds,
    data.operation.period.amedasSeconds,
  ].filter((interval): interval is number => interval !== null);
  const processing = processingPresentation(data);

  return [
    {
      id: 'operation',
      title: '取得運転',
      value: data.operation.schedulerRunning ? '自動取得有効' : '自動取得停止',
      details: [readiness.label],
      tone:
        readiness.tone === 'error'
          ? 'neutral'
          : data.operation.schedulerRunning
            ? 'normal'
            : 'neutral',
      detailTone: readiness.tone,
    },
    {
      id: 'health',
      title: '取得健全性',
      value: health.value,
      details: [
        `評価時刻 ${data.health.evaluatedAt ? formatJstTime(data.health.evaluatedAt) : '—'}`,
      ],
      tone: health.tone,
    },
    {
      id: 'schedule',
      title: 'スケジュール',
      value: `${data.operation.period.start} – ${data.operation.period.end}`,
      details: [
        `次の切替 ${formatJstTime(data.operation.nextPeriodChangeAt)}`,
        ...(activeIntervals.length === 0 ? ['定期取得の設定なし'] : []),
      ],
      tone: 'neutral',
    },
    {
      id: 'processing',
      title: '処理待ち',
      value: processing.value,
      details: processing.details,
      tone: processing.tone,
    },
  ];
}

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
    } else if (!data.operation.schedulerRunning) {
      stateCell = { text: '停止', tone: 'neutral' };
    } else if (
      healthSource.status === 'suspended' ||
      scheduledSource?.state === 'scheduled_stopped'
    ) {
      stateCell = { text: 'スケジュール停止', tone: 'neutral' };
    } else if (scheduledSource?.state === 'running') {
      stateCell = { text: '取得中', tone: 'active' };
    } else {
      stateCell = { text: '待機', tone: 'normal' };
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
