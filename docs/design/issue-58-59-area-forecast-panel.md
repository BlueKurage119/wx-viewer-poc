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
5. ~~画面表記「天気・風：東京地方」「気温：東京（北の丸公園）」~~ → 確定事項11で変更。
6. 混在系の天気文字「雨または雪」「雨か雪」「雪か雨」は3語とも `rainy_snow` を割り当てる。
7. 詳細ダイアログを本 Issue で作る。ダイアログは過去を含む全区間・全時点を横スクロールで表示する。パネルは #56 と同じく現在を含む区間から3列だけ表示し、横スクロールしない。これは基本設計 §5.11「全区間・横スクロール」のパネルにおける例外であり、全期間の閲覧は詳細ダイアログで満たす。
8. 風速階級の色は新設トークンを作らず、雨雲ナウキャスト凡例のデータ色 `var(--wx-data-nowcast-N)` を転用する（気象庁HPの流儀）。階級1→nowcast-1、2→2、3→4、4→5（黄）、5→6（橙）、6→7（赤）。
9. 9時の気温は 9時から始まる区間の列（区間の開始側）に置く。~~区間行「9-12時」と時点行「9時」の2段見出し~~ → 確定事項12で変更。
10. 風速表示はセル背景を塗らず、色は矢羽根に付ける。矢羽根は Material Symbols の `navigation`（24px 相当）で、塗りつぶし版（FILL=1、`color: var(--wx-data-nowcast-N)`）の上に既存 Outlined（FILL=0）の輪郭版を通常の文字色トークンで重ねる。（輪郭層・ライト/ダーク両方の検証は確定事項18・19で変更）回転は `classifyWindDirection` を流用（→ 確定事項17で本パネル専用の16方位表に変更）。m/s 範囲の文字は通常の文字色トークン（テーマ追従）。既存 Outlined の読み込みは変えず、塗りつぶし版は別ファミリを `icon_names=navigation` でサブセットして追加する。コントラストは「輪郭と背景で 3:1 以上」（非テキスト）をライト/ダーク両方で検証し、塗り色は要件にしない。別ファミリとの形状のずれは確認・記録し、問題なら UI 監修で検討する。

11. UI監修（オーナー、2026-09-28）: 地名は2行表記をやめ、パネル見出しを1行「東京地方／東京（北の丸公園）・XX:00発表」（XX:00 は発表時刻）とする。詳細ダイアログの対象表記も同じ「東京地方／東京（北の丸公園）」に揃える。基本設計 §5.11 の【確定】表記をオーナー決定で変更するもの。
12. UI監修（同）: 時刻見出しはパネル・詳細とも時点「9時」の1段とする（詳細は日付行＋時点行の2段）。区間行「9-12時」は廃止する。天気・風のセルはその時刻から3時間の区間、気温はその時刻の値として読む（気象庁HPと同じ読み方）。区間の意味は読み上げラベルで補う。基本設計 §5.11「区間と時点を列見出しで区別」をオーナー決定で変更するもの。
13. UI監修（同）: 風向の漢字表記はパネル・詳細とも画面から消し、読み上げラベルにのみ残す。
14. 折れ線グラフ化は今回扱わない（オーナーが後で検討）。
15. オーナー決定（Q7）: 風向が「ない」場合（方向を持たない値）は矢羽根の枠に「ー」を表示する。方向はあるが矢羽根を描けないだけの場合（8方位以外の方位文字、フォントの読み込み失敗）は、風向の漢字をそのまま表示する。（「8方位以外」は確定事項17で「16方位表に無い方位文字」に読み替え）
16. オーナー決定（Q8）: パネル見出しの区切りは共通枠の既存「 · 」のままとする。
17. オーナー決定（2026-09-28）: 16方位の方位文字（例「北北西」）も矢羽根で描く（22.5°刻み）。#55 の `classifyWindDirection` は変更せず、本パネル専用の16方位→回転角表を `areaForecast` 配下に持つ。unit が「８方位漢字」「１６方位漢字」のいずれでも、方位文字が16方位表にあれば回転する。16方位表に無い方位文字（36方位等）だけを「漢字をそのまま表示」の対象とする。
18. UI監修（オーナー、2026-09-29）: 矢羽根の輪郭層（Outlined FILL=0 の重ね）を廃止し、Sharp FILL=1 の塗り1層だけにする（背景がダークグレーのため塗りだけで判別可能と実画面で確認済み）。矢羽根のフォント読込判定は塗り用フォントだけとする。
19. UI監修（同）: プロジェクトはダークテーマ固定でライトテーマは想定しない。検証はダークのみ。コントラスト要件は「塗り色とパネル・詳細のセル背景で 3:1 以上（ダーク）」とする。
20. オーナー回答（2026-09-29、Q9）: 階級3（nowcast-4）が 3:1 に届かない点は例外として受け入れる。色は変えず、縁取りも付けない。階級は範囲表記「6-9」で読める。

### 2.3 実物調査の結果

