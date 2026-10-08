import type { StartupNotificationInitialization } from './startupNotificationService.js';
import {
  notificationDeltaCursorToSequence,
  toNotificationDeltaCursor,
  type NotificationCategory,
  type NotificationDeltaCursor,
  type NotificationDeltaRequest,
  type NotificationDeltaGenerationError,
  type WeatherNotificationPendingResponse,
  type NotificationDeltaItem,
  type NotificationDeltaReadyResponse,
  type NotificationDetectionContext,
  type NotificationOrigin,
  type NotificationRelatedRef,
  type NotificationTarget,
  type UtcIso8601String,
  type VenueId,
  type VenueRegistry,
} from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import {
  findMaxNotificationOutputSequence,
  listNotificationOutputHistoryAfter,
} from '../repositories/notificationOutputHistoryRepository.js';
import { resolveNotificationVenueScope } from './notificationVenueScope.js';

export type NotificationDeltaQueryInput = NotificationDeltaRequest & {
  readonly terminalId: string;
  readonly venueId: VenueId;
  readonly requestedAt: UtcIso8601String;
};

export type NotificationDeltaQueryResult =
  | NotificationDeltaReadyResponse
  | NotificationDeltaGenerationError
  | WeatherNotificationPendingResponse
  | {
      readonly status: 'cursor_out_of_range';
      readonly cursor: NotificationDeltaCursor;
      readonly origin: NotificationOrigin;
      readonly serverGenerationId: string;
    };

export interface NotificationDeltaService {
  query(input: NotificationDeltaQueryInput): NotificationDeltaQueryResult;
}

export interface CreateNotificationDeltaServiceDependencies {
  readonly connection: DatabaseConnection;
  readonly venueRegistry: VenueRegistry;
  readonly serverGenerationId: string;
  readonly serverStartCursor: NotificationDeltaCursor;
  readonly initialization: StartupNotificationInitialization;
  readonly now?: () => UtcIso8601String;
}

function isNotificationTarget(value: unknown): value is NotificationTarget {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.kind === 'area' || candidate.kind === 'point' || candidate.kind === 'equipment') &&
    typeof candidate.codeType === 'string' &&
    typeof candidate.code === 'string' &&
    typeof candidate.name === 'string'
  );
}

export function createNotificationDeltaService(
  dependencies: CreateNotificationDeltaServiceDependencies,
): NotificationDeltaService {
  const now = dependencies.now ?? (() => new Date().toISOString() as UtcIso8601String);

  return {
    query(input: NotificationDeltaQueryInput): NotificationDeltaQueryResult {
      if (
        'serverGenerationId' in input &&
        input.serverGenerationId !== dependencies.serverGenerationId
      )
        return {
          status: 'error',
          code: 'server_generation_changed',
          serverGenerationId: dependencies.serverGenerationId,
        };
      const weatherState = dependencies.initialization.getWeatherState(input.venueId);
      if (input.origin === 'weather' && weatherState !== 'ready')
        return {
          status: 'initializing',
          terminalId: input.terminalId,
          venueId: input.venueId,
          serverGenerationId: dependencies.serverGenerationId,
          weatherState,
        };
      return dependencies.connection
        .transaction((): NotificationDeltaQueryResult => {
          const max = findMaxNotificationOutputSequence(dependencies.connection);
          const requested = 'cursor' in input ? notificationDeltaCursorToSequence(input.cursor) : 0;
          const from =
            input.origin === 'system'
              ? Math.max(
                  requested,
                  notificationDeltaCursorToSequence(dependencies.serverStartCursor),
                )
              : requested;
          if (from > max) {
            return {
              status: 'cursor_out_of_range',
              origin: input.origin,
              serverGenerationId: dependencies.serverGenerationId,
              cursor: toNotificationDeltaCursor(max),
            };
          }

          const rows = listNotificationOutputHistoryAfter(dependencies.connection, from);
          const notifications: NotificationDeltaItem[] = [];
          let skippedCount = 0;

          for (const row of rows) {
            if (row.origin !== input.origin) continue;
            let targets: readonly NotificationTarget[];
            try {
              if (row.targetAreaJson === null) {
                throw new Error('targetAreaJson is null');
              }
              const parsed = JSON.parse(row.targetAreaJson);
              if (
                !Array.isArray(parsed) ||
                parsed.length === 0 ||
                !parsed.every(isNotificationTarget)
              ) {
                throw new Error('targets must be a non-empty array of valid NotificationTarget');
              }
              targets = parsed as readonly NotificationTarget[];
            } catch (err) {
              console.error(
                `[notificationDelta] Failed to parse targetAreaJson for row id=${row.id}:`,
                err,
              );
              skippedCount++;
              continue;
            }

            const scope = resolveNotificationVenueScope(targets, dependencies.venueRegistry);
            if (scope.kind === 'venue' && !scope.venueIds.includes(input.venueId)) {
              // 会場スコープ外の行は配信しない（skippedCount には含めない）
              continue;
            }
            if (scope.kind === 'unresolved') {
              console.warn(
                `[notificationDelta] Unresolved venue scope for row id=${row.id}, notificationId=${row.notificationId}`,
              );
            }

            let relatedRefs: readonly NotificationRelatedRef[];
            try {
              const parsed = JSON.parse(row.relatedRefsJson);
              if (!Array.isArray(parsed)) {
                throw new Error('relatedRefs must be an array');
              }
              relatedRefs = parsed as readonly NotificationRelatedRef[];
            } catch (err) {
              console.error(
                `[notificationDelta] Failed to parse relatedRefsJson for row id=${row.id}:`,
                err,
              );
              skippedCount++;
              continue;
            }

            const item: NotificationDeltaItem = {
              sequence: row.id,
              notificationId: row.notificationId,
              category: row.category as NotificationCategory,
              origin: row.origin as NotificationOrigin,
              detectionContext: row.detectionContext as NotificationDetectionContext,
              sourceType: row.sourceType,
              sourceVersion: row.sourceVersion,
              changeType: row.changeType,
              targets: targets as [NotificationTarget, ...NotificationTarget[]],
              occurredAt: row.occurredAt as UtcIso8601String,
              detectedAt: row.detectedAt as UtcIso8601String,
              relatedRefs,
              isTraining: row.isTraining,
              venueScope: scope.kind,
              output: {
                ackRequired: row.ackRequired,
                summary: row.summary,
                messageDefinition:
                  row.messageDefinitionId !== null && row.messageDefinitionVersion !== null
                    ? { id: row.messageDefinitionId, version: row.messageDefinitionVersion }
                    : null,
              },
            };
            notifications.push(item);
          }

          const generatedAt = input.requestedAt || now();
          return {
            status: 'ready',
            origin: input.origin,
            terminalId: input.terminalId,
            venueId: input.venueId,
            serverGenerationId: dependencies.serverGenerationId,
            generatedAt,
            cursor: toNotificationDeltaCursor(max),
            notifications,
            skippedCount,
          };
        })
        .deferred();
    },
  };
}
