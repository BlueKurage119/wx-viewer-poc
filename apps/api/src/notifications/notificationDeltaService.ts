import {
  notificationDeltaCursorToSequence,
  toNotificationDeltaCursor,
  type NotificationCategory,
  type NotificationDeltaCursor,
  type NotificationDeltaItem,
  type NotificationDeltaReadyResponse,
  type NotificationDetectionContext,
  type NotificationOrigin,
  type NotificationRelatedRef,
  type NotificationTarget,
  type UtcIso8601String,
  type VenueId,
} from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import {
  findMaxNotificationOutputSequence,
  listNotificationOutputHistoryAfter,
} from '../repositories/notificationOutputHistoryRepository.js';
import { resolveNotificationVenueScope } from './notificationVenueScope.js';

export interface NotificationDeltaQueryInput {
  readonly terminalId: string;
  readonly venueId: VenueId;
  readonly cursor: NotificationDeltaCursor;
  readonly requestedAt: UtcIso8601String;
}

export type NotificationDeltaQueryResult =
  | NotificationDeltaReadyResponse
  | { readonly status: 'cursor_out_of_range'; readonly cursor: NotificationDeltaCursor };

export interface NotificationDeltaService {
  query(input: NotificationDeltaQueryInput): NotificationDeltaQueryResult;
}

export interface CreateNotificationDeltaServiceDependencies {
  readonly connection: DatabaseConnection;
  readonly serverGenerationId: string;
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
      return dependencies.connection
        .transaction((): NotificationDeltaQueryResult => {
          const max = findMaxNotificationOutputSequence(dependencies.connection);
          const from = notificationDeltaCursorToSequence(input.cursor);
          if (from > max) {
            return {
              status: 'cursor_out_of_range',
              cursor: toNotificationDeltaCursor(max),
            };
          }

          const rows = listNotificationOutputHistoryAfter(dependencies.connection, from);
          const notifications: NotificationDeltaItem[] = [];
          let skippedCount = 0;

          for (const row of rows) {
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

            const scope = resolveNotificationVenueScope(targets);
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
