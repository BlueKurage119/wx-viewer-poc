import { useState } from 'react';
import type {
  AmedasObservationDto,
  AmedasPublicElement,
  AmedasResponse,
} from '@wx-viewer-poc/shared';
import { DetailDialog } from '../../detail/DetailDialog';
import { useDetailDialogScrollContainer } from '../../detail/DetailDialogScrollContainerContext';
import {
  AMEDAS_FIELDS,
  amedasValue,
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
  if (response.capabilities.unsupportedElements.includes(keyName))
    return <p>{field.label}：非提供</p>;
  const samples = rows.map((row) => ({
    at: Date.parse(row.observedAt),
    value: row.values[keyName],
  }));
  const finite = samples.filter(
    (sample): sample is { at: number; value: number } =>
      typeof sample.value === 'number' && Number.isFinite(sample.value),
  );
  if (finite.length === 0) return <p>{field.label}：観測値なし（欠測または未取得）</p>;
  const start = now - 24 * 60 * 60 * 1000;
  const low = Math.min(0, ...finite.map((sample) => sample.value));
  const high = Math.max(...finite.map((sample) => sample.value), low + 1);
  const x = (at: number) => 32 + ((at - start) / (now - start)) * 560;
  const y = (value: number) => 148 - ((value - low) / (high - low)) * 116;
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
      <div className="amedas-plot-scroll">
        <svg
          viewBox="0 0 620 190"
          role="img"
          aria-label={`${field.label}の直近24時間。詳しい値は下の観測表を参照`}
        >
          <line x1="32" y1="148" x2="592" y2="148" className="amedas-axis" />
          <text x="32" y="174">
            24時間前
          </text>
          <text x="552" y="174">
            現在
          </text>
          <text x="0" y="25">
            {high}
          </text>
          <text x="0" y="150">
            {low}
          </text>
          {keyName === 'precipitation1h'
            ? finite.map((sample) => (
                <rect
                  key={sample.at}
                  x={x(sample.at) - 3}
                  y={y(sample.value)}
                  width="6"
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
  return (
    <div className="amedas-detail">
      {staleMessage && (
        <p role="status" className="amedas-alert">
          {staleMessage}
        </p>
      )}
      <p>
        直近24時間：{formatAmedasTime(new Date(start).toISOString())}〜
        {formatAmedasTime(new Date(now).toISOString())}
      </p>
      {rows.length === 0 ? (
        <p>この期間の観測値は取得できません</p>
      ) : (
        <>
          {Date.parse(rows[0]!.observedAt) > start && (
            <p>期間開始〜{formatAmedasTime(rows[0]!.observedAt)}は未取得</p>
          )}
          {Date.parse(rows[rows.length - 1]!.observedAt) < now && (
            <p>{formatAmedasTime(rows[rows.length - 1]!.observedAt)}〜現在は未取得</p>
          )}
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
                  {AMEDAS_FIELDS.map((field) => (
                    <th key={field.key} scope="col">
                      {field.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.observedAt}>
                    <th scope="row">{formatAmedasTime(row.observedAt)}</th>
                    {AMEDAS_FIELDS.map((field) => (
                      <td key={field.key}>{amedasValue(response, row, field.key)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
              <dd>{amedasValue(response, row, field.key as AmedasPublicElement)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>取得できません</p>
      )}
      <button type="button" className="amedas-detail-button" onClick={() => setOpen(true)}>
        詳細
      </button>
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
        <Detail response={response} now={now} staleMessage={staleMessage} />
      </DetailDialog>
    </div>
  );
}
