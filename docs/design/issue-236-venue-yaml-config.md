# Issue #236 会場定義の YAML 外部化

## 1. 根拠と確定事項

- [Issue #236](https://github.com/BlueKurage119/wx-viewer-poc/issues/236) 本文・オーナーコメント: 起動時に厳密検証した会場定義を API と Web で共有し、再起動のみで反映する。東京以外の取得とデバッグ用ローカル設定を追加する。
- 統括担当からのヒアリング結果: 会場を YAML に追加すると、その地域も既存の気象取得処理の対象へ動的に加える。開発時のみ Git 管理外のローカル YAML を共有設定へ差分として重ねる。
- 追加ヒアリング結果: C5 早期注意・C6 地域時系列の全会場共通前提を本 Issue で変更し、異なる対象ごとに処理・保存する。新会場の YAML 追加だけで気象取得と API 列挙まで行い、新端末 URL・端末台帳追加は別作業とする。
- 現行コード: `packages/shared/src/venueForecastTargets.ts` は `east` / `trc` の型・データ・列挙を固定する。`apps/api/src/venueForecastTargets.ts` は C5/C6 の全会場同一対象を表明し、C7 は 2 会場を直接結合する。`apps/web/src/shell/config.ts` は名称・実験扱いを重複保持する。`packages/shared/src/terminalConfig.ts` の端末台帳は会場定義とは別に固定する。
- `apps/api/src/config/pollingScheduleLoader.ts` には既存の共有 YAML と開発時ローカル差分方式がある。会場設定も運用原則を揃える。

## 2. 設計上の分岐

【確定】東京以外を動的に扱うため、C5 早期注意と C6 地域時系列の「全会場で同じ対象」制約を外し、異なる対象キーごとに処理・保存し、会場別結果へ結び付ける。現行の `resolveSharedEarlyWarningTargetArea` / `resolveSharedAreaTimeseriesForecastTarget`、単一対象パーサー、保存・採用経路は改修対象となる。東京都内の既存 2 会場は従来と同じ対象を共有し、重複処理を避ける。

Issue 本文の「全会場で共通であることを前提とする対象」の不変条件は、この追加ヒアリングによって C5/C6 には適用しない。採用ルールの会場別の意味は維持する。

【確定】端末台帳は本 Issue で YAML 化せず、未割当の新会場も API の取得・列挙対象にする。新会場を画面で開くための `TERMINAL_DEFINITIONS` と URL の追加は別作業とする。

## 3. YAML と検証

【設計案】正本は `config/venues.yaml`、開発時差分は `config/venues.local.yaml`。後者は `.gitignore` に登録し、`NODE_ENV=production` では存在しても読まない。ローカル差分は `venues` 配列を ID で突き合わせた項目単位の上書き・追加とし、削除表現は設けない。マージ後に全体を厳密検証する。差分ファイル単体でも未知キー・重複 ID を拒否し、共有正本の欠落・破損を補えない。

正式な会場項目は次のとおり。ルートは `venues` のみで、配列は 1 件以上。各会場に `id`、`name`、`experimental`、`mapReference`、`warning`、`warningTimeseries`、`broadForecast`、`temperatureForecast`、`amedas`、`bosaiBulletin` を必須とする。各下位キーは Issue 本文の YAML 例どおりとし、`experimental` は真偽値。ローカル差分に限り `id` と変更する項目だけを記載可能とする。共有正本とローカル差分の同一 ID は上書き、未登録 ID は全必須項目を要求する。

【設計案】`id` は `^[a-z][a-z0-9-]{0,31}$`。名称類は `trim()` 後に 1 文字以上で、値は勝手にトリム変更しない。座標は数値型の有限値で緯度 `[-90,90]`、経度 `[-180,180]`。市町村コードは ASCII 数字 7 桁、府県予報区・広域予報区域・気温地点・アメダス地点・速報区域コードは ASCII 数字 5〜7 桁のうち既存値に対応する桁数を項目別に固定する。具体的には府県予報区 6 桁、広域予報区域 6 桁、気温・アメダス地点 5 桁、速報区域 6 または 7 桁。`elements` は ASCII 数字 8 桁。形式検証は存在する実コードかどうかの照会までは行わない。`warning.municipalCode === warningTimeseries.municipalCode`。速報区域リストは 1 件以上、重複禁止で、市町村警報区域と広域予報区域を含む。全キーで未知キー、`null`、暗黙の数値変換を拒否する。

異なる都道府県にまたがる対象の整合性をコードの先頭数字だけで推定しない。各コードの意味は気象庁の実データ・公式資料で検証し、README に設定手順を記載する。ローダーは例外のメッセージに相対設定パスと YAML パス（例: `venues[2].amedas.stationCode`）を含める。設定内容全体と絶対パスは出さない。読み込み失敗・構文エラー・不正値は起動失敗で、既定値に戻さない。

## 4. モジュールと型の境界

【設計案】`packages/shared/src/venueForecastTargets.ts` は会場・対象の読み取り専用型と検証済み ID の型だけを所有し、実会場データを持たない。`VenueId` はブランド付き `string` とし、外部文字列をキャストせず API プロセスのレジストリで `resolveVenueId(value: unknown): VenueId | null` に通す。テスト用のレジストリは注入する。既存 `VENUE_IDS` / `VENUE_FORECAST_TARGETS` のトップレベル定数を廃止し、単一のプロセス内レジストリを起動時に構築して明示注入する。内部で配列・対象を深く凍結し、`listVenueIds(): readonly VenueId[]`、`listVenues(): readonly VenueDefinition[]`、`getVenue(id: VenueId): VenueDefinition` を公開する。未知 ID は `null` の解決結果または明示例外となり、既知 ID のように扱わない。

`apps/api/src/config/venueConfigLoader.ts` がファイル読込・YAML 構文解析・差分合成・検証を所有する。シグネチャ案は `loadVenueConfig(options?: { baseUrl?: URL; localUrl?: URL; environment?: string }): LoadedVenueConfig`、`createVenueRegistry(config: ValidatedVenueConfig): VenueRegistry`。純粋な検証器は単体テスト用にファイル読込から分離する。ローダーは実行時のリポジトリルート相対パスを使い、ビルド成果物から起動しても YAML を参照できることをテストする。

`startServer()` の先頭で 1 回だけ設定を読み、DB 初期化・HTTP 待受・上流取得より前にレジストリを確定する。テストの明示レジストリ注入時も検証済み値だけを受け、運用時の無効設定を回避する入口にしない。ポーリング設定の読込順序との兼ね合いは依存しない。

## 5. API と Web

【設計案】`GET /api/config/venues` は `200` で `{ generation: string, venues: VenueConfigDto[] }` を返す。`VenueConfigDto` は `id`、`name`、`experimental`、`mapReference`、警報等の画面表示に必要な全対象情報を含み、共有 package の型で API/Web が合意する。`generation` は検証後の有効設定を安定シリアライズした SHA-256 で、同じ設定は同じ世代となる。レスポンスは起動時レジストリのみから生成し、毎リクエスト YAML を読まない。取得 API の応答や通知等が参照する会場 ID は同じレジストリに所属する。

Web は `main.tsx` の描画前に上記 API を取得・検証し、成功時のみ会場を Context で配布する。取得中は起動画面、通信失敗は再試行ボタン付きエラー画面、HTTP 200 でも不正 DTO・端末所属会場の欠落は設定エラー画面を出す。既存画面を古い内蔵会場値で表示しない。ページ更新時は再取得する。API 側の設定は稼働中不変なので、起動後の世代変更に備えて表示するなら再読込を要求する。`apps/web/src/shell/config.ts` の会場名・実験扱い・対象値の重複定義を削除する。

## 6. 気象処理・履歴・復旧の変更範囲

固定 `VENUE_IDS` と `east` / `trc` を参照する処理をレジストリ列挙へ置き換える。対象は `server.ts`、警報・時系列・早期注意・地域時系列・アメダス・速報のポーラーとパーサー、各 Repository、通知、起動時再処理、監視・タイルの会場解決、Web の API 応答検証。C7 速報区域の和集合は全会場から生成し、順序は YAML 会場順の初出順とする。会場別採用・復旧・通知は会場 ID を維持する。

`apps/api/src/polling/timeBasedPollingScheduler.ts` の `options.amedasVenueId ?? 'east'` と `amedasFetchService.ts` の既定 `east` は、運用経路で暗黙の会場選択をしない形へ変更する。共通アメダス地点は地点コード・要素で重複排除し、結果の会場別配布は維持する。テストの明示対象指定は残せる。`DEFAULT_AMEDAS_TARGET` 等のトップレベル初期化もレジストリ確定後の解決へ改める。

【設計案】既存 DB の会場 ID は履歴として保持し、起動時に自動削除しない。現在のレジストリに無い ID は現在会場の列挙・通知生成・復旧対象から除外し、履歴 API では履歴として識別可能に返す。登録されていない ID を現行会場に丸めない。端末台帳が参照する会場が設定から消えた場合は起動失敗とする。

東京以外の実データでの取得可否は、気象庁の配信範囲・電文内容に依存する。現段階ではコードと既存サンプルから全国対応を実挙動未確認とし、公式資料・実電文と照合して対象キーでの取得を検証する。

### 6.1 C5/C6 の対象別処理と DB

現行の `jmaXmlPoller.ts` は VPFD61/VPFW60/VPFD51 を 1 対象へ 1 回だけ渡す。`jmaEarlyWarningProcessor.ts` と `jmaVpfd51Processor.ts` は成功・失敗を `upsertTelegramReceptionAdoptionForAllVenues` で全会場へ複製する。これを対象別に変える。シグネチャ案は `processEarlyWarningReceptionForVenues(connection, reception, processedAt, registry): readonly VenueParseOutcome[]` と `processVpfd51ReceptionForVenues(...)`。対象キーは C5 が `(forecastAreaCode)`、C6 が `(forecastAreaCode, temperatureStationCode)`。同じキーの会場は一度だけパース・保存し、採用結果は各会場の `telegram_reception_adoption` 行へ個別に記録する。対象区域外の電文は当該会場で不採用とし、別地域の成功結果を複製しない。原文欠落・不正構造も対象会場ごとの採用理由を保存する。

`early_warning_snapshot` は現状 `UNIQUE(area_code, segment, control_status)`、`area_timeseries_snapshot` は `UNIQUE(area_code, station_code, control_status)` であり、対象キーごとの保存には既に対応する。子テーブルは snapshot ID に結び付くため同名区域間の混同を防げる。現行の `telegram_reception_adoption` は `UNIQUE(reception_id, venue_id)` だが、DDL に `CHECK (venue_id IN ('east', 'trc'))` がある。既存行と索引を保持する新 migration でこの CHECK を撤廃し、任意の検証済み ID を保存可能にする。Migration 前後で旧 2 会場の行数・内容を比較する。DB の FK を会場設定へ張らず、削除済み会場の履歴を保持する。

`weatherApiService.ts` の C5 は端末会場から `forecastAreaCode` を解決して near/far を検索し、C6 は `forecastAreaCode`・`temperatureStationCode` で検索している。この参照キーと `packages/shared/src/weatherApi.ts` の既存応答形は維持する。ただし C5/C6 の新地域について、`hasNewerWeatherParseFailure` に渡す採用行が会場別となることを確認し、他地域でのパース失敗が可用性を下げないようにする。端末のない新会場の気象結果は DB と会場列挙 API で検証し、端末用天気 API は端末が追加された時に同じキーで読める形にする。

起動時再処理は現行の警報電文だけでなく、C5/C6 の未採用または新会場分の既存原文について対象別再処理を行う必要がある。既存原文に該当地域の電文が無いときは未取得のままとし、別地域の snapshot を流用しない。新会場追加後に `telegram_reception_adoption` に当該会場行が無い既存電文を検出し、上流ポーリング開始前の復旧段階で処理する。既存行を重複追加せず、対象キーが同じ旧会場の snapshot を不必要に上書きしない。

### 6.2 固定会場参照の棚卸し

| 現行箇所 | 変更案 |
| --- | --- |
| `packages/shared/src/venueForecastTargets.ts` | `VenueId` の固定 Union、データ正本、`VENUE_IDS` を外し、型・レジストリ用境界へ変更 |
| `packages/shared/src/terminalConfig.ts` | 既存端末台帳は維持。起動時に所属会場の存在を照合 |
| `apps/api/src/venueForecastTargets.ts` | `assertSharedAcrossVenues` と C5/C6 共通解決を廃止。C7 和集合を全会場で生成 |
| `apps/api/src/polling/jmaXmlPoller.ts` と C5/C6 Processor/Parser | 対象キーごとに解析・保存し、会場別採用行を書く。パーサーの `east` 既定値を除去 |
| `apps/api/src/polling/timeBasedPollingScheduler.ts`、`amedasFetchService.ts` | `VENUE_IDS` と `?? 'east'` の暗黙既定を除去し、レジストリ列挙を使用 |
| `apps/api/src/server.ts`、`jmaWarningTelegramProcessor.ts`、`jmaVpwp50Processor.ts` | 起動時復旧、警報・時系列処理の列挙元をレジストリに変更 |
| `apps/api/src/notifications/notificationVenueScope.ts`、`bosaiBulletinNotificationEmitter.ts` | 速報区域の対象と通知対象を全会場から解決 |
| `apps/api/src/monitoring/monitoringStatusService.ts`、`startupProgressTracker.ts`、`warningCurrentRecoveryTracker.ts` | 監視対象と進捗を全会場で生成。代表端末 `east` 固定は端末のある会場から解決し、新会場を監視列挙から落とさない |
| `apps/api/src/repositories/telegramReceptionRepository.ts`、migration | 固定列挙と DB CHECK を外し、レジストリにない履歴 ID を保持して表示と現行処理を区別 |
| `apps/web/src/shell/config.ts`、`apps/web/src/api/amedas.ts`、`monitoringStatus.ts` | 会場正本と `east` / `trc` 入力判定を設定 DTO に置換 |
| `apps/web/src/map/WeatherMapView.tsx` | 端末 ID の会場別既定推測を端末コンテキストからの明示値に変更 |

### 6.3 東京以外の取得経路

上流 Atom/XML フィードは会場別に別 URL を構成する処理ではない。取得した各電文の区域・地点を、レジストリの対象キーへ照合する。警報現況・警報等時系列は全会場の市町村コードと府県コード、C5 は全会場の広域予報区域、C6 は広域区域と気温地点、アメダスは全会場の地点コードと `elements`、C7 速報は全会場の `includedAreaCodes` で照合する。タイル索引は全国共通で、会場位置は表示基準に使う。対象区域が違うために「電文種別は取得済みだが当該会場に対象データが無い」場合は unavailable とし、東京の値を代用しない。東京以外の実電文による疎通は実挙動未確認であり、製造時に公式資料とサンプルに照らしてテストする。

## 7. 製造・検収の受け入れ条件

- [ ] `config/venues.yaml` の 2 会場の ID・名称・座標・各コード・要素・実験扱いが旧定義と一致することを差分テストで確認する。
- [ ] 実ビルド成果物で API を起動し、YAML 読込が 1 回、DB 初期化と待受より前であることを計測する。ファイル変更は稼働中に反映せず、再ビルドせず再起動すると反映される。
- [ ] 欠落・読込不能・構文誤り・未知キー・必須キー欠落・重複 ID・0 件・空文字・型誤り・不正座標・コード桁数・`elements`・速報区域リストの空/重複・会場内不整合の各試験で起動が失敗し、該当パスのみがエラーに含まれる。
- [ ] 開発時はローカル差分の既存項目上書きと第 3 会場追加が反映され、未存在なら共有値を使い、本番環境では差分ファイルを無視する。差分が不正なら起動失敗する。
- [ ] 第 3 会場を東京以外の合成コードで追加し、レジストリ列挙、警報等の会場別処理、C5/C6 の異なる対象、アメダス、速報区域の和集合、監視・復旧・通知対象へ現れる。旧 2 会場の結果は基準値と一致する。
- [ ] C5/C6 について、異なる対象の合成電文を同一受信サイクルへ投入し、対象キーごとに snapshot が別行で保存され、同一対象の 2 会場は同じ snapshot を参照しつつ採用行は会場ごとに存在することを SQL で確認する。対象外会場の採用は成功にならない。
- [ ] 既存 DB を migration し、旧会場の採用行が同数・同内容で残り、第 3 会場 ID の採用行を保存できることを確認する。新会場の行がない既存 C5/C6 原文を起動時再処理し、重複起動しても採用行と snapshot 数が増殖しないことを確認する。
- [ ] C5/C6 の天気 API を既存端末で呼び、旧応答 DTO の `venueId`・`area`・`metadata`・`data` が移行前と一致する。別地域の対象電文のみがあるとき旧端末の可用性が変化しないことを確認する。
- [ ] 未知 ID と削除済み ID は新規処理対象にならず、履歴を消さない。端末参照会場の欠落は起動失敗する。外部入力の会場 ID の無検証キャストが残らない。
- [ ] `GET /api/config/venues` の DTO はレジストリと一致し、Web は初回描画前に取得する。読み込み中・通信失敗・不正応答の各状態が区別され、成功時は会場名・実験扱い・座標・対象が反映される。
- [ ] `rg` で本番経路の 2 会場固定列挙・`east` 既定・会場データの重複正本が残らないことを確認する。既存端末から従来会場へ解決される。
- [ ] README に YAML スキーマ、変更・再起動方法、開発時差分、本番無効、失敗時動作を記載する。
- [ ] `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test --workspaces --if-present`、`npm run build` がすべて成功する。

## 8. 後続 Issue への引き継ぎ

端末の追加・編集を設定化すること、旧会場の DB 履歴の自動削除、区域・地点コードの公式マスタ照会、設定の無停止再読込は本 Issue の対象外。新会場の実端末を運用するときは、端末台帳の変更要否を別 Issue で判断する。

## 9. 要ヒアリング事項

なし。新端末 URL・端末台帳は別作業と確定した。
