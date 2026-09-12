import crypto from 'node:crypto';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import {
  findWarningCurrentSnapshot,
  recordNotificationOutputHistory,
} from '../repositories/index.js';
import type {
  ControlStatus,
  ParsedWarningTelegram,
  TelegramReception,
  WarningCurrentApplyResult,
  WarningCurrentTargetArea,
} from '../repositories/types.js';
import { diffWarningCurrent } from '../polling/jmaWarningCurrentReducer.js';
import { InitialWarningNotificationTracker } from './initialWarningNotificationTracker.js';
import {
  type WarningNotificationContext,
  type WarningNotificationSkip,
  type WarningNotificationTrigger,
  planWarningNotifications,
} from './warningNotificationPlanner.js';
import { toNotificationOutputHistoryInput } from './notificationOutputHistoryMapper.js';

export interface WarningNotificationEmitDeps {
  readonly tracker: InitialWarningNotificationTracker;
  readonly now: () => UtcIso8601String;
  readonly notificationIdFactory?: () => string; // 既定 crypto.randomUUID
}

export interface WarningNotificationEmitResult {
  readonly recordedCount: number;
  readonly skipped: readonly WarningNotificationSkip[];
}

/**
 * 受信経路。applied:true の適用結果からのみ呼ぶ。
 */
export function emitWarningNotificationsForReception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  applyResult: Extract<WarningCurrentApplyResult, { applied: true }>,
  parsed: ParsedWarningTelegram,
  deps: WarningNotificationEmitDeps,
): WarningNotificationEmitResult {
  const isPending = deps.tracker.isPending(parsed.area.code, parsed.controlStatus);
  const detectionContext = isPending ? 'initial' : 'normal';

  const context: WarningNotificationContext = {
    areaCode: parsed.area.code,
    areaName: applyResult.snapshot.areaName,
    controlStatus: parsed.controlStatus,
    sourceVersion: applyResult.snapshot.metadata.sourceVersion,
    reportDateTime: applyResult.snapshot.telegram.reportDateTime,
    detectedAt: reception.receivedAt,
    currentItems: applyResult.snapshot.items,
  };

  const trigger: WarningNotificationTrigger = {
    kind: 'reception',
    infoType: applyResult.infoType,
    telegramType: parsed.telegramType,
    receptionId: reception.id,
  };

  const plan = planWarningNotifications({
    trigger,
    changes: applyResult.changes,
    context,
    detectionContext,
    notificationIdFactory: deps.notificationIdFactory ?? (() => crypto.randomUUID()),
  });

  // 永続化（C3のトランザクションとは独立して実行し、失敗してもC3を取り消さない）
  if (plan.notifications.length > 0) {
    try {
      const transaction = connection.transaction(() => {
        for (const planned of plan.notifications) {
          const recordInput = toNotificationOutputHistoryInput(
            planned.notification,
            planned.output,
          );
          recordNotificationOutputHistory(connection, recordInput);
        }
      });
      transaction();
    } catch (error) {
      console.error('Failed to record warning notification output history:', error);
    }
  }

  // 初期取得フラグを完了にマーク
  deps.tracker.markDone(parsed.area.code, parsed.controlStatus);

  // skipped をログ出力
  for (const s of plan.skipped) {
    console.warn(`Warning notification skipped: [${s.reason}] ${s.detail}`);
  }

  return {
    recordedCount: plan.notifications.length,
    skipped: plan.skipped,
  };
}

/**
 * 起動時復旧経路。会場ごとに 1 回呼ぶ。
 */
export function emitInitialWarningNotifications(
  connection: DatabaseConnection,
  targetArea: WarningCurrentTargetArea,
  deps: WarningNotificationEmitDeps,
): WarningNotificationEmitResult {
  const targetStatuses: readonly ControlStatus[] = ['normal', 'training'];
  let recordedCount = 0;
  const skipped: WarningNotificationSkip[] = [];

  for (const status of targetStatuses) {
    // 既に初期取得済みなら何もしない
    if (!deps.tracker.isPending(targetArea.municipalCode, status)) {
      continue;
    }

    const snapshot = findWarningCurrentSnapshot(connection, targetArea.municipalCode, status);
    // スナップショットがなければ何もしない（markDone も呼ばない）
    if (!snapshot) {
      continue;
    }

    // 全件 new の差分を作成
    const changes = diffWarningCurrent([], snapshot.items);

    const context: WarningNotificationContext = {
      areaCode: targetArea.municipalCode,
      areaName: targetArea.displayName,
      controlStatus: status,
      sourceVersion: snapshot.metadata.sourceVersion,
      reportDateTime: snapshot.telegram.reportDateTime,
      detectedAt: deps.now(),
      currentItems: snapshot.items,
    };

    const plan = planWarningNotifications({
      trigger: { kind: 'initial' },
      changes,
      context,
      detectionContext: 'initial',
      notificationIdFactory: deps.notificationIdFactory ?? (() => crypto.randomUUID()),
    });

    if (plan.notifications.length > 0) {
      try {
        const transaction = connection.transaction(() => {
          for (const planned of plan.notifications) {
            const recordInput = toNotificationOutputHistoryInput(
              planned.notification,
              planned.output,
            );
            recordNotificationOutputHistory(connection, recordInput);
          }
        });
        transaction();
      } catch (error) {
        console.error('Failed to record initial warning notification output history:', error);
      }
    }

    deps.tracker.markDone(targetArea.municipalCode, status);
    recordedCount += plan.notifications.length;
    skipped.push(...plan.skipped);

    for (const s of plan.skipped) {
      console.warn(`Initial warning notification skipped: [${s.reason}] ${s.detail}`);
    }
  }

  return {
    recordedCount,
    skipped,
  };
}
