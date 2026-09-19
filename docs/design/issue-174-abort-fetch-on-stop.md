# Issue #174 設計書: 初回同期・取得処理の中断機構の追加

対象Issue: #174（親: #168、関連: #171）
ブランチ: `feature/issue-174-abort-fetch-on-stop`

## 1. 目的と範囲

### 1.1 やること

- 気象庁XML取得ループに**電文単位の境界でのみ効く中断機構**を追加し、`scheduler.stop()` が実行中の初回同期を打ち切って速やかに返るようにする。
- Ctrl+C（SIGINT/SIGTERM による graceful shutdown）と K端末の中止指示（`POST /api/control/fetch/stop`）が、同一の中断機構を共有するようにする。
- 中断時の初回取得フェーズ・バックオフ・DB整合性の扱いを確定する。
- 停止経路の現状（Ctrl+C・停止API・強制更新API）を実挙動で確認し、記録する。

### 1.2 やらないこと

- **`AbortSignal` を HTTP 取得（`performHttpGet` / `fetch`）へ通して実行中のリクエストを切断すること。** 確定事項(1)により採らない。中断判定は電文の境界（次の HTTP GET を始める前）でのみ行う。
- 中断位置（どこまで取得したか）の永続化と、再起動時の再開。確定事項(2)により行わない。
- 画像系（ナウキャスト・キキクル）・アメダスの取得への中断機構の追加。§3.4 の実測どおり1サイクルが1秒未満で完了するため不要。
- K端末（フロント）側のUI実装。本Issueはサーバー側のみ。

## 2. 参照した資料と、設計判断の根拠

| 参照 | そこから導いたこと |
| --- | --- |
| 統括担当から渡された確定事項(1)〜(4) | 中断粒度＝電文境界、中断されたデータはDB保持＋再起動時に全件再取得、Ctrl+Cと停止APIで中断機構を共有、実挙動を実測して記録 |
| `apps/api/src/polling/jmaXmlPollingService.ts` | `stop()` が `inFlightPollPromise` を無条件に await する構造。ここが待ちの発生源 |
| `apps/api/src/polling/jmaXmlPoller.ts` | `pollSingleFeed()` の電文ループ。中断検査を差し込む唯一の場所 |
| `apps/api/src/polling/timeBasedPollingScheduler.ts` | `stop()` が `xmlPollingService.stop()` と非XMLの inFlight を await する |
| `apps/api/src/server.ts` `close()`（L719-745） | Ctrl+C 経路も `scheduler.stop()` を通る。K端末経路（`fetchControlTargets.stop`, L639-642）と同じ関数 |
| `apps/api/src/services/fetchControlService.ts` | 停止・開始・強制更新を1本のレーンで直列化している。停止が詰まると後続の強制更新も詰まる |
| `docs/basic-design.md` §8.1「操作の動作案」L621 | 停止の意味論は【確定】タグが付かない**案**（§3.5 参照） |
| `docs/design/issue-171-*.md` §9 | 初回取得完了までプロセスが終了しない残留リスクの記載 |
| 本設計での実測（§3.1〜§3.4） | 「数秒以内」の受け入れ条件が電文境界中断で達成可能かの定量判断 |

## 3. 現状調査（Issue §2）

### 3.1 実測環境

一時DB（`WX_VIEWER_DB_PATH` に一時ディレクトリを指定）・`PORT=3921` で `apps/api/src/server.ts` を単独起動し、開発用DB・既定ポート（3001）・他プロセスには一切触れていない。計測は 2026-09-19 01:41:40Z 起動の1インスタンスで行った。

### 3.2 停止経路の現状（コード上の事実）

```
SIGINT/SIGTERM ──► registerGracefulShutdown ──► close({reason:'signal'})
                                                   │
POST /api/control/fetch/stop ──► fetchControlService.request('stop')
                                  └─(直列レーン)─► targets.stop()
                                                   │
                                                   ▼
                                      scheduler.stop()
                                        ├─ isRunning=false / generation++ / タイマー解除
                                        ├─ await xmlPollingService.stop()
                                        │     └─ await inFlightPollPromise  ← ここで詰まる
                                        └─ await 非XML の inFlightPromises
```

