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
  { key: 'precipitation1h', label: '1時間降水量', unit: 'mm' },
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
