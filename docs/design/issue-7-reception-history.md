# Issue #7「B3. 受信履歴テーブルの設計・実装」設計

作成日: 2026-09-09

## 1. 目的

基本設計 §8.1・§8.2 が求める「受信履歴」を、**通信履歴（取得試行ごとの成否ログ）**と**電文履歴（XML 電文 1 件ごとの受信記録）**の 2 表として設計し、B1 で確立した forward-only マイグレーションとして実装する。あわせて追記・検索・単件削除を行うリポジトリ層と、その単体テストを追加する。

本 Issue は保存先の形だけを扱う。実際の気象庁データ取得・ポーリング（Epic C）、REST エンドポイント（Epic E）、通知出力履歴（B4）・操作記録（B5）、履歴削除 API（B6）は実装しない。自動削除・TTL・ローテーションは本 Issue でも一切設けない（基本設計 §8.1「明示的に削除するまで保持する」）。

## 2. 参照資料と確定事項

### 2.1 参照資料

- [Issue #7](https://github.com/BlueKurage119/wx-viewer-poc/issues/7)
- [基本設計](../basic-design.md) §8.1、§8.2、§8.3、§6.3、§7.3
- [取得方法レポート](../data-acquisition-report.md) §2、§2.1、§3.1、§3.6、§4、§4.1、§5、§8、§9
- [Issue 化ドラフト](../issues-draft.md) B3
- [Issue #3 設計](issue-3-common-metadata.md)（`UtcIso8601String` / `Availability`）
- [Issue #5 設計](issue-5-sqlite-persistence.md)（migration 規則、`DatabaseConnection`、`initializeDatabase`）
- [Issue #6 設計](issue-6-info-type-schema.md) §9（B2 → B3 の引き継ぎ）、[テーブル定義書](issue-6-table-definition.md)
- 実装済みの `apps/api/src/repositories/types.ts`（`ControlStatus`）、`apps/api/src/repositories/snapshot.ts`（`validate*` 群）、`apps/api/src/database/migrations.ts`（migration 検出・トランザクション制御禁止の実装）
- 気象庁配布のサンプル電文一式（`cmk-gsx/docs/260907_weather-data/jmaxml_20260723_Samples/`。§8 のサイズ実測に使用）

### 2.2 ヒアリングで確定した事項

1. **2 表構成とする。**
   - **通信履歴**（取得試行＝ HTTP リクエスト等ごとの成否ログ）: **全取得元共通**の 1 表とし、取得元種別を列に持つ。XML 定時・随時フィード、レーダー時刻一覧・タイル、キキクル時刻一覧・タイル、アメダスをすべてカバーする。1 回の取得試行で 1 行。成功・失敗の双方を記録する。
   - **電文履歴**（XML 電文単位の受信記録）: 発表時刻・受信時刻・種別・対象地域・発表／訂正／取消区分・採用結果・原文を持つ。対象は XML 由来の電文のみ。レーダー・キキクル・アメダスの非 XML 取得は電文履歴の対象外とし、通信履歴側だけで扱う。
   - 2 表は互いに独立させ、双方が独立に検索・保持でき、**片方の欠落が他方の記録を妨げない**こと。
2. **採用結果は自由記述文字列（TEXT）**とし、値の集合を列挙・CHECK 制約で縛らない。Epic C の判定ロジック実装時に文字列を追加できるようにする。
3. **電文原文は DB の TEXT 列に直接格納する。** タイル画像のようなファイルシステム＋パス参照にはしない。原文を取得できなかった場合は NULL。
4. **B2（情報種別スナップショット）とは外部キーで関連付けない。** 完全に独立したログとし、B2 のリファクタで B3 が壊れないようにする。画面側の紐付けが必要になった場合は、時刻・種別・対象地域等の値で読み出し時に対応付ける（Epic C／E の課題）。
5. **レーダー・キキクルのタイル取得の通信履歴は、1 フレーム単位でまとめて 1 行とする。**（追加ヒアリングで確定。当初の設計案「1 HTTP リクエスト＝ 1 行」は不採用）
   - 1 フレーム（product/layer・basetime・validtime で識別される 1 枚の画）の取得に属する複数タイルの GET をまとめ、`fetch_attempt` の 1 行として記録する。
   - `target_ref` にフレームの識別子（product/layer、base_time、valid_time 等）を入れる。
   - `response_bytes` / `duration_ms` はそのフレームに属する全タイル取得の合計値とする。
   - フレーム内の一部タイルだけが失敗した場合の `outcome` の決め方（部分失敗を `failure` とするか `success` とするか）は、**取得ズーム範囲・タイル枚数が未検証のため本 Issue では決めない。本 Issue はテーブル・型を提供するのみで、集計方針の決定は Epic C に委ねる。** 判断を後から下せるよう、フレーム内の総数と失敗数を `item_count` / `failed_item_count` として記録する（§3.1・§4.1）。
   - XML 電文・アメダス等、1 回の取得が 1 リソースに対応する取得元では従来どおり「1 リクエスト＝ 1 行」であり、`item_count` / `failed_item_count` は NULL でよい。
6. **採用結果の後追い更新でよい。**（統括確認済み）受信時点では `adoption_result` を NULL とし、判定後に `updateTelegramReceptionAdoption` で更新する（§3.4・§5.3）。
7. **「取得しなかった」記録は作らない。**（統括確認済み）`outcome` は `success` / `failure` の 2 値に留め、スケジュール停止中の非取得については行を作らない。304 Not Modified は `outcome='success'` かつ `http_status=304` で表現する。

### 2.3 基本設計・取得方法レポートから引き継ぐ確定事項

- 受信履歴は取得・処理エラーも確認できる構成とし、**電文本文を取得できなかった失敗は本文なしの取得試行記録として区別する**（§8.2）。→ 本設計では「通信履歴に `outcome='failure'` の行が立ち、電文履歴に対応行が存在しない」状態として表現する。
- 監視の判定基準は**新着の有無ではなく取得試行の成否**（§8.1）。取得元ごとに最終試行時刻・最終成功時刻・連続失敗回数・直近処理時間を独立に集計できる必要がある。→ 通信履歴に `source_kind` / `started_at` / `finished_at` / `duration_ms` / `outcome` を持ち、集計は読み出し側（Epic C／E）が行う。
- 入電履歴は「発表時刻・受信時刻・種別・対象地域・発表／訂正／取消・採用結果で検索。詳細で原文を閲覧」（§8.1）。→ 検索軸すべてを列（対象地域は明細表）とし、索引を張る。原文は詳細取得時のみ返す。
- `Control/Status`（通常・訓練・試験）を区別し、通常画面へ訓練・試験を混入させない（取得方法レポート §3.1）。→ 電文履歴に `control_status` を持ち、一覧関数で `controlStatus` を指定したときは他の値および NULL（不明）の行を返さない。
- `Control/DateTime`（発信）、`Head/ReportDateTime`（発表）、`TargetDateTime`（基点）、実際の受信時刻を**別々に保持する**（同 §3.1）。→ 4 列に分けて保持し、統合しない。
- URL／Atom ID で二重取得を避け、**本文ハッシュで同一内容を識別する**（同 §3.1）。Serial の大小や到着順だけで現行を決めない。→ `feed_entry_id` / `document_url` / `content_hash` / `serial` を保持し、判定ロジックは持たない。
- 実東京電文では `EventID` / `Serial` が空である（同 §3.1）。→ `event_id` / `serial` を NOT NULL にしない。
- 対象地域コードは文字列として保持し、異なるコード体系を混同しない（同 §2）。
- 未知コード・未対応構造を「なし」に変換せず、原文を保持して未対応として扱う（同 §3.1）。→ 種別・区分列はすべて原文文字列で保持し、正規化された列挙値へ丸めない。

## 3. スキーマ設計の方針

### 3.1 2 表の役割分担と独立性

| 表 | 単位 | 対象 | 書かれる条件 |
| --- | --- | --- | --- |
| `fetch_attempt`（通信履歴） | 1 回の取得試行（後述の「取得試行の単位」） | 全取得元 | 成否によらず必ず 1 行 |
| `telegram_reception`（電文履歴） | 1 件の XML 電文 | XML 由来のみ | 電文として識別できたときに 1 行（本文取得成功・解析失敗を含む） |

**取得試行の単位**（ヒアリング確定事項 5）:

| 取得元 | 1 行の単位 | `target_ref` | `item_count` / `failed_item_count` |
| --- | --- | --- | --- |
| XML フィード・個別電文、アメダス、時刻一覧（`targetTimes`・`latest_time.txt`） | 1 HTTP リクエスト | 電文 URL・地点コード等 | NULL |
| レーダー・キキクルのタイル | **1 フレーム**（そのフレームに属する複数タイルの GET をまとめたもの） | フレームの識別子（product/layer、base_time、valid_time 等） | フレーム内のタイル総数／失敗タイル数 |

- 1 回のフィード取得（`regular.xml` の GET）は `fetch_attempt` 1 行になる。そこから辿って個別電文を GET すると、電文ごとに `fetch_attempt` がもう 1 行ずつ立ち、対応する `telegram_reception` が 1 行ずつ立つ。
- タイルは 1 フレームの取得全体で 1 行である。**個々のタイル 1 枚ごとの成否は `fetch_attempt` 単体では区別できない。** `response_bytes` と `duration_ms` はそのフレームに属する全タイル取得の合計値であり、1 リクエスト分の値ではない。`request_url` にはフレームを代表する 1 本（例: 最初に要求したタイルの URL、もしくはタイル URL テンプレート）を入れる。`http_status` は代表値であり、フレーム内で応答が割れた場合は NULL としてよい（リポジトリ層は整合を検証しない）。
- **フレーム内の一部タイルだけが失敗したときに `outcome` をどちらにするかは本 Issue では決めない**（ヒアリング確定事項 5）。本 Issue はテーブル・型を提供するのみで、集計方針の決定は Epic C に委ねる。どちらの方針を採っても後から読み替えられるよう、`item_count`（フレーム内の取得対象タイル数）と `failed_item_count`（うち失敗した枚数）を列として持ち、部分失敗の事実を欠落させない。すなわち `failed_item_count = 0` が全成功、`0 < failed_item_count < item_count` が部分失敗、`failed_item_count = item_count` が全失敗であることは `outcome` の値によらず読み出せる。
- この 2 列を `response_bytes` 等で代替できないかを検討したが、合計バイト数からは枚数も成否も復元できず、`attempt_no`（同一目的の再試行回数）も別概念であるため、専用列 2 本の追加が最小の対応と判断した。列は NULL 可とし、1 リクエスト＝ 1 行の取得元には課さない。
- 本文を取得できなかった失敗（DNS 失敗・タイムアウト・HTTP エラー）は `fetch_attempt` の `outcome='failure'` 行だけで表現し、`telegram_reception` 行を作らない（§2.3 の「本文なしの取得試行記録」）。
- 本文は取れたが解析に失敗した場合は、`telegram_reception` 行を作り、`raw_body` に原文を入れ、解析できなかった列（`report_datetime` 等）を NULL のまま残し、採用結果に解析失敗を示す文字列を入れる。**解析できなかった項目を既定値で埋めない。**

### 3.2 2 表の関連付け

`telegram_reception.fetch_attempt_id` を**外部キー制約なしの参照値**として持つ（索引は張る）。

- `REFERENCES fetch_attempt(id)` を張らない理由: ヒアリング確定事項 1 の「片方の欠落が他方の記録を妨げない」を満たすため。FK を張ると、B6 が通信履歴だけを古い順に削除しようとしたときに、参照している電文履歴が残っていれば削除が失敗するか（`RESTRICT`）、電文履歴まで巻き添えで消える（`CASCADE`）。どちらも 2 表の独立性という確定事項に反する。
- したがって `fetch_attempt_id` は「対応付けできれば付ける」弱いリンクであり、参照先が存在しないことを許す。値が NULL の電文履歴（復旧処理でまとめて取り込んだ等）も正当な行として扱う。
- リポジトリ層は `fetch_attempt_id` の存在検証を行わない。整合性を DB に期待させないため、この点をコメントで明示する。

### 3.3 B2（情報種別スナップショット）との関係

ヒアリング確定事項 4 に従い、`0009` / `0010` の migration は B2 のテーブル名を一切参照しない。外部キー・ビュー・トリガーのいずれも作らない。受け入れ条件 §7-11 で grep により機械的に検証する。

### 3.4 追記ログとしての性質（UNIQUE 制約を張らない）

`fetch_attempt` と `telegram_reception` は**純粋な追記ログ**であり、業務キーによる UNIQUE 制約・UPSERT を持たない。

- 同一の `document_url` を長期フィード経由で再取得した場合、電文履歴には 2 行が並ぶ。これは「同じ電文を 2 回受信した」という事実の記録であり、重複ではない。B2 のスナップショット表と異なり、後から来た行が前の行を上書きしない。
- したがって `record*` 関数は INSERT のみを行い、`ON CONFLICT` 句を持たない。既受信かどうかの判定（取得方法レポート §3.1 の二重取得回避）は Epic C の責務であり、`listTelegramReceptions` の `documentUrl` 絞り込みで問い合わせる。
- 唯一の例外は採用結果で、受信時点では未判定であり得るため §5.3 の `updateTelegramReceptionAdoption` による後追い更新を許す。それ以外の列は追記後に更新しない。**この後追い更新の運用はヒアリング確定事項 6 として統括確認済みである。**

### 3.5 availability を持たない

`fetch_attempt.outcome`（`success` / `failure`）は**取得試行という事実の記録**であり、基本設計 §6.3 の `availability`（`available` / `stale` / `unavailable`）とは別の概念である。3 状態を 2 値へ縮退させたものではない。

- `availability` は「その情報種別の現在値がいま使えるか」を表す B2 スナップショットの属性であり、直近の取得が失敗しても前回正常値が残っていれば `stale` になる。これは 1 回の取得試行だけでは決まらない。
- したがって履歴 2 表に `availability` 列を置かない。`outcome='failure'` を `availability='unavailable'` に読み替えてはならない。この対応付けの禁止を §10 実装上の注意に再掲する。

### 3.6 訓練・試験の扱い

`telegram_reception.control_status` は `normal` / `training` / `test` の CHECK に加えて **NULL（不明）** を許す。B2 のスナップショット表では NOT NULL だが、履歴には「本文は取れたが解析前・解析失敗で `Control/Status` を読めていない」行が正当に存在するためである。

読み出しの規律を次のとおり固定する。

- `listTelegramReceptions` に `controlStatus` を指定した場合、その値の行だけを返す。**NULL（不明）の行は返さない。**「不明」を「通常」の一種として扱わない。
- `controlStatus` 未指定は「絞り込みなし（NULL 行を含む全件）」であり、通常データだけを返す意味ではない。Epic E の通常画面向けエンドポイントは必ず `controlStatus: 'normal'` を明示する。この規約を §9 引き継ぎに書く。
- 不明行だけを抽出したい要求は本 Issue では実装しない（Epic E で必要になったら絞り込みオプションを追加する）。

### 3.7 テーブル名・列名の規約

Issue #6 §3.4 を踏襲する。小文字スネークケース、主キーは `id INTEGER PRIMARY KEY`、コード値・区分値は TEXT、原文を丸めない。加えて本 Issue 固有に次を定める。

- SQLite の予約語と衝突する列名（`trigger`）を避け、`trigger_kind` とする。
- ミリ秒・バイト数・HTTP ステータスは INTEGER。負値を CHECK で禁止する。
- 時刻列はすべて UTC ISO 8601 文字列（`UtcIso8601String`）。`CURRENT_TIMESTAMP` の DEFAULT を使わない（形式が混ざり文字列比較が壊れる）。

## 4. テーブル定義

DDL の最終形は migration ファイルとする。以下は列の意図を示す定義である。

### 4.1 `fetch_attempt`（通信履歴、migration `0009`）

| 列 | 型 | 制約 | 内容 |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY | |
| `source_kind` | TEXT | NOT NULL、`CHECK (source_kind <> '')` | 取得元種別。§4.2 のとおり値集合を DB で縛らない |
| `target_ref` | TEXT | NULL 可 | 取得対象の識別子。タイルではフレームの識別子（product/layer、base_time、valid_time 等）を入れる（§3.1）。ほかに地点コード、電文 URL 等。自由記述 |
| `request_url` | TEXT | NOT NULL、`<> ''` | 実際に要求した URL。タイルのフレーム行では代表 URL（§3.1） |
| `trigger_kind` | TEXT | NOT NULL、`<> ''` | 契機（`scheduled` / `manual` / `startup` / `retry` 等）。自由記述 |
| `attempt_no` | INTEGER | NOT NULL、`CHECK (attempt_no >= 1)` | 同一目的での試行回数。初回は 1。バックオフ再試行で増える |
| `started_at` | TEXT | NOT NULL | 試行開始時刻 |
| `finished_at` | TEXT | NOT NULL | 試行終了時刻（失敗・タイムアウト時も入れる） |
| `duration_ms` | INTEGER | NOT NULL、`CHECK (duration_ms >= 0)` | 所要時間。§8.2「直近処理時間」表示用。**フレーム行では全タイル取得の合計** |
| `outcome` | TEXT | NOT NULL、`CHECK (outcome IN ('success','failure'))` | 取得試行の成否。フレーム内部分失敗時の値は Epic C が決める（§3.1） |
| `http_status` | INTEGER | NULL 可 | 応答を得られなかった場合（DNS 失敗等）は NULL。フレーム行では代表値、割れた場合は NULL |
| `response_bytes` | INTEGER | NULL 可、`CHECK (response_bytes IS NULL OR response_bytes >= 0)` | 受信バイト数。**フレーム行では全タイル取得の合計** |
| `item_count` | INTEGER | NULL 可、`CHECK (item_count IS NULL OR item_count >= 1)` | この 1 行がまとめた取得対象の件数。タイルのフレーム行ではフレーム内のタイル枚数。1 リクエスト＝ 1 行の取得元では NULL |
| `failed_item_count` | INTEGER | NULL 可、`CHECK (failed_item_count IS NULL OR failed_item_count >= 0)`、`CHECK (item_count IS NULL OR failed_item_count IS NULL OR failed_item_count <= item_count)` | うち失敗した件数。`item_count` が NULL のときは NULL |
| `content_hash` | TEXT | NULL 可 | 本文の小文字 16 進 SHA-256。同一内容の識別用（取得方法レポート §3.1） |
| `error_kind` | TEXT | NULL 可、`<> ''` | 失敗分類の自由記述（`timeout` / `network` / `http_status` / `parse` 等）。CHECK で縛らない |
| `error_message` | TEXT | NULL 可 | 失敗の詳細文字列 |

`duration_ms` は `started_at` / `finished_at` から計算できるが、ISO 8601 文字列の差分を SQL で取ると SQLite の `julianday()` に依存し精度と可読性が落ちるため、明示列として持つ。値の整合（`finished_at - started_at ≒ duration_ms`）はリポジトリ層でも DB でも強制しない（時刻取得元が異なり得るため）。

`item_count` / `failed_item_count` は「どちらも NULL」または「どちらも非 NULL」で使う。リポジトリ層は片方だけが NULL の入力を例外にし、`failed_item_count > item_count` も例外にする。一方、`failed_item_count >= 1` のときに `outcome` を `failure` に強制することは**しない**。部分失敗の扱いは Epic C の判断であり（§3.1）、本 Issue で先取りして固定しないためである。

索引:

| 索引 | 列 | 用途 |
| --- | --- | --- |
| `idx_fetch_attempt_started_at` | `(started_at DESC, id DESC)` | 一覧の既定順（新しい順） |
| `idx_fetch_attempt_source` | `(source_kind, started_at DESC)` | 取得元別の最終試行・最終成功・連続失敗の集計（§8.2 主テーブル） |
| `idx_fetch_attempt_outcome` | `(outcome, started_at DESC)` | 失敗だけの抽出 |

### 4.2 `source_kind` の値集合を DB で縛らない理由

ヒアリングで確定しているのは「取得元種別を列として持つ」ことまでであり、値の集合は確定していない。`CHECK (source_kind IN (...))` を張ると、Epic C が新しい取得元（キキクルの追加レイヤー、アメダス地点表など）を扱うたびに migration の追加が必要になり、`0009` は適用済みで編集できないため列制約だけのための `0011` を積むことになる。採用結果を自由記述にした判断（ヒアリング確定事項 2）と同じ理由で、DB では空文字禁止のみとする。

TypeScript 側は `apps/api/src/repositories/types.ts` に既知値の参考定数を置く。**検証には使わない**（未知の値も保存できる）。

```ts
export const KNOWN_FETCH_SOURCE_KINDS = [
  'xml_feed_regular',      // https://www.data.jma.go.jp/developer/xml/feed/regular.xml
  'xml_feed_extra',        // 同 extra.xml
  'xml_feed_regular_long', // 同 regular_l.xml（初期化・復旧）
  'xml_feed_extra_long',   // 同 extra_l.xml
  'xml_document',          // フィードから辿った個別電文本体
  'radar_target_times',    // targetTimes_N1.json / N2.json
  'radar_tile_frame',      // nowc の hrpns PNG。1 フレーム分のタイル取得をまとめて 1 行（§3.1）
  'risk_target_times',     // キキクル時刻一覧
  'risk_tile_frame',       // キキクルの PNG／PBF／GeoJSON。同じく 1 フレーム＝ 1 行
  'amedas_latest_time',    // latest_time.txt
  'amedas_point',          // point/44136/{date}_{hh}.json
  'amedas_table',          // amedastable.json
] as const;
```

URL は取得方法レポート §2.1・§4・§4.1・§5 で実在を確認した取得元に対応する。基本設計 §8.2 の監視テーブルの行（XML 定時／XML 随時／雨雲時刻一覧／キキクル時刻一覧／アメダス）はこの値の部分集合を集約したものであり、集約の対応付けは Epic C／E が行う。

### 4.3 `telegram_reception`（電文履歴、migration `0010`）

| 列 | 型 | 制約 | 内容 |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY | |
| `fetch_attempt_id` | INTEGER | NULL 可、**FK 制約なし**（§3.2） | 由来する取得試行 |
| `feed_kind` | TEXT | NULL 可、`<> ''` | 由来フィード（`regular` / `extra` / `regular_l` / `extra_l` 等）。自由記述 |
| `feed_entry_id` | TEXT | NULL 可、`<> ''` | Atom エントリの `<id>`。二重取得判定の材料 |
| `document_url` | TEXT | NOT NULL、`<> ''` | 電文 XML の URL |
| `telegram_type` | TEXT | NULL 可、`<> ''` | 電文種別（`VPWW55` 等）。**判別できなければ NULL**。既定値で埋めない |
| `title` | TEXT | NULL 可 | `Head/Title` の原文 |
| `control_status` | TEXT | NULL 可、`CHECK (control_status IS NULL OR control_status IN ('normal','training','test'))` | `Control/Status`。解析前・解析失敗は NULL（§3.6） |
| `info_type` | TEXT | NULL 可 | `Head/InfoType`（発表／訂正／取消等）の原文 |
| `event_id` | TEXT | NULL 可 | `Head/EventID`。実東京電文では空のため NOT NULL にしない |
| `serial` | TEXT | NULL 可 | `Head/Serial`。同上 |
| `control_datetime` | TEXT | NULL 可 | `Control/DateTime`（発信） |
| `report_datetime` | TEXT | NULL 可 | `Head/ReportDateTime`（発表）。ヒアリング列「発表時刻」 |
| `target_datetime` | TEXT | NULL 可 | `Head/TargetDateTime`（基点） |
| `received_at` | TEXT | NOT NULL | 本文を受信した時刻。ヒアリング列「受信時刻」 |
| `adoption_result` | TEXT | NULL 可、`CHECK (adoption_result IS NULL OR adoption_result <> '')` | 採用結果。**自由記述、値集合を縛らない**（ヒアリング確定事項 2）。未判定は NULL |
| `adoption_reason` | TEXT | NULL 可 | 採用・不採用の理由の自由記述 |
| `adoption_decided_at` | TEXT | NULL 可 | 採用判定を行った時刻 |
| `raw_body` | TEXT | NULL 可 | 電文原文（ヒアリング確定事項 3）。取得できなかった場合 NULL |
| `body_bytes` | INTEGER | NULL 可、`CHECK (body_bytes IS NULL OR body_bytes >= 0)` | 原文のバイト数 |
| `content_hash` | TEXT | NULL 可 | 原文の小文字 16 進 SHA-256 |

`control_datetime` / `report_datetime` / `target_datetime` / `received_at` を 1 列に統合しない（取得方法レポート §3.1）。

索引:

| 索引 | 列 | 用途 |
| --- | --- | --- |
| `idx_telegram_reception_received_at` | `(received_at DESC, id DESC)` | 一覧の既定順 |
| `idx_telegram_reception_document_url` | `(document_url)` | 既受信判定（Epic C） |
| `idx_telegram_reception_type` | `(telegram_type, received_at DESC)` | 種別での検索（§8.1） |
| `idx_telegram_reception_control_status` | `(control_status, received_at DESC)` | 訓練・試験の分離 |
| `idx_telegram_reception_report_datetime` | `(report_datetime DESC)` | 発表時刻での検索 |
| `idx_telegram_reception_fetch_attempt` | `(fetch_attempt_id)` | 通信履歴からの逆引き |

### 4.4 `telegram_reception_area`（対象地域明細、migration `0010`）

| 列 | 型 | 制約 | 内容 |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY | |
| `reception_id` | INTEGER | NOT NULL、`REFERENCES telegram_reception(id) ON DELETE CASCADE` | 親 |
| `area_code` | TEXT | NOT NULL、`<> ''` | 対象区域コード（文字列。`1310800` / `130010` 等） |
| `area_name` | TEXT | NULL 可 | 区域名の原文 |
| `code_type` | TEXT | NULL 可 | `codeType` の原文 |
| `sequence` | INTEGER | NOT NULL | 電文中の並び順 |
| 一意キー | | `UNIQUE (reception_id, sequence)` | 並び順の重複を防ぐ |

「対象地域」を親行のカンマ連結 TEXT 列にせず明細表にする理由は 2 つある。1 つは 1 電文が複数区域を対象にし得ること（気象防災速報が典型。取得方法レポート §3.6）。もう 1 つは §8.1 の「対象地域で検索」を LIKE ではなく等値検索＋索引で実現するためで、連結文字列にすると `130010` の検索が `1300100` を誤ヒットさせる。

`(reception_id, area_code, code_type)` を一意キーにしない。`code_type` が NULL のとき SQLite は NULL 同士を相異なるものとして扱い、一意制約が黙って効かなくなるためである。並び順を一意キーにすることで、この故障モードを避けつつ重複挿入を検出できる。

索引: `idx_telegram_reception_area_code (area_code, reception_id)` — 区域からの絞り込み用。

## 5. モジュール・ファイル構成

### 5.1 追加・変更するファイル

```text
apps/api/
├── migrations/
│   ├── 0009_create_fetch_attempt.sql        # 新規
│   └── 0010_create_telegram_reception.sql   # 新規（telegram_reception と telegram_reception_area）
├── src/
│   └── repositories/
│       ├── types.ts                         # 変更（履歴の型を末尾に追記）
│       ├── fetchAttemptRepository.ts        # 新規
│       ├── telegramReceptionRepository.ts   # 新規
│       └── index.ts                         # 変更（2 モジュールを再エクスポート）
└── tests/
    ├── historySchema.test.ts                # 新規（スキーマ制約・独立性・トリガー不在）
    └── historyRepositories.test.ts          # 新規（CRUD・検索）
```

- migration は B1 の規則（`NNNN_<name>.sql`、forward-only、`BEGIN`/`COMMIT`/`ROLLBACK` を書かない、適用済みファイルを編集しない）に従う。`0001`〜`0008` は B2 が適用済みのため編集しない。
- `telegram_reception` と `telegram_reception_area` は親子であり FK で結ばれるため、同一 migration（`0010`）に入れる。`fetch_attempt` は独立しているため別ファイル（`0009`）とし、2 表が別々に追加・検証できることをファイル構成でも表す。
- 型は既存 `types.ts` の末尾に追記する。`index.ts` が `export * from './types.js'` しているため、import 経路は変わらない。
- 既存 `snapshot.ts` の `validateControlStatus` / `validateNonEmptyString` / `validateUtcIso8601String` / `validateUtcIso8601StringOrNull` を再利用する。履歴専用の検証ヘルパーは新設しない。
- `apps/web` は変更しない。

### 5.2 型定義

```ts
// apps/api/src/repositories/types.ts に追記

// --- 通信履歴 ---
export type FetchOutcome = 'success' | 'failure';

export const KNOWN_FETCH_SOURCE_KINDS = [/* §4.2 のとおり */] as const;

export interface FetchAttemptInput {
  readonly sourceKind: string;
  readonly targetRef: string | null;
  readonly requestUrl: string;
  readonly triggerKind: string;
  readonly attemptNo: number;
  readonly startedAt: UtcIso8601String;
  readonly finishedAt: UtcIso8601String;
  readonly durationMs: number;
  readonly outcome: FetchOutcome;
  readonly httpStatus: number | null;
  readonly responseBytes: number | null;
  /** この 1 行がまとめた取得対象の件数（タイルのフレーム行のみ）。1 リクエスト＝ 1 行なら null。 */
  readonly itemCount: number | null;
  /** うち失敗した件数。itemCount が null のときは null。 */
  readonly failedItemCount: number | null;
  readonly contentHash: string | null;
  readonly errorKind: string | null;
  readonly errorMessage: string | null;
}

export interface FetchAttempt extends FetchAttemptInput {
  readonly id: number;
}

export interface ListFetchAttemptsOptions {
  readonly sourceKind?: string;
  readonly outcome?: FetchOutcome;
  readonly startedAtFrom?: UtcIso8601String;
  readonly startedAtTo?: UtcIso8601String;
  readonly limit?: number;   // 既定 100、上限 1000
  readonly offset?: number;  // 既定 0
}

// --- 電文履歴 ---
export interface TelegramReceptionAreaInput {
  readonly areaCode: string;
  readonly areaName: string | null;
  readonly codeType: string | null;
  readonly sequence: number;
}

export interface TelegramReceptionArea extends TelegramReceptionAreaInput {
  readonly id: number;
}

export interface TelegramReceptionInput {
  readonly fetchAttemptId: number | null;
  readonly feedKind: string | null;
  readonly feedEntryId: string | null;
  readonly documentUrl: string;
  readonly telegramType: string | null;
  readonly title: string | null;
  readonly controlStatus: ControlStatus | null;
  readonly infoType: string | null;
  readonly eventId: string | null;
  readonly serial: string | null;
  readonly controlDateTime: UtcIso8601String | null;
  readonly reportDateTime: UtcIso8601String | null;
  readonly targetDateTime: UtcIso8601String | null;
  readonly receivedAt: UtcIso8601String;
  readonly adoptionResult: string | null;
  readonly adoptionReason: string | null;
  readonly adoptionDecidedAt: UtcIso8601String | null;
  readonly rawBody: string | null;
  readonly bodyBytes: number | null;
  readonly contentHash: string | null;
  readonly areas: readonly TelegramReceptionAreaInput[];
}

/** 一覧用。原文（rawBody）を含まない。 */
export interface TelegramReceptionSummary
  extends Omit<TelegramReceptionInput, 'rawBody' | 'areas'> {
  readonly id: number;
  readonly hasRawBody: boolean;
  readonly areas: readonly TelegramReceptionArea[];
}

/** 詳細用。原文を含む。 */
export interface TelegramReception extends TelegramReceptionSummary {
  readonly rawBody: string | null;
}

export interface ListTelegramReceptionsOptions {
  /** 指定した値の行だけを返す。NULL（不明）の行は返さない（§3.6）。 */
  readonly controlStatus?: ControlStatus;
  readonly telegramType?: string;
  readonly infoType?: string;
  readonly areaCode?: string;
  readonly documentUrl?: string;
  readonly adoptionResult?: string;
  readonly receivedAtFrom?: UtcIso8601String;
  readonly receivedAtTo?: UtcIso8601String;
  readonly reportDateTimeFrom?: UtcIso8601String;
  readonly reportDateTimeTo?: UtcIso8601String;
  readonly limit?: number;   // 既定 100、上限 1000
  readonly offset?: number;
}

export interface TelegramReceptionAdoptionInput {
  readonly adoptionResult: string | null;
  readonly adoptionReason: string | null;
  readonly adoptionDecidedAt: UtcIso8601String | null;
}
```

`TelegramReceptionSummary` を分ける理由は原文のサイズである。§8 の実測で、気象庁配布サンプルの `VPWS50`（全国集約）は 4,567,490 バイト、`VPWP50` は最大 426,941 バイトある。一覧取得で `SELECT *` を行うと 100 件で数百 MB を読み出しかねないため、一覧の SQL は `raw_body` を選択せず、代わりに `raw_body IS NOT NULL` を `has_raw_body` として返す。

### 5.3 リポジトリ層の契約

```ts
// apps/api/src/repositories/fetchAttemptRepository.ts
export function recordFetchAttempt(
  connection: DatabaseConnection,
  input: FetchAttemptInput,
): FetchAttempt;

export function findFetchAttemptById(
  connection: DatabaseConnection,
  id: number,
): FetchAttempt | null;

export function listFetchAttempts(
  connection: DatabaseConnection,
  options?: ListFetchAttemptsOptions,
): readonly FetchAttempt[];

export function countFetchAttempts(
  connection: DatabaseConnection,
  options?: ListFetchAttemptsOptions,
): number;

export function deleteFetchAttempt(connection: DatabaseConnection, id: number): boolean;
```

```ts
// apps/api/src/repositories/telegramReceptionRepository.ts
export function recordTelegramReception(
  connection: DatabaseConnection,
  input: TelegramReceptionInput,
): TelegramReception;

/** 原文を含む詳細取得。 */
export function findTelegramReceptionById(
  connection: DatabaseConnection,
  id: number,
): TelegramReception | null;

/** 原文を含まない一覧取得。 */
export function listTelegramReceptions(
  connection: DatabaseConnection,
  options?: ListTelegramReceptionsOptions,
): readonly TelegramReceptionSummary[];

export function countTelegramReceptions(
  connection: DatabaseConnection,
  options?: ListTelegramReceptionsOptions,
): number;

/** 採用結果だけを後から更新する。存在しなければ null。 */
export function updateTelegramReceptionAdoption(
  connection: DatabaseConnection,
  id: number,
  input: TelegramReceptionAdoptionInput,
): TelegramReception | null;

export function deleteTelegramReception(connection: DatabaseConnection, id: number): boolean;
```

規律:

- 第 1 引数で `DatabaseConnection` を受け取り、モジュールスコープに接続を保持しない（B1 §3.2）。
- `record*` は INSERT のみ。`ON CONFLICT` 句を持たない（§3.4）。`recordTelegramReception` は親 INSERT と明細 INSERT を 1 トランザクション（`connection.transaction()`）で行う。
- `delete*` は単件削除のみ。期間指定・一括削除は B6 の責務であり、本 Issue では提供しない。
- 一覧は `ORDER BY started_at DESC, id DESC`（電文履歴は `received_at DESC, id DESC`）。`id DESC` を第 2 キーに置き、同一時刻の行の順序を rowid 順の暗黙の挙動に委ねない。
- `limit` 未指定は 100、`limit > 1000` は 1000 に丸め、`limit <= 0` は例外にする。無制限取得の口を作らない（原文を含まない一覧でも、数万行の全件返却は監視画面を壊す）。
- `countTelegramReceptions` / `countFetchAttempts` は同じ options 型を受け、`limit` / `offset` を無視する。一覧とカウントで絞り込み条件を組み立てるコードを共有し、条件がずれないようにする。
- すべての SQL は prepared statement と bind parameter を使い、値を文字列連結しない。可変長の絞り込みは条件句とパラメータ配列を並行して積む。
- 検証はリポジトリ層で行い、判別不能な値の保存を例外にする: `outcome`、`controlStatus`（`null` は許容）、非空必須文字列、UTC ISO 8601 形式（`null` 許容列は `validateUtcIso8601StringOrNull`）、`attemptNo >= 1`、`durationMs >= 0`、`responseBytes`／`bodyBytes` が `null` または `>= 0`、`itemCount` が `null` または `>= 1`、`failedItemCount` が `null` または `>= 0`、`itemCount` と `failedItemCount` の NULL 性が一致すること、`failedItemCount <= itemCount`。
- **`failedItemCount >= 1` から `outcome` を導かない。** リポジトリ層は両者の関係を検証も補正もしない（§3.1・§4.1）。
- `fetchAttemptId` の参照先存在は検証しない（§3.2）。
- DB 行型は API workspace 内部に閉じ、`packages/shared` や HTTP 契約へ露出させない（Issue #3・#5 の引き継ぎ）。

## 6. テスト設計

`apps/api/tests` に 2 ファイルを追加する。既存 `schema.test.ts` / `repositories.test.ts` と同じく `mkdtemp` で一時ディレクトリを作り、`initializeDatabase` に本番 `migrations/` を指すコンフィグを渡して実スキーマを適用する。テストごとに DB ファイルを分離する。アサーションは原則完全一致。

### 6.1 スキーマ検証（`historySchema.test.ts`）

1. 本番 migration をすべて適用すると `fetch_attempt` / `telegram_reception` / `telegram_reception_area` が `sqlite_master` に存在し、`__schema_migrations` の適用件数が migration ファイル数（10）と一致する。
2. 3 表の `PRAGMA table_info` が §4 の列名・型・NOT NULL 指定と完全一致する。
3. `fetch_attempt.outcome` に `success` / `failure` 以外を入れると CHECK 違反。2 値はいずれも保存できる。
4. `telegram_reception.control_status` に `normal` / `training` / `test` 以外を入れると CHECK 違反。3 値と **NULL** はいずれも保存できる。
4b. `fetch_attempt` の `item_count` / `failed_item_count` に、両方 NULL・`(12, 0)`・`(12, 3)`・`(12, 12)` を INSERT できる。`(12, 13)` は CHECK 違反、`item_count = 0` は CHECK 違反、`failed_item_count = -1` は CHECK 違反。
5. `adoption_result` に任意の文字列（例 `採用`、`未対応形式`、`adopted-by-aggregate`）を保存できる。`PRAGMA table_info` と `sqlite_master` の DDL に `adoption_result` の `IN (` 制約が存在しない。
6. `telegram_reception` を削除すると `telegram_reception_area` が `ON DELETE CASCADE` で消える。`PRAGMA foreign_keys` が `1` であることも確認する。
7. `telegram_reception_area` を親不在で挿入すると外部キー違反になる。
8. **2 表の独立性**: `fetch_attempt` 行を削除しても、その `id` を `fetch_attempt_id` に持つ `telegram_reception` 行が残り、値も変わらない。存在しない `fetch_attempt_id`（例 `999999`）を持つ `telegram_reception` を挿入できる。
9. **B2 からの独立性**: `0009` / `0010` の DDL に B2 のテーブル名（`_snapshot`、`bosai_bulletin` 等）が現れない。
10. 3 表に自動削除の仕組み（トリガー）が存在しない。`sqlite_master` の `type='trigger'` が 0 件（B6 の前提）。
11. 同一 `document_url` の行を 2 件挿入でき、UNIQUE 制約に阻まれない（追記ログ性、§3.4）。
12. migration を 2 回適用しても再実行されない（`appliedVersions` が空配列）。

### 6.2 CRUD・検索検証（`historyRepositories.test.ts`）

通信履歴:

1. `recordFetchAttempt` した内容を `findFetchAttemptById` で完全一致取得できる。NULL 許容列（`targetRef`、`httpStatus`、`responseBytes`、`contentHash`、`errorKind`、`errorMessage`）が `null` のまま往復する。
2. 失敗行（`outcome='failure'`、`httpStatus=null`、`errorKind='timeout'`）を保存・取得できる。`httpStatus` が `0` に変換されない。
3. `listFetchAttempts` が `startedAt` の新しい順に返る。同一 `startedAt` の 2 行は `id` の大きい順に返る。
4. `sourceKind` / `outcome` / `startedAtFrom` / `startedAtTo` の各絞り込みが期待どおりに効き、組み合わせても矛盾しない。`countFetchAttempts` が同じ条件で一覧の全件数（`limit` 適用前）を返す。
5. `limit` / `offset` でページングでき、`limit` 未指定が 100 件、`limit=5000` が 1000 件に丸められる。`limit=0` / 負値が例外になる。
6. `outcome` に不正値、`attemptNo=0`、`durationMs=-1`、`startedAt` が非 ISO 8601 の入力が例外になる。
6b. **フレーム単位の記録**: `sourceKind: 'radar_tile_frame'`、`targetRef` にフレーム識別子、`itemCount: 12`、`failedItemCount: 3`、`responseBytes`／`durationMs` に合計値を入れた行を保存・取得でき、値が完全一致で往復する。`itemCount: null` かつ `failedItemCount: 3`（片方だけ NULL）、`failedItemCount > itemCount`、`itemCount: 0`、`failedItemCount: -1` はいずれも例外になる。
6c. **部分失敗と outcome を結合しない**: `failedItemCount: 3` かつ `outcome: 'success'` の行を保存でき、`outcome` が `failure` に書き換わらない。逆に `failedItemCount: 0` かつ `outcome: 'failure'` も保存できる。
7. `deleteFetchAttempt` で単件が消え、他の行が残る。

電文履歴:

8. `recordTelegramReception` した内容を `findTelegramReceptionById` で完全一致取得でき、`rawBody` と `areas` が往復する。
9. `listTelegramReceptions` の結果に `rawBody` プロパティが含まれず、`hasRawBody` が `true` になる。`findTelegramReceptionById` では原文が取れる。
10. 原文なし（`rawBody: null`、`bodyBytes: null`）の行を保存でき、`hasRawBody` が `false` になる。空文字に変換されない。
11. **訓練の分離**: `controlStatus: 'training'`、`'test'`、`'normal'`、`null` の 4 行を保存し、`listTelegramReceptions({ controlStatus: 'normal' })` が `normal` の 1 行だけを返す（`null` 行を含まない）。`controlStatus` 未指定では 4 行すべて返る。
12. 解析失敗相当の行（`telegramType: null`、`controlStatus: null`、`reportDateTime: null`、`rawBody` あり、`adoptionResult: '未対応形式'`）を保存・取得でき、NULL が既定値に置き換わらない。
13. 同一 `documentUrl` を 2 回 `recordTelegramReception` すると 2 行になり、`id` が異なり、1 行目の内容が変化しない（追記ログ）。
14. `areaCode` 絞り込みで、明細に `1310800` を持つ電文だけが返る。`130010` で検索したとき `1300100` のような別コードを持つ行が誤ヒットしない。
15. 1 電文に複数区域を保存でき、`sequence` 順に往復する。同一 `(receptionId, sequence)` の重複挿入が一意制約違反になる。
16. `telegramType` / `infoType` / `receivedAtFrom`／`To` / `reportDateTimeFrom`／`To` / `adoptionResult` の絞り込みが効く。`reportDateTime` が `null` の行は `reportDateTimeFrom` 指定時に返らない。
17. `updateTelegramReceptionAdoption` で採用結果・理由・判定時刻だけが変わり、`rawBody` を含む他の列と `areas` が変化しない。存在しない `id` で `null` が返る。任意の文字列（列挙外）を採用結果として保存できる。
18. `deleteTelegramReception` で親と明細が消え、再取得が `null` になる。他の電文行は残る。
19. **2 表の独立性（リポジトリ経由）**: 電文行に紐づく `fetch_attempt` を `deleteFetchAttempt` で消しても、`findTelegramReceptionById` の結果が完全一致で変わらない。逆に電文行を消しても通信履歴行が残る。

### 6.3 テストの有効性確認

B1 §9.4・Issue #6 §6.3 と同じ手順を踏む。

1. 実装前にテストを追加し、対象 migration／リポジトリが未実装で失敗すること（red）を確認する。
2. **対照実験を先に行う**: 空白やローカル変数名だけの意味を変えない改変で、テストが成功し続けることを確かめる。「常に失敗する／常に成功する」故障モードでないことを先に確認してからミューテーション判定に進む。
3. 対象変異を 1 つずつ加え、対応テストが失敗することを確認する。少なくとも次を行う。
   - `listTelegramReceptions` から `control_status` 条件を外す（§6.2-11 が落ちること）
   - `controlStatus` 指定時の SQL を `control_status = ? OR control_status IS NULL` に変える（§6.2-11 の「NULL 行を含まない」が落ちること）
   - `recordTelegramReception` を `ON CONFLICT (document_url) DO UPDATE` の UPSERT に変える（§6.2-13 が落ちること）
   - 一覧の SELECT に `raw_body` を含め、`TelegramReceptionSummary` に原文を載せる（§6.2-9 が落ちること）
   - `0010` の `ON DELETE CASCADE` を外した migration に差し替える（§6.1-6 が落ちること）
   - `0010` に `fetch_attempt_id INTEGER REFERENCES fetch_attempt(id) ON DELETE CASCADE` を書いた migration に差し替える（§6.1-8・§6.2-19 が落ちること）
   - `outcome` の CHECK 制約を外す（§6.1-3 が落ちること）
   - `areaCode` 絞り込みを `LIKE '%' || ? || '%'` に変える（§6.2-14 の誤ヒット検出が落ちること）
   - `limit` の上限丸めを外す（§6.2-5 が落ちること）
   - `recordFetchAttempt` に「`failedItemCount >= 1` なら `outcome` を `failure` に上書きする」処理を足す（§6.2-6c が落ちること）
   - `failedItemCount <= itemCount` の検証を外す（§6.2-6b が落ちること）
4. 変異を元に戻し、対象テストが再度成功することを確認する。一時変更はコミットしない。migration を差し替える変異では、適用済みチェックサムの不一致で `initializeDatabase` 自体が失敗し得るため、テスト用の一時 DB を毎回作り直して判定する。

## 7. 受け入れ条件

検収担当は次を上から順に実行する。

1. `npm run build` が成功する。
2. `npm run typecheck`、`npm run lint`、`npm run format:check` がいずれもエラー 0 で終了する。
3. `npm run test -w apps/api` が全件成功する。
4. `apps/api/migrations` に `0009_create_fetch_attempt.sql` と `0010_create_telegram_reception.sql` が存在し、`0001`〜`0008` に差分がない（`git diff --stat main -- apps/api/migrations` に `0001`〜`0008` が現れない）。
5. `grep -iE '^\s*(begin|commit|rollback)' apps/api/migrations/*.sql` が 0 件。
6. 一時 DB を指定して API サーバーを起動すると（`WX_VIEWER_DB_PATH=<一時パス> npm run dev` もしくはビルド後の起動）、起動ログに新規適用 migration 件数 **10** が出て、`/api/health` が `{"status":"ok"}` を返す。
7. その DB ファイルに対し `sqlite3 <path> ".tables"` で `fetch_attempt`、`telegram_reception`、`telegram_reception_area` の 3 表が存在する。
8. `sqlite3 <path> "PRAGMA table_info(fetch_attempt);"` が §4.1 の 17 列（`item_count` / `failed_item_count` を含む）を、`telegram_reception` が §4.3 の 21 列を、`telegram_reception_area` が §4.4 の 6 列を、いずれも列名一致で返す。
9. `fetch_attempt.outcome` に `success` / `failure` 以外を INSERT すると CHECK 制約違反になる。2 値はいずれも INSERT できる。
10. `telegram_reception.control_status` に `normal` / `training` / `test` / NULL はいずれも INSERT でき、`unknown` 等の他の値は CHECK 制約違反になる。
10b. **フレーム単位の記録**: `fetch_attempt` に `(item_count, failed_item_count)` として `(NULL, NULL)` / `(12, 0)` / `(12, 3)` / `(12, 12)` を INSERT でき、`(12, 13)` / `(0, 0)` / `(12, -1)` はいずれも CHECK 制約違反になる。
10c. **部分失敗と outcome を結合していない**: `failed_item_count = 3` かつ `outcome = 'success'` の行を `recordFetchAttempt` で保存でき、`findFetchAttemptById` の結果の `outcome` が `success` のままである（`npm run test -w apps/api` の該当テストで確認）。
11. **B2 からの独立**: `grep -nE '_snapshot|bosai_bulletin|warning_current|radar_frame|risk_frame|amedas_' apps/api/migrations/0009_*.sql apps/api/migrations/0010_*.sql` が 0 件。
12. **通信履歴への FK 不在**: `grep -n 'REFERENCES fetch_attempt' apps/api/migrations/*.sql` が 0 件。
13. **採用結果の非制約**: `grep -nE "adoption_result[^,]*IN \(" apps/api/migrations/*.sql` が 0 件。任意の日本語文字列を `adoption_result` に INSERT できる。
14. 通信履歴行を DELETE しても、その `id` を `fetch_attempt_id` に持つ電文履歴行が残り、内容が変わらない。逆に電文履歴行を DELETE しても通信履歴行が残る。
15. 同一 `document_url` の電文履歴を 2 件 INSERT でき、UNIQUE 制約に阻まれない。
16. `telegram_reception` 行を削除すると、対応する `telegram_reception_area` 行が 0 件になる。
17. `sqlite_master` に `type='trigger'` の行が 0 件である（自動削除処理が存在しない）。
18. 原文 NULL の電文履歴行（本文を取得できなかったケース）を保存・取得でき、`rawBody` が `null` のまま返る。空文字に変換されない。
19. `listTelegramReceptions` の返却オブジェクトに `rawBody` プロパティが存在せず、`findTelegramReceptionById` では原文が取れる（`npm run test -w apps/api` の該当テストで確認）。
20. `controlStatus: 'training'` と `null` の行を保存した後、`listTelegramReceptions({ controlStatus: 'normal' })` の結果が保存前と完全一致で変わらない。
21. `listTelegramReceptions({ areaCode: '130010' })` が、`1300100` のような別コードだけを持つ行を返さない。
22. 2 回目の起動で migration が再実行されず、1 回目に保存した行が完全一致で残る。
23. `git status --porcelain` に、設計書・migration・リポジトリ・テスト（および `docs/design/issue-6-table-definition.md` への追記があればそれ）以外の変更が含まれない。`apps/api/data/` 配下が追跡対象になっていない。

## 8. 実測値

原文を TEXT 列へ直接格納する（ヒアリング確定事項 3）判断の裏付けとして、気象庁配布サンプル電文（`cmk-gsx/docs/260907_weather-data/jmaxml_20260723_Samples/`）のバイト数を実測した。

| 電文種別 | サンプル件数 | 最大バイト数 | 平均バイト数 |
| --- | --- | --- | --- |
| VPWW55（大雨） | 2 | 19,893 | 16,037 |
| VPWW56（土砂災害） | 2 | 20,473 | 17,029 |
| VPWW57（高潮） | 2 | 20,762 | 16,182 |
| VPWW58（暴風・暴風雪） | 1 | 19,221 | 19,221 |
| VPWW59（波浪） | 1 | 12,289 | 12,289 |
| VPWW60（大雪） | 1 | 13,355 | 13,355 |
| VPWW61（雷等） | 1 | 16,874 | 16,874 |
| **VPWS50（全国集約）** | 1 | **4,567,490** | 4,567,490 |
| VPWP50（警報等時系列） | 4 | 426,941 | 351,028 |
| VPFD61（早期注意・近） | 1 | 10,237 | 10,237 |
| VPFW60（早期注意・遠） | 1 | 4,761 | 4,761 |
| VPFD51（地域時系列） | 6 | 54,121 | 51,156 |
| VPBS50（気象防災速報） | 10 | 3,427 | 2,555 |

- 個別の警報電文・速報・早期注意は数 KB〜21 KB であり、TEXT 列への格納に問題はない。
- **一方 VPWS50（全国集約）は 4.36 MiB、VPWP50 は最大 417 KiB ある。** これらは全国・全地域分を含む電文であり、江東区分だけを抜いたサイズではない（取得方法レポート §9 も「件数は電文全地域分」と記す）。基本設計 §8.1 が自動削除を禁じているため、VPWS50 を復旧のたびに保存し続けると DB ファイルが単調に増える。
- この点は統括担当がユーザーへ確認済みであり、**「本 Issue の段階では結論を出さず、Epic C 実装時に具体的な取得頻度が分かってから判断する」**と決まった。したがって本設計は現状（全件・無制限で TEXT 列に格納）のままとし、**本 Issue の受け入れ条件には含めない**（§7 に対応項目を置かない）。この論点は §12 の引き継ぎ事項として Epic C 着手時に統括が再判断する。本設計では原文を格納する構造だけを用意し、保存対象の絞り込み・圧縮・上限は一切実装しない。
- **実挙動未確認**: 上記は気象庁配布のサンプル電文の実測であり、実運用フィードから取得する電文の実サイズ・出現頻度は未検証。高頻度フィード本体の実 GET は取得方法レポート §2.1 の時点でも未実施である。

## 9. 未確認事項

- **原文の累積量**: §8 のとおりサンプル実測はあるが、実運用での VPWS50 の取得頻度（復旧時のみか、定時取得に含まれるか）が未確定のため、DB ファイルの増加量を見積もれていない。実挙動未確認。**Epic C 着手時に統括が再判断すると確定済み**（§8・§11-1・§12）。
- **`source_kind` の値集合**: §4.2 の一覧は取得方法レポートで実在を確認した取得元に対応するが、Epic C が実際に採る取得単位（フィード単位・電文単位・タイル単位）は未確定。DB で縛らないことで影響を局所化している。
- **フレーム内の部分失敗時の `outcome`**: 記録粒度は「1 フレーム＝ 1 行」に確定済み（ヒアリング確定事項 5）だが、フレーム内の一部タイルだけが失敗したときに `outcome` をどちらにするかは、取得ズーム範囲・タイル枚数が未検証（取得方法レポート §4、§4.1）のため決められない。本 Issue はテーブル・型のみを提供し、集計方針の決定を Epic C に委ねる（§3.1）。`item_count` / `failed_item_count` により、どちらの方針でも後から読み替えられる。実挙動未確認。
- **`Head/TargetDateTime` の有無**: 対象電文すべてに基点時刻が入るかは未検証。NULL 可としている。
- **採用結果の値の集合**: Epic C の判定ロジック未実装のため未確定。自由記述としているのはこのため（ヒアリング確定事項 2）。
- **304 Not Modified の扱い**: 条件付き GET を実際に使うかは Epic C の未確定事項。`outcome='success'` かつ `http_status=304` で表現でき、スキーマ変更は不要。なお「取得しなかった」記録を作らない方針はヒアリング確定事項 7 として確定済み。
- **竜巻関連電文（VPHW50/51）**: VPBS50 とは別電文形式（Issue 化ドラフト C8）。電文履歴は種別を問わず原文と共通ヘッダ項目だけを持つため構造変更は不要だが、実電文は未確認。

## 10. 実装上の注意

- `outcome='failure'` を `availability='unavailable'` に読み替えない（§3.5）。履歴 2 表に `availability` 列を作らない。逆に、`stale` 相当の状態を通信履歴から導く処理も本 Issue では書かない。
- `failed_item_count` から `outcome` を導出・補正しない（§3.1・§4.1）。部分失敗を `failure` とみなすかは Epic C の判断であり、本 Issue のリポジトリ層は入力された `outcome` をそのまま保存する。
- `control_status IS NULL` を「通常」と同義に扱わない（§3.6）。SQL の絞り込みで `control_status = ?` を使い、`IS NULL` を OR で足さない。
- migration の SQL は `0009` / `0010` に閉じ、B2 のテーブルを参照しない。`0001`〜`0008` は適用済みのため編集しない（チェックサム不一致で起動が失敗する）。
- 時刻列に `CURRENT_TIMESTAMP` の DEFAULT を使わない。`YYYY-MM-DD HH:MM:SS` 形式になり ISO 8601 UTC 文字列と混在して文字列比較が壊れる。時刻は必ずアプリケーション側から渡す。
- `trigger` は SQLite の予約語のため、列名は `trigger_kind` とする。
- 一覧 SQL で `SELECT *` を書かない。`telegram_reception` の一覧では `raw_body` を選択せず、`raw_body IS NOT NULL AS has_raw_body` を返す。`SELECT *` にすると原文が黙って全件読み込まれ、遅くなるだけでエラーは出ない。
- 可変長の絞り込みは、条件句の配列とパラメータ配列を必ず対で積む。片方だけ追加すると bind 数の不一致で実行時エラーになるため、条件を追加するヘルパー関数に閉じ込める。
- `listTelegramReceptions` の `areaCode` 絞り込みは `EXISTS (SELECT 1 FROM telegram_reception_area a WHERE a.reception_id = t.id AND a.area_code = ?)` とする。`LIKE` や `IN` を使った部分一致にしない（`130010` と `1300100` の誤ヒット）。
- `recordTelegramReception` の親 INSERT と明細 INSERT は 1 トランザクションにまとめる。途中失敗で対象地域を欠いた電文行が残らないようにする。
- 検証は保存前にリポジトリ層で行い、DB の CHECK に到達させない（既存 `snapshot.ts` の `validate*` を再利用）。CHECK 違反の `SqliteError` を業務エラーとして表示に流用しない。
- 本 Issue では `apps/web` を変更しない。

## 11. 統括担当へ差し戻す要確認事項

初版で挙げた 4 件は統括担当がユーザーへ確認済みである。うち 3 件（タイル取得の記録粒度、採用結果の後追い更新、「取得しなかった」記録の要否）は確定し、§2.2 のヒアリング確定事項 5〜7 として本文へ統合した。残るのは次の 1 件のみである。

1. **VPWS50（4.36 MiB）の原文を無条件に保存し続けてよいか。** 現設計はヒアリング確定事項 3 に従い全電文の原文を TEXT 列へ格納し、自動削除も上限も設けない。**本 Issue の段階では結論を出さず、Epic C 実装時に具体的な取得頻度が分かってから統括が判断すると確定済み。本 Issue の受け入れ条件には含めず、設計変更も行わない**（§8・§9・§12）。製造・検収は現設計どおり進めてよい。

## 12. 後続 Issue への引き継ぎ

- **Epic C** は取得試行ごとに `recordFetchAttempt` を呼び、成否によらず行を残す。XML 電文の本文を取得できたら `recordTelegramReception` を呼び、採用判定後に `updateTelegramReceptionAdoption` を呼ぶ。既受信判定（二重取得回避）は `listTelegramReceptions({ documentUrl })` と `content_hash` で行い、DB の UNIQUE 制約には頼らない。
- **Epic C** は `source_kind` の値を §4.2 の定数に合わせるか、新しい値を同定数へ追加する。DB は縛らないため、定数の追加だけで済み migration は不要。
- **Epic C（要判断・統括マター 1）**: **VPWS50（4.36 MiB）の原文を無条件に保存し続けるかは、Epic C 着手時に統括が改めて判断する**（§8・§11-1）。本 Issue では全件・無制限で TEXT 列に格納する構造だけを用意し、受け入れ条件にも含めていない。判断の材料は「VPWS50 が復旧時のみ取得されるのか、定時取得にも含まれるのか」という実際の取得頻度である。絞り込み・圧縮・上限が必要になった場合でも、既存の列定義は変更せず、保存側（Epic C）の判断もしくは B6 の削除運用で対応できる。
- **Epic C（要判断・統括マター 2）**: **レーダー・キキクルのフレーム内で一部タイルだけが失敗したときに `outcome` を `success` / `failure` のどちらにするかは Epic C が決める**（§3.1、ヒアリング確定事項 5）。本 Issue はテーブル・型を提供するのみで、集計方針を決めない。Epic C はフレーム単位で `recordFetchAttempt` を 1 回呼び、`target_ref` にフレーム識別子（product/layer、base_time、valid_time 等）、`response_bytes`／`duration_ms` に全タイルの合計、`item_count`／`failed_item_count` にフレーム内の枚数と失敗枚数を入れる。方針を後から変えても過去行を読み替えられるよう、この 2 列を必ず埋めること。
- **Epic E** は履歴一覧・詳細のエンドポイントを実装する際、必ず `controlStatus: 'normal'` を明示して訓練・試験・不明を通常画面へ混入させない。一覧では `TelegramReceptionSummary`（原文なし）を、詳細では `TelegramReception`（原文あり）を使い、一覧レスポンスに原文を載せない。
- **Epic E** は §8.2 の「取得元別の稼働状況」（最終試行・最終成功・連続失敗回数・直近処理時間）を `fetch_attempt` の集計として実装する。本 Issue は集計関数を提供しない。集計を DB の派生列やトリガーで持たせないこと（トリガー 0 件は §6.1-10 で検証している）。
- **Epic E／画面側**は、B2 の現在値がどの受信に由来するかを外部キーではなく時刻・種別・対象地域の値で対応付ける（ヒアリング確定事項 4）。B3 に B2 への参照列を追加しない。
- **B4（通知出力履歴）・B5（操作記録）** は本 Issue の 2 表とは別テーブルとし、`0011` 以降を採番する。`trigger_kind='manual'` の通信履歴と B5 の操作記録は別の記録であり、片方をもう片方の代替にしない。
- **B6（履歴削除 API）** は本 Issue の 2 表を削除対象に含める。2 表に FK がないため、削除順序の制約がなく、片方だけの削除も許される。一括削除・期間削除の関数は B6 が追加する（本 Issue は単件削除のみ）。自動削除処理が存在しないことは §6.1-10 のトリガー 0 件テストが起点になる。
- 実装後、`docs/design/issue-6-table-definition.md` の一覧に `0009` / `0010` の 3 表を追記する（同ファイルは「migration を追加・変更したときは更新する」と宣言している）。
- 追加の列が必要になった場合は、適用済み migration を編集せず `0011` 以降を追加する。
