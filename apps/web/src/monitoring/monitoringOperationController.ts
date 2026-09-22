import {
  isFetchControlRequestId,
  type FetchControlCompletedResponse,
  type FetchControlInProgressResponse,
  type FetchControlOperationKind,
} from '@wx-viewer-poc/shared';

export const OPERATION_REQUEST_TIMEOUT_MS = 30_000;
export const OPERATION_POLL_DELAY_MS = 5_000;

export interface SubmittedOperation {
  readonly requestId: string;
  readonly operationKind: FetchControlOperationKind;
}

export type FetchControlReply =
  | { readonly kind: 'completed'; readonly response: FetchControlCompletedResponse }
  | { readonly kind: 'in_progress'; readonly response: FetchControlInProgressResponse }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'rejected'; readonly code: string }
  | {
      readonly kind: 'unverifiable';
      readonly reason: 'network' | 'timeout' | 'invalid_response' | 'server_error';
    };

export interface FetchControlClient {
  submit(request: SubmittedOperation, signal: AbortSignal): Promise<FetchControlReply>;
  find(request: SubmittedOperation, signal: AbortSignal): Promise<FetchControlReply>;
}

export type OperationState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'sending' | 'checking'; readonly request: SubmittedOperation }
  | {
      readonly phase: 'completed';
      readonly request: SubmittedOperation;
      readonly response: FetchControlCompletedResponse;
    }
  | {
      readonly phase: 'unknown' | 'unverifiable';
      readonly request: SubmittedOperation;
      readonly reason: string;
    }
  | {
      readonly phase: 'rejected';
      readonly request: SubmittedOperation | null;
      readonly reason: string;
    };

