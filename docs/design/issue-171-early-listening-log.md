# Issue #171 設計書: APIサーバー起動待受ログの早期出力と初回同期の非同期化

対象Issue: #171（親Issue #168 配下）。
対象ファイル: `apps/api/src/server.ts` の `main()` のみ（他ファイルの変更なし）。

## 1. 目的と範囲

`main()` は現在、HTTP待受の成功後に「初回同期ブロック」（画像サービス生成 → 会場ごとの未処理電文再処理 → スケジューラ起動 → 初回XML全件取得、実測17分超）を `await` し、**その完了後に** `[api] listening on ...` を出力している。このため `npm run dev` で起動完了が判別できるまで約20分待たされる。

本Issueでは、待受成功時点で待受ログを出力し、初回同期をバックグラウンドのPromiseとして進める。

### 1.1 やること

- `waitForServerListening()` 成功直後に `[api] database: ...` と `[api] listening on http://localhost:${port} (initial sync in progress)` を出力する
- 初回同期ブロックをバックグラウンドPromiseとして起動し、完了時に初回同期完了ログを出力する
- 初回同期の失敗時は従来どおり `close()` して `process.exitCode = 1` とする
- 初期化中にSIGTERM/SIGINTが届いた場合、保留せず即座にハンドラで受理し close を開始する（**close の完了＝プロセス終了までの即時化は対象外**。§4.4・§1.2）
- 既存テスト（特に子プロセス起動テスト）への非退行を担保する

### 1.2 やらないこと

- `startServer()`（テスト用エントリ）の非同期化。**確定事項(3)により現状維持**（初期化完了後に resolve する同期的な契約を保つ）。`main()` との構造の乖離はコード内コメントで明記する
- 新規エンドポイントの追加、既存エンドポイントの応答内容の変更
- `/api/initialization` という名前のエンドポイントの新設（§6参照。実在しない）
- スケジューラ・ポーリング・通知ロジック自体の変更
- **実行中の初回XML取得そのものの中断機構**（`scheduler.stop()` の「in-flight ジョブの完了を待つ」契約の変更、`AbortSignal` の導入、`POST /api/control/fetch/stop` の即応化）。これにより「初回同期中のCtrl+Cで短時間にプロセスが終了する」ことは本Issueでは達成されない。**#174（親 #168）で扱う**

## 2. 参照した資料と、設計判断の根拠

