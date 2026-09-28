import { useState } from 'react';
import type { EarlyWarningResponse } from '@wx-viewer-poc/shared';
import { GbButton } from '../../../components/md';
import { DetailDialog } from '../../detail/DetailDialog';
import { DetailTimeSeriesTable, type TimeSeriesRow } from '../../detail/DetailTimeSeriesTable';
import { useDetailDialogScrollContainer } from '../../detail/DetailDialogScrollContainerContext';
import {
  buildDetailTable,
  buildPanelTable,
  selectPanelColumns,
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
  if (kind === 'outOfRange') return <span aria-label={`${label}、対象外`} />;
  const className = kind === 'missing' ? 'wts-cell wts-cell-missing' : `ew-cell ew-cell-${kind}`;
  return (
    <span className={className} aria-label={`${label}、${DESCRIPTION[kind]}`}>
      {CONTENT[kind]}
    </span>
  );
}
function WarningTableView({
  table,
  title,
  emptyMessage = '発表された値はありません',
}: {
  readonly table: WarningTable;
  readonly title: string;
  readonly emptyMessage?: string;
}) {
  if (table.columns.length === 0 || table.rows.length === 0)
    return <p className="ew-message">{emptyMessage}</p>;
  return (
    <div className="ew-scroll ew-panel-table" role="region" aria-label={title} tabIndex={0}>
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
          {table.rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              {row.cells.map((kind, index) => {
                const column = table.columns[index]!;
                return (
                  <td key={column.key}>{cellContent(kind, `${row.label}、${column.label}`)}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
/** 詳細は共通時系列表へ渡し、遠距離の雨だけ縦結合する。 */
export function EarlyWarningDetail({
  table,
  now,
}: {
  readonly table: WarningTable;
  readonly now: number;
}) {
  if (table.columns.length === 0 || table.rows.length === 0) {
    return <p className="ew-message">発表された値はありません</p>;
  }
  const rainIndex = table.rows.findIndex((row) => row.key === '大雨');
  const soilIndex = table.rows.findIndex((row) => row.key === '土砂災害');
  const canJoin = table.rainJoined && rainIndex >= 0 && soilIndex === rainIndex + 1;
  const rows: readonly TimeSeriesRow[] = table.rows.map((row, rowIndex) => ({
    key: row.key,
    header: row.label,
    cells: row.cells.flatMap((kind, index) => {
      const column = table.columns[index]!;
      const joined = canJoin && column.segment === 'far';
      if (joined && rowIndex === soilIndex) return [];
      const subject =
        joined && rowIndex === rainIndex ? '大雨・土砂災害、雨の警報級の可能性' : row.label;
      return [
        {
          key: `${row.key}:${column.key}`,
          rowSpan: joined && rowIndex === rainIndex ? 2 : undefined,
          content: cellContent(kind, `${subject}、${column.label}`),
        },
      ];
    }),
  }));
  const columns = table.columns.map((column) => ({
    key: column.key,
    at: column.timeFrom,
    timeLabel: column.label.includes(' ') ? column.label.split(' ').slice(1).join(' ') : '',
  }));
  return (
    <DetailTimeSeriesTable
      caption="警報級の可能性の全期間"
      rowHeaderLabel="現象"
      columns={columns}
      rows={rows}
      initialColumnKey={selectPanelColumns(table.columns, now)[0]?.key}
      stickyHeader
      bodyDateBoundaries
    />
  );
}
export function NearPanel({
  response,
  now,
}: {
  readonly response: EarlyWarningResponse;
  readonly now: number;
}) {
  const entry = response.near;
  if (entry.data === null || entry.metadata.availability === 'unavailable') {
    return <p className="ew-message">取得できませんでした</p>;
  }
  const table = buildPanelTable(response, now);
  const emptyMessage =
    table.columns.length === 0 ? '表示できる時間帯はありません' : '警報級の可能性はありません';
  return <WarningTableView table={table} title="明後日まで" emptyMessage={emptyMessage} />;
}
export function EarlyWarningContent({
  response,
  issuedTimes,
  now,
}: {
  readonly response: EarlyWarningResponse;
  readonly issuedTimes: IssuedTimes;
  readonly now: number;
}) {
  const [open, setOpen] = useState(false);
  const scrollContainer = useDetailDialogScrollContainer();
  return (
    <div className="ew-panel">
      <NearPanel response={response} now={now} />
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
        <div className="wts-detail ew-detail">
          <div className="wts-legend">
            <span className="wts-legend-item">{cellContent('high', '凡例')} 高</span>
            <span className="wts-legend-item">{cellContent('medium', '凡例')} 中</span>
            <span className="wts-legend-item">{cellContent('none', '凡例')} なし</span>
            <span className="wts-legend-item">{cellContent('noValue', '凡例')} 値なし</span>
            <span className="wts-legend-item">{cellContent('missing', '凡例')} 欠測・未取得</span>
          </div>
          <EarlyWarningDetail table={buildDetailTable(response)} now={now} />
        </div>
      </DetailDialog>
    </div>
  );
}
