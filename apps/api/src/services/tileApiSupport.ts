import type {
  Availability,
  TileApiError,
  TileUpstreamAccess,
  UtcIso8601String,
} from '@wx-viewer-poc/shared';
import type { UpstreamAccess } from '../config/pollingSchedule.js';

export type TileDeliveryResult =
  | {
      readonly kind: 'success';
      readonly buffer: Buffer;
      readonly catalogAvailability: Availability;
      readonly tileResult: 'cached' | 'downloaded';
      readonly storedAt: UtcIso8601String;
    }
  | {
      readonly kind: 'error';
      readonly httpStatus: number;
      readonly error: TileApiError;
    };

export class ImageServicesInitializingError extends Error {
  constructor(message = 'Image services are initializing') {
    super(message);
    this.name = 'ImageServicesInitializingError';
  }
}

export function projectUpstreamAccess(
  access: UpstreamAccess,
  enablePolling: boolean,
): TileUpstreamAccess {
  if (!enablePolling) {
    return {
      allowed: false,
      reason: 'disabled',
      nextAllowedAt: access.nextAllowedAt,
    };
  }
  if (!access.allowed) {
    return {
      allowed: false,
      reason: 'scheduled_stopped',
      nextAllowedAt: access.nextAllowedAt,
    };
  }
  return {
    allowed: true,
    reason: null,
    nextAllowedAt: access.nextAllowedAt,
  };
}