| 参照 | 本設計への反映 |
| --- | --- |
| Issue #171 本文（受け入れ条件3項目） | §8 の受け入れ条件へ分解 |
| 統括担当からの確定事項(1) 初期化失敗時 | 失敗時は `close()` + `exitCode=1`。バックグラウンドPromiseを保持し `monitorServerErrors` と競合させる（§4.3） |
| 統括担当からの確定事項(2) ログ | 待受直後に `(initial sync in progress)` 付きの listening ログ、`[api] database: ...` も待受直後へ移動、初回同期完了時に別ログ（§5） |
| 統括担当からの確定事項(3) 対象 | `main()` のみ非同期化、`startServer()` は現状維持＋乖離コメント（§4.5） |
| `apps/api/src/server.ts` 712〜846行（実コード確認） | `const server = app.listen(port)` は**初回同期ブロックより前**に実行されている。つまり現状でも初期化中からHTTPリクエストは受け付けられている。本Issueの実質的な変更点は「ログ出力の時刻」と「シグナル応答性」であり、**API応答内容は変更されない**（§6） |
| `apps/api/src/server.ts` 581〜593行（実コード確認） | `deferredCloseRef` / `shutdownSignalPending` は「close の実体が確定する前に届いたシグナルを保留し、確定後に反映する」仕組み。従来は初回同期完了まで close が確定しないため、初期化中のCtrl+Cは17分後にしか効かなかった。本設計では待受直後に確定させる（§4.4） |
| `apps/api/src/polling/imageServices.ts` 48行（実コード確認） | `createImageServices()` は**同期関数**。バックグラウンドPromiseの本体先頭に置けば、Promise生成時（最初の `await` に到達する前）に `imageServices` への代入が完了する。これがタイル系API 503 回帰を防ぐ鍵（§4.2・§7） |
| `apps/api/tests/nowcastApi.test.ts` 1251〜1300行（実コード確認） | 子プロセスを spawn し `/listening on http:\/\/localhost:(\d+)/` に**部分一致**した直後に `/api/weather/nowcast/times` を叩き 200 を期待する。正規表現は接尾辞追加でも一致し続ける。ただし `imageServices` 未生成なら `ImageServicesInitializingError` → 503 となるため、§4.2 の同期代入順序が必須 |
| `apps/api/tests/serverGracefulShutdownTiming.test.ts`（実コード確認） | 検証対象は `startServer()` のみ。確定事項(3)により無変更＝非退行 |
| `apps/api/src/app.ts` 266行ほか（実コード確認） | `ImageServicesInitializingError` は 503 `{status:'error', code:'image_services_initializing'}` にマップされる |
| `apps/api/src/gracefulShutdown.ts`（実コード確認） | SIGTERM/SIGINT を一度だけ購読し handler を1回だけ呼ぶ。`emitter.once()` を使うため**1回目のシグナルでリスナーが外れ、2回目のシグナルはNode既定動作で即時終了（終了コード130）となる**。本設計で変更不要 |
| `apps/api/src/server.ts` 717〜742行 `close()` の順序（実コード確認・検収実測） | `close()` は「`fetchHealthMonitorService.stop()` → `await scheduler.stop()` → `imageServices.close()` → `pollingService.stop()` →（signal時）`recordShutdown()` → `closeServer()` → `database.close()`」の順。`scheduler.stop()` は `await Promise.all(inFlightPromises)` で**実行中の初回XML取得（実測17分超）の完了を待つ契約**であり、初回取得は listening の約68ms後に始まる。したがって初回同期中のSIGINTは「close の**開始**は即座、**完了**は初回取得の完了まで待たされる」挙動になる（§4.4・§9）。完全終了（取得処理そのものの中断機構）は本Issueの範囲外とし #174 へ引き継ぐ |
| `apps/api/src/polling/timeBasedPollingScheduler.ts` 354・394・261行（実コード確認） | `start()` は先頭で `isRunning=true`、`stop()` は先頭で `isRunning=false` にしてから in-flight を待つ。`isRunningNow()` がこのフラグを返す。これが「close が開始されたか」を**数百ミリ秒で外部から観測できる唯一の観測点**であり、AC6 の判定に用いる（§8 AC6） |
| `apps/api/src/monitoring/monitoringStatusService.ts` 460〜480行・`apps/api/src/server.ts` 675〜683行（実コード確認） | `GET /api/monitoring/status` の `operation.schedulerRunning` は `scheduler?.isRunningNow() ?? false`。初回取得中は `true`、`close()` 開始後は `false` になる |
| `apps/api/src/database/config.ts` 14行（実コード確認） | DBパスの環境変数は **`WX_VIEWER_DB_PATH`**。`DATABASE_PATH` は実装が読まない（初版ACの誤り。§8で全て修正） |
| `apps/api/src/app.ts` 388〜398行（実コード確認） | `GET /api/monitoring/status` は `terminalId` 必須。欠落時は 400 `invalid_request`。ACのcurlには `?terminalId=hkeagh01` を付ける |

## 3. 現状の構造（変更前）

```
main()
  registerGracefulShutdown(process, ...)      // close 未確定 → shutdownSignalPending へ保留
  loadPollingScheduleConfig() / initializeDatabase()
  ...サービス生成 / createApp()
  const server = app.listen(port)             // ← ポートは既にここで開く
  const close = async (...) => {...}
  try {
    await waitForServerListening(server)
    serverErrorMonitor = monitorServerErrors(server)
    await Promise.race([serverErrorMonitor.promise, (async () => { 初回同期 })()])   // ← 17分超
    finally: serverErrorMonitor.dispose()
    console.log(database) ; console.log(listening)                                  // ← 遅い
  } catch { await close(); throw }
  server.once('error', ...)
  deferredCloseRef.current = close ; if (shutdownSignalPending) close({reason:'signal'})
```

## 4. 変更後の構造

`main()` の 743〜846行を以下の構造へ置き換える。`close` の定義（715〜741行）とそれより前は変更しない。

### 4.1 全体の流れ

```ts
await waitForServerListening(server);   // 失敗時は従来どおり catch → close() → throw

const serverErrorMonitor = monitorServerErrors(server);

// (A) 初回同期をバックグラウンドで起動する。
//     本体先頭の createImageServices() は同期関数なので、この行の完了時点で
//     imageServices は代入済み（§4.2）。
const initializationPromise = runInitialSync();

// (B) 待受ログ（確定事項(2)）
console.log(
  `[api] database: ${database.connection.name}, applied migrations: ${database.migrationSummary.appliedVersions.length}`,
);
console.log(`[api] listening on http://localhost:${port} (initial sync in progress)`);