- `close()` は `scheduler.stop()` の後に `imageServices.close()` → `pollingService.stop()` → `recordShutdown()`（signal のときのみ）→ `closeServer()` → `database.close()` を行う。したがって **HTTPサーバーのクローズもDBクローズも `scheduler.stop()` の完了待ちに従属する**。
- `fetchControlService` は `lane` による直列化のため、停止が詰まっている間に届いた開始・強制更新の要求もすべて詰まる。

### 3.3 実挙動（実測結果）

起動から 20 秒後（初回同期が `regular` フィードの電文取得中）に SIGINT を送出した。

| 操作 | 送出時刻(目安) | 結果 |
| --- | --- | --- |
| Ctrl+C 相当（SIGINT） | 01:42:00Z 頃 | **21分経過してもプロセスが終了せず、計測を打ち切った**（`SIGKILL` で終了させた）。ログは `starting initial JMA XML feed fetch...` のまま進まず、`fetch_attempt` の追加は継続（打ち切り時点で `regular_l` が3742件まで到達）＝取得ループは走り続けている。 |
| `POST /api/control/fetch/stop` | 01:54:10Z | **60秒のクライアントタイムアウトまで応答なし**。`GET /api/control/operations/:requestId` は `202 in_progress` / `fetchControlState: "stopping"` を返す。 |
| `POST /api/control/fetch/force-refresh` | 01:55:25Z | **45秒のクライアントタイムアウトまで応答なし**。照会は `202 in_progress` / `fetchControlState: "stopping"`。停止要求の後ろでレーン待ちしているため、停止が解けるまで着手すらしない。 |

通常ポーリング中（初回同期完了後）の挙動は、1サイクルが `regular`+`extra` の差分のみで秒オーダーに収まるため、上記の待ちは発生しない。ただし**新規電文が大量に出た直後のサイクルでは同じ構造の待ちが起こりうる**（サイクル長に比例）。本設計の中断機構は初回同期に限らず全サイクルへ効くため、この場合も解消される。

### 3.4 中断粒度と「数秒以内」の整合（確定事項(1)の検証）

同一計測から得た実測値：

| 指標 | 実測値 |
| --- | --- |
| 個別電文 HTTP GET の所要（n=2365） | 平均 **83ms** / 最大 **557ms** |
| 電文1件あたりの処理スループット（GET＋解析＋DB保存） | **約1.6件/秒（≒620ms/件）** |
| フィード別件数・所要 | `regular` 564件/143秒、`extra` 295件/30秒、`regular_l` 3742件/20分以上（計測打ち切り時点でなお継続中）、`extra_l` 未着手 |
| 打ち切り時点の `telegram_reception` | 4601件、`document_url` の distinct も4601件（＝重複なし） |
| 初回同期全体 | **17分超**（#171 の実測と一致） |

したがって電文境界での中断は、**実測ベースでは1秒未満**で効く。一方で理論上の最悪値は「中断指示が届いた瞬間に始まったばかりの HTTP GET が `performHttpGet` の既定タイムアウト（`timeoutMs` 未指定＝**10秒**）まで粘るケース」であり、**最悪 約10.6秒（10秒＋電文1件分の処理時間）**となる。

- 実測の中央値では Issue §3 の「数秒以内」を満たす。
- ただし**上流が無応答のときだけ約11秒まで伸びうる**ため、受け入れ条件の数値はこれを包含する形（§6 AC1・AC2 で **15秒以内**）とした。
- この 15 秒を「数秒以内」と呼んでよいか、あるいは XML 取得の `timeoutMs` を短縮する／確定事項(1)を見直して `AbortSignal` を HTTP まで通すかは、**ユーザーの判断を要する点**として §8-(1) に挙げる。設計側では判断しない。

### 3.5 K端末の中止指示の仕様の確度

`docs/basic-design.md` §8.1 の該当記述：

- 「取得開始・取得停止・強制更新は……『送信』を押して初めてサーバーへ実行要求を送る」は **【確定】**（見出し「ツールバーと操作手順【確定】」配下）。
- 「取得元単位の操作を設けず、開始・停止・強制更新は全体一括操作のみとする」も **【確定】**（当該行に明示）。
- **「停止: 新しい取得の投入を止め、実行中の処理は完了させる。『停止処理中』と『停止中』を区別する」は、見出し「#### 操作の動作案」配下でタグなし＝【設計案】**。【確定】ではない。
- 「操作状態の具体案」は **【未確定】** と明記されている。

