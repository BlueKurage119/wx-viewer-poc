import { useState } from 'react';
import type { EarlyWarningResponse } from '@wx-viewer-poc/shared';
import { GbButton } from '../../../components/md';
import { DetailDialog } from '../../detail/DetailDialog';
import { useDetailDialogScrollContainer } from '../../detail/DetailDialogScrollContainerContext';
import {
  buildDetailTable,
  buildTable,
  type Segment,
  type WarningCellKind,
  type WarningTable,
} from './earlyWarningModel';
import type { IssuedTimes } from './issuedTimes';

const DESCRIPTION: Readonly<Record<WarningCellKind, string>> = {
  high: '高',
  medium: '中',
  none: 'なし',
  noValue: '値なし',
  missing: '欠測',
  outOfRange: '対象外',
};
const CONTENT: Readonly<Record<WarningCellKind, string>> = {
  high: '高',
  medium: '中',
  none: '－',
  noValue: '',
  missing: '?',
  outOfRange: '',
};
function cellContent(kind: WarningCellKind, label: string) {
  return (
    <span className={`ew-cell ew-cell-${kind}`} aria-label={`${label}、${DESCRIPTION[kind]}`}>
      {CONTENT[kind]}
    </span>
  );
}
function WarningTableView({
  table,
  title,
  detail = false,
}: {
  readonly table: WarningTable;
  readonly title: string;
  readonly detail?: boolean;
}) {
  if (table.columns.length === 0 || table.rows.length === 0)
    return <p className="ew-message">発表された値はありません</p>;
  const rainIndex = table.rows.findIndex((row) => row.key === '大雨');
  const soilIndex = table.rows.findIndex((row) => row.key === '土砂災害');
  const joined = table.rainJoined && rainIndex >= 0 && soilIndex === rainIndex + 1;
  return (
    <div className="ew-scroll" role="region" aria-label={title} tabIndex={0}>
      <table className="ew-table">
        <caption className="ew-visually-hidden">{title}</caption>
        <thead>
          <tr>
            <th scope="col">現象</th>
            {table.columns.map((column) => (
              <th scope="col" key={column.key}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              {row.cells.map((kind, index) => {
                const column = table.columns[index]!;
                const rainCell = joined && (detail ? column.segment === 'far' : true);
                if (rainCell && rowIndex === soilIndex) return null;
                const label = `${rainCell && rowIndex === rainIndex ? '大雨・土砂災害、雨の警報級の可能性' : row.label}、${column.label}`;
                return (
                  <td key={column.key} rowSpan={rainCell && rowIndex === rainIndex ? 2 : undefined}>
                    {cellContent(kind, label)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function SegmentTable({
  response,
  segment,
}: {
  readonly response: EarlyWarningResponse;
  readonly segment: Segment;
}) {
  const title = segment === 'near' ? '明後日まで' : '明々後日以降';
  const entry = response[segment];
  return (
    <section className="ew-section">
      <h3>{title}</h3>
      {entry.data === null || entry.metadata.availability === 'unavailable' ? (
        <p className="ew-message">取得できませんでした</p>
      ) : (
        <WarningTableView table={buildTable(response, segment)} title={title} />
      )}
    </section>
  );
}
export function EarlyWarningContent({
  response,
  issuedTimes,
}: {
  readonly response: EarlyWarningResponse;
  readonly issuedTimes: IssuedTimes;
}) {
  const [open, setOpen] = useState(false);
  const scrollContainer = useDetailDialogScrollContainer();
  return (
    <div className="ew-panel">
      <SegmentTable response={response} segment="near" />
      <SegmentTable response={response} segment="far" />
      <GbButton color="text" size="sm" onClick={() => setOpen(true)}>
        詳細
      </GbButton>
      <DetailDialog
        open={open}
        meta={{
          title: '警報級の可能性',
          target: '東京地方',
          time: { kind: 'issued', value: null },
          issuedTimes,
          isTraining: response.isTraining,
        }}
        onClose={() => setOpen(false)}
        scrollContainer={scrollContainer}
      >
        <div className="ew-detail">
          <div className="ew-legend">
            <span>{cellContent('high', '凡例')} 高</span>
            <span>{cellContent('medium', '凡例')} 中</span>
            <span>－（なし）</span>
            <span>空白（値なし）</span>
          </div>
          <WarningTableView
            table={buildDetailTable(response)}
            title="警報級の可能性の全期間"
            detail
          />
        </div>
      </DetailDialog>
    </div>
  );
}
