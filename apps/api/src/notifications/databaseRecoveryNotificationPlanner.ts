import {
  resolveNotificationMessage,
  resolveVenueForecastTargets,
  type ResolvedNotificationOutputSnapshot,
  type SystemNotification,
  type UtcIso8601String,
  type VenueId,
} from '@wx-viewer-poc/shared';

export type DatabaseRecoveryEvent = 'started' | 'completed' | 'delayed' | 'failed';

export interface PlanDatabaseRecoveryNotificationInput {
  readonly event: DatabaseRecoveryEvent;
  readonly venueId: VenueId;
  readonly serverGenerationId: string;
  readonly occurredAt: UtcIso8601String;
  readonly notificationIdFactory: () => string;
}

export interface PlannedDatabaseRecoveryNotification {
  readonly notification: SystemNotification;
  readonly output: ResolvedNotificationOutputSnapshot;
}

export function planDatabaseRecoveryNotification(
  input: PlanDatabaseRecoveryNotificationInput,
): PlannedDatabaseRecoveryNotification {
  // 通知定義とイベントの対応は下表で一元管理する。
  const definitions = {
    started: 'system-database-initialization-started',
    completed: 'system-database-initialized',
    delayed: 'system-database-initialization-delayed',
    failed: 'system-database-initialization-failed',
  } as const;
  const category = input.event === 'failed' ? 'question' : 'warning';
  const targetName = resolveVenueForecastTargets(input.venueId).warning.displayName;
  const notification: SystemNotification = {
    notificationId: input.notificationIdFactory(),
    origin: 'system',
    category,
    changeType: `database_recovery_${input.event}`,
    sourceType: 'database_recovery',
    sourceVersion: input.serverGenerationId,
    targets: [{ kind: 'equipment', codeType: 'venue', code: input.venueId, name: targetName }],
    occurredAt: input.occurredAt,
    detectedAt: input.occurredAt,
    relatedRefs: [{ type: 'server_generation', ref: input.serverGenerationId }],
    detectionContext: 'initial',
    isTraining: false,
  };
  return {
    notification,
    output: resolveNotificationMessage(notification, { definitionId: definitions[input.event] }),
  };
}