**風速階級（確定）**: サンプル6本の `WindSpeedLevel` 全288件の `range` / `description` は、階級1=`0 2`、2=`3 5`、3=`6 9`、4=`10 14`、5=`15 19`、6=`20 INF`（毎秒２０メートル以上）で例外なし。Ｒ１解説資料 ※４－１－１(3) も「風のレベル値は１～６」とし、同じ6段の range を例示している。確定事項4の固定表は実電文・公式資料の双方と一致する。なお**旧版解説資料（平成23年）は「１～４」、4=`10 INF`（毎秒１０メートル以上）**としており、令和2年のＲ１改訂で6段階になった。本設計は現行のＲ１を根拠とし、`'1'`〜`'6'` 以外の値は範囲表に当てはめない（§3.4）。

**天気語彙**: Ｒ１解説資料 ※４－１－１(1) は3時間内卓越天気を「晴れ」「くもり」「雨」「雪」「雨または雪」の5種類とする。サンプル6本の `region-3hour` に現れた語は「晴れ」「くもり」「雨」「雪か雨」「雨か雪」で、「雨または雪」は無く、資料に無い「雪か雨」「雨か雪」が現れる。辞書（`jmaxml_20260129_dictionary.xlsx`）・コード表（`jmaxml_20260826_code.xlsx`）に語彙の列挙は無い。対応表は資料5語＋実電文2語の計7語を載せる（確定事項6）。

**Material Symbols（確定）**: `apps/web/index.html` は Google Fonts から `Material+Symbols+Outlined` を `icon_names` 指定なし・FILL=0 固定で読み込んでおり、全グリフの輪郭版が利用可能。Material Design Icons 公式リポジトリの `MaterialSymbolsOutlined[FILL,GRAD,opsz,wght].codepoints`（2026-09-28 取得）で `sunny`(e81a)、`cloud`(f15c)、`rainy`(f176)、`weather_snowy`(e2cd)、`rainy_snow`(f61d)、`navigation`(e55d) の存在を確認した。フォントは CDN 配信で JS バンドルに含まれない。塗りつぶしの `navigation` は別ファミリの1文字サブセットで追加する（§5.2、読み込み量は AC-15 で記録）。フォントが読み込めない環境の扱いは §5.3。

**風向（確定）**: サンプルの `WindDirection` は `unit="８方位漢字"` で8語のみ。回転角は本パネル専用の16方位表（`windDirection16.ts`、§4.1a）で求める。#55 の `classifyWindDirection()`（`warningTimeSeriesModel.ts`、`unit === '８方位漢字'` 前提、風下を指す `navigation` の回転角）は変更せず、8方位の角度はそれと一致させる（確定事項17）。`condition="やや強く"` 等の属性は #16 で保存していないため表示しない。

**時間軸（確定）**: サンプル `24_11_01` では `region-3hour` が 23日06:00 起点 `PT3H` ×14区間（24日 21-24時まで）、`temperature-3hour` が 23日06:00〜25日00:00 の15時点。最後の時点（25日0時）には開始側の区間が無い。

**データ色（確定）**: `weatherDataColors.css` の nowcast トークンは `:root` 固定値で、ライト/ダークで同じ値（データ色のため、06 業務標準の例外規定どおり）。矢羽根の塗りに転用する6色は `-1`・`-2`・`-4`・`-5`・`-6`・`-7`（`-7` は `var(--wx-jma-hue-red)`）。塗り色のコントラストは確定事項10では要件外としたが、輪郭層の廃止（確定事項18）に伴い、塗り色とセル背景で 3:1 以上（ダーク）を要件とする（確定事項19、§5.1）。

**方向なしの風向（確定）**: Ｒ１解説資料で VPFD51 の風向に現れる方向なしの表現は、日別の風予報（`WindForecastPart`）の「風弱く」だけで、`<jmx_eb:WindDirection condition="風弱く" description="風弱く" … unit="８方位漢字"/>` のように**要素テキストが空**で `condition` に入る（資料は「風向は特定されない」と説明）。3時間区間（※４－１－１(2)）の例示・説明は8方位だけで、方向なしの語は無い。辞書（`jmaxml_20260129_dictionary.xlsx`）の風向の単位は「８方位漢字」「１６方位漢字」「３６方位漢字」等で、「静穏」「風向不定」「微風」の語は見つからなかった。スキーマ `jmx_eb.xsd` の `type.WindDirection` は任意文字列で値域を定めていない。また現行 parser（`jmaVpfd51Parser.ts`）は3時間区間の `WindDirection` テキストが空なら電文全体を「未対応構造」として保存しないため、「風弱く」形が3時間区間に来ても画面には届かない（§11、Issue #229 で起案済み）。以上から、方向なしの語は列挙せず「方位文字以外の文字列」という規則で判定する（§4.1a）。

**欠測と方向なしの区別（判断）**: #55・#56 は「値なし／なし」（電文が値を持たないことを明示したもの）と「欠測・参照欠落」（あるべき値が得られない）を区別し、前者は文字なし・黒セル等、後者は点線 `?` とした。本 DTO には風向の `condition` が保存されず、`wind_direction` の行が無い場合は電文に要素が無い（参照欠落）ことしか分からない。これは #56 の参照欠落と同じ性質なので `?`（欠測）とし、電文が方向なしを明示した値（方位文字以外の文字列）だけを「ー」とする。オーナー回答の「値なし」は、電文が値なしを明示した場合と解釈した（本 DTO ではそれが方位文字以外の文字列として現れる）。

## 3. データモデル

### 3.1 モジュール構成

