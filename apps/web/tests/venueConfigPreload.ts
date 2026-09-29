import { loadVenueConfig } from '../../api/src/config/venueConfigLoader.ts';
import { createTerminals } from '../src/shell/config.ts';

/** Web テストで共有する検証済み会場レジストリ。 */
export const testVenueRegistry = loadVenueConfig().registry;
export const eastVenueId = testVenueRegistry.resolveVenueId('east')!;
export const trcVenueId = testVenueRegistry.resolveVenueId('trc')!;
export const eastVenueTargets = testVenueRegistry.getVenue(eastVenueId);
export const trcVenueTargets = testVenueRegistry.getVenue(trcVenueId);
export const testTerminals = createTerminals(testVenueRegistry);
export const eastVenue = testTerminals.find((terminal) => terminal.venue.id === eastVenueId)!.venue;
export const trcVenue = testTerminals.find((terminal) => terminal.venue.id === trcVenueId)!.venue;
