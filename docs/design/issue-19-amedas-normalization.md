# Issue #19「C9. アメダス最新時刻・地点データの取得・正規化」設計

対象ブランチ: `feature/issue-19-amedas-normalization`

## 1. 目的

気象庁Web画面用のアメダスJSONから、**会場定義（Issue #109 で実装済みの `resolveVenueForecastTargets(venueId).amedas`）が指すアメダス地点**の最新観測時刻と地点ブロックデータを取得し、`amedas_snapshot` / `amedas_observation`（Issue #6 で実装済み）へ正規化して保存する処理を実装する。

**本 Issue は特定の1地点専用の実装ではない。** 取得・正規化のロジックは `AmedasTarget`（`stationCode` / `displayName` / `elements`）を入力として受け取り、east（江戸川臨海 `44136`・`elems="11112010"`）と trc（羽田 `44166`・`elems="11110000"`）のどちらでも正しく動く。羽田は湿度・日照を提供しないため、正規化結果に湿度・日照の行が現れてはならない。これは Issue #109 設計 §7 の引き継ぎ事項「**C9/G6**: `amedas.elements` を確認して羽田にない湿度・日照を unavailable/未提供として表現する。別地点へのフォールバックは禁止する」の直接の実装である。

ただし**両会場を同時に収集・保存する運用そのものは本 Issue の対象外**とし、Issue #109 §3.2 と同じく「east 既定 ＋ 明示注入」までを受け入れ範囲とする（確定事項#5）。

本 Issue は**単発実行可能な関数**を提供するところまでを範囲とする。時間帯別の定期実行（基本設計 §8.3）は C14（Issue 未採番・時間帯別取得周期スケジューラ）の責務であり、本 Issue では実装しない（確定事項#2）。

また「時刻確認と地点データ取得の成功を別管理にする」（`docs/issues-draft.md` C9、基本設計 §8.5）を、**2系統の独立した availability** として具体化する（確定事項#3）。

さらに、取得方法レポート §5 が求める「推計値であることを表示」の土台として、**`amedas_observation` に推計フラグ列 `is_estimated` を追加する**（migration `0017`、確定事項#6・§3.4.3）。本 Issue が触るスキーマはこの1列だけである。

## 2. 参照資料と確定済み前提

### 2.1 参照資料

| 資料 | 参照箇所 |
| --- | --- |
| `docs/basic-design.md` | §5.10（アメダスパネル【確定】と設計案）、§5.12（取得状態表示）、§5.13（詳細ダイアログ・直近24時間）、§6.3（availability 3状態）、§8.3（時間帯別取得周期）、§8.5（取得元別状態・時刻確認と地点データの別管理） |
| `docs/data-acquisition-report.md` | §5（アメダス取得URL・JSTブロック仕様・要素キー一覧・品質欠測）、§6（取得・配信構成、タイムアウト10秒・指数バックオフ） |
| `docs/design/issue-6-info-type-schema.md` | §4.7（`amedas_snapshot` / `amedas_observation`）、§8（未確定事項）、§9（保持時間幅は Epic C が決める） |
| `apps/api/src/repositories/amedasRepository.ts` | `saveAmedasSnapshot` / `findAmedasSnapshot` / `deleteAmedasSnapshot` の実挙動 |
| `apps/api/migrations/0007_create_amedas.sql` | 実テーブル定義・UNIQUE 制約 |
| `apps/api/src/database/migrations.ts` | migration runner の実挙動（ファイル名規則 `^[0-9]{4}_[a-z0-9_]+\.sql$`、sha256 チェックサム照合、トランザクション制御文の拒否）を実読で確認 |
| `apps/api/migrations/0016_add_bosai_bulletin_has_sighting.sql` / `0008` / `0011` | 既存の ALTER TABLE と真偽値列（`INTEGER ... CHECK (col IN (0, 1))`）の書式 |
| `apps/api/src/repositories/bosaiBulletinRepository.ts` | 真偽値の 0/1 往復変換の作法（`? 1 : 0` / `=== 1`） |
| `apps/api/src/polling/jmaXmlPoller.ts` | `performHttpGet`（タイムアウト・エラー種別・サニタイズ）、`recordFetchAttempt` の呼び方 |
| `packages/shared/src/availability.ts` | `resolveAvailability` の判定規則 |
| `docs/design/issue-109-venue-forecast-target-definitions.md` | §1.1（会場別アメダス定義表）、§3.1（`AmedasTarget` 型・ブランド型）、§3.2（API adapter の作法・複数会場同時処理を行わない理由）、§7（C9/G6 への引き継ぎ） |
| `packages/shared/src/venueForecastTargets.ts` | 実装済みの `VENUE_FORECAST_TARGETS` / `AmedasTarget` / `AmedasStationCode` / `resolveVenueForecastTargets`（実読で確認） |
| `apps/api/src/venueForecastTargets.ts` | 実装済みの `resolveXxxTargetArea` adapter 群の書式（`resolveAmedasTarget` はまだ存在しない） |
| `docs/design/issue-18-tornado-bulletin.md` | 書式・受け入れ条件の粒度・fixture 来歴管理の作法 |

### 2.2 統括担当から渡された確定事項

1. **正規化・保存対象の要素**: 表示は §5.10 確定の5項目（気温・湿度・風向・風速・直近1時間降水量）に限るが、保存は取得方法レポート §5 で存在確認済みの全要素（`temp` / `humidity` / `windDirection` / `wind` / `precipitation10m` / `precipitation1h` / `precipitation3h` / `precipitation24h` / `sun10m` / `sun1h` / `gust` 系 / `maxTemp` `minTemp` とその時刻）を `amedas_observation` の element 行として保存する。**積雪・気圧は観測非対応のため対象外**。

   この「積雪・気圧が非対応」は江戸川臨海（`elems="11112010"`）についての判断である。確定事項#5 により、非対応要素の判定は地点の `elems` から導出する一般規則として実装する（§3.4.1）。羽田（`elems="11110000"`）ではこれに日照・湿度が加わる。**確定事項#1 を「積雪と気圧の2つだけを除外する」という固定リストとして実装しない。**
2. **スケジューラは対象外**。単発実行可能なインターフェースを提供し、C14 から呼び出せる形にする。
3. **2系統 availability**: 最新時刻（`latest_time.txt`）の取得と地点ブロックJSON（`point/{地点コード}/....json`）の取得を独立した availability として管理する。時刻取得が成功していても地点ブロック取得が失敗した場合、地点データ側だけが stale / unavailable になり、前回正常値は保持される。
4. **AQC フラグ `5`（休止中）・`6`（×）の例外扱い**（追加協議で確定、基本設計 §5.10 に追記済み）: この2値は「AQC で区別しない」の対象から**除外**し、`value` が数値であっても**欠測相当**として扱う（通常の観測値として表示しない）。`1` / `4` 等その他の値は引き続き区別せず通常の観測値として扱う。実観測で `aqc=5` / `6` かつ数値が入る電文は未確認であり、挙動を先回りして定めたものである。
5. **会場別アメダス定義は Issue #109 の `packages/shared/src/venueForecastTargets.ts` が唯一の定義元である**（追加協議で確定）。本 Issue は地点コード・地点名・`elems` をソース内に再定義しない。取得・正規化は `AmedasTarget` を入力に取り、east / trc のどちらでも動く。ただし両会場の同時収集は Issue #109 §3.2・§7 のとおり「受信採用履歴の永続化境界が未決定」であり本 Issue の対象外とする。既定は east、明示注入で trc を選べる形に留める。

6. **`elems` 桁が `2`（推計）の要素に推計フラグを立てる**（追加協議で確定）。取得方法レポート §5 が「推計値であることを表示」と明示的に求めているため、表示層（Epic E / F）が参照できる推計フラグ列を**本 Issue で DB に用意する**。江戸川臨海の日照（`sun10m` / `sun1h`、日照桁が `2`）がこれに当たる。桁が `'1'`（観測）の要素にはフラグを立てない。

   これに伴い、**本 Issue は migration を1本だけ追加する**（`0017`、§3.4.3）。当初「本 Issue は migration を追加しない」としていた方針は本確定事項により撤回した。追加するのは `amedas_observation.is_estimated` の1列のみであり、availability 等の他の列は引き続き追加しない（§3.3）。

   なお `packages/shared` 側の型・定義に変更は不要である。`AmedasTarget` は `stationCode` / `displayName` / `elements` を既に備えており（実読で確認）、`AmedasStationCode` はブランド型として `string` に代入可能なため、`AmedasSnapshotInput.stationCode: string`（`apps/api/src/repositories/types.ts`）へそのまま渡せる。**本 Issue は `packages/shared` を変更しない**（§6 の品質ゲートで担保）。

### 2.3 実データ実読で確定した事実（2026-09-11 JST 取得）

本設計にあたり、以下3つのURLを実際に取得して構造を確認した。以下は取得時点の記録であり、気象状況の記述ではない。

#### 2.3.1 `latest_time.txt`

```text
https://www.jma.go.jp/bosai/amedas/data/latest_time.txt
→ 本文（25バイト、改行なし）: 2026-09-11T19:50:00+09:00
→ Content-Type: text/plain, Cache-Control: max-age=60, Access-Control-Allow-Origin: *
```

**JSTオフセット付き ISO 8601 の1行**である。`Z` 形式でもエポック秒でもない。末尾に改行を含まなかったが、パーサーは前後空白の trim を行う。

#### 2.3.2 地点ブロックJSON

`https://www.jma.go.jp/bosai/amedas/data/point/44136/20260911_18.json`（5,563バイト）は、キーが `YYYYMMDDHHmmss` 形式のJST文字列であるオブジェクトで、12個の観測時刻（`20260911180000` 〜 `20260911195000`、10分間隔）を含んだ。**最新時刻 19:50 とブロック内最新キー 19:50 が一致した**ことから、「`latest_time` から `floor(JST時 / 3) * 3` でブロックを決める」規則が実データで裏付けられた。

最新時刻（`20260911195000`）のエントリの原文は次のとおり。

```json
{"prefNumber": 44, "observationNumber": 136, "temp": [20.2, 0], "humidity": [94, 0],
 "sun10m": [0, 0], "sun1h": [0.0, 0], "precipitation10m": [0.0, 0], "precipitation1h": [0.0, 0],
 "precipitation3h": [0.0, 0], "precipitation24h": [15.5, 0], "windDirection": [2, 0], "wind": [2.1, 0],
 "maxTempTime": {"hour": 5, "minute": 23}, "maxTemp": [20.6, 0],
 "minTempTime": {"hour": 23, "minute": 21}, "minTemp": [18.0, 0],
 "gustTime": {"hour": 6, "minute": 8}, "gustDirection": [1, 0], "gust": [6.0, 0]}
```

ここから、値の形が**2種類**あることが確定した。

- `[value, aqc]` の2要素配列（観測値）
- `{hour, minute}` のオブジェクト（`maxTempTime` / `minTempTime` / `gustTime` の極値発生時刻）
- `prefNumber` / `observationNumber` は観測値ではなく地点識別子（`44` + `136` = `44136`）

#### 2.3.3 **取得方法レポートとの食い違い: 積雪キーが実在した（重要）**

取得方法レポート §5 は「積雪・気圧 … 今回の観測JSONにも存在しない」と記録しているが、**今回のブロックJSONには `snow1h` / `snow6h` / `snow12h` / `snow24h` が存在した**。ただし出現は12観測中2観測（`18:00` と `19:00`＝毎正時のみ）で、いずれも次の形だった。

```json
"snow1h": [0, null], "snow6h": [0, null], "snow12h": [0, null], "snow24h": [0, null]
```

