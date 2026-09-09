import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import {
  listPendingWarningTelegramReceptions,
  updateTelegramReceptionAdoption,
} from '../repositories/telegramReceptionRepository.js';
import {
  applyWarningCurrentReception,
  DEFAULT_WARNING_CURRENT_TARGET_AREA,
} from './jmaWarningCurrentProcessor.js';
import type {
  TelegramReception,
  WarningCurrentApplyResult,
  WarningCurrentTargetArea,
  WarningTelegramParseResult,
  WarningTargetArea,
} from '../repositories/types.js';
import { parseWarningTelegram } from './jmaWarningTelegramParser.js';
import { resolveWarningTargetArea } from '../venueForecastTargets.js';

export const DEFAULT_WARNING_TARGET_AREA: WarningTargetArea = resolveWarningTargetArea('east');

export interface WarningTelegramProcessResult {
  readonly parseResult: WarningTelegramParseResult;
  readonly currentResult: WarningCurrentApplyResult | null;
}

export function processWarningTelegramReception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  decidedAt: UtcIso8601String,
  targetArea: WarningTargetArea | WarningCurrentTargetArea = DEFAULT_WARNING_TARGET_AREA,
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

  if (result.ok) {
    const currentTargetArea: WarningCurrentTargetArea =
      'prefectureCode' in targetArea && typeof targetArea.prefectureCode === 'string'
        ? targetArea
        : {
            ...targetArea,
            prefectureCode: DEFAULT_WARNING_CURRENT_TARGET_AREA.prefectureCode,
          };

    try {
      applyWarningCurrentReception(connection, reception, result.value, currentTargetArea);
    } catch (error) {
      // C3 の例外によって C2 の解析成功を取り消さない
      console.error('Failed to apply warning current reception:', error);
    }
  }

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
