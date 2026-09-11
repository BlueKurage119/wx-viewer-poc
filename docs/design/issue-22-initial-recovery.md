# Issue #22「C12. 長期フィードによる初期取得・復旧処理」設計

作成日: 2026-09-12

## 1. 目的と範囲

API プロセスの起動ごとに、気象庁 XML の高頻度フィード `regular` / `extra` と長期フィード `regular_l` / `extra_l` を各 1 回取得し、保存済み受信履歴と取得した未受信電文から現況を復元する。初期取得中・初期取得完了・初期取得失敗をプロセス内で区別し、4 フィードすべてのフィード取得が成功した場合だけ「初期取得済み」とする。

本 Issue の対象は次のとおりである。

- C3 で実装済みの保存済み受信履歴からの現況再構成と、C1 の `pollOnce('initial')` を API 起動処理へ接続する
- 初期取得状態をプロセス単位のメモリ状態として管理し、`JmaXmlPollingService.getStatus()` から参照可能にする
- 初期取得の完了後に通常の高頻度フィード定期取得へ移る。初期取得サイクルと通常サイクルを重複実行しない
- フィード取得成否を `PollCycleResult` だけから完全一致で判定できるようにする
- `pollOnce('recovery')` が引き続き4フィードを対象とすることを回帰テストする

次は対象外とする。

- 失敗した初期取得の自動再試行、指数バックオフを使った復旧サイクル投入、取得元別の異常判定（C13）
- JST の時間帯別周期、夜間停止・再開時の復旧契機（C14）
- 開始・停止・強制更新の HTTP API と、手動再開時に `recovery` を選ぶ制御（E11）
- 初期取得で検知した現況からの通知生成、通知区分判定、同一版通知の重複防止（D2〜D4）
- 起動時通知出力 API と端末セッション管理（D5、D6）
- XML 以外の雨雲、キキクル、アメダスに対する起動時外部取得
- migration、永続化済みデータ、REST API、`apps/web`、`packages/shared` の変更

## 2. 参照資料と判断根拠

### 2.1 参照資料

- `docs/issues-draft.md` C12
- `docs/basic-design.md` §5.12、§6.3、§7.6、§7.7、§8.1〜§8.3、§9.2、§9.3
- `docs/data-acquisition-report.md` §2.1、§6、§8
- `docs/design/issue-11-xml-feed-polling.md`（C1）
- `docs/design/issue-12-warning-xml-parser.md`（C2）
- `docs/design/issue-13-warning-current-state.md`（C3）
- `docs/design/issue-14-warning-timeseries.md` 以降の XML 情報種別設計
- 実装済みの `apps/api/src/polling/jmaXmlFeeds.ts`
- 実装済みの `apps/api/src/polling/jmaXmlPoller.ts`
- 実装済みの `apps/api/src/polling/jmaXmlPollingService.ts`
- 実装済みの `apps/api/src/polling/jmaWarningTelegramProcessor.ts`
- 実装済みの `apps/api/src/polling/jmaWarningCurrentProcessor.ts`
- 実装済みの `apps/api/src/server.ts`
- 既存統合テスト `apps/api/tests/jmaXmlPolling.test.ts`

### 2.2 確定事項と判断

統括のヒアリングにより、`regular_l` / `extra_l` を含む4フィードすべての取得成功時だけ「初期取得済み」とし、1本でも失敗した場合は未初期化を維持することが確定した。失敗時の再試行は C13 に委ねる。

取得方法レポートでは、高頻度フィードは直近の短い期間、長期フィードは数日分を掲載し、長期フィードは初期化・復旧時に参照する方針である。電文種別の所属フィードは固定せず4フィードの和集合を扱う。したがって、起動時に長期2本だけを読むのではなく、C1 が定義済みの `initial` サイクルで4本すべてを読む。

既存実装は次の状態にある。

