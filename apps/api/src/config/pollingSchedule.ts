export type PollingMode = 'early' | 'busy' | 'late' | 'off_hours';
export type ScheduledSource = 'xml' | 'nowcast' | 'kikikuru' | 'amedas';

export interface TimeRangeConfig {
  readonly mode: PollingMode;
  readonly start: `${number}:${number}`; // HH:mm、JST
  readonly end: `${number}:${number}`;
}

export interface PollingScheduleConfig {
  readonly timeZone: 'Asia/Tokyo';
  readonly ranges: readonly TimeRangeConfig[];
  readonly intervalsSeconds: Readonly<
    Record<PollingMode, Readonly<Record<ScheduledSource, number | null>>>
  >;
  readonly amedasPointRecheckSeconds?: number;
}

export const ALL_POLLING_MODES: readonly PollingMode[] = [
  'early',
  'busy',
  'late',
  'off_hours',
] as const;

export const ALL_SCHEDULED_SOURCES: readonly ScheduledSource[] = [
  'xml',
  'nowcast',
  'kikikuru',
  'amedas',
] as const;

export const DEFAULT_POLLING_SCHEDULE: PollingScheduleConfig = {
  timeZone: 'Asia/Tokyo',
  ranges: [
    { mode: 'early', start: '04:00', end: '05:00' },
    { mode: 'busy', start: '05:00', end: '18:00' },
    { mode: 'late', start: '18:00', end: '20:00' },
    { mode: 'off_hours', start: '20:00', end: '04:00' },
  ],
  intervalsSeconds: {
    early: { xml: 120, nowcast: 300, kikikuru: 300, amedas: 300 },
    busy: { xml: 60, nowcast: 60, kikikuru: 60, amedas: 60 },
    late: { xml: 120, nowcast: 300, kikikuru: 300, amedas: 300 },
    off_hours: { xml: null, nowcast: null, kikikuru: null, amedas: null },
  },
  amedasPointRecheckSeconds: 600,
};