新設ディレクトリ `apps/web/src/map/panels/areaForecast/`:

| ファイル | 内容 |
| --- | --- |
| `areaForecastModel.ts` | DTO → 表モデル変換、パネル3列の選択（純関数） |
| `weatherIconMap.ts` | #59 天気文字→Material Symbols 固定表（§3.3） |
| `windSpeedLevel.ts` | 風速階級→m/s 範囲・色トークンの固定表（§3.4、§5） |
| `windDirection16.ts` | 16方位→矢羽根回転角の固定表（§4.1a、確定事項17） |
| `AreaForecastContent.tsx` | パネル本文・詳細ダイアログ（`EarlyWarningContent.tsx` と同形） |
| `areaForecast.css` | 本パネル限定スタイル |
| `useAreaForecast.tsx` | 取得・カード組立（`useEarlyWarning` と同形、`buildAreaForecastCard` を export） |
| `areaForecastFixture.ts` / `areaForecastFixtureGate.ts` | 開発フィクスチャ（§6） |

加えて `apps/web/src/api/areaForecast.ts`（`fetchAreaForecast`、`fetchEarlyWarning` と同形で `path: '/api/weather/area-timeseries'`）、`apps/web/src/map/panels/panelTargets.ts`（`areaForecast` の対象表記、§4.2）、`panelDefinitions.ts`・`InfoPanelColumn.tsx`（任意 `target` 上書き、必要な場合のみ）、`apps/web/index.html`（塗りつぶし矢羽根用フォントの `<link>` 1本の追加のみ、§5.2）、`WeatherMapView.tsx`・`panelFixtures.ts` の結線、`apps/web/tests/` の対応テスト。新しい色トークンは作らない。

### 3.2 表モデル

