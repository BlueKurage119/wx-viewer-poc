import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import { validateUtcIso8601String } from '../repositories/snapshot.js';
import type { KikikuruLayer } from './kikikuruTypes.js';

export const KIKIKURU_TARGET_TIMES_URL =
  'https://www.jma.go.jp/bosai/jmatile/data/risk/targetTimes.json' as const;
export const KIKIKURU_TILE_URL_TEMPLATE =
  'https://www.jma.go.jp/bosai/jmatile/data/risk/{basetime}/{member}/{validtime}/surf/{imageId}/{z}/{x}/{y}.png' as const;

const FOURTEEN_DIGIT_PATTERN = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;

export function parse14DigitUtcToIso(val: string): UtcIso8601String {
  if (typeof val !== 'string') {
    throw new Error(`Time value must be a string: ${String(val)}`);
  }
  const match = FOURTEEN_DIGIT_PATTERN.exec(val);
  if (!match) {
    throw new Error(`Invalid 14-digit UTC time string: ${val}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (month < 1 || month > 12) {
    throw new Error(`Invalid month in 14-digit UTC time: ${val}`);
  }
  if (day < 1 || day > 31) {
    throw new Error(`Invalid day in 14-digit UTC time: ${val}`);
  }
  if (hour < 0 || hour > 23) {
    throw new Error(`Invalid hour in 14-digit UTC time: ${val}`);
  }
  if (minute < 0 || minute > 59) {
    throw new Error(`Invalid minute in 14-digit UTC time: ${val}`);
  }
  if (second < 0 || second > 59) {
    throw new Error(`Invalid second in 14-digit UTC time: ${val}`);
  }

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    throw new Error(
      `Invalid calendar date in 14-digit UTC time (e.g. leap year/month day mismatch): ${val}`,
    );
  }

  return date.toISOString() as UtcIso8601String;
}

export function formatIsoTo14DigitUtc(iso: UtcIso8601String): string {
  validateUtcIso8601String(iso, 'iso');
  const date = new Date(iso);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  const second = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hour}${minute}${second}`;
}

export function buildKikikuruTileUrl(
  baseTimeIso: UtcIso8601String,
  validTimeIso: UtcIso8601String,
  member: string,
  imageId: string,
  zoom: number,
  tileX: number,
  tileY: number,
): string {
  const base14 = formatIsoTo14DigitUtc(baseTimeIso);
  const valid14 = formatIsoTo14DigitUtc(validTimeIso);
  return `https://www.jma.go.jp/bosai/jmatile/data/risk/${base14}/${member}/${valid14}/surf/${imageId}/${zoom}/${tileX}/${tileY}.png`;
}

export function buildKikikuruTileRelativePath(
  layer: KikikuruLayer,
  baseTimeIso: UtcIso8601String,
  member: string,
  validTimeIso: UtcIso8601String,
  imageId: string,
  zoom: number,
  tileX: number,
  tileY: number,
  contentHash: string,
): string {
  const base14 = formatIsoTo14DigitUtc(baseTimeIso);
  const valid14 = formatIsoTo14DigitUtc(validTimeIso);
  return `risk/${layer}/${base14}/${member}/${valid14}/${imageId}/${zoom}/${tileX}/${tileY}/${contentHash}.png`;
}
