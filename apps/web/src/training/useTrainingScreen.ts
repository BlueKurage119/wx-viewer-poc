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
  trainingInjectingMessage,
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
  venueId?: string,
): {
  readonly state: TrainingState;
  readonly actions: TrainingActions;
  readonly toolbar: TrainingToolbarModel;
  /** 共通通知領域の操作行（選択中の案内、または投入・削除結果）。 */
  readonly operationLine: OperationLine | null;
} {
  const [state, setState] = useState<TrainingState>(INITIAL_TRAINING_STATE);
  const controllerRef = useRef<TrainingController | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const activeTerminalRef = useRef(terminalId);
  activeTerminalRef.current = terminalId;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

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
    controller.startInjectedWatch();
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [terminalId, enabled]);

  useEffect(() => {
    // 画面離脱・端末切替で操作行の結果表示を消す（選択はナビゲーション側がルートへ戻して破棄する）。
    setStatusMessage(null);
  }, [enabled, terminalId]);

  const { clearSelection, setLocalState } = navigation;
  const selection = navigation.localState.selectedOperation;
  const counts = { checked: state.checked.length, stock: state.history.length };
  const sendReady = isTrainingSendReady(selection, counts, state.injecting);

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
      if (selection !== next && !canSelectTrainingOperation(next, counts, state.injecting)) return;
      setStatusMessage(null);
      setLocalState((current) => toggleToolbarSelection(current, next));
    },
    clear() {
      clearSelection();
    },
    send() {
      if (selection === null || !sendReady) return;
      const currentSelection = selection;
      clearSelection();
      if (currentSelection === 'inject') {
        const injectCount = state.checked.length;
        setStatusMessage(trainingInjectingMessage(injectCount));
        const currentTerminal = terminalId;
        controllerRef.current?.injectChecked(venueId).then((result) => {
          if (!enabledRef.current || activeTerminalRef.current !== currentTerminal) return;
          setStatusMessage(result.message);
        });
      } else if (currentSelection === 'delete') {
        const count = controllerRef.current?.deleteChecked() ?? 0;
        setStatusMessage(trainingDeletedMessage(count));
      } else {
        const count = controllerRef.current?.deleteAll() ?? 0;
        setStatusMessage(trainingDeletedMessage(count));
      }
    },
  };

  const operationLine = selectOperationLineFor(
    selection === null ? null : trainingSelectionLabel(selection),
    [{ text: statusMessage, changedSeq: 0 }],
  );

  return { state, actions, toolbar, operationLine };
}
