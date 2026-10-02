import type { UtcIso8601String, VenueId, VenueRegistry } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import {
  upsertTelegramReceptionAdoption,
  upsertTelegramReceptionAdoptionForAllVenues,
} from '../repositories/telegramReceptionRepository.js';
import {
  findEarlyWarningSnapshot,
  saveEarlyWarningSnapshot,
} from '../repositories/earlyWarningRepository.js';
import type {
  EarlyWarningParseResult,
  EarlyWarningTargetArea,
  TelegramReception,
} from '../repositories/types.js';
import { resolveEarlyWarningTargetAreas } from '../venueForecastTargets.js';
import { parseEarlyWarning } from './jmaEarlyWarningParser.js';

export function processEarlyWarningReception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  processedAt: UtcIso8601String,
  targetArea: EarlyWarningTargetArea,
  registry: VenueRegistry,
): EarlyWarningParseResult {
  if (!reception.rawBody) {
    const errorResult: EarlyWarningParseResult = {
      ok: false,
      disposition: '未対応構造',
      reason: '原文（raw_body）がありません',
    };
    const tx = connection.transaction(() => {
      upsertTelegramReceptionAdoptionForAllVenues(
        connection,
        reception.id,
        {
          adoptionResult: errorResult.disposition,
          adoptionReason: errorResult.reason,
          adoptionDecidedAt: processedAt,
        },
        registry,
      );
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

      upsertTelegramReceptionAdoptionForAllVenues(
        connection,
        reception.id,
        {
          adoptionResult: '早期注意情報として解析済み',
          adoptionReason: null,
          adoptionDecidedAt: processedAt,
        },
        registry,
      );
    } else {
      upsertTelegramReceptionAdoptionForAllVenues(
        connection,
        reception.id,
        {
          adoptionResult: parseResult.disposition,
          adoptionReason: parseResult.reason,
          adoptionDecidedAt: processedAt,
        },
        registry,
      );
    }
  });

  tx();
  return parseResult;
}

/** C5 を対象区域単位で一度だけ解析し、採用結果だけを会場別に記録する。 */
export function processEarlyWarningReceptionForVenues(
  connection: DatabaseConnection,
  reception: TelegramReception,
  processedAt: UtcIso8601String,
  registry: VenueRegistry,
  preserveNewerSnapshot = false,
): readonly { readonly venueId: VenueId; readonly result: EarlyWarningParseResult }[] {
  const groups = new Map<string, VenueId[]>();
  for (const venue of registry.listVenues()) {
    const key = resolveEarlyWarningTargetAreas(
      registry,
      venue.venueId,
      reception.telegramType === 'VPFW60' ? 'far' : 'near',
    )
      .map((target) => target.forecastAreaCode)
      .join(',');
    groups.set(key, [...(groups.get(key) ?? []), venue.venueId]);
  }
  const outcomes: { venueId: VenueId; result: EarlyWarningParseResult }[] = [];
  const tx = connection.transaction(() => {
    for (const venueIds of groups.values()) {
      const venue = registry.getVenue(venueIds[0]!);
      const targets = resolveEarlyWarningTargetAreas(
        registry,
        venue.venueId,
        reception.telegramType === 'VPFW60' ? 'far' : 'near',
      );
      let result: EarlyWarningParseResult = {
        ok: false,
        disposition: '未対応構造',
        reason: '原文（raw_body）がありません',
      };
      if (reception.rawBody) {
        for (const target of targets) {
          result = parseEarlyWarning(reception.rawBody, reception, target);
          if (result.ok || result.disposition !== '対象地域外') break;
        }
      }
      if (result.ok) {
        const parsed = result.value;
        const existing = preserveNewerSnapshot
          ? findEarlyWarningSnapshot(
              connection,
              parsed.area.code,
              parsed.segment,
              parsed.controlStatus,
            )
          : null;
        // 過去の対象地域外電文を再処理しても、保存済みの新しい予報を巻き戻さない。
        const isNewerSaved =
          existing !== null &&
          (existing.telegram.reportDateTime > parsed.reportDateTime ||
            (existing.telegram.reportDateTime === parsed.reportDateTime &&
              existing.telegram.controlDateTime > parsed.controlDateTime));
        if (!isNewerSaved)
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
      }
      for (const venueId of venueIds) {
        upsertTelegramReceptionAdoption(
          connection,
          reception.id,
          {
            venueId,
            adoptionResult: result.ok ? '早期注意情報として解析済み' : result.disposition,
            adoptionReason: result.ok ? null : result.reason,
            adoptionDecidedAt: processedAt,
          },
          registry,
        );
        outcomes.push({ venueId, result });
      }
    }
  });
  tx();
  return outcomes;
}
