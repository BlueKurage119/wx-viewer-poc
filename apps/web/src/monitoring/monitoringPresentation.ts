import type {
  MonitoringHealthStatus,
  MonitoringStatusResponse,
  VenueId,
} from '@wx-viewer-poc/shared';

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

function formatJstTime(value: string): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(value));
  const hour = parts.find((part) => part.type === 'hour')?.value;
  const minute = parts.find((part) => part.type === 'minute')?.value;
  return hour && minute ? `${hour}:${minute}` : '—';
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

export function formatJstDateTime(value: string): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');
  const second = get('second');
  return year && month && day && hour && minute && second
    ? `${year}/${month}/${day} ${hour}:${minute}:${second}`
    : '—';
}
