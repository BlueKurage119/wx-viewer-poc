# Issue #225 復旧テストの残存乱数ポートと後始末の統一

## 状態・目的

- 【設計案】設計担当: Codex（GPT-6）。設計着手のみ承認済み。製造は設計承認後に別途着手する。
- [Issue #225](https://github.com/BlueKurage119/wx-viewer-poc/issues/225) の対象2件を `port: 0` と `t.after` に揃え、ポート衝突と失敗時の資源残留を防ぐ。
- 【確定】復旧ゲートを解放する前の実HTTP検証、既存期待値・通知順序・会場別検証は維持する。スキップ・隔離・検証緩和はしない。
- 設計時の基点は main `1b6dce7`。着手時差分は `package.json` の web 起動への `--host` 追加だけであり保持する。Git管理領域は読取専用で、設計担当はブランチ・コミット等を操作しない。

## 参照資料・静的調査の根拠

| 参照 | 確認した事実・設計判断 |
| --- | --- |
| Issue本文（統括から受領）・[Issue #222 設計書](issue-222-recovery-test-stability.md) | OSによるポート割当と失敗時の終了保証が目的。`t.after` はFIFOであり、closeを削除より先に行う |
| `apps/api/tests/databaseRecoveryOrchestration.test.ts` | 最新コードの乱数ポートは263行・402行。AC13とAC10/11/15の両方に既に `finally` がある。Issueの「未検証」の推測とは区別する |
| `apps/api/src/server.ts` | `app.listen()`（574行）後に待受を待ち、会場の復旧を逐次awaitする。実ポートを返すのは復旧完了後。ゲート解放前の `await startServer()` は停止する |
| 同 `StartedServer`・`StartServerOptions` | 戻り値は `port` と `close()` を持つが、待受コールバックやHTTPサーバー注入の入口はない。公開契約は変更しない |
| 同 起動catch・close（700行以降） | 待受後の起動失敗はサービス・HTTPサーバー・DBを閉じてrejectする。正常起動後の `close()` は `closed` フラグで冪等 |
| `node_modules/express/lib/application.js` | `app.listen()` は `http.createServer(this)` の `listen` に委譲する。同期呼出しの範囲で実HTTPサーバーを捕捉できる |
| `node_modules/@types/node/test.d.ts`・`net.d.ts` | `t.mock.method(object, method)` は元関数を呼び、呼出しの `this`・引数・戻り値を記録できる。対象mockだけを `mock.restore()` で復元できる |
| `apps/api/src/database/index.ts` | setupで作った `context.close()` も冪等。後始末で再度呼んでもよい |
| `apps/api/package.json`・Node CLI help | APIテストはtsxと会場preloadをimportする。現環境はNode 24.20.0で `--test-timeout` がある。`timeout` / `gtimeout` はなく、Python 3は利用可能 |
| 開発・設計・検証業務標準、G-01/G-04/G-10指導文書 | 対象設計書1本のみ作成。期待値は維持し、対照実験を先に行い、受入項目ごとに終了結果を記録する |
| `docs/basic-design.md` §7.6、`docs/issues-draft.md` | 復旧時も通常の通知生成を行う既存仕様を変更しない。Issue #225の詳細はIssue本文を基準とする |

以上は読み取り調査であり、ポート捕捉・後始末・タイムアウトの**実挙動未確認**。設計段階ではテスト、サーバー起動、意図的失敗の実験を実行していない。

## 変更範囲・構成

製造で変更するのは `apps/api/tests/databaseRecoveryOrchestration.test.ts` の対象2テストと、同ファイル内の捕捉・待機用ローカルヘルパーだけ。`apps/api/src/**`、他テスト・共通ヘルパー、package関連・設定ファイルは変更しない。本設計書以外の設計資料も変更しない。

対象テストは `async (t)` とする。公開型・エンドポイントの追加はない。ファイル内で使用する型・処理の形は以下とする（内部名は製造担当の裁量）。

- `StartupOutcome = { status: 'fulfilled'; server: Awaited<ReturnType<typeof startServer>> } | { status: 'rejected'; error: unknown }`
- `StartupState = { starting?: ReturnType<typeof startServer>; outcome?: Promise<StartupOutcome>; httpServer?: Server; listenCalls?: number; requestedPort?: unknown; release?: () => void; restoreListen?: () => void }`（hook所有の可変状態）
- `captureStartingServer(t: TestContext, options: StartServerOptions, state: StartupState): void`
- `waitForAssignedPort(httpServer: Server, outcome: Promise<StartupOutcome>): Promise<number>`
- 型importは `node:test`、`node:http`、既存 `server.js` から取得する。必要な捕捉結果の型検証はテスト側で行う。`any` や公開型の変更で回避しない。

## 実割当ポートの取得

1. setup返却直後に `StartupState` を作り、この状態を参照する後始末hookを登録する。ゲートのresolve関数は作成時に `state.release` へ保存する。その後 `captureStartingServer` に同じ状態を渡す。ヘルパーの戻り値を受けてから所有権を移す構成は採らない。
2. ヘルパー内部で `t.mock.method(Server.prototype, 'listen')` を実装差替えなしで登録し、対象mockの復元関数を直ちに `state.restoreListen` に保存する。元のlistenが実行されるため、待受・エラー・HTTP結線を模擬しない。
3. 同期的に `startServer({ ...options, port: 0 })` を呼ぶ。返却されたPromiseをまず `state.starting` に保存し、直ちに成功・失敗両方のハンドラーを付けた `state.outcome` も保存する。呼出し記録の読取・捕捉検査・mock復元より前にこの2つを保存する。失敗を状態として保持して、待機側と後始末側が必ず観測する。元の `starting` のrejectを未処理のまま放置しない。
4. 最初のawaitに到達する前にExpressのlisten呼出しが完了するので、呼出し記録の `this` を `state.httpServer` に保存する。件数・引数も状態に保存する。捕捉値の型・戻り値との同一性などのassertは、状態への保存とmock復元が完了した後、step5で行う。`try/finally` で対象mockだけを直ちに復元し、復元成功後に `state.restoreListen` を解除する。mock登録中にawait・HTTPアクセス・assertを挟まない。`restoreAll()` で他のmockを解除しない。呼出し記録読取や復元がthrowしてヘルパーが正常returnしなくても、hookは保存済み `state.outcome` から実際の `StartedServer` を閉じられる。
5. 後始末登録後に、listenがちょうど1件、要求ポートが0、捕捉対象がHTTP `Server` であることを確認する。捕捉なし・複数件は失敗として扱い、推測で別サーバーを選ばない。
6. 既存 `waitUntil` と同じ10ms間隔・5秒上限で `httpServer.listening` を待つ。起動rejectが先に判明した場合は即座にそのエラーを投げる。新しい `listening` / `error` listenerは登録しないため、待機失敗時に追加listenerは残らない。
7. `address()` がnull・文字列でないこと、`address.port > 0` を検査し、そのポートを既存URLすべてに使用する。ゲートはまだ解放しない。

`Server.prototype` の監視はプロセス内に作用するが、登録から復元までが同期処理であり、対象2件だけで使用する。他のテストを並行化する設定を追加しない。外部プロセスの既存サーバーには作用しない。Node/Expressの内部呼出しが変わった場合は捕捉件数の検査で失敗し、ポートの推測や再予約で回避しない。

待受ポートを事前予約して閉じる方式は、閉じてからAPIがlistenするまでの衝突競合を残すため採らない。ゲートを先に解放して `server.port` を読む方式は、復旧中のAPI検証を失うため採らない。

## 後始末・部分初期化・失敗

各対象テストで、setupが返った直後に `StartupState` を作り、これを所有する単一の `t.after(async () => ...)` を登録する。hook登録を `captureStartingServer` より前に済ませ、起動資源はヘルパーの正常returnに依存せず同じ状態へ逐次保存する。単一hook内で以下を逐次実行し、FIFOの登録順に依存する箇所を減らす。

1. ゲートが作られていれば解放する。正常経路で解放済みでもPromiseのresolveは冪等。
2. `state.restoreListen` が残っていれば対象mockの復元を再試行し、失敗は保持して資源解放を続ける。setupの `context.close()` を呼ぶ。正常経路ではstartServerの前に既に閉じているが、初期化途中の例外でも閉じる。
3. 起動済みなら `outcome` の確定を待つ。成功なら `StartedServer.close()` をawaitする。起動失敗なら `startServer` のcatchによる解放完了後にoutcomeが確定する。失敗結果を無条件catchで消さず、テスト本体またはhookで報告する。
4. 捕捉HTTPサーバーがある場合、`listening === false` を確認する。close失敗・未確定・まだ待受中の場合は削除に進まず、後始末失敗として報告する。
5. サーバー終了が確認できたときだけ `rmSync(directory, { recursive: true, force: true })` を行う。DB削除後のcloseによる `SQLITE_READONLY_DBMOVED` を防ぐ。

起動rejectやmock復元失敗は一旦保持し、待受なしとdir削除を確認してから必要ならhookで再送出する。例外を先に再送出してclose・削除を飛ばさない。捕捉Serverが得られなくても、保存済みoutcomeの成功結果からclose完了を確認できる。close自体が失敗した場合は待受停止だけでDB解放完了を推測せず、削除せずにその失敗を報告する。

対象2件の既存finallyはこのhookに一本化する。正常経路の明示closeも外し、ゲート解放後の `await starting` と既存アサーションを維持する。後始末のcloseエラーを成功扱いにしない。

| 失敗位置 | 後始末 |
| --- | --- |
| setup返却後、ゲート・起動前 | contextを閉じ、起動資源なしとしてdirを削除 |
| listen呼出し記録読取・捕捉検査・mock復元の例外 | hook所有状態に起動Promise・outcomeは保存済み。ゲート解放と必要なmock復元再試行後、outcomeからclose・削除し例外を報告 |
| ポート待機中 | mockは同期finallyで復元済み。ゲート解放後に起動outcomeを待ち、close・削除 |
| 復旧中APIのassert/fetch失敗 | ゲート解放→復旧完了→close→削除。未処理rejectを残さない |
| 起動reject | 待機がrejectを観測する。startServerの解放が完了した結果を確認し、待受なしで削除 |
| 復旧後のassert失敗 | 起動結果のclose完了後に削除 |
| ポート待機上限 | assert失敗後に同じhookを実行。単なるtimeout raceで後始末を省略しない |
| hookの起動待ち・close自体が停止 | テストrunnerと外側の期限で失敗を報告。終了保証の合格とはしない。DBディレクトリを先に削除しない |

5秒は既存の待機ヘルパー・AC17/18と揃える暫定上限であり実測値ではない。対象テストに `{ timeout: 15000 }` を付け、待受待機・AC13の既存3100ms待ち・終了に猶予を設ける。15秒も実挙動未確認の暫定値で、通常実行の所要時間を製造で記録する。過負荷で不足する場合は数値だけを勝手に増やさず統括へ根拠を返す。

本変更は制御可能な復旧ゲートと既存起動契約の範囲で終了を保証する。イベントループの永久停止や `startServer` 内の任意箇所の永久停止をテスト側のraceだけで解放できるとは扱わない。setup内部が返却前に失敗する場合のdir所有権や、本番初期化の一般的な漏れ修正は範囲外。

## 同一ファイルの他テストの調査

| 対象 | 静的確認・対応 |
| --- | --- |
| AC12×3、AC10/§3.1、AC14×4、差し戻し1 | HTTPサーバーなし。try/finallyでcontext・dirを解放。runtime作成などtry前の例外余地はあるが、今回全面変更しない |
| AC15 | 3起動ともport:0。不正設定等のrejectを期待し、dirをfinallyで削除。再openしたDBもfinallyで閉じる |
| AC16 | HTTPなし。最初のrecover・assert等がtry前なので初期context残留の余地あり。今回のサーバー停止問題とは分け、後続に申し送る |
| AC17/18×2 | port:0。t.afterでゲート解放・close・fetch復元を先、dir削除を後に登録済み。正常closeも既に冪等。子プロセスのexecFileに明示timeoutがない点は後続へ申し送る |
| AC18×2（signal） | port:0、finallyでゲート解放・close・dir削除。起動はtry前、closeエラーを吸収する既存構造だが今回変更しない |

同一ファイルの乱数ポートは対象2件だけ。既存finallyを「存在しない」とは扱わない。調査結果は上表で受入対象とし、追加改修が必要なら統括の判断を受ける。

## 検証手順・受け入れ条件

以下は製造・検収で実行する。新規の恒久テストは追加せず、既存の検証内容を保つ。

対象ファイルの通常実行はリポジトリルートから次を使う。APIのtest scriptと同じpreloadを省略しない。

製造時に確認した検証環境条件に合わせ、ローカル実行ではREADMEに定める `NODE_ENV=production` を指定して共有設定を検証する。Git管理外のローカル設定は保持する。通常sandboxではHTTP待受が `EPERM` になるため、待受を伴う検証は正式な `require_escalated` で実行する。詳細・通常並列経路の確認方法は末尾の検証環境注記を参照する。

```bash
(cd apps/api && NODE_ENV=production node --import tsx --import ./tests/helpers/venueConfigPreload.ts --test --test-timeout=30000 tests/databaseRecoveryOrchestration.test.ts)
```

50回反復は同コマンドを逐次実行し、回番号・所要時間・終了コードを記録する。AC13の3100ms待ちを維持するため、待ち時間だけで少なくとも155秒を要する。50回は既存Issue #222と同水準の間欠失敗確認回数という設計値であり、失敗確率の統計的保証とはしない。

```bash
for run in {1..50}; do
  echo "反復 $run / 50"
  (cd apps/api && NODE_ENV=production node --import tsx --import ./tests/helpers/venueConfigPreload.ts --test --test-timeout=30000 tests/databaseRecoveryOrchestration.test.ts) || exit 1
done
```

意図的失敗は製造後の対象ファイルを一時退避して、対象テスト内のゲート解放前のassertだけを一時改変する。まず意味を変えないコメント挿入の対照実験で通常成功することを確認し、その後次を1件ずつ行う。変更前・復元後のファイルハッシュを照合し、元からあるpackage差分を含め他ファイルを復元対象にしない。

- F1（AC13）: delta取得後、既存 `release()` より前に `assert.fail('Issue #225 後始末検証 AC13')` を一時挿入する。
- F2（AC10/11/15）: running状態のAPI取得後、既存 `release()` より前に `assert.fail('Issue #225 後始末検証 AC10/11/15')` を一時挿入する。

各失敗実験は上のファイル全体を実行する。対象だけのname filterで他テストをスキップせず、後続テストも完走することを確認する。対象名と注入メッセージが失敗原因として出ること、他テストの成功、終了コード1、timeout・cancel・未処理rejectなしを必須とする。hook途中の一時ログで当該ポートの `listening === false` とdir削除後の不存在を記録し、ログ挿入も復元する。

外側の監視期限はファイル1回120秒、API全体600秒とする（暫定上限・実挙動未確認）。`timeout` がない環境ではPython標準の `subprocess.Popen(command, start_new_session=True)` と `wait(timeout=秒)` を用いる一時ラッパーで監視する。期限切れは当該PopenのプロセスグループだけをTERM→5秒待機→必要ならKILLし、124として記録する。`pkill`、別担当のサーバー終了、OS権限変更は行わない。外側の強制終了・runner timeoutで終了した実験は不合格であり、終了保証を実証したことにしない。ラッパーと実験バックアップは検証後に自分の一時物だけを削除する。

- [ ] AC1: `rg -n 'Math\.random|35000|34000' apps/api/tests/databaseRecoveryOrchestration.test.ts` が該当なし。対象2件はport:0で、ゲート解放前に取得した実ポートを全URLで使用する。差分レビューで既存assert・期待値・3100ms待ち・ゲート解放位置が維持されている。
- [ ] AC2: 対象2件でmock登録から復元までawaitなし、捕捉は1件、起動rejectの即時観測、追加listenerなし、単一t.afterでゲート解放→close完了確認→dir削除を確認する。setup返却直後にhook所有状態を作りhookを登録している。ヘルパーは同じ状態を受け、startServer返却直後にstarting/outcomeを保存してからcalls読取・復元へ進む。捕捉値もassert前に保存され、ヘルパーの正常returnに後始末が依存しない。
- [ ] AC3: コメントだけの対照実験が終了コード0。F1/F2は各1回、意図したassertで失敗し、後続テストが成功、終了コード1で120秒以内に自然終了する。timeout・cancel・未処理reject・`SQLITE_READONLY_DBMOVED` がなく、当該サーバー停止・dir削除を一時ログで確認する。各改変を復元したハッシュが製造後原本と一致する。
- [ ] AC4: 対象ファイル50回を全て終了コード0で完走する。各回の所要時間と成功件数を記録し、timeout・ポート衝突・DB削除順エラーなし。1回でも失敗・停止すれば不合格。
- [ ] AC5: ローカルでは `NODE_ENV=production` と正式な待受権限でAPI全件を、末尾記載の `--test-concurrency=1` を指定したCLIで600秒以内に正常終了・終了コード0にする。スキップせず全件の件数・所要時間を記録する。通常並列経路はCIの既存 `npm run test -w apps/api` が成功することで別途確認する。ローカルの同npmコマンドで生じた既存B18の失敗証跡は保持し、逐次成功だけで通常並列も成功したとは扱わない。`npm run lint`、`npm run typecheck`、`npm run format:check` が全て成功する。
- [ ] AC6: 同一ファイルの他テスト調査が上表と実コードに一致する。新たな問題が見つかった場合は、本件対象の資源残留か後続課題かを分類し統括へ報告する。
- [ ] AC7: 基点からのdiffと未追跡ファイルを確認し、本設計書と対象テスト以外の新規差分なし。既存package差分保持、スキップ・todo・無効化追加なし、公開起動契約・本番コード変更なし。

## 判断・後続への引き継ぎ

- 要ヒアリング事項: なし。捕捉方式・hook構成・反復回数は確定した要件の範囲内の内部設計であり、製造前に本設計案の承認を受ける。
- 先送り: 上表のtry前の初期化失敗、AC17/18子プロセスの期限、起動失敗時の一般的な資源解放の強化。今回の2件の検証が失敗する原因となる場合は自動的に範囲を広げず統括へ返す。
- 残留リスク: NodeのmockとExpressのlisten捕捉は実挙動未確認。型・捕捉件数・復元を製造で先に確認する。15秒・120秒・600秒の期限は実測に基づく保証値ではない。後始末自体が停止した場合は不合格として診断する。
- 実装承認後もGit管理領域の書込制約は別に解決が必要。権限迂回・OS権限変更をせず、統括が指定したブランチと正式な許可範囲で製造する。

## 製造時の検証環境注記・報告結果

以下は設計承認後に統括から受領した製造の実測報告である。上記の「実挙動未確認」は設計時点の記録であり、ここでは報告済みの確認と未完了の確認を分ける。今回の追記は検証環境の設定・記録であり、仕様・期待値・コード変更範囲は変更しない。追加のユーザー判断は要しない。

### 実行環境

- 通常sandboxでは `listen` が `EPERM` となる。HTTP待受を伴うテストには正式な `require_escalated` が必要であり、権限迂回・OS権限変更で回避しない。
- 現checkoutのGit管理外ローカル設定に追加会場があり、通常の実行環境では既存AC17/18・AC18の計4件が失敗した。これは今回の対象2件の期待値を変更する理由とはしない。
- [README](../../README.md) の設定仕様では `NODE_ENV=production` でローカル差分を読み込まない。この公式の実行環境設定を使い、ローカル設定を保持したまま共有設定に対する検証を行う。設定ファイル・テスト期待値・共通preloadの変更は行わない。

### 受領済みの結果

| 検証 | 統括から受領した結果 |
| --- | --- |
| 対象ファイル反復 | 全17件を50回実行し、全回成功 |
| F1・F2 | 各回pass 16 / fail 1 / cancel 0で自然終了。後始末確認・ハッシュによる原本復元確認とも成功 |
| API通常並列、`NODE_ENV=production npm run test -w apps/api` | 2回とも全796件中pass 795 / fail 1。既存 `nowcastApi.test.ts` のB18でmain子プロセスの起動ログ待ちが15秒のtimeoutになった。失敗証跡を保持する |
| B18単独、同実行環境 | 13.576秒で成功。並行負荷による間欠失敗の疑いはあるが、原因確定とはしない |
| API全件逐次 | 下記コマンドで追加確認中。追記時点では結果未確定であり、成功件数・終了コードは先に記入しない |
| CI通常並列 | 既存npmコマンドの成功確認が必要。追記時点では未結果 |

### API全件の追加確認

APIディレクトリで全ファイルを指定し、同じtsx・会場preloadを維持したままファイル間の並行負荷を外して確認する。外側の期限は600秒、実行環境はproduction、HTTP待受の正式権限を使用する。

```bash
(cd apps/api && NODE_ENV=production node --import tsx --import ./tests/helpers/venueConfigPreload.ts --test --test-concurrency=1 tests/*.test.ts)
```

この確認はname filter・skip・todoを使わず全件を実行する。逐次実行の結果と通常並列npmの失敗結果を併記し、既存失敗を消さない。通常並列経路はCIの元の `npm run test -w apps/api` の成功で確認し、これが未確認の間はAC5の全体を完了扱いにしない。CIの失敗も残る場合はB18の原因・Issue #225との関係を統括が判断し、本件担当がタイムアウト・期待値・スキップを変更して通さない。