1. `getFeedDefinitionsForTrigger('initial' | 'recovery')` は4フィード、`scheduled` / `manual` は高頻度2フィードを返す。
2. `pollSingleFeed` はフィード HTTP／Atom 解析の成功を内部の `isFeedFetchSuccess` で返すが、公開結果 `FeedPollResult` にはその成否が含まれない。失敗時と正常な空フィードが同じ件数値になり得るため、現状の `PollCycleResult` だけでは初期取得済みを判定できない。
3. `JmaXmlPollingService.start()` は `scheduled` を非同期で直ちに開始するため、プロセス起動時に長期フィードを取得しない。
4. `server.ts` はポーリング開始前に、未判定の警報電文を再処理し、保存済み受信履歴から警報現況を再構成している。この DB 復旧は HTTP 取得・受信履歴追記・通知生成を行わない。
5. 未受信電文は `jmaXmlPoller` が電文種別ごとの既存 processor へ直ちに渡すため、初期サイクル中にも正常化済みスナップショットが更新される。

「4フィードの取得成功」は、各フィード本文の HTTP GET と Atom 解析が成功したことを指す。個別電文の取得失敗件数 `failedDocumentCount`、対象情報が存在しないこと、対象地域外、未対応構造、個別 processor の採否は、情報種別ごとの復元・解析状態として別に追跡する。`docs/basic-design.md` §8.1 の「取得成功と必要情報の復元・解析成功は別に判定する」に従い、これらをフィード取得の成功へ混ぜない。ただし個別電文失敗は既存どおり取得履歴と `failedDocumentCount` に残し、正常な発表なしへ縮退させない。

## 3. 起動・状態遷移設計

### 3.1 プロセス起動順序

ポーリング有効時の起動順序を次で固定する。

```text
DB 初期化・migration
  ↓
C2: 未判定の保存済み警報電文を再処理
  ↓
C3: 保存済み受信履歴から警報現況を再構成（通知なし）
  ↓
JmaXmlPollingService.start()
  ├─ プロセス内状態を running にする
  ├─ pollOnce('initial') を1回実行（4フィード）
  ├─ 4本の成否から completed / failed を確定
  └─ サービスが停止されていなければ通常タイマーを開始
       └─ 以後 pollOnce('scheduled')（高頻度2フィードのみ）
```

保存済み履歴からの C3 復旧を先に行うことで、外部取得が失敗しても前回正常値を失わない。続く初期サイクルで未受信電文が見つかれば、既存の processor と版比較により現況へ反映する。既受信 URL は C1 の DB 重複抑止により再ダウンロードしない。

`start()` は初期サイクル完了まで待てる `Promise<InitialFetchResult>` を返す。初期サイクルがネットワーク失敗または Atom 解析失敗を結果として返した場合、Promise 自体は正常完了し、`InitialFetchResult.completed` は `false` となる。DB 書込み失敗や不変条件違反など、既存取得処理が例外として返す内部障害は初期取得失敗状態を記録したうえで再 throw し、正常な取得失敗へ偽装しない。

初期サイクルが `completed` でも `failed` でも、サービスが停止されていなければ通常タイマーを開始する。失敗後に長期フィードを自動再取得せず、高頻度2フィードの通常取得だけを継続する。これにより通常の新着収集は止めず、「初期取得済み」だけは false のまま維持できる。長期フィードを再試行して状態を完了へ遷移させる処理は C13 が追加する。

### 3.2 プロセス単位の初期取得状態

初期取得状態は SQLite に保存せず、`JmaXmlPollingService` のインスタンスフィールドだけで保持する。新しいサービスインスタンスは、同じ DB を使っていても必ず `not_started` から始まる。これはプロセス再起動のテスト可能な代替でもある。

状態遷移は次の一方向とする。

```text
not_started ── start() ──> running ──4フィード成功──> completed
                              └────1本以上失敗──────> failed
                              └────内部例外─────────> failed（例外は再throw）
```

C12 では `failed` から `running` へ自動遷移しない。`stop()` と同一インスタンスへの再度の `start()` もプロセス再起動ではないため、初期サイクルを再実行しない。停止前の初期結果を維持したまま通常ポーリングだけを再開する。将来 E11 が明示的な再開・復旧を要求するときは、C13 が `recovery` サイクルの投入条件と状態更新規則を追加する。

同時または重複した `start()` は1つの起動 Promise に集約し、4フィードを重複取得しない。初期サイクル実行中に `stop()` された場合は既存どおり in-flight 完了を待ち、その後に通常タイマーを開始しない。

### 3.3 初期取得済み判定

期待するフィード集合を固定順 `regular`, `extra`, `regular_l`, `extra_l` とする。次をすべて満たすときだけ `completed=true` とする。

