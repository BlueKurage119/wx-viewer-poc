import type { DatabaseConnection } from '../database/index.js';
import { toNotificationOutputHistoryInput } from './notificationOutputHistoryMapper.js';
import { recordNotificationOutputHistory } from '../repositories/notificationOutputHistoryRepository.js';
import type { PlannedOperationNotification } from './operationNotificationPlanner.js';

/**
 * Issue #43 §6: 操作系通知の記録失敗は操作の失敗にしない。
 * 例外を外へ出さず console.error に残すだけとする（既存 emitFetchHealthNotification と同じ扱い）。
 */
export function emitOperationNotification(
  connection: DatabaseConnection,
  planned: PlannedOperationNotification | null,
): void {
  if (planned === null) {
    return;
  }
  try {
    const input = toNotificationOutputHistoryInput(planned.notification, planned.output);
    connection.transaction(() => {
      recordNotificationOutputHistory(connection, input);
    })();
  } catch (error) {
    console.error('操作系通知の記録に失敗しました:', error);
  }
}
