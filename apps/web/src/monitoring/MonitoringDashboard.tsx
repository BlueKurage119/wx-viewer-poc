import {
  buildMonitoringCards,
  formatJstDateTime,
  type MonitoringCard,
} from './monitoringPresentation';
import { useMonitoringStatus } from './useMonitoringStatus';
import './monitoring.css';

const SOURCE_HEADERS = [
  '取得元',
  '状態',
  '適用周期',
  '最終試行',
  '最終成功',
  '次回予定',
  '直近処理時間',
  '連続失敗回数',
] as const;
const SOURCE_ROWS = [
  'XML定時フィード',
  'XML随時フィード',
  '雨雲時刻一覧',
  'キキクル時刻一覧',
  'アメダス最新時刻',
  'アメダス地点データ',
] as const;
const INFORMATION_HEADERS = [
  '情報名',
  '対象地域・地点',
  '反映状態',
  '情報時刻',
  '反映時刻',
  '要約',
] as const;
const INFORMATION_ROWS = [
  '気象防災速報',
  '気象警報・注意報',
  '警報等時系列',
  '警報級の可能性',
  'アメダス',
  '地域時系列予報',
  '雨雲',
  'キキクル',
] as const;

function CardIcon({ id }: { id: MonitoringCard['id'] }) {
  if (id === 'operation') {
    return (
      <path d="M12 3v4m0 10v4m9-9h-4M7 12H3m15.4-6.4-2.8 2.8M8.4 15.6l-2.8 2.8m0-12.8 2.8 2.8m7.2 7.2 2.8 2.8M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z" />
    );
  }
  if (id === 'health') {
    return <path d="m4 12 4 4 8-9m4-2v4m0 6v4M3 4h4m10 0h4M3 20h4m10 0h4" />;
  }
  if (id === 'schedule') {
    return <path d="M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />;
  }
  return <path d="M5 4h10l4 4v12H5Zm10 0v5h4M8 13h8m-8 3h6" />;
}

function MonitoringCardView({ card, stale }: { card: MonitoringCard; stale: boolean }) {
  return (
    <article
      className={`monitoring-card monitoring-tone-${card.tone}${stale ? ' monitoring-stale' : ''}`}
    >
      <span className="monitoring-card-icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <CardIcon id={card.id} />
        </svg>
      </span>
      <div className="monitoring-card-content">
        <h2>{card.title}</h2>
        <p className="monitoring-card-value">{card.value}</p>
        {card.details.map((detail) => (
          <p
            className={`monitoring-card-detail${card.detailTone ? ` monitoring-detail-${card.detailTone}` : ''}`}
            key={detail}
          >
            {detail}
          </p>
        ))}
      </div>
    </article>
  );
}

function SkeletonTable({
  title,
  headers,
  rows,
}: {
  readonly title: string;
  readonly headers: readonly string[];
  readonly rows: readonly string[];
}) {
  return (
    <section className="monitoring-table-section" aria-labelledby={`monitoring-${title}`}>
      <h2 id={`monitoring-${title}`}>{title}</h2>
      <div className="monitoring-table-scroll">
        <table>
          <thead>
            <tr>
              {headers.map((header) => (
                <th scope="col" key={header}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row}>
                <th scope="row">{row}</th>
                {headers.slice(1).map((header) => (
                  <td className="monitoring-unavailable" key={header}>
                    —
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function MonitoringDashboard({ terminalId }: { terminalId: string }) {
  const state = useMonitoringStatus(terminalId);
  const cards = state.data ? buildMonitoringCards(state.data) : null;
  const failed = state.phase === 'failed';
  const refreshing = state.phase === 'refreshing';
  const message =
    state.phase === 'loading'
      ? '監視情報を取得中'
      : failed
        ? state.data
          ? '監視情報を更新できません（前回値を表示）'
          : '監視情報を更新できません（通信成功なし）'
        : refreshing
          ? '監視情報を確認中'
          : '';

  return (
    <div className="monitoring-dashboard" aria-label="取得監視">
      <div className="monitoring-update-row" role="status" aria-live="polite">
        <span>{message}</span>
        <span>
          最終表示更新{' '}
          {state.data ? (
            <time dateTime={state.data.generatedAt}>
              {formatJstDateTime(state.data.generatedAt)}
            </time>
          ) : (
            '—'
          )}
        </span>
      </div>
      <section className="monitoring-cards" aria-label="監視の概要">
        {cards ? (
          cards.map((card) => (
            <MonitoringCardView card={card} stale={failed || refreshing} key={card.id} />
          ))
        ) : (
          <>
            <MonitoringCardView
              card={{
                id: 'operation',
                title: '取得運転',
                value: '—',
                details: ['—'],
                tone: 'neutral',
              }}
              stale={false}
            />
            <MonitoringCardView
              card={{
                id: 'health',
                title: '取得健全性',
                value: '—',
                details: ['—'],
                tone: 'neutral',
              }}
              stale={false}
            />
            <MonitoringCardView
              card={{
                id: 'schedule',
                title: 'スケジュール',
                value: '—',
                details: ['—'],
                tone: 'neutral',
              }}
              stale={false}
            />
            <MonitoringCardView
              card={{
                id: 'processing',
                title: '処理待ち',
                value: '—',
                details: ['—'],
                tone: 'neutral',
              }}
              stale={false}
            />
          </>
        )}
      </section>
      <SkeletonTable title="取得元別の稼働状況" headers={SOURCE_HEADERS} rows={SOURCE_ROWS} />
      <SkeletonTable
        title="情報別の反映状況"
        headers={INFORMATION_HEADERS}
        rows={INFORMATION_ROWS}
      />
    </div>
  );
}