1. `PollCycleResult.trigger === 'initial'`
2. `feedResults` が期待する4種類を過不足・重複なく含む
3. 4件すべての `feedFetchOutcome === 'success'`

1件でも欠落、重複、失敗があれば `failed` とし、失敗または欠落したフィード種別を `failedFeedKinds` に固定順で格納する。単に `feedResults.length === 4`、取得件数が0より大きい、長期2本だけが成功した、あるいは高頻度2本の後続 `scheduled` が成功した、という条件では完了にしない。

正常な空フィードは成功である。逆に HTTP／Atom 失敗によって件数が0になったフィードは失敗であり、この2つは `feedFetchOutcome` で区別する。個別電文の一部失敗は §2.2 のとおり初期フィード取得済み判定を変更しない。

### 3.4 現況復元・通知との境界

C12 の初期取得状態はプロセス全体の XML フィード取得状態であり、個別情報の `availability` と同一ではない。

- 4フィードが成功しても、有効な `VPWS50` がなければ警報現況は C3 の定義どおり未初期化のままである。
- 有効な対象電文が存在しないことを正常に確認できた情報は、各 processor／repository の規則に従い、空の available と未取得を区別する。
- 既存値がある状態で個別電文取得・解析が失敗しても、前回値を削除しない。`available` / `stale` / `unavailable` の遷移を本 Issue で boolean に縮退させない。
- `normal` / `training` / `test` の保存先分離を維持し、初期取得を理由に訓練・試験データを通常現況へ混入させない。

基本設計 §7.6 は、初期取得・復旧時に発表中の情報を通常の状態変化規則で通知し、プロセス再起動ごとに再評価することを求める。しかし通知生成ロジックは D2〜D4 の責務であり、現時点では `notification_output_history` repository だけが存在する。C12 は、完了した `InitialFetchResult` とその `finishedAt`、取得後の保存済み現況を D4 が再評価できる境界として提供し、通知行を生成しない。DB 復旧時に返る C3 の `origin='initial'` や、新着処理時の `origin` を C12 が通知へ変換したり、通知履歴へ直接書いたりしない。

## 4. モジュール・型・内部 API

### 4.1 変更対象

```text
apps/api/src/
├── polling/
│   ├── jmaXmlFeeds.ts                 # FeedPollResult にフィード取得成否を追加
│   ├── jmaXmlPoller.ts                # 成功・失敗結果へ成否を設定
│   └── jmaXmlPollingService.ts        # 初期取得状態、起動集約、起動順序
└── server.ts                          # start() の初期取得完了を扱う
apps/api/tests/
└── jmaXmlPolling.test.ts              # 起動・状態遷移・4フィード統合テスト
```

既存の `polling/index.ts` は `jmaXmlFeeds.ts` と `jmaXmlPollingService.ts` を wildcard export 済みのため、個別の export 追加は不要である。migration、repository、package 依存関係の追加も不要とする。

### 4.2 型

`jmaXmlFeeds.ts` の公開結果にフィード本体の取得成否を追加する。

```ts
export interface FeedPollResult {
  readonly feedKind: JmaXmlFeedKind;
  readonly feedFetchOutcome: 'success' | 'failure';
  readonly discoveredCount: number;
  readonly skippedDuplicateCount: number;
  readonly downloadedCount: number;
  readonly failedDocumentCount: number;
}
```

エラー詳細は既存の `fetch_attempt` と `FeedBackoffStatus.lastError` を正とし、`FeedPollResult` に生の例外文を重複保持しない。`pollSingleFeed` の内部返却 `isFeedFetchSuccess` は、`feedFetchOutcome` から判定できるため削除し、`errorReason` だけをバックオフ記録用に残す。これによりサービス層とテストが公開結果の成否を単一の値から判定できる。

`jmaXmlPollingService.ts` に次を追加する。

```ts
export type InitialFetchPhase = 'not_started' | 'running' | 'completed' | 'failed';

export interface InitialFetchResult {
  readonly completed: boolean;
  readonly startedAt: UtcIso8601String;
  readonly finishedAt: UtcIso8601String;
  readonly failedFeedKinds: readonly JmaXmlFeedKind[];
  readonly cycleResult: PollCycleResult | null;
  readonly errorReason: string | null;
}

export interface InitialFetchStatus {
  readonly phase: InitialFetchPhase;
  readonly result: InitialFetchResult | null;
}

export interface JmaXmlPollingStatus {
  readonly isRunning: boolean;
  readonly initialFetch: InitialFetchStatus;
  readonly lastCycleResult: PollCycleResult | null;
  readonly feedStatuses: Readonly<Record<JmaXmlFeedKind, FeedBackoffStatus>>;
}
```

