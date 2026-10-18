import type { AtomFeedEntry, JmaXmlFeedDefinition, JmaXmlPollTrigger } from './jmaXmlFeeds.js';
import { sanitizeUrl } from './httpGet.js';

/** 初回同期・復旧で「種別×発表官署ごとに直近N件」へ絞る集約型の電文種別 */
export const BACKFILL_AGGREGATE_TELEGRAM_TYPES: ReadonlySet<string> = new Set([
  'VPWS50',
  'VPWP50',
  'VPFD51',
  'VPFD61',
  'VPFW60',
]);

/** 種別×発表官署ごとに取得候補として残す件数（予備を含む） */
export const BACKFILL_LATEST_PER_GROUP = 3;

// .../<YYYYMMDDhhmmss>_<数字>_<種別>_<官署コード6桁>.xml
const AGGREGATE_URL_PATTERN = /(\d{14})_\d+_([A-Z]{4}\d{2})_(\d{6})\.xml$/;

/** initial/recovery かつ long_term フィードのときだけ true */
export function shouldLimitLongFeedBackfill(
  trigger: JmaXmlPollTrigger,
  feedDef: Pick<JmaXmlFeedDefinition, 'role'>,
): boolean {
  return (trigger === 'initial' || trigger === 'recovery') && feedDef.role === 'long_term';
}

/**
 * 取得候補から外す（=取得も記録もしない）エントリのURL集合を返す。
 * 集約5種別以外、URL形式に合わないエントリは決して含めない。
 * 返すURLは sanitizeUrl 適用後の値。入力は変更しない。
 */
export function selectBackfillExcludedUrls(entries: readonly AtomFeedEntry[]): ReadonlySet<string> {
  interface Candidate {
    readonly url: string;
    readonly time: string;
    readonly index: number;
  }
  const groups = new Map<string, Candidate[]>();
  const seen = new Set<string>();

  entries.forEach((entry, index) => {
    const url = sanitizeUrl(entry.documentUrl);
    const match = AGGREGATE_URL_PATTERN.exec(url);
    if (!match) return;
    const [, time, type, office] = match;
    if (!time || !type || !office || !BACKFILL_AGGREGATE_TELEGRAM_TYPES.has(type)) return;
    if (seen.has(url)) return; // 重複URLは1件として数える
    seen.add(url);
    const key = `${type}|${office}`;
    const list = groups.get(key);
    if (list) list.push({ url, time, index });
    else groups.set(key, [{ url, time, index }]);
  });

  const excluded = new Set<string>();
  for (const list of groups.values()) {
    // 時刻降順、同時刻はフィード上の出現順（先が新しい）
    list.sort((a, b) => (a.time === b.time ? a.index - b.index : a.time < b.time ? 1 : -1));
    for (const c of list.slice(BACKFILL_LATEST_PER_GROUP)) excluded.add(c.url);
  }
  return excluded;
}
