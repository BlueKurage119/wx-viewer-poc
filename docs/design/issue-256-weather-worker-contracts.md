# Issue #256 気象処理の入口と2 Worker間の契約

## 1. 位置づけと根拠

- 対象: [#256](https://github.com/BlueKurage119/wx-viewer-poc/issues/256)、親: [#255](https://github.com/BlueKurage119/wx-viewer-poc/issues/255)。設計状態は【承認済み】。2026-10-09にユーザーがサブエージェント式での製造開始・PR発行・初回レビュー対応まで承認した。マージは承認範囲に含まない。
- 製造ブランチ: `codex/issue-256-weather-worker-contracts`。
- 2026-10-09の着手時、ローカル `main` のHEADとリモート `main` はともに `3e95635bf46fb38a559d6ca9d63a36ce414c2ac2`（PR #254）。既存差分なし。両Issueのコメントは0件。
- ヒアリング確定事項: メイン＋取得Worker＋提供Workerの構成、各Workerは1つ、異常終了後は手動再開、保持履歴からのsystem配信、保存失敗の通知補完・再送なし。詳細の方式選定は統括へ委任済み。これらを再検討しない。
- **本Issueで実装するのは同一スレッドadapterと実運用経路の境界整理まで。** Worker起動・気象DB失敗の隔離・WAL有効化・再開HTTP/UIの追加は #257 / #258、画面全体の整理は #259、最終性能判定は #260。

| 参照 | 確認した事実と設計への反映 |
| --- | --- |
| `server.ts`、`app.ts` | `main()` と `startServer()` に構成処理が重複。両入口を共通の構成関数へ接続するが、待受・初回同期の戻り時点は保持する。 |
| `database/pair.ts`、`pairSafety.ts`、`resetWeatherDatabase.ts` | 両DBの検査・lease・初期化が一体。Aでは既存起動条件を維持し、Bで共通安全検査と各roleの初期化を分離する。 |
| `notifications/startupNotificationService.ts` | 保持DBのimmediate transaction中に気象DBを同期読取する。非同期readerへそのまま置換できない。§5の公開ゲートを使用する。 |
| `warningNotificationEmitter.ts`、`bosaiBulletinNotificationEmitter.ts`、`fetchHealthNotificationEmitter.ts` | 気象transaction終了後に保持へ記録し、初回tracker・健全性前回値は保存失敗でも進む。候補と判定後状態を一緒に受領する。 |
| `polling/jmaWarningCurrentProcessor.ts` | 復旧候補の探索後、会場・controlStatus単位のtransactionで置換する。探索途中を公開状態にしない。 |
| `services/fetchControlService.ts` | requestId、開始/停止レーン、強制更新の合流、30分停止後の復旧、記録失敗時メモリfallbackがある。メインに残す。 |
| `services/weatherApiService.ts`、`monitoring/*Service.ts` | 同期DB読取・DTO生成が存在。気象部分を提供側へ、保持記録部分をメインへ分ける。 |
| `polling/nowcastService.ts`、`kikikuruService.ts`、各TileStore | cache miss経路が上流取得・DB記録・ファイル保存/削除まで行う。保存済み読取と取得依頼を別コマンドにする。 |
| [#247設計](issue-247-split-weather-retained-db.md)、[#253設計](issue-253-independent-system-notifications.md) | DB世代参照、origin別cursor、起動claimのat-most-once、準備失敗時のsystem継続を維持する。 |
| [設計標準](../rules/02-design-protocol.md)、[検証標準](../rules/05-verification-protocol.md)、[気象データ標準](../rules/07-wx-data-protocol.md) | 対象設計書のみを作成。製造・検収は観測可能な受け入れ条件で確認する。 |

外部仕様の根拠は [Node.js Worker公式資料](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html) と [SQLite WAL公式資料](https://www.sqlite.org/wal.html)。Workerへのデータ転送と、WALでもbusy・長いreader・checkpointに制約が残る点を採用判断へ使用する。気象電文の解析・採用仕様を新たに確定する設計ではない。

**実挙動未確認:** 実Worker間転送、WAL上の並行実行、停止・再開の時間、負荷時応答、ファイル清掃との競合。本設計時点ではサーバー起動・実データ操作・性能計測をしていない。後述の期限・容量は実測値ではなく、失敗を有限にする初期の制御値である。

## 2. 責務と入口の棚卸し

以下のパスは特記のない限り `apps/api/src/` からの相対パス。

| 現行入口・処理 | 新しい所有者 | Aで接続する境界／B・Cの移行先 |
| --- | --- | --- |
| `server.ts` の設定検証、会場/端末解決、HTTP listen、signal処理 | メイン | `createApplicationRuntime`。設定をplain objectへ変換し各roleを構成。 |
| `initializeDatabases`、DB role/family/instance検査、migration、writer lease | Aは構成入口内、Bから各所有role | 保持DBはメイン、気象DBは取得側。readerは提供側。§7。 |
| XMLのfeed/body取得、fetch attempt、reception/採用・parse failure記録、現況更新、再処理 | 取得側 | `JmaXmlPollingService` と各 `jma*Processor/Reprocessor`、取得スケジューラ。 |
| 現況復旧、起動評価、復旧進捗、初回同期phase | 取得側 | `createStartupNotificationRuntime` の気象処理を取得runtimeへ移す。メインへ状態報告する。 |
| アメダス地点/値、画像target times取得、タイルmetadata/取得履歴、失敗記録 | 取得側 | `createScheduledAdapters`、`createImageServices`、各取得service。 |
| タイルcache miss、ファイル保存・差替え・ロールバック削除・索引更新・期限清掃 | 取得側 | `ensureTile`。提供HTTPからDB/filesへ直接書き込まない。 |
| 警報/速報・初回警報/速報の判定、fetch_health評価、復旧/初回同期の通知判定 | 取得側 | plannerは同じ意味で利用。保持connectionを除き、`DecisionBatch` でメインへ渡す。 |
| 全通知履歴保存、system/weather delta、session、claim、起動応答監査 | メイン | `RetainedNotificationSink` と `StartupPublicationCoordinator`。 |
| `WeatherApiService` の6種、nowcast/kikikuru times、保存済みPNG読取/検証 | 提供側 | `WeatherReadPort`。Aは同一スレッド、Bはメイン内read-only adapter、Cは提供Worker。 |
| monitoring reception一覧/原文、processing、通知履歴からの原文参照 | 提供側 | 気象由来の部分のみ。原文参照はDB世代を伴う要求とする。 |
| monitoring通知/操作履歴 | メイン | 保持DB読取。通知参照の存在確認だけ提供側へ有界のバッチ要求。気象側失敗で履歴本体を失わない。 |
| monitoring statusの気象DB集計・情報/タイル鮮度 | 提供側 | 更新報告をメインへ送る。メインは最後の報告を使用し、監視GETで気象RPCを待たない。 |
| monitoring statusの取得運転・健全性・初回同期/復旧進捗 | 取得側→メイン | データ報告をメインが保持し、受領時刻と報告鮮度を付加。 |
| 取得開始/停止/強制更新、操作の記録・合流・結果照会・停止通知 | メイン→取得側 | `FetchControlService` の意味を保持し、実行部分を `WeatherAcquisitionPort` へ。 |
| Worker lifecycle、異常検知・通知、再開要求 | メイン | Aは型・失効規則・同一スレッド試験、実管理はB/C。 |

棚卸しの機械確認では `record*`、`INSERT/UPDATE/DELETE`、`writeFile/rename/unlink/rm` の呼出しをこの表と照合する。`app.ts` や保持serviceから気象connection、画像service実体への抜け道を残さない。テスト用DIがローカルfactoryに存在することと、role間メッセージへ関数を入れることを区別する。

## 3. モジュール構成と今回の変更範囲

| 新規モジュール案 | 内容 |
| --- | --- |
| `runtime/createApplicationRuntime.ts` | メインの構成、同一スレッドの取得/提供adapterの接続。`main/startServer` 共通化。 |
| `runtime/weatherContracts.ts` | role間のDTO、要求/応答対応表、シリアライズ検証。DB/Expressのimport禁止。 |
| `runtime/inlineWeatherAcquisition.ts` | 既存取得serviceの構成とdispatch、更新単位・通知候補・状態報告。 |
| `runtime/inlineWeatherRead.ts` | 既存読取・投影をデータ要求へ変換。外部取得・保持DB依存なし。 |
| `runtime/weatherPublication.ts` | 更新境界・起動投影token・cursorの調停。 |
| `runtime/weatherDecisionState.ts` | メイン保持の判定状態と受領順序、snapshotのexport/import。 |
| `runtime/retainedNotificationSink.ts` | 通知保存、候補の重複抑止、判定状態受領確定。 |
| `runtime/weatherRequestRegistry.ts` | 要求ID・世代・期限・失効、有限キューの共通規則。 |
| `packages/shared/src/weatherRuntime.ts` | B/C/Dが共有する監視状態・再開操作DTO。再開HTTPはAでは公開しない。 |

既存の `server.ts`、`app.ts`、気象API/画像API/監視service、通知emitter/tracker、polling構成と通知呼出し箇所は上の入口へ接続するために変更してよい。エンドポイントと業務応答は、非同期化に必要な型・`await`の追加を除き維持する。既存の同期repository・planner・parserはrole内部で使う。気象・保持DBのtable分割、migrationの新設、parserの意味変更、webの画面配置、台帳、共通テスト設定、依存追加はAの対象外。

`startServer()` は従来どおり初回処理列がsettleしてから `StartedServer` を返し、待受後の気象準備失敗だけではrejectしない。実プロセスの `main()` はHTTP待受後に初回処理を背景実行する。既存 `StartedServer` の試験用観測口は互換を保つが、実HTTPの依存は新portだけにする。

Aでは既存pair initializerのconnectionをローカルfactoryへ注入してよい。提供adapterは読取処理しか実行しないが、独立read-only接続を実際に作るのはB。**このローカル注入をWorkerメッセージの契約と誤認しない。**

## 4. データ契約

### 4.1 共通包絡と世代

以下は実装時の型シグネチャ。`Readonly` は省略せず実型に適用する。既存sharedのDTOは重複定義せず参照する。

```ts
type WeatherRole = 'acquisition' | 'delivery';
type WorkerGeneration = string;
type WeatherEpoch = {
  serverGenerationId: string;
  workerGeneration: WorkerGeneration;
  weatherDatabaseGenerationId: string | null;
  readerEpoch: string | null;
};
type WeatherRequest<K extends keyof WeatherOperations> = {
  protocolVersion: 1;
  requestId: string;
  epoch: WeatherEpoch;
  deadlineAt: UtcIso8601String;
  kind: K;
  payload: WeatherOperations[K]['request'];
};
type WeatherReply<K extends keyof WeatherOperations> = {
  protocolVersion: 1;
  requestId: string;
  epoch: WeatherEpoch;
  result:
    | { status: 'completed'; value: WeatherOperations[K]['response'] }
    | { status: 'failed'; code: WeatherFailureCode }
    | { status: 'unknown'; code: 'operation_result_unknown' };
};
interface WeatherPort {
  request<K extends keyof WeatherOperations>(
    input: WeatherRequest<K>,
  ): Promise<WeatherReply<K>>;
}
```

- `serverGenerationId` と `serverStartCursor` はメインの起動時に1回生成/取得。roleの再構成で変えない。
- `workerGeneration` はroleの起動ごとに新規UUID。Aにも各inline instanceの世代を与え、入替試験で失効を確認する。
- 気象DB世代は既存 `__database_identity.instance_id`。Worker再開・migrationでは更新しない。reset後の新規作成でのみ変わる。
- `readerEpoch` は提供connectionを開くたびにメインが発行するUUID。同じ提供Worker・DB世代でも再接続時は必ず変える。提供の読取要求/応答とpublication tokenに必須とし、取得roleの要求ではnullとする。close開始時に旧readerEpochの全pending要求/tokenを失効させ、新epochがreadyになるまで読取を受け付けない。受領時にはworkerGenerationとreaderEpochの両方を照合し、再接続前の後着応答を破棄する。
- RPCの `requestId` と既存取得操作の `requestId` は別項目として扱う。操作IDはpayloadにそのまま入れる。再問い合わせを実行要求へ変換しない。
- 型付き失敗コードは `invalid_request`、`not_ready`、`busy`、`deadline_exceeded`、`generation_changed`、`database_unavailable`、`read_failed`、`operation_result_unknown`。例外・stack・ローカルパスをDTOへ含めない。既存HTTPエラーコードへの変換はメインのrouteで行う。
- 設定も配列・plain objectへ変換する。`VenueRegistry`、connection、function、URL/Date/Error/Map/Set、Bufferのクラス性は境界に依存させない。時刻はISO文字列、集合は配列、バイナリは独立所有の `Uint8Array`。JSONのround-tripと `structuredClone` を試験し、バイナリのみ `structuredClone` で内容を比較する。

### 4.2 要求・結果の対応表

`WeatherOperations` は次のkeyとpayload/resultの対応を判別可能な型として定義する。列挙外の任意SQL、ファイルパス、上流URLを要求として受け取らない。

| key | request | response | role |
| --- | --- | --- | --- |
| `weather.read` | `kind`（warnings/warning-timeseries/early-warning/area-timeseries/amedas/bulletins）、解決済み `TerminalDefinition`、`WeatherControlStatus`、`requestedAt` | kindに対応する既存6種のresponse | 提供 |
| `image.times` | nowcast/kikikuru、端末、controlStatus、requestedAt | 既存times response | 提供 |
| `tile.read` | layer/product、既存frame DTO、TileCoordinate | `{kind:'hit', bytes, contentType:'image/png'}` / `{kind:'miss'}` / 既存利用不能結果 | 提供 |
| `tile.ensure` | 検証済みframe/coordinate、通常/明示取得の区別 | 保存済み識別子 / 既存取得不可理由。PNG本体は返さない | 取得 |
| `history.receptions` | `MonitoringReceptionQuery` | `MonitoringReceptionListResponse` | 提供 |
| `history.reception` | receptionId、expectedDatabaseGenerationId | `MonitoringReceptionDetailResponse` / not_found / 世代不一致 | 提供 |
| `history.references` | 保持履歴の気象DB世代とreceptionIdの配列（最大200件） | 同順序の `NotificationReceptionReference[]` | 提供 |
| `monitoring.processing` | 解決済み端末 | `MonitoringProcessingResponse` | 提供 |
| `monitoring.sample` | 対象会場、取得状態のデータsnapshot、requestedAt | 既存監視の気象DB由来セクションとreadErrors | 提供 |
| `startup.project` | publicationToken、会場、inquiredAt | 全categoryの `StartupCurrentNotification[]` とtoken/DB世代 | 提供 |
| `fetch.execute` | operationId、start/stop/force_refresh/recovery | 完了/失敗と取得状態（保持記録は含まない） | 取得 |
| `publication.pause` / `publication.release` | token、失効時刻 / token | 境界到達時のrevisionと状態 / 解放確認 | 取得 |
| `runtime.prepare` / `runtime.close` | plain設定、引継ぎ判定状態 / 停止理由 | 初期化受付 / 資源解放結果 | 各role |

取得開始/停止の状態問い合わせは最後の取得報告で行う。関数を返す `getService()` やschedulerを境界へ公開しない。既存service facadeが必要なら、facadeはメインのローカルport wrapperとし、境界を越えるのはこの表のデータだけとする。

### 4.3 報告・候補・判定状態

```ts
type DecisionCheckpoint = {
  revision: number;
  warningDoneKeys: readonly string[];
  bosaiCompletedKeys: readonly string[];
  bosaiCollecting: boolean;
  fetchHealth: {
    previousStatusBySource: Readonly<Record<MonitoredFetchSourceId, FetchHealthStatus | null>>;
    activeSinceAtBySource: Readonly<Record<MonitoredFetchSourceId, UtcIso8601String | null>>;
  };
};
type DecisionBatch = {
  eventId: string;
  unitId: string;
  epoch: WeatherEpoch;
  beforeRevision: number;
  after: DecisionCheckpoint;
  groups: readonly {
    groupId: string;
    records: readonly NotificationOutputHistoryInput[];
  }[];
};
type DecisionReceipt = {
  eventId: string;
  acceptedRevision: number;
  groups: readonly { groupId: string; outcome: 'recorded' | 'record_failed' }[];
};
```

実型の `NotificationOutputHistoryInput` はDB接続を持たないplain recordへ限定する。origin/weatherDatabaseGenerationId、isTraining、sourceVersion、targets、検出時刻、通知ID、文面をそのまま渡す。メインが気象状態を再判定して補完しない。

既存のtransaction単位を保持する。警報は計画1組、速報は会場/初回statusごとの1組、fetch_healthは取得元ごとに1組。1つの取得元の保存失敗で他の取得元の保存成功を取り消さない。復旧/初回同期通知の安定IDと抑止規則も保持する。候補0件でも判定後状態が変わった場合は空groupのbatchを受領確定する。

## 5. 現況・cursor・claimの整合

### 5.1 比較と採用

| 方式 | 利点 | 問題／判断 |
| --- | --- | --- |
| 保持transactionの中でreader応答を待つ | 見かけの移植は小さい | 非同期応答・タイムアウトの間、保持DBを占有する。採用しない。 |
| メインに版付き全現況投影を保持・永続化 | writer停止なしで起動応答可能 | 会場/時刻で変わる投影、保存容量、履歴版管理が必要。Aとして大きく、永続配送保証とも混同しやすい。採用しない。 |
| **短い公開ゲート** | 現行repository・投影を再利用し、保持transactionを同期のまま完結できる | 起動問い合わせ中だけ気象commitを待たせる。期限・失効・解放を必須として採用。 |

公開ゲートは上流通信・XML解析・復旧探索を囲まない。通知に影響する気象commitと候補受領が1単位として終わる境界へ入る。現況を変えるすべての経路（復旧/再処理/通常取得/初回評価）を参加させる。通知を作らない現況更新もrevisionを進める。タイルやアメダス等、起動投影に関与しない書込みはこのゲートに入れず、DB transactionの整合で扱う。

### 5.2 更新と公開の順序

1. 取得側は更新単位の開始をメインへ登録する（unitId、対象scope、判定前revision、初回評価対象keys）。登録ACK前に該当commitを始めない。Aでも実際にこの境界を通す。
2. 気象DBのtransactionをcommitする。既存の採用・現況更新の原子性を維持する。通知保存失敗でこのcommitを取り消さない。
3. 取得側が通知候補と判定後checkpointを送る。メインは世代・unitId・beforeRevisionを検査する。
4. メインは候補の各groupを一度だけ保持DBに保存し、成否を固定する。`finally` 相当の経路で判定後checkpointをメインメモリへ反映してreceiptを確定する。保存失敗でも戻さない。メイン内は同期処理で、保存とcheckpoint更新の間にWorker終了通知を割り込ませない。
5. 取得側がreceiptを受け取った後、ローカルtrackerへ同じcheckpointを反映し、単位完了を報告する。次評価はこのACK後。完了したrevisionを公開可能とする。
6. `eventId` 再受領では保存し直さず同じreceiptを返す。同一IDのpayload差異・revision飛越しは契約違反として失敗させる。新世代から旧候補を再送しない。

受領済みeventの重複判定は完了単位の単調sequenceと直近receiptで行う。古いeventは完了high-water以下なら破棄できるため、全通知payloadを無期限保持しない。判定状態revisionと公開revisionは別に管理する（保存失敗でも判定は進む）。

### 5.3 起動問い合わせ

1. メインで端末/会場・serverGenerationIdを検証し、非readyなら既存202を返す。この時点でsession/claim/ready監査へ触れない。
2. メインがpublication tokenを作り、取得側へpause要求。進行中の対象更新単位と候補受領が完了してからACKされる。取得側は解放まで対象commitを開始しない。DB transactionは開いたまま待たない。
3. メインはtoken、取得/提供の世代、DB世代、readerEpoch、公開revision、期限を固定し、その時点の保持DB最大sequenceをcursor Cとして取得する。
4. 提供側は1回の短い読取transactionで会場の警報・速報現況を投影する。warning categoryも含む全候補を取得する。session/claimを先取りしない。inquiredAtは要求で固定し、期限判定と並べ替えの意味を維持する。
5. 応答後、メインがtoken、両世代、DB世代、readerEpoch、期限、準備状態を再検証する。1つでも不一致なら候補を捨てる。未完了Promiseの有無を根拠にtokenを有効扱いしない。
6. 保持DBの同期immediate transactionでsession登録、warning claim、候補からwarning categoryの出力可否選別、cursor=Cのready応答生成、監査保存を行う。projector自体の気象読取はこのtransactionに含めない。監査失敗なら全rollbackする。
7. `finally` でtokenを無効化し、取得側を解放する。HTTP切断でも解放する。HTTP送信だけ失敗した場合のclaimは従来どおり消費済みであり、exactly-onceへ強化しない。

全categoryを先に取得してからclaimに合わせて選別するため、claim対象のwarningと、claim非対象のquestion/info/訓練を混同しない。既存projectorの `includeWarningCategory=false` と等価な結果になることを比較試験する。投影失敗時はsession自体が未登録、監査失敗時はsession/claimもrollbackとなる。

system通知はゲート中も記録・delta配信してよい。Cより後に記録されたsystem行は独立system cursorで配信される。起動後のweather deltaがsystem行でcursorを進める既存仕様も維持する。

### 5.4 順序例と失敗範囲

| 条件 | 具体的順序と結果 |
| --- | --- |
| 正常更新と起動競合 | 気象U1 commit→N1をsequence 101へ保存→pause→C=101→現況U1→claim/監査→解放→U2/N2=103。起動現況はU1、weather差分は103のみ。途中のsystem=102はsystem経路で1回。 |
| 通知保存失敗 | U1 commit→N1保存失敗→checkpointは進む→pause→Cは最後の成功sequence→現況U1。N1を保存/差分再送しない。新規端末の起動現況という既存投影まで抑止する意味ではない。 |
| 投影失敗 | pause→reader失敗→token無効化/解放。session/claim/監査は0件増分。systemは継続。 |
| 監査失敗 | 現況取得成功→保持transaction内の監査throw→session/claim含めrollback→解放。 |
| reader停止・期限切れ | tokenを先に失効させ、releaseを冪等送信。後着投影は破棄し、claimを行わない。取得側は自身の期限でもゲートを解放し、通常commitへ戻れる。 |
| pause ACK未着 | 起動要求は失敗し、cancel/releaseを送る。遅れてpauseに到達しても期限切れtokenを取得側が拒否する。未確認の「停止」を根拠に投影を開始しない。 |
| Worker世代交代 | 旧token/旧世代応答はすべて破棄。再開後は別tokenで新規問い合わせ。サーバー世代・既存claimは変わらない。 |
| 取得側終了 | 進行単位がないこととDB公開状態が確認済みなら、メインがwriter不在のゲートを成立させ保存済み現況を取得できる。未完了単位・DB不整合があるscopeはreadyを返さず、明示再開後の検証を待つ。通常の保存済み情報提供とsystem/監視は継続。 |

同一roleの更新は直列化する。pause要求後の新規更新を追い越させない。複数startupはFIFOで1つずつ処理し、待機中もHTTP/system/監視の処理列を占有しない。

## 6. 判定状態の所有と異常終了

### 6.1 状態一覧

| 状態 | 更新時点 | 正本・寿命 | Worker再開 |
| --- | --- | --- | --- |
| 初回warning `areaCode|controlStatus` done keys | 既存通知評価完了。保存失敗も完了。snapshotなしなら変更なし | メインcheckpoint、serverGeneration単位 | 引継ぎ。初回扱いへ戻さない。 |
| 初回bosai `venueId|normal/training` completed、collecting | 会場status評価後。全会場完了でcollecting=false | 同上 | completedを保持。完了済み状態からcollecting=trueへ戻さない。未完了会場だけ初期評価可能。 |
| fetch_health previousStatusとactiveSinceAt | 各評価batchの受領確定。0候補/保存失敗でも更新 | 同上 | そのまま引継ぐ。同じ異常は再通知せず、回復や別状態への変化は通常判定する。 |
| fetch_health最終集計 | 評価時 | メインの最後の報告＋取得側の計算用copy | 報告鮮度とWorker状態を別表示。異常終了をsuspended評価として注入しない。 |
| initialFetchPhase、evaluatedVenueIds、preparationFailures | 準備段階の遷移・会場評価 | メインの報告copy、取得側の実行状態 | 新世代の準備を再評価。成功が確認された失敗項目だけ解除。通知done keysとは別。 |
| 起動/復旧進捗、実行timer、abort、処理中Promise | 実処理の進行 | 実行role・workerGeneration単位 | 引継がず新規構成。古い進捗を現世代の実行中と表示しない。 |
| 復旧/初回失敗通知の試行済みID | 候補受領・保存試行時 | メイン、serverGeneration単位 | 同じ安定IDを再保存しない。保存失敗も補完しない。 |
| operationレーン、lastStoppedAt、合流中操作、記録fallback | 操作受付/完了 | メイン、既存serviceの寿命 | メインが生存する限り保持。Worker再開を取得開始の代用にしない。 |
| serverStartCursor、serverGenerationId、session/claim/監査 | 既存どおり | メイン/保持DB | Worker再開で変更しない。 |

### 6.2 候補・ACKの位置別の扱い

正常終了時だけsnapshotを取る方式は採用しない。メインが受領した判定状態を常に正本にする。Aではinline adapterの差替えとfailpointで、以下を実際に検証できるようにする。

| 取得側が止まる位置 | メインに残る情報 | 再開時の扱い |
| --- | --- | --- |
| 単位開始の登録前 | 前回checkpointのみ。該当DB更新は未着手 | 前回状態から続行。 |
| 単位開始登録後、気象commit前 | scope・初回対象keyを含む未完了unit。メインからはcommit有無を断定できない | 結果不明として閉じる。対象scopeだけ下記の再検証を行う。未着手の別scopeへ消費を波及させない。 |
| 気象commit後、候補未受領 | 同じ未完了unit。気象現況は進んでいるが保持への保存試行は0回 | 結果不明として閉じる。候補の再送・現況から通常通知の再構成をしない。下記のscope再検証を行う。 |
| 候補受領後、保存処理中にWorkerが終了 | メインは受領したbatchを同期処理中 | メインで保存試行とcheckpoint確定まで完了させる。Worker終了を理由に二重保存しない。 |
| 保存成功/失敗とcheckpoint確定後、ACK前 | 確定checkpointとreceipt | 再開へ確定checkpointを渡す。成功分も失敗分も再送しない。 |
| ACK後、ローカル反映/単位完了前 | メインの確定checkpoint | receiptにより単位完了扱いにできる。ローカル状態を正本としない。 |

未受領単位の再検証は次の限定規則とする。異常終了窓について新しい配送保証を追加しない。

- メインに登録済みの未完了scopeだけを検証対象にし、気象DBで最後に整合した現況を比較基準として復旧する。未完了時点の通知payloadを復元・配信しない。
- 初回warning/初回bosaiの評価単位が結果不明なら、その登録済み初回keyは消費済みとしてcheckpointへ繰り入れる。これは実際の通知保存成功を意味しない。異常終了後に同じscopeを新たな初回として鳴らさないためである。登録対象外の会場/statusや未着手の初回keyは消費しない。
- fetch_healthはweather DB commitを必要としない。評価結果・判定後状態をbatch受領前にローカルcommitしない。未受領なら前回checkpointのまま再評価できる（保持への保存試行は0回）。受領済み保存失敗なら進んだcheckpointを使うため同じ異常を補完しない。
- 次の新規電文/新しい健全性変化は通常判定を行う。恒久的な通知停止フラグは作らない。
- 未受領候補や未完了単位は監視上「結果不明」と記録し、保存済みと表示しない。メインも終了した場合のcheckpoint永続化は追加しない。プロセス再起動は従来のサーバー世代変更として扱う。

この方式は異常終了で結果不明となった初回通知を取りこぼし得る。正常処理では欠落を認めず、異常終了時のexactly-onceや永続outboxは保証しないという範囲を明示したもの。通常の通知保存失敗で判定を進める既存契約を守るため、再開時の補完を選ばない。

## 7. DB接続・公開・終了の契約（B/Cへの実装指示）

### 7.1 比較と接続所有

rollback journalのまま短いtransactionへ制限する案は変更が少ないが、writerとreaderの競合が大きい。DB全体のコピー提供はファイル容量と世代調停が増える。**気象DBにはWALと独立read-only readerを採用する。** 保持DBのjournal方式は変更しない。WALだけで無待機とはしない。

- メイン: 共通設定のrole重複・同一path/hardlink等の安全条件検査、保持DB検査/初期化/唯一writer/lease、role管理。
- 取得側: 気象ファイル検査、唯一writer connection、migration、identity、WAL設定、checkpoint、気象writer lease。生きた接続やrelease関数を送らない。
- 提供側: `{readonly:true, fileMustExist:true}` の独立connection。`query_only=ON` とrole/family/instance/migration version検証。migration・repair・INSERT/清掃禁止。
- Bの中間状態ではこのreaderだけがメイン内に残る。取得Workerが全気象書込みを所有する。Cでreader adapter全体を提供Workerへ移す。

AではDB初期化条件・journal mode・lease取得順序を変更しない。Aの契約試験は一時ファイルDBを使い、BのWAL競合保証を先取りしない。

### 7.2 初期化・migration・reader開始

Bの起動は共通安全検査→保持DB初期化→HTTP/system/監視開始→取得Workerの気象初期化。気象DB単独のopen/検査/migration失敗は取得側failedとし、保持履歴は残す。同一DB指定等の共通違反と保持DB失敗は起動自体の失敗。気象ファイルを救済目的で削除・再作成しない。

取得側は `{weatherDatabaseGenerationId, schemaFamily, schemaVersion}` を `database.ready` として通知する。メインが新しいreaderEpochを付け、検証済みの組だけreaderへ渡す。初回作成途中・未完了reset・schema不一致からreaderを開始しない。公開前に正常と確認できた会場/statusの集合を別のデータとして報告し、未検証/不整合/復旧中は正常な空と区別する。

再開時の検査・migrationはメインが新規読取受付停止→提供側の処理drain/接続close ACK→取得側の検査・migration→新readerEpoch発行→reader再open/検証の順で調停する。readerのcloseが確認できなければmigrationを行わない。異常終了した取得Workerの旧接続終了を確認するまで新writerは起動しない。既存schemaの確認だけで済む場合も、コピー検査を生きたreader/writerと競合させない。通常の復旧探索・気象取得はmigrationとは別であり、readerを止めない。

### 7.3 保存済み現況と復旧

復旧の単位は既存の会場×controlStatus。探索はDB transaction外で行い、採用候補を一度の短いtransactionで置換する。保存済み状態が検証済みなら探索中もそれを提供する。元から不整合のscopeは値を正常扱いせず、該当情報をunavailableとread errorで表す。他scopeの正常な保存値を巻き添えにしない。

availability（available/stale/unavailable）と保持値の有無、取得Workerの運転状態は別軸。取得停止をavailableへの固定や空配列への置換に使わない。提供側で現在時刻と既存の鮮度規則から評価する。normal/training/test、isTraining、会場・H/Kの意味を保持する。

### 7.4 busy・checkpoint・lease・reset

Bの初期設定は気象writer/readerとも `busy_timeout=100ms`、WALは既定相当の1000ページPASSIVE checkpoint、`synchronous` は耐久性を下げない設定を選ぶ。reader transactionは1要求のSQL読取までに限定し、RPC・ネットワーク・PNG読取をまたがない。busyは有限の `busy` 結果とし無限再試行しない。特にBのメイン内readerが既定の秒単位busy待ちで監視を止めないよう明示設定する。実測のうえBで再評価するが、無期限待ちには戻さない。

weather writer leaseにはプロセスPIDだけでなくrole・Worker世代・所有tokenを関連づける。同一PIDのWorker間でPIDの生存だけを解放根拠にしない。取得Workerが正常close後に解放、異常終了時はメインがexit確認と所有token照合後にだけ残留leaseを解放する。他プロセス/他tokenのlockを自動削除しない。メインの保持leaseは稼働中維持する。

終了順は新規HTTP/操作/role要求受付停止→token失効→取得timer/新規取得停止・実行中処理終了またはabort→readerの要求終了/close→取得writer close/exit→各所有lease解放→停止操作記録の完了と保持DB close。停止通知は保持DBを閉じる前に従来条件で保存する。全体終了でDB close失敗を成功へ変換しない。

resetは全role終了後に限る。既存の停止確認は `lsof` によりread-only接続も含め、DB本体と `-wal` / `-shm` / `-journal` 全対象に対して維持する。取得Worker不在だけを停止済みとしない。reset計画・digest・再開journal・保持DB不変検証を維持する。checkpointがbusyのときに付随ファイルを手動削除する手順は追加しない。

## 8. タイル・大きいデータ・過負荷

Aでは `tile.read`→missなら `tile.ensure`→`tile.read` の実経路へ分け、既存の時間帯・DISABLE_POLLING・対象frame検証・上流再試行を維持する。保存済み読取が取得serviceの同一レーンに入り、別要求のcache missを待たない構成にする。

B/Cのファイル契約は、保存時は一時ファイルへ書いて検証後に公開し、同じ公開パスを上書きして読取中の内容を変えない。提供側は非同期にopenしてバイト列を確保し、ファイルハンドルを閉じてから応答する。索引取得とopenの間に清掃されENOENTならmissとして扱う。既存ファイルを開いた後の削除競合、差替え、PNG破損を一時cacheで検証する。プラットフォーム上unlinkが開いたファイルに失敗する場合は取得側で後の清掃へ回し、readerを失敗させるために強制削除しない。

大きい原文/JSONはCで提供側がHTTP用のUTF-8 bytesへシリアライズし、メインはframe単位でHTTPへ転送する。メインで巨大JSONを組立て直さない。通常の制御DTOはplain data、bulkは次の有限転送契約を使う。

```ts
type PayloadFrame = {
  requestId: string;
  workerGeneration: string;
  index: number;
  final: boolean;
  bytes: Uint8Array;
};
```

1 frame上限256KiB、1要求の未ACKは2 frameまで。HTTPのdrainに応じて次を要求し、切断/期限で残りを取り消す。サイズ超過の1メッセージを先に送ってから拒否する実装にはしない。既存監視履歴のlimit最大200件を維持し、大きい原文を勝手に切り捨てない。通知batchも必要ならgroupを壊さずframe化し、受信組立ての上限と大きさを確認してから送る。Aは型/往復/上限試験を行い、bulk HTTP転送の製造はC。

初期の制御値は次のとおり。性能達成値ではない。定数と注入時計で決定的に試験可能にする。

| 項目 | 初期値と意味 | 実装段階 |
| --- | --- | --- |
| 読取RPC・起動投影 | 受付から5秒。待機時間を含む。期限後の結果を採用しない | Aのregistry・B/Cのtransport |
| 公開ゲート保持 | pause ACKから2秒、起動要求全体5秒以内。先に到達した期限で失効 | A |
| 制御要求の受付ACK | 5秒。長い初回取得/復旧の完了期限とは別 | B |
| タイルmiss待機 | 30秒。上流の既存10秒timeout/再試行規則を短絡的に置換しない | B/C |
| 提供待機 | 最大64要求、実行中を含む最大総数64。startupはそのうち最大8。超過はbusy | Aの共通registry、B/C |
| 取得操作待機 | 既存の合流後、最大16論理要求。停止要求のため1枠を予約 | B |
| tile.ensure | 最大16要求、取得実行は4並列まで。同一tileは合流。保存済みreadとは別枠 | B |
| 状態報告 | 変化時＋5秒ごと、メイン受領から15秒超でstale | B/C |
| bulk未ACK転送 | roleごと総計8MiBまで。超過時は生成側を待たせる | C |
| 停止drain | 10秒後に停止未完了を表示。終了確認なしで代替Workerを作らない | B/C |

Aで新しく外部動作に影響する上限を実装するのは同一スレッドの読取/公開gate registry。B/C用の制御・bulk上限は契約と試験用純粋ロジックまで。既存の長い取得開始要求を5秒で「失敗」と確定しない。

## 9. 監視・再開・操作結果（B/C/D共通）

```ts
type WeatherRuntimeStatus = {
  role: WeatherRole;
  mode: 'inline' | 'worker';
  workerGeneration: string | null;
  lifecycle: 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed' | 'restarting';
  reportedAt: UtcIso8601String | null;
  receivedAt: UtcIso8601String | null;
  reportFreshness: 'unknown' | 'fresh' | 'stale';
  stopReason: 'requested' | 'unexpected_exit' | 'initialization_failed' | null;
  restartAllowed: boolean;
  pendingRequests: number;
};
```

報告の鮮度はメインの受領時刻から計算し、Worker側時刻のずれでfreshへ偽装しない。Workerがreadyでも気象準備は未完了であり得る。`fetchControlState=stopped`（通常の取得停止）と `lifecycle=failed`（Worker停止）は別項目。監視GETは最後の報告と保持DBだけで応答し、取得/提供双方の報告が古い場合も応答する。Aはinlineの状態を共通モデルで生成し、既存監視DTOへの互換投影を行う。B/Cでsharedのruntime欄を公開する。

再開HTTP契約（Aでは型と判定ロジックのみ、Bで取得・Cで提供を公開）:

- `POST /api/control/weather-workers/:role/restart`、bodyは `{requestId, expectedWorkerGeneration}`。
- `GET /api/control/weather-workers/operations/:requestId` で結果確認。
- 未知role/不正IDは400、世代不一致やfreshなready中の再開は409。failed/stoppedまたは報告staleで受付可能とする。`restartAllowed` は再開手続きを開始できる意味であり、代替Workerを直ちに生成できる意味ではない。restarting中の同じrequestIdは同じ操作を返し、別IDの重複再開は409。
- 受付は202 `{status:'in_progress', requestId, role}`。完了結果は `{status:'completed', result:'success'|'failure'|'unknown', requestId, role, workerGeneration, errorCode}`。
- successは新Workerが初期化ハンドシェイクを終えて要求受付できたこと。XML初回同期・気象readyの成功と同義にしない。起動失敗はfailure。応答だけ喪失して実行有無を断定できない場合はunknown。
- 報告staleだけでは終了・再起動しない。運用者の再開操作を受けてrestartingへ移り、「停止を確認中」と表示する。旧Workerへ停止要求し、drain期限後も未終了なら運用者が開始したこの再開操作の一部としてterminateを要求する。exitを確認するまで新規起動へ進まない。terminate要求からさらに10秒の終了確認期限も超過した場合はunknownで終了し、旧世代とleaseを維持して新writerを作らない。別の明示再開操作は終了確認から再開する。
- 文言は取得「取得処理を再開」、提供「情報提供を再開」。通常の取得開始/停止/強制更新とは別の操作。B/Cで監視画面へ必要最小限を置き、配置整理はD。

通常取得操作は既存requestIdを保持する。RPC受付前の拒否はfailure、受付後に応答喪失して終了を確認できないものは結果不明。既存OperationResultのsuccess/failureを変更せず、Bでは `result:'failure', errorCode:'operation_result_unknown'` と専用表示で「実行されなかった」と誤認させない。実行中が確認できる間はin_progressを保つ。同じ操作IDの再POSTで再実行せず照会結果を返す。上流HTTPの既存再試行は続ける。

再開操作はBで保持の専用操作記録を追加し、既存fetch/start-stop履歴を流用して意味を混ぜない。Aでmigrationは作らない。メインがWorker異常通知を生成する。origin=system、category=question、isTraining=false、equipmentスコープ、role×Worker世代×異常種別につき保存試行1回。報告staleは別種別で1回、後続exitと別の現象として扱う。復帰時に既存questionを自動確認しない。具体的文面定義・履歴table/API表示はB/C設計でこの契約に沿って追加する。

## 10. 製造手順と受け入れ条件

製造は承認後、統括が指定したブランチ上で行う。実装→テスト→コミットまでが製造担当、push/PRは検収担当。設計の資産化と署名は業務標準に従う。

1. 契約・inline factory・メイン保持sinkを作成し、実入口を切り替える。parser/repositoryの意味は変えない。
2. 起動公開ゲート・checkpoint import/export・候補の受領確定を接続する。保存単位や例外の意味を維持する。
3. 気象提供/タイルmiss/監視/履歴/操作の入口をportへ揃え、以下を検証する。

新規試験は一時ファイルDB・専用cache・固定時計を使う。実サーバーへの障害注入はしない。新しいテストには、意味を変えない対照改変が通る確認を先に行い、その後、対象条件を意図的に壊すと落ちるred確認を実施する。検収結果は項目別に記録する。

- [ ] **AC1 / A1 棚卸し:** §2の各行を実装のcall graphと照合する。`app.ts`からweather connection/画像service実体を直接使う箇所0、取得側のretained connection依存0、提供側の書込み/上流fetch 0で合格。ローカル構成factoryのDIは除外根拠を記録する。
- [ ] **AC2 / A2 実経路・型:** 実 `main/startServer` のHTTPで6気象API、times/tile、reception/原文、startup、monitoring、取得操作がport spyを通ることを確認。代表成功/失敗/状態/候補をJSON/structuredClone往復して完全一致。関数・DB・service・Error混入は境界検証が拒否する。
- [ ] **AC3 / A3 #253回帰:** #253設計§8のAC1〜AC13を既存API/web/sharedテストと対応づけて全実行する。準備待ち/同期失敗中のsystem受信、origin別cursor、世代409、claim/監査rollback、初回throw後recovery、monitoring部分失敗、停止cleanupを省略しない。H/Kは既存controllerから実HTTPへ接続し、隔離ブラウザで表示/鳴動/確認状態を確認する。
- [ ] **AC4 / A4 正常並行:** 一時DBで§5.4の101/102/103例を実inline adapterで実行。pause到達前後で更新とstartupの順序を入れ替え、startup現況=U1、weather差分=N2のみ、system=102のみ、warning claimは会場/世代で1件、ready監査と応答JSONが一致すれば合格。複数端末・複数会場・normal/training/testも既存fixtureで確認する。
- [ ] **AC5 / A4 保存/投影/監査失敗:** 通知保存失敗でも気象commitとcheckpointが残り、同じ候補再受領で再保存されない。projector失敗でsession/claim/監査増分0、監査失敗で3者rollback、次の有効要求で初めてclaimできることを完全一致で確認する。
- [ ] **AC6 / A4 遅延・期限:** reader応答を保留して期限を進め、token失効後にwriter更新を完了させてから旧投影を返す。旧応答からclaim/監査0、gate解放後の更新成功、新tokenの投影だけ採用されることを確認。pause ACK遅延・HTTP中断・reader失敗も同様。同じ提供Worker/DB世代でreaderを再接続するケースでは、旧readerEpochの投影だけを破棄し、新readerEpochの要求は成功することを確認する。待機中にsystem deltaと監視が完了することを確認する。
- [ ] **AC7 / A5 状態継承:** warning初回、bosai完了/collecting、fetch_health前回値/activeSinceAtを設定してinline取得adapterを新世代へ差替える。同一事象の保存件数増分0、次の新規警報/速報と健全性の回復→異常は既存plannerどおり出る。保存失敗後の差替えも0、未着手会場の初回評価は抑止しない。
- [ ] **AC8 / A5 異常終了窓:** §6.2の各停止位置をfailpointで再現する。未受領unitの対象keysだけ消費、受領済み保存成功/失敗はACK欠落後にも再保存0、他scopeの判定状態は不変。気象commit後・候補未受領のケースを省略しない。これは実Worker障害試験の代替ではなくAの状態機械試験と記録する。
- [ ] **AC9 / A6 DB所有:** Aの `databasePairCleanup` / `splitDatabaseLifecycle` / reset回帰が通り、同一ファイル・role誤り・未完了resetの拒否、起動失敗cleanupを維持する。§7のB中間状態について、factory構成図と型にwriter/reader/lease/readerEpochが割り当てられ、Bで変更する箇所が特定できればAとして合格。WALの並行実測はBへ。
- [ ] **AC10 / A7 要求失効・制御:** role世代変更、期限直前/直後、同じrequestId重複、同ID異payload、64件上限とstartup 8件上限を固定時計で確認。超過はbusy、期限切れ後の応答は不採用、同じ取得操作は1回だけ実行。既存開始/停止/強制更新の合流・30分復旧・DISABLE_POLLING・夜間条件を回帰する。
- [ ] **AC11 / A1・A2 タイル境界:** 一方の未取得tileを保留し、別の保存済みtileとテキスト要求が完了することを実adapterで確認。miss→ensure→readの順、時間帯禁止なら上流0回、既存正常PNG/破損/ファイルなしの応答が変わらないことを確認する。
- [ ] **AC12 / A7 監視:** 最終報告未取得/時刻超過を純粋関数で確認し、unknown/fresh/staleの完全一致を比較。Worker readyと気象ready、通常取得stoppedとrole failedを混同しない。system差分と監視の実装にreader応答待ちがないことを確認する。
- [ ] **AC13 / A8 品質:** `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api`、`npm run test -w apps/web`、`npm run test -w packages/shared`、`npm run build` がすべて成功。共通テスト設定を書き換えて成功させない。新規テストの対照/red確認結果を報告する。
- [ ] **AC14 範囲:** `git status --short` と基点からのdiffで、実Worker起動、WAL/migration、TRC削除、監視全体再配置、parser意味変更が含まれない。Aだけで障害隔離・性能向上達成と記載していない。

## 11. 後続への引継ぎ・先送り・判断事項

| Issue | 必須引継ぎ |
| --- | --- |
| #257 | 取得Worker transport、単位/候補/checkpointの実通信、異常終了全窓、気象DB起動失敗隔離、WAL、read-only中間reader、全気象書込み・タイル取得/清掃の移動、lease/終了/reset、取得再開操作と最小UI、異常通知/再開記録。 |
| #258 | 提供Worker transport、schema/DB世代/readerEpoch検証、同じ起動公開ゲートの実2 Worker検証、bulk転送、タイル競合、提供再開と最小UI。 |
| #259 | 監視のrole状態/報告鮮度/気象準備/通常取得停止の区別、操作結果不明・再開可否・成功と準備完了の区別、ツールバー配置とH/K/MD3回帰。 |
| #260 | 実Worker・実HTTP・一時DB・隔離ブラウザでの統合障害/負荷試験。health最大500ms・監視最大1秒という親Issueの初期案との比較、system/保存済み気象/タイル別の目標・fixture規模の実測合意、CPU/メモリ・WAL肥大・停止時間、rollbackとデータ保全手順。 |

詳細設計上の先送りは、上表の実Worker構成で初めて検証可能な事項、実測性能目標、再開の画面配置と通知文面の具体化。Aで必要な公開順序・受領失敗の扱い・状態寿命は先送りしない。

**要ヒアリング事項:** 現時点でなし。§6.2の結果不明窓における通知欠落と再開時の非補完は、監視画面等で確認できることを前提にIssue起案時からユーザー合意済みであり、本設計も承認済みである。欠落・結果不明を監視で確認できる要件を維持する。異常終了窓にも通知配送保証を追加する場合は本方式の範囲を超えるため、製造せず統括へ戻す。

設計担当: Codex（GPT-6）。コミット時の署名用メールアドレス: `noreply@openai.com`。
