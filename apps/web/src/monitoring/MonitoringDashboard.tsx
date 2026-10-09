import type { WeatherRole } from '@wx-viewer-poc/shared';
import type { WeatherRestartModel } from './useWeatherRestart';
import {
  presentSampleFreshness,
  workerRestartabilityId,
  workerRestartableBadgeId,
} from './weatherWorkerPresentation';
import { memo, useEffect, useMemo } from 'react';
import type { VenueForecastTargets } from '@wx-viewer-poc/shared';
import type { MonitoringLoadState } from './useMonitoringStatus';
import {
  buildMonitoringCards,
  buildSourceStatusRows,
  formatElapsedTime,
  formatJstDateTime,
  IDLE_RESTARTS,
  NO_BASELINES,
  SOURCE_ROW_DEFINITIONS,
  type MonitoringCard,
  type SourceStatusRow,
} from './monitoringPresentation';
import { buildInformationRows, type InformationRow } from './monitoringInformationRows';
import { useMonitoringStatus } from './useMonitoringStatus';
import { useMonitoringUptime } from './useMonitoringUptime';
import { useVenueRegistry } from '../venueRegistryContext';

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
  acquisitionWorker: 'cloud_download',
  deliveryWorker: 'dns',
  autoFetch: 'settings',
  telegram: 'checklist',
};

const MonitoringCardView = memo(function MonitoringCardView({ card }: { card: MonitoringCard }) {
  const role: WeatherRole | null =
    card.id === 'acquisitionWorker'
      ? 'acquisition'
      : card.id === 'deliveryWorker'
        ? 'delivery'
        : null;
  return (
    <article className={`monitoring-card monitoring-tone-${card.tone}`} data-card={card.id}>
      <span className="monitoring-card-icon" aria-hidden="true">
        <span className="monitoring-card-icon-symbol">{CARD_ICON_NAMES[card.id]}</span>
      </span>
      <div className="monitoring-card-content">
        <div className="monitoring-card-heading">
          <h2
            aria-describedby={role && card.canRestart ? workerRestartableBadgeId(role) : undefined}
          >
            {card.title}
          </h2>
          {role && card.canRestart ? (
            <span className="monitoring-card-badge" id={workerRestartableBadgeId(role)}>
              再起動可
            </span>
          ) : null}
        </div>
        <p className="monitoring-card-value" title={card.value}>
          {card.value}
        </p>
        <div className="monitoring-card-details">
          {card.details.map((detail) => (
            <p
              className={`monitoring-card-detail${detail.tone ? ` monitoring-detail-${detail.tone}` : ''}`}
              data-detail-kind={detail.kind}
              key={detail.text}
              title={detail.text}
              {...(detail.kind === 'restart-result'
                ? { role: 'status', 'aria-live': 'polite' as const }
                : {})}
            >
              {detail.text}
            </p>
          ))}
        </div>
        {role && card.restartability ? (
          <span hidden id={workerRestartabilityId(role)}>
            {card.restartability}
          </span>
        ) : null}
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
            {columnWidths.map((width, index) => (
              <col key={index} style={{ width: `${width}%` }} />
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
            {SOURCE_COLUMN_WIDTHS.map((width, index) => (
              <col key={index} style={{ width: `${width}%` }} />
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
            {INFORMATION_COLUMN_WIDTHS.map((width, index) => (
              <col key={index} style={{ width: `${width}%` }} />
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

export function MonitoringDashboardView({
  state,
  uptimeSeconds,
  resolveTargets,
  workerModel,
  deliveryModel,
  restartBaselines = NO_BASELINES,
}: {
  state: MonitoringLoadState;
  workerModel?: WeatherRestartModel;
  deliveryModel?: WeatherRestartModel;
  /** 提供の完了判定に使う、再起動完了受領後に最初に得た監視応答の generatedAt。 */
  restartBaselines?: Readonly<Record<WeatherRole, string | null>>;
  uptimeSeconds?: number | null;
  resolveTargets?: (venueId: string) => VenueForecastTargets | undefined;
}) {
  const serverUptime = useMonitoringUptime(state.data);
  const displayUptime = uptimeSeconds !== undefined ? uptimeSeconds : serverUptime;
  const uptimeText = displayUptime !== null ? formatElapsedTime(displayUptime) : '—';

  // 更新中は既存データを維持し、画面更新時刻だけを継続表示する。
  const isFailed = state.phase === 'failed';
  const acquisitionRestart = workerModel?.state ?? IDLE_RESTARTS.acquisition;
  const deliveryRestart = deliveryModel?.state ?? IDLE_RESTARTS.delivery;
  const cards = useMemo(
    () =>
      buildMonitoringCards({
        data: state.data,
        monitoringFailed: isFailed || state.data === null,
        restarts: { acquisition: acquisitionRestart, delivery: deliveryRestart },
        baselines: restartBaselines,
      }),
    [state.data, isFailed, acquisitionRestart, deliveryRestart, restartBaselines],
  );
  const sampleFreshness = useMemo(() => presentSampleFreshness(state.data), [state.data]);
  const sourceRows = useMemo(
    () => buildSourceStatusRows(state.data, isFailed),
    [state.data, isFailed],
  );
  const informationRows = useMemo(
    () => (state.data ? buildInformationRows(state.data, resolveTargets, isFailed) : null),
    [state.data, resolveTargets, isFailed],
  );

  return (
    <div className="monitoring-dashboard" aria-label="取得監視">
      <div className="monitoring-update-row">
        <span className="monitoring-uptime">メイン 運転時間: {uptimeText}</span>
        {sampleFreshness ? (
          <span
            className={`monitoring-sample-freshness monitoring-tone-${sampleFreshness.tone}`}
            data-monitoring-sample="true"
          >
            {sampleFreshness.text}
          </span>
        ) : null}
        <span>
          画面更新{' '}
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
        {cards.map((card) => (
          <MonitoringCardView card={card} key={card.id} />
        ))}
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

export interface MonitoringDashboardProps {
  terminalId: string;
  workerModel?: WeatherRestartModel;
  deliveryModel?: WeatherRestartModel;
  restartBaselines?: Readonly<Record<WeatherRole, string | null>>;
  onLoadStateChange?: (state: MonitoringLoadState) => void;
}

export function MonitoringDashboard({
  terminalId,
  onLoadStateChange,
  workerModel,
  deliveryModel,
  restartBaselines,
}: MonitoringDashboardProps) {
  const state = useMonitoringStatus(
    terminalId,
    (workerModel?.refreshVersion ?? 0) + (deliveryModel?.refreshVersion ?? 0),
  );
  const registry = useVenueRegistry();

  useEffect(() => {
    onLoadStateChange?.(state);
  }, [state, onLoadStateChange]);

  return (
    <MonitoringDashboardView
      state={state}
      workerModel={workerModel}
      deliveryModel={deliveryModel}
      restartBaselines={restartBaselines}
      resolveTargets={(venueId) => {
        const resolved = registry.resolveVenueId(venueId);
        return resolved ? registry.getVenue(resolved) : undefined;
      }}
    />
  );
}
