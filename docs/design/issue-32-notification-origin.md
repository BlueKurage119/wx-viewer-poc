# Issue #32 D8. 通知パイプラインでの気象内容／装置異常の区別 設計

対象 Issue: [#32](https://github.com/BlueKurage119/wx-viewer-poc/issues/32)  
対象ブランチ: `feature/issue-32-notification-origin`

## 1. 目的とスコープ

D1（#25）の通知用データ、B4（#8）の通知出力履歴、D4（#28）の気象通知生成、D7（#31）の装置異常系通知生成を横断し、原因系統が `origin: 'weather' | 'system'` で区別されたまま同一の通知出力履歴へ保存されることを統合テストで固定する。

本 Issue は新しいフィールドや第3の値を追加しない。通常処理と初期取得・復旧の区別は既存の `detectionContext: 'normal' | 'initial'` が担い、`origin` とは直交させる。

### 1.1 やること

- 実際の D4 気象通知経路と D7 装置異常通知経路を同一の一時 DB に接続する横断受け入れテストを追加する。
- 気象通知が `origin === 'weather'`、装置異常通知が `origin === 'system'` として、B4 mapper・repository・SQLite を通過後も完全一致で保存されることを確認する。
- B4 の `origin` 検索が、同じテーブルに保存された両原因系統を混同せず分離することを確認する。
- `origin` と `detectionContext` を入れ替えたり、一方から他方を導出したりしていないことを、組合せの異なる実例で確認する。

### 1.2 やらないこと

- `NotificationOrigin`、`Notification`、`NotificationOutputHistoryInput`、DB schema／migration、mapper、repository の変更。
- D4・D7 の判定規則、通知区分、メッセージ文言、通知粒度の変更。
- 装置異常系 `changeType` を共有 union 型へ狭める変更。
- H端末相当モードで装置異常系通知を除外する表示・配信フィルタリング（Epic K9）。
- フロントエンド、通知配信 API、端末セッション、確認・鳴動・受領監視の変更。
- 基本設計の【設計案】【未確定】事項を本 Issue で確定すること。

## 2. 参照資料と確認結果

### 2.1 参照資料

- [Issue #32](https://github.com/BlueKurage119/wx-viewer-poc/issues/32)
- [Issue 化ドラフト](../issues-draft.md) D1、B4、D7、D8
- [基本設計](../basic-design.md) §7.3、§8.4
- [Issue #25 設計](issue-25-notification-data-model.md) — D1 の判別共用体と B4 mapper
- [Issue #8 設計](issue-8-notification-output-history.md) — B4 の `origin`／`detection_context`、永続値、検索条件
- [Issue #103 設計](issue-103-notification-message-definitions.md) — 定義と通知の `origin` 整合検証
- [Issue #28 設計](issue-28-warning-notification-generation-rules.md) — D4 の気象通知生成・永続化経路
- `feature/issue-31-equipment-anomaly-notification` 上の [Issue #31 設計](issue-31-equipment-anomaly-notification.md) と実装 — D7 の装置異常通知生成・永続化経路
- `packages/shared/src/notification.ts`、`packages/shared/src/notification.typecheck.ts`
- `apps/api/src/notifications/notificationOutputHistoryMapper.ts`
- `apps/api/tests/notificationOutputHistoryMapper.test.ts`
- `apps/api/tests/warningNotificationRules.acceptance.test.ts`
- #31 ブランチの `apps/api/src/notifications/fetchHealthNotificationPlanner.ts`、`fetchHealthNotificationEmitter.ts` および対応テスト
- 統括担当から渡された Issue #32 のヒアリング確定事項

### 2.2 既存実装で充足済みの範囲

| 層 | 充足済みの内容 | 根拠 |
|---|---|---|
| D1 共有型 | `NotificationOrigin = 'weather' | 'system'`。`WeatherNotification` は `origin: 'weather'`、`SystemNotification` は `origin: 'system'` の判別共用体 | `notification.ts` と型テスト |
| D1/B4 変換 | mapper が `notification.origin` と `notification.detectionContext` を別々の同名入力へ無加工で写す | `notificationOutputHistoryMapper.ts` |
| B4 DB | `origin` は `weather` / `system` CHECK、`detection_context` は `normal` / `initial` CHECK。両列を独立した検索条件として扱う | migration、repository、schema／repository テスト |
| #103 | 気象定義は `weather`、システム定義は `system` との整合を検証し、不一致を拒否する | `notificationMessageDefinitions.ts` とテスト |
| D4 | 警報・注意報通知を `origin: 'weather'` で生成し、mapper と B4 repository を経て履歴へ保存する | `warningNotificationPlanner.ts`、`warningNotificationEmitter.ts`、受け入れテスト |
| D7（#31） | 取得健全性通知を `origin: 'system'` で生成し、同じ mapper と B4 repository を経て履歴へ保存する | #31 ブランチの planner、emitter、テスト |

既存の mapper テストは手組みした weather／system オブジェクトの保存を確認し、D4 と D7 の各テストは個別経路を確認している。一方、**実際の D4 と D7 の生成器が同一 DB・同一 B4 経路へ出力した結果を並べ、原因系統と検知文脈を横断確認するテスト**はない。この不足だけを D8 の新規作業とする。

### 2.3 ヒアリング確定事項の反映

1. `origin` は既存の `'weather' | 'system'` を正式採用する。
2. 通常／初期取得の区別は `detectionContext` が担う。
3. D8 は重複フィールドの追加ではなく、D1・B4・D7 を横断する統合確認と不足テストの追加を中心とする。
4. H端末表示フィルタリングは対象外とする。
5. 製造は #31 の検収・main 反映後、最新 `main` を本体作業ディレクトリで確認してから AGY へ委託する。

## 3. 設計判断と責務境界

### 3.1 原因系統と検知文脈を二つの軸として保持する

永続値の意味は次で固定済みであり、D8 では変更しない。

| 軸 | 値 | 意味 |
|---|---|---|
| `origin` | `weather` | 気象内容を原因として生成した通知 |
| `origin` | `system` | 取得遅延・異常等を原因として生成した通知 |
| `detectionContext` | `normal` | 通常の取得・更新中に検知した通知 |
| `detectionContext` | `initial` | プロセス起動時の初期評価・復旧で検知した通知 |

`weather + initial` と `system + normal` を同一 DB に保存するケースを必須にする。これにより、旧 §7.3 の `origin` 項目案を誤読して `origin` を `normal` / `initial` に戻す変更や、`origin === 'system'` なら常に `detectionContext === 'initial'` といった誤った従属関係を検出できる。

### 3.2 本番コードを変更しない

型、mapper、DB、D4、D7 は要求をすでに満たす。D8 用の facade、変換関数、列、migration を加えると同じ意味の所有箇所が増えるため追加しない。製造時に受け入れテストが既存実装の欠陥を検出した場合は、AGY が設計外の修正を独断で行わず、再現結果と最小修正候補を統括へ返す。

### 3.3 UI 試作型を正規契約へ混ぜない

`apps/web/src/shell/notifications.ts` の暫定型や H/K 端末の表示条件は、本 Issue の正規通知モデル・保存確認へ接続しない。D8 は「生成・保持は端末種別によらず共通」という §8.4 の保存側境界までを対象とする。

## 4. 変更対象と型／API

### 4.1 変更対象

```text
apps/api/tests/
└── notificationOriginPipeline.acceptance.test.ts  # 新規。D4・D7・B4 横断テスト
```

上記以外は変更しない。特に `packages/shared`、`apps/api/src`、`apps/api/migrations`、`apps/web`、設定、基本設計は変更対象外である。

### 4.2 利用する既存 API

新しい公開型・API は追加しない。テストは次の既存 API を製品コードと同じ順で利用する。

```ts
processWarningTelegramReception(
  connection,
  reception,
  processedAt,
  venueContext,
  emitDeps,
): WarningTelegramProcessingResult;

emitInitialWarningNotifications(
  connection,
  targetArea,
  emitDeps,
): WarningNotificationEmitResult;

emitFetchHealthNotification(
  connection,
  aggregate,
  store,
  deps,
): FetchHealthNotificationEmitResult;

listNotificationOutputHistory(
  connection,
  options?: ListNotificationOutputHistoryOptions,
): NotificationOutputHistory[];
```

気象側は D4 の初期復旧 API を使い `weather + initial` を生成する。装置側は D7 の state store を一度 `normal` で初期化した後、1取得元を `delayed` に遷移させて `system + normal` を生成する。双方の `notificationIdFactory` と clock は固定値を注入し、結果を完全一致で検証できるようにする。

## 5. テスト構成

1. 一時 SQLite DB を作成し、既存 migration を適用する。
2. 検証用の VPWS50 発表電文を受信履歴へ保存し、D4 の現況構成を行う。初期通知 tracker を新規作成して `emitInitialWarningNotifications` を呼び、1件の気象通知を生成する。
3. D7 の全取得元 `normal` 集約を emitter に渡して state store を初期化する。この評価では通知が0件であることを確認する。
4. `xml_regular` だけを `delayed` にした集約を同じ emitter・store に渡し、1件の装置異常通知を生成する。
5. 無条件一覧がちょうど2件であり、IDで特定した各履歴が次と完全一致することを確認する。
   - 気象: `origin: 'weather'`、`detectionContext: 'initial'`、`sourceType: 'warning_current'`、気象系 `changeType`、気象メッセージ定義 ID。
   - 装置: `origin: 'system'`、`detectionContext: 'normal'`、`sourceType: 'fetch_health'`、`changeType: 'fetch_delayed'`、`system-data-fetch-delayed`。
6. `{ origin: 'weather' }` と `{ origin: 'system' }` の検索がそれぞれ該当する1件だけを返すことを、行全体または ID 配列の完全一致で確認する。
7. `{ detectionContext: 'initial' }` が気象通知だけ、`{ detectionContext: 'normal' }` が装置通知だけを返すことを確認し、二軸が独立して保存・検索されることを固定する。
8. DB を閉じ、一時ディレクトリを確実に削除する。

テスト用 XML・受信履歴作成 helper は `warningNotificationRules.acceptance.test.ts` の検証済み最小構造に合わせて当該テスト内へ置く。製品コードへの test-only API 追加や既存テスト間の helper import は行わない。期待値を実装の式から複製せず、Issue #25、#8、#28、#31 で確定した外部契約の固定値として記述する。

## 6. 実装手順

1. 製造開始条件（§8）を確認する。
2. `notificationOriginPipeline.acceptance.test.ts` を追加し、§5 の weather／system 横断ケースを実装する。
3. 新規テストの red、対照実験、ミューテーション確認を §7 の手順で行う。
4. 対象テスト、API workspace 全テスト、必須品質コマンドを実行する。
5. 設計外の製品コード変更がないことを `git diff` で確認し、AGY の Walkthrough に結果を残す。

## 7. 受け入れ条件

- [ ] AC1: D4 の実際の初期復旧経路で生成・保存した気象通知が `origin === 'weather'` かつ `detectionContext === 'initial'` である。
- [ ] AC2: D7 の実際の `normal -> delayed` 経路で生成・保存した装置異常通知が `origin === 'system'` かつ `detectionContext === 'normal'` である。
- [ ] AC3: AC1 と AC2 を同一 DB・同一 `notification_output_history` に保存した無条件一覧がちょうど2件で、各通知の ID、`origin`、`detectionContext`、`sourceType`、`changeType`、メッセージ定義 ID／版が期待値へ完全一致する。
- [ ] AC4: `origin: 'weather'` の一覧は気象通知だけ、`origin: 'system'` の一覧は装置異常通知だけを返し、相互混入しない。
- [ ] AC5: `detectionContext: 'initial'` の一覧は気象通知だけ、`detectionContext: 'normal'` の一覧は装置異常通知だけを返す。`origin` と `detectionContext` が独立した軸である。
- [ ] AC6: `NotificationOrigin`、DB schema／migration、mapper、repository、D4、D7、フロントエンド、設定ファイルに変更がない。
- [ ] AC7: `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w packages/shared`、`npm run test -w apps/api` が通る。

### 7.1 新規テストの有効性確認

新規テスト追加後、まず対象テストが通常状態で通ることを確認する。次に意味を変えない対照実験として、検証対象外のローカル変数名またはテスト名だけを一時変更し、テストが引き続き通ることを確認する。その後、次の変異を一つずつ適用して対象テストが失敗することを確認し、各変異を元に戻す。

- D4 planner の `origin: 'weather'` を一時的に `system` 相当へ変える。
- D7 planner の `origin: 'system'` を一時的に `weather` 相当へ変える。
- mapper の `detectionContext` を固定の `normal` 相当へ変える。
- repository の `origin` 検索 bind 値を別値へ変える。

型エラーだけで実行テストへ到達しない変異は、`as` による一時的な型適合を使ってランタイムで KILLED を確認してよい。変異と対照実験はコミットへ残さず、最終 `git diff` に混入していないことを確認する。

## 8. #31 依存と製造開始条件

D8 は D7 の実コードを横断テストへ使用するため、`feature/issue-31-equipment-anomaly-notification` 上だけで先行製造しない。次をすべて満たしてから製造を開始する。

1. #31 の検収が完了し、PR が `main` へマージ済みである。
2. `git merge-base --is-ancestor <#31 のマージコミット> origin/main` が成功する。
3. ユーザーが本体作業ディレクトリへ戻り、最新 `main` から `feature/issue-32-notification-origin` を作成または載せ替えたことを確認する。
4. 本設計書の承認済みコミットが対象ブランチに含まれる。
5. AGY への依頼に、作業ディレクトリ・ブランチ・設計コミット、変更対象がテスト1本のみであること、§7 の自己検証、Walkthrough の最終報告項目を明記する。

#31 マージ後に API 名や D7 の境界が本設計の記載から変わっていた場合は、同等の公開／内部 API への機械的な追従だけを許容する。受け入れ条件や変更範囲が変わる場合は製造を止め、統括へ戻す。

## 9. 後続 Issue への引き継ぎ

### Epic K9（H端末表示フィルタリング）

- 正規の判定軸は `origin === 'system'` とする。`sourceType`、`changeType`、`targets.kind`、`detectionContext`、表示文言の部分一致で装置異常通知を推測しない。
- H端末相当モードでも生成・B4 保存は止めず、表示または配信境界で除外する。
- K端末相当モードでは `weather` と `system` の両方を表示対象とする。

### Epic E／通知配信

- API の検索・配信で原因系統を扱う場合は、既存の `origin` をそのまま公開契約へ写し、第3の別名フィールドを作らない。
- 初期取得通知を区別する場合は `detectionContext` を使い、`origin` の意味を変えない。

### Issue #139（D9 棚卸し）

- 基本設計 §7.3 の項目案では `origin` が通常／初期取得を表す旧記述のままである一方、#8・#25 と本 Issue の確定事項では原因系統を表す。実装の正規契約は `origin`＝原因系統、`detectionContext`＝検知文脈であるため、棚卸し時に基本設計の記述を整合させる。
- §8.4 の H端末表示フィルタリングが未実装であることを、D8 完了を理由に完了扱いしない。

## 10. 未確認事項

追加のユーザー判断を要する未確認事項はない。

製造開始時には、#31 の実際のマージ結果が §4.2 の API 名・export と一致することだけを再確認する。不一致が受け入れ条件や変更範囲へ影響する場合は、AGY が補完せず統括へ具体的な差分を報告する。
