import type { DatabaseConnection } from '../database/index.js';
import { recordNotificationOutputHistory } from '../repositories/notificationOutputHistoryRepository.js';
import { toNotificationOutputHistoryInput } from './notificationOutputHistoryMapper.js';
import type { planInitialSyncNotification } from './initialSyncNotificationPlanner.js';

/** 同一起動世代・段階・会場の失敗を一度だけ保存する。 */
export class InitialSyncNotificationEmitter {
  private readonly emitted = new Set<string>();
  constructor(private readonly connection: DatabaseConnection) {}
  emit(planned: ReturnType<typeof planInitialSyncNotification>): void {
    const key = planned.notification.notificationId;
    if (this.emitted.has(key)) return;
    recordNotificationOutputHistory(
      this.connection,
      toNotificationOutputHistoryInput(planned.notification, planned.output, null),
    );
    this.emitted.add(key);
  }
}
