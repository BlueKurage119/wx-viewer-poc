# Issue #31 D7. 装置異常系（取得遅延・異常）の通知判定ロジック 設計

対象ブランチ: `feature/issue-31-equipment-anomaly-notification`
参照する基本設計: [basic-design.md](../basic-design.md) §8.1 / §8.3 / §8.4（および §7.3 / §7.5 / §7.6）

## 1. 目的とスコープ

### 1.1 やること

- 取得元ごとに「最終試行時刻・最終成功時刻・連続失敗回数」を求め、§8.1 の閾値表（正常／遅延／異常）で判定する統一ロジックを新規に実装する。**この判定ロジック自体が本 Issue のスコープに含まれる**（統括担当ヒアリング確定事項 1）。
- 判定対象は 6 取得元（XML 定時フィード・XML 随時フィード・雨雲時刻一覧・キキクル時刻一覧・アメダス（時刻）・アメダス（地点）。確定事項 2・確定事項 5）。
- **取得元ごとに独立した状態機械を持ち、取得元ごとに通知を生成する**（確定事項 6・§8.4【確定】）。区分は「遅延 → 警報（`warning`）」「異常 → 問いかけ（`question`）」（§8.4 トリガー対応表）。複数取得元が同時に問題化すれば、その数だけ通知が出る。
- 取得元ごとの状態の悪化（遅延→異常）・回復（異常→遅延）・正常復帰（遅延/異常→正常）を状態変化として扱い、§7.5 と同じ考え方で通知する（確定事項 3）。
- 監視画面（E 系）が読む**表示専用**の集約オブジェクト（取得元別結果の一覧＋最悪値）を併せて公開する。**これは通知の生成単位ではない**（§4.4）。
- 生成した通知を `notification_output_history` に記録する（D4 の永続化パターンを踏襲）。
- 閾値の数値を設定ファイル（`config/polling.yaml`）で変更可能にする（§8.1【確定】）。

### 1.2 やらないこと

- **非常ブザー相当（`emergency`）の生成**。§8.4 で「今回は設けない」と確定済み。区分は `warning` / `question` の 2 値のみ。
- **タイル画像本体（雨雲・キキクルの画像、`radar_tile` / `risk_tile_frame`）の取得成否判定**。§8.1 で「オンデマンド取得のため周期ベースの判定になじまない。別基準を設ける案」と明記された未確定事項であり、確定事項 2 のとおり対象外（§4.2 の除外表に理由を明記する）。
- **H 端末相当モードでの表示除外（§8.4 後段）**。表示段階のフィルタリングであり、フロント側または配信 API のクエリ側が所有する。
- **通知の配信・push・HTTP エンドポイントの追加**。D5（#29）および E 系（監視画面）の責務。本 Issue は「判定して履歴に記録する」までを担う。
- **取得操作（開始/停止/強制更新）や DB 初期化に対応するシステム通知**（`system-fetch-manually-*` 等、#103 が定義済みの他 8 種）。E 系の責務。
- **監視画面の「取得元別状態」テーブル・「現在の異常」カードの UI 実装**。本 Issue は E 系がそのまま読める形の評価結果オブジェクトを公開するところまで。
- **既存ポーリング各サービス（`jmaXmlPoller` / `nowcastService` / `kikikuruService` / `amedasFetchService`）のロジック変更**。§3.2 の理由により 1 行も変更しない。

## 2. 参照資料と、そこから導いた判断

### 2.1 参照資料

| 資料 | 参照個所 | 導いた判断 |
|---|---|---|
| [basic-design.md](../basic-design.md) §8.1 | 遅延・異常判定基準【設計案・未確定】の閾値表、「新着ではなく取得試行の成否を基準とする」【確定】、「取得元ごとに最終試行・最終成功・連続失敗を保持し独立に判定」、「全体状態カードの取得健全性は取得元ごとの判定の最悪値に従って集約する」、「意図的な停止・スケジュール停止は判定から除外し停止中として区別する」、「数値は設定ファイルで変更可能・画面上の設定 UI は設けない」【確定】 | §4.1 の閾値関数、§4.3 の `suspended` 状態、§4.4 の**表示用**集約（「最悪値に従って集約する」は全体状態カードの表示についての規定であり、通知の単位ではないと読む）、§4.7 の設定 |
| 同 §8.3 | 時間帯別の取得周期表（XML 60/120/300 秒、画像索引・アメダス 60/300 秒・夜間停止） | 「適用周期×3」の周期取得元を `getIntervalSecondsForSource` に委ねる判断（§4.1） |
| 同 §8.4【確定】 | トリガー対応表、悪化・回復の状態変化扱い、**「複数の取得元が同時に問題を抱える場合、取得元ごとに個別に通知する（1 件に集約しない）。例えば 5 取得元すべてが異常化すれば問いかけが 5 件発生する。どの取得元が原因かは通知本文および監視画面本体（8.1・8.2 の表）で確認する。（Issue #31 実装時に確定変更。旧方針は「最も高い区分で 1 件だけ通知」だったが、取得元ごとの個別把握を優先する運用判断により変更した）」**、非常ブザーを設けない、origin 等で気象系と区別する | §4.4（通知単位＝取得元）、§4.5 の取得元単位の遷移表、§4.6 の通知フィールド |
| 同 §7.5【確定】 | 「解除は通知区分 警報で知らせる」 | 正常復帰を `warning` とする（確定事項 3 の根拠） |
| 同 §7.6【確定】 | 「初期取得・復旧時に検知した既発表も新規発見として通知する」「初期取得済みの判定はプロセス起動単位でリセットする」 | §4.5 の「前回値なし（プロセス起動直後）」行と `detectionContext: 'initial'` |
| [docs/design/issue-28-...md](issue-28-warning-notification-generation-rules.md) | planner（純粋関数、`{notifications, skipped}`）／emitter（永続化）／tracker（プロセス内状態）の 3 層構成、AC の書き方 | §3.1 のモジュール構成と §7 の受け入れ条件 |
| [docs/design/issue-103-...md](issue-103-notification-message-definitions.md) §「D7・取得／操作／初期化の各実装」 | 「`system-data-fetch-delayed` / `system-data-fetch-failed` を D7 が選ぶ」「『データ取得復旧』が必要になった場合は、**ユーザー確認後に**新規 ID と版 1 の定義を追加する」 | §4.6 の定義 ID 選択と、§9 のヒアリング事項 H1 |
| [docs/data-acquisition-report.md](../data-acquisition-report.md) | 取得元の一覧と取得方式 | 取得元 ID の命名（§4.2） |

本 Issue は**気象庁 XML 電文の内容を一切解釈しない**（取得試行の成否だけを見る）。したがって電文仕様・コード値の照合を必要とする設計判断は含まれない。

### 2.2 実物調査で確かめた事実（設計の根拠）

以下はすべて現在のコードを読んで確認した事実である。

1. **判定対象 6 取得元の「連続失敗回数・最終成功時刻」を統一的に持つ場所は存在しない。**
   - `apps/api/src/polling/retryBackoff.ts` の `FeedBackoffManager` は XML フィード 4 種について `consecutiveFailures` / `lastAttemptAt` / `lastSuccessAt` / `lastFailureAt` / `nextAllowedFetchAt` をプロセス内に保持する。
   - `apps/api/src/polling/amedasFetchService.ts` の `AmedasFetchState` は `latestTime` / `pointData` の 2 系統について `{lastSuccessAt, consecutiveFailures}` のみ保持する（`lastAttemptAt` を持たない）。
   - **`nowcastService.ts` / `kikikuruService.ts` は連続失敗回数を一切保持していない。** 保持しているのは DB スナップショットの `metadata.lastSuccessAt` と `availability`（`available` / `stale` / `unavailable`）だけである（`nowcastService.ts` の失敗時分岐、`kikikuruService.ts` の同等個所）。
   - `TimeBasedPollingScheduler` は `nextRunAtMap` / `sourceStates` / `lastCompletedAtMap` を持つが、成否は持たない。
   → **既存の内部状態を横断的に読む方式は成立しない**（雨雲・キキクルの連続失敗を作り出せない）。
2. **`fetch_attempt` テーブルが全取得元の試行を同一スキーマで記録している。** `recordFetchAttempt` の呼び出し個所は `jmaXmlPoller.ts`（フィード・文書）、`nowcastService.ts`（索引・タイル）、`kikikuruService.ts`（索引・タイル）、`amedasFetchService.ts`（最新時刻・地点）であり、**成功・失敗の両方を必ず 1 行記録する**（各サービスで `outcome` を確定させたうえで単一の `recordFetchAttempt` を呼ぶ構造）。`source_kind` の実値は `xml_feed_regular` / `xml_feed_extra` / `xml_feed_regular_long` / `xml_feed_extra_long` / `xml_document` / `radar_times_N1` / `radar_times_N2` / `radar_tile` / `risk_target_times` / `risk_tile_frame` / `amedas_latest_time` / `amedas_point`。
3. **`fetch_attempt` に必要な索引が既にある。** `apps/api/migrations/0009_create_fetch_attempt.sql` に `idx_fetch_attempt_source ON fetch_attempt (source_kind, started_at DESC)`。→ **マイグレーション追加は不要**。
4. **`started_at` の文字列形式はミリ秒が任意である。** `apps/api/src/repositories/snapshot.ts` の `UTC_ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/`。同一秒内で `...:00.500Z` と `...:00Z` が混在すると辞書順比較が実時刻順と一致しない（`.` < `Z`）。本番コードは `toISOString()` 由来でミリ秒付きだが、テストの固定クロックはミリ秒無しになりうる。→ **SQL の辞書順比較だけに依存しない**（§4.2 の「窓を取って JS 側で `Date.parse` 比較」方式）。
5. **`TimeBasedPollingScheduler.getStatus(): TimeBasedPollingStatus`** が `sources[source].state` として `'waiting' | 'running' | 'scheduled_stopped'` を返し、`!this.isRunning`（手動停止）でも `intervalSeconds === null`（スケジュール停止）でも `'scheduled_stopped'` になる。→ §8.1 の「停止中の除外」はこの 1 箇所を唯一の権威として実装できる（§4.3）。
6. **`getIntervalSecondsForSource(period, source)`** が「その時間帯の適用周期」を返す既存の関数である（xml→`xmlSeconds`、nowcast/kikikuru→`imageCatalogSeconds`、amedas→`amedasSeconds`、停止時 `null`）。→ 「適用周期×3」はこれを再利用する（§4.1）。
7. **`config/polling.yaml` の検証は未知のルートキーを拒否し、既定値フォールバックを行わない。** `apps/api/src/config/pollingSchedule.ts` の `EXPECTED_ROOT_KEYS`（`timezone` / `amedasPointRecheckSeconds` / `freshness` / `periods`）に対し、未知キーは `未知のルート設定キーです`、不足キーは `必須ルート設定キーが不足しています` でエラーになる。`PollingScheduleConfig` をインラインで組み立てているのは `apps/api/tests/timeBasedPollingScheduler.test.ts` と `apps/api/tests/pollingScheduleLoader.test.ts` の 2 ファイルのみ。→ §4.7 で必須ルートキーを 1 つ追加する（改修コストが小さいことを確認済み）。
8. **`system-data-fetch-delayed`（`warning` / 表示題名「データ取得遅延」/ 操作なし）と `system-data-fetch-failed`（`question` / 「データ取得異常」/ 確認操作あり）が `packages/shared/src/notificationMessageDefinitions.ts` に既に存在する。** 一方、**復帰に対応する定義は存在しない**（システム通知は 10 種で、残りは DB 初期化・サービス停止・運転モード・手動操作・強制更新に対応するもの）。`resolveNotificationMessage` は `origin` と `allowedCategories` の不一致を `notification_mismatch` で例外にするため、復帰通知に `system-data-fetch-delayed` を流用すると題名が「データ取得遅延」になる。→ §4.6 と §9 H1。
9. **`SystemNotificationChangeType = string`（任意文字列）は D1 が意図的に開いた契約であり、型テストがそれを固定している。** `packages/shared/src/notification.typecheck.ts` に「`systemNotif` は任意の文字列 `changeType` を許容する」というアサーション（`changeType: 'device_offline'`）があり、`apps/api/tests/notificationOutputHistoryMapper.test.ts` 等の fixture も任意文字列を使う。→ **shared 側の型を union に狭めない**（§4.6 と §9 H2）。
10. **`amedas_point` は「スキップされた周期には `fetch_attempt` 行が 1 行も残らない」うえ、`amedasPointRecheckSeconds`（既定 600 秒）ごとに必ず試行される。**
    - `apps/api/src/polling/amedasFetchService.ts` の `pointFetchPolicy === 'onLatestTimeChange' && !latestTimeChanged` の分岐は `skipReason: 'latest_time_unchanged'` / `attempted: false` / `fetchAttemptId: null` で早期 return しており、**`recordFetchAttempt` を呼ばない**。したがってスキップは「成功でも失敗でもない」ものとして健全性判定から自然に消える（連続失敗回数を薄めない）。
    - `apps/api/src/polling/timeBasedPollingScheduler.ts` の `AmedasScheduledAdapter.runScheduled()` は `isRecheckDue`（前回の地点取得開始から `recheckIntervalMs` 経過）のとき `pointFetchPolicy = 'always'` にする。`config/polling.yaml` の `amedasPointRecheckSeconds: 600`。→ **最新時刻が長時間変わらなくても、地点取得は最大 10 分に 1 回は必ず試行される**。
    - 一方、試行間隔が最悪 10 分になりうるため、**`amedas_point` に「最終成功から適用周期×3」「固定 10 分」の経過時間条件を適用すると、正常稼働中でも遅延・異常と誤判定する**。確定事項 5 が経過時間条件を外す根拠はこれである（§4.1）。
    - 帰結として `amedas_point` が「異常」（連続失敗 5 回）に達するまで最悪 50 分かかりうる。これは意図した挙動である（§10 に残留リスクとして記載）。
