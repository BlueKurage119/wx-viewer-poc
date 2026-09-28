import { useMemo, useState } from 'react';
import type { AreaTimeseriesResponse } from '@wx-viewer-poc/shared';
import { GbButton } from '../../../components/md';
import { DetailDialog } from '../../detail/DetailDialog';
import { DetailTimeSeriesTable, type TimeSeriesRow } from '../../detail/DetailTimeSeriesTable';
import { useDetailDialogScrollContainer } from '../../detail/DetailDialogScrollContainerContext';
import {
  buildAreaForecastModel,
  selectPanelColumns,
  resolveAreaForecastTarget,
  formatWeatherAriaLabel,
  formatWindAriaLabel,
  formatTemperatureAriaLabel,
  formatColumnAriaLabel,
  type AreaForecastColumn,
  type AreaForecastTableModel,
  type DirView,
  type IntervalCell,
  type PointCell,
} from './areaForecastModel';
import type { LevelView } from './windSpeedLevel';
import { useFontLoading, type FontLoadingStatus } from './useFontLoading';
import { TemperatureChart, TemperatureChartHeader } from './TemperatureChart.jsx';
import { calculateTemperatureRange } from './temperatureChart';

/** 風向の矢羽根枠(24×24px固定)。矢羽根(塗り1層)／漢字代替／「ー」／「?」のいずれか1つだけを枠内に表示する
 * (§4.1a、§7、確定事項13: 風向の漢字は画面から消し aria-label にのみ残す)。 */
function WindArrowBox({
  direction,
  level,
  fontStatus,
}: {
  readonly direction: DirView;
  readonly level: LevelView;
  readonly fontStatus: FontLoadingStatus;
}) {
  if (direction.kind === 'missing') {
    return (
      <span className="af-wind-arrow-box" aria-hidden="true">
        <span className="wts-cell-missing">?</span>
      </span>
    );
  }
  if (direction.kind === 'none') {
    return (
      <span className="af-wind-arrow-box" aria-hidden="true">
        <span className="af-wind-none">ー</span>
      </span>
    );
  }

  // 矢羽根の表示可否は塗り用フォント(Sharp)の読込だけで判定する(確定事項18)
  const canShowArrow = direction.rotation !== null && fontStatus.sharpReady;
  if (!canShowArrow) {
    return (
      <span className="af-wind-arrow-box" aria-hidden="true">
        <span className="af-wind-dir-fallback">{direction.text}</span>
      </span>
    );
  }

  // 階級不明・欠測は通常文字色(CSS既定)、既知階級は階級色の塗り1層
  return (
    <span className="af-wind-arrow-box" aria-hidden="true">
      <span
        className="af-wind-layer af-wind-fill"
        style={{
          color: level.kind === 'known' ? level.colorVar : undefined,
          transform: `rotate(${direction.rotation}deg)`,
        }}
      >
        navigation
      </span>
    </span>
  );
}

function WeatherCellView({
  interval,
  column,
  fontStatus,
}: {
  readonly interval: IntervalCell;
  readonly column: AreaForecastColumn;
  readonly fontStatus: FontLoadingStatus;
}) {
  const ariaLabel = formatWeatherAriaLabel(interval, column);
  if (interval.kind === 'none') {
    return <div className="af-cell-weather af-cell-none" aria-label={ariaLabel} />;
  }
  if (interval.weather.kind === 'missing') {
    return (
      <div className="af-cell-weather" aria-label={ariaLabel}>
        <span className="wts-cell-missing" aria-hidden="true">
          ?
        </span>
      </div>
    );
  }

  const { text, icon } = interval.weather;
  return (
    <div className="af-cell-weather" aria-label={ariaLabel} title={text}>
      {icon && (
        <span
          className="af-weather-icon"
          aria-hidden="true"
          style={{ visibility: fontStatus.outlinedReady ? 'visible' : 'hidden' }}
        >
          {icon}
        </span>
      )}
      <span className="af-weather-name">{text}</span>
    </div>
  );
}

function WindCellView({
  interval,
  column,
  fontStatus,
}: {
  readonly interval: IntervalCell;
  readonly column: AreaForecastColumn;
  readonly fontStatus: FontLoadingStatus;
}) {
  const ariaLabel = formatWindAriaLabel(interval, column);
  if (interval.kind === 'none') {
    return <div className="af-cell-wind af-cell-none" aria-label={ariaLabel} />;
  }

  const { direction, level } = interval.wind;

  let rangeText = '';
  if (level.kind === 'known') {
    rangeText = level.rangeLabel;
  } else if (level.kind === 'unknown') {
    rangeText = level.raw;
  }

  return (
    <div className="af-cell-wind" aria-label={ariaLabel}>
      <div className="af-wind-top">
        <WindArrowBox direction={direction} level={level} fontStatus={fontStatus} />
      </div>
      <div className="af-wind-range">
        {level.kind === 'missing' ? (
          <span className="wts-cell-missing" aria-hidden="true">
            ?
          </span>
        ) : (
          rangeText
        )}
      </div>
    </div>
  );
}

