import type { Availability } from '@wx-viewer-poc/shared';
import type { ControlStatus, SnapshotMetadataInput, TelegramMetadataInput } from './types.js';

const VALID_AVAILABILITY: ReadonlySet<string> = new Set<Availability>([
  'available',
  'stale',
  'unavailable',
]);

const VALID_CONTROL_STATUS: ReadonlySet<string> = new Set<ControlStatus>([
  'normal',
  'training',
  'test',
]);

export function validateAvailability(availability: string): asserts availability is Availability {
  if (!VALID_AVAILABILITY.has(availability)) {
    throw new Error(`Invalid availability: ${availability}`);
  }
}

export function validateControlStatus(
  controlStatus: string,
): asserts controlStatus is ControlStatus {
  if (!VALID_CONTROL_STATUS.has(controlStatus)) {
    throw new Error(`Invalid controlStatus: ${controlStatus}`);
  }
}

export function validateNonEmptyString(value: string, fieldName: string): void {
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
}

export function validateTileRelativePath(filePath: string): void {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path: path must be a non-empty string');
  }
  if (filePath.startsWith('/') || filePath.startsWith('\\')) {
    throw new Error(`Invalid file path: absolute path is not allowed: ${filePath}`);
  }
  const parts = filePath.split(/[/\\]/);
  if (parts.some((part) => part === '..')) {
    throw new Error(`Invalid file path: parent directory traversal is not allowed: ${filePath}`);
  }
}

export function validateMetadataInput(metadata: SnapshotMetadataInput): void {
  validateNonEmptyString(metadata.source, 'metadata.source');
  validateNonEmptyString(metadata.issuedAt, 'metadata.issuedAt');
  validateNonEmptyString(metadata.fetchedAt, 'metadata.fetchedAt');
  validateAvailability(metadata.availability);
}

export function validateTelegramInput(telegram: TelegramMetadataInput): void {
  validateControlStatus(telegram.controlStatus);
  validateNonEmptyString(telegram.infoType, 'telegram.infoType');
  validateNonEmptyString(telegram.reportDateTime, 'telegram.reportDateTime');
  validateNonEmptyString(telegram.controlDateTime, 'telegram.controlDateTime');
}

export interface SnapshotMetadataRow {
  readonly source: string;
  readonly issued_at: string;
  readonly valid_at: string | null;
  readonly valid_from: string | null;
  readonly valid_to: string | null;
  readonly fetched_at: string;
  readonly last_success_at: string | null;
  readonly availability: string;
  readonly source_version: string | null;
}

export function mapMetadataRow(row: SnapshotMetadataRow): SnapshotMetadataInput {
  validateAvailability(row.availability);
  return {
    source: row.source,
    issuedAt: row.issued_at,
    validAt: row.valid_at,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    fetchedAt: row.fetched_at,
    lastSuccessAt: row.last_success_at,
    availability: row.availability,
    sourceVersion: row.source_version,
  };
}

export interface TelegramMetadataRow {
  readonly control_status: string;
  readonly info_type: string;
  readonly event_id: string | null;
  readonly report_datetime: string;
  readonly control_datetime: string;
}

export function mapTelegramRow(row: TelegramMetadataRow): TelegramMetadataInput {
  validateControlStatus(row.control_status);
  return {
    controlStatus: row.control_status,
    infoType: row.info_type,
    eventId: row.event_id,
    reportDateTime: row.report_datetime,
    controlDateTime: row.control_datetime,
  };
}
