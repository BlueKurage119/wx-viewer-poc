import { createContext, useContext } from 'react';
import type { VenueRegistry } from '@wx-viewer-poc/shared';

export const VenueRegistryContext = createContext<VenueRegistry | null>(null);

export function useVenueRegistry(): VenueRegistry {
  const registry = useContext(VenueRegistryContext);
  if (!registry) {
    throw new Error('会場設定が読み込まれていません');
  }
  return registry;
}
