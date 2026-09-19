# Issue #178 設計書: 停止中の強制更新がXML取得を行わず成功を返す問題の解消

対象Issue: #178（親: #168、関連: #174 / PR #177）
ブランチ: `fix/issue-178-manual-refresh-while-stopped`

## 1. 目的と範囲

### 1.1 やること

- **停止中（中断フラグが立ったまま）でも、強制更新（`pollOnce('manual')`）が実際にXML取得を行う**ようにする。手動サイクル専用の中断シグナルを設け、`stop()` による中断状態を手動サイクルが引き継がない構造にする。
- **強制更新後も自動取得は再開しない**ことを維持する（`start()` 相当を行わない。`isRunning`・定期タイマー・世代・`lastCompletedAt` を変えない）。
- **手動サイクルの実行中に `stop()`・シャットダウンが来たら、電文境界で手動サイクルを中断する。**
- **シャットダウン中（`stop('shutdown')` 済み）は、強制更新の手動サイクルを新規に走らせない。**
- **「取得していないのに成功」を返さない。** 手動サイクルの結果が空、または `'aborted'` を含む場合は成功扱いにせず、取得失敗（`force_refresh_failed`）とは区別できる `errorCode` を記録する。
- **中断専用の通知定義 `system-force-fetch-aborted` を新設**し、中断された強制更新が「強制取得失敗」として通知されないようにする（確定事項(7)）。
- 停止（中断）途中のサイクルへ手動サイクルが合流したときの扱いを確定する。

### 1.2 やらないこと

- **非XML取得元（ナウキャスト・キキクル・アメダス）への中断機構の追加**。確定事項(5)により、既存の `adapter.runManual()` 経路は変更しない。
- **`result` の3値化**（`'success' | 'failure' | 'aborted'`）。確定事項(3)により行わない。`operation_history.result` は2値のままとし、中断は `errorCode` で区別する。
- **DBスキーマ・migration・`operationHistoryRepository` / `notificationOutputHistoryRepository` の変更**（確定事項(4)）。
- **`apps/web`（フロント）の変更**。確定事項(7)の調査により、フロントは `NotificationMessageDefinitionId` を参照していないため波及しない。K端末の取得制御UIも本Issueの対象外。
- **API応答の `result` 契約の変更**。中断は `result: "failure"` + `errorCode` で表す。
- **`AbortSignal` を HTTP 取得へ通すこと**（#174 §1.2 の方針を踏襲。中断判定は電文境界のみ）。
- **K端末（フロント）側のUI実装**。本Issueはサーバー側のみ。
- **`docs/basic-design.md` の改訂**。確定事項(1)により、§8.1 の「強制更新は停止中でも実行できるが、自動取得は再開しない」【設計案】どおりの挙動へ戻す変更であり、記述の改訂は不要。
- **`fetchControlService` の `lane` 直列化の変更**。確定事項(6)により現状維持する（§4.8）。
- **設計担当による `docs/design/issue-103-notification-message-definitions.md` の編集**。設計担当の権限外のため、必要な追記内容を §4.6.4 に製造担当向けの指示として書くにとどめる。

## 2. 参照した資料と、設計判断の根拠

| 参照 | そこから導いたこと |
| --- | --- |
| 統括担当から渡された確定事項(1)〜(5)（1回目） | 手動サイクルのみ中断状態を無視／自動取得は再開しない／手動サイクルも `stop`・シャットダウンで中断可能／空・`aborted` を成功にしない（B-軽量）／`result` は2値のまま `errorCode` で区別／非XMLは対象外 |
| 統括担当から渡された確定事項(6)〜(8)（2回目・本改訂） | (6) `lane` 直列化は維持（§8-1 の(a)案。§4.8 で決定済みとして記載）／(7) 中断専用の通知定義を新設する（当初の「通知プランナ・共有型は変更しない」を撤回）／(8) `force_refresh_aborted` は停止中断とシャットダウン中拒否を分けずまとめる |
| `packages/shared/src/notificationMessageDefinitions.ts` L10-36・L327-345・L415-440 | 定義IDは型ユニオン＋`MESSAGE_DEFINITIONS`（`satisfies Record<NotificationMessageDefinitionId, …>` で網羅が強制される）の2か所。`fixedContent` を持たない定義でも `detail` はそのまま `content` になる（L421-422）。`actionResolution: {kind:'none'}` は `ackRequired: false` を与える（L426-440） |
| `docs/design/issue-103-notification-message-definitions.md` §5.2（L245-261） | システム通知の定義一覧表。列は「定義 ID / category / ① title / ②対象 / ③固定内容 / 操作」。`system-force-fetch-completed` が本Issueの手本 |
| `apps/api/src/polling/jmaXmlPollingService.ts` L142・L365・L394・L422・L676 | 中断コントローラが**サービスに1個だけ**で、`start()` でのみ `reset()` される。`executePollCycle()` のフィードループ先頭（L365）で `break` するため停止中の手動サイクルは `feedResults` が空になる |
| `apps/api/src/polling/jmaXmlPoller.ts` L186-192・L364 | 電文ループ先頭で `abortSignal.aborted` を見て `break` し、`feedFetchOutcome: 'aborted'` を返す |
| `apps/api/src/polling/timeBasedPollingScheduler.ts` L197-250 | `runManualOnce()` は `feedFetchOutcome === 'failure'` のみ失敗とみなす。空の `feedResults` は素通りする（本Issueの直接原因） |
| `apps/api/src/services/fetchControlService.ts` L29-36・L251-283・L374-399 | `ForceRefreshFailedError` / `runForceRefresh()` / `activeForceRefresh` による合流と `lane` による直列化 |
| `apps/api/src/server.ts` L304-309・L647-653・L723-752 | 強制更新の呼び出し元は2か所（本番用・テスト用の2つの生成経路）。`close()` は `pollingService.stop('shutdown')` → `scheduler.stop()` の順 |
| `apps/api/src/repositories/operationHistoryRepository.ts` L64-65 | `errorCode` は非空文字列であればよく、列挙制約もDBの CHECK 制約もない。新しい値の追加に migration は不要（確定事項(4)の裏付け） |
| `apps/api/src/notifications/operationNotificationPlanner.ts` L22-30・L84-95 | `force_refresh` は `result !== 'success'` で `system-force-fetch-failed` 通知（`category: 'question'`・確認応答必須）を出す。`PlanOperationNotificationInput` は `failureDetail` しか持たず `errorCode` を受け取らないため、中断の判別には入力の拡張が必要（§4.6.3） |
| `apps/api/src/polling/jmaXmlFeeds.ts` L71-84 | `trigger: 'manual'` の対象は `high_frequency` フィード（`regular`・`extra`）のみ。長期フィードは含まない |
| `docs/design/issue-174-abort-fetch-on-stop.md` §3.4・§4.3・§6 | 電文境界中断の実測値（1件あたり約620ms、最悪は `performHttpGet` 既定タイムアウト10秒＋1件分＝約10.6秒）と「15秒以内」の受け入れ条件 |

