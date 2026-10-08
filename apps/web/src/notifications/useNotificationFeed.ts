import { useEffect, useReducer, useRef } from 'react';
import { type TerminalMode } from '@wx-viewer-poc/shared';
import { fetchNotificationDelta } from '../api/notificationDelta';
import { fetchStartupNotifications } from '../api/startupNotifications';
import {
  confirmNotification,
  createNotificationUiState,
  expireWarningHistory,
  receiveNotifications,
  selectQuestionConfirmation,
  setNotificationTransport,
  type ChimeRequest,
  type NotificationUiState,
} from './notificationStore';

import {
  createNotificationFeedController,
  type NotificationTransportState,
} from './notificationFeedController';
export { retryDelayMs } from './notificationFeedController';

type Action =
  | { readonly type: 'reset' }
  | {
      readonly type: 'receive';
      readonly items: NotificationUiState['items'];
      readonly mode: TerminalMode;
      readonly receivedAtMs: number;
    }
  | { readonly type: 'transport'; readonly update: NotificationTransportState }
  | { readonly type: 'expire-history'; readonly nowMs: number }
  | { readonly type: 'select-question-confirmation'; readonly feedKey: string }
  | { readonly type: 'confirm'; readonly feedKey: string; readonly mode: TerminalMode };

function reducer(state: NotificationUiState, action: Action): NotificationUiState {
  switch (action.type) {
    case 'reset':
      return createNotificationUiState();
    case 'receive':
      return receiveNotifications(state, action.items, action.mode, action.receivedAtMs).state;
    case 'expire-history':
      return expireWarningHistory(state, action.nowMs);
    case 'transport':
      return setNotificationTransport(state, action.update);
    case 'select-question-confirmation':
      return selectQuestionConfirmation(state, action.feedKey);
    case 'confirm':
      return confirmNotification(state, action.feedKey, action.mode);
  }
}

export interface UseNotificationFeedOptions {
  readonly terminalId: string;
  readonly mode: TerminalMode;
  readonly enabled?: boolean;
  readonly onChimeRequest?: (request: ChimeRequest) => void;
  readonly nowMs: number;
}

/** 起動現況と通常差分を一つのメモリ内通知storeへ合流する。 */
export function useNotificationFeed({
  terminalId,
  mode,
  enabled = true,
  onChimeRequest,
  nowMs,
}: UseNotificationFeedOptions): {
  readonly state: NotificationUiState;
  readonly selectQuestionConfirmation: (feedKey: string) => void;
  readonly confirm: (feedKey: string) => void;
} {
  const [state, dispatch] = useReducer(reducer, undefined, createNotificationUiState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const chimeRef = useRef(onChimeRequest);
  chimeRef.current = onChimeRequest;

  useEffect(() => {
    dispatch({ type: 'expire-history', nowMs });
  }, [nowMs]);

  useEffect(() => {
    if (!enabled) return;
    const initialState = createNotificationUiState();
    stateRef.current = initialState;
    dispatch({ type: 'reset' });
    const receive = (items: NotificationUiState['items']) => {
      // reducerにも同じ純粋遷移を通す。鳴動要求だけは取得単位でここから公開する。
      const current = stateRef.current;
      const receivedAtMs = Date.now();
      const { state: received, chime } = receiveNotifications(current, items, mode, receivedAtMs);
      if (chime) chimeRef.current?.(chime);
      stateRef.current = received;
      dispatch({ type: 'receive', items, mode, receivedAtMs });
    };
    const controller = createNotificationFeedController({
      terminalId,
      fetchDelta: fetchNotificationDelta,
      fetchStartup: fetchStartupNotifications,
      receive,
      onTransportState: (update) => dispatch({ type: 'transport', update }),
      setTimer: (task, delay) => setTimeout(task, delay),
      clearTimer: (timer) => clearTimeout(timer),
    });
    controller.start();
    return () => controller.stop();
    // terminalId変更時だけ空のstoreから開始する。mode変更は端末IDと同時に起きる。
  }, [terminalId, enabled, mode]);

  return {
    state,
    selectQuestionConfirmation: (feedKey) =>
      dispatch({ type: 'select-question-confirmation', feedKey }),
    confirm: (feedKey) => dispatch({ type: 'confirm', feedKey, mode }),
  };
}
