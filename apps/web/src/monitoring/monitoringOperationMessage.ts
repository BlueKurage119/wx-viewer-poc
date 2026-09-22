import type { FetchControlOperationKind } from '@wx-viewer-poc/shared';
import type { OperationState } from './monitoringOperationController';
import type { ToolbarLocalState } from './monitoringToolbarState';

function operationLabel(operation: FetchControlOperationKind): string {
  return { start: '取得開始', stop: '取得停止', force_refresh: '強制更新' }[operation];
}

/** 通知ストアを書き換えず、選択・進行・最新結果を共通操作行へ投影する。 */
export function monitoringOperationMessage(
  local: ToolbarLocalState,
  operation: OperationState,
): string | null {
  if (local.selectedOperation !== null) {
    return `${operationLabel(local.selectedOperation)}を選択中／送信で実行`;
  }
  if (operation.phase === 'idle') return null;
  if (operation.phase === 'sending')
    return `${operationLabel(operation.request.operationKind)}を送信中`;
  if (operation.phase === 'checking')
    return `${operationLabel(operation.request.operationKind)}の結果を確認中`;
  if (operation.phase === 'completed') {
    return `${operationLabel(operation.request.operationKind)}が${operation.response.result === 'success' ? '完了しました' : '失敗しました'}`;
  }
  if (operation.phase === 'unknown') {
    return `${operationLabel(operation.request.operationKind)}の結果が不明です（要求の記録を確認できません）`;
  }
  if (operation.phase === 'unverifiable') {
    return `${operationLabel(operation.request.operationKind)}の結果を確認できません（通信・応答異常）`;
  }
  return operation.request
    ? `${operationLabel(operation.request.operationKind)}の要求を受け付けられませんでした`
    : '取得操作の要求を準備できませんでした';
}