11. **`toNotificationOutputHistoryInput` → `recordNotificationOutputHistory` の 1 トランザクションという永続化パターンが `warningNotificationEmitter.ts` に確立している。** `NotificationOutputHistoryInput.origin` は `'system'` を受け付ける（`apps/api/tests/notificationOutputHistoryRepository.test.ts` に `origin: 'system'` の実例あり）。→ §4.8 でそのまま踏襲する。

### 2.3 統括担当から渡されたヒアリング確定事項の反映

| 確定事項 | 反映先 |
|---|---|
| 1. §8.1 の遅延・異常判定ロジック自体を D7 のスコープに含める | §4.1（閾値関数）・§4.2（入力の作り方）・§4.7（設定） |
| 2. 対象取得元は周期取得される取得元。タイル画像本体は対象外 | §4.2 の取得元定義表と除外表 |
| 3. 正常復帰（遅延→正常・異常→正常）も状態変化として `warning` で通知する。正常→遅延・正常→異常は §8.4 のトリガー対応表がそのまま適用される | §4.5 の遷移表（`fetch_recovered` 行）、§4.6 の定義 ID |
| 4. D5（#29）が並行実装中。型変更の理由を明記しマージ時に追えるようにする | §6（D5 との関係） |
| 5.（2 回目のヒアリング・H4 への回答）アメダス「地点データ」（`amedas_point`）も判定対象に含める。ただし**経過時間条件は適用せず、連続失敗回数条件だけで判定する**。取得元は「アメダス（時刻）」と「アメダス（地点）」の 2 つに分離する | §4.1 の条件適用表、§4.2 の取得元定義表（除外表から `amedas_point` を削除）、§4.7、AC7 |
| 6.（2 回目のヒアリング・H3 への回答）**通知は取得元ごとに個別に出す**（1 件に集約しない）。5 取得元が同時に異常化すれば問いかけが 5 件出る。基本設計 §8.4 は統括担当がユーザー承認のもとで既に訂正済み | §1.1、§4.4、§4.5、§4.6、§4.8、AC3・AC4 |
| 7.（2 回目のヒアリング・H1/H2/H5 への回答）復帰メッセージ定義の新規追加は承認。`SystemNotificationChangeType` は `string` のまま。停止遷移で復帰通知を出さない方針は承認。往復抑制は入れない | §4.5、§4.6、§6、§9 |

## 3. 全体構成

### 3.1 レイヤー構成

D4（#28）で確立した「収集 → 純粋判定 → 永続化 → 配線」の 4 層をそのまま踏襲する。

```text
[1] 収集層（DB クエリ）
    fetchAttemptRepository.summarizeFetchStreamHealth()
      … source_kind 単位に lastAttemptAt / lastSuccessAt / consecutiveFailures を返す

[2] 判定層（純粋関数・副作用なし・例外を投げない）
    monitoring/fetchHealthSources.ts    … 取得元 6 種の定義と source_kind 対応表
    monitoring/fetchHealthEvaluator.ts  … §8.1 の閾値計算（取得元単位）＋表示用集約（最悪値）

[3] 通知計画層（純粋関数）
    notifications/fetchHealthNotificationPlanner.ts
      … 取得元ごとに前回状態と今回状態の差を見て Notification + 出力スナップショットを
        0〜6 件（取得元数ぶんまで）作る

[4] 永続化・配線層（副作用あり）
    monitoring/fetchHealthStateStore.ts       … プロセス内の取得元ごとの前回値保持（非永続）
    notifications/fetchHealthNotificationEmitter.ts … 履歴記録
    monitoring/fetchHealthMonitorService.ts   … 周期評価タイマーと上記の結線
    server.ts                                  … 起動・停止への配線
```

**判定を周期タイマーで駆動する理由**: §8.1 の閾値には「最終成功時刻が適用周期×3 を超えて更新されていない」「固定 10 分を超えて更新されていない」という**時間経過だけで成立する条件**が含まれる。取得試行のイベント駆動だけでは、取得が完全に止まった（＝試行そのものが発生しない）ケースを検知できない。したがって評価は一定周期のタイマーで回す。

### 3.2 既存ポーリングサービスを変更しない方式を採る理由

「各サービスに健全性記録の呼び出しを足す」方式（案 A）と「`fetch_attempt` から導出する」方式（案 B）を比較し、**案 B を採用する**。

| | 案 A: 各サービスに `recordOutcome()` を追加 | 案 B: `fetch_attempt` から導出（採用） |
|---|---|---|
| 変更範囲 | `jmaXmlPoller` / `nowcastService` / `kikikuruService` / `amedasFetchService` の 4 ファイル（成否確定個所すべて） | ポーリング層は 0 ファイル変更 |
| 雨雲・キキクル・アメダス地点の連続失敗 | 新規に作れる | 既に DB にある（§2.2-2、§2.2-10） |
| プロセス再起動 | 状態が消える（再起動直後は必ず「正常」から始まる＝継続中の異常を見落とす） | `fetch_attempt` から復元できる（§4.3 の初期状態） |
| 並行実装（D5）との競合 | ポーリング層に触るため競合しうる | 新規ファイル中心で競合しにくい |
| コスト | 実装は素直 | 取得元ごとに索引付き 1 クエリ（§4.2）。評価周期は 30 秒既定なので無視できる |

案 B の副作用として、**`fetch_attempt` に記録されない取得は健全性判定に現れない**。これは §8.1 の「新着の有無ではなく取得試行の成否を基準とする」【確定】と整合する（試行していないものは成否を問えない）。バックオフ待機中で試行がスキップされた期間は、直前までの連続失敗回数と最終成功時刻の経過時間によって判定される。

### 3.3 新規・変更ファイル

```text
apps/api/src/monitoring/                        ← 新規ディレクトリ
├── fetchHealthSources.ts        新規  取得元定義・source_kind 対応表
├── fetchHealthConfig.ts         新規  閾値設定の型と検証（loader は既存 YAML に相乗り）
├── fetchHealthEvaluator.ts      新規  §8.1 閾値計算＋表示用集約（純粋関数）
├── fetchHealthStateStore.ts     新規  取得元ごとの前回状態・activeSinceAt の保持（プロセス内）
├── fetchHealthMonitorService.ts 新規  周期評価タイマー・結線
└── index.ts                     新規  バレル

apps/api/src/notifications/
├── fetchHealthNotificationPlanner.ts  新規  遷移 → Notification（純粋関数）
├── fetchHealthNotificationEmitter.ts  新規  履歴記録
└── index.ts                           変更  上記 2 つを追記（1 行 × 2）

apps/api/src/repositories/
└── fetchAttemptRepository.ts    変更  summarizeFetchStreamHealth() を追加（既存関数は変更しない）

apps/api/src/config/
├── pollingSchedule.ts           変更  PollingScheduleConfig に fetchHealth を追加＋検証
└── index.ts                     変更  必要なら再 export

config/polling.yaml              変更  fetchHealth セクションを追加

apps/api/src/server.ts           変更  FetchHealthMonitorService の生成・start・stop

packages/shared/src/notificationMessageDefinitions.ts
                                 変更  system-data-fetch-recovered を追加（§9 H1 で承認済み）

apps/api/tests/
├── fetchHealthEvaluator.test.ts          新規
├── fetchHealthNotificationPlanner.test.ts 新規
├── fetchHealthMonitorService.test.ts     新規（DB あり・タイマー注入）
├── fetchAttemptRepository.test.ts        変更（summarize のケース追加。既存ファイルがあれば追記）
├── timeBasedPollingScheduler.test.ts     変更（インライン設定に fetchHealth を追加）
└── pollingScheduleLoader.test.ts         変更（同上・未知キー/欠落キーのケース追加）

packages/shared/tests/notificationMessageDefinitions.test.ts
                                 変更  復帰定義のケース追加（§9 H1 で承認済み）
```

**マイグレーションは追加しない**（§2.2-3）。

## 4. 設計詳細

### 4.1 §8.1 の閾値計算

§8.1 の表をそのまま実装する。判定は取得元の各 `source_kind`（＝ストリーム）単位で行い、取得元の状態はそのストリーム群の最悪値とする（§4.2 で雨雲が 2 ストリームになるため）。

| 状態 | 判定条件（§8.1 の表） | 実装 |
|---|---|---|
| 正常 | 直近の取得試行が成功、または再試行待ちだが連続失敗 1 回以内 | 下記いずれにも該当しない |
| 遅延 | 連続失敗 2 回以上、**または**最終成功時刻がその時間帯の適用周期×3 を超えて更新されていない | `consecutiveFailures >= delayedConsecutiveFailures` または `elapsedSeconds > intervalSeconds * delayedIntervalMultiplier` |
| 異常 | 連続失敗 5 回以上、**または**最終成功時刻が固定 10 分を超えて更新されていない | `consecutiveFailures >= abnormalConsecutiveFailures` または `elapsedSeconds > abnormalElapsedSeconds` |

