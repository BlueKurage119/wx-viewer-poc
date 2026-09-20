import { memo, useMemo } from 'react';
import type { MonitoringLoadState } from './useMonitoringStatus';
import {
  buildMonitoringCards,
  buildSourceStatusRows,
  formatJstDateTime,
  SOURCE_ROW_DEFINITIONS,
  type MonitoringCard,
  type SourceStatusRow,
} from './monitoringPresentation';
import { buildInformationRows, type InformationRow } from './monitoringInformationRows';
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
export const SOURCE_ROWS = SOURCE_ROW_DEFINITIONS.map((def) => def.name);
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

const SOURCE_COLUMN_WIDTHS = [11.63, 8.46, 10.15, 14.8, 14.8, 14.8, 12.68, 12.68] as const;
const INFORMATION_COLUMN_WIDTHS = [17.78, 24.44, 12.22, 15.56, 15.56, 14.44] as const;

const CARD_ICON_NAMES: Readonly<Record<MonitoringCard['id'], string>> = {
  operation: 'settings',
  schedule: 'schedule',
  processing: 'article',
  health: 'remove',
};

function healthIconName(value: MonitoringCard['value']): string {
  switch (value) {
    case '正常':
      return 'check';
    case '遅延':
      return 'check_alert';
    case '異常':
      return 'close';
    default:
      return 'remove';
  }
}