`running` 中は `result=null` とする。完了時刻がない途中状態を空文字等で表現しない。内部例外の場合は `cycleResult=null`、`failedFeedKinds` は4種類すべてとし、公開用 `errorReason` には既存の `sanitizeErrorMessage` と同等の秘密値を含まない文字列だけを格納する。

サービス API は次とする。

```ts
start(): Promise<InitialFetchResult>;
pollOnce(trigger: JmaXmlPollTrigger): Promise<PollCycleResult>;
stop(): Promise<void>;
getStatus(): JmaXmlPollingStatus;
```

`pollOnce('initial' | 'recovery')` を外部から直接呼ぶことは初期取得状態を変更しない。状態を変更する入口は `start()` に限定する。これにより、テストや将来機能による単発取得が誤ってプロセスの初期取得済み判定を完了させない。C13 は明示的な復旧処理を追加するとき、この状態更新をサービス内部の専用メソッドとして共通化する。

### 4.3 `server.ts` の接続

`startServer()` と CLI `main()` の重複した起動処理を同じ順序に揃え、いずれも DB 復旧後に `await pollingService.start()` する。テスト注入された `pollingService` に対しても同じ API を使う。

期待されるフィード取得失敗は `start()` の正常な `InitialFetchResult` なので、HTTP サーバーと通常ポーリングを稼働させる。内部例外で `start()` が reject した場合、`startServer()` は既存の失敗時クリーンアップ規則に従い polling service、HTTP server、DB を閉じて reject する。CLI `main()` も上位 `catch` へ伝播させ、部分起動を正常としてログ出力しない。

`enablePolling=false` または `DISABLE_POLLING=true` の場合は外部取得を行わず、`pollingService` を作らない既存契約を維持する。この停止設定を「初期取得失敗」と記録する永続状態は追加しない。

## 5. 詳細処理

### 5.1 `start()`

1. 初回呼出しで `isRunning=true`、`initialFetch.phase='running'` とし、開始時刻を取得する。
2. 既存の in-flight 集約を使って `pollOnce('initial')` を1回だけ実行する。
3. §3.3 の完全一致判定で `completed` または `failed` を構成し、`lastCycleResult` と別に `initialFetch.result` へ保持する。
4. `isRunning` が true のままなら、初期サイクル終了時点から通常周期のタイマーを1本だけ設定する。初期サイクル直後に追加の即時 `scheduled` は実行しない。初期サイクル自体が高頻度2本も取得済みだからである。
5. 複数の `start()` が重なった場合は同じ内部起動処理へ集約する。
6. 初期処理後に `stop()`、再度 `start()` された場合は保存済みの `InitialFetchResult` を返し、長期フィードを再取得せず通常タイマーだけを再開する。

### 5.2 フィード失敗と個別電文失敗

`jmaXmlPoller.ts` は次の結果を返す。

| 状況 | `feedFetchOutcome` | `failedDocumentCount` | 初期取得済み判定 |
|---|---|---:|---|
| フィード HTTP／Atom が成功、entry 0件 | `success` | 0 | 当該フィードは成功 |
| フィード HTTP／Atom が失敗 | `failure` | 0 | 当該フィードは失敗 |
| フィード成功、個別電文の一部 GET 失敗 | `success` | 1以上 | 当該フィードは成功。情報別の復元失敗は別管理 |
| フィード成功、個別電文がすべて既受信 | `success` | 0 | 当該フィードは成功 |

フィードごとの `FeedBackoffManager.recordSuccess` / `recordFailure` も `feedFetchOutcome` を用いる。C1 の「個別電文失敗をフィード失敗へ読み替えない」という既存契約を維持する。

### 5.3 復旧トリガー

`pollOnce('recovery')` は C1 の契約どおり4フィードを1回取得し、長期フィードを通常タイマーへ混ぜない。C12 では自動的に呼ばず、初期取得状態も変更しない。C13／C14／E11 が復旧契機を決めるまで、無制限な長期フィード再取得の経路を追加しない。

