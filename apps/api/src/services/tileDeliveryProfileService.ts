import type { TerminalDefinition, TileDeliveryProfile } from '@wx-viewer-poc/shared';

export interface TileDeliveryProfileService {
  getProfile(terminal: TerminalDefinition): TileDeliveryProfile;
}

export function createStaticTileDeliveryProfileService(
  profile: TileDeliveryProfile,
): TileDeliveryProfileService {
  return {
    getProfile(terminal: TerminalDefinition): TileDeliveryProfile {
      void terminal;
      return profile;
    },
  };
}
