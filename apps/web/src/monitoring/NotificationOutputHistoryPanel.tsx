import { useEffect, useRef, useState } from 'react';
import type { MonitoringNotificationOutputSummary } from '@wx-viewer-poc/shared';
import { GbButton } from '../components/md';
import {
  createNotificationOutputHistoryController,
  type NotificationOutputHistoryState,
} from './notificationOutputHistoryController';

export function NotificationOutputHistoryRows({
  items,
  onReception,
}: {
  readonly items: readonly MonitoringNotificationOutputSummary[];
  readonly onReception: (id: number) => void;
}) {
  return (
    <ul className="notification-output-history-list">
      {items.map((row) => (
        <li key={row.id}>
          <time dateTime={row.detectedAt}>{new Date(row.detectedAt).toLocaleString('ja-JP')}</time>
          <span>{row.isTraining ? '訓練' : '本番'}</span>
          <p>{row.summary}</p>
          {row.receptionReference.status === 'available' && (
            <GbButton color="text" size="sm" onClick={() => onReception(row.id)}>
              原文
            </GbButton>
          )}
          {row.receptionReference.status === 'unavailable' && <span>原文参照不可</span>}
        </li>
      ))}
    </ul>
  );
}

export function NotificationOutputHistoryPanel() {
  const [state, setState] = useState<NotificationOutputHistoryState>({
    phase: 'loading',
    items: [],
    totalCount: 0,
    offset: 0,
    rawBody: null,
    receptionPhase: 'idle',
  });
  const [filter, setFilter] = useState<'all' | 'normal' | 'training'>('all');
  const controllerRef = useRef<ReturnType<typeof createNotificationOutputHistoryController> | null>(
    null,
  );
  useEffect(() => {
    const controller = createNotificationOutputHistoryController(setState);
    controllerRef.current = controller;
    void controller.load(0, filter === 'all' ? undefined : filter === 'training');
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [filter]);
  const loadPage = (offset: number) =>
    void controllerRef.current?.load(offset, filter === 'all' ? undefined : filter === 'training');
  return (
    <section>
      <select
        aria-label="訓練区分"
        value={filter}
        onChange={(event) => setFilter(event.target.value as typeof filter)}
      >
        <option value="all">すべて</option>
        <option value="normal">本番</option>
        <option value="training">訓練</option>
      </select>
      {state.phase === 'loading' && <p role="status">取得中…</p>}
      {state.phase === 'failed' && <p role="alert">出力履歴を取得できませんでした。</p>}
      {state.phase === 'ready' && (
        <>
          <NotificationOutputHistoryRows
            items={state.items}
            onReception={(id) => void controllerRef.current?.openReception(id)}
          />
          {state.items.length === 0 && <p>出力履歴はありません。</p>}
          <GbButton
            color="text"
            size="sm"
            disabled={state.offset === 0}
            onClick={() => loadPage(Math.max(0, state.offset - 100))}
          >
            前へ
          </GbButton>
          <GbButton
            color="text"
            size="sm"
            disabled={state.offset + 100 >= state.totalCount}
            onClick={() => loadPage(state.offset + 100)}
          >
            次へ
          </GbButton>
        </>
      )}
      {state.receptionPhase === 'loading' && <p role="status">原文取得中…</p>}
      {state.receptionPhase === 'failed' && <p role="alert">原文を取得できませんでした。</p>}
      {state.rawBody !== null && (
        <pre className="notification-output-raw-body">{state.rawBody}</pre>
      )}
    </section>
  );
}