## 6. テスト計画

実ネットワーク、実運用 DB、長い実時間待機を使わず、一時 SQLite DB、注入 `fetchFn`、短いテスト周期、決定的な clock を用いる。既存 `apps/api/tests/jmaXmlPolling.test.ts` のローカル HTTP サーバーと Atom fixture を再利用する。

1. 新しいサービスの状態が `not_started` / `result=null` であり、DB に初期取得状態を保存する行・migration がない。
2. `start()` で要求順が `regular`, `extra`, `regular_l`, `extra_l` の各1回となり、4本すべて成功後に `phase='completed'`、`completed=true`、`failedFeedKinds=[]` となる。
3. 初期サイクルの実行中は `phase='running'` で、通常 `scheduled` が並行開始されない。完了後の通常周期では高頻度2本だけが増え、長期2本は増えない。
4. 4本のうち先頭・中間・末尾をそれぞれ失敗させても4本すべてを試行し、`phase='failed'`、`completed=false`、該当する `failedFeedKinds` が完全一致する。高頻度の通常ポーリングはその後も開始するが、成功しても初期状態は `failed` のままである。
5. 正常な空 Atom は成功として完了し、HTTP 失敗の空件数とは `feedFetchOutcome` で区別できる。
6. フィードは成功し個別電文 GET だけが失敗した場合、`feedFetchOutcome='success'`、`failedDocumentCount=1` が同時に残り、4フィードの初期取得状態は `completed` となる。個別電文の失敗 `fetch_attempt` が存在し、正常情報へ変換されないことも確認する。
7. 同時の複数 `start()`、初期化後の重複 `start()` で初期4フィードのリクエスト数が各1回のままである。
8. 初期サイクル中に `stop()` すると in-flight 完了を待ち、完了後に通常取得が始まらない。停止後の `start()` は初期4フィードを再取得しない。
9. 同じ DB に対して新しい `JmaXmlPollingService` を作成すると `not_started` に戻り、`start()` で4フィードを再取得する。DB の既受信 URL は個別電文 GET を抑止するが、各フィード GET は省略しない。
10. `pollOnce('recovery')` は4フィード、`pollOnce('scheduled' | 'manual')` は高頻度2フィードだけを取得し、直接呼出しでは `initialFetch` が変化しない。
11. `startServer()` の既定起動で、保存済み履歴の C2 再処理・C3 再構成後に4フィードの初期サイクルが実行される。`enablePolling=false` では外部リクエストが0件である。
12. 初期取得中の内部例外は `failed` を記録して reject し、`startServer()` が HTTP server、polling service、DB を閉じる。
13. 初期サイクルで取得した未受信の `VPWS50` と個別更新が既存 processor に渡され、C3 の現況が版順に復元される。既受信 URL の再取得・受信履歴追記はない。
14. 初期取得は `notification_output_history` を増やさず、`training` / `test` 電文が `normal` の現況を変更しない。

新規テストの対照実験では、Atom fixture の表示用 title だけを変更して全テストが成功し続けることを先に確認する。その後、`getFeedDefinitionsForTrigger('initial')` から `extra_l` を一時的に除くミューテーション、および完了条件を「1本以上成功」に一時的に緩めるミューテーションで、対応テストがそれぞれ失敗することを red として確認する。一時変更は完成コードへ残さない。

## 7. 実行可能な受け入れ条件

検収担当は次を上から順に実行する。

