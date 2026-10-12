import { useEffect, useMemo, useRef, useState } from 'react';
import type { TrainingItemId } from '@wx-viewer-poc/shared';
import { selectOperationLineFor, type OperationLine } from '../toolbar/operationLine';
import { toggleToolbarSelection } from '../toolbar/operationToolbarState';
import { useToolbarNavigation, type ToolbarNavigation } from '../toolbar/useToolbarNavigation';
import {
  INITIAL_TRAINING_STATE,
  createTrainingController,
  type TrainingController,
  type TrainingState,
} from './trainingController';
import {
  TRAINING_TOOLBAR_ROOT_ID,
  canSelectTrainingOperation,
  isTrainingSendReady,
  trainingDeletedMessage,
  trainingSelectionLabel,
  trainingToolbarDefinitions,
  type TrainingToolbarItem,
  type TrainingToolbarSelection,
} from './trainingToolbarState';

export interface TrainingActions {
  readonly select: (group: string, itemId: TrainingItemId | null) => void;
  readonly generate: () => void;
  readonly reset: () => void;
  readonly reload: () => void;
  readonly setChecked: (entryId: string, checked: boolean) => void;
  /** XMLダイアログを開くときに呼ぶ。ツールバーの選択を破棄する（監視のダイアログ表示と同じ）。 */
  readonly onDialogOpen: () => void;
}

export interface TrainingToolbarModel {
  readonly navigation: ToolbarNavigation<TrainingToolbarItem, TrainingToolbarSelection, never>;
  readonly counts: { readonly checked: number; readonly stock: number };
  readonly selection: TrainingToolbarSelection | null;
  readonly sendReady: boolean;
  /** 項目の押下（選択のトグル）。対象が0件で選べない項目は、選択中でなければ何もしない。 */
  selectOperation(selection: TrainingToolbarSelection): void;
  clear(): void;
  send(): void;
}

/**
 * 訓練画面の状態と操作。ツールバー（AppShellのスロット）と本体で同じ状態を共有するため、
 * 端末画面の側で保持する。enabled が false の間はコントローラを作らない（通信も保存の読込みもしない）。
 */
export function useTrainingScreen(
  terminalId: string,
  enabled: boolean,
): {
  readonly state: TrainingState;
  readonly actions: TrainingActions;
  readonly toolbar: TrainingToolbarModel;
  /** 共通通知領域の操作行（選択中の案内、または削除結果）。 */
  readonly operationLine: OperationLine | null;
} {
  const [state, setState] = useState<TrainingState>(INITIAL_TRAINING_STATE);
  const controllerRef = useRef<TrainingController | null>(null);
  const [deletedMessage, setDeletedMessage] = useState<string | null>(null);
  const navigation = useToolbarNavigation<TrainingToolbarItem, TrainingToolbarSelection, never>({
    active: enabled,
    definitions: trainingToolbarDefinitions,
    rootId: TRAINING_TOOLBAR_ROOT_ID,
    isNavigateTo: (item, toolbarId) => item.kind === 'navigate' && item.toolbarId === toolbarId,
    missingMessage: '訓練ツールバーのルート定義が見つかりません',
  });
  useEffect(() => {
    if (!enabled) return;
    const controller = createTrainingController(terminalId, setState);
    controllerRef.current = controller;
    controller.start();
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [terminalId, enabled]);
  useEffect(() => {
    // 画面離脱で操作行の結果表示を消す（選択はナビゲーション側がルートへ戻して破棄する）。
    if (!enabled) setDeletedMessage(null);
  }, [enabled]);

  const { clearSelection, setLocalState } = navigation;
  const selection = navigation.localState.selectedOperation;
  const counts = { checked: state.checked.length, stock: state.history.length };
  const sendReady = isTrainingSendReady(selection, counts);

  const actions = useMemo<TrainingActions>(
    () => ({
      select: (group, itemId) => controllerRef.current?.selectInGroup(group, itemId),
      generate: () => controllerRef.current?.generate(),
      reset: () => controllerRef.current?.reset(),
      reload: () => controllerRef.current?.start(),
      setChecked: (entryId, checked) => controllerRef.current?.setChecked(entryId, checked),
      onDialogOpen: () => clearSelection(),
    }),
    [clearSelection],
  );

  const toolbar: TrainingToolbarModel = {
    navigation,
    counts,
    selection,
    sendReady,
    selectOperation(next) {
      if (selection !== next && !canSelectTrainingOperation(next, counts)) return;
      setDeletedMessage(null);
      setLocalState((current) => toggleToolbarSelection(current, next));
    },
    clear() {
      clearSelection();
    },
    send() {
      if (selection === null || !sendReady) return;
      clearSelection();
      const count =
        selection === 'delete'
          ? (controllerRef.current?.deleteChecked() ?? 0)
          : (controllerRef.current?.deleteAll() ?? 0);
      setDeletedMessage(trainingDeletedMessage(count));
    },
  };
  const operationLine = selectOperationLineFor(
    selection === null ? null : trainingSelectionLabel(selection),
    [{ text: deletedMessage, changedSeq: 0 }],
  );
  return { state, actions, toolbar, operationLine };
}
