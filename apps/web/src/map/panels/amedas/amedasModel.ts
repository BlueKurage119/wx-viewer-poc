import type {
  AmedasObservationDto,
  AmedasPublicElement,
  AmedasResponse,
} from '@wx-viewer-poc/shared';

const DIRECTIONS = [
  '静穏',
  '北北東',
  '北東',
  '東北東',
  '東',
  '東南東',
  '南東',
  '南南東',
  '南',
  '南南西',
  '南西',
  '西南西',
  '西',
  '西北西',
  '北西',
  '北北西',
  '北',
] as const;
export const AMEDAS_FIELDS: readonly { key: AmedasPublicElement; label: string; unit: string }[] = [
  { key: 'temp', label: '気温', unit: '℃' },
  { key: 'humidity', label: '湿度', unit: '%' },
  { key: 'windDirection', label: '風向', unit: '' },
  { key: 'wind', label: '風速', unit: 'm/s' },
  { key: 'precipitation1h', label: '時雨量', unit: 'mm' },
];
export function windDirectionName(value: number): string {
  return Number.isInteger(value) && value >= 0 && value < DIRECTIONS.length
    ? DIRECTIONS[value]!
    : '方位不明';
}
export function amedasValue(
  response: AmedasResponse,
  row: AmedasObservationDto,
  key: AmedasPublicElement,
): string {
  if (response.capabilities.unsupportedElements.includes(key)) return '非提供';
  const value = row.values[key];
  if (value === null || value === undefined || !Number.isFinite(value)) return '欠測';
  if (key === 'windDirection') return windDirectionName(value);
  const unit = AMEDAS_FIELDS.find((field) => field.key === key)!.unit;
  return `${value} ${unit}`;
}
export function latestAmedasRow(response: AmedasResponse): AmedasObservationDto | null {
  if (response.metadata.availability === 'unavailable') return null;
  const at = response.data?.latestObservedAt;
  return response.data?.observations.find((row) => row.observedAt === at) ?? null;
}
export function recentAmedasRows(
  response: AmedasResponse,
  now: number,
): readonly AmedasObservationDto[] {
  const start = now - 24 * 60 * 60 * 1000;
  return (
    response.data?.observations.filter((row) => {
      const time = Date.parse(row.observedAt);
      return Number.isFinite(time) && time >= start && time <= now;
    }) ?? []
  );
}
export function formatAmedasTime(iso: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** 表示上の非提供は欠測と区別し、読み上げでは意味を残す。 */
export function amedasDisplayValue(
  response: AmedasResponse,
  row: AmedasObservationDto,
  key: AmedasPublicElement,
): { text: string; accessibleLabel: string | null } {
  const label = AMEDAS_FIELDS.find((field) => field.key === key)!.label;
  if (response.capabilities.unsupportedElements.includes(key)) {
    return { text: '—', accessibleLabel: `${label} 非提供` };
  }
  return { text: amedasValue(response, row, key), accessibleLabel: null };
}

const TABLE_STEP_MS = 3 * 60 * 60 * 1000;
export function visibleAmedasRows(
  rows: readonly AmedasObservationDto[],
  now: number,
  windows: number,
): { rows: readonly AmedasObservationDto[]; hasMore: boolean } {
  const cutoff = now - Math.min(Math.max(windows, 1), 8) * TABLE_STEP_MS;
  const descending = [...rows].reverse();
  return {
    rows: descending.filter((row) => Date.parse(row.observedAt) >= cutoff),
    hasMore: descending.some((row) => Date.parse(row.observedAt) < cutoff),
  };
}

/** 観測のない3時間枠は飛ばし、次に値のある枠まで進める。 */
export function nextAmedasWindowCount(
  rows: readonly AmedasObservationDto[],
  now: number,
  current: number,
): number {
  const previousLength = visibleAmedasRows(rows, now, current).rows.length;
  for (let window = current + 1; window <= 8; window += 1) {
    if (visibleAmedasRows(rows, now, window).rows.length > previousLength) return window;
  }
  return 8;
}