1. `npm run build`、`npm run typecheck`、`npm run lint`、`npm run format:check` がすべて成功する。
2. `npm run test -w apps/api` が全件成功する。
3. 新規 `JmaXmlPollingService` の `getStatus().initialFetch` が完全一致で `{ phase: 'not_started', result: null }` となる。
4. `start()` の初回取得で `regular`、`extra`、`regular_l`、`extra_l` が各1回だけ要求され、4本すべて成功時のみ `phase='completed'` / `completed=true` となる。
5. 4本のいずれか1本を HTTP または Atom 解析失敗にすると、残りを含む4本すべてが試行され、`phase='failed'` / `completed=false` となる。失敗フィードが `failedFeedKinds` と `fetch_attempt` に完全一致で残る。
6. 初期取得失敗後に通常フィード取得が成功しても `initialFetch.phase` は `failed` のままで、長期フィードの自動再試行が発生しない。
7. 正常な空フィードと取得失敗が `feedFetchOutcome` で区別され、前者だけで構成された4フィードは初期取得済みになる。
8. 個別電文取得に失敗したサイクルでは `failedDocumentCount` と失敗履歴が残る一方、4本のフィード HTTP／Atom が成功していればフィード初期取得は完了する。個別情報を「正常な発表なし」へ変換しない。
9. 初期取得中に通常サイクルは並行実行されず、初期取得完了後のタイマーは高頻度2フィードだけを取得する。
10. 同一インスタンスへの重複 `start()`、停止・再開は長期フィードを重複取得しない。新しいサービスインスタンスでは同じ DB でも初期状態がリセットされ、4フィードを再取得する。
11. 保存済み警報受信履歴の復旧が初期外部取得より先に行われ、初期サイクル後の現況が既存の版比較規則どおりになる。既受信の個別電文は再取得・再保存されない。
12. `pollOnce('recovery')` が4フィード、`scheduled` / `manual` が高頻度2フィードだけを対象とし、長期フィードが通常周期へ混入しない。
13. 初期取得の実行前後で `notification_output_history` の件数が増えず、通知生成が D2〜D4 の範囲として残されている。
14. `normal` / `training` / `test` の既存分離、情報種別ごとの `available` / `stale` / `unavailable` の表現、保存済み前回値が初期取得状態によって破壊・boolean 化されない。
15. 既存 migration、repository schema、`apps/web`、`packages/shared`、REST endpoint に差分がない。

## 8. 後続 Issue への引き継ぎ

- **C13**: `initialFetch.phase='failed'` と `failedFeedKinds` を入力に、失敗フィードのバックオフ付き再試行を設計する。復旧成功時に `completed` へ遷移させる専用経路を追加し、通常 `scheduled` の成功だけで完了へ変えない。個別電文失敗とフィード失敗の別管理を維持する。
- **C14**: 初期サイクル完了後の固定周期を JST 時間帯別周期へ置き換える。初期サイクル中に通常ジョブを投入せず、長期フィードを定期取得対象へ含めない。夜間停止からの日次再開をプロセス初期取得と同一視するかは C14／E11 側で決定する。
- **D2〜D4**: `InitialFetchResult.completed=true` を初期現況再評価の開始条件に使い、取得後の `normal` 現況から通知を生成する。C3 の DB 復旧は通知を生成しないため、プロセス再起動単位の通知は D4 が明示的に生成する。同一版の通常再処理との重複防止を行う。
- **D5／D6**: `initialFetch.phase` が `not_started` / `running` / `failed` の間は起動時出力を初期化中または復元未完了として返し、`completed` 後に現行情報を返す。プロセス単位の初期取得と端末セッション単位の初回問い合わせを混同しない。
- **E10／K6**: `InitialFetchStatus` と4長短フィードの取得履歴を監視表示へ投影する。初期化・復旧用長期フィードは実行時だけ補助行に表示し、取得成功と個別情報の解析・復元状態を別欄で示す。
- **E11**: 開始・停止・強制更新の全体一括操作を追加するとき、単なる停止後 `start()` と明示的 `recovery` を区別する。C12 の `pollOnce('recovery')` を無条件または連打可能な長期取得 API として直接公開しない。

## 9. 未確認事項

- 初期取得失敗後の具体的な再試行回数、バックオフ値、どの失敗フィードを再取得するか、個別電文失敗を復旧サイクルへ含めるかは C13 の設計事項である。C12 の製造開始を妨げない。
- 手動停止後の再開、日次運用開始、設定変更後の再開を `recovery` とする条件は C14／E11 で未確定である。C12 ではプロセス起動時だけ `initial` を自動実行する。
- 初期取得完了後にどの情報種別をどの通知区分で再通知し、同一版をどう重複防止するかは D2〜D4 の設計事項である。C12 は通知を生成しない。
- XML 以外の雨雲・キキクル・アメダスについて、プロセス起動時に外部取得する順序と、全体の「初期化中」表示へどう集約するかは C14／監視 API 側で未確定である。C12 の XML 初期取得済み判定へ混ぜない。

上記はいずれも本 Issue の製造開始を妨げる追加ヒアリング事項ではない。
