import type { WeatherRole } from '@wx-viewer-poc/shared';
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
  isSelectionSubmittable,
  isWorkerRestartSelection,
  openMonitoringDialog,
  selectToolbarOperation,
  selectToolbarWorkerRestart,
  type MonitoringDialogId,
  type ToolbarDefinition,
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

export type ToolbarFocusRequest =
  | { readonly kind: 'first' }
  /** 戻った先で、指定の階層へ進む navigate 項目へフォーカスする。 */
  | { readonly kind: 'navigate'; readonly fromId: ToolbarId };

/** フォーカス先の項目キー（`階層ID:ラベル`）。見つからなければ null。 */
export function toolbarFocusKey(
  definitions: readonly ToolbarDefinition[],
  history: readonly ToolbarId[],
  request: ToolbarFocusRequest,
): string | null {
  const currentId = history.at(-1);
  const current = definitions.find((definition) => definition.id === currentId);
  if (!current) return null;
  if (request.kind === 'first') {
    const first = current.groups.flat()[0];
    return first ? `${current.id}:${first.label}` : null;
  }
  for (const item of current.groups.flat()) {
    if (item.kind === 'navigate' && item.toolbarId === request.fromId)
      return `${current.id}:${item.label}`;
  }
  return null;
}

/** 描画直後の Lit 要素は内部の button が未生成のため、更新完了を待ってからフォーカスする。 */
function focusToolbarItem(key: string): void {
  const element = document.querySelector<HTMLElement>(`[data-toolbar-item="${CSS.escape(key)}"]`);
  if (!element) return;
  const updateComplete = (element as HTMLElement & { updateComplete?: Promise<unknown> })
    .updateComplete;
  if (updateComplete) void updateComplete.then(() => element.focus());
  else element.focus();
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
  const definitionsRef = useRef(definitions);
  const rootIdRef = useRef(rootId);
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

  // 階層移動後のフォーカス: 進むときは先頭の項目、戻るときは移動元の navigate 項目へ。
  const focusRequest = useRef<ToolbarFocusRequest | null>(null);
  const historyKey = localState.history.join('>');
  useEffect(() => {
    const request = focusRequest.current;
    focusRequest.current = null;
    if (!request) return;
    const key = toolbarFocusKey(definitionsRef.current, localState.history, request);
    if (key) focusToolbarItem(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyKey]);

  const busy = isBusy(operationState);
  return {
    localState,
    operationState,
    currentToolbar: currentToolbar(localState, definitionsRef.current),
    definitions: definitionsRef.current,
    busy,
    selectOperation(operation) {
      if (busy) return;
      setLocalState((state) => selectToolbarOperation(state, operation));
    },
    selectWorkerRestart(role) {
      setLocalState((state) => selectToolbarWorkerRestart(state, role));
    },
    clearSelection() {
      setLocalState(clearToolbarSelection);
    },
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
    navigate(toolbarId) {
      focusRequest.current = { kind: 'first' };
      setLocalState((state) => navigateToolbar(state, definitionsRef.current, toolbarId));
    },
    back() {
      const history = localState.history;
      if (history.length > 1) focusRequest.current = { kind: 'navigate', fromId: history.at(-1)! };
      setLocalState(backToolbar);
    },
    backToRoot() {
      const history = localState.history;
      if (history.length > 1) focusRequest.current = { kind: 'navigate', fromId: history[1]! };
      setLocalState(backToolbarToRoot);
    },
  };
}
