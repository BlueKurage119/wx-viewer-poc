import crypto from 'node:crypto';
import type { SystemNotification, UtcIso8601String } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import type { MonitoredFetchSourceId } from '../monitoring/fetchHealthSources.js';
import type { FetchHealthAggregate } from '../monitoring/fetchHealthEvaluator.js';
import type { FetchHealthStateStore } from '../monitoring/fetchHealthStateStore.js';
import {
  planFetchHealthNotification,
  type FetchHealthNotificationSkip,
} from './fetchHealthNotificationPlanner.js';
import { toNotificationOutputHistoryInput } from './notificationOutputHistoryMapper.js';
import { recordNotificationOutputHistory } from '../repositories/notificationOutputHistoryRepository.js';

export interface FetchHealthNotificationEmitDeps {
  readonly now: () => UtcIso8601String;
  readonly notificationIdFactory?: () => string; // 既定 crypto.randomUUID
}

export interface FetchHealthNotificationEmitResult {
  /** 実際に履歴へ記録できた通知（取得元ごとに 0〜1 件、合計 0〜6 件）。 */
  readonly recorded: readonly SystemNotification[];
  /** 記録に失敗した取得元（例外は外へ投げない）。 */
  readonly recordFailedSourceIds: readonly MonitoredFetchSourceId[];
  readonly skipped: readonly FetchHealthNotificationSkip[];
}

export function emitFetchHealthNotification(
  connection: DatabaseConnection,
  aggregate: FetchHealthAggregate,
  store: FetchHealthStateStore,
  deps: FetchHealthNotificationEmitDeps,
): FetchHealthNotificationEmitResult {
  const previousStatusBySource = store.getPreviousStatusBySource();

  const plan = planFetchHealthNotification({
    previousStatusBySource,
    current: aggregate,
    detectedAt: deps.now(),
    notificationIdFactory: deps.notificationIdFactory ?? crypto.randomUUID,
  });

  const recorded: SystemNotification[] = [];
  const recordFailedSourceIds: MonitoredFetchSourceId[] = [];

  for (const planned of plan.notifications) {
    try {
      const input = toNotificationOutputHistoryInput(planned.notification, planned.output);
      connection.transaction(() => {
        recordNotificationOutputHistory(connection, input);
      })();
      recorded.push(planned.notification);
    } catch (error) {
      console.error(
        `Failed to record fetch health notification for source ${planned.sourceId}:`,
        error,
      );
      recordFailedSourceIds.push(planned.sourceId);
    }
  }

  // 記録の成否にかかわらず、最後に必ず 1 回状態を進める（再通知ループ防止）
  store.commit(aggregate);

  // ログ出力: message_resolution_failed のみ警告ログを出す
  for (const skip of plan.skipped) {
    if (skip.reason === 'message_resolution_failed') {
      console.warn(
        `Fetch health notification skipped due to message resolution failure for source ${skip.sourceId}: ${skip.detail}`,
      );
    }
  }

  return {
    recorded,
    recordFailedSourceIds,
    skipped: plan.skipped,
  };
}
