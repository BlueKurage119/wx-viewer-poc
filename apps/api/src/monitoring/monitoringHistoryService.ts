import type {
  MonitoringNotificationOutputQuery,
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
  readonly connection: DatabaseConnection;
  readonly now: () => UtcIso8601String;
}

export interface MonitoringNotificationOutputListResult {
  readonly status: 'ready';
  readonly generatedAt: UtcIso8601String;
  readonly totalCount: number;
  readonly limit: number;
  readonly offset: number;
  readonly items: readonly NotificationOutputHistory[];
}

export interface MonitoringOperationListResult {
  readonly status: 'ready';
  readonly generatedAt: UtcIso8601String;
  readonly totalCount: number;
  readonly limit: number;
  readonly offset: number;
  readonly items: readonly OperationHistory[];
}

export interface MonitoringHistoryService {
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
  return {
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
      const rows = listTelegramReceptions(deps.connection, options);
      const totalCount = countTelegramReceptions(deps.connection, options);

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
      const row = findTelegramReceptionById(deps.connection, id);
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
      const rows = listNotificationOutputHistory(deps.connection, options);
      const totalCount = countNotificationOutputHistory(deps.connection, options);

      return {
        status: 'ready',
        generatedAt: deps.now(),
        totalCount,
        limit: query.limit,
        offset: query.offset,
        items: rows,
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
      const rows = listOperationHistory(deps.connection, options);
      const totalCount = countOperationHistory(deps.connection, options);

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