// (C) close を確定させ、保留中シグナルを反映（§4.4）
deferredCloseRef.current = close;
if (shutdownSignalPending) {
  void close({ reason: 'signal' }).catch((closeError: unknown) => {
    console.error('保留していたgraceful shutdownの処理に失敗しました:', closeError);
  });
}

// (D) 初回同期の完了・失敗と server error の監視（§4.3）
void watchInitialSync(initializationPromise, serverErrorMonitor);
```

`main()` はこの後 `return`（＝(D) を待たずに resolve する）。プロセスはHTTPサーバーとバックグラウンドPromiseが生きているため終了しない。

### 4.2 `runInitialSync()`（初回同期本体）

現在の即時実行async関数（750〜817行）の本体をそのまま移すが、**中断点（abort point）を追加する**。`main()` のローカル変数（`closed`, `imageServices`, `pollingService`, `scheduler`, `fetchHealthMonitorService`, `database`, `schedule`, `startupRuntime`）を参照するため、`main()` 内のローカル関数として定義する。

```ts
const runInitialSync = async (): Promise<void> => {
  const enablePolling = process.env.DISABLE_POLLING !== 'true';

  // 【必須】この行より前に await を置かないこと。
  // createImageServices は同期関数であり、ここまでは Promise 生成と同じターンで実行される。
  // これにより待受ログ出力時点で imageServices は必ず生成済みとなり、
  // 画像系API（/api/weather/nowcast|kikikuru/...）が 503 image_services_initializing を
  // 返す窓を作らない（既存テスト nowcastApi.test.ts の子プロセス起動テストがこれに依存する）。
  imageServices = createImageServices({ connection: database.connection, schedule, enablePolling });

  if (!enablePolling) return;

  recoverLegacyVphwBulletinAreas(database.connection);
  for (const venueId of VENUE_IDS) {
    if (closed) return;                       // 中断点1
    const venue = resolveVenueWarningContext(venueId);
    await reprocessPendingWarningTelegramReceptions(/* 既存引数のまま */);
    if (closed) return;                       // 中断点2
    rebuildWarningCurrentFromReceptions(database.connection, venue.targetArea);
    emitInitialWarningNotifications(database.connection, venue.targetArea, startupRuntime.warningEmitDeps);
  }

  if (closed) return;                         // 中断点3
  pollingService = new JmaXmlPollingService(/* 既存のまま */);
  startupRuntime.connectPolling(pollingService);
  const adapters = createScheduledAdapters(/* 既存のまま */);
  scheduler = new TimeBasedPollingScheduler(/* 既存のまま */);
  fetchHealthMonitorService = new FetchHealthMonitorService(/* 既存のまま */);

  if (closed) return;                         // 中断点4（最重要）
  // 順序が重要（PRレビュー指摘 #141）: 既存コメントをそのまま残す。
  const schedulerStartPromise = scheduler.start();
  fetchHealthMonitorService.start();
  await schedulerStartPromise;
};
```

中断点の意味と設計判断:

- `closed` は `close()` が先頭で `true` にする既存フラグ。同じクロージャから参照できる。
- **中断点4が最重要**。従来は初期化完了まで close が確定しなかったため「close と初回同期が同時に走ること」自体が起こり得なかった。close を待受直後に確定させる本変更で初めて同時実行が発生するため、`scheduler.start()`（＝外部への初回XML取得。DBへ書き込む）を `closed` 後に開始させないことが必須である。
- 中断点3で `return` した場合、`pollingService` / `scheduler` は未生成のため `close()` の既存クリーンアップ（`if (scheduler) ...`）で取りこぼしは起きない。
- `closed` 判定と生成の間（同期区間）に割り込みは入らないため、中断点の直後に生成・start する形であれば「close がクリーンアップしたのに後から生成された」ケースは起こらない。**ただし `scheduler.start()` の内部 await 中にシグナルが来た場合は、`close()` 側の `await scheduler.stop()` が担当する**（`close()` は `closed=true` の後に `scheduler` を読むため、その時点で生成済みなら停止される）。
- **中断点の実効性の限界（検収実測）**: 初回XML取得は listening の約68ms後（＝中断点4を通過した直後）に始まるため、開発者が手で送るSIGINTは**ほぼ必ず初回取得の実行中に着弾する**。その時点では中断点1〜4はすべて通過済みで、`if (closed) return;` は実質効かない。中断点は「シグナルが会場再処理ループ中など早い段階で着弾した場合」に効く保険であり、初回取得中の即時中断を与えるものではない。これは `scheduler.stop()` が実行中ジョブの完了を待つ契約に由来する**設計起因の限界**であり、取得処理自体の中断機構（`POST /api/control/fetch/stop` への即応を含む）は #174 で扱う（§9・§10）。

### 4.3 `watchInitialSync()`（完了・失敗の監視）

確定事項(1)のとおり、バックグラウンドPromiseを保持して `serverErrorMonitor` と競合させる。**未処理Promise拒否（unhandledRejection）を作らない**ため、`Promise.race` に生のPromiseを渡さず、先に rejection を消費する。

```ts
const watchInitialSync = async (
  initializationPromise: Promise<void>,
  serverErrorMonitor: { readonly promise: Promise<never>; dispose(): void },
): Promise<void> => {
  const startedMs = Date.now();
  let initializationError: unknown;
  let initializationFailed = false;
  // race で負けた側の rejection が未処理にならないよう、ここで必ず消費する。
  const settled = initializationPromise.catch((error: unknown) => {
    initializationFailed = true;
    initializationError = error;
  });

  try {
    await Promise.race([serverErrorMonitor.promise, settled]);
    if (initializationFailed) {
      throw initializationError;
    }
    if (!closed) {
      console.log(`[api] initial sync completed (${Date.now() - startedMs}ms)`);
    }
  } catch (error) {
    // 確定事項(1): 初期化失敗・server error のいずれでも close して異常終了させる。
    // 既に close 済み（シグナル停止）なら異常終了扱いにしない。
    if (closed) {
      console.error('初期化中に停止したため初回同期を中断しました:', error);
      return;
    }
    console.error(error);
    try {
      await close();
    } catch (closeError) {
      console.error('初期化失敗後のクローズに失敗しました:', closeError);
    }
    process.exitCode = 1;
  } finally {
    serverErrorMonitor.dispose();
    // 既存と同じ順序（dispose の後に長期監視ハンドラを登録）を保つ。
    if (!closed) {
      server.once('error', (error) => {
        void close().finally(() => {
          console.error(error);
          process.exitCode = 1;
        });
      });
    }
  }
};
```

補足:

- `server.once('error', ...)` の登録位置は「`serverErrorMonitor.dispose()` の直後」という既存の順序（819〜837行）を保つ。両方が同時に生きると `close` が二重に呼ばれログが重複するため、意図的にこの順序とする（`close` は冪等なので機能上の害はない）。
- `DISABLE_POLLING=true` の場合、`runInitialSync()` は `createImageServices` 直後に return するため、初回同期完了ログは待受ログとほぼ同時に出る（正常）。
- `main()` は (D) を await しないため、初期化失敗時に `main()` の呼び出し元（849〜854行の `void main().catch(...)`）は反応しない。`exitCode=1` の設定と `close()` は `watchInitialSync()` 内で完結させる。`process.exit()` は呼ばない（既存方針どおり、ハンドルが閉じてから自然終了させる）。

### 4.4 graceful shutdown との相互作用

| 事象のタイミング | 変更前の挙動 | 変更後の挙動 |
| --- | --- | --- |
| 待受前にシグナル | `shutdownSignalPending=true` で保留、初期化完了後に close | 同じ（変更なし） |
| 待受後・初回同期中にシグナル | 保留され、**close の開始自体が初回同期完了（最大17分超）まで起こらない** | `deferredCloseRef.current` が確定済みなので**close の開始が即座になる**（`closed=true`、`fetchHealthMonitorService.stop()`、`scheduler.stop()` の `isRunning=false` までは数ミリ秒で到達）。ただし**close の完了は即座ではない**: `await scheduler.stop()` が実行中の初回XML取得の完了を待つため、プロセスの実際の終了は初回取得完了まで待たされる（§9・#174） |
| 初回同期完了後にシグナル | 即 close | 同じ |
| 初期化中にシグナル→その後に初期化が失敗 | 起こり得なかった | `closed` が真のため `exitCode=1` にせず、中断ログのみ（§4.3） |

`close({reason:'signal'})` は `fetchControlService.recordShutdown()` を呼ぶ。初期化中の停止でも `fetchControlService` は待受前に生成済みであり、この記録は従来どおり行われる。ただし `recordShutdown()` は `close()` の順序上 `await scheduler.stop()` の**後**にあるため、初回取得中に停止した場合の記録も初回取得完了後になる。

**本Issueが改善する範囲の明確化**: 本変更が与えるのは「シグナルが**保留されず即座にハンドラで受理され、close が開始される**」ことまでである。「Ctrl+Cで数秒以内にプロセスが終了する」ことは本Issueでは達成しない（`scheduler.stop()` の契約による）。開発中に即時終了させたい場合は、1回目のSIGINTでリスナーが外れている（`gracefulShutdown.ts` が `once` を使う）ため、**2回目のCtrl+CでNode既定動作により即時終了する**。この挙動は仕様として受け入れ、恒久対応は #174 とする。

### 4.5 `startServer()` に残す乖離コメント

`startServer()` 冒頭（初回同期相当の処理の直前）に以下の趣旨のコメントを追加する。

> Issue #171: `main()` は待受直後に listening ログを出力し初回同期をバックグラウンド化したが、`startServer()` は**初回同期の完了を待って resolve する**契約を維持する。既存テストが「resolve 時点で初回取得・再処理が完了している」ことに依存しているため、意図的に `main()` と構造が異なる。

## 5. ログ仕様

| 出力時点 | 文言 | 変更 |
| --- | --- | --- |
| 待受成功直後 | `[api] database: ${name}, applied migrations: ${n}` | 位置のみ移動 |
| 待受成功直後 | `[api] listening on http://localhost:${port} (initial sync in progress)` | 接尾辞追加＋位置移動 |
| 初回XML取得開始時 | `[api] starting initial JMA XML feed fetch...` | 変更なし（既存） |
| 初回XML取得完了時 | `[api] completed initial JMA XML feed fetch (${ms}ms)` | 変更なし（既存） |
| 初回同期（再処理＋スケジューラ起動まで）完了時 | `[api] initial sync completed (${ms}ms)` | 新規 |