## 3. 現状の不具合の構造（コード上の事実）

```
POST /api/control/fetch/stop
  └─ scheduler.stop() → xmlPollingService.stop('stop')
       └─ abortController.abort('stop')     ← 以後 start() まで解除されない

POST /api/control/fetch/force-refresh
  └─ scheduler.runManualOnce()
       └─ xmlPollingService.pollOnce('manual')
            └─ executePollCycle('manual')
                 └─ for (feedDef of feedDefs) { if (signal.aborted) break; }  ← 即 break
                      ⇒ feedResults = []
       └─ hasFailedFeed = [].some(...) === false  ⇒ failedSources = []
  └─ ForceRefreshFailedError を投げない ⇒ result: "success"
```

- 中断フラグの生存期間が「`stop()` から次の `start()` まで」であるのに対し、手動サイクルは「その1回のサイクルの間だけ」中断可能であるべき。**スコープの不一致が原因**である。
- 空の `feedResults` を成功と判定する `runManualOnce()` が、この不一致を隠蔽している。

**実挙動未確認**: 本設計書の作成にあたり、設計担当はサーバーの起動・実測を行っていない。上記は Issue #178 本文に記載された #174 検収時の実測（stop 直後の force-refresh で `fetch_attempt` が 15185→15185 と増えず、応答は成功）とコード読解に基づく。実挙動の確認は §6 の受け入れ条件で検収担当が行う。

## 4. 設計

### 4.1 変更対象ファイルと責務

| ファイル | 変更内容 |
| --- | --- |
| `apps/api/src/polling/jmaXmlPollingService.ts` | 手動サイクル専用の `FetchAbortController` を追加。`executePollCycle()` が trigger に応じて使うシグナルを選ぶ。`pollFeeds()` の合流条件に中断状態を加える。`stop()` は両方を `abort()`。シャットダウン要求時は手動サイクルを開始しない |
| `apps/api/src/polling/timeBasedPollingScheduler.ts` | `ManualRunResult` に `abortedSources` を追加。`runManualOnce()` の XML 判定に「空」「`aborted` を含む」を追加 |
| `apps/api/src/services/fetchControlService.ts` | `ForceRefreshAbortedError` を新設・export。`runForceRefresh()` で捕捉し `errorCode: 'force_refresh_aborted'` を返す。`planOperationNotification()` の呼び出し（L332付近）へ `errorCode` を渡す |
| `apps/api/src/server.ts` | 強制更新の2か所（L304-309 / L647-653）で `abortedSources` を検査し `ForceRefreshAbortedError` を投げる |
| `packages/shared/src/notificationMessageDefinitions.ts` | 定義ID型ユニオンと `MESSAGE_DEFINITIONS` に `system-force-fetch-aborted` を追加（§4.6.2） |
| `apps/api/src/notifications/operationNotificationPlanner.ts` | `PlanOperationNotificationInput` に `errorCode` を追加し、`force_refresh_aborted` の分岐で新定義を選ぶ（§4.6.3） |
| `packages/shared/tests/notificationMessageDefinitions.test.ts` | 新定義のテストを追加（§5） |
| `apps/api/src/polling/fetchAbort.ts` | 変更なし（既存の `FetchAbortController` をもう1インスタンス使うだけ） |
| `apps/api/src/polling/jmaXmlPoller.ts` | 変更なし（シグナルを受け取る口は #174 で既にある） |
| DBスキーマ / migration / `operationHistoryRepository` / `notificationOutputHistoryRepository` / `apps/web` | **変更なし**（確定事項(4)(7)） |

### 4.2 中断シグナルの二重化

`JmaXmlPollingService` の private フィールドに以下を追加する。

```ts
/** 自動取得（initial / scheduled / recovery）用。stop() で abort、start() で reset。既存。 */
private readonly abortController = new FetchAbortController();

/** 手動サイクル（trigger='manual'）専用。手動サイクル開始時に reset、stop() で abort。 */
private readonly manualAbortController = new FetchAbortController();

/** stop('shutdown') を受けたか。以後の手動サイクルを開始しない。start() で解除する。 */
private shutdownRequested = false;
```

トリガ別に使うシグナルを選ぶ内部ヘルパを置く。

```ts
private abortSignalFor(trigger: JmaXmlPollTrigger): FetchAbortSignal {
  return trigger === 'manual' ? this.manualAbortController.signal : this.abortController.signal;
}
```