本Issueは「実行中の処理は完了させる」という**設計案の一部を変更する**（実行中のXML取得サイクルを電文境界で打ち切る）。確定事項(3)により経路共通化は決定済みだが、`basic-design.md` の当該記述をどう改めるかは本設計書の権限外であるため、§8-(2) に挙げる。なお「『停止処理中』と『停止中』を区別する」は現行 `fetchControlState: 'stopping' | 'stopped'` で既に実装済みであり、本設計は変更しない。

## 4. 中断機構の設計

### 4.1 変更対象ファイルと責務

| ファイル | 変更内容 |
| --- | --- |
| `apps/api/src/polling/fetchAbort.ts`（**新規**） | 中断フラグの保持と読み取り口（`FetchAbortController` / `FetchAbortSignal`） |
| `apps/api/src/polling/jmaXmlFeeds.ts` | `FeedPollResult.feedFetchOutcome` に `'aborted'` を追加 |
| `apps/api/src/polling/jmaXmlPoller.ts` | `pollSingleFeed()` に中断シグナルを受け取り、電文ループ先頭で検査する |
| `apps/api/src/polling/jmaXmlPollingService.ts` | 中断コントローラの所有。`stop()` で `abort()`、`start()` で解除。`executePollCycle()` のフィードループ先頭でも検査。`'aborted'` をバックオフ・初回取得判定から除外 |
| `apps/api/src/polling/timeBasedPollingScheduler.ts` | 変更なし（`stop()` は既に `xmlPollingService.stop()` を await しており、そこが速く返るようになるだけ） |
| `apps/api/src/server.ts` | 初回取得 `failed` 時のログを「中断」と「失敗」で区別する |
| `apps/api/src/services/fetchControlService.ts` | 変更なし（`stop()` の契約コメントのみ更新、§4.5） |

### 4.2 中断シグナルの型（`apps/api/src/polling/fetchAbort.ts`）

```ts
/** 中断理由。ログにのみ使う。 */
export type FetchAbortReason = 'shutdown' | 'stop';

/** 取得ループ側が参照する読み取り専用の中断シグナル。 */
export interface FetchAbortSignal {
  readonly aborted: boolean;
  readonly reason: FetchAbortReason | null;
}

/**
 * 中断の指示側。標準の AbortController は使わない
 * （確定事項(1): HTTP 取得へは通さず、電文境界でのフラグ検査にのみ使う意図を型で表す）。
 */
export class FetchAbortController {
  readonly signal: FetchAbortSignal;
  /** 冪等。既に中断済みなら理由を上書きしない。 */
  abort(reason: FetchAbortReason): void;
  /** 取得再開時に中断状態を解除する。 */
  reset(): void;
}
```

### 4.3 中断検査を入れる位置（電文境界の定義）

`pollSingleFeed()` のシグネチャに末尾引数を追加する。

```ts
export async function pollSingleFeed(
  connection: DatabaseConnection,
  feedDef: JmaXmlFeedDefinition,
  trigger: JmaXmlPollTrigger,
  attemptNo: number,
  processedUrlsInCycle: Set<string>,
  options?: PollerContextOptions,
  abortSignal?: FetchAbortSignal,
): Promise<{ readonly feedResult: FeedPollResult; readonly errorReason: string | null }>;
```

検査点は次の2か所だけとする。

1. **`executePollCycle()` のフィードループ先頭**（`backoffManager.recordAttempt()` を呼ぶ**前**）。中断済みなら以降のフィードは `feedResults` に一切積まずに `break` する。試行記録もバックオフ更新も発生しない。
2. **`pollSingleFeed()` の電文エントリループ先頭**（重複判定の前、`performHttpGet(docUrl)` より前）。中断済みなら `break` し、そのフィードの結果を `feedFetchOutcome: 'aborted'` として返す。

フィード索引そのものの HTTP GET（`pollSingleFeed` 冒頭）の**途中**では検査しない。索引の GET は実測 46ms〜350ms で完了するため、中断遅延への寄与は無視できる。

**実行中の HTTP GET は最後まで（または `timeoutMs` まで）走らせる。** これが §3.4 の最悪値の根拠であり、確定事項(1)の直接の帰結である。