```ts
type AreaForecastColumn = {
  key: string;
  at: UtcIso8601String;          // 列の代表時刻（区間の開始時刻 = 同時刻の時点）
  label: string;                 // 「9時」（JST の時＋「時」）。全列に付ける（確定事項12）
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
3. 区間セルは `timeFrom` の列から、`timeFrom <= 列時刻 < timeTo` を満たす列の数だけ `span` する。区間の範囲は見出しに出さず、読み上げラベル（§4.1）で「9時から12時」と示す。区間どうしが重なる、または `timeTo <= timeFrom` の区間があれば `{ kind: 'invalid' }`。どの区間にも含まれない列は `kind: 'none'`（連続する列はまとめて1セル）。
4. 時点セルは時刻が一致する列（＝その時刻から始まる区間の列、確定事項9）に置く。列見出し `label` は列時刻の「{時}時」（JST、`0`〜`21`）。最終時点（例 25日0時）は区間の無い列として**残す**（気温の値を失わないため）。その列の天気・風は `none`（空セル、読み上げ「対象外」）、見出しは「0時」。見出しが1段になっても、見出し「0時」の下の空の天気・風は「0時からの区間の予報なし」と読める（気象庁HPの読み方と矛盾しない）。
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
- 風セル: 上段に矢羽根（§5.2 の塗り1層、`aria-hidden`）、下段に範囲表記。風向の漢字は画面に出さず、`aria-label` にだけ入れる（確定事項13）。セル背景は塗らない。文字は通常の文字色トークン。unknown 階級・欠測は塗りなしで輪郭だけ。矢羽根を描けない場合・方向なし・欠測の扱いは §4.1a。
- 気温セル: 数値＋℃。
- §4.1a 矢羽根を描けない場合（オーナー決定 2026-09-28、§2.2-15）: 矢羽根枠（24×24px）の中に次のとおり表示する。
  - 16方位表にあり、`unit` が `'８方位漢字'` または `'１６方位漢字'`、フォント読込済み: 矢羽根。回転角は `windDirection16.ts` の固定表（北=180°、北北東=202.5°、北東=225°、東北東=247.5°、東=270°、東南東=292.5°、南東=315°、南南東=337.5°、南=0°、南南西=22.5°、南西=45°、西南西=67.5°、西=90°、西北西=112.5°、北西=135°、北北西=157.5°。＝方位角＋180° を 360° で割った余り、風下を指す）。8方位の値は #55 の `WIND_DIRECTION_ROTATION` と同じ。`unit` がそれ以外（null を含む）の場合は推測で回転せず、次項の漢字表示とする。
  - **方向はあるが矢羽根を描けない**: 値が方位文字（「北」「東」「南」「西」だけで構成される文字列）だが16方位表に無い（36方位等）、または上記の `unit` 以外のとき、およびフォント読込失敗時の16方位: 風向の漢字をそのまま表示（1行、枠内、はみ出しは省略記号）。読み上げ「北北西の風」等。
  - **方向なし**: 値が方位文字でない文字列（例「静穏」「風向不定」「微風」「風弱く」。§2.3 のとおり3時間区間では実例・公式列挙とも無く、語を列挙せず規則で判定する）: 「ー」を表示。読み上げ「風向なし（{原文}）」。
  - **欠測**: `wind_direction` の値が無い（参照欠落、同一 ref 重複）: #55/#56 と同じ点線 `?`、読み上げ「風向欠測」。「ー」とは区別する（判断は §2.3 末尾）。
- 各セルの `aria-label` は「2026年9月28日（月）9時から12時、くもり」「2026年9月28日（月）9時から12時、北西の風、毎秒3から5メートル」「2026年9月28日（月）9時、気温12度」の形式で、完全日付と区間（天気・風）／時点（気温）の違いを含める。列見出しの `aria-label` は「2026年9月28日（月）9時」。
- `missing` は #55 の `.wts-cell-missing` を再利用した点線 `?`（読み上げ「欠測」）。`kind: 'none'` は色・枠・記号なしの空セル（読み上げ「対象外」）。
- `invalid` は本文に「表示できない予報形式です」と示し、値を部分表示しない。

### 4.2 パネル

- `InfoPanelFrame` の既存 `areaForecast`（title「地域時系列予報」、presence `always`）を使う。ヘッダーのメタ行は1行で「東京地方／東京（北の丸公園） · 05:00発表」（確定事項11）。対象表記は共通枠の既存 `target` 入力、時刻は既存の `formatPanelTime(issuedAt, 'issued')` で出す。区切りは共通枠の既存「 · 」を使う（確定事項16）。`issuedAt` が null でデータがある場合は「発表時刻不明」。
- 対象表記は `panelTargets.ts` の `resolvePanelTarget(venueId, 'areaForecast')` を `${broadForecast.displayName}／${temperatureForecast.displayName}` に変更して得る（両会場とも「東京地方／東京（北の丸公園）」）。他パネルの対象表記は変えない。
- API 応答の `area.code` / `data.station.code` が会場定義（`broadForecast.areaCode` / `temperatureForecast.stationCode`）と一致しない場合は、推測で定義名を付けず、カード入力の任意 `target` 上書きで API の `area.name／station.name` を表示する（`InfoPanelCardInput` に任意 `target?: string` が無ければ追加し、`InfoPanelColumn` で `resolvePanelTarget` より優先する）。
- 本文の対象表記ブロック（旧2行）は削除する。
- 表は #56 のパネル表（`ew-table`）と同じ方式の専用 `<table>` とし、§3.2 で選んだ最大3列だけを表示する。横スクロールしない。左上角は空欄。列見出しは時点「9時」の1段で、日付は付けない（#56 パネルと同じ）。
- パネルの詳細入口は行・列の有無に関係なく、保持値があるとき残す。

### 4.3 詳細ダイアログ

#56 の実装・設計を踏襲する（`AreaForecastContent.tsx` 内で `DetailDialog`＋`DetailTimeSeriesTable`）。

- 見出し「地域時系列予報」、対象「東京地方／東京（北の丸公園）」（パネルと同じ文字列・同じ不一致時の規則）、時刻は発表時刻。初回取得中は時刻ラベルを出さない。
- 表は過去を含む全区間・全時点を横スクロールで表示し、固定コマ数で切り捨てない。`initialColumnKey` はパネル3列の先頭列（無ければ先頭列）。`stickyHeader`・`bodyDateBoundaries`・`dateHeaderMode="day-weekday-on-change"` を有効にし、#56 と同じ寸法・吸着・日付境界線・フォーカス復帰を使う。
- 列見出しは2段: 上段=日付（`D(曜)`、先頭列と日付切替列だけ）、下段=時点「9時」（`TimeSeriesColumn.timeLabel`）。左端の見出しは `cornerLabels={{ date: '日（曜日）', time: '時刻' }}`。天気・風の区間は `TimeSeriesCell.span` による既存の横結合で表す。
- 共用部品 `DetailTimeSeriesTable` は変更しない。製造時に追加した任意の中段見出し（`intervalHeaderCells`、`cornerLabels.interval` と関連の検証・描画・テスト）は削除し、`main` の版に戻す（`git diff main -- apps/web/src/map/detail/DetailTimeSeriesTable.tsx` が空になること）。
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

- 範囲表記（および §4.1a の代替漢字）は通常の文字色トークン `var(--md-sys-color-on-surface)`。白/黒系の切替えはしない。
- unknown 階級・欠測では、矢羽根（塗り1層）を `var(--md-sys-color-on-surface)` で描く（方向は示し、階級色は付けない）。
- コントラスト要件（確定事項19、非テキスト要素）: 塗り色とセル背景で 3:1 以上（ダーク）。セル背景はパネル `.info-panel-card` の `--md-sys-color-surface-container`（ダーク: neutral トーン12）、詳細 `.detail-dialog` 系の `--md-sys-color-surface-container-high`（ダーク: トーン17）。設計時に `@material/material-color-utilities` 0.3.0 でシード `#1A73E8` の neutral パレットから求めた値（パネル `#1f1f23`、詳細 `#292a2d`）で WCAG 2.x の比を計算した結果:

| 階級 | 塗り | パネル背景比 | 詳細背景比 | 判定 |
| --- | --- | --- | --- | --- |
| 1 | nowcast-1 `#f2f2ff` | 14.80 | 12.93 | 可 |
| 2 | nowcast-2 `#a0d2ff` | 10.29 | 8.99 | 可 |
| 3 | nowcast-4 `#0041ff` | **2.50** | **2.19** | **不可**（例外として受容、確定事項20） |
| 4 | nowcast-5 `#faf500` | 14.18 | 12.39 | 可 |
| 5 | nowcast-6 `#ff9900` | 7.67 | 6.70 | 可 |
| 6 | nowcast-7 `#ff2800` | 4.35 | 3.80 | 可 |
- 色だけに依存しない: 範囲表記を常に表示する。