`executePollCycle()` では、

- フィードループ先頭の中断検査（現行 L365）を `abortSignalFor(trigger)` に差し替える。
- `pollSingleFeed()` への第7引数を `abortSignalFor(trigger)` に差し替える。

これにより、**`stop()` 後も `manualAbortController` は未中断のまま**なので、手動サイクルは 1 件目のフィードから通常どおり取得する。

### 4.3 `stop()` / `start()` の変更

```ts
async stop(reason: FetchAbortReason = 'stop'): Promise<void> {
  this.abortController.abort(reason);
  this.manualAbortController.abort(reason);   // ★追加: 実行中の手動サイクルも電文境界で打ち切る
  if (reason === 'shutdown') {
    this.shutdownRequested = true;            // ★追加
  }
  this.isRunning = false;
  // 以下、タイマー解除・inFlightPollPromise / inFlightStartPromise の await は現行のまま
}

start(startOptions?): Promise<InitialFetchResult> {
  this.abortController.reset();
  this.manualAbortController.reset();         // ★追加（防御的。手動サイクル開始時にも reset する）
  this.shutdownRequested = false;             // ★追加
  this.initialFetchAborted = false;
  // 以下現行のまま
}
```

- `manualAbortController` は**手動サイクルを開始する直前にも必ず `reset()` する**（§4.4）。`stop()` → 手動サイクル開始、という順序でも中断状態を持ち越さないための本質的な担保はこちらであり、`start()` 側の `reset()` は防御的な措置である。
- `abort()` は冪等で理由を上書きしないため、`close()` の `pollingService.stop('shutdown')` → `scheduler.stop()`（既定 `'stop'`）の順でも理由は `'shutdown'` のまま保たれる（#174 §4.4 と同じ性質）。
- `shutdownRequested` を `start()` で解除するのは、テスト等で `stop('shutdown')` 後に `start()` する経路を壊さないため。本番の graceful shutdown 経路では `start()` は呼ばれない。

### 4.4 `pollFeeds()` の合流ルール

現行は「実行中サイクルがあれば無条件に in-flight Promise を返す」。これを次の表のとおりにする。

| 状況 | 手動サイクル（`trigger === 'manual'`）の挙動 |
| --- | --- |
| `shutdownRequested === true` | **サイクルを開始しない。** 空の `PollCycleResult`（`feedResults: []`、`trigger: 'manual'`）を即座に返す。§4.5 により強制更新は中断扱いになる |
| 実行中サイクルがあり、そのサイクルが中断されていない | **現行どおり合流**する（上流取得を重複させない。#43 の意図を維持） |
| 実行中サイクルがあり、中断済み（`abortController.signal.aborted` または `manualAbortController.signal.aborted`） | **合流しない。** 実行中サイクルの解決を待ってから（失敗は握りつぶす）、新規の手動サイクルを開始する |
| 実行中サイクルなし | 新規の手動サイクルを開始する |

手動サイクル以外のトリガ（`initial` / `scheduled` / `recovery`）の合流条件は**変更しない**（現行どおり in-flight があれば合流）。停止中は自動サイクルが起動しないため、手動サイクルへ自動サイクルが合流する状況は停止中には発生しない。

新規の手動サイクルを開始する直前に、

```
this.manualAbortController.reset();
```

を行ってから `executePollCycle('manual', ...)` を呼ぶ。**合流した場合は `reset()` しない**（実行中サイクルの中断状態を他者が壊さないため）。

補足（実装ディテール、設計担当判断）: `pollFeeds()` は現在同期関数として in-flight Promise を返す。「中断済みの in-flight を待ってから新規サイクルを開始する」分岐を入れるため、手動トリガの経路だけ内部の非同期ヘルパ（例 `startManualCycle()`）へ委譲し、`inFlightPollPromise` スロットへの登録タイミングが `await` をまたいでも二重起動しないよう、スロット登録は待機解除後に**同期的に**行うこと。

### 4.5 `runManualOnce()` の結果判定（確定事項(3)）

`ManualRunResult` を拡張する。

```ts
export interface ManualRunResult {
  /** 例外・取得失敗が起きた取得元（順不同）。空なら取得失敗なし。 */
  readonly failedSources: readonly (ScheduledSource | 'xml')[];
  /**
   * 中断により取得を完了できなかった取得元（順不同）。failedSources とは排他で、
   * 同一取得元が両方に入ることはない（取得失敗を優先する）。
   * 現状 'xml' のみが入りうる（確定事項(5): 非XMLは中断機構の対象外）。
   */
  readonly abortedSources: readonly (ScheduledSource | 'xml')[];
}
```

XMLタスクの判定を次の順序にする。

```
result = await xmlPollingService.pollOnce('manual')

1) result.feedResults.some(r => r.feedFetchOutcome === 'failure')  → failedSources.push('xml')
2) else if (result.feedResults.length === 0
            || result.feedResults.some(r => r.feedFetchOutcome === 'aborted'))
                                                                    → abortedSources.push('xml')
3) else                                                             → 正常
例外                                                                → failedSources.push('xml')（現行どおり）
```

- **取得失敗を中断より優先する**（1 が 2 より先）。上流障害という運用上重要な事実を、中断で覆い隠さないため。
- **`feedResults` が空**は「1件も取得に着手しなかった」＝本Issueの症状そのものであり、中断扱いとする。シャットダウン中の拒否（§4.4 第1行）もここに合流する。
- 非XML取得元は判定を変更しない。`abortedSources` には現状 `'xml'` しか入らない。

### 4.6 強制更新APIの結果と通知（確定事項(3)(7)）

#### 4.6.1 専用エラーと `errorCode`

`apps/api/src/services/fetchControlService.ts` に専用エラーを追加する。

