import { useState } from 'react';
import type {
  AmedasObservationDto,
  AmedasPublicElement,
  AmedasResponse,
} from '@wx-viewer-poc/shared';
import { GbButton } from '../../../components/md';
import { DetailDialog } from '../../detail/DetailDialog';
import { useDetailDialogScrollContainer } from '../../detail/DetailDialogScrollContainerContext';
import {
  AMEDAS_FIELDS,
  AMEDAS_TABLE_FIELDS,
  hourlyPrecipitationRows,
  amedasPlotRange,
  amedasTimeTicks,
  amedasDisplayValue,
  nextAmedasWindowCount,
  visibleAmedasRows,
  formatAmedasTime,
  latestAmedasRow,
  recentAmedasRows,
} from './amedasModel';

type Metric = 'temp' | 'humidity' | 'wind' | 'precipitation1h';
const METRICS: readonly Metric[] = ['temp', 'humidity', 'wind', 'precipitation1h'];
function Plot({
  response,
  rows,
  keyName,
  now,
}: {
  response: AmedasResponse;
  rows: readonly AmedasObservationDto[];
  keyName: Metric;
  now: number;
}) {
  const field = AMEDAS_FIELDS.find((item) => item.key === keyName)!;
  const unsupported = response.capabilities.unsupportedElements.includes(keyName);
  const plotRows = unsupported
    ? []
    : keyName === 'precipitation1h'
      ? hourlyPrecipitationRows(rows, new Date(now).toISOString())
      : rows;
  const samples = plotRows.map((row) => ({
    at: Date.parse(row.observedAt),
    value: row.values[keyName],
  }));
  const finite = samples.filter(
    (sample): sample is { at: number; value: number } =>
      typeof sample.value === 'number' && Number.isFinite(sample.value),
  );
  const emptyMessage = unsupported ? '非提供' : '観測値なし（欠測または未取得）';
  const start = now - 24 * 60 * 60 * 1000;
  const range = amedasPlotRange(
    finite.map((sample) => sample.value),
    keyName === 'temp',
  );
  const ticks = amedasTimeTicks(now);
  const x = (at: number) => 32 + ((at - start) / (now - start)) * 560;
  const y = (value: number) =>
    range ? 148 - ((value - range.low) / (range.high - range.low)) * 116 : 148;
  const paths: string[] = [];
  let path = '';
  for (const sample of samples) {
    if (typeof sample.value !== 'number' || !Number.isFinite(sample.value)) {
      if (path) paths.push(path);
      path = '';
    } else {
      path += `${path ? ' L' : 'M'} ${x(sample.at)} ${y(sample.value)}`;
    }
  }
  if (path) paths.push(path);
  return (
    <section className="amedas-plot-section" aria-label={`${field.label}の推移`}>
      <h3>
        {field.label}（{field.unit}）
      </h3>
      {finite.length === 0 && <p>{emptyMessage}</p>}
      <div className="amedas-plot-scroll">
        <svg
          viewBox="0 0 620 190"
          role="img"
          aria-label={`${field.label}の直近24時間、${ticks.map((tick) => tick.label).join('、')}。${keyName === 'precipitation1h' ? '各棒は観測時刻直前1時間の積算値。' : ''}${finite.length === 0 ? emptyMessage : '観測値：'}${finite.map((sample) => `${formatAmedasTime(new Date(sample.at).toISOString())} ${sample.value} ${field.unit}`).join('、')}`}
          tabIndex={0}
        >
          <line x1="32" y1="148" x2="592" y2="148" className="amedas-axis" />
          {ticks.map((tick, index) => {
            const tickX = x(tick.at);
            return (
              <g key={tick.at}>
                <line x1={tickX} y1="148" x2={tickX} y2="154" className="amedas-axis" />
                <text
                  x={tickX}
                  y="178"
                  textAnchor={index === 0 ? 'start' : index === 4 ? 'end' : 'middle'}
                >
                  {tick.label}
                </text>
              </g>
            );
          })}
          {range && (
            <>
              <text x="0" y="25">
                {Number(range.high.toFixed(1))}
              </text>
              <text x="0" y="150">
                {Number(range.low.toFixed(1))}
              </text>
            </>
          )}
          {keyName === 'precipitation1h'
            ? finite.map((sample) => (
                <rect
                  key={sample.at}
                  x={x(sample.at) - 8}
                  y={y(sample.value)}
                  width="16"
                  height={148 - y(sample.value)}
                  className="amedas-graph-mark"
                />
              ))
            : paths.map((segment, index) => (
                <path key={index} d={segment} fill="none" className="amedas-graph-line" />
              ))}
          {keyName !== 'precipitation1h' &&
            finite.map((sample) => (
              <circle
                key={sample.at}
                cx={x(sample.at)}
                cy={y(sample.value)}
                r="3"
                className="amedas-graph-mark"
              />
            ))}
        </svg>
      </div>
    </section>
  );
}
function Detail({
  response,
  now,
  staleMessage,
}: {
  response: AmedasResponse;
  now: number;
  staleMessage: string | null;
}) {
  const rows = recentAmedasRows(response, now);
  const start = now - 24 * 60 * 60 * 1000;
  const [tableWindows, setTableWindows] = useState(1);
  const table = visibleAmedasRows(rows, now, tableWindows);
  const earliest = rows[0]?.observedAt;
  const startMissing = earliest === undefined || Date.parse(earliest) > start;
  return (
    <div className="amedas-detail">
      {staleMessage && (
        <p role="status" className="amedas-alert">
          {staleMessage}
        </p>
      )}
      {startMissing && (
        <p className="amedas-time-summary">
          開始側 未取得{earliest ? `〜${formatAmedasTime(earliest)}` : ' 全期間'}
        </p>
      )}
      {rows.length === 0 ? (
        <p>この期間の観測値は取得できません</p>
      ) : (
        <>
          <div className="amedas-plot-grid">
            {METRICS.map((key) => (
              <Plot key={key} response={response} rows={rows} keyName={key} now={now} />
            ))}
          </div>
          <div
            className="amedas-table-scroll"
            role="region"
            aria-label="アメダス観測値一覧"
            tabIndex={0}
          >
            <table className="amedas-table">
              <caption>観測値と風向（観測時刻ごと）</caption>
              <thead>
                <tr>
                  <th scope="col">観測時刻</th>
                  {AMEDAS_TABLE_FIELDS.map((field) => (
                    <th key={field.key} scope="col">
                      {field.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => (
                  <tr key={row.observedAt}>
                    <th scope="row">{formatAmedasTime(row.observedAt)}</th>
                    {AMEDAS_TABLE_FIELDS.map((field) => (
                      <td key={field.key}>
                        {(() => {
                          const display = amedasDisplayValue(response, row, field.key);
                          return display.accessibleLabel ? (
                            <span
                              aria-label={`${formatAmedasTime(row.observedAt)} ${display.accessibleLabel}`}
                            >
                              {display.text}
                            </span>
                          ) : (
                            display.text
                          );
                        })()}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {table.hasMore && (
            <GbButton
              color="text"
              size="sm"
              onClick={() => setTableWindows(nextAmedasWindowCount(rows, now, tableWindows))}
            >
              続きを見る
            </GbButton>
          )}
        </>
      )}
    </div>
  );
}
export function AmedasContent({
  response,
  now,
  staleMessage,
}: {
  response: AmedasResponse;
  now: number;
  staleMessage: string | null;
}) {
  const [open, setOpen] = useState(false);
  const scrollContainer = useDetailDialogScrollContainer();
  const row = latestAmedasRow(response);
  const detailEnd = row ? Date.parse(row.observedAt) : now;
  return (
    <div className="amedas-panel">
      {staleMessage && (
        <p role="status" className="amedas-alert">
          {staleMessage}
        </p>
      )}
      {row ? (
        <dl className="amedas-values">
          {AMEDAS_FIELDS.map((field) => (
            <div key={field.key}>
              <dt>{field.label}</dt>
              <dd>
                {(() => {
                  const display = amedasDisplayValue(
                    response,
                    row,
                    field.key as AmedasPublicElement,
                  );
                  return display.accessibleLabel ? (
                    <span aria-label={display.accessibleLabel}>{display.text}</span>
                  ) : (
                    display.text
                  );
                })()}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>取得できません</p>
      )}
      <GbButton color="text" size="sm" onClick={() => setOpen(true)}>
        詳細
      </GbButton>
      <DetailDialog
        open={open}
        meta={{
          title: 'アメダス',
          target: response.station.name,
          time: { kind: 'observed', value: row?.observedAt ?? null },
          isTraining: response.isTraining,
        }}
        onClose={() => setOpen(false)}
        scrollContainer={scrollContainer}
      >
        <Detail response={response} now={detailEnd} staleMessage={staleMessage} />
      </DetailDialog>
    </div>
  );
}
