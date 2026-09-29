import { configureVenueRegistry } from '@wx-viewer-poc/shared';
import { loadVenueConfig } from '../../api/src/config/venueConfigLoader.ts';

configureVenueRegistry(loadVenueConfig().registry);
