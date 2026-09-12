import type { VenueId } from './venueForecastTargets.js';

export type TerminalMode = 'H' | 'K';

export interface TerminalDefinition {
  readonly id: string;
  readonly mode: TerminalMode;
  readonly venueId: VenueId;
}

/** API と web が共用する、端末 ID から会場を決定する最小台帳。 */
export const TERMINAL_DEFINITIONS: readonly TerminalDefinition[] = Object.freeze([
  Object.freeze({ id: 'hkeagh01', mode: 'H', venueId: 'east' }),
  Object.freeze({ id: 'kkeagh01', mode: 'K', venueId: 'east' }),
  Object.freeze({ id: 'htrcph01', mode: 'H', venueId: 'trc' }),
  Object.freeze({ id: 'ktrcph01', mode: 'K', venueId: 'trc' }),
]);

export function resolveTerminalDefinition(id: unknown): TerminalDefinition | null {
  if (typeof id !== 'string') {
    return null;
  }
  return TERMINAL_DEFINITIONS.find((terminal) => terminal.id === id) ?? null;
}