function TemperatureCellView({
  point,
  column,
}: {
  readonly point: PointCell;
  readonly column: AreaForecastColumn;
}) {
  const ariaLabel = formatTemperatureAriaLabel(point, column);
  if (point.kind === 'none') {
    return <div className="af-cell-temperature af-cell-none" aria-label={ariaLabel} />;
  }
  if (point.temperature.kind === 'missing') {
    return (
      <div className="af-cell-temperature" aria-label={ariaLabel}>
        <span className="wts-cell-missing" aria-hidden="true">
          ?
        </span>
      </div>
    );
  }
  return (
    <div className="af-cell-temperature" aria-label={ariaLabel}>
      {point.temperature.text}
    </div>
  );
}

/** パネル専用表ビュー (最大3列表示、時点1段見出し、確定事項12) */
function AreaForecastPanelTable({
  table,
  columns,
  fontStatus,
}: {
  readonly table: AreaForecastTableModel;
  readonly columns: readonly AreaForecastColumn[];
  readonly fontStatus: FontLoadingStatus;
}) {
  if (columns.length === 0) {
    return <p className="af-message">表示できる時間帯はありません</p>;
  }

  // 選択された列に対応する区間・時点セルを抽出
  const selectedIndices = columns.map((c) => table.columns.findIndex((col) => col.key === c.key));

  return (
    <div className="af-panel-table" role="region" aria-label="地域時系列予報" tabIndex={0}>
      <table
        className="af-table"
        style={{ minInlineSize: `calc(3rem + ${columns.length * 4}rem)` }}
      >
        <caption className="af-visually-hidden">地域時系列予報</caption>
        <thead>
          <tr>
            <th scope="col" aria-label="時刻" />
            {columns.map((col) => (
              <th scope="col" key={col.key} aria-label={formatColumnAriaLabel(col)}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">天気</th>
            {selectedIndices.map((colIdx, i) => {
              const col = columns[i]!;
              const interval = table.intervals.find(
                (int) => colIdx >= int.startIndex && colIdx < int.startIndex + int.span,
              ) ?? { kind: 'none' as const, startIndex: colIdx, span: 1 };
              return (
                <td key={`weather-${col.key}`}>
                  <WeatherCellView interval={interval} column={col} fontStatus={fontStatus} />
                </td>
              );
            })}
          </tr>
          <tr>
            <th scope="row">風（m/s）</th>
            {selectedIndices.map((colIdx, i) => {
              const col = columns[i]!;
              const interval = table.intervals.find(
                (int) => colIdx >= int.startIndex && colIdx < int.startIndex + int.span,
              ) ?? { kind: 'none' as const, startIndex: colIdx, span: 1 };
              return (
                <td key={`wind-${col.key}`}>
                  <WindCellView interval={interval} column={col} fontStatus={fontStatus} />
                </td>
              );
            })}
          </tr>
          <tr>
            <th scope="row">気温</th>
            {selectedIndices.map((colIdx, i) => {
              const col = columns[i]!;
              const point = table.points[colIdx] ?? { kind: 'none' as const, index: colIdx };
              return (
                <td key={`temp-${col.key}`}>
                  <TemperatureCellView point={point} column={col} />
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** 詳細ダイアログ (全区間・全時点を横スクロール、日付＋時点の2段見出し) */
export function AreaForecastDetail({
  table,
  now,
  fontStatus,
}: {
  readonly table: AreaForecastTableModel;
  readonly now: number;
  readonly fontStatus: FontLoadingStatus;
}) {
  // 共用部品は columns の変化で初期列へスクロールし直すため、毎秒の再描画で配列を作り直さない
  const columns = useMemo(
    () =>
      table.columns.map((col) => ({
        key: col.key,
        at: col.at,
        timeLabel: col.label,
        ariaTimeLabel: col.label,
        width: '4rem',
      })),
    [table.columns],
  );

  const tempValues = useMemo(
    () =>
      table.columns.map((_, i) => {
        const pt = table.points[i];
        if (!pt || pt.kind !== 'value') return null;
        if (pt.temperature.kind !== 'value') return null;
        return pt.temperature.value;
      }),
    [table.columns, table.points],
  );
  const tempRange = useMemo(() => calculateTemperatureRange(tempValues), [tempValues]);

  if (table.columns.length === 0) {
    return <p className="af-message">発表された値はありません</p>;
  }

  const weatherRowCells = table.intervals.map((int, i) => {
    const col = table.columns[int.startIndex]!;
    return {
      key: `weather-int-${i}`,
      span: int.span,
      content: <WeatherCellView interval={int} column={col} fontStatus={fontStatus} />,
    };
  });

  const windRowCells = table.intervals.map((int, i) => {
    const col = table.columns[int.startIndex]!;
    return {
      key: `wind-int-${i}`,
      span: int.span,
      content: <WindCellView interval={int} column={col} fontStatus={fontStatus} />,
    };
  });

  const tempRowCells = [
    {
      key: 'temp-chart-cell',
      span: table.columns.length,
      content: (
        <TemperatureChart
          points={table.points}
          columns={table.columns}
          columnWidths={columns.map((c) => c.width)}
        />
      ),
    },
  ];

  const rows: readonly TimeSeriesRow[] = [
    { key: 'weather', header: '天気', cells: weatherRowCells },
    { key: 'wind', header: '風（m/s）', cells: windRowCells },
    {
      key: 'temperature',
      header: <TemperatureChartHeader range={tempRange} />,
      cells: tempRowCells,
    },
  ];

  const panelCols = selectPanelColumns(table.columns, table.intervals, now);
  const initialColumnKey = panelCols[0]?.key ?? table.columns[0]?.key;

  return (
    <DetailTimeSeriesTable
      caption="地域時系列予報の全期間"
      rowHeaderLabel="日（曜日）"
      dateHeaderMode="day-weekday-on-change"
      cornerLabels={{ date: '日（曜日）', time: '時刻' }}
      columns={columns}
      rows={rows}
      initialColumnKey={initialColumnKey}
      stickyHeader
      bodyDateBoundaries
    />
  );
}

export function AreaForecastPanel({
  response,
  now,
  fontStatus,
  onOpenDetail,
}: {
  readonly response: AreaTimeseriesResponse;
  readonly now: number;
  readonly fontStatus: FontLoadingStatus;
  readonly onOpenDetail?: () => void;
}) {
  if (response.data === null || response.metadata.availability === 'unavailable') {
    return <p className="af-message">取得できませんでした</p>;
  }

  const model = buildAreaForecastModel(response.data);

  if (model.kind === 'invalid') {
    return (
      <div className="af-panel">
        <p className="af-message">表示できない予報形式です</p>
      </div>
    );
  }

  const panelColumns = selectPanelColumns(model.columns, model.intervals, now);

  return (
    <div className="af-panel">
      <AreaForecastPanelTable table={model} columns={panelColumns} fontStatus={fontStatus} />
      {onOpenDetail && (
        <GbButton color="text" size="sm" onClick={onOpenDetail}>
          詳細
        </GbButton>
      )}
    </div>
  );
}

export function AreaForecastContent({
  response,
  now,
}: {
  readonly response: AreaTimeseriesResponse;
  readonly now: number;
}) {
  const [open, setOpen] = useState(false);
  const scrollContainer = useDetailDialogScrollContainer();
  const fontStatus = useFontLoading();
  // 毎秒の now 更新で表モデル(列配列)を作り直すと、詳細表が初期列へスクロールし直してしまう
  const model = useMemo(
    () => (response.data === null ? null : buildAreaForecastModel(response.data)),
    [response.data],
  );

  if (
    response.data === null ||
    model === null ||
    response.metadata.availability === 'unavailable'
  ) {
    return <p className="af-message">取得できませんでした</p>;
  }

  const target = resolveAreaForecastTarget(response.area, response.data.station);

  return (
    <>
      <AreaForecastPanel
        response={response}
        now={now}
        fontStatus={fontStatus}
        onOpenDetail={() => setOpen(true)}
      />
      {model.kind !== 'invalid' && (
        <DetailDialog
          open={open}
          meta={{
            title: '地域時系列予報',
            target,
            time: { kind: 'issued', value: response.metadata.issuedAt },
            isTraining: response.isTraining,
          }}
          onClose={() => setOpen(false)}
          scrollContainer={scrollContainer}
        >
          <div className="wts-detail af-detail">
            <AreaForecastDetail table={model} now={now} fontStatus={fontStatus} />
          </div>
        </DetailDialog>
      )}
    </>
  );
}