異常条件を先に判定し、該当しなければ遅延条件を判定する（異常 ⊃ 遅延 の包含関係を前提にしない）。

**経過時間条件の適用可否（確定事項 5）**: 取得元定義に `appliesElapsedCondition: boolean` を持たせ、`false` の取得元では経過時間条件（周期×3 と固定 10 分）を**評価しない**。連続失敗回数条件だけで判定する。

| 取得元 | 連続失敗回数条件 | 経過時間条件 | 理由 |
|---|---|---|---|
| `xml_regular` / `xml_extra` / `nowcast_target_times` / `kikikuru_target_times` / `amedas_latest_time` | 適用 | 適用 | 時間帯ごとの周期で無条件に試行される（§8.3） |
| `amedas_point` | 適用 | **適用しない** | 条件付き取得（最新時刻が変わったとき、または `amedasPointRecheckSeconds` ごと）であり、試行間隔が最悪 10 分になる。経過時間条件を当てると正常稼働中に誤検知する（§2.2-10） |

この分岐は取得元定義のフラグ 1 つで表現し、取得元 id による `if` 文を評価器の中に書かない（取得元が増えたときに条件が散らばるのを防ぐ）。

```ts
// apps/api/src/monitoring/fetchHealthEvaluator.ts

import type { FreshnessStatus, UtcIso8601String } from '@wx-viewer-poc/shared';

/** §8.1 の「正常/遅延/異常」＋「停止中」。語彙は shared の FreshnessStatus を再利用する。 */
export type FetchHealthStatus = FreshnessStatus | 'suspended';

/** 判定理由。監視画面（E 系）と通知本文の detail に使う。 */
export type FetchHealthReasonKind =
  | 'consecutive_failures'   // 連続失敗回数による
  | 'last_success_elapsed';  // 最終成功からの経過時間による

export interface FetchHealthReason {
  readonly kind: FetchHealthReasonKind;
  readonly status: 'delayed' | 'abnormal';
  readonly sourceKind: string;
  /** 通知本文へ載せる 1 行テキスト（改行を含めない）。例: '連続5回失敗' / '最終成功から11分経過' */
  readonly text: string;
}

/** 収集層が返す 1 ストリーム分の実測値。 */
export interface FetchStreamHealthSummary {
  readonly sourceKind: string;
  readonly lastAttemptAt: UtcIso8601String | null;
  readonly lastSuccessAt: UtcIso8601String | null;
  readonly consecutiveFailures: number;
  /** 走査窓（maxScanAttempts）を埋め尽くしたため実数がこれ以上ありうる場合 true。 */
  readonly consecutiveFailuresCapped: boolean;
}

export interface EvaluateFetchSourceInput {
  readonly sourceId: MonitoredFetchSourceId;
  readonly now: UtcIso8601String;
  /** 取得停止中（手動停止・スケジュール停止）か。true なら閾値判定を行わない。 */
  readonly suspended: boolean;
  /** その時間帯の適用周期。suspended のとき null。 */
  readonly intervalSeconds: number | null;
  /** 経過時間条件（周期×3・固定10分）を適用するか。false なら連続失敗回数条件だけで判定する（§4.1）。 */
  readonly appliesElapsedCondition: boolean;
  /** この取得元が「最後に稼働状態へ入った時刻」。経過時間判定の下限に使う（§4.3）。 */
  readonly activeSinceAt: UtcIso8601String;
  readonly streams: readonly FetchStreamHealthSummary[];
}

export interface FetchSourceHealthResult {
  readonly sourceId: MonitoredFetchSourceId;
  readonly status: FetchHealthStatus;
  readonly reasons: readonly FetchHealthReason[];
  readonly lastAttemptAt: UtcIso8601String | null;
  readonly lastSuccessAt: UtcIso8601String | null;
  readonly maxConsecutiveFailures: number;
  readonly intervalSeconds: number | null;
}

export function evaluateFetchSourceHealth(
  input: EvaluateFetchSourceInput,
  config: FetchHealthConfig,
): FetchSourceHealthResult;
```

**経過時間の基準時刻**:

```text
baselineAt   = max(lastSuccessAt ?? 0, activeSinceAt)
elapsedSec   = (now - baselineAt) / 1000
```

`lastSuccessAt` が `null`（成功実績なし）でも `activeSinceAt` があるため必ず計算できる。稼働再開直後は `elapsedSec ≈ 0` となり、**スケジュール停止から復帰した瞬間に「10 分超過」で異常と誤判定することがない**。この `max` を取らないと、夜間停止明け（20:00〜翌 4:00 の 8 時間）に必ず異常が発火する。実装時にこの 1 行を落とさないこと（§7 AC5 で検証する）。

`appliesElapsedCondition === false` の取得元では上記 `elapsedSec` を一切計算せず、`reasons` に `kind: 'last_success_elapsed'` が入ることもない。

`suspended === true` のときは閾値計算を行わず `status: 'suspended'`、`reasons: []` を返す。

### 4.2 取得元の統一状態モデル

```ts
// apps/api/src/monitoring/fetchHealthSources.ts

import type { ScheduledSource } from '../config/pollingSchedule.js';

export type MonitoredFetchSourceId =
  | 'xml_regular'
  | 'xml_extra'
  | 'nowcast_target_times'
  | 'kikikuru_target_times'
  | 'amedas_latest_time'
  | 'amedas_point';

export interface MonitoredFetchSourceDefinition {
  readonly id: MonitoredFetchSourceId;
  /** 通知本文・監視画面に出す日本語名。 */
  readonly displayName: string;
  /** fetch_attempt.source_kind の集合。1 取得元が複数ストリームを持つ場合がある。 */
  readonly sourceKinds: readonly [string, ...string[]];
  /** 適用周期と停止状態の参照先（scheduler の status キー）。 */
  readonly scheduledSource: ScheduledSource;
  /** 経過時間条件（周期×3・固定10分）を適用するか。§4.1 の表を参照。 */
  readonly appliesElapsedCondition: boolean;
}

/** 通知・表示用集約での並び順を固定する（表示のぶれと通知順の非決定性を防ぐ）。 */
export const MONITORED_FETCH_SOURCES: readonly MonitoredFetchSourceDefinition[] = [ /* 下表 */ ];
```

| `id` | `displayName` | `sourceKinds` | `scheduledSource` | `appliesElapsedCondition` | 根拠 |
|---|---|---|---|---|---|
| `xml_regular` | XML 定時フィード | `xml_feed_regular` | `xml` | `true` | §8.1 の取得元一覧「XML 定時」 |
| `xml_extra` | XML 随時フィード | `xml_feed_extra` | `xml` | `true` | 同「XML 随時」 |
| `nowcast_target_times` | 雨雲時刻一覧 | `radar_times_N1`, `radar_times_N2` | `nowcast` | `true` | 同「雨雲時刻一覧」。実装が N1/N2 の 2 リクエストに分かれている（§2.2-2） |
| `kikikuru_target_times` | キキクル時刻一覧 | `risk_target_times` | `kikikuru` | `true` | 同「キキクル時刻一覧」 |
| `amedas_latest_time` | アメダス（時刻） | `amedas_latest_time` | `amedas` | `true` | 同「アメダス」。§8.3 の周期で無条件に取得される部分 |
| `amedas_point` | アメダス（地点） | `amedas_point` | `amedas` | **`false`** | 確定事項 5。条件付き取得のため経過時間条件を適用せず、連続失敗回数条件（遅延 2 回・異常 5 回）だけで判定する（§2.2-10・§4.1） |

`displayName` は通知本文の宛先名（`targets[].name`）と監視画面の行見出しに使う。アメダスを「（時刻）」「（地点）」の 2 行に分けるのは確定事項 5 による。**この 2 つは別々の状態機械を持ち、別々に通知される**（例: 時刻取得は正常で地点取得だけが異常なら、「アメダス（地点）」の通知だけが 1 件出る）。

**判定対象から除外する `source_kind`（除外理由を必ずコメントに残す）**:

| `source_kind` | 除外理由 |
|---|---|
| `xml_feed_regular_long`, `xml_feed_extra_long` | 長期フィード。`getFeedDefinitionsForTrigger` で `initial` / `recovery` 時のみ取得される（`role: 'long_term'`）。周期取得されないため「適用周期×3」も「10 分」も意味を持たず、常に異常と判定されてしまう |
| `xml_document` | 個別電文の取得。フィードの新着に応じて発生するオンデマンド取得であり周期を持たない。文書取得の失敗は §8.1 の「処理状態（構造不正・未対応形式等のエラー）」領域の話題 |
| `radar_tile`, `risk_tile_frame` | タイル画像本体。§8.1 が「オンデマンド取得のため周期ベースの判定になじまない。直近数分間の失敗率など別基準を設ける案」とした**未確定**事項。確定事項 2 により対象外 |

（`amedas_point` は当初除外案だったが、確定事項 5 により**対象に含める**。除外表に残さない。）

**収集層のクエリ**（`fetchAttemptRepository.ts` に追加。既存関数は変更しない）:

```ts
export function summarizeFetchStreamHealth(
  connection: DatabaseConnection,
  sourceKind: string,
  maxScanAttempts: number,
): FetchStreamHealthSummary;
```

実装方針:

1. `SELECT started_at, outcome FROM fetch_attempt WHERE source_kind = ? ORDER BY started_at DESC, id DESC LIMIT ?`（`maxScanAttempts`）。既存索引 `idx_fetch_attempt_source` が効く。
2. 取得した窓を **JS 側で `Date.parse(started_at)` の降順（同値は `id` 降順）に並べ直す**。§2.2-4 のとおり辞書順が実時刻順と一致しないケースがあるため、SQL の順序を最終的な真とみなさない。
3. 先頭から `outcome === 'failure'` が連続する数を `consecutiveFailures` とする。窓が全件失敗なら `consecutiveFailuresCapped: true`。
4. `lastAttemptAt` = 窓の先頭の `started_at`。`lastSuccessAt` = 窓内で最初に現れる `outcome === 'success'` の `started_at`。窓内に成功が無い場合のみ `SELECT MAX(...)` ではなく `SELECT started_at FROM fetch_attempt WHERE source_kind = ? AND outcome = 'success' ORDER BY started_at DESC, id DESC LIMIT 1` を追加で 1 回発行し、その値を `Date.parse` して採用する（窓外の古い成功も拾える）。行が無ければ `null`。
5. 行が 1 件も無ければ `{lastAttemptAt: null, lastSuccessAt: null, consecutiveFailures: 0, consecutiveFailuresCapped: false}`。

`maxScanAttempts` の既定は 50。閾値の最大（連続失敗 5）を大きく上回るため、**打ち切りが判定結果を左右することはない**。`consecutiveFailuresCapped` は監視画面が「50 回以上」と表示するための情報であり、判定では使わない。履歴は自動削除しない方針（§8.1【確定】）なのでテーブルは単調増加するが、窓と索引により走査量は一定である。

### 4.3 停止中の扱いと `activeSinceAt`

§8.1【確定】「意図的な停止・スケジュール停止（夜間の定期取得停止等）はこの判定から除外し『停止中』として区別する」を実装する。

