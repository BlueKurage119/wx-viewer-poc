/**
 * 監視画面の時刻フォーマッタ群。
 * 画面内で用途に応じて4つの書式を使い分ける:
 * - formatJstDateTime: "YYYY/MM/DD HH:mm:ss"（最終表示更新時刻など）
 * - formatJstTime: "HH:mm"（サマリーカードなど）
 * - formatJstMonthDayClock: "MM/DD HH:mm:ss"（取得元表・情報反映表など。同日でも日付を省略しない）
 * - formatElapsedTime: "hh:mm:ss"（サーバー起動からの運転時間）
 */

export function formatJstTime(value: string): string {
  if (!value || Number.isNaN(Date.parse(value))) {
    return '—';
  }
  try {
    const parts = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(value));
    const hour = parts.find((part) => part.type === 'hour')?.value;
    const minute = parts.find((part) => part.type === 'minute')?.value;
    return hour && minute ? `${hour}:${minute}` : '—';
  } catch {
    return '—';
  }
}

export function formatJstDateTime(value: string): string {
  if (!value || Number.isNaN(Date.parse(value))) {
    return '—';
  }
  try {
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
  } catch {
    return '—';
  }
}

/**
 * 取得元表・情報反映表で用いる共通時刻フォーマッタ。
 * 日付を含め常に MM/DD HH:mm:ss（JST、年は付けない）。
 * 同日であっても日付を省略しない。
 * value が null・空文字・Date.parse 不能なら '—' を返す。
 */
export function formatJstMonthDayClock(value: string | null): string {
  if (!value || Number.isNaN(Date.parse(value))) {
    return '—';
  }
  try {
    const parts = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date(value));
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value;
    const month = get('month');
    const day = get('day');
    const hour = get('hour');
    const minute = get('minute');
    const second = get('second');
    return month && day && hour && minute && second
      ? `${month}/${day} ${hour}:${minute}:${second}`
      : '—';
  } catch {
    return '—';
  }
}

/**
 * 経過秒数を "hh:mm:ss" 形式の文字列へ整形する。
 * - 24時間を超えた場合も日数は分けず、時間部を2桁以上で累積する（例: 25:00:00）。
 * - 負数または NaN、非有限数の場合は "00:00:00" を返す。
 *
 * @param elapsedSeconds 経過秒数（整数または実数、内部で Math.floor される）
 * @returns "hh:mm:ss" 形式の文字列
 */
export function formatElapsedTime(elapsedSeconds: number): string {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
    return '00:00:00';
  }
  const totalSec = Math.floor(elapsedSeconds);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
