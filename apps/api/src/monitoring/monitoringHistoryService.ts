import type {
  MonitoringNotificationOutputQuery,
  NotificationReceptionReference,
  NotificationReceptionUnavailableReason,
  MonitoringOperationQuery,
  MonitoringReceptionDetailResponse,
  MonitoringReceptionListResponse,
  MonitoringReceptionQuery,
  MonitoringReceptionSummary,
  UtcIso8601String,
} from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import {
  countTelegramReceptions,
  findTelegramReceptionById,
  listTelegramReceptions,
} from '../repositories/telegramReceptionRepository.js';
import {
  countNotificationOutputHistory,
  findNotificationOutputHistoryById,
  listNotificationOutputHistory,
} from '../repositories/notificationOutputHistoryRepository.js';
import {
  countOperationHistory,
  listOperationHistory,
} from '../repositories/operationHistoryRepository.js';
import type {
  NotificationOutputHistory,
  OperationHistory,
  TelegramReceptionSummary,
} from '../repositories/types.js';

export interface MonitoringHistoryServiceDependencies {
  readonly weatherConnection: DatabaseConnection;
  readonly retainedConnection: DatabaseConnection;
  readonly weatherDatabaseGenerationId: string;
  readonly now: () => UtcIso8601String;
}

export interface MonitoringNotificationOutputListResult {
  readonly status: 'ready';
  readonly generatedAt: UtcIso8601String;
  readonly totalCount: number;
  readonly limit: number;
  readonly offset: number;
  readonly items: readonly (NotificationOutputHistory & {
    receptionReference: NotificationReceptionReference;
  })[];
}

export interface MonitoringOperationListResult {
  readonly status: 'ready';
  readonly generatedAt: UtcIso8601String;
  readonly totalCount: number;
  readonly limit: number;
  readonly offset: number;
  readonly items: readonly OperationHistory[];
}

export type NotificationReceptionResult =
  | { readonly kind: 'found'; readonly response: MonitoringReceptionDetailResponse }
  | { readonly kind: 'not_found' }
  | {
      readonly kind: 'unavailable';
      readonly reason: NotificationReceptionUnavailableReason | 'not_applicable';
    };

export interface MonitoringHistoryService {
  getNotificationReceptionById(id: number): NotificationReceptionResult;
  listReceptions(query: MonitoringReceptionQuery): MonitoringReceptionListResponse;
  getReceptionById(id: number): MonitoringReceptionDetailResponse | null;
  listNotificationOutputs(
    query: MonitoringNotificationOutputQuery,
  ): MonitoringNotificationOutputListResult;
  listOperations(query: MonitoringOperationQuery): MonitoringOperationListResult;
}

function mapReceptionSummary(row: TelegramReceptionSummary): MonitoringReceptionSummary {
  return {
    id: row.id,
    fetchAttemptId: row.fetchAttemptId,
    feedKind: row.feedKind,
    documentUrl: row.documentUrl,
    telegramType: row.telegramType,
    title: row.title,
    controlStatus: row.controlStatus,
    infoType: row.infoType,
    eventId: row.eventId,
    serial: row.serial,
    controlDateTime: row.controlDateTime,
    reportDateTime: row.reportDateTime,
    targetDateTime: row.targetDateTime,
    receivedAt: row.receivedAt,
    hasRawBody: row.hasRawBody,
    bodyBytes: row.bodyBytes,
    contentHash: row.contentHash,
    areas: row.areas.map((area) => ({
      areaCode: area.areaCode,
      areaName: area.areaName,
      codeType: area.codeType,
    })),
    adoptions: row.adoptions.map((adoption) => ({
      venueId: adoption.venueId,
      adoptionResult: adoption.adoptionResult,
      adoptionReason: adoption.adoptionReason,
      adoptionDecidedAt: adoption.adoptionDecidedAt,
    })),
  };
}

