import { createRequestId } from './createRequestId';
import { useEffect, useRef, useState } from 'react';
import { createFetchControlClient } from '../api/fetchControl';
import {
  createMonitoringOperationController,
  type MonitoringOperationController,
  type OperationState,
} from './monitoringOperationController';
import {
  backToolbar,
  backToolbarToRoot,
  clearToolbarSelection,
  closeMonitoringDialog,
  createToolbarLocalState,
  currentToolbar,
  monitoringToolbarDefinitions,
  navigateToolbar,
  openMonitoringDialog,
  selectToolbarOperation,
  type MonitoringDialogId,
  type ToolbarDefinition,
  type ToolbarId,
  type ToolbarLocalState,
} from './monitoringToolbarState';

export interface UseMonitoringToolbarOptions {
  readonly active: boolean;
  readonly definitions?: readonly ToolbarDefinition[];
  readonly rootId?: ToolbarId;
}

export interface MonitoringToolbarModel {
  readonly localState: ToolbarLocalState;
  readonly operationState: OperationState;
  readonly currentToolbar: ToolbarDefinition;
  readonly busy: boolean;
  selectOperation(operation: Parameters<typeof selectToolbarOperation>[1]): void;
  clearSelection(): void;
  submit(): void;
  openDialog(dialogId: MonitoringDialogId): void;
  closeDialog(): void;
  navigate(toolbarId: ToolbarId): void;
  back(): void;
  backToRoot(): void;
}

function isBusy(state: OperationState): boolean {
  return state.phase === 'sending' || state.phase === 'checking';
}

/** TerminalAppの寿命に合わせ、表示中かどうかとは独立してE11照会を保持する。 */
export function useMonitoringToolbar({
  active,
  definitions = monitoringToolbarDefinitions,
  rootId = 'monitor-root',
}: UseMonitoringToolbarOptions): MonitoringToolbarModel {
  const definitionsRef = useRef(definitions);
  const rootIdRef = useRef(rootId);
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
  const [localState, setLocalState] = useState(() => createToolbarLocalState(rootIdRef.current));
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
  useEffect(() => {
    if (active) return;
    setLocalState((state) => closeMonitoringDialog(clearToolbarSelection(state)));
  }, [active]);

  const busy = isBusy(operationState);
  return {
    localState,
    operationState,
    currentToolbar: currentToolbar(localState, definitionsRef.current),
    busy,
    selectOperation(operation) {
      if (busy) return;
      setLocalState((state) => selectToolbarOperation(state, operation));
    },
    clearSelection() {
      if (busy) return;
      setLocalState(clearToolbarSelection);
    },
    submit() {
      if (busy || localState.selectedOperation === null) return;
      const operation = localState.selectedOperation;
      setLocalState(clearToolbarSelection);
      controller.submit(operation);
    },
    openDialog(dialogId) {
      setLocalState((state) => openMonitoringDialog(state, dialogId));
    },
    closeDialog() {
      setLocalState(closeMonitoringDialog);
    },
    navigate(toolbarId) {
      setLocalState((state) => navigateToolbar(state, definitionsRef.current, toolbarId));
    },
    back() {
      setLocalState(backToolbar);
    },
    backToRoot() {
      setLocalState(backToolbarToRoot);
    },
  };
}
