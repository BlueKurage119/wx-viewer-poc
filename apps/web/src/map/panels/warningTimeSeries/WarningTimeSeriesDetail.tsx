/**
 * 警報等時系列パネルの詳細ダイアログ本文 (G4 #55 §4.4)。【設計案・見た目は後日ユーザー監修】
 *
 * (1) 3時間表: 危険度の全行 + 基準blockの量的予想行を、電文の出現順(同種の区分行は連続配置)
 *     で並べ、右端固定の「備考」列(付加事項)を追加する。
 * (2) 別欄: 基準以外のblockの量的予想をblockごとの表で示す(備考は置かない)。
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
  buildRemarks,
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

const REMARKS_COLUMN_KEY = 'remarks';

function toTimeSeriesColumns(columns: readonly WtsColumn[]): readonly TimeSeriesColumn[] {
  return columns.map((column) => ({
    key: column.key,
    at: column.timeFrom,
    timeLabel: column.label,
  }));
}

/** 行キー(`propertyType::areaDivision` または `propertyType::valueType::areaDivision`)から備考照合用の主体を復元する。 */
function parseRowSubject(key: string): {
  readonly propertyType: string;
  readonly areaDivision: string | null;
} {
  const parts = key.split('::');
  const propertyType = parts[0] ?? '';
  const areaDivisionRaw = parts[parts.length - 1] ?? '';
  return { propertyType, areaDivision: areaDivisionRaw === '' ? null : areaDivisionRaw };
}

/**
 * 危険度全行+基準block量的予想行を、電文の出現順(値配列の初出順)で並べる。
 * 同じ種類(危険度=propertyType、量的予想=propertyType::valueType)は、既に model 側で
 * 連続配置済みのため、行グループの最小出現順で束ねて全体をマージする(§2.1-16)。
 */
function buildThreeHourRows(
  data: WarningTimeseriesData,
  table: RiskTable,
): { readonly rows: readonly TimeSeriesRow[]; readonly remarksUnavailable: boolean } {
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
    groupKey: parseRowSubject(row.key).propertyType,
    order: firstIndex(
      (v) => v.valueCategory === 'risk' && `${v.propertyType}::${v.areaDivision ?? ''}` === row.key,
    ),
  }));
  const quantityEntries = quantityRows.map((row) => ({
    kind: 'quantity' as const,
    row,
    groupKey: row.key.split('::').slice(0, 2).join('::'), // propertyType::valueType
    order: firstIndex(
      (v) =>
        v.valueCategory === 'quantity' &&
        `${v.propertyType}::${v.valueType}::${v.areaDivision ?? ''}` === row.key,
    ),
  }));

  const combined = [...riskEntries, ...quantityEntries];
  const groupFirstOrder = new Map<string, number>();
  for (const entry of combined) {
    const prev = groupFirstOrder.get(entry.groupKey);
    if (prev === undefined || entry.order < prev) {
      groupFirstOrder.set(entry.groupKey, entry.order);
    }
  }
  combined.sort((a, b) => {
    const ga = groupFirstOrder.get(a.groupKey) as number;
    const gb = groupFirstOrder.get(b.groupKey) as number;
    if (ga !== gb) {
      return ga - gb;
    }
    return a.order - b.order;
  });

  const subjectRows = combined.map((entry) => ({
    key: entry.row.key,
    ...parseRowSubject(entry.row.key),
  }));
  const remarks = buildRemarks(data.additions, subjectRows);
  const remarksUnavailable = remarks === null;

  const rows = combined.map((entry) => {
    const remarkText = remarks?.byRow.get(entry.row.key) ?? '';
    const remarkCell = { key: `${entry.row.key}-${REMARKS_COLUMN_KEY}`, content: remarkText };
    if (entry.kind === 'risk') {
      const row = entry.row as WtsRow<RiskCell>;
      return {
        key: row.key,
        header: row.label,
        cells: [
          ...row.cells.map((cell, index) => ({
            key: `${row.key}-${index}`,
            content: renderRiskCellContent(cell, table.columns[index]?.label ?? ''),
          })),
          remarkCell,
        ],
      };
    }
    const row = entry.row as WtsRow<DetailCell>;
    return {
      key: row.key,
      header: row.label,
      cells: [
        ...row.cells.map((cell, index) => ({
          key: `${row.key}-${index}`,
          content: renderQuantityCellContent(cell),
        })),
        remarkCell,
      ],
    };
  });

  return { rows, remarksUnavailable };
}

function buildRemarksColumn(table: RiskTable, unavailable: boolean): TimeSeriesColumn {
  const lastColumn = table.columns[table.columns.length - 1];
  return {
    key: REMARKS_COLUMN_KEY,
    at: lastColumn?.timeFrom ?? '',
    timeLabel: unavailable ? '備考(未取得)' : '備考',
  };
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
        <span className="wts-cell wts-cell-level4">危険</span>危険警報級
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
        未満・値なし
      </span>
      <span className="wts-legend-item">
        <span className="wts-cell wts-cell-missing">?</span>欠測・未取得
      </span>
    </div>
  );
}

export function WarningTimeSeriesDetail({ data, table }: WarningTimeSeriesDetailProps) {
  const separateTables = buildSeparateQuantityTables(data, table?.baseBlockId ?? null);
  const threeHour = table !== null ? buildThreeHourRows(data, table) : null;

  return (
    <div className="wts-detail">
      <WtsLegend />
      {table !== null && threeHour !== null && (
        <div className="wts-detail-3h">
          <DetailTimeSeriesTable
            caption="警報等時系列(3時間表)"
            rowHeaderLabel="要素"
            columns={[
              ...toTimeSeriesColumns(table.columns),
              buildRemarksColumn(table, threeHour.remarksUnavailable),
            ]}
            rows={threeHour.rows}
            initialColumnKey={table.currentColumnKey ?? undefined}
          />
          {threeHour.remarksUnavailable && (
            <p className="wts-remarks-unavailable">付加事項は取得できていません</p>
          )}
        </div>
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
