import { useState } from 'react';
import type { AreaTimeseriesResponse } from '@wx-viewer-poc/shared';
import { GbButton } from '../../../components/md';
import { DetailDialog } from '../../detail/DetailDialog';
import { DetailTimeSeriesTable, type TimeSeriesRow } from '../../detail/DetailTimeSeriesTable';
import { useDetailDialogScrollContainer } from '../../detail/DetailDialogScrollContainerContext';
import {
  buildAreaForecastModel,
  selectPanelColumns,
  resolveAreaForecastTargets,
  formatWeatherAriaLabel,
  formatWindAriaLabel,
  formatTemperatureAriaLabel,
  formatIntervalRangeJst,
  toJstHour,
  toJstEndHour,
  type AreaForecastColumn,
  type AreaForecastTableModel,
  type IntervalCell,
  type PointCell,
} from './areaForecastModel';
import { useFontLoading, type FontLoadingStatus } from './useFontLoading';

if (typeof window !== 'undefined' && typeof process === 'undefined') {
  void import('./areaForecast.css');
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
  const showArrow = direction.kind === 'text' && direction.rotation !== null;
  const rotation = direction.kind === 'text' ? (direction.rotation ?? 0) : 0;
  const showFill = level.kind === 'known';
  const showOutline = showArrow;

  const dirText = direction.kind === 'text' ? direction.text : '';

  let rangeText = '';
  if (level.kind === 'known') {
    rangeText = level.rangeLabel;
  } else if (level.kind === 'unknown') {
    rangeText = level.raw;
  }

  return (
    <div className="af-cell-wind" aria-label={ariaLabel}>
      <div className="af-wind-top">
        <span className="af-wind-arrow-box" aria-hidden="true">
          {showArrow && (
            <>
              {showFill && (
                <span
                  className="af-wind-layer af-wind-fill"
                  style={{
                    color: level.colorVar,
                    transform: `rotate(${rotation}deg)`,
                    visibility:
                      fontStatus.outlinedReady && fontStatus.sharpReady ? 'visible' : 'hidden',
                  }}
                >
                  navigation
                </span>
              )}
              {showOutline && (
                <span
                  className="af-wind-layer af-wind-outline"
                  style={{
                    transform: `rotate(${rotation}deg)`,
                    visibility: fontStatus.outlinedReady ? 'visible' : 'hidden',
                  }}
                >
                  navigation
                </span>
              )}
            </>
          )}
        </span>
        {dirText && <span className="af-wind-dir-text">{dirText}</span>}
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

/** パネル専用表ビュー (最大3列表示) */
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
      <table className="af-table">
        <caption className="af-visually-hidden">地域時系列予報</caption>
        <thead>
          <tr>
            <th scope="col" aria-label="時間帯" />
            {columns.map((col) => (
              <th scope="col" key={`interval-${col.key}`}>
                {col.intervalLabel ?? ''}
              </th>
            ))}
          </tr>
          <tr>
            <th scope="col" aria-label="時刻" />
            {columns.map((col) => (
              <th scope="col" key={`point-${col.key}`}>
                {col.pointLabel ?? ''}
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

/** 詳細ダイアログ (全区間・全時点を横スクロール) */
export function AreaForecastDetail({
  table,
  now,
  fontStatus,
}: {
  readonly table: AreaForecastTableModel;
  readonly now: number;
  readonly fontStatus: FontLoadingStatus;
}) {
  if (table.columns.length === 0) {
    return <p className="af-message">発表された値はありません</p>;
  }

  const columns = table.columns.map((col) => ({
    key: col.key,
    at: col.at,
    timeLabel: col.pointLabel ?? '',
    ariaTimeLabel: col.pointLabel ?? '',
    width: '4rem',
  }));

  const intervalHeaderCells = table.intervals.map((int, index) => {
    if (int.kind === 'none') {
      return {
        key: `int-none-${index}`,
        label: '',
        span: int.span,
        ariaLabel: '対象外',
      };
    }
    const fromHour = toJstHour(int.timeFrom);
    const toHour = toJstEndHour(int.timeFrom, int.timeTo);
    return {
      key: `int-${int.timeFrom}`,
      label: `${fromHour}-${toHour}時`,
      span: int.span,
      ariaLabel: formatIntervalRangeJst(int.timeFrom, int.timeTo),
    };
  });

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

  const tempRowCells = table.points.map((pt, i) => {
    const col = table.columns[i]!;
    return {
      key: `temp-pt-${i}`,
      span: 1,
      content: <TemperatureCellView point={pt} column={col} />,
    };
  });

  const rows: readonly TimeSeriesRow[] = [
    { key: 'weather', header: '天気', cells: weatherRowCells },
    { key: 'wind', header: '風（m/s）', cells: windRowCells },
    { key: 'temperature', header: '気温', cells: tempRowCells },
  ];

  const panelCols = selectPanelColumns(table.columns, table.intervals, now);
  const initialColumnKey = panelCols[0]?.key ?? table.columns[0]?.key;

  return (
    <DetailTimeSeriesTable
      caption="地域時系列予報の全期間"
      rowHeaderLabel="日（曜日）"
      dateHeaderMode="day-weekday-on-change"
      cornerLabels={{ date: '日（曜日）', interval: '時間帯', time: '時刻' }}
      columns={columns}
      intervalHeaderCells={intervalHeaderCells}
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
  const targets = resolveAreaForecastTargets(response.area, response.data.station);

  if (model.kind === 'invalid') {
    return (
      <div className="af-panel">
        <div className="af-target-block">
          <p className="af-target-line">{targets.weatherWindTarget}</p>
          <p className="af-target-line">{targets.temperatureTarget}</p>
        </div>
        <p className="af-message">表示できない予報形式です</p>
      </div>
    );
  }

  const panelColumns = selectPanelColumns(model.columns, model.intervals, now);

  return (
    <div className="af-panel">
      <div className="af-target-block">
        <p className="af-target-line">{targets.weatherWindTarget}</p>
        <p className="af-target-line">{targets.temperatureTarget}</p>
      </div>
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

  if (response.data === null || response.metadata.availability === 'unavailable') {
    return <p className="af-message">取得できませんでした</p>;
  }

  const model = buildAreaForecastModel(response.data);
  const targets = resolveAreaForecastTargets(response.area, response.data.station);

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
            target: targets.detailDialogTarget,
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
