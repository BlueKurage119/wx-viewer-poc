import {
  toNotificationFeedItemFromDelta,
  toNotificationFeedItemFromStartup,
  type NotificationDeltaCursor,
  type NotificationDeltaRequest,
  type NotificationFeedItem,
  type NotificationOrigin,
} from '@wx-viewer-poc/shared';
import type { NotificationDeltaClientResult } from '../api/notificationDelta';
import type { StartupNotificationClientResult } from '../api/startupNotifications';

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;
export function retryDelayMs(failureCount: number): number {
  return RETRY_DELAYS_MS[Math.min(failureCount, RETRY_DELAYS_MS.length - 1)]!;
}
export type NotificationTransportPhase = 'starting' | 'ready' | 'pending' | 'retrying';
export interface NotificationTransportState {
  readonly origin: NotificationOrigin;
  readonly phase: NotificationTransportPhase;
  readonly cursor: NotificationDeltaCursor | null;
  readonly message?: string;
}

/** 本番hookと検証で同じ取得制御を使い、経路ごとの受信位置と再試行を保つ。 */
export function createNotificationFeedController(dependencies: {
  readonly terminalId: string;
  readonly fetchDelta: (
    request: NotificationDeltaRequest,
    signal: AbortSignal,
  ) => Promise<NotificationDeltaClientResult>;
  readonly fetchStartup: (
    terminalId: string,
    generation: string,
    signal: AbortSignal,
    options?: { retry?: boolean },
  ) => Promise<StartupNotificationClientResult>;
  readonly receive: (items: readonly NotificationFeedItem[]) => void;
  readonly onTransportState: (state: NotificationTransportState) => void;
  readonly setTimer: (task: () => void, delay: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  let active = false;
  let epoch = 0;
  let generation: string | null = null;
  let controller = new AbortController();
  const channels = {
    system: {
      cursor: null as NotificationDeltaCursor | null,
      retries: 0,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
    },
    weather: {
      cursor: null as NotificationDeltaCursor | null,
      retries: 0,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
    },
  };
  const state = (origin: NotificationOrigin, phase: NotificationTransportPhase, message?: string) =>
    dependencies.onTransportState({ origin, phase, cursor: channels[origin].cursor, message });
  const schedule = (origin: NotificationOrigin, task: () => void, delay: number) => {
    if (channels[origin].timer !== undefined) dependencies.clearTimer(channels[origin].timer);
    channels[origin].timer = dependencies.setTimer(task, delay);
  };
  const clear = () => {
    controller.abort();
    epoch += 1;
    for (const channel of Object.values(channels)) {
      if (channel.timer !== undefined) dependencies.clearTimer(channel.timer);
      channel.timer = undefined;
      channel.cursor = null;
      channel.retries = 0;
    }
  };
  const valid = (requestEpoch: number) => active && epoch === requestEpoch;
  const restart = () => {
    clear();
    controller = new AbortController();
    generation = null;
    state('system', 'starting');
    state('weather', 'starting');
    void poll('system');
  };
  const retry = (origin: NotificationOrigin, pending: boolean, task: () => void) => {
    state(origin, pending ? 'pending' : 'retrying');
    schedule(origin, task, retryDelayMs(channels[origin].retries++));
  };
  const startup = async (isRetry = false): Promise<void> => {
    if (!active || generation === null) return;
    const requestEpoch = epoch;
    const result = await dependencies.fetchStartup(
      dependencies.terminalId,
      generation,
      controller.signal,
      { retry: isRetry },
    );
    if (!valid(requestEpoch)) return;
    if (result.status === 'server_generation_changed') return restart();
    if (result.status !== 'ready')
      return retry('weather', result.status === 'initializing', () => void startup(true));
    if (result.serverGenerationId !== generation) return restart();
    channels.weather.cursor = result.cursor;
    channels.weather.retries = 0;
    dependencies.receive(result.notifications.map(toNotificationFeedItemFromStartup));
    state('weather', 'ready');
    void poll('weather');
  };
  const poll = async (origin: NotificationOrigin): Promise<void> => {
    if (!active) return;
    const channel = channels[origin];
    if (origin === 'weather' && (generation === null || channel.cursor === null)) return;
    const requestEpoch = epoch;
    const request: NotificationDeltaRequest =
      generation !== null && channel.cursor !== null
        ? {
            terminalId: dependencies.terminalId,
            origin,
            cursor: channel.cursor,
            serverGenerationId: generation,
          }
        : { terminalId: dependencies.terminalId, origin: 'system' };
    const result = await dependencies.fetchDelta(request, controller.signal);
    if (!valid(requestEpoch)) return;
    if (result.status === 'server_generation_changed') return restart();
    if (result.status === 'cursor_out_of_range') {
      channel.cursor = null;
      channel.retries = 0;
      state(origin, 'pending', '通知の受信位置を同期しました。');
      schedule(
        origin,
        () => {
          if (origin === 'system') void poll(origin);
          else void startup(true);
        },
        1000,
      );
      return;
    }
    if (result.status !== 'ready')
      return retry(origin, result.status === 'initializing', () => void poll(origin));
    const first = generation === null;
    if (!first && result.response.serverGenerationId !== generation) return restart();
    generation = result.response.serverGenerationId;
    channel.cursor = result.response.cursor;
    channel.retries = 0;
    dependencies.receive(result.response.notifications.map(toNotificationFeedItemFromDelta));
    state(origin, 'ready');
    schedule(origin, () => void poll(origin), 15000);
    if (first) void startup();
  };
  return {
    start() {
      if (active) return;
      active = true;
      restart();
    },
    stop() {
      active = false;
      clear();
    },
  };
}
