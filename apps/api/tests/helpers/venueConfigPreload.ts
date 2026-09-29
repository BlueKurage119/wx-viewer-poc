import { configureVenueRegistry } from '@wx-viewer-poc/shared';
import { loadVenueConfig } from '../../src/config/venueConfigLoader.js';

configureVenueRegistry(loadVenueConfig().registry);
