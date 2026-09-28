# Issue #58 G7. 地域時系列予報パネル / Issue #59 G8. 天気アイコン対応表 設計書

## 1. 目的・範囲

`GET /api/weather/area-timeseries`（E4 #36）の保存済み3時間ブロックを、情報パネル「地域時系列予報」（`panelDefinitions.ts` の `areaForecast`）とその詳細ダイアログに結線する。#59 の天気アイコン対応表は本パネル専用の固定表として同時に実装する（2026-09-28 ユーザー決定により設計書1本・ブランチ1本）。製造ブランチの想定名は `feature/issue-58-59-area-forecast-panel`。

表示対象は次の2ブロックだけとする。

| blockId | 要素 | 性質 |
| --- | --- | --- |
| `region-3hour` | `weather`（3時間内卓越天気）、`wind_direction`、`wind_speed_rank` | 3時間区間値 |
| `temperature-3hour` | `temperature`（3時間毎気温） | 時点値 |

対象外（変更しない）: parser・DB・API・共通 DTO（`packages/shared`）、VPFD51 の日別天気・天気コード・6時間降水確率・朝の最低／日中の最高気温、他パネルの表示、`docs/basic-design.md`（§12 の追記案を示すだけ）。

## 2. 根拠と確定判断

### 2.1 参照資料

