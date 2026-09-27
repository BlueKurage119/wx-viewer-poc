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
  buildWindRows,
  type DetailCell,
  type RiskCell,
  type RiskTable,
  type WindRowEntry,
  type WtsColumn,
  type WtsRow,
} from './warningTimeSeriesModel';
import {
  renderRiskCellContent,
  renderQuantityCellContent,
  renderWindCellContent,
} from './WarningTimeSeriesContent';

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

interface ThreeHourEntry {
  readonly kind: 'risk' | 'quantity' | 'wind';
  readonly key: string;
  readonly label: string;
  readonly groupKey: string;
  readonly order: number;
  readonly riskCells?: readonly RiskCell[];
  readonly quantityCells?: readonly DetailCell[];
  readonly windCells?: WindRowEntry['cells'];
}

/**
 * 危険度全行+基準block量的予想行を、電文の出現順(値配列の初出順)で並べる。
 * 同じ種類(危険度=propertyType、量的予想=propertyType::valueType)は、既に model 側で
 * 連続配置済みのため、行グループの最小出現順で束ねて全体をマージする(§2.1-16)。
 * 風向・風速の統合行(§4.7)は、対応する風危険度行の直下に置く(§2.1-16の例外)。
 * 対応する危険度行が無い統合行は、風の値の初出位置に置く(groupKey='風')。
 */
function buildThreeHourRows(
  data: WarningTimeseriesData,
  table: RiskTable,
): { readonly rows: readonly TimeSeriesRow[]; readonly remarksUnavailable: boolean } {
  const windRows = buildWindRows(data, table.baseBlockId);
  const windDivisionKeys = new Set(windRows.map((row) => row.areaDivision ?? ''));
  // 統合された区分の風向・最大風速の単独行は、量的予想の行一覧から除く(§4.7、二重表示防止)
  const quantityRows = buildBaseQuantityRows(data, table.baseBlockId).filter((row) => {
    const parts = row.key.split('::');
    if (parts[0] !== '風' || (parts[1] !== '風向' && parts[1] !== '最大風速')) {
      return true;
    }
    const divisionKey = parts[2] ?? '';
    return !windDivisionKeys.has(divisionKey);
  });

  const firstIndex = (
    predicate: (v: WarningTimeseriesData['values'][number]) => boolean,
  ): number => {
    const idx = data.values.findIndex(predicate);
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  };

  const riskEntries: ThreeHourEntry[] = table.allRows.map((row) => ({
    kind: 'risk',
    key: row.key,
    label: row.label,
    groupKey: parseRowSubject(row.key).propertyType,
    order: firstIndex(
      (v) => v.valueCategory === 'risk' && `${v.propertyType}::${v.areaDivision ?? ''}` === row.key,
    ),
    riskCells: row.cells,
  }));
  const quantityEntries: ThreeHourEntry[] = quantityRows.map((row) => ({
    kind: 'quantity',
    key: row.key,
    label: row.label,
    groupKey: row.key.split('::').slice(0, 2).join('::'), // propertyType::valueType
    order: firstIndex(
      (v) =>
        v.valueCategory === 'quantity' &&
        `${v.propertyType}::${v.valueType}::${v.areaDivision ?? ''}` === row.key,
    ),
    quantityCells: row.cells,
  }));

  // 危険度行(風危険度)と区分が一致する統合行は、その行の直下に配置するため、通常のマージ対象から外す。
  const riskDivisionKeys = new Set(
    riskEntries
      .filter((entry) => parseRowSubject(entry.key).propertyType === '風危険度')
      .map((entry) => parseRowSubject(entry.key).areaDivision ?? ''),
  );
  const matchedWindRows = windRows.filter((row) => riskDivisionKeys.has(row.areaDivision ?? ''));
  const unmatchedWindRows = windRows.filter((row) => !riskDivisionKeys.has(row.areaDivision ?? ''));
  const windEntry = (row: WindRowEntry): ThreeHourEntry => ({
    kind: 'wind',
    key: row.key,
    label: row.label,
    groupKey: '風',
    order: row.firstIndex,
    windCells: row.cells,
  });

  const combined: ThreeHourEntry[] = [
    ...riskEntries,
    ...quantityEntries,
    ...unmatchedWindRows.map(windEntry),
  ];
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

  // 風危険度行の直下に、区分が一致する統合行を挿入する(§4.7・§2.1-16の例外)
  const final: ThreeHourEntry[] = [];
  for (const entry of combined) {
    final.push(entry);
    if (entry.kind === 'risk' && parseRowSubject(entry.key).propertyType === '風危険度') {
      const areaDivision = parseRowSubject(entry.key).areaDivision;
      const match = matchedWindRows.find((row) => (row.areaDivision ?? null) === areaDivision);
      if (match) {
        final.push(windEntry(match));
      }
    }
  }

  const subjectRows = final.map((entry) => ({ key: entry.key, ...parseRowSubject(entry.key) }));
  const remarks = buildRemarks(data.additions, subjectRows);
  const remarksUnavailable = remarks === null;

  const rows = final.map((entry) => {
    const remarkText = remarks?.byRow.get(entry.key) ?? '';
    const remarkCell = { key: `${entry.key}-${REMARKS_COLUMN_KEY}`, content: remarkText };
    if (entry.kind === 'risk') {
      const cells = entry.riskCells as readonly RiskCell[];
      return {
        key: entry.key,
        header: entry.label,
        cells: [
          ...cells.map((cell, index) => ({
            key: `${entry.key}-${index}`,
            content: renderRiskCellContent(cell, table.columns[index]?.label ?? ''),
          })),
          remarkCell,
        ],
      };
    }
    if (entry.kind === 'wind') {
      const cells = entry.windCells as WindRowEntry['cells'];
      return {
        key: entry.key,
        header: entry.label,
        cells: [
          ...cells.map((cell, index) => ({
            key: `${entry.key}-${index}`,
            content: renderWindCellContent(cell, table.columns[index]?.label ?? ''),
          })),
          remarkCell,
        ],
      };
    }
    const cells = entry.quantityCells as readonly DetailCell[];
    return {
      key: entry.key,
      header: entry.label,
      cells: [
        ...cells.map((cell, index) => ({
          key: `${entry.key}-${index}`,
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
    // stickyHeaderのtable-layout:fixedで既定4remになるため、備考欄として広めの幅を指定する
    width: '8rem',
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
            stickyHeader
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
