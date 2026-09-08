# Issue #6「B2. 情報種別ごとのテーブル・スキーマ設計」設計

作成日: 2026-09-09

## 1. 目的

基本設計 §6.1・§6.2 の情報種別単位（現況警報／警報等時系列／早期注意／地域時系列／レーダー／キキクル／アメダス／気象防災速報）ごとに、正規化後データを保存する SQLite のテーブルを設計し、B1 で確立した forward-only マイグレーションとして実装する。あわせて、各テーブルへの保存・取得・削除を行うリポジトリ層と、その CRUD 単体テストを追加する。

本 Issue は保存先の形だけを扱う。気象庁からの取得・パース・正規化（Epic C）、REST エンドポイントとレスポンス組み立て（Epic E）、受信履歴・通知出力履歴・操作記録（B3〜B5）、履歴削除 API（B6）は実装しない。

## 2. 参照資料と確定事項

### 2.1 参照資料

- [Issue #6](https://github.com/BlueKurage119/wx-viewer-poc/issues/6)
- [基本設計](../basic-design.md) §5.5〜§5.12、§6.1、§6.2、§6.3、§8.1
- [取得方法レポート](../data-acquisition-report.md) §2〜§5
- [Issue 化ドラフト](../issues-draft.md) B2
- [Issue #3 設計](issue-3-common-metadata.md)（`CommonMetadata` / `Availability`）
- [Issue #5 設計](issue-5-sqlite-persistence.md)（migration 規則、`DatabaseConnection`、`initializeDatabase`）
- 実装済みの `apps/api/src/database/index.ts`（`initializeDatabase` / `runMigrations` のシグネチャ）

### 2.2 ヒアリングで確定した事項

1. 8 情報種別すべてを個別テーブル群として設計する。共通メタ情報の列（`source`、`issued_at`、`valid_at`／`valid_from`／`valid_to`、`fetched_at`、`last_success_at`、`availability`、`source_version`）は各テーブルで共通の列定義とし、業務列は種別ごとに実データ構造へ即して個別に設計する。8 種別を無理に統合しない。
2. 各種別は「最新 1 件の現在値」に加えて、1 回の発表に含まれる複数時刻・区間を同一種別内の多行として表現する。発表ごとの履歴蓄積は行わない（履歴は B3 の責務）。新しい発表を受信したら、その情報種別・対象地域の現在値は最新発表の内容で置き換える。
3. レーダー・キキクルのタイル画像はファイルシステムに保存し、DB にはパス・時刻・種別等のメタ情報だけを持つ。画像バイナリを BLOB 列に格納しない。

### 2.3 基本設計・取得方法レポートから引き継ぐ確定事項

- `availability` は `available` / `stale` / `unavailable` の 3 状態（§6.3）。boolean や OK/NG へ縮退させない。`stale` では保持済みの前回正常値を削除しない。
- 履歴・前回正常値は明示的に削除するまで保持する（§8.1）。本 Issue のテーブルにも自動削除・TTL・トリガーによるローテーションを設けない。
- 訓練・試験（`Control/Status`）は通常の画面へ混入させない（取得方法レポート §3.1）。本設計では通常・訓練・試験を保存キーの一部として分離する。
- 対象地域コードは文字列として保持し、異なるコード体系を混同しない（同 §2）。江東区 `1310800`、東京地方 `130010`、東京地点 `44132`、江戸川臨海 `44136`。
- 警報等時系列・地域時系列予報は `TimeDefines` と `refID` の対応を同一ブロック内で結合する（同 §3.3、§3.5）。異なるブロックの同じ ID を混ぜない。
- 早期注意情報の「なし」と `condition="値なし"` は別の意味であり、区別して保持する（同 §3.4、基本設計 §5.9）。
- 気象防災速報は完全な EventID を更新単位とし、親番だけの上書きで別の速報を消さない（同 §3.6）。
- レーダー・キキクルは提供された時刻のみを扱い、存在しないフレームを埋めない（同 §4、§4.1）。

## 3. スキーマ設計の方針

### 3.1 テーブルの二層構成

各情報種別は次の二層で表現する。

- **スナップショット表**（種別ごとに 1 表）: 「その情報種別・対象・電文ステータスにおける現在値」を 1 行で表し、共通メタ情報列を持つ。
- **明細表**（種別ごとに 0〜複数表）: 1 回の発表に含まれる時刻・区間・現象・観測項目を多行で表す。スナップショット行への外部キーを持ち、`ON DELETE CASCADE` で親に従属する。

明細行は親スナップショットに完全従属させ、明細表には共通メタ情報列を重複させない。共通メタ情報は「1 回の取得・発表」に付随する属性であり、行ごとに複製すると同一発表内で不整合な `availability` が生じ得るためである。ヒアリング確定事項 1 の「各テーブルで共通の列定義」は、8 種別のスナップショット表がすべて同一の共通メタ列定義を持つこととして実現する。

例外は気象防災速報で、1 件の速報（完全な EventID 単位）そのものが独立した発表であるため、速報行自体が共通メタ情報列を持つ（§4.8）。

### 3.2 上書き（置き換え）の単位

スナップショット表は、次の一意キーで UPSERT する。新しい発表を保存すると、同一キーの既存行と、その配下の明細行を置き換える。

```text
(対象を識別する列…, control_status)
```

`control_status`（`normal` / `training` / `test`）を一意キーへ含めることで、訓練・試験の受信が通常の現在値を上書きしない。読み出し側は必ず `control_status` を条件に指定する。既定値は設けず、書き込み時に明示させる。

置き換えは「親行の DELETE → INSERT」ではなく「親行の UPSERT ＋ 明細の全件削除 ＆ 再挿入」を 1 トランザクションで行う。親行の `id` を維持することで、B3 以降が採用結果を参照する際のキー安定性を保つ。

### 3.3 共通メタ情報列の定義

すべてのスナップショット表（および `bosai_bulletin`）に、次の列を同一定義で置く。

| 列 | 型 | 制約 | 対応する `CommonMetadata` |
| --- | --- | --- | --- |
| `source` | TEXT | NOT NULL、空文字禁止 | `source` |
| `issued_at` | TEXT | NOT NULL | `issuedAt` |
| `valid_at` | TEXT | NULL 可 | `validAt` |
| `valid_from` | TEXT | NULL 可 | `validFrom` |
| `valid_to` | TEXT | NULL 可 | `validTo` |
| `fetched_at` | TEXT | NOT NULL | `fetchedAt` |
| `last_success_at` | TEXT | NULL 可 | `lastSuccessAt` |
| `availability` | TEXT | NOT NULL、`CHECK (availability IN ('available','stale','unavailable'))` | `availability` |
| `source_version` | TEXT | NULL 可 | `sourceVersion` |

時刻はすべて UTC の ISO 8601 文字列（Issue #3 の `UtcIso8601String`）。SQLite に日時型はないため TEXT とし、比較は文字列比較で行える形式（`YYYY-MM-DDTHH:MM:SSZ` 等）に揃える。形式の実行時検証はリポジトリ層で行い、SQL の CHECK 制約では非空判定までに留める（正規表現検証を SQLite の CHECK へ持ち込まない）。

XML 由来の種別には、共通メタに加えて次の列を置く。

| 列 | 型 | 内容 |
| --- | --- | --- |
| `control_status` | TEXT NOT NULL CHECK IN ('normal','training','test') | `Control/Status`。訓練・試験の分離キー |
| `info_type` | TEXT NOT NULL | `Head/InfoType`（発表／訂正／取消等）の原文 |
| `event_id` | TEXT NULL | `Head/EventID`。実東京電文では空のため NULL 可 |
| `report_datetime` | TEXT NOT NULL | `Head/ReportDateTime`（＝`issued_at` の由来）と別に原文を保持 |
| `control_datetime` | TEXT NOT NULL | `Control/DateTime`。版の新旧判定に使う |

`issued_at` は共通契約側、`report_datetime` / `control_datetime` は電文原文側であり、両者を統合しない。取得方法レポート §3.1 が「発信・発表・基点・受信時刻を別々に保持する」ことを求めているためである。

### 3.4 テーブル名・列名の規約

- テーブル名・列名は小文字スネークケース。共通シェルや API の型名とは独立に、SQL 側の語彙で命名する。
- 主キーは `id INTEGER PRIMARY KEY`（rowid エイリアス）。
- 一意制約は名前付き `UNIQUE (...)` 制約として宣言し、UPSERT の競合ターゲットに使う。
- 明細表の並び順は `sequence INTEGER NOT NULL` で明示し、rowid 順に依存しない。
- コード値（現象コード、危険度コード、天気コード等）は TEXT として保持する。取得方法レポート §3.2 が「コード番号の大小から危険度を推測しない」ことを求めているため、整数比較の余地を作らない。
- 未知コード・未対応構造は、対応する原文文字列を保持し、`NULL` や既定値へ丸めない。

## 4. 情報種別ごとのテーブル定義

以下は列の意図を示す定義であり、DDL の最終形は migration ファイルとする。すべてのスナップショット表に §3.3 の共通メタ列と XML 系の追加列（レーダー・キキクル・アメダスを除く）が入る。以下では種別固有の列だけを列挙する。

### 4.1 現況警報（VPWW55–61 / VPWS50）

スナップショット表 `warning_current_snapshot`

| 列 | 内容 |
| --- | --- |
| `area_code` | 対象地域コード（江東区 `1310800`） |
| `area_name` | 区域名の原文 |
| 一意キー | `(area_code, control_status)` |

明細表 `warning_current_item`（現象単位の現況バッジ 1 個に対応）

| 列 | 内容 |
| --- | --- |
| `snapshot_id` | 親 FK、`ON DELETE CASCADE` |
| `sequence` | 表示順 |
| `kind_code` | `Warning/Item/Kind/Code`（TEXT） |
| `kind_name` | `Kind/Name` の原文 |
| `kind_status` | `Kind/Status`（発表／継続／解除等の原文） |
| `last_kind_code` / `last_kind_name` | `LastKind` の原文（NULL 可） |
| `significancy_code` / `significancy_name` | 危険度の `Significancy`（NULL 可、種別コードとは別辞書） |
| `warning_level` | 警戒レベル（TEXT、NULL 可。レベルを冠さない種別は NULL） |
| `attention_text` | `Property` / `Addition` から得た付加事項・補足（TEXT、NULL 可） |
| `kind_issued_at` | 当該現象の `Kind/DateTime`（NULL 可）。集約と個別の優先判定に使う |
| `source_telegram` | この現象の採用元電文種別（例 `VPWW55`、`VPWS50`） |
| 一意キー | `(snapshot_id, kind_code)` |

解除された現象は行を残さない（基本設計 §5.4「現況パネルから外す」）。解除の履歴は B3 が持つ。「正常に発表なしを確認した」状態は、明細 0 件のスナップショット行（`availability='available'`）で表現し、スナップショット行の不在（未取得）と区別する。

### 4.2 警報等時系列（VPWP50）

スナップショット表 `warning_timeseries_snapshot`

| 列 | 内容 |
| --- | --- |
| `area_code` / `area_name` | 江東区 |
| 一意キー | `(area_code, control_status)` |

明細表 `warning_timeseries_time_define`

| 列 | 内容 |
| --- | --- |
| `snapshot_id` | 親 FK |
| `block_id` | 同一 `TimeSeriesInfo` ブロックの識別子（TEXT）。異ブロックの `timeId` 衝突を防ぐ |
| `time_id` | `TimeDefine@timeId` の原文 |
| `sequence` | ブロック内の並び順 |
| `time_from` / `time_to` | 区間の開始・終了 |
| `duration` | `Duration` の原文（NULL 可） |
| 一意キー | `(snapshot_id, block_id, time_id)` |

明細表 `warning_timeseries_value`

| 列 | 内容 |
| --- | --- |
| `snapshot_id` | 親 FK |
| `block_id` / `ref_id` | 参照する `time_define` の `block_id` + `time_id` |
| `kind_code` / `kind_name` | 現象 |
| `kind_status` | `Kind/Status`（発表／継続） |
| `value_category` | `risk`（危険度）または `quantity`（量的予想） |
| `property_type` | `Property/Type` の原文（雨、風、雪、波、高潮等） |
| `value_type` | 値の種類の原文（最大値・範囲・階級等） |
| `value_text` | 値の原文文字列 |
| `unit` | 単位の原文（NULL 可） |
| `area_division` | 陸上／海上・細分類の原文（NULL 可） |
| `sequence` | 並び順 |
| 外部キー | `(snapshot_id, block_id, ref_id)` → `warning_timeseries_time_define(snapshot_id, block_id, time_id)` |

`value_text` を数値列にしない。取得方法レポート §3.3 が「最大値・範囲等を単なる現在値にしない」ことを求めており、範囲・階級・以上表現を単一 REAL へ丸めると原文が失われるためである。数値化は表示・通知判定の各 Issue で、単位と区分を保った上で行う。

### 4.3 早期注意情報／警報級の可能性（VPFD61 / VPFW60）

スナップショット表 `early_warning_snapshot`

| 列 | 内容 |
| --- | --- |
| `area_code` / `area_name` | 東京地方 `130010` |
| `segment` | `near`（明後日まで＝VPFD61）／`far`（明々後日以降＝VPFW60） |
| `telegram_type` | `VPFD61` / `VPFW60` |
| 一意キー | `(area_code, segment, control_status)` |

2 電文の発表時刻が異なり得るため（基本設計 §5.9）、前半・後半を別スナップショット行として保持する。`segment` を含めた一意キーにより、片方の取得失敗が他方の現在値を消さない。

明細表 `early_warning_time_define`（`snapshot_id`、`time_id`、`sequence`、`time_from`、`time_to`、`duration`）と `early_warning_cell`

| 列 | 内容 |
| --- | --- |
| `snapshot_id` | 親 FK |
| `ref_id` | `time_define.time_id` |
| `phenomenon_code` / `phenomenon_name` | 現象（大雨、土砂災害、雨 等の原文） |
| `rank_value` | `PossibilityRankOfWarning` の原文（例 `高`、`中`、`なし`） |
| `condition` | `condition` 属性の原文（例 `値なし`、NULL 可） |
| 一意キー | `(snapshot_id, ref_id, phenomenon_code)` |

「なし」は `rank_value='なし'`、「値なし」は `condition='値なし'` かつ `rank_value IS NULL` として保持し、両者と行不在（構造上提供されない・未取得）を区別する。取得できていない状態を `rank_value` の既定値で埋めない。VPFW60 に残る明後日部分は保存対象に含めてよいが、`segment='far'` の行として保持し、表示時の切り分けは Epic C/E が行う。

### 4.4 地域時系列予報（VPFD51）

スナップショット表 `area_timeseries_snapshot`

| 列 | 内容 |
| --- | --- |
| `area_code` / `area_name` | 東京地方 `130010` |
| `station_code` / `station_name` | 気温地点 東京 `44132` |
| 一意キー | `(area_code, station_code, control_status)` |

天気・風（3 時間区間）と気温（3 時間ごとの時点値）は別の `TimeDefines` を持つため、明細表 `area_timeseries_time_define` に `block_id`（例 `weather`、`wind`、`temperature`）を置き、`(snapshot_id, block_id, time_id)` を一意キーとする。配列番号での横並びを構造上できないようにする。

明細表 `area_timeseries_value`

| 列 | 内容 |
| --- | --- |
| `snapshot_id`、`block_id`、`ref_id` | 時間定義への参照（複合 FK） |
| `element` | `weather` / `wind_direction` / `wind_speed_rank` / `temperature` |
| `value_code` | 天気コード・風向コード・風速階級（TEXT、NULL 可） |
| `value_text` | 表示用の原文（天気名称、風向名称等、NULL 可） |
| `value_number` | 気温など数値として提供される値（REAL、NULL 可） |
| `unit` | 単位の原文（NULL 可） |
| `sequence` | 並び順 |
| 一意キー | `(snapshot_id, block_id, ref_id, element)` |

風速階級 1〜6 は `value_code` に階級のまま保持し、m/s へ換算した値を列に持たない（取得方法レポート §3.5）。

### 4.5 レーダー（雨雲ナウキャスト）

スナップショット表 `radar_snapshot`

| 列 | 内容 |
| --- | --- |
| `product` | `N1`（実況）／`N2`（予測）。基準時刻が異なるため独立に保持する |
| 一意キー | `(product)` |

XML 由来ではないため `control_status` 等の電文列は持たない。共通メタ列は持つ（`source` に取得元 URL の識別子、`issued_at` に最新 basetime、`source_version` は NULL）。N1 と N2 を別行にすることで、片方の障害時に他方を `available` のまま残せる（取得方法レポート §4）。

明細表 `radar_frame`

| 列 | 内容 |
| --- | --- |
| `snapshot_id` | 親 FK |
| `base_time` | 14 桁時刻由来の UTC ISO 8601 |
| `valid_time` | 同上 |
| `element` | 例 `hrpns` |
| `member` | 時刻一覧が示す値（レーダーでは `none` を含む。固定値としてハードコードしない） |
| `sequence` | 時刻順 |
| 一意キー | `(snapshot_id, base_time, valid_time, element, member)` |

タイルメタ表 `radar_tile`

| 列 | 内容 |
| --- | --- |
| `frame_id` | `radar_frame` への FK、`ON DELETE CASCADE` |
| `zoom` / `tile_x` / `tile_y` | タイル座標（INTEGER） |
| `file_path` | タイル保存ルートからの相対パス（TEXT NOT NULL） |
| `byte_size` | INTEGER NOT NULL |
| `content_hash` | 小文字 16 進 SHA-256（TEXT NOT NULL） |
| `stored_at` | 保存時刻 |
| 一意キー | `(frame_id, zoom, tile_x, tile_y)` |

画像バイナリは保持しない（ヒアリング確定事項 3）。保存ルートは §5.2 で定義する。

### 4.6 キキクル（危険度分布）

スナップショット表 `risk_snapshot`

| 列 | 内容 |
| --- | --- |
| `layer` | `heavyrain` / `inund` / `land` / `flood` |
| 一意キー | `(layer)` |

レイヤーごとに時刻一覧と凡例が独立するため、レイヤー単位で `availability` を持つ。明細表 `risk_frame` は `radar_frame` と同じ列に加えて `image_id`（`rain_mesh` / `inund` / `land` 等）を持ち、`member` は時刻一覧の値（`immed0` / `immed1` / `none` 等）をそのまま保存する。一意キーは `(snapshot_id, base_time, valid_time, image_id, member)`。

タイルメタ表 `risk_tile` は `radar_tile` と同じ列構成とし、`frame_id` は `risk_frame` を参照する。レーダーと同形でも 1 表に統合しない（ヒアリング確定事項 1、および時刻管理・保存先ディレクトリが独立するため）。

洪水キキクルは PBF／GeoJSON の複合であり、取得方法レポート §4.1 で「単一 PNG では公式画面を再現できない」「流路フィーチャのデコード・描画は未検証」とされている。本 Issue では `layer='flood'` の行を保存できる構造だけを用意し、ベクタ資産用の列・表は追加しない（§8 未確認事項）。

### 4.7 アメダス（江戸川臨海）

スナップショット表 `amedas_snapshot`

| 列 | 内容 |
| --- | --- |
| `station_code` / `station_name` | `44136` / 江戸川臨海 |
| 一意キー | `(station_code)` |

明細表 `amedas_observation`（1 観測時刻 × 1 要素で 1 行）

| 列 | 内容 |
| --- | --- |
| `snapshot_id` | 親 FK |
| `observed_at` | 観測時刻（UTC ISO 8601。JST ブロック由来でも保存は UTC） |
| `element` | 実 JSON のキー名（`temp`、`humidity`、`wind`、`windDirection`、`precipitation1h` 等） |
| `value_number` | REAL、NULL 可 |
| `value_text` | 数値化できない原文（NULL 可） |
| `quality_flag` | 配列第 2 要素の aqc（INTEGER、NULL 可） |
| 一意キー | `(snapshot_id, observed_at, element)` |

- 欠測は行を作らないか `value_number IS NULL` とし、`0` で埋めない（基本設計 §5.10 確定）。観測非対応の要素（積雪・気圧）は行自体を作らない。欠測・観測非対応・取得失敗の 3 区分は、行の値 NULL・行不在・スナップショットの `availability` で表し分ける。
- `quality_flag` は保存のみ行い、本 Issue では表示・判定の意味づけをしない（同 §5.10 の品質注記の扱い）。
- 詳細ダイアログの直近 24 時間推移（§5.13）に備え、明細は最新 1 時点だけでなく取得済みの複数観測時刻を保持できる構造とする。**保持する時間幅の上限は本 Issue では未確定とし、Epic C（取得・正規化処理）へ委譲することがヒアリングで確定している。** したがって本 Issue のスキーマ・リポジトリには保持時間幅による自動削除・件数上限を一切実装しない（古い明細の削除は Epic C が明示的に呼ぶ削除操作で行う）。

### 4.8 気象防災速報（VPBS50）

この種別だけは、1 件の速報が独立した発表であるため、行ごとに共通メタ情報列を持つ単層構成とする。

表 `bosai_bulletin`

| 列 | 内容 |
| --- | --- |
| 共通メタ列 | §3.3 のとおり（`valid_from` は発表時刻、`valid_to` は電文に明示された期限がある場合のみ。表示 3 時間ルールは保存側で解決しない） |
| 電文列 | `control_status`、`info_type`（発表／訂正／取消）、`event_id`（完全な EventID、NOT NULL）、`report_datetime`、`control_datetime` |
| `title` | `Head/Title` |
| `headline_text` | `Headline/Text` |
| `information_tag` | `Headline/Information@type` の原文 |
| `is_cancelled` | INTEGER 0/1。取消電文を受けた状態 |
| 一意キー | `(event_id, control_status)` |

明細表 `bosai_bulletin_area`

| 列 | 内容 |
| --- | --- |
| `bulletin_id` | 親 FK、`ON DELETE CASCADE` |
| `area_code` / `area_name` | 対象区域 |
| `code_type` | codeType の原文 |
| `sequence` | 並び順 |
| 一意キー | `(bulletin_id, area_code, code_type)` |

**江東区包含判定は保存しない（確定）**: 当初案では判定結果を `relation`（`direct`／`wide`／`other`）列として保存し CHECK 制約で表現していたが、ヒアリングの結果、**判定結果を列として持たず、電文どおりの対象区域コード（`area_code` / `code_type`）だけを保存し、江東区を含むかどうかは読み出し時に都度判定する**方針に確定した。理由は、判定基準（対象とみなす区域コードの集合）が Epic C・Epic E の実装過程で変わり得るのに対し、保存済みの判定結果は基準変更時に全行の再計算を要し、古い基準の結果が静かに残るためである。1 件の速報が複数区域を対象とする場合は、従来どおり明細表に区域ごとの複数行として保持する。

判定は `1310800`（江東区）→ `130012`（東京地方の細分）→ `130010`（東京地方）の包含関係（取得方法レポート §3.6）に基づく。**実装場所はリポジトリ層**とし、`apps/api` のリポジトリモジュール内に江東区の上位区域コード列（`['1310800', '130012', '130010']`）を定数として置き、`listBosaiBulletins` がその列に含まれる `area_code` を持つ明細行の存在で親行を絞り込む。`direct`／`wide` の区別が表示側で必要になった場合は、返却した明細行の `area_code` から呼び出し側（Epic C／E）が導出する。伊豆諸島など江東区を含まない区域だけを対象とする速報も保存され、江東区向けの絞り込み結果には含まれない。

**上書き単位についての注意（確定）**: 他の 7 種別と異なり、新しい速報を受信しても既存の別 EventID の行は削除しない。速報は「同一対象の最新スナップショット」ではなく「個別の発表の集合」であり、3 時間の表示期間（基本設計 §5.5）は表示側の判定であって保存側の削除条件ではないためである。訂正・取消は同一 `event_id` 行の UPSERT で反映する。**この「速報テーブルだけ、明示的な削除まで行が残り続ける」挙動はヒアリング済みの確定事項であり、本 Issue では保持上限・自動削除を設けない**（削除 API は B6）。

## 5. モジュール・ファイル構成

### 5.1 追加・変更するファイル

```text
apps/api/
├── migrations/
│   ├── 0001_create_warning_current.sql
│   ├── 0002_create_warning_timeseries.sql
│   ├── 0003_create_early_warning.sql
│   ├── 0004_create_area_timeseries.sql
│   ├── 0005_create_radar.sql
│   ├── 0006_create_risk.sql
│   ├── 0007_create_amedas.sql
│   └── 0008_create_bosai_bulletin.sql
├── src/
│   └── repositories/
│       ├── types.ts                     # 共通メタ・行型・入力型
│       ├── snapshot.ts                  # 共通メタ列の read/write ヘルパー
│       ├── warningCurrentRepository.ts
│       ├── warningTimeseriesRepository.ts
│       ├── earlyWarningRepository.ts
│       ├── areaTimeseriesRepository.ts
│       ├── radarRepository.ts
│       ├── riskRepository.ts
│       ├── amedasRepository.ts
│       ├── bosaiBulletinRepository.ts
│       └── index.ts
└── tests/
    ├── repositories.test.ts             # 各リポジトリの CRUD
    └── schema.test.ts                   # スキーマ制約・CASCADE・自動削除不在
```

migration は情報種別ごとに 1 ファイルとし、B1 の規則（`NNNN_<name>.sql`、forward-only、`BEGIN`/`COMMIT` を書かない、適用済みファイルを編集しない）に従う。B1 で `migrations/` は空のまま残されているため、本 Issue が `0001` から採番する。

### 5.2 タイル画像の保存先

タイル本体は DB ファイルと同じ `apps/api/data/` 配下に置き、Git 管理外とする（B1 で `.gitignore` に `apps/api/data/` を追加済み）。

| 用途 | 既定パス |
| --- | --- |
| タイル保存ルート | `apps/api/data/tiles` |
| レーダー | `tiles/radar/<product>/<baseTime>/<validTime>/<element>/<z>/<x>/<y>.png` |
| キキクル | `tiles/risk/<layer>/<baseTime>/<validTime>/<imageId>/<member>/<z>/<x>/<y>.png` |

- DB には保存ルートからの相対パスだけを格納する。絶対パスを格納すると、`WX_VIEWER_DB_PATH` を変えたときや別環境でレコードが無効になるためである。
- 保存ルートは `WX_VIEWER_TILE_ROOT` で上書きでき、未指定時は上記既定値。解決規則は B1 の `WX_VIEWER_DB_PATH` と同じく、絶対パスはそのまま、相対パスは API workspace ルート基準とする。
- 相対パスは `..` とパス区切りの先頭 `/` を禁止し、リポジトリ層で検証する。DB 由来の文字列をそのままファイルパスへ連結しない。
- 本 Issue ではタイルのダウンロード・書き込み処理を実装しない。リポジトリはメタ行の CRUD と、パス文字列の妥当性検証だけを担う。ファイル本体の削除・整合（孤児ファイルの掃除）は Epic C／B6 の課題として §7 に引き継ぐ。

### 5.3 リポジトリ層の契約

```ts
// apps/api/src/repositories/types.ts
import type { Availability, UtcIso8601String } from '@wx-viewer-poc/shared';

export type ControlStatus = 'normal' | 'training' | 'test';

export interface SnapshotMetadataInput {
  readonly source: string;
  readonly issuedAt: UtcIso8601String;
  readonly validAt: UtcIso8601String | null;
  readonly validFrom: UtcIso8601String | null;
  readonly validTo: UtcIso8601String | null;
  readonly fetchedAt: UtcIso8601String;
  readonly lastSuccessAt: UtcIso8601String | null;
  readonly availability: Availability;
  readonly sourceVersion: string | null;
}

export interface TelegramMetadataInput {
  readonly controlStatus: ControlStatus;
  readonly infoType: string;
  readonly eventId: string | null;
  readonly reportDateTime: UtcIso8601String;
  readonly controlDateTime: UtcIso8601String;
}
```

各リポジトリは同じ形の関数を公開する（現況警報の例）。

```ts
export interface WarningCurrentSnapshotInput {
  readonly areaCode: string;
  readonly areaName: string;
  readonly metadata: SnapshotMetadataInput;
  readonly telegram: TelegramMetadataInput;
  readonly items: readonly WarningCurrentItemInput[];
}

export interface WarningCurrentSnapshot extends WarningCurrentSnapshotInput {
  readonly id: number;
}

export function saveWarningCurrentSnapshot(
  connection: DatabaseConnection,
  input: WarningCurrentSnapshotInput,
): WarningCurrentSnapshot;

export function findWarningCurrentSnapshot(
  connection: DatabaseConnection,
  areaCode: string,
  controlStatus: ControlStatus,
): WarningCurrentSnapshot | null;

export function deleteWarningCurrentSnapshot(
  connection: DatabaseConnection,
  areaCode: string,
  controlStatus: ControlStatus,
): boolean;
```

- 各リポジトリは `DatabaseConnection` を第 1 引数で受け取り、モジュールスコープに接続を保持しない（B1 §3.2 の方針）。
- `save*` は親の UPSERT と明細の全削除・再挿入を 1 トランザクション（`better-sqlite3` の `transaction()`）で行う。途中失敗時に旧内容が半端に消えた状態を残さない。
- `find*` は `controlStatus` を必須引数とし、既定値を持たせない。訓練データを通常の読み出しへ混入させないためである。
- すべての SQL は prepared statement と bind parameter を使い、値を文字列連結しない。
- `availability`、`controlStatus`、タイル相対パスは、DB の CHECK に到達する前にリポジトリ層で検証し、判別不能な値を保存しようとした場合は例外にする。
- DB 行型は API workspace 内部に閉じ、`packages/shared` や HTTP 契約へ露出させない（Issue #3・#5 の引き継ぎ事項）。
- 気象防災速報は `saveBosaiBulletin`（1 件単位の UPSERT）、`listBosaiBulletins`（`controlStatus` と、江東区を含むかの絞り込みオプション `includesKoto?: boolean` で絞り込み。`includesKoto: true` のとき、明細に `1310800` / `130012` / `130010` のいずれかを持つ速報だけを返す。判定結果は保存せず毎回 SQL で評価する）、`deleteBosaiBulletin`（`eventId` 単位）とし、「全消し → 再挿入」の API を設けない。

## 6. テスト設計

`apps/api/tests` に 2 ファイルを追加する。B1 と同じく `mkdtemp` で一時ディレクトリを作り、`initializeDatabase` に本番 `migrations/` を指すコンフィグを渡して実スキーマを適用する。テストごとに DB ファイルを分離し、開発用 DB を共有しない。アサーションは原則完全一致とする。

### 6.1 スキーマ検証（`schema.test.ts`）

1. 本番 migration をすべて適用すると、設計した全テーブルが `sqlite_master` に存在し、`__schema_migrations` の適用件数が migration ファイル数と一致する。
2. 8 種別のスナップショット表（および `bosai_bulletin`）が §3.3 の共通メタ列をすべて持ち、列名・NOT NULL 指定が一致する（`PRAGMA table_info` で完全一致比較）。
3. `availability` に `available` / `stale` / `unavailable` 以外を入れると CHECK 違反になる。3 値はいずれも保存できる。
4. `control_status` に `normal` / `training` / `test` 以外を入れると CHECK 違反になる。
5. 親スナップショットを削除すると、明細行が `ON DELETE CASCADE` で消える。外部キー無効化に依存しないよう、`PRAGMA foreign_keys` が `1` であることも確認する。
6. 明細行を親不在で挿入すると外部キー違反になる。
7. 各表に自動削除の仕組み（トリガー）が存在しない。`sqlite_master` の `type='trigger'` が 0 件であることを確認する（B6 の前提）。
8. migration を 2 回適用しても再実行されない（`appliedVersions` が空配列）。

### 6.2 CRUD 検証（`repositories.test.ts`）

各情報種別について次を確認する。

1. `save*` した内容を `find*` で完全一致で取得できる。共通メタの `null` 許容フィールド（`validAt`、`validFrom`、`validTo`、`lastSuccessAt`、`sourceVersion`）が `null` のまま往復する。
2. 同一キーで新しい発表を `save*` すると、スナップショット行の `id` が変わらず、明細が新しい発表の内容へ完全に置き換わる（旧明細が残らない）。
3. `controlStatus='training'` で保存しても、`controlStatus='normal'` の `find*` 結果が変化しない。逆も同様。訓練行と通常行が同時に存在できる。
4. `delete*` で親と明細が消え、再取得が `null` になる。
5. `availability='stale'` を保存しても、保持済みの明細行が削除されない。
6. 種別固有の確認
   - 警報等時系列・地域時系列予報: 異なる `block_id` に同じ `time_id` が存在しても値の参照先が混ざらない。存在しない `ref_id` を参照する値行は外部キー違反になる。
   - 早期注意: `rank_value='なし'` の行と `condition='値なし'` の行が別の値として往復し、行不在と区別できる。`near` と `far` を独立に保存・更新でき、片方の削除が他方に影響しない。
   - 現況警報: 明細 0 件かつ `availability='available'` のスナップショット（正常に発表なし）を保存・取得でき、スナップショット不在（未取得）と区別できる。
   - レーダー・キキクル: `N1` と `N2`（およびレイヤー別）のスナップショットが独立し、片方を `unavailable` にしても他方の明細が残る。タイル行は相対パス・サイズ・ハッシュを保持し、`..` を含むパスや絶対パスの保存が例外になる。フレーム削除でタイル行が CASCADE で消える。
   - アメダス: 欠測（`value_number IS NULL`）と観測非対応（行不在）を区別して往復し、`0` へ変換されない。同一 `observed_at` の複数要素、複数 `observed_at` を同時に保持できる。
   - 気象防災速報: 別 EventID の速報を続けて保存しても既存行が消えない。同一 EventID の訂正で内容が置き換わる。取消で `is_cancelled=1` になり行は残る。江東区を含まない区域コード（例: 伊豆諸島）だけを対象とする速報が、`includesKoto: true` の絞り込み結果に含まれず、絞り込みなしの結果には含まれる。明細に `130010` だけを持つ速報も `includesKoto: true` の結果に含まれる（包含関係の上位区域で拾えている）。

### 6.3 テストの有効性確認

B1 §9.4 と同じ手順を踏む。

1. 実装前にテストを追加し、対象 migration／リポジトリが未実装で失敗すること（red）を確認する。
2. 空白やローカル変数名だけの意味を変えない改変でテストが成功し続ける対照実験を行い、「常に失敗する／常に成功する」故障モードでないことを確かめる。
3. 対象変異を 1 つずつ加え、対応テストが失敗することを確認する。少なくとも次を行う。
   - `find*` から `control_status` 条件を外す（訓練分離テストが落ちること）
   - 明細の全件削除を省いて再挿入だけ行う（置き換えテストが落ちること）
   - `ON DELETE CASCADE` を外した migration に差し替える（CASCADE テストが落ちること）
   - `availability` の CHECK 制約を外す（制約テストが落ちること）
   - `listBosaiBulletins` の江東区包含判定から上位区域コード（`130012` / `130010`）を除く（広域速報の絞り込みテストが落ちること）
4. 変異を元に戻し、対象テストが再度成功することを確認する。一時変更はコミットしない。

## 7. 受け入れ条件

検収担当は次を上から順に実行する。

1. `npm run build` が成功する。
2. `npm run typecheck`、`npm run lint`、`npm run format:check` がいずれもエラー 0 で終了する。
3. `npm run test -w apps/api` が全件成功する。
4. `apps/api/migrations` に `0001`〜`0008` の 8 ファイルが存在し、いずれも `BEGIN` / `COMMIT` / `ROLLBACK` を含まない（`grep -iE '^\s*(begin|commit|rollback)' apps/api/migrations/*.sql` が 0 件）。
5. 一時 DB を指定して API サーバーを起動すると（`WX_VIEWER_DB_PATH=<一時パス> npm run dev` もしくはビルド後の起動）、起動ログに新規適用 migration 件数 8 が出て、`/api/health` が `{"status":"ok"}` を返す。
6. その DB ファイルに対し `sqlite3 <path> ".tables"` 相当の確認で、§4 に定義した全テーブル（8 種別のスナップショット表、各明細表、`radar_tile`、`risk_tile`、`bosai_bulletin`、`bosai_bulletin_area`）が存在する。
7. 8 種別のスナップショット表（および `bosai_bulletin`）について、`PRAGMA table_info` に `source` / `issued_at` / `valid_at` / `valid_from` / `valid_to` / `fetched_at` / `last_success_at` / `availability` / `source_version` の 9 列がすべて含まれる。
8. `availability` に `available` / `stale` / `unavailable` 以外の値を INSERT すると SQLite が CHECK 制約違反を返す。3 値はいずれも INSERT できる。
9. `control_status='training'` の行を保存した後、`control_status='normal'` での取得結果が保存前と完全一致で変わらない。
10. 同一キーへ 2 回目の `save*` を行うと、スナップショット行が 1 件のまま、明細が 2 回目の内容だけになる（1 回目の明細が 0 件になる）。
11. スナップショット行を削除すると、対応する明細行が 0 件になる。
12. `sqlite_master` に `type='trigger'` の行が 0 件である（自動削除処理が存在しない）。
13. タイル表に画像バイナリ用の BLOB 列が存在せず、`file_path` に相対パスを保存できる。`..` を含むパスや絶対パスの保存はリポジトリ層で例外になる。
14. アメダスの欠測値を保存して取得すると `null` のまま返り、`0` に変換されない。
15. 気象防災速報を 2 件（異なる EventID）保存した後も両方が取得でき、同一 EventID の訂正保存で内容だけが置き換わる。
15-1. `bosai_bulletin_area` の `PRAGMA table_info` に `relation` 列が存在しない（判定結果を保存していない）。`grep -n "relation" apps/api/migrations/*.sql` が 0 件。
15-2. 対象区域が `1310800` だけの速報 A、`130010` だけの速報 B、伊豆諸島の区域コードだけの速報 C を保存し、`listBosaiBulletins({ controlStatus: 'normal', includesKoto: true })` が A と B のみを返し、`includesKoto` 未指定では A・B・C の 3 件を返す。
16. 2 回目の起動で migration が再実行されず、1 回目に保存した行が完全一致で残る。
17. `git status --porcelain` に、設計書・migration・リポジトリ・テスト以外の変更が含まれない。`apps/api/data/` 配下が追跡対象になっていない。

## 8. 未確認事項

- **洪水キキクルのベクタ資産**: PBF／GeoJSON の構造・凡例・レベル変換は取得方法レポート §4.1 で未検証（取得した 1 タイルは 0 バイト）。本 Issue では `risk_snapshot.layer='flood'` の行を保存できる構造だけを用意し、ベクタ資産用の表・列を作らない。実挙動未確認。
- **タイルの取得ズーム範囲**: ズーム 10 以外は未検証（同 §4、§4.1）。`zoom` 列は整数で任意値を保持できるようにするが、取得対象ズームの決定は Epic C で行う。
- **PNG 色と降水強度・危険度レベルの対応**: 未検証。DB にレベル値の列を設けない。
- **速報の有効期限**: 専用の有効期限を確認できていない（同 §3.6）。`valid_to` は電文に明示がある場合のみ設定し、表示 3 時間ルール（基本設計 §5.5）を保存側の期限に読み替えない。
- **アメダスの極値・最大瞬間風速の集計期間と日付境界**: キーの存在のみ確認済みで解釈は未確認（同 §5）。`amedas_observation` の汎用 `element` 行として保存できるが、初期表示の必須項目にしない。
- **AQC フラグの業務上の意味**: 未確認（基本設計 §5.10）。`quality_flag` は保存のみで、意味づけを行わない。
- **VPWW61 の複数 Kind、指定河川氾濫等（VXKO 系）**: 現況警報の明細は `kind_code` 単位で複数行を保持できるが、河川別電文の地域対応は追加調査事項（取得方法レポート §3.2）。本 Issue では河川専用の表を作らない。
- **`source` の識別子体系と `sourceVersion` の値の由来**: Issue #3 §7 のとおり未確定。列は TEXT として用意し、値の規約は Epic C で決める。

## 9. 後続 Issue への引き継ぎ

- Epic C は本設計のリポジトリ関数を通じて正規化結果を保存する。`availability='stale'` では保存済みの明細を削除しない。訓練・試験電文は `controlStatus` を明示して保存し、通常の現在値を上書きしない。
- Epic C はタイル本体のダウンロードと保存、および孤児ファイル（DB 行のないタイル）の扱いを設計する。本 Issue はメタ行だけを扱う。
- Epic E は DB 行型を HTTP へ露出させず、`CommonMetadata` と種別ごとの payload 型へ変換する。`find*` 呼び出し時に `controlStatus='normal'` を指定し、訓練データを通常 API へ出さない。
- B3 の受信履歴表は、取得試行ごとに独立して追記するログである（成否問わず、原文を含む）。本 Issue のスナップショット表（B2）は、その B3 の上に構築される派生ビューという位置づけであり、B3 は B2 の上書き時だけ書かれる副産物ではない。本 Issue のテーブルには履歴を残さない。
- B6 は、本 Issue のテーブルに自動削除処理がないことを検証する。§6.1 のトリガー 0 件テストがその起点になる。
- **アメダス明細の保持時間幅の上限は Epic C が決める（確定・本 Issue 対象外）。** 本 Issue は複数観測時刻を保持できる構造だけを提供し、上限も削除契機も持たない。
- **気象防災速報は明示削除まで行が残り続ける（確定）。** 速報テーブルだけが「個別の発表の集合」であり、他 7 種別のような最新スナップショットへの置き換えを行わない。保持上限を設ける必要が生じた場合は B6 の履歴削除 API 側で扱う。
- **江東区包含判定はリポジトリ層の読み出し時判定で行う（確定）。** 判定に使う区域コード列（`1310800` / `130012` / `130010`）はリポジトリ層の定数であり、対象区域の追加・変更が必要になった場合は DB のデータ移行なしにこの定数の変更だけで済む。Epic C／E は判定結果を DB に書き戻さない。
- 追加の情報種別・列が必要になった場合は、適用済み migration を編集せず `0009` 以降を追加する。

## 10. 実装上の注意

- migration の SQL は 1 ファイル 1 情報種別に閉じ、他種別の表を参照しない。ファイル間に外部キーを張らない。
- `INSERT ... ON CONFLICT (...) DO UPDATE SET ...` を使う場合、競合ターゲットは名前付き UNIQUE 制約の列組と完全に一致させる。一致しないと UPSERT が INSERT として振る舞い、重複行が静かに増える。
- 時刻列に SQLite の `CURRENT_TIMESTAMP` を DEFAULT で使わない。`YYYY-MM-DD HH:MM:SS` 形式となり、ISO 8601 UTC 文字列と混在して文字列比較が壊れる。時刻は必ずアプリケーション側から渡す。
- `INTEGER` の 0/1 を boolean として使う列（`is_cancelled`）には `CHECK (is_cancelled IN (0,1))` を付ける。
- 検索に使う列（`area_code`、`control_status`、`event_id`、`observed_at`）は UNIQUE 制約でカバーされない組み合わせについてのみ索引を追加する。UNIQUE 制約は暗黙に索引を作るため、同じ列組へ索引を二重に作らない。
- 本 Issue では `apps/web` を変更しない。
