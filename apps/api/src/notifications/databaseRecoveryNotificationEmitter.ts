import type { DatabaseConnection } from '../database/index.js';
import { recordNotificationOutputHistory } from '../repositories/notificationOutputHistoryRepository.js';
import { toNotificationOutputHistoryInput } from './notificationOutputHistoryMapper.js';
import type { PlannedDatabaseRecoveryNotification } from './databaseRecoveryNotificationPlanner.js';

/** 同一起動世代の同一イベントを二重永続化しないEmitter。 */
export class DatabaseRecoveryNotificationEmitter {
  private readonly emitted = new Set<string>();
  constructor(private readonly connection: DatabaseConnection) {}
  emit(planned: PlannedDatabaseRecoveryNotification): boolean {
    const key = planned.notification.notificationId;
    if (this.emitted.has(key)) return false;
    const transaction = this.connection.transaction(() => {
      recordNotificationOutputHistory(
        this.connection,
        toNotificationOutputHistoryInput(planned.notification, planned.output),
      );
    });
    transaction();
    this.emitted.add(key);
    return true;
  }
}
