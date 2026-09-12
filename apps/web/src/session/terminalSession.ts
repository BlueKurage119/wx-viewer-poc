import { isTerminalSessionId, type TerminalSessionId } from '@wx-viewer-poc/shared';

export type TerminalSessionState =
  | {
      readonly status: 'ready';
      readonly sessionId: TerminalSessionId;
      readonly persistence: 'session' | 'memory';
    }
  | { readonly status: 'unavailable'; readonly reason: 'random' };

export interface TerminalSessionDependencies {
  readonly getStorage: () => Pick<Storage, 'getItem' | 'setItem'>;
  readonly fillRandom: (bytes: Uint8Array) => void;
}

export interface TerminalSessionStore {
  getOrCreate(terminalId: string): TerminalSessionState;
}

function formatUuidV4(bytes: Uint8Array): TerminalSessionId {
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex: string[] = new Array(16);
  for (let i = 0; i < 16; i++) {
    hex[i] = bytes[i]!.toString(16).padStart(2, '0');
  }

  return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`;
}

export function createTerminalSessionStore(
  dependencies: TerminalSessionDependencies,
): TerminalSessionStore {
  const memorySessions = new Map<string, TerminalSessionState>();

  return {
    getOrCreate(terminalId: string): TerminalSessionState {
      if (typeof terminalId !== 'string' || terminalId.length === 0) {
        throw new Error('terminalId must be a non-empty string');
      }

      const existingState = memorySessions.get(terminalId);
      if (existingState !== undefined) {
        return existingState;
      }

      const storageKey = `wx-viewer:terminal-session:v1:${terminalId}`;
      let storage: Pick<Storage, 'getItem' | 'setItem'> | null = null;
      let storedValue: string | null = null;

      try {
        storage = dependencies.getStorage();
        storedValue = storage.getItem(storageKey);
      } catch {
        storage = null;
        storedValue = null;
      }

      if (storedValue !== null && isTerminalSessionId(storedValue)) {
        const state: TerminalSessionState = {
          status: 'ready',
          sessionId: storedValue,
          persistence: 'session',
        };
        memorySessions.set(terminalId, state);
        return state;
      }

      const randomBytes = new Uint8Array(16);
      try {
        dependencies.fillRandom(randomBytes);
      } catch {
        return { status: 'unavailable', reason: 'random' };
      }

      const sessionId = formatUuidV4(randomBytes);
      let persistence: 'session' | 'memory' = 'memory';

      if (storage !== null) {
        try {
          storage.setItem(storageKey, sessionId);
          persistence = 'session';
        } catch {
          persistence = 'memory';
        }
      }

      const state: TerminalSessionState = {
        status: 'ready',
        sessionId,
        persistence,
      };
      memorySessions.set(terminalId, state);
      return state;
    },
  };
}

const defaultDependencies: TerminalSessionDependencies = {
  getStorage: () => window.sessionStorage,
  fillRandom: (bytes: Uint8Array) => {
    window.crypto.getRandomValues(bytes);
  },
};

let defaultStore: TerminalSessionStore | null = null;

export function getOrCreateTerminalSession(terminalId: string): TerminalSessionState {
  if (defaultStore === null) {
    defaultStore = createTerminalSessionStore(defaultDependencies);
  }
  return defaultStore.getOrCreate(terminalId);
}
