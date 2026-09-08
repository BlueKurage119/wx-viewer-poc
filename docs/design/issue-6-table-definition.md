# テーブル定義書（Issue #6 実装分）

作成日: 2026-09-09

`apps/api/migrations/0001`〜`0008` の実 DDL を転記したリファレンス。後続 Issue（Epic C・Epic E・B3〜B6）がテーブル構造を素早く参照するためのもので、設計意図は [issue-6-info-type-schema.md](issue-6-info-type-schema.md) を正とする。migration を追加・変更したときはこのファイルも更新する。

## 1. テーブル一覧

| migration | テーブル | 役割 |
| --- | --- | --- |
| 0001 | `warning_current_snapshot` | 現況警報の現在値（区域×電文ステータス） |
| 0001 | `warning_current_item` | 現況警報の現象別明細 |
| 0002 | `warning_timeseries_snapshot` | 警報等時系列の現在値 |
| 0002 | `warning_timeseries_time_define` | 警報等時系列の時間定義 |
| 0002 | `warning_timeseries_value` | 警報等時系列の値 |
| 0003 | `early_warning_snapshot` | 早期注意情報の現在値（区域×`segment`×電文ステータス） |
| 0003 | `early_warning_time_define` | 早期注意情報の時間定義 |
| 0003 | `early_warning_cell` | 早期注意情報の現象×時間セル |
| 0004 | `area_timeseries_snapshot` | 地域時系列予報の現在値 |
| 0004 | `area_timeseries_time_define` | 地域時系列予報の時間定義（`block_id` 別） |
| 0004 | `area_timeseries_value` | 地域時系列予報の値 |
| 0005 | `radar_snapshot` | レーダーの現在値（`N1`/`N2`） |
| 0005 | `radar_frame` | レーダーのフレーム（時刻） |
| 0005 | `radar_tile` | レーダーのタイル画像メタ（ファイル本体は DB 外） |
| 0006 | `risk_snapshot` | キキクルの現在値（レイヤー別） |
| 0006 | `risk_frame` | キキクルのフレーム |
| 0006 | `risk_tile` | キキクルのタイル画像メタ |
| 0007 | `amedas_snapshot` | アメダスの現在値（地点別） |
| 0007 | `amedas_observation` | アメダスの観測時刻×要素 |
| 0008 | `bosai_bulletin` | 気象防災速報（1 EventID＝1 行、単層） |
| 0008 | `bosai_bulletin_area` | 速報の対象区域 |

`__schema_migrations` は Issue #5 で作成される migration 管理表。

## 2. 共通列

### 2.1 共通メタ情報（全スナップショット表と `bosai_bulletin`）

| 列 | 型 | 制約 |
| --- | --- | --- |
| `source` | TEXT | NOT NULL, CHECK (`source <> ''`) |
| `issued_at` | TEXT | NOT NULL |
| `valid_at` | TEXT | — |
| `valid_from` | TEXT | — |
| `valid_to` | TEXT | — |
| `fetched_at` | TEXT | NOT NULL |
| `last_success_at` | TEXT | — |
| `availability` | TEXT | NOT NULL, CHECK IN (`available`, `stale`, `unavailable`) |
| `source_version` | TEXT | — |

時刻は UTC ISO 8601 文字列。`CURRENT_TIMESTAMP` の DEFAULT は使わない。

### 2.2 電文列（XML 由来の表：0001〜0004、`bosai_bulletin`）

| 列 | 型 | 制約 |
| --- | --- | --- |
| `control_status` | TEXT | NOT NULL, CHECK IN (`normal`, `training`, `test`) |
| `info_type` | TEXT | NOT NULL |
| `event_id` | TEXT | NULL 可（`bosai_bulletin` のみ NOT NULL） |
| `report_datetime` | TEXT | NOT NULL |
| `control_datetime` | TEXT | NOT NULL |

レーダー・キキクル・アメダス（0005〜0007）は電文列を持たない。

