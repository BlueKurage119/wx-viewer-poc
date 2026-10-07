import type {
  MonitoringNotificationOutputListResponse,
  MonitoringNotificationOutputSummary,
  MonitoringReceptionDetailResponse,
} from '@wx-viewer-poc/shared';

export interface NotificationOutputHistoryState {
  readonly phase: 'loading' | 'ready' | 'failed';
  readonly items: readonly MonitoringNotificationOutputSummary[];
  readonly totalCount: number;
  readonly offset: number;
  readonly rawBody: string | null;
  readonly receptionPhase: 'idle' | 'loading' | 'failed';
}

export function createNotificationOutputHistoryController(
  publish: (state: NotificationOutputHistoryState) => void,
  fetcher: typeof fetch = fetch,
) {
  let state: NotificationOutputHistoryState = {
    phase: 'loading',
    items: [],
    totalCount: 0,
    offset: 0,
    rawBody: null,
    receptionPhase: 'idle',
  };
  let active = true;
  let listRequest: AbortController | null = null;
  let receptionRequest: AbortController | null = null;
  const update = (patch: Partial<NotificationOutputHistoryState>) => {
    if (!active) return;
    state = { ...state, ...patch };
    publish(state);
  };
  return {
    async load(offset = 0, isTraining?: boolean) {
      if (!active) return;
      listRequest?.abort();
      receptionRequest?.abort();
      const request = new AbortController();
      listRequest = request;
      update({ phase: 'loading', offset, rawBody: null, receptionPhase: 'idle' });
      const query = new URLSearchParams({ limit: '100', offset: String(offset) });
      if (isTraining !== undefined) query.set('isTraining', String(isTraining));
      try {
        const response = await fetcher(`/api/monitoring/notification-outputs?${query}`, {
          signal: request.signal,
        });
        if (!response.ok) throw new Error('履歴取得失敗');
        const result = (await response.json()) as MonitoringNotificationOutputListResponse;
        if (request.signal.aborted || !active) return;
        update({ phase: 'ready', items: result.items, totalCount: result.totalCount });
      } catch {
        if (!request.signal.aborted) update({ phase: 'failed' });
      }
    },
    async openReception(id: number) {
      if (
        !active ||
        state.phase !== 'ready' ||
        state.items.find((row) => row.id === id)?.receptionReference.status !== 'available'
      )
        return;
      receptionRequest?.abort();
      const request = new AbortController();
      receptionRequest = request;
      update({ receptionPhase: 'loading', rawBody: null });
      try {
        const response = await fetcher(`/api/monitoring/notification-outputs/${id}/reception`, {
          signal: request.signal,
        });
        if (request.signal.aborted || !active) return;
        if (response.status === 410) {
          const error = (await response.json()) as { reason: string };
          if (request.signal.aborted || !active) return;
          const reasons = [
            'weather_generation_changed',
            'reception_missing',
            'raw_body_missing',
            'generation_unknown',
          ] as const;
          const reason = reasons.find((value) => value === error.reason);
          if (reason === undefined) throw new Error('参照状態不明');
          update({
            receptionPhase: 'idle',
            items: state.items.map((row) =>
              row.id === id
                ? { ...row, receptionReference: { status: 'unavailable', reason } }
                : row,
            ),
          });
          return;
        }
        if (!response.ok) throw new Error('原文取得失敗');
        const result = (await response.json()) as MonitoringReceptionDetailResponse;
        if (request.signal.aborted || !active) return;
        update({ receptionPhase: 'idle', rawBody: result.reception.rawBody });
      } catch {
        if (!request.signal.aborted) update({ receptionPhase: 'failed' });
      }
    },
    dispose() {
      active = false;
      listRequest?.abort();
      receptionRequest?.abort();
    },
  };
}