```ts
/** §4.6: 強制更新が停止・シャットダウンによる中断で完了しなかったときの専用エラー。 */
export class ForceRefreshAbortedError extends Error {
  constructor(readonly abortedSources: readonly string[]) {
    super(`force refresh aborted for: ${abortedSources.join(',')}`);
    this.name = 'ForceRefreshAbortedError';
  }
}
```

`apps/api/src/server.ts` の強制更新ターゲット（2か所）:

```ts
forceRefresh: async () => {
  if (!scheduler) throw new Error('scheduler is not ready');
  const result = await scheduler.runManualOnce();
  if (result.failedSources.length > 0) {
    throw new ForceRefreshFailedError(result.failedSources);
  }
  if (result.abortedSources.length > 0) {
    throw new ForceRefreshAbortedError(result.abortedSources);
  }
},
```

`runForceRefresh()` の catch に分岐を1つ足す。**`ForceRefreshFailedError` の判定より前に置く**（両者に継承関係を作らない前提だが、順序を固定しておく）。

```ts
if (error instanceof ForceRefreshAbortedError) {
  return {
    completedAt,
    result: 'failure',
    errorCode: 'force_refresh_aborted',
    errorMessage: truncate(error.abortedSources.join(','), MAX_ERROR_MESSAGE_LENGTH),
  };
}
```

| 観点 | 結果 |
| --- | --- |
| `operation_history.result` | `'failure'`（確定事項(3): 2値のまま） |
| `operation_history.error_code` | **`'force_refresh_aborted'`**（取得失敗の `'force_refresh_failed'` と区別） |
| `operation_history.error_message` | 中断された取得元（現状 `'xml'`） |
| API応答 | `POST /api/control/fetch/force-refresh` は HTTP 200 で `result: "failure"`, `errorCode: "force_refresh_aborted"`（`result` 契約は不変） |
| 通知 | **`system-force-fetch-aborted`**（`changeType: 'force_fetch_aborted'`, `category: 'warning'`, 確認応答不要）。§4.6.2〜4.6.3 |

確定事項(8)により、**「停止による中断」と「シャットダウン中の拒否」は `force_refresh_aborted` にまとめる**。両者を分けるための `errorCode` も `errorMessage` の書き分けも行わない。中断理由（`'stop'` / `'shutdown'`）はサーバーログでのみ判別する。

#### 4.6.2 新設する通知定義（`packages/shared/src/notificationMessageDefinitions.ts`）

`NotificationMessageDefinitionId` の型ユニオンに `'system-force-fetch-aborted'` を追加し、`MESSAGE_DEFINITIONS` に次を追加する。追加位置は `'system-force-fetch-completed'` と `'system-force-fetch-failed'` の間とする（`MESSAGE_DEFINITIONS` は `satisfies Record<NotificationMessageDefinitionId, …>` のため、片方だけ足すと型エラーになる。両方に足すこと）。

```ts
'system-force-fetch-aborted': {
  id: 'system-force-fetch-aborted',
  version: '1',
  origin: 'system',
  allowedCategories: ['warning'],
  title: '強制取得中断',
  targetMode: { kind: 'notificationTargetsOmittable' },
  actionResolution: { kind: 'none' },
},
```

統括担当から提案された仕様の妥当性を検証した結果、**すべてそのまま採用する**。根拠は次のとおり。

| 項目 | 値 | 妥当性の根拠 |
| --- | --- | --- |
| `id` / `changeType` | `system-force-fetch-aborted` / `force_fetch_aborted` | 既存の `system-force-fetch-{completed,failed}` / `force_fetch_{completed,failed}` と同じ命名規則。`changeType` は `SystemNotification` 上は自由文字列で、システム通知の matcher は `changeType` を固定しない（#103 §5.2 末尾）ため衝突しない |
| `category` | `warning` | 停止・終了指示に従った正常動作であり、要対応（`question`）にはしない。`allowedCategories: ['warning']` と `buildBaseNotification()` に渡す `category` を一致させること（不一致だと `resolveNotificationMessage` が `notification_mismatch` を投げる） |
| `title` | `強制取得中断` | 既存4文字〜6文字の体言止めに揃う |
| `targetMode` | `notificationTargetsOmittable` | 対象は固定の「防災気象情報」1件のみで、`system-force-fetch-completed` と同じく省略する（`omitTarget: true`） |
| `actionResolution` | `none` | `ackRequired: false` を与える（同ファイル L426-440）。確認応答を求めない |
| `fixedContent` | **持たせない** | #103 §5.2 の表でも強制取得系の「③固定内容」は「なし」 |
| `detail` | **渡さない** | `fixedContent` がない定義では `detail` がそのまま `content` になる（同ファイル L421-422）。渡せる値は取得元の内部識別子 `'xml'` だけで、日本語UIの本文として不適切。取得元名は `operation_history.error_message` に残るため、通知に載せなくても追跡できる。結果として summary は `'強制取得中断'` の1行になる |

#### 4.6.3 通知プランナの変更（`apps/api/src/notifications/operationNotificationPlanner.ts`）

現状の `PlanOperationNotificationInput` は `errorCode` を受け取らないため、中断を判別できない。入力に追加する。

```ts
export interface PlanOperationNotificationInput {
  // …既存のまま…
  /** 強制更新失敗時のみ使用。§5.6 のとおり200文字以内・改行なしに整形済みであること。 */
  readonly failureDetail?: string | null;
  /** 操作記録に載せる errorCode。'force_refresh_aborted' のとき中断専用の通知定義を選ぶ。 */
  readonly errorCode?: string | null;
}
```

`force_refresh` の分岐を3分岐にする。