すなわち **value は `0`、aqc は `null`**。公式画面スクリプト（`https://www.jma.go.jp/bosai/amedas/` のインラインJS）に `onlyOnTheDotElems:[r.snc,r.snf1h,r.snf6h,r.snf12h,r.snf24h,r.vis,r.tenki]` という定義があり、積雪系が毎正時のみ出現する要素として扱われていることも確認した。また地点表 `amedastable.json` の `44136` は

```json
{"type": "C", "elems": "11112010", "lat": [35, 38.3], "lon": [139, 51.8], "alt": 5,
 "kjName": "江戸川臨海", "knName": "エドガワリンカイ", "enName": "Edogawa Seaside"}
```

であり、`observedCodeElems`（気温／降水／風向／風速／日照／積雪／湿度／気圧）と照合すると**積雪桁が `0`（非対応）**である。取得方法レポート §5 の AQC 表でも aqc `7 / null` は「空欄相当」である。

したがって **「キーが存在する＝観測している」ではない**。`snow*` の `0` をそのまま保存すると、基本設計 §5.10 確定の「欠測等を0として表示しない」に真っ向から反する値が DB に入る。この扱いを §3.4 で規定する。

**この観察は江戸川臨海に固有の話ではない。** 取得方法レポート §5 が記録するとおり `elems` の各桁は「`0`＝非対応 / `1`＝観測 / `2`＝推計」であり、江戸川臨海の `11112010` は日照桁が `2`（推計）・積雪桁と気圧桁が `0`、羽田の `11110000` は日照・積雪・湿度・気圧の4桁が `0` である（Issue #109 §1.1・§2 で確認済み）。よって非対応要素の判定は**特定地点向けの固定リストではなく `elems` の桁から導出する**（§3.4.1）。

#### 2.3.4 確認できなかったこと（実挙動未確認）

- **風向コード → 16方位名の対応表**: 公式画面スクリプトでは `m.tr(j[n.toString(10)])` の形で辞書 `j` を引いており、コードが方位名辞書のキーであることまでは確認したが、**辞書 `j` の実体はページのインラインJS内に存在せず、今回の取得範囲では対応表を実読できなかった**。「0は静穏」は取得方法レポート §5 に記録があるが、1〜16の具体的な方位名は未確認である。→ §3.5 の判断根拠。
- AQC が `0` 以外（`1` / `4` 等）の実観測データ。今回も全て `0` または `null` であった（取得方法レポート §5 と同じ状況）。

## 3. 設計方針

### 3.1 スコープ境界

| 項目 | 本 Issue | 委譲先 |
| --- | --- | --- |
| 最新時刻・地点ブロックの取得と正規化・保存 | **実装する** | — |
| 60秒 / 10分周期の自動実行、時間帯別周期切替 | 実装しない | C14 |
| 指数バックオフの待機制御（次回取得の抑止） | 実装しない（連続失敗数の計上のみ） | C13 |
| 内部REST API（`/api/amedas` 等）での配信 | 実装しない | Epic E |
| 風向コード→方位名、単位付き表示、16方位ラベル | 実装しない（コード値を保存） | Epic E / F（§3.5） |
| 過去ブロックの遡り取得（24時間分の一括バックフィル） | 既定では行わない（§3.7・引数で可能にする） | §9 の要ヒアリング事項 |
| 会場定義（`AmedasTarget`）を入力とする一般化・`elems` 由来の非対応要素判定 | **実装する**（east / trc の双方で検証する） | — |
| east と trc を同一プロセスで同時に収集・保存する運用 | 実装しない（east 既定・明示注入まで） | 後続（Issue #109 §7「複数会場の常時処理」） |
| `elems` 桁が `2`（推計）の要素への推計フラグ付与・その保存列の追加（migration `0017`） | **実装する**（確定事項#6・§3.4.3） | — |
| 推計フラグを使った**表示上**の区別（注記・記号・凡例） | 実装しない（フラグを保存するところまで） | Epic E / F（§8） |

本 Issue は XML 電文を扱わないため、`telegram_reception`（受信履歴）には一切書き込まない。アメダスは電文ではなく観測JSONであり、発表・訂正・取消の履歴概念を持たない。取得試行の記録は `fetch_attempt` にのみ行う。

**訓練・試験の区別を持ち込まない。** アメダスJSONには `Control/Status` に相当する要素が存在せず、`amedas_snapshot` にも `control_status` 列がない。`isTraining` を立てる経路を本 Issue で作らない（基本設計 §3.4 の訓練通知はXML電文側の概念である）。

### 3.2 モジュール境界と HTTP 取得の共通化

現在 `performHttpGet` / `sanitizeUrl` / `sanitizeErrorMessage` は `jmaXmlPoller.ts` 内の非 export 関数である。アメダスも同じタイムアウト・エラー種別（`timeout` / `network` / `http_status`）・URLサニタイズを必要とするため、**`apps/api/src/polling/httpGet.ts` へ抽出して両者から使う**。コピーを作らない。

抽出時の唯一の機能追加は `accept` オプションである。**既定値は現行の `'application/xml, text/xml, */*'` のままとし、`jmaXmlPoller.ts` 側の挙動を1バイトも変えない**（既存テストが通ることで担保する）。アメダス側は `'application/json, text/plain, */*'` を渡す。`User-Agent` は現行の `wx-viewer-poc/0.1.0` を共通で使う。

### 3.3 2系統 availability の具体化（確定事項#3）

**時刻系統（latest_time）と地点系統（point block）を、取得試行・成否・連続失敗数・availability のすべてにおいて分離する。**

| 系統 | `fetch_attempt.source_kind` | `target_ref` | availability の置き場所 |
| --- | --- | --- | --- |
| 最新時刻 | `amedas_latest_time` | `null` | **DBに列を持たない**。`fetch_attempt` 行（永続）＋プロセス内状態から導出し、戻り値で返す |
| 地点ブロック | `amedas_point` | **解決済みの `target.stationCode`**（east なら `44136`、trc なら `44166`） | `amedas_snapshot.availability`（永続） |

`target_ref` に地点コードを入れるのは、Epic G の取得元別状態を地点単位で集計できるようにするためである。**地点コードをリテラルで埋め込まない。** `latest_time.txt` は全地点共通のため `target_ref` は `null` のままとする。

`amedas_snapshot` は地点データのスナップショットであり、その `availability` は**地点ブロック取得の状態だけを表す**。時刻確認の成否をここへ混ぜない（基本設計 §8.5「時刻確認だけの成功を地点データ更新成功として表示しない」）。監視画面（Epic G）の取得元別状態は `fetch_attempt` を `source_kind` で分けて集計すれば、最終試行・最終成功・連続失敗数を2行として表示できる。**2系統 availability のために新しい列を作らない**（本 Issue が追加する migration は §3.4.3 の推計フラグ列のみであり、availability 関連の列追加は行わない）。

判定は `packages/shared` の `resolveAvailability` に委ねる。系統ごとの入力は次のとおり。

| 系統 | `hasLastNormalValue` | `freshness` |
| --- | --- | --- |
| 最新時刻 | プロセス内に前回取得成功した最新時刻値を保持しているか | 今回成功 → `normal`／今回失敗 → `delayed` |
| 地点ブロック | DB に観測行が1件以上あるか（今回の保存結果を含む） | §3.3.1 |

#### 3.3.1 地点系統の freshness 判定

1. 今回ブロックを取得し、正規化に成功し、**ブロック内の最新観測時刻が `latest_time` と一致した** → `normal`
2. 取得・正規化に成功したが、**ブロック内の最新観測時刻が `latest_time` より古い** → `delayed`（上流の観測遅延。2.3.2 の実測ではこの2つは一致していた）
3. ブロックの取得失敗・JSON構造異常 → `abnormal`
4. 時刻取得に失敗してブロック取得を試行しなかった → **`amedas_snapshot` を更新しない（§3.8）**。ただし前回成功から `staleAfterSeconds`（既定 600 秒）を超えていれば、観測行を保持したまま `availability='stale'`・`fetched_at` のみ更新する

既定 600 秒は基本設計 §8.3 の「運用中は現行ブロックを10分ごとに再確認する案」に対応させた値であり、実測に基づく閾値ではない。**設定値として外出しし、呼び出し側（C14）が上書きできるようにする**。

#### 3.3.2 `unavailable` を書くときの地雷

`saveAmedasSnapshot` は `availability !== 'stale'` の場合、**既存の `amedas_observation` を DELETE してから入力の観測行を INSERT する**（`amedasRepository.ts`）。したがって観測行がある状態で `availability='unavailable'` かつ `observations: []` を渡すと、保持していた前回正常値が消える。

`resolveAvailability` は `hasLastNormalValue=true` のとき決して `unavailable` を返さないため、この規則を守る限り事故は起きない。実装では**availability を自前で組み立てず、必ず `resolveAvailability` の戻り値を使う**こと。

### 3.4 正規化規則（値の3区分との対応）

基本設計 §5.10 の「欠測・観測非対応・通信異常を区別し、欠測等を0として表示しない【確定】」「AQCフラグによる区別をしない【確定】」「AQC `5`／`6` は例外として欠測相当【確定】」と、取得方法レポート §5 の「0/1/4でも value=null なら欠測記号にする」「欠落キー、値なし、観測非対応、通信失敗は別状態に正規化する」を、以下のとおり両立させる。

| 区分 | JSON上の形 | 正規化 |
| --- | --- | --- |
| 正常値 | `[数値, 数値aqc]`（aqc が `5` / `6` 以外） | 行を作る。`value_number = 数値`、`quality_flag = aqc`、`value_text = null` |
| **推計値** | 上記のうち、`elems` の該当桁が `2` の系列に属する要素 | 行を作る（値の扱いは正常値と同一）。加えて `is_estimated = 1`（§3.4.3） |
| **欠測** | `[null, aqc]`（aqc が数値） | 行を作る。`value_number = null`、`quality_flag = aqc` |
| **欠測（AQC由来）** | `[任意, 5]` / `[任意, 6]` | 行を作る。`value_number = null`、`quality_flag = 5` / `6`。**元の数値は保存しない**（§3.4.2） |
| **観測非対応（要素単位）** | キーが存在しない／`aqc` が `null`／地点表 `elems` が非対応 | **行を作らない**（§3.4.1） |
| 極値発生時刻 | `{hour, minute}` | 行を作る。`value_number = null`、`value_text = "HH:MM"`（ゼロ埋め）、`quality_flag = null` |
| **通信異常** | ブロックJSON全体の取得・構造検証の失敗 | 観測行を一切書き換えず、スナップショットの `availability` を `stale`（前回値あり）／`unavailable`（前回値なし）にする |

`quality_flag` は `5` / `6` の判定にのみ用い、それ以外では**保存するだけ**で、値の採否・availability 判定・表示可否のいずれにも使わない（基本設計 §5.10 確定、Issue #6 §8 と同じ扱い）。`aqc=1/4` の値も通常の観測値として `value_number` に入る。これは「AQCフラグで区別しない」という確定事項に従った結果であり、「品質不明を正常値として利用しない」（取得方法レポート §5）との緊張関係は `quality_flag` を残すことで将来の再検討余地として担保する。

なお AQC 由来の欠測は **`availability` に影響しない**。`availability` は取得・構造検証の成否（通信異常）だけで決まる（§3.3）。全要素が `aqc=5` でも取得自体は成功しており `available` である。

#### 3.4.1 観測非対応の判定（`elems` の桁から動的に導出する）

次の**いずれか**に当たる要素は行を作らない。**`aqc` が `5` / `6` の場合はここに含めない**（§3.4.2 で欠測として行を作る）。

1. **`target.elements`（`elems`、8桁）の該当桁が `0` である系列に属する要素キー**。
2. **`aqc` が `null`**: 取得方法レポート §5 の AQC 表で `7 / null` は空欄相当。2.3.3 の実データでも `[0, null]` は非対応要素にのみ現れた。
3. **配列でも `{hour,minute}` オブジェクトでもない未知の形**: 行を作らず、カウンタに計上する。

