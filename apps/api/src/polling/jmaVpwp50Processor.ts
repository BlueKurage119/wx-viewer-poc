import { VENUE_IDS, type UtcIso8601String, type VenueId } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import { upsertTelegramReceptionAdoption } from '../repositories/telegramReceptionRepository.js';
import { saveWarningTimeseriesSnapshot } from '../repositories/warningTimeseriesRepository.js';
import type { TelegramReception, Vpwp50ParseResult } from '../repositories/types.js';
import { parseVpwp50 } from './jmaVpwp50Parser.js';
import {
  resolveVenueWarningTimeseriesContext,
  type VenueWarningTimeseriesContext,
} from '../venueForecastTargets.js';

export { DEFAULT_VPWP50_TARGET_AREA } from './jmaVpwp50Parser.js';

/**
 * 1 会場分の VPWP50（警報等時系列）電文を採用判定する。市町村等コードが会場で異なるため
 * 会場ごとに parse をやり直す。
 */
export function processVpwp50Reception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  processedAt: UtcIso8601String,
  venue: VenueWarningTimeseriesContext,
): Vpwp50ParseResult {
  if (!reception.rawBody) {
    const errorResult: Vpwp50ParseResult = {
      ok: false,
      disposition: '未対応構造',
      reason: '原文（raw_body）がありません',
    };
    const tx = connection.transaction(() => {
      upsertTelegramReceptionAdoption(connection, reception.id, {
        venueId: venue.venueId,
        adoptionResult: errorResult.disposition,
        adoptionReason: errorResult.reason,
        adoptionDecidedAt: processedAt,
      });
    });
    tx();
    return errorResult;
  }

  const parseResult = parseVpwp50(reception.rawBody, reception, venue.targetArea);

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

      upsertTelegramReceptionAdoption(connection, reception.id, {
        venueId: venue.venueId,
        adoptionResult: '警報等時系列として解析済み',
        adoptionReason: null,
        adoptionDecidedAt: processedAt,
      });
    } else {
      upsertTelegramReceptionAdoption(connection, reception.id, {
        venueId: venue.venueId,
        adoptionResult: parseResult.disposition,
        adoptionReason: parseResult.reason,
        adoptionDecidedAt: processedAt,
      });
    }
  });

  tx();
  return parseResult;
}

/** VENUE_IDS を毎回ループする。ポーリング本線はこちらを呼ぶ（確定事項3）。 */
export function processVpwp50ReceptionForAllVenues(
  connection: DatabaseConnection,
  reception: TelegramReception,
  processedAt: UtcIso8601String,
): ReadonlyMap<VenueId, Vpwp50ParseResult> {
  const results = new Map<VenueId, Vpwp50ParseResult>();
  for (const venueId of VENUE_IDS) {
    const venue = resolveVenueWarningTimeseriesContext(venueId);
    results.set(venueId, processVpwp50Reception(connection, reception, processedAt, venue));
  }
  return results;
}
