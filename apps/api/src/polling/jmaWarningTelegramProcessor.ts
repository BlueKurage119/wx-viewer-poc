import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import {
  listPendingWarningTelegramReceptions,
  updateTelegramReceptionAdoption,
} from '../repositories/telegramReceptionRepository.js';
import type {
  TelegramReception,
  WarningTelegramParseResult,
  WarningTargetArea,
} from '../repositories/types.js';
import { parseWarningTelegram } from './jmaWarningTelegramParser.js';

export const DEFAULT_WARNING_TARGET_AREA: WarningTargetArea = {
  municipalCode: '1310800',
  displayName: '江東区',
};

export function processWarningTelegramReception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  decidedAt: UtcIso8601String,
  targetArea: WarningTargetArea,
): WarningTelegramParseResult {
  const result =
    reception.rawBody === null
      ? {
          ok: false as const,
          disposition: '未対応構造' as const,
          reason: '原文（raw_body）がありません',
        }
      : parseWarningTelegram(reception.rawBody, reception, targetArea);
  const adoptionResult = result.ok ? '警報・注意報として解析済み' : result.disposition;
  const adoptionReason = result.ok ? null : result.reason;
  const transaction = connection.transaction(() => {
    updateTelegramReceptionAdoption(connection, reception.id, {
      adoptionResult,
      adoptionReason,
      adoptionDecidedAt: decidedAt,
    });
  });
  transaction();
  return result;
}

export async function reprocessPendingWarningTelegramReceptions(
  connection: DatabaseConnection,
  targetArea: WarningTargetArea,
  clock: () => UtcIso8601String,
): Promise<{ readonly processedCount: number }> {
  let after: { readonly receivedAt: UtcIso8601String; readonly id: number } | undefined;
  let processedCount = 0;
  do {
    const page = listPendingWarningTelegramReceptions(connection, { after, limit: 100 });
    for (const reception of page.receptions) {
      processWarningTelegramReception(connection, reception, clock(), targetArea);
      processedCount += 1;
    }
    after = page.nextCursor ?? undefined;
  } while (after);
  return { processedCount };
}