`initial sync completed` は既存の `completed initial JMA XML feed fetch` より後に出る（後者はXML取得だけ、前者はスケジューラ起動までを含む全体）。文言の区別は実装ディテールとして設計担当が決定した。

## 6. `/api/initialization` とフロントの初期化中認識との整合

**実コード確認の結果、`/api/initialization` というエンドポイントは存在しない。** 初期化中の認識は次の2経路で行われている。

1. `POST /api/notifications/startup` — `StartupNotificationInitialization.isReady(venueId)` が偽のとき `{status:'initializing', venueId}` を返す。フロントは `apps/web/src/api/startupNotifications.ts` の `isInitializing()` で判定している。
2. `GET /api/monitoring/status` — 会場ごとに `startupEvaluated`（`initialFetchPhase==='completed'` かつ会場評価済み）と `reprocessing`（`InMemoryStartupProgressTracker`）を返す。

本設計はこれらの状態機械（`initialization` / `progressTracker` / `initialFetchPhase`）に一切手を入れない。また `app.listen(port)` は変更前から初回同期ブロックより先に実行されており、**初期化中でもHTTPは応答していた**。したがって本変更によるAPI応答内容の変化はなく、変わるのは「開発者が待受を認識できる時刻」と「シグナル応答性」のみである。

唯一の注意点は画像系API（`imageServices` 未生成なら 503 `image_services_initializing`）で、§4.2 の同期代入順序により窓を作らない。