### 5.2 矢羽根の構成とフォント読み込み

- 自作 SVG は使わない。塗りつぶし版ファミリ（FILL=1）の `navigation` を 24px 相当の1層で描く（確定事項18。輪郭層は置かない）。`color` は §5.1。24×24px の枠内に置き、`transform: rotate()` の角度は `windDirection16.ts`（§4.1a）で求める。`aria-hidden`。
- `apps/web/index.html` の既存 Material Symbols Outlined の `<link>`（FILL=0 固定）は変更しない。
- 塗りつぶし版は既存と衝突しない別ファミリを、`icon_names=navigation` で1文字にサブセットして `<link>` を1本追加する。設計案は **Material Symbols Sharp**、軸は `opsz,wght,FILL,GRAD@20..48,400,1,0`（opsz・wght・GRAD は既存と揃え、FILL だけ 1）、`display=block`。統括の実測では Outlined 同条件のサブセットが約1.1KB。全体読み込みに FILL 軸を加える案（+384KB）は採らない。

### 5.3 フォント読み込み失敗時（CDN 不可）

- リガチャ文字列（`navigation`、`sunny` 等）を画面に出さない。`document.fonts.load()` で、矢羽根は塗り用ファミリ（Sharp、24px、`navigation`）だけ、天気アイコンは従来どおり Outlined の読込を確認し、それぞれ完了するまで矢羽根・天気アイコンを `visibility: hidden`（枠の寸法は保持）とする。失敗・タイムアウト（例 3秒）の場合も非表示のまま維持する。
- このとき風セルは矢羽根枠に風向の漢字を代替表示（§4.1a、方向なしは「ー」のまま）し範囲表記と合わせて、天気セルは名称だけで意味を保つ。レイアウトは変化させない（§7、AC-18）。
- 矢羽根の表示は Outlined の読込状態（`outlinedReady` 等）に依存させない。Sharp だけ読めれば矢羽根は表示し、天気アイコンだけ非表示（名称のみ）になる。Outlined だけ読めた場合は天気アイコンを表示し、矢羽根枠は漢字代替（§4.1a）。

## 6. 開発フィクスチャ

`?panelFixture=area-forecast` を追加する（開発ビルド限定、本番では無視）。合成 `AreaTimeseriesResponse` を本番と同じ `buildAreaForecastCard`・モデル・パネル表・`DetailDialog`・`DetailTimeSeriesTable` に通し、「確認用データ」と明示する。この名前のときだけ `useAreaForecast` のポーリングを無効化する（#56 の `earlyWarningFixtureGate` と同形）。現在時刻を含む JST の3時間区間を先頭から3つ目に置き（過去2区間を含める）、区間14・時点15を作り、次を含める。

- 天気: 晴れ・くもり・雨・雪・雨または雪・雨か雪・雪か雨（アイコン）、表に無い長い文字「くもり一時雨」（2行折返し確認）、`valueText` null（欠測）。パネル3列の中に、アイコンあり・文字代替・欠測が揃うよう配置する
- 風: 階級1〜6すべて、`valueCode='7'`（unknown）、風向「北北西」（`unit='８方位漢字'`、16方位の矢羽根）、風向「北北西」（`unit='１６方位漢字'`、矢羽根）、方位文字だが16方位表に無い合成値「北北北西」（漢字代替）、風向「静穏」（方向なし「ー」、合成値。実電文では未確認）、風向の値なし（参照欠落 → `?`）
- 気温: 負値、`valueNumber` null・`valueText` あり、欠測、区間の無い最終列
- 日付境界を2回以上またぐ

## 7. 寸法の揺れ防止

全状態で次の寸法を固定し、状態によってレイアウトが動かないことを受け入れ条件にする（AC-8）。

| 対象 | 固定する寸法 |
| --- | --- |
| 列幅 | パネル・詳細とも全データ列 `inline-size: 4rem`（詳細は `TimeSeriesColumn.width`）。結合セルは span×4rem。区間の無い列も同幅。パネルは3列未満でも各列 4rem |
| 見出し | パネルは時点行1段、詳細は日付行＋時点行の2段で各1行固定。日付の空欄セルも同じ高さ |
| 天気行 | `block-size` 固定（アイコン 24px＋名称2行分）。アイコンあり／文字代替／長文字（2行で打切り、全文は `aria-label` と `title`）／欠測 `?`／`none`／フォント未読込で同じ高さ、内容は上下左右中央 |
| 風行 | 上段（矢羽根 24×24px の固定枠のみ。風向の漢字行は置かない）と下段（範囲）の2段固定。矢羽根は塗り1層で枠内に置き、フロー上の幅を増やさない。行見出し列と値セルは重ならない（AC-19）。16方位表に無い方位文字・フォント未読込で漢字を代替表示する場合、方向なし「ー」、風向欠測 `?` も同じ 24px 高の枠内（1行、はみ出しは省略記号）に収め、unknown 階級・`20以上`・欠測・`none` でも枠を残し、高さ・幅が同じ |
| 気温行 | 1行固定。負値・文字値・欠測・`none` で同じ高さ |
| パネル表 | 行見出し列は残り幅（#56 と同じ配分）。「表示できる時間帯はありません」表示は表を置かない |
| 状態 | stale／available の切替で寸法差なし。取得中・失敗は既存 `InfoPanelFrame` の表示のまま |