- `suspended` の判定は **`TimeBasedPollingScheduler.getStatus().sources[scheduledSource].state === 'scheduled_stopped'` の 1 条件だけ**で行う。§2.2-5 のとおり手動停止（`isRunning === false`）とスケジュール停止（`intervalSeconds === null`）の両方がこの値に畳まれているため、判定条件を独自に組み直さない（組み直すと停止の定義が 2 箇所に分裂する）。
- スケジューラは `{ getStatus(): TimeBasedPollingStatus }` という最小インターフェースで注入し、テストからスタブを渡せるようにする。
- `intervalSeconds` は同じ `getStatus()` の結果（`sources[x].intervalSeconds`）を使う。`getIntervalSecondsForSource` を再実装しない。

`activeSinceAt` はプロセス内の状態ストアが取得元ごとに保持する。

| 局面 | `activeSinceAt` |
|---|---|
| プロセス起動後の初回評価 | その評価時刻（`now`） |
| 前回評価が `suspended` で今回が非 `suspended` | 今回の評価時刻（＝稼働へ復帰した時刻） |
| 前回も今回も非 `suspended` | 前回の値を保持 |
| 今回が `suspended` | 値を保持（次に稼働へ入った時刻で上書きされる） |

評価周期（既定 30 秒）の粒度で「稼働へ入った時刻」を検知するため、実際の復帰時刻より最大 1 周期遅れる。閾値が分オーダーであるため実害はない。

**プロセス再起動時の初期状態**:

- 前回状態は永続化しない（プロセス内・非永続）。`FetchHealthStateStore` は**取得元ごとに** `previousStatus: FetchHealthStatus | null` を持ち、起動直後は全取得元が `null`。§7.6【確定】「初期取得済みの判定はプロセス起動単位でリセットする」と同じ設計である。
- 一方、**取得元ごとの実測値（連続失敗・最終成功時刻）は `fetch_attempt` から復元される**ため、再起動をまたいで継続している異常を見落とさない。
- 初回評価で `delayed` / `abnormal` だった取得元については**それぞれ**通知を生成し、`detectionContext: 'initial'` を付ける（§7.6【確定】「初期取得・復旧時に検知した情報も新規発見として通知する」「サーバー再起動のたびに現況が再通知されうることを許容する」に倣う）。
- ただし `activeSinceAt` が起動時刻になるため、**起動直後は経過時間条件が成立しない**。起動直後に `delayed` / `abnormal` になるのは連続失敗回数条件（DB 由来）に該当する場合だけである。これは意図した挙動であり、「起動したばかりで一度も取得していないこと」を異常と呼ばないための設計である。

### 4.4 通知の単位は取得元、集約は表示専用

**通知は取得元ごとに個別に生成する**（確定事項 6、§8.4【確定】の訂正後の文言「複数の取得元が同時に問題を抱える場合、取得元ごとに個別に通知する（1 件に集約しない）。例えば 5 取得元すべてが異常化すれば問いかけが 5 件発生する」）。

したがって:

- 状態機械は `MonitoredFetchSourceId` ごとに 1 本ずつ、合計 6 本ある。前回状態（`previousStatus`）も取得元ごとに保持する（§4.8）。
- 1 回の評価（`runOnce()`）で状態が変化した取得元の数だけ通知が生成される（0〜6 件）。
- 「同一状態は再通知しない」という重複抑止は**取得元ごとに独立に**適用する。取得元 A が異常のままでも、取得元 B の新たな遅延は B の通知として出る。
- 区分（`warning` / `question`）は**その取得元自身の今回状態**で決まる。他の取得元の状態に影響されない。最悪値で区分を引き上げたり、最悪値以外を握り潰したりしない。

一方 §8.1【確定】「全体状態カードの取得健全性は取得元ごとの判定の最悪値に従って集約する」は**監視画面（E 系）の全体状態カード表示についての規定**であり、通知の生成単位ではない。この集約は**表示専用データ**として残す。

```ts
/**
 * E 系（監視画面）が読む表示専用の集約。
 * 【重要】これは通知の生成単位ではない。通知は sources の各要素ごとに独立に生成される（§4.5）。
 * status は §8.1 の「全体状態カードの取得健全性」＝最悪値の表示のためだけに存在する。
 */
export interface FetchHealthAggregate {
  /** 表示用の最悪値。通知の区分決定に使ってはならない。 */
  readonly status: FetchHealthStatus;
  /** 固定順（MONITORED_FETCH_SOURCES の順）で全 6 取得元を含む。通知はこの各要素から作る。 */
  readonly sources: readonly FetchSourceHealthResult[];
  /** status と同じ状態にある取得元（監視画面の「現在の異常」カードの強調表示用）。 */
  readonly worstSourceIds: readonly MonitoredFetchSourceId[];
  readonly evaluatedAt: UtcIso8601String;
}

export function aggregateFetchHealth(
  results: readonly FetchSourceHealthResult[],
  evaluatedAt: UtcIso8601String,
): FetchHealthAggregate;
```

アルゴリズム（表示用最悪値の計算。通知には影響しない）:

1. `suspended` の取得元を除外した集合 `active` を作る。
2. `active` が空なら `status = 'suspended'`、`worstSourceIds = []`。
3. そうでなければ優先順位 `abnormal > delayed > normal` で `active` の最悪値を `status` とする。
4. `worstSourceIds` = `status` と一致する状態の取得元 id（`MONITORED_FETCH_SOURCES` の順。`status` が `normal` なら空配列）。

取得元単位の通知という選択の**帰結**（旧設計（集約値 1 本）との違いを実装者が取り違えないよう明示する）:

| シナリオ | 通知（新設計・採用） | 参考: 旧設計（集約 1 本、不採用） |
|---|---|---|
| A が遅延 → B も遅延 | **2 件目が出る**（B の警報） | 出なかった |
| A が遅延 → B が異常 | **B の問いかけが出る**（A の遅延通知は既出のまま） | 出た（1 件） |
| A が異常 → B が遅延 | **B の警報が出る** | **出なかった**（この取りこぼしが変更理由） |
| A・B が異常 → A だけ正常化 | **A の復帰通知が出る** | 出なかった |
| A が異常 → A が遅延に回復 | A の警報が出る | 出た |
| 5 取得元が同時に異常化 | **問いかけが 5 件出る** | 1 件だけ出た |

**旧設計で取りこぼしていた「他の取得元が既に異常な間に発生した新たな問題」が、新設計では確実に通知される。** これが確定事項 6 の狙いである。

### 4.5 状態変化の検知と通知遷移表

**取得元 1 つについて**、その取得元の前回状態（`previousStatus`）と今回状態の組で決定する。この表を全 6 取得元に独立に適用し、通知が出る取得元の数だけ通知を生成する。`changeType` は 3 値、`category` は「その取得元の今回状態が `abnormal` なら `question`、それ以外は `warning`」で一意に決まる。

| 前回 | 今回 | 通知 | `category` | `changeType` | 根拠 |
|---|---|---|---|---|---|
| `null`（起動直後） | `normal` / `suspended` | なし（`skipped: 'initial_no_problem'`） | — | — | 問題がないので通知する事実がない |
| `null` | `delayed` | 出す（`detectionContext: 'initial'`） | `warning` | `fetch_delayed` | §8.4 トリガー表＋§7.6 初期検知 |
| `null` | `abnormal` | 出す（`detectionContext: 'initial'`） | `question` | `fetch_abnormal` | 同上 |
| `normal` / `suspended` | `delayed` | 出す | `warning` | `fetch_delayed` | §8.4「いずれかの取得元が遅延判定に該当したとき」（他の取得元の状態によらず、この取得元について出す） |
| `normal` / `suspended` | `abnormal` | 出す | `question` | `fetch_abnormal` | §8.4「いずれかの取得元が異常判定に該当したとき」（同上） |
| `delayed` | `abnormal` | 出す | `question` | `fetch_abnormal` | §8.4「遅延から異常へ悪化した場合、7.5 と同様の考え方で問いかけを新たに発生させる」 |
| `abnormal` | `delayed` | 出す | `warning` | `fetch_delayed` | §8.4「異常から遅延へ回復した場合も状態変化として扱い、警報で知らせる」 |
| `delayed` / `abnormal` | `normal` | 出す | `warning` | `fetch_recovered` | 確定事項 3（§7.5 の「解除は警報」に倣う） |
| `delayed` / `abnormal` | `suspended` | なし（`skipped: 'suspended_transition'`） | — | — | 下記 |
| 同一状態 | 同一状態 | なし（`skipped: 'unchanged'`） | — | — | §7.6「同一内容の再取得・単なる継続は新たな通知を生成しない」と同じ考え方。**これが重複抑止の唯一の機構であり、取得元ごとに独立して適用する**（取得元 A が `unchanged` でも取得元 B の変化は通知される） |
| `normal` | `suspended` / `suspended` → `normal` | なし（`skipped: 'suspended_transition'`） | — | — | 問題の発生も解消もしていない |

**`delayed` / `abnormal` → `suspended` で通知しない理由**: `suspended` は §8.1【確定】により「判定から除外し停止中として区別する」状態であり、「問題が解消した」ことを意味しない。夜間のスケジュール停止で「データ取得復旧」を鳴らすのは誤報である。停止をまたいで問題が続いていれば、稼働復帰後の評価で `suspended → delayed/abnormal` として改めて通知される（§4.3 の `activeSinceAt` により、復帰直後は経過時間条件では発火せず、連続失敗回数条件で発火する）。この方針は確定事項 7（H5-a）で承認済み。

**往復抑制（一定時間同じ状態が続いてから通知する等）は設けない**（確定事項 7・H5-b）。閾値の境界で状態が往復すれば、そのたびに取得元ごとの通知が出る。

`previousStatus` は**取得元ごとに**保持する（§4.8 の `FetchHealthStateStore`）。集約値の前回値は保持しない（集約は表示専用であり状態機械を持たない。§4.4）。

### 4.6 通知フィールドの決め方

```ts
// apps/api/src/notifications/fetchHealthNotificationPlanner.ts

/**
 * D7 が確定させる装置異常系（取得健全性）の changeType 値集合。
 * SystemNotificationChangeType（= string、D1 が意図的に開いた契約）に代入可能な部分集合として定義する。
 * shared 側の型は狭めない（理由は §6 / §9 H2）。
 */
export type FetchHealthNotificationChangeType =
  | 'fetch_delayed'    // 遅延判定に該当（悪化からの回復 abnormal→delayed を含む）
  | 'fetch_abnormal'   // 異常判定に該当
  | 'fetch_recovered'; // 正常復帰

export interface PlannedFetchHealthNotification {
  /** この通知がどの取得元に由来するか。emitter がログ・commit の対応づけに使う。 */
  readonly sourceId: MonitoredFetchSourceId;
  readonly notification: SystemNotification;
  readonly output: ResolvedNotificationOutputSnapshot;
}

export type FetchHealthNotificationSkipReason =
  | 'unchanged'
  | 'initial_no_problem'
  | 'suspended_transition'
  | 'message_resolution_failed';

export interface FetchHealthNotificationSkip {
  /** どの取得元について見送ったか。 */
  readonly sourceId: MonitoredFetchSourceId;
  readonly reason: FetchHealthNotificationSkipReason;
  readonly detail: string;
}

export interface PlanFetchHealthNotificationInput {
  /**
   * 取得元ごとの前回状態。プロセス起動後まだ評価していない取得元は null。
   * 全 MonitoredFetchSourceId を鍵に持つ（値が null でも鍵は存在する）。
   */
  readonly previousStatusBySource: Readonly<
    Record<MonitoredFetchSourceId, FetchHealthStatus | null>
  >;
  /** 今回の評価結果。sources の各要素が独立に判定される。 */
  readonly current: FetchHealthAggregate;
  readonly detectedAt: UtcIso8601String;
  readonly notificationIdFactory: () => string;
}

export interface FetchHealthNotificationPlan {
  /** 状態が変化した取得元の数だけ並ぶ（0〜6 件）。順序は MONITORED_FETCH_SOURCES の順。 */
  readonly notifications: readonly PlannedFetchHealthNotification[];
  /** 通知しなかった取得元の理由。取得元ごとに 1 件。 */
  readonly skipped: readonly FetchHealthNotificationSkip[];
}

/**
 * 副作用も例外も持たない。判定不能はすべて skipped へ落とす（D4 と同じ規律）。
 * 全 6 取得元を MONITORED_FETCH_SOURCES の順に走査し、§4.5 の遷移表を各取得元へ独立に適用する。
 * 1 取得元の message 解決失敗が他取得元の通知を巻き込まないこと（その取得元だけを skipped へ落とす）。
 */
export function planFetchHealthNotification(
  input: PlanFetchHealthNotificationInput,
): FetchHealthNotificationPlan;
```