## 7. 既存テストへの影響

| テスト | 影響 | 根拠 |
| --- | --- | --- |
| `apps/api/tests/nowcastApi.test.ts`「main 子プロセス起動テスト」 | 影響なし（要実行確認）。listening ログの正規表現は部分一致で接尾辞追加に耐える。`imageServices` は §4.2 により同期代入済み。むしろ 15 秒タイムアウトに対して余裕が増える | 実コード・実テスト確認済み |
| `apps/api/tests/serverGracefulShutdownTiming.test.ts` | 影響なし。`startServer()` のみを対象とし、`startServer()` は無変更 | 実コード確認済み |
| `apps/api/tests/database.test.ts` / `jmaXmlPolling.test.ts` / `issue33WarningRestApis.test.ts` / `issue145BulletinNotifications.test.ts` / `reprocessProgressLogs.test.ts` | いずれも `startServer()` のみを使用するため影響なし | `grep -rn "startServer" apps packages --include="*.ts"` で全件確認済み |

新規テストは必須としない（`main()` の子プロセス起動テストが既に存在し、待受ログ経路をカバーしている）。ただし §8 AC4 で「待受ログが初回同期より先に出る」ことを子プロセスの標準出力順で検証する。

## 8. 受け入れ条件チェックリスト

いずれも `apps/api` ディレクトリを起点に実行する。`<repo>` はリポジトリルート。

