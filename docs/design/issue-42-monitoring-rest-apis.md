# Issue #42「E10. 監視画面向けAPI（稼働状態・履歴取得）」設計

対象Issue: [#42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42)
基準コミット: `1f92233`（`main`、Issue #41 マージ直後）
前提: Issue #139 の棚卸し（[docs/audit-epic-a-d.md](../audit-epic-a-d.md)）を踏まえた再着手。

---

## 1. 目的と範囲

### 1.1 対象

基本設計 §8.1・§8.2 の監視画面が必要とする「サーバーが既に保持している監視状態」と「保存済み履歴」を、REST で読み出せるようにする。

- **稼働状態API（1本）**: 全体状態・取得元別稼働状況・情報別反映状況・現在の異常を、**セクションを分離したまま**返す。
- **履歴検索API（3本 + 詳細1本）**: 受信履歴・通知出力履歴・操作記録の一覧検索と、受信履歴の詳細取得（原文を含む唯一の経路）。
- **処理できなかった電文の診断API（1本）**: 判定不能・未知XML構造で採用されなかった電文の理由・件数・**原文抜粋**を返す。**稼働状態APIとは別エンドポイントに分離する**（確定事項7。稼働状態APIは5秒周期ポーリングを想定するため、原文抜粋を毎回転送しない）。

すべて「保存済み・保持済みの値を読んで返す」だけであり、**このAPIの呼び出しが上流（気象庁等）への追加ポーリングを一切起こさない**（基本設計 §8.2 末尾の確定方針）。

### 1.2 対象外（この設計では扱わない）

| 除外するもの | 理由・引き継ぎ先 |
| --- | --- |
| 取得制御API（開始・停止・強制更新、要求識別子） | E11 #43。本設計は**読み取り専用**であり、POST/PUT/DELETE を一切追加しない |
| 監視画面UI（4カード・各テーブル・各ダイアログ） | Epic K（#74〜#81） |
| タイル健全性の新基準（AD-H001） | **今回スコープ外（確定事項4）**。K6 #79 / L2 #84 |
| アメダス地点の検知遅れの新基準（AD-H003） | **今回スコープ外（確定事項4）**。K6 #79 / L2 #84 |
| 履歴の容量上限・自動削除・圧縮（AD-H011） | 棚卸しで L2 #84 へ先送り承認済み。**現状（自動削除なし）をそのまま前提とする** |
| session・startup監査の保持期限（AD-H012） | 棚卸しで L2 #84 / K4 #77 へ先送り承認済み。**現状（無期限保持）をそのまま前提とする** |
| D5 起動監査（`startup_notification_inquiry`）の閲覧API | **今回スコープ外（確定事項5）**。`GET /api/monitoring/startup-inquiries` は用意しない。AD-H012 の対応先のうち **K4 #77 へ先送り**する |
| 通知保存失敗時の回復保証・outbox（AD-H039） | 棚卸しで L3 #85 へ先送り承認済み。**本設計で outbox を追加しない** |
| 健全性評価の運用初期値・境界の見直し（AD-H041） | 棚卸しで K6 #79 / L2 #84 へ先送り承認済み。**閾値は `config/polling.yaml` の現行値をそのまま公開するだけ** |
| 認証・認可（操作者識別） | 基本設計 §8.2 のとおり AuthGate 連携側。本設計では認証を実装しない |
| Epic A〜D の保存側（テーブル・列・processor）の変更 | 本Issueは配信のみ。**migration を追加しない** |
| 気象庁カナ形式への変換表示 | K3 #76 の着手前判断事項。原文保存は変換器の実装を意味しない（基本設計 §8.1） |

---

## 2. 参照資料と判断根拠

### 2.1 参照資料

- `docs/basic-design.md` §6.3（availability 3状態）、§8.1（監視画面の役割・遅延異常判定基準）、§8.2（ダッシュボード配置案・取得操作）、§8.4（装置異常系通知）、§9.4（受入条件）
- `docs/audit-epic-a-d.md` の AD-H001 / AD-H003 / AD-H011 / AD-H012 / AD-H039 / AD-H040 / AD-H041 / AD-H045 / AD-H063 / AD-H065
- `docs/issues-draft.md` の E10 および K1〜K8（E10 に依存する画面側の着手前判断事項）
- `docs/design/issue-41-notification-delta-api.md`（REST 設計・受け入れ条件の書式の手本、および E10 への引き継ぎ事項）
- `docs/rules/02-design-protocol.md`、`docs/rules/07-wx-data-protocol.md`
- 実装: `apps/api/src/app.ts`、`apps/api/src/monitoring/*`、`apps/api/src/polling/timeBasedPollingScheduler.ts`、`apps/api/src/polling/jmaXmlPollingService.ts`、`apps/api/src/repositories/{telegramReception,notificationOutputHistory,operationHistory,weatherParseFailure}Repository.ts`、`apps/api/src/repositories/types.ts`、`apps/api/src/services/weatherAvailability.ts`、`packages/shared/src/{availability,types,weatherApi,notificationDelta,terminalConfig,venueForecastTargets}.ts`

### 2.2 統括担当から渡されたヒアリング確定事項

| # | 確定事項 | 反映先 |
| --- | --- | --- |
| **1** | **監視DTOの粒度（AD-H063）**: 起動時readiness（4feedの成功可否）・会場別採用状態・画像生成状態・地点別状態を、**それぞれ別フィールド／別セクションとして分離して公開する**。単一の統合ステータスに丸めない。理由: 「200が返ればすべて正常」という誤認を避けるため | §4 全体、§5.1、§6.2、§9 AC2・AC3 |
| **2** | **処理できなかった電文の公開範囲（AD-H040・AD-H045）**: 判定不能・未知XML構造でskipした電文について、理由コード・件数に加えて**該当箇所の原文抜粋**も監視APIで公開する（原文全体ではなく抜粋）。抜粋の範囲・サニタイズ方針は設計で具体化する | §7 全体、§5.1 `processing`、§9 AC6 |
| **3** | **履歴検索のデフォルト条件（AD-H065）**: デフォルトで訓練／本番のフィルタを**かけず全件を返す**（訓練データを除外しない）。一覧レスポンスには電文原文を含めず、**詳細取得時のみ返す**。1回の検索の**最大件数に上限を設ける**（上限値は設計で決定） | §6 全体、§6.1、§9 AC7・AC8・AC9 |
| **4** | **タイル健全性基準（AD-H001）・アメダス地点検知遅れ（AD-H003）は今回スコープ外**: 新規の判定基準を定義せず、既存の6系列健全性監視の範囲（`radar_tile`/`risk_tile_frame` は監視対象外、地点は失敗回数基準のまま）を**そのまま**監視APIで公開する | §1.2、§4.3、§5.1 `tiles`、§9 AC4、§10 |

初版設計の §12 で挙げた4件の要ヒアリング事項について、統括担当がユーザーへ確認して得た追加の確定事項を次に示す（本改訂で反映済み）。

| # | 確定事項 | 反映先 |
| --- | --- | --- |
| **5** | **D5 起動監査（`startup_notification_inquiry`）は E10 の対象に含めない**: `GET /api/monitoring/startup-inquiries` を用意しない。AD-H012 の対応先のうち **K4 #77 へ先送り**する | §1.2、§8.3、§9 AC13(e)・AC14、§10 K4 |
| **6** | **稼働状態APIの会場別セクションは全会場（east・trc）分を含める**: 特定の会場端末に絞らない。**気象系APIが会場に絞る境界とは異なる基準**であることを設計書に明記する | §5.1、§5.2、§9 AC10 |
| **7** | **原文抜粋（`processing`）は稼働状態APIとは別エンドポイントに分ける**: 稼働状態APIは5秒周期ポーリングを想定するため、毎回原文抜粋を転送しない。パス・命名は設計担当の判断（`/api/monitoring/*` 配下で一貫させる） | §1.1、§3、§5.1、§5.3、§7、§8、§9 AC6・AC13 |
| **8** | **原文抜粋のサイズは提案値のまま**: 2000文字・サンプル20件・24時間ウィンドウ。**実データでの妥当性は未検証のままでよく、必要なら後続PRで調整する**前提を明記する | §7.3、§11 |

上記8点以外の未決事項（AD-H011 容量、AD-H012 無期限保持、AD-H039 回復保証、AD-H041 運用初期値）は、棚卸しで既に後続Issueへ先送り承認済みであるため、**本Issueでは新規定義せず、現状の実装をそのまま前提とする**（§1.2 の表、§10）。

### 2.3 現行実装調査からの判断根拠

いずれも基準コミット `1f92233` のコードから確認した事実である。

1. **6系列健全性はメモリ保持であり、最後の評価結果を読み出す口が既にある。**
   `apps/api/src/monitoring/fetchHealthStateStore.ts` の冒頭コメントが「プロセス起動単位の前回値保持（非永続・メモリのみ）」と明記しており、`FetchHealthMonitorService.getLastAggregate(): FetchHealthAggregate | null`（`fetchHealthMonitorService.ts:143-145`）が公開されている。
   → **稼働状態APIは新たに評価を走らせず、`getLastAggregate()` を読むだけにする。** まだ1度も評価していなければ `null` であり、これを「正常」に丸めず**判定待ち**として表現する（§5.1）。

2. **監視対象の6系列と、除外された系列がコード上に固定されている。**
   `fetchHealthSources.ts:3-9` が `MonitoredFetchSourceId = 'xml_regular' | 'xml_extra' | 'nowcast_target_times' | 'kikikuru_target_times' | 'amedas_latest_time' | 'amedas_point'`。同ファイル `:23-28` のコメントに、タイル画像本体は「オンデマンド取得のため周期ベースの判定になじまない未確定事項（別基準検討中）」として除外する旨が明記されている。`amedas_point` だけ `appliesElapsedCondition: false`（`:70`）。

   **表記ゆれに注意**: 除外理由のコメントは `radar_tile` と書いているが、`KNOWN_FETCH_SOURCE_KINDS`（`types.ts:654-666`）にある実際の `source_kind` は **`'radar_tile_frame'` と `'risk_tile_frame'`** である。受け入れ条件・実装ではコメントの表記ではなく `KNOWN_FETCH_SOURCE_KINDS` の値を正とする。同様に、雨雲の時刻一覧は `KNOWN_FETCH_SOURCE_KINDS` に `'radar_target_times'` があるのに対し監視定義側は `'radar_times_N1'` / `'radar_times_N2'` を参照しており、**両者は一致していない**。本Issueはこの不一致を修正しない（保存側の語彙に手を入れることになるため）が、§11 に残留リスクとして記録する。
   → **確定事項4 のとおり、この範囲をそのまま公開する。** タイルは健全性の系列としては返さず、別セクションで「監視対象外である」ことを明示的に表現する（§4.3、§5.1 `tiles`）。

3. **健全性の状態語彙は4値であり、`suspended` が独立している。**
   `fetchHealthEvaluator.ts:8` が `export type FetchHealthStatus = FreshnessStatus | 'suspended'`、`packages/shared/src/availability.ts:9` が `FreshnessStatus = 'normal' | 'delayed' | 'abnormal'`。
   → 監視APIも `'normal' | 'delayed' | 'abnormal' | 'suspended'` の4値をそのまま返す。基本設計 §8.1 の「意図的な停止を判定から除外し停止中として区別する」に一致する。
   `FetchHealthAggregate` の JSDoc（`fetchHealthEvaluator.ts:200-204`）は「`status` は表示用の最悪値。**通知の区分決定に使ってはならない**」と明記している。→ §5.1 の DTO でも同じ注意をTSDocに残す。

4. **起動時readiness は「4feedの初期取得フェーズ」と「会場評価済みか」の2軸であり、個別電文の成功とは別物である。**
   `jmaXmlPollingService.ts:15` `InitialFetchPhase = 'not_started' | 'running' | 'completed' | 'failed'`、`:16-23` `InitialFetchResult` が `failedFeedKinds: readonly JmaXmlFeedKind[]` を持つ。`INITIAL_FEED_KINDS` は `regular` / `extra` / `regular_l` / `extra_l` の4種（`:56-60` 付近）。
   `startupNotificationService.ts:53-55` が `isReady(venueId) { return this.initialFetchPhase === 'completed' && this.evaluatedVenueIds.has(venueId); }`。
   → **AD-H063 の「200空を全情報正常の保証と誤認し得る」の根拠そのもの。** 確定事項1 に従い、`readiness`（4feed別）と `venues`（会場別）を別フィールドで返す（§5.1）。`StartupNotificationInitialization.getStatus()` は既に `{ initialFetchPhase, evaluatedVenueIds }` を返す（`:37-42`）ので、これをそのまま使う。

5. **「処理できなかった電文」は専用テーブルではなく、`telegram_reception_adoption.adoption_result` に日本語の区分値として保存されている。**
   `weatherParseFailureRepository.ts:44` が `AND a.adoption_result = '未対応構造'` で判定している。実際に書き込まれる値（`apps/api/src/polling/*Processor.ts`・`jmaXmlPoller.ts:274`）は次のとおり:
   - 非採用側: `'未対応構造'` / `'対象地域外'` / `'対象外'` / `'未対応形式'` / `'重複または旧版'`
   - 採用側: `'警報・注意報として解析済み'` / `'気象防災速報として解析済み'` / `'警報等時系列として解析済み'` / `'早期注意情報として解析済み'` / `'地域時系列予報として解析済み'`
   `'対象外' | '対象地域外' | '未対応構造'` は `apps/api/src/repositories/types.ts` 内で `disposition` としてリテラル・ユニオン型になっている（`:205` ほか）。
   → **確定事項2 の「理由コード」は、この `adoption_result` を安定した区分値として採用する。** 新たな理由コード列の追加は保存側（Epic A〜D）の変更になり本Issueの範囲外である（§1.2）。
6. **`adoption_reason` は自由文であり、機械可読な理由コードとしては使えない。**
   `jmaWarningTelegramParser.ts:231-236` の `failure(disposition, reason)` に渡る文字列は `'ルート要素 Report の名前空間が不正です'` `'Control/Status が不正です'` 等の日本語自由文である。`unknown_cancellation_target:` / `ambiguous_cancellation_target:` の英小文字プレフィックスが付くのは `jmaVpbs50Processor.ts` の3箇所だけで、**全体として一貫していない**。
   → `adoption_reason` は**そのまま人間向けの詳細テキストとして返し、コードとしてパースしない**。§7 の理由コードは `adoption_result` 側で表現する。

7. **受信履歴リポジトリは、一覧で原文を返さない実装に既になっている。**
   `telegramReceptionRepository.ts:377-445` の `listTelegramReceptions` は `SELECT ... (t.raw_body IS NOT NULL) AS has_raw_body ...` であり `raw_body` 本体を SELECT していない。`findTelegramReceptionById` だけが `rawBody` を返す。
   `ListTelegramReceptionsOptions`（`types.ts:755-771`）は既に `limit`（既定100、`Math.min(options.limit, 1000)` で上限1000）と `offset` を持つ。
   → **確定事項3 の「一覧に原文を含めず、詳細取得時のみ返す」は、リポジトリ層では既に満たされている。** API層はこの性質を崩さないことを保証すればよい。

8. **訓練／本番の区別は履歴の種類ごとに軸が違う。**
   - 受信履歴: `telegram_reception.control_status`（`ControlStatus`、`WeatherControlStatus = 'normal' | 'training' | 'test'` と同語彙）。**`is_training` 列は存在しない。**
   - 通知出力履歴: `notification_output_history.is_training`（`NotificationOutputHistoryInput.isTraining: boolean`、`types.ts:991`）。`ListNotificationOutputHistoryOptions.isTraining?: boolean`（`:1006`）。
   - 操作記録: **訓練軸が存在しない**（`OperationHistoryInput`、`types.ts:1018-1031` に該当列なし）。
   → 確定事項3 の「デフォルトで訓練／本番のフィルタをかけない」は、**API層がこれらのオプションを既定で渡さない**ことで実現する。「訓練を除外する既定値を入れない」ことが要件である（§6.1）。

9. **操作記録の `actorId` / `actorDisplayName` は、入力では `null` 固定、読み出しでは `string | null`。**
   `types.ts:1025-1028` の入力側 TSDoc が「AuthGate 連携前は必ず NULL とする」、`:1036-1041` の読み出し側が「将来の AuthGate 連携後の履歴も読み出せるよう、返却値は NULL 固定にしない」。
   → 監視APIも `string | null` のまま返し、`null` を `"不明"` 等の文字列へ置換しない（K5 #78 の「actor null を保持」に対応）。

10. **既存の REST 規約（`app.ts`）**: Router 分割はせず `createApp()` 内に直書き。依存注入の有無（`if (dependencies.X)`）でルート登録ごとスキップする。エラーは共通ハンドラを持たず、各ハンドラが `{ status: 'error', code: <snake_case> }` を返す。クエリ検証は zod 等を使わず `packages/shared` 側の `parseXxx` に手書きし、**キー数完全一致**で余剰キーを 400 にする（`notificationDelta.ts:88-91`、`weatherApi.ts:332`）。新しめのルートは `sendJsonNoStore`（`app.ts:28-32`）を使う。
    → 本設計もこの規約に完全に従う（§5・§6・§8）。

11. **テストは `node:test`（vitest でも jest でもない）、`apps/api/tests/*.test.ts` のフラット配置、supertest 不使用、`app.listen(0)` + `fetch`。**
    `apps/api/package.json` の `"test": "node --import tsx --test tests/*.test.ts"`。
    → §9 の受け入れ条件はこの前提で書く。**サブディレクトリに置くと `tests/*.test.ts` のグロブに掛からず実行されない**（Issue #41 で実際に起きた事故。`d0df370`）。

---

## 3. 全体像

```text
                        ┌──────────────────────────────────────────┐
GET /api/monitoring/status ─▶│ MonitoringStatusService（新規・読み取り専用）│
                        │  ├ operation   : 運転状態（scheduler）      │
                        │  ├ health      : 6系列健全性（getLastAggregate）│
                        │  ├ readiness   : 4feed初期取得（getStatus）  │← 確定事項1で分離
                        │  ├ venues      : 会場別評価・採用（会場別に分離）│← 確定事項1で分離
                        │  ├ information : 情報別反映状況（availability）│
                        │  └ tiles       : 画像生成状態（監視対象外を明示）│← 確定事項1・4
                        └──────────────────────────────────────────┘
                                       │ 既存の保持値を読むだけ（上流HTTPを起こさない）
                                       ▼
   TimeBasedPollingScheduler.getStatus() / JmaXmlPollingService.getStatus()
   FetchHealthMonitorService.getLastAggregate() / StartupNotificationInitialization.getStatus()
   WeatherApiService（snapshot + evaluateWeatherAvailability）

GET /api/monitoring/processing ─▶│ MonitoringProcessingService（新規・読み取り専用）│← 確定事項2・7
                             │  └ 処理できなかった電文の件数・理由・原文抜粋    │
                             └────────────────────────────────────────┘
   ※ 稼働状態API（5秒周期ポーリング想定）とは別エンドポイント。低頻度取得を前提とする。

GET /api/monitoring/receptions        ─┐
GET /api/monitoring/receptions/:id     ├▶│ MonitoringHistoryService（新規・読み取り専用）│
GET /api/monitoring/notification-outputs│ └ 既存 listXxx / findXxxById をそのまま呼ぶ
GET /api/monitoring/operations        ─┘
```

**設計の中心的な考え方**: E10 は**新しい判定を一切行わない**。既に各サブシステムが持っている状態を、**丸めずに**、それぞれの語彙のまま HTTP へ写す層である。判定基準の見直し（AD-H001/H003/H041）を本Issueでやらないのは、確定事項4 と棚卸しの先送り承認に従った結果であり、かつ「配信層で新しい判定基準を作ると、通知生成側（D7）の判定と二重になって食い違う」ことを避けるためでもある。

---

## 4. 監視DTOの分離方針（AD-H063 / 確定事項1）

### 4.1 なぜ分離するのか

AD-H063 の「影響・到達条件」は **「200空を全情報正常の保証と誤認し得る」**。起動時 readiness は「4feedの取得が成功し、かつ会場評価が済んだ」ことしか意味せず、個別電文の解析成功も、非XML（雨雲・キキクル・アメダス）の取得完了も含まない。したがって、これらを1つの `status: 'ok'` に畳むと、**誤認が構造的に発生する**。

確定事項1 に従い、次の4つを**別フィールド**として返す。同じ値を集約した便利フィールドを**併設しない**（併設すると画面側がそちらだけを読む）。

| セクション | 意味 | 値の出どころ | 意味しないこと（TSDocに明記する） |
| --- | --- | --- | --- |
| `readiness` | 起動時の4feed初期取得が成功したか（feed別） | `JmaXmlPollingService.getStatus().initialFetch` | 個別電文の解析成功、非XML取得の完了 |
| `venues` | 会場ごとの起動時評価済み／採用状態 | `StartupNotificationInitialization.getStatus()` + 会場別採用の集計 | 全会場の正常性、当該会場の全情報の利用可能性 |
| `tiles` | 画像（雨雲・キキクル）の生成・配信状態 | タイルストア／索引の保持値 | 健全性判定（**監視対象外**。確定事項4） |
| `information` | 情報種別ごとの反映状態（availability 3状態） | `evaluateWeatherAvailability` の結果 | 取得の成否（取得成功と解析成功は別。基本設計 §8.2） |

さらに `health`（6系列）と `operation`（運転状態）も独立させる。基本設計 §8.2 が「**取得健全性は運転状態とは別に表示し、自動取得中でも異常を示せるようにする**」と明記しているため、両者を1フィールドに畳んではならない。

### 4.2 availability 3状態を縮退させない

`information` セクションの反映状態は `Availability`（`'available' | 'stale' | 'unavailable'`）をそのまま返す。boolean や OK/NG に丸めない（[07-wx-data-protocol.md](../rules/07-wx-data-protocol.md) の必須事項）。

`stale` は「前回正常値を保持しつつ鮮度が低下している」状態であり、`unavailable`（保持値なし）とは別である。監視画面の「停止中の保存値」（基本設計 §8.2 の反映状態の語彙）は、`availability = 'stale'` かつ `operation.health = 'suspended'` の組み合わせとして**2軸で**表現し、新しい単一の列挙値を作らない。

### 4.3 タイルは「健全性の系列」として返さない（確定事項4）

`tiles` セクションは**保持している事実だけ**を返し、`status`（正常/遅延/異常）を**持たない**。代わりに次を明示する。

- `healthMonitored: false` — 6系列健全性監視の対象外であること（`fetchHealthSources.ts:23-28` の除外理由に対応）
- `healthCriteriaStatus: 'undecided'` — 判定基準が未決であり、K6 #79 / L2 #84 で決めること

**`tiles` に失敗率や閾値判定を実装してはならない。** それは AD-H001 の「要求数・失敗率等の採否を先に判断。既存周期基準を流用しない」に反する。件数（取得中・失敗）は**観測値としてのみ**返す。

同様に、`amedas_point` の状態は既存の失敗回数基準の結果（`FetchSourceHealthResult`）をそのまま返し、到達時間保証を表す新フィールド（「最悪N分」等）を**追加しない**（AD-H003、確定事項4）。代わりに §5.1 のとおり `appliesElapsedCondition: false` を可視化して、画面側が「経過時間条件が適用されていない系列である」と分かるようにする。

---

## 5. 稼働状態API

### 5.1 `GET /api/monitoring/status`（新設）

**クエリ**: `terminalId`（必須）のみ。キー数完全一致で、それ以外のキーがあれば 400。
端末IDから `venueId` を解決するのは既存の weather 系 API と同じ（`resolveTerminalDefinition`）。会場別セクション（`venues` と `information`）は**全会場分（east・trc）を返し**、`requestedVenueId` で要求元会場を示す（**確定事項6**）。

**会場スコープの境界が気象系APIと異なることの明記（確定事項6）**: 気象系API（#33 等）は「端末が属する会場の気象状況を表示する」ためのものであり、他会場のデータを返さない。一方、監視APIは「サーバー全体が正常に動いているか」を見るためのものであり、**操作対象・取得対象がサーバー共通で全会場に影響する**（基本設計 §8.2「操作対象はサーバー共通であり全端末に影響することを表示する」）。したがって、片方の会場だけで採用失敗が起きている状況を、要求元会場に絞ったことで見落とす事態を避ける必要がある。**この差は意図した設計であり、気象系APIの会場スコープ規約の例外ではなく、別の基準（サーバー全体の健全性）に基づく別種のAPIである**。製造担当は、監視APIに気象系APIと同じ会場絞り込みを持ち込んではならない。

**応答（200）**:

```ts
// packages/shared/src/monitoringStatus.ts（新規）

export interface MonitoringStatusResponse {
  readonly status: 'ready';
  readonly terminalId: string;
  readonly requestedVenueId: VenueId;
  readonly serverGenerationId: string;
  /** この応答を組み立てた時刻。監視画面の「最終表示更新時刻」の基準（基本設計 §8.2）。 */
  readonly generatedAt: UtcIso8601String;

  readonly operation: MonitoringOperationSection;
  readonly health: MonitoringHealthSection;
  readonly readiness: MonitoringReadinessSection;
  readonly venues: readonly MonitoringVenueSection[];
  readonly information: readonly MonitoringInformationSection[];
  readonly tiles: MonitoringTilesSection;
}
```

**`processing` はこの応答に含まれない**（確定事項7）。稼働状態APIは監視画面の 5 秒周期ポーリング（基本設計 §8.3）で叩かれる想定であり、原文抜粋（最大 2000 文字 × 20 件）を毎回転送しない。診断は §5.3 の別エンドポイントから低頻度で取得する。

#### `operation`（全体状態：取得運転・スケジュール）

```ts
export interface MonitoringOperationSection {
  /** 取得ジョブが動いているか。健全性とは独立（基本設計 §8.2）。 */
  readonly schedulerRunning: boolean;
  /** 現在の時間帯設定。config/polling.yaml の periods の該当要素。 */
  readonly period: {
    readonly start: string; // "HH:mm" (JST)
    readonly end: string;   // "HH:mm" (JST)
    readonly xmlSeconds: number | null;
    readonly imageCatalogSeconds: number | null;
    readonly amedasSeconds: number | null;
    readonly nowcastEnabled: boolean;
    readonly kikikuruEnabled: boolean;
  };
  readonly nextPeriodChangeAt: UtcIso8601String;
  /** ScheduledSource ごとの待機／取得中／スケジュール停止と次回予定。 */
  readonly scheduledSources: readonly {
    readonly source: 'xml' | 'nowcast' | 'kikikuru' | 'amedas';
    readonly state: 'waiting' | 'running' | 'scheduled_stopped';
    readonly intervalSeconds: number | null;
    readonly nextRunAt: UtcIso8601String | null;
  }[];
}
```

出どころ: `TimeBasedPollingScheduler.getStatus(): TimeBasedPollingStatus`（`timeBasedPollingScheduler.ts:140-`）をそのまま写す。`PollingPeriod` は `config/pollingSchedule.ts:15-23` の型と同形。

#### `health`（6系列健全性）— 確定事項4 の範囲そのまま

```ts
export type MonitoringHealthStatus = 'normal' | 'delayed' | 'abnormal' | 'suspended';

export interface MonitoringHealthSection {
  /**
   * まだ一度も評価していない場合 null。
   * 【重要】null を 'normal' に丸めない。監視画面は「判定待ち」と表示する（基本設計 §8.2 の取得健全性カード）。
   */
  readonly evaluatedAt: UtcIso8601String | null;
  /**
   * 表示用の最悪値。まだ評価していなければ null。
   * 【重要】通知の区分決定に使ってはならない（fetchHealthEvaluator.ts の FetchHealthAggregate と同じ注意）。
   */
  readonly worstStatus: MonitoringHealthStatus | null;
  readonly worstSourceIds: readonly MonitoredFetchSourceId[];
  /** MONITORED_FETCH_SOURCES の固定順で常に6要素。評価前は status が null。 */
  readonly sources: readonly MonitoringHealthSource[];
  /** config/polling.yaml の fetchHealth の現行値。AD-H041 のとおり表示のみで、ここから判定し直さない。 */
  readonly thresholds: {
    readonly evaluationIntervalSeconds: number;
    readonly delayedConsecutiveFailures: number;
    readonly delayedIntervalMultiplier: number;
    readonly abnormalConsecutiveFailures: number;
    readonly abnormalElapsedSeconds: number;
    readonly maxScanAttempts: number;
  };
}

export interface MonitoringHealthSource {
  readonly sourceId: MonitoredFetchSourceId;
  readonly displayName: string;
  readonly status: MonitoringHealthStatus | null;
  readonly lastAttemptAt: UtcIso8601String | null;
  readonly lastSuccessAt: UtcIso8601String | null;
  readonly consecutiveFailures: number | null;
  readonly intervalSeconds: number | null;
  /**
   * 経過時間条件（周期×3・固定10分）を適用する系列か。
   * amedas_point だけ false。AD-H003 のとおり到達時間は保証されない（K6/L2 で判断）。
   */
  readonly appliesElapsedCondition: boolean;
  /** 判定理由。1行テキスト（改行を含まない）をそのまま返す。 */
  readonly reasons: readonly {
    readonly kind: 'consecutive_failures' | 'last_success_elapsed';
    readonly status: 'delayed' | 'abnormal';
    readonly sourceKind: string;
    readonly text: string;
  }[];
}

export type MonitoredFetchSourceId =
  | 'xml_regular' | 'xml_extra'
  | 'nowcast_target_times' | 'kikikuru_target_times'
  | 'amedas_latest_time' | 'amedas_point';
```

出どころ: `FetchHealthMonitorService.getLastAggregate()`。`null`（未評価）のとき `evaluatedAt`・`worstStatus` は `null`、`sources` は `MONITORED_FETCH_SOURCES` の6件を `status: null` で埋める（**配列を空にしない**。画面が「6系列の表」を常に描けるようにするため）。

`MonitoredFetchSourceId` と `MONITORED_FETCH_SOURCES` 相当の定義は `apps/api` 側にしかないため、**`packages/shared` へ同じ語彙を再定義する**（`apps/api` から `packages/shared` へは依存できるが逆はできないため）。二重定義による食い違いを防ぐため、`apps/api/src/monitoring/fetchHealthSources.ts` 側で `MonitoredFetchSourceId` を shared から import して使う形に**置き換える**（値の変更はなく、定義位置の移動のみ）。

#### `readiness`（起動時4feed）— 確定事項1 で分離

```ts
export interface MonitoringReadinessSection {
  readonly initialFetchPhase: 'not_started' | 'running' | 'completed' | 'failed';
  readonly startedAt: UtcIso8601String | null;
  readonly finishedAt: UtcIso8601String | null;
  /** 初期取得の4フィード。成功・失敗を feed 別に返す。 */
  readonly feeds: readonly {
    readonly feedKind: 'regular' | 'extra' | 'regular_l' | 'extra_l';
    readonly succeeded: boolean | null; // 未実施・実施中は null
  }[];
  readonly errorReason: string | null;
}
```

出どころ: `JmaXmlPollingService.getStatus().initialFetch`。`result.failedFeedKinds` に含まれる feed を `succeeded: false`、`phase === 'completed'` かつ含まれないものを `true`、`phase` が `not_started` / `running` なら全て `null`。

**TSDoc に必ず書く注意（AD-H063）**: 「このセクションが `completed` かつ全 feed `succeeded: true` でも、**個別電文の解析成功や非XML（雨雲・キキクル・アメダス）の取得完了を意味しない**。情報種別ごとの反映状態は `information` を、取得系列の健全性は `health` を見ること。」

#### `venues`（会場別採用・評価状態）— 確定事項1 で分離

```ts
export interface MonitoringVenueSection {
  readonly venueId: VenueId;
  /** StartupNotificationInitialization.isReady(venueId) と同値。起動時評価が済んだか。 */
  readonly startupEvaluated: boolean;
  /**
   * 直近の採用判定の集計。adoption_result の区分値ごとの件数。
   * 【重要】会場ごとに独立。片方の会場の失敗を全体成功に隠さない（基本設計 §8.2）。
   */
  readonly recentAdoptions: readonly {
    readonly adoptionResult: string;
    readonly count: number;
    readonly latestDecidedAt: UtcIso8601String | null;
  }[];
  /** 集計対象の期間（generatedAt から遡った時間）。既定 24 時間。 */
  readonly adoptionWindowHours: number;
}
```

#### `information`（情報別反映状況）

```ts
export type MonitoringInformationKind =
  | 'bosai_bulletin' | 'warning' | 'warning_timeseries' | 'early_warning'
  | 'amedas' | 'area_timeseries' | 'nowcast' | 'kikikuru';

export interface MonitoringInformationSection {
  readonly kind: MonitoringInformationKind;
  readonly venueId: VenueId;
  /** 3状態をそのまま返す。boolean へ縮退させない（07-wx-data-protocol.md 必須）。 */
  readonly availability: Availability;
  readonly issuedAt: UtcIso8601String | null;
  readonly validAt: UtcIso8601String | null;
  readonly fetchedAt: UtcIso8601String | null;
  readonly lastSuccessAt: UtcIso8601String | null;
  /** 保存済み正規化データから得た件数等の要約。取得できない場合 null。 */
  readonly summaryCount: number | null;
}
```

出どころ: 既存の `WeatherApiService` / `NowcastApiService` / `KikikuruApiService` が返すレスポンスの `metadata` をそのまま使う（`evaluateWeatherAvailability` を**再実装しない**）。`controlStatus` は `'normal'` を渡す（監視画面の反映状況は本番相当データの状態を見るものであるため）。

#### `tiles`（画像生成状態）— 確定事項1・4

```ts
export interface MonitoringTilesSection {
  /** 6系列健全性監視の対象外であること。常に false。 */
  readonly healthMonitored: false;
  /** 判定基準が未決であること。K6 #79 / L2 #84 で決める。常に 'undecided'。 */
  readonly healthCriteriaStatus: 'undecided';
  readonly layers: readonly {
    readonly layer: 'nowcast' | 'kikikuru';
    /** 索引（時刻一覧）の availability。索引は6系列健全性の監視対象であり、画像本体は対象外。 */
    readonly catalogAvailability: Availability;
    readonly catalogUpdatedAt: UtcIso8601String | null;
    readonly availableFrameCount: number;
    /** その時間帯で画像本体の上流取得が許可されているか（config/polling.yaml）。 */
    readonly upstreamFetchAllowed: boolean;
    readonly nextUpstreamAllowedAt: UtcIso8601String | null;
  }[];
}
```

**`status` フィールドを持たないことが仕様である。** 正常/遅延/異常の判定を返すと、未決の判定基準を確定させたことになる（AD-H001 違反）。

### 5.2 稼働状態APIのエラー応答

| 状況 | HTTP | body |
| --- | --- | --- |
| `terminalId` 欠落・余剰キー・同名キー重複・空文字 | 400 | `{"status":"error","code":"invalid_request"}` |
| 未知 `terminalId` | 404 | `{"status":"error","code":"terminal_not_found"}` |
| 読み出し中の例外 | 500 | `{"status":"error","code":"monitoring_status_failed"}` |

`503`（初期化中）は**返さない**。監視画面は初期化中こそ状態を見たいものであり、`readiness.initialFetchPhase` で表現する方が確定事項1 に合致する。

### 5.3 `GET /api/monitoring/processing`（処理できなかった電文の診断・新設）【確定事項7】

稼働状態APIから分離した独立エンドポイント。**パス命名**は `/api/monitoring/` 配下の他ルート（`status` / `receptions` / `notification-outputs` / `operations`）と同じく、**複数形または状態名の名詞1語**という規約に合わせて `processing` とした（`receptions` 等の「行の一覧」ではなく「処理状況の診断」という状態を返すため、`status` と同じ単数の状態名を採る）。

**クエリ**: `terminalId`（必須）のみ。キー数完全一致で、それ以外のキーがあれば 400。稼働状態APIと同じ検証規約・同じエラーコード体系を使う。

**応答（200）**:

```ts
// packages/shared/src/monitoringProcessing.ts（新規）

export interface MonitoringProcessingResponse {
  readonly status: 'ready';
  readonly terminalId: string;
  readonly requestedVenueId: VenueId;
  readonly serverGenerationId: string;
  readonly generatedAt: UtcIso8601String;
  /** 集計対象の期間（generatedAt から遡った時間）。PROCESSING_WINDOW_HOURS = 24。 */
  readonly windowHours: number;
  /** adoption_result の区分値ごとの件数。非採用・採用の両方を含む。全会場分（確定事項6）。 */
  readonly byAdoptionResult: readonly {
    readonly adoptionResult: string;
    readonly venueId: VenueId;
    readonly count: number;
  }[];
  /** 非採用（未対応構造・未対応形式）だけの直近サンプル。原文抜粋を含む。最大20件。 */
  readonly recentFailures: readonly MonitoringProcessingFailure[];
}
```

**取得頻度の前提**: 監視画面（K8 #81）は稼働状態APIを 5 秒周期で、本APIは**それより十分に低い頻度（例: 60 秒周期、またはパネルを開いたときの都度取得）**で叩く。**本APIの呼び出し頻度をサーバー側で制限（レートリミット）しない**（PoCで制限機構を新設しない）。頻度の決定は K8 #81 の責務であり、§10 で引き継ぐ。

**エラー応答**:

| 状況 | HTTP | body |
| --- | --- | --- |
| `terminalId` 欠落・余剰キー・同名キー重複・空文字 | 400 | `{"status":"error","code":"invalid_request"}` |
| 未知 `terminalId` | 404 | `{"status":"error","code":"terminal_not_found"}` |
| 読み出し中の例外 | 500 | `{"status":"error","code":"monitoring_processing_failed"}` |

---

## 6. 履歴検索API（AD-H065 / 確定事項3）

### 6.1 共通のクエリ規約

3本すべてに共通して次を適用する。

| 規約 | 内容 | 根拠 |
| --- | --- | --- |
| **訓練フィルタの既定なし** | `controlStatus`（受信履歴）/ `isTraining`（通知出力履歴）を**指定しなければリポジトリへ渡さない**。既定値を補わない | 確定事項3 |
| **最大件数の上限** | `limit` の既定 `100`、**上限 `200`**。上限を超える値は 400（**黙って切り捨てない**） | 確定事項3 |
| **オフセット方式** | `offset`（既定 `0`、最大 `100000`）。カーソル方式は使わない | §6.4 |
| **総件数の同時返却** | `totalCount` を必ず返す。既存の `countXxx` を同じ条件で呼ぶ | 画面のページャに必要 |
| **一覧に原文を含めない** | 受信履歴一覧は `hasRawBody: boolean` と `bodyBytes` のみ。原文は詳細APIのみ | 確定事項3 |
| **キー数完全一致** | 未知のクエリキーが1つでもあれば 400 | 既存規約（§2.3-10） |
| **時刻は UTC ISO 8601** | `...From` / `...To` は `UtcIso8601String`。パースできなければ 400 | 既存規約 |

**`limit` 上限を `200` にした根拠**: リポジトリ層の既存上限は `1000`（`Math.min(options.limit, 1000)`）だが、(a) 受信履歴の一覧は1件ごとに `telegram_reception_area` と `telegram_reception_adoption` を追加SELECTする N+1 構造であり（`telegramReceptionRepository.ts:418-431`）、件数に比例して往復が増える、(b) 基本設計 §8.1 の履歴はダイアログ内の一覧であり1画面に200行は十分過ぎる、(c) AD-H011（容量未決）のもとで大量取得を既定の使い方にしたくない、の3点による。**リポジトリ層の `1000` は変更しない**（Epic A〜D の保存側に手を入れないため）。API層が `200` を超える要求を 400 で拒否する。

### 6.2 `GET /api/monitoring/receptions`（受信履歴一覧）

**クエリ**（すべて任意、`limit` / `offset` を除き既定値なし）:
`controlStatus` / `telegramType` / `infoType` / `areaCode` / `documentUrl` / `adoptionResult` / `adoptionVenueId` / `receivedAtFrom` / `receivedAtTo` / `reportDateTimeFrom` / `reportDateTimeTo` / `limit` / `offset`

`ListTelegramReceptionsOptions`（`types.ts:755-771`）と1対1で対応させ、API独自のフィルタ語彙を作らない。

**応答（200）**:

```ts
export interface MonitoringReceptionListResponse {
  readonly status: 'ready';
  readonly generatedAt: UtcIso8601String;
  readonly totalCount: number;
  readonly limit: number;
  readonly offset: number;
  readonly items: readonly MonitoringReceptionSummary[];
}

export interface MonitoringReceptionSummary {
  readonly id: number;
  readonly fetchAttemptId: number | null;
  readonly feedKind: string | null;
  readonly documentUrl: string;
  readonly telegramType: string | null;
  readonly title: string | null;
  /** 'normal' | 'training' | 'test' | null。null は不明であり、normal とみなさない。 */
  readonly controlStatus: ControlStatus | null;
  readonly infoType: string | null;
  readonly eventId: string | null;
  readonly serial: string | null;
  readonly controlDateTime: UtcIso8601String | null;
  readonly reportDateTime: UtcIso8601String | null;
  readonly targetDateTime: UtcIso8601String | null;
  readonly receivedAt: UtcIso8601String;
  /** 原文は一覧に含めない（確定事項3）。有無とサイズだけを返す。 */
  readonly hasRawBody: boolean;
  readonly bodyBytes: number | null;
  readonly contentHash: string | null;
  readonly areas: readonly { readonly areaCode: string; readonly areaName: string | null; readonly codeType: string | null }[];
  /** 会場ごとの採用判定。片方の会場の非採用を隠さない。 */
  readonly adoptions: readonly {
    readonly venueId: VenueId;
    readonly adoptionResult: string | null;
    readonly adoptionReason: string | null;
    readonly adoptionDecidedAt: UtcIso8601String | null;
  }[];
}
```

**`rawBody` キーは型に存在しない。** 型の上で存在しないことが、誤って含めてしまう事故への一番強い防御である。

### 6.3 `GET /api/monitoring/receptions/:id`（受信履歴詳細＝原文取得）

**唯一、電文原文を返す経路。** `findTelegramReceptionById` の結果をそのまま返す。

```ts
export interface MonitoringReceptionDetailResponse {
  readonly status: 'ready';
  readonly generatedAt: UtcIso8601String;
  readonly reception: MonitoringReceptionSummary & {
    /** 電文原文。保存されていなければ null（取得失敗時は本文なしの取得試行記録となる。基本設計 §8.2）。 */
    readonly rawBody: string | null;
  };
}
```

- `:id` が整数でない（前ゼロ・負数・小数・全角数字・空）→ 400 `invalid_request`
- 該当なし → 404 `{"status":"error","code":"reception_not_found"}`
- クエリキーが1つでもあれば → 400

**原文は無加工で返す。** 抜粋・サニタイズを行うのは §7 の `processing` セクションであり、詳細APIは「原文をそのまま読む」ための経路である（基本設計 §8.1 の「右ペインに電文本文を表示する」）。表示側のエスケープは K3 #76 の責務であることを §10 で引き継ぐ。

### 6.4 `GET /api/monitoring/notification-outputs`（通知出力履歴一覧）

**クエリ**: `category` / `sourceType` / `changeType` / `origin` / `detectionContext` / `isTraining` / `detectedAtFrom` / `detectedAtTo` / `limit` / `offset`

`isTraining` は `"true"` / `"false"` のみ受理（それ以外は 400）。**指定しなければ渡さない**＝訓練・本番の両方が返る（確定事項3）。

**応答**: `NotificationOutputHistory`（`types.ts:996-998`）の全フィールドをそのまま返す。`summary` は改行を含む1本の文字列のまま返し、3要素へ分解しない（Issue #41 の確定事項7 を踏襲）。`origin` と `detectionContext` は**独立した2軸**として返し、片方から他方を導出しない（AD-H069）。

`relatedRefsJson` / `targetAreaJson` は**保存された文字列のまま**返し、APIでパースしない（パース失敗で履歴が読めなくなることを避けるため）。パースは K4 #77 の責務として引き継ぐ。

### 6.5 `GET /api/monitoring/operations`（操作記録一覧）

**クエリ**: `operationKind` / `result` / `actorId` / `requestedAtFrom` / `requestedAtTo` / `completedAtFrom` / `completedAtTo` / `limit` / `offset`

**応答**: `OperationHistory`（`types.ts:1033-1041`）をそのまま返す。`actorId` / `actorDisplayName` は `string | null` のまま返し、`null` を文字列で埋めない（§2.3-9）。

**注**: E11 #43 が未実装のため、現時点で `operation_history` に行が入る経路は存在しない。したがってこのAPIは**空配列を返すのが正常**である。§9 AC10 はその前提で検証する。

### 6.6 履歴APIのエラー応答

| 状況 | HTTP | body |
| --- | --- | --- |
| クエリ不正（未知キー・重複キー・型不正・`limit` 範囲外） | 400 | `{"status":"error","code":"invalid_request"}` |
| 受信履歴詳細で該当なし | 404 | `{"status":"error","code":"reception_not_found"}` |
| 読み出し例外 | 500 | `{"status":"error","code":"monitoring_history_failed"}` |

---

## 7. 処理できなかった電文の診断公開（AD-H040・AD-H045 / 確定事項2・7・8）

本章の内容は、すべて §5.3 の独立エンドポイント `GET /api/monitoring/processing` の応答仕様である（確定事項7 により稼働状態APIから分離した）。

### 7.1 何を「処理できなかった電文」とするか

§2.3-5 のとおり、専用テーブルは存在しない。`telegram_reception_adoption.adoption_result` が次の値のとき「処理できなかった」と扱う。

| `adoptionResult` | 意味 | 診断公開の対象か |
| --- | --- | --- |
| `'未対応構造'` | 既知の電文種別だが XML 構造を解釈できなかった（AD-H045） | **対象** |
| `'未対応形式'` | フィード上の電文がスキーマ検証を通らなかった（`jmaXmlPoller.ts:274`） | **対象** |
| `'対象地域外'` | 構造は解釈できたが、その会場の対象区域を含まない | 対象外（正常な非採用） |
| `'対象外'` | 実装対象外の電文種別 | 対象外（正常な非採用） |
| `'重複または旧版'` | 既存行と同じか古い | 対象外（正常な非採用） |
| `'...として解析済み'` | 採用された | 対象外 |

`byAdoptionResult` は**全区分の件数**を返す（正常な非採用の件数も運用上の判断材料になるため）。`recentFailures` は**上表の「対象」2区分だけ**を返す。

### 7.2 理由コードと詳細テキスト

- **理由コード** = `adoptionResult`（`'未対応構造'` / `'未対応形式'`）。安定した区分値であり、保存側の変更なしに得られる。
- **詳細テキスト** = `adoptionReason`（自由文）。§2.3-6 のとおり機械可読なコードではないため、**そのまま人間向けテキストとして返し、APIでパースしない**。

### 7.3 原文抜粋の範囲とサニタイズ（確定事項2）

```ts
export interface MonitoringProcessingFailure {
  readonly receptionId: number;
  readonly venueId: VenueId;
  /** 理由コード。'未対応構造' | '未対応形式'。 */
  readonly adoptionResult: string;
  /** 詳細テキスト（自由文）。機械可読なコードではない。 */
  readonly adoptionReason: string | null;
  readonly telegramType: string | null;
  readonly documentUrl: string;
  readonly receivedAt: UtcIso8601String;
  readonly adoptionDecidedAt: UtcIso8601String | null;
  /** 原文の総バイト数。抜粋との対比で「どれだけ省いたか」を示す。 */
  readonly rawBodyBytes: number | null;
  /** 原文抜粋。原文が保存されていなければ null。 */
  readonly excerpt: MonitoringRawExcerpt | null;
}

export interface MonitoringRawExcerpt {
  /** 抜粋本文。最大 EXCERPT_MAX_CHARS 文字。 */
  readonly text: string;
  /** 抜粋の開始位置（原文先頭からの UTF-16 コードユニット数）。 */
  readonly startOffset: number;
  /** 原文全体の長さ（UTF-16 コードユニット数）。 */
  readonly totalLength: number;
  /** 原文の末尾まで含んでいるか。false なら以降が省略されている。 */
  readonly truncated: boolean;
  /** 抜粋位置の決め方。'head' = 先頭から（該当箇所を特定できなかった場合）。 */
  readonly anchor: 'head' | 'reason_match';
}
```

**抜粋の範囲（決定）**:

- `EXCERPT_MAX_CHARS = 2000`（UTF-16 コードユニット）。
- **`anchor = 'reason_match'`**: `adoptionReason` に含まれる要素名（`Control/Status`、`Head/ReportDateTime`、`ルート要素 Report` 等の `/` 区切り・英数字のトークン）の最後の区切りを原文から検索し、**最初に一致した位置の 500 文字手前**から `EXCERPT_MAX_CHARS` 文字を切り出す。
- **`anchor = 'head'`**: 一致が見つからない、または `adoptionReason` が `null` のときは、**原文の先頭から** `EXCERPT_MAX_CHARS` 文字を切り出す。XML の Control / Head 部が先頭にあるため、構造不正の診断には先頭が最も有用である。
- サロゲートペアの途中で切らない（切り出し境界が下位サロゲートなら1文字戻す）。

**サニタイズ（決定）**:

1. **制御文字の除去**: `U+0000`〜`U+0008`、`U+000B`、`U+000C`、`U+000E`〜`U+001F`、`U+007F` を除去する。XML として不正な電文には制御文字が混入しうるため、JSON へ載せる前に落とす。**`U+0009`（TAB）・`U+000A`(LF)・`U+000D`(CR) は残す**（XML の整形を壊さず、診断で行位置が分かるようにするため）。
2. **HTMLエスケープを行わない**。抜粋は XML の原文断片であり、サーバー側でエスケープすると「原文がどうだったか」が分からなくなる。**表示側（K7 #80 / K8 #81）がテキストノードとして描画する責務**として §10 で引き継ぐ。
3. **マスキングを行わない**。気象庁XML電文は公開情報であり、個人情報・認証情報を含まない。マスキング処理を入れると、かえって「どこが壊れていたか」の診断を妨げる。

**`recentFailures` の件数上限**: `PROCESSING_FAILURE_SAMPLE_LIMIT = 20`（`adoptionDecidedAt` の降順）。20件を超える場合も `byAdoptionResult` の件数には全件が反映される（件数は落とさず、サンプルだけ絞る）。より多くを見たい場合は §6.2 の受信履歴一覧を `adoptionResult=未対応構造` で検索する経路がある。

**集計ウィンドウ**: `PROCESSING_WINDOW_HOURS = 24`（`generatedAt` から遡る）。`windowHours` として応答に含め、画面が期間を明示できるようにする。

**サイズ値の確度（確定事項8）**: 上記3つの値（`EXCERPT_MAX_CHARS = 2000` / `PROCESSING_FAILURE_SAMPLE_LIMIT = 20` / `PROCESSING_WINDOW_HOURS = 24`）は、**実データの「未対応構造」電文で診断に必要な文字数を検証したうえで決めた値ではない**。統括担当の確認により、提案値のまま進めることが確定している。**運用で不足・過大が判明した場合は、本設計の改訂ではなく後続PRでの定数調整で対応する**前提とする。そのため製造担当は、この3値を**`packages/shared` の名前付き定数として1か所に定義し、サービス実装・テストの両方がその定数を参照する**こと（数値をコードへ直書きしない）。受け入れ条件 AC6 も定数を参照して書き、値を変えたときにテストの期待値だけが取り残されないようにする。

---

## 8. モジュール構成

### 8.1 `packages/shared`（新規）

| ファイル | 内容 |
| --- | --- |
| `src/monitoringStatus.ts` | §5.1 の全DTO型、`MonitoredFetchSourceId`、`parseMonitoringStatusQuery(query): MonitoringStatusRequest \| null` |
| `src/monitoringProcessing.ts` | §5.3・§7 の全DTO型、`parseMonitoringProcessingQuery`、定数 `EXCERPT_MAX_CHARS` / `PROCESSING_FAILURE_SAMPLE_LIMIT` / `PROCESSING_WINDOW_HOURS`（確定事項8 のとおり1か所に定義する） |
| `src/monitoringHistory.ts` | §6 の全DTO型、`parseMonitoringReceptionQuery` / `parseMonitoringReceptionIdParam` / `parseMonitoringNotificationOutputQuery` / `parseMonitoringOperationQuery`、`MONITORING_HISTORY_LIMIT_DEFAULT = 100` / `MONITORING_HISTORY_LIMIT_MAX = 200` |
| `src/index.ts` | 上記3ファイルの `export * from './xxx.js';` を追加 |

パーサは既存の `parseNotificationDeltaQuery` と同じ **`null` 返し**の規約に揃える（`parseWeatherApiQuery` の Result 型ではなく）。新しめのファイルが `null` 返しであるため。

### 8.2 `apps/api`（新規・変更）

| ファイル | 区分 | 内容 |
| --- | --- | --- |
| `src/monitoring/monitoringStatusService.ts` | 新規 | §5.1 の組み立て。依存は注入（`scheduler` / `xmlPollingService` / `fetchHealthMonitor` / `startupInitialization` / `weatherApi` / `nowcastApi` / `kikikuruApi` / `serverGenerationId` / `now`）。**`connection` を依存に取らない**（確定事項7 により DB を読むのは processing 側だけになったため。ただし `venues.recentAdoptions` の集計だけは `connection` を使う） |
| `src/monitoring/monitoringProcessingService.ts` | 新規 | §5.3 の組み立て。依存は `connection` / `serverGenerationId` / `now` のみ |
| `src/monitoring/monitoringProcessingDiagnostics.ts` | 新規 | §7 の集計・抜粋・サニタイズ。`buildRawExcerpt(rawBody, adoptionReason)` を純粋関数として切り出す |
| `src/monitoring/monitoringHistoryService.ts` | 新規 | §6。既存 `listXxx` / `countXxx` / `findXxxById` を呼ぶだけ |
| `src/repositories/telegramReceptionRepository.ts` | 変更 | §7 用の集計関数 `summarizeAdoptionResults(connection, sinceIso)` と `listRecentAdoptionFailures(connection, sinceIso, limit)` を**追加**（既存関数は変更しない） |
| `src/monitoring/fetchHealthSources.ts` | 変更 | `MonitoredFetchSourceId` を `packages/shared` からの再輸出に置き換える（値の変更なし） |
| `src/app.ts` | 変更 | `AppDependencies` に `monitoringStatus?` / `monitoringProcessing?` / `monitoringHistory?` を追加し、6ルートを登録。すべて `sendJsonNoStore` を使う |
| `src/server.ts` | 変更 | 3サービスを生成して `createApp` へ渡す配線 |

**migration を追加しない。** 既存テーブルの読み取りだけで §5〜§7 のすべてが構成できることを §2.3 で確認済みである。

### 8.3 ルート一覧

| メソッド | パス | 登録条件 |
| --- | --- | --- |
| GET | `/api/monitoring/status` | `dependencies.monitoringStatus` |
| GET | `/api/monitoring/processing` | `dependencies.monitoringProcessing` |
| GET | `/api/monitoring/receptions` | `dependencies.monitoringHistory` |
| GET | `/api/monitoring/receptions/:id` | `dependencies.monitoringHistory` |
| GET | `/api/monitoring/notification-outputs` | `dependencies.monitoringHistory` |
| GET | `/api/monitoring/operations` | `dependencies.monitoringHistory` |

**POST / PUT / DELETE を一切追加しない**（E11 #43 の範囲）。**`GET /api/monitoring/startup-inquiries` を追加しない**（確定事項5。D5 起動監査は K4 #77 へ先送り）。

**Issue #43（E11）とのAPI体系の整合**: E11 は取得制御（副作用のある操作）であり、ベースパスを `/api/control/` に分けている（#43 §5.1）。本設計の読み取り専用APIは `/api/monitoring/` に固定し、**両者のベースパスを混在させない**。エラー包絡形式は両Issue共通で `{"status":"error","code":"<snake_case>"}`、成功時は本Issueが `status: 'ready'`、E11 が操作の進行状態を表す `status: 'completed' | 'in_progress'` を返す。**これは「読み取り結果の準備状態」と「操作の完了状態」という別の意味を同じキー名で表すものであり、値域を統一しない**（統一すると E11 の `in_progress` を本Issue側にも持ち込むことになり、読み取り専用APIに存在しない状態を作ってしまう）。K2/K5 の画面側は、ベースパスでどちらの語彙かを判別する。

### 8.4 `apps/web`

**変更しない。** 画面側の fetch 関数・ストアは Epic K の各Issueで実装する（Issue #41 が `apps/web` をほぼ触らなかったのと同じ境界）。

---

## 9. 受け入れ条件

Node.js 24、既存の `node:test` + `tsx` を使う。**テストファイルは `apps/api/tests/*.test.ts` に直置きする**（サブディレクトリはグロブに掛からず実行されない）。時刻・`serverGenerationId`・端末IDは注入し、応答JSONは原則 `assert.deepEqual` で完全一致を検証する。

- [ ] **AC1 クエリ検証（全6ルート共通）**: `GET /api/monitoring/status` および `GET /api/monitoring/processing` に対し、`terminalId` 欠落 / 余剰クエリキー（例 `venueId=east`）/ 同名キー重複（`terminalId=a&terminalId=b`）/ 空文字 のすべてで、HTTP 400 と body `{"status":"error","code":"invalid_request"}` が完全一致で返る。未知 `terminalId`（例 `"zzz"`）で 404 と `{"status":"error","code":"terminal_not_found"}`。既知の4端末（`hkeagh01` / `kkeagh01` / `htrcph01` / `ktrcph01`）はすべて 200。履歴3ルートでも、未知クエリキーが1つでもあれば 400 になる。`/api/monitoring/receptions/:id` に `abc` / `-1` / `1.5` / `01` / `１`（全角）/ 空 を渡すと 400、存在しない整数IDで 404 と `{"status":"error","code":"reception_not_found"}`。
- [ ] **AC2 セクション分離（確定事項1・AD-H063）**: `GET /api/monitoring/status` の 200 応答が、トップレベルに `operation` / `health` / `readiness` / `venues` / `information` / `tiles` の**6セクションをすべて持つ**。**これらを集約した単一のステータス値（`overallStatus` / `ok` / `healthy` 等の名前のトップレベル真偽値・単一列挙値）が応答に存在しない**ことを、応答のトップレベルキー集合が `['status','terminalId','requestedVenueId','serverGenerationId','generatedAt','operation','health','readiness','venues','information','tiles']` と**集合として完全一致**することで確認する。あわせて、**`processing` キーが稼働状態APIの応答に存在しない**こと（確定事項7）を明示的に検証する。
- [ ] **AC3 readiness が他を保証しないこと（AD-H063）**: 初期取得4フィードをすべて成功させ `initialFetchPhase='completed'`・全 feed `succeeded:true` にしたうえで、(a) 雨雲索引の snapshot を未保存にすると `information` の `kind='nowcast'` の `availability` が `'unavailable'` になり、`readiness` は `completed` のまま変わらない。(b) 6系列のうち `amedas_point` だけ連続失敗を仕込むと `health.sources` の当該要素が `'abnormal'`、`readiness` は `completed` のまま。(c) `readiness.feeds` は常に4要素（`regular` / `extra` / `regular_l` / `extra_l`）で、`phase='not_started'` のときは全要素 `succeeded: null`（`false` に丸められていない）。
- [ ] **AC4 タイルを健全性系列として返さないこと（確定事項4・AD-H001）**: (a) `health.sources` が**常に6要素**であり、`sourceId` の集合が `['xml_regular','xml_extra','nowcast_target_times','kikikuru_target_times','amedas_latest_time','amedas_point']` と完全一致する。`radar_tile` / `risk_tile_frame` がどこにも現れない。(b) `tiles` セクションに `status` / `health` / `freshness` といった判定を表すキーが**存在しない**（`tiles.layers[0]` のキー集合が `['layer','catalogAvailability','catalogUpdatedAt','availableFrameCount','upstreamFetchAllowed','nextUpstreamAllowedAt']` と完全一致）。(c) `tiles.healthMonitored === false` かつ `tiles.healthCriteriaStatus === 'undecided'`。(d) 失敗率・閾値を計算するコードが `apps/api/src/monitoring/` 配下に追加されていないことを `git diff` で確認する。
- [ ] **AC5 健全性の未評価を正常に丸めないこと**: `FetchHealthMonitorService` を一度も `runOnce()` させずに `GET /api/monitoring/status` を呼ぶと、`health.evaluatedAt === null`、`health.worstStatus === null`、`health.worstSourceIds` が空配列、`health.sources` が**6要素で各 `status === null`**（空配列でも `'normal'` でもない）。`runOnce()` を1回走らせた後に呼ぶと `health.evaluatedAt` が注入時刻と一致し、`health.thresholds` が `config/polling.yaml` の `fetchHealth` の各値と完全一致する。`health.sources` の `appliesElapsedCondition` が `amedas_point` だけ `false`、他5件は `true`。
- [ ] **AC6 処理できなかった電文の診断（確定事項2・7・8・AD-H040・AD-H045）**: **`GET /api/monitoring/processing` に対して**検証する。`adoption_result='未対応構造'` の受信を、`raw_body` に制御文字 `U+0000` と `U+0007` を含む 5000 文字の XML 文字列で1件、`raw_body` が `NULL` で1件、`adoption_result='対象地域外'` で1件仕込む。(a) `recentFailures` に**`'未対応構造'` の2件だけ**が現れ、`'対象地域外'` は現れない。(b) `byAdoptionResult` には `'対象地域外'` を含む**全区分の件数**が現れる。(c) 原文ありの要素の `excerpt.text` が **`EXCERPT_MAX_CHARS` 文字以内**、`excerpt.totalLength === 5000`、`excerpt.truncated === true`、`excerpt.text` に `U+0000` と `U+0007` が**含まれない**、`\n` は**含まれる**。(d) `raw_body` が `NULL` の要素は `excerpt === null` かつ `rawBodyBytes === null`。(e) `adoptionReason` が `'Control/Status が不正です'` の場合、`excerpt.anchor === 'reason_match'` で `excerpt.text` に `Control` の該当箇所が含まれる。`adoptionReason` が `null` の場合 `excerpt.anchor === 'head'` かつ `excerpt.startOffset === 0`。(f) `PROCESSING_FAILURE_SAMPLE_LIMIT + 1` 件以上仕込んでも `recentFailures` は `PROCESSING_FAILURE_SAMPLE_LIMIT` 件で止まり、`byAdoptionResult` の件数はそれを超える実件数を正しく示す。(g) `windowHours === PROCESSING_WINDOW_HOURS` であり、ウィンドウより古い受信が `recentFailures` にも `byAdoptionResult` にも現れない。(h) **上記3定数がテストコードへ数値直書きされておらず、`packages/shared` の定数を import して比較している**ことをコード上で確認する（確定事項8: 後続PRで値を調整できるようにするため）。
- [ ] **AC7 訓練データを既定で除外しないこと（確定事項3）**: (a) `control_status` が `'normal'` / `'training'` / `'test'` / `NULL` の受信を各1件仕込み、`GET /api/monitoring/receptions`（クエリ `limit` のみ）で**4件すべて**が返り `totalCount === 4`。`controlStatus=training` を指定したときだけ1件に絞られる。(b) `is_training` が `true` / `false` の通知出力を各1件仕込み、`GET /api/monitoring/notification-outputs`（フィルタなし）で**2件とも**返る。`isTraining=true` で1件、`isTraining=false` で1件。`isTraining=yes` は 400。(c) `apps/api/src/monitoring/monitoringHistoryService.ts` に `controlStatus` や `isTraining` の**既定値を設定する分岐が存在しない**ことをコード上で確認する。
- [ ] **AC8 一覧に原文を含めないこと（確定事項3）**: `raw_body` に `'<Report>SECRET_MARKER</Report>'` を保存した受信を仕込み、(a) `GET /api/monitoring/receptions` の応答 JSON 文字列全体に `SECRET_MARKER` が**現れない**、各要素に `rawBody` キーが**存在しない**、`hasRawBody === true` かつ `bodyBytes` が保存値と一致する。(b) `GET /api/monitoring/receptions/:id` では `reception.rawBody` が保存文字列と**完全一致**する（抜粋・サニタイズされていない）。(c) `GET /api/monitoring/notification-outputs` の各要素の `relatedRefsJson` / `targetAreaJson` が保存された文字列のまま返る（パース済みオブジェクトになっていない）。
- [ ] **AC9 検索上限（確定事項3）**: 300件の受信を仕込み、(a) `limit` 未指定で **100件**、`totalCount === 300`。(b) `limit=200` で **200件**。(c) `limit=201` / `limit=1000` / `limit=0` / `limit=-1` / `limit=1.5` / `limit=abc` がすべて 400 `invalid_request`（**200件へ黙って切り捨てられない**）。(d) `offset=250` で 50件が返り `totalCount === 300` のまま。(e) 同じ検証を `/api/monitoring/notification-outputs` と `/api/monitoring/operations` でも行う。
- [ ] **AC10 会場別・actor・operation の保持（確定事項6）**: (a) east と trc で `adoption_result` が異なる受信を仕込み、`venues` が**2要素**で、それぞれの `recentAdoptions` が会場ごとに異なる値を持つ（片方の非採用が他方に混ざらない）。受信履歴一覧の `adoptions` も2会場分が別要素で返る。**east 端末（`hkeagh01`）で呼んでも trc 端末（`htrcph01`）で呼んでも `venues` の `venueId` 集合が `['east','trc']` と完全一致し、`requestedVenueId` だけが端末に応じて変わる**（会場に絞り込まれていないこと）。`information` と `GET /api/monitoring/processing` の `byAdoptionResult` についても同様に、どちらの端末でも全会場分が返ることを確認する。(b) `operation_history` に `actor_id` が `NULL` の行と非 `NULL` の行を直接 INSERT し、`GET /api/monitoring/operations` がそれぞれ `null` と文字列を**そのまま**返す（`null` が `"不明"` 等に置換されない）。(c) E11 未実装の既定状態では `/api/monitoring/operations` が `{"status":"ready", ..., "totalCount":0, "items":[]}` を返し 500 にならない。
- [ ] **AC11 availability 3状態を縮退させないこと**: `information` の各要素について、`available` / `stale` / `unavailable` の**3値が実際に出し分けられる**ことを確認する。(a) snapshot なし → `'unavailable'`。(b) snapshot ありで保存 `availability` が `'available'`、かつ feed 鮮度が `'stale'` → `'stale'` かつ `issuedAt` / `fetchedAt` が**保持値のまま返る**（`null` に落ちない）。(c) 全条件を満たす → `'available'`。(d) `information` の要素に boolean の可用性フィールド（`isAvailable` 等）が存在しない。
- [ ] **AC12 副作用がないこと・上流へポーリングしないこと**: (a) 6ルートを各10回呼んだ前後で、`telegram_reception`・`telegram_reception_adoption`・`telegram_reception_area`・`notification_output_history`・`operation_history`・`terminal_session`・`startup_notification_inquiry` の**全行数と内容が完全一致で不変**である。(b) HTTP クライアント（`httpGet`）を呼び出し回数を数えるスタブに差し替え、6ルートを呼んだ前後で**呼び出し回数が0のまま**である（基本設計 §8.2「この画面から外部へ追加ポーリングしない」）。(c) `FetchHealthMonitorService.runOnce()` が API 呼び出しによって走らない（`getLastAggregate()` の戻り値が呼び出し前後で同一参照）。
- [ ] **AC13 HTTP実挙動と依存注入**: 実サーバーを `app.listen(0)` で起動し、(a) 6ルートすべてに `Cache-Control: no-store` と `Content-Type: application/json; charset=utf-8` が付く。(b) `POST /api/monitoring/status` と `POST /api/monitoring/processing` が 404/405 相当になる。(c) `dependencies.monitoringStatus` を渡さずに `createApp` すると `/api/monitoring/status` が 404 になり、`monitoringProcessing` を渡さなければ `/api/monitoring/processing` が 404、`monitoringHistory` を渡さなければ履歴3ルート＋詳細が 404 になる（**3つの依存が互いに独立して登録・非登録になる**こと）。(d) 既存の `/api/health`・`/api/weather/*`・`/api/notifications/*` が従来どおり動く。(e) `/api/monitoring/startup-inquiries` が**存在しない**（404。確定事項5）。
- [ ] **AC14 境界（作りすぎていないこと）**: 次のいずれも行っていないことを `git diff --stat` とコード検索で確認する。取得制御（開始・停止・強制更新）のエンドポイントや POST/PUT/DELETE の追加、新規 migration、既存テーブルへの列追加、Epic A〜D の processor・通知生成コードの変更、タイル健全性の閾値判定、アメダス地点の到達時間保証フィールド、履歴の自動削除・ローテーション、認証・認可、`apps/web` 配下の変更、**D5 起動監査（`startup_notification_inquiry`）を読み出すAPI・サービス・リポジトリ関数の追加（確定事項5）**。変更ファイルが §8.2 に挙げたものに限られる。
- [ ] **AC15 必須検証**: `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w packages/shared`、`npm run test -w apps/api`、`npm run test -w apps/web`、`npm run build` がすべて成功する。

### 9.1 red・対照実験

新規テスト完成前に、意味を変えないコメントだけの変更で対象テストが成功する対照実験を行う。その後、以下の変更を1つずつ入れて失敗（red）を確認し、都度戻す。

1. `status` 応答に `overallStatus: 'ok'` を追加する → **AC2 が失敗する**（トップレベルキー集合の完全一致が崩れる。確定事項1 の「単一の統合ステータスに丸めない」を守る回帰防止）
2. `health.sources` を未評価時に空配列にする → **AC5 が失敗する**
3. `health.worstStatus` の `null` を `'normal'` にフォールバックする → **AC5 が失敗する**（「判定待ち」を「正常」に丸めない）
4. 受信履歴一覧の SELECT に `t.raw_body` を追加して DTO に載せる → **AC8(a) が失敗する**（確定事項3）
5. 履歴サービスで `controlStatus` の既定値を `'normal'` にする → **AC7(a) が失敗する**（確定事項3）
6. `limit` 超過を 400 ではなく `Math.min(limit, 200)` で切り捨てる → **AC9(c) が失敗する**
7. `tiles` に失敗率から求めた `status` を追加する → **AC4(b) が失敗する**（確定事項4・AD-H001）
8. `excerpt` のサニタイズから制御文字除去を外す → **AC6(c) が失敗する**
9. `excerpt` に HTML エスケープを追加する → **AC6(c)/(e) が失敗する**（原文断片が原文と読めなくなる。§7.3 の方針）
10. `information` の `availability` を `available` 以外すべて `'unavailable'` に畳む → **AC11(b) が失敗する**（3状態の縮退禁止）
11. `GET /api/monitoring/status` の応答に `processing` セクションを戻す → **AC2 が失敗する**（確定事項7 の「5秒周期の応答に原文抜粋を載せない」を守る回帰防止）
12. `venues` を `requestedVenueId` の1会場だけに絞る → **AC10(a) が失敗する**（確定事項6）

---

## 10. 後続Issueへの引き継ぎ

- **K1 #74（監視画面レイアウト）**: 4カードは `operation`（取得運転・スケジュール）と `health`（取得健全性）の**別セクション**から組み立てる。`health.evaluatedAt === null` / `worstStatus === null` を「判定待ち」として表示し、緑の正常表示にしない（基本設計 §8.2 の「緑の正常表示だけを残さない」）。`generatedAt` を「最終表示更新時刻」の基準に使う。「未評価 null の扱い」「状態の文字表現」は K1 の着手前判断事項（issues-draft）であり、本設計は `null` を返すところまでを決めた。
- **K3 #76（受信履歴ダイアログ）**: 左ペインは `/api/monitoring/receptions`、右ペインは `/api/monitoring/receptions/:id` の `rawBody`。**原文はサーバー側でエスケープしていない**ため、K3 がテキストノードとして描画すること（`innerHTML` へ入れない）。ページングは `limit`（最大200）+ `offset`。「normal 既定」は**設けない**ことが確定した（確定事項3）ので、訓練データを含む全件が既定で返る前提で UI を作る。気象庁カナ形式への変換は K3 の着手前判断事項であり、本設計は原文を返すところまでしか提供しない。
- **K4 #77（通知出力履歴ダイアログ）**: `origin` と `detectionContext` は**独立した2軸**である。`relatedRefsJson` / `targetAreaJson` は文字列のまま返るため、パースと失敗時の表示は K4 が決める。**`startup_notification_inquiry`（D5 の起動監査）は E10 のスコープ外であることが確定した（確定事項5）。閲覧APIは本Issueで作らないため、K4 #77 が必要とするなら K4 の中でAPIごと設計・実装する**。AD-H012（監査の保持期限）のうち起動監査に関わる部分も K4 #77 が対応先である。
- **K5 #78（操作記録の表示）**: `actorId` / `actorDisplayName` は `null` のまま返る。E11 #43 が実装されるまで 0 件が正常である。
- **K6 #79（取得元別稼働状況テーブル）**: `health.sources` の6要素と `operation.scheduledSources` の4要素は**粒度が違う**（健全性は6系列、スケジューラは4ソース）。`health.sources[].sourceId` の `xml_regular` / `xml_extra` は、スケジューラ上は同じ `'xml'` である。この対応付けは K6 が行う。`health.thresholds` は表示のみに使い、画面側で判定し直さない（AD-H041）。**タイル健全性基準（AD-H001）とアメダス地点の検知遅れ（AD-H003）は本設計で決めていない** — `tiles.healthCriteriaStatus === 'undecided'` と `appliesElapsedCondition === false` が、その未決を画面へ運ぶ唯一の手段である。
- **K7 #80（情報別反映状況テーブル）**: `information` の `availability` 3状態と `operation` の `suspended` を**2軸で組み合わせて**「停止中の保存値」を表現する。単一の列挙値に畳まない（§4.2）。`GET /api/monitoring/processing` の `recentFailures[].excerpt` を表示する場合もテキストノードとして描画する。
- **K8 #81（現在の異常パネル）**: 「現在の異常」は、`GET /api/monitoring/status` の `health.sources` のうち `status` が `'delayed'` / `'abnormal'` の要素と、**`GET /api/monitoring/processing` の `recentFailures`** から画面側が組み立てる。**この2本は取得頻度が異なる**（確定事項7）: 稼働状態APIは 5 秒周期、診断APIはそれより低頻度（60秒周期、またはパネルを開いたときの都度取得）とし、**診断APIを 5 秒周期のポーリングに載せない**。具体的な周期は K8 が決めるが、原文抜粋を含む応答であることを前提に判断すること。サーバー側にレートリミットは無い。**同一問題の集約は通知生成単位とは別**であり（issues-draft K8）、本APIは集約済みの「異常一覧」を返さない。ブラウザ疎通異常（AD-H022）はサーバーからは検知できないため、K8 がクライアント側で判定する。
- **E11 #43（取得制御API）**: 本設計は読み取り専用であり、`operation_history` への書き込み経路を作らない。E11 が `recordOperationHistory` を呼ぶようになれば、`/api/monitoring/operations` は変更なしでその行を返す。要求識別子による結果再照会（AD-H064）は E11 が設計する。
- **L2 #84 / L3 #85 / K6 #79**: AD-H001（タイル健全性基準）・AD-H003（地点検知遅れ）・AD-H011（履歴容量）・AD-H012（監査の無期限保持）・AD-H039（通知保存失敗時の回復保証）・AD-H041（健全性評価の運用初期値）は**本設計で新規定義していない**。棚卸しの先送り承認（2026-09-13）のとおり、これらの結論は各先送り先で出す。本設計はそれらの未決を**隠さずに公開する**（`healthCriteriaStatus: 'undecided'`、`appliesElapsedCondition: false`、`thresholds` の現行値）ことまでを担う。

---

## 11. 残留リスク・実挙動未確認事項

- **実挙動未確認**: 設計時点で監視エンドポイントは存在しないため、次は**実挙動未確認**である。製造時に確認し、設計と矛盾した場合は勝手に方式を変えず統括担当へ報告すること。
  - Express 5 における `:id` パスパラメータの同名クエリキー重複時の `req.query` の値（配列化されるか）
  - 受信履歴 300 件の一覧（1件ごとに area / adoption を追加SELECTする N+1）の所要時間。§6.1 の `limit` 上限 200 はこの N+1 構造を根拠に決めたが、**実測していない**。実測して 200 でも遅い場合は、上限値の再検討ではなく**リポジトリ側の JOIN 化**を先に検討すべきであり、その場合は Epic A〜D の変更になるため統括担当へ戻すこと
  - `raw_body` が数 MiB 規模（AD-H011 の「VPWS50 4.36MiB」）のとき、`GET /api/monitoring/receptions/:id` の応答サイズと JSON シリアライズの所要時間
- **`excerpt` の `anchor='reason_match'` の的中率は未検証**: `adoptionReason` の自由文から要素名トークンを拾って原文を検索する方式（§7.3）は、`adoptionReason` の文面に依存する。§2.3-6 のとおり文面は一貫していないため、**多くのケースで `'head'` にフォールバックする可能性がある**。これは機能の欠損ではなく設計上の許容範囲（先頭は Control / Head 部であり構造不正の診断に有用）だが、K7 #80 の実運用で不足が判明した場合は、保存側（Epic A〜D）で理由コードと失敗位置を保存する変更が必要になる。その判断は本Issueの範囲外である。
- **`health` はプロセス再起動で失われる**: §2.3-1 のとおりメモリ保持である。再起動直後は `health.evaluatedAt === null` になり、評価周期（既定30秒）が経過するまで「判定待ち」が続く。これは AD-H041 の「最大1評価周期差」と同じ性質であり、本設計で解消しない。K1 #74 が「判定待ち」を適切に表示することに依存する。
- **原文抜粋のサイズ3値は実データ未検証のまま採用している（確定事項8）**: `EXCERPT_MAX_CHARS = 2000` / `PROCESSING_FAILURE_SAMPLE_LIMIT = 20` / `PROCESSING_WINDOW_HOURS = 24` は、実際の「未対応構造」電文で診断に足りるかを検証していない。統括担当の確認により提案値のまま進めることが確定しており、**不足・過大が運用で判明した場合は本設計の改訂ではなく後続PRでの定数調整で対応する**。§7.3 のとおり定数は `packages/shared` の1か所に置き、テストもその定数を参照する。
- **`processing` の集計は `telegram_reception` + `telegram_reception_adoption` の JOIN であり、行数増加に比例して重くなる**: 24時間ウィンドウで区切っているが、AD-H011 のとおり自動削除がないため、長期運転では `telegram_reception` 自体が大きくなる。`received_at` にインデックスがあるかを製造時に `PRAGMA index_list('telegram_reception')` で確認し、なければ**インデックス追加は行わず**（migration 追加は §1.2 で対象外）、実測結果を統括担当へ報告すること。
- **`information` セクションが既存 API サービスに依存する**: `WeatherApiService` 等の `getXxx` を内部で呼ぶため、それらの実装変更が監視APIの応答に波及する。逆に言えば「監視画面が見る反映状態」と「気象画面が見る反映状態」が**同じ判定から出る**ことを保証している。これは意図した設計であり、`evaluateWeatherAvailability` を監視側で再実装しないことがその条件である。
- **`venues` の `recentAdoptions` は「直近24時間の採用判定」であり、「現在の警報の採用状態」ではない**: C16 #114 の会場別採用履歴は受信単位の記録であり、現況のスナップショットではない。K1 #74 / K7 #80 が現況を表示したい場合は `information` を使うこと。混同すると「24時間新着がない＝異常」と誤読されうる（基本設計 §8.2 の「新着がないことを障害と扱わない」に反する）。
- **参照した実装はコミット `1f92233` 時点のものである。** 製造開始までに `main` へ追加変更が入った場合は、§2.3 の事実と差分がないか再確認すること。

---

## 12. 要ヒアリング事項

初版設計で挙げた4件は、統括担当がユーザーへ確認して**すべて確定した**（§2.2 の確定事項5〜8）。本改訂で設計書へ反映済みであり、**未確定として残っている論点はない**。

| # | 初版の論点 | 確定結果 | 反映箇所 |
| --- | --- | --- | --- |
| 1 | D5 起動監査（`startup_notification_inquiry`）を履歴APIの対象に含めるか | **含めない。`GET /api/monitoring/startup-inquiries` を用意せず、K4 #77 へ先送りする**（AD-H012 の対応先の一方） | §1.2、§8.3、§9 AC13(e)・AC14、§10 K4 |
| 2 | 稼働状態APIに会場別セクションを全会場分含めてよいか | **全会場（east・trc）分を含める。特定の会場端末に絞らない。気象系APIが会場に絞る境界とは異なる基準であることを明記する** | §5.1、§9 AC10(a)、§9.1 red-12 |
| 3 | `processing` を稼働状態APIに含めるか、独立エンドポイントにするか | **別エンドポイント `GET /api/monitoring/processing` に分離する**（稼働状態APIは5秒周期ポーリング想定のため、毎回原文抜粋を転送しない）。パス命名は設計担当の判断で `/api/monitoring/` 配下に統一 | §1.1、§3、§5.1、§5.3、§7、§8、§9 AC2・AC6・AC13、§10 K7・K8 |
| 4 | 原文抜粋の最大文字数 2000 で足りるか | **提案値のまま進める（2000文字・サンプル20件・24時間ウィンドウ）。実データでの妥当性は未検証のままでよく、必要なら後続PRで調整する** | §7.3、§11 |

**設計担当からの残りの申し送り**: 上記以外に、本改訂の過程で新たに発生した要ヒアリング事項は**ない**。製造は本設計の承認後に別フェーズとして開始する。
