import type { FetchControlOperationKind } from '@wx-viewer-poc/shared';
import type { OperationState } from './monitoringOperationController';
import {
  selectOperationLineFor,
  type OperationLine,
  type OperationLineEntry,
} from '../toolbar/operationLine';
import { toolbarSelectionLabel, type ToolbarLocalState } from './monitoringToolbarState';

function operationLabel(operation: FetchControlOperationKind): string {
  return { start: '取得開始', stop: '取得停止', force_refresh: '強制更新' }[operation];
}

/** 取得操作の最新の進行・結果。何もなければ null。 */
export function fetchOperationText(operation: OperationState): string | null {
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

export type { OperationLine, OperationLineEntry } from '../toolbar/operationLine';

/**
 * 通知領域最下段の1行を決める。選択中は常に最優先。
 * 取得操作と再起動が同時にあるときは、最後に状態が変わった方を表示し、title に全件を並べる。
 */
export function selectOperationLine(
  local: ToolbarLocalState,
  entries: readonly OperationLineEntry[],
): OperationLine | null {
  return selectOperationLineFor(
    local.selectedOperation === null ? null : toolbarSelectionLabel(local.selectedOperation),
    entries,
  );
}

/**
 * 再起動行の「状態が変わった」判定に使う識別子。
 * 受付後の準備中と完了は監視データの更新だけで行き来するため、同じ要求の間は同一とみなす。
 */
export function restartChangeToken(
  stage: string,
  requestId: string | null,
  rowText: string | null,
): string | null {
  if (rowText === null) return null;
  return (stage === 'preparing' || stage === 'completed') && requestId !== null
    ? `request:${requestId}`
    : rowText;
}

/** 通知ストアを書き換えず、選択・進行・最新結果を共通操作行へ投影する。 */
export function monitoringOperationMessage(
  local: ToolbarLocalState,
  operation: OperationState,
): string | null {
  return (
    selectOperationLine(local, [{ text: fetchOperationText(operation), changedSeq: 0 }])?.text ??
    null
  );
}