### 4.4 `JmaXmlPollingService` の状態遷移

```
start()          : abortController.reset() → isRunning=true → 既存分岐
stop()           : abortController.abort(reason) → isRunning=false → タイマー解除
                   → await inFlightPollPromise（catch 済み）
                   → await inFlightStartPromise（catch 済み。★新規）
```

- `stop()` に `inFlightStartPromise` の await を追加する理由: 現行の `stop()` は `inFlightPollPromise` しか待たないため、初回取得の後処理（`initialFetchPhase` の確定、`notifyInitialFetchPhaseChange()`）が `stop()` の戻り後に走る。中断が速くなると、この順序ずれが「`recordShutdown()` の後に `failed` ログが出る」形で表面化する。中断により当該 Promise は速やかに解決するので、await してもブロックは増えない。
- `stop()` は中断理由を引数で受ける: `stop(reason: FetchAbortReason = 'stop')`。`server.ts` の `close({reason:'signal'})` 経路は `'shutdown'` を渡す。
- **`abort()` は `isRunning=false` より先**に行う。逆順だと `runScheduledOrRetryCycle()` が `isRunning` を見て抜ける前に新しいサイクルを開始しうる。

### 4.5 中断時の結果の扱い

| 対象 | 中断時の扱い | 理由 |
| --- | --- | --- |
| `FeedPollResult.feedFetchOutcome` | `'aborted'`（新設） | `'failure'` にすると健全性監視が上流障害と誤認する |
| `FeedBackoffManager` | `'aborted'` では `recordSuccess()` も `recordFailure()` も呼ばない | 連続失敗回数を増やさず、再開時に即座に取得できるようにする |
| `successfulInitialFeedKinds` | `'success'` のみ追加（`'aborted'` は追加しない） | 途中まで取得したフィードを「取得済み」と誤認させない |
| `initialFetchPhase` | `'failed'`（確定事項(2)「failed相当」） | 新しい phase 値を足すと `/api/monitoring/*` と `shared` の型・フロントに波及する |
| `InitialFetchResult` | `completed: false`、`failedFeedKinds` に未完了フィード、`errorReason: '停止指示により中断'` | 監視画面に理由が出る |
| `runManualOnce()` の `failedSources` | `'aborted'` は失敗に数えない（現行の `=== 'failure'` 判定のまま） | 停止指示に従った正常動作であり、強制更新の失敗通知を出さない |
| `recordFetchAttempt` | 中断で**開始しなかった**電文の記録は作らない | 取得していないものを試行として残さない |

`JmaXmlPollingService` に `wasInitialFetchAborted(): boolean` を追加し、`server.ts` の phase 変化リスナーで分岐する。

```
中断時:  console.log  ('[api] aborted initial JMA XML feed fetch (Nms)')
失敗時:  console.error('[api] failed initial JMA XML feed fetch (Nms)')   ← 現行のまま
```

### 4.6 Ctrl+C と K端末の中止指示の共通化（確定事項(3)）

| 観点 | Ctrl+C（signal） | K端末（`POST /api/control/fetch/stop`） |
| --- | --- | --- |
| 中断機構 | `close()` → `scheduler.stop()` → `xmlPollingService.stop('shutdown')` | `fetchControlService` → `targets.stop()` → `scheduler.stop()` → `xmlPollingService.stop('stop')` |
| 操作記録 | `recordShutdown()`（`request_id` が `shutdown-` 前置、サービス停止通知） | `recordOperationHistory()` + `planOperationNotification()`（従来どおり） |
| 再開 | プロセス再起動 | `POST /api/control/fetch/start` |

**中断の実体は `scheduler.stop()` の1経路に集約され、記録・通知だけが分離する。** 新しい共通化コードは追加しない（現行が既に同一関数を通っているため）。`FetchControlTargets.stop()` の JSDoc を「実行中ジョブの完了を待つ」から「新規投入を止め、実行中のXML取得サイクルを電文境界で打ち切ってから戻る。非XMLの実行中ジョブは完了を待つ」に改める。

### 4.7 K端末の中止指示後の再開