```
if (result === 'success')                        → system-force-fetch-completed / force_fetch_completed / warning / omitTarget=true / detail なし（現行）
else if (errorCode === 'force_refresh_aborted')  → system-force-fetch-aborted   / force_fetch_aborted   / warning / omitTarget=true / detail なし（新設）
else                                             → system-force-fetch-failed    / force_fetch_failed    / question / omitTarget=false / detail=failureDetail（現行）
```

`start` / `stop` の分岐は変更しない（`result !== 'success'` で `null` を返す現行どおり）。

`fetchControlService.ts` の `planOperationNotification({...})` 呼び出し（L332付近）に `errorCode: outcome.errorCode` を追加する。

#### 4.6.4 製造担当への指示: `docs/design/issue-103-notification-message-definitions.md` の追記

設計担当の権限では他の設計書を編集しないため、製造担当が次を行うこと。

1. L177-178 の定義ID型ユニオンの引用に `| 'system-force-fetch-aborted'` を1行追加する（`'system-force-fetch-completed'` の直後）。
2. §5.2 の表（L258-259 付近）の `system-force-fetch-completed` の行の直後に次の行を追加する。

```
| `system-force-fetch-aborted` | warning | 強制取得中断 | 通知対象（区分名、全部の場合は省略可） | なし | なし |
```

3. 追記の理由として「Issue #178 で追加」が分かる一文を、表の近く（#103 の記述様式に合わせた位置）に添える。


### 4.7 「自動取得を再開しない」ことの担保

強制更新は `scheduler.runManualOnce()` → `xmlPollingService.pollOnce('manual')` のみを通る。本設計で新たに触れる状態は `manualAbortController`（手動サイクル専用）と `shutdownRequested` だけであり、以下は**一切変更しない**。

| 状態 | 強制更新での扱い |
| --- | --- |
| `isRunning` | 変更しない（停止中は `false` のまま） |
| `timerId` / `scheduleNextCycle()` | 呼ばない。`executePollCycle()` も `pollFeeds()` も次サイクルを予約しない |
| `nextScheduledPollAtMs` / `scheduledPollDueOnNextRun` / `nextCycleNotBeforeMs` | 変更しない |
| `initialFetchPhase` / `successfulInitialFeedKinds` | 変更しない（更新は `start()` 内と `runScheduledOrRetryCycle()` のみ） |
| `TimeBasedPollingScheduler` の `generation` / `lastCompletedAtMap` / `nextRunAtMap` | 変更しない（`runManualOnce()` は元々触れない。#43 §4.3） |
| `lastCycleResult` | **更新される**（現行どおり。手動サイクルの結果で上書き） |
| `FeedBackoffManager` | **更新される**（`recordAttempt` / `recordSuccess` / `recordFailure`）。実際に取得した以上 `lastSuccessAt` が進むのは正しい。`'aborted'` では成功も失敗も記録しない（#174 §4.5 のまま） |

### 4.8 手動サイクル中の `stop` が届く経路（決定済みの制約・確定事項(6)）

> **決定済み（ユーザー承認）**: `fetchControlService` の `lane` 直列化は**維持する**。停止APIは実行中の強制更新の完了を待つ。実行中の手動サイクルを即座に中断できるのは SIGINT / SIGTERM 経路のみである。以下はその制約の内容と根拠である。

`fetchControlService` は `start` / `stop` / `force_refresh` を**1本の `lane` で直列化**している（L386-406）。したがって、

- **SIGINT / SIGTERM（graceful shutdown）は `lane` を通らず `close()` から直接 `scheduler.stop()` を呼ぶため、実行中の手動サイクルを即座に（電文境界で）中断できる。**
- **`POST /api/control/fetch/stop` は `lane` 上で強制更新の後ろに並ぶため、実行中の強制更新を中断できず、その完了を待ってから停止処理に入る。** これは #43 で確定した直列化の帰結であり、本Issueの変更対象外である。

手動サイクルの対象は `high_frequency` フィード（`regular`・`extra`）のみで長期フィードを含まない（`jmaXmlFeeds.ts` L71-84）。#174 §3.4 の実測（`regular` 564件/143秒、`extra` 295件/30秒、いずれも空DBからの初回相当）から、停止要求の待ちの上限は**最悪で数分オーダー**と見積もられる。この待ちは許容する（確定事項(6)）。

したがって受け入れ条件（AC4）は「**シャットダウン経路で**手動サイクルが中断されること」で検証し、停止API経路での中断は検証対象としない。

## 5. テスト方針

新規テストは `apps/api/tests/issue178ManualRefreshWhileStopped.test.ts` に置く（既存の `fetchAbort.test.ts` は #174 の受け入れ根拠なので分ける）。すべて `node:test` + スタブ化した `fetchFn` を用い、実ネットワークへ出ない。