**通知の順序と ID**: 出力順は `MONITORED_FETCH_SOURCES` の固定順とする（テストの決定性のため）。`notificationIdFactory` は通知ごとに呼び、**同一評価で生成された複数通知が同じ ID を持たないこと**を保証する。

各フィールドの値:

| フィールド | 値 | 理由 |
|---|---|---|
| `origin` | `'system'` | §8.4【確定】「気象内容の通知と装置異常系の通知を区別できるフィールド（origin 等）を持たせる」 |
| `category` | **その取得元の**今回状態が `abnormal` → `'question'`、それ以外 → `'warning'` | §8.4 トリガー表。**他取得元の最悪値で引き上げない**（§4.4）。**`'emergency'` は生成しない**（§1.2） |
| `changeType` | `fetch_delayed` / `fetch_abnormal` / `fetch_recovered` | 上記 |
| `sourceType` | `'fetch_health'` | 装置異常系のうち「取得健全性」に由来することを表す固定値。E 系が追加するシステム通知（DB 初期化・手動操作等）は別の `sourceType` を使う |
| `sourceVersion` | `null` | 原因電文が存在しない |
| `targets` | 下記 | |
| `occurredAt` | `detectedAt` と同値（評価時刻） | 装置異常の「状態変化」は評価によって確定するため、発表時刻に相当する独立の時刻が存在しない。**取得試行の時刻を `occurredAt` に流用しない**（閾値超過の瞬間と試行時刻は一致しない） |
| `detectedAt` | 評価時刻 | |
| `relatedRefs` | `[{ type: 'fetch_source', ref: <sourceId> }]`（**その取得元 1 件のみ**） | 監視画面から取得元別テーブルの当該行へ辿るため |
| `detectionContext` | **その取得元の** `previousStatus === null` なら `'initial'`、それ以外 `'normal'` | §4.3 / §7.6 |
| `isTraining` | **常に `false`** | 装置異常系は訓練注入の経路を持たない。§3.4 の訓練通知が将来装置異常を模擬する場合は、**本ロジックの集約ストアを経由させず**、`isTraining: true` の通知を別経路で注入すること（本番の集約状態を訓練で汚染しない） |

**`targets`**（`NotificationTarget` は空配列を許さない型である）:

通知は取得元 1 つに対応するため、`changeType` によらず**常にその取得元 1 件だけ**を指す。

```ts
[{ kind: 'equipment', codeType: 'wx-viewer-poc/fetch-source', code: <sourceId>, name: <displayName> }]
```

`fetch_recovered` も同じ（復帰した取得元自身を指す）。**空配列になりうる経路が存在しないため、「取得系全体」等のフォールバックは不要であり、設けない**（旧設計では集約単位だったためフォールバックが必要だった）。この結果、通知本文からどの取得元が原因かが直接読める（§8.4 訂正後の「どの取得元が原因かは通知本文および監視画面本体で確認する」に対応する）。

`kind: 'equipment'` は `NotificationTarget` の既存 3 値の 1 つであり、D1 が装置系のために用意した値である。`codeType` は「同じ code でも意味が混ざらないよう、コード体系を表す」という D1 のコメントに従い、取得元 id 体系を表す固定文字列とする。

**メッセージ定義 ID の選択**（#103 の定義レジストリを唯一の文言源とする）:

| `changeType` | 定義 ID | 状態 |
|---|---|---|
| `fetch_delayed` | `system-data-fetch-delayed`（`warning` / 題名「データ取得遅延」/ 操作なし） | **既存**（§2.2-8） |
| `fetch_abnormal` | `system-data-fetch-failed`（`question` / 題名「データ取得異常」/ 確認操作あり） | **既存**（§2.2-8） |
| `fetch_recovered` | `system-data-fetch-recovered`（`warning` / 題名「データ取得復帰」/ 操作なし / `targetMode: notificationTargets` / `actionResolution: none`） | **新規追加する。確定事項 7（§9 H1）でユーザー承認済み** |

`abnormal → delayed` の回復も `fetch_delayed` として `system-data-fetch-delayed`（`warning`）を選ぶ。§8.4 の「異常から遅延へ回復した場合も警報で知らせる」と、現在の状態が遅延であることの両方を満たすため、追加の定義を要しない。

`resolveNotificationMessage` に渡す `detail` は、**その取得元自身の**代表理由 1 行とする（`reasons[0].text`。例: `連続5回失敗` / `最終成功から11分経過`）。同関数は改行・空白のみの `detail` を `invalid_detail` で例外にするため、**`detail` は必ず改行を含まない非空文字列として組み立てる**。`reasons` が空（理論上起こらないが防御する）の場合は取得元の `displayName` を `detail` に据える。`fetch_recovered` では `detail` を渡さない（`undefined`）。`resolveNotificationMessage` が例外を投げた場合は**その取得元の通知だけ**を捨て、`skipped: 'message_resolution_failed'` に落とす（他の取得元の通知は生成し続ける。D4 と同じ規律で例外をそのまま上げない）。

### 4.7 設定（§8.1【確定】設定ファイルで変更可能）

`config/polling.yaml` に必須ルートキー `fetchHealth` を追加する。

```yaml
fetchHealth:
  evaluationIntervalSeconds: 30      # 判定の実行周期
  delayedConsecutiveFailures: 2      # §8.1 遅延: 連続失敗2回以上
  delayedIntervalMultiplier: 3       # §8.1 遅延: 適用周期×3
  abnormalConsecutiveFailures: 5     # §8.1 異常: 連続失敗5回以上
  abnormalElapsedSeconds: 600        # §8.1 異常: 固定10分
  maxScanAttempts: 50                # 連続失敗回数の走査窓（判定閾値より十分大きく取る）
```

閾値は**全取得元で共通**とし、取得元ごとの個別閾値は設けない（§8.1 に取得元別閾値の規定がないため）。`amedas_point` だけは経過時間条件を適用しない（§4.1）が、これは設定値ではなく取得元定義のフラグである（運用で切り替える性質のものではないため）。

```ts
// apps/api/src/monitoring/fetchHealthConfig.ts
export interface FetchHealthConfig {
  readonly evaluationIntervalSeconds: number;
  readonly delayedConsecutiveFailures: number;
  readonly delayedIntervalMultiplier: number;
  readonly abnormalConsecutiveFailures: number;
  readonly abnormalElapsedSeconds: number;
  readonly maxScanAttempts: number;
}
export function validateFetchHealthConfig(value: unknown): FetchHealthConfig;
```

検証規則（既存 `validatePollingScheduleConfig` と同じ厳格さ・同じ日本語エラー文体で実装する）:

- 全キー必須・未知キー拒否。**既定値フォールバックを行わない**（既存ローダーの方針。健全性の閾値を暗黙の既定値で動かすと、設定ミスが無警告で別の閾値になる）。
- すべて正の安全整数。
- `delayedConsecutiveFailures >= 2`（§8.1 の「正常 = 連続失敗 1 回以内」と矛盾しないため）。
- `abnormalConsecutiveFailures >= delayedConsecutiveFailures`、`abnormalElapsedSeconds` は正。
- `maxScanAttempts > abnormalConsecutiveFailures`（走査窓が閾値以下だと判定できない）。

`PollingScheduleConfig` に `readonly fetchHealth: FetchHealthConfig` を追加し、`EXPECTED_ROOT_KEYS` に `'fetchHealth'` を足す。§2.2-7 のとおりインラインで設定を組む既存テストは 2 ファイルだけなので、そこに `fetchHealth` を追記する。

**判定 UI は設けない**（§8.1【確定】「画面上の設定 UI は設けない」）。API も設けない。

### 4.8 永続化・配線

```ts
// apps/api/src/monitoring/fetchHealthStateStore.ts
/**
 * プロセス起動単位の前回値保持（非永続・メモリのみ）。process レベルのシングルトンにしない。
 * 【重要】状態は取得元ごとに独立して保持する。集約値の前回値は保持しない（集約は表示専用。§4.4）。
 */
export class FetchHealthStateStore {
  /** その取得元の前回状態。プロセス起動後まだ評価していなければ null。 */
  getPreviousStatus(sourceId: MonitoredFetchSourceId): FetchHealthStatus | null;
  /** 全取得元ぶんをまとめて取り出す（planner の入力）。未評価の取得元も鍵として含む。 */
  getPreviousStatusBySource(): Readonly<Record<MonitoredFetchSourceId, FetchHealthStatus | null>>;
  getActiveSinceAt(sourceId: MonitoredFetchSourceId): UtcIso8601String | null;
  /** 評価後に呼ぶ。取得元ごとの状態と activeSinceAt をまとめて更新する。 */
  commit(aggregate: FetchHealthAggregate): void;
  /** テスト用。プロセス再起動の等価物。 */
  reset(): void;
}

// apps/api/src/notifications/fetchHealthNotificationEmitter.ts
export interface FetchHealthNotificationEmitDeps {
  readonly now: () => UtcIso8601String;
  readonly notificationIdFactory?: () => string; // 既定 crypto.randomUUID
}
export interface FetchHealthNotificationEmitResult {
  /** 実際に履歴へ記録できた通知（取得元ごとに 0〜1 件、合計 0〜6 件）。 */
  readonly recorded: readonly SystemNotification[];
  /** 記録に失敗した取得元（例外は外へ投げない）。 */
  readonly recordFailedSourceIds: readonly MonitoredFetchSourceId[];
  readonly skipped: readonly FetchHealthNotificationSkip[];
}
export function emitFetchHealthNotification(
  connection: DatabaseConnection,
  aggregate: FetchHealthAggregate,
  store: FetchHealthStateStore,
  deps: FetchHealthNotificationEmitDeps,
): FetchHealthNotificationEmitResult;
```

`emitFetchHealthNotification` は `planFetchHealthNotification` を呼び、返った通知を**1 件ずつ**
`toNotificationOutputHistoryInput` → `recordNotificationOutputHistory` の 1 トランザクションで記録する（`warningNotificationEmitter` と同一パターン。§2.2-11）。

