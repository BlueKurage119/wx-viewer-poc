/**
 * 警報等時系列パネル本文 (G4 #55 §4.2〜§4.4、UI監修反映版)。
 *
 * パネル本体は3列窓(現在を含む時間帯とその先2コマ)の単純な `<table>` とする
 * (`DetailTimeSeriesTable` には日付行があり `apps/web/src/map/detail/**` は変更禁止のため使わない)。
 * セルの色・文字付与ロジックは model 側で確定済み。ここでは表示区分→クラス名/文字の
 * 対応付けだけを行う(製造裁量の内部関数分割)。
 */
import { useState, type ReactNode } from 'react';
import type { WarningTimeseriesResponse } from '@wx-viewer-poc/shared';
import { GbButton } from '../../../components/md';
import { DetailDialog } from '../../detail/DetailDialog';
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

/**
 * 危険度セルの表示内容(パネル本体・詳細で共用)。
 * 文字の無いセルも同じ大きさで表示する(§2.1-14、CSS側で固定寸法を与える)。
 */
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

/** 量的予想セルの表示内容(基準blockの行・別欄で共用)。値なしは空白(§2.1-17)。 */
// eslint-disable-next-line react-refresh/only-export-components
export function renderQuantityCellContent(cell: DetailCell): ReactNode {
  if (cell.kind === 'missing') {
    return <span className="wts-cell wts-cell-missing">?</span>;
  }
  if (cell.kind === 'noValue') {
    return <span className="wts-cell wts-cell-noValue" aria-label="値なし" />;
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
  const showTable = table !== null && table.visibleRows.length > 0;

  return (
    <div className="wts-panel">
      {message !== null && <p className="wts-panel-message">{message}</p>}
      {showTable && table !== null && (
        <table className="wts-panel-table">
          <caption className="wts-visually-hidden">警報等時系列</caption>
          <thead>
            <tr>
              <th scope="col" />
              {table.panelColumns.map((column) => (
                <th key={column.key} scope="col">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.visibleRows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                {row.cells.map((cell, index) => (
                  <td key={`${row.key}-${index}`}>
                    {renderRiskCellContent(cell, table.panelColumns[index]?.label ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
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
