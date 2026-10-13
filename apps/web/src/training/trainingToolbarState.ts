import type { ToolbarDefinition, ToolbarId } from '../toolbar/operationToolbarState';

/** 訓練画面のツールバーで選べる操作。投入・削除・全削除・抹消・全抹消（選択は常に1つ）。 */
export type TrainingToolbarSelection = 'inject' | 'delete' | 'deleteAll' | 'retract' | 'retractAll';

export type TrainingToolbarItem =
  | {
      readonly kind: 'select';
      readonly selection: TrainingToolbarSelection;
      readonly label: string;
    }
  | { readonly kind: 'navigate'; readonly toolbarId: ToolbarId; readonly label: string };

export const TRAINING_TOOLBAR_ROOT_ID = 'training-root';

/** ツールバー定義（階層の配列）。[[リスト消去, リスト全消], [電文投入], [電文抹消, 電文全抹消]] の3グループ。 */
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
      [
        { kind: 'select', selection: 'retract', label: '電文抹消' },
        { kind: 'select', selection: 'retractAll', label: '電文全抹消' },
      ],
    ],
  },
];

export interface TrainingToolbarCounts {
  /** 一覧でチェックされた行の数。 */
  readonly checked: number;
  /** 一覧の件数。 */
  readonly stock: number;
  /** 投入済みの行でチェックされた（抹消済みを除く）訓練の数。省略は0。 */
  readonly checkedInjected?: number;
  /** 投入済みの行でチェックされた抹消済みの行の数。省略は0。 */
  readonly checkedRetracted?: number;
  /** 一覧にある抹消済みの行の数。省略は0。 */
  readonly retracted?: number;
}

const labels: Readonly<Record<TrainingToolbarSelection, string>> = {
  inject: '電文投入',
  delete: 'リスト消去',
  deleteAll: 'リスト全消',
  retract: '抹消',
  retractAll: '全抹消',
};

export function trainingSelectionLabel(selection: TrainingToolbarSelection): string {
  return labels[selection];
}

/**
 * 項目を新しく選べるか。処理中（投入中・抹消中）は選べない。
 * 投入はローカル行のチェック1件以上、削除はローカル行または抹消済みの行のチェック1件以上、
 * 全削除はローカル行または抹消済みの行1件以上、抹消は未抹消の投入済みの行のチェック1件以上。
 * 全抹消は一覧が空でも選べる（基準電文の取消のため）。
 */
export function canSelectTrainingOperation(
  selection: TrainingToolbarSelection,
  counts: TrainingToolbarCounts,
  busy = false,
): boolean {
  if (busy) return false;
  if (selection === 'inject') return counts.checked > 0;
  if (selection === 'delete') return counts.checked + (counts.checkedRetracted ?? 0) > 0;
  if (selection === 'deleteAll') return counts.stock + (counts.retracted ?? 0) > 0;
  if (selection === 'retract') return (counts.checkedInjected ?? 0) > 0;
  return true;
}

/** 送信できるか。処理中や未選択は不可。選択中でも対象が0件や処理中になったら選択は維持したまま送信だけ押せなくする。 */
export function isTrainingSendReady(
  selection: TrainingToolbarSelection | null,
  counts: TrainingToolbarCounts,
  busy = false,
): boolean {
  if (busy || selection === null) return false;
  return canSelectTrainingOperation(selection, counts, busy);
}

export function trainingDeletedMessage(count: number): string {
  return `${count}件をリストから消去しました`;
}

export function trainingInjectingMessage(count: number): string {
  return `${count}通を電文投入中`;
}

export function trainingRetractingMessage(count: number): string {
  return `${count}件の訓練を抹消中`;
}

export const TRAINING_RETRACTING_ALL_MESSAGE = '訓練データを全抹消中';

export function trainingDeletingMessage(count: number): string {
  return `${count}件をリストから消去中`;
}