除外した件数は戻り値の集計（`unsupportedElementCount` 等）に載せ、静かに捨てない。1と2を**両方**適用する（片方が破れても非対応要素の `0` が保存されない二重の安全）。

##### 桁とJSON要素キーの対応表

桁の並びは取得方法レポート §5 の `observedCodeElems`（気温／降水／風向／風速／日照／積雪／湿度／気圧）に従う。Issue #109 §1.1 も同じ並びで `elems` を記録している。**桁の値はビット列ではなく、桁ごとに `0`＝非対応 / `1`＝観測 / `2`＝推計 を表す1文字である。ビット演算をしない**（Issue #109 の `AmedasTarget.elements` の doc コメントと同じ方針）。**行を作るかどうかの判定は「その桁が `'0'` かどうか」だけで行う**（`'1'` と `'2'` はどちらも行を作る＝推計値も保存する）。その上で、**桁が `'2'` の系列に属する要素には推計フラグを立てる**（§3.4.3、確定事項#6）。すなわち桁の値は「`'0'` → 行を作らない」「`'1'` → 行を作る・`is_estimated = 0`」「`'2'` → 行を作る・`is_estimated = 1`」の3分岐であり、`'3'`〜`'9'` は未定義値として `'1'` と同じ扱い（行を作り `is_estimated = 0`）とする（実在を確認していないため、推計と断定しない）。

| 添字 | 系列 | JSON要素キー |
| --- | --- | --- |
| 0 | 気温 | `temp` / `maxTemp` / `minTemp` / `maxTempTime` / `minTempTime` |
| 1 | 降水 | `precipitation10m` / `precipitation1h` / `precipitation3h` / `precipitation24h` |
| 2 | 風向 | `windDirection` / `gustDirection` |
| 3 | 風速 | `wind` / `gust` / `gustTime` |
| 4 | 日照 | `sun10m` / `sun1h` |
| 5 | 積雪 | `snow` / `snow1h` / `snow6h` / `snow12h` / `snow24h` |
| 6 | 湿度 | `humidity` |
| 7 | 気圧 | `pressure` / `normalPressure` |

- 極値発生時刻（`maxTempTime` / `minTempTime` / `gustTime`）と極値（`maxTemp` / `minTemp` / `gust`）は、その値の系列（気温・風速）に従属させる。気温桁が `0` の地点では極値時刻も現れないという素直な扱いである。`gustDirection` は風向系列に置く。**実観測でこれらを検証できた地点は east（全桁の該当要素が提供対象）だけであり、風向桁のみが `0` の地点の挙動は実挙動未確認**（§9）。
- 対応表は 2026-09-11 の実ブロックJSON（§2.3.2・§2.3.3）に現れたキーと、取得方法レポート §5 の要素キー一覧から作った。**未確認のキーを名称の類推だけで系列へ割り当てない。**

##### 対応表に無いキーの扱い

未知の**新しいキー**が `[value, aqc]` 形かつ `aqc` が数値で現れた場合は、対応表に無くても保存する（確定事項#1 の「存在を確認済みの全要素を保存」の精神に沿い、キー名をそのまま `element` に入れる構造のため素直に拡張できる）。**対応表にあり、かつ該当桁が `0` の要素は、形が正常でも保存しない。**

この規則の帰結を両会場について明示する。

| 会場 | `elems` | 桁が `0` の系列 | 行が作られない要素キー |
| --- | --- | --- | --- |
| east（江戸川臨海 `44136`） | `11112010` | 積雪・気圧 | `snow*` / `pressure` / `normalPressure` |
| trc（羽田 `44166`） | `11110000` | 日照・積雪・湿度・気圧 | `sun10m` / `sun1h` / `snow*` / `humidity` / `pressure` / `normalPressure` |

east の結果は確定事項#1（積雪・気圧は対象外）と一致する。trc の結果は Issue #109 §7「羽田にない湿度・日照を未提供として表現する。別地点へのフォールバックは禁止する」の実装である。**羽田のブロックJSONに `humidity` キーが現れた場合でも行を作らない。** また、羽田で湿度が取れないことを理由に江戸川臨海の値で補完する経路を一切作らない（そもそも本 Issue のサービス関数は1サイクルで1地点しか取得しない）。

##### `elements` の形式検証

`target.elements` が8桁の `0`〜`9` でない場合、正規化を**失敗として扱わず**、`elems` 由来の除外（規則1）だけを行わずに規則2・3で処理する… という「静かな縮退」は採らない。**`AmedasTarget.elements` の形式が `^[0-9]{8}$` に一致しない場合は例外を投げる**（会場定義の誤りであり、実行時のデータ異常ではないため。§10）。`resolveVenueForecastTargets` の戻り値は readonly 定数であり、正しい値でこの例外に到達することはない。

#### 3.4.2 AQC `5`（休止中）・`6`（×）の扱い【確定事項#4】

基本設計 §5.10 の追記は「値が数値であっても欠測相当として扱う（通常の観測値として表示しない）」と述べる。既存の3区分（欠測・観測非対応・通信異常）のどれに位置づけるかを、本設計では次のとおり確定させる。

**「欠測」に分類する。`amedas_observation` の行は作り、`value_number = null`、`quality_flag = 5` または `6` を保存する。**

根拠:

1. **基本設計の文言が「欠測相当」と言っている。** 「観測非対応」は「その地点がその要素を恒常的に提供しない」という地点の構造的性質であり、本設計では地点表 `elems` と `aqc === null`（提供対象外要素）から判定している（§3.4.1）。AQC `5` / `6` は**観測時刻ごとに変わりうる一時的な状態**であり、地点の構造的性質ではない。同じ要素が 19:40 は正常値・19:50 は `aqc=5` になりうる。行を作らない扱いにすると、同一要素の行が時刻によって現れたり消えたりし、§5.13 の24時間グラフ上で「その時刻に観測が無かった（＝欠測）」ことと「その要素を提供していない」ことが区別できなくなる。
2. **他の欠測（`[null, aqc]`）と表現を一貫させられる。** どちらも `value_number === null` の行になるため、表示層は `value_number` が `null` かどうかだけを見れば欠測記号を出せる。表示層が `quality_flag` を参照する必要がない。これは §7 の「`quality_flag` を使った値の採否判定・表示分岐をしない」という対象外設定と矛盾しない（採否判定は正規化層で完結する）。
3. **監視・再検討がしやすい。** 行が残るので `SELECT ... WHERE quality_flag IN (5,6)` で実在件数を後から数えられる。「実観測で `aqc=5` / `6` かつ数値が入る電文は未確認」（基本設計 §5.10 追記）という前提が実データで覆ったかどうかを、運用中に検知できる。行を作らない設計では件数カウンタ（プロセス内）にしか残らず、後から追跡できない。

**元の数値は `value_number` にも `value_text` にも保存しない。** 「通常の観測値として表示しない」を正規化層で完結させる方針（上記2）を取る以上、数値を DB に残すと表示層が誤って拾う経路が生まれる。代わりに、捨てた件数を戻り値の `qualitySuppressedCount` に計上し、静かに捨てない（元値そのものを残すべきかは §9 の要検討事項）。

`aqc` が `2` / `3`（`#` 等）その他の値の扱いは**変更しない**。従来どおり区別せず、`value` が数値なら通常の観測値、`null` なら欠測とする。

#### 3.4.3 推計フラグの付与と保存列【確定事項#6】

取得方法レポート §5 は `elems` の各桁を「`0`＝非対応 / `1`＝観測 / `2`＝推計」と記録し、推計値については「推計値であることを表示」することを求めている。江戸川臨海（`11112010`）の日照桁が `2` であり、`sun10m` / `sun1h` は**推計値**である。羽田（`11110000`）は日照桁が `0` で、そもそも行が作られない。

本 Issue はこれを DB 列として保存する。

##### migration `0017_add_amedas_estimated_flag.sql`

```sql
ALTER TABLE amedas_observation
  ADD COLUMN is_estimated INTEGER NOT NULL DEFAULT 0 CHECK (is_estimated IN (0, 1));
```

- 既存 migration の作法に従う（Issue #5 設計 §3・`apps/api/src/database/migrations.ts` を実読して確認）。
  - ファイル名は `^[0-9]{4}_[a-z0-9_]+\.sql$` に一致させる。バージョンは既存最大の `0016` の次で `0017`。
  - **forward-only**。`0016` 以前のファイルを1バイトも書き換えない（適用済み migration は sha256 チェックサムで照合されるため、既存ファイルを編集すると既存 DB で起動が失敗する）。down migration は無い。
  - **`BEGIN` / `COMMIT` / `ROLLBACK` を書かない**（runner が拒否する）。
- 真偽値の表現は既存の慣習に合わせる: SQLite に BOOLEAN 型は無く、`0008` / `0011` / `0016` はいずれも `INTEGER ... CHECK (col IN (0, 1))` としている。本列は「不明」を持たないため `NOT NULL DEFAULT 0` とし、`NULL` 許容にしない。
- **実測（2026-09-11、スクラッチ DB で確認）**: 既存行のあるテーブルに対する `ALTER TABLE ... ADD COLUMN INTEGER NOT NULL DEFAULT 0 CHECK (...)` は SQLite で成功し、既存行の値は `0` で埋まる。既存の観測行（もしあれば）は「推計でない」として扱われる。運用上、既存 PoC DB に入っている日照の行だけは実際には推計値でありながら `0` のままになるが、本 Issue のサイクルが同じブロックを再取得した時点で上書きされる（§3.7 のマージは今回値で上書きする）。

##### 付与規則

- **推計フラグは値ではなく地点の `elems` から決まる。** `target.elements` の該当桁が `'2'` の系列に属する要素キーであれば `is_estimated = 1`、それ以外は `0`。
- **値の状態と独立**である。欠測行（`value_number = null`）や AQC 由来の欠測行（§3.4.2）にも、その要素が推計系列なら `1` を立てる。「その地点がその要素を推計で提供している」という地点の構造的性質であり、観測時刻ごとに変わるものではないため。
- 極値・極値時刻（`maxTemp` / `maxTempTime` 等）は §3.4.1 の対応表どおり親系列に従属するため、親系列の桁が `'2'` ならフラグが立つ。east / trc では気温・風速桁が `1` のため実際には立たない。
- 対応表に無い未知のキー（§3.4.1「対応表に無いキーの扱い」）は、属する系列が決められないため `is_estimated = 0` とする。**推計かもしれない値を推計と断定しない。**
- `AmedasBlockNormalization.estimatedElementCount` に、フラグを立てた行数を計上する。

##### リポジトリ層への波及（既存実装への追加であり後方互換）

`amedasRepository.ts` を実読して確認した現状は次のとおりで、いずれも列を1つ増やすだけで成立する。

| 箇所 | 現状 | 変更 |
| --- | --- | --- |
| `AmedasObservationInput`（`apps/api/src/repositories/types.ts`） | `observedAt` / `element` / `valueNumber` / `valueText` / `qualityFlag` | `readonly isEstimated: boolean;` を追加する |
| `AmedasObservation` | `AmedasObservationInput extends` + `id` | 変更不要（追加フィールドが自動的に乗る） |
| `AmedasObservationRow`（行型） | 列名スネークケース | `is_estimated: number` を追加する |
| INSERT 文 | 6列・プレースホルダ6個 | `is_estimated` を加えて7列にし、`obs.isEstimated ? 1 : 0` を渡す（`bosaiBulletinRepository.ts` の `hasSighting` と同じ作法） |
| 2箇所の SELECT → map（`saveAmedasSnapshot` の stale 経路・`findAmedasSnapshot`） | 5フィールドへ写す | `isEstimated: row.is_estimated === 1` を加える。**2箇所とも直す**（片方だけ直しても型検査で落ちるため静かには壊れない） |

