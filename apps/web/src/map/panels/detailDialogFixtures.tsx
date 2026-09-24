/**
 * 詳細ダイアログの仮の入口とサンプル表 (G10 §6)。
 *
 * G4〜G6で置き換える前提の仮実装であり、本番導線ではない。
 * `?panelFixture=all-content` 限定で「警報等時系列」「地域時系列予報」のダミー本文に
 * 「詳細（仮）」ボタンを追加する。本番ビルドではフィクスチャ自体が無効のため入口も出ない。
 */
import { useState } from 'react';
import { GbButton } from '../../components/md';
import { DetailDialog } from '../detail/DetailDialog';
import {
  DetailTimeSeriesTable,
  type TimeSeriesColumn,
  type TimeSeriesRow,
} from '../detail/DetailTimeSeriesTable';
import type { DetailDialogMeta } from '../detail/detailDialogMeta';
import { useDetailDialogScrollContainer } from '../detail/DetailDialogScrollContainerContext';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 「今日 0:00 JST」から `offsetHours` 時間後の ISO8601 を返す */
function todayJstPlusHours(offsetHours: number): string {
  const now = new Date();
  const jstMs = now.getTime() + JST_OFFSET_MS;
  const jst = new Date(jstMs);
  jst.setUTCHours(0, 0, 0, 0);
  const targetJstMs = jst.getTime() + offsetHours * 60 * 60 * 1000;
  return new Date(targetJstMs - JST_OFFSET_MS).toISOString();
}

function buildThreeHourColumns(count: number): readonly TimeSeriesColumn[] {
  return Array.from({ length: count }, (_, index) => {
    const startHour = index * 3;
    const endHour = startHour + 3;
    return {
      key: `c${index}`,
      at: todayJstPlusHours(startHour),
      timeLabel: `${startHour % 24}-${endHour % 24 === 0 ? 24 : endHour % 24}時`,
    };
  });
}

// 警報等時系列（サンプル）: 行5（大雨・洪水・暴風・波浪・高潮）、3時間区切り32列（4日分）
// 列数はAC-7の初期位置合わせ（§6設計根拠）のため、FHDでも必要列数(25)を満たすよう定めた値。減らさないこと。
const WARNING_TIME_SERIES_COLUMNS = buildThreeHourColumns(32);
const WARNING_LEVEL_SAMPLE = ['－', '注意報', '警報'] as const;

const WARNING_TIME_SERIES_ROWS: readonly TimeSeriesRow[] = (
  ['大雨', '洪水', '暴風', '波浪', '高潮'] as const
).map((label, rowIndex) => ({
  key: label,
  header: label,
  cells: WARNING_TIME_SERIES_COLUMNS.map((column, columnIndex) => ({
    key: column.key,
    content: WARNING_LEVEL_SAMPLE[(rowIndex + columnIndex) % WARNING_LEVEL_SAMPLE.length],
  })),
}));

const WARNING_TIME_SERIES_META: DetailDialogMeta = {
  title: '警報等時系列（サンプル）',
  target: '江東区',
  time: { kind: 'issued', value: todayJstPlusHours(-1) },
  isTraining: false,
};

// 地域時系列予報（サンプル）: 行3（天気・風・気温）、列24（3日分）
const AREA_FORECAST_COLUMNS = buildThreeHourColumns(24);
const WEATHER_SAMPLE = ['晴れ', 'くもり', '雨'] as const;
const WIND_SAMPLE = ['北の風', '南の風', '西の風'] as const;