- **通知ごとに独立したトランザクションにする。** 6 件を 1 トランザクションに束ねない。1 取得元の記録失敗が他取得元の通知を巻き添えにしないためであり、通知はそれぞれ独立した事象だからである。
- 記録が失敗しても例外を外へ投げず `console.error` に留め、**`store.commit(aggregate)` は最後に必ず 1 回実行する**（同じ状態変化を毎周期通知し続けるのを防ぐ。記録に失敗した取得元も状態は前進させる。旧設計と同じ規律）。
- `skipped` は `console.warn` に落とす（`warningNotificationEmitter` と同粒度）。`unchanged` は毎周期・全取得元ぶん発生するため**ログに出さない**（30 秒ごとに 6 行出るのを避ける）。ログに出すのは `message_resolution_failed` のみとする。

```ts
// apps/api/src/monitoring/fetchHealthMonitorService.ts
export interface FetchHealthStatusProvider {
  getStatus(): TimeBasedPollingStatus;
}
export interface FetchHealthMonitorServiceOptions {
  readonly connection: DatabaseConnection;
  readonly statusProvider: FetchHealthStatusProvider;
  readonly config: FetchHealthConfig;
  readonly store?: FetchHealthStateStore;
  readonly now?: () => UtcIso8601String;
  readonly notificationIdFactory?: () => string;
  readonly setTimer?: (cb: () => void, ms: number) => unknown;
  readonly clearTimer?: (id: unknown) => void;
}
export class FetchHealthMonitorService {
  constructor(options: FetchHealthMonitorServiceOptions);
  /** 1 回だけ評価して通知判定まで行う。テストの主入口。 */
  runOnce(): { readonly aggregate: FetchHealthAggregate; readonly emit: FetchHealthNotificationEmitResult };
  start(): void;   // 即時 1 回 + evaluationIntervalSeconds 周期
  stop(): void;
  /** E 系監視画面向け。最後の評価結果（未評価なら null）。 */
  getLastAggregate(): FetchHealthAggregate | null;
}
```

タイマーは `setTimer` / `clearTimer` を注入可能にする（`TimeBasedPollingScheduler` と同じ形）。`runOnce()` 内で例外が起きても周期タイマーを止めない（`try`/`catch` で `console.error`）。

`server.ts` への配線:

- `scheduler` を生成した直後（現在 `await scheduler.start()` を呼んでいる個所、および同ファイル内の 2 つ目の起動経路の両方）で `FetchHealthMonitorService` を生成し、`statusProvider` に `scheduler` を渡して `start()` する。
- `enablePolling === false` のときは生成しない（取得しないのだから健全性も問わない）。
- 例外時の解放処理・正常停止処理の両方で `stop()` を呼ぶ（`scheduler.stop()` と同じ箇所）。

### 4.9 D7 が提供し E 系が読むもの

`FetchHealthAggregate.sources` は 6 取得元すべてについて `status` / `lastAttemptAt` / `lastSuccessAt` / `maxConsecutiveFailures` / `intervalSeconds` / `reasons` を含む。§8.1 の「取得元別状態（最終試行・最終成功・連続失敗数）」と「全体状態カードの取得健全性」「現在の異常（解消していない問題だけ）」がこの 1 オブジェクトから作れる。**D7 は HTTP エンドポイントを追加しない**。E 系が `getLastAggregate()` を読む。

`availability`（`available` / `stale` / `unavailable`）とは別軸であることに注意する。`FetchHealthStatus` は取得試行の成否から見た健全性であり、`availability` は保存値の有無と鮮度から見た可用性である。**この 2 つを OK/NG に畳まない**（§6.3【確定】・CLAUDE.md §4）。

## 5. 実装手順

1. `apps/api/src/monitoring/fetchHealthSources.ts`（取得元定義と除外理由コメント）。
2. `fetchHealthConfig.ts`（型・検証）→ `config/pollingSchedule.ts` に `fetchHealth` を組み込み → `config/polling.yaml` に節を追加 → 既存 2 テストファイルのインライン設定を更新。ここで `npm run test -w apps/api` が通ることを確認する。
3. `fetchAttemptRepository.ts` に `summarizeFetchStreamHealth` を追加し、単体テスト（成功のみ／失敗のみ／混在／窓超過／行なし／ミリ秒混在）を書く。
4. `fetchHealthEvaluator.ts`（`evaluateFetchSourceHealth` / `aggregateFetchHealth`）と単体テスト。DB に依存しない純粋関数なので固定入力で網羅する。`appliesElapsedCondition: false`（`amedas_point`）のケースを必ず含める。
5. `fetchHealthStateStore.ts`（取得元ごとの状態保持）。
6. `notifications/fetchHealthNotificationPlanner.ts` と遷移表の総当たりテスト。**取得元単位の独立性**（複数取得元が同時に変化する／一方だけ変化する／一方が `unchanged` で他方が変化する）のテストを必ず含める。
7. `packages/shared/src/notificationMessageDefinitions.ts` に `system-data-fetch-recovered` を追加し、shared 側テストを追記（確定事項 7・§9 H1 で承認済み）。
8. `notifications/fetchHealthNotificationEmitter.ts` と、インメモリ DB を使った記録テスト。
9. `monitoring/fetchHealthMonitorService.ts` と、タイマー注入＋スケジューラスタブによる結合テスト。
10. `notifications/index.ts` / `monitoring/index.ts` のバレル整備、`server.ts` への配線。
11. AC0 の全コマンドを実行。

## 6. D5（Issue #29、並行実装中）との関係

統括担当が D5 設計書を確認した結果、次のとおり整理されている。

- **機能的な重複はない。** D5 の対象外に「装置異常通知（D7/D8）」が明記されている。D5 は端末起動時の現況出力（pull 方式）を所有し、D7 は装置異常の判定と履歴記録を所有する。
- **型定義面の競合リスクは低い。** D5 が shared 側で行うのは新規ファイル 2 本の追加とバレルへの追記のみで、既存の `NotificationCategory` / `SystemNotification` の型定義自体は変更していない（`origin: 'weather'` の起動時専用型を新設するだけ）。
- **本 Issue も既存の共有型を変更しない。** `SystemNotificationChangeType = string` を union に狭めず（§2.2-9 の型テストと既存 fixture を壊さないため）、D7 の値集合は API 層の `FetchHealthNotificationChangeType` として定義する。`packages/shared` への変更は `notificationMessageDefinitions.ts` への**定義 1 件の追加**だけである（確定事項 7 で承認済み）。
- **マージ時に起こりうるのは行競合だけである。** `packages/shared/src/index.ts` と `apps/api/src/notifications/index.ts` のバレル export に両 Issue が追記する可能性がある。いずれも export 行の追加であり、衝突したら両方を残せばよい。
- D5 が起動時出力の対象に装置異常系通知を含めるかどうかは D5 の所有範囲である。D7 は `notification_output_history` に `origin='system'` / `source_type='fetch_health'` で記録するので、D5 側は `origin` で絞り込める。

## 7. 受け入れ条件（検収担当が 1 項目ずつ実行する）

前提コマンドはリポジトリルートで実行する。

### AC0 共通検証

```bash
npm run lint && npm run typecheck && npm run format:check && npm run test -w apps/api && npm run test -w packages/shared
```

すべて終了コード 0。`--max-warnings 0` のため警告も 0 件であること。

### AC1 遅延判定で「警報」、異常判定で「問いかけ」が生成される（Issue 受け入れ条件 1）

テスト名（例）: `連続2回失敗で警報、連続5回失敗で問いかけが生成される`

手順: インメモリ DB に `source_kind = 'xml_feed_regular'` の `fetch_attempt` 行を投入し（成功 1 件 → 失敗 2 件）、スケジューラスタブが `xml` を `state: 'waiting'`, `intervalSeconds: 60` と返す状態で `FetchHealthMonitorService.runOnce()` を実行する。次に失敗をさらに 3 件（計 5 件）足して `runOnce()` を再実行する。

合格条件:
- 1 回目: `aggregate.status === 'delayed'`、記録された通知の `category === 'warning'`、`changeType === 'fetch_delayed'`、`messageDefinitionId === 'system-data-fetch-delayed'`、`ackRequired === false`。
- 2 回目: `aggregate.status === 'abnormal'`、`category === 'question'`、`changeType === 'fetch_abnormal'`、`messageDefinitionId === 'system-data-fetch-failed'`、`ackRequired === true`。
- いずれも `origin === 'system'`、`sourceType === 'fetch_health'`、`isTraining === false`。
- `listNotificationOutputHistory(connection, { origin: 'system' })` の件数が 2 件。

### AC2 経過時間条件でも判定される

テスト名（例）: `最終成功から適用周期×3 を超えると遅延、10 分を超えると異常になる`

手順: `xml_feed_regular` の成功行を 1 件だけ投入し（失敗行は入れない）、`intervalSeconds: 60` のスタブで `now` を「最終成功 + 181 秒」「最終成功 + 601 秒」として `runOnce()` を実行する。`activeSinceAt` が経過時間の下限にならないよう、最初の評価を「最終成功 + 1 秒」の時点で 1 回行ってから時刻を進める。

合格条件:
- +181 秒: `status === 'delayed'`、`reasons` に `kind: 'last_success_elapsed'` が含まれる。
- +601 秒: `status === 'abnormal'`。
- 連続失敗回数は 0 のままである（経過時間条件だけで発火したことが確認できる）。

### AC3 複数取得元が同時に問題を抱えると取得元ごとに個別の通知が出る（Issue 受け入れ条件 2・確定事項 6）

テスト名（例）: `2 取得元が同時に問題化すると通知が 2 件出て、区分はそれぞれの状態で決まる`

手順: `xml_feed_regular`（失敗 2 件＝遅延相当）と `risk_target_times`（失敗 5 件＝異常相当）の行を投入し、`runOnce()` を 1 回実行する。

合格条件:
- 記録された通知は **2 件**（1 件に集約されていない）。
- `xml_regular` の通知が `category === 'warning'` / `changeType === 'fetch_delayed'` / `targets` が `code === 'xml_regular'` のみ 1 件。
- `kikikuru_target_times` の通知が `category === 'question'` / `changeType === 'fetch_abnormal'` / `targets` が `code === 'kikikuru_target_times'` のみ 1 件。
  （**遅延側が最悪値 `abnormal` に引き上げられていないこと**を確認する。§4.4）
- 各通知の `targets` の長さが 1、`relatedRefs` の長さが 1。
- `aggregate.sources` は 6 件すべてを含み、表示用 `aggregate.status === 'abnormal'`、`worstSourceIds === ['kikikuru_target_times']`（表示用集約は生きている）。
- 続けて `xml_feed_regular` にも失敗を 3 件足して `runOnce()` を再実行すると、**`xml_regular` の通知が 1 件増える**（`delayed → abnormal` の悪化。合計 3 件）。`kikikuru_target_times` の通知は増えない（`unchanged`）。

**追加ケース（5 取得元同時異常）**: `xml_feed_regular` / `xml_feed_extra` / `radar_times_N1` / `risk_target_times` / `amedas_latest_time` に失敗 5 件ずつを投入して `runOnce()` を 1 回実行すると、**`category === 'question'` の通知がちょうど 5 件**記録され、`targets[0].code` が 5 取得元それぞれと 1 対 1 対応する（重複・欠落なし）。通知 ID が 5 件すべて異なる。

### AC4 状態変化（悪化・回復・正常復帰）が取得元ごとに通知され、無変化では通知されない

テスト名（例）: `1 取得元の delayed→abnormal→delayed→normal の遷移で 4 件の通知が出る`