`is_estimated` は `NOT NULL DEFAULT 0` であり、SELECT は `SELECT *` のため、列追加そのものは既存の保存・取得ロジックを壊さない。`AmedasObservationInput` に必須フィールドを足すため、**既存の呼び出し元（`apps/api/tests/repositories.test.ts` 等）は型エラーになる。これは黙って壊れるのではなく typecheck で検出される**ので、該当箇所に `isEstimated: false` を明示して追随させる。`isEstimated` を省略可能（`?`）にしない——省略を許すと正規化層が付け忘れても通ってしまう。

### 3.5 風向コードの扱い

**変換しない。`windDirection` / `gustDirection` のコード値をそのまま `value_number` に保存する。**

理由: 2.3.4 のとおり、コード 1〜16 と方位名の対応表を公式資料・公式画面スクリプトの実読で確認できなかった。CLAUDE.md「気象庁XML電文の提供仕様は、実データ・公式資料と照合できたものだけを設計上の確定事実として扱う」および「憶測で電文仕様を補ってはならない」に従い、**未確認の対応表を正規化層へ埋め込まない**。コード値は可逆であり、対応表が確認でき次第、表示層で変換すれば保存済みデータを作り直す必要がない。

`0`（静穏）だけは取得方法レポート §5 に記録があるが、これも保存時には `0` のまま置く。表示層の責務であることを §8 で引き継ぐ。

### 3.6 地点情報の供給元（`amedastable.json` を実行時に取得するか）

**取得しない。地点コード・地点名・`elems` は Issue #109 の会場定義から受け取る。**

- 実測で `amedastable.json` は 187,742 バイト・1,286 地点を含み、必要なのは対象地点の1エントリのみである（今回の地点ブロックJSONは 5,563 バイト。60秒周期で引くと地点表が転送量の大半を占める）。
- Issue #109 は `44136`（江戸川臨海・`elems="11112010"`）と `44166`（羽田・`elems="11110000"`）を、現行地点表 JSON と公式の地域気象観測所一覧・`20260326_PointAmedas.xlsx` の双方と照合して確定させている（Issue #109 §2）。本 Issue で再確認・再定義する必要はない。
- 本 Issue が地点情報から使うのは `stationCode`（URL・DB列・`target_ref`）、`displayName`（`station_name` 列）、`elements`（非対応要素の判定、§3.4.1）の3つだけであり、すべて `AmedasTarget` に揃っている。

**本ファイル（`amedasSource.ts`）に地点コード・地点名・`elems` の定数を置かない。** Issue #109 が防ごうとした「文字列値の偶然の一致に頼った重複定義」を再生産しないためであり、同じ値を2箇所に置けば片方だけ更新される事故が起きる。代わりに `apps/api/src/venueForecastTargets.ts` へ既存 adapter 群（`resolveWarningTargetArea` 等）と同じ形で `resolveAmedasTarget(venueId)` を追加し、そこを唯一の接続点とする（§4）。

`resolveBlockKey` / `buildPointBlockUrl` も定数を参照せず、**地点コードを引数で受け取る**。

**地点表の内容が気象庁側で変わっても自動検知できない**ことは §9 の残留リスクに記す（これは Issue #109 の定義値についての話であり、本 Issue で新たに増えるリスクではない）。

### 3.7 観測の蓄積と保持時間幅

`saveAmedasSnapshot` は非 stale 保存で観測行を全削除・再投入するため、**サービス層が「既存行 ＋ 今回ブロック」をマージした完全な集合を渡す**必要がある。これを怠ると、ブロックを保存するたびに直近3時間分しか残らず、§5.13 の直近24時間グラフが成立しない。

マージ規則:

1. `findAmedasSnapshot(connection, target.stationCode)` で既存観測行を読む（**地点コードをリテラルで書かない**）
2. 今回ブロックの `(observedAt, element)` が既存と重複する場合、**今回の値で上書きする**（上流の遡及訂正を反映する。取得方法レポート §6「最新時刻が不変でも現行ブロックを10分ごとに再確認する」の意図）
3. マージ後、**最新 `observedAt` から `retentionHours`（既定 25 時間）より古い行を落とす**
4. 結果を `observations` として `saveAmedasSnapshot` に渡す

既定 25 時間は「§5.13 の直近24時間表示 ＋ 3時間ブロック境界のための余裕1時間」であり、Issue #6 §9 が Epic C へ委譲した「保持時間幅の上限」をここで確定させる。設定値として外出しし、呼び出し側が上書きできるようにする。

過去ブロックの遡り取得は既定で行わない（§5.13「24時間未取得の場合は取得済み範囲と未取得区間を明示する」は、蓄積が24時間に満たない状態を許容している）。ただし `backfillBlocks`（既定 `0`、最大 `8`）で過去ブロックを古い順に取得できるようにし、C12（初期取得・復旧）／C14 が使えるようにする。

### 3.8 1サイクルの処理順序

```
0. target = resolveAmedasTarget(state.venueId)   // state.venueId の既定は 'east'
   （以降 target.stationCode / target.displayName / target.elements だけを使う）
1. latest_time.txt を GET（fetch_attempt: amedas_latest_time）
   ├ 失敗 → 時刻系統を stale/unavailable にし、地点系統は §3.3.1-4 に従う。ブロック取得は行わない
   └ 成功 → JST ISO 8601 をパース → UTC へ正規化。前回値と比較して latestTimeChanged を求める
2. pointFetchPolicy が 'onLatestTimeChange' かつ latestTimeChanged === false
   → ブロック取得をスキップ（skipped: 'latest_time_unchanged'）。スナップショットは更新しない
3. latest_time（JST）から blockKey = `${YYYYMMDD}_${HH}`（HH = floor(JST時 / 3) * 3 のゼロ埋め2桁）を決める
4. point/{target.stationCode}/{blockKey}.json を GET
   （fetch_attempt: amedas_point、target_ref: target.stationCode、contentHash に本文の sha256）
   ├ 失敗・構造異常 → §3.3.1-3
   └ 成功 → §3.4 で正規化 → §3.7 でマージ → saveAmedasSnapshot
5. 双方の系統の状態を AmedasFetchCycleResult として返す
```

ブロック取得の失敗が時刻取得の状態に影響しないこと、およびその逆が成り立たないことが、確定事項#3 の実装上の要である。

#### 3.8.1 構造検証（失敗として扱う条件）

- JSON としてパースできない、トップレベルがオブジェクトでない
- 観測時刻キーが `^\d{14}$` に一致しない
- ブロックが空オブジェクト（観測0件）
- エントリ内の `prefNumber` / `observationNumber` から組み立てた地点コード（`prefNumber` + 3桁ゼロ埋めの `observationNumber`。east なら `44` + `136` ＝ `44136`、trc なら `44` + `166` ＝ `44166`）が **`target.stationCode` と一致しない**（誤った地点のブロックを保存しないための照合。§2.3.2 の実データで east の組み立て規則を確認済み。trc の実ブロックJSONは未取得であり、`observationNumber = 166` の実値は**実挙動未確認**）

いずれも**取得失敗と同じ扱い**（§3.3.1-3）とし、既存の観測行を上書きしない。取得方法レポート §6「不正構造・未対応コードも取得失敗と区別して記録する」に従い、`fetch_attempt.error_kind` を通信失敗（`timeout` / `network` / `http_status`）と区別して `invalid_structure` とする。

### 3.9 保存入力（`AmedasSnapshotInput` / `SnapshotMetadataInput`）の対応

上2行は `AmedasSnapshotInput` の直下フィールド、以降は `metadata`（`SnapshotMetadataInput`）である。

| 項目 | 値 |
| --- | --- |
| `stationCode` | `target.stationCode`（`AmedasSnapshotInput.stationCode: string` へそのまま渡せる。ブランド型は `string` に代入可能） |
| `stationName` | `target.displayName`（east: `江戸川臨海` / trc: `羽田`。**ソース内にリテラルを持たない**） |
| `source` | サニタイズ済みの地点ブロックJSONのURL |
| `issued_at` | `latest_time` の値（UTC）。気象庁が公表する最新観測時刻を発表時刻相当とする。時刻取得に失敗し前回値もない状態ではブロック取得自体を行わないため、この列が埋まらない状況は発生しない |
| `valid_at` | **マージ後に保持している最新の `observedAt`**（§5.10 の「観測時刻を明示する」の供給元） |
| `valid_from` / `valid_to` | マージ後に保持している観測の最古 / 最新 `observedAt`（§5.13 の「取得済み範囲」の供給元） |
| `fetched_at` | 今サイクルの実行時刻 |
| `last_success_at` | 地点系統の最終成功時刻。**時刻系統の成功では更新しない** |
| `availability` | `resolveAvailability` の戻り値（§3.3） |
| `source_version` | `${blockKey}:${本文sha256の先頭12桁}` |

## 4. モジュール・型・内部 API

```text
packages/shared/                 # 変更しない（確定事項#5）
apps/api/migrations/
└── 0017_add_amedas_estimated_flag.sql   # 新規: amedas_observation.is_estimated（§3.4.3）
apps/api/src/
├── venueForecastTargets.ts      # 変更: resolveAmedasTarget / DEFAULT_AMEDAS_TARGET を追加
├── repositories/
│   ├── types.ts                 # 変更: AmedasObservationInput に isEstimated を追加
│   └── amedasRepository.ts      # 変更: INSERT / 2箇所の SELECT→map に is_estimated を追加
├── polling/
│   ├── httpGet.ts               # 新規: jmaXmlPoller.ts から抽出（§3.2）
│   ├── jmaXmlPoller.ts          # 変更: httpGet.ts を import し、ローカル定義を削除
│   ├── amedasSource.ts          # 新規: URL組み立て・ブロックキー算出・elems 由来の非対応要素導出
│   ├── amedasParser.ts          # 新規: latest_time / ブロックJSON の純粋パーサー（DBに触れない）
│   ├── amedasFetchService.ts    # 新規: 1サイクルの取得・保存（C14 から呼ぶ入口）
│   └── index.ts                 # 変更: export 追加
apps/api/tests/
├── repositories.test.ts         # 変更: 既存の saveAmedasSnapshot 呼び出しに isEstimated を追加（3箇所）
├── venueForecastTargets.test.ts # 変更: resolveAmedasTarget の検証を追加
├── amedasParser.test.ts         # 新規
├── amedasFetchService.test.ts   # 新規
└── fixtures/jma/amedas/         # 新規（manifest.json に来歴を追記）
```

#### 4.1 会場定義との接続点

```ts
// apps/api/src/venueForecastTargets.ts（既存ファイルへ追記）

import {
  resolveVenueForecastTargets,
  type AmedasTarget,
  type VenueId,
} from '@wx-viewer-poc/shared';

/** C9 用のアメダス対象地点を会場定義から解決する。 */
export function resolveAmedasTarget(venueId: VenueId): AmedasTarget {
  return resolveVenueForecastTargets(venueId).amedas;
}

/** east 既定の後方互換 alias（Issue #109 §3.2 の DEFAULT_* と同じ作法）。 */
export const DEFAULT_AMEDAS_TARGET: AmedasTarget = resolveAmedasTarget('east');
```

他の adapter（`resolveWarningTargetArea` 等）は共有型を API 側のローカル型（`WarningTargetArea` 等）へ写し替えているが、**アメダスは写し替えない**。理由は、C9 が必要とするフィールドが `AmedasTarget` の3つ（`stationCode` / `displayName` / `elements`）とちょうど一致し、写し替え用のローカル型が既存に存在しないためである。新しいローカル型を作ると、Issue #109 が排したはずの「同じ3値を持つ別の型」を増やすことになる。`AmedasStationCode` のブランドは写し替えない方がむしろ保たれる（他コード体系との混同が型検査で弾かれ続ける）。

