/**
 * 警報等時系列パネル本文 (G4 #55 §4.2〜§4.4)。
 *
 * パネル本体の危険度表(注意報級以上を含む行だけ)、「詳細」ボタン、詳細ダイアログを描画する。
 * セルの色・文字付与ロジックは model 側で確定済み。ここでは表示区分→クラス名/文字の
 * 対応付けだけを行う(製造裁量の内部関数分割)。
 */
import { useState, type ReactNode } from 'react';
import type { WarningTimeseriesResponse } from '@wx-viewer-poc/shared';
import { GbButton } from '../../../components/md';
import { DetailDialog } from '../../detail/DetailDialog';
import { DetailTimeSeriesTable, type TimeSeriesRow } from '../../detail/DetailTimeSeriesTable';
import { useDetailDialogScrollContainer } from '../../detail/DetailDialogScrollContainerContext';
import { resolvePanelTarget } from '../panelTargets';
import {
  resolveWarningTimeSeriesPanelMessage,
  type DetailCell,
  type RiskCell,
  type RiskTable,
} from './warningTimeSeriesModel';
import { WarningTimeSeriesDetail } from './WarningTimeSeriesDetail';

const RISK_ARIA_NAME: Readonly<Record<RiskCell['display'], string>> = Object.freeze({
  level5: '特別警報級相当',
  level4: '警戒レベル４相当',
  level3: '警報級相当',
  level2: '注意報級相当',
  below: '注意報級未満',
  noValue: '値なし',
  missing: '欠測・未取得',
});

/** 危険度セルの表示内容(パネル本体・詳細で共用)。 */
// eslint-disable-next-line react-refresh/only-export-components
export function renderRiskCellContent(cell: RiskCell, columnLabel: string): ReactNode {
  const className = `wts-cell wts-cell-${cell.display}`;
  const ariaLabel = `${columnLabel} ${RISK_ARIA_NAME[cell.display]}`;
  return (
    <span className={className} aria-label={ariaLabel}>
      {cell.label ?? ''}
    </span>
  );
}

/** 量的予想セルの表示内容(基準blockの行・別欄で共用)。 */
// eslint-disable-next-line react-refresh/only-export-components
export function renderQuantityCellContent(cell: DetailCell): ReactNode {
  if (cell.kind === 'missing') {
    return <span className="wts-cell wts-cell-missing">?</span>;
  }
  if (cell.kind === 'noValue') {
    return <span className="wts-cell wts-cell-noValue">—</span>;
  }
  return (
    <span className="wts-quantity-cell">
      {cell.text}
      {cell.condition !== null && (
        <small className="wts-quantity-condition">{cell.condition}</small>
      )}
    </span>
  );
}

export interface WarningTimeSeriesContentProps {
  readonly response: WarningTimeseriesResponse;
  readonly table: RiskTable | null;
}

export function WarningTimeSeriesContent({ response, table }: WarningTimeSeriesContentProps) {
  const [open, setOpen] = useState(false);
  const scrollContainer = useDetailDialogScrollContainer();
  const data = response.data;
  const message = resolveWarningTimeSeriesPanelMessage(table);

  return (
    <div className="wts-panel">
      {message !== null && <p className="wts-panel-message">{message}</p>}
      {table !== null && table.visibleRows.length > 0 && (
        <div className="wts-panel-table">
          <DetailTimeSeriesTable
            caption="警報等時系列"
            columns={table.columns.map((column) => ({
              key: column.key,
              at: column.timeFrom,
              timeLabel: column.label,
            }))}
            rows={table.visibleRows.map((row): TimeSeriesRow => ({
              key: row.key,
              header: row.label,
              cells: row.cells.map((cell, index) => ({
                key: `${row.key}-${index}`,
                content: renderRiskCellContent(cell, table.columns[index]?.label ?? ''),
              })),
            }))}
            initialColumnKey={table.currentColumnKey ?? undefined}
          />
        </div>
      )}
      <GbButton color="text" size="sm" onClick={() => setOpen(true)}>
        詳細
      </GbButton>
      {data !== null && (
        <DetailDialog
          open={open}
          meta={{
            title: '警報等時系列',
            target: resolvePanelTarget(response.venueId, 'warningTimeSeries') ?? null,
            time: { kind: 'issued', value: response.metadata.issuedAt },
            isTraining: response.isTraining,
          }}
          onClose={() => setOpen(false)}
          scrollContainer={scrollContainer}
        >
          <WarningTimeSeriesDetail data={data} table={table} />
        </DetailDialog>
      )}
    </div>
  );
}
