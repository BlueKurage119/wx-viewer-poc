import { useEffect, useReducer, useRef } from 'react';
import {
  toNotificationFeedItemFromDelta,
  toNotificationFeedItemFromStartup,
  type NotificationDeltaCursor,
  type TerminalMode,
} from '@wx-viewer-poc/shared';
import { fetchNotificationDelta } from '../api/notificationDelta';
import { fetchStartupNotifications } from '../api/startupNotifications';
import {
  confirmNotification,
  createNotificationUiState,
  receiveNotifications,
  setNotificationCursor,
  setNotificationRetry,
  type ChimeCategory,
  type NotificationUiState,
} from './notificationStore';

const POLLING_INTERVAL_MS = 15_000;
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;

export function retryDelayMs(failureCount: number): number {
  return RETRY_DELAYS_MS[Math.min(failureCount, RETRY_DELAYS_MS.length - 1)]!;
}

type Action =
  | { readonly type: 'reset' }
  | {
      readonly type: 'receive';
      readonly items: NotificationUiState['items'];
      readonly mode: TerminalMode;
    }
  | { readonly type: 'cursor'; readonly cursor: NotificationDeltaCursor; readonly message?: string }
  | { readonly type: 'retry' }
  | { readonly type: 'confirm'; readonly feedKey: string; readonly mode: TerminalMode };

function reducer(state: NotificationUiState, action: Action): NotificationUiState {
  switch (action.type) {
    case 'reset':
      return createNotificationUiState();
    case 'receive':
      return receiveNotifications(state, action.items, action.mode).state;
    case 'cursor':
      return setNotificationCursor(state, action.cursor, action.message);
    case 'retry':
      return setNotificationRetry(state);
    case 'confirm':
      return confirmNotification(state, action.feedKey, action.mode);
  }
}

export interface UseNotificationFeedOptions {
  readonly terminalId: string;
  readonly mode: TerminalMode;
  readonly enabled?: boolean;
  readonly onChimeRequest?: (category: ChimeCategory) => void;
}

/** 起動現況と通常差分を一つのメモリ内通知storeへ合流する。 */
export function useNotificationFeed({
  terminalId,
  mode,
  enabled = true,
  onChimeRequest,
}: UseNotificationFeedOptions): {
  readonly state: NotificationUiState;
  readonly confirm: (feedKey: string) => void;
} {
  const [state, dispatch] = useReducer(reducer, undefined, createNotificationUiState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const chimeRef = useRef(onChimeRequest);
  chimeRef.current = onChimeRequest;

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let retryCount = 0;
    let timer: number | undefined;
    const abortController = new AbortController();
    let cursor: NotificationDeltaCursor | null = null;
    const initialState = createNotificationUiState();
    stateRef.current = initialState;
    dispatch({ type: 'reset' });

    const schedule = (delay: number, task: () => void) => {
      timer = window.setTimeout(task, delay);
    };
    const receive = (items: NotificationUiState['items']) => {
      // reducerにも同じ純粋遷移を通す。鳴動要求だけは取得単位でここから公開する。
      const current = stateRef.current;
      const chime = receiveNotifications(current, items, mode).chime;
      if (chime) chimeRef.current?.(chime);
      stateRef.current = receiveNotifications(current, items, mode).state;
      dispatch({ type: 'receive', items, mode });
    };
    const retry = (task: () => void) => {
      if (disposed) return;
      dispatch({ type: 'retry' });
      const delay = retryDelayMs(retryCount);
      retryCount += 1;
      schedule(delay, task);
    };
    const poll = async () => {
      if (disposed || cursor === null) return;
      const result = await fetchNotificationDelta(terminalId, cursor, abortController.signal);
      if (disposed) return;
      if (result.status === 'ready') {
        retryCount = 0;
        cursor = result.response.cursor;
        receive(result.response.notifications.map(toNotificationFeedItemFromDelta));
        dispatch({ type: 'cursor', cursor });
        schedule(POLLING_INTERVAL_MS, () => void poll());
        return;
      }
      if (result.status === 'cursor_out_of_range') {
        retryCount = 0;
        cursor = result.cursor as NotificationDeltaCursor;
        dispatch({ type: 'cursor', cursor, message: '通知の受信位置を同期しました。' });
        schedule(POLLING_INTERVAL_MS, () => void poll());
        return;
      }
      retry(() => void poll());
    };
    const startup = async (isRetry = false) => {
      const result = await fetchStartupNotifications(terminalId, abortController.signal, {
        retry: isRetry,
      });
      if (disposed) return;
      if (result.status !== 'ready') {
        retry(() => void startup(true));
        return;
      }
      retryCount = 0;
      cursor = result.cursor;
      receive(result.notifications.map(toNotificationFeedItemFromStartup));
      dispatch({ type: 'cursor', cursor });
      void poll();
    };
    void startup();
    return () => {
      disposed = true;
      abortController.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
    // terminalId変更時だけ空のstoreから開始する。mode変更は端末IDと同時に起きる。
  }, [terminalId, enabled, mode]);

  return { state, confirm: (feedKey) => dispatch({ type: 'confirm', feedKey, mode }) };
}