全表の主キーは `id INTEGER PRIMARY KEY`。以下の各表では `id`・共通メタ列・電文列を省略する。

## 3. 現況警報（0001）

### warning_current_snapshot

| 列 | 型 | 制約 |
| --- | --- | --- |
| `area_code` | TEXT | NOT NULL |
| `area_name` | TEXT | NOT NULL |

UNIQUE `(area_code, control_status)`

### warning_current_item

| 列 | 型 | 制約 |
| --- | --- | --- |
| `snapshot_id` | INTEGER | NOT NULL → `warning_current_snapshot(id)` CASCADE |
| `sequence` | INTEGER | NOT NULL |
| `kind_code` / `kind_name` / `kind_status` | TEXT | NOT NULL |
| `last_kind_code` / `last_kind_name` | TEXT | — |
| `significancy_code` / `significancy_name` | TEXT | — |
| `warning_level` | TEXT | — |
| `attention_text` | TEXT | — |
| `kind_issued_at` | TEXT | — |
| `source_telegram` | TEXT | NOT NULL |

UNIQUE `(snapshot_id, kind_code)`

## 4. 警報等時系列（0002）

### warning_timeseries_snapshot

`area_code` TEXT NOT NULL / `area_name` TEXT NOT NULL。UNIQUE `(area_code, control_status)`

### warning_timeseries_time_define

| 列 | 型 | 制約 |
| --- | --- | --- |
| `snapshot_id` | INTEGER | NOT NULL → `warning_timeseries_snapshot(id)` CASCADE |
| `block_id` / `time_id` | TEXT | NOT NULL |
| `sequence` | INTEGER | NOT NULL |
| `time_from` / `time_to` | TEXT | NOT NULL |
| `duration` | TEXT | — |

UNIQUE `(snapshot_id, block_id, time_id)`

### warning_timeseries_value

| 列 | 型 | 制約 |
| --- | --- | --- |
| `snapshot_id` | INTEGER | NOT NULL |
| `block_id` / `ref_id` | TEXT | NOT NULL |
| `kind_code` / `kind_name` / `kind_status` | TEXT | NOT NULL |
| `value_category` | TEXT | NOT NULL（`risk` / `quantity`） |
| `property_type` / `value_type` / `value_text` | TEXT | NOT NULL |
| `unit` / `area_division` | TEXT | — |
| `sequence` | INTEGER | NOT NULL |

FK `(snapshot_id, block_id, ref_id)` → `warning_timeseries_time_define(snapshot_id, block_id, time_id)` CASCADE / FK `(snapshot_id)` → `warning_timeseries_snapshot(id)` CASCADE

## 5. 早期注意情報（0003）

### early_warning_snapshot

| 列 | 型 | 制約 |
| --- | --- | --- |
| `area_code` / `area_name` | TEXT | NOT NULL |
| `segment` | TEXT | NOT NULL, CHECK IN (`near`, `far`) |
| `telegram_type` | TEXT | NOT NULL |

UNIQUE `(area_code, segment, control_status)`

### early_warning_time_define

`snapshot_id` INTEGER NOT NULL → `early_warning_snapshot(id)` CASCADE / `time_id` TEXT NOT NULL / `sequence` INTEGER NOT NULL / `time_from`・`time_to` TEXT NOT NULL / `duration` TEXT。UNIQUE `(snapshot_id, time_id)`

### early_warning_cell

| 列 | 型 | 制約 |
| --- | --- | --- |
| `snapshot_id` | INTEGER | NOT NULL |
| `ref_id` | TEXT | NOT NULL |
| `phenomenon_code` / `phenomenon_name` | TEXT | NOT NULL |
| `rank_value` | TEXT | —（「なし」は文字列、未提供は NULL） |
| `condition` | TEXT | —（`値なし` 等の原文） |

FK `(snapshot_id, ref_id)` → `early_warning_time_define(snapshot_id, time_id)` CASCADE / FK `(snapshot_id)` → `early_warning_snapshot(id)` CASCADE。UNIQUE `(snapshot_id, ref_id, phenomenon_code)`

