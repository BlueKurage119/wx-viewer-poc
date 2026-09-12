import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import { upsertTelegramReceptionAdoptionForAllVenues } from '../repositories/telegramReceptionRepository.js';
import { saveAreaTimeseriesSnapshot } from '../repositories/areaTimeseriesRepository.js';
import type {
  AreaTimeseriesForecastTarget,
  TelegramReception,
  Vpfd51ParseResult,
} from '../repositories/types.js';
import { DEFAULT_AREA_TIMESERIES_FORECAST_TARGET, parseVpfd51 } from './jmaVpfd51Parser.js';

export { DEFAULT_AREA_TIMESERIES_FORECAST_TARGET };

export function processVpfd51Reception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  processedAt: UtcIso8601String,
  target: AreaTimeseriesForecastTarget = DEFAULT_AREA_TIMESERIES_FORECAST_TARGET,
): Vpfd51ParseResult {
  if (!reception.rawBody) {
    const errorResult: Vpfd51ParseResult = {
      ok: false,
      disposition: '未対応構造',
      reason: '原文（raw_body）がありません',
    };
    const tx = connection.transaction(() => {
      upsertTelegramReceptionAdoptionForAllVenues(connection, reception.id, {
        adoptionResult: errorResult.disposition,
        adoptionReason: errorResult.reason,
        adoptionDecidedAt: processedAt,
      });
    });
    tx();
    return errorResult;
  }

  const parseResult = parseVpfd51(reception.rawBody, reception, target);

  const tx = connection.transaction(() => {
    if (parseResult.ok) {
      const parsed = parseResult.value;
      saveAreaTimeseriesSnapshot(connection, {
        areaCode: parsed.area.code,
        areaName: parsed.area.name,
        stationCode: parsed.station.code,
        stationName: parsed.station.name,
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

      upsertTelegramReceptionAdoptionForAllVenues(connection, reception.id, {
        adoptionResult: '地域時系列予報として解析済み',
        adoptionReason: null,
        adoptionDecidedAt: processedAt,
      });
    } else {
      upsertTelegramReceptionAdoptionForAllVenues(connection, reception.id, {
        adoptionResult: parseResult.disposition,
        adoptionReason: parseResult.reason,
        adoptionDecidedAt: processedAt,
      });
    }
  });

  tx();
  return parseResult;
}