- [基本設計](../basic-design.md) §5.11（画面表記・表の構成・風速表示は【確定】、天気アイコンは【設計案・検討中】）、§5.13（【設計案・未確定】）
- [#16 設計](issue-16-area-time-series-forecast.md) §「保存方法」: 天気は `valueText`、風向は `valueText`＋`unit`、風速階級は `valueCode`（`valueNumber` は null）、気温は `valueText`＋`unit`＋`valueNumber`
- [#36 設計](issue-36-timeseries-amedas-bosai-rest-apis.md) §3.4: `AreaTimeseriesResponse`、`capabilities.unsupportedFields = ['weatherCode','windSpeedRange','windSpeedDescription']`
- [#56 設計](issue-56-early-warning-panel.md): パネル3コマ・詳細ダイアログ・開発フィクスチャ・stale 表示・fetch 抑止テストの流儀。実装は `apps/web/src/map/panels/earlyWarning/`（パネルは専用 `<table className="ew-table">`、詳細は `EarlyWarningContent.tsx` 内の `DetailDialog`＋`DetailTimeSeriesTable`）
- [棚卸し](../audit-epic-a-d.md) AD-H046 / AD-H050 / AD-H051
- 型: `packages/shared/src/weatherApi.ts` の `AreaTimeseriesResponse`、`AreaTimeseriesTimeDefineDto`、`AreaTimeseriesValueDto`
- 色: `apps/web/src/theme/weatherDataColors.css` の `--wx-data-nowcast-1`〜`8`、`officialJmaColors.css`
- 実電文: [VPFD51 提供サンプル6本](../../../docs/260907_weather-data/jmaxml_20260723_Samples/)（`24_11_0[1-3]_190925_VPFD51.xml`、`24_12_0[1-3]_190925_VPFD51.xml`）
- 公式資料: [府県天気予報（Ｒ１）XML の解説（令和2年10月1日）](<../../../docs/260907_weather-data/jmaxml_20260826_Manual(pdf)/>) の「府県天気予報，地域時系列予報」フォルダ内 ※４－１－１(1)〜(3)・※５－１－１、および同フォルダの旧版解説資料（平成23年11月25日）

### 2.2 ユーザー確定事項（2026-09-28）

1. #58・#59 は設計書1本・ブランチ1本。
2. 表示は保存済み3時間ブロックのみ。日別天気・6時間降水確率・最高/最低気温は表示せず、parser・DB・API も変更しない。最高・最低気温は「3時間気温で概ね代替でき費用に見合わない」ため見送り、将来課題とする（熱中症関連は別途将来拡張）。
3. 天気アイコンは3時間区間の天気文字から Material Symbols への固定対応表で引く。表にない文字は文字だけで表示する。天気コードは使わない。
4. 風速階級→m/s 範囲の固定表をフロントに持つ（1:0〜2、2:3〜5、3:6〜9、4:10〜14、5:15〜19、6:20以上）。実数変換・補間はしない。
5. 画面表記「天気・風：東京地方」「気温：東京（北の丸公園）」は確定（基本設計 §5.11）。
6. 混在系の天気文字「雨または雪」「雨か雪」「雪か雨」は3語とも `rainy_snow` を割り当てる。
7. 詳細ダイアログを本 Issue で作る。ダイアログは過去を含む全区間・全時点を横スクロールで表示する。パネルは #56 と同じく現在を含む区間から3列だけ表示し、横スクロールしない。これは基本設計 §5.11「全区間・横スクロール」のパネルにおける例外であり、全期間の閲覧は詳細ダイアログで満たす。
8. 風速階級の色は新設トークンを作らず、雨雲ナウキャスト凡例のデータ色 `var(--wx-data-nowcast-N)` を転用する（気象庁HPの流儀）。階級1→nowcast-1、2→2、3→4、4→5（黄）、5→6（橙）、6→7（赤）。
9. 列見出しは日付行の下に区間行「9-12時」と時点行「9時」の2段とする。9時の気温は 9-12時の列（区間の開始側）に置く。
10. 風速表示はセル背景を塗らず、色は矢羽根に付ける。矢羽根は Material Symbols の `navigation`（24px 相当）で、塗りつぶし版（FILL=1、`color: var(--wx-data-nowcast-N)`）の上に既存 Outlined（FILL=0）の輪郭版を通常の文字色トークンで重ねる。回転は `classifyWindDirection` を流用。m/s 範囲の文字は通常の文字色トークン（テーマ追従）。既存 Outlined の読み込みは変えず、塗りつぶし版は別ファミリを `icon_names=navigation` でサブセットして追加する。コントラストは「輪郭と背景で 3:1 以上」（非テキスト）をライト/ダーク両方で検証し、塗り色は要件にしない。別ファミリとの形状のずれは確認・記録し、問題なら UI 監修で検討する。

### 2.3 実物調査の結果

**風速階級（確定）**: サンプル6本の `WindSpeedLevel` 全288件の `range` / `description` は、階級1=`0 2`、2=`3 5`、3=`6 9`、4=`10 14`、5=`15 19`、6=`20 INF`（毎秒２０メートル以上）で例外なし。Ｒ１解説資料 ※４－１－１(3) も「風のレベル値は１～６」とし、同じ6段の range を例示している。確定事項4の固定表は実電文・公式資料の双方と一致する。なお**旧版解説資料（平成23年）は「１～４」、4=`10 INF`（毎秒１０メートル以上）**としており、令和2年のＲ１改訂で6段階になった。本設計は現行のＲ１を根拠とし、`'1'`〜`'6'` 以外の値は範囲表に当てはめない（§3.4）。

**天気語彙**: Ｒ１解説資料 ※４－１－１(1) は3時間内卓越天気を「晴れ」「くもり」「雨」「雪」「雨または雪」の5種類とする。サンプル6本の `region-3hour` に現れた語は「晴れ」「くもり」「雨」「雪か雨」「雨か雪」で、「雨または雪」は無く、資料に無い「雪か雨」「雨か雪」が現れる。辞書（`jmaxml_20260129_dictionary.xlsx`）・コード表（`jmaxml_20260826_code.xlsx`）に語彙の列挙は無い。対応表は資料5語＋実電文2語の計7語を載せる（確定事項6）。

**Material Symbols（確定）**: `apps/web/index.html` は Google Fonts から `Material+Symbols+Outlined` を `icon_names` 指定なし・FILL=0 固定で読み込んでおり、全グリフの輪郭版が利用可能。Material Design Icons 公式リポジトリの `MaterialSymbolsOutlined[FILL,GRAD,opsz,wght].codepoints`（2026-09-28 取得）で `sunny`(e81a)、`cloud`(f15c)、`rainy`(f176)、`weather_snowy`(e2cd)、`rainy_snow`(f61d)、`navigation`(e55d) の存在を確認した。フォントは CDN 配信で JS バンドルに含まれない。塗りつぶしの `navigation` は別ファミリの1文字サブセットで追加する（§5.2、読み込み量は AC-15 で記録）。フォントが読み込めない環境の扱いは §5.3。

**風向（確定）**: サンプルの `WindDirection` は `unit="８方位漢字"` で8語のみ。#55 の `classifyWindDirection()`（`warningTimeSeriesModel.ts`、風下を指す `navigation` の回転角）をそのまま再利用する。`condition="やや強く"` 等の属性は #16 で保存していないため表示しない。

**時間軸（確定）**: サンプル `24_11_01` では `region-3hour` が 23日06:00 起点 `PT3H` ×14区間（24日 21-24時まで）、`temperature-3hour` が 23日06:00〜25日00:00 の15時点。最後の時点（25日0時）には開始側の区間が無い。

**データ色（確定）**: `weatherDataColors.css` の nowcast トークンは `:root` 固定値で、ライト/ダークで同じ値（データ色のため、06 業務標準の例外規定どおり）。矢羽根の塗りに転用する6色は `-1`・`-2`・`-4`・`-5`・`-6`・`-7`（`-7` は `var(--wx-jma-hue-red)`）。塗り色は形の判別を担わない（輪郭が担う）ため、塗り色自体のコントラストは要件にしない（確定事項10）。

## 3. データモデル

### 3.1 モジュール構成

新設ディレクトリ `apps/web/src/map/panels/areaForecast/`:

| ファイル | 内容 |
| --- | --- |
| `areaForecastModel.ts` | DTO → 表モデル変換、パネル3列の選択（純関数） |
| `weatherIconMap.ts` | #59 天気文字→Material Symbols 固定表（§3.3） |
| `windSpeedLevel.ts` | 風速階級→m/s 範囲・色トークンの固定表（§3.4、§5） |
| `AreaForecastContent.tsx` | パネル本文・詳細ダイアログ（`EarlyWarningContent.tsx` と同形） |
| `areaForecast.css` | 本パネル限定スタイル |
| `useAreaForecast.tsx` | 取得・カード組立（`useEarlyWarning` と同形、`buildAreaForecastCard` を export） |
| `areaForecastFixture.ts` / `areaForecastFixtureGate.ts` | 開発フィクスチャ（§6） |

加えて `apps/web/src/api/areaForecast.ts`（`fetchAreaForecast`、`fetchEarlyWarning` と同形で `path: '/api/weather/area-timeseries'`）、`apps/web/src/map/detail/DetailTimeSeriesTable.tsx`（§4.3 の任意の中段見出し）、`apps/web/index.html`（塗りつぶし矢羽根用フォントの `<link>` 1本の追加のみ、§5.2）、`WeatherMapView.tsx`・`panelFixtures.ts` の結線、`apps/web/tests/` の対応テスト。新しい色トークンは作らない。

### 3.2 表モデル

```ts
type AreaForecastColumn = {
  key: string;
  at: UtcIso8601String;          // 列の代表時刻（区間の開始時刻 = 同時刻の時点）
  intervalLabel: string | null;  // 「9-12時」。この列から始まる区間が無ければ null
  pointLabel: string | null;     // 「9時」。この列時刻の気温時点が無ければ null
};
type IntervalCell =
  | { kind: 'value'; startIndex: number; span: number; timeFrom: string; timeTo: string; weather: WeatherView; wind: WindView }
  | { kind: 'none'; startIndex: number; span: number }; // 区間が存在しない列
type PointCell = { kind: 'value'; index: number; at: string; temperature: TemperatureView } | { kind: 'none'; index: number };
type WeatherView = { kind: 'missing' } | { kind: 'text'; text: string; icon: string | null };
type WindView = { direction: DirView; level: LevelView };
type DirView = { kind: 'missing' } | { kind: 'text'; text: string; rotation: number | null };
type LevelView = { kind: 'missing' } | { kind: 'known'; level: 1|2|3|4|5|6; rangeLabel: string } | { kind: 'unknown'; raw: string };
type TemperatureView = { kind: 'missing' } | { kind: 'value'; text: string }; // 例 "12℃"
type AreaForecastModel =
  | { kind: 'table'; columns: AreaForecastColumn[]; intervals: IntervalCell[]; points: PointCell[] }
  | { kind: 'invalid' }; // 区間の重なり等、表として配置できない
```

変換規則（AD-H050）:

1. `timeDefines` を `blockId` ごとに分け、`values` は **同じ `blockId` 内で `refId` と `timeId` を照合**して結合する。配列添字・`sequence`・ブロックをまたぐ ID 一致で結合しない。気温を区間へ、区間値を時点へ補間しない。
2. 列の集合 = `region-3hour` の各 `timeFrom` ∪ `temperature-3hour` の各時刻を昇順で重複除去したもの。
3. 区間セルは `timeFrom` の列から、`timeFrom <= 列時刻 < timeTo` を満たす列の数だけ `span` する。`intervalLabel` は区間の開始列に「{開始時}-{終了時}時」（JST。終了が翌日0時なら `24`、例「21-24時」）で付け、`span` 分の見出しセルを結合する。区間どうしが重なる、または `timeTo <= timeFrom` の区間があれば `{ kind: 'invalid' }`。どの区間にも含まれない列は `kind: 'none'`（連続する列はまとめて1セル）。
4. 時点セルは時刻が一致する列（＝その時刻から始まる区間の列、確定事項9）に置き、`pointLabel` を「{時}時」（JST、`0`〜`21`）とする。最終時点（例 25日0時）は区間の無い列になり、区間行・天気・風は `none`、時点行は「0時」となる。
5. 同じ `blockId`・`refId`・`element` の値が複数あれば推測で選ばず、その要素を `missing` とする。`refId` に対応する `timeDefine` が無い値は捨て、`droppedValueCount` に数える（表示しない、テスト用）。
6. 時刻判定は `now` を一度だけ取得して使う。

パネル3列の選択（#56 §4 と同じ規則）: `timeFrom <= now < timeTo` の区間の開始列を起点に、時間順の次の2列まで最大3列。現在を含む区間が無ければ `now` 以降で最初の列から最大3列。境界 `now = timeTo` は次の区間に属する。対象列が無ければ本文に「表示できる時間帯はありません」と示す。区間が複数列に span する場合、パネルでは選択範囲内の列数だけに切って表示する。

### 3.3 #59 天気アイコン対応表（`weatherIconMap.ts`）

`valueText` との**完全一致**でだけ引く（前後空白の除去・部分一致・正規化はしない）。

| 天気文字 | Material Symbols | 根拠 |
| --- | --- | --- |
| 晴れ | `sunny` | Ｒ１資料・サンプル |
| くもり | `cloud` | Ｒ１資料・サンプル |
| 雨 | `rainy` | Ｒ１資料・サンプル |
| 雪 | `weather_snowy` | Ｒ１資料 |
| 雨または雪 | `rainy_snow` | Ｒ１資料、確定事項6 |
| 雨か雪 | `rainy_snow` | サンプル、確定事項6 |
| 雪か雨 | `rainy_snow` | サンプル、確定事項6 |

表に無い文字・空文字は `icon: null` で原文だけを表示する。`valueText` null は `missing`。アイコンは記号であり、名称は常に原文（例「雪か雨」）を表示するため、3語の文言の違いは失われない。

### 3.4 風速階級（`windSpeedLevel.ts`）

`valueCode` が文字列 `'1'`〜`'6'` に完全一致する場合だけ `known` とし、範囲表記を `0-2`、`3-5`、`6-9`、`10-14`、`15-19`、`20以上` とする（単位 m/s は行見出しに置く）。それ以外（`'0'`、`'7'`、`'4.0'`、全角等）は `unknown` とし原文をそのまま表示、色は付けない。`valueCode` null は `missing`。API の値から範囲を読まない（`unsupportedFields` の `windSpeedRange`）。

### 3.5 気温

`valueNumber` が有限数なら `${valueNumber}℃`（`unit === '度'` の場合。他の unit は `${valueNumber}${unit}`）。`valueNumber` が null で `valueText` があれば `valueText` をそのまま表示。両方 null は `missing`。丸め・補間しない。

## 4. 画面

### 4.1 共通のセル表示

- 行は上から「天気」「風（m/s）」「気温」。
- 天気セル: アイコン（`aria-hidden`）＋名称。文字代替は名称のみ。
- 風セル: 上段に矢羽根（§5.2 の塗り＋輪郭の2層、`aria-hidden`）＋風向文字、下段に範囲表記。セル背景は塗らない。文字は通常の文字色トークン。風向が8方位以外なら矢羽根を省き文字だけ（枠は保持）。unknown 階級・欠測は塗りなしで輪郭だけ。
- 気温セル: 数値＋℃。
- 各セルの `aria-label` は「2026年9月28日（月）9時から12時、くもり」「…、北西の風、毎秒3から5メートル」「2026年9月28日（月）9時、気温12度」の形式で、完全日付と区間／時点の違いを含める。
- `missing` は #55 の `.wts-cell-missing` を再利用した点線 `?`（読み上げ「欠測」）。`kind: 'none'` は色・枠・記号なしの空セル（読み上げ「対象外」）。
- `invalid` は本文に「表示できない予報形式です」と示し、値を部分表示しない。

### 4.2 パネル

- `InfoPanelFrame` の既存 `areaForecast`（title「地域時系列予報」、presence `always`）を使う。ヘッダーの時刻は `metadata.issuedAt`。null でデータがある場合は「発表時刻不明」。
- 本文は表の直前に対象表記を2行で示す: 「天気・風：東京地方」「気温：東京（北の丸公園）」。この固定表記は `area.code === '130010'` かつ `data.station.code === '44132'` のときだけ使い、不一致の場合は API の `area.name` / `station.name` を同じ書式で表示する（推測で固定表記を付けない）。
- 表は #56 のパネル表（`ew-table`）と同じ方式の専用 `<table>` とし、§3.2 で選んだ最大3列だけを表示する。横スクロールしない。左上角は空欄。列見出しは2段（上段=区間「9-12時」、下段=時点「9時」、該当なしは空欄）で、日付は付けない（#56 パネルと同じ）。
- パネルの詳細入口は行・列の有無に関係なく、保持値があるとき残す。

### 4.3 詳細ダイアログ

#56 の実装・設計を踏襲する（`AreaForecastContent.tsx` 内で `DetailDialog`＋`DetailTimeSeriesTable`）。

- 見出し「地域時系列予報」、対象「東京地方／東京（北の丸公園）」（§4.2 と同じ不一致時の規則）、時刻は発表時刻。初回取得中は時刻ラベルを出さない。
- 表は過去を含む全区間・全時点を横スクロールで表示し、固定コマ数で切り捨てない。`initialColumnKey` はパネル3列の先頭列（無ければ先頭列）。`stickyHeader`・`bodyDateBoundaries`・`dateHeaderMode="day-weekday-on-change"` を有効にし、#56 と同じ寸法・吸着・日付境界線・フォーカス復帰を使う。
- 列見出しは3段: 上段=日付（`D(曜)`、先頭列と日付切替列だけ）、中段=区間「9-12時」（span 列を結合）、下段=時点「9時」。左端の見出しは上から「日（曜日）」「時間帯」「時刻」。
- `DetailTimeSeriesTable` に任意の props を追加する: `TimeSeriesColumn` の既存 `timeLabel` を下段（時点）に使い、新設の `intervalHeaderCells?: readonly { key: string; label: string; span: number; ariaLabel?: string }[]` を日付行と時刻行の間に描画する。`cornerLabels` に任意の `interval?: string` を追加する。span の合計が列数と一致しない入力は検証エラーとする。未指定時は現行の DOM・寸法・読み上げを一切変えない（#55・#56 回帰）。
- 凡例は置かない（範囲表記と名称を常に表示するため）。追加の予報要素は出さない。

### 4.4 状態

`useEarlyWarning` と同じ `useTileCatalogPolling` を使う。

| 状態 | カード |
| --- | --- |
| 初回取得中 | `{ kind: 'loading' }`。ヘッダーに発表時刻・「取得中」を出さない（#56 と同じ） |
| 保持値なしの失敗 / `availability='unavailable'` / `data=null` | `{ kind: 'failed' }`。詳細は開けない |
| 取得成功 | `{ kind: 'data', availability: 'available', time: issuedAt, timeKind: 'issued' }` |
| 保持値ありの失敗 / `availability='stale'` | 同上で `availability: 'stale'`。前回値を装飾・警告色なしで表示（#52/#56 と同じ） |

本番/訓練: `fetchAreaForecast` は `controlStatus` を付けて要求し、応答の `controlStatus`・`isTraining` が要求と一致しなければ `parse` を失敗（`null`）にする（`parseEarlyWarningResponse` と同じ照合）。`capabilities` の3配列が無い応答も失敗とする。`metadata` の各 null は null のまま扱い、`fetchedAt` を発表時刻の代用にしない。

## 5. 風速の矢羽根と色

### 5.1 色（既存データ色の転用）

セル背景は塗らない。色は矢羽根の塗りつぶしに付け、`windSpeedLevel.ts` に階級→トークン名の固定表を持って CSS から `var()` で参照する。HEX/RGB は書かない。新しい色トークンは作らない。

| 階級 | 矢羽根の塗り（`color`） |
| --- | --- |
| 1 | `var(--wx-data-nowcast-1)` |
| 2 | `var(--wx-data-nowcast-2)` |
| 3 | `var(--wx-data-nowcast-4)` |
| 4 | `var(--wx-data-nowcast-5)` |
| 5 | `var(--wx-data-nowcast-6)` |
| 6 | `var(--wx-data-nowcast-7)` |

- 輪郭矢羽根・風向文字・範囲表記は通常の文字色トークン `var(--md-sys-color-on-surface)`（テーマ追従）。白/黒系の切替えはしない。
- unknown 階級・欠測では塗り要素を描かず、輪郭だけを表示する。
- コントラスト要件は非テキスト要素として「輪郭色とセル背景色で 3:1 以上」をライト/ダーク両方で満たすこと（AC-13）。塗り色のコントラストは要件にしない（形は輪郭で担保する）。セル背景は表の既存背景（パネル・詳細それぞれの `--md-sys-color-*` 背景）をそのまま使う。
- 色だけに依存しない: 範囲表記を常に表示する。

### 5.2 矢羽根の構成とフォント読み込み

- 自作 SVG は使わない。Material Symbols の `navigation` を 24px 相当で2枚重ねる。
  - 下層（塗り）: 塗りつぶし版ファミリ（FILL=1）の `navigation`、`color` は §5.1。
  - 上層（輪郭）: 既存 `Material Symbols Outlined`（FILL=0）の `navigation`、`color` は `var(--md-sys-color-on-surface)`。
  - 両層とも同じ 24×24px の枠内に絶対配置し、同じ `transform: rotate()` を掛ける。回転角は #55 の `classifyWindDirection()` をそのまま使う。両層とも `aria-hidden`。
- `apps/web/index.html` の既存 Material Symbols Outlined の `<link>`（FILL=0 固定）は変更しない。
- 塗りつぶし版は既存と衝突しない別ファミリを、`icon_names=navigation` で1文字にサブセットして `<link>` を1本追加する。設計案は **Material Symbols Sharp**、軸は `opsz,wght,FILL,GRAD@20..48,400,1,0`（opsz・wght・GRAD は既存と揃え、FILL だけ 1）、`display=block`。統括の実測では Outlined 同条件のサブセットが約1.1KB。全体読み込みに FILL 軸を加える案（+384KB）は採らない。
- 形状の重なり確認（製造・検収で実施、記録を残す）: フィクスチャの8方位×階級の矢羽根を 200% 以上に拡大してスクリーンショットを撮り、塗りが輪郭の外へはみ出す・輪郭の内側に隙間が出る箇所の有無と最大幅（目視、px 概算）を検収記録に書く。製造担当は Sharp と Rounded の両方で1回ずつ確認し、ずれの小さい方を採用して理由を記録する。ずれが残る場合も合否にはせず UI 監修で検討する（ユーザー了承済み）。

### 5.3 フォント読み込み失敗時（CDN 不可）

- リガチャ文字列（`navigation`、`sunny` 等）を画面に出さない。`document.fonts.load()` で両ファミリ（24px、`navigation`）の読込を確認し、完了するまで矢羽根の2層と天気アイコンは `visibility: hidden`（枠の寸法は保持）とする。失敗・タイムアウト（例 3秒）の場合も非表示のまま維持する。
- このとき風セルは風向文字と範囲表記、天気セルは名称だけで意味を保つ。レイアウトは変化させない（§7、AC-18）。
- 片方のファミリだけ読めた場合: 輪郭（Outlined）だけ読めれば輪郭だけを表示し、塗りだけ読めた場合は矢羽根全体を非表示にする（輪郭なしの塗りは形の担保が無いため）。

## 6. 開発フィクスチャ

`?panelFixture=area-forecast` を追加する（開発ビルド限定、本番では無視）。合成 `AreaTimeseriesResponse` を本番と同じ `buildAreaForecastCard`・モデル・パネル表・`DetailDialog`・`DetailTimeSeriesTable` に通し、「確認用データ」と明示する。この名前のときだけ `useAreaForecast` のポーリングを無効化する（#56 の `earlyWarningFixtureGate` と同形）。現在時刻を含む JST の3時間区間を先頭から3つ目に置き（過去2区間を含める）、区間14・時点15を作り、次を含める。

- 天気: 晴れ・くもり・雨・雪・雨または雪・雨か雪・雪か雨（アイコン）、表に無い長い文字「くもり一時雨」（2行折返し確認）、`valueText` null（欠測）。パネル3列の中に、アイコンあり・文字代替・欠測が揃うよう配置する
- 風: 階級1〜6すべて、`valueCode='7'`（unknown）、風向「北北西」（矢羽根なし）、風向欠測
- 気温: 負値、`valueNumber` null・`valueText` あり、欠測、区間の無い最終列
- 日付境界を2回以上またぐ

## 7. 寸法の揺れ防止

全状態で次の寸法を固定し、状態によってレイアウトが動かないことを受け入れ条件にする（AC-8）。

| 対象 | 固定する寸法 |
| --- | --- |
| 列幅 | パネル・詳細とも全データ列 `inline-size: 4rem`（詳細は `TimeSeriesColumn.width`）。結合セルは span×4rem。区間の無い列も同幅。パネルは3列未満でも各列 4rem |
| 見出し | 区間行・時点行とも1行固定。空欄の見出しセルも同じ高さ |
| 天気行 | `block-size` 固定（アイコン 24px＋名称2行分）。アイコンあり／文字代替／長文字（2行で打切り、全文は `aria-label` と `title`）／欠測 `?`／`none`／フォント未読込で同じ高さ、内容は上下左右中央 |
| 風行 | 上段（矢羽根 24×24px の固定枠＋風向文字）と下段（範囲）の2段固定。塗り・輪郭の2要素は同じ枠に絶対配置で重ね、フロー上の幅を増やさない。矢羽根なし・フォント未読込・風向欠測・unknown 階級・`20以上`・欠測でも枠を残し、高さ・幅が同じ |
| 気温行 | 1行固定。負値・文字値・欠測・`none` で同じ高さ |
| パネル表 | 行見出し列は残り幅（#56 と同じ配分）。「表示できる時間帯はありません」表示は表を置かない |
| 状態 | stale／available の切替で寸法差なし。取得中・失敗は既存 `InfoPanelFrame` の表示のまま |

## 8. 未決事項

なし（2026-09-28 のユーザー回答で Q1〜Q6 と風速表示方式を解決。§2.2-6〜10）。

## 9. 受け入れ条件

- [ ] AC-1: east / trc の双方で `GET /api/weather/area-timeseries` を `controlStatus` 付きで呼ぶ。応答の `controlStatus` / `isTraining` 不一致、`capabilities` 欠落は取得失敗として扱うことを単体テストで確認する。parser・DB・API・`packages/shared`・`docs/basic-design.md` に差分が無い（`git diff --stat main...HEAD` で確認）。
- [ ] AC-2: モデル単体テストで、`values` の配列順や `sequence` をシャッフルしても同じ表になり、`refId` は同一 `blockId` 内の `timeId` だけに結合される。ブロックをまたいで同じ `refId` がある入力、対応 `timeDefine` の無い値、同一 ref の重複値（→ missing）、区間の重なり・逆転（→ invalid）、区間の無い最終列（→ none、時点行「0時」）を検証する。気温・風速の補間値が生成されない。9時の気温が「9-12時」列に置かれる。
- [ ] AC-3: サンプル `apps/api/tests/fixtures/jma/24_11_03_190925_VPFD51.xml` 相当の DTO（テスト内で構築）から、区間数・時点数どおりの列とセルが生成され、詳細の表は全列を持つ。区間見出しが「6-9時」…「21-24時」、時点見出しが「6時」…「0時」になる。
- [ ] AC-4: パネル3列の単体テスト: 現在区間の開始列から最大3列、境界 `now = timeTo` で次の区間、現在区間なしで未来の先頭から、3列未満、過去だけの保持値で「表示できる時間帯はありません」。パネルに横スクロール（`overflow-x` によるスクロール可能領域）が無いことを DOM で確認する。
- [ ] AC-5: #59 対応表の単体テスト: 晴れ→`sunny`、くもり→`cloud`、雨→`rainy`、雪→`weather_snowy`、雨または雪・雨か雪・雪か雨→`rainy_snow`。空文字・「くもり一時雨」・前後空白付き「晴れ 」は `icon: null` で原文表示。null は missing。アイコン付きでも名称は原文のまま表示される。
- [ ] AC-6: 風速単体テスト: `'1'`〜`'6'` が `0-2`、`3-5`、`6-9`、`10-14`、`15-19`、`20以上` と §5.1 の塗り色トークンになり、`'0'`・`'7'`・`'4.0'`・全角 `'４'` は unknown で原文表示・塗り色なし（輪郭だけの矢羽根）、null は missing。風向は8方位で #55 の `classifyWindDirection` と同じ回転角を塗り・輪郭の両方に適用し、8方位以外は矢羽根なし（24px の空白を保持）。気温は `12℃`・`-3℃`、文字値、欠測 `?`。
- [ ] AC-7: `?panelFixture=area-forecast`（開発ビルド、端末選択後）で、パネルに対象表記2行、区間・時点の2段見出し、天気・風（m/s）・気温の3行、現在を含む3列、アイコン＋名称、文字代替、階級色と範囲、欠測 `?`、「確認用データ」が表示される。詳細を開くと過去を含む全列が横スクロールで閲覧でき、日付・区間・時点の3段見出し、区間の無い最終列の空セル、階級1〜6すべてが表示される。スクリーンショットを検収記録に残す。
- [ ] AC-8: 同フィクスチャで `getBoundingClientRect()` により、パネル・詳細の全データ列の幅が 64px（ルート16px時）±1px、結合セルが span×64px ±1px、天気行のアイコンあり・文字代替・長文字・欠測・none セルの高さ差1px以内、風行の各状態（階級1〜6・矢羽根なし・風向欠測・unknown・`20以上`・欠測）の高さ差1px以内、矢羽根の塗り要素と輪郭要素の外接矩形がともに 24×24px ±1px で中心が一致（差1px以内）、気温行の各状態の高さ差1px以内、見出しの空欄セルと有字セルの高さ差1px以内であることを測る。stale 版のカード（単体テストのレンダリング比較でも可）で表の幅・行高が変わらない。
- [ ] AC-9: 各データセル・見出しの `aria-label` に完全日付（年・月・日・曜日）と「○時から○時」（区間）／「○時」（時点）が含まれ、天気・風向・範囲・気温・「欠測」「対象外」を読み上げで区別できる。アイコン・矢羽根は `aria-hidden`。
- [ ] AC-10: 詳細を開閉でき、#61 のフォーカス・スクロール復帰を維持する。`stickyHeader` の吸着、`bodyDateBoundaries` の日付境界線、初期列がパネル先頭列であることを確認する。追加の予報要素・凡例が無い。
- [ ] AC-11: `DetailTimeSeriesTable` の単体テスト: `intervalHeaderCells` 指定時に日付行と時刻行の間へ span 付きの行が入り、見出しと本文の列幅同期が保たれる。span 合計と列数の不一致は検証エラー。未指定時の DOM が変更前と一致し、#55・#56 の既存テストが変更なしで通る。
- [ ] AC-12: 状態: 初回取得中はヘッダーに時刻・「取得中」なし、保持値なし失敗・`unavailable`・`data=null` は失敗表示で詳細なし、stale は前回値を装飾なしで表示、`issuedAt=null` は「発表時刻不明」。`fetchedAt` を発表時刻に使わない。`area.code`・`station.code` が想定値のとき固定表記、不一致のとき API の名称になる。以上を単体テストで確認する。
- [ ] AC-13: 風速色: 新しい `--wx-*` トークン定義が追加されていない（`git diff main...HEAD -- apps/web/src/theme` が空）。風セルの背景が塗られていない（算出 `background-color` が表の通常セルと同じ）。塗りつぶし矢羽根の算出 `color` が §5.1 の階級対応の nowcast 値、輪郭矢羽根と範囲・風向文字の算出 `color` が通常の文字色トークン値であることを、ライト/ダーク両テーマでフィクスチャ上の `getComputedStyle` で確認する。輪郭色とセル背景色のコントラスト比が両テーマで 3:1 以上であることを、テーマ生成関数の出力から計算する単体テストで確認する（塗り色のコントラストは検証しない）。`git grep -nE '#[0-9a-fA-F]{3,8}\b|rgb\(' -- apps/web/src/map/panels/areaForecast` が0件。ライト/ダーク両テーマのスクリーンショットをオーナーの主観確認に回す。
- [ ] AC-14: `?panelFixture=area-forecast` で地域時系列 API の fetch 呼出しが0件であることを、#56 AC-16 と同じ hook mount 方式の**自動テスト**でポーリング1周期以上進めて確認する。別 fixture 名・クエリなしでは初回1件以上と再呼出しがある。本番ビルド相当ではクエリが無効で合成データも「確認用データ」も出ない。
- [ ] AC-15: 読み込み量の記録: (1) `npm run build -w apps/web` の JS 合計サイズを main と比較し増分を記録する。(2) `index.html` の既存 Material Symbols Outlined の `<link>` が1文字も変わっていないことを `git diff` で確認する。(3) 追加した塗りつぶし用 `<link>` が `icon_names=navigation` を含み、開発サーバーでの実際のフォント応答（woff2）のサイズを記録する。統括実測（Outlined 同条件約1.1KB）と桁が同じ（数KB 以下）であることを確認し、数十KB 以上なら差し戻す。(4) 形状の重なり確認（§5.2 の手順）のスクリーンショットと所見を検収記録に残す（ずれの有無は記録のみで合否にしない）。
- [ ] AC-16: 既存フィクスチャ（`all-content`、`mixed`、`early-warning`、`warning-timeseries` 等）と #55・#56 のパネル・詳細表示・既存テストに回帰が無い。`classifyWindDirection` の再利用で `warningTimeSeriesModel.ts` に差分が無い。
- [ ] AC-17: `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/web` が成功し、変更範囲が §3.1 のファイルに限られる。
- [ ] AC-18: フォント読み込み失敗時: 開発ツールで `fonts.gstatic.com` / `fonts.googleapis.com` を遮断した状態（またはフォント状態をモックした単体テスト）で、風セルに `navigation` 等のリガチャ文字列が表示されず、矢羽根領域 24px は空白のまま保たれ、風向文字・範囲表記が表示される。天気セルは名称だけになる。遮断前後で風行・天気行の高さ・列幅が変わらない（差1px以内）。

## 10. 棚卸し項目の結論

- **AD-H046**（XML明細の未抽出項目）: G7 に必要な項目は保存済みの天気文字・風向・風速階級・気温で足り、保存追加は不要。風速範囲は API の未保存項目を使わずフロントの固定表（Ｒ１資料・実電文と照合済み）で示す。天気コード・日別天気・6時間降水確率・最高/最低気温は未抽出のまま将来課題とし、「該当なし」と混同しない（`unsupportedFields` を尊重）。
- **AD-H050**（区間と時点）: 同一 `blockId` 内の `refId`–`timeId` 参照で結合し、区間は列結合、時点は開始側の一致列に置く。区間と時点は見出し行を分けて区別する。配列添字結合・風速実数補間・気温補間をしない。
- **AD-H051**（天気アイコンの入力境界）: 入力は3時間区間の天気文字（`valueText`）とし、完全一致の固定表（7語）で Material Symbols を引く。天気コードは使わない。表に無い文字は文字代替。

## 11. 後続への引き継ぎ

- 最高・最低気温（朝の最低／日中の最高）、日別天気と天気コード、6時間降水確率は将来課題（ユーザー判断 2026-09-28）。熱中症関連情報は別途将来拡張で検討する。
- 風向の `condition`（やや強く／強く）は未保存。表示が必要になれば parser 拡張が要る。
- 公式資料と実電文の天気語彙の不一致（§2.3）は、実運用電文の蓄積後に再照合する。
- Material Symbols を CDN から読むため、LAN 限定環境（#208）でフォントが得られない場合はアイコン・矢羽根が出ず、天気名称・風向文字・範囲表記だけになる（§5.3、意味は失わない）。
- nowcast データ色を転用しているため、雨雲凡例の色を変更すると矢羽根の塗り色も変わる（塗り色のコントラストは要件外）。
- 塗りつぶし版と輪郭版のフォントファミリが異なるため、形状のずれが UI 監修で問題になった場合は同ファミリへの切替等を別途検討する（ユーザー了承済み、§5.2）。

## 12. 基本設計への追記案（本 Issue では basic-design.md を編集しない）

§5.11「表の構成」の末尾に次を追記する案:

> パネルは警報級の可能性（§5.9）と同じく、現在を含む区間から3列だけを表示し横スクロールしない。全区間・全時点の閲覧は詳細ダイアログで横スクロールにより行う（2026-09-28 ユーザー決定）。列見出しは日付の下に区間（「9-12時」）と時点（「9時」）の2段とし、時点値は同時刻から始まる区間の列に置く。

§5.11「風速の表示」の末尾に次を追記する案:

> 階級の色は雨雲ナウキャスト凡例のデータ色を転用し（階級1→nowcast-1、2→2、3→4、4→5、5→6、6→7）、セル背景ではなく矢羽根（塗りつぶしの `navigation` に通常文字色の輪郭を重ねる）に付ける。天気アイコンは3時間区間の天気文字から Material Symbols の固定表で引き、表に無い文字は文字だけで表示する。
