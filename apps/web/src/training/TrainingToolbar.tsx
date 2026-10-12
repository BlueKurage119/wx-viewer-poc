import { OperationToolbar, type OperationToolbarItem } from '../toolbar/OperationToolbar';
import { canSelectTrainingOperation, trainingSelectionLabel } from './trainingToolbarState';
import type { TrainingToolbarModel } from './useTrainingScreen';

/**
 * 訓練画面のツールバー。取得監視と共通の `OperationToolbar` に、削除・全削除（選択→送信の2段階）を
 * 渡すだけの薄い部品。右端のクリア・送信、左の `<<`・`<` は共通部品が描画する。
 */
export function TrainingToolbar({ model }: { readonly model: TrainingToolbarModel }) {
  const { navigation, counts, selection } = model;
  const current = navigation.currentToolbar;
  const groups: OperationToolbarItem[][] = current.groups.map((group) =>
    group.map((item): OperationToolbarItem => {
      if (item.kind === 'select') {
        return {
          kind: 'select',
          label: item.label,
          selected: selection === item.selection,
          softDisabled: !canSelectTrainingOperation(item.selection, counts),
          onSelect: () => model.selectOperation(item.selection),
        };
      }
      return {
        kind: 'action',
        label: item.label,
        onClick: () => navigation.navigate(item.toolbarId),
      };
    }),
  );
  return (
    <OperationToolbar
      toolbarId={current.id}
      title={current.title}
      atRoot={navigation.localState.history.length <= 1}
      navigationLabel="訓練メニュー移動"
      groups={groups}
      selectionActive={selection !== null}
      sendReady={model.sendReady}
      sendLabel={selection === null ? '操作を送信' : `${trainingSelectionLabel(selection)}を送信`}
      onBackToRoot={navigation.backToRoot}
      onBack={navigation.back}
      onClear={model.clear}
      onSend={model.send}
    />
  );
}
