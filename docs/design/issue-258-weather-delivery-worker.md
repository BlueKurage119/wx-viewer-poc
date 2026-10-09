# Issue #258 気象情報・履歴・保存済みタイルの提供 Worker 化

## 1. 位置づけ・確定事項・根拠

- 対象: [#258](https://github.com/BlueKurage119/wx-viewer-poc/issues/258)、親: [#255](https://github.com/BlueKurage119/wx-viewer-poc/issues/255)。状態は **【承認済み】**。2026-10-09にユーザーが設計を承認し、サブエージェント方式の製造から初回レビュー対応までを委任した。マージは承認範囲に含まない。
- 基点: `main` の `fde8ce876e8cc7dd3e48afe403bb17aeab46332e`。着手時の既存差分なし。ブランチ・コミット・コード・設定は変更しない。
- 【確定】メイン＋取得 Worker 1つ＋提供 Worker 1つ。会場数に応じて Worker を増やさない。HTTP、保持 DB、監視応答、通知配信はメインに残す。
- 【確定】異常終了・報告途絶で自動再起動しない。専用操作で手動再開し、旧 Worker の終了を確認してから代替を起動する。
- 【確定】2026-10-09の追加判断: 取得・提供とも報告 `stale` だけでは `lifecycle=failed` にせず、処理と新規要求の受付を継続する。報告鮮度と制御処理の健全性を別軸に保つ。実際の通信失敗、プロトコル異常、exit等は別途失敗として扱う。
- 【確定】通知保存失敗・候補受領前の終了による欠落は監視等で確認する運用として許容し、補完・再送保証を追加しない。通常の公開整合・重複抑止は維持する。
- 【確定】今回の最小 UI・通知も暫定。#259で必ずユーザー監修を受ける。仮 UI は流用予定なし。監視4カードの再設計・全体配置・細部の仕上げへ拡張しない。
- 【確定】具体方式・制限・性能検収案は統括へ委任された詳細設計。本書で提案する。既存保証・操作意味を変更する必要が判明した場合だけ統括へ戻す。

以下のソースパスは、特記しない限り `apps/api/src/` からの相対パス。

| 参照 | 実物から確認した事実と設計判断 |
| --- | --- |
| [#256設計](issue-256-weather-worker-contracts.md)、[#257設計](issue-257-weather-acquisition-worker.md) | epoch、通知判定 checkpoint、公開ゲート、有限待機、停止意図、通知欠落許容を維持する。 |
| `runtime/startWorkerServer.ts` | `databaseReady` 内でメインが reader・気象 API・画像 reader・監視集計を構成し、起動現況も同期投影する。この一式を提供 Worker へ移す。 |
| `runtime/createApplicationRuntime.ts` | 現行 inline adapter は依存注入された service と気象 connection を要求する。実運用 facade を connection 不要に分離し、inline は試験用に残す。 |
| `runtime/weatherContracts.ts`、`weatherRequestRegistry.ts`、`weatherTransport.ts` | 通常64要求、起動8要求、5秒期限、256KiB frame、8MiB制限がある。現 transport の JSON stringify/parse は Uint8Array をバイナリとして復元せず、気象大型 DTO をメインで組み立てるため、提供用 bytes 経路を追加する。取得 transport の既存契約は維持する。 |
| `database/roleDatabase.ts`、`runtime/acquisitionWorkerHost.ts` | read-only/query_only、role/family/instance/schema照合、100ms busy、WAL がある。取得再開は旧取得 exit→reader close→lease解放→spawn の順。reader close を実 Worker ACK/exit に置換する。 |
| `runtime/weatherReadScope.ts`、`workerDecisions.ts` | 未完了更新・再検証失敗の scope を公開しない。読取の直前・返却直前にもメインの正本で照合する。 |
| `runtime/weatherPublication.ts`、`notifications/startupNotificationService.ts` | 5秒待機、2秒公開 token、pause/release、保持側の同期確定を維持し、投影だけ非同期 RPC にする。 |
| `polling/nowcastTileStore.ts`、`kikikuruTileStore.ts` | ファイル descriptor の stat/読取、byteSize、SHA-256、PNG検証が実装済み。DB snapshot とファイル寿命は別なので、索引再照合を有限回行う。 |
| `services/weatherWorkerControlService.ts`、`app.ts` | 再開 service と POST は取得 role 固定。保持 table と shared DTO は delivery role を既に許容する。role別レーンと共通履歴 lookup に拡張する。 |
| `apps/web/src/monitoring/WeatherWorkerPanel.tsx`、`useWeatherRestart.ts`、`apps/web/src/api/weatherWorkers.ts` | 取得専用 UI/client を最小限 role 対応し、提供側の再開・結果再確認を追加する。 |
| [設計標準](../rules/02-design-protocol.md)、[検証標準](../rules/05-verification-protocol.md)、[UI標準](../rules/06-ui-md3-protocol.md)、[気象データ標準](../rules/07-wx-data-protocol.md) | 成果物1本、対照/red、MD3、isTraining と availability 3状態維持。 |

外部資料: [Node.js 24 Worker公式資料](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html)の ArrayBuffer 所有移転・Buffer pool・online/exit、および [SQLite WAL公式資料](https://www.sqlite.org/wal.html)の reader/writer 並行と busy/checkpoint の制約を参照する。独立所有 ArrayBuffer と exit 確認を採用し、WALだけで閲覧継続を保証しない。気象電文仕様の新規確定は行わない。

**実挙動未確認:** 本設計ではサーバー・実 Worker・実 DB・ブラウザ・負荷計測を起動していない。後述の数値は既存制御値に基づく初期検収案であり、実測性能や実運用 SLA ではない。製造・検収は一時 DB、専用キャッシュ、隔離ポートを用いる。

## 2. 構成と変更範囲

| 所有者 | 責務 |
| --- | --- |
| メイン | HTTP検証・端末/会場解決、保持 DB、通知保存/配信、session/claim/監査、取得操作/判定正本、公開ゲート、2 Worker管理、cache miss中継、最終報告からの監視応答。気象 connection を開かない。 |
| 取得 Worker | 既存の唯一気象 writer、migration、取得/解析/復旧、索引とタイル書込み/削除/清掃、通知判定。提供側停止でも通常更新を継続する。 |
| 提供 Worker | 検証済みread-only connectionを1本所有。6気象API、times、保存済みタイル、受信履歴/詳細/原文/参照、processing、気象監視集計、起動現況投影。上流取得、migration、保持DB、writer lease、清掃を実行しない。 |

| 新規/改訂モジュール案 | シグネチャ・変更内容 |
| --- | --- |
| `runtime/deliveryWorker.ts` | Worker入口。parentPortから設定/接続指示を受け、HTTP・保持DBをimportしない。 |
| `runtime/createDeliveryRuntime.ts` | `createDeliveryRuntime(settings, epoch): DeliveryRuntime`。現 `databaseReady` の読取構成を移す。 `read(request)`、`project(request)`、`sample(snapshot)`、`suspendReader()`、`close()`。 |
| `runtime/deliveryWorkerHost.ts` | `DeliveryWorkerHost` の `start()`、`readHttp(request, signal?)`、`project(request, signal?)`、`suspendReader()`、`connectReader(spec)`、`restart()`、`close()`、`status()`。すべて有限期限。 |
| `runtime/deliveryTransport.ts`、`deliveryContracts.ts` | 提供用のcontrol/plain DTOとHTTP bytes転送、frame ACK、cancel、世代検証、容量予約。 |
| `runtime/startWorkerServer.ts`、`createApplicationRuntime.ts`、`server.ts` | production構成から気象 connection/service を除去。両実起動入口で2 Workerを利用。旧 inline DI/試験ヘルパーは明示的に分離する。 |
| `database/roleDatabase.ts` | `openWeatherReader` を提供側だけで使用。既存検証・WAL・busy値維持。新migrationなし。 |
| `runtime/acquisitionWorkerHost.ts` | reader停止/再接続callbackを提供hostへ接続。取得側の通知・停止意図・更新契約は変更しない。 |
| `services/weatherWorkerControlService.ts`、`app.ts` | role別再開実行、共通履歴/結果lookup、worker bytesをHTTPへ送る小さなadapter。 |
| `monitoring/monitoringStatusService.ts`、`unavailableMonitoring.ts` | メイン組立部分と提供集計を分離。気象未受領でも監視応答を返す。 |
| `polling/*TileStore.ts`、`services/*ApiService.ts` | read-only経路のサイズ上限・索引再照合・HTTP encode用の分離に必要な変更だけ。書込み意味・解析規則は変更しない。 |
| `packages/shared/src/weatherRuntime.ts`、`notificationMessageDefinitions.ts`、webのWorker欄/client/controller | 必要なrole表示・提供異常定義・最小再開対応。既存DTOを優先し、互換を維持する。 |

上記と対応テスト・専用fixture、Workerビルド入口に必要な局所設定のみ変更可能。台帳、基本設計の確度、共通テスト設定、パーサー、保持期間、TRC、依存追加、動的pool、別プロセス化、監視全画面再配置は対象外。

## 3. 読取/API契約

既存 `WeatherOperations`、`WeatherEpoch`、`PublicationToken`、shared DTOを再利用する。任意SQL・ファイルパス・上流URLを要求にしない。role設定はplain object/配列、時刻はISO文字列。connection、関数、Map/Set、Date、Error、Buffer poolを渡さない。

| HTTP/内部入口 | 提供側の操作 | メインに残る処理 |
| --- | --- | --- |
| `GET /api/weather/{warnings,warning-timeseries,early-warning,area-timeseries,amedas,bulletins}` | `weather.read` とDTO/JSON encode | query検証・端末解決・最終scope/epoch照合・bytes送信 |
| `GET /api/weather/{nowcast,kikikuru}/times` | `image.times` とJSON encode | 既存HTTP status/cache契約 |
| `GET /api/weather/{nowcast,kikikuru}/…/tiles/…png` | `tile.read`、索引/ファイル検証、PNG bytes | missのみ取得hostへ `tile.ensure`、再読取、既存ヘッダー |
| `GET /api/monitoring/receptions`、`/:id` | `history.receptions` / `history.reception` | query/ID検証 |
| `GET /api/monitoring/processing` | `monitoring.processing` | 端末解決 |
| 通知出力一覧/通知原文参照 | `history.references`（最大200件）、必要時 `history.reception` | 保持履歴本体、参照照合。提供失敗時も履歴本体を返す |
| `POST /api/notifications/startup` | `startup.project` | 初期化判定、pause、cursor、claim/session/監査/応答確定 |
| `GET /api/monitoring/status` | 背景 `monitoring.sample` | 最後のサンプル＋取得報告＋保持状態＋runtime状態。GETはRPCを待たない |
| health、通知delta、取得操作/再開/履歴 | 提供RPCなし | 全処理をメインで維持 |

保存済み read と cache hit の経路では取得hostのstatus RPC・pause・上流アクセスを待たない。メインに既に受領済みの取得状態snapshotを提供側へ送る。取得 Worker が終了していても、検証済み DB と読取可能 scope がある限り読取を許す。同期解析の最中はheartbeatが遅れるため、取得報告の鮮度と保存値availabilityは別軸として返す。

提供側へ送る `DeliveryReadContext` は `AcquisitionStatusReport` の読取用部分（polling、health、scheduler、初期化/復旧、locallyValidatedScopes、unknownScopes）を型付きplain DTOにしたものと `contextRevision`。メインが変更受領時にrevisionを増やす。Workerは最新snapshotを保持し、要求に含まれるrevisionより古ければ更新snapshotを要求に添えて適用する。後着の低revision snapshotは破棄する。通知checkpoint全体・原文を報告へ載せない。scopeが公開不可へ変化した要求は、返却直前のメイン再検証で失敗/initializingへ変換する。提供側の旧snapshotで新しい不整合を公開しない。

DB準備前・reader停止中・提供異常は `not_ready` / `database_unavailable` 等を既存routeの503系へ対応させ、正常空配列や真のnot_foundにしない。提供不能による通知参照は `weather_unavailable`、実際の欠落は `reception_missing`、DB世代違いは `weather_generation_changed` を維持する。available/stale/unavailable、情報時刻、normal/training/test、isTraining（通知・履歴・表示すべて）を変えない。

通知原文の成功応答は保持履歴組立の例外に含めない。`retainedMonitoringHistory` の実運用境界を `resolveNotificationReception(id): Promise<{kind:'not_found'} | {kind:'unavailable', reason} | {kind:'reference', receptionId, expectedDatabaseGenerationId}>` に分離し、保持行の存在・関連参照・世代/原文有無の小型参照判定だけをメインで行う。`/api/monitoring/notification-outputs/:id/reception` の成功時は、この参照を提供hostの `readHttp('history.reception', payload)` へ渡し、提供側encode済みJSON bytesを送る。原文DTOをメインに受領して `sendJsonNoStore` に渡す現在の経路を実運用から除く。not_foundは既存404、参照不能は理由付き既存410をメインで生成し、参照照合後の競合missing/世代交代も対応する410理由へ変換する。通知出力一覧/操作履歴自体の保持側JSON組立は引き続きメインに残す。

### 3.1 提供用転送型

```ts
type DeliveryConnectionSpec = {
  readonly epoch: WeatherEpoch;
  readonly schemaFamily: string;
  readonly schemaVersion: number;
};
type DeliveryHttpBody = {
  readonly contentType: 'application/json; charset=utf-8' | 'image/png';
  readonly byteLength: number;
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
};
type DeliveryFrame = {
  readonly protocolVersion: 1;
  readonly requestId: string;
  readonly epoch: WeatherEpoch;
  readonly index: number;
  readonly final: boolean;
  readonly bytes: Uint8Array;
};
type DeliveryEvent =
  | { readonly kind: 'runtime.accepting'; readonly workerGeneration: string;
      readonly nonce: string }
  | { readonly kind: 'reader.ready'; readonly spec: DeliveryConnectionSpec }
  | { readonly kind: 'reader.closed'; readonly epoch: WeatherEpoch }
  | { readonly kind: 'status'; readonly epoch: WeatherEpoch;
      readonly reportedAt: string; readonly pendingRequests: number }
  | { readonly kind: 'http.begin'; readonly requestId: string;
      readonly epoch: WeatherEpoch; readonly body: DeliveryHttpBody }
  | { readonly kind: 'http.frame'; readonly frame: DeliveryFrame };
```

ヘッダーは既存routeで必要なcache/タイル識別情報のみallowlistで受領する。任意HTTPヘッダー・Cookie・ローカルパス・stackを通さない。失敗コードは既存 `WeatherFailureCode`、過大応答は `payload_too_large` を加えて明示的503にする。過大応答が1件発生しただけで正常Workerを終了しない。不正frame/世代偽装はprotocol異常とする。

### 3.2 保存済みタイルの競合処理

提供側は短いread transactionで対象索引（frame/product/coordinate、相対path、byteSize、hash、storedAt）を採り、transactionを終えてからファイルを開く。descriptorのstat→上限検査→read→byteSize/hash/PNG検証を行い、同じ索引を再照合する。索引が同じなら完全なbytesをhitとする。差替え/削除/検証失敗なら最新索引で1回だけ再読取し、再失敗はmissを返す。読取中に削除された旧descriptorのbytesでも、再照合で索引が変わっていれば成功にはしない。再照合後の更新は通常のsnapshot読取の範囲として、完全な旧bytesを許す。ファイルdescriptorはfinallyで閉じる。readerは壊れたファイル/索引を削除・更新しない。

missはメインが取得hostへ依頼し、保存完了後に新しい提供readで検証する。同tileの取得合流は取得側の既存queueに任せる。二度目のreadもmissなら既存tile_read_failed等の有限エラーで終わり、無限ensure/readループにしない。タイル所有・hashの意味は変えず、無関係なreadや全体清掃を停止しない。

## 4. 転送・受付上限・キャンセル

既存取得 transport は維持し、提供 HTTP のJSON.stringifyとUTF-8 encodeは提供 Worker 内で行う。PNGもWorker内で検証する。各frameは `new Uint8Array(n)` にコピーした独立bufferを `transferList` で所有移転する。メインはJSON.parse/stringify・DTOの大型組立・同期ファイル読取を行わず、bytesを有限の応答bufferへ格納して `res.end(Buffer.from(arrayBuffer))` に渡す。Buffer poolの元ArrayBufferを転送しない。

**全部受領・サイズ/index/世代/期限/scope確認後にHTTPヘッダーを確定する。** 途中frameを先にブラウザへ公開しないため、期限/再開で旧DBの部分JSONや部分PNGを成功として返さない。全bytes再検証はWorker、メインは長さと包絡だけを検証する。retained履歴の組立と、公開確定用の起動候補plain DTOは必要な例外であり、それにも8MiB上限を課す。

| 制御 | 初期設計値・根拠 |
| --- | --- |
| 提供HTTP要求総数 | 64件（実行＋queue＋転送＋miss待ち＋HTTP送信完了待ち）。#256の上限を維持。超過は即busy。 |
| 起動現況 | 上記内で8件まで。既存gate/reserve上限を維持し二重計上しない。 |
| 通常読取実行 | 16件まで、残りは最大48件のFIFO。同期DB処理は1スレッドで順番に実行し、DB transaction内にawaitを入れない。各完了後setImmediateでcontrolを受領する。 |
| PNG読取 | 通常枠内で4件まで。同時readFileのbuffer増加を抑える。残りは通常queue。 |
| cache miss取得 | 既存取得側4並列・16依頼上限を維持。miss待ちは通常実行枠を解放して専用待機へ移すが、総64件枠は保持。 |
| 応答bytes/原文/PNG | 1応答8MiB、提供送信buffer予約合計8MiB、メイン受領/送信待ちbuffer予約合計8MiB。元DTO/encoded bytes/作業bufferの実メモリは別で、8MiBをRSS上限と主張しない。 |
| frame/ACK | 256KiB、全提供payloadで未ACK最大2frame、1frame ACK5秒。#256値を維持。全サイズを先に通知し、受領側が容量予約を拒否したら送信しない。 |
| 小型control/report | 256KiB以下、payloadと別枠8件。close/cancelは別2件。報告は5秒ごと・重複未ACKの報告は最新1件へ合流。 |
| 通常read | 受付から5秒（queue・転送・再照合込み）。起動公開tokenは既存2秒、総待機5秒。 |
| miss経路 | HTTP受付から30秒の絶対期限。最初/最後のreadは各最大5秒か残余期限の短い方。ensureに残余時間だけを渡し、5+30+5秒へ延長しない。 |
| HTTP送信 | socketへの引渡し後も枠/bytes予約を保持し、finish/closeで解放。送信期限5秒、遅いclientはsocket終了。読み終えた応答を無制限に保持しない。 |

8MiBは現契約のbulk上限、16/4枠は既存cache miss制御と独立readを両立する初期値。代表負荷での適正値・RSSの実測は#260へ渡す。原文やPNGはDB byteSize/file stat等を読取前に検査する。JSONは出力上限を検査し、過大DTOの無制限生成を避けるため既存ページ上限・会場単位読取を維持し、大きい文字列/配列はencode前にも予算を検査する。上限に達した結果を切り捨てて正常JSONにしない。

取消は `{kind:'request.cancel', requestId, epoch}`。HTTP abort/close・期限・reader停止・Worker交代でメインpendingを失効し、Workerの未開始queue・frame予約・miss待機を解除する。DB同期処理は中断できないので完了時に取消状態を再確認し、結果を送らない。実行中枠は実完了まで保持する。応答ACKがなくてもタイマーでframe/assemblyを解放し、後着応答を捨てる。取得 `tile.ensure` が既に書込みを開始した場合、HTTP取消で保存結果を破壊せず完了してよい。再問い合わせは新読取であり、再開操作の再実行には変換しない。

## 5. DB接続・再開の調停

### 5.1 起動とreader

1. メインは保持DB/HTTPを先に準備し、取得/提供 Worker を各1つ生成する。気象準備失敗でhealth/system配信を止めない。
2. 提供Workerはonlineだけでreadyにしない。5秒以内の `runtime.accepting` にメインがnonce・Worker世代・authorize期限を照合して許可する。期限後/旧世代の許可でDBを開かない。
3. 取得 `database.ready` の確認済みgeneration/family/schemaをメインが保持し、新 `readerEpoch` を発行して `connectReader` を送る。提供Worker内で `openWeatherReader` がrole/family/instance/migration履歴/schemaを照合する。read-only/query_only、busy100msを維持。
4. `reader.ready` をメインが現在のspecと照合後に公開する。接続前の仮ready/古いreadyを採用しない。失敗時にcreate/migration・空DB生成へfallbackしない。

取得準備の中で投影可能scopeが増える場合はメイン報告を反映する。提供reader readyと取得初回評価readyは別。提供は単独で初回通知trackerを進めない。

### 5.2 取得側再開とmigration

共通のDB lifecycle mutexで、両roleのreader open/close、取得migration、shutdownを直列化する。通常read/updateや独立提供再開が取得全体を長期停止するmutexにはしない。再開POSTはrole別の即時予約を行い、異なるroleが競合する場合は新規要求409、同IDは既存結果を返す。取得側を停止してからreaderに待つ既存順序を維持する。

取得再開: 旧取得exit確認→公開token/readerEpoch失効・新read拒否→提供側reader drain/close ACK→旧writer lease照合/解放→新取得spawn/authorize/migration→database.ready→新readerEpochで再接続→reader.ready。

- drain/closeは10秒。ACKが来なければ提供Workerをterminateし、exitをさらに10秒確認する。ACK/exit双方未確認なら取得spawn/migrationを禁止し結果不明にする。close ACKは接続・file descriptor・実行中read解放後にだけ送る。
- 正常なreader suspendでは提供Workerを保持し、新DBspecで再接続する。schema変更中は明示的利用不能を返す。同schemaでも現 #257 と同じ一時停止を行い、無条件閲覧継続保証を追加しない。
- 既に異常/終了した提供Workerを取得再開が自動spawnしない。reader終了確認済みなら取得再開を進め、新DBspecを保存し、提供の専用手動再開を待つ。強制終了になった場合も同じ。
- 取得の単なる異常exitでは既存readerを閉じない。DBが整合しscopeが公開可能なら保存済み読取を続ける。未知scopeは正常空へ置換しない。

### 5.3 提供側専用再開

`restart()` は新規要求/公開tokenを失効→旧提供 `runtime.close`→10秒exit待ち→terminate→さらに10秒exit確認→旧transport/予約解放→新workerGeneration生成→spawn/accepting確認。再開操作成功は #257 と同じ **新Worker受付確認** を意味し、DB接続/気象提供readyを保証しない。接続準備状態は監視で別に表示する。受付5秒失敗はfailure/unknownを既存分類に合わせて返し、後着acceptingを採用しない。

最後に確認されたDBspecがあれば再接続する。取得停止/異常でも利用するが、実DB識別/schemaを再検証する。spec未取得・migration中ならreader準備待ちであり、取得を勝手に開始しない。提供再開でserverGenerationId、DBinstance、通知sequence、session/claim/確認状態、取得停止意図、通知checkpoint/初回tracker/fetch_healthを変更しない。

## 6. 公開ゲート・監視・異常通知

起動問い合わせは既存のFIFOとscopes判定を維持する。メインでgate取得→生存取得Workerをpause（終了確認済みなら既存の停止済み読取条件）→候補通知の保存ACK/未完了unitなし確認→保持cursor取得→提供 `startup.project`→token/両epoch/readerEpoch/DB世代/期限/scopes再検証→保持側同期transactionでsession/claim/監査/応答を確定→finallyでrelease。提供側投影はread transaction内の同期処理で完結し、原文や保持状態を返さない。

提供再開・reader停止はgateのdelivery epochを即失効する。旧応答が同じDBgenerationでもworkerGeneration/readerEpoch不一致なら破棄。取得停止中も未完了/unknown scopeを迂回しない。読取失敗/取消/期限/監査失敗ではsession/claim/監査を増やさない。保持transactionを開いてRPCを待たない。先行weather101、並行system102、後続weather103の系列で現況/cursorとorigin別差分の既存契約を検証する。

監視の気象サンプルは提供側で5秒ごとに収集し、メインは最終正常値を保持する。メインの監視GETはDB/Worker応答を待たず、初回未受領は既存unavailableセクションを返す。取得進捗/取得意図/保持DB操作状態はメイン正本を合成し、古い提供サンプルで上書きしない。runtime受領時刻とサンプル受領時刻を分け、runtime heartbeatだけで古い集計をfreshにしない。`MonitoringStatusResponse` に後方互換のoptionalフィールド `weatherSampleReceivedAt?: string | null` を追加し、新サーバーは常に値かnullを返す。web検証器は旧応答の未定義をnullとして扱い、Worker欄に気象集計の最終受領時刻と15秒超の鮮度低下・未受領を表示する。新Worker heartbeatだけでこの値を更新しない。監視4カードの意味・配置は変更しない。

提供statusは5秒ごと、受領後15秒超でstale（既存project関数）。未報告acceptingは5秒期限、accepting後reader接続中もheartbeatがなく15秒経過すればstaleとする。メインがexit/error/report_stale/initialization_failed/protocol・handshake異常を検知し、提供role/workerGeneration/種別ごとにsystem通知を1回記録する。定義ID案は `system-weather-delivery-{initialization-failed,exited,report-stale,control-failed}`。保存失敗でも重複抑止状態は進め、再開で補完しない。表示はquestion系の既存system方針を踏襲し、weather initial trackerに混ぜない。ACK途絶でもheartbeatだけfreshになるケースはfailureCodeを優先して再開可にする。単発read deadline/busy/応答過大とWorker全体異常を区別する。

報告 `stale` のみでは取得・提供の `lifecycle` を `failed` に変更しない。提供Workerが `ready` でreader接続済みなら新規readを受け付け、既存の5秒期限と取消、返却直前のscope・epoch・readerEpoch・DB世代の再検証を維持する。応答が届かなければ個別要求を有限の明示失敗とし、保存済み情報を正常空として返さない。監視には `reportFreshness=stale` と最終受領時刻を表示し、role×世代の `report_stale` 通知は復帰後の再staleでも追加しない。`stale` で専用手動再開を受け付けるが、自動停止・terminate・spawnはしない。これらは#256の再開契約および#257の取得側処理継続と揃える。実際の通信/制御失敗やプロトコル・handshake異常、初回受付期限超過、初期化失敗、error/exitは既存の分類に従い `failed` 等へ遷移させ、heartbeatの `fresh` や単なるread期限切れで隠したり混同したりしない。

## 7. HTTP再開・暫定UI・停止

- `POST /api/control/weather-workers/:role/restart`: acquisition/deliveryのみ。bodyは既存 `{requestId, expectedWorkerGeneration}`、202 in_progress、200 completed、400不正、409世代/role/並行競合、503履歴照合不能/容量。取得専用コード/文言はrole対応する。
- `GET /api/control/weather-workers/operations/:requestId` と `GET /api/monitoring/weather-worker-operations?limit=&beforeId=` は両role共通。既存requestIdの全体一意性を維持する。同IDを異なるrole/世代へ使えば409、同role/同世代は照合のみ。SQL lookupにroleを含めた照合を行う。role別serviceの起動回収が他roleの進行操作をunknownにしないよう、サーバー起動時の残存in_progress回収を共通storeで1回だけ実行する。
- 保持履歴保存失敗の200件メモリfallback、historyRecorded=false、結果再確認、結果不明を維持する。delivery結果にdesiredRunningを付けず、取得停止意図を意味する表示を混ぜない。table/schema migration不要。
- 監視の現在のWorker欄に提供の状態/最終報告/理由/専用再開を追加する。role別controller、requestId、送信/確認中の抑止、同ID結果再確認、履歴のrole表示を実装する。H/K・通常取得操作・確認状態を維持。既存MD3ラッパー/色トークンを使い、重複DOM idを避ける。#259で文言/見た目を監修する。
- shutdownは再開/HTTP新read受付停止→gate/cancel失効→取得更新停止/exit確認→提供reader/file/queue閉鎖/exit確認→lease解放→保持DB close。close二重呼出しは同じ完了Promiseへ合流する。失敗で終了未確認を成功扱いにしない。resetは提供接続も停止した証跡が必要。WAL/SHMを稼働中に削除せず、既存reset plan/apply/resumeの安全条件を維持する。

## 8. 性能検収案とテスト方針

#257 AC10のhealth最大500ms・監視最大1秒・system差分2秒を維持し、保存済みテキスト/tileの最大2秒を本Issueの限定fixture基準に加える。5秒read期限内の失敗だけで性能合格にはしない。根拠は先行分離の回帰基準と、取得依存を除いた保存済み経路の同じ2秒応答予算。実運用代表DB/頻度・p95目標確定は#260。基準未達は原因/環境を報告して統括判断へ戻し、無断で緩和しない。

実Worker×2、実HTTP、一時WAL DBと専用タイルを使用する。先行fixtureの規模を記録し、Worker latchで処理継続区間を保証する。取得重処理中、通常停止、取得異常exitを個別に20回以上測定し、保存済み気象テキスト/PNG・health/監視/system差分の最大/p95、CPU、DB件数、bytes、実行回数を報告する。提供側同期read/encodeを重くする別試験でもメインのhealth/監視/systemが同じ基準内で継続することを確認する。プロセス全体のメモリ枯渇・ネイティブ障害隔離は保証しない。

新規テストは業務標準に従い、まずコメント挿入等の意味不変の対照改変でPASS（SURVIVED）を確認する。その後、inlineへ戻す・取消やepoch検証を除く・hash検証を除く等の破壊改変で対応条件がFAILとなるredを確認し、改変を復元してPASSを再確認する。各段階の証跡を残す。fixture内だけの無関係なmockで合格させない。

## 9. 受け入れ条件

- [ ] **AC1 / C1 所有:** 6気象API、times、受信一覧/詳細/原文、processing、通知参照、startup投影、監視sample、PNG hitを実HTTPで呼び、Worker threadId/要求観測でdelivery経由を確認。メインのcall graph/SQL/fs呼出し棚卸しで気象connection open・同期気象read/投影/大型encode・PNG検証0。提供ではINSERT/UPDATE/DELETE/migration/上流fetch/清掃/保持DB open0。両実起動入口・本番distを確認する。
- [ ] **AC2 / C2 分離:** §8の取得重処理/通常停止/異常exitそれぞれで保存済みtext/tile各20回以上が最大2秒、health500ms、監視1秒、system差分2秒以内。取得処理継続をlatchで観測。提供重read/encode中にも後3経路が継続。環境/fixture/最大/p95/CPU/回数を記録し、待機Promiseだけで代替しない。
- [ ] **AC3 / C3 状態:** 未保存、期限切れ、復旧途中、unknown scope、再検証失敗、未検証schema、異世代DBを固定fixtureで作り、情報時刻/available・stale・unavailable/initializing/明示503が期待どおり。正常空への変換0、1会場/複数会場・normal/training/test・isTraining伝播を全読取/通知/履歴/表示で確認する。
- [ ] **AC4 / C4 miss:** 取得ensureをbarrierで保留し、後続hit/textを各20回実行して2秒以内。取得停止/失敗/夜間/期限/HTTP中断で既存利用不能か絶対30秒内失敗。ensure4並列/16待機/同tile合流を維持。取消後も不要な二重取得/予約残存0。
- [ ] **AC5 / C5 ファイル競合:** 索引読取→file open→read→再照合の各境界で同tile差替え/清掃を重ねる。完全な旧/新PNG、再照合1回後miss/有限失敗だけ。SHA-256/byteSize/PNG不一致のsuccess0。開いたdescriptorを必ずcloseし、別tile/text応答が停止しない。過大statをreadFile前に拒否する。
- [ ] **AC6 / C6 提供障害:** 実提供Workerをterminate/error/heartbeat停止/accepting未送信/ACK未送信にする。heartbeat停止だけなら `reportFreshness=stale`、`lifecycle=ready` のままreadを受付け、応答可能な保存済みtext/PNGは成功し、応答途絶は個別の5秒期限内に明示失敗する。scope・epoch・readerEpoch・DB世代の返却直前検証を通らない旧結果/正常空への変換は0。staleからの手動再開は受付可、自動停止・terminate・spawn0。実際の通信/制御失敗、protocol・handshake異常、初回受付期限超過、初期化失敗、error/exitは別にfailed等へ遷移し、fresh heartbeatでもfailureを隠さない。取得側更新/通知判定とメインhealth/監視/system継続、role×世代×種別ごとのsystem異常1件（復帰後の再staleも追加0）、通知保存失敗時の補完0を確認する。
- [ ] **AC7 / C7 再開:** 同ID再試行・別ID競合・異role同ID・古いexpected世代・両role同時操作を試し、実行1回/競合409/結果照合を確認。旧exit以前spawn0、readerClosed ACK/exit未確認時の取得migration0。schema/gen/readerEpoch切替、ready後着、期限後authorizeを注入して未検証・旧結果公開0。正常suspendは同じ提供Worker再接続、異常提供を取得再開がspawnしない。
- [ ] **AC8 / C8 公開:** weather101/system102/weather103固定系列で更新・複数startup・提供再開を両順序で並行実行。先行現況・後続weather103・system102、claim1件、監査と返却JSON一致。token期限/reader失効/HTTP中断/読取失敗/監査失敗時session・claim・監査増分0、gate/release残存0。提供再開でsequence/checkpoint/初回tracker/fetch_health/確認状態不変、同一通知増分0、新しい変化の通知は維持。
- [ ] **AC9 / C9 上限:** 64/65要求、8/9起動、16実行、4PNG、48queue、8MiB±1bytes、256KiB±1、ACK2枠、期限直前/直後を実transportと固定時計で検証。capacity予約前frame送信0、超過はbusy/明示過大失敗、完了/取消/ACK途絶後pending・frame・予約0。期限切れ同期処理は実完了まで枠保持、遅いHTTPclientは5秒で解放。受領frameを旧epochで混ぜても部分成功0。転送後元bufferのdetachとbyte一致を確認。
- [ ] **AC10 / C9 busy・監視:** 外部接続でDB lock、長いreader、checkpoint busyを再現し100ms設定と有限read失敗を確認。監視GETは提供RPC0、最終正常sample保持/受領時刻鮮度、未受領も応答。runtime heartbeatとsample鮮度を別に確認。busy時のsidecar削除0、保持system配信は§8基準で継続。
- [ ] **AC11 / C10 終了:** 正常/初期化失敗/読取中/再開中/migration中にclose二重呼出し。接続/file/timer/port/queue/所有Worker/自己lease残存0、新要求拒否、終了未確認は失敗。提供だけreaderを開いた状態でresetを拒否し、全停止後plan/apply/resume成功・保持DB不変を確認する。
- [ ] **AC12 / C11 暫定UIの最小機能:** 監視欄に両roleの状態・最終報告時刻と専用再開操作を備え、role別の二重送信抑止・同ID結果再確認・履歴表示をWebテスト等で確認する。取得の停止意図・H/K・確認状態を維持し、DOM id重複とMD3規約違反がないことをコード・テストで確認する。2026-10-09のユーザー判断により、隔離実HTTPブラウザでの360/768/1280px表示、各状態の見た目、staleとfailedの視覚的区別、再開・履歴の実操作、Tab/Enter/Space・フォーカスの実操作検証は本Issueの検収対象外とし、未検証のまま#259へ引き継ぐ。stale中の保存済み読取と手動再開の機能検証はAC6・AC7で行う。
- [ ] **AC13 / C11 既存回帰:** #253 AC1〜13、#256 AC1〜14、#257 AC1〜16の機能要件を最終構成へ対応付け、API/Webテスト・実HTTP等の非ブラウザ手段で回帰する。inline限定の観測は実Workerへ置換。既存HTTP body/status/cache/header/画像準備中503、history generatedAtの注入時計、通知参照理由、取得requestId/合流/30分境界/夜間/DISABLE_POLLING、保存失敗欠落許容を確認する。#253 AC7のブラウザを開いたままの観測、#256 AC3の隔離ブラウザでのH/K表示・鳴動・確認状態、#257 AC15の画面幅・状態表示・操作・キーボード・フォーカス等、先行Issueに含まれるブラウザ固有の検証は2026-10-09のユーザー判断により本Issueでは未検証のまま#259へ引き継ぐ。これらに対応する世代切替・通知・確認・再開・履歴等の機能回帰は省略しない。
- [ ] **AC14 / C12 品質・範囲:** `npm run lint`、`npm run typecheck`、`npm run format:check`、api/web/shared各workspace test、`npm run build`、本番出力起動成功。新規red/対照証跡を提示。差分が§2範囲内で、通知再送・parser意味変更・監視再設計・依存追加・実環境操作がない。

## 10. 承認用の要点・後続事項

**設計の要点:** メインの暫定readerを提供Workerへ移し、大型JSONのencodeとPNG検証/読取もそこで完結する。保存済み経路は取得応答を待たず、missだけ中継する。reader停止ACK/exitとepochでmigration・再接続を調停し、公開ゲートと保持側確定を維持する。専用提供再開・異常通知・最小UIを追加し、各待機/転送/HTTP滞留を有界にする。

**要ヒアリング事項:** 現時点ではなし。具体値・方式は委任された詳細設計として本書の承認対象。既存保証/操作意味との矛盾が実証された場合は統括へ戻す。

| 後続 | 引き継ぐ内容 |
| --- | --- |
| #259 | 今回と#257の仮UI・異常通知を必ずユーザー監修し、見た目/配置/文言/通知を全面改定する。2role、通常取得停止とWorker停止、受付/接続/提供ready、結果不明/記録失敗、報告と集計鮮度、両role再開履歴の機能要件を渡す。#258のAC12およびAC13で未検証とした隔離実HTTPブラウザ固有の回帰を改定後のUIで検証する。対象は360/768/1280px表示、準備中・ready・stale・異常・再開中・再開受付成功後接続失敗・結果不明・履歴保存失敗の表示、staleとfailedの視覚的区別、両roleの専用再開・二重操作抑止・同ID再確認・履歴、Tab/Enter/Space・フォーカスに加え、#253 AC7のブラウザを開いたままの世代切替、#256 AC3のH/K表示・鳴動・確認状態、#257 AC15の既存取得操作・ツールバー機能を含む。仮UIを流用するための追加仕上げは行わない。 |
| #260 | 最終2 Workerの同条件比較、代表DB/原文/タイルサイズ/要求頻度の合意、RSS/CPU/encode費用/転送buffer/WAL肥大の実測、上限の適正化、終了/reset/rollback・残留lease運用。今回の機能/障害/限定fixture検収を先送りしない。 |

本Issueは同一プロセス内のスレッド分離であり、プロセス全体の障害隔離やDB故障時の常時閲覧保証を追加しない。
