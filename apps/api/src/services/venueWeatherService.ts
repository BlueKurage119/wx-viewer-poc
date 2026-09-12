import { resolveVenueForecastTargets, type VenueId } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import { findWarningCurrentSnapshot } from '../repositories/warningCurrentRepository.js';
import { findWarningTimeseriesSnapshot } from '../repositories/warningTimeseriesRepository.js';
import { listBosaiBulletins } from '../repositories/bosaiBulletinRepository.js';
import { listTelegramReceptions } from '../repositories/telegramReceptionRepository.js';
import {
  resolveWarningCurrentTargetArea,
  resolveWarningTimeseriesTargetArea,
} from '../venueForecastTargets.js';
import type {
  BosaiBulletin,
  ControlStatus,
  ListBosaiBulletinsOptions,
  ListTelegramReceptionsOptions,
  TelegramReceptionSummary,
  WarningCurrentSnapshot,
  WarningTimeseriesSnapshot,
} from '../repositories/types.js';

/**
 * 会場別のデータを返す内部境界。HTTP ルータからは呼ばれない（本 Issue ではエンドポイントを作らない）。
 * controlStatus は既定値に固定せず呼出し側に明示させ、訓練（training）と本番（normal）の現況を
 * 同一視しない（isTraining の伝播を単純化しない）。
 */
export function getVenueWarningCurrent(
  connection: DatabaseConnection,
  venueId: VenueId,
  controlStatus: ControlStatus,
): WarningCurrentSnapshot | null {
  const targetArea = resolveWarningCurrentTargetArea(venueId);
  return findWarningCurrentSnapshot(connection, targetArea.municipalCode, controlStatus);
}

export function getVenueWarningTimeseries(
  connection: DatabaseConnection,
  venueId: VenueId,
  controlStatus: ControlStatus,
): WarningTimeseriesSnapshot | null {
  const targetArea = resolveWarningTimeseriesTargetArea(venueId);
  return findWarningTimeseriesSnapshot(connection, targetArea.municipalCode, controlStatus);
}

export function listVenueBosaiBulletins(
  connection: DatabaseConnection,
  venueId: VenueId,
  options: Omit<ListBosaiBulletinsOptions, 'includedAreaCodes'>,
): readonly BosaiBulletin[] {
  const includedAreaCodes = resolveVenueForecastTargets(venueId).bosaiBulletin.includedAreaCodes;
  return listBosaiBulletins(connection, { ...options, includedAreaCodes });
}

export function listVenueTelegramReceptions(
  connection: DatabaseConnection,
  venueId: VenueId,
  options?: Omit<ListTelegramReceptionsOptions, 'adoptionVenueId'>,
): readonly TelegramReceptionSummary[] {
  return listTelegramReceptions(connection, { ...options, adoptionVenueId: venueId });
}
