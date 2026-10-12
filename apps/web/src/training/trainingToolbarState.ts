import type { ToolbarDefinition, ToolbarId } from '../toolbar/operationToolbarState';

/** 訓練画面のツールバーで選べる操作。投入・削除・全削除（選択は常に1つ）。 */
export type TrainingToolbarSelection = 'inject' | 'delete' | 'deleteAll';

export type TrainingToolbarItem =
  | {
      readonly kind: 'select';
      readonly selection: TrainingToolbarSelection;
      readonly label: string;
    }
  | { readonly kind: 'navigate'; readonly toolbarId: ToolbarId; readonly label: string };

export const TRAINING_TOOLBAR_ROOT_ID = 'training-root';

/** ツールバー定義（階層の配列）。[[リスト消去, リスト全消], [電文投入]] の2グループ。 */
export const trainingToolbarDefinitions: readonly ToolbarDefinition<TrainingToolbarItem>[] = [
  {
    id: TRAINING_TOOLBAR_ROOT_ID,
    title: '',
    groups: [
      [
        { kind: 'select', selection: 'delete', label: 'リスト消去' },
        { kind: 'select', selection: 'deleteAll', label: 'リスト全消' },
      ],
      [{ kind: 'select', selection: 'inject', label: '電文投入' }],
    ],
  },
];

export interface TrainingToolbarCounts {
  /** 一覧でチェックされた行の数。 */
  readonly checked: number;
  /** 一覧の件数。 */
  readonly stock: number;
}

const labels: Readonly<Record<TrainingToolbarSelection, string>> = {
  inject: '電文投入',
  delete: 'リスト消去',
  deleteAll: 'リスト全消',
};

export function trainingSelectionLabel(selection: TrainingToolbarSelection): string {
  return labels[selection];
}

/** 項目を新しく選べるか。投入・削除はチェック1件以上かつ投入中でない、全削除は一覧1件以上かつ投入中でない。 */
export function canSelectTrainingOperation(
  selection: TrainingToolbarSelection,
  counts: TrainingToolbarCounts,
  injecting = false,
): boolean {
  if (injecting) return false;
  if (selection === 'inject') return counts.checked > 0;
  if (selection === 'delete') return counts.checked > 0;
  return counts.stock > 0;
}

/** 送信できるか。投入中や未選択は不可。選択中でも対象が0件や投入中になったら選択は維持したまま送信だけ押せなくする。 */
export function isTrainingSendReady(
  selection: TrainingToolbarSelection | null,
  counts: TrainingToolbarCounts,
  injecting = false,
): boolean {
  if (injecting || selection === null) return false;
  return canSelectTrainingOperation(selection, counts, injecting);
}

export function trainingDeletedMessage(count: number): string {
  return `${count}件をリストから消去しました`;
}

export function trainingInjectingMessage(count: number): string {
  return `${count}通を電文投入中`;
}