手順: 1 取得元（`xml_feed_regular`）について 失敗 2 件（delayed）→ 失敗 5 件（abnormal）→ `abnormal → delayed` → 成功 1 件を追加して `now` を最終成功 +10 秒（normal）へ、という順で `runOnce()` を都度実行する。`abnormal → delayed` は「失敗 5 件の後、`maxScanAttempts` 窓の先頭に成功を 1 件足しつつ `now` を周期×3 超過の位置に置く」ことで作る。各遷移の間に、状態が変わらない `runOnce()` を 1 回ずつ挟む。**他の 5 取得元は成功行だけを置き、全期間を通じて `normal` のままにする。**

合格条件:
- 遷移のたびに 1 件、合計 4 件（`fetch_delayed` → `fetch_abnormal` → `fetch_delayed` → `fetch_recovered`）の通知が記録される。
- 状態が変わらない `runOnce()` では通知が**増えない**。
- `normal` のままの 5 取得元からは通知が 1 件も出ない（全期間で記録件数が上記 4 件を超えない）。
- `abnormal → delayed` の通知が `category === 'warning'`（§8.4「異常から遅延へ回復した場合も警報で知らせる」）。
- 正常復帰の通知が `category === 'warning'`、`changeType === 'fetch_recovered'`、`messageDefinitionId === 'system-data-fetch-recovered'`、`ackRequired === false`、`targets` が `xml_regular` 自身を指している。

**追加ケース（独立性・確定事項 6 の核心）**: 取得元 A を異常のままにしたうえで、取得元 B を `normal → delayed` にして `runOnce()` すると、**B の警報が 1 件記録される**（A が異常であることに抑止されない。旧設計ではここで通知が出なかった）。同じ `runOnce()` で A の通知は増えない。

### AC5 停止中が判定から除外され、復帰直後に誤検知しない

テスト名（例）: `スケジュール停止中は判定せず、復帰直後に経過時間で異常にならない`

手順: スケジューラスタブが全取得元を `state: 'scheduled_stopped'`, `intervalSeconds: null` と返す状態で、最終成功が 8 時間前の行を投入して `runOnce()` を実行する。次にスタブを `state: 'waiting'`, `intervalSeconds: 60` に切り替えて `runOnce()` を 2 回（同一時刻・+61 秒）実行する。

合格条件:
- 停止中: 全 6 `sources[].status === 'suspended'`、`aggregate.status === 'suspended'`、通知 0 件。
- 復帰直後: `status === 'normal'`（8 時間前の成功にもかかわらず異常にならない＝`activeSinceAt` が効いている）、通知 0 件。
- さらに「問題を抱えたまま停止に入る」ケース: 1 取得元が異常状態で通知を 1 件出した後、スタブを `scheduled_stopped` に切り替えて `runOnce()` すると、**復帰通知が出ない**（その取得元の `skipped` 要素が `reason === 'suspended_transition'`）。

### AC6 プロセス再起動時の初期状態

テスト名（例）: `新しい StateStore で評価すると継続中の異常が initial として通知される`

手順: 失敗 5 件の行がある DB に対し、**新しい `FetchHealthStateStore` と新しい `FetchHealthMonitorService`**（＝プロセス再起動の等価物）を作って `runOnce()` を実行する。

合格条件:
- 通知が 1 件出る。`detectionContext === 'initial'`。
- 同じサービスで `runOnce()` を再実行しても通知は増えない。
- 問題のない DB（成功のみ）で同じことをすると通知は 0 件（全 6 取得元の `skipped` 要素が `reason === 'initial_no_problem'`）。
- 2 取得元に失敗 5 件ずつがある DB で同じことをすると、`detectionContext === 'initial'` の通知が**2 件**出る（初期検知も取得元ごとに独立している）。

### AC7 対象取得元と除外取得元（確定事項 5）

テスト名（例）: `6 取得元が判定対象で、タイル・長期フィード・個別電文は対象外`

手順: `radar_tile`, `risk_tile_frame`, `xml_document`, `xml_feed_regular_long`, `xml_feed_extra_long` の失敗行を各 10 件投入し、6 取得元には成功行だけを置いて `runOnce()` を実行する。

合格条件:
- `aggregate.status === 'normal'`、通知 0 件（除外対象の失敗が判定に漏れ出していない）。
- `aggregate.sources` の長さが **6** で、id が `xml_regular` / `xml_extra` / `nowcast_target_times` / `kikikuru_target_times` / `amedas_latest_time` / `amedas_point`。
- 雨雲について `radar_times_N1` だけを失敗 5 件にすると `nowcast_target_times` が `'abnormal'` になる（複数ストリームの最悪値が取れている。N2 の成功で薄まらない）。

### AC7b アメダス（地点）は連続失敗回数だけで判定され、経過時間では判定されない（確定事項 5）

テスト名（例）: `amedas_point は 8 時間成功が無くても正常、連続失敗 2 回で遅延・5 回で異常になる`

手順・合格条件:
1. `amedas_point` に成功行を 1 件だけ（8 時間前の `started_at`）投入し、`amedas_latest_time` には直近の成功行を置く。スケジューラスタブは `amedas` を `state: 'waiting'`, `intervalSeconds: 60` と返す。`activeSinceAt` が下限にならないよう、8 時間前の時点で 1 回 `runOnce()` を実行してから `now` を現在へ進めて `runOnce()` する。
   → `sources` のうち `amedas_point` が **`'normal'`**（経過時間条件が適用されていない）。同条件の `amedas_latest_time` が `'abnormal'` になること（同じ入力でも経過時間条件が適用される取得元では異常になる、という対照）を**同一テスト内で確認する**。`amedas_point` の通知は 0 件。
2. `amedas_point` に失敗行を 2 件追加して `runOnce()` → `amedas_point` が `'delayed'`、`category === 'warning'` の通知が 1 件、`targets[0].code === 'amedas_point'`、`targets[0].name === 'アメダス（地点）'`。`reasons` に `kind: 'last_success_elapsed'` が**含まれない**（`kind: 'consecutive_failures'` のみ）。
3. さらに失敗行を 3 件追加（計 5 件）して `runOnce()` → `'abnormal'`、`category === 'question'` の通知が 1 件。
4. `amedas_latest_time` と `amedas_point` が同時に異常化した場合、通知が **2 件**出る（アメダスが 1 件に束ねられていない）。

### AC8 設定ファイルで閾値が変わる

テスト名（例）: `fetchHealth の閾値を変えると判定が変わる / 不正な設定は起動前に失敗する`

手順・合格条件:
- `config/polling.yaml` の `fetchHealth` を読み込んだ `PollingScheduleConfig` が §4.7 の 6 キーを持つ。
- `delayedConsecutiveFailures: 3` にしたコンフィグを注入すると、失敗 2 件では `'normal'`、3 件で `'delayed'` になる（数値がハードコードされていない）。
- `fetchHealth` を欠いた YAML は `必須ルートキーが不足` 相当のエラーで `loadPollingScheduleConfig` が失敗する。未知のサブキーを足した YAML もエラーになる。`delayedConsecutiveFailures: 1`、`maxScanAttempts: 3`（＝`abnormalConsecutiveFailures` 以下）はいずれもエラーになる。
- `grep -rn "600\|10 \* 60" apps/api/src/monitoring/` に閾値のハードコードが無いこと（既定値フォールバックを書いていないこと）。

### AC9 非常ブザーを生成しない・訓練と混同しない

手順・合格条件:
- `grep -rn "emergency" apps/api/src/monitoring/ apps/api/src/notifications/fetchHealthNotification*.ts` が 0 件、または「生成しない」旨のコメントのみ。
- 全 AC で記録された通知の `category` が `'warning'` / `'question'` のみ。
- `isTraining` が全件 `false`。`grep -rn "isTraining" apps/api/src/monitoring/ apps/api/src/notifications/fetchHealthNotification*.ts` の代入がすべて `false`。

### AC10 既存ポーリング層を変更していない

```bash
git diff --stat origin/main -- apps/api/src/polling/
```

合格条件: 出力が空（`apps/api/src/polling/` 配下の変更が 0 ファイル）。§3.2 の設計判断が守られていること。`apps/api/src/config/pollingSchedule.ts` の差分は `fetchHealth` の追加と検証のみで、`periods` / `freshness` / 既存関数の挙動を変えていないこと。

### AC11 red / 対照実験 / ミューテーション

- 新規テストは、実装を壊した状態で実際に落ちること（red）を先に確認して報告する。
- ミューテーション判定の前に、意味を変えないダミー改変が SURVIVED になることを確認する（対照実験）。
- 次の 6 変異が KILLED になること:
  1. `planFetchHealthNotification` を「最悪値の取得元 1 件だけ通知する」旧設計に戻す（AC3 の 2 件・5 件、AC4 の独立性ケースが落ちる）。
  2. 通知の `category` を「その取得元の状態」ではなく `aggregate.status` から決める（AC3 の「遅延側が引き上げられていないこと」が落ちる）。
  3. `'unchanged'` の skip を外して毎周期通知する（AC3 後半・AC4・AC6 が落ちる）。
  4. `suspended` を `normal` と同一視する（AC5 の「復帰通知が出ない」が落ちる）。
  5. `baselineAt` から `activeSinceAt` の `max` を外す（AC5 の「復帰直後に異常にならない」が落ちる）。
  6. `amedas_point` の `appliesElapsedCondition` を `true` に変える（AC7b-1 が落ちる）。
- `FetchHealthStateStore` の前回状態を取得元ごとではなく 1 本にまとめる改変も KILLED になること（AC3 後半・AC4 の独立性ケース）。
- 対照変更・変異は元に戻し、完成コードへ残さない。

### AC12 手動確認

```bash
npm run dev
```

合格条件: API が起動し、通常の（上流に到達できる）環境では装置異常通知が記録されないこと。その後ネットワークを切る（または `fetchFn` が失敗する状態にする）と、`notification_output_history` に `origin='system'`, `source_type='fetch_health'` の行が増えること。**このとき行は取得元ごとに増える**（全取得元が同時に落ちるため、遅延判定を満たした取得元の数だけ `category='warning'` の行が増え、異常判定に達した取得元の数だけ `category='question'` の行が増える）。各行の `targets` がそれぞれ異なる取得元を指していること（`code` の重複がないこと）を確認する。復旧させると `change_type='fetch_recovered'` の行が取得元ごとに増えること。**同じ状態が続く間に行が増え続けないこと**を最低 2 評価周期ぶん観察する。

`amedas_point` は試行が最大 10 分間隔になりうるため（§2.2-10）、この手動確認の時間内に遅延・異常へ到達しない場合がある。到達しないこと自体は不合格としない（AC7b が単体テストで担保する）。

## 8. 後続 Issue への引き継ぎ