export interface MonitoringOperationController {
  getSnapshot(): OperationState;
  subscribe(listener: () => void): () => void;
  submit(kind: FetchControlOperationKind): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

interface TimerDependencies {
  readonly setTimeout: (callback: () => void, delayMs: number) => number;
  readonly clearTimeout: (timerId: number) => void;
}

export interface MonitoringOperationControllerDependencies extends TimerDependencies {
  readonly client: FetchControlClient;
  readonly requestIdFactory: () => string;
}

function isBusy(state: OperationState): boolean {
  return state.phase === 'sending' || state.phase === 'checking';
}

/**
 * E11への送信・結果照会をReactから切り離して直列化する。通信失敗時にも同じIDを
 * 一度だけ照会するため、POSTの自動再送は行わない。
 */
export function createMonitoringOperationController(
  deps: MonitoringOperationControllerDependencies,
): MonitoringOperationController {
  let state: OperationState = { phase: 'idle' };
  let disposed = false;
  let visible = true;
  let generation = 0;
  let activeAbort: AbortController | null = null;
  let timeoutTimer: number | null = null;
  let pollTimer: number | null = null;
  const listeners = new Set<() => void>();

  const notify = () => listeners.forEach((listener) => listener());
  const setState = (next: OperationState) => {
    if (disposed) return;
    state = next;
    notify();
  };
  const clearRequestTimer = () => {
    if (timeoutTimer !== null) deps.clearTimeout(timeoutTimer);
    timeoutTimer = null;
  };
  const clearPollTimer = () => {
    if (pollTimer !== null) deps.clearTimeout(pollTimer);
    pollTimer = null;
  };
  const clearAllTimers = () => {
    clearRequestTimer();
    clearPollTimer();
  };
  const isCurrent = (requestGeneration: number) => !disposed && requestGeneration === generation;
  const finish = (next: Exclude<OperationState, { readonly phase: 'sending' | 'checking' }>) => {
    generation += 1;
    activeAbort?.abort();
    activeAbort = null;
    clearAllTimers();
    setState(next);
  };

  const scheduleFind = (request: SubmittedOperation, delayMs: number) => {
    if (disposed || !isBusy(state)) return;
    clearPollTimer();
    if (!visible) return;
    pollTimer = deps.setTimeout(() => {
      pollTimer = null;
      startFind(request);
    }, delayMs);
  };

  const onFindReply = (
    request: SubmittedOperation,
    requestGeneration: number,
    reply: FetchControlReply,
  ) => {
    if (!isCurrent(requestGeneration)) return;
    activeAbort = null;
    clearRequestTimer();
    if (reply.kind === 'completed') {
      finish({ phase: 'completed', request, response: reply.response });
      return;
    }
    if (reply.kind === 'in_progress') {
      setState({ phase: 'checking', request });
      scheduleFind(request, OPERATION_POLL_DELAY_MS);
      return;
    }
    if (reply.kind === 'unknown') {
      finish({ phase: 'unknown', request, reason: 'unknown_request' });
      return;
    }
    finish({
      phase: 'unverifiable',
      request,
      reason: reply.kind === 'rejected' ? 'server_error' : reply.reason,
    });
  };

  const startFind = (request: SubmittedOperation) => {
    if (disposed || !visible || !isBusy(state) || activeAbort !== null) return;
    const requestGeneration = ++generation;
    const abort = new AbortController();
    activeAbort = abort;
    timeoutTimer = deps.setTimeout(() => {
      if (!isCurrent(requestGeneration)) return;
      abort.abort();
      activeAbort = null;
      clearRequestTimer();
      finish({ phase: 'unverifiable', request, reason: 'timeout' });
    }, OPERATION_REQUEST_TIMEOUT_MS);
    void deps.client.find(request, abort.signal).then(
      (reply) => onFindReply(request, requestGeneration, reply),
      () => onFindReply(request, requestGeneration, { kind: 'unverifiable', reason: 'network' }),
    );
  };

  const onSubmitReply = (
    request: SubmittedOperation,
    requestGeneration: number,
    reply: FetchControlReply,
  ) => {
    if (!isCurrent(requestGeneration)) return;
    activeAbort = null;
    clearRequestTimer();
    if (reply.kind === 'completed') {
      finish({ phase: 'completed', request, response: reply.response });
      return;
    }
    if (reply.kind === 'in_progress') {
      setState({ phase: 'checking', request });
      scheduleFind(request, OPERATION_POLL_DELAY_MS);
      return;
    }
    if (reply.kind === 'unknown') {
      finish({ phase: 'unknown', request, reason: 'unknown_request' });
      return;
    }
    if (reply.kind === 'rejected') {
      finish({ phase: 'rejected', request, reason: reply.code });
      return;
    }
    setState({ phase: 'checking', request });
    scheduleFind(request, 0);
  };

  const startSubmit = (request: SubmittedOperation) => {
    const requestGeneration = ++generation;
    const abort = new AbortController();
    activeAbort = abort;
    timeoutTimer = deps.setTimeout(() => {
      if (!isCurrent(requestGeneration)) return;
      abort.abort();
      activeAbort = null;
      clearRequestTimer();
      setState({ phase: 'checking', request });
      scheduleFind(request, 0);
    }, OPERATION_REQUEST_TIMEOUT_MS);
    void deps.client.submit(request, abort.signal).then(
      (reply) => onSubmitReply(request, requestGeneration, reply),
      () => onSubmitReply(request, requestGeneration, { kind: 'unverifiable', reason: 'network' }),
    );
  };

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    submit(kind) {
      if (disposed || isBusy(state)) return;
      let requestId: string;
      try {
        requestId = deps.requestIdFactory();
      } catch {
        setState({ phase: 'rejected', request: null, reason: 'request_id_unavailable' });
        return;
      }
      if (!isFetchControlRequestId(requestId)) {
        setState({ phase: 'rejected', request: null, reason: 'request_id_unavailable' });
        return;
      }
      const request = { requestId, operationKind: kind };
      setState({ phase: 'sending', request });
      startSubmit(request);
    },
    setVisible(nextVisible) {
      if (disposed || visible === nextVisible) return;
      visible = nextVisible;
      if (!visible) {
        clearPollTimer();
        return;
      }
      if (state.phase === 'checking' && activeAbort === null) scheduleFind(state.request, 0);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      clearAllTimers();
      activeAbort?.abort();
      activeAbort = null;
      listeners.clear();
    },
  };
}
