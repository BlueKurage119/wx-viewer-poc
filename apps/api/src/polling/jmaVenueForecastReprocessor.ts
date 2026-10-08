import {
  createVenueRegistry,
  type UtcIso8601String,
  type VenueId,
  type VenueRegistry,
} from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import {
  findTelegramReceptionById,
  listTelegramReceptions,
} from '../repositories/telegramReceptionRepository.js';
import {
  VPWP50_TELEGRAM_TYPE,
  type TelegramReceptionSummary,
  VPFD51_TELEGRAM_TYPE,
  VPFD61_TELEGRAM_TYPE,
  VPFW60_TELEGRAM_TYPE,
} from '../repositories/types.js';
import { processEarlyWarningReceptionForVenues } from './jmaEarlyWarningProcessor.js';
import { resolveEarlyWarningTargetAreas } from '../venueForecastTargets.js';
import { processVpfd51ReceptionForVenues } from './jmaVpfd51Processor.js';
import { processVpwp50ReceptionForAllVenues } from './jmaVpwp50Processor.js';
import { compareTelegramVersions } from '../repositories/snapshot.js';

/** 原文を読む前に履歴の対象区域・版と保存済みの版だけで復旧対象を絞る。 */
function needsSnapshotRecovery(
  connection: DatabaseConnection,
  summary: TelegramReceptionSummary,
  registry: VenueRegistry,
  venueId: VenueId,
): boolean {
  if (
    !summary.hasRawBody ||
    !summary.controlStatus ||
    !summary.reportDateTime ||
    !summary.controlDateTime
  )
    return false;
  const venue = registry.getVenue(venueId);
  const hasArea = (code: string) => summary.areas.some((area) => area.areaCode === code);
  let saved: { reportDateTime: string; controlDateTime: string } | undefined;
  if (summary.telegramType === VPWP50_TELEGRAM_TYPE) {
    if (!hasArea(venue.warningTimeseries.municipalCode)) return false;
    saved = connection
      .prepare(
        `SELECT report_datetime AS reportDateTime, control_datetime AS controlDateTime
      FROM warning_timeseries_snapshot WHERE area_code = ? AND control_status = ?`,
      )
      .get(venue.warningTimeseries.municipalCode, summary.controlStatus) as typeof saved;
  } else if (summary.telegramType === VPFD51_TELEGRAM_TYPE) {
    if (!hasArea(venue.broadForecast.areaCode)) return false;
    saved = connection
      .prepare(
        `SELECT report_datetime AS reportDateTime, control_datetime AS controlDateTime
      FROM area_timeseries_snapshot WHERE area_code = ? AND station_code = ? AND control_status = ?`,
      )
      .get(
        venue.broadForecast.areaCode,
        venue.temperatureForecast.stationCode,
        summary.controlStatus,
      ) as typeof saved;
  } else {
    const segment = summary.telegramType === VPFW60_TELEGRAM_TYPE ? 'far' : 'near';
    // processorと同じ候補順を使い、併記された府県区域を未保存と誤判定しない。
    const target = resolveEarlyWarningTargetAreas(registry, venueId, segment).find((area) =>
      hasArea(area.forecastAreaCode),
    );
    if (!target) return false;
    saved = connection
      .prepare(
        `SELECT report_datetime AS reportDateTime, control_datetime AS controlDateTime
      FROM early_warning_snapshot WHERE area_code = ? AND segment = ? AND control_status = ?`,
      )
      .get(target.forecastAreaCode, segment, summary.controlStatus) as typeof saved;
  }
  return (
    !saved ||
    compareTelegramVersions(
      { reportDateTime: summary.reportDateTime, controlDateTime: summary.controlDateTime },
      saved,
    ) > 0
  );
}

/**
 * 未採用のC4/C5/C6原文と、採用済みでも保存値より新しい原文を起動前に再処理する。
 * 受信時刻・登録ID順のページングを維持し、新旧判定はrepositoryで保証する。
 */
export function reprocessPendingVenueForecastReceptions(
  connection: DatabaseConnection,
  _processedAt: UtcIso8601String,
  registry: VenueRegistry,
): number {
  let offset = 0;
  let processed = 0;
  for (;;) {
    const page = listTelegramReceptions(connection, {
      limit: 1000,
      offset,
      receivedAtOrder: 'asc',
    });
    for (const summary of page) {
      if (
        summary.telegramType !== VPWP50_TELEGRAM_TYPE &&
        summary.telegramType !== VPFD61_TELEGRAM_TYPE &&
        summary.telegramType !== VPFW60_TELEGRAM_TYPE &&
        summary.telegramType !== VPFD51_TELEGRAM_TYPE
      )
        continue;
      const hasPendingAdoption = !registry
        .listVenueIds()
        .every((venueId) =>
          summary.adoptions.some(
            (row) =>
              row.venueId === venueId &&
              !(
                summary.telegramType === VPFW60_TELEGRAM_TYPE &&
                row.adoptionResult === '対象地域外' &&
                resolveEarlyWarningTargetAreas(registry, venueId, 'far').some((target) =>
                  summary.areas.some((area) => area.areaCode === target.forecastAreaCode),
                )
              ),
          ),
        );
      const recoveryVenues = hasPendingAdoption
        ? []
        : registry
            .listVenues()
            .filter((venue) => needsSnapshotRecovery(connection, summary, registry, venue.venueId));
      if (!hasPendingAdoption && recoveryVenues.length === 0) continue;
      const reception = findTelegramReceptionById(connection, summary.id);
      if (!reception) continue;
      const targets = hasPendingAdoption
        ? registry
        : createVenueRegistry(recoveryVenues, registry.generation);
      // 未採用会場が同居していても、再処理を新規受信と見せず原受信時刻を使う。
      const replayedAt = reception.receivedAt;
      if (reception.telegramType === VPWP50_TELEGRAM_TYPE)
        processVpwp50ReceptionForAllVenues(connection, reception, replayedAt, targets);
      else if (reception.telegramType === VPFD51_TELEGRAM_TYPE)
        processVpfd51ReceptionForVenues(connection, reception, replayedAt, targets);
      else processEarlyWarningReceptionForVenues(connection, reception, replayedAt, targets);
      processed += 1;
    }
    if (page.length < 1000) return processed;
    offset += page.length;
  }
}
