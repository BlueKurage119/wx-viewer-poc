import type { WeatherRole } from '@wx-viewer-poc/shared';
import { createRequestId } from './createRequestId';
import { useEffect, useRef, useState } from 'react';
import { useToolbarNavigation } from '../toolbar/useToolbarNavigation';
import {
  toolbarFocusKey as toolbarFocusKeyCommon,
  type ToolbarFocusRequest,
} from '../toolbar/toolbarFocus';
import { createFetchControlClient } from '../api/fetchControl';
import {
  createMonitoringOperationController,
  type MonitoringOperationController,
  type OperationState,
} from './monitoringOperationController';
import {
  clearToolbarSelection,
  closeMonitoringDialog,
  monitoringToolbarDefinitions,
  isSelectionSubmittable,
  isWorkerRestartSelection,
  openMonitoringDialog,
  selectToolbarOperation,
  selectToolbarWorkerRestart,
  type MonitoringDialogId,
  type ToolbarDefinition,
  type ToolbarItem,
  type ToolbarSelection,
  type ToolbarId,
  type ToolbarLocalState,
} from './monitoringToolbarState';

export interface UseMonitoringToolbarOptions {
  readonly active: boolean;
  readonly definitions?: readonly ToolbarDefinition[];
  readonly rootId?: ToolbarId;
  /** Worker再起動の送信。取得操作の照会とは独立に動く。 */
  readonly submitWorkerRestart?: (role: WeatherRole) => void;
}

export interface MonitoringToolbarModel {
  readonly localState: ToolbarLocalState;
  readonly operationState: OperationState;
  readonly currentToolbar: ToolbarDefinition;
  readonly definitions: readonly ToolbarDefinition[];
  readonly busy: boolean;
  selectOperation(operation: Parameters<typeof selectToolbarOperation>[1]): void;
  selectWorkerRestart(role: WeatherRole): void;
  clearSelection(): void;
  submit(): void;
  openDialog(dialogId: MonitoringDialogId): void;
  closeDialog(): void;
  navigate(toolbarId: ToolbarId): void;
  back(): void;
  backToRoot(): void;
}

export type { ToolbarFocusRequest } from '../toolbar/toolbarFocus';

/** フォーカス先の項目キー（`階層ID:ラベル`）。見つからなければ null。 */
export function toolbarFocusKey(
  definitions: readonly ToolbarDefinition[],
  history: readonly ToolbarId[],
  request: ToolbarFocusRequest,
): string | null {
  return toolbarFocusKeyCommon(
    definitions,
    history,
    request,
    (item, toolbarId) => item.kind === 'navigate' && item.toolbarId === toolbarId,
  );
}

function isBusy(state: OperationState): boolean {
  return state.phase === 'sending' || state.phase === 'checking';
}

/** TerminalAppの寿命に合わせ、表示中かどうかとは独立してE11照会を保持する。 */
export function useMonitoringToolbar({
  active,
  definitions = monitoringToolbarDefinitions,
  rootId = 'monitor-root',
  submitWorkerRestart,
}: UseMonitoringToolbarOptions): MonitoringToolbarModel {
  const submitWorkerRestartRef = useRef(submitWorkerRestart);
  submitWorkerRestartRef.current = submitWorkerRestart;
  const controllerRef = useRef<MonitoringOperationController | null>(null);
  const disposeTimerRef = useRef<number | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createMonitoringOperationController({
      client: createFetchControlClient({ fetch: window.fetch.bind(window) }),
      requestIdFactory: createRequestId,
      setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimeout: (timerId) => window.clearTimeout(timerId),
    });
  }
  const controller = controllerRef.current;
  const navigation = useToolbarNavigation<ToolbarItem, ToolbarSelection, MonitoringDialogId>({
    active,
    definitions,
    rootId,
    isNavigateTo: (item, toolbarId) => item.kind === 'navigate' && item.toolbarId === toolbarId,
    missingMessage: '監視ツールバーのルート定義が見つかりません',
  });
  const { localState, setLocalState } = navigation;
  const [operationState, setOperationState] = useState<OperationState>(() =>
    controller.getSnapshot(),
  );

  useEffect(
    () => controller.subscribe(() => setOperationState(controller.getSnapshot())),
    [controller],
  );
  useEffect(() => {
    const onVisibilityChange = () => controller.setVisible(document.visibilityState !== 'hidden');
    onVisibilityChange();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [controller]);
  useEffect(() => {
    if (disposeTimerRef.current !== null) {
      window.clearTimeout(disposeTimerRef.current);
      disposeTimerRef.current = null;
    }
    return () => {
      // StrictModeのeffect再作成では同じTerminalAppを継続して利用する。
      // 実際のunmountでは次のイベントループで確実に破棄する。
      disposeTimerRef.current = window.setTimeout(() => controller.dispose(), 0);
    };
  }, [controller]);

  const busy = isBusy(operationState);
  return {
    localState,
    operationState,
    currentToolbar: navigation.currentToolbar,
    definitions: navigation.definitions,
    busy,
    selectOperation(operation) {
      if (busy) return;
      setLocalState((state) => selectToolbarOperation(state, operation));
    },
    selectWorkerRestart(role) {
      setLocalState((state) => selectToolbarWorkerRestart(state, role));
    },
    clearSelection: navigation.clearSelection,
    submit() {
      const selection = localState.selectedOperation;
      if (selection === null || !isSelectionSubmittable(selection, busy)) return;
      if (isWorkerRestartSelection(selection)) {
        setLocalState(clearToolbarSelection);
        submitWorkerRestartRef.current?.(selection.role);
        return;
      }
      setLocalState(clearToolbarSelection);
      controller.submit(selection);
    },
    openDialog(dialogId) {
      setLocalState((state) => openMonitoringDialog(state, dialogId));
    },
    closeDialog() {
      setLocalState(closeMonitoringDialog);
    },
    navigate: navigation.navigate,
    back: navigation.back,
    backToRoot: navigation.backToRoot,
  };
}