const MS_PER_DAY = 86_400_000;
const MINUTES_PER_DAY = 1440;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function parseTimeStringToMinutes(timeStr: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeStr);
  if (!match) {
    throw new RangeError(`時刻形式は HH:mm (00:00〜23:59) である必要があります: ${timeStr}`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours * 60 + minutes;
}

export function getJstDayTimeMs(date: Date): number {
  const utcMs = date.getTime();
  const jstMs = (utcMs + JST_OFFSET_MS) % MS_PER_DAY;
  return (jstMs + MS_PER_DAY) % MS_PER_DAY;
}

export function resolvePollingMode(
  date: Date,
  schedule: PollingScheduleConfig = DEFAULT_POLLING_SCHEDULE,
): PollingMode {
  const currentJstMs = getJstDayTimeMs(date);

  for (const range of schedule.ranges) {
    const startMs = parseTimeStringToMinutes(range.start) * 60 * 1000;
    const endMs = parseTimeStringToMinutes(range.end) * 60 * 1000;

    if (startMs < endMs) {
      if (currentJstMs >= startMs && currentJstMs < endMs) {
        return range.mode;
      }
    } else {
      // 日跨ぎ区間 (例: 20:00〜04:00)
      if (currentJstMs >= startMs || currentJstMs < endMs) {
        return range.mode;
      }
    }
  }

  throw new Error(`時間帯モードを解決できませんでした: ${date.toISOString()}`);
}

export function getNextModeChangeAt(
  date: Date,
  schedule: PollingScheduleConfig = DEFAULT_POLLING_SCHEDULE,
): Date {
  const nowMs = date.getTime();
  const jstTotalMs = nowMs + JST_OFFSET_MS;
  const jstDayBaseUtcMs = Math.floor(jstTotalMs / MS_PER_DAY) * MS_PER_DAY - JST_OFFSET_MS;

  const candidateBoundaries: number[] = [];
  for (const dayOffset of [-1, 0, 1, 2]) {
    const dayStartUtcMs = jstDayBaseUtcMs + dayOffset * MS_PER_DAY;
    for (const range of schedule.ranges) {
      const startMs = dayStartUtcMs + parseTimeStringToMinutes(range.start) * 60 * 1000;
      if (startMs > nowMs) {
        candidateBoundaries.push(startMs);
      }
      const endMs = dayStartUtcMs + parseTimeStringToMinutes(range.end) * 60 * 1000;
      if (endMs > nowMs) {
        candidateBoundaries.push(endMs);
      }
    }
  }

  if (candidateBoundaries.length === 0) {
    throw new Error('次回モード切替時刻の計算に失敗しました');
  }

  return new Date(Math.min(...candidateBoundaries));
}

export function getNextJstTime(date: Date, timeStr: `${number}:${number}` = '04:00'): Date {
  const nowMs = date.getTime();
  const jstTotalMs = nowMs + JST_OFFSET_MS;
  const jstDayBaseUtcMs = Math.floor(jstTotalMs / MS_PER_DAY) * MS_PER_DAY - JST_OFFSET_MS;
  const targetMsToday = jstDayBaseUtcMs + parseTimeStringToMinutes(timeStr) * 60 * 1000;

  if (targetMsToday > nowMs) {
    return new Date(targetMsToday);
  }
  return new Date(targetMsToday + MS_PER_DAY);
}

export function validatePollingScheduleConfig(config: unknown): PollingScheduleConfig {
  if (typeof config !== 'object' || config === null) {
    throw new TypeError('PollingScheduleConfig はオブジェクトである必要があります');
  }

  const c = config as Record<string, unknown>;

  if (c.timeZone !== 'Asia/Tokyo') {
    throw new Error('timeZone は "Asia/Tokyo" 固定である必要があります');
  }

  if (!Array.isArray(c.ranges) || c.ranges.length === 0) {
    throw new Error('ranges は空でない配列である必要があります');
  }

  const seenModes = new Set<PollingMode>();
  interface MinuteInterval {
    start: number;
    end: number;
  }
  const intervals: MinuteInterval[] = [];

  for (const r of c.ranges) {
    if (typeof r !== 'object' || r === null) {
      throw new TypeError('ranges の各要素はオブジェクトである必要があります');
    }
    const range = r as Record<string, unknown>;

    if (typeof range.mode !== 'string' || !ALL_POLLING_MODES.includes(range.mode as PollingMode)) {
      throw new Error(`不正なモード指定です: ${String(range.mode)}`);
    }
    const mode = range.mode as PollingMode;
    if (seenModes.has(mode)) {
      throw new Error(`モード "${mode}" が重複して定義されています`);
    }
    seenModes.add(mode);

    if (typeof range.start !== 'string' || typeof range.end !== 'string') {
      throw new TypeError('start および end は HH:mm 形式の文字列である必要があります');
    }

    const startMin = parseTimeStringToMinutes(range.start);
    const endMin = parseTimeStringToMinutes(range.end);

    if (startMin === endMin) {
      throw new Error(`start と end が同一です (${range.start})`);
    }

    if (startMin < endMin) {
      intervals.push({ start: startMin, end: endMin });
    } else {
      intervals.push({ start: startMin, end: MINUTES_PER_DAY });
      intervals.push({ start: 0, end: endMin });
    }
  }

  for (const expectedMode of ALL_POLLING_MODES) {
    if (!seenModes.has(expectedMode)) {
      throw new Error(`モード "${expectedMode}" の定義が不足しています`);
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
    throw new Error(`時間帯範囲が24時間を完全に網羅していません (終了: ${currentMinute}分)`);
  }

  // intervalsSeconds 検査
  if (typeof c.intervalsSeconds !== 'object' || c.intervalsSeconds === null) {
    throw new TypeError('intervalsSeconds はオブジェクトである必要があります');
  }
  const intervalsMap = c.intervalsSeconds as Record<string, unknown>;
  const unexpectedModes = Object.keys(intervalsMap).filter(
    (mode) => !ALL_POLLING_MODES.includes(mode as PollingMode),
  );
  if (unexpectedModes.length > 0) {
    throw new Error(
      `intervalsSeconds に未定義のモード設定があります: ${unexpectedModes.join(', ')}`,
    );
  }

  for (const mode of ALL_POLLING_MODES) {
    const modeMap = intervalsMap[mode];
    if (typeof modeMap !== 'object' || modeMap === null) {
      throw new Error(`intervalsSeconds にモード "${mode}" の設定が存在しません`);
    }
    const sourceMap = modeMap as Record<string, unknown>;
    const unexpectedSources = Object.keys(sourceMap).filter(
      (source) => !ALL_SCHEDULED_SOURCES.includes(source as ScheduledSource),
    );
    if (unexpectedSources.length > 0) {
      throw new Error(
        `intervalsSeconds.${mode} に未定義の取得元設定があります: ${unexpectedSources.join(', ')}`,
      );
    }

    for (const source of ALL_SCHEDULED_SOURCES) {
      const val = sourceMap[source];
      if (mode === 'off_hours') {
        if (val !== null) {
          throw new Error(
            `off_hours の周期はすべて null である必要があります: ${source}=${String(val)}`,
          );
        }
      } else {
        if (val === null) {
          throw new Error(`運用時間モード "${mode}" の ${source} 周期に null は指定できません`);
        }
        if (typeof val !== 'number' || !Number.isSafeInteger(val) || val < 1 || val > 86400) {
          throw new Error(
            `運用時間モード "${mode}" の ${source} 周期は 1〜86400 の有限整数秒である必要があります: ${String(val)}`,
          );
        }
      }
    }
  }

  // amedasPointRecheckSeconds 検査
  if (c.amedasPointRecheckSeconds !== undefined) {
    const s = c.amedasPointRecheckSeconds;
    if (typeof s !== 'number' || !Number.isSafeInteger(s) || s <= 0) {
      throw new Error(`amedasPointRecheckSeconds は正の有限整数である必要があります: ${String(s)}`);
    }
  }

  return config as PollingScheduleConfig;
}
