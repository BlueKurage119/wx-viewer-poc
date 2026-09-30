import type { VenueId } from './venueForecastTargets.js';

export type TerminalMode = 'H' | 'K';

const reservedTerminalIds = new Set([
  'api',
  'assets',
  'audio',
  'config',
  'src',
  'node_modules',
  'public',
  'favicon.ico',
  'index.html',
  'robots.txt',
]);

export function isValidTerminalId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-z][a-z0-9-]{0,31}$/.test(value) &&
    !reservedTerminalIds.has(value)
  );
}

export interface TerminalDefinition {
  readonly id: string;
  readonly name: string;
  readonly mode: TerminalMode;
  readonly venueId: VenueId;
}

export interface TerminalConfigResponse {
  readonly generation: string;
  readonly venueGeneration: string;
  readonly terminals: readonly TerminalDefinition[];
}

export interface TerminalRegistry {
  readonly generation: string;
  resolveTerminal(id: unknown): TerminalDefinition | null;
  listTerminals(): readonly TerminalDefinition[];
}

export function createTerminalRegistry(
  definitions: readonly TerminalDefinition[],
  generation: string,
): TerminalRegistry {
  const terminals = Object.freeze(definitions.map((terminal) => Object.freeze({ ...terminal })));
  const byId = new Map(terminals.map((terminal) => [terminal.id, terminal]));
  return Object.freeze({
    generation,
    resolveTerminal(id: unknown): TerminalDefinition | null {
      return typeof id === 'string' ? (byId.get(id) ?? null) : null;
    },
    listTerminals(): readonly TerminalDefinition[] {
      return terminals;
    },
  });
}

export function isTerminalConfigResponse(value: unknown): value is TerminalConfigResponse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  if (
    typeof response.generation !== 'string' ||
    !/^[a-f0-9]{64}$/.test(response.generation) ||
    typeof response.venueGeneration !== 'string' ||
    !/^[a-f0-9]{64}$/.test(response.venueGeneration) ||
    !Array.isArray(response.terminals) ||
    response.terminals.length === 0
  )
    return false;
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const item of response.terminals) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return false;
    const terminal = item as Record<string, unknown>;
    if (
      Object.keys(terminal).length !== 4 ||
      !Object.keys(terminal).every((key) => ['id', 'name', 'mode', 'venueId'].includes(key)) ||
      !isValidTerminalId(terminal.id) ||
      typeof terminal.name !== 'string' ||
      terminal.name.trim() !== terminal.name ||
      terminal.name.length < 1 ||
      terminal.name.length > 80 ||
      (terminal.mode !== 'H' && terminal.mode !== 'K') ||
      typeof terminal.venueId !== 'string' ||
      terminal.venueId.length === 0 ||
      ids.has(terminal.id) ||
      names.has(terminal.name)
    )
      return false;
    ids.add(terminal.id);
    names.add(terminal.name);
  }
  return true;
}
