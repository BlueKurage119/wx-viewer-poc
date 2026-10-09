# Issue #257 取得・復旧と全気象書込みの Worker 化

## 1. 位置づけ・確定事項・根拠

- 対象: [#257](https://github.com/BlueKurage119/wx-viewer-poc/issues/257)、親: [#255](https://github.com/BlueKurage119/wx-viewer-poc/issues/255)。状態は **【承認済み】**。2026-10-09にユーザーがサブエージェント方式による製造・PR発行・初回レビュー対応まで承認した。マージは承認範囲に含まない。製造ブランチは `codex/issue-257-weather-acquisition-worker`。
- 基点: PR #261 のマージコミット `1aab24fb4b92e643335e171f7d1b408c13127b20`。統括が `origin/main` への包含を確認済み。着手時の `main` に既存差分なし。
- 【確定】最終構成はメイン＋取得 Worker 1つ＋提供 Worker 1つ。今回は取得 Worker を導入し、提供側はメイン内の独立 read-only 接続を用いる。提供 Worker は #258。
- 【確定】異常終了で自動再起動しない。監視画面の専用操作で再開する。取得開始・停止・強制更新の意味は変えない。
- 【確定】通知保存失敗・候補受領前の異常終了による通知欠落は、監視等で確認する運用として許容済み。再開時に補完・再送しない。この点は再判断を求める未決事項ではない。
- 【確定・追加指示】#257で追加するUI・通知は暫定とし、#259で必ずユーザーの監修を受けて確定する。仮UIは#259で流用予定なし。今回は必要な機能検証に限定し、見た目・文言・細部の追加仕上げや流用目的の作り込みを行わない。今回の機能検証合格を、見た目・文言・通知の最終承認として扱わない。
- 【確定】詳細設計は統括へ委任済み。既存保証・操作意味を変える場合だけ判断を戻す。本書の具体方式・数値は承認対象の設計案であり、実測達成値ではない。

以下のソースパスは、特記しない限り `apps/api/src/` からの相対パス。

| 参照 | 実装の確認結果・設計判断 |
| --- | --- |
| [#256 設計](issue-256-weather-worker-contracts.md) §4〜9 | DTO、世代、公開ゲート、通知判定 checkpoint、手動再開、初期の有界制御値を引き継ぐ。 |
| `server.ts`、`runtime/createApplicationRuntime.ts` | 両起動入口はまだ pair initializer と同期 service を構成する。共通の非同期構成へ移し、気象失敗を HTTP 待受から切り離す。 |
| `runtime/weatherDecisionRuntime.ts`、`weatherDecisionState.ts`、`retainedNotificationSink.ts` | 現在の `runSync` は登録・気象 commit・保持保存を同一スレッドで実行する。Worker 内の同期 transaction とメインへの非同期 ACK を分ける必要がある。 |
| `runtime/weatherPublication.ts` | FIFO と token の期限が実装済み。Worker をまたぐ pause/release と、メインの同期保持 transaction の確定条件を追加する。 |
| `database/pairConfig.ts`、`pair.ts`、`pairSafety.ts` | 両 DB のパス検査・コピー検査・初期化・lease が一体。共通安全検査と role 固有初期化を分ける。lease は PID だけでは同プロセス内の Worker を識別できない。 |
| `database/resetWeatherDatabase.ts` | DB 本体・WAL/SHM/journal の停止確認、計画 digest、再開 journal、保持 DB 不変検証を維持する。 |
| `services/fetchControlService.ts` | requestId、開始/停止レーン、強制更新合流、lastStoppedAt、記録失敗 fallback をメインに残す。 |
| `polling/nowcastTileStore.ts`、`kikikuruTileStore.ts`、各画像 service | 書込み・清掃と保存済み読取を分離する。現行 PNG 検証・hash とバイト数照合を維持し、競合を有限回の再読取で扱う。 |
| PR #261 の修正 `e53955b` | close 後の新規要求拒否、画像初期化中の既存 503、注入時計による履歴 generatedAt を維持する。 |
| `packages/shared/src/weatherRuntime.ts`、`monitoringStatus.ts`、`notificationMessageDefinitions.ts` | 既存 runtime DTO を利用し、監視に公開する。総合状態を新設せず、通常停止・Worker 状態・気象準備を区別する。 |
| `apps/web/src/monitoring/MonitoringDashboard.tsx`、`MonitoringToolbar.tsx` | 監視画面に小さな取得 Worker 状態・再開欄を追加する。ツールバーの配置整理は #259。 |
| [設計標準](../rules/02-design-protocol.md)、[検証標準](../rules/05-verification-protocol.md)、[UI 標準](../rules/06-ui-md3-protocol.md)、[気象データ標準](../rules/07-wx-data-protocol.md) | 設計のみ、観測可能な合否、対照/red、MD3、availability と訓練属性の維持。 |

外部仕様の参照: [Node.js 24 Worker 公式資料](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html)、[SQLite WAL 公式資料](https://www.sqlite.org/wal.html)。Worker の `online` は業務初期化完了ではなく、`exit` が終了確認である。WAL でも busy と checkpoint の制約は残る。これらを以下の状態遷移と DB 制御へ反映する。Node.js 24 と better-sqlite3 は現行依存を使い、新規依存を追加しない。

**実挙動未確認:** 本設計時点では実 Worker 起動、並行 WAL、終了・再開、ブラウザ、負荷計測を実行していない。既存サーバー・実データには操作を加えていない。数値は有限待機の設計値であり、性能保証ではない。製造・検収で一時 DB と専用キャッシュ・ポートを使い確認する。

## 2. 変更範囲と構成

| 所有者 | 責務 |
| --- | --- |
| メイン | 共通設定安全検査、保持 DB/lease、HTTP、端末/会場解決、全通知保存・配信、session/claim/監査、取得操作レーン、判定 checkpoint 正本、Worker 管理・異常通知・再開履歴、最終報告からの監視応答。 |
| 取得 Worker | 気象 DB 検査/open/migration/唯一 writer/lease、XML 取得・解析・採用・再処理・復旧、アメダス、画像索引、タイル取得・保存・削除・清掃、取得 scheduler、通知判定、更新の公開ゲート。保持 DB を import/open しない。 |
| 暫定 reader（メイン内） | 独立 read-only 接続、6種の気象 API、times、保存済み PNG、履歴/原文/通知参照、processing、気象監視集計、起動現況投影。外部取得・migration・清掃を行わない。 |

全気象書込みについて、SQL の INSERT/UPDATE/DELETE、repository の record/upsert、ファイルの write/rename/unlink、キャッシュ清掃、起動リカバリを call graph で棚卸しする。HTTP と reader の画像 service から writer へ抜ける経路を残さない。

| 新規/改訂モジュール案 | 具体的な責務・入口 |
| --- | --- |
| `runtime/createApplicationRuntime.ts`、`server.ts` | 両起動入口共通の非同期 bootstrap。`startServer()` は HTTP 待受時点で返し、気象準備は別の観測 Promise にする。旧テスト専用の同期 service DI は inline 専用ヘルパーへ隔離する。 |
| `runtime/acquisitionWorker.ts` | `parentPort` を通した取得 Worker の入口。HTTP listen・保持 DB 初期化を実行しない。 |
| `runtime/createAcquisitionRuntime.ts` | 取得 service の構成、起動準備、更新、停止。`server.ts` の気象側処理を移す。 |
| `runtime/acquisitionWorkerHost.ts` | spawn、epoch/lease 所有記録、message 検証、要求期限、状態、error/exit、再開・shutdown。 |
| `runtime/weatherTransport.ts`、`weatherContracts.ts` | 型付きメッセージ、ACK、上限、古い応答の拒否。既存契約を拡張する。 |
| `runtime/weatherDecisionRuntime.ts`、`weatherPublication.ts` | Worker 側同期処理と非同期 ACK、公開ゲート。保持 sink と checkpoint 正本はメイン。 |
| `database/pairConfig.ts`、`pairSafety.ts`、`pair.ts` | 共通の衝突検査、role ごとの検査/lease/初期化、互換の pair helper。reset は既存の両 role lease 取得を維持。 |
| `database/weatherReader.ts`、`runtime/inlineWeatherRead.ts` | read-only open/検証/close、readerEpoch、公開 scope、busy の変換。 |
| `runtime/acquisitionControlTargets.ts` | Worker port に対するローカル facade。service インスタンスを境界に渡さない。 |
| `services/weatherWorkerControlService.ts`、`repositories/weatherWorkerOperationRepository.ts` | 再開操作の冪等性、保持記録、照会。 |
| `migrations/retained/0002_weather_worker_operation.sql` | 再開専用台帳。既存の取得操作 table とその意味を変えない。 |
| `packages/shared/src/weatherRuntime.ts`、監視/通知 DTO、API 検証器 | runtime 欄、再開操作・履歴、通知定義の型を接続。 |
| `apps/web/src/monitoring/WeatherWorkerStatus.tsx` と API/controller | 最小限の状態・再開・結果欄。既存 MD ラッパーと色トークンを使用。 |

パス・細かな内部関数名は製造時に同じ責務内で調整可能。気象 schema の意味変更、parser/採用ルール変更、保持 DB 救済、全画面再設計、TRC 削除、提供 Worker は対象外。

### 2.1 起動手段と試験口

本番は `new Worker(new URL('./acquisitionWorker.js', import.meta.url), {workerData, execArgv: []})` を基本とし、TypeScript build が出力した ESM を起動する。開発・テストのソース実行では、既存の `tsx/esm/api` の `register()` を使う固定 ESM bootstrap から `.ts` 入口を import する。bootstrap 用モジュール URL はホスト側で解決し、テスト runner の preload/execArgv を無差別に継承しない。現在の tsx 依存に当該 API があることは型定義で確認済み、実 Worker ロードは AC1 で確認する。本番経路は tsx を要求しない。

Worker 設定は plain object（DB/cache パス、解決済み会場/端末配列、polling 設定、開始時刻、epoch、checkpoint、desiredRunning 等）に固定する。URL は文字列、日時は ISO、集合は配列。fetch 関数・DB 接続・registry/service 実体は転送しない。テストは固定 HTTP fixture サーバーとテスト専用 Worker 入口/明示的 DI で障害を注入し、本番 HTTP に障害注入口を公開しない。

`StartedServer` の観測口は次の形へ移行する。既存 HTTP 契約は維持するが、`startServer()` が初回取得完了まで待つテスト専用挙動は、気象初期化失敗の隔離に合わせて明示的に変更する。旧 service 実体の参照が必要な単体試験は inline factory で実施し、結合試験を inline へ逃がさない。

```ts
interface StartedServer {
  readonly port: number;
  readonly weatherPrepared: Promise<WeatherPreparationOutcome>;
  readonly fetchControlService: FetchControlService;
  close(options?: { readonly reason?: 'signal' | 'programmatic' }): Promise<void>;
}
type WeatherPreparationOutcome =
  | { readonly status: 'ready'; readonly workerGeneration: string }
  | { readonly status: 'failed'; readonly code: string };
```

Promise は準備失敗を結果として返し、未処理 rejection でメインを落とさない。後続の再開結果は再開操作 API と監視で観測する。

## 3. DB 起動・接続・lease

### 3.1 待受前の共通安全性と role 固有失敗

現 `resolve/validateDatabasePairConfig` をそのままメインで呼ぶと、気象単独のファイル不正・アクセス不可まで HTTP 起動を止める。次の二段階へ分割する。

1. メインは設定文字列/role、通常ファイルパスという形式、両 DB と付随/管理パスの字句上の衝突を検査する。解決可能な親ディレクトリの canonical path、存在するファイルの dev/ino も照合し、同一ファイル・hardlink・管理領域重複を拒否する。気象内容の hash/copy/SQLite open はここで実行しない。
2. 気象パスの参照が EACCES 等で安全に確定できない場合は、保持 DB の安全な単独起動を成立させたうえで「気象側検査失敗」とする。**未確認の気象パスに writer を開かない**。衝突が判明した場合は共通違反として起動を拒否する。安全性未確認を「別ファイル確認済み」と扱わない。
3. メインは保持 role の通常ファイル/symlink/付随ファイル・identity/schema・未完了 reset・コピー検査・lease を検証して初期化する。保持障害・既存の共通設定不正は従来どおりプロセス起動失敗。
4. 保持初期化後に HTTP/system/監視を開始してから、取得 Worker に気象 role の検査を依頼する。気象単独の通常ファイル違反、symlink、open、identity、migration、未完了 reset は取得側失敗とし、当該ファイルを変更せずメインを継続する。
5. Worker は気象を変更する前と lease 取得後に、canonical path/ファイル同一性と保持側予約先との不一致を再検証する。途中の差替え・共通衝突は気象初期化を拒否し、既に待受済みのメインでは system 異常として報告する。設定変更・パス差替えを自動救済しない。

共通検査は filesystem metadata のみであり、気象 DB 容量に比例するコピー/hash/quick_check はすべて Worker で行う。保持 DB の検査は従来どおりメインが責任を持つ。

### 3.2 WAL・read-only・公開可能性

- 気象 writer は検査・migration と identity 確認後に WAL を有効化し、戻り値が `wal` であることを検証する。`synchronous=FULL`、writer/reader とも `busy_timeout=100` ms。保持 DB の journal 設定は変更しない。
- `wal_autocheckpoint=1000`（ページ）、通常 checkpoint は PASSIVE。busy を無限 retry しない。最終停止時は reader close 後に checkpoint を試み、失敗時も sidecar を削除せず、成功と偽らず記録して接続を閉じる。
- Worker は検査済み `{weatherDatabaseGenerationId, schemaFamily, schemaVersion}` を `database.ready` で送る。メインは新しい readerEpoch を発行し、`{readonly:true, fileMustExist:true, timeout:100}` と `query_only=ON` で開く。role/family/instance と適用済み migration を独立照合してから提供を開始する。reader は migration を実行しない。
- reader transaction は単一要求の必要な SQL 読取に限定し、await、Worker ACK、ファイル読取、HTTP をまたがない。busy は `WeatherRequestError('busy')`、未準備は `not_ready`、読取破損は `database_unavailable/read_failed` へ分類する。
- 気象情報は会場×controlStatus×情報種の公開可否を持つ。保存済み整合性検証後の値は復旧探索中も提供し、復旧置換は既存単位の短い transaction で一括 commit。不整合・未検証 scope は既存 unavailable と監視 read error で返し、正常な空へ変換しない。
- 公開可否を変える更新の開始時に scope をメインへ登録する。メインは開始 ACK から完了 ACK まで該当 scope を未確定として扱う。既に検証済みの旧値を返す経路では transaction により整合した snapshot のみ返す。更新途中終了で不確定になった scope の起動通知は ready にしない。
- 取得 Worker 終了後、検証済み reader は維持する。availability は現在時刻・既存鮮度規則で評価し、Worker 停止とは別表示。異常終了しただけで全気象値を空にしない。

### 3.3 lease と再検査

lease は role 単位の取得・解放を新設し、reset の両 role 取得はその合成とする。既存 `.writer-lock/owner.json` 形式を拡張する。

```ts
interface WriterLeaseOwner {
  readonly pid: number;
  readonly role: 'weather' | 'retained';
  readonly token: string;
  readonly startedAt: string;
  readonly serverGenerationId: string;
  readonly workerGeneration: string | null;
  readonly threadId: number | null;
}
```

メインは Worker を作る前にその世代と lease token を生成して所有予定を記憶し、生成直後の threadId も保存する（exit 後の threadId 値を所有証明に使わない）。気象 Worker が排他的に lease を作成し、owner を書き、取得完了を報告してから DB を open する。メインは `database.ready` を待たずとも終了した Worker の予定 token を照合できる。

正常時は Worker が writer close 後に自己所有 token を照合して解放する。異常時はメインが **実 Worker の exit 確認＋保存済み予定 token/世代/PID/threadId の一致** を満たしたときのみ残留 lease を回収する。`error` やタイムアウトだけでは回収しない。owner 不在/不完全・別 token・別 PID の lock は自動削除せず、再開失敗 `lease_owner_unverified` として残す。lease 作成途中終了という確認不能な窓を隠さず、停止済みの確認と既存の運用調査が必要な状態として扱う。生きた他所有者の lock を PID だけで奪わない。

再開時は旧 Worker の終了を確定し、reader 新規要求/token を失効→非同期読取を drain→reader close ACK→所有 lease の回収/確認→新 Worker の検査/migration→新 readerEpoch で再 open の順とする。schema が変わらなくてもコピー検査中は reader を閉じる。close を確認できなければ新 Worker に migration を許可しない。通常の気象復旧探索はこの接続停止と区別する。

## 4. メッセージと有界制御

既存 `WeatherRequest/Reply/Epoch`、`DecisionCheckpoint/Batch/Receipt`、`WeatherUpdateUnit` を利用する。`serverGenerationId` はメイン起動単位、`workerGeneration` は起動ごと、DB 世代は `__database_identity.instance_id`、readerEpoch は再接続ごと。Worker 再開でサーバー世代・通知 sequence・既存 claim を更新しない。

```ts
type AcquisitionEvent =
  | { readonly kind: 'runtime.accepting'; readonly epoch: WeatherEpoch }
  | { readonly kind: 'database.ready'; readonly epoch: WeatherEpoch;
      readonly weatherDatabaseGenerationId: string;
      readonly schemaFamily: string; readonly schemaVersion: number }
  | { readonly kind: 'update.begin'; readonly unit: WeatherUpdateUnit }
  | { readonly kind: 'decision.batch'; readonly batch: DecisionBatch }
  | { readonly kind: 'update.complete'; readonly epoch: WeatherEpoch;
      readonly unitId: string; readonly acceptedRevision: number }
  | { readonly kind: 'status'; readonly epoch: WeatherEpoch;
      readonly report: AcquisitionStatusReport }
  | { readonly kind: 'initialization.failed'; readonly epoch: WeatherEpoch;
      readonly code: string };
type AcquisitionStatusReport = {
  readonly reportedAt: string;
  readonly desiredRunning: boolean;
  readonly operation: MonitoringOperationSection | null;
  readonly health: MonitoringHealthSection | null;
  readonly preparation: WeatherPreparationReport;
  readonly pendingOperationIds: readonly string[];
  readonly completedOperations: readonly AcquisitionOperationOutcome[];
};
```

型中の preparation/outcome は次のデータ型を設ける。

```ts
type WeatherPreparationReport = {
  readonly readiness: MonitoringReadinessSection;
  readonly venues: readonly MonitoringVenueSection[];
  readonly publishedScopes: readonly {
    readonly venueId: string;
    readonly controlStatus: WeatherControlStatus;
    readonly informationKind: MonitoringInformationKind;
    readonly status: 'verified' | 'unverified' | 'inconsistent';
  }[];
};
type AcquisitionOperationOutcome = {
  readonly operationId: string;
  readonly result: 'success' | 'failure' | 'unknown';
  readonly completedAt: string;
  readonly errorCode: string | null;
};
```

`venues` の気象集計部分は暫定 reader のサンプルと合成し、Worker から進捗を送る際に全電文/原文を付加しない。例外・stack・絶対ローカルパスを外部 API の errorCode/message に含めない。メッセージに protocolVersion と世代を持たせ、受信時にも data/schema/件数・サイズを検証する。旧世代は副作用前に拒否する。

lifecycle は制御処理の健全性であり、OS スレッドの終了証明には使わない。`WeatherRuntimeStatus` に `exitConfirmed:boolean` と `failureCode:null|'initial_accept_timeout'|'handshake_timeout'|'protocol_error'|'payload_too_large'` を追加する。プロトコル/更新 handshake の失敗、候補のサイズ超過では新規取得・通知に関係する更新を抑止し、lifecycle=failed、対応する failureCode と未完了 scope を表示する。heartbeat が届いて fresh でも failed は専用再開可能。stopReason は exit 未確認の間は null とし、終了済みと偽らない。制御/監視/停止メッセージの受信だけは維持し、手動再開から通常の drain→terminate→exit 確認へ進む。メイン検知と Worker 自己検知の双方で同じ状態に遷移させる。

spawn から5秒以内に `runtime.accepting` が届かない場合も lifecycle=failed、failureCode=initial_accept_timeout とする。Worker が開始したか不明なら再開操作は unknown、明確な起動エラーがあれば failure。reportFreshness=unknown のままでも再開操作を許可し、存在する Worker handle に対する停止・exit 確認を必ず先行させる。遅れて accepting/status が届いても失敗を自動解除して更新を始めず、旧世代の停止確認と次の明示再開へ進む。初回5秒期限は設定/checkpoint の受付までで、DB 初期化/復旧の完了を5秒に制限しない。

`runtime.accepting` は設定/checkpoint の受領・制御要求を処理できる状態を示す。DB 準備とは別である。Worker はこの送信後、メインの `runtime.authorize` ACK を待機し、受領するまで lease 取得・気象ファイル検査・DB open/migration・取得を始めない。ACK は protocolVersion、workerGeneration、起動nonce、許可期限を持つ。メインは初回5秒以内かつ current世代・starting/restarting・未失効の場合だけ発行する。Workerもnonce/世代/期限を照合し、期限後/旧世代ACKから初期化を開始しない。初回受付期限後の後着acceptingには許可を出さず、停止要求だけを返す。メインが許可した後のDB検査の長期化は初回受付不明と区別し、既存の状態報告・手動再開で扱う。

初回 epoch の weatherDatabaseGenerationId は null。`database.ready` の包絡はその未確定 epoch を保ち、検査済みの新DB世代を独立フィールドに含める。メインは現在の許可済みWorkerとschemaを確認し、checkpoint正本のepochを判定値を保持したまま新DB世代へ置き換え、`database.accepted` ACKで確定epochを返す。WorkerはこのACKまで更新単位を開始しない。メインは同じ確定DB世代でreaderEpochを発行し、reader独立検証後に読取を公開する。以降のstatus/unit/候補は確定epochだけを受理する。未確定epochの遅延statusで確定済みDB世代をnullへ戻さない。Worker再開で既存DB世代を再確認してもinstance_idそのものは更新しない。`database.ready` は reader 検証開始条件、気象 ready はさらに scope 検証・準備評価を要する。初期化失敗は該当 code を報告した後に Worker が cleanup/exit し、メインは `initialization_failed` を保持する。

| 制御 | 上限・処理 |
| --- | --- |
| 読取/起動要求 | 受付から5秒、全64件・起動8件。閉鎖後の新規要求は恒久拒否。 |
| 公開ゲート | pause ACK から最大2秒、起動要求全体5秒以内。 |
| 制御受付/ACK・更新 handshake | 5秒。長い取得/復旧の処理完了期限と混同しない。ACK 不明なら気象更新の次単位を開始せず、状態を結果不明として監視可能にする。 |
| 通常取得操作 | 合流後16件、停止用1枠を予約。5秒以内に受付を確認し、その後は操作 ID と status 報告で完了を追う。 |
| tile.ensure | 論理要求16件・取得4並列、同一キー合流。待機30秒。保存済み読取とは別枠。 |
| Worker status | 変化時＋5秒ごと。メイン受領から15秒超で stale。送信中の状態報告は次の最新1件に合流する。 |
| 通信量 | 1 frame 256 KiB、role ごとの未 ACK payload 総計8 MiB。通知 batch は group を論理的に保ったまま frame 化し、メインは最大8 MiBの組立てが揃ってから保存する。 |
| 更新候補 | 同時1 unit、未 ACK batch 1件。8 MiBを超す単位は黙って切捨てず protocol/busy 失敗として当該処理を止め、結果不明 scope を表示する。 |
| 世代内結果キャッシュ | 操作結果は既存同様最大200件、履歴があれば保持 DB で照合する。unknown unit は既存最大200件。不要になった世代の transport map は解放する。 |
| 停止 | drain 10秒、明示再開/shutdown の終了要求後さらに10秒で確認不能を unknown とする。終了確認前に代替を起動しない。 |

これらは初期制御値であり測定による処理時間の保証ではない。長い同期解析が Worker 内の heartbeat を止めれば stale を表示するが、これだけで terminate しない。大量の状態送信やタイル要求で通知 ACK/停止経路が詰まらないよう制御メッセージ用の独立枠を設け、無制限 queue を作らない。

## 5. 通知判定・公開ゲート

### 5.1 更新の順序

`createWeatherDecisionRuntime` はメインの checkpoint/sink と、取得 Worker の planner/tracker を分離する。現在の `runSync` 内からメインへ同期呼出しできるという前提を取り除く。

1. 上流取得・解析・復旧探索を更新単位の外で行う。
2. Worker の FIFO 更新レーンに入り、`update.begin`（scope、初回 keys、beforeRevision、unitId）を送る。メインの登録 ACK まで DB を変更しない。
3. Worker 内で既存の同期 DB transaction・通知判定を実行し、候補 group と判定後 checkpoint を生成する。DB transaction 中に ACK を待たない。
4. `decision.batch` をメインへ送る。メインは世代/登録単位/revision を検証し、既存 group 単位で保持への保存を試行する。保存失敗も checkpoint を進め、receipt を記憶して ACK する。
5. Worker は ACK の checkpoint を確定し、`update.complete` を送る。メインは単位を完了する。ここまで終わってから次更新または pause へ進む。0候補でも状態変化を受領確定する。

同一 eventId の重複は既存 receipt を返し、保存を再試行しない。異なる内容の同一 ID は拒否する。開始 ACK 喪失では DB 未着手、候補 ACK 喪失ではメイン受領有無を同じ unit/eventId で照合し、新たな通常通知として再実行しない。未確認のまま処理を継続しない。メイン自体が終了する場合の永続配送保証は追加しない。

異常終了時は #256 §6.2 の停止位置別ルールをそのまま実通信に適用する。未受領 unit の登録済み初回 keys だけを消費し、未着手会場は抑止しない。fetch_health はメインで受領した previousStatus/activeSinceAt を引き継ぐ。未完了 scope は監視で「結果不明」、再開後に整合を再検証する。同じ安定 ID の初回失敗/復旧通知を再保存しない。通常例外で実際に未評価の keys まで消費する実装にしない。

### 5.2 起動現況・cursor・claim

1. メインは startup 待機枠を確保し、世代付き token と期限を作り `publication.pause` を送る。
2. Worker は先行更新の候補受領・完了まで FIFO で待ち、通知に関係する新規 commit を止めて、revision と期限を ACK する。上流通信・解析・通知に関係しないタイル書込みはこのゲートに含めない。
3. メインは pause ACK/未完了 unit 不在/readerEpoch と公開 scope を検証し、read-only reader で起動現況を取得する。SQL と DTO 投影は保持 transaction 外。
4. メインは token の期限・全世代・readerEpoch を再検証し、既存の短い同期保持 transaction で cursor/session/claim/監査を一括確定する。通知候補保存とこの transaction はメインの同一イベントループ上で直列に処理する。
5. release を送る。Worker は同じ token だけを解放する。期限到達時は Worker 自身も解放し、メインは期限後に保持 transaction を開始しない。中断・失敗・再開で token を先に失効させる。

Worker 内で期限が来た直後に更新が始まっても、メイン側は期限内に開始した同期保持 transaction 中へ候補 message を割り込ませない。次更新の候補はその後の sequence になり、投影済み現況と cursor の対応が保たれる。投影・監査失敗時に session/claim だけ確定しない。

取得 Worker が終了済みで、未完了単位がなく保存済み scope が検証済みなら、メインが writer 不在の token を作り起動現況を提供できる。未完了 scope がある場合はその気象起動現況を ready にしない。system 差分・保持履歴・保存済みの読取可能な情報の提供は継続する。

## 6. 通常取得操作・再開操作

### 6.1 通常操作と desiredRunning

`FetchControlService` のレーン、合流、requestId 照合、lastStoppedAt、保持記録/メモリ fallback はメイン所有のままにする。Worker 側は実行と経過/結果報告を担当する。

- 初回 desiredRunning は既存 enablePolling/DISABLE_POLLING と開始条件から決める。夜間の上流禁止は desiredRunning と別の既存条件として評価する。
- 取得開始/停止要求を **メインの操作レーンが新規の有効な論理操作として受け付けた時点** で、送信前に desiredRunning と単調増加する intentRevision を記憶する。同一IDの照会・再POSTでは更新しない。Workerの受付ACKを意図保存の条件にしないため、停止ACK喪失直後にWorkerが終了しても停止意図を引き継げる。未送信/明示的拒否で未実行が確定した場合だけ、そのintentRevisionが依然最新なら直前の意図へ戻す。送信済み・結果不明なら最後にメインが受け付けた意図を保持し、後から届く古い結果で新しい意図を上書きしない。完了未確認は成功とは表示せず、lastStoppedAtは既存の成功確定条件で更新する。Worker再開はこの最新意図を引き継ぎ、停止意図なら取得を自動開始しない。
- 再開で必要な DB 検査・ローカル整合再評価は行うが、desiredRunning=false のとき上流取得を始めない。30分停止後の「取得開始」に伴う復旧は既存 FetchControlService の条件と操作記録を維持する。再開を取得開始の代用にしない。
- 5秒の受付期限前に未送信/明示拒否なら failure。送信済みで受付・結果が不明なら同じ operationId の照会を行い、未確認の実行を再送しない。status が実行中を報告する間は in_progress。世代終了・期限による照合不能は `result:'failure', errorCode:'operation_result_unknown'` と「処理結果を確認できません」で記録する。通常の失敗と取り違えない。
- 現在 `acquisitionControlTargets` が一般 Error に畳む箇所に専用エラー/結果型を通し、FetchControlService の catch で unknown code を保持する。強制更新の結果不明を「実行されなかった」と通知しない。
- 同じ requestId の再 POST は保持結果/実行中を返す。再開中・Worker 停止中の通常取得操作は不可/利用不能を返し、Worker を生成しない。上流通信の既存 retry は変更しない。

### 6.2 再開 API と保持履歴

#256 の契約を公開する。

| エンドポイント | 応答・条件 |
| --- | --- |
| `POST /api/control/weather-workers/acquisition/restart` | `{requestId, expectedWorkerGeneration}`。受付202、同じ ID/同じ内容は既存操作。未知 role/ID 不正400、別内容の同じ ID・世代不一致・fresh ready・別 ID の再開中409。 |
| `GET /api/control/weather-workers/operations/:requestId` | 既存 `WeatherRestartOperation`（in_progress / completed success・failure・unknown）。不在404。 |
| `GET /api/monitoring/weather-worker-operations?limit=...&beforeId=...` | 新しい専用履歴 DTO。既存一覧同様上限200、降順と cursor を固定し、DB 記録・メモリ fallback を区別する。 |

#257 では `delivery` 再開は未提供として400を返し、UI 操作を置かない。再開可否は failed/stopped または report stale で、stopping/restarting 中は false。全体 shutdown 開始後は常に拒否する。

再開 table の列は `id`、unique `request_id`、`role`、`expected_worker_generation`、`new_worker_generation`（nullable）、`server_generation_id`、`status`（in_progress/completed）、`result`（success/failure/unknown/null）、`requested_at`、`completed_at`、`error_code`、`error_message`。role/result/status と null の組合せを CHECK、要求内容は ID と同時に保存する。保持の既存取得操作 table には追加しない。

再開履歴の DTO は以下とする。requestId 照会にも `historyRecorded` を追加し、履歴 API は保持済みのレコードのみを返す。保存失敗 fallback は操作結果欄へ表示し、履歴に存在すると偽装しない。

```ts
interface WeatherWorkerOperationHistoryItem {
  readonly id: number;
  readonly operation: WeatherRestartOperation;
  readonly expectedWorkerGeneration: string;
  readonly serverGenerationId: string;
  readonly requestedAt: string;
  readonly completedAt: string | null;
}
interface WeatherWorkerOperationHistoryResponse {
  readonly status: 'ready';
  readonly generatedAt: string;
  readonly items: readonly WeatherWorkerOperationHistoryItem[];
  readonly nextBeforeId: number | null;
}
```

受付時に in_progress を保存してから開始する。保存失敗時は既存取得操作と同様にメインの有界メモリ fallback に保持し、結果へ `historyRecorded:false` を付加して記録失敗を表示する（shared DTO に追加）。同一メイン寿命内の重複実行防止は維持し、DB 救済保証は増やさない。メイン再起動時に残存 in_progress は unknown として閉じ、再実行しない。完了保存失敗も fallback で結果照合を維持する。

### 6.3 再開手順・結果

1. 操作を直列化して `restarting`、「停止を確認中」。旧世代 token/要求を失効させる。
2. 旧 Worker が生存していれば新規取得を止めて runtime.close。10秒 drain 後も未終了なら、**この明示再開操作の一部として** terminate。さらに10秒で exit 未確認なら unknown、旧世代/leaseを保持し終了確認の継続だけを行う。遅れて exit が来ても新 Worker を自動生成せず、次の専用操作を待つ。
3. exit 確認後、reader drain/close と lease 照合、checkpoint の不明単位の処理を終える。いずれか確認不能なら failure/unknown の code を返し、新 writer を作らない。
4. 新 Worker 世代・lease token を発行し、引継ぎ状態を渡す。`runtime.accepting` を確認したら再開操作 success。これは要求受付の再成立であり、気象 DB/準備の成功ではない。
5. 後続の DB/気象初期化失敗は runtime failed と専用異常通知で観測する。再開操作を後から成功→失敗へ改竄しない。runtime.accepting 前の Worker 起動失敗は failure、起動したか確定できない場合は unknown。

再開の success 文言は「取得Workerを再開しました。気象情報は準備中です」（気象未準備の場合）。気象準備済みなら「取得Workerを再開しました」。取得停止の意図を保持した場合は「取得Workerを再開しました。取得は停止したままです」とし、別項目の通常取得状態「停止」も表示し続ける。#256 の「取得処理を再開」は今回の文言具体化で「取得Workerを再開」に揃え、通常の取得開始との混同を避ける。

## 7. タイル・監視・通知・最小 UI

### 7.1 タイル

保存済み read→miss の場合だけ Worker `tile.ensure`→保存済み read の順を維持する。PNG 本体は取得 Worker から返さず、検証済みの識別子だけ返す。read-only 側へ `getTile` の取得機能や清掃を渡さない。既存時間帯/明示取得条件、HTTP status/error/`tileResult`/`storedAt`/`catalogAvailability` を維持する。

DB transaction の外で非同期ファイル open/read/close を行い、metadata のバイト数・hash・PNG と照合する。ファイル参照中の差替えは既存の一時ファイル→rename、清掃は取得 Worker だけが実施する。消失または metadata/hash の不一致時は metadata 再取得＋read を **1回だけ** やり直す。それでも不一致なら miss として有界 ensure 経路へ進み、ensure 後も読めなければ既存 `tile_read_failed` とする。破損を正常 PNG として返さず、空/部分ファイルを返さない。取得 Worker 不在でも保存済み read は要求でき、miss は有限の利用不能になる。新しいキャッシュ配置・保存期間の変更は行わない。

### 7.2 監視と system 異常通知

`MonitoringStatusResponse` に `weatherRuntimes: {acquisition: WeatherRuntimeStatus, delivery: WeatherRuntimeStatus}` を追加する。delivery は今回 `mode:'inline'`、再開操作非対象。既存各 section は維持し、取得状態は Worker 最終報告、気象読取集計は暫定 reader の周期サンプル、保持状態はメインから合成する。監視 GET から取得 RPC/読取集計を開始しない。生成時刻は注入時計を使う。

起動直後/DB失敗には未知の状態・取得元/情報一覧の unavailable を明示し、空の正常サンプルを作らない。現 `createApplicationRuntime` の「監視報告が未受領です」という throw は除き、設定とメイン状態だけで部分応答を構成する。health は6取得元を残して status/evaluatedAt=null、readiness は not_started または failed、information は会場ごとの8情報種を残して unavailable・件数/時刻=null とする。recentAdoptions と tiles は既存の読取失敗 DTO と readErrors を使い、表示は0件成功でなく「—／読取不能」とする。operation の schedulerRunning は初期には false だが、Worker未報告を表す runtime の unknown/starting を併記し、UI は通常停止と断定しない。監視 response の `status:ready` は応答構成成功の意味であり、気象準備完了ではない。Worker reportFreshness は受領時刻で計算し、停止理由・最終報告・再開可否と初回同期/復旧進捗を分けて返す。未完了 unit は scope と「結果不明」を付加し、旧進捗を新世代の実行中にしない。

異常はメインが origin=system、category=question、isTraining=false、equipment 対象、sourceType=`weather_worker` で保存する。role×世代×異常種別につき保存試行1回。error→exit は異常終了1件へ合流し、初期化失敗後の exit も初期化失敗1件とする。stale は別種別で世代内1件、復帰後再 stale でも再保存しない。初回受付不明・handshake/protocol/容量失敗は `failureCode` を異常種別として1件記録し、「終了」とは通知しない。これに伴う明示停止での exit は新たな異常終了通知にしない。これらの通知生成は Worker の自己報告に依存せず、ホスト側の期限/容量/検証エラーからメインが直接実行する。ホスト検知とWorker報告の両方が到着しても同じrole×世代×failureCodeで合流し、fresh/unknownを理由に通知を抑止しない。再開・正常停止そのものを異常通知にしない。保存失敗で再試行せず、復帰時の既存 question 自動確認も行わない。

| 通知定義 ID 案 | 文面 |
| --- | --- |
| `system-weather-acquisition-initialization-failed` | 気象取得処理の準備に失敗しました。監視画面で状態を確認してください。 |
| `system-weather-acquisition-exited` | 気象取得処理が停止しました。監視画面から再開できます。 |
| `system-weather-acquisition-report-stale` | 気象取得処理の応答を確認できません。監視画面で状態を確認してください。 |
| `system-weather-acquisition-control-failed` | 気象取得Workerの処理を継続できません。監視画面で状態を確認してください。 |

発生時刻と世代・再開操作への参照を履歴に残す。例外文の無制限露出はしない。配信スコープと H/K の扱いは既存 equipment system 通知と同じ。

### 7.3 最小 UI

監視画面の既存カード群と取得元表の間に、取得 Worker の状態/最終報告/停止理由/「取得Workerを再開」ボタン/直近の再開結果を1つの section として追加する。通常停止と Worker 異常を同じラベルにしない。再開履歴はこの section 内の「再開履歴」展開で閲覧し、既存の取得操作履歴とは混在させない。

クリック時に requestId を1回発行し、即時 disabled と progress を表示する。POST の応答を失ったら同じ ID の GET で照会し、UI 側で新 ID の自動再送をしない。1秒周期の有界照会で追い、30秒で画面の連続照会を止め「結果を確認できません」を表示する。これはサーバー操作の失敗確定ではなく、明示の「結果を再確認」で同じ ID を問い合わせる。監視の通常更新は継続する。

未知状態/画面読み込み中/準備中で fresh/stopping/restarting/shutdown は無効。stale/failed/stopped でサーバーが許可する場合のみ有効。failed には初回受付不明・protocol/handshake失敗を含め、報告がfresh/unknownでも再開可能とする。409 は最新監視を再取得して表示を更新し、自動再開しない。操作後もボタンの DOM を維持しフォーカスを失わせず、結果領域は aria-live=polite。既存 MD ラッパー・テーマ変数を使用する。幅360/768/1280px、キーボード Tab/Enter/Space、既存 H/K、通常取得操作を実ブラウザで検証する。画面全体の情報配置とツールバー整理は #259。

## 8. shutdown と reset

新規 HTTP/操作/role 要求受付停止→公開 token/readerEpoch 失効→Worker の timer/新規取得停止と abort/drain→暫定 reader の要求 drain/close→Worker writer close/exit 確認→各所有 lease 解放→既存停止通知/操作記録の完了→保持 DB close の順にする。保持記録は必ず保持 close 前に終える。close は冪等、新規要求拒否は解除しない。

10秒 drain 超過は停止未完了を報告し、shutdown の明示要求に伴って terminate を試みる。終了確認不能・DB close/lease 解放失敗を成功へ畳まない。メインは終了確認待ちの限界を返せるが、停止完了とは記録しない。dev runner が旧プロセスの終了前に新 API を起動しない現契約を維持する。

reset は全体停止後のみ。既存 lsof は read-only 接続も含め、気象/保持の本体・WAL/SHM/journal 全部へ実行する。気象 Worker だけの停止を reset 許可にしない。台帳/digest/resume/保持不変を維持し、checkpoint 失敗を sidecar 手動削除で解消しない。

## 9. 製造順序・受け入れ条件

承認後に指定ブランチで製造する。最初に Worker bootstrap と DB 分離、その後全書込み移行、通知/公開境界、操作/監視/UI の順で接続する。各段階の回帰を通し、最後に実 Worker 結合検収を行う。テストは一時ファイル DB、固定 fixture、専用 cache/port、隔離ブラウザを使用し、実運用サーバーへ障害を入れない。

新規試験は意味を変えない対照改変が通る確認を先に行い、対象を壊す改変で実際に落ちる red を確認して復元する。項目ごとの実行コマンド・fixture・観測値・対照/red 結果を検収報告に残す。

- [ ] **AC1 / B1 起動・所有:** 開発 TS と本番 build の両方で実 Worker/HTTP を起動する。threadId≠メイン、取得 Worker 1つ、気象 writer/lease 1つ。SQL/ファイル書込みの棚卸しを全経路（通常/復旧/再処理/アメダス/画像索引/tile miss/履歴/清掃）と対応付ける。メインの read-only 接続で INSERT を試み拒否され、保持接続はメインだけで合格。
- [ ] **AC2 / B2 起動失敗隔離:** 気象 EACCES/open、非通常ファイル、壊れた schema/migration、復旧 throw を別々に注入する。HTTP listen・health・監視・system 差分が応答し、既存保持通知/操作行が不変、初期化異常通知1件、気象自動削除0件。同一 path/hardlink/管理領域衝突・保持障害は既存方針どおり起動拒否。未確認気象パスで writer を開かない。
- [ ] **AC3 / B3 reader 調停:** database.ready 前、migration 保留中、reader close 未了中へ要求を送り、未検証 schema/旧 readerEpoch の応答が成功しない。検証済み旧 snapshot は復旧探索中に提供し、不整合 scope は unavailable。再開後の新 DB/reader 世代のみ採用。空の正常データへの置換0件。
- [ ] **AC4 / B4 異常終了:** 実 Worker を `terminate` と未捕捉例外で終了させる。error/exit 二重通知なし、保持 system 継続、保存済み気象/PNG成功、missは有限失敗。時計を進め通常取得操作を行っても spawn 回数が増えない。report stale と終了理由が区別される。
- [ ] **AC5 / B5 再開競合:** 二重クリック/同一 ID/別 ID/旧世代要求/ACK 後着、旧 Worker が同期処理中、terminate 後 exit 未確認をそれぞれ実行する。旧 exit 前の新 writer 0、同一操作実行1回、別 ID 409、unknown 時の自動再開0。owner 完全一致時だけ残留 lease 解放、別 token/PID/不完全 owner は保持しエラー。reader close 失敗時 migration0回。実Worker入口でaccepting/statusを送らない障害を注入し、5秒後にunknown/failed・再開可へ進み、旧exit確認前のspawn0を確認する。期限後にaccepting/authorizeを後着させ、旧Workerのlease取得/DB初期化/更新0を確認する。database.readyの世代提案→accepted以前のunit拒否、null世代の遅延statusによる巻戻り0も確認する。
- [ ] **AC6 / B6 判定継承:** 初回警報/速報・fetch_health の既存異常を作り再開する。serverGenerationId/通知 sequence の継続、session/claim/確認状態不変、同一通知増分0、新規警報/速報・回復→異常は既存期待値どおり。保存失敗後も補完0。登録対象外会場の初回通知は通常どおり。
- [ ] **AC7 / B6 終了窓:** `update.begin` 前/ACK 後 commit 前/commit 後候補未受領/保持保存中/保存成功または失敗後 ACK 前/ACK 後完了前で実 Worker を終了する。#256 §6.2 の checkpoint/対象 keys/保存件数を完全一致で比較し、未完了 scope の結果不明表示、再開後の再検証を確認する。メインと Worker の mock 同居だけで代替しない。
- [ ] **AC8 / B7 公開整合:** 先行 weather 通知101、並行 system102、後続 weather103 の固定系列で、更新と複数 startup を並行実行する。起動現況は先行 snapshot、weather 差分は後続103、system差分は102、claim1件、監査と返却 JSON 一致。pause 前後/期限直前直後/ACK遅延/HTTP中断/読取失敗/監査失敗/世代交代を注入し、失敗問い合わせの session/claim/監査増分0と gate 解放を確認する。
- [ ] **AC9 / B8 操作:** 開始/停止/強制更新の同一 requestId、合流、30分境界、DISABLE_POLLING、夜間、上流retryを回帰する。停止済みで再開して上流取得0・通常状態停止維持。停止送信直後・受付ACK喪失後にWorkerを終了しても最新のメイン受付意図が引き継がれ、古い開始ACKで停止意図が覆らない。未送信拒否は最新revisionだけを戻す。受付/完了 ACK喪失は同 ID照合、二重実行0、未知は専用code/文言、確実な拒否はfailure。再開履歴保存失敗の fallback と履歴未記録表示、メイン再起動後の残存in_progress→unknownを検証する。
- [ ] **AC10 / B9 負荷分離:** 実 Worker に固定 XML 解析または復旧 DB 処理を同期的に繰返させ、実HTTP health/監視/system差分を並行送信する。試験用 latch で Worker 処理継続を確認した区間で各20回以上が応答し、health最大500ms・監視最大1秒を暫定回帰基準とする。system差分も全件2秒以内を初期検収基準とする。環境/fixture規模/CPU/最大・p95/処理回数を記録。基準未達は原因を切分け、未解決Promiseや平均値だけで合格にしない。最終構成の代表負荷判定は #260。
- [ ] **AC11 / B9 上限・DB競合:** 64/8/16/4要求、期限直前直後、frame 256KiB/8MiB境界を固定時計と実transportで検証。超過はbusy等の既定失敗、完了後pending0、閉鎖後新規拒否。外部検証接続でwriterロックを保持し、reader/writer busyが100ms設定で有限失敗すること、保持system/監視が無期限待ちにならないことを確認。WAL checkpoint busy時にsidecar削除0。候補8MiB超過と更新ACK期限超過を注入してheartbeatだけ継続させ、freshでもfailed/専用再開可、新規更新0、手動再開の旧exit確認を検証する。initial_accept/handshake/protocol/payload失敗についてメイン由来system異常が各種別1回で、Worker報告との重複0であることも確認する。
- [ ] **AC12 / B1・B3 タイル競合:** 保存済みreadと同一tile差替え/清掃を barrier で重ね、完全な旧/新PNGか有限miss/既定失敗だけになる。破損/不完全bytesの成功0。別tile miss取得を止めたまま保存済みtileとテキストが応答する。同一tile取得合流・4並列上限、DB記録/ファイル削除のスレッド所有を確認する。
- [ ] **AC13 / B10 終了/reset:** 正常、初回同期中、初期化失敗後、再開中で close を2回呼ぶ。新規要求拒否、timer/port/Worker/DB/自己所有lease残存0、停止記録の重複0。暫定readerだけを開いたケースもreset拒否し、全接続停止後のplan/apply/resumeは成功、保持DBの既存内容不変。終了未確認/他者leaseは成功扱いにしない。
- [ ] **AC14 / B11 既存回帰:** 1会場/複数会場、normal/training/test、isTraining、available/stale/unavailable、6気象API、times/tile、履歴/原文/通知参照を確認。#253 AC1〜13と #256 AC1〜14 の現在の保証を対応表で回帰する（#256のinline限定/非対象だった実Worker等は本書で置換）。画像準備中503、history generatedAt注入時計、通知参照weather_unavailableと真のreception_missingの区別、close後要求拒否を明示確認する。
- [ ] **AC15 / B12 ブラウザ:** 360/768/1280pxで正常/準備中/通常停止/異常終了/stale/再開中/再開成功後準備失敗/結果不明/記録失敗を表示。専用再開、二重操作抑止、同ID結果再確認、履歴表示、Tab/Enter/Space/フォーカス、H/Kと確認状態を実HTTP＋隔離ブラウザで検証。既存取得操作・ツールバー機能を削らず、MD3トークン/ラッパーを使用する。
- [ ] **AC16 / B12 品質と範囲:** `npm run lint`、`npm run typecheck`、`npm run format:check`、api/web/shared各workspaceのtest、`npm run build`、本番出力起動が成功。新規テスト対照/redの証跡を提示。提供Worker、全画面再配置、parser意味変更、保存期間変更、TRC削除、保持救済、通知永続再送、実環境操作がdiffにない。

AC10 の数値は親Issueの初期案を段階Bの限定fixtureへ適用した検収案で、実運用性能の達成報告ではない。結果が環境要因で判定不能の場合も未検証として統括へ返し、基準を無断で緩めない。

## 10. 承認用の要点・未決事項・後続への引継ぎ

**要点:** HTTP/保持の起動を気象初期化から独立させ、気象書込み全経路を取得 Worker に移す。メインは暫定read-only readerで保存済み情報を返す。通知判定正本・操作履歴をメインに保ち、実通信の ACK と公開ゲートで通知/起動現況の整合を維持する。再開は旧Worker終了・reader閉鎖・lease照合を経て一つだけ起動し、通常の取得停止意図を引き継ぐ。監視に最小限の専用再開と履歴を追加する。

**要ヒアリング事項:** 現時点ではなし。通知欠落許容は既合意。上記の技術方式・限定fixtureの暫定検収値は委任された詳細設計として承認対象に含める。製造中に既存保証・操作意味と両立しない事実が判明した場合は、実装で補完せず統括へ戻す。

| 後続 | 引継ぎ・今回の限界 |
| --- | --- |
| #258 | 暫定reader全体を提供Workerへ移す。readerEpoch/schema/DB世代、pause/release、タイルmiss、サイズ上限、保存済みファイル競合を引継ぎ、2 Worker実通信で再検証する。提供Worker異常/専用再開を追加する。 |
| #259 | 本IssueのUI・通知は暫定。必ずユーザーの監修を受け、配置・見た目・文言・通知を確定する。仮UIは流用予定なし。今回は必要な機能検証に限定する。機能上の状態・結果・再開履歴の要件を引き継ぎ、2 Workerの監視情報とツールバー配置はユーザー監修の下で設計する。通常停止/Worker停止/気象準備の意味を維持し、#257の機能検証合格を最終承認と扱わない。 |
| #260 | 最終構成の同一条件比較、代表DB規模・要求頻度の合意と実測、system/保存済みAPI/tileの最終目標、CPU/メモリ/WAL肥大、shutdown/reset/rollback・残留leaseの運用手順を整備する。Bの機能回帰・障害注入は先送りしない。 |

本Issueの完了だけで全気象負荷の分離完了とはしない。同期的な気象読取/DTO整形と一部PNG検証はメインに残る。Worker は同一プロセスであり、プロセス全体のメモリ枯渇・ネイティブ障害への完全隔離は保証しない。
