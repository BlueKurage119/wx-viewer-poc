# Issue #253 初回同期から独立したシステム通知配信

対象Issue: [#253](https://github.com/BlueKurage119/wx-viewer-poc/issues/253)
設計状態: 【承認済み】2026-10-09 にユーザーが製造開始・PR発行・初回レビュー対応まで承認。
調査基点: `da107dc`。製造ブランチ: `codex/issue-253-independent-system-notifications`。
設計担当: Codex (GPT 6.1 Sol)、署名用メールアドレス `noreply@openai.com`。

## 1. 目的・確定事項・範囲

### 1.1 ヒアリング済みの【確定】事項

- HTTP待受後は、初回同期の完了・成否に依存せずシステム通知を受信できる。
- 端末を開く前も含め、今回のサーバー起動以降に発生したシステム通知を対象とする。以前の起動の通知履歴は通常の起動取得へ混ぜない。
- 気象通知の受信開始は、初回取得と対象会場の初期評価が完了した後とする。
- 同期完了への切替で通知を欠落させず、同じ通知を二重表示・二重鳴動させない。
- HTTP待受後の同期失敗でも監視APIとシステム通知を継続する。気象側は準備未完了・失敗として扱う。
- 会場スコープ、H/Kの表示・鳴動方針、気象warningのclaim、訓練フラグを維持する。
- 今回は通知問題を先に進め、Worker分離の方針は完了後に別途検討する。
- 2026-10-09 の承認により、統括配下のサブエージェントで製造・検収・PR発行・初回レビュー対応まで進める。マージ・再レビュー要求は含めない。
- fetch_healthは保存履歴からの配信に統一する。保存失敗による発生通知の欠落を許容し、現在の異常は監視画面で確認する。保存再試行・現況補完は追加しない。

### 1.2 対象と対象外

対象は、通知API・フロント受信制御・起動失敗の扱い・稼働状態監視APIの必要な縮退である。DB構成は #247 の気象DB／保持DBのままとし、スキーマ移行を追加しない。

対象外は、Worker／別プロセス化、TRC廃止、性能改善、取得機能の全面再編、HTTP待受前の設定／DB初期化障害、保持DB自体の障害に対する新しい配信保証である。取得操作の新設、復旧処理全体の自動再実行、通知確認状態の永続化も行わない。

「監視API継続」の対象は既存 `GET /api/monitoring/status` と、保持DBを利用する通知・操作履歴である。気象DB由来の処理履歴や気象情報APIすべてを、DB故障時にも正常応答させる変更へ広げない。

## 2. 参照資料・現状・判断根拠

| 参照先 | 確認した内容と設計への反映 |
| --- | --- |
| `docs/design/issue-29-startup-notification-api.md`、`docs/design/issue-41-notification-delta-api.md` | 起動現況・気象warning claim・cursor境界の契約を維持し、全通知の準備待ちだけを廃止する。 |
| `docs/design/issue-171-early-listening-log.md`、`docs/design/issue-193-database-recovery.md` | HTTP待受後の初回同期失敗で全体終了する契約を本Issueで変更する。 |
| `apps/api/src/notifications/startupNotificationService.ts` | ready前に202を返し、ready時点のB4最大sequenceをcursorとする。システム履歴をこのcursorから読むと同期中の通知を飛ばす。 |
| `apps/api/src/notifications/notificationDeltaService.ts` | B4の全originを同じcursorで走査する。会場除外・壊れた行でも走査cursorを進める。独立した2本のcursorを使う。 |
| `apps/api/src/polling/jmaXmlPollingService.ts` | 初回throwのcatchで、運転中だけ既存recovery周期を登録する。 |
| `apps/api/src/server.ts` | `startServer()` は初期化のsettleを待ち、`main()` はバックグラウンド化している。両方の失敗経路を直す必要がある。起動runtime生成は復旧通知の生成より先で、開始cursorの確定位置として使える。 |
| `apps/api/src/polling/jmaXmlPollingService.ts` | 上流の通常失敗は `phase='failed'` の結果でresolveする場合がある。C13のrecoveryでcompletedへ回復し、会場評価callback失敗も後続周期で再実行する。例外catchだけでは状態を網羅できない。 |
| `apps/api/src/notifications/startupCurrentNotificationProjector.ts` | 気象現況とfetch_health現況を再提示する。fetch_healthを履歴でも配ると別IDの重複となるため、起動現況から除く。 |
| `apps/api/src/notifications/fetchHealthNotificationPlanner.ts`、`fetchHealthNotificationEmitter.ts` | プロセス初回の異常をB4へ記録する。記録失敗時も状態を進めるため、履歴一本化の限界を§9に明記する。 |
| `apps/web/src/api/startupNotifications.ts` | 完了応答を端末IDだけでキャッシュする。起動世代を跨ぐ再利用を防止する。 |
| `apps/web/src/notifications/useNotificationFeed.ts`、`notificationStore.ts` | startup readyまでdeltaを呼ばない。storeのID重複排除・確認済み集合を残したまま受信制御を分ける。 |
| `apps/api/src/monitoring/monitoringStatusService.ts` | 気象DBの採用集計・各気象APIの読み取り例外が状態API全体を500にする。セクション単位に縮退する。 |
| `docs/rules/02-design-protocol.md`、`05-verification-protocol.md`、`06-ui-md3-protocol.md`、`07-wx-data-protocol.md` | 成果物の範囲、red／対照実験、表示規約、availability・訓練フラグの維持に従う。 |

設計調査は静的確認のみ。以下に示す改修後のHTTP・フロント・プロセス挙動はすべて**実挙動未確認**であり、§8を製造・検収で実行する。気象庁提供仕様の新しい「確定」判断は行わない。

## 3. 全体構成と配信境界

```text
サーバー起動runtime生成
  G = serverGenerationId
  B = この時点の保持DB・B4最大sequence（空なら0）
  ↓ 復旧・初回取得・会場評価

端末起動
  GET delta(origin=system、cursorなし) → G、Bより後のsystem、system cursor S
  ├─ system差分をSから継続（気象startupの成否を待たない）
  └─ POST startup（気象現況のみ）
       202 initializing/failed → 気象側だけ再試行
       200 ready → 気象現況 + weather cursor W
          └─ GET delta(origin=weather、cursor=W、generation=G)

両経路 → 既存store → 会場/H/K/確認/鳴動の既存処理
```

### 3.1 システム通知

`B` は `createStartupNotificationRuntime()` の冒頭で、通知を生成するいかなる起動処理より先に `findMaxNotificationOutputSequence(retainedConnection)` で確定する。不変のメモリ値とし、時刻比較や最初の端末接続時の最大値では代用しない。保持履歴のIDは無期限追記である既存前提を使う。

対象はB4の `origin='system' AND id>B`。`sourceType`を復旧だけに限定せず、取得健全性・取得操作を含める。会場別の復旧通知は既存会場スコープを維持する。システム側に端末session登録や気象claimを持ち込まない。

### 3.2 気象通知

startupは気象現況のみを返す。現行どおり、保持DBのimmediate transaction内でsession・claim・cursor・監査を扱い、気象現況投影を同期処理として完了させる。`cursor=W` は気象現況投影の直前に取得するB4最大sequenceである。単一スレッド・同期DB処理という現構成の前提では途中INSERTが割り込まない。

weather差分は `origin='weather' AND id>W` のみ。初期取得・会場評価による `id<=W` の気象通知は現況再提示に置き換える既存方式を維持する。システムcursor SをWで上書きしない。気象開始時にシステム側を停止・再作成しない。

例: B=100、system=101、初期気象=102、startupのW=102、直後system=103、通常気象=104の場合、systemは101と103、気象は起動現況と104を各1回受信する。102を差分へ混ぜず、101/103をWによって捨てない。

## 4. 型・API・サービス契約

以下は承認済みの具体的な契約。名前の微調整は可能だが、境界条件を変更しない。

### 4.1 差分要求・応答

既存 `GET /api/notifications/delta` を2経路で使用する。`origin`を必須化する契約変更であり、APIとwebは同時更新する。旧webと新APIの混在運用は今回保証しない。リポジトリ内の全呼出し元・モック・HTTP契約テストを更新する。

```ts
type NotificationDeltaRequest =
  | { terminalId: string; origin: 'system' }
  | {
      terminalId: string;
      origin: 'system' | 'weather';
      cursor: NotificationDeltaCursor;
      serverGenerationId: string;
    };
```

- 初回system要求だけcursorとserverGenerationIdの両方を省略できる。片方のみ、空文字、不正origin、未知キー、重複クエリは400。端末未登録は404。
- 初回systemはfrom=B。継続systemは同一世代のcursorを使い、B未満ならBへ丸める。気象はstartupで得たcursorからだけ開始する。
- `serverGenerationId`不一致は、cursor大小や気象readyより先に判定して409を返す。異なる世代のcursorで行を返さない。
- ready応答には既存項目に `origin: 'system'|'weather'` を追加する。cursorは対象originの最終行ではなく、そのtransactionで走査したB4最大sequence。会場除外や壊れた対象行でも進める。
- 対象外originはDTO復元より先に除外する。`skippedCount`は対象originの壊れた行だけを数える。会場スコープの警告・配信契約と、保存summaryを再解釈しない契約を維持する。
- system経路は保持DBと起動世代情報・会場台帳だけで応答する。気象DB、気象現況投影、会場評価、端末session保存へ触れない。
- weather経路は対象会場がreadyでなければ202。readyを偽装した空配列＋進んだcursorを返さない。

```ts
type NotificationDeltaGenerationError = {
  status: 'error';
  code: 'server_generation_changed';
  serverGenerationId: string;
};

type WeatherNotificationPendingResponse = {
  status: 'initializing';
  terminalId: string;
  venueId: VenueId;
  serverGenerationId: string;
  weatherState: 'initializing' | 'failed';
};
```

同一世代でcursorが最大値超過の場合は既存409 `cursor_out_of_range` を維持し、現在の `serverGenerationId` と `origin` も返す。保持DB差替え等の範囲外事象であり、UIの既存「受信位置を同期しました」を維持する。systemは世代開始から再取得し、既存IDで重複排除する。weatherはcursorを勝手に進めずstartup再取得へ戻す。

依存の追加: `CreateNotificationDeltaServiceDependencies` に `serverStartCursor` と `initialization`。`NotificationDeltaQueryInput` は上記要求に解決済みvenueId／requestedAtを加える。`app.ts`は全応答をno-storeで返す。

### 4.2 起動現況要求・応答

`POST /api/notifications/startup` の要求を `{terminalId, sessionId, serverGenerationId}` とする。フロントがsystem応答で確定した世代を必須で渡し、サーバーは端末検証後、準備判定・session登録・claim・監査より先に世代一致を確認する。不一致はdeltaと同じ409 `server_generation_changed` を返し、副作用を一切起こさない。世代未指定は400。これにより、A世代を見た端末のPOSTが再起動後のB世代でclaimを消費し、その応答を端末が破棄する競合を防ぐ。ready応答の `cursor` はweather専用となる。202応答は§4.1のpending型へ揃え、起動世代と失敗／準備中を返す。非readyではsession・claim・監査のready記録を行わない。

`projectStartupCurrentNotifications` からfetch_health現況の生成を外し、startupの出力を気象に限定する。共有のstartup型・webの型ガードも実際の出力に揃える。fetch_healthの通知判定・文面・B4記録は変更しない。遅延warningも、気象claimの結果に関係なくsystem履歴として配信する。

### 4.3 気象準備状態

`StartupNotificationInitialization` に、初回取得phaseとは別の準備失敗を記録する。

```ts
type WeatherPreparationFailure = {
  stage: 'reprocessing' | 'recovery' | 'service_setup' | 'venue_evaluation';
  venueId: VenueId | null;
  failedAt: UtcIso8601String;
  code: 'weather_preparation_failed';
};

// 既存のphase・evaluatedVenueIdsに加える
// パイプラインが中断した失敗と、会場単位の評価失敗を別に管理する
markPreparationFailed(failure: WeatherPreparationFailure): void;
markVenueEvaluationFailed(venueId: VenueId, failedAt: UtcIso8601String): void;
getWeatherState(venueId: VenueId): 'initializing' | 'failed' | 'ready';
```

- 初回取得failedは既存phaseで表現する。通常の上流失敗を恒久的な準備失敗へコピーしない。C13のfailed→completedを維持する。
- 復旧・再処理・サービス構築で処理列が中断した場合、準備失敗を記録し、その起動では気象readyへ進めない。HTTPと保持DBは維持する。復旧処理全体の再試行を今回追加しない。
- 会場評価callback失敗は失敗会場だけを記録し、既存callback再試行を維持する。評価成功時に当該失敗を消去して評価済みにする。他会場の成功を失敗で上書きしない。
- 初回取得completedだけではreadyにならず、対象会場の評価完了が必要。正常な再評価でreadyへ進める。
- 生の例外文字列やパスを新しいDTO・通知へ出さない。詳細はサーバーログに残す。

## 5. フロント受信制御

`useNotificationFeed` が使う制御を `notificationFeedController.ts` へ分け、fetch・タイマー・receiveを注入できる形にする。これはテスト専用の別実装ではなく、hookから実際に利用する受信処理である。

```ts
createNotificationFeedController({
  terminalId,
  fetchDelta,
  fetchStartup,
  receive,
  onTransportState,
  setTimer,
  clearTimer,
}): { start(): void; stop(): void };
```

- systemの初回GETを直ちに開始し、その応答から世代Gを得る。気象startupを開始した後は2経路のtimer・retryCount・cursorを独立管理する。systemが成功しても失敗中のweather retryを打ち消さず、その逆も同じ。
- 通常ポーリング15秒、通信障害の再試行1/2/4/8/16/30秒上限という既存値を使う。202の準備待ち・同期失敗は通信断に変換せず、気象側だけ同じ再試行間隔で確認し続ける。
- `NotificationUiState.cursor` を `cursors: {system, weather}` に置き換え、経路別受信状態から表示用phase/messageを導く。system成功中のweather準備待ちで「通知を受信できません」を表示しない。実際に片経路の通信が失敗した場合は対象が分かる受信再試行メッセージにする。
- store・確認・鳴動処理は一本のまま。両方の受信が同時に完了しても、最新stateに逐次適用し、同じ `feedKey` の再受信で鳴動しない。
- startup readyを受けた時点でweather cursorを一度だけ確定する。system cursorとstoreをresetしない。異常復旧後も同様。
- startupクライアントのキャッシュ／inFlightを `{terminalId, sessionId, expectedServerGenerationId}` で分ける。非readyの結果は永続的な完了キャッシュにしない。新世代へ移ると旧世代キャッシュを破棄する。StrictModeによる同じ論理startup要求の重複POST抑止を維持する。
- 各要求にクライアント内の世代番号を持たせ、取消し後・端末切替後・世代切替後の古い応答を破棄する。サーバー世代不一致時はまずsystemをcursorなしで再接続し、新しい世代を確定してからweather startupへ戻る。以前のready応答を再利用しない。
- サーバー再起動時はcursor・取得timer・startup状態のみを初期化する。既存store、確認済み集合、warning履歴は保持し、新世代の通知だけを追加する。これはブラウザ継続中の既存表示を保つ方針であり、確認済みの過去通知を再鳴動させない。
- 端末ID変更・ブラウザ新規読込時は従来どおりstoreを新規作成する。永続確認履歴は追加しない。同一起動世代のシステム履歴は新規接続へ配信されるので、再読込による再提示は今回の対象期間の仕様に含まれる。
- 端末session生成に失敗してもsystem GETは継続可能とする。気象側のみ既存のsession再試行となる。

気象warningのclaimは従来のat-most-onceであり、応答喪失時のexactly-once保証や端末間の確認同期は追加しない。通常再試行で既に受信した通知が二重化しないことと、既存claimの配送保証を強化することを区別する。

## 6. HTTP待受後の失敗と監視継続

### 6.1 起動制御

`server.ts`の `startServer` と `main` に同じ失敗分類を適用する。共有化は失敗状態記録・通知処理の小さなヘルパーに限り、サーバー全体の再構成は行わない。

| 事象 | 処置 |
| --- | --- |
| 待受前の設定・DB・listen失敗 | 従来どおり全資源を閉じて失敗する。 |
| 待受後の復旧・再処理・サービス構築例外 | 準備失敗を記録する。HTTP・保持DBを閉じず、生成済みの監視とsystem配信を残す。未完了の処理列は先へ進めない。 |
| XML初回取得の通常失敗 | phase=failedを公開し、既存recovery周期・取得健全性監視を維持する。 |
| XML初回取得のthrow | HTTPを閉じずfailedを公開する。`JmaXmlPollingService.start()` の初回catch内で、phase/result更新後、`isRunning && !abortController.signal.aborted` の場合に `scheduleNextCycle()` を呼び、既存recovery周期を登録してから元の例外を再throwする。サーバー側からstartを再呼出しして補わない。回復可能な失敗を準備失敗へ固定しない。 |
| 会場評価callback失敗 | 会場の失敗を記録し、既存再試行を継続する。 |
| HTTP server error | 初回同期例外と区別し、従来どおり終了・資源解放する。 |
| SIGTERM/SIGINT/programmatic close | 従来の停止・abort・監査・DB解放を維持する。意図した中断を新たな同期失敗通知へ変換しない。 |

`startServer(): Promise<StartedServer>` は「初回処理列がsettleするまで待つ」という正常系タイミングを保つ。ただし同期例外だけではrejectせず、稼働中の `StartedServer` を返す。失敗状態は監視APIで取得する。`main()` は待受直後に応答し、バックグラウンド同期失敗で `process.exitCode=1` や `close()` を呼ばない。HTTP異常・明示停止の経路は別に残す。

`start()` はisRunningかつ結果ありの場合に早期returnするため、現行の再startだけでは初回throw後のtimerを補えない。上記の変更をpollingサービス内に限定する。timerは既存 `scheduleNextCycle()` が前のtimerを解除して置き換える。サーバーはXML開始待機段階の例外かつphase=failedを回復可能な取得失敗として扱い、準備失敗へ固定しない。停止後には新しいtimerを登録しない。時間帯境界側の既存再startも同じtimerを増殖させないことを確認する。

同期待機・遅延通知用timer等、失敗した処理が所有する一時資源は必ず解放する。既存の独立したscheduler/健全性監視まで一括停止しない。未生成サービスは既存のnull用状態を使い、監視稼働を装うために生成成功を偽装しない。

### 6.2 失敗通知

既存 `database_recovery` の失敗通知が記録済みなら、その同じ失敗について別の汎用通知を追加しない。それ以外の再処理・サービス構築・XML初回失敗・会場評価失敗には、保持DBへ以下のシステムquestionを記録する小さなplanner/emitterを追加する。

- sourceType: `initial_sync`、changeType: `initial_sync_failed`、origin: `system`、category: `question`、ackRequired: `true`、isTraining: `false`。
- 文面定義: `system-initial-sync-failed`。タイトル「気象情報の初回準備失敗」、本文「気象情報の初回準備に失敗しました。監視とシステム通知は継続しています。」。
- 全体障害はequipmentスコープ、会場評価障害は当該venueスコープ。例外詳細は含めない。
- 通知の段階は `reprocessing` / `service_setup` / `xml_initial_fetch` / `venue_evaluation` とする。同じ起動世代・段階・会場の失敗は1回だけ記録する。IDはこの組合せから安定生成し、throwとphase=failedの両方を観測しても重複しない。
- 明示停止由来のabortは対象外。通知記録自体が失敗してもHTTPの終了理由にしない。保持DB障害時の配送保証を追加しない。
- 回復したら気象準備状態を更新する。専用の回復通知や失敗questionの自動確認は新設しない。

### 6.3 監視APIの部分失敗

`MonitoringReadinessSection` に `preparationFailures: readonly WeatherPreparationFailure[]` を追加する。XML失敗は既存initialFetchPhase/result、会場復旧失敗は既存recoveryに残す。初回取得開始前の失敗を `not_started` だけに隠さず、既存カードの詳細へ「初回準備失敗」を表示する。全体状態を単一のoverallStatusに集約しない。

気象DB依存箇所は読取単位で例外を捕捉する。正常に読めたセクションは保持し、失敗情報だけを以下へ追加する。

```ts
type MonitoringReadError = {
  section: 'recent_adoptions' | 'information' | 'tiles';
  venueId: VenueId | null;
  kind: MonitoringInformationKind | 'nowcast' | 'kikikuru' | null;
  code: 'weather_data_read_failed';
};
// MonitoringStatusResponseへの追加
readErrors: readonly MonitoringReadError[];
```

- 採用集計の失敗: recentAdoptionsは空配列とするが、readErrorsを必ず添えて「0件」と区別する。
- 情報セクションの失敗: 該当kindだけavailability=unavailable、時刻・件数=null。正常読取のavailable/staleや保持値は変更しない。
- タイル索引の失敗: 該当layerのcatalogAvailability=unavailable、更新時刻=null、frame数=0とreadErrorsで未取得を示す。取得許可はDBではなく既存時間帯ポリシーから返す。
- 起動世代、稼働時刻、取得運転、初回取得phase、会場評価・復旧進捗はメモリ情報として応答する。readErrorsがあっても状態APIは200で返し、UIは既存カード内に「気象データ読取失敗」を表示する。
- 保持DB履歴の読取失敗、未定義のサービス例外まで成功扱いにする包括的catchは追加しない。監視の気象読取境界をテストで特定する。

## 7. 変更対象

| 対象 | 主な変更 |
| --- | --- |
| `packages/shared/src/notificationDelta.ts`、`startupNotification.ts`、関連export・型検証 | origin別要求、世代判定、気象準備状態。 |
| `packages/shared/src/monitoringStatus.ts`、`notificationMessageDefinitions.ts` | 監視の部分失敗・準備失敗、初回準備失敗通知定義。 |
| `apps/api/src/notifications/notificationDeltaService.ts`、`startupNotificationService.ts`、`startupCurrentNotificationProjector.ts` | 起動開始cursor、origin選別、準備判定、気象現況への限定。 |
| `apps/api/src/notifications/initialSyncNotificationPlanner.ts`、`initialSyncNotificationEmitter.ts`（新規）、関連export | 汎用初回準備失敗のシステム通知。 |
| `apps/api/src/polling/jmaXmlPollingService.ts` | 初回throwのcatchで、運転中だけ既存recovery周期を登録する。 |
| `apps/api/src/server.ts` | 両エントリの失敗分類、開始cursorの固定、回復／停止契約。 |
| `apps/api/src/app.ts` | 新要求・202/409応答・no-store。 |
| `apps/api/src/monitoring/monitoringStatusService.ts` | 気象読取の部分失敗とメモリ準備状態。 |
| `apps/web/src/api/notificationDelta.ts`、`startupNotifications.ts` | 新契約の型ガード・起動世代別キャッシュ。 |
| `apps/web/src/notifications/notificationFeedController.ts`（新規）、`useNotificationFeed.ts`、`notificationStore.ts` | 独立した取得・再試行・cursor、storeへの合流。 |
| `apps/web/src/api/monitoringStatus.ts`、`apps/web/src/monitoring/monitoringPresentation.ts` | 監視DTOの検証・失敗表示。 |
| 上記のAPI/web/sharedテストと、その専用fixture | §8の検証。既存起動・通知・監視・終了の回帰テストを移行。 |

台帳・会場設定・基本設計の未確定事項・DB分割構成・共通テスト設定・依存パッケージは変更しない。必要になった場合は設計との差として統括へ戻す。

## 8. 受け入れ条件と検証計画

単体のdelta直呼びだけで合格にしない。実際にhookが使うcontroller→HTTPクライアント→HTTP API→保持DBの経路、および隔離した実ブラウザのK/H表示を確認する。固定時計・制御可能な同期Promise・一時DBを使い、外部気象通信に合否を依存させない。

- [ ] **AC1 起動範囲**: 起動前system行を1件seedしruntime生成後にsystem行を2件追加。cursorなしsystem GETが後者2件だけをsequence昇順・完全一致で返す。遅れて開いた端末でも同じ2件を受信する。
- [ ] **AC2 同期中の実受信**: 復旧／初回取得を未解決Promiseで停止し、実controller経路を開始。startupが202のままでも復旧開始・遅延をstoreへ取り込む。気象行を同時に追加してもweather差分・claimは開始されない。
- [ ] **AC3 切替境界**: §3.2のsequence例をfixture化し、systemとstartup応答の完了順を両方向に変える。system 101/103と通常気象104が各1件、初期気象102の差分が0件、起動現況が1組となる。受信・鳴動callbackの回数を完全一致で検証する。
- [ ] **AC4 fetch_health一本化**: 初期異常のB4行を生成し、同期中systemで受信後にstartup readyへ進める。同じ取得元のstartup system項目は0件、表示と鳴動は1回。遅延warningは気象claimの取得可否に左右されない。
- [ ] **AC5 claim・監査**: 複数端末でsystem取得と202 startupを繰り返してもsession/claim/ready監査は増えない。ready後は既存の世代×会場warning claim、continuation、projector/監査失敗時rollback、訓練通知の既存テストが通る。
- [ ] **AC6 通信と独立性**: system通信失敗・weather通信失敗をそれぞれ注入し、他方が止まらない。202 failedを通信断と誤表示しない。session生成失敗でもsystemを受信できる。再試行で同一IDを受信しても表示・鳴動が増えない。
- [ ] **AC7 再起動**: ブラウザを開いたまま世代A→Bへ変更し、BのB4最大値がAより大きい場合でも世代変化を検出する。Bの起動前履歴は混入せずB開始以降を取得する。Aの遅延startup応答を破棄し、AのキャッシュでBの気象受信を開始しない。未登録の新規sessionでA世代指定のstartup POSTがBへ到着する競合では409となり、そのsession登録・Bのclaim/監査追加件数が0のまま、Bを指定した再POSTが初めてclaimを取得する。登録済みsessionの場合は既存のcontinuation契約を維持する。
- [ ] **AC8 複数端末・確認**: H/Kを同時接続して会場一致・別会場・global・unresolvedをfixtureで確認。Hはsystemを表示／鳴動せずcursorは進む。Kは表示し、questionを確認した後の再取得・サーバー再起動で既存項目の確認状態を失わない。端末ID切替時は従来どおり別storeとなる。
- [ ] **AC9 復旧例外**: `recoveryInternals.recover`を失敗させ、`startServer`がStartedServerを返すこと、状態APIが200で準備／復旧失敗を返すこと、失敗後のsystem通知が実HTTP経由で配信されることを確認。保持DB接続が閉じていないことも確認する。
- [ ] **AC10 上流失敗と回復**: 初回4feedの一部失敗（resolve failed）とthrowを別に注入。HTTP・system配信・健全性監視が継続する。recoveryで全feed成功後に会場評価が実行されweather readyへ進む。失敗通知がphaseとcatchで重複しない。throw後の回復timerが実際に1本登録され、同じisRunning状態でrecoveryが走ることを注入timerで確認する。停止との競合でtimerを残さず、時間帯境界での再startでも重複しない。
- [ ] **AC11 評価失敗**: 片会場の評価callbackを1回失敗させる。他会場の状態を壊さず、失敗会場は非ready。既存callback再試行で成功すると当該会場の失敗が消え、気象受信を開始できる。
- [ ] **AC12 監視部分失敗**: 気象DBの採用集計・情報1種・タイル1層の読取を別々にthrowさせる。監視200、メモリ由来の進捗維持、readErrorsの完全一致、失敗以外のavailable/stale維持、件数0と未取得の区別を検証する。
- [ ] **AC13 main実プロセス**: 既存preload方式に倣う隔離子プロセスで初回同期失敗を注入し、待受後にプロセスが生存しstatus/system GETが成功することを確認。成功ログだけで判断しない。自分の子プロセスを終了しDB/lease解放を確認する。
- [ ] **AC14 終了契約**: 待受前の不正port・listen失敗、待受後のHTTP server error、同期中と失敗後のSIGTERM/SIGINT/programmatic closeを既存テストと新規試験で確認。待受終了・所有timer停止・両DB/lease解放が維持され、明示abortで初回失敗通知が追加されない。
- [ ] **AC15 HTTP契約**: originなし、片側だけのcursor/generation、未知キー、不正端末・origin、異世代＋大cursor、同一世代大cursorを試験し、400/404/409の優先順位・no-storeを完全一致で確認。weather非readyは202でcursorを進めない。
- [ ] **AC16 ブラウザ確認**: 隔離サーバー／DBで同期保留→Kのシステム通知表示・question確認→同期完了→気象通知表示を通す。Hでも非表示条件を確認する。同期失敗時の監視カードと受信継続を確認し、ブラウザコンソールエラーがないことを記録する。
- [ ] **AC17 品質確認**: `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api`、`npm run test -w apps/web`、sharedにtestスクリプトがあれば同workspaceテストを実行して成功する。鳴動・バンドルの回帰を見るためweb本番buildも確認する。

追加テストは業務標準に従って、意味を変えない対照実験を先に実行し、次に対象処理を意図的に壊してredを確認する。対象は上記受け入れ条件の範囲に限る。例は「system開始cursorを末尾へ変更」「weather readyを待ってからsystem開始」「気象cursorをsystemへコピー」「同期失敗でHTTPを閉じる」。テストを通すために受け入れ条件や共通設定を弱めない。

## 9. 残留リスク・未決事項・後続への引き継ぎ

- API契約変更、履歴一本化、既存store保持、同期失敗時の限定継続は承認済み。追加のヒアリングを必須とする未確定要件は現時点ではない。
- fetch_healthのB4記録失敗後も状態が進む既存挙動は変えない。従来startupの集約状態からだけ再提示できた通知が、履歴一本化後は配信されなくなる場合がある。保持DB障害時の新保証は対象外であり、この限界を隠さない。必要なら再送・outbox等を別Issueで設計する。
- 長時間稼働後の新規接続では、今回起動以降のsystem通知をすべて配る。件数上限なしという既存delta契約を維持するため、履歴量に比例して応答が大きくなる。ページング／配信期間短縮／確認状態永続化は別判断とする。
- 気象warning claimのat-most-onceと、ブラウザ再読込時のcontinuationは維持する。通信応答喪失後も必ず同じwarningを再提示する保証へは拡張しない。
- 単一プロセス・単一実行スレッド内の同期DB読取を前提にcursorと現況の境界を作る。後続のWorker分離時には、別接続の同時更新とスナップショット整合を再設計する。
- HTTPは生存しても同一スレッドの重い同期処理中は応答が遅れる。応答時間の改善・別スレッド化の効果を本Issueの成果として約束しない。
- 復旧／再処理／サービス構築が途中で失敗した処理列を自動でやり直す機能は追加しない。XMLの既存recoveryと会場評価callback再試行を維持する。運転再開手順の拡張が必要なら別Issueとする。
- 全改修後挙動・ブラウザ・負荷・実プロセス試験は**実挙動未確認**。設計完了時点で製造・検収結果と混同しない。
- 設計資産化後、統括から製造・検収担当へ引き継ぐ。初回レビュー対応の完了時点で停止し、マージ判断をユーザーへ返す。
