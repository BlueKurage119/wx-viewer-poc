/**
 * 見出しの発表／観測時刻表示 (G1 §3.3)。
 *
 * JSTで表記する。表示時点のJST日付と同日なら時刻のみ、それ以外は日付を併記する
 * （月日はゼロ埋めなし、時刻はゼロ埋めあり）。
 */
import type { InfoPanelStatus } from './panelDefinitions';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function toJstParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const jstMs = date.getTime() + JST_OFFSET_MS;
  const jst = new Date(jstMs);
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    day: jst.getUTCDate(),
    hour: jst.getUTCHours(),
    minute: jst.getUTCMinutes(),
  };
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

/** `time` (発表／観測時刻) と `timeKind` を、`now` 時点のJST日付を基準に表示文字列へ変換する */
export function formatPanelTime(
  time: string,
  timeKind: 'issued' | 'observed',
  now: Date = new Date(),
): string {
  const target = toJstParts(new Date(time));
  const today = toJstParts(now);
  const suffix = timeKind === 'issued' ? '発表' : '観測';
  const hhmm = `${pad2(target.hour)}:${pad2(target.minute)}`;

  const isSameDay =
    target.year === today.year && target.month === today.month && target.day === today.day;

  if (isSameDay) {
    return `${hhmm}${suffix}`;
  }

  return `${target.month}/${target.day} ${hhmm}${suffix}`;
}

/** occasional種別（速報等）の並べ替え用: data カードの発表・観測時刻を数値化する。data以外は最も古い扱い。 */
export function cardTimeValue(status: InfoPanelStatus): number {
  if (status.kind === 'data') {
    const parsed = Date.parse(status.time);
    return Number.isNaN(parsed) ? -Infinity : parsed;
  }
  return -Infinity;
}