- **E 系（監視画面）**: `FetchHealthAggregate` が §8.1 の「取得元別状態」テーブルと「全体状態カード＝取得健全性」「現在の異常」の全データ源である。`aggregate.status` / `worstSourceIds` は**表示専用**であり、通知の単位ではない（§4.4）。取得元別テーブルはアメダスを「アメダス（時刻）」「アメダス（地点）」の 2 行として表示する（6 行になる）。`FetchHealthMonitorService.getLastAggregate()` を読む API を E 系が追加する。**取得健全性（`FetchHealthStatus`）と `availability` を 1 つの OK/NG に畳まないこと。**
- **E 系（取得操作）**: `system-fetch-manually-stopped` / `-started` / `system-force-fetch-*` の 4 定義は #103 に既にある。操作系のシステム通知は本 Issue の集約状態機械を経由させず、操作イベントから直接生成する（取得健全性の状態遷移とは別軸）。`sourceType` は `'fetch_health'` 以外を使うこと。
- **D8（§8.4 の残り）**: H 端末相当モードでの装置異常系通知の表示除外は、本 Issue が付ける `origin === 'system'` で絞り込める。生成・保持は常に行う（§8.4【確定】）。
- **タイル取得の健全性判定**: §8.1 が「直近数分間の失敗率など別基準を設ける案」とした未確定事項。`radar_tile` / `risk_tile_frame` の行は `fetch_attempt` に揃っているため、`summarizeFetchStreamHealth` とは別の集計関数を足せば実装できる。**本 Issue の周期ベース閾値をタイルへ流用しないこと。**
- **アメダス地点データ（`amedas_point`）**: 確定事項 5 により対象に含めた。ただし**連続失敗回数条件のみ**で判定するため、異常検知までの遅れが他取得元より大きい（最悪 50 分。§2.2-10）。将来、地点取得にも時間ベースの基準を設けるなら「実際に試行された周期だけを母集団にする」別の指標（例: 直近 N 回の試行のうち失敗率）が必要であり、**本 Issue の経過時間条件をそのまま当ててはならない**。`amedasPointRecheckSeconds` を短くすれば検知は早まるが、それは取得負荷の問題として別途判断すること。
- **#103**: `system-data-fetch-recovered` を追加するとシステム通知は 11 種になる。`sourceType` / `changeType` による定義 ID の自動選択関数を将来設けるなら、本 Issue の planner が取得健全性についての唯一の対応表である。
- **訓練通知（§3.4）**: 装置異常を訓練で模擬する場合、`FetchHealthStateStore` を経由させず `isTraining: true` の通知を別経路で注入する。本番の取得元別状態を訓練で遷移させてはならない。
- **通知件数の増加**: 確定事項 6 により、装置異常時の通知件数は旧設計の最大 1 件から最大 6 件（1 評価あたり）へ増える。E 系の通知一覧・履歴 UI と D5 の起動時出力は、同時刻に同種の通知が複数並ぶことを前提に設計すること。

## 9. ヒアリング事項と回答（H1〜H5 はすべて回答済み）

設計担当が自分では決めず統括担当へ差し戻した論点と、統括担当がユーザーから得た回答。**回答は決定の根拠として保存する。実装時にこの節の回答を再検討・上書きしないこと。**

- **H1（実装に影響・#103 設計書が明示的にユーザー確認を求めている）**: 正常復帰の通知に使うメッセージ定義を新規追加してよいか。
  質問文: 「取得の遅延・異常が解消して正常に戻ったときの通知文言として、既存の『データ取得遅延』『データ取得異常』とは別に、**『データ取得復帰』という新しいメッセージ定義（通知区分は警報、確認操作なし）を追加**してよいでしょうか。既存の『データ取得遅延』を流用すると、復帰したのに『データ取得遅延』という題名が表示されます。」
  **回答: 承認。** `system-data-fetch-recovered`（`warning`・確認操作なし）を新規追加してよい。→ §4.6 の定義 ID 表、§5 手順 7、§3.3 のファイル一覧のとおり実装する（差し戻し待ちの記述は解除済み）。
- **H2（型の方針確認）**: `SystemNotification.changeType` の型を狭めるか。
  質問文: 「D1 の設計書は『装置異常の状態値は D2 以降で確定する』としていますが、共有型 `SystemNotificationChangeType` は現在『任意の文字列』で、**その自由度を固定する型テストと既存テストデータが存在します**。今回は D7 の値（`fetch_delayed` / `fetch_abnormal` / `fetch_recovered`）を API 層で確定させ、共有型は文字列のまま残す方針（型テスト・既存テストを変更しない）でよいでしょうか。それとも共有型を列挙型に狭めますか（その場合、型テスト 1 ファイルと API 側テスト 2 ファイルの修正が発生し、E 系のシステム通知が値を追加するたびに共有型を変更することになります）。」
  **回答: 承認（選択肢 A）。** `SystemNotificationChangeType` は共有型のまま（`string`）変更しない。D7 固有の値（`fetch_delayed` / `fetch_abnormal` / `fetch_recovered`）は API 層の `FetchHealthNotificationChangeType` だけで定義する。→ §4.6・§6 のとおり。
- **H3（業務上の許容確認・回答により設計を大幅変更）**: 集約値のみで状態変化を見ることの帰結。
  質問文: 「装置異常の通知は『最も高い区分で 1 件』という確定方針に従い、全取得元をまとめた 1 つの状態（正常／遅延／異常）の変化だけで通知します。この結果、**すでにある取得元が『異常』の間に、別の取得元が新たに『遅延』になっても通知は出ません**（全体状態は『異常』のままだからです。どの取得元が原因かは監視画面で確認する想定）。この挙動で問題ないでしょうか。」
  **回答: 否。取得元ごとに個別に通知する方式へ変更する。** ユーザー指示は「装置異常は異常のあった装置ですべて警報出力する。5 個全部落ちたら警報は 5 個上がる」。これを受けて統括担当が**基本設計 §8.4 の該当記述をユーザー承認のもとで訂正済み**（新しい文言は §2.1 の参照資料表に全文を引用した）。Issue #31 本文の受け入れ条件も同様に訂正済み。
  → 本設計書は §1.1・§3.1・§4.4・§4.5・§4.6・§4.8・AC3・AC4・AC6・AC11 を「取得元ごとの独立した状態機械と個別通知」へ書き直した。集約オブジェクト（`FetchHealthAggregate`）は**監視画面向けの表示専用データ**として残し、通知の生成単位ではないことを §4.4 に明記した。
- **H4（対象範囲の線引き確認）**: アメダス地点データの扱い。
  質問文: 「アメダスは『最新時刻の確認』と『地点データの取得』の 2 段構えで、**地点データは最新時刻が更新されたときだけ取得されます**（周期ごとには取得されません）。今回は周期取得される『最新時刻』だけを判定対象とし、地点データの取得失敗では装置異常通知を出さない設計としています。地点データだけが失敗し続ける状態を通知したい場合は別基準が必要ですが、今回は対象外としてよいでしょうか。」
  **回答: 否。`amedas_point` も判定対象に含める（統括担当が判断し確定事項として提示）。** ただし技術的制約に対応するため、**経過時間条件（周期×3・固定 10 分）は適用せず、連続失敗回数条件（遅延 2 回以上・異常 5 回以上）だけで判定する。** 取得元は「アメダス（時刻）」（`amedas_latest_time`、従来どおりの周期判定）と「アメダス（地点）」（`amedas_point`、連続失敗回数のみ）の 2 つに分離し、H3 の個別通知方針に沿ってそれぞれ独立に通知する。
  → §4.1 の条件適用表、§4.2 の取得元定義表（除外表から `amedas_point` を削除）、§2.2-10 の実挙動調査、AC7・AC7b に反映済み。`MonitoredFetchSourceId` は 6 種類になった。
- **H5（誤報防止の方針確認）**: 停止に入るときの扱いと、状態が往復する場合の扱い。
  質問文: 「(a) 異常や遅延を抱えたまま夜間のスケジュール停止時刻（20:00）に入った場合、『復帰しました』という通知は出さず、停止中は判定を止める設計としています（停止は問題の解消ではないため）。よろしいでしょうか。(b) 閾値の境界で状態が短時間に往復すると、そのたびに通知が出ます（例: 遅延↔正常を繰り返す）。往復を抑える仕組み（一定時間同じ状態が続いてから通知する等）は今回入れていませんが、必要でしょうか。」
  **回答: (a) 承認（設計どおり、停止に入るときは復帰通知を出さず判定を止める）。(b) 往復抑制の仕組みは不要（入れない）。** → §4.5 の `suspended_transition` と往復抑制なしの明記のとおり。なお確定事項 6 により通知単位が取得元になったため、往復が起きた場合の通知は**その取得元についてのみ**発生する（他取得元は影響を受けない）。

## 10. 実装上の注意・残留リスク

- **`activeSinceAt` の `max` を省略しない。** §4.1 のとおり、これを落とすと夜間停止明けに必ず「異常」が発火する。AC5 がこの回帰を捕まえる。
- **`fetch_attempt.started_at` の辞書順に依存しない。** §2.2-4 のとおりミリ秒の有無で順序が乱れる。窓を取って `Date.parse` で比較する（§4.2）。テストの固定クロックはミリ秒無しになりがちで、本番と挙動が変わりうる。ミリ秒混在のテストケースを必ず入れること。
- **既存ポーリング層を「ついでに」直さない。** 雨雲・キキクルが連続失敗回数を持たない、`AmedasFetchState` が `lastAttemptAt` を持たない、といった非対称は本 Issue では**解消しない**（案 B を採るため不要）。CLAUDE.md 禁止事項 5。
- **`availability` の 3 状態を潰さない。** 取得健全性は別軸である（§4.9）。
- **`emergency` を生成する余地を作らない。** §8.4【確定】で今回は設けない。
- **通知の永続化失敗で `store.commit()` を飛ばさない。** 飛ばすと同じ状態変化を評価周期ごとに再通知し続ける。取得元が 6 本になったため、1 件の記録失敗で 6 本ぶんの `commit` を巻き戻さないこと。
- **通知単位は取得元であり、集約ではない。** `FetchHealthAggregate.status` は表示専用である。通知の `category` をこの値から決めると、遅延にすぎない取得元に「問いかけ」が付く（§4.4、AC3・AC11 変異 2）。
- **`amedas_point` に経過時間条件を当てない。** 当てると正常稼働中に誤検知する（§2.2-10）。取得元定義のフラグで表現し、評価器に取得元 id の `if` を書かない（AC7b・AC11 変異 6）。
- **`amedas_point` の異常検知は最悪 50 分遅れる。** 試行間隔が最大 10 分（`amedasPointRecheckSeconds`）であるため、連続失敗 5 回に到達するまでに時間がかかる。これは確定事項 5 を採った帰結であり、不具合ではない。
- **`apps/api/tests` は `npm run typecheck` の対象外である。** 型で排除したつもりの入力も実行時ガードとテストで担保する。
- **`process` レベルのシングルトンを使わない。** `FetchHealthStateStore` はブートストラップで生成して注入する。テストが並行実行されても独立させる。
- **色・音・文言表現を本 Issue に持ち込まない。** §7.2 の表現案（ピンポーン等）とフロント表示は対象外。通知区分色は #90 の対象。
- **実挙動未確認の事項**: 本設計は既存コードの読み取りと `fetch_attempt` のスキーマ・索引・呼び出し個所の確認に基づく。**実際に上流取得を失敗させた状態での判定・通知の発火は未確認である**（AC12 の手動確認で製造・検収時に初めて実測される）。特に「バックオフ待機によって試行間隔が延びたとき、連続失敗回数条件と経過時間条件のどちらが先に成立するか」は環境依存であり、設計上はどちらでも同じ区分に落ちるよう作ってあるが、実測値は取っていない。
- **評価周期 30 秒は暫定値である。** §8.1 に評価周期の規定はなく、閾値が分オーダーであることから決めた。監視画面の更新周期（§8.3 の「監視画面表示中 5 秒」）とは別物であり、そちらに合わせていない。