#### 4.2 `amedasSource.ts`

```ts
// apps/api/src/polling/amedasSource.ts

import type { AmedasTarget } from '@wx-viewer-poc/shared';

export const AMEDAS_LATEST_TIME_URL =
  'https://www.jma.go.jp/bosai/amedas/data/latest_time.txt';

export const AMEDAS_LATEST_TIME_SOURCE_KIND = 'amedas_latest_time';
export const AMEDAS_POINT_SOURCE_KIND = 'amedas_point';

/**
 * 値が数値でも欠測相当として扱う AQC 値（§3.4.2、基本設計 §5.10 追記）。
 * 5 = 休止中、6 = ×。
 */
export const AMEDAS_MISSING_EQUIVALENT_AQC: readonly number[]; // [5, 6]

/**
 * elems の桁順（気温/降水/風向/風速/日照/積雪/湿度/気圧）と、各系列に属する
 * JSON 要素キーの対応表（§3.4.1）。添字が桁位置に対応する。
 */
export const AMEDAS_ELEMENT_SERIES: readonly (readonly string[])[];

/**
 * 地点表 elems（8桁）から、その地点が提供しない要素キーの集合を導出する（§3.4.1）。
 * 桁が '0' の系列に属するキーだけを返す。'1'（観測）も '2'（推計）も非対応ではないため
 * 含めない（推計かどうかは resolveEstimatedElements が別に返す）。
 * elems が /^[0-9]{8}$/ に一致しない場合は例外を投げる（会場定義の誤り）。
 */
export function resolveUnsupportedElements(elements: string): ReadonlySet<string>;

/**
 * 地点表 elems（8桁）から、その地点が推計で提供する要素キーの集合を導出する（§3.4.3）。
 * 桁が '2' の系列に属するキーだけを返す。'0'（非対応）・'1'（観測）・その他の桁は含まない。
 * 形式検証と例外送出は resolveUnsupportedElements と同一規則。
 */
export function resolveEstimatedElements(elements: string): ReadonlySet<string>;

/** JST の最新観測時刻から 3 時間ブロックキー `YYYYMMDD_HH` を求める（§2.3.2 で実測検証）。 */
export function resolveBlockKey(latestTimeUtc: UtcIso8601String): string;

/** 地点コードはリテラルで埋め込まず引数で受け取る（§3.6）。 */
export function buildPointBlockUrl(stationCode: string, blockKey: string): string;
```

`resolveBlockKey` は地点に依存しないため引数は最新時刻のみとする（ブロック境界は全地点共通）。

#### 4.3 `amedasParser.ts`

```ts
// apps/api/src/polling/amedasParser.ts

export type AmedasParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/** `2026-09-11T19:50:00+09:00` 形式の1行を UTC ISO 8601 へ正規化する（§2.3.1）。 */
export function parseAmedasLatestTime(bodyText: string): AmedasParseResult<UtcIso8601String>;

export interface AmedasBlockNormalization {
  /** 保存対象の観測行（観測時刻昇順・element 昇順）。 */
  readonly observations: readonly AmedasObservationInput[];
  /** ブロック内の最新観測時刻（UTC）。 */
  readonly latestObservedAt: UtcIso8601String;
  readonly observedTimeCount: number;
  /** value が null だった要素の件数（欠測）。AQC由来の欠測も含む。 */
  readonly missingValueCount: number;
  /**
   * AQC が 5 / 6 のため数値を捨てて欠測行にした件数（§3.4.2）。
   * missingValueCount の内数。実観測で 0 を超えたら §9 の前提が覆ったことを意味する。
   */
  readonly qualitySuppressedCount: number;
  /** elems 非対応・aqc null で除外した件数。 */
  readonly unsupportedElementCount: number;
  /** is_estimated = 1 を立てた行数（elems 桁が '2' の系列。§3.4.3）。 */
  readonly estimatedElementCount: number;
  /** 想定外の形で除外した件数。 */
  readonly unknownShapeCount: number;
}

/**
 * ブロックJSON本文を正規化する。構造検証（§3.8.1）に失敗したら ok:false を返す。
 * target は必須。stationCode を地点照合に、elements を非対応要素の判定に使う（§3.4.1）。
 * 地点コード・elems の既定値を持たない（省略可能にすると江戸川臨海が暗黙の既定に戻る）。
 */
export function parseAmedasPointBlock(
  bodyText: string,
  target: AmedasTarget,
): AmedasParseResult<AmedasBlockNormalization>;
```

#### 4.4 `amedasFetchService.ts`

```ts
// apps/api/src/polling/amedasFetchService.ts

export interface AmedasStreamStatus {
  readonly availability: Availability;
  readonly attempted: boolean;
  readonly succeeded: boolean;
  readonly attemptedAt: UtcIso8601String | null;
  readonly lastSuccessAt: UtcIso8601String | null;
  readonly consecutiveFailures: number;
  readonly errorKind: string | null;
  readonly errorMessage: string | null;
  readonly fetchAttemptId: number | null;
}

export type AmedasPointSkipReason = 'latest_time_failed' | 'latest_time_unchanged' | null;

export interface AmedasFetchCycleResult {
  readonly latestTime: AmedasStreamStatus & { readonly value: UtcIso8601String | null };
  readonly pointData: AmedasStreamStatus & {
    readonly blockKey: string | null;
    readonly skipReason: AmedasPointSkipReason;
    readonly normalization: AmedasBlockNormalization | null;
    /** マージ・保持期間適用後に DB へ書いた観測行数。 */
    readonly savedObservationCount: number | null;
    /** 保持期間超過で落とした行数。 */
    readonly prunedObservationCount: number | null;
  };
  readonly snapshot: AmedasSnapshot | null;
}

export interface AmedasFetchOptions {
  readonly fetchFn?: typeof fetch;
  readonly clock?: () => UtcIso8601String;
  readonly timeoutMs?: number;             // 既定 10_000（取得方法レポート §6）
  readonly retentionHours?: number;        // 既定 25（§3.7）
  readonly staleAfterSeconds?: number;     // 既定 600（§3.3.1）
  readonly pointFetchPolicy?: 'always' | 'onLatestTimeChange'; // 既定 'always'
  readonly backfillBlocks?: number;        // 既定 0、上限 8（§3.7）
  readonly triggerKind?: string;           // fetch_attempt.trigger_kind。既定 'manual'
}

/** プロセス内に持つ取得状態。C14 が地点ごとに1インスタンスを保持し、渡し続ける。 */
export class AmedasFetchState {
  /** 既定 'east'（Issue #109 §3.2 と同じ「east 既定・明示注入」）。 */
  constructor(venueId?: VenueId);
  /** このインスタンスが担当する会場。生成後に変わらない。 */
  readonly venueId: VenueId;
  getLatestTime(): UtcIso8601String | null;
  getStreamStatus(kind: 'latestTime' | 'pointData'): { lastSuccessAt: UtcIso8601String | null; consecutiveFailures: number };
}

/**
 * 単発実行の入口（確定事項#2）。同一インスタンスを渡し続けると連続失敗数・前回時刻が引き継がれる。
 * 取得対象は state.venueId から解決する（引数に地点を持たせない＝取り違えの余地を作らない）。
 */
export async function runAmedasFetchCycle(
  connection: DatabaseConnection,
  state: AmedasFetchState,
  options?: AmedasFetchOptions,
): Promise<AmedasFetchCycleResult>;
```

- 対象地点の注入口は **`venueId` だけ**とする。`AmedasTarget` を生の値から組み立てる引数を用意しない。`AmedasStationCode` はブランド型であり、外部文字列をキャストして生成する経路を作ると Issue #109 §3.1 の「生成関数は共有モジュール内だけに置く」という前提が崩れるためである。テストも `resolveAmedasTarget('trc')` を通して trc を指定する。任意の `elems` に対する挙動は、プレーンな `string` を取る `resolveUnsupportedElements` の単体テストで網羅する。
- **プロセス内状態 `AmedasFetchState` は会場ごとに別インスタンスとする。** 会場は `AmedasFetchState` の生成時にのみ決まり、`AmedasFetchOptions` には持たせない。同一インスタンスで east と trc を交互に取得できてしまうと、前回最新時刻・連続失敗数が地点間で混線するためである（`latest_time.txt` は全地点共通だが、地点系統の連続失敗数は地点ごとに意味が異なる）。
- `amedasParser.ts` は **DB にも `fetch` にも触れない純粋関数**とする（既存 parser / processor の分離に合わせる）。
- `runAmedasFetchCycle` は自分でタイマーを持たない。周期・時間帯判定・同時実行の排他は C14 の責務とする。
- 例外を投げない。取得失敗・構造異常はすべて戻り値の `AmedasStreamStatus` で表現する（既存 poller と同じ方針）。
- 保存は `saveAmedasSnapshot` の1トランザクション内で完結する。`findAmedasSnapshot` によるマージ読み出しは同一サイクル内で行うが、本 PoC は単一プロセス・逐次実行のため読み書き間の排他は設けない（C14 が同一取得の同時実行をまとめる）。

## 5. 実装手順

1. `httpGet.ts` を抽出し、`jmaXmlPoller.ts` を import に差し替える。この時点で `npm run test -w apps/api` が全て通ることを確認する（挙動不変のリファクタである証拠）。
2. `apps/api/src/venueForecastTargets.ts` に `resolveAmedasTarget` / `DEFAULT_AMEDAS_TARGET` を追加し、`apps/api/tests/venueForecastTargets.test.ts` に east=`44136`/`江戸川臨海`/`11112010`、trc=`44166`/`羽田`/`11110000` の完全一致検証を足す（§4.1）。
3. migration `0017_add_amedas_estimated_flag.sql` を追加し、`AmedasObservationInput.isEstimated` と `amedasRepository.ts` の INSERT / 2箇所の SELECT→map を追随させる（§3.4.3）。既存の `apps/api/tests/repositories.test.ts` の3箇所に `isEstimated` を明示し、`npm run test -w apps/api` が通ることを確認する（`is_estimated` の往復保存を1件確認する）。
4. テスト fixture を用意する（§5.1）。
5. `amedasSource.ts` の定数・`resolveBlockKey` を実装する。ブロック境界（`00/03/…/21`）のテストを先に red にしてから通す。
6. `resolveUnsupportedElements` / `resolveEstimatedElements` を実装する。`11112010` → 非対応は積雪・気圧のみ・推計は日照のみ、`11110000` → 非対応は日照・積雪・湿度・気圧・推計は空集合、の各ケースを先に red にしてから通す（§3.4.1・§3.4.3）。
7. `amedasParser.ts` を実装する。`latest_time` のパース、ブロックJSONの構造検証・正規化（§3.4・§3.8.1）と推計フラグ付与（§3.4.3）。east / trc 双方の target で検証する。
8. `amedasFetchService.ts` を実装する。2系統の `fetch_attempt` 記録、`resolveAvailability` 経由の判定、マージ・保持期間適用、保存。
9. `index.ts` に export を追加する。
10. `npm run lint` / `npm run typecheck` / `npm run format:check` / `npm run test -w apps/api` を実行する。

### 5.1 テスト fixture の方針

Issue #18・#118 の作法（`apps/api/tests/fixtures/jma/manifest.json` に来歴を記録し、原文と合成を必ず区別する）を踏襲する。**ネットワークに出るテストは書かない**。fixture はリポジトリ内に置き、テストは注入した `fetchFn` から読む。

