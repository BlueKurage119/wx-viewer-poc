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
  buildWindRowLabel,
  buildWindRows,
  formatIntervalHeader,
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

/**
 * 3時間表のセルaria-label用、時間帯の読み上げ文言(§4.2・§2.1-33)。
 * 基準列は「21-24時」のように「時」を付けた形、延長列は時刻行が空欄のため
 * `formatIntervalHeader`の結果(「29日」「29日12時まで」等)を使う。
 */
function columnTimePhrase(table: RiskTable, index: number): string {
  if (index < table.columns.length) {
    return `${table.detailColumns[index]?.label ?? ''}時`;
  }
  const column = table.detailColumns[index];
  return column ? formatIntervalHeader(column.timeFrom, column.timeTo) : '';
}

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

/** 雨に関わる危険度(大雨浸水・土砂災害・洪水)の行の直後に、雨の量的予想の行を置く(§4.6.1)。 */
const RAIN_ANCHOR_PROPERTY_TYPES = new Set(['大雨浸水危険度', '土砂災害危険度', '洪水危険度']);

/**
 * 危険度全行+基準block量的予想行を、電文の出現順(値配列の初出順)で並べる。
 * 同じ種類(危険度=propertyType、量的予想=propertyType::valueType)は、既に model 側で
 * 連続配置済みのため、行グループの最小出現順で束ねて全体をマージする(§2.1-16)。
 * 風向・風速の統合行(§4.7)は、対応する風危険度行の直下に置く(§2.1-16の例外)。
 * 対応する危険度行が無い統合行は、風の値の初出位置に置く(groupKey='風')。
 * 雨の量的予想の行は、雨に関わる危険度の行のまとまりの直後に置く(§4.6.1)。
 */
function buildThreeHourRows(
  data: WarningTimeseriesData,
  table: RiskTable,
): { readonly rows: readonly TimeSeriesRow[]; readonly remarksUnavailable: boolean } {
  const windRows = buildWindRows(data, table.baseBlockId, table.extensionColumns);
  const windDivisionKeys = new Set(windRows.map((row) => row.areaDivision ?? ''));
  // 統合された区分の風向・最大風速の単独行は、量的予想の行一覧から除く(§4.7、二重表示防止)
  const quantityRowsAll = buildBaseQuantityRows(data, table.baseBlockId, table.extensionColumns);
  const quantityRows = quantityRowsAll.filter((row) => {
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

  // 雨の行(§4.6.1)は、対応する危険度の行があれば通常のマージ対象から外し、後で直後に挿入する。
  const hasRainAnchor = riskEntries.some((entry) =>
    RAIN_ANCHOR_PROPERTY_TYPES.has(parseRowSubject(entry.key).propertyType),
  );
  const rainQuantityRows = hasRainAnchor
    ? quantityRows.filter((row) => row.key.startsWith('雨::'))
    : [];
  const rainKeys = new Set(rainQuantityRows.map((row) => row.key));
  const nonRainQuantityRows = hasRainAnchor
    ? quantityRows.filter((row) => !rainKeys.has(row.key))
    : quantityRows;

  const quantityEntries: ThreeHourEntry[] = nonRainQuantityRows.map((row) => ({
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
  const rainEntries: ThreeHourEntry[] = rainQuantityRows.map((row) => ({
    kind: 'quantity',
    key: row.key,
    label: row.label,
    groupKey: row.key.split('::').slice(0, 2).join('::'),
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
  // 直下に置けた統合行は区分名を省く。置けなかった統合行(先頭位置)は区分名を付ける(§2.1-30)。
  const windEntry = (row: WindRowEntry, includeDivision: boolean): ThreeHourEntry => ({
    kind: 'wind',
    key: row.key,
    label: buildWindRowLabel(row.areaDivision, row.unit, includeDivision),
    groupKey: '風',
    order: row.firstIndex,
    windCells: row.cells,
  });

  const combined: ThreeHourEntry[] = [
    ...riskEntries,
    ...quantityEntries,
    ...unmatchedWindRows.map((row) => windEntry(row, true)),
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
  const withWind: ThreeHourEntry[] = [];
  for (const entry of combined) {
    withWind.push(entry);
    if (entry.kind === 'risk' && parseRowSubject(entry.key).propertyType === '風危険度') {
      const areaDivision = parseRowSubject(entry.key).areaDivision;
      const match = matchedWindRows.find((row) => (row.areaDivision ?? null) === areaDivision);
      if (match) {
        withWind.push(windEntry(match, false));
      }
    }
  }

  // 雨の行を、雨に関わる危険度の行のうち最後のものの直後にまとめて挿入する(§4.6.1)。
  let final = withWind;
  if (hasRainAnchor && rainEntries.length > 0) {
    let rainAnchorIndex = -1;
    withWind.forEach((entry, index) => {
      if (
        entry.kind === 'risk' &&
        RAIN_ANCHOR_PROPERTY_TYPES.has(parseRowSubject(entry.key).propertyType)
      ) {
        rainAnchorIndex = index;
      }
    });
    if (rainAnchorIndex !== -1) {
      final = [
        ...withWind.slice(0, rainAnchorIndex + 1),
        ...rainEntries,
        ...withWind.slice(rainAnchorIndex + 1),
      ];
    }
  }

  // 量的予想・統合行(3時間表=基準block)はblockIdで照合する。危険度の行はblockIdを照合しない(§4.4)。
  const subjectRows = final.map((entry) => ({
    key: entry.key,
    ...parseRowSubject(entry.key),
    blockId: entry.kind === 'risk' ? null : table.baseBlockId,
  }));
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
            content: renderRiskCellContent(cell, columnTimePhrase(table, index)),
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
            content: renderWindCellContent(cell, columnTimePhrase(table, index)),
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
  const lastColumn = table.detailColumns[table.detailColumns.length - 1];
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
              ...toTimeSeriesColumns(table.detailColumns),
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