| # | テスト | 検証内容 |
| --- | --- | --- |
| T1 | 停止中の手動サイクルがXML取得を行う | `start()` で初回同期させた後 `stop()` し、`pollOnce('manual')` を実行。`fetchFn` の呼び出し回数が停止前より増え、`feedResults` が2件（`regular`・`extra`）で全て `feedFetchOutcome: 'success'` |
| T2 | 手動サイクル後も自動取得が再開しない | T1 の後、タイマースタブに登録された `setTimeout` が増えていない。`getStatus().isRunning === false`、`getNextRunAt() === null` |
| T3 | 手動サイクル中の `stop()` が電文境界で中断する | `fetchFn` を1件ごとに待機させ、2件目の処理中に `stop()` を呼ぶ。以降の電文 GET が発生せず、該当フィードが `feedFetchOutcome: 'aborted'` |
| T4 | シャットダウン後は手動サイクルを開始しない | `stop('shutdown')` 後の `pollOnce('manual')` が `feedResults: []` を返し、`fetchFn` が1回も呼ばれない |
| T5 | 中断済み in-flight へ合流しない | 実行中サイクルを中断させた状態で `pollOnce('manual')` を呼び、返る `PollCycleResult` が in-flight のものと別オブジェクトで、`feedResults` に `'success'` が含まれる |
| T6 | `runManualOnce()` の中断判定 | フェイク `xmlPollingService` で (a) `feedResults: []`、(b) `'aborted'` を含む、(c) `'failure'` と `'aborted'` の両方、の3ケース。(a)(b) は `abortedSources: ['xml']` かつ `failedSources: []`、(c) は `failedSources: ['xml']` かつ `abortedSources: []` |
| T7 | 強制更新APIの `errorCode` | `fetchControlService` 経由で中断する強制更新を実行し、`operation_history` の `result='failure'`, `error_code='force_refresh_aborted'`。取得失敗ケースでは `'force_refresh_failed'` のままであること |
| T8 | 中断時の通知が中断専用定義になる | T7 と同じ中断ケースで `notification_output_history` を検査。`message_definition_id === 'system-force-fetch-aborted'`、`ack_required === 0`、`change_type === 'force_fetch_aborted'`、`summary === '強制取得中断'`。同一 `request_id` に対して `system-force-fetch-failed` の行が**存在しない** |
| T9 | 取得失敗時の通知が退行しない | `errorCode: 'force_refresh_failed'` の強制更新失敗で `message_definition_id === 'system-force-fetch-failed'`、`ack_required === 1` のまま |

`packages/shared/tests/notificationMessageDefinitions.test.ts` に追加するテスト:

| # | テスト | 検証内容 |
| --- | --- | --- |
| T10 | 新定義の解決 | `origin: 'system'` / `category: 'warning'` の通知に対し `resolveNotificationMessage(n, { definitionId: 'system-force-fetch-aborted', omitTarget: true })` が `ackRequired: false`、`summary: '強制取得中断'`、`messageDefinition.id/version` が `'system-force-fetch-aborted'` / `'1'` を返す |
| T11 | category 不一致の拒否 | `category: 'question'` の通知に同定義を適用すると `NotificationMessageResolutionError('notification_mismatch')` になる |

既存テストへの影響（製造時に必ず確認すること）:

- **`apps/api/tests/issue43FetchControlApi.test.ts`**: フェイクの `xmlPollingService.pollOnce()` が空の `feedResults` を返している箇所があると、本変更で強制更新が**中断＝失敗**になり、成功を期待するテストが落ちる。フェイクが `feedFetchOutcome: 'success'` のフィード結果を少なくとも1件返すよう修正する（テストの期待値ではなくフェイクを直すこと。空を失敗にするのが本Issueの目的）。
- `apps/api/tests/fetchAbort.test.ts`（#174）・`jmaXmlPolling.test.ts`・`serverGracefulShutdownTiming.test.ts` は期待値変更が不要であることを確認する。
- `ManualRunResult` にフィールドを足すため、`runManualOnce()` の戻り値をオブジェクトリテラルで組み立てる箇所・モックがあれば型エラーになる。`grep -rn "ManualRunResult\|runManualOnce" apps packages` で洗い出すこと。
- **`NotificationMessageDefinitionId` を網羅列挙しているテスト・コードがあれば型エラーになる**（`MESSAGE_DEFINITIONS` は `satisfies Record<…>` で網羅が強制される）。`grep -rn "NotificationMessageDefinitionId\|system-force-fetch" apps packages --include=*.ts` で洗い出すこと。`packages/shared` を変更するため、**`npm run build`（shared→api→web）を通してから** api のテストを実行すること。

## 6. 受け入れ条件チェックリスト

検証はすべて**一時DB・非既定ポート**で行う。`pkill node` 等の一括終了は禁止。起動・停止は自分が起動したPIDのみを対象とする。

準備（実データ検証を伴うAC用）:

```bash
SP=$(mktemp -d)
cd apps/api
WX_VIEWER_DB_PATH="$SP/t.db" PORT=3922 npx tsx src/server.ts > "$SP/t.log" 2>&1 &
APIPID=$!
until grep -q "listening on" "$SP/t.log"; do sleep 1; done
sleep 20   # 初回同期が電文取得に入るのを待つ
count() { sqlite3 "$SP/t.db" "select count(*) from fetch_attempt where target_kind='xml_document';"; }
```