## 8. 未決事項

Q1〜Q6 と風速表示方式は 2026-09-28 のユーザー回答で解決済み（§2.2-6〜10）。UI監修（§2.2-11〜14）で生じた Q7・Q8 もオーナー回答で解決した。UI監修（2026-09-29、§2.2-18・19）に伴う Q9 もオーナー回答で解決した（§2.2-20）。

- ~~Q7~~: 解決（オーナー決定 2026-09-28、§2.2-15）。
- ~~Q8~~: 解決（オーナー決定 2026-09-28、§2.2-16。既存「 · 」のまま）。

- Q9: 解決済み（§2.2-20、例外として受容）。

## 9. 受け入れ条件

- [ ] AC-1: east / trc の双方で `GET /api/weather/area-timeseries` を `controlStatus` 付きで呼ぶ。応答の `controlStatus` / `isTraining` 不一致、`capabilities` 欠落は取得失敗として扱うことを単体テストで確認する。parser・DB・API・`packages/shared`・`docs/basic-design.md` に差分が無い（`git diff --stat main...HEAD` で確認）。
- [ ] AC-2: モデル単体テストで、`values` の配列順や `sequence` をシャッフルしても同じ表になり、`refId` は同一 `blockId` 内の `timeId` だけに結合される。ブロックをまたいで同じ `refId` がある入力、対応 `timeDefine` の無い値、同一 ref の重複値（→ missing）、区間の重なり・逆転（→ invalid）、区間の無い最終列（→ none、見出し「0時」）を検証する。気温・風速の補間値が生成されない。9時の気温が9時から始まる区間と同じ列に置かれる。
- [ ] AC-3: サンプル `apps/api/tests/fixtures/jma/24_11_03_190925_VPFD51.xml` 相当の DTO（テスト内で構築）から、区間数・時点数どおりの列とセルが生成され、詳細の表は全列を持つ。列見出しが「6時」…「21時」「0時」の1段で、区間の範囲表記（「6-9時」等）が DOM に無い。最終の「0時」列は気温だけを持ち、天気・風は空セル（読み上げ「対象外」）。
- [ ] AC-4: パネル3列の単体テスト: 現在区間の開始列から最大3列、境界 `now = timeTo` で次の区間、現在区間なしで未来の先頭から、3列未満、過去だけの保持値で「表示できる時間帯はありません」。パネルに横スクロール（`overflow-x` によるスクロール可能領域）が無いことを DOM で確認する。
- [ ] AC-5: #59 対応表の単体テスト: 晴れ→`sunny`、くもり→`cloud`、雨→`rainy`、雪→`weather_snowy`、雨または雪・雨か雪・雪か雨→`rainy_snow`。空文字・「くもり一時雨」・前後空白付き「晴れ 」は `icon: null` で原文表示。null は missing。アイコン付きでも名称は原文のまま表示される。
- [ ] AC-6: 風速単体テスト: `'1'`〜`'6'` が `0-2`、`3-5`、`6-9`、`10-14`、`15-19`、`20以上` と §5.1 の塗り色トークンになり、`'0'`・`'7'`・`'4.0'`・全角 `'４'` は unknown で原文表示・矢羽根は `--md-sys-color-on-surface`（階級色なし）、null は missing。風向は16方位表の全16語で固定表どおりの回転角を矢羽根に適用し、8方位の8語は #55 の `classifyWindDirection(text, '８方位漢字')` と同じ角度になる。`unit` が `'８方位漢字'` と `'１６方位漢字'` のどちらでも同じ角度、それ以外の `unit`（null を含む）は漢字表示。16方位表に無い方位文字（例「北北北西」）は矢羽根なしで枠内に原文漢字、方位文字以外（例「静穏」「風向不定」「微風」「風弱く」）は枠内に「ー」、`wind_direction` の値が無い（参照欠落）ときは枠内に点線 `?`（§4.1a）。矢羽根を描いた場合の漢字は画面のテキスト（`textContent` の可視部分）に現れず `aria-label` にだけ含まれる。気温は `12℃`・`-3℃`、文字値、欠測 `?`。
- [ ] AC-7: `?panelFixture=area-forecast`（開発ビルド、端末選択後）で、パネルのヘッダーに1行「東京地方／東京（北の丸公園） · HH:MM発表」、本文に旧2行の対象表記が無いこと、時点1段の見出し、風セルに風向の漢字が無いこと、天気・風（m/s）・気温の3行、現在を含む3列、アイコン＋名称、文字代替、階級色と範囲、欠測 `?`、「確認用データ」が表示される。詳細を開くと過去を含む全列が横スクロールで閲覧でき、日付・時点の2段見出し、ダイアログ対象表記「東京地方／東京（北の丸公園）」、区間の無い最終列の空セル、階級1〜6すべてが表示される。スクリーンショットを検収記録に残す。
- [ ] AC-8: 同フィクスチャで `getBoundingClientRect()` により、パネル・詳細の全データ列の幅が 64px（ルート16px時）±1px、結合セルが span×64px ±1px、天気行のアイコンあり・文字代替・長文字・欠測・none セルの高さ差1px以内、風行の各状態（階級1〜6・16方位の矢羽根・16方位表に無い方位文字の漢字代替・方向なし「ー」・風向欠測 `?`・unknown・`20以上`・欠測・none）の高さ差1px以内、漢字代替が 24px 枠を越えない、矢羽根要素の外接矩形が 24×24px ±1px、気温行の各状態の高さ差1px以内、見出しの空欄セルと有字セルの高さ差1px以内であることを測る。stale 版のカード（単体テストのレンダリング比較でも可）で表の幅・行高が変わらない。
- [ ] AC-9: 各データセル・見出しの `aria-label` に完全日付（年・月・日・曜日）と「○時から○時」（区間）／「○時」（時点）が含まれ、天気・風向（例「北西の風」）・範囲・気温・「欠測」「風向欠測」「風向なし（原文）」「対象外」を読み上げで区別できる。天気・風は「○時から○時」、気温は「○時」で読み上げられる。アイコン・矢羽根は `aria-hidden`。
- [ ] AC-10: 詳細を開閉でき、#61 のフォーカス・スクロール復帰を維持する。`stickyHeader` の吸着、`bodyDateBoundaries` の日付境界線、初期列がパネル先頭列であることを確認する。追加の予報要素・凡例が無い。
- [ ] AC-11: 共用部品の復元: `git diff main -- apps/web/src/map/detail/DetailTimeSeriesTable.tsx` が空で、`intervalHeaderCells`・`cornerLabels.interval` が `apps/web` のどこにも無い（`git grep -n intervalHeaderCells -- apps/web` が0件）。`apps/web/tests/detailTimeSeriesTable.test.ts` の中段見出し関連テストも削除され、#55・#56 の既存テストが変更なしで通る。対象表記: `resolvePanelTarget('east'|'trc', 'areaForecast')` が「東京地方／東京（北の丸公園）」を返し、他パネルの戻り値は変わらない。API のコード不一致時に API 名称で上書きされることを単体テストで確認する。
- [ ] AC-12: 状態: 初回取得中はヘッダーに時刻・「取得中」なし、保持値なし失敗・`unavailable`・`data=null` は失敗表示で詳細なし、stale は前回値を装飾なしで表示、`issuedAt=null` は「発表時刻不明」。`fetchedAt` を発表時刻に使わない。`area.code`・`station.code` が想定値のとき固定表記、不一致のとき API の名称になる。以上を単体テストで確認する。
- [ ] AC-13: 風速色: 新しい `--wx-*` トークン定義が追加されていない（`git diff main...HEAD -- apps/web/src/theme` が空）。風セルの背景が塗られていない（算出 `background-color` が表の通常セルと同じ）。矢羽根が1層だけ（輪郭用の Outlined 要素が風セルに無い）で、算出 `color` が §5.1 の階級対応の nowcast 値、範囲表記の算出 `color` が通常の文字色トークン値であることを、ダークテーマのフィクスチャ上で `getComputedStyle` により確認する。塗り色6色とパネル背景（`surface-container`）・詳細背景（`surface-container-high`）のダークでのコントラスト比を、テーマ生成関数の出力から計算する単体テストで確認し、3:1 以上であること（階級3は確定事項20により例外とし、テストでは 3:1 未満であることを既知の例外として明示する）。`git grep -nE '#[0-9a-fA-F]{3,8}\b|rgb\(' -- apps/web/src/map/panels/areaForecast` が0件。ダークテーマのスクリーンショットをオーナーの主観確認に回す。
- [ ] AC-14: `?panelFixture=area-forecast` で地域時系列 API の fetch 呼出しが0件であることを、#56 AC-16 と同じ hook mount 方式の**自動テスト**でポーリング1周期以上進めて確認する。別 fixture 名・クエリなしでは初回1件以上と再呼出しがある。本番ビルド相当ではクエリが無効で合成データも「確認用データ」も出ない。
- [ ] AC-15: 読み込み量の記録: (1) `npm run build -w apps/web` の JS 合計サイズを main と比較し増分を記録する。(2) `index.html` の既存 Material Symbols Outlined の `<link>` が1文字も変わっていないことを `git diff` で確認する。(3) 追加した塗りつぶし用 `<link>` が `icon_names=navigation` を含み、開発サーバーでの実際のフォント応答（woff2）のサイズを記録する。統括実測（Outlined 同条件約1.1KB）と桁が同じ（数KB 以下）であることを確認し、数十KB 以上なら差し戻す。
- [ ] AC-16: 既存フィクスチャ（`all-content`、`mixed`、`early-warning`、`warning-timeseries` 等）と #55・#56 のパネル・詳細表示・既存テストに回帰が無い。`warningTimeSeriesModel.ts`（`classifyWindDirection` を含む）に差分が無い。
- [ ] AC-17: `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/web` が成功し、変更範囲が §3.1 のファイルに限られる。
- [ ] AC-18: フォント読み込み失敗時: 開発ツールで `fonts.gstatic.com` / `fonts.googleapis.com` を遮断した状態（またはフォント状態をモックした単体テスト）で、風セルに `navigation` 等のリガチャ文字列が表示されず、8方位の風向は矢羽根領域 24px に風向の漢字（例「北西」）が代替表示され（§4.1a）、方向なしの語は「ー」、欠測は `?` のまま、範囲表記が表示される。天気セルは名称だけになる。遮断前後で風行・天気行の高さ・列幅が変わらない（差1px以内）。
- [ ] AC-19: 行見出しと値の配置（UI監修 2026-09-29 の実画面の崩れの明文化）: `?panelFixture=area-forecast` のパネル表と詳細表の両方で、DOM の `getBoundingClientRect()` により次を確認する。(a) 各行の行見出しセル（「天気」「風（m/s）」「気温」）の右端が、同じ行の1列目の値セル・その中の矢羽根要素・範囲表記の左端以下であり、矩形が重ならない（風の行で「風（m/s）」と1列目の矢羽根が重ならない）。(b) 同じ列の値セル（天気・風・気温）の `left` と `width` が全行で一致し（差1px以内）、各セル内の内容（アイコン・矢羽根・「15℃」等の文字）の水平中心がセルの水平中心と一致する（差1px以内）。気温の1列目の値が行見出しの直後に寄らない。(c) 詳細では横スクロール前と、右端までスクロールした後の両方で (a)(b) が成り立つ（固定の行見出し列が値セルに重なって見える場合は、行見出しの背景が不透明で値が行見出しの下に潜るだけであることを確認し、値セルの座標は (b) を満たす）。

