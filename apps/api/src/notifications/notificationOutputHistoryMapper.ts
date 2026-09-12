import type { Notification, NotificationOutputSnapshot } from '@wx-viewer-poc/shared';
import type { NotificationOutputHistoryInput } from '../repositories/types.js';

/**
 * 共有通知事実 Notification と出力スナップショット NotificationOutputSnapshot を
 * B4 の NotificationOutputHistoryInput へマッピングする。
 *
 * 設計書 §4.2 に従い、値の意味や文言の補正は行わず、各属性を完全一致で写す。
 */
export function toNotificationOutputHistoryInput(
  notification: Notification,
  output: NotificationOutputSnapshot,
): NotificationOutputHistoryInput {
  return {
    notificationId: notification.notificationId,
    category: notification.category,
    sourceType: notification.sourceType,
    sourceVersion: notification.sourceVersion,
    targetAreaJson: notification.target === null ? null : JSON.stringify(notification.target),
    occurredAt: notification.occurredAt,
    detectedAt: notification.detectedAt,
    changeType: notification.changeType,
    ackRequired: output.ackRequired,
    summary: output.summary,
    relatedRefsJson: JSON.stringify(notification.relatedRefs),
    origin: notification.origin,
    detectionContext: notification.detectionContext,
    isTraining: notification.isTraining,
    messageDefinitionId: output.messageDefinition === null ? null : output.messageDefinition.id,
    messageDefinitionVersion:
      output.messageDefinition === null ? null : output.messageDefinition.version,
  };
}
