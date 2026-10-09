import type { WeatherRestartOperation, WeatherRestartRequest } from '@wx-viewer-poc/shared';
import type { WeatherRestartReply, WeatherWorkerClient } from '../api/weatherWorkers';

export type WeatherRestartState =
  | { readonly phase: 'idle' }
  | {
      readonly phase: 'sending' | 'checking' | 'unverifiable' | 'conflict' | 'rejected';
      readonly request: WeatherRestartRequest;
    }
  | {
      readonly phase: 'completed';
      readonly request: WeatherRestartRequest;
      readonly operation: WeatherRestartOperation;
    };

export function createWeatherRestartController(deps: {
  readonly client: Pick<WeatherWorkerClient, 'restart' | 'find'>;
  readonly requestIdFactory: () => string;
  readonly setTimeout: (callback: () => void, delay: number) => number;
  readonly clearTimeout: (id: number) => void;
  readonly onRefresh: () => void;
}) {
  let state: WeatherRestartState = { phase: 'idle' };
  const listeners = new Set<() => void>();
  let sequence = 0;
  let disposed = false;
  let active: AbortController | null = null;
  let deadline: number | null = null;
  let requestTimer: number | null = null;
  let poll: number | null = null;
  const busy = () => state.phase === 'sending' || state.phase === 'checking';
  const publish = (next: WeatherRestartState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  const cleanup = () => {
    sequence += 1;
    active?.abort();
    active = null;
    for (const timer of [deadline, requestTimer, poll])
      if (timer !== null) deps.clearTimeout(timer);
    deadline = requestTimer = poll = null;
  };
  const finish = (next: WeatherRestartState) => {
    cleanup();
    publish(next);
  };
  const schedule = (request: WeatherRestartRequest) => {
    publish({ phase: 'checking', request });
    poll = deps.setTimeout(() => {
      poll = null;
      send(request, false);
    }, 1_000);
  };
  const send = (request: WeatherRestartRequest, post: boolean) => {
    if (disposed || !busy()) return;
    const token = ++sequence;
    const abort = new AbortController();
    active = abort;
    const receive = (reply: WeatherRestartReply) => {
      if (disposed || token !== sequence) return;
      sequence += 1;
      active = null;
      if (requestTimer !== null) deps.clearTimeout(requestTimer);
      requestTimer = null;
      if (reply.kind === 'operation' && reply.operation.status === 'completed') {
        finish({ phase: 'completed', request, operation: reply.operation });
        deps.onRefresh();
      } else if (reply.kind === 'conflict' || reply.kind === 'rejected') {
        finish({ phase: reply.kind, request });
        if (reply.kind === 'conflict') deps.onRefresh();
      } else schedule(request);
    };
    // POST応答が失われても照会時間を残し、同じIDのGETだけを続ける。
    requestTimer = deps.setTimeout(() => {
      abort.abort();
      receive({ kind: 'unverifiable' });
    }, 5_000);
    void (
      post ? deps.client.restart(request, abort.signal) : deps.client.find(request, abort.signal)
    ).then(receive, () => receive({ kind: 'unverifiable' }));
  };
  const begin = (request: WeatherRestartRequest, post: boolean) => {
    cleanup();
    publish({ phase: post ? 'sending' : 'checking', request });
    deadline = deps.setTimeout(() => finish({ phase: 'unverifiable', request }), 30_000);
    send(request, post);
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    restart(expectedWorkerGeneration: string) {
      if (disposed || busy() || state.phase === 'unverifiable') return;
      let requestId: string;
      try {
        requestId = deps.requestIdFactory();
      } catch {
        return;
      }
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) return;
      begin({ requestId, expectedWorkerGeneration }, true);
    },
    recheck() {
      if (disposed || state.phase !== 'unverifiable') return;
      begin(state.request, false);
    },
    dispose() {
      disposed = true;
      cleanup();
      listeners.clear();
    },
  };
}
