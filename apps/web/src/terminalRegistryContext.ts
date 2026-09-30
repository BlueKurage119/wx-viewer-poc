import { createContext, useContext } from 'react';
import type { TerminalRegistry } from '@wx-viewer-poc/shared';

export const TerminalRegistryContext = createContext<TerminalRegistry | null>(null);

export function useTerminalRegistry(): TerminalRegistry {
  const registry = useContext(TerminalRegistryContext);
  if (!registry) throw new Error('端末設定が読み込まれていません');
  return registry;
}
