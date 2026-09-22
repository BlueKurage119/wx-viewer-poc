# Issue #193 設計: 保存済み警報現況の高速復旧と復旧状態通知

対象Issue: [#193](https://github.com/BlueKurage119/wx-viewer-poc/issues/193)  
後続の製造ブランチ: `feature/issue-193-database-recovery`  
基準: 設計着手時の作業ツリー

---

## 1. 目的・範囲・確定事項

### 1.1 目的

既存DBを残してAPIサーバーを再起動したとき、保存済み警報電文の全件同期解析がイベントループを長時間占有する問題を解消する。保存済みのストリーム情報・現況スナップショットを検証して再利用し、再構築が必要な範囲だけを新しい電文から探索する。復旧中もHTTP APIを応答可能にし、復旧の開始・完了・遅延・失敗を端末通知経路へ記録する。

### 1.2 ヒアリング済みの確定事項

| # | 論点 | 確定事項 |
| --- | --- | --- |
| 1 | 通知対象期間 | HTTP待受開始後から、全会場の保存済み警報現況復旧完了まで。DBマイグレーションと初回上流取得は対象外。 |
| 2 | 待受前の失敗 | DBを開けない、またはマイグレーションが失敗した場合は端末通知を試みず、ログ出力して異常終了する。 |
| 3 | 復旧方式 | 保存済みストリーム情報と現況スナップショットを整合性検証して再利用する。不足・不整合がある会場／`controlStatus` だけ履歴から再構築する。 |
| 4 | 履歴探索 | 必要な電文種別ごとの候補を新しい順に絞る。訂正・取消、および `normal` / `training` / `test` の復元結果を維持する。単純な最新1件・固定期間制限にはしない。 |
| 5 | 遅延通知 | 復旧開始から60秒。会場別に出力し、各会場・起動世代につき1回。完了または失敗まで同会場へ再通知しない。閾値は設定ファイルで変更可能にする。 |
| 6 | API応答目標 | 復旧中も `GET /api/health` は500ms以内、`GET /api/monitoring/status` は1秒以内。連続リクエストの最大値で判定し、検証データと実行環境を記録する。 |
| 7 | 通知区分 | 開始・完了・遅延は `warning`、失敗は `question`。 |
| 8 | 通知単位 | 開始・完了・遅延・失敗はすべて会場別に通知し、該当会場の端末だけへ配信する。 |

### 1.3 対象外

- DBファイル削除による解決、履歴の自動削除、保持期間変更、原文保存方式の変更。
- DBオープン・マイグレーション失敗の端末通知。
- 初回上流取得の開始・完了・遅延・失敗通知。
- 警報現況以外の保存データの再構築方式変更。
- フロントエンドの新しい画面・表示部品。既存の通知差分APIと通知領域を利用する。
- Worker採用。§8の計測結果が採用条件を満たした場合は後続Issueで扱う。

## 2. 参照資料と設計判断の根拠

| 参照先 | 実物確認と設計判断 |
| --- | --- |
| Issue #193 本文 | 約868MBの調査DB、VPWS50原文合計約411MB。既存復旧は1会場で1分以上完了せず、完了時間・成功は実挙動未確認。全履歴同期解析を前提にしない。 |
| `apps/api/src/server.ts` | `main()` はHTTP待受後に `runInitialSync()` をバックグラウンド起動する。現在は会場ごとに未処理電文再処理→全履歴復旧→初期通知→初回上流取得の順。復旧は初回上流取得より前へ維持し、通知範囲を混在させない。`startServer()` は初期同期完了までresolveする既存テスト契約を維持する。 |
| `apps/api/src/polling/jmaWarningCurrentProcessor.ts` | `rebuildWarningCurrentFromReceptions` は全警報電文を100件ずつ昇順で読み、ページ間にもyieldがない。全 `controlStatus` のストリームを削除して再生成するため、正常な保存状態も毎回作り直す。async化し、検証・限定再構築へ置き換える。 |
| `apps/api/src/repositories/telegramReceptionRepository.ts` | `listWarningTelegramReceptionsForRebuild` は会場・`controlStatus`・電文種別で絞らず、昇順に全原文を返す。復旧専用の降順候補取得へ変更する。 |
| `warningCurrentStreamRepository.ts` / `warningCurrentRepository.ts` | ストリームは `(prefecture_code, area_code, control_status, telegram_type)`、スナップショットは `(area_code, control_status)` 単位。再利用・フォールバックの最小単位を「会場×`controlStatus`」にできる。 |
| `jmaWarningCurrentReducer.ts` と Issue #13設計 | 現況はVPWS50を基礎に個別電文を合成し、取消、訂正、同版競合、`sourceVersion` を扱う。既存reducerと版比較規則を再利用し、復旧専用の簡略規則を作らない。 |
| `packages/shared/src/notificationMessageDefinitions.ts` | 完了・失敗の定義は登録済みだが発火処理はない。開始・遅延の定義を追加し、既存の解決・履歴変換経路を利用する。 |
| `notificationDeltaService.ts` / `notificationVenueScope.ts` | `codeType: 'venue'` のtargetは会場別に配信され、`notification_output_history` の永続行が差分APIから端末へ届く。復旧通知のtargetは会場とする。 |
| `startupProgressTracker.ts` / `monitoringStatusService.ts` | 現在の `venues[].reprocessing` は未処理電文採用判定の進捗であり、保存済み現況復旧の状態ではない。同じフィールドへ意味を混ぜず、新しい `recovery` を会場単位で公開する。 |
| `config/polling.yaml` と `pollingSchedule.ts` | 設定は未知キーを拒否する厳密検証。復旧設定をルート直下に追加し、秒数・yield件数を検証対象にする。 |
| Issue #170 / #171設計 | HTTP早期待受、初期同期のバックグラウンド監視、会場別進捗APIという既存契約を維持する。 |

## 3. 起動シーケンスと状態境界

### 3.1 実行順序

`main()` と `startServer()` の両経路で、HTTP待受成功後の保存済み現況復旧を次の順序に統一する。

1. `waitForServerListening` の完了。
2. 会場ごとに復旧開始状態を記録し、開始通知を永続化する。
3. 未処理警報電文の採用判定を行う。
4. 当該会場の `normal` / `training` / `test` を検証・必要箇所だけ再構築する。
5. 会場の復旧完了状態と完了通知を永続化する。
6. 全会場完了後にのみ、初期警報通知の評価と初回上流取得へ進む。

DB初期化・マイグレーションは1より前なので通知対象外、初回上流取得は6より後なので通知対象外である。`DISABLE_POLLING=true` でも保存済みDBのローカル復旧は行う。上流取得の有効・無効とローカルDB整合性は別責務である。

`createStartupNotificationRuntime().evaluateVenues` が初回上流取得完了時に再度呼ばれる経路では、保存済み復旧を再実行しない。上流取得で受信した電文は通常の `applyWarningCurrentReception` が適用済みであり、ここでは初期通知評価と `initialization.markVenueEvaluated` だけを行う。これにより同一起動世代の二重復旧・二重通知を防ぐ。

### 3.2 会場別状態機械

```text
idle ── start ──> running ── success ──> completed
                       └──── failure ──> failed
running ── threshold経過 ──> running（delayedAtを1回だけ設定）
```

状態はプロセス内の起動世代に属し、会場ごとに独立する。一会場が失敗した場合、その会場を `failed` にして失敗通知をDBへコミットした後、初期同期Promiseをrejectする。後続会場と初回上流取得は開始せず、既存の `watchInitialSync` がサーバーをcloseして異常終了させる。

進捗公開では途中データを完成済みと表現しない。復旧中の既存スナップショット自体はAPIから読み取り可能だが、`venues[].recovery.status === 'running'` を併記する。再構築のDB更新は1つの「会場×`controlStatus`」を同期トランザクションで原子的に置換し、ストリームだけ／スナップショットだけの中間状態を公開しない。

### 3.3 開始・完了・失敗の会場単位

開始・完了・失敗も遅延と同じ会場別とする。実処理・監視状態・失敗境界が会場単位であり、`codeType: 'venue'` を使って該当会場の端末だけに配信する。一会場だけ完了または失敗した場合も、その状態を正確に表現する。

## 4. 復旧アルゴリズム

### 4.1 公開シグネチャ

`apps/api/src/polling/jmaWarningCurrentProcessor.ts`:

```ts
export interface WarningCurrentRecoveryOptions {
  readonly yieldEveryParsedReceptions: number;
  readonly yieldControl?: () => Promise<void>;
  readonly onProgress?: (progress: WarningCurrentRecoveryProgress) => void;
}

export interface WarningCurrentRecoveryProgress {
  readonly venueId: VenueId;
  readonly controlStatus: ControlStatus;
  readonly phase: 'validating' | 'searching' | 'committing';
  readonly parsedReceptionCount: number;
  readonly reused: boolean | null;
}

export interface WarningCurrentRecoveryStatusResult {
  readonly controlStatus: ControlStatus;
  readonly outcome: 'reused' | 'rebuilt' | 'uninitialized';
  readonly parsedReceptionCount: number;
  readonly selectedReceptionIds: readonly number[];
}

export interface WarningCurrentRecoveryResult {
  readonly venueId: VenueId;
  readonly statuses: readonly WarningCurrentRecoveryStatusResult[];
  readonly parsedReceptionCount: number;
  readonly elapsedMs: number;
}

export async function recoverWarningCurrent(
  connection: DatabaseConnection,
  venue: VenueWarningContext,
  options: WarningCurrentRecoveryOptions,
): Promise<WarningCurrentRecoveryResult>;
```

既存の同期関数 `rebuildWarningCurrentFromReceptions` は呼び出し元とテストを移行して廃止する。復旧結果はnormalだけに縮退させず、3つの`controlStatus`を明示的に返す。

既定の `yieldControl` はNodeの `setImmediate` をPromise化したものとし、テストではスパイを注入できる。`yieldEveryParsedReceptions` 件のXML解析ごと、および各`controlStatus`の境界で必ずawaitする。SQLiteの同期トランザクション中にはyieldしない。

### 4.2 保存済み状態の整合性検証

各「会場×`controlStatus`」について次をすべて満たす場合だけ `reused` とする。

1. 保存済みストリームのキーが対象会場・対象`controlStatus`と一致し、電文種別の重複・未知値がない。
2. 各ストリームの`receptionId`が存在し、原文・`contentHash`・`reportDateTime`・`controlDateTime`を持つ。受信行の各値がストリーム保存値と一致する。
3. 指し先原文を既存 `parseWarningTelegram` で解析でき、対象会場に適用され、解析結果の`controlStatus`・`telegramType`・時刻・hashがストリームと一致する。未知InfoType、非取消電文の未対応Kind、同版競合を許容しない。
4. VPWS50がない場合、スナップショットが存在しないこと。この場合、個別ストリームだけが整合していれば `uninitialized` として再利用する。
5. VPWS50がある場合、保存ストリームから既存`reduceWarningCurrent`と`computeSourceVersion`で期待スナップショットをメモリ上に構成し、保存スナップショットのtelegram metadata、metadata、itemsが完全一致する。DBの行IDだけは比較対象外とする。

検証は各ストリームが指す原文だけを解析する。上限は現行8電文種別×3 status×会場数であり、履歴総件数に比例しない。不一致を見つけても正常な別statusは破棄しない。

### 4.3 不足・不整合statusの候補探索

`apps/api/src/repositories/telegramReceptionRepository.ts` に次を追加し、従来の全履歴昇順APIを置き換える。

```ts
export interface WarningRecoveryCandidateCursor {
  readonly reportDateTime: string;
  readonly controlDateTime: string;
  readonly id: number;
}

export function listWarningRecoveryCandidates(
  connection: DatabaseConnection,
  input: {
    readonly controlStatus: ControlStatus;
    readonly telegramType: WarningTelegramType;
    readonly before?: WarningRecoveryCandidateCursor;
    readonly limit: number;
  },
): WarningTelegramRebuildPage;
```

SQLは `telegram_type = ? AND control_status = ? AND raw_body IS NOT NULL AND report_datetime IS NOT NULL AND control_datetime IS NOT NULL` で絞り、`ORDER BY report_datetime DESC, control_datetime DESC, id DESC` のkeyset paginationとする。この検索を支える複合インデックスをマイグレーションで追加する。`OFFSET`と固定期間条件は使わない。

各必要電文種別について、新しい候補から解析し、対象会場に適用できる最初の版を採用する。ただし同じ`reportDateTime`・`controlDateTime`の候補は全件確認し、異なるhashの対象会場向け電文が複数あれば既存と同じ `WarningCurrentConflictError` とする。対象会場外・解析不能・未知InfoType・未対応Kindは飛ばし、古い候補へ進む。このため通常は少数で停止しつつ、必要なら期間制限なしに古い履歴まで探索できる。

全電文種別の候補を得た後、既存reducerで訂正・取消を含めて合成する。VPWS50が見つからない場合は個別ストリームだけを保存し、スナップショットを削除して `uninitialized` とする。選択結果の書き込みは対象statusの1トランザクションで、既存ストリーム・スナップショットを置換する。探索中にDBを書き換えない。

### 4.4 インデックス

新規マイグレーションで次と同等の索引を作る。

```sql
CREATE INDEX idx_telegram_reception_warning_recovery
ON telegram_reception (
  control_status,
  telegram_type,
  report_datetime DESC,
  control_datetime DESC,
  id DESC
)
WHERE raw_body IS NOT NULL
  AND report_datetime IS NOT NULL
  AND control_datetime IS NOT NULL;
```

実際のマイグレーション番号は製造時の末尾番号に従う。`EXPLAIN QUERY PLAN` で候補SQLがこの索引を使い、一時B-treeによる全件sortをしないことを検証する。

## 5. 復旧状態の公開

`packages/shared/src/monitoringStatus.ts`:

```ts
export type MonitoringWarningRecoveryPhase =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed';

export interface MonitoringWarningRecoveryStatus {
  readonly status: MonitoringWarningRecoveryPhase;
  readonly startedAt: UtcIso8601String | null;
  readonly finishedAt: UtcIso8601String | null;
  readonly delayedAt: UtcIso8601String | null;
  readonly elapsedMs: number | null;
  readonly currentControlStatus: ControlStatus | null;
  readonly completedControlStatuses: readonly ControlStatus[];
  readonly reusedControlStatuses: readonly ControlStatus[];
  readonly rebuiltControlStatuses: readonly ControlStatus[];
  readonly parsedReceptionCount: number;
  /** 外部へ例外詳細を漏らさず、失敗の有無だけを表す。 */
  readonly errorCode: 'warning_current_recovery_failed' | null;
}

export interface MonitoringVenueSection {
  // 既存フィールドは維持
  readonly recovery: MonitoringWarningRecoveryStatus;
}
```

`apps/api/src/monitoring/warningCurrentRecoveryTracker.ts`:

```ts
export interface WarningCurrentRecoveryTracker {
  start(venueId: VenueId, startedAt: UtcIso8601String): void;
  progress(venueId: VenueId, progress: WarningCurrentRecoveryProgress): void;
  markDelayed(venueId: VenueId, delayedAt: UtcIso8601String): boolean;
  complete(venueId: VenueId, result: WarningCurrentRecoveryResult, finishedAt: UtcIso8601String): void;
  fail(venueId: VenueId, finishedAt: UtcIso8601String): void;
  getStatus(venueId: VenueId, now: UtcIso8601String): MonitoringWarningRecoveryStatus;
}
```

`markDelayed` は当該会場が`running`かつ未通知の場合だけ`true`を返す。`elapsedMs`はrunning中も`now - startedAt`で更新して返す。既存の`reprocessing`は未処理電文の採用判定を表すため変更しない。

`GET /api/monitoring/status?terminalId=...` は従来のトップレベル構造を保ち、`venues[]`内への追加だけとする。復旧中・失敗時にもDB読み取りと状態取得だけで応答し、復旧Promiseをawaitしない。

## 6. 通知設計

### 6.1 通知定義

`NotificationMessageDefinitionId` と定義表へ次を追加する。

| definitionId | category | title | target | action |
| --- | --- | --- | --- | --- |
| `system-database-initialization-started` | warning | DB初期化開始 | 会場名 | なし |
| `system-database-initialization-delayed` | warning | DB初期化遅延 | 会場名 | なし |
| `system-database-initialized`（既存） | warning | DB初期化完了 | 会場名 | なし |
| `system-database-initialization-failed`（既存） | question | DB初期化異常終了 | 会場名 | 確認 |

既存IDの互換性を優先し、表示上の「DB初期化」は保存済み警報現況復旧を指す。開始・遅延・完了に詳細文は付けない。失敗は内部例外・パス・SQLを漏らさず、既存固定文言と会場名だけを出す。詳細はサーバーログへ記録する。

### 6.2 通知事実・Planner・Emitter

`apps/api/src/notifications/databaseRecoveryNotificationPlanner.ts`:

```ts
export type DatabaseRecoveryEvent = 'started' | 'completed' | 'delayed' | 'failed';

export interface PlanDatabaseRecoveryNotificationInput {
  readonly event: DatabaseRecoveryEvent;
  readonly venueId: VenueId;
  readonly serverGenerationId: string;
  readonly occurredAt: UtcIso8601String;
  readonly notificationIdFactory: () => string;
}

export function planDatabaseRecoveryNotification(
  input: PlanDatabaseRecoveryNotificationInput,
): PlannedDatabaseRecoveryNotification;
```

通知事実は次の固定値を使う。

- `origin: 'system'`
- `sourceType: 'database_recovery'`
- `sourceVersion: serverGenerationId`
- `changeType`: `database_recovery_started` / `completed` / `delayed` / `failed`
- `targets: [{ kind: 'equipment', codeType: 'venue', code: venueId, name: 会場表示名 }]`
- `detectionContext: 'initial'`, `isTraining: false`
- `relatedRefs: [{ type: 'server_generation', ref: serverGenerationId }]`

Emitterは既存 `toNotificationOutputHistoryInput` と `recordNotificationOutputHistory` を使い、1通知を1トランザクションで永続化する。ただし操作通知のように例外を握り潰してはならない。復旧状態の通知は要件そのものなので、開始・完了・遅延・失敗の記録失敗をログ出力し、当該会場の復旧失敗として初期同期をrejectする。失敗通知自身の記録に失敗した場合は再帰的に再通知せず、ログと異常終了にする。

### 6.3 遅延タイマーと重複抑制

会場の開始直後に `setTimeout(thresholdSeconds * 1000)` を1本登録する。callbackはTrackerの`markDelayed`が`true`のときだけ遅延通知を記録する。完了・失敗時はtimerをclearする。イベントループが混雑して閾値を超えてcallbackが遅れた場合も、`occurredAt`は「実際に遅延と判定した時刻」、閾値は状態上の`startedAt`との差で判定する。

重複抑制は起動世代内のTrackerで `(serverGenerationId, venueId, event)` を一度だけ発火可能にする。さらに `notificationId` は `database-recovery:${serverGenerationId}:${venueId}:${event}` と決定的に生成し、同じイベントの再入を同一IDとして扱う。`notification_output_history.notification_id` に一意制約は追加しない（既存通知全体への影響を避ける）が、Emitter単体テストで同じイベントを2回渡しても2行目を記録しない。

失敗通知はcloseより前にコミットする。現在接続中の端末がclose前にポーリングできること自体は保証せず、永続化した履歴を次回起動後も通知差分APIから取得可能にすることで配送を保証する。確認操作が必要な`question`として端末へ届く既存経路は変更しない。

## 7. 設定

`config/polling.yaml` のルートへ次を追加する。

```yaml
startupRecovery:
  delayedThresholdSeconds: 60
  yieldEveryParsedReceptions: 25
  candidatePageSize: 100
```

`PollingScheduleConfig`へ同形の`startupRecovery`を追加し、未知キーを拒否する既存の厳密検証を維持する。3値は正の安全整数、`candidatePageSize`は1〜100、`yieldEveryParsedReceptions`は1〜100とする。遅延閾値の初期値は確定事項どおり60秒である。設定ファイル欠落・不正は既存と同様、DBオープン・HTTP待受より前に異常終了し、端末通知対象外とする。

テストではタイマー・clock・yield関数を注入し、60秒を実時間待機しない。

## 8. 計測とWorker採否

### 8.1 必須計測

Issue本文の規模に相当する匿名化またはfixture拡張DBを用い、変更前・変更後で次を同じマシン・Node.js版・DBファイル・電源条件で計測する。

- DBファイルサイズ、警報原文件数・合計bytes、会場数、`controlStatus`別・電文種別別件数。
- HTTP待受から全会場復旧完了までのwall time。
- 会場・status別の `reused` / `rebuilt`、候補取得件数、XML解析件数、yield回数、所要時間。
- 復旧中に各APIへ1秒間隔で最低20回連続要求したときの全応答時間と最大値。平均値・p95だけで合否にしない。
- 復旧前後のストリーム・スナップショット一致結果。

計測結果はPR本文または検収記録に、実行日時、OS、CPU、メモリ、Node.js版、SQLite実装版、DB条件、実行コマンドとともに残す。調査DBでの変更前完了時間は実挙動未確認なので、推測値を基準にしない。

### 8.2 Worker判断

本IssueではWorkerを採用しない。理由は、通常再起動を履歴総量に比例しない保存状態検証へ変え、フォールバックも候補を絞り、XML解析間でyieldすれば、まず主因を小さい変更面積で除去できるためである。またbetter-sqlite3のconnectionをWorkerへ共有できず、原文転送・別connection・結果の原子反映・停止処理が追加で必要になる。

次のいずれかを同一条件で再現した場合、後続IssueでWorkerを採用候補にする。

- yield間隔を25件以下にしても `/api/health` 最大500msまたは監視API最大1秒を超える。
- 候補探索が十分絞られているのに、単一XML解析または合成のCPU占有だけで500msを超える。
- yieldを細かくすると復旧時間が実運用上許容できず、応答性との両立ができない。

## 9. 失敗時経路と終了契約

- DBオープン・マイグレーション・設定検証失敗: 待受前。従来どおりログ＋異常終了。通知なし。
- 待受後の会場復旧失敗: Trackerを`failed`にし、会場別失敗通知を永続化してから例外を再throwする。`watchInitialSync`が`close()`し`process.exitCode = 1`にする。
- 遅延通知記録失敗: 復旧Promiseへ伝播できるよう、timer callbackの失敗を会場の復旧監視Promiseと競合させる。未処理Promise rejectionを作らない。
- SIGTERM/SIGINT: 既存`closed`中断点を尊重する。運用者停止は復旧失敗に数えず、DB復旧失敗通知を生成しない。登録済みtimerをclearする。
- statusの置換トランザクション失敗: rollbackにより変更前のストリーム・スナップショットを保持する。失敗状態・通知の記録はrollback後に別トランザクションで行う。

## 10. 変更モジュール一覧

| ファイル | 変更内容 |
| --- | --- |
| `config/polling.yaml` | `startupRecovery` 初期値。 |
| `apps/api/src/config/pollingSchedule.ts` とテスト | 設定型・厳密検証。 |
| `apps/api/migrations/<next>_add_warning_recovery_index.sql` | 候補探索用部分複合索引。 |
| `apps/api/src/repositories/telegramReceptionRepository.ts` | status・type別降順keyset候補取得。 |
| `apps/api/src/polling/jmaWarningCurrentProcessor.ts` | async検証・限定再構築・yield・計測結果。 |
| `apps/api/src/monitoring/warningCurrentRecoveryTracker.ts` | 会場別状態と重複抑制。 |
| `packages/shared/src/monitoringStatus.ts` | `venues[].recovery` DTO。 |
| `apps/api/src/monitoring/monitoringStatusService.ts` | Tracker状態公開。 |
| `packages/shared/src/notificationMessageDefinitions.ts` | 開始・遅延定義と型。 |
| `apps/api/src/notifications/databaseRecoveryNotificationPlanner.ts` | 通知事実・出力決定。 |
| `apps/api/src/notifications/databaseRecoveryNotificationEmitter.ts` | 履歴永続化と起動世代内重複抑制。 |
| `apps/api/src/server.ts` | 待受後・上流取得前の復旧オーケストレーション、timer、失敗伝播。 |
| 関連する `apps/api/tests/**`、`packages/shared/tests/**` | 以下の受け入れ条件を自動化。 |

## 11. 受け入れ条件

- [ ] **AC1 保存状態再利用**: `normal` / `training` / `test`それぞれに整合したストリームとスナップショットを持つfixture DBで`recoverWarningCurrent`を実行する。全statusが`reused`、書き込み前後の関連テーブルdumpが完全一致、XML解析件数が保存ストリーム数以下、全履歴候補SQLの呼び出し0なら合格。
- [ ] **AC2 status単位フォールバック**: 片会場の`training`スナップショットだけを意図的に不整合にする。他会場と同会場の`normal` / `test`は`reused`、当該`training`だけ`rebuilt`となり、再利用statusの行が完全一致すれば合格。
- [ ] **AC3 候補絞り込み**: 十分な旧履歴の後に各電文種別の有効な最新候補を置き、候補SQLの`EXPLAIN QUERY PLAN`が新規索引を使用すること、探索が有効候補を得た版より古いページを読まないこと、`OFFSET`・期間条件を使わないことを確認する。
- [ ] **AC4 意味保存**: 発表→訂正、個別電文取消、VPWS50取消、同版同hash重複、同版異hash競合を含むfixtureで、変更前の全履歴再構築の期待値として固定したstream・snapshotを、変更後の`normal` / `training` / `test`すべてで完全一致比較する。同版異hashは同じ例外種別で失敗すれば合格。
- [ ] **AC5 欠損ケース**: 空DB、VPWS50なしで個別電文のみ、stream指し先欠損、rawBody欠損、hash不一致、snapshot欠損、snapshot item不一致を個別に実行する。空DBは3statusとも`uninitialized`、VPWS50なしはsnapshotなし、その他は該当statusだけ再構築されれば合格。
- [ ] **AC6 中断再起動**: status置換トランザクション内で例外を注入し、変更前状態がrollbackされることを確認する。同じDBで再起動相当の復旧を行い、期待状態まで完了すれば合格。
- [ ] **AC7 yield**: 解析対象251件、`yieldEveryParsedReceptions=25`、spy `yieldControl`で復旧する。解析中に10回以上yieldされ、status境界でもyieldされること。yield前後で選択結果が変わらなければ合格。
- [ ] **AC8 API最大応答時間**: §8.1の環境・データ条件を記録し、復旧中に`GET /api/health`と`GET /api/monitoring/status?terminalId=hkeagh01`を各最低20回連続実行する。全HTTP statusが200、最大値がそれぞれ500ms以下・1000ms以下なら合格。平均やp95だけの提示は不合格。
- [ ] **AC9 復旧時間・削減効果**: 同じDBで変更前・変更後の復旧wall time・候補取得件数・XML解析件数を記録する。変更後の整合DBで解析件数が履歴総数ではなく保存ストリーム数以下となり、変更前より解析件数が減ること。数値と環境を検収記録へ残す。
- [ ] **AC10 監視状態**: 制御可能なPromiseで復旧を停止し、監視APIの該当会場が`running`、現在status、解析件数、開始時刻を返し、別会場は独立状態であることを確認する。status commit前はcompletedにならず、完了後は`completed`とreused/rebuilt一覧、失敗時は`failed`と固定errorCodeを返すこと。
- [ ] **AC11 通知区分・会場配信**: 1起動世代で2会場を復旧し、開始・完了の履歴が各会場1行、`warning`、`sourceType='database_recovery'`、`sourceVersion=serverGenerationId`、`codeType='venue'`となること。east端末の差分APIにはeast行だけ、trc端末にはtrc行だけ届くこと。
- [ ] **AC12 遅延60秒・重複抑制**: fake timerで会場復旧を59,999ms停止して遅延0行、60,000msで遅延1行を確認する。さらに120秒進めても同会場・同世代は1行のまま。別会場は独立に1行、完了／失敗後にtimerを進めても追加0行なら合格。
- [ ] **AC13 閾値設定**: 一時設定で`delayedThresholdSeconds: 3`とし3秒で通知されることを確認する。0、負数、小数、文字列、未知キー、`candidatePageSize: 101`は設定検証で待受前に失敗し、通知履歴0行なら合格。
- [ ] **AC14 失敗通知・確認操作**: 待受後の各段階（検証、候補取得、parse/reduce、commit）で例外を注入する。当該会場に失敗履歴が1行だけ、`question`、`ackRequired=true`、既存失敗definition、会場targetで記録され、その後初期同期が異常終了し初回上流取得を開始しないこと。再度同イベントをemitしても行が増えないこと。
- [ ] **AC15 待受前失敗**: 不正設定、DBオープン失敗、マイグレーション失敗をそれぞれ起こし、HTTP待受なし、通知履歴への書き込み試行なし、ログ＋非0終了となること。
- [ ] **AC16 永続配送**: 復旧失敗通知のcommit直後にプロセスを終了し、同じDBで再起動する。端末の既存cursor以降を通知差分APIで取得すると失敗通知が1件届き、解決済みmessage snapshotから「確認」操作が表示可能であること。
- [ ] **AC17 初回上流取得との境界**: 上流fetch spyを使い、全会場の完了通知commitまでは呼び出し0、完了後に初回取得が始まること。初回取得の成功・失敗でDB復旧通知が増えないこと。
- [ ] **AC18 `DISABLE_POLLING`**: `DISABLE_POLLING=true`かつ既存DBで起動し、上流fetch 0回のまま復旧開始・完了通知、整合検証、監視状態更新が行われること。
- [ ] **AC19 回帰テスト**: `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api`、`npm run test -w packages/shared`がすべて成功すること。
- [ ] **AC20 Worker判断記録**: §8.1の結果と3つの採用条件への該当有無を検収記録へ明記する。目標内なら「Worker不採用」、目標超過なら本Issueで場当たり的に追加せず、再現条件と後続Issue案を記録する。

## 12. 実装順序

1. 設定型・検証、候補索引、降順候補リポジトリとテスト。
2. 保存状態検証・status限定再構築・yieldとアルゴリズム単体テスト。
3. Trackerと監視DTO・監視サービス結線。
4. 通知定義、Planner、Emitter、重複抑制テスト。
5. `server.ts` の両起動経路へ、待受後・上流取得前の復旧オーケストレーションを結線。
6. 結合・失敗・性能受け入れ条件を検証し、Worker採否を記録。

## 13. 後続Issueへの引き継ぎ

- 本Issueの実測で§8.2の条件に該当した場合、XML parse/reduceをWorkerへ分離するIssueを起票する。その際、better-sqlite3 connectionは共有せず、メインスレッドが候補原文を読み、Workerが純粋解析し、メインスレッドが原子的にcommitする境界を再設計する。
- 履歴保持期間・原文圧縮・削除は本Issueの候補探索とは独立して判断する。
- 監視画面で`venues[].recovery`を明示表示するUIは別Issueとする。API型は本Issueで提供する。
- 実測用の大容量DBそのものはリポジトリへ追加しない。生成手順または統計値だけを検収記録へ残す。

## 14. 実挙動未確認

- Issue本文の約868MB DBで、既存処理が最後まで完了する時間と復旧成功は未計測。
- 同DBにおける本設計の保存済みstream/snapshot整合率、フォールバック解析件数、最大API応答時間は実挙動未確認。§11 AC8・AC9で確認する。
- プロセス終了直前に現在接続中の端末が失敗通知を受信できるタイミングは端末のポーリング周期に依存し、即時到達は実挙動未確認。設計上の保証は履歴の先行commitと次回起動後の差分配送（AC16）で行う。

## 15. 要ヒアリング事項

なし。