## 10. 棚卸し項目の結論

- **AD-H046**（XML明細の未抽出項目）: G7 に必要な項目は保存済みの天気文字・風向・風速階級・気温で足り、保存追加は不要。風速範囲は API の未保存項目を使わずフロントの固定表（Ｒ１資料・実電文と照合済み）で示す。天気コード・日別天気・6時間降水確率・最高/最低気温は未抽出のまま将来課題とし、「該当なし」と混同しない（`unsupportedFields` を尊重）。
- **AD-H050**（区間と時点）: 同一 `blockId` 内の `refId`–`timeId` 参照で結合し、区間は列結合、時点は開始側の一致列に置く。区間と時点は見出し行を分けて区別する。配列添字結合・風速実数補間・気温補間をしない。
- **AD-H051**（天気アイコンの入力境界）: 入力は3時間区間の天気文字（`valueText`）とし、完全一致の固定表（7語）で Material Symbols を引く。天気コードは使わない。表に無い文字は文字代替。

## 11. 後続への引き継ぎ

- 最高・最低気温（朝の最低／日中の最高）、日別天気と天気コード、6時間降水確率は将来課題（ユーザー判断 2026-09-28）。熱中症関連情報は別途将来拡張で検討する。
- 風向の `condition`（やや強く／強く／風弱く）は未保存。表示が必要になれば parser 拡張が要る。現行 parser は3時間区間の空テキストの `WindDirection`（「風弱く」形）を電文全体の「未対応構造」とするため、実運用で出現した場合は地域時系列全体が更新されない。parser 側の課題として Issue #229 で起案済み（本 Issue の対象外）。
- 公式資料と実電文の天気語彙の不一致（§2.3）は、実運用電文の蓄積後に再照合する。
- Material Symbols を CDN から読むため、LAN 限定環境（#208）でフォントが得られない場合はアイコン・矢羽根が出ず、天気名称・矢羽根枠の風向漢字（§4.1a）・範囲表記だけになる（§5.3、意味は失わない）。
- nowcast データ色を転用しているため、雨雲凡例の色を変更すると矢羽根の塗り色も変わる（塗り色のコントラストは要件外）。

