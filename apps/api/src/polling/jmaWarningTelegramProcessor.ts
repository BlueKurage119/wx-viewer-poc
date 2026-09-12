import { VENUE_IDS, type UtcIso8601String, type VenueId } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import {
  listPendingWarningTelegramReceptions,
  upsertTelegramReceptionAdoption,
} from '../repositories/telegramReceptionRepository.js';
import { applyWarningCurrentReception } from './jmaWarningCurrentProcessor.js';
import type {
  TelegramReception,
  WarningCurrentApplyResult,
  WarningTelegramParseResult,
} from '../repositories/types.js';
import { parseWarningTelegram } from './jmaWarningTelegramParser.js';
import { resolveVenueWarningContext, type VenueWarningContext } from '../venueForecastTargets.js';
import {
  type WarningNotificationEmitDeps,
  emitWarningNotificationsForReception,
} from '../notifications/warningNotificationEmitter.js';
import { InitialWarningNotificationTracker } from '../notifications/initialWarningNotificationTracker.js';

export interface WarningTelegramProcessResult {
  readonly parseResult: WarningTelegramParseResult;
  readonly currentResult: WarningCurrentApplyResult | null;
}

/**
 * 1 会場分の警報・注意報電文を採用判定する。パース結果は会場に依存するため
 * （C2 は targetArea.municipalCode で Item を絞る）、会場ごとに parse をやり直す。
 */
export function processWarningTelegramReception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  decidedAt: UtcIso8601String,
  venue: VenueWarningContext,
  emitDeps?: WarningNotificationEmitDeps,
): WarningTelegramParseResult {
  const result =
    reception.rawBody === null
      ? {
          ok: false as const,
          disposition: '未対応構造' as const,
          reason: '原文（raw_body）がありません',
        }
      : parseWarningTelegram(reception.rawBody, reception, venue.targetArea);
  let adoptionResult = result.ok ? '警報・注意報として解析済み' : result.disposition;
  let adoptionReason = result.ok ? null : result.reason;

  if (result.ok) {
    try {
      const currentResult = applyWarningCurrentReception(
        connection,
        reception,
        result.value,
        venue.targetArea,
      );
      if (!currentResult.applied && currentResult.reason === 'unsupported_code') {
        adoptionResult = '未対応コード';
        adoptionReason = currentResult.detail;
      } else if (currentResult.applied) {
        const resolvedDeps: WarningNotificationEmitDeps = emitDeps ?? {
          tracker: new InitialWarningNotificationTracker(),
          now: () => decidedAt,
        };
        emitWarningNotificationsForReception(
          connection,
          reception,
          currentResult,
          result.value,
          resolvedDeps,
        );
      }
    } catch (error) {
      // C3 の例外によって C2 の解析成功を取り消さない
      console.error('Failed to apply warning current reception:', error);
    }
  }

  const transaction = connection.transaction(() => {
    upsertTelegramReceptionAdoption(connection, reception.id, {
      venueId: venue.venueId,
      adoptionResult,
      adoptionReason,
      adoptionDecidedAt: decidedAt,
    });
  });
  transaction();

  return result;
}

/** VENUE_IDS を毎回ループする。ポーリング本線はこちらを呼ぶ（確定事項3）。 */
export function processWarningTelegramReceptionForAllVenues(
  connection: DatabaseConnection,
  reception: TelegramReception,
  decidedAt: UtcIso8601String,
  emitDeps?: WarningNotificationEmitDeps,
): ReadonlyMap<VenueId, WarningTelegramParseResult> {
  const results = new Map<VenueId, WarningTelegramParseResult>();
  for (const venueId of VENUE_IDS) {
    const venue = resolveVenueWarningContext(venueId);
    results.set(
      venueId,
      processWarningTelegramReception(connection, reception, decidedAt, venue, emitDeps),
    );
  }
  return results;
}

export async function reprocessPendingWarningTelegramReceptions(
  connection: DatabaseConnection,
  venue: VenueWarningContext,
  clock: () => UtcIso8601String,
  emitDeps?: WarningNotificationEmitDeps,
): Promise<{ readonly processedCount: number }> {
  let after: { readonly receivedAt: UtcIso8601String; readonly id: number } | undefined;
  let processedCount = 0;
  do {
    const page = listPendingWarningTelegramReceptions(connection, venue.venueId, {
      after,
      limit: 100,
    });
    for (const reception of page.receptions) {
      processWarningTelegramReception(connection, reception, clock(), venue, emitDeps);
      processedCount += 1;
    }
    after = page.nextCursor ?? undefined;
  } while (after);
  return { processedCount };
}
