import { useEffect, useMemo, useRef, useState } from 'react';
import type { TrainingItemId } from '@wx-viewer-poc/shared';
import {
  INITIAL_TRAINING_STATE,
  createTrainingController,
  type TrainingController,
  type TrainingState,
} from './trainingController';

export interface TrainingActions {
  readonly select: (group: string, itemId: TrainingItemId | null) => void;
  readonly generate: () => void;
  readonly reset: () => void;
  readonly reload: () => void;
  readonly setChecked: (entryId: string, checked: boolean) => void;
  readonly deleteChecked: () => void;
}

/**
 * 訓練画面の状態と操作。ツールバー（AppShellのスロット）と本体で同じ状態を共有するため、
 * 端末画面の側で保持する。enabled が false の間はコントローラを作らない（通信も保存の読込みもしない）。
 */
export function useTrainingScreen(
  terminalId: string,
  enabled: boolean,
): { readonly state: TrainingState; readonly actions: TrainingActions } {
  const [state, setState] = useState<TrainingState>(INITIAL_TRAINING_STATE);
  const controllerRef = useRef<TrainingController | null>(null);
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
  const actions = useMemo<TrainingActions>(
    () => ({
      select: (group, itemId) => controllerRef.current?.selectInGroup(group, itemId),
      generate: () => controllerRef.current?.generate(),
      reset: () => controllerRef.current?.reset(),
      reload: () => controllerRef.current?.start(),
      setChecked: (entryId, checked) => controllerRef.current?.setChecked(entryId, checked),
      deleteChecked: () => controllerRef.current?.deleteChecked(),
    }),
    [],
  );
  return { state, actions };
}
