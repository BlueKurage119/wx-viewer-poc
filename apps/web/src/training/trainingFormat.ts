const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** UTC ISO を「2026/10/11 14:10」（JST）に整形する。不正値はそのまま返す。 */
export function formatTrainingJst(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms + JST_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** UTC ISO を JST の「HH:mm:ss」に整形する。不正値はそのまま返す。 */
export function formatTrainingJstTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms + JST_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export interface TrainingInjectAdoptionLike {
  readonly venueId: string;
  readonly adoptionResult: string | null;
  readonly adoptionReason: string | null;
}

export interface TrainingInjectedTelegramLike {
  readonly adoptions: readonly TrainingInjectAdoptionLike[];
}

export interface TrainingInjectResponseLike {
  readonly telegrams: readonly TrainingInjectedTelegramLike[];
}

/**
 * 投入成功メッセージを整形する。
 * 自端末の会場（venueId）の採用結果が「…として解析済み」で終わらない電文が m 通あれば
 * 「{n}通を投入しました（{m}通は会場で採用されませんでした）」、なければ「{n}通を投入しました」。
 * 基準電文は含まない。
 */
export function formatTrainingInjectSuccessMessage(
  response: TrainingInjectResponseLike,
  venueId?: string,
): string {
  const n = response.telegrams.length;
  if (!venueId) {
    return `${n}通を投入しました`;
  }
  const m = response.telegrams.filter((telegram) => {
    const adoption = telegram.adoptions.find((a) => a.venueId === venueId);
    return (
      !adoption || !adoption.adoptionResult || !adoption.adoptionResult.endsWith('として解析済み')
    );
  }).length;
  if (m > 0) {
    return `${n}通を投入しました（${m}通は会場で採用されませんでした）`;
  }
  return `${n}通を投入しました`;
}
