export interface OperationLineEntry {
  readonly text: string | null;
  /** 状態が最後に変わった順序。大きいほど新しい。 */
  readonly changedSeq: number;
  /** 受付済み・準備中の再起動など、進行中の行。1件でもあれば完了済みの行より優先する。 */
  readonly active?: boolean;
}

export interface OperationLine {
  readonly text: string;
  /** 複数件あるときだけ、全件を「／」でつないだ補足。 */
  readonly title?: string;
}

/**
 * 通知領域最下段の1行を決める。選択中（selectionLabel が非null）は常に最優先で
 * `「{名}を選択中／送信で実行」`。それ以外は最後に状態が変わった行（進行中があれば進行中を優先）。
 */
export function selectOperationLineFor(
  selectionLabel: string | null,
  entries: readonly OperationLineEntry[],
): OperationLine | null {
  if (selectionLabel !== null) {
    return { text: `${selectionLabel}を選択中／送信で実行` };
  }
  const present = entries.filter(
    (entry): entry is OperationLineEntry & { text: string } => entry.text !== null,
  );
  if (present.length === 0) return null;
  const inProgress = present.filter((entry) => entry.active === true);
  const candidates = inProgress.length > 0 ? inProgress : present;
  const latest = candidates.reduce((a, b) => (b.changedSeq > a.changedSeq ? b : a));
  return present.length > 1
    ? { text: latest.text, title: present.map((entry) => entry.text).join('／') }
    : { text: latest.text };
}