const MonitoringCardView = memo(function MonitoringCardView({ card }: { card: MonitoringCard }) {
  return (
    <article className={`monitoring-card monitoring-tone-${card.tone}`}>
      <span className="monitoring-card-icon" aria-hidden="true">
        <span className="monitoring-card-icon-symbol">
          {card.id === 'health' ? healthIconName(card.value) : CARD_ICON_NAMES[card.id]}
        </span>
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
  columnWidths,
  tableClassName,
}: {
  readonly title: string;
  readonly headers: readonly string[];
  readonly rows: readonly string[];
  readonly columnWidths: readonly number[];
  readonly tableClassName: string;
}) {
  return (
    <section className="monitoring-table-section" aria-labelledby={`monitoring-${title}`}>
      <h2 id={`monitoring-${title}`}>{title}</h2>
      <div className="monitoring-table-scroll">
        <table className={tableClassName}>
          <colgroup>
            {columnWidths.map((width) => (
              <col key={width} style={{ width: `${width}%` }} />
            ))}
          </colgroup>
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

const SourceStatusTable = memo(function SourceStatusTable({
  rows,
}: {
  readonly rows: readonly SourceStatusRow[];
}) {
  return (
    <section
      className="monitoring-table-section"
      aria-labelledby="monitoring-source-status-heading"
    >
      <h2 id="monitoring-source-status-heading">取得元別の稼働状況</h2>
      <div className="monitoring-table-scroll">
        <table className="monitoring-source-table">
          <colgroup>
            {SOURCE_COLUMN_WIDTHS.map((width) => (
              <col key={width} style={{ width: `${width}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {SOURCE_HEADERS.map((header) => (
                <th scope="col" key={header}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                className={
                  row.state.tone === 'attention' || row.state.tone === 'error'
                    ? `monitoring-row-${row.state.tone}`
                    : undefined
                }
                key={row.sourceId}
              >
                <th scope="row">{row.name}</th>
                <td
                  className={`monitoring-source-state${row.state.tone ? ` monitoring-tone-${row.state.tone}` : ''}`}
                  title={row.state.note}
                >
                  {row.state.text}
                  {row.state.note ? (
                    <span className="monitoring-visually-hidden">{row.state.note}</span>
                  ) : null}
                </td>
                <td className="monitoring-numeric" title={row.interval.note}>
                  {row.interval.text}
                  {row.interval.note ? (
                    <span className="monitoring-visually-hidden">{row.interval.note}</span>
                  ) : null}
                </td>
                <td className="monitoring-time" title={row.lastAttempt.note}>
                  {row.lastAttempt.text}
                  {row.lastAttempt.note ? (
                    <span className="monitoring-visually-hidden">{row.lastAttempt.note}</span>
                  ) : null}
                </td>
                <td className="monitoring-time" title={row.lastSuccess.note}>
                  {row.lastSuccess.text}
                  {row.lastSuccess.note ? (
                    <span className="monitoring-visually-hidden">{row.lastSuccess.note}</span>
                  ) : null}
                </td>
                <td className="monitoring-time" title={row.nextRun.note}>
                  {row.nextRun.text}
                  {row.nextRun.note ? (
                    <span className="monitoring-visually-hidden">{row.nextRun.note}</span>
                  ) : null}
                </td>
                <td className="monitoring-numeric" title={row.duration.note}>
                  {row.duration.text}
                  {row.duration.note ? (
                    <span className="monitoring-visually-hidden">{row.duration.note}</span>
                  ) : null}
                </td>
                <td
                  className={`monitoring-numeric${row.consecutiveFailures.tone ? ` monitoring-tone-${row.consecutiveFailures.tone}` : ''}`}
                  title={row.consecutiveFailures.note}
                >
                  {row.consecutiveFailures.text}
                  {row.consecutiveFailures.note ? (
                    <span className="monitoring-visually-hidden">
                      {row.consecutiveFailures.note}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
});

const InformationTable = memo(function InformationTable({
  rows,
}: {
  readonly rows: readonly InformationRow[];
}) {
  return (
    <section
      className="monitoring-table-section"
      aria-labelledby="monitoring-information-status-heading"
    >
      <h2 id="monitoring-information-status-heading">情報別の反映状況</h2>
      <div className="monitoring-table-scroll">
        <table className="monitoring-information-table">
          <colgroup>
            {INFORMATION_COLUMN_WIDTHS.map((width) => (
              <col key={width} style={{ width: `${width}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {INFORMATION_HEADERS.map((header) => (
                <th scope="col" key={header}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                className={
                  row.stateTone === 'attention' || row.stateTone === 'error'
                    ? `monitoring-row-${row.stateTone}`
                    : undefined
                }
                key={row.kind}
              >
                <th scope="row">{row.name}</th>
                <td>{row.target}</td>
                <td
                  className={
                    row.stateTone === 'unknown'
                      ? 'monitoring-unavailable'
                      : `monitoring-information-state monitoring-tone-${row.stateTone}`
                  }
                >
                  {row.stateLabel}
                </td>
                <td className="monitoring-time">
                  {row.validAt ? (
                    <time dateTime={row.validAt}>{row.validAtText}</time>
                  ) : (
                    row.validAtText
                  )}
                </td>
                <td className="monitoring-time">
                  {row.fetchedAt ? (
                    <time dateTime={row.fetchedAt}>{row.fetchedAtText}</time>
                  ) : (
                    row.fetchedAtText
                  )}
                </td>
                <td className="monitoring-numeric">{row.summaryCountText}</td>
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
  const sourceRows = useMemo(() => buildSourceStatusRows(state.data), [state.data]);
  const informationRows = useMemo(
    () => (state.data ? buildInformationRows(state.data) : null),
    [state.data],
  );

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
      <SourceStatusTable rows={sourceRows} />
      {state.data !== null && informationRows !== null ? (
        <InformationTable rows={informationRows} />
      ) : (
        <SkeletonTable
          title="情報別の反映状況"
          headers={INFORMATION_HEADERS}
          rows={INFORMATION_ROWS}
          columnWidths={INFORMATION_COLUMN_WIDTHS}
          tableClassName="monitoring-information-table"
        />
      )}
    </div>
  );
}

export function MonitoringDashboard({ terminalId }: { terminalId: string }) {
  const state = useMonitoringStatus(terminalId);
  return <MonitoringDashboardView state={state} />;
}
