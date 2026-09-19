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
- 初期化中にSIGTERM/SIGINTが届いた場合の中断・後始末を設計する
- 既存テスト（特に子プロセス起動テスト）への非退行を担保する

### 1.2 やらないこと

- `startServer()`（テスト用エントリ）の非同期化。**確定事項(3)により現状維持**（初期化完了後に resolve する同期的な契約を保つ）。`main()` との構造の乖離はコード内コメントで明記する
- 新規エンドポイントの追加、既存エンドポイントの応答内容の変更
- `/api/initialization` という名前のエンドポイントの新設（§6参照。実在しない）
- スケジューラ・ポーリング・通知ロジック自体の変更

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
| `apps/api/src/gracefulShutdown.ts`（実コード確認） | SIGTERM/SIGINT を一度だけ購読し handler を1回だけ呼ぶ。本設計で変更不要 |

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
- 残留リスク: `scheduler.start()` の await 中にシグナルが来ると、`close()` が `database.close()` まで進んだ後に初回取得の続きがDBへ触れて例外になる可能性がある。`close()` は「サービス停止 → `closeServer` → `database.close()`」の順（既存）であり、`await scheduler.stop()` が実行中ジョブの完了を待つため通常は先に収束する。§9 に残留リスクとして記載。**この経路は実挙動未確認**（再現に17分規模の初回取得が必要）。

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
| 待受後・初回同期中にシグナル | 保留され、**初回同期完了（最大17分超）まで停止しない** | `deferredCloseRef.current` が確定済みなので**即座に** `close({reason:'signal'})` が走る。初回同期は中断点で自発的に終了する |
| 初回同期完了後にシグナル | 即 close | 同じ |
| 初期化中にシグナル→その後に初期化が失敗 | 起こり得なかった | `closed` が真のため `exitCode=1` にせず、中断ログのみ（§4.3） |

`close({reason:'signal'})` は `fetchControlService.recordShutdown()` を呼ぶ。初期化中の停止でも `fetchControlService` は待受前に生成済みであり、この記録は従来どおり行われる。

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
  `cd apps/api && DISABLE_POLLING=true PORT=3099 DATABASE_PATH=$(mktemp -d)/ac4.db node --import tsx src/server.ts`
  を起動し、**5秒以内**に標準出力へ次の2行がこの順で出ることを目視確認する。
  1. `[api] database: ...`
  2. `[api] listening on http://localhost:3099 (initial sync in progress)`
  続いて `[api] initial sync completed (Nms)` が出ること。確認後 Ctrl+C（SIGINT）で終了すること。
- **AC5 初期化中のHTTP応答**: AC4 のプロセスに対し、listening ログ出力の直後に別シェルから
  `curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3099/api/health'` → `200`、
  `curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3099/api/weather/nowcast/times?terminalId=hkeagh01&controlStatus=normal'` → `200`(503 でないこと)、
  `curl -s 'http://127.0.0.1:3099/api/monitoring/status' | head -c 200` が JSON を返すことを確認する。
- **AC6 初回同期中のCtrl+Cが即効くこと（ポーリング有効）**: `cd apps/api && PORT=3099 DATABASE_PATH=$(mktemp -d)/ac6.db node --import tsx src/server.ts` を起動し、`listening on ...(initial sync in progress)` を確認した後（`initial sync completed` を待たずに）SIGINT を送る。**10秒以内**にプロセスが終了コード0で終了し、`[api] initial sync completed` が出力されないこと、`保留していたgraceful shutdownの処理に失敗しました` などのエラーが出ないことを確認する。外部通信を避けたい場合は §9 の注記に従い `DISABLE_POLLING=true` では本ACは検証できない点に留意する。
- **AC7 待受ログが初回同期完了より前**: AC6 の標準出力で、`listening on` の行が `starting initial JMA XML feed fetch...` の行より**前**に出ていること（従来は後だった）。
- **AC8 初期化失敗時の異常終了**: 意図的な失敗の再現手段が無いため、コードレビューで次を確認する。`watchInitialSync()` の catch 節で (a) `console.error(error)`、(b) `await close()`、(c) `process.exitCode = 1` の3つが揃っていること、かつ `closed` が真の場合は (c) を行わないこと。**実挙動未確認**である旨を検収報告に明記すること。
- **AC9 `startServer()` 無変更**: `git diff main -- apps/api/src/server.ts` において、`startServer()` 関数本体の変更が §4.5 のコメント追加のみであること（ロジックの差分が無いこと）。
- **AC10 変更範囲**: `git diff --name-only main` が `apps/api/src/server.ts` と `docs/design/issue-171-early-listening-log.md` のみであること（`apps/api/dist/` などが含まれないこと）。

## 9. 残留リスクと注記

- **`scheduler.start()` の await 中にシグナルが来る経路は実挙動未確認**。`close()` の `await scheduler.stop()` が実行中ジョブの完了を待つ設計であるため通常は収束するが、`database.close()` 後に初回取得の続きがDBへ触れて例外ログが出る可能性が残る。発生した場合は「初回同期中断時の例外ログ」であり、終了コードには影響させない設計（§4.3 の `closed` 分岐）としている。
- **AC6 はポーリング有効で実行するため外部（気象庁）へのリクエストが発生する**。夜間帯設定によりXML取得が抑止される時刻がある点に注意する。検証は短時間（listening 確認後すぐ SIGINT）に留めること。
- `main()` が初回同期を待たずに resolve するため、`main()` の戻りをもって「起動完了」と見なす外部スクリプトがあれば意味が変わる。現時点でそのような利用箇所は無い（`grep` で `main()` の呼び出しは 849 行の1箇所のみ）。
- `startServer()` と `main()` の初回同期処理が二重に記述された状態は本Issueでも解消しない（確定事項(3)）。共通化は後続Issue候補（§10）。

## 10. 後続Issueへの引き継ぎ事項

1. `startServer()` と `main()` の初期化シーケンス二重管理の共通化（`runInitialSync` 相当を切り出して両者から使う）。本Issueでは確定事項(3)により対象外。
2. フロントエンドに「初期化中」であることを明示する表示（現在は `POST /api/notifications/startup` の `initializing` と `GET /api/monitoring/status` で判定できるが、待受直後からアクセス可能になったことでUI側の初期化中表示の重要性が上がる）。UI要件は未ヒアリング。
3. 初回同期の進捗を示す構造化ログ・メトリクス（現在は会場再処理の進捗が `progressTracker` にのみ存在）。
