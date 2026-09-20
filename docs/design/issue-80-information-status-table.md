# Issue #80 K7：情報別反映状況テーブルの実装

- 状態：設計承認済み・製造開始待ち
- 対象：K7 #80のみ。設計担当：Claude（wxviewer-designer）
- 設計日：2026-09-21（同日改訂：ユーザー決定事項を反映し、未決事項をすべて確定）
- 前提：K6 #79の実装後、**K6のブランチ上で**着手する。ブランチは実装着手時に統括担当が切る。
- 本設計フェーズではコード・設定・ブランチ・コミットを変更しない。

## 1. 根拠と参照資料

| 資料 | 本設計で導いた判断 |
| --- | --- |
| [Issue #80](https://github.com/BlueKurage119/wx-viewer-poc/issues/80) | K7の範囲（情報別反映状況テーブル）、受け入れ条件、AD-H040/045/063/070の結論記録義務 |
| [Issue #74 設計書](issue-74-monitoring-dashboard-layout.md) §3.2, §4.2, §4.3, §9 | 表骨格の列見出し・8行の行名、処理待ちカードの現行仕様、状態色トークン、「未取得を理由に異常としない」「既知の失敗を『—』で隠さない」、K7への引き継ぎ事項 |
| [Issue #79 設計書](issue-79-source-status-table.md) §5.1, §5.2, §6, §9 | 共通の日時フォーマッタ、`SourceStatusCell`、取得元表の実装位置。K7が再利用してよい旨の明記 |
| `packages/shared/src/monitoringStatus.ts` | `MonitoringInformationSection` の実フィールド。K7が使える値の上限 |
| `packages/shared/src/types.ts` `CommonMetadata` | `validAt` が基準時刻、`issuedAt` が発表時刻、`fetchedAt` がサーバー取得時刻であること |
| `packages/shared/src/availability.ts` | `Availability` 3状態と、保持値の有無・鮮度が別軸であること |
| `packages/shared/src/venueForecastTargets.ts` | 会場ごとの対象地域・地点の表示名の唯一の出どころ |
| `apps/api/src/monitoring/monitoringStatusService.ts` `buildInformationForVenue` | `information` が全会場×8種で返ること、各 `kind` の値の実際の埋め方 |
| `apps/web/src/monitoring/MonitoringDashboard.tsx` / `monitoringPresentation.ts` / `monitoring.css` | K1が実装済みの骨格と、K7が差し替える範囲 |
| [気象データ業務標準](../rules/07-wx-data-protocol.md) | availability 3状態の縮退禁止、`isTraining` の扱い、確定/未確定の区別 |
| [UI業務標準](../rules/06-ui-md3-protocol.md) | HEX直書き禁止、状態色はトークン参照 |

### 1.1 統括担当から渡された確定事項（ユーザー判断）

| # | 確定内容 | 本書での反映箇所 |
| --- | --- | --- |
| 1 | 反映状態はK7では「利用可能」「情報なし（正常・対象情報なし）」「未取得」の3つだけ。availability 3状態をそのまま対応付ける。取得異常・解析異常・未対応形式の赤表示とラッチはK8 #81で拡張。「要確認」等の追加文言は付けない | §4.2 |
| 2 | 情報時刻は「基準時刻」（`validAt`）とする。注釈は付けない。発表/観測/基準の区別表示はしない | §4.3 |
| 3 | `summaryCount` が `null` のときは「—」と表示する | §4.4 |
| 4 | 会場は `requestedVenueId` のみ表示する。他会場は表示せず、展開・切替UIも作らない | §4.1 |
| 5 | 内訳展開（警報級の可能性の2表、キキクルの各種別）は不要。API拡張もしない | §5 |
| 6 | 新着がないこと・発表時刻が古いことだけで異常表示にしない。テストで確認できる受け入れ条件にする | §8 AC-6 |
| 7 | APIの拡張は行わない。既存DTOで表示できる範囲に限る | §3 |
| 8 | **処理待ちカードから他会場の表示を消す変更をK7の範囲に含める。** 自会場が完了なら、他会場が再処理中でも「再処理完了」のみの表示になることを許容する | §6 |
| 9 | **AD-H040 は「K7では表示せず K8 #81 / E10 #42 へ残す」で確定** | §10 |
| 10 | **対象地域・地点は案C。** 気象防災速報のみ市区町村名を流用し、雨雲・キキクルは「—」とする。雨雲・キキクルの「—」がK1の「—＝未接続・欠測」と同じ見た目になることは承知のうえで採用する | §4.5 |
| 11 | **`stale` は「情報なし」で確定。** 表示語の拡張はK8 #81 で行う | §4.2 |
| 12 | **合成行（警報級の可能性・雨雲・キキクル）に「どの系列が落ちているか」を書かない** | §5 |
| 13 | **時刻書式は K6 と同じ日付入り `MM/DD HH:mm:ss`（年なし）。日付が `generatedAt` と同じでも省略しない。K6が切り出す共通の日時フォーマッタを再利用する** | §4.3 |

## 2. 対象範囲

### K7で実装するもの

- `MonitoringDashboard.tsx` の下段2表のうち **「情報別の反映状況」表だけ** を、`MonitoringStatusResponse.information` の実データへ接続する。
- 8行固定・6列の行データ生成（純粋関数）と、その単体テスト。
- 反映状態3値の表示語・状態色トークンの適用。
- 「新着なし・発表時刻が古い」だけでは異常表示にならないことのテスト。
- **処理待ちカードを自端末会場（`requestedVenueId`）のみの表示へ変更する（確定事項8、§6）。**

### K7で実装しないもの（対象外）

- 取得元別の稼働状況表（K6 #79）。K7はこの表とそのロジックに触れない。
- サーバー／共有DTOの拡張（確定事項7）。`internalErrorCount` 等の新フィールドを足さない。K6がE10契約へ追加する `lastDurationMs` にもK7は触れない。
- 取得異常・解析異常・未対応形式の赤表示と、K8の状態診断でリセットするまで赤を保持するラッチ（K8 #81）。
- 内訳展開UI（確定事項5）。
- 会場切替・他会場表示（確定事項4・8）。
- 取得運転・取得健全性・スケジュールの3カード（K1実装済み）の変更。

## 3. 既存実装の境界（実コードで確認した事実）

実コードを読んで確認した内容のみを記す。未確認のものは §10 に分離する。

1. `MonitoringDashboard.tsx` の `SkeletonTable` が2表とも描画しており、`INFORMATION_HEADERS` は実装上 **`['情報名','対象地域・地点','反映状態','情報時刻','反映時刻','有効な情報件数']`** である。K1設計書§3.2の表は最終列を「要約」と書いているが、**実装済みの見出しが正**であり、K7はこの6列を維持する。Issue #80本文の「内容の要約」も同じ列を指す。
2. K1時点の情報表は行名以外すべて `—`（`monitoring-unavailable`）であり、**実データは一切接続されていない**。K7が初接続となる。
3. `MonitoringStatusResponse.information` は API 側 `buildInformationForVenue` により **全会場（east/trc）× 8種 = 16要素**で返る。配列順は `warning, warning_timeseries, early_warning, amedas, area_timeseries, bosai_bulletin, nowcast, kikikuru` であり、**画面の表示順とは異なる**。K7は配列順に依存せず `kind` で引く。
4. `bosai_bulletin` の要素は API 実装上 `issuedAt / validAt / fetchedAt / lastSuccessAt` が **常に `null`** で、`summaryCount` は常に数値（`bulletins.length`）である。つまり気象防災速報行の時刻2列は K7 では必ず「—」になる。これは API 側の作りであり、確定事項7によりK7では直さない（§10、§11へ引き継ぐ）。
5. `early_warning` / `nowcast` / `kikikuru` は API 側で既に **`worseAvailability` による悪い方の合成**が行われており、件数は各要素の合算、時刻は「悪い方の系列のメタ情報」である。**片方の失敗が全体成功に隠されない**という要件はこの合成規則によってサーバー側で既に満たされている。ただし「どちらが失敗しているか」はDTOに出ていない。
6. `MonitoringInformationSection` に **対象地域・地点の名称は存在しない**。`venueId` と `kind` から `VENUE_FORECAST_TARGETS` を引くのがフロントで名称を得る唯一の手段である。
7. `VENUE_FORECAST_TARGETS` の `bosaiBulletin.includedAreaCodes` の先頭要素は、east が `'1310800'`、trc が `'1311100'` であり、**同会場の `warning.municipalCode`（それぞれ `'1310800'` / `'1311100'`）と一致する**。案C の「市区町村名の流用」はこの一致を根拠とする（§4.5）。
8. `MonitoringInformationSection` に **`isTraining` 相当のフィールドは存在しない**。監視APIは訓練通知を扱わない。したがってK7は訓練データを本番データとして描画することがない（§7）。
9. `apps/web/tests/monitoringFixture.ts` の `information` は現在 `[]` である。K7はここへ実データ相当の fixture を追加する必要がある。
10. `monitoringPresentation.ts` の `processingPresentation`（74–97行相当）は `response.venues.map(...)` で**全会場の明細行を作り**、`tone` も全会場を対象に判定している。`VENUE_NAMES`（`east: '東地区'`, `trc: 'TRC'`）はこの関数のためだけに使われている。確定事項8はここを変更する（§6）。
11. `apps/web/tests/monitoringPresentation.test.ts:36` が `details: ['東地区 再処理完了 0件', 'TRC 再処理中 3 / 8']` を固定しており、確定事項8の変更でこの期待値が**必ず落ちる**。

## 4. 表示仕様

### 4.1 行の選択と順序

- `data.information` から `venueId === data.requestedVenueId` の要素だけを取る（確定事項4）。
- 表示順は K1 の固定8行を維持する。`kind` → 行名の対応は以下。

| # | 行名（`th scope="row"`） | `kind` |
| --- | --- | --- |
| 1 | 気象防災速報 | `bosai_bulletin` |
| 2 | 気象警報・注意報 | `warning` |
| 3 | 警報等時系列 | `warning_timeseries` |
| 4 | 警報級の可能性 | `early_warning` |
| 5 | アメダス | `amedas` |
| 6 | 地域時系列予報 | `area_timeseries` |
| 7 | 雨雲 | `nowcast` |
| 8 | キキクル | `kikikuru` |

- 当該 `kind` の要素が応答に**存在しない**場合、行は消さずに残し、反映状態を含む全セルを「—」にする。**行の欠落で情報を消さない**（K1引き継ぎ「8行予約を理由に情報を欠落させない」）。この「要素なし」は「未取得」とは別扱いとし、赤や異常にしない。
- `data` が `null`（初回読込中・通信成功なし）のときは K1 と同じ骨格表示（全セル「—」）を維持する。

### 4.2 反映状態（確定事項1・11）

`availability` の3値をそのまま1対1で表示語へ対応付ける。**フロントで時刻・閾値から再判定しない。**

| `availability` | 表示語 | 色トークンの役割 |
| --- | --- | --- |
| `available` | 利用可能 | `--wx-system-status-green-foreground`（K1で定義済みの状態色トークン） |
| `stale` | 情報なし | 無彩色（既存MD3 `on-surface-variant` 系） |
| `unavailable` | 未取得 | 無彩色（既存MD3 `on-surface-variant` 系） |
| 要素なし | — | `monitoring-unavailable`（既存） |

- 「情報なし」「未取得」は**どちらも異常色（赤・黄）にしない**。K1の「未取得だけを理由に異常としない」に従う。
- 「要確認」等の追加文言を付けない（確定事項1）。
- 3値は必ず区別して描画し、boolean や OK/NG に縮退させない（07-wx-data-protocol.md 必須）。
- `stale` は本来「前回の正常値を保持しつつ鮮度が低下した状態」であり、表示語「情報なし」とは意味がずれる。**ユーザーはこのずれを承知のうえで確定事項11を選択した。** 3状態の区別自体は1対1で保たれるため縮退には当たらない。表示語の細分化は K8 #81 で行う。

### 4.3 情報時刻・反映時刻の書式（確定事項2・13）

| 列 | 値 | `null` のとき |
| --- | --- | --- |
| 情報時刻 | `validAt`（基準時刻） | 「—」 |
| 反映時刻 | `fetchedAt`（サーバー取得時刻） | 「—」 |

- **書式は JST `MM/DD HH:mm:ss`（年なし）。`generatedAt` と同じ日付でも日付を省略しない。**
- 出どころは **K6 #79 で実装済みの共通フォーマッタ `formatJstMonthDayClock(value: string | null): string`（`apps/web/src/monitoring/monitoringTimeFormat.ts`）**とする。これは常に `MM/DD HH:mm:ss`（年なし・同日でも日付を省略しない）で、`null` は「—」を返し、K7 の要件と一致する。**K7 は新しい書式関数を追加せず、これをそのまま情報表で使う。** 新しい書式ロジックを情報表専用に重複実装しないこと。
- K1 の `formatJstDateTime`（`YYYY/MM/DD HH:mm:ss`）は最終表示更新行の専用書式として残し、情報表では使わない。監視画面内の時刻書式を3種類以上に増やさない。
- 注釈・ツールチップ・「基準」等の但し書きを付けない。発表（`issuedAt`）／観測／基準の区別表示はしない（確定事項2）。
- `<time dateTime={validAt}>` / `<time dateTime={fetchedAt}>` で機械可読値を併記する（K1の最終表示更新行と同じ方式）。`null` のときは `time` 要素を出さず「—」のみとする。

### 4.4 有効な情報件数（確定事項3）

- 値は `summaryCount`。`null` は「—」。
- `summaryCount === 0` は `null` と区別し、**「0」と表示する**。「0」を「—」へ丸めない。0件は正常な状態であり、異常色にしない。
- 件数は右寄せ（`monitoring.css` の追記クラス）、時刻は既存表のセル書式に合わせる。

### 4.5 対象地域・地点（確定事項10：案C）

`VENUE_FORECAST_TARGETS[requestedVenueId]`（`resolveVenueForecastTargets(venueId)`）から解決する。

| `kind` | 表示名の出どころ | east / trc の実値 |
| --- | --- | --- |
| `bosai_bulletin` | `warning.displayName` を流用（§4.5.1の条件を満たす場合のみ） | 江東区 / 大田区 |
| `warning` | `warning.displayName` | 江東区 / 大田区 |
| `warning_timeseries` | `warningTimeseries.displayName` | 江東区 / 大田区 |
| `early_warning` | `broadForecast.displayName` | 東京地方 / 東京地方 |
| `amedas` | `amedas.displayName` | 江戸川臨海 / 羽田 |
| `area_timeseries` | `broadForecast.displayName` | 東京地方 / 東京地方 |
| `nowcast` | **表示しない** | 「—」 |
| `kikikuru` | **表示しない** | 「—」 |

- 地域コード（`1310800` 等）を画面に出さない。表示語は日本語名のみとする。
- **雨雲・キキクルの「—」は、K1 が定めた「—＝未接続・欠測」と見た目が同じになる。** ユーザーはこれを承知のうえで案Cを採用した。両行は反映状態・時刻・件数の各列で実データを表示するため、行全体が「—」になる未接続状態とは区別できる。

#### 4.5.1 気象防災速報の市区町村名の流用条件と例外

気象防災速報は複数の対象地域コード（`bosaiBulletin.includedAreaCodes`：市区町村コードと府県予報区・一次細分区域コードの混在）を持ち、**そのうちどれが単独の表示名かを示す情報を持たない**。無条件に市区町村名を出すと、対象が市区町村以外へ広がった場合に誤表示になる。そこで次の条件で流用する。

1. `targets.bosaiBulletin.includedAreaCodes` に `targets.warning.municipalCode` と**同じ値が含まれる**ことを確認する。
2. 含まれる場合のみ `targets.warning.displayName`（江東区／大田区）を表示する。
3. 含まれない場合、`includedAreaCodes` が空の場合、または会場定義が解決できない場合は **「—」** を表示する。複数地域をカンマ連結したり、「ほか」を付けたりしない（確定事項1「追加文言を付けない」の徹底）。

実コードで確認済み：east・trc とも条件1を満たすため、現行の会場定義では両会場とも市区町村名が表示される（§3-7）。条件分岐は将来の会場追加・定義変更に対する防御であり、現行データでは常に真の枝を通る。

**実挙動未確認**：API が実際に返す `bulletins` が `includedAreaCodes` のうちどの範囲の電文を含むか（市区町村単位の速報と府県単位の速報が混在するか）は実データで未確認。件数（`summaryCount`）は会場の対象範囲全体の合計であり、表示している市区町村名だけの件数とは限らない。この不一致は K7 では解消できず、K8 #81 / E10 #42 へ残す。

## 5. 内訳展開を作らないことと「片方の失敗を全体成功に隠さない」要件の整理（確定事項5・12）

1. **隠蔽は起きていない。** §3-5 のとおり、`early_warning`（near/far）・`nowcast`（N1/N2）・`kikikuru`（各layer）の `availability` は API 側で `worseAvailability` により**悪い方へ寄せて**返される。片方が `unavailable` なら行の反映状態は `available` にならない。K7 はこの値をそのまま表示するだけで、フロントで良い方へ丸め直さない。
2. **失われるのは「どちらが」の粒度だけ。** near と far のどちらが落ちているか、キキクルのどの種別が落ちているかは K7 では分からない。**確定事項12により、この旨を画面上に一切表示しない**（凡例・脚注・ツールチップも付けない）。粒度の補完は K8 #81（状態診断ウィンドウ）で扱う。
3. **件数の合算に注意する。** `summaryCount` は両系列の合算であり、片方 0 件でも合計が正の値になり得る。したがって **件数が正であることを「両系列正常」の根拠に使わない**。反映状態の列が正である。この禁止事項は製造担当・検収担当ともに守る（§8 AC-4）。

## 6. 処理待ちカードの会場限定（確定事項8）

### 6.1 変更内容

`monitoringPresentation.ts` の `processingPresentation` を、**`requestedVenueId` に一致する会場だけ**を対象とするよう変更する。

- 明細行は1行になり、**会場名の接頭辞（「東地区 」「TRC 」）を付けない**。見ればわかるラベルを省略する規約（CLAUDE.md §3.2）に従う。表示は `未開始` / `再処理中 3 / 8` / `再処理完了 0件`。
- `tone` の判定も自会場のみを見る。`running` なら `active`、`completed` なら `normal`、`idle` なら `neutral`。
- `venues` に `requestedVenueId` の要素が無い場合は、明細を「—」・`tone` を `neutral` とする。他会場の値で代用しない。
- カードの主要値「起動時再処理」は変更しない（K1で承認済み）。
- `VENUE_NAMES` はこの変更で参照元が無くなるため削除する。会場名が必要になったら `VENUE_FORECAST_TARGETS[venueId].venueName` を使う（`monitoringPresentation.ts` に会場名を直書きしない）。

### 6.2 K1設計書§4.2との差分

K1設計書 §4.2 は処理待ちカードについて「**会場別に**未開始／再処理中 processedCount / total／再処理完了を表示する」「片方の完了で全体完了にしない」と定めており、実装もそのとおりになっている（§3-10）。

**確定事項8はこの承認済み仕様を意図的に変更するものであり、変更の根拠はユーザー指示である。** 変更により生じる次の挙動をユーザーは明示的に許容した。

- 自会場が `completed`、他会場が `running` の場合、カードは「再処理完了」とだけ表示する。他会場の再処理中は画面から分からなくなる。
- K1設計書 §4.2 の「片方の完了で全体完了にしない」は、**K端末が自端末会場のみを監視対象とする**という前提（確定事項4と同じ考え方）へ置き換わる。同一の情報表・カードの中で会場の扱いを統一するための変更である。

統括担当は、K1設計書 §4.2 の該当記述の整合更新を本書とは別に扱う（設計担当は本書以外を変更しない）。

### 6.3 影響するファイル・テスト・fixture

| 対象 | 影響 |
| --- | --- |
| `apps/web/src/monitoring/monitoringPresentation.ts` | `processingPresentation` の実装変更、`VENUE_NAMES` 削除、`buildMonitoringCards` から `data`（`requestedVenueId` を含む）を渡す経路の確認 |
| `apps/web/tests/monitoringPresentation.test.ts` | **6行目のテスト（`K1: 停止・判定待ち・初回同期失敗と会場別再処理を断定せず表示する`）の 36行目 `details: ['東地区 再処理完了 0件', 'TRC 再処理中 3 / 8']` が必ず落ちる。** `requestedVenueId: 'east'` の期待値 `details: ['再処理完了 0件']` へ更新し、テスト名からも「会場別」を外す |
| `apps/web/tests/monitoringFixture.ts` | `requestedVenueId: 'east'`、`venues` に east（`completed` 0件）・trc（`running` 3/8）が入っている現行の値をそのまま使える。**fixture 自体の値は変えない**（他会場が混ざらないことの検証に必要なため） |
| `apps/web/tests/monitoringDashboard.test.ts` | 処理待ちカードの描画を検証している箇所があれば期待値を更新する。現時点で「再処理」「東地区」「TRC」を含む記述は `monitoringPresentation.test.ts` のみ（実コードで確認済み） |
| `apps/web/src/monitoring/MonitoringDashboard.tsx` | 変更不要。カードの描画は `MonitoringCard.details` を回すだけ |
| `apps/web/src/monitoring/monitoring.css` | 変更不要 |

**K6 #79 は `health` セクションと取得元表のみを扱い、`venues` には手を入れない**（K6設計書 §8 の受け入れ条件が `venues` 不変を明示）。したがって本変更が K6 と衝突しない。

## 7. モジュール構成とシグネチャ

K7 は **K6 のブランチ上で K6 の後に実装する**ため、K6 が追加した `buildSourceStatusRows` / `SourceStatusCell`（`monitoringPresentation.ts`）と `formatJstMonthDayClock`（`monitoringTimeFormat.ts`）は既に存在する前提で書く。

| ファイル | 種別 | 責務・K7での変更 |
| --- | --- | --- |
| `apps/web/src/monitoring/monitoringInformationRows.ts` | 新規 | DTO → 情報表の行への純粋変換。会場フィルタ、`kind` 引き当て、状態語、対象地域・地点の解決、書式化 |
| `apps/web/src/monitoring/monitoringPresentation.ts` | 変更 | (a) `processingPresentation` の会場限定（§6）、(b) `VENUE_NAMES` 削除、(c) 日付常時表示のフォーマッタを §4.3 の方針で用意（K6が既に提供していれば変更不要） |
| `apps/web/src/monitoring/MonitoringDashboard.tsx` | 変更 | `InformationTable` を追加し、**2つ目の `SkeletonTable` の呼び出し1箇所だけ**を差し替える。`SkeletonTable` と `INFORMATION_HEADERS` / `INFORMATION_ROWS` の定義は残す（データ未着時に使う）。K6が差し替えた `SourceStatusTable` には触れない |
| `apps/web/src/monitoring/monitoring.css` | 変更 | 情報表用の状態セル・数値右寄せのクラスを**ファイル末尾へ追記**する。既存セレクタとK6の追記分を書き換えない |
| `apps/web/tests/monitoringInformationFixture.ts` | 新規 | 情報表用の `MonitoringInformationSection[]` を組み立てるヘルパー |
| `apps/web/tests/monitoringFixture.ts` | 変更 | `information: []` の1行のみ（必要な場合） |
| `apps/web/tests/monitoringInformationRows.test.ts` | 新規 | 行生成の単体テスト |
| `apps/web/tests/monitoringPresentation.test.ts` | 変更 | §6.3 のとおり処理待ちカードの期待値を更新 |
| `apps/web/tests/monitoringDashboard.test.ts` | 変更 | 情報表の描画テストを**末尾へ追記**する |

```ts
// apps/web/src/monitoring/monitoringInformationRows.ts
import type {
  MonitoringInformationKind,
  MonitoringStatusResponse,
} from '@wx-viewer-poc/shared';

/** 反映状態の表示語。K7は3値と欠落のみ。K8で異常系を追加する。 */
export type InformationStateLabel = '利用可能' | '情報なし' | '未取得' | '—';

export type InformationStateTone = 'normal' | 'neutral' | 'unknown';

export interface InformationRow {
  readonly kind: MonitoringInformationKind;
  /** 行見出し。固定8行。 */
  readonly name: string;
  /** 対象地域・地点。解決できない場合と雨雲・キキクルは '—'（§4.5）。 */
  readonly target: string;
  readonly stateLabel: InformationStateLabel;
  readonly stateTone: InformationStateTone;
  /** 情報時刻（基準時刻）の表示文字列。JST MM/DD HH:mm:ss。null は '—'。 */
  readonly validAtText: string;
  /** `<time dateTime>` へ渡す生値。null なら time 要素を出さない。 */
  readonly validAt: string | null;
  readonly fetchedAtText: string;
  readonly fetchedAt: string | null;
  /** 件数。null は '—'、0 は '0'。 */
  readonly summaryCountText: string;
}

/**
 * requestedVenueId の情報だけを固定8行へ整形する。
 * 時刻・閾値からの再判定、availability の丸め、件数からの状態推定は行わない。
 * data が null のときは全セル '—' の8行を返す（K6 buildSourceStatusRows と同じ方針）。
 */
export function buildInformationRows(
  data: MonitoringStatusResponse | null,
): readonly InformationRow[];
```

```tsx
// apps/web/src/monitoring/MonitoringDashboard.tsx（追加する部分のシグネチャ）
function InformationTable(props: {
  readonly rows: readonly InformationRow[];
}): React.JSX.Element;
```

`MonitoringDashboardView` 内の分岐：

- `state.data !== null` → `<InformationTable rows={buildInformationRows(state.data)} />`（`useMemo` でメモ化）
- `state.data === null` → 既存 `<SkeletonTable title="情報別の反映状況" ... />` をそのまま使う

K6 の `SourceStatusCell`（`text` と `tone` と `note` を持つセル型）を `InformationRow` で再利用してもよいが、K7は `note` を使わないため（確定事項1・12）、上記の平坦な型を既定とする。製造担当が K6 の実装を見て再利用したほうが自然だと判断した場合は、`note` を常に未設定にすることを条件に再利用してよい。

## 8. 業務標準上の必須制約の維持

| 制約 | K7での扱い |
| --- | --- |
| availability 3状態の縮退禁止 | §4.2 のとおり3値を区別して描画。boolean 化・OK/NG 化をしない。`stale` を `available` へ寄せない |
| 共通メタ情報の `null` | `validAt` / `fetchedAt` / `summaryCount` の `null` をそれぞれ「—」とし、0・未取得・正常と混同しない。`null` を `0` や現在時刻で補完しない |
| 時刻の意味 | 情報時刻＝`validAt`（基準時刻）、反映時刻＝`fetchedAt`（サーバー取得時刻）に固定。`issuedAt`（発表時刻）を情報時刻として使わない |
| 会場 | `requestedVenueId` の行のみ表示。処理待ちカードも同じ（§6）。他会場の値を混入させない。会場名・地点名は `VENUE_FORECAST_TARGETS` で解決し、文字列を直書きしない |
| 本番・訓練の区別 | 監視DTOに `isTraining` 相当のフィールドがないため（§3-8）、K7は訓練データを表示しない。訓練フラグを推測して補わない。この表に訓練由来の値が混じっていないことは API 側の責務であり、K7では**実挙動未確認**とする |
| HEX直書き禁止 | 状態色はK1が定義した `--wx-system-status-*` トークンおよび既存MD3トークンのみを参照する。コンポーネント・CSS・fixture にHEXを書かない |

## 9. 受け入れ条件

検収担当が1項目ずつ実行する。実行手順と合格の見え方を項目ごとに記す。

- [ ] **AC-1（会場フィルタ）** `requestedVenueId: 'east'` かつ `information` に east 8件・trc 8件を入れた fixture で `MonitoringDashboardView` を描画する。情報表の本体行が**ちょうど8行**であり、対象地域・地点に「大田区」「羽田」（trcの値）が1つも現れないこと。他会場の展開ボタン・会場切替UIが存在しないこと。
- [ ] **AC-2（行の順序と行名）** 同じ描画で、行見出しが上から `気象防災速報 / 気象警報・注意報 / 警報等時系列 / 警報級の可能性 / アメダス / 地域時系列予報 / 雨雲 / キキクル` の順に並ぶこと。`information` 配列を API 実装と同じ順（`warning` 始まり）で渡しても、この表示順が変わらないこと。
- [ ] **AC-3（反映状態3値）** 同一の情報種別について `availability` を `available` / `stale` / `unavailable` と変えた3つの fixture を順に描画し、それぞれ「利用可能」「情報なし」「未取得」と表示されること。3つが同一文言へ縮退していないこと。`stale` 行が「利用可能」にも「未取得」にもならないこと。「要確認」等の追加文言が表示されないこと。
- [ ] **AC-4（片方の失敗を隠さない）** `early_warning` の `availability` を `unavailable`、`summaryCount` を正の値（例：3）とした fixture を描画し、反映状態が「未取得」と表示され、件数が正であることを理由に「利用可能」へ変わらないこと。`nowcast` / `kikikuru` でも同じ組合せで確認すること。併せて、どの系列が落ちているかを示す文言・凡例・ツールチップが**追加されていない**こと（確定事項12）。
- [ ] **AC-5（時刻列の書式）** `generatedAt: '2026-09-21T00:20:00.000Z'`、`validAt: '2026-09-21T00:12:00.000Z'`、`fetchedAt: '2026-09-21T00:13:45.000Z'` の fixture で、情報時刻が `09/21 09:12:00`、反映時刻が `09/21 09:13:45` と表示されること（**同日でも日付が出る**、年は出ない）。`generatedAt` と異日の値でも同じ書式であること。`issuedAt` にだけ別の時刻を入れた fixture で、その値が情報時刻の列に**現れない**こと。「基準時刻」等の注釈文言が画面に追加されていないこと。
- [ ] **AC-6（古い情報を異常にしない）** `availability: 'available'`、`validAt` を `generatedAt` より 24 時間以上前、`summaryCount: 0` とした fixture を描画し、反映状態が「利用可能」のままで、異常色（赤）・注意色（黄）のクラスが当該行に付かないこと。同条件で `fetchedAt` も古くした場合も同じであること。**この検証は `apps/web/tests` の自動テストとして存在し、`npm run test -w apps/web` で通ること。**
- [ ] **AC-7（null と 0 の区別）** `summaryCount: null` の行が「—」、`summaryCount: 0` の行が「0」と表示され、両者が同じ文字列になっていないこと。`validAt: null` / `fetchedAt: null` の行がそれぞれ「—」と表示され、`time` 要素が出ていないこと。
- [ ] **AC-8（気象防災速報の既知の制約）** `bosai_bulletin` の要素を API 実装どおり（時刻4項目すべて `null`、`summaryCount` は数値）にした fixture で、情報時刻・反映時刻が「—」、件数が数値で表示され、反映状態が `availability` のとおりであること。時刻が `null` であることを理由に異常色にならないこと。
- [ ] **AC-9（対象地域・地点：案C）** `requestedVenueId: 'east'` で、気象防災速報・気象警報・注意報・警報等時系列が「江東区」、警報級の可能性・地域時系列予報が「東京地方」、アメダスが「江戸川臨海」、**雨雲・キキクルが「—」**と表示されること。`requestedVenueId: 'trc'` では順に「大田区」「大田区」「大田区」「東京地方」「羽田」「東京地方」、雨雲・キキクルが「—」であること。地域コードの数字が画面に現れないこと。
- [ ] **AC-10（速報の流用条件の例外）** `bosaiBulletin.includedAreaCodes` に `warning.municipalCode` が含まれない状況を単体テストで再現し（テスト内でターゲット解決関数へ与える値を差し替えるか、解決結果を引数化した純粋関数として検証する）、気象防災速報の対象地域・地点が「—」になること。カンマ連結や「ほか」等の文言が出ないこと。
- [ ] **AC-11（要素欠落）** `information` から `kikikuru` の要素を除いた fixture で、キキクル行が**消えずに残り**、全セルが「—」であり、異常色が付かないこと。
- [ ] **AC-12（データ未着）** `state.phase: 'loading'`（`data: null`）で情報表がK1と同じ骨格（8行・全セル「—」）で表示されること。`phase: 'failed'` かつ前回値ありのとき、前回値の行が保持されること。**通信失敗時に正常行を現在値として強調しない表示と、応答要素の検証は、K端末→サーバーの取得失敗の扱いとして別Issue #187 へ移管する（K7の対象外）。** K1 §5 の該当表示が未実装であることは、K6・K7で悪化していない既存の状態である。表現の方法は #187 の着手時に決める。
- [ ] **AC-13（処理待ちカードの会場限定）** `requestedVenueId: 'east'`、`venues` に east（`completed` 0件）・trc（`running` 3/8）を入れた fixture で、処理待ちカードの明細が **`['再処理完了 0件']` の1行だけ**であること。「東地区」「TRC」の文字列と trc の進捗 `3 / 8` が**画面のどこにも現れない**こと。カードの `tone` が `normal`（自会場 completed 由来）であり、trc の `running` によって `active` にならないこと。主要値が「起動時再処理」のままであること。
- [ ] **AC-14（処理待ちカードの欠落・進行中）** `venues` から `requestedVenueId` の要素を除いた fixture で明細が「—」・`tone` が `neutral` であり、他会場の値で代用されないこと。自会場が `running` の fixture で `再処理中 n / N` と表示され `tone` が `active` になること。
- [ ] **AC-15（取得元表の不変）** 上記すべての描画で、「取得元別の稼働状況」表がK6の実装どおりのまま変化していないこと。K7の差分に取得元表のロジック変更・`health` セクションの変更が含まれないこと（`git diff` で確認）。
- [ ] **AC-16（時刻書式の重複実装なし）** 情報表の時刻書式が K6 の共通フォーマッタ群（`monitoringPresentation.ts`）に実装され、`monitoringInformationRows.ts` 内で `Intl.DateTimeFormat` を独自に呼んでいないことを `git diff` で確認する。
- [ ] **AC-17（トークン遵守）** K7の差分に HEX リテラル（`#` から始まる色値）が1つもないこと。情報表の状態色が `--wx-system-status-*` と既存MD3トークンのみを参照していること。警戒レベル色・通知区分色の定義が変更されていないこと。
- [ ] **AC-18（アクセシビリティ）** 情報表の行見出しが `th scope="row"`、列見出しが `th scope="col"` であること。反映状態が色だけでなく文字で判別できること。時刻セルに `<time dateTime>` が付いていること。
- [ ] **AC-19（レイアウト）** 1920×1080 CSS px・倍率100% で監視本体の `scrollHeight` が `clientHeight` 以内、横方向の溢れがないこと。実測値を記録すること。1920×960 でも確認する。情報時刻・反映時刻が日付入りになったことで列幅が溢れていないこと。
- [ ] **AC-20（静的検査）** `npm run lint` / `npm run typecheck` / `npm run format:check` / `npm run test -w apps/web` / `npm run build` がすべて通ること。K6がAPIに触れているため `npm run test -w apps/api` も実行し、K7の差分で落ちていないことを確認する。

## 10. AD-H項目の結論と、判断を先送りにした点

| 項目 | K7での結論 |
| --- | --- |
| **AD-H040**（通知skip・保存失敗の監視） | **確定事項9により、K7では表示しない。K8 #81 / E10 #42 へ残す。** 判定不能1件を落として他現象を継続する事象は warn/error ログのみに残り、情報表には現れない。採否待ちの保守事項として据え置き、修正必須へ昇格させない |
| **AD-H045**（未知XML構造の継続確認） | 厳密parserが未知形を採用しないため、未知構造に遭遇した情報種別は `availability` が `unavailable` または `stale` として表に現れる。**原文・理由を画面へ出す経路は存在しない**（DTOに該当フィールドなし）。K7の結論は「反映状態の低下としては可視化されるが、原因は表示できない。原因表示は K8 #81 / L2 #84 へ残す」。確認待ちのまま据え置く |
| **AD-H063**（全体初期化と個別復元） | 情報表は `information` の `availability` のみを出典とし、`readiness.initialFetchPhase`（初回同期）や `venues[].startupEvaluated` を情報別の正常根拠として使わない。初回同期完了を全情報の利用可能と読み替えない。逆に初回同期中であることを理由に情報行を異常にもしない。分離はDTOで既に達成されており、K7はこれを崩さない |
| **AD-H070**（気象snapshotの鮮度評価） | 鮮度判定はサーバーが返す `availability` に一本化し、フロントで `validAt` / `fetchedAt` と現在時刻の差から stale を再判定しない（確定事項6と整合）。情報別の鮮度評価基準そのものの妥当性（どの秒数で stale とするか）は未対応申し送りのままで、K7では変更しない |

### 先送りにした点・実挙動未確認

- **`stale` の表示語**：確定事項11により「情報なし」で実装するが、語義のずれは残る。表示語の細分化は K8 #81。
- **気象防災速報の件数と表示地域の不一致**：`summaryCount` は会場の対象範囲全体の合計であり、表示している市区町村名だけの件数とは限らない（§4.5.1）。K7では解消しない。
- **気象防災速報の時刻2列が常に「—」**：API 側で時刻4項目が `null` 固定であることによる（§3-4）。E10 #42 へ引き継ぐ。
- **実挙動未確認**：本設計は静的なコード読解のみで作成した。dev サーバー起動・実 API 接続・ブラウザでの実寸計測・状態色のコントラスト計測は未実施。§9 AC-19 の寸法は K1 設計書§3.1 の見積り（情報枠 300 px）を前提とした期待値であり、実測は製造・検収で行う。
- **実挙動未確認**：API が実際に返す `availability` の分布（例：夜間帯に `nowcast` が `unavailable` になるか）、および `bulletins` が含む地域の範囲は未確認。受け入れ条件はすべて fixture ベースで判定できるように書いてある。
- **実挙動未確認**：K6 #79 は実装・検収済み（PR #185）。時刻書式は `formatJstMonthDayClock` で確定している。K6 がマージされる前は K6 のブランチ上で実装する。**K6 の実装が存在しない状態で K7 を実装しない。**

## 11. 後続Issueへの引き継ぎ

- **K8 #81**：取得異常・解析異常・未対応形式の赤表示と、状態診断ウィンドウでリセットするまで赤を保持するラッチを追加する。K7の3値（利用可能／情報なし／未取得）を置き換えるのではなく拡張する形にする。§5-2 の粒度不足（どの系列が落ちているか）、AD-H040 の通知skip・保存失敗、AD-H045 の未知構造の原文・理由、`stale` の語義、気象防災速報の対象地域の粒度はここで扱う。
- **E10 #42**：`bosai_bulletin` の時刻4項目が常に `null` である点（§3-4）と、対象地域の内訳が DTO に出ていない点（§4.5.1）。表示上は「—」で正しいが、本来は返せるはずで、API側の追補候補として残す。
- **K6 #79**：取得元表と情報表は出典が別（`health.sources` と `information`）。取得元が正常でも情報が `unavailable` であり得る（逆も同じ）。両表の状態を一致させる整合化をしない。K7は K6 の共通フォーマッタを再利用し、書式ロジックを重複させない。
- **L2 #84**：タイル（雨雲・キキクル）の健全性判定基準は `healthCriteriaStatus: 'undecided'` のまま。情報表の反映状態はカタログの `availability` 由来であり、画像本体の健全性ではない。
- **統括担当へ**：K1設計書 §4.2 の処理待ちカードの記述（会場別表示）は確定事項8により実質無効になる。本書 §6.2 に差分を記録した。基本設計・K1設計書の整合更新は本書の対象外。

## 12. 設計時点の作業記録

- 着手時・終了時とも、本書以外に自身が加えた変更はない。コード・設定・ブランチ・コミットは変更していない。K6設計書 `docs/design/issue-79-source-status-table.md` は参照のみで変更していない。