| 用途 | fixture | 種別 |
| --- | --- | --- |
| 最新時刻の正例 | `amedas_latest_time.txt` | **原文**（`latest_time.txt` を取得して保存） |
| 地点ブロックの正例（east） | `amedas_point_44136_block.json` | **原文**（`point/44136/{YYYYMMDD}_{HH}.json` を取得して保存） |
| **地点ブロックの正例（trc・羽田）** | `amedas_point_44166_block.json` | **原文**（`point/44166/{YYYYMMDD}_{HH}.json` を取得して保存）。江戸川臨海の原文を書き換えた合成で代用しない。取得できなかった場合に限り合成とし、`kind: "synthetic"` と代用理由を manifest に明記する |
| 積雪キー（aqc null）を含む観測 | 上記原文に含まれていればそのまま使う。含まれない場合のみ原文へ `snow1h: [0, null]` 等を足した合成 | 原文または合成 |
| 欠測（`[null, 0]`）・aqc 1/2/3/4 の値 | 原文を加工した合成 | 合成 |
| **aqc 5（休止中）・6（×）に数値が入る形**（§3.4.2） | 原文の要素の aqc を `5` / `6` に書き換えた合成 | 合成（**実観測では未確認の形。manifest の `purpose` にその旨を明記する**） |
| **推計要素の欠測・AQC由来欠測**（`sun1h: [null, 0]` / `sun1h: [23.4, 5]`。§3.4.3 の「フラグは値に依存しない」の検証） | east の原文の `sun1h` を書き換えた合成 | 合成 |
| **対応表に無い未知のキー**（例 `experimentalValue: [1.0, 0]`） | east の原文へ追加した合成 | 合成（**実観測では未確認の形**。manifest の `purpose` に明記する） |
| 構造異常（キー形式不正・空オブジェクト・地点コード不一致・JSON不正） | 合成 | 合成 |

- 原文を保存する際は、`manifest.json` に `kind: "original"`、`sourceUrl`（実URL）、`retrievedAt`、`sourceSha256` / `fixtureSha256`、`purpose` を記録する。
- 合成 fixture は `kind: "synthetic"` とし、fixture のファイル名・テスト名の双方に「公式データを加工した合成データ」である旨を明記する。**合成データを実観測として扱わない。**
- 羽田の原文ブロックに `humidity` / `sun*` キーが**含まれるかどうかは実挙動未確認**である。含まれていても含まれていなくても、正規化結果にそれらの行が出ないことが受け入れ条件である（§6）。含まれていた場合は、§2.3.3 の「キーが存在する＝観測している、ではない」がもう一例増えたことになるので manifest の `purpose` に記録する。羽田の原文に `humidity` が含まれなかった場合は、`elems` 判定が効いていることの検証にならないため、**羽田の原文へ `humidity: [55, 0]` を足した合成 fixture を別途用意する**（`elems` 由来の除外が働かなければ行が作られてしまう形）。
- 本設計の §2.3 に引用した実データは 2026-09-11 時点の取得結果である。製造担当が fixture を取得する時点では値が変わっているのが正常であり、**§2.3 の数値と一致しないことを不具合として扱わない**。構造（キーの形・ブロック境界・aqc の入り方）が一致するかだけを確認する。

## 6. 受け入れ条件

検収担当は各項目を1つずつ実行する。

### リファクタ（httpGet 抽出）

- [ ] `apps/api/src/polling/httpGet.ts` が存在し、`grep -n "async function performHttpGet" apps/api/src/polling/jmaXmlPoller.ts` が**0件**であること（コピーが残っていない）。
- [ ] `npm run test -w apps/api` で、既存の `jmaXmlPolling.test.ts` を含む全テストが通ること。

### migration・推計フラグ列（確定事項#6・§3.4.3）

- [ ] `git diff main --name-only -- apps/api/migrations/` の出力が **`apps/api/migrations/0017_add_amedas_estimated_flag.sql` の1行のみ**であること（既存 migration が1バイトも変わっていない＝forward-only の遵守。ファイル名の slug は設計と異なってもよいが、バージョンは `0017` であること）。
- [ ] `0017` の SQL に `BEGIN` / `COMMIT` / `ROLLBACK` が含まれないこと（`grep -niE "begin|commit|rollback" apps/api/migrations/0017_*.sql` が0件。migration runner が拒否する）。
- [ ] 列定義が `INTEGER NOT NULL DEFAULT 0 CHECK (is_estimated IN (0, 1))` 相当であること。既存 DB を模した検証: 空の一時 DB に `0016` までを適用して `amedas_observation` に1行入れた後 `0017` を適用し、既存行の `is_estimated` が `0` になること（一時 DB は検証後に削除する）。
- [ ] `sqlite3 <テスト用DB> "PRAGMA table_info(amedas_observation)"` に `is_estimated` が現れ、`notnull=1`・`dflt_value=0` であること。
- [ ] `AmedasObservationInput` に `isEstimated: boolean` が**必須フィールドとして**存在すること（`grep -n "isEstimated?" apps/api/src/repositories/types.ts` が0件＝省略可能になっていない）。
- [ ] `saveAmedasSnapshot` で `isEstimated: true` の行を保存し、`findAmedasSnapshot` で読み戻すと `isEstimated === true` であること。`false` の行が `false` で返ること（`0` / `1` の往復変換が両方向で正しいことの検証。`row.is_estimated === 1` を `Boolean(row.is_estimated)` 等に変えても通るが、`!== 1` のような反転があれば落ちる）。
- [ ] `saveAmedasSnapshot` の **stale 経路**（`availability === 'stale'`）で既存行を読み出した結果にも `isEstimated` が正しく載ること（SELECT→map が2箇所あり、片方だけ直す漏れの検出）。

### 会場定義との接続（確定事項#5・Issue #109 §7 の中核）

- [ ] `apps/api/src/venueForecastTargets.ts` に `resolveAmedasTarget` が存在し、`resolveAmedasTarget('east')` が `{ stationCode: '44136', displayName: '江戸川臨海', elements: '11112010' }`、`resolveAmedasTarget('trc')` が `{ stationCode: '44166', displayName: '羽田', elements: '11110000' }` と完全一致すること。
- [ ] **地点コード・地点名・`elems` が `apps/api/src` 内に重複定義されていないこと**: `grep -rn "44136\|44166\|11112010\|11110000\|江戸川臨海\|羽田" apps/api/src` が**0件**であること（これらの値は `packages/shared/src/venueForecastTargets.ts` にのみ存在する）。
- [ ] `grep -rn "AMEDAS_STATION" apps/api/src` が**0件**であること（ローカル地点定数が残っていない）。
- [ ] `buildPointBlockUrl` / `resolveBlockKey` / `parseAmedasPointBlock` のいずれも、地点コードの既定値を持たないこと（引数を省略して呼べないことを typecheck で確認する）。

### `elems` 由来の非対応要素判定（§3.4.1）

- [ ] `resolveUnsupportedElements('11112010')` が `snow` / `snow1h` / `snow6h` / `snow12h` / `snow24h` / `pressure` / `normalPressure` を含み、`humidity` / `sun10m` / `sun1h` / `temp` を**含まない**こと。
- [ ] `resolveUnsupportedElements('11110000')` が上記に加えて **`humidity` / `sun10m` / `sun1h` を含む**こと。`temp` / `precipitation1h` / `windDirection` / `wind` は含まないこと。
- [ ] `resolveUnsupportedElements('11111111')` が**空集合**であること（全桁が非ゼロ）。
- [ ] `resolveUnsupportedElements('00000000')` が対応表の全キーを含むこと。
- [ ] 桁 `2`（推計）を `0`（非対応）と混同していないこと: `'11112010'` の日照桁は `2` であり、`sun10m` / `sun1h` が除外されないこと（上記1項目目で担保。**この1文字を `0` に変異させると1項目目が落ちる**ことを確認する）。
- [ ] `resolveUnsupportedElements('1111201')`（7桁）・`'111120100'`（9桁）・`'1111201x'` でそれぞれ例外が投げられること。
- [ ] `resolveEstimatedElements('11112010')` が **`sun10m` / `sun1h` のちょうど2キー**であること（`temp` / `humidity` / `snow1h` を含まない）。
- [ ] `resolveEstimatedElements('11110000')` が**空集合**であること（羽田は日照桁が `0`＝非対応であり、推計ではない。**「非対応」を「推計」と取り違える故障の検出**）。
- [ ] `resolveEstimatedElements('22222222')` が対応表の全キーを含み、`resolveEstimatedElements('11111111')` が空集合であること。
- [ ] `resolveEstimatedElements` が `resolveUnsupportedElements` と同じ形式検証を行い、7桁・9桁・非数字で例外を投げること。
- [ ] 2つの集合が**互いに素**であること: 任意の `elements`（上記ケース全て）で `resolveUnsupportedElements` と `resolveEstimatedElements` の積集合が空であること。
- [ ] 対応表がビット演算で実装されていないこと: `grep -n "&\s*1\|>>\|<<\|parseInt(.*2)" apps/api/src/polling/amedasSource.ts` が0件であること（Issue #109 の `AmedasTarget.elements` doc コメント「ビット演算による機能推測には使用しない」の遵守）。

### ブロックキー算出

- [ ] `resolveBlockKey` に JST `2026-09-11T19:50:00+09:00` 相当の UTC 値を与えると `20260911_18` を返すこと（§2.3.2 の実測と一致）。
- [ ] JST `00:00` → `20260912_00`、`02:59` → `..._00`、`03:00` → `..._03`、`21:00` → `..._21`、`23:59` → `..._21` を返すこと（境界5点）。
- [ ] JST `2026-01-01T00:10:00+09:00` に対し、UTC 日付（前日 15:10Z）ではなく **JST 日付** `20260101_00` を返すこと（日付境界でローカル日付・UTC日付を流用していないことの検証）。

### latest_time パーサー

- [ ] 原文 fixture（オフセット `+09:00` 付き1行、末尾改行なし）を与えると `ok: true` で UTC ISO 8601（`...Z`）を返すこと。
- [ ] 前後に空白・改行を付けた入力でも同じ値を返すこと。
- [ ] 空文字・`not a time`・`2026-09-11 19:50:00`（T なし）を与えると `ok: false` となり、例外を投げないこと。

### ブロックJSON 正規化（east・江戸川臨海）

以下は `resolveAmedasTarget('east')` を `parseAmedasPointBlock` に渡して検証する。

- [ ] 原文 fixture を正規化した結果に、`temp` / `humidity` / `windDirection` / `wind` / `precipitation1h` の行が**各観測時刻ぶん**含まれること。
- [ ] `observedAt` が UTC ISO 8601 で、JST キー `20260911195000` に対し `2026-09-11T10:50:00.000Z` 相当であること。
- [ ] **`snow1h` / `snow6h` / `snow12h` / `snow24h` / `pressure` 系の行が1件も作られないこと**（§3.4.1）。`observations.some((o) => o.element.startsWith('snow'))` が false であること。
- [ ] `[0, null]` 形の要素が `unsupportedElementCount` に計上され、`value_number = 0` の行として保存されないこと（**基本設計 §5.10「欠測等を0として表示しない」の直接の検証**）。
- [ ] `[null, 0]` 形（合成 fixture）が**行として作られ**、`valueNumber === null`、`qualityFlag === 0` であり、`missingValueCount` に計上されること。
- [ ] `[23.4, 1]` / `[23.4, 4]` 形（合成 fixture）が通常の観測値として `valueNumber = 23.4` で保存され、`qualityFlag` に `1` / `4` が入ること（§3.4 の「AQCで区別しない」確定事項の検証）。
- [ ] **`[23.4, 5]` 形（合成 fixture）が行として作られ、`valueNumber === null`、`qualityFlag === 5` であること**（§3.4.2。数値 `23.4` がどこにも保存されていないこと＝`valueText === null` も併せて確認する）。
- [ ] **`[23.4, 6]` 形（合成 fixture）も同様に `valueNumber === null`、`qualityFlag === 6` の行になること**。
- [ ] 上記2件が `qualitySuppressedCount` に計上され（同一 fixture で `=== 2`）、かつ `missingValueCount` にも含まれること（内数であることの検証）。
- [ ] `[23.4, 5]` / `[23.4, 6]` の要素が `unsupportedElementCount` に計上され**ない**こと（観測非対応ではなく欠測として扱っている、の検証）。
- [ ] `[23.4, 5]` だけを含む fixture で `parseAmedasPointBlock` が `ok: true` を返し、`amedasFetchService` 経由で保存したスナップショットの `availability` が `available` であること（AQC由来の欠測が availability を下げないことの検証、§3.4 末尾）。
- [ ] `[23.4, 2]` / `[23.4, 3]` 形（合成 fixture）は従来どおり `valueNumber = 23.4` の通常値として保存されること（例外扱いが `5` / `6` に限定されていることの検証）。
- [ ] `maxTempTime: {"hour": 5, "minute": 23}` が `element='maxTempTime'`、`valueNumber === null`、`valueText === '05:23'` の行になること。`minTempTime` の `hour: 23`（前日分と解釈しうる値）でも日付を補完せず `'23:21'` のまま保存すること。
- [ ] `windDirection` が**コード値のまま**（例 `2`）保存され、方位名の文字列がリポジトリ全体に存在しないこと: `grep -rn "北北東\|南南西" apps/api/src` が0件であること（§3.5）。
- [ ] `prefNumber` / `observationNumber` が `element` 行として保存されていないこと。

