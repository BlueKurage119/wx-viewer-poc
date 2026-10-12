import type { ToolbarDefinition, ToolbarId } from '../toolbar/operationToolbarState';

/** 訓練画面のツールバーで選べる操作。削除と全削除は排他（選択は常に1つ）。 */
export type TrainingToolbarSelection = 'delete' | 'deleteAll';

export type TrainingToolbarItem =
  | {
      readonly kind: 'select';
      readonly selection: TrainingToolbarSelection;
      readonly label: string;
    }
  | { readonly kind: 'navigate'; readonly toolbarId: ToolbarId; readonly label: string };

export const TRAINING_TOOLBAR_ROOT_ID = 'training-root';

/** ツールバー定義（階層の配列）。J2では投入・取消の選択型項目や子階層(navigate)を足す。 */
export const trainingToolbarDefinitions: readonly ToolbarDefinition<TrainingToolbarItem>[] = [
  {
    id: TRAINING_TOOLBAR_ROOT_ID,
    title: '',
    groups: [
      [
        { kind: 'select', selection: 'delete', label: '削除' },
        { kind: 'select', selection: 'deleteAll', label: '全削除' },
      ],
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
  delete: '削除',
  deleteAll: '全削除',
};

export function trainingSelectionLabel(selection: TrainingToolbarSelection): string {
  return labels[selection];
}

/** 項目を新しく選べるか。削除はチェック1件以上、全削除は一覧1件以上。 */
export function canSelectTrainingOperation(
  selection: TrainingToolbarSelection,
  counts: TrainingToolbarCounts,
): boolean {
  return selection === 'delete' ? counts.checked > 0 : counts.stock > 0;
}

/** 送信できるか。選択中でも、対象が0件になったら選択は維持したまま送信だけ押せなくする。 */
export function isTrainingSendReady(
  selection: TrainingToolbarSelection | null,
  counts: TrainingToolbarCounts,
): boolean {
  return selection !== null && canSelectTrainingOperation(selection, counts);
}

export function trainingDeletedMessage(count: number): string {
  return `${count}件を削除しました`;
}
