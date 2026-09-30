import { loadVenueConfig } from '../../api/src/config/venueConfigLoader.ts';
import { loadTerminalConfig } from '../../api/src/config/terminalConfigLoader.ts';
import { createTerminals } from '../src/shell/config.ts';
import { setCurrentVenueRegistry } from '../src/venueRegistryContext.ts';

/** Web テストで共有する検証済み会場レジストリ。 */
export const testVenueRegistry = loadVenueConfig().registry;
setCurrentVenueRegistry(testVenueRegistry);
export const eastVenueId = testVenueRegistry.resolveVenueId('east')!;
export const trcVenueId = testVenueRegistry.resolveVenueId('trc')!;
export const eastVenueTargets = testVenueRegistry.getVenue(eastVenueId);
export const trcVenueTargets = testVenueRegistry.getVenue(trcVenueId);
export const testTerminalRegistry = loadTerminalConfig({
  venueRegistry: testVenueRegistry,
}).registry;
export const testTerminals = createTerminals(testVenueRegistry, testTerminalRegistry);
export const eastVenue = testTerminals.find((terminal) => terminal.venue.id === eastVenueId)!.venue;
export const trcVenue = testTerminals.find((terminal) => terminal.venue.id === trcVenueId)!.venue;