- **AC1 静的検査**: `npm run lint` / `npm run typecheck` / `npm run format:check` をリポジトリルートで実行し、いずれも終了コード0・エラー0件であること。
- **AC2 APIテスト全緑**: `npm run test -w apps/api` を実行し、失敗0件であること（`fail 0`）。
- **AC3 子プロセス起動テスト単体**: `npm run test -w apps/api` の出力に `nowcastApi` 由来の失敗がないこと。個別確認する場合は `node --import tsx --test apps/api/tests/nowcastApi.test.ts` を実行し `fail 0` を確認する。
- **AC4 待受ログの早期出力（DISABLE_POLLING=true）**: 一時DBパスを指定して
  `cd apps/api && DISABLE_POLLING=true PORT=3099 WX_VIEWER_DB_PATH=$(mktemp -d)/ac4.db node --import tsx src/server.ts`
  を起動し、**5秒以内**に標準出力へ次の2行がこの順で出ることを目視確認する。
  1. `[api] database: ...`
  2. `[api] listening on http://localhost:3099 (initial sync in progress)`
  続いて `[api] initial sync completed (Nms)` が出ること。確認後 Ctrl+C（SIGINT）で終了すること（`DISABLE_POLLING=true` では初回取得が走らないため即座に終了する）。
  ※ DBパスの環境変数は `WX_VIEWER_DB_PATH`（`apps/api/src/database/config.ts` 14行）。`DATABASE_PATH` では既定パスが使われてしまうため誤り。
- **AC5 初期化中のHTTP応答**: AC4 のプロセスに対し、listening ログ出力の直後に別シェルから
  `curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3099/api/health'` → `200`、
  `curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3099/api/weather/nowcast/times?terminalId=hkeagh01&controlStatus=normal'` → `200`(503 でないこと)、
  `curl -s 'http://127.0.0.1:3099/api/monitoring/status?terminalId=hkeagh01' | head -c 200` が JSON（`"status":"ready"` を含む）を返すことを確認する。
  ※ `/api/monitoring/status` は `terminalId` 必須（`apps/api/src/app.ts` 388〜398行）。省略すると 400 `invalid_request` になるため必ず付ける。
