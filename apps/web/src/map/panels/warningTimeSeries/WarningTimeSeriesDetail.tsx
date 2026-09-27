/**
 * 警報等時系列パネルの詳細ダイアログ本文 (G4 #55 §4.4)。【設計案・見た目は後日ユーザー監修】
 *
 * (1) 3時間表: 危険度の全行 + 基準blockの量的予想行を、電文の出現順で並べる。
 * (2) 別欄: 基準以外のblockの量的予想をblockごとの表で示す。
 * 凡例は本文の先頭に置く(パネル本体には置かない)。
 */
import type { WarningTimeseriesData } from '@wx-viewer-poc/shared';
import {
  DetailTimeSeriesTable,
  type TimeSeriesColumn,
  type TimeSeriesRow,
} from '../../detail/DetailTimeSeriesTable';
import {
  buildBaseQuantityRows,
  buildSeparateQuantityTables,
  type DetailCell,
  type RiskCell,
  type RiskTable,
  type WtsColumn,
  type WtsRow,
} from './warningTimeSeriesModel';
import { renderRiskCellContent, renderQuantityCellContent } from './WarningTimeSeriesContent';

export interface WarningTimeSeriesDetailProps {
  readonly data: WarningTimeseriesData;
  readonly table: RiskTable | null;
}

function toTimeSeriesColumns(columns: readonly WtsColumn[]): readonly TimeSeriesColumn[] {
  return columns.map((column) => ({
    key: column.key,
    at: column.timeFrom,
    timeLabel: column.label,
  }));
}

/** 危険度全行+基準block量的予想行を、電文の出現順(values配列の初出順)で並べる。 */
function buildThreeHourRows(
  data: WarningTimeseriesData,
  table: RiskTable,
): readonly TimeSeriesRow[] {
  const quantityRows = buildBaseQuantityRows(data, table.baseBlockId);

  const firstIndex = (
    predicate: (v: WarningTimeseriesData['values'][number]) => boolean,
  ): number => {
    const idx = data.values.findIndex(predicate);
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  };

  const riskEntries = table.allRows.map((row) => ({
    kind: 'risk' as const,
    row,
    order: firstIndex(
      (v) => v.valueCategory === 'risk' && `${v.propertyType}::${v.areaDivision ?? ''}` === row.key,
    ),
  }));
  const quantityEntries = quantityRows.map((row) => ({
    kind: 'quantity' as const,
    row,
    order: firstIndex(
      (v) =>
        v.valueCategory === 'quantity' &&
        `${v.propertyType}::${v.valueType}::${v.areaDivision ?? ''}` === row.key,
    ),
  }));

  const combined = [...riskEntries, ...quantityEntries].sort((a, b) => a.order - b.order);

  return combined.map((entry) => {
    if (entry.kind === 'risk') {
      const row = entry.row as WtsRow<RiskCell>;
      return {
        key: row.key,
        header: row.label,
        cells: row.cells.map((cell, index) => ({
          key: `${row.key}-${index}`,
          content: renderRiskCellContent(cell, table.columns[index]?.label ?? ''),
        })),
      };
    }
    const row = entry.row as WtsRow<DetailCell>;
    return {
      key: row.key,
      header: row.label,
      cells: row.cells.map((cell, index) => ({
        key: `${row.key}-${index}`,
        content: renderQuantityCellContent(cell),
      })),
    };
  });
}

function SeparateQuantityTable({
  blockId,
  columns,
  rows,
}: {
  readonly blockId: string;
  readonly columns: readonly WtsColumn[];
  readonly rows: readonly WtsRow<DetailCell>[];
}) {
  return (
    <table className="wts-detail-separate-table">
      <caption className="wts-visually-hidden">{`量的予想(${blockId})`}</caption>
      <thead>
        <tr>
          <th scope="col" />
          {columns.map((column) => (
            <th key={column.key} scope="col">
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row">{row.label}</th>
            {row.cells.map((cell, index) => (
              <td key={`${row.key}-${index}`}>{renderQuantityCellContent(cell)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WtsLegend() {
  return (
    <div className="wts-legend">
      <span className="wts-legend-item">
        <span className="wts-cell wts-cell-level5">切迫</span>特別警報級
      </span>
      <span className="wts-legend-item">
        <span className="wts-cell wts-cell-level4">危険</span>警戒レベル４相当
      </span>
      <span className="wts-legend-item">
        <span className="wts-cell wts-cell-level3">警戒</span>警報級
      </span>
      <span className="wts-legend-item">
        <span className="wts-cell wts-cell-level2" />
        注意報級
      </span>
      <span className="wts-legend-item">
        <span className="wts-cell wts-cell-below" />
        未満
      </span>
      <span className="wts-legend-item">
        <span className="wts-cell wts-cell-noValue">—</span>値なし
      </span>
      <span className="wts-legend-item">
        <span className="wts-cell wts-cell-missing">?</span>欠測・未取得
      </span>
      <p className="wts-legend-note">文字は段階が変わる時間帯にだけ表示</p>
    </div>
  );
}

export function WarningTimeSeriesDetail({ data, table }: WarningTimeSeriesDetailProps) {
  const separateTables = buildSeparateQuantityTables(data, table?.baseBlockId ?? null);

  return (
    <div className="wts-detail">
      <WtsLegend />
      {table !== null && (
        <DetailTimeSeriesTable
          caption="警報等時系列(3時間表)"
          rowHeaderLabel="要素"
          columns={toTimeSeriesColumns(table.columns)}
          rows={buildThreeHourRows(data, table)}
          initialColumnKey={table.currentColumnKey ?? undefined}
        />
      )}
      {separateTables.length > 0 && (
        <div className="wts-detail-separate">
          {separateTables.map((entry) => (
            <SeparateQuantityTable
              key={entry.blockId}
              blockId={entry.blockId}
              columns={entry.columns}
              rows={entry.rows}
            />
          ))}
        </div>
      )}
    </div>
  );
}
