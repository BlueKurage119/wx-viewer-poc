import { memo, useMemo } from 'react';
import type { MonitoringLoadState } from './useMonitoringStatus';
import {
  buildMonitoringCards,
  formatJstDateTime,
  type MonitoringCard,
} from './monitoringPresentation';
import { useMonitoringStatus } from './useMonitoringStatus';

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
  '有効な情報件数',
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

const CARD_ICON_NAMES: Readonly<Record<MonitoringCard['id'], string>> = {
  operation: 'settings',
  health: 'check_circle',
  schedule: 'schedule',
  processing: 'article',
};

const MonitoringCardView = memo(function MonitoringCardView({ card }: { card: MonitoringCard }) {
  return (
    <article className={`monitoring-card monitoring-tone-${card.tone}`}>
      <span className="monitoring-card-icon" aria-hidden="true">
        <span className="monitoring-card-icon-symbol">{CARD_ICON_NAMES[card.id]}</span>
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
});

const SkeletonTable = memo(function SkeletonTable({
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
});

export function MonitoringDashboardView({ state }: { state: MonitoringLoadState }) {
  // 更新中は既存データを維持し、最終表示更新だけを継続表示する。
  const cards = useMemo(() => (state.data ? buildMonitoringCards(state.data) : null), [state.data]);

  return (
    <div className="monitoring-dashboard" aria-label="取得監視">
      <div className="monitoring-update-row">
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
          cards.map((card) => <MonitoringCardView card={card} key={card.id} />)
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
            />
            <MonitoringCardView
              card={{
                id: 'health',
                title: '取得健全性',
                value: '—',
                details: ['—'],
                tone: 'neutral',
              }}
            />
            <MonitoringCardView
              card={{
                id: 'schedule',
                title: 'スケジュール',
                value: '—',
                details: ['—'],
                tone: 'neutral',
              }}
            />
            <MonitoringCardView
              card={{
                id: 'processing',
                title: '処理待ち',
                value: '—',
                details: ['—'],
                tone: 'neutral',
              }}
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

export function MonitoringDashboard({ terminalId }: { terminalId: string }) {
  const state = useMonitoringStatus(terminalId);
  return <MonitoringDashboardView state={state} />;
}
