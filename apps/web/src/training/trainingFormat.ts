const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** UTC ISO を「2026/10/11 14:10」（JST）に整形する。不正値はそのまま返す。 */
export function formatTrainingJst(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms + JST_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