const AREA_FORECAST_ROWS: readonly TimeSeriesRow[] = [
  {
    key: 'weather',
    header: '天気',
    cells: Array.from({ length: AREA_FORECAST_COLUMNS.length / 2 }, (_, pairIndex) => ({
      key: `weather-${pairIndex}`,
      span: 2,
      content: WEATHER_SAMPLE[pairIndex % WEATHER_SAMPLE.length],
    })),
  },
  {
    key: 'wind',
    header: '風',
    cells: Array.from({ length: AREA_FORECAST_COLUMNS.length / 2 }, (_, pairIndex) => ({
      key: `wind-${pairIndex}`,
      span: 2,
      content: WIND_SAMPLE[pairIndex % WIND_SAMPLE.length],
    })),
  },
  {
    key: 'temperature',
    header: '気温',
    cells: AREA_FORECAST_COLUMNS.map((column, index) => ({
      key: column.key,
      content: `${20 + (index % 10)}℃`,
    })),
  },
];

const AREA_FORECAST_META: DetailDialogMeta = {
  title: '地域時系列予報（サンプル）',
  target: null,
  time: { kind: 'issued', value: null },
  isTraining: true,
};

// AC-8: 全viewport（本文領域が最も高い1920×1080を含む）で本文領域の
// scrollHeight − clientHeight ≥ 200px となるだけの段落数。2行以上の段落を40個並べる
// （§6設計根拠: 目安30個以上に余裕を持たせた値）。
const SCROLL_HINT_PARAGRAPH_COUNT = 40;

function ScrollHintParagraph() {
  return (
    <>
      <p className="detail-dialog-fixture-scroll-hint">
        これは仮の入口のダミー本文です（本文領域の縦スクロール確認用の段落）。G4〜G6でこの入口は本物のパネル中身に置き換えられます。
      </p>
      {Array.from({ length: SCROLL_HINT_PARAGRAPH_COUNT }, (_, index) => (
        <p key={index} className="detail-dialog-fixture-scroll-hint">
          ダミー本文ダミー本文ダミー本文ダミー本文ダミー本文ダミー本文ダミー本文ダミー本文ダミー本文ダミー本文ダミー本文ダミー本文
          ダミー本文ダミー本文ダミー本文ダミー本文ダミー本文ダミー本文ダミー本文ダミー本文ダミー本文ダミー本文ダミー本文ダミー本文
        </p>
      ))}
    </>
  );
}

/** G4で置き換える前提の「詳細（仮）」入口（警報等時系列サンプル） */
export function WarningTimeSeriesDetailFixtureEntry() {
  const [open, setOpen] = useState(false);
  const scrollContainer = useDetailDialogScrollContainer();

  return (
    <>
      <GbButton color="text" size="sm" onClick={() => setOpen(true)}>
        詳細（仮）
      </GbButton>
      <DetailDialog
        open={open}
        meta={WARNING_TIME_SERIES_META}
        onClose={() => setOpen(false)}
        scrollContainer={scrollContainer}
      >
        <ScrollHintParagraph />
        <DetailTimeSeriesTable
          caption="警報等時系列（サンプル）"
          rowHeaderLabel="種別"
          columns={WARNING_TIME_SERIES_COLUMNS}
          rows={WARNING_TIME_SERIES_ROWS}
          initialColumnKey={WARNING_TIME_SERIES_COLUMNS[2]?.key}
        />
      </DetailDialog>
    </>
  );
}

/** G6で置き換える前提の「詳細（仮）」入口（地域時系列予報サンプル） */
export function AreaForecastDetailFixtureEntry() {
  const [open, setOpen] = useState(false);
  const scrollContainer = useDetailDialogScrollContainer();

  return (
    <>
      <GbButton color="text" size="sm" onClick={() => setOpen(true)}>
        詳細（仮）
      </GbButton>
      <DetailDialog
        open={open}
        meta={AREA_FORECAST_META}
        onClose={() => setOpen(false)}
        scrollContainer={scrollContainer}
      >
        <p className="detail-dialog-fixture-scroll-hint">
          これは仮の入口のダミー本文です。G6でこの入口は本物のパネル中身に置き換えられます。
        </p>
        <DetailTimeSeriesTable
          caption="地域時系列予報（サンプル）"
          rowHeaderLabel="要素"
          columns={AREA_FORECAST_COLUMNS}
          rows={AREA_FORECAST_ROWS}
        />
      </DetailDialog>
    </>
  );
}