## 6. 地域時系列予報（0004）

### area_timeseries_snapshot

`area_code`・`area_name`・`station_code`・`station_name` すべて TEXT NOT NULL。UNIQUE `(area_code, station_code, control_status)`

### area_timeseries_time_define

`warning_timeseries_time_define` と同一列構成（親は `area_timeseries_snapshot(id)` CASCADE）。UNIQUE `(snapshot_id, block_id, time_id)`

### area_timeseries_value

| 列 | 型 | 制約 |
| --- | --- | --- |
| `snapshot_id` | INTEGER | NOT NULL |
| `block_id` / `ref_id` / `element` | TEXT | NOT NULL |
| `value_code` / `value_text` / `unit` | TEXT | — |
| `value_number` | REAL | — |
| `sequence` | INTEGER | NOT NULL |

FK `(snapshot_id, block_id, ref_id)` → `area_timeseries_time_define(snapshot_id, block_id, time_id)` CASCADE / FK `(snapshot_id)` → `area_timeseries_snapshot(id)` CASCADE。UNIQUE `(snapshot_id, block_id, ref_id, element)`

## 7. レーダー（0005）

### radar_snapshot

`product` TEXT NOT NULL, CHECK IN (`N1`, `N2`)。UNIQUE `(product)`

### radar_frame

`snapshot_id` INTEGER NOT NULL → `radar_snapshot(id)` CASCADE / `base_time`・`valid_time`・`element`・`member` TEXT NOT NULL / `sequence` INTEGER NOT NULL。UNIQUE `(snapshot_id, base_time, valid_time, element, member)`

### radar_tile

| 列 | 型 | 制約 |
| --- | --- | --- |
| `frame_id` | INTEGER | NOT NULL → `radar_frame(id)` CASCADE |
| `zoom` / `tile_x` / `tile_y` | INTEGER | NOT NULL |
| `file_path` | TEXT | NOT NULL（保存ルートからの相対パス） |
| `byte_size` | INTEGER | NOT NULL |
| `content_hash` | TEXT | NOT NULL |
| `stored_at` | TEXT | NOT NULL |

UNIQUE `(frame_id, zoom, tile_x, tile_y)`。画像バイナリ用の BLOB 列は持たない。

## 8. キキクル（0006）

### risk_snapshot

`layer` TEXT NOT NULL, CHECK IN (`heavyrain`, `inund`, `land`, `flood`)。UNIQUE `(layer)`

### risk_frame

`radar_frame` と同構成だが `element` の代わりに `image_id` TEXT NOT NULL。親は `risk_snapshot(id)` CASCADE。UNIQUE `(snapshot_id, base_time, valid_time, image_id, member)`

### risk_tile

`radar_tile` と同一列構成。`frame_id` → `risk_frame(id)` CASCADE。UNIQUE `(frame_id, zoom, tile_x, tile_y)`

## 9. アメダス（0007）

### amedas_snapshot

`station_code` / `station_name` TEXT NOT NULL。UNIQUE `(station_code)`

### amedas_observation

| 列 | 型 | 制約 |
| --- | --- | --- |
| `snapshot_id` | INTEGER | NOT NULL → `amedas_snapshot(id)` CASCADE |
| `observed_at` / `element` | TEXT | NOT NULL |
| `value_number` | REAL | —（欠測は NULL、0 で埋めない） |
| `value_text` | TEXT | — |
| `quality_flag` | INTEGER | — |

UNIQUE `(snapshot_id, observed_at, element)`

## 10. 気象防災速報（0008）

### bosai_bulletin

| 列 | 型 | 制約 |
| --- | --- | --- |
| `event_id` | TEXT | NOT NULL（完全な EventID） |
| `title` / `headline_text` / `information_tag` | TEXT | NOT NULL |
| `is_cancelled` | INTEGER | NOT NULL, CHECK IN (0, 1) |

＋ 共通メタ列・電文列。UNIQUE `(event_id, control_status)`

