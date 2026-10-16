import { loadVenueConfig } from '../../src/config/venueConfigLoader.js';
import { loadTerminalConfig } from '../../src/config/terminalConfigLoader.js';

/** テスト用固定の会場設定。実設定(config/)・ローカル設定に依存しない。 */
export const testVenueConfigUrl = new URL('../fixtures/config/venues.yaml', import.meta.url);
/** テスト用固定の端末設定。実設定(config/)・ローカル設定に依存しない。 */
export const testTerminalConfigUrl = new URL('../fixtures/config/terminals.yaml', import.meta.url);

/** テスト用固定のpolling設定。実設定(config/)・ローカル設定に依存しない。 */
export const testPollingConfigUrl = new URL('../fixtures/polling/schedule.yaml', import.meta.url);

const venueConfig = loadVenueConfig({ baseUrl: testVenueConfigUrl });

/** 既存テストに明示注入する検証済み会場レジストリ。 */
export const testVenueRegistry = venueConfig.registry;
export const testVenueGeneration = venueConfig.response.generation;
export const eastVenueId = testVenueRegistry.resolveVenueId('east')!;
export const trcVenueId = testVenueRegistry.resolveVenueId('trc')!;

/** 既存テストに明示注入する検証済み端末レジストリ。 */
export const testTerminalRegistry = loadTerminalConfig({
  baseUrl: testTerminalConfigUrl,
  venueRegistry: testVenueRegistry,
  venueGeneration: testVenueGeneration,
}).registry;