停止で `initialFetchPhase` が `'failed'` になった状態から `POST /api/control/fetch/start` を送ると、`JmaXmlPollingService.start()` の `'failed'` 分岐が走り、`scheduleNextCycle()` → `runScheduledOrRetryCycle()` の `'failed'` 分岐で **未完了フィードだけ** を `'recovery'` トリガーで取り直す。中断したフィードはバックオフを汚していない（§4.5）ため `minPendingDelayMs = 0`、すなわち即座に再開する。既に完了したフィードは再取得しない。

## 5. DB整合性と再起動後の安全性（確定事項(2)）

### 5.1 中断位置に「壊れた行」が残らない根拠

`pollSingleFeed()` の電文1件分の処理は

```
performHttpGet(docUrl)   ← await（中断検査はこの直前）
  → parseTelegramXml()
  → recordTelegramReception()   ← connection.transaction() でトランザクション化済み
  → process...Reception()       ← 同期呼び出し。await を挟まない
```

であり、**`recordTelegramReception()` から各 processor の完了までの間に `await` が1つも存在しない**。Node.js の単一スレッド実行上、この区間に中断フラグの検査点は入らない。したがって「電文行は保存されたが警報現況等へ反映されていない」という中途半端な状態は、中断によっては発生しない（プロセス強制kill時の扱いは従来どおり `reprocessPendingWarningTelegramReceptions()` が起動時に救済する）。

### 5.2 再起動後に初回同期が壊れない根拠

- 初回取得の進捗（どのフィードのどこまで）は**一切永続化していない**。再起動時は `initialFetchPhase = 'not_started'` から始まり、4フィードすべてを `'initial'` トリガーで取り直す。
- 既に保存済みの電文は `hasTelegramReception(connection, docUrl)` で除外される。`telegram_reception.document_url` には `idx_telegram_reception_document_url` があり、実測のクエリプランは `SEARCH ... USING COVERING INDEX` で、2000件規模の再走査でも秒オーダーに収まらない負荷にはならない。
- 再取得されるのは**未取得の電文のみ**で、DBには重複行が増えない。
- したがって「中断→再起動」は「初回同期が途中から再開されたのと同じ結果」に収束する。再開位置の永続化が不要なのはこのためである。

### 5.3 graceful shutdown の記録への影響

- `recordShutdown()` の内容（`operation_kind='stop'`, `result='success'`, `request_id='shutdown-…'`, サービス停止通知1件）は**変更しない**。
- 変わるのは**記録が行われるまでの時間**だけである（17分超 → 数秒）。
- 中断で初回取得が `'failed'` になるため、`/api/monitoring/status` の `initialFetch.phase` は停止直前に `'failed'` を返す。これは「未完了のまま止めた」という事実の正しい表現である（確定事項(2)）。

## 6. 受け入れ条件チェックリスト

検証はすべて**一時DB・非既定ポート**で行う。`WX_VIEWER_DB_PATH` に一時ファイル、`PORT=3921` を指定し、自分が起動したプロセスのみを対象に停止する（`pkill node` 等の一括終了は禁止）。

準備（各ACの前に実施）:

```bash
SP=$(mktemp -d)
cd apps/api
rm -f "$SP/t.db"*
WX_VIEWER_DB_PATH="$SP/t.db" PORT=3921 npx tsx src/server.ts > "$SP/t.log" 2>&1 &
APIPID=$!
# 待受ログを待つ
until grep -q "listening on" "$SP/t.log"; do sleep 1; done
sleep 20   # 初回同期が電文取得に入るのを待つ
```