## 12. 基本設計への追記案（本 Issue では basic-design.md を編集しない）

§5.11「表の構成」の末尾に次を追記する案:

> パネルは警報級の可能性（§5.9）と同じく、現在を含む区間から3列だけを表示し横スクロールしない。全区間・全時点の閲覧は詳細ダイアログで横スクロールにより行う（2026-09-28 ユーザー決定）。

§5.11 の既存記述を次のとおり改める案（2026-09-28 オーナー決定による【確定】事項の変更）:

- 対象の画面表記: 「天気・風：東京地方」「気温：東京（北の丸公園）」の2表記に代えて、パネル見出しを1行「東京地方／東京（北の丸公園）・XX:00発表」とし、詳細ダイアログの対象表記も「東京地方／東京（北の丸公園）」とする。
- 表の構成: 「区間値と時点値の違いは、列見出しの時刻表記（例: 区間は「9-12時」、時点は「9時」）で区別する」を、「列見出しは時点「9時」だけとし、天気・風のセルはその時刻から3時間の区間、気温はその時刻の値として読む（気象庁ホームページと同じ読み方）。区間の意味は読み上げで補う」に改める。
- 風の表示: 風向の漢字は画面に出さず、矢羽根と読み上げで示す。

§5.11「風速の表示」の末尾に次を追記する案:

> 階級の色は雨雲ナウキャスト凡例のデータ色を転用し（階級1→nowcast-1、2→2、3→4、4→5、5→6、6→7）、セル背景ではなく矢羽根（塗りつぶしの `navigation` 1層）に付ける。天気アイコンは3時間区間の天気文字から Material Symbols の固定表で引き、表に無い文字は文字だけで表示する。