| # | 受け入れ条件 | 検証手順 | 合格の判定 |
| --- | --- | --- | --- |
| AC1 | **停止中の強制更新でXML取得が実際に走る** | 準備後、`RID=$(uuidgen); curl -s -m 30 -X POST -H 'Content-Type: application/json' -d "{\"requestId\":\"$RID\"}" http://localhost:3922/api/control/fetch/stop` で停止。`BEFORE=$(count)` を記録。`RID2=$(uuidgen); curl -s -m 180 -X POST -H 'Content-Type: application/json' -d "{\"requestId\":\"$RID2\"}" http://localhost:3922/api/control/fetch/force-refresh` を実行し、`AFTER=$(count)` | **`AFTER > BEFORE`**（`fetch_attempt` の `xml_document` 行が増えている）。かつ応答の `result` が `"success"`、`errorCode` が `null` |
| AC2 | **強制更新後も自動取得が再開しない** | AC1 の直後に `curl -s http://localhost:3922/api/monitoring/status`（必要なクエリは `apps/api/src/app.ts` のハンドラに従う）を取得。さらに `AFTER2=$(count)` を記録し、90秒待って `AFTER3=$(count)` | 監視状態のXML取得元が**停止中**（`isRunning` 相当が false、`nextRunAt` が null）。かつ **`AFTER3 === AFTER2`**（90秒間に取得が1件も増えない） |
| AC3 | **「取得していないのに成功」を返さない（ユニット）** | `npm run test -w apps/api` のうち T6 相当のテスト（`issue178ManualRefreshWhileStopped.test.ts`） | `feedResults: []` と `'aborted'` 混在の両ケースで `abortedSources: ['xml']` / `failedSources: []` になり、`'failure'` 混在ケースでは `failedSources: ['xml']` / `abortedSources: []` になる |
| AC4 | **手動サイクル中のシャットダウンで中断される** | 準備後に停止し、`curl ... /force-refresh` をバックグラウンドで発行。1秒後に `T0=$(date +%s); kill -INT $APIPID; wait $APIPID; echo $(( $(date +%s) - T0 ))` | 出力が **15以下**。`$SP/t.log` に手動サイクルが中断された旨のログが出て、プロセスが SIGKILL なしで終了する |
| AC5 | **シャットダウン中は強制更新を新規に走らせない** | ユニットテスト T4（`stop('shutdown')` 後の `pollOnce('manual')`） | スタブ `fetchFn` の呼び出し回数が **0**、戻り値の `feedResults` が空配列 |
| AC6 | **中断結果が `errorCode` で区別される** | AC4 の実行で使った `$SP/t.db` に対し `sqlite3 "$SP/t.db" "select operation_kind, result, error_code from operation_history where operation_kind='force_refresh' order by completed_at desc limit 3;"`。併せてユニットテスト T7 | 中断された強制更新の行が `force_refresh｜failure｜force_refresh_aborted`。取得失敗ケース（T7）は `force_refresh_failed` のまま |
| AC6b | **中断時の通知が中断専用定義で出る** | AC6 と同じ `$SP/t.db` に対し `sqlite3 "$SP/t.db" "select change_type, message_definition_id, message_definition_version, ack_required, summary from notification_output_history where change_type like 'force_fetch%' order by detected_at desc limit 3;"`。併せてユニットテスト T8・T9 | 中断に対応する行が `force_fetch_aborted｜system-force-fetch-aborted｜1｜0｜強制取得中断`。同じ強制更新に対する `system-force-fetch-failed` の行が**存在しない**。`ack_required` が **0** |
| AC7 | **#174 の中断機構が退行しない（初回同期中の停止が15秒以内）** | 新しい一時DBで起動し、初回同期中（起動20秒後）に `T0=$(date +%s); kill -INT $APIPID; wait $APIPID; echo $(( $(date +%s) - T0 ))` | 出力が **15以下**。`$SP/t.log` 末尾に `[api] aborted initial JMA XML feed fetch (Nms)` が出ている |
| AC8 | **#174 の停止APIが退行しない** | 新しい一時DBで起動し、初回同期中に `time curl -s -m 30 -X POST -H 'Content-Type: application/json' -d "{\"requestId\":\"$(uuidgen)\"}" http://localhost:3922/api/control/fetch/stop` | **15秒以内に HTTP 200**、本文の `result` が `"success"`、`fetchControlState` が `"stopped"` |
| AC9 | **中断で電文データが壊れない** | AC4 後の `$SP/t.db` に対し `sqlite3 "$SP/t.db" "select count(*) from telegram_reception where raw_body is null or content_hash is null;"` と `sqlite3 "$SP/t.db" "select count(*), count(distinct document_url) from telegram_reception;"` | 前者が **0**、後者の2つの値が**一致** |
| AC10 | **既存テストが退行しない** | `npm run build` の後に `npm run test -w apps/api` と `npm run test -w packages/shared` | 全通過。特に `fetchAbort.test.ts` / `issue43FetchControlApi.test.ts` / `jmaXmlPolling.test.ts` / `serverGracefulShutdownTiming.test.ts` / `timeBasedPollingScheduler*.test.ts` / `notificationMessageDefinitions.test.ts` |
| AC11 | **新規テストが存在し通る** | `apps/api/tests/issue178ManualRefreshWhileStopped.test.ts` と `packages/shared/tests/notificationMessageDefinitions.test.ts` を実行 | §5 の T1〜T11 に対応するテストが全て存在し、通過する |
| AC12 | **静的検査** | `npm run lint && npm run typecheck && npm run format:check` | エラー0 |
| AC13 | **変更範囲が設計どおりである** | `git diff --stat main -- apps/api/src/database apps/api/src/repositories apps/web packages/shared` | `apps/api/src/database`・`apps/api/src/repositories`・`apps/web` の差分が**0件**（DB・migration・リポジトリ・フロントは無変更）。`packages/shared` の差分は **`src/notificationMessageDefinitions.ts` と `tests/notificationMessageDefinitions.test.ts` のみ**（確定事項(4)(7)） |
| AC14 | **#103 設計書への追記がある** | `git diff main -- docs/design/issue-103-notification-message-definitions.md` | §4.6.4 の 1.〜3. のとおり、定義ID型ユニオンの引用と §5.2 の表に `system-force-fetch-aborted` の行が追加されている |

各AC終了後は `kill -INT $APIPID`（応答しなければ `kill -TERM $APIPID`）で当該プロセスのみを停止し、`$SP` を削除する。

## 7. 後続Issueへの引き継ぎ事項

