import type {
  StartupNotificationInitializingResponse,
  StartupNotificationReadyResponse,
} from '@wx-viewer-poc/shared';
import { getOrCreateTerminalSession, type TerminalSessionState } from '../session/terminalSession';

export type StartupNotificationClientResult =
  | StartupNotificationReadyResponse
  | StartupNotificationInitializingResponse
  | { readonly status: 'unavailable'; readonly reason: 'session' | 'network' | 'server' };

export interface StartupNotificationClientDependencies {
  readonly getSession: (terminalId: string) => TerminalSessionState;
  readonly fetch: typeof fetch;
}

export interface StartupNotificationClient {
  fetchStartupNotifications(
    terminalId: string,
    signal?: AbortSignal,
    options?: { readonly retry?: boolean },
  ): Promise<StartupNotificationClientResult>;
}

function isInitializing(value: unknown): value is StartupNotificationInitializingResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { status?: unknown }).status === 'initializing' &&
    typeof (value as { venueId?: unknown }).venueId === 'string'
  );
}

function isReady(value: unknown): value is StartupNotificationReadyResponse {
  const notifications =
    typeof value === 'object' && value !== null
      ? (value as { notifications?: unknown }).notifications
      : undefined;
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { status?: unknown }).status === 'ready' &&
    Array.isArray(notifications) &&
    notifications.every(isNotification) &&
    typeof (value as { cursor?: unknown }).cursor === 'string'
  );
}

function isNotification(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  const output = item.output;
  return (
    typeof item.outputId === 'string' &&
    (item.category === 'warning' ||
      item.category === 'question' ||
      item.category === 'emergency') &&
    (item.origin === 'weather' || item.origin === 'system') &&
    typeof item.occurredAt === 'string' &&
    Array.isArray(item.targets) &&
    typeof output === 'object' &&
    output !== null &&
    typeof (output as Record<string, unknown>).summary === 'string' &&
    typeof (output as Record<string, unknown>).ackRequired === 'boolean'
  );
}

/** StrictMode の購読解除では共有 POST を中断しない。一端末につき 1 回だけ送信する。 */
export function createStartupNotificationClient(
  dependencies: StartupNotificationClientDependencies,
): StartupNotificationClient {
  const completed = new Map<string, StartupNotificationClientResult>();
  const inFlight = new Map<string, Promise<StartupNotificationClientResult>>();

  return {
    fetchStartupNotifications(
      terminalId: string,
      signal?: AbortSignal,
      options?: { readonly retry?: boolean },
    ) {
      // 呼出し元の中断は共有 POST を中断しない。StrictMode の cleanup は購読解除だけを表す。
      void signal;
      const cached = options?.retry ? undefined : completed.get(terminalId);
      if (cached !== undefined) return Promise.resolve(cached);
      const current = inFlight.get(terminalId);
      if (current !== undefined) return current;

      const session = dependencies.getSession(terminalId);
      if (session.status !== 'ready') {
        const unavailable: StartupNotificationClientResult = {
          status: 'unavailable',
          reason: 'session',
        };
        completed.set(terminalId, unavailable);
        return Promise.resolve(unavailable);
      }

      const request = dependencies
        .fetch('/api/notifications/startup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ terminalId, sessionId: session.sessionId }),
        })
        .then(async (response) => {
          if (!response.ok && response.status !== 202) {
            return { status: 'unavailable', reason: 'server' } as const;
          }
          let body: unknown;
          try {
            body = await response.json();
          } catch {
            return { status: 'unavailable', reason: 'server' } as const;
          }
          if (isReady(body) || isInitializing(body)) return body;
          return { status: 'unavailable', reason: 'server' } as const;
        })
        .catch(() => ({ status: 'unavailable', reason: 'network' }) as const)
        .then((result) => {
          completed.set(terminalId, result);
          return result;
        })
        .finally(() => {
          inFlight.delete(terminalId);
        });
      inFlight.set(terminalId, request);
      return request;
    },
  };
}

let defaultClient: StartupNotificationClient | null = null;

function getDefaultClient(): StartupNotificationClient {
  if (defaultClient === null) {
    defaultClient = createStartupNotificationClient({
      getSession: getOrCreateTerminalSession,
      fetch: window.fetch.bind(window),
    });
  }
  return defaultClient;
}

export function fetchStartupNotifications(
  terminalId: string,
  signal?: AbortSignal,
  options?: { readonly retry?: boolean },
): Promise<StartupNotificationClientResult> {
  return getDefaultClient().fetchStartupNotifications(terminalId, signal, options);
}
