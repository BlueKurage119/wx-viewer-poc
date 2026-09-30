import { loadVenueConfig } from '../../src/config/venueConfigLoader.js';

/** 既存テストに明示注入する検証済み会場レジストリ。 */
export const testVenueRegistry = loadVenueConfig().registry;
export const eastVenueId = testVenueRegistry.resolveVenueId('east')!;
export const trcVenueId = testVenueRegistry.resolveVenueId('trc')!;

import { loadTerminalConfig } from '../../src/config/terminalConfigLoader.js';

/** 既存テストに明示注入する検証済み端末レジストリ。 */
export const testTerminalRegistry = loadTerminalConfig({
  venueRegistry: testVenueRegistry,
}).registry;
