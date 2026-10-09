import type { FetchControlOperationKind, WeatherRole } from '@wx-viewer-poc/shared';

export type ToolbarId = string;
export type MonitoringDialogId =
  'reception' | 'telegram' | 'output' | 'diagnostics' | 'workerRestartHistory';
export interface WorkerRestartSelection {
  readonly kind: 'workerRestart';
  readonly role: WeatherRole;
}
/** 選択中の操作。取得操作は種別の文字列、Worker再起動は役割を持つ。 */
export type ToolbarSelection = FetchControlOperationKind | WorkerRestartSelection;
export type ToolbarItem =
  | {
      readonly kind: 'operation';
      readonly operation: FetchControlOperationKind;
      readonly label: string;
    }
  | { readonly kind: 'dialog'; readonly dialogId: MonitoringDialogId; readonly label: string }
  | { readonly kind: 'navigate'; readonly toolbarId: ToolbarId; readonly label: string }
  | { readonly kind: 'workerRestart'; readonly role: WeatherRole; readonly label: string };
export interface ToolbarDefinition {
  readonly id: ToolbarId;
  readonly title: string;
  readonly groups: readonly (readonly ToolbarItem[])[];
}
export interface ToolbarLocalState {
  readonly history: readonly ToolbarId[];
  readonly selectedOperation: ToolbarSelection | null;
  readonly openDialog: MonitoringDialogId | null;
}

export const MONITORING_TOOLBAR_ROOT_ID = 'monitor-root';
export const MONITORING_TOOLBAR_WORKER_ID = 'monitor-worker';
export const MONITORING_TOOLBAR_HISTORY_ID = 'monitor-history';
export const monitoringToolbarDefinitions: readonly ToolbarDefinition[] = [
  {
    id: MONITORING_TOOLBAR_ROOT_ID,
    title: '',
    groups: [
      [
        { kind: 'operation', operation: 'start', label: '取得開始' },
        { kind: 'operation', operation: 'stop', label: '取得停止' },
        { kind: 'operation', operation: 'force_refresh', label: '強制更新' },
      ],
      [
        { kind: 'navigate', toolbarId: MONITORING_TOOLBAR_WORKER_ID, label: 'Worker' },
        { kind: 'navigate', toolbarId: MONITORING_TOOLBAR_HISTORY_ID, label: '履歴' },
      ],
      [{ kind: 'dialog', dialogId: 'diagnostics', label: '状態診断' }],
    ],
  },
  {
    id: MONITORING_TOOLBAR_WORKER_ID,
    title: 'Worker',
    groups: [
      [
        { kind: 'workerRestart', role: 'acquisition', label: '取得再起動' },
        { kind: 'workerRestart', role: 'delivery', label: '提供再起動' },
      ],
    ],
  },
  {
    id: MONITORING_TOOLBAR_HISTORY_ID,
    title: '履歴',
    groups: [
      [
        { kind: 'dialog', dialogId: 'reception', label: '受信' },
        { kind: 'dialog', dialogId: 'telegram', label: '電文' },
        { kind: 'dialog', dialogId: 'output', label: '通知出力' },
      ],
      [{ kind: 'dialog', dialogId: 'workerRestartHistory', label: 'Worker' }],
    ],
  },
];

const operationLabels: Readonly<Record<FetchControlOperationKind, string>> = {
  start: '取得開始',
  stop: '取得停止',
  force_refresh: '強制更新',
};
const restartLabels: Readonly<Record<WeatherRole, string>> = {
  acquisition: '取得再起動',
  delivery: '提供再起動',
};

export function isWorkerRestartSelection(
  selection: ToolbarSelection | null,
): selection is WorkerRestartSelection {
  return selection !== null && typeof selection === 'object';
}

/**
 * 送信できる選択か。取得操作は取得の照会中は送れないが、Worker再起動は互いに独立で送れる。
 */
export function isSelectionSubmittable(
  selection: ToolbarSelection | null,
  fetchOperationBusy: boolean,
): boolean {
  return selection !== null && (isWorkerRestartSelection(selection) || !fetchOperationBusy);
}

/** 選択中の操作の表示名。送信ボタンの読み上げ名と操作行に使う。 */
export function toolbarSelectionLabel(selection: ToolbarSelection): string {
  return isWorkerRestartSelection(selection)
    ? restartLabels[selection.role]
    : operationLabels[selection];
}

export function createToolbarLocalState(rootId: ToolbarId): ToolbarLocalState {
  return { history: [rootId], selectedOperation: null, openDialog: null };
}

export function currentToolbar(
  state: ToolbarLocalState,
  definitions: readonly ToolbarDefinition[],
): ToolbarDefinition {
  const currentId = state.history.at(-1);
  const current = definitions.find((definition) => definition.id === currentId);
  if (!current) throw new Error('監視ツールバーのルート定義が見つかりません');
  return current;
}

export function selectToolbarOperation(
  state: ToolbarLocalState,
  operation: FetchControlOperationKind,
): ToolbarLocalState {
  return {
    ...state,
    selectedOperation: state.selectedOperation === operation ? null : operation,
  };
}

export function selectToolbarWorkerRestart(
  state: ToolbarLocalState,
  role: WeatherRole,
): ToolbarLocalState {
  const current = state.selectedOperation;
  return {
    ...state,
    selectedOperation:
      isWorkerRestartSelection(current) && current.role === role
        ? null
        : { kind: 'workerRestart', role },
  };
}

export function clearToolbarSelection(state: ToolbarLocalState): ToolbarLocalState {
  return { ...state, selectedOperation: null };
}

export function openMonitoringDialog(
  state: ToolbarLocalState,
  dialogId: MonitoringDialogId,
): ToolbarLocalState {
  return { ...state, selectedOperation: null, openDialog: dialogId };
}

export function closeMonitoringDialog(state: ToolbarLocalState): ToolbarLocalState {
  return { ...state, selectedOperation: null, openDialog: null };
}

export function navigateToolbar(
  state: ToolbarLocalState,
  definitions: readonly ToolbarDefinition[],
  toolbarId: ToolbarId,
): ToolbarLocalState {
  const currentId = state.history.at(-1);
  if (toolbarId === currentId || !definitions.some((definition) => definition.id === toolbarId)) {
    return state;
  }
  return { history: [...state.history, toolbarId], selectedOperation: null, openDialog: null };
}

export function backToolbar(state: ToolbarLocalState): ToolbarLocalState {
  if (state.history.length <= 1) return state;
  return { history: state.history.slice(0, -1), selectedOperation: null, openDialog: null };
}

export function backToolbarToRoot(state: ToolbarLocalState): ToolbarLocalState {
  if (state.history.length <= 1) return state;
  return { history: [state.history[0]!], selectedOperation: null, openDialog: null };
}

/** 監視画面から離れたとき。階層・選択・ダイアログをすべて破棄してルートへ戻す。 */
export function resetToolbarToRoot(state: ToolbarLocalState): ToolbarLocalState {
  if (state.history.length <= 1 && state.selectedOperation === null && state.openDialog === null)
    return state;
  return { history: [state.history[0]!], selectedOperation: null, openDialog: null };
}
