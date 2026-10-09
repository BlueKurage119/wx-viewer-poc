import {
  resolveNotificationMessage,
  type SystemNotification,
  type UtcIso8601String,
  type VenueId,
  type VenueRegistry,
} from '@wx-viewer-poc/shared';

export type InitialSyncFailureStage =
  'reprocessing' | 'service_setup' | 'xml_initial_fetch' | 'venue_evaluation';

const STAGE_REASONS: Readonly<Record<InitialSyncFailureStage, string>> = {
  reprocessing: '電文再処理',
  service_setup: 'サービス準備',
  xml_initial_fetch: 'XML初回取得',
  venue_evaluation: '会場評価',
};

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
    // 対象欄は「取得系」。会場単位の通知は、配信範囲の判定に使う会場コードを保持する。
    targets: [
      input.venueId === null
        ? {
            kind: 'equipment',
            codeType: 'wx-viewer-poc/service',
            code: 'acquisition',
            name: '取得系',
          }
        : { kind: 'equipment', codeType: 'venue', code: input.venueId, name: '取得系' },
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
      definitionId: 'system-weather-acquisition-initialization-failed',
      // 内容は「会場名 理由」。会場を特定できない段階では理由だけを出す。
      detail:
        input.venueId === null
          ? STAGE_REASONS[input.stage]
          : `${input.venueRegistry.getVenue(input.venueId).warning.displayName} ${STAGE_REASONS[input.stage]}`,
    }),
  };
}