- **K端末の取得制御UIを実装するIssueへ**: 停止中の強制更新は成功しうる（取得は走る）が、自動取得は再開しない。UI上「停止中」の表示を強制更新で解除してはならない。また強制更新は `result: "failure"` + `errorCode: "force_refresh_aborted"` を返す場合があり、これは**上流障害ではなく停止・終了指示による中断**なので、UI文言を `force_refresh_failed` と分けるとよい。
- **操作履歴画面を扱うIssueへ**: `operation_history.error_code` に `'force_refresh_aborted'` が新たに現れる。表示辞書に追加が必要。
- **通知表示を扱うIssueへ**: 通知定義 `system-force-fetch-aborted`（`changeType: 'force_fetch_aborted'`、`category: 'warning'`、確認応答不要、summary は `'強制取得中断'` の1行）が新たに現れる。フロントは定義IDを参照していないため今回の変更では波及しないが、将来 `changeType` 別のアイコン・色分けを行う場合は追加が必要。
- **取得制御APIの直列化を見直すIssueへ**: §4.8 のとおり、`POST /api/control/fetch/stop` は実行中の強制更新を中断できず、最悪で数分待つ。確定事項(6)によりこの制約は受け入れ済みであり、応答性を上げるには停止要求を `lane` に入れる前に中断だけ先に通す（`scheduler.requestAbort()` 相当）改修が必要になる。

## 8. ユーザーの判断を要する点（統括担当へ差し戻す論点）

> 1回目の3論点（`lane` 直列化・中断通知の扱い・`errorCode` の分割）は確定事項(6)(7)(8)として回答済み。以下は**本改訂で新たに生じた論点**のみである。

1. **中断通知の `category` と確認応答の要否**（§4.6.2）。本設計は `category: 'warning'` / `actionResolution: 'none'`（確認応答不要）を採り、`ackRequired: false` となる。これは「停止・終了指示に従った正常動作なので運用者の対応は不要」という解釈に基づく。一方で「強制更新を押したのに完了しなかった」という**運用者が気づくべき事象**でもあり、確認応答を求める（`category: 'question'` / `actionResolution: 'acknowledge'`）余地がある。現案（`warning`・確認不要）でよいか。
2. **通知本文（`detail`）を出さないこと**（§4.6.2）。本設計は `detail` を渡さず、summary を `'強制取得中断'` の1行にする。理由は、渡せる値が内部識別子 `'xml'` しかなく日本語UIに不適切であるため。中断された取得元を運用者に見せたいなら、`'気象庁XML'` のような**日本語の表示名への変換表**を新たに設ける必要がある（`ScheduledSource` → 日本語名の対応は本Issueの範囲外）。1行のままでよいか。
3. **シャットダウン中の拒否でも同じ通知が出ること**（§4.4・§4.6.1）。確定事項(8)により `errorCode` は分けないため、シャットダウン中に届いた強制更新も `system-force-fetch-aborted` の通知を1件生成する。ただしその直後にプロセスは終了するため、この通知は運用者の目に触れないまま `notification_output_history` に残る可能性が高い（`recordShutdown()` によるサービス停止通知と並んで記録される）。(a) このまま記録する、(b) シャットダウン中の拒否では通知を生成しない（`planOperationNotification` が `null` を返す分岐を追加する）、のいずれを採るか。(b) を採る場合は `errorCode` を分けずに判別する手段（例: `PlanOperationNotificationInput` に `shuttingDown` フラグを追加）が別途必要になる。
4. **`title` の文言**（§4.6.2）。`'強制取得中断'` は既存の `'強制取得完了'` / `'強制取得失敗'` と字数・体言止めを揃えたもの。運用上の呼称として妥当か。

## 9. 判断を先送りにした点・残留リスク

- **非XML取得元（ナウキャスト・キキクル・アメダス）は中断機構の対象外のまま**（確定事項(5)）。停止中の強制更新でもこれらは `adapter.runManual()` で従来どおり取得し、停止・シャットダウンで中断されない。強制更新全体の所要は非XML側の完了にも律速される。
- **`lastCycleResult` が手動サイクルで上書きされること**は現行どおりで変更しない。停止中の強制更新により `/api/monitoring/*` の「最後のサイクル結果」が `trigger: 'manual'` になる。停止中に表示上のサイクル結果が動くことを問題視するなら別Issueとする。
- **バックオフ状態が停止中の強制更新で更新される**（§4.7）。停止中に強制更新を繰り返すと `lastSuccessAt` が進み、XML取得元の鮮度（availability）が「正常」に見え続ける。停止中の availability の扱いは #168 系の監視Issueの範疇であり、本Issueでは変更しない。
- **`pollFeeds()` の手動分岐で `await` をまたぐことによる二重起動リスク**（§4.4 補足）。`inFlightPollPromise` スロットへの登録を待機解除後に同期的に行う実装でなければ、稀に手動サイクルが2本走りうる。T5 で検出できるとは限らないため、製造時のコードレビュー観点として明記する。
- **`packages/shared` の変更を伴うため、ビルド順に注意**。`npm run build`（shared→api→web）を通さずに `npm run test -w apps/api` を実行すると、`dist` が古いままで新定義が見つからず `definition_not_found` で落ちうる。§5 に明記済み。
- **中断通知の実挙動未確認**: `system-force-fetch-aborted` が実際に `notification_output_history` へ記録されるか（AC6b）は設計時点で未確認。特に `notification_delta` API 経由でフロントへ配信される際、未知の `changeType` を落とす実装がないかを製造時に確認すること（`grep -rn "force_fetch_" apps packages`）。
- **実挙動未確認**: 本設計書の作成時点でサーバーの起動・実測は行っていない（§3）。AC1・AC2・AC4・AC6b・AC7〜AC9 は実データを伴う検証であり、検収担当が初めて実挙動を確認する。特に AC1 の所要時間（停止中のDBが不完全な場合、手動サイクルが `regular`+`extra` の未取得分をまとめて取りにいくため数分かかりうる）は未測定であり、`curl -m 180` としたタイムアウト値が不足する可能性がある。不足した場合は `-m` を延ばして再測し、実測値を検収報告に記録すること。
