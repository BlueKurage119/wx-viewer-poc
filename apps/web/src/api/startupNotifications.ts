import type {
  StartupNotificationInitializingResponse,
  StartupNotificationReadyResponse,
} from '@wx-viewer-poc/shared';
import { isNotificationDeltaCursor } from '@wx-viewer-poc/shared';
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
  if (!isRecord(value)) return false;
  const { notifications, session } = value;
  return (
    value.status === 'ready' &&
    typeof value.terminalId === 'string' &&
    typeof value.venueId === 'string' &&
    typeof value.serverGenerationId === 'string' &&
    typeof value.generatedAt === 'string' &&
    isRecord(session) &&
    (session.kind === 'startup' || session.kind === 'continuation') &&
    typeof session.firstInquiredAt === 'string' &&
    typeof value.warningClaimed === 'boolean' &&
    Array.isArray(notifications) &&
    notifications.every(isNotification) &&
    isNotificationDeltaCursor(value.cursor)
  );
}

function isNotification(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const item = value;
  const output = item.output;
  return (
    typeof item.outputId === 'string' &&
    (item.category === 'warning' ||
      item.category === 'question' ||
      item.category === 'emergency') &&
    ((item.origin === 'weather' &&
      (item.sourceType === 'warning_current' || item.sourceType === 'bosai_bulletin')) ||
      (item.origin === 'system' && item.sourceType === 'fetch_health')) &&
    (item.sourceVersion === null || typeof item.sourceVersion === 'string') &&
    typeof item.occurredAt === 'string' &&
    isTargets(item.targets) &&
    isRelatedRefs(item.relatedRefs) &&
    typeof item.isTraining === 'boolean' &&
    isResolvedOutput(output)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTargets(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (target) =>
        isRecord(target) &&
        (target.kind === 'area' || target.kind === 'point' || target.kind === 'equipment') &&
        typeof target.codeType === 'string' &&
        typeof target.code === 'string' &&
        typeof target.name === 'string',
    )
  );
}

function isRelatedRefs(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (ref) => isRecord(ref) && typeof ref.type === 'string' && typeof ref.ref === 'string',
    )
  );
}

function isMessageDefinition(value: unknown): boolean {
  return isRecord(value) && typeof value.id === 'string' && typeof value.version === 'string';
}

function isResolvedOutput(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isMessageDefinition(value.messageDefinition) ||
    !isRecord(value.display)
  ) {
    return false;
  }
  const { display, action } = value;
  return (
    typeof value.ackRequired === 'boolean' &&
    typeof value.summary === 'string' &&
    typeof display.title === 'string' &&
    (display.target === null || typeof display.target === 'string') &&
    (display.content === null || typeof display.content === 'string') &&
    (action === null ||
      (isRecord(action) && action.kind === 'acknowledge' && action.label === '確認'))
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
