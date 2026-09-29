import type { UtcIso8601String, VenueRegistry } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import {
  findTelegramReceptionById,
  listTelegramReceptions,
} from '../repositories/telegramReceptionRepository.js';
import {
  VPFD51_TELEGRAM_TYPE,
  VPFD61_TELEGRAM_TYPE,
  VPFW60_TELEGRAM_TYPE,
} from '../repositories/types.js';
import { processEarlyWarningReceptionForVenues } from './jmaEarlyWarningProcessor.js';
import { processVpfd51ReceptionForVenues } from './jmaVpfd51Processor.js';

/** 新会場に採用行がない既存 C5/C6 原文だけを起動前に再処理する。 */
export function reprocessPendingVenueForecastReceptions(
  connection: DatabaseConnection,
  processedAt: UtcIso8601String,
  registry: VenueRegistry,
): number {
  let offset = 0;
  let processed = 0;
  for (;;) {
    const page = listTelegramReceptions(connection, { limit: 1000, offset });
    for (const summary of page) {
      if (
        summary.telegramType !== VPFD61_TELEGRAM_TYPE &&
        summary.telegramType !== VPFW60_TELEGRAM_TYPE &&
        summary.telegramType !== VPFD51_TELEGRAM_TYPE
      )
        continue;
      if (
        registry
          .listVenueIds()
          .every((venueId) => summary.adoptions.some((row) => row.venueId === venueId))
      )
        continue;
      const reception = findTelegramReceptionById(connection, summary.id);
      if (!reception) continue;
      if (reception.telegramType === VPFD51_TELEGRAM_TYPE)
        processVpfd51ReceptionForVenues(connection, reception, processedAt, registry);
      else processEarlyWarningReceptionForVenues(connection, reception, processedAt, registry);
      processed += 1;
    }
    if (page.length < 1000) return processed;
    offset += page.length;
  }
}