| # | 受け入れ条件 | 検証手順 | 合格の判定 |
| --- | --- | --- | --- |
| AC1 | 初回同期中の SIGINT で速やかに graceful shutdown が完了する | 上記準備後 `T0=$(date +%s); kill -INT $APIPID; wait $APIPID; echo $(( $(date +%s) - T0 ))` | 出力が **15以下**（15秒以内）。`$SP/t.log` の末尾に `[api] aborted initial JMA XML feed fetch (Nms)` が出ており、`failed initial JMA XML feed fetch` は出ていない |
| AC2 | 初回同期中の `POST /api/control/fetch/stop` が速やかに完了する | 準備後 `RID=$(uuidgen); time curl -s -m 30 -X POST -H 'Content-Type: application/json' -d "{\"requestId\":\"$RID\"}" http://localhost:3921/api/control/fetch/stop` | **15秒以内に HTTP 200** が返り、本文の `result` が `"success"`、`fetchControlState` が `"stopped"` |
| AC3 | 停止結果を requestId で確認できる | AC2 の直後に `curl -s http://localhost:3921/api/control/operations/$RID` | `200` かつ `status: "completed"`, `operationKind: "stop"`, `result: "success"`, `duplicate: true` |
| AC4 | 停止後に強制更新が詰まらない | AC2 の直後に `RID2=$(uuidgen); time curl -s -m 60 -X POST ... /api/control/fetch/force-refresh` | HTTP 応答が返る（`200`）。所要が 60 秒未満。`-m 60` のタイムアウトで切れないこと |
| AC5 | 停止後に `POST /api/control/fetch/start` で取得が再開し、未完了フィードのみ取り直す | AC2 の後に start を送り、30秒後に `$SP/t.db` の `fetch_attempt` を `target_ref` 別に集計（`select target_ref, count(*) from fetch_attempt group by 1`） | 中断前に完了していたフィード（例 `regular`）の `xml_document` 件数が**増えていない**、中断したフィードの件数が**増えている** |
| AC6 | 中断で電文データが壊れない | AC1（SIGINT で中断）後に `$SP/t.db` を読み取り専用で開き、`select count(*) from telegram_reception where raw_body is null or content_hash is null;` と `select count(*) c, count(distinct document_url) d from telegram_reception;` | 前者が **0**、後者の `c` と `d` が **一致**（重複なし） |
| AC7 | 中断後に再起動しても初回同期が正常に進む | AC1 で中断した `$SP/t.db` をそのまま使って再度サーバーを起動し、60秒観察 | ログに `starting initial JMA XML feed fetch...` が出て、`fetch_attempt` の `xml_document` 行が増える。起動時に例外・`failed` ログが出ない。`telegram_reception` の `count(*)` と `count(distinct document_url)` が一致したまま |
| AC8 | 中断が health 監視を汚さない | AC2 の直後に `curl -s 'http://localhost:3921/api/monitoring/status'` （必要なクエリパラメータは `apps/api/src/app.ts` の該当ハンドラに従う） | XML取得元の状態が「異常」ではなく停止扱い。`initialFetch.phase` が `"failed"`（＝未完了、確定事項(2)） |
| AC9 | 通常ポーリング中の停止が退行しない | 既存DB（初回同期済み）を使って起動し、`initial sync completed` ログの後に AC2 と同じ停止要求を送る | 15秒以内に `200` / `result: "success"` |
| AC10 | 既存テストが退行しない | `npm run test -w apps/api` | 全通過。特に `serverGracefulShutdownTiming.test.ts` / `issue43FetchControlApi.test.ts` / `jmaXmlPolling.test.ts` / `timeBasedPollingScheduler*.test.ts` |
| AC11 | 新規の単体テストがある | `apps/api/tests/` に中断機構のテストを追加し実行 | (a) `FetchAbortController` の `abort`/`reset` の冪等性、(b) 中断後の `pollSingleFeed` が残りの電文を GET しない（`fetchFn` のスタブ呼び出し回数で検証）、(c) 中断フィードが `feedFetchOutcome: 'aborted'` になり `successfulInitialFeedKinds` に入らない、(d) 中断でバックオフの `consecutiveFailures` が増えない、の4点が通る |
| AC12 | 静的検査 | `npm run lint && npm run typecheck && npm run format:check` | エラー0 |

各AC終了後は `kill -INT $APIPID`（応答しなければ `kill -TERM $APIPID`）でこのプロセスだけを停止し、`$SP` を削除する。

## 7. 既存テスト・後続への影響

- `serverGracefulShutdownTiming.test.ts`: 初期化中シグナルの扱いを検証しており、`stop()` の挙動変更で**期待値の変更は不要**（速くなるだけ）。ただし `stop()` が `inFlightStartPromise` を await するようになるため、フェイクを使う箇所で待ちが増えていないか確認すること。
- `jmaXmlPolling.test.ts`: `feedFetchOutcome` のユニオン拡張により、網羅的な switch/比較があれば型エラーになりうる。
- `packages/shared`: `feedFetchOutcome` は API レスポンスに載っていない（`apps/api` 内部型）ため、shared・フロントへの波及はない。**製造時に `grep -rn "feedFetchOutcome" apps packages` で再確認すること。**