export function createMonitoringHistoryService(
  deps: MonitoringHistoryServiceDependencies,
): MonitoringHistoryService {
  function resolveReference(
    notification: NotificationOutputHistory,
  ): NotificationReceptionReference {
    const refs: unknown = JSON.parse(notification.relatedRefsJson);
    const receptionRef = Array.isArray(refs)
      ? refs.find(
          (ref: unknown) =>
            typeof ref === 'object' &&
            ref !== null &&
            'type' in ref &&
            ref.type === 'telegram_reception',
        )
      : undefined;
    if (notification.origin !== 'weather' || receptionRef === undefined) {
      return { status: 'not_applicable' };
    }
    if (notification.weatherDatabaseGenerationId === null) {
      return { status: 'unavailable', reason: 'generation_unknown' };
    }
    if (notification.weatherDatabaseGenerationId !== deps.weatherDatabaseGenerationId) {
      return { status: 'unavailable', reason: 'weather_generation_changed' };
    }
    const rawId: unknown = receptionRef.ref;
    const id = typeof rawId === 'string' && /^[1-9][0-9]*$/.test(rawId) ? Number(rawId) : NaN;
    if (!Number.isSafeInteger(id)) {
      return { status: 'unavailable', reason: 'reception_missing' };
    }
    const reception = findTelegramReceptionById(deps.weatherConnection, id);
    if (reception === null) return { status: 'unavailable', reason: 'reception_missing' };
    if (reception.rawBody === null || reception.rawBody.length === 0) {
      return { status: 'unavailable', reason: 'raw_body_missing' };
    }
    return { status: 'available', receptionId: id };
  }

  return {
    getNotificationReceptionById(id: number): NotificationReceptionResult {
      const notification = findNotificationOutputHistoryById(deps.retainedConnection, id);
      if (notification === null) return { kind: 'not_found' };
      return deps.weatherConnection.transaction((): NotificationReceptionResult => {
        const reference = resolveReference(notification);
        if (reference.status !== 'available') {
          return {
            kind: 'unavailable',
            reason: reference.status === 'not_applicable' ? 'not_applicable' : reference.reason,
          };
        }
        const reception = findTelegramReceptionById(deps.weatherConnection, reference.receptionId)!;
        return {
          kind: 'found',
          response: {
            status: 'ready',
            generatedAt: deps.now(),
            reception: { ...mapReceptionSummary(reception), rawBody: reception.rawBody },
          },
        };
      })();
    },
    listReceptions(query: MonitoringReceptionQuery): MonitoringReceptionListResponse {
      const options = {
        controlStatus: query.controlStatus,
        telegramType: query.telegramType,
        infoType: query.infoType,
        areaCode: query.areaCode,
        documentUrl: query.documentUrl,
        adoptionResult: query.adoptionResult,
        adoptionVenueId: query.adoptionVenueId,
        receivedAtFrom: query.receivedAtFrom,
        receivedAtTo: query.receivedAtTo,
        reportDateTimeFrom: query.reportDateTimeFrom,
        reportDateTimeTo: query.reportDateTimeTo,
        limit: query.limit,
        offset: query.offset,
      };
      const rows = listTelegramReceptions(deps.weatherConnection, options);
      const totalCount = countTelegramReceptions(deps.weatherConnection, options);

      return {
        status: 'ready',
        generatedAt: deps.now(),
        totalCount,
        limit: query.limit,
        offset: query.offset,
        items: rows.map(mapReceptionSummary),
      };
    },

    getReceptionById(id: number): MonitoringReceptionDetailResponse | null {
      const row = findTelegramReceptionById(deps.weatherConnection, id);
      if (row === null) {
        return null;
      }
      return {
        status: 'ready',
        generatedAt: deps.now(),
        reception: {
          ...mapReceptionSummary(row),
          rawBody: row.rawBody,
        },
      };
    },

    listNotificationOutputs(
      query: MonitoringNotificationOutputQuery,
    ): MonitoringNotificationOutputListResult {
      const options = {
        category: query.category,
        sourceType: query.sourceType,
        changeType: query.changeType,
        origin: query.origin,
        detectionContext: query.detectionContext,
        isTraining: query.isTraining,
        detectedAtFrom: query.detectedAtFrom,
        detectedAtTo: query.detectedAtTo,
        limit: query.limit,
        offset: query.offset,
      };
      const rows = listNotificationOutputHistory(deps.retainedConnection, options);
      const totalCount = countNotificationOutputHistory(deps.retainedConnection, options);

      return {
        status: 'ready',
        generatedAt: deps.now(),
        totalCount,
        limit: query.limit,
        offset: query.offset,
        items: deps.weatherConnection.transaction(() =>
          rows.map((row) => ({
            ...row,
            receptionReference: resolveReference(row),
          })),
        )(),
      };
    },

    listOperations(query: MonitoringOperationQuery): MonitoringOperationListResult {
      const options = {
        operationKind: query.operationKind,
        result: query.result,
        actorId: query.actorId,
        requestedAtFrom: query.requestedAtFrom,
        requestedAtTo: query.requestedAtTo,
        completedAtFrom: query.completedAtFrom,
        completedAtTo: query.completedAtTo,
        limit: query.limit,
        offset: query.offset,
      };
      const rows = listOperationHistory(deps.retainedConnection, options);
      const totalCount = countOperationHistory(deps.retainedConnection, options);

      return {
        status: 'ready',
        generatedAt: deps.now(),
        totalCount,
        limit: query.limit,
        offset: query.offset,
        items: rows,
      };
    },
  };
}
