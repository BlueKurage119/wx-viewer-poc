import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import { updateTelegramReceptionAdoption } from '../repositories/telegramReceptionRepository.js';
import { saveWarningTimeseriesSnapshot } from '../repositories/warningTimeseriesRepository.js';
import type {
  TelegramReception,
  Vpwp50ParseResult,
  WarningTimeseriesTargetArea,
} from '../repositories/types.js';
import { DEFAULT_VPWP50_TARGET_AREA, parseVpwp50 } from './jmaVpwp50Parser.js';

export function processVpwp50Reception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  processedAt: UtcIso8601String,
  targetArea: WarningTimeseriesTargetArea = DEFAULT_VPWP50_TARGET_AREA,
): Vpwp50ParseResult {
  if (!reception.rawBody) {
    const errorResult: Vpwp50ParseResult = {
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

  const parseResult = parseVpwp50(reception.rawBody, reception, targetArea);

  const tx = connection.transaction(() => {
    if (parseResult.ok) {
      const parsed = parseResult.value;
      saveWarningTimeseriesSnapshot(connection, {
        areaCode: parsed.area.code,
        areaName: parsed.area.name,
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
        values: parsed.values,
      });

      updateTelegramReceptionAdoption(connection, reception.id, {
        adoptionResult: '警報等時系列として解析済み',
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
