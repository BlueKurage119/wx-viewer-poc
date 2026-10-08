import type {
  MonitoringNotificationOutputQuery,
  MonitoringOperationQuery,
  NotificationReceptionReference,
  UtcIso8601String,
} from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import {
  countNotificationOutputHistory,
  findNotificationOutputHistoryById,
  listNotificationOutputHistory,
} from '../repositories/notificationOutputHistoryRepository.js';
import {
  countOperationHistory,
  listOperationHistory,
} from '../repositories/operationHistoryRepository.js';
import type { NotificationOutputHistory } from '../repositories/types.js';
import type {
  NotificationReceptionResult,
  MonitoringNotificationOutputListResult,
  MonitoringOperationListResult,
} from '../monitoring/monitoringHistoryService.js';
import { WeatherRequestError } from './weatherRequestRegistry.js';
import type { WeatherOperations } from './weatherContracts.js';

type Read = <K extends 'history.references' | 'history.reception'>(
  kind: K,
  payload: WeatherOperations[K]['request'],
) => Promise<WeatherOperations[K]['response']>;
/** 保持履歴を先に取得し、気象参照の失敗で履歴本体を失わない。 */
export function createRetainedMonitoringHistory(
  connection: DatabaseConnection,
  read: Read,
  now: () => UtcIso8601String,
) {
  function requestReference(row: NotificationOutputHistory) {
    const refs: unknown = JSON.parse(row.relatedRefsJson);
    const ref = Array.isArray(refs)
      ? (refs.find(
          (r: unknown) =>
            typeof r === 'object' && r !== null && 'type' in r && r.type === 'telegram_reception',
        ) as { ref?: unknown } | undefined)
      : undefined;
    if (row.origin !== 'weather' || !ref) return null;
    const id = typeof ref.ref === 'string' && /^[1-9][0-9]*$/.test(ref.ref) ? Number(ref.ref) : 0;
    return {
      weatherDatabaseGenerationId: row.weatherDatabaseGenerationId,
      receptionId: Number.isSafeInteger(id) ? id : 0,
    };
  }
  async function references(
    rows: readonly NotificationOutputHistory[],
  ): Promise<readonly NotificationReceptionReference[]> {
    const requests = rows.map(requestReference);
    const applicable = requests.filter((r): r is NonNullable<typeof r> => r !== null);
    if (!applicable.length) return rows.map(() => ({ status: 'not_applicable' }));
    let results: readonly NotificationReceptionReference[];
    try {
      results = await read('history.references', applicable);
    } catch {
      results = applicable.map(() => ({ status: 'unavailable', reason: 'weather_unavailable' }));
    }
    let index = 0;
    return requests.map((r) => (r === null ? { status: 'not_applicable' } : results[index++]!));
  }
  return {
    async listNotificationOutputs(
      query: MonitoringNotificationOutputQuery,
    ): Promise<MonitoringNotificationOutputListResult> {
      const rows = listNotificationOutputHistory(connection, query);
      const totalCount = countNotificationOutputHistory(connection, query);
      const refs = await references(rows);
      return {
        status: 'ready',
        generatedAt: now(),
        totalCount,
        limit: query.limit,
        offset: query.offset,
        items: rows.map((row, index) => ({ ...row, receptionReference: refs[index]! })),
      };
    },
    async getNotificationReceptionById(id: number): Promise<NotificationReceptionResult> {
      const row = findNotificationOutputHistoryById(connection, id);
      if (!row) return { kind: 'not_found' };
      const [ref] = await references([row]);
      if (!ref || ref.status !== 'available')
        return {
          kind: 'unavailable',
          reason: ref?.status === 'unavailable' ? ref.reason : 'not_applicable',
        };
      try {
        const response = await read('history.reception', {
          receptionId: ref.receptionId,
          expectedDatabaseGenerationId: row.weatherDatabaseGenerationId!,
        });
        return response
          ? { kind: 'found', response }
          : { kind: 'unavailable', reason: 'reception_missing' };
      } catch (error) {
        return {
          kind: 'unavailable',
          reason:
            error instanceof WeatherRequestError && error.code === 'generation_changed'
              ? 'weather_generation_changed'
              : 'weather_unavailable',
        };
      }
    },
    listOperations(query: MonitoringOperationQuery): MonitoringOperationListResult {
      return {
        status: 'ready',
        generatedAt: now(),
        totalCount: countOperationHistory(connection, query),
        limit: query.limit,
        offset: query.offset,
        items: listOperationHistory(connection, query),
      };
    },
  };
}
