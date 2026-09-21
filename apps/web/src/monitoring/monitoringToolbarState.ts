import type { FetchControlOperationKind } from '@wx-viewer-poc/shared';

export type ToolbarId = string;
export type MonitoringDialogId = 'reception' | 'telegram' | 'output' | 'diagnostics';
export type ToolbarItem =
  | {
      readonly kind: 'operation';
      readonly operation: FetchControlOperationKind;
      readonly label: string;
    }
  | { readonly kind: 'dialog'; readonly dialogId: MonitoringDialogId; readonly label: string }
  | { readonly kind: 'navigate'; readonly toolbarId: ToolbarId; readonly label: string };
export interface ToolbarDefinition {
  readonly id: ToolbarId;
  readonly title: string;
  readonly groups: readonly (readonly ToolbarItem[])[];
}
export interface ToolbarLocalState {
  readonly history: readonly ToolbarId[];
  readonly selectedOperation: FetchControlOperationKind | null;
  readonly openDialog: MonitoringDialogId | null;
}

export const MONITORING_TOOLBAR_ROOT_ID = 'monitor-root';
export const monitoringToolbarDefinitions: readonly ToolbarDefinition[] = [
  {
    id: MONITORING_TOOLBAR_ROOT_ID,
    title: '',
    groups: [
      [
        { kind: 'operation', operation: 'start', label: '取得開始' },
        { kind: 'operation', operation: 'stop', label: '取得停止' },
      ],
      [{ kind: 'operation', operation: 'force_refresh', label: '強制更新' }],
      [
        { kind: 'dialog', dialogId: 'reception', label: '受信履歴' },
        { kind: 'dialog', dialogId: 'telegram', label: '電文履歴' },
        { kind: 'dialog', dialogId: 'output', label: '出力履歴' },
      ],
      [{ kind: 'dialog', dialogId: 'diagnostics', label: '状態診断' }],
    ],
  },
];

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
