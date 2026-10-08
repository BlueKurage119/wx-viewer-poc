import {
  resolveNotificationMessage,
  type SystemNotification,
  type UtcIso8601String,
  type VenueId,
  type VenueRegistry,
} from '@wx-viewer-poc/shared';

export type InitialSyncFailureStage =
  'reprocessing' | 'service_setup' | 'xml_initial_fetch' | 'venue_evaluation';

export function planInitialSyncNotification(input: {
  readonly stage: InitialSyncFailureStage;
  readonly venueId: VenueId | null;
  readonly venueRegistry: VenueRegistry;
  readonly serverGenerationId: string;
  readonly occurredAt: UtcIso8601String;
}) {
  const notification: SystemNotification = {
    notificationId: `initial-sync:${input.serverGenerationId}:${input.stage}:${input.venueId ?? 'all'}`,
    origin: 'system',
    category: 'question',
    sourceType: 'initial_sync',
    sourceVersion: input.serverGenerationId,
    changeType: 'initial_sync_failed',
    targets:
      input.venueId === null
        ? [
            {
              kind: 'equipment',
              codeType: 'wx-viewer-poc/service',
              code: 'weather',
              name: '気象情報',
            },
          ]
        : [
            {
              kind: 'equipment',
              codeType: 'venue',
              code: input.venueId,
              name: input.venueRegistry.getVenue(input.venueId).warning.displayName,
            },
          ],
    occurredAt: input.occurredAt,
    detectedAt: input.occurredAt,
    relatedRefs: [
      { type: 'server_generation', ref: input.serverGenerationId },
      { type: 'initial_sync_stage', ref: input.stage },
    ],
    detectionContext: 'initial',
    isTraining: false,
  };
  return {
    notification,
    output: resolveNotificationMessage(notification, {
      definitionId: 'system-initial-sync-failed',
    }),
  };
}
