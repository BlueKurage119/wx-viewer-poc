import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import { updateTelegramReceptionAdoption } from '../repositories/telegramReceptionRepository.js';
import { saveEarlyWarningSnapshot } from '../repositories/earlyWarningRepository.js';
import type {
  EarlyWarningParseResult,
  EarlyWarningTargetArea,
  TelegramReception,
} from '../repositories/types.js';
import { DEFAULT_EARLY_WARNING_TARGET_AREA, parseEarlyWarning } from './jmaEarlyWarningParser.js';

export { DEFAULT_EARLY_WARNING_TARGET_AREA };

export function processEarlyWarningReception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  processedAt: UtcIso8601String,
  targetArea: EarlyWarningTargetArea = DEFAULT_EARLY_WARNING_TARGET_AREA,
): EarlyWarningParseResult {
  if (!reception.rawBody) {
    const errorResult: EarlyWarningParseResult = {
      ok: false,
      disposition: '未対応構造',
      reason: '原文（raw_body）がありません',
    };
    const tx = connection.transaction(() => {
      updateTelegramReceptionAdoption(connection, reception.id, {
        adoptionResult: errorResult.disposition,
        adoptionReason: errorResult.reason,
        adoptionDecidedAt: processedAt,
      });
    });
    tx();
    return errorResult;
  }

  const parseResult = parseEarlyWarning(reception.rawBody, reception, targetArea);

  const tx = connection.transaction(() => {
    if (parseResult.ok) {
      const parsed = parseResult.value;
      saveEarlyWarningSnapshot(connection, {
        areaCode: parsed.area.code,
        areaName: parsed.area.name,
        segment: parsed.segment,
        telegramType: parsed.telegramType,
        metadata: {
          source: reception.documentUrl,
          issuedAt: parsed.reportDateTime,
          validAt: null,
          validFrom: null,
          validTo: null,
          fetchedAt: reception.receivedAt,
          lastSuccessAt: processedAt,
          availability: 'available',
          sourceVersion: parsed.infoKindVersion,
        },
        telegram: {
          controlStatus: parsed.controlStatus,
          infoType: parsed.infoType,
          eventId: parsed.eventId,
          reportDateTime: parsed.reportDateTime,
          controlDateTime: parsed.controlDateTime,
        },
        timeDefines: parsed.timeDefines,
        cells: parsed.cells,
      });

      updateTelegramReceptionAdoption(connection, reception.id, {
        adoptionResult: '早期注意情報として解析済み',
        adoptionReason: null,
        adoptionDecidedAt: processedAt,
      });
    } else {
      updateTelegramReceptionAdoption(connection, reception.id, {
        adoptionResult: parseResult.disposition,
        adoptionReason: parseResult.reason,
        adoptionDecidedAt: processedAt,
      });
    }
  });

  tx();
  return parseResult;
}
