import { formatPanelTime } from '../panelTime';
export type IssuedTime =
  | { readonly kind: 'loading' | 'unavailable' | 'unknown' }
  | { readonly kind: 'issued'; readonly value: string };
export interface IssuedTimes {
  readonly near: IssuedTime;
  readonly far: IssuedTime;
}
function text(time: IssuedTime): string {
  if (time.kind === 'loading') return '取得中';
  if (time.kind === 'unavailable') return '未取得';
  if (time.kind === 'unknown') return '発表時刻不明';
  if (time.kind !== 'issued') return '未取得';
  return formatPanelTime(time.value, 'issued');
}
export function formatNearIssuedTime(time: IssuedTime): string {
  return `明後日まで: ${text(time)}`;
}
export function formatIssuedTimes(times: IssuedTimes): string {
  return `明後日まで: ${text(times.near)} · 明々後日以降: ${text(times.far)}`;
}