#### 推計フラグ（§3.4.3）

- [ ] east の原文 fixture を正規化した結果で、**`sun10m` / `sun1h` の行がすべて `isEstimated === true`** であること（江戸川臨海の日照桁は `2`）。
- [ ] 同じ結果で、**`temp` / `humidity` / `windDirection` / `wind` / `precipitation1h` の行がすべて `isEstimated === false`** であること（桁 `1`＝観測。「全部立てる」故障の検出）。
- [ ] `estimatedElementCount` が `sun10m` / `sun1h` の行数の合計と一致すること。
- [ ] 日照が**欠測**（`sun1h: [null, 0]`、合成 fixture）でも `isEstimated === true` であること（フラグが値の有無に依存しないことの検証。§3.4.3）。
- [ ] AQC `5` で欠測化した日照の行（合成 fixture）でも `isEstimated === true` であること。
- [ ] `runAmedasFetchCycle`（east）で保存した後、`sqlite3 <テスト用DB> "SELECT DISTINCT element FROM amedas_observation WHERE is_estimated = 1"` が `sun10m` / `sun1h` のみを返すこと。
- [ ] trc（羽田）のサイクルで保存した `amedas_observation` に `is_estimated = 1` の行が**1件も無い**こと（羽田は日照が非対応であり、行自体が作られない）。
- [ ] 対応表に無い未知のキー（合成 fixture、例 `experimentalValue: [1.0, 0]`）が保存され、その行の `isEstimated === false` であること（§3.4.3「推計かもしれない値を推計と断定しない」）。
- [ ] 構造異常4種（JSON不正、トップレベルが配列、観測時刻キーが `20260911_1800`、`observationNumber` が `137`）でそれぞれ `ok: false` となり、例外を投げないこと。
- [ ] 空オブジェクト `{}` で `ok: false` となること。

### ブロックJSON 正規化（trc・羽田）— Issue #109 §7 引き継ぎの検証

以下は `resolveAmedasTarget('trc')` を `parseAmedasPointBlock` に渡して検証する。**同じ入力を east の target で正規化した場合との差分**が検証の本体である。

- [ ] 羽田の fixture（原文。取得できなければ合成）を trc の target で正規化した結果に、**`humidity` の行が1件も無い**こと（`observations.some((o) => o.element === 'humidity')` が false）。
- [ ] 同じく **`sun10m` / `sun1h` の行が1件も無い**こと。
- [ ] 同じく `snow*` / `pressure` 系の行が1件も無いこと。
- [ ] **`temp` / `precipitation1h` / `precipitation24h` / `windDirection` / `wind` の行は各観測時刻ぶん存在する**こと（非対応判定が効きすぎて全部消える故障を検出する）。
- [ ] **`humidity: [55, 0]` を含む fixture を用意し、trc の target では行が作られず `unsupportedElementCount` に計上され、east の target では `valueNumber === 55` の行が作られること。** 同一入力・target 違いで結果が変わることを1つのテストで対比する（これが「地点固定の実装に戻っていない」ことの決定的な証拠になる）。
- [ ] 羽田の正規化で欠落した湿度・日照を、江戸川臨海の値で補完していないこと: trc の正規化結果の `element` 集合に湿度・日照が現れないこと（上記2項目）に加え、`runAmedasFetchCycle` を `new AmedasFetchState('trc')` で実行したときに**発行された HTTP リクエストURLに `44136` が一度も現れない**こと（注入した `fetchFn` の呼び出しURL一覧で確認。Issue #109 §7「別地点へのフォールバックは禁止」の検証）。
- [ ] `new AmedasFetchState('trc')` のサイクルで保存された `amedas_snapshot` の `station_code === '44166'`、`station_name === '羽田'` であり、east のサイクルで保存した行（`44136`）を上書きしていないこと（`amedas_snapshot` の UNIQUE 制約は `(station_code)` なので2行が共存する）。
- [ ] trc のサイクルの `fetch_attempt` で `source_kind='amedas_point'` の行の `target_ref === '44166'` であること。

### 2系統 availability（確定事項#3 の中核）

以下はすべて `fetchFn` を注入した `amedasFetchService.test.ts` で検証する。

- [ ] **正常系**: 両方成功したサイクル後、`fetch_attempt` に `source_kind='amedas_latest_time'` と `'amedas_point'` の行が**それぞれ1件ずつ**記録され、`amedas_snapshot.availability === 'available'` であること。
- [ ] **地点だけ失敗**: 1回目を成功させた後、2回目で地点ブロックのみ HTTP 500 を返すと、
      (a) `result.latestTime.availability === 'available'`、
      (b) `result.pointData.availability === 'stale'`、
      (c) `findAmedasSnapshot` の観測行が**1回目と同一件数・同一内容で残っている**こと（前回正常値の保持）、
      (d) `amedas_snapshot.last_success_at` が1回目の時刻のままで、時刻取得の成功では更新されていないこと。
- [ ] **時刻だけ失敗**: 1回目成功後、2回目で `latest_time.txt` のみタイムアウトさせると、
      (a) `result.latestTime.availability === 'stale'`、`consecutiveFailures === 1`、
      (b) 地点ブロックへの HTTP リクエストが**発行されていない**こと（注入した `fetchFn` の呼び出しURL一覧で確認）、
      (c) `skipReason === 'latest_time_failed'`、
      (d) 観測行が1回目のまま残っていること。
- [ ] **初回から両方失敗**: DB に既存行がない状態で両方失敗させると、`amedas_snapshot.availability === 'unavailable'` となり、`amedas_observation` が0件であること。例外を投げないこと。
- [ ] **unavailable でデータを消さない**: 正常サイクルの後に両方失敗させても `availability` は `'stale'` にとどまり、`'unavailable'` にならず、観測行が消えないこと（§3.3.2 の地雷の検証）。
- [ ] **stale の期限**: 時刻取得が失敗し続けたまま `staleAfterSeconds` を超える時刻を `clock` で与えると `availability` が `'stale'` へ落ち、観測行は保持されたまま `fetched_at` だけが更新されること。
- [ ] エラー種別が区別されること: タイムアウト → `errorKind === 'timeout'`、HTTP 500 → `'http_status'`、JSON構造異常 → `'invalid_structure'`。構造異常時の `fetch_attempt.outcome` が `'failure'` であること。

### 蓄積とマージ

- [ ] 同じブロックを2回取得しても観測行が二重にならず、`(observedAt, element)` が一意であること。
- [ ] 2回目のブロックで同一 `(observedAt, element)` の値が変わっていた場合、**新しい値で上書きされている**こと（遡及訂正の反映）。
- [ ] 連続する2ブロック（例 `_15` と `_18`）を順に与えると、**両ブロックの観測行が残る**こと（`saveAmedasSnapshot` の全削除・再投入でデータが消えないこと。§3.7 の中核）。
- [ ] `retentionHours: 25` の既定で、最新観測時刻から26時間前の観測行が保存対象から落ち、`prunedObservationCount` に計上されること。
- [ ] `valid_at` がマージ後の最新 `observedAt` と一致し、`valid_from` / `valid_to` が保持範囲の最古 / 最新と一致すること。
- [ ] `issued_at` が `latest_time` の値（UTC）と一致すること。

### スケジューラを持ち込んでいないこと（確定事項#2）

- [ ] `grep -rn "setInterval\|setTimeout" apps/api/src/polling/amedas*.ts` が**0件**であること（`httpGet.ts` のタイムアウト実装は対象外）。
- [ ] `runAmedasFetchCycle` を1回 await すると、追加の待機なくその場で完了すること。

### 品質ゲート

- [ ] `npm run lint`（`--max-warnings 0`）がエラー0で通ること。
- [ ] `npm run typecheck` がエラー0で通ること。
- [ ] `npm run format:check` が差分0で通ること。
- [ ] `npm run test -w apps/api` が全て通ること。
- [ ] `git diff main --stat -- apps/web packages/shared` が**空**であること（本 Issue はフロントと shared を変更しない）。
- [ ] `apps/api/tests/fixtures/jma/manifest.json` に、追加した全 fixture の `kind`（`original` / `synthetic`）・出典・取得日時が記録されていること。

## 7. 対象外（本 Issue で実装しないこと）

- 定期実行・時間帯別周期・同時実行の排他（C14）
- 指数バックオフによる次回取得の抑止（C13。本 Issue は連続失敗数を数えるのみ）
- 内部REST API・フロントエンド表示（Epic E / F）
- 風向コード → 16方位名の変換（§3.5）
- `amedastable.json` の実行時取得（§3.6）
- 会場定義に無い任意地点への一般化（`AmedasTarget` は `VenueId` 経由でのみ得る。§4.4）
- **east と trc を同一プロセスで同時に収集・保存する運用**（Issue #109 §3.2・§7。本 Issue は east 既定・`AmedasFetchState('trc')` による明示注入まで）
- 会場IDを内部REST APIの契約へ露出する設計（Epic E。Issue #109 §8-3 と同じく未決）
- 推計値であることの**表示**（注記・記号・凡例・ツールチップ等）。本 Issue は `amedas_observation.is_estimated` に保存するところまでで、表示は Epic E / F（§3.4.3・§8）
- 推計フラグ以外の DB スキーマ変更（本 Issue の migration は `0017` の1本・1列のみ）
- 非対応要素の保存（`elems` の該当桁が `0` の系列。east では積雪・気圧、trc ではさらに日照・湿度。§3.4.1）
- `quality_flag` を使った値の採否判定・表示分岐（基本設計 §5.10 確定）。**例外は AQC `5` / `6` の欠測化のみで、これは正規化層で完結させ、表示層には `value_number === null` としてだけ見せる（§3.4.2）**
- 訓練・試験区分の扱い（アメダスに該当概念なし。§3.1）

## 8. 後続 Issue への引き継ぎ

