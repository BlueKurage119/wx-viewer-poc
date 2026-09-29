import { createContext, useContext } from 'react';
import type { VenueRegistry } from '@wx-viewer-poc/shared';

export const VenueRegistryContext = createContext<VenueRegistry | null>(null);

let currentVenueRegistry: VenueRegistry | null = null;

/** 起動時に検証済み会場レジストリを、API応答の検証に使用する。 */
export function setCurrentVenueRegistry(registry: VenueRegistry): void {
  currentVenueRegistry = registry;
}

export function getCurrentVenueRegistry(): VenueRegistry {
  if (!currentVenueRegistry) {
    throw new Error('会場設定が読み込まれていません');
  }
  return currentVenueRegistry;
}

export function useVenueRegistry(): VenueRegistry {
  const registry = useContext(VenueRegistryContext);
  if (!registry) {
    throw new Error('会場設定が読み込まれていません');
  }
  return registry;
}