- **AC6 初回同期中のSIGINTが保留されず、close が開始されること（ポーリング有効）**

  **確認する命題**: 「listening 後に届いたSIGINTが `shutdownSignalPending` に保留されず、その場でハンドラが起動して `close()` が開始される」こと。
  **確認しない命題**: 「短時間でプロセスが終了する」こと。`close()` は `await scheduler.stop()` で実行中の初回XML取得（実測17分超）の完了を待つ契約であり、初回取得は listening の約68ms後に始まるため、手で送るSIGINTはほぼ必ず取得中に着弾する。完全終了は設計起因の限界として #174 で扱う（§4.4・§9）。

  **観測点**: 現実装に「shutdown を開始した」ことを示すログは存在しない（`close()` は `console.log` を持たない。`gracefulShutdown.ts` のハンドラも無言）。そこで実装を読んで実際に観測できる代替として、`GET /api/monitoring/status?terminalId=hkeagh01` の **`operation.schedulerRunning`** を使う。これは `scheduler?.isRunningNow() ?? false`（`apps/api/src/server.ts` 682行）であり、`TimeBasedPollingScheduler.start()` は先頭で `isRunning=true`、`stop()` は先頭で `isRunning=false` にしてから in-flight を待つ（同ファイル 354・394・261行）。したがって
  - SIGINT 前: `schedulerRunning === true`（初回取得が実行中）
  - SIGINT 後（数百ミリ秒以内）: `schedulerRunning === false`（`close()` → `scheduler.stop()` に到達した証拠）

  が成り立つ。保留されていれば（修正前の挙動）`close()` は呼ばれず `schedulerRunning` は `true` のままである。この反転がACの合否判定である。

  **手順**（スクラッチディレクトリ等、リポジトリ外の作業場所で実行する。作成した一時ファイルは削除する）:

  ```bash
  # リポジトリルートで実行する
  DB="$(mktemp -d)/ac6.db"
  LOG="$(mktemp -d)/ac6.log"
  ( cd apps/api && PORT=3099 WX_VIEWER_DB_PATH="$DB" node --import tsx src/server.ts ) >"$LOG" 2>&1 &
  PID=$!

  # 1) listening ログを最大30秒待つ
  for i in $(seq 1 60); do grep -q 'listening on http://localhost:3099' "$LOG" && break; sleep 0.5; done
  grep -n 'listening on http://localhost:3099 (initial sync in progress)' "$LOG"

  # 2) 初回取得が走り出し schedulerRunning=true になるのを最大15秒待つ
  for i in $(seq 1 30); do
    curl -s 'http://127.0.0.1:3099/api/monitoring/status?terminalId=hkeagh01' \
      | grep -q '"schedulerRunning":true' && break
    sleep 0.5
  done
  curl -s 'http://127.0.0.1:3099/api/monitoring/status?terminalId=hkeagh01' | grep -o '"schedulerRunning":[a-z]*'   # → true

  # 3) SIGINT を1回送り、schedulerRunning が false に反転することを最大5秒待つ
  kill -INT "$PID"
  for i in $(seq 1 10); do
    curl -s 'http://127.0.0.1:3099/api/monitoring/status?terminalId=hkeagh01' \
      | grep -q '"schedulerRunning":false' && break
    sleep 0.5
  done
  curl -s 'http://127.0.0.1:3099/api/monitoring/status?terminalId=hkeagh01' | grep -o '"schedulerRunning":[a-z]*'   # → false（合格）

  # 4) 自分が起動したプロセスのみを確実に終了させる
  #    1回目のSIGINTでリスナーは外れている（gracefulShutdown.ts が once を使う）ため、
  #    2回目のSIGINTはNode既定動作で即時終了する。
  kill -INT "$PID" 2>/dev/null || true
  sleep 1
  kill -9 "$PID" 2>/dev/null || true   # 念のため
  rm -f "$LOG" "$DB"
  ```

  **合格条件**（すべて満たすこと。実行時間は1分以内に収まる）:
  1. 手順1で `listening on http://localhost:3099 (initial sync in progress)` が出力されている。
  2. 手順2で `"schedulerRunning":true` が観測できる（初回取得が実行中＝SIGINTが取得中に着弾する状況である確認）。
  3. 手順3で、SIGINT送出後**5秒以内**に `"schedulerRunning":false` へ反転する（＝SIGINTが保留されず `close()` が開始された証拠）。
  4. ログに `保留していたgraceful shutdownの処理に失敗しました` および `graceful shutdown の記録に失敗しました` が出ていない。
  5. 手順3の時点で `[api] initial sync completed` が出力されていない。

  **注記**: 本ACは外部（気象庁）への実リクエストを伴う。手順4で必ずプロセスを終了させること。手順4のプロセスが `kill -9` でしか落ちなかった場合も、それは本ACの合否に影響しない（§9 の既知の限界）が、検収報告に事実として記載すること。`DISABLE_POLLING=true` では初回取得が走らないため本ACは検証できない。

- **AC7 待受ログが初回同期の開始より前**: AC6 手順1〜3のログ（`$LOG`）で、`listening on` の行が `starting initial JMA XML feed fetch...` の行より**前**に出ていること（従来は後だった）。`grep -n 'listening on\|starting initial JMA XML feed fetch' "$LOG"` の行番号で確認する。
- **AC8 初期化失敗時の異常終了**: 意図的な失敗の再現手段が無いため、コードレビューで次を確認する。`watchInitialSync()` の catch 節で (a) `console.error(error)`、(b) `await close()`、(c) `process.exitCode = 1` の3つが揃っていること、かつ `closed` が真の場合は (c) を行わないこと。**実挙動未確認**である旨を検収報告に明記すること。
- **AC9 `startServer()` 無変更**: `git diff main -- apps/api/src/server.ts` において、`startServer()` 関数本体の変更が §4.5 のコメント追加のみであること（ロジックの差分が無いこと）。
- **AC10 変更範囲**: `git diff --name-only main` が `apps/api/src/server.ts` と `docs/design/issue-171-early-listening-log.md` のみであること（`apps/api/dist/` などが含まれないこと）。