- **C14** は `AmedasFetchState` を**会場ごとに**1インスタンス保持し、時間帯別周期で `runAmedasFetchCycle` を呼ぶ。基本設計 §8.3 の「最新時刻は60秒、現行ブロックは10分ごとに再確認」は、`pointFetchPolicy: 'onLatestTimeChange'` で毎回呼びつつ、10分に1回だけ `'always'` にする、という使い分けで表現できる。
- **C13** はバックオフ待機を被せる。`AmedasStreamStatus.consecutiveFailures` を入力に使える。既存の `calculateBackoffDelaySeconds` は `FeedBackoffManager`（`JmaXmlFeedKind` キー）に閉じているため、アメダスへ適用する際はキー型の一般化が必要になる。**本 Issue では既存の型を変更しない。**
- **C12（初期取得・復旧）** は `backfillBlocks` を使って起動時に過去ブロックを遡れる。ただし24時間分を揃えるかどうかは未決（§9）。
- **Epic E** は `amedas_snapshot.availability` を地点データの状態としてそのまま露出し、時刻確認の状態は別フィールドとして扱う。1つの OK/NG に畳まない（CLAUDE.md）。`valid_from` / `valid_to` が §5.13 の「取得済み範囲と未取得区間の明示」の入力になる。
- **Epic E / F（表示）** は欠測判定に `value_number === null` だけを見ればよい。AQC `5` / `6` は正規化層で既に `value_number = null` にしてあるため、表示層が `quality_flag` を解釈する必要はない（§3.4.2）。将来「休止中」を独自の記号で出し分けたくなった時に限り `quality_flag` を参照する。
- **Epic F（表示）** が風向コード → 方位名の変換を担う。**対応表は公式資料で実読して確定させてから実装すること**（§2.3.4。今回は確認できなかった）。`0 = 静穏` のみ取得方法レポート §5 に記録がある。
- **Epic G（監視画面）** の「取得元別状態」は `fetch_attempt` を `source_kind IN ('amedas_latest_time','amedas_point')` で2行に分けて集計する。§8.5 の「時刻確認だけの成功を地点データ更新成功として表示しない」はこの分離で満たされる。会場を分けて表示する場合は `source_kind='amedas_point'` の行を `target_ref`（地点コード）でさらに分ける。`latest_time` は全地点共通のため会場別に分けられない（`target_ref` が `null`）ことに注意する。
- **G6** は「羽田に湿度・日照が無い」ことを**通信異常や欠測と区別して**表示する。本 Issue の正規化層は非対応要素の行を作らないため、G6 は `resolveVenueForecastTargets(venueId).amedas.elements` の該当桁が `0` であることを見て「未提供」と表示する。**行が無いことだけを見て「欠測」や `unavailable` と表示しない。** 行が無い原因は「非対応」「その観測時刻に未出現」の2つがあり、両者を `elems` 無しに区別できない。
- **Epic E / F（表示）** は「推計値であることを表示」する（取得方法レポート §5）。参照すべきは **`amedas_observation.is_estimated`（`INTEGER NOT NULL DEFAULT 0`、`1`＝推計値。§3.4.3）**であり、本 Issue の正規化層が地点の `elems` から付与済みである。**表示層が `elements` の桁を自前で解釈し直さない**（同じ判定が2箇所に増え、片方だけ更新される事故を招く）。内部REST API（Epic E）はこのフラグを観測値と同じ粒度（`(observedAt, element)` ごと）で露出させる。現時点で `1` が立つのは east（江戸川臨海）の `sun10m` / `sun1h` のみである。
- **推計フラグは「値の信頼度」ではなく「地点がその要素を推計で提供している」という地点の構造的性質**である。欠測行にも立つ（§3.4.3）。したがって表示層は `value_number === null`（欠測）と `is_estimated === 1`（推計）を**直交する2軸**として扱い、どちらか一方に畳まない。
- **複数会場の同時収集**（Issue #109 §7「複数会場の常時処理」）は本 Issue の範囲外だが、アメダスに限れば `telegram_reception.adoption_result` の制約を受けない（電文ではなくJSONであり、受信採用履歴を書かない。§3.1）。`amedas_snapshot` の UNIQUE も `(station_code)` であり、east と trc は別行として共存できる。**したがってアメダスだけは、C14 が `AmedasFetchState` を2つ持てば同時収集が成立する見込みである。**ただし `latest_time.txt` を会場ごとに二重取得しないための共有方法（時刻系統を会場間で1つにまとめるか、地点系統だけを会場ごとに回すか）は未設計であり、C14 で決める。
- 取得方法レポート §5 の「積雪・気圧キーは観測JSONに存在しない」という記述は、2026-09-11 の実データで**反証された**（§2.3.3）。レポート本文の更新は本 Issue の対象外だが、次にレポートを改訂する機会に反映すべきである。

## 9. 残留リスク・実挙動未確認の事項

- **風向コードの方位名対応表が未確認**（§2.3.4）。本 Issue はコード値を保存するだけなので影響を受けないが、表示層が独自の記憶で表を書くと静かに誤表示になる。
- **AQC が `0` / `null` 以外の実観測を入手できていない（実挙動未確認）**。`1` / `2` / `3` / `4` / `5` / `6` の扱いはすべて合成 fixture でしか検証できない。ただし**仕様としては確定している**: `5` / `6` は欠測相当（§3.4.2、基本設計 §5.10 追記）、それ以外は区別せず `value` が `null` なら欠測行・数値なら通常値。残るのは「実データがこの通りの形で現れるか」の未検証点のみであり、`qualitySuppressedCount` が実運用で 0 を超えたら実例を入手できたことを意味する。
- **AQC `5` / `6` で捨てた元の数値を残すかは未決**（§3.4.2）。本設計は表示層への誤流入を防ぐため保存しない。将来「休止中でも参考値として見たい」となった場合、過去分は再取得が必要になる。`value_text` に退避する案もあるが、極値時刻の `"HH:MM"` と型が混ざるため採らなかった。
- **`aqc === null` を観測非対応として除外する規則**は、積雪要素での実データ観察（§2.3.3）と AQC 表の「7/null は空欄相当」から導いた。提供対象の要素で `aqc` が `null` になる事例は確認していない。万一そうなった場合、その観測は保存されず、欠測ですらなく行が消える（表示は空白）。件数は `unsupportedElementCount` に出るため、運用で検知できる。
- **地点表を実行時に取得しない**ため、気象庁側で `44136` / `44166` の名称・`elems` が変わっても自動検知できない。Issue #109 §2 の確認日（2026-09-10）が古くなったら再確認する運用が必要であり、その際に更新するのは `packages/shared/src/venueForecastTargets.ts` の1箇所だけである。
- **羽田（`44166`）のブロックJSONを本設計時点で実読していない（実挙動未確認）。** `prefNumber: 44` / `observationNumber: 166` という組み立てが実データでそうなっているか、`humidity` / `sun*` キーが存在するかは、製造担当が fixture を取得して確認する（§5.1）。`observationNumber` の実値が想定と異なれば §3.8.1 の地点照合が全サイクルで失敗する（`invalid_structure`）ため、静かに壊れるのではなく取得失敗として検知できる。
- **`elems` の桁とJSON要素キーの対応表（§3.4.1）のうち、極値・突風系（`maxTemp` / `minTemp` / `maxTempTime` / `minTempTime` / `gust` / `gustTime` / `gustDirection`）の所属は設計判断であり、公式資料で明示された対応ではない。** east / trc はいずれも気温・風向・風速の桁が非ゼロのため、この判断が結果に影響する地点は現時点で存在しない。気温桁または風速桁が `0` の地点を将来追加する場合は、実データで再確認すること。
- **推計の根拠が地点表 `elems` の桁定義（`2`＝推計）だけであり、実データで「この値は推計である」と名乗る情報は無い（実挙動未確認）。** 桁の意味は取得方法レポート §5 の記録に依拠している。江戸川臨海の日照が実際に推計値かどうかを観測JSONそのものから検証する手段は無く、`is_estimated` の正しさは `elems` の桁定義の正しさに等しい。`elems` の桁定義が誤っていた場合、フラグは静かに誤る（表示上は推計注記の有無が変わるだけで、値そのものは変わらない）。
- **`elems` の桁が `3`〜`9` の地点は未確認**。本設計は `'0'` 以外・`'2'` 以外を `'1'`（観測）と同じに扱う（§3.4.1）。将来 `3` 以降の定義が判明した場合、それらの地点の推計フラグは誤って `0` になる。east / trc はいずれも `0` / `1` / `2` のみで構成されているため現時点の影響は無い。
- **既存 DB に既に入っている観測行の `is_estimated` は `0` で埋まる**（`ALTER TABLE ... DEFAULT 0`、§3.4.3 で実測確認）。PoC 段階でアメダスの観測行を本格投入した DB は存在しない見込みだが、もし存在すれば日照の過去行だけは推計フラグが立たないまま残る。同じブロックを再取得すれば §3.7 のマージで上書きされる。
- **極値時刻（`maxTempTime` 等）の日付境界**は依然として未確認（取得方法レポート §5、Issue #6 §8 と同じ）。本設計は時分のみを文字列保存し、日付を補完しない。表示に使う場合は先に解釈を確定させること。
- **`staleAfterSeconds = 600` / `retentionHours = 25`** はいずれも基本設計 §8.3・§5.13 から導いた設計値であり、実測に基づく閾値ではない。設定で上書きできる形にしてある。

## 10. 実装上の注意

- `saveAmedasSnapshot` は `availability !== 'stale'` のとき既存観測行を**全削除して再投入する**。マージせずに今回ブロックだけを渡すと、直近3時間分しか残らず §5.13 の24時間グラフが静かに壊れる（§3.7）。
- `availability` を文字列リテラルで直接組み立てない。必ず `resolveAvailability` を通す（§3.3.2）。
- JST の日付・時刻の算出に `new Date()` のローカルタイムゾーンへ依存しない。実行環境が UTC のことがある。JST 固定オフセット（+9時間）で計算し、**雨雲レーダーの UTC 形式の流用もしない**（取得方法レポート §5 の明示的な注意）。
- `httpGet.ts` の抽出では `Accept` の既定値を現行のXML用文字列のままにする。既定を変えると XML 側の挙動が黙って変わる。
- `fetch_attempt.request_url` にはサニタイズ済みURLを入れる（既存 poller と同じ）。
- テストで実ネットワークへ出ない。`fetchFn` を必ず注入する。
- **地点コード・地点名・`elems` を `apps/api/src` に書かない。** 唯一の定義元は `packages/shared/src/venueForecastTargets.ts` であり、接続点は `resolveAmedasTarget` だけである（§3.6・§4.1）。「江戸川臨海だけ動けばよい」という近道を取ると、羽田で湿度が保存され Issue #109 §7 の引き継ぎに反する。
- **`0016` 以前の migration ファイルを書き換えない。** 適用済み migration は sha256 チェックサムで照合されるため、既存ファイルを1バイトでも編集すると既存 DB での起動が失敗する。推計フラグは必ず新規の `0017` で追加する（§3.4.3）。
- **`is_estimated` は `elems` の桁 `'2'` からのみ導出する。** 要素キー名（`sun*` 等）を直接見て立てない。江戸川臨海で日照が推計であることは地点の性質であり、日照という要素の性質ではない（他地点では日照桁が `1`＝観測のこともある）。
- **`resolveUnsupportedElements` と `resolveEstimatedElements` を同じ桁走査から作り、判定を二重に書かない。** 「非対応」と「推計」を取り違える故障が最も起きやすい箇所であり（`'0'` と `'2'` はどちらも「ふつうの観測ではない」）、受け入れ条件では羽田（日照桁 `0`）の推計集合が空であることで検出する。
- **`elements` をビット演算しない。** 8桁の各桁は独立した1文字（`0`/`1`/`2`）であり、2進数でも数値でもない（Issue #109 の `AmedasTarget.elements` doc コメント）。`parseInt` して `& 0b...` するような実装は `2`（推計）で静かに誤る。
- `resolveUnsupportedElements` の形式異常（8桁でない `elements`）は**例外を投げる**。会場定義の誤りは実行時のデータ異常ではなく実装の誤りであり、`fetch_attempt` に `invalid_structure` として記録して黙って続行すると、非対応要素の除外が効かないまま運転を続けることになる（§3.4.1）。
- 本 Issue では `apps/web` と `packages/shared` を変更しない。`apps/api/src/venueForecastTargets.ts` への `resolveAmedasTarget` 追加は既存 adapter 群への追記であり、既存関数のシグネチャを変えない。