### bosai_bulletin_area

| 列 | 型 | 制約 |
| --- | --- | --- |
| `bulletin_id` | INTEGER | NOT NULL → `bosai_bulletin(id)` CASCADE |
| `area_code` / `area_name` / `code_type` | TEXT | NOT NULL |
| `sequence` | INTEGER | NOT NULL |

UNIQUE `(bulletin_id, area_code, code_type)`

江東区包含判定の結果列（`relation` 等）は持たない。判定は `apps/api/src/repositories/bosaiBulletinRepository.ts` の `KOTO_INCLUDED_AREA_CODES`（`1310800` / `130012` / `130010`）を使い、読み出し時に行う。

## 11. 制約サマリ

### 11.1 UNIQUE 制約（UPSERT 競合ターゲット）

| テーブル | 列組 |
| --- | --- |
| `warning_current_snapshot` | `(area_code, control_status)` |
| `warning_current_item` | `(snapshot_id, kind_code)` |
| `warning_timeseries_snapshot` | `(area_code, control_status)` |
| `warning_timeseries_time_define` | `(snapshot_id, block_id, time_id)` |
| `early_warning_snapshot` | `(area_code, segment, control_status)` |
| `early_warning_time_define` | `(snapshot_id, time_id)` |
| `early_warning_cell` | `(snapshot_id, ref_id, phenomenon_code)` |
| `area_timeseries_snapshot` | `(area_code, station_code, control_status)` |
| `area_timeseries_time_define` | `(snapshot_id, block_id, time_id)` |
| `area_timeseries_value` | `(snapshot_id, block_id, ref_id, element)` |
| `radar_snapshot` | `(product)` |
| `radar_frame` | `(snapshot_id, base_time, valid_time, element, member)` |
| `radar_tile` | `(frame_id, zoom, tile_x, tile_y)` |
| `risk_snapshot` | `(layer)` |
| `risk_frame` | `(snapshot_id, base_time, valid_time, image_id, member)` |
| `risk_tile` | `(frame_id, zoom, tile_x, tile_y)` |
| `amedas_snapshot` | `(station_code)` |
| `amedas_observation` | `(snapshot_id, observed_at, element)` |
| `bosai_bulletin` | `(event_id, control_status)` |
| `bosai_bulletin_area` | `(bulletin_id, area_code, code_type)` |

`warning_timeseries_value` に UNIQUE 制約はない。

### 11.2 外部キーと CASCADE

すべての外部キーが `ON DELETE CASCADE`。`PRAGMA foreign_keys = 1` が前提（Issue #5 の `openDatabase` が設定）。

```text
warning_current_snapshot   ← warning_current_item
warning_timeseries_snapshot ← warning_timeseries_time_define ← warning_timeseries_value
                            ← warning_timeseries_value（snapshot_id 単独）
early_warning_snapshot     ← early_warning_time_define ← early_warning_cell
                            ← early_warning_cell（snapshot_id 単独）
area_timeseries_snapshot   ← area_timeseries_time_define ← area_timeseries_value
                            ← area_timeseries_value（snapshot_id 単独）
radar_snapshot             ← radar_frame ← radar_tile
risk_snapshot              ← risk_frame ← risk_tile
amedas_snapshot            ← amedas_observation
bosai_bulletin             ← bosai_bulletin_area
```

### 11.3 CHECK 制約

| テーブル | 制約 |
| --- | --- |
| 全スナップショット表・`bosai_bulletin` | `source <> ''` / `availability IN ('available','stale','unavailable')` |
| 0001〜0004・`bosai_bulletin` | `control_status IN ('normal','training','test')` |
| `early_warning_snapshot` | `segment IN ('near','far')` |
| `radar_snapshot` | `product IN ('N1','N2')` |
| `risk_snapshot` | `layer IN ('heavyrain','inund','land','flood')` |
| `bosai_bulletin` | `is_cancelled IN (0,1)` |

トリガーは 0 件。自動削除・TTL・ローテーションは存在しない。

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