## 9. 残留リスクと注記

- **初回同期中のSIGINTでは、close は即座に開始されるがプロセスの終了は初回XML取得の完了（実測17分超）まで待たされる（検収実測により確認済み）**。原因は `close()` 内の `await scheduler.stop()` が `Promise.all(inFlightPromises)` で実行中ジョブの完了を待つ契約であること、および初回取得が listening の約68ms後に始まり中断点（`if (closed) return;`）が実質効かないことの2点。これは本Issueの変更で生じた退行ではなく、既存の停止契約に由来する**設計起因の限界**である。本Issueはここを改善対象に含めない（§1.2）。
  - 開発時の回避策: **2回目のCtrl+C（SIGINT）でNode既定動作により即時終了する**（`gracefulShutdown.ts` が `once` でリスナーを登録しており、1回目で外れるため）。ただしこの経路は graceful shutdown の後半（`recordShutdown()`・`closeServer()`・`database.close()`）を実行しないため、B5記録が残らない。
  - 恒久対応（取得処理自体の中断機構、`POST /api/control/fetch/stop` の即応化）は **#174（親 #168）** で扱う。
- `scheduler.start()` の await 中にシグナルが来た場合に、`close()` が `database.close()` まで進んだ後に初回取得の続きがDBへ触れて例外ログが出る可能性は残る。`await scheduler.stop()` が実行中ジョブの完了を待つため通常は先に収束する（上記のとおり、この「待つ」ことが終了遅延の原因でもある）。発生した場合は「初回同期中断時の例外ログ」であり、終了コードには影響させない設計（§4.3 の `closed` 分岐）としている。**この例外経路は実挙動未確認**。
- **AC6 はポーリング有効で実行するため外部（気象庁）へのリクエストが発生する**。夜間帯設定によりXML取得が抑止される時刻があり、その場合 `schedulerRunning` は `true` になるが初回取得が実行中にならないことがある。AC6 手順2で `true` が観測できない時刻帯は、時刻を変えて再実行すること。検証は短時間（listening 確認後すぐ SIGINT、合計1分以内）に留め、必ずプロセスを終了させること。
- 現実装には「graceful shutdown を開始した」ことを示すログが存在しない。そのため AC6 は `operation.schedulerRunning` の反転という間接的な観測点に依存している。shutdown開始ログの追加は #174 の作業に含めると検証が容易になる（§10）。
- `main()` が初回同期を待たずに resolve するため、`main()` の戻りをもって「起動完了」と見なす外部スクリプトがあれば意味が変わる。現時点でそのような利用箇所は無い（`grep` で `main()` の呼び出しは 849 行の1箇所のみ）。
- `startServer()` と `main()` の初回同期処理が二重に記述された状態は本Issueでも解消しない（確定事項(3)）。共通化は後続Issue候補（§10）。

## 10. 後続Issueへの引き継ぎ事項

1. `startServer()` と `main()` の初期化シーケンス二重管理の共通化（`runInitialSync` 相当を切り出して両者から使う）。本Issueでは確定事項(3)により対象外。
2. フロントエンドに「初期化中」であることを明示する表示（現在は `POST /api/notifications/startup` の `initializing` と `GET /api/monitoring/status` で判定できるが、待受直後からアクセス可能になったことでUI側の初期化中表示の重要性が上がる）。UI要件は未ヒアリング。
3. 初回同期の進捗を示す構造化ログ・メトリクス（現在は会場再処理の進捗が `progressTracker` にのみ存在）。
4. **#174（親 #168）— 初回XML取得の中断機構**。本Issueの範囲外とした以下をまとめて扱う。
   - `scheduler.stop()` / `JmaXmlPollingService` への中断機構（`AbortSignal` 等）の導入により、初回取得中でも数秒以内にプロセスを終了できるようにする。
   - K端末からの `POST /api/control/fetch/stop` が初回取得中でも即応するようにする。
   - graceful shutdown の開始・段階を示すログ（例: `[api] graceful shutdown started (reason=signal)`）の追加。これにより本Issueの AC6 のような検証が `schedulerRunning` の間接観測ではなくログで直接行える。
