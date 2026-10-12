import type { WeatherRole } from '@wx-viewer-poc/shared';
import { OperationToolbar, type OperationToolbarItem } from '../toolbar/OperationToolbar';
import type { MonitoringToolbarModel } from './useMonitoringToolbar';
import {
  isSelectionSubmittable,
  isWorkerRestartSelection,
  toolbarSelectionLabel,
} from './monitoringToolbarState';

export interface WorkerRestartButtonState {
  readonly canRestart: boolean;
  /** 押せない理由を示すカードの再開可否要素のID。 */
  readonly describedBy?: string;
}
const NO_RESTART: Readonly<Record<WeatherRole, WorkerRestartButtonState>> = {
  acquisition: { canRestart: false },
  delivery: { canRestart: false },
};

/** K2の操作表示。送信・照会の実行は親のTerminalAppに保持する。 */
export function MonitoringToolbar({
  model,
  workerRestart = NO_RESTART,
}: {
  readonly model: MonitoringToolbarModel;
  readonly workerRestart?: Readonly<Record<WeatherRole, WorkerRestartButtonState>>;
}) {
  const { localState, currentToolbar, busy } = model;
  const selection = localState.selectedOperation;
  const sendReady = isSelectionSubmittable(selection, busy);
  const groups: OperationToolbarItem[][] = currentToolbar.groups.map((group) =>
    group.map((item): OperationToolbarItem => {
      if (item.kind === 'operation') {
        return {
          kind: 'select',
          label: item.label,
          selected: selection === item.operation,
          disabled: busy,
          onSelect: () => model.selectOperation(item.operation),
        };
      }
      if (item.kind === 'workerRestart') {
        const state = workerRestart[item.role];
        return {
          kind: 'select',
          label: item.label,
          selected: isWorkerRestartSelection(selection) && selection.role === item.role,
          softDisabled: !state.canRestart,
          describedBy: state.describedBy,
          onSelect: () => {
            if (state.canRestart) model.selectWorkerRestart(item.role);
          },
        };
      }
      if (item.kind === 'dialog') {
        return {
          kind: 'action',
          label: item.label,
          onClick: () => model.openDialog(item.dialogId),
        };
      }
      return { kind: 'action', label: item.label, onClick: () => model.navigate(item.toolbarId) };
    }),
  );
  return (
    <OperationToolbar
      toolbarId={currentToolbar.id}
      title={currentToolbar.title}
      atRoot={localState.history.length <= 1}
      navigationLabel="監視メニュー移動"
      groups={groups}
      selectionActive={selection !== null}
      sendReady={sendReady}
      sendLabel={
        selection === null ? '取得操作を送信' : `${toolbarSelectionLabel(selection)}を送信`
      }
      onBackToRoot={model.backToRoot}
      onBack={model.back}
      onClear={model.clearSelection}
      onSend={model.submit}
    />
  );
}
