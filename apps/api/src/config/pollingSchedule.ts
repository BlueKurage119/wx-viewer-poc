import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import type { FreshnessPolicy } from '../polling/freshnessPolicy.js';

export type ScheduledSource = 'xml' | 'nowcast' | 'kikikuru' | 'amedas';
export type OnDemandSource = 'nowcast' | 'kikikuru';

export type AcquisitionTarget =
  | { readonly kind: 'scheduled'; readonly source: ScheduledSource }
  | { readonly kind: 'image'; readonly source: OnDemandSource };

export interface PollingPeriod {
  readonly start: string; // "HH:mm" (JST)
  readonly end: string; // "HH:mm" (JST)
  readonly xmlSeconds: number | null;
  readonly imageCatalogSeconds: number | null;
  readonly amedasSeconds: number | null;
  readonly nowcastEnabled: boolean;
  readonly kikikuruEnabled: boolean;
}

export interface PollingScheduleConfig {
  readonly timezone: 'Asia/Tokyo';
  readonly amedasPointRecheckSeconds: number;
  readonly freshness: {
    readonly xml: FreshnessPolicy;
    readonly imageCatalog: FreshnessPolicy;
  };
  readonly periods: readonly PollingPeriod[];
}

export interface UpstreamAccess {
  readonly allowed: boolean;
  readonly period: PollingPeriod;
  readonly nextAllowedAt: UtcIso8601String | null;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MINUTES_PER_DAY = 24 * 60;

function parseTimeStringToMinutes(timeStr: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeStr);
  if (!match) {
    throw new Error(`不正な時刻形式です (期待: HH:mm): ${timeStr}`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours * 60 + minutes;
}

function getJstMinutesOfDay(date: Date): number {
  const utcMs = date.getTime();
  const jstMs = utcMs + JST_OFFSET_MS;
  const totalSeconds = Math.floor(jstMs / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutesOfDay = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return minutesOfDay;
}

function isMinuteInPeriod(currentMinute: number, startStr: string, endStr: string): boolean {
  const start = parseTimeStringToMinutes(startStr);
  const end = parseTimeStringToMinutes(endStr);

  if (start < end) {
    return currentMinute >= start && currentMinute < end;
  }
  return currentMinute >= start || currentMinute < end;
}

export function resolvePollingPeriod(now: Date, schedule: PollingScheduleConfig): PollingPeriod {
  const currentMinute = getJstMinutesOfDay(now);

  for (const period of schedule.periods) {
    if (isMinuteInPeriod(currentMinute, period.start, period.end)) {
      return period;
    }
  }

  throw new Error(
    `時刻 ${now.toISOString()} (JST ${currentMinute}分) に合致する時間帯が見つかりません`,
  );
}

export function getNextPeriodChangeAt(now: Date, schedule: PollingScheduleConfig): Date {
  const nowMs = now.getTime();
  const jstTotalMs = nowMs + JST_OFFSET_MS;
  const jstDayBaseUtcMs = Math.floor(jstTotalMs / MS_PER_DAY) * MS_PER_DAY - JST_OFFSET_MS;

  let minCandidateMs = Infinity;

  for (const dayOffset of [0, 1]) {
    const dayStartUtcMs = jstDayBaseUtcMs + dayOffset * MS_PER_DAY;
    for (const period of schedule.periods) {
      const boundaryMs = dayStartUtcMs + parseTimeStringToMinutes(period.end) * 60 * 1000;
      if (boundaryMs > nowMs && boundaryMs < minCandidateMs) {
        minCandidateMs = boundaryMs;
      }
    }
  }

  if (minCandidateMs === Infinity) {
    throw new Error('次回の時間帯境界を算出できませんでした');
  }

  return new Date(minCandidateMs);
}

function isTargetAllowedInPeriod(target: AcquisitionTarget, period: PollingPeriod): boolean {
  if (target.kind === 'scheduled') {
    switch (target.source) {
      case 'xml':
        return period.xmlSeconds !== null;
      case 'nowcast':
      case 'kikikuru':
        return period.imageCatalogSeconds !== null;
      case 'amedas':
        return period.amedasSeconds !== null;
    }
  } else {
    switch (target.source) {
      case 'nowcast':
        return period.nowcastEnabled;
      case 'kikikuru':
        return period.kikikuruEnabled;
    }
  }
}

export function getNextEnabledAt(
  target: AcquisitionTarget,
  now: Date,
  schedule: PollingScheduleConfig,
): Date | null {
  const currentPeriod = resolvePollingPeriod(now, schedule);
  if (isTargetAllowedInPeriod(target, currentPeriod)) {
    return new Date(now.getTime());
  }

  const nowMs = now.getTime();
  const jstTotalMs = nowMs + JST_OFFSET_MS;
  const jstDayBaseUtcMs = Math.floor(jstTotalMs / MS_PER_DAY) * MS_PER_DAY - JST_OFFSET_MS;

  interface BoundaryCandidate {
    timeMs: number;
    period: PollingPeriod;
  }
  const candidates: BoundaryCandidate[] = [];

  for (const dayOffset of [0, 1, 2]) {
    const dayStartUtcMs = jstDayBaseUtcMs + dayOffset * MS_PER_DAY;
    for (const period of schedule.periods) {
      const startMs = dayStartUtcMs + parseTimeStringToMinutes(period.start) * 60 * 1000;
      if (startMs > nowMs) {
        candidates.push({ timeMs: startMs, period });
      }
    }
  }

  candidates.sort((a, b) => a.timeMs - b.timeMs);

  for (const candidate of candidates) {
    if (isTargetAllowedInPeriod(target, candidate.period)) {
      return new Date(candidate.timeMs);
    }
  }

  return null;
}

export function resolveOnDemandAccess(
  source: OnDemandSource,
  now: Date,
  schedule: PollingScheduleConfig,
): UpstreamAccess {
  const period = resolvePollingPeriod(now, schedule);
  const allowed = source === 'nowcast' ? period.nowcastEnabled : period.kikikuruEnabled;
  let nextAllowedAt: UtcIso8601String | null = null;

  if (allowed) {
    nextAllowedAt = now.toISOString() as UtcIso8601String;
  } else {
    const nextDate = getNextEnabledAt({ kind: 'image', source }, now, schedule);
    nextAllowedAt = nextDate ? (nextDate.toISOString() as UtcIso8601String) : null;
  }

  return {
    allowed,
    period,
    nextAllowedAt,
  };
}

const EXPECTED_PERIOD_KEYS = new Set([
  'start',
  'end',
  'xmlSeconds',
  'imageCatalogSeconds',
  'amedasSeconds',
  'nowcastEnabled',
  'kikikuruEnabled',
]);

const EXPECTED_ROOT_KEYS = new Set([
  'timezone',
  'amedasPointRecheckSeconds',
  'periods',
  'freshness',
]);

export function validatePollingScheduleConfig(config: unknown): PollingScheduleConfig {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new TypeError('PollingScheduleConfig はオブジェクトである必要があります');
  }

  const c = config as Record<string, unknown>;

  const rootKeys = Object.keys(c);
  for (const key of rootKeys) {
    if (!EXPECTED_ROOT_KEYS.has(key)) {
      throw new Error(`未知のルート設定キーです: ${key}`);
    }
  }
  for (const key of EXPECTED_ROOT_KEYS) {
    if (!(key in c)) {
      throw new Error(`必須ルート設定キーが不足しています: ${key}`);
    }
  }

  if (c.timezone !== 'Asia/Tokyo') {
    throw new Error('timezone は "Asia/Tokyo" 固定である必要があります');
  }

  if (
    typeof c.amedasPointRecheckSeconds !== 'number' ||
    !Number.isSafeInteger(c.amedasPointRecheckSeconds) ||
    c.amedasPointRecheckSeconds <= 0
  ) {
    throw new Error('amedasPointRecheckSeconds は正の有限整数秒である必要があります');
  }

  if (typeof c.freshness !== 'object' || c.freshness === null || Array.isArray(c.freshness)) {
    throw new TypeError('freshness はオブジェクトである必要があります');
  }
  const f = c.freshness as Record<string, unknown>;
  if (!('xml' in f) || !('imageCatalog' in f)) {
    throw new Error('freshness に xml または imageCatalog が不足しています');
  }
  for (const fKey of ['xml', 'imageCatalog']) {
    const policy = f[fKey];
    if (typeof policy !== 'object' || policy === null || Array.isArray(policy)) {
      throw new TypeError(`freshness.${fKey} はオブジェクトである必要があります`);
    }
    const p = policy as Record<string, unknown>;
    if (
      typeof p.staleAfterSeconds !== 'number' ||
      !Number.isSafeInteger(p.staleAfterSeconds) ||
      p.staleAfterSeconds <= 0
    ) {
      throw new Error(`freshness.${fKey}.staleAfterSeconds は正の有限整数秒である必要があります`);
    }
  }

  if (!Array.isArray(c.periods) || c.periods.length === 0) {
    throw new Error('periods は空でない配列である必要があります');
  }

  interface MinuteInterval {
    start: number;
    end: number;
  }
  const intervals: MinuteInterval[] = [];

  for (const r of c.periods) {
    if (typeof r !== 'object' || r === null) {
      throw new TypeError('periods の各要素はオブジェクトである必要があります');
    }
    const period = r as Record<string, unknown>;

    for (const key of Object.keys(period)) {
      if (!EXPECTED_PERIOD_KEYS.has(key)) {
        throw new Error(`未知の period キーです: ${key}`);
      }
    }
    for (const key of EXPECTED_PERIOD_KEYS) {
      if (!(key in period)) {
        throw new Error(`必須 period キーが不足しています: ${key}`);
      }
    }

    if (typeof period.start !== 'string' || typeof period.end !== 'string') {
      throw new TypeError('start および end は HH:mm 形式の文字列である必要があります');
    }

    const startMin = parseTimeStringToMinutes(period.start);
    const endMin = parseTimeStringToMinutes(period.end);

    if (startMin === endMin) {
      throw new Error(`start と end が同一です (${period.start})`);
    }

    if (startMin < endMin) {
      intervals.push({ start: startMin, end: endMin });
    } else {
      intervals.push({ start: startMin, end: MINUTES_PER_DAY });
      if (endMin > 0) {
        intervals.push({ start: 0, end: endMin });
      }
    }

    const checkSeconds = (name: string, val: unknown) => {
      if (val === null) return;
      if (typeof val !== 'number' || !Number.isSafeInteger(val) || val <= 0 || val > 86400) {
        throw new Error(
          `${name} は 1〜86400 の有限整数秒または null である必要があります: ${String(val)}`,
        );
      }
    };

    checkSeconds('xmlSeconds', period.xmlSeconds);
    checkSeconds('imageCatalogSeconds', period.imageCatalogSeconds);
    checkSeconds('amedasSeconds', period.amedasSeconds);

    if (typeof period.nowcastEnabled !== 'boolean') {
      throw new TypeError('nowcastEnabled は boolean である必要があります');
    }
    if (typeof period.kikikuruEnabled !== 'boolean') {
      throw new TypeError('kikikuruEnabled は boolean である必要があります');
    }
  }

  // 24時間 (1440分) の被覆検査
  intervals.sort((a, b) => a.start - b.start);

  let currentMinute = 0;
  for (const iv of intervals) {
    if (iv.start !== currentMinute) {
      throw new Error(
        `時間帯範囲に欠落または重複があります: 期待 ${currentMinute}分, 実際 ${iv.start}分`,
      );
    }
    currentMinute = iv.end;
  }

  if (currentMinute !== MINUTES_PER_DAY) {
    throw new Error(
      `時間帯範囲が24時間を完全に網羅していません (現在 ${currentMinute}分 / 1440分)`,
    );
  }

  return config as PollingScheduleConfig;
}