## 8. ユーザーの判断を要する点

> **回答済み（2026-09-19、ユーザー承認）**: (1) 受け入れ条件は **15秒以内** で確定（案(a)）。(2) `docs/basic-design.md` §8.1 の停止の記述は本Issueで改訂済み（タグは【設計案】のまま）。(3) 停止APIは **現行の同期型を維持**。以下は設計時点の論点記録である。

1. **「数秒以内」の数値の確定**（§3.4）。電文境界中断の実測は1秒未満だが、上流無応答時は `performHttpGet` の既定タイムアウト 10 秒に引きずられ最悪 約11秒かかる。本設計は受け入れ条件を **15秒以内** としたが、(a) この値で確定してよいか、(b) XML取得の `timeoutMs` を 5 秒等へ短縮するか、(c) 確定事項(1)を見直して `AbortSignal` を HTTP 取得へ通し実行中リクエストも切断するか、のいずれを採るか。
2. **`docs/basic-design.md` §8.1「操作の動作案」の停止の記述**（§3.5）。「実行中の処理は完了させる」は【設計案】であり、本Issueで XML 取得サイクルについては電文境界で打ち切る挙動に変わる。当該記述を改訂するか、本設計書を根拠として据え置くか。改訂する場合は別Issueとするか本Issueに含めるか。
3. **停止APIの応答モデル**。現行の `POST /api/control/fetch/stop` は完了まで HTTP 応答を返さない同期型である。中断機構で15秒以内には返るようになるが、K端末のUI（`fetchControlState: 'stopping'` の表示）は `202 in_progress` を返す非同期型を前提にも読める。本設計は**現行の同期型を維持**する前提で受け入れ条件を書いた。これでよいか。

## 9. 判断を先送りにした点・残留リスク

- **非XML取得（ナウキャスト・キキクル索引、アメダス）には中断機構を入れない。** 実測で1サイクルが1秒未満のため。将来、索引取得がリトライを含んで長くなった場合は同じ構造の待ちが再発する。
- **`reprocessPendingWarningTelegramReceptions()`（起動時の未処理電文再処理）は中断対象外。** `runInitialSync()` 内で会場ループごとに `closed` を見て抜ける現行の仕組みがあるが、1会場分の再処理そのものは中断できない。今回の実測では `found 0 pending` で即完了しており、中断遅延への寄与は確認できなかった（**実挙動未確認**: 未処理電文が大量にある状態での所要は測っていない）。
- **`stop()` 中に `start()` が届いた場合の競合。** `abortController.reset()` と `abort()` の順序が入れ替わると、再開直後の取得が即座に中断されうる。`fetchControlService` が開始・停止を同一レーンで直列化しているため実運用経路では起きないが、直接 API を叩くテストコードでは起こりうる。製造時は `start()` の先頭で必ず `reset()` する実装とし、AC5 で再開が実際に走ることを確認する。
- **通常ポーリング中に新規電文が大量に出たサイクルの停止所要は未実測**（§3.3）。構造上は同じ中断機構が効くが、実データでの再現条件が作れなかった（**実挙動未確認**）。

## 10. 後続Issueへの引き継ぎ事項

- K端末（フロント）の取得制御UIを実装するIssueへ: 停止要求は最悪で10秒強かかりうる。送信ボタンの無効化・「停止処理中」表示の維持時間は、クライアント側タイムアウトを最低15秒とる前提で設計すること（§3.4・§8-(1) の結論に従う）。
- 初回同期の進捗表示を扱うIssueへ: 中断された初回同期は `initialFetch.phase = 'failed'` として現れる。「失敗」と「中止」を画面で区別したい場合、`InitialFetchResult.errorReason`（本設計で `'停止指示により中断'` を入れる）を判別材料に使えるが、専用フィールドは設けていない。
- 取得タイムアウト設定を扱うIssueへ: `performHttpGet` の `timeoutMs` は現状どこからも指定されておらず既定10秒である（`PollerContextOptions.timeoutMs` は未設定）。設定ファイル化する場合、本Issueの中断所要の上限がそれに連動する。
