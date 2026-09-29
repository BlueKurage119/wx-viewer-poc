import type { ReactNode } from 'react';
import type { VenueRegistry } from '@wx-viewer-poc/shared';
import { VenueRegistryContext } from './venueRegistryContext';

export function VenueRegistryProvider({
  value,
  children,
}: {
  readonly value: VenueRegistry;
  readonly children: ReactNode;
}) {
  return <VenueRegistryContext.Provider value={value}>{children}</VenueRegistryContext.Provider>;
}
