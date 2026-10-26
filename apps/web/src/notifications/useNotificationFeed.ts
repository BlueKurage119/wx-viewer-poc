import { useCallback, useEffect, useReducer, useRef } from 'react';
import { type TerminalMode } from '@wx-viewer-poc/shared';
import { fetchNotificationDelta } from '../api/notificationDelta';
import { fetchStartupNotifications } from '../api/startupNotifications';
import {
  confirmNotification,
  createNotificationUiState,
  discardPreviousGeneration,
  expireWarningHistory,
  receiveNotifications,
  restoreAlertedFeedKeys,
  selectQuestionConfirmation,
  setNotificationTransport,
  type ChimeRequest,
  type NotificationUiState,
} from './notificationStore';
import { advanceAutoConfirmation, nextAutoConfirmationDeadline } from './autoConfirmation';
import {
  EMPTY_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
} from './notificationPreferences';
import { createNotificationFeedController } from './notificationFeedController';
import { createAlertedFeedKeyRepository } from './alertedFeedKeyStore';
export { retryDelayMs } from './notificationFeedController';

export interface UseNotificationFeedOptions {
  readonly terminalId: string;
  readonly mode: TerminalMode;
  readonly enabled?: boolean;
  readonly onChimeRequest?: (request: ChimeRequest) => void;
  readonly onConfirmed?: (state: NotificationUiState, feedKeys: readonly string[]) => void;
  readonly preferences?: NotificationPreferences;
  readonly nowMs: number;
  readonly clock?: () => number;
}

/** 起動現況・差分・期限照合を同じ状態へ順番に反映する。 */
export function useNotificationFeed({
  terminalId,
  mode,
  enabled = true,
  onChimeRequest,
  onConfirmed,
  preferences = EMPTY_NOTIFICATION_PREFERENCES,
  nowMs,
  clock = Date.now,
}: UseNotificationFeedOptions): {
  readonly state: NotificationUiState;
  readonly selectQuestionConfirmation: (feedKey: string) => void;
  readonly confirm: (feedKey: string) => void;
} {
  const [state, replace] = useReducer(
    (_state: NotificationUiState, next: NotificationUiState) => next,
    undefined,
    createNotificationUiState,
  );
  const stateRef = useRef(state);
  const callbacks = useRef({ onChimeRequest, onConfirmed, preferences, clock });
  callbacks.current = { onChimeRequest, onConfirmed, preferences, clock };
  const scheduleRef = useRef<() => void>(() => {});
  const alertedRepoRef = useRef(createAlertedFeedKeyRepository());
  const generationRef = useRef<string | null>(null);
  const alertedTimesRef = useRef<Map<string, number>>(new Map());

  const update = useCallback((next: NotificationUiState) => {
    stateRef.current = next;
    replace(next);
  }, []);
  const advance = useCallback(() => {
    const result = advanceAutoConfirmation(stateRef.current, mode, callbacks.current.clock());
    if (result.state !== stateRef.current) {
      update(result.state);
      callbacks.current.onConfirmed?.(result.state, result.automaticallyConfirmedFeedKeys);
    }
  }, [mode, update]);

  useEffect(() => {
    update(expireWarningHistory(stateRef.current, nowMs));
  }, [nowMs, update]);

  useEffect(() => {
    const initialState = createNotificationUiState();
    update(initialState);
    if (!enabled) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (!active) return;
      const deadline = nextAutoConfirmationDeadline(stateRef.current);
      if (deadline === null) return;
      timer = setTimeout(
        () => {
          if (!active) return;
          advance();
          schedule();
        },
        Math.max(0, deadline - callbacks.current.clock()),
      );
    };
    scheduleRef.current = schedule;

    const onGeneration = (serverGenerationId: string, reason: 'page_open' | 'changed') => {
      generationRef.current = serverGenerationId;
      if (reason === 'page_open') {
        const restored = alertedRepoRef.current.load(serverGenerationId, callbacks.current.clock());
        if (restored.length > 0) {
          const now = callbacks.current.clock();
          for (const key of restored) {
            alertedTimesRef.current.set(key, now);
          }
          update(restoreAlertedFeedKeys(stateRef.current, restored));
        }
      } else {
        alertedRepoRef.current.clear();
        alertedTimesRef.current.clear();
        update(discardPreviousGeneration(stateRef.current, mode));
      }
    };

    const receive = (
      items: NotificationUiState['items'],
      options?: { readonly initialFetch?: boolean },
    ) => {
      if (!active) return;
      advance();
      const beforeAlertedCount = stateRef.current.alertedFeedKeys.size;
      const result = receiveNotifications(
        stateRef.current,
        items,
        mode,
        callbacks.current.clock(),
        callbacks.current.preferences,
        options,
      );
      update(result.state);
      if (result.chime) callbacks.current.onChimeRequest?.(result.chime);

      const nextAlerted = result.state.alertedFeedKeys;
      if (generationRef.current !== null && nextAlerted.size > beforeAlertedCount) {
        const now = callbacks.current.clock();
        for (const key of nextAlerted) {
          if (!alertedTimesRef.current.has(key)) {
            alertedTimesRef.current.set(key, now);
          }
        }
        const entries = Array.from(nextAlerted).map((feedKey) => ({
          feedKey,
          alertedAtMs: alertedTimesRef.current.get(feedKey) ?? now,
        }));
        alertedRepoRef.current.save({ serverGenerationId: generationRef.current, entries }, now);
      }
      schedule();
    };

    const visibility = () => {
      if (!active) return;
      advance();
      schedule();
    };
    document.addEventListener('visibilitychange', visibility);
    const controller = createNotificationFeedController({
      terminalId,
      fetchDelta: fetchNotificationDelta,
      fetchStartup: fetchStartupNotifications,
      receive,
      onGeneration,
      onTransportState: (transport) => {
        if (active) update(setNotificationTransport(stateRef.current, transport));
      },
      setTimer: (task, delay) => setTimeout(task, delay),
      clearTimer: (handle) => clearTimeout(handle),
    });
    controller.start();
    return () => {
      active = false;
      if (timer !== null) clearTimeout(timer);
      scheduleRef.current = () => {};
      document.removeEventListener('visibilitychange', visibility);
      controller.stop();
    };
    // 設定変更は以後の受信だけに適用し、端末切替では旧期限を破棄する。
  }, [terminalId, enabled, mode, update, advance]);

  return {
    state,
    selectQuestionConfirmation: (feedKey) =>
      update(selectQuestionConfirmation(stateRef.current, feedKey)),
    confirm: (feedKey) => {
      advance();
      const before = stateRef.current;
      const next = confirmNotification(before, feedKey, mode, 'manual');
      if (next !== before) {
        update(next);
        callbacks.current.onConfirmed?.(next, [feedKey]);
      }
      scheduleRef.current();
    },
  };
}
