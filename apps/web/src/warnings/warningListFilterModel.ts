import type { NotificationCategory, NotificationFeedItem } from '@wx-viewer-poc/shared';

export interface WarningListFilterDraft {
  readonly category: NotificationCategory | 'all';
  readonly sourceType: string;
  readonly fromLocal: string;
  readonly toLocal: string;
}

export interface WarningListFilter {
  readonly category: NotificationCategory | 'all';
  readonly sourceType: string;
  readonly fromEpochMs: number | null;
  readonly toEpochMs: number | null;
}

export type WarningListFilterParseResult =
  | { readonly ok: true; readonly filter: WarningListFilter }
  | { readonly ok: false; readonly message: string };

export interface WarningListSearchState {
  readonly draft: WarningListFilterDraft;
  readonly applied: WarningListFilter;
  readonly error: string | null;
}

export function createWarningListSearchState(): WarningListSearchState {
  return {
    draft: { category: 'all', sourceType: 'all', fromLocal: '', toLocal: '' },
    applied: { category: 'all', sourceType: 'all', fromEpochMs: null, toEpochMs: null },
    error: null,
  };
}

/** ブラウザーのタイムゾーンを使わず、暦日も検証してJSTの秒へ変換する。 */
function parseJst(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, seconds] = match;
  const normalized = `${year}-${month}-${day}T${hour}:${minute}:${seconds ?? '00'}`;
  const time = Date.parse(`${normalized}+09:00`);
  if (!Number.isFinite(time)) return null;
  // Date.parseが補正する2月30日などは入力エラーとする。
  return new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 19) === normalized
    ? time
    : null;
}

export function parseWarningListFilter(
  draft: WarningListFilterDraft,
): WarningListFilterParseResult {
  const from = draft.fromLocal === '' ? null : parseJst(draft.fromLocal);
  const to = draft.toLocal === '' ? null : parseJst(draft.toLocal);
  if ((draft.fromLocal !== '' && from === null) || (draft.toLocal !== '' && to === null))
    return { ok: false, message: '日時を正しく入力してください。' };
  if (from !== null && to !== null && from > to)
    return { ok: false, message: '開始日時は終了日時以前にしてください。' };
  return {
    ok: true,
    filter: {
      category: draft.category,
      sourceType: draft.sourceType,
      fromEpochMs: from,
      toEpochMs: to,
    },
  };
}

export function applyWarningListSearch(state: WarningListSearchState): WarningListSearchState {
  const result = parseWarningListFilter(state.draft);
  return result.ok
    ? { ...state, applied: result.filter, error: null }
    : { ...state, error: result.message };
}

export function matchesWarningListFilter(
  item: NotificationFeedItem,
  filter: WarningListFilter,
): boolean {
  const occurredAtMs = Date.parse(item.occurredAt);
  return (
    (filter.category === 'all' || item.category === filter.category) &&
    (filter.sourceType === 'all' || item.sourceType === filter.sourceType) &&
    (filter.fromEpochMs === null || occurredAtMs >= filter.fromEpochMs) &&
    (filter.toEpochMs === null || occurredAtMs <= filter.toEpochMs)
  );
}

export function filterWarningListItems(
  items: readonly NotificationFeedItem[],
  filter: WarningListFilter,
): readonly NotificationFeedItem[] {
  return items.filter((item) => matchesWarningListFilter(item, filter));
}
