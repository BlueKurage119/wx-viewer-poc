import type { ReactNode } from 'react';
import type { TerminalRegistry } from '@wx-viewer-poc/shared';
import { TerminalRegistryContext } from './terminalRegistryContext';

export function TerminalRegistryProvider({
  value,
  children,
}: {
  readonly value: TerminalRegistry;
  readonly children: ReactNode;
}) {
  return (
    <TerminalRegistryContext.Provider value={value}>{children}</TerminalRegistryContext.Provider>
  );
}
