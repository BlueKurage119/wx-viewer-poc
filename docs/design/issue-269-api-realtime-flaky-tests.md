# Issue #269・#277・#280・#282 apps/api の実時間依存テストの安定化

## 状態と前提

- **行番号の版**: 本書の行番号は、特記がなければ main 版(3f073ae 時点)のものである。ブランチ版では #280・#282 の追加で行がずれる(例: #282 の「364行」は main 版で、ブランチでは387行付近)。製造では現行ファイルで再確認すること。

- 改訂中(検収差し戻し後の改訂、未承認)。設計担当: Claude(Opus)。設計の基点は main(3f073ae)。
- 2026-10-18 改訂の経緯: 検収で AC-1・AC-6・AC-11 が未達。オーナーが差し戻しの直し方を確定した(根拠はオーナーの言葉「すべて推奨案で問題ありません。」)。反映先は「[差し戻し後の範囲](#差し戻し後の範囲2026-10-18)」と各節の【確定】(2026-10-18 差し戻し)。
- Issue は #269(B18)・#277(workerScopeRead)・#280(deliveryRealMissBarrier)・#282(workerDecisions)の4件を別々のまま扱い、PR は1本にまとめる。
- オーナーの確定事項(ヒアリング済み):
  1. Issue は4件とも別々、PR は1本。設計書の構成は設計担当に任せる。
  2. 範囲は4件すべて。
  3. 遅延を注入して失敗を確実に再現させ、そのうえで実時間の期限や固定の待ちを「状態の変化を待つ形」または「時計の注入」に置き換える。**期限を延ばすだけの対処・リトライ・スキップは禁止**。テストの検証力を落とさない。
  4. 受け入れ条件: 遅延注入下で「直す前は落ち、直した後は通る」(必須)／単独30回・全体5回・負荷をかけた単独10回で失敗0／本番コードをわざと壊してテストが落ちる／製造の最初に遅延注入下の修正前失敗率を測る。
- 統括の実測(main 221427b、12コア): 4件とも単独20回・`yes` 24本負荷の単独20回で失敗0、全体5回で1192件すべて合格(99〜115秒)。**自然な状態では再現しないため、「N回流して失敗0」だけでは修正の有無を判別できない**。遅延注入による前後比較を判定の主軸とする。
- 測定の基点(221427b)と設計の基点(3f073ae)の差: `git diff 221427b 3f073ae --stat` で確認した変更は `.prettierignore` と `docs/rules/**`(6ファイル)だけで、`apps/api/**` に差分は無い。統括の実測は本設計の基点にそのまま当てはまる。
- 変更してよい範囲: `apps/api/tests/**`(fixture・helper を含む)。`apps/api/src/**` は原則変更しない。例外は #280 の案A(【確定】2026-10-18)と、#282 で `node:test` の `mock.timers` が Worker 内で使えなかった場合の最小の時計注入(後述)だけ。`config/**`・`package.json` は変更しない。

## 差し戻し後の範囲(2026-10-18)

- 合格済みでそのまま使うもの(作り直さない):
  - 6ae3684 設計書
  - 2f16349 B18
  - 3b18645 #280(index 0 送信前のチェックと 280-frame の作り直し)。**ただし作り直しのときに足した「280-frame: 送信枠が埋まりません」の5秒の判定は外す**
  - b3eef8a main の取り込み
- 直すもの:
  1. #277 の原因記録(「#277」節・AC-11)
  2. #282: `282-run` の注入位置、注入を対象テストだけに効かせる作り(「#282」節)
  3. #280 の対象テストに残る実時間判定(「#280」節「対象テストの実時間判定の撤去」)
  4. `weatherTransport.test.ts` 追加テストの固定待ち(「#280」節)
  5. 実測記録(AGY が書いた数値の削除)
- 製造は wxviewer-builder(サブエージェント)が行う。検収は全項目をやり直す。
- PR では #277 を閉じない。PR 本文の `Closes` には #269・#280・#282 だけを書き、#277 は `Refs #277` とする(【確定】2026-10-18 差し戻し)。

## 参照資料と調査結果

参照した資料: 各 Issue 本文とコメント(`gh issue view`)、`apps/api/tests/{nowcastApi,workerScopeRead,deliveryRealMissBarrier,workerDecisions}.test.ts`、`apps/api/tests/fixtures/worker/{publication,acquisition-tile-barrier}.ts`、`apps/api/tests/fixtures/acquisition-worker/decisions-fixture.mjs`(import 部のみ)、`apps/api/tests/helpers/fixtureServerMain.ts`、`apps/api/src/runtime/{weatherTransport,tileEnsureQueue,acquisitionWorker,acquisitionWorkerHost,workerDecisions}.ts`、`docs/design/issue-225-recovery-test-port-cleanup.md`(B18 の記録)、`docs/design/issue-183-polling-test-fake-timers.md`(書式・負荷のかけ方)、`docs/rules/02-design-protocol.md`。以下はすべて静的に読んだ結果で、実行して確かめたものは「実測」と書く。

### #269 B18(`nowcastApi.test.ts` 1262行)

- 子プロセス(`tests/helpers/fixtureServerMain.ts`)が `[api] listening on ...` を標準出力に出すまで、テスト内の `setTimeout(..., 15000)` で待つ。続けて `/api/monitoring/status` の `weatherRuntimes.delivery.lifecycle === 'ready'` を `Date.now() + 10000` の期限付きで20ms間隔に取りに行く。
- #225 の記録(`issue-225-recovery-test-port-cleanup.md` 156〜157行): 通常並列の全体実行で「起動ログ待ちが15秒の timeout」で失敗、単独でも13.576秒かかった。**単独で期限の9割を使っているため、負荷で15秒を超えるのが原因と強く推定する**(推測。13.6秒の内訳は未計測で、tsx の子プロセス起動・移行・Worker 起動のどこが重いかは不明)。
- 子プロセスの異常終了(`exit`)・`error` はすでに即時失敗として拾っている。

### #277(`workerScopeRead.test.ts`「実Workerの会場全体保存後未完了scope…」)

- 症状は「socket closed」(全体実行で1回)。`apps/api/src` に該当文言はない。**どの呼び出しで出たかは記録が無く、原因は未確定**。
- テスト内の実時間依存は3か所: (a) 監視 sample 保留の確認 `performance.now() + 5000`(163〜166行)、(b) sample 到着の確認 `+ 10_000` と20ms間隔(176〜187行)、(c) `exit` 時に `exitConfirmed` を10ms×200回(=約2秒)待つ(210〜212行)。fixture の `fixture.incomplete` は応答後 `setTimeout(() => process.exit(1), 100)`(`publication.ts` 81行)。
- 仮説(いずれも推測):
  - H1: HTTP keep-alive の競合。テストは `fetch` を同じ接続で繰り返し、(b)(c) の待ちの間に接続が遊ぶ。サーバー側が遊休接続を閉じた瞬間にクライアントが再利用すると、接続が閉じられたという種類のエラーになる(Node の http サーバー既定 keepAliveTimeout は5秒。`src` に keepAlive 設定は無いことを grep で確認)。ただし Node 組み込み `fetch`(undici)はクライアント側の遊休接続を既定で約4秒で手放す(推測。版ごとの既定値は未確認)。サーバーの5秒より先にクライアントが手放すので、**自然に起きる見込みは薄い**。H1 は優先度の低い仮説として扱う。
  - H2: (c) の2秒で `exitConfirmed` にならず、その後の状態検証が想定外の経路に入る(この場合の素直な症状は `false !== true` なので、socket closed とは合いにくい)。
  - H3: 取得Worker の `process.exit(1)` の時機が、後続の HTTP 処理中の提供側と重なる(根拠は弱い)。

### #280(`deliveryRealMissBarrier.test.ts`、490行 `tileFetches` が 8)

- `pendingRequests` は**親スレッド側** `WeatherTransport` の `pending.size`(`acquisitionWorkerHost.ts` 132行)。`call()` は `pending.set` の後で `void this.send(...)` を呼ぶ。`send()` は frame ごとに `acquireFrameSlot` を待ち(lane あたり未 ack は `WEATHER_LIMITS.unackedFrames = 2`)、**送信直前に要求がまだ有効か(`pending.has(id)`)を確かめない**(`weatherTransport.ts` 188〜230行)。
- 中断時(`onAbort`)は `pending` から即削除し、すぐ `cancel` を Worker へ送る。Worker 側の `onCancel` は `tileRequests.get(id)?.abort()` だけで(`acquisitionWorker.ts` 173行)、**まだ受け取っていない id への cancel は記録されず捨てられる**。
- したがって次の順序が成立しうる: tile(9) の call frame が frame slot 待ちで未送信 → テストが `pendingRequests` 5 を見て中断 → cancel が先に Worker に届き捨てられる → 後から call frame が届き、tile(9) が Worker の `TileEnsureQueue` に積まれる → `release-all` で先行4件が終わると tile(9) が開始し上流取得 → `tileFetches` 8。
- これは**製品コードの競合(中断の取りこぼし)である可能性が高い**が、frame slot が実際に詰まっていたか(tile.ensure がどの lane か、その時点の未 ack 数)は実測していない(推測)。テストの「`pendingRequests` が減った = Worker が中断を受け取った」という前提は、上記の通り成立しない。
- 加えて 489行の `setTimeout(100)` は「100ms のうちに余計な取得が起きないこと」を見る固定の待ちで、遅い環境では余計な取得を見逃す(検証力の穴)。

### #282(`workerDecisions.test.ts` 364行)

- テストは親スレッドで `expires = Date.now() + 150` を決め、`fixture.pause` を Worker へ送る。Worker 側 `pause()` は `enqueue` の中で `remaining = Date.parse(expiresAt) - Date.now()` を計算し、`remaining <= 0` なら `deadline_exceeded`(`workerDecisions.ts` 112〜113行)。**往復と待ち行列に150ms以上かかると、期限内のはずの2回目の pause が `deadline_exceeded` で拒否される**。Issue の症状(期待外の箇所での `deadline_exceeded`)と一致する(原因はほぼ確定と考えるが、実測での確認は製造の最初に行う)。
- 同じテストの `await delay(50)` 後の `commits()` が `[]` であることも、50ms の間に150ms 期限が切れれば崩れる(第2の実時間依存)。

## 変更内容

### 共通: 遅延注入の仕組み

- 環境変数 `WX_TEST_INJECT_DELAY` で注入点を選ぶ。値はカンマ区切りの注入名(下表)。**未設定時は一切の挙動を変えない**。注入コードは `apps/api/tests/**` にだけ置き、コミットに含める(検収担当が同じ注入を再実行するため)。【確定】2026-10-18(要ヒアリング1、オーナー判断)
- 注入は「本来の待ち合わせが無いと壊れる時間差」を作るものに限る。修正後のテストは、同じ注入を入れたまま合格しなければならない。
- **遅延量の規則**: 遅延は「旧期限(または固定待ち)の3倍以上、かつ安全網の `node:test` timeout(【確定】120000ms)未満」とする。期限を延ばしただけの修正(例: 15秒→30秒)では同じ注入の下で落ちるようにするため。安全網の値が案より小さく決まった場合は、遅延量をこの規則で決め直す。
- **注入の待ちは必ず実時計で行う**。`mock.timers` を有効にする場所(#282 の `decisions-fixture.mjs`)では、`mock.timers.enable` を呼ぶ**前に** `globalThis.setTimeout` を別名に退避し、注入の待ちはその退避した本物の `setTimeout` で行う。偽時計で待つと `advance` するまで注入が終わらず、注入の意味が変わる(ハングまたは無注入と同じになる)。
- **注入は transport の ack・handshake の期限(各 frame 5000ms。`weatherTransport.ts` 210〜218行で `handshake_timeout` → `failure()`)に掛からない場所に置く**。Worker と親の間の message 配送そのものを5秒以上遅らせると lifecycle が `failed` になり、修正後のテストも落ちるうえ、修正前の失敗理由も期限切れではなくなる。message 配送を遅らせてよいのは `280-frame`(1000ms。5000ms 未満)だけ。

| 注入名 | 置き場所 | 内容 | 再現する失敗(Issue と症状が一致するか) |
| --- | --- | --- | --- |
| `b18-start` | `tests/helpers/fixtureServerMain.ts` | `startWorkerServer` 呼び出し前に45秒待つ(旧期限15秒の3倍) | 起動ログ待ち15秒の timeout(一致) |
| `b18-ready` | 子プロセス用 preload(`tests/helpers/` に新設) | 提供Worker の `ready` への遷移を30秒遅らせる(旧期限10秒の3倍)。**transport の外で遅らせる**: 例として preload で `DeliveryWorkerHost.prototype.connectReader` を包み、元の処理(transport の `reader.connect` 呼び出し)を始める前に30秒待つ。`listening` の出力より前に効く場所だった場合や、別の期限(`authorizeUntil` 等)に掛かる場合は場所を変える。製造の手順2で、失敗理由が「ready 待ち10秒の期限切れ」であり、子プロセス出力に `handshake_timeout`・`initialization_failed` が無いことを確かめる | ready 待ち10秒の失敗(一致) |
| `277-idle` | `workerScopeRead.test.ts` | (b)(c) の各待ちの直後、次の `fetch` の前に「サーバーの keepAliveTimeout 付近(5000ms 前後を数点)」待つ | H1 の検証用(仮説確認。症状一致は製造で確かめる) |
| `277-exit` | `tests/fixtures/worker/publication.ts` | `process.exit(1)` までを100ms→8000msに延ばす(旧待ち2秒の4倍) | (c) の2秒待ちの失敗(H2 の仮説確認。素直な症状は `false !== true` で Issue の socket closed と**一致しない**) |
| `280-frame` | `deliveryRealMissBarrier.test.ts` の `onAcquisitionWorkerCreated` | 取得Worker から親への `ack` を一時的に保留し、payload の送信枠(未ack 2frame)を埋める。tile(5)〜(8) の要求の前に保留を始め、tile(9) の中断と `pendingRequests` の減少を確かめた後に解除する。保留する時間は ack 期限5000ms 未満 | `tileFetches` 8(一致)。修正なしでは9 |
| `282-pause` | `tests/fixtures/acquisition-worker/decisions-fixture.mjs` | `fixture.pause` を `decisions.pause` に渡す前に、退避した本物の `setTimeout` で600ms待つ(旧期限150ms の4倍)。対象テストだけに効かせる条件は「#282」節 | 2回目 pause の `deadline_exceeded`(一致) |
| `282-run` | 同上 | 【確定】2026-10-18(オーナー承認)。意味は「run を送るのを遅らせる。置き場所は `fixture.pause` の処理の中」。`fixture.pause` の `decisions.pause` が受理(resolve)したあと、テストへ応答する前に本物の `setTimeout` で600ms待つ。コード例: `const r = await decisions.pause(...); await realDelay(600); return r;`。`fixture.run` の受け取り時の現行の注入は削除する | `delay(50)` 後の `commits()` が `['east']`(同じテストの第2の実時間依存。Issue の症状とは別だが同じ原因系統) |

`280-frame` の作り方の根拠(2026-10-18 改訂): MessagePort は送った順に届けるため、すでに送った frame を後から送った `cancel` が追い越すことはない。そのため、送ったあとの frame の配送を遅らせる旧方式は、実際には起きない順序を作ってしまっていた(旧方式では修正の有無にかかわらず結果が揺れた)。最小の修正が防ぐ実際の競合は、送信枠の空きを待つあいだの中断である。新方式では、保留した ack が2件そろったこと(送信枠が埋まったこと)を確かめてから tile(9) を中断する。これにより tile(9) の index 0 は、必ず送信枠の空き待ちのあいだに中断される。

**AC-1/AC-2 の前後比較の対象**: 症状が Issue と一致する注入(`b18-start`・`b18-ready`・`280-frame`・`282-pause`)と、`282-run` を対象にする。#277 の注入は仮説確認用で、手順2で Issue と同じ症状(socket closed 系)を再現できた注入だけを比較の対象に加える。症状が違う注入(例: `277-exit` で `false !== true`)は仮説の棄却・採択の記録に使い、比較の対象にしない。

### #269 B18

- テスト内の `setTimeout(15000)` と `readyDeadline`(10秒)を削除する。
- 起動ログ待ち: 標準出力の `listening on` 一致で成功、子プロセスの `exit`・`error` で即失敗(現状通り)。
- ready 待ち: 20ms 間隔の取得は残してよいが、終了条件を状態で決める。`lifecycle === 'ready'` で成功、`lifecycle` が `failed`・`stopped` になった時点、または子プロセスが終了した時点で即失敗(出力を添える)。実時間の期限で失敗判定しない。
- ハング対策: テスト関数に `node:test` の `{ timeout: <値> }` を付ける。これは合否判定のための期限ではなく、子プロセスが状態を返さずに止まった場合の後始末用の安全網とする。値は120000ms とする(【確定】2026-10-18、要ヒアリング2、オーナー判断)。
- 製造の最初に、単独実行での13.6秒の内訳(startServer 部分・子プロセスの `listening` まで・ready まで)を `performance.now()` で一度だけ計測して記録する(コミットしない一時コード)。

### #277

**2026-10-18 差し戻しで確定した扱い(【確定】)**:

- テストの修正(取得Worker の `exit` イベント待ちへの置き換え、(a)(b)(c) の実時間の期限の撤去、安全網 `timeout: 120000`)は、現行の実装をそのまま残す。
- 原因の記録は「**未確定**。socket closed は再現できなかった(検収で `277-exit` を10回流し、10回とも `false !== true`、socket closed は0件)」とする。H2 の採択は取り下げる。
- PR で #277 を閉じない(`Closes` に含めず `Refs #277`)。
- 以下の手順1〜3は初回製造時の計画の記録として残す。今回の製造では実行しない。

1. 現行テストで失敗時のエラー全体(`cause` 連鎖を含む)が出るよう、一時的に `fetch` を包んで記録する(コミットしない)。
2. `277-idle` を入れて単独10回実行し、失敗の有無とエラー全体を記録する。`277-exit` も同様に10回。
3. 判定と修正:
   - H1 で再現した場合: テストの `fetch` が遊休接続を再利用しないようにする。まず、追加の依存を入れずにテストだけで済む方法を試す: 各 `fetch` の応答本文を必ず読み切り、そのうえでテストから `startServer` の戻り値の HTTP サーバーに `keepAliveTimeout` を設定できるか確かめる。テストからの設定で済まない場合は、止めて統括へ報告する(`undici` の dispatcher を差し替える案は依存の追加になるため、製造の判断では採らない)。本番コードの keep-alive 設定変更が必要なら【未確定】として統括へ返す。
   - H2 で再現した場合: (c) を `onAcquisitionWorkerCreated` で受け取った取得Worker の `exit` イベント待ち(`once(worker, 'exit')`)に置き換え、その後 `exitConfirmed === true` を検証する。
   - どちらでも再現しない場合: 他の仮説を自分で立てて修正せず、記録を付けて統括へ報告し止まる。
4. 原因に関わらず、(a)(b) の実時間期限は状態待ちに置き換える。(a) は `queuedSample` が設定された時点で resolve する Promise を待つ。(b) は条件を満たすまで取得を続け、失敗判定は「提供Worker が `failed`」等の状態で行う。ハング対策は B18 と同じく `node:test` の `timeout` を安全網として付ける(値は120000ms)。

### #280

- テスト側(製品側の判断に関係なく行う):
  - 489行の `setTimeout(100)` を削除し、**番兵要求**に置き換える。`release-all` 後に、まだ取得していない座標の tile を1件要求し、その応答を待ってから `tileFetches` を検証する。`TileEnsureQueue` の待ち行列は FIFO なので、tile(9) が積まれていれば番兵より先に開始する。期待値は「7 + 番兵1 = 8」で、tile(9) が取得されれば9になる。`acquisition-tile-barrier.ts` の正規表現(`/10/([2-9])/`)は番兵の座標を受け付けるよう広げる。550行・562行の期待値も番兵分を足して合わせる。
- 製品側の競合への対応は**案A に【確定】**(2026-10-18、要ヒアリング3)。根拠はオーナーの回答「とりあえず推奨案でいいですが、実際は直接取得にするか、プロキシモードなら誰かが使うかもしれないので、そこまで頑張る必要はないのかなという感想です。」。この感想に沿い、**実装は最小にとどめる**: 範囲は `send()` で最初の frame を送る直前に中断済みを確かめる処理と、下記の単体テスト2件まで。範囲を広げる必要が出たら止めて統括へ報告する。検討した選択肢(記録):

| 案 | 内容 | 長所 | 短所 |
| --- | --- | --- | --- |
| A | `WeatherTransport.send()` で、`call` の最初の frame(index 0)を送る直前に `pending.has(id)` を確かめ、中断済みなら1 frame も送らない(`src/runtime/weatherTransport.ts`) | 親側1か所の数行。中断済み要求が Worker に届かない。テストは `280-frame` 下でも7(+番兵)で通る | 送信途中の中断は下記の扱いが要る。全 method に効くため影響範囲の確認が要る |
| B | Worker 側で、未受信 id への cancel を上限付きで記録し、後から届いた call を即中断する(`acquisitionWorker.ts`/`weatherTransport.ts`) | 送信途中の中断も含めて取りこぼさない | 記録の上限・期限の設計が要る。変更量が A より多い |
| C | 製品は変えない。テストが tile(9) の call frame が**実際に Worker へ配送された**(注入の遅延の後の、本物の `postMessage` の呼び出し)ことを確かめてから中断する | 本番コード無変更 | 製品の取りこぼしを残したまま、テストが競合を避けるだけになる。実運用で中断済み要求が上流取得を1件余分に行いうる。`280-frame` 下での合格は製品の安全性を示さない |

- 送信途中で中断されたときの決まり(残りの frame を送り切ってから cancel を送る)は**実装しない**(【確定】2026-10-18)。理由: cancel を送るのは tile.ensure だけで、tile.ensure は frame 1つに収まるため、この経路は実際には通らない。また、オーナーの「そこまで頑張る必要はない」という判断による。中断時は従来どおり、すぐに `pending` から削除し、tile.ensure なら cancel を送る(Worker は、まだ受け取っていない id への cancel を捨てる)。
  - 検証: `tests/weatherTransport.test.ts` に単体テストを1件足す。frame slot が埋まり、index 0 が未送信のまま中断された要求は、frame を1つも送らない(cancel は従来どおり送ってよい)。
  - 固定待ちの撤去(2026-10-18 差し戻し、【確定】): 追加テストの最後の `setTimeout(50)` を削除し、**番兵要求**に置き換える。保留していた ack を解放し `blocker1`・`blocker2` を待ったあと、同じ lane で別の要求(例 `tile.ensure` の id 4)を送り、その応答を待つ。MessagePort は送った順に届け、送信枠は FIFO で空くので、中断した要求の frame が送られていれば番兵の frame より先に `receivedTypes` に記録される。判定は「中断後に送られた frame が番兵の1件だけ」とする(frame の要求 id で数える。フィールド名は `weatherTransport.ts` の frame 型に従う)。index 0 のチェックを外すと、中断した要求の frame が記録されて落ちる(AC-7)。

#### 対象テストの実時間判定の撤去(2026-10-18 差し戻し、【確定】)

対象は `deliveryRealMissBarrier.test.ts` の「実取得Workerのcache miss保留中も提供Workerの保存済みtileとtextが進む」。安全網はテスト関数の `timeout: 120000` だけにする。

| 箇所(現行の行) | 現行 | 置き換え |
| --- | --- | --- |
| 426 | `Promise.race` で5000ms 後に `ensure未到達` で reject | `await waitingForEnsure` だけにする |
| 468・479・485・494・501・512・589 | `performance.now() - X > 5000` で throw | 判定を外し、条件が満たされるまで10ms間隔で取得を続ける(状態待ち) |
| 505〜506 | 「280-frame: 送信枠が埋まりません」の5秒判定(3b18645 で追加) | 判定を外す。`heldAcks.length >= 2` まで待つだけにする |
| 473 | tile(3) の応答が30000ms 未満 | 下記 |
| 584・596 | 停止中・異常終了後の miss の応答が30000ms 未満 | 下記 |

`< 30000` の判定が検証していること(コードで確認): 提供側の `ensureTile` は `timeoutMs ?? 30000` で取得Worker に `tile.ensure` を送る(`startWorkerServer.ts` 198行)。提供Worker の要求期限は `Math.min(5000, timeoutMs)` で頭打ちになる(`deliveryWorkerHost.ts` 277行)。したがって `< 30000` は「miss の応答が、既定の30秒の取得期限まで待たされず、短い期限または即時の拒否で返る」ことを確かめている。473 は保留中の取得に対する期限切れ、584・596 は停止中・異常終了後に上流取得せず即座に有限の失敗を返すこと(テスト名の「有限503」に対応)。

置き換え方(検証力を落とさない): 経過時間ではなく、**どの経路で失敗したかを応答の内容で確かめる**。

- 473・584・596 とも、`status >= 400` を具体的な status 値の一致に強め、応答本文のエラー種別(提供側が返すエラーコード・理由の文字列)も一致を確かめる。期待値は、製造担当が現行コードと1回の実行で確かめた値を使い、実測記録に書く。期待値は「短い期限で切れた」「停止中で拒否した」「Worker 不在で拒否した」を区別できるものにする。区別できる値が応答に無い場合は、止めて統括へ報告する(本番コードは変えない)。
- 584・596 は加えて、応答を待つ前後で `tileFetches` が増えないこと(現行どおり)と、`server.acquisitionHost.status().pendingRequests` が応答後に0へ戻っていることを確かめる。
- 30秒待たされる不具合は、上記の経路の一致が崩れるか、安全網の120000ms で落ちる。

撤去の対象外として残すもの(【確定】B2、2026-10-18、オーナー承認): 446行の `duration < 2000` と `measure()` の `values.at(-1) < bound` は、「cache miss 保留中・停止中でも保存済み tile・text が所定の時間内に返る」という性能の要求そのものを検証しており、待ちの期限ではない。431行の `delay(50)` 後の `tileFetches === 1`(同じ tile への合流要求が上流取得を増やさないこと)は固定待ちの後の否定検証だが、オーナーの指示の対象(`>5000`・`<30000`)に含まれない。今回は両方とも変えない。431行の `delay(50)` の後の判定を例外として残す理由は AC-6 に書く。
- 案C を採る場合の合格条件: AC-2 の `280-frame` 下で、番兵込みの期待値8で合格すること(tile(9) の call が先に Worker に届き、その後の cancel で `cancelQueued` されるため。中断前の待ちが「ラップ前の呼び出し」を見ていると注入の遅延中に中断してしまい9になるので、本物の `postMessage` の呼び出しを待つこと)。AC-8 の「製品修正を外すと落ちる」は案C には適用せず、代わりに中断済み要求の取りこぼしを製品の既知事項として別Issue化を統括に提案する(後続への引き継ぎ)。
- 設計担当の推奨は A(最小で原因に直接効く)で、オーナー判断により A に確定した。

### 本番コードを変える場合の挙動保証(#280 案A/B、#282 第4引数)

目視以外の保証として、次をすべて満たすことを AC-13 で確かめる。

- 既存テストを書き換えずに合格させる: `tests/weatherTransport.test.ts`(256KiB の frame 化と8MiB 境界、HTTP中断での待機枠解放、tile.ensure 期限での取消 frame、未ack 2 frame と停止制御の独立枠)、`tests/weatherStopTransport.test.ts`、`tests/workerDecisions.test.ts`、`tests/deliveryRealMissBarrier.test.ts` の対象外テスト。これらが transport の送信・中断・期限と decisions の既定挙動を守っている。既存テストの期待値の変更は不可(#280・#282 の対象テストの書き換えを除く)。
- #282 第4引数: 本番の呼び出し `createAcquisitionRuntime.ts` に差分が無いことを `git diff main... -- apps/api/src/runtime/createAcquisitionRuntime.ts` が空であることで確かめる。また `workerDecisions.test.ts` のうち、第4引数を渡さない(既定の実時計を使う)テストが少なくとも1件残り合格していること。
- 案A/B: 追加した単体テスト(上記)と、AC-7 の「製品修正を外すと `280-frame` 下で落ちる」で、変更が意図した経路にだけ効くことを確かめる。

### #282

- 期限を実時間から切り離す。第一案は**Worker fixture 内で `node:test` の `mock.timers` を有効にする**(`decisions-fixture.mjs` 内で `mock.timers.enable({ apis: ['Date', 'setTimeout'], now: <固定時刻> })`)。本番コードは変えない。テストは `fixture.clock.advance`(fixture に新設する制御メソッド。`mock.timers.tick(ms)` を呼んで応答する)で時計を進める。
  - Worker 内での `mock.timers` 動作、および transport の ack・handshake 用 `setTimeout`(5000ms)まで偽物になる影響は**実挙動未確認**。進める量は最大150ms なので5000ms のタイマーは発火しない想定。
  - `mock.timers` が Worker 内で使えない、または transport を壊す場合の代替: `createWorkerDecisions(epoch, checkpoint, transport, clock?)` に省略可能な第4引数 `clock?: { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void }` を足す(既定は実時計。本番の呼び出し `createAcquisitionRuntime.ts` 81行は変更しない)。理由: 期限判定と期限タイマーは Worker スレッド内にあり、テストスレッドの偽タイマーが届かないため。この代替を採るときは統括へ報告する。
- テストの流れ(偽時計の時刻を T0 とする):
  1. 期限切れ pause(`2000-01-01`)が `deadline_exceeded` で拒否されることを検証(現状通り)。
  2. `expiresAt = T0 + 150` で pause → `{ revision: 0 }`。
  3. `fixture.run` を送り、Worker がそれを待ち行列に入れたことを既存の `fixture.latch` 機構(stage 名は新設、例 `run_enqueued`)で待つ。`delay(50)` は削除する。
  4. `advance(149)` → `commits()` が `[]`。
  5. `advance(1)` → 誤った token で `fixture.release` を呼び `{ released: true }`(期限失効で pause が解けたこと。期限処理を壊したときにハングせず落ちる)。
  6. `await following` → `commits()` が `['east']`。
#### `282-run` の位置(2026-10-18 差し戻し)

- オーナーの確定事項は「遅延を `runUpdate` の途中、要求が待ち行列に入ったあと・確定する前に入れ直す」。現行の位置(`fixture.run` 受け取り時、`runUpdate` の前の600ms)では、修正前の旧テストが落ちなかった(検収の実測 0/10)。
- **コードで確かめた結果、オーナーが確定した位置でも旧テストは落ちない**。旧テスト(main の同名テスト)の実時間に依存する合否判定は「`fixture.run` を送ってから `delay(50)` 後に `commits()` が `[]`」だけで、その後の `await following` と `Date.now() >= expires` には期限が無い。`runUpdate` の途中(待ち行列に入ったあと・`work()` の INSERT の前)に遅延を入れると、確定はさらに遅れるので、50ms 時点の `[]` はかえって確実に成り立つ。遅延はどこに入れても「確定を早める」ことはできない。
- 旧テストを落とすには、**テストが `fixture.run` を送る時刻を、Worker 側の pause の期限タイマー(実時間150ms)より後ろへずらす**必要がある。それができる位置は、pause の受理(`decisions.pause` の Promise が resolve。この時点で期限タイマーは動き始めている)から、テストへの応答までの間だけである。
  - 旧テスト: pause 受理 → 600ms 待つあいだに期限(150ms)が切れる → 応答後にテストが `fixture.run` を送る → 待ち行列は空なので、すぐに `update.begin` 往復と INSERT が済む → 50ms 後の `commits()` が `['east']` で落ちる。
  - 新テスト: Worker の `Date`・`setTimeout` は偽物で、実時間の600ms では期限タイマーが発火しない → pause は保たれたまま → 合格する。
- 【確定】(B1、2026-10-18、オーナー承認): `282-run` の遅延は、pause を受け付けたあと、テストへ応答する前に入れる(上記の位置)。遅延量は600ms(旧期限150msの4倍、遅延量の規則を満たす)。期限切れ pause(`2000-01-01`)は受理されず拒否されるので、この注入は掛からない。
- 前提と停止条件: 修正前の旧テストが10回中10回落ちるには、「`update.begin` の往復と INSERT が50ms以内に終わる」という前提が要る。AC-1 でこの前提が崩れて10回中10回に届かなかった場合は、注入の調整などの回避策を入れず、製造を止めて報告する。

#### 注入を対象テストだけに効かせる(2026-10-18 差し戻し)

- 現状は `282-pause`・`282-run` を入れたまま `workerDecisions.test.ts` 全体を流すと、対象外の FIFO テスト(「実Workerのpauseは先行更新後のrevision…」、355行付近)が毎回落ちる。テスト名で絞る手順では済ませない(【確定】)。
- 作り: fixture の `fixture.pause` 処理で、`WX_TEST_INJECT_DELAY` が該当の注入名を含み、**かつ** `remaining = Date.parse(value.expiresAt) - Date.now()`(Worker 内の時計で計算)が `0 < remaining <= 1000` のときだけ注入する。
  - 対象テストの pause は旧テスト・新テストとも残り150ms(新テストは偽時計の T0 基準でも150ms)なので掛かる。
  - FIFO テストの pause は残り3000ms なので掛からない。期限切れ pause は残りが負なので掛からない。
  - `fixture.run` には注入を置かない(`282-run` を pause 側へ移すため)。
- 判定の確認(AC-2 に含める): 各注入を入れた状態で `workerDecisions.test.ts` をファイル全体で単独10回流し、全件合格すること。

- 注入 `282-pause`・`282-run` を入れても、偽時計は実時間で進まないので合格する。注入の600ms は `mock.timers.enable` 前に退避した本物の `setTimeout` で待つ(共通の規則)。第4引数の代替を採った場合は fixture が注入する時計だけが偽物になり、注入の待ちは素の `setTimeout` のままでよい。

## 製造の手順

初回製造(6ae3684〜b3eef8a)は済んでいる。以下は 2026-10-18 差し戻し後の手順。ブランチ `test/issue-269-api-realtime-flaky-tests` はチェックアウト済み。

1. 実測記録の整理: 「実測記録」節の「再測定待ち」の欄は、この手順で builder が実測したものだけで埋める。AGY が書いた数値を復元・流用しない。
2. #282:
   1. `282-run` の位置が統括経由で確定していることを依頼文で確かめる。確定していなければ `282-run` には着手せず、他の手順を進めて報告で止まる。
   2. 注入を「#282」節の作り(`fixture.pause` だけに置き、残り時間 `0 < remaining <= 1000` のときだけ効く)に直す。`fixture.run` の注入は削除する。
   3. 修正前の失敗率: 対象テスト本体だけを main の版に戻した一時状態(コミットしない)で、`282-pause`・`282-run` をそれぞれ入れて単独10回。10/10失敗と失敗理由を記録する。戻した後、現行の新テストで同じ注入下の単独10回を記録する。
   4. 各注入を入れたまま `workerDecisions.test.ts` をファイル全体で10回流し、全件合格を記録する(FIFO テストが落ちないこと)。
3. #280:
   1. 対象テストの実時間判定を「対象テストの実時間判定の撤去」の表のとおり直す。`< 30000` の置き換えに使う status・エラー種別は、現行コードで1回流して確かめた値を使い、実測記録に書く。
   2. `weatherTransport.test.ts` の追加テストの50ms待ちを番兵要求に置き換える。
4. #277: コードは変えない。実測記録の原因欄が「未確定」の記述になっていることを確かめる(AC-11)。
5. 受け入れ条件をすべて実行し、実測記録へ書く(追記は製造担当に許可する)。
6. コミットは直す対象ごとに分ける(#282、#280、設計書の実測記録)。

## 実行コマンド

単独実行(`apps/api` で):

```bash
node --import tsx --import ./tests/helpers/venueConfigPreload.ts --test \
  --test-name-pattern="<テスト名の一部>" tests/<ファイル>.test.ts
```

負荷: `issue-183` 設計書の「負荷のかけ方」と同じく `yes > /dev/null` を論理コア数の2倍(12コアなら24本)起動し、終了後に必ず停止する。全体実行は `npm run test -w apps/api`。`npm run build`・`npm run dev` は使わない。テストはポート0を使う。


## 受け入れ条件

各項目で、対象4件は「B18」「#277」「#280」「#282」と呼ぶ。検収は全項目をやり直す。実測値は今回の builder・inspector が測ったものだけを使う。

- [ ] AC-1 修正前の失敗率: 実測記録に、修正前の状態で各注入を単独10回ずつ実行した結果(失敗回数とエラー概要)がある。前後比較の対象の注入(`b18-start`・`b18-ready`・`280-frame`・`282-pause`・`282-run`)は10回中10回失敗し、失敗理由が表の「再現する失敗」と一致している。修正前の状態は、B18・#282 は対象テスト本体を main の版に戻した一時状態、#280 は index 0 のチェックを外した状態とする。`282-run` は、旧テストの `delay(50)` 後の `commits()` の検証で落ちていること。各注入の遅延量が遅延量の規則(旧期限の3倍以上、安全網 timeout 未満)を満たし、記録した遅延量がコードの値と一致している。
- [ ] AC-2 修正後の合格: 比較の対象の各注入を入れて、該当テストを単独10回実行し、すべて合格。加えて、`282-pause`・`282-run` をそれぞれ入れたまま `workerDecisions.test.ts` をファイル全体で10回実行し、全件合格(対象外の FIFO テストを含む)。注入名ごとの結果を記録する。
- [ ] AC-3 自然状態の単独: 注入なしで対象4件をそれぞれ単独30回実行し、失敗0。
- [ ] AC-4 負荷下の単独: `yes` を論理コア数の2倍起動した状態で、対象4件をそれぞれ単独10回実行し、失敗0。446行の `duration` と `measure` で測った時間の最大値を記録に残す(B2)。
- [ ] AC-5 全体実行: `npm run test -w apps/api` を5回実行し、毎回失敗0(会場ローカル設定依存の既存失敗がある場合はテスト名で照合し、対象4件と新規の失敗が0であること)。件数と所要時間を記録する。446行の `duration` と `measure` で測った時間の最大値も記録に残す(B2)。
- [ ] AC-6 実時間の期限・固定待ちの撤去: 差分の目視で次を確かめる。期限値を延ばしただけの変更・リトライ・`skip`/`todo` が無い。
  - B18・#277・#282 の対象テスト本体に、合否判定に使う実時間の期限(`setTimeout(... reject ...)`、`Date.now()/performance.now()` との比較による失敗判定、固定待ちの後の否定検証)が無い。
  - #280 の対象テストに、`performance.now()` による `> 5000` の判定、`< 30000`(`< 30_000`)の判定、426行相当の5000ms の reject、「280-frame: 送信枠が埋まりません」の判定が無い。安全網はテスト関数の `timeout: 120000` だけ。`< 30000` の代わりに、status とエラー種別の一致の検証がある。446行の `duration < 2000`・`measure()` の上限・431行の `delay(50)` 後の `tileFetches === 1` は【確定】(B2)により例外として残す。理由: 遅くなっても見逃しの方向にしか働かず、誤って落ちることはない。オーナーの指示(`>5000`・`<30000`)の範囲外。446行の `duration < 2000`・`measure()` の上限も変えない。
  - `weatherTransport.test.ts` の追加テストに最後の固定待ち(`setTimeout(50)`)が無く、番兵要求の応答を待ってから frame を数えている。
- [ ] AC-7 検証力(本番コードをわざと壊す。各1回、終了後は元に戻し `git diff --stat apps/api/src` が意図した差分以外なし):
  - B18: `startWorkerServer` の先頭で例外を投げる → 子プロセス終了による失敗で即座に落ちる(安全網の timeout で落ちるのではない)。
  - #277: `acquisitionWorkerHost.ts` の `unknownScopes` から `workerGone ? pendingScopes : []` を除く → 落ちる。
  - #280: `tileEnsureQueue.ts` の `task.cancelQueued()` 呼び出しを除く → `tileFetches` の検証で落ちる。index 0 の前のチェックを除く → `280-frame` の下で10回中10回落ち(9件)、追加した単体テストも落ちる。
  - #280 追加: index 0 の前のチェックを除く → 番兵に置き換えた単体テストが落ちる(中断した要求の frame が記録される)。
  - #282: `workerDecisions.ts` の `remaining <= 0` 判定を除く → 期限切れ pause 拒否の検証で落ちる。期限タイマーの `release()` を除く → ハングせず約5秒で落ち、失敗理由が `handshake_timeout`(transport の call 期限切れ)であること(【確定】2026-10-18 差し戻し。期限で pause が解けないため後続の要求が応答を返さず、transport の5000ms の期限で切れる)。
- [ ] AC-8 #280 の製品判断: 確定した案A の通り(最小範囲。`send()` の index 0 の前のチェックだけ)に実装されている。`git diff origin/main -- apps/api/src` はそのチェックの数行だけ。`280-frame` の下で番兵込みの期待値で10回中10回合格し、チェックを外すと同じ注入の下で10回中10回落ちる。
- [ ] AC-9 注入の無害性: `WX_TEST_INJECT_DELAY` 未設定で、注入コードが何もしないことを差分の目視で確認する。注入コードが `apps/api/src/**` に無い。
- [ ] AC-10 `npm run lint`・`npm run typecheck`・`npm run format:check` が成功する。
- [ ] AC-11 #277 の原因記録: 実測記録の原因欄が「未確定。socket closed は再現できなかった(検収で `277-exit` を10回流し、10回とも `false !== true`、socket closed は0件)」になっている。H2 を採択した記述が残っていない。PR 本文で #277 が `Closes` に含まれず `Refs #277` になっている(検収担当が PR 作成時に確かめる)。
- [ ] AC-12 変更範囲: `git diff --stat main...` が `apps/api/tests/**` と本設計書(と、承認された場合の #280 製品修正・#282 代替の時計注入)だけ。
- [ ] AC-13 本番挙動の保証(本番コードを変えた場合のみ): 「本番コードを変える場合の挙動保証」の各項目を満たす。既存テストの期待値を変えていないことを `git diff main... -- apps/api/tests` で確かめる(対象テストと追加テストを除く)。

## 実挙動未確認の箇所

- B18 の13.6秒の内訳。
- #277 の socket closed の発生箇所と原因(未確定。再現できていない)。
- #280 で、自然な状態でも送信枠が実際に埋まるかは確かめていない。`280-frame` は送信枠が埋まった状況を作るもので、MessagePort の順序保証に反する状況は作らない。
- #280 の `< 30000` の置き換えで、応答の status・エラー種別が「短い期限」「停止中」「Worker 不在」を区別できるか(製造で1回流して確かめる)。
- `282-run` を pause 受理後・応答前に置いたとき、旧テストで `fixture.run` 送信から50ms以内に確定するか(静的には数ms と見込むが未計測)。
- Node 組み込み `fetch` のクライアント側 keep-alive の既定値(約4秒は推測)。

## 後続への引き継ぎ

- #277 は原因未確定のまま開いておく。テスト側の実時間依存は今回の PR で除いたので、再発したら失敗時のエラー全体(`cause` 連鎖)を Issue に記録する。
- 本設計の `WX_TEST_INJECT_DELAY` の方式は、他の不安定テストにも使える。
- `node:test` の `timeout` 安全網の値は全体で120000ms に揃える(【確定】)。

## 依頼文の雛形(製造担当向け、差し戻し後)

```
wx-viewer-poc の製造担当(wxviewer-builder)として、docs/design/issue-269-api-realtime-flaky-tests.md を唯一の仕様として、「差し戻し後の範囲」と「製造の手順」だけを実装してください。
ブランチ: test/issue-269-api-realtime-flaky-tests(チェックアウト済み。合格済みのコミットは作り直さない)
282-run の位置: <統括経由で確定した位置>
#280 の撤去対象外(446行・measure()・431行): <要ヒアリングの結果>
- 変更は apps/api/tests/** と設計書の実測記録だけ。apps/api/src は AC-7 の一時的な破壊以外で変えない。npm run build / npm run dev は使わない。背景エージェントは起動せず、このターン内で報告すること。
- 実測記録には自分で測った値だけを書くこと。
- コミットまで行い、push・PR 作成はしない。報告には各ACの結果、git diff --stat、コミット一覧を含めること。
```

## 実測記録

AGY が初回製造で書いた数値には、コードと食い違う誤りがあった(b18-start・b18-ready・282 の遅延量、282-run の修正前失敗率、277-exit の遅延量と症状、全体実行の件数)。それらは削除した。**「再測定待ち」の欄は、builder・inspector が実測したものだけを記録する。**

### 1. 自然状態(統括の実測、有効)

- main 221427b、12コア: 4件とも単独20回・`yes` 24本負荷の単独20回で失敗0、全体5回すべて合格(99〜115秒)。詳細は「状態と前提」。

### 2. B18 の時間内訳

- 再測定待ち(builder・inspector が実測したものだけを記録する)。

### 3. AC-1 修正前の失敗率(各注入10回)

| 注入名 | 注入遅延(コードの値) | 失敗回数 | 失敗理由 |
| --- | --- | --- | --- |
| `b18-start` | 再測定待ち | 再測定待ち | 再測定待ち |
| `b18-ready` | 再測定待ち | 再測定待ち | 再測定待ち |
| `280-frame` | ack 保留(送信枠を埋める) | 10 / 10(統括の実測、作り直し後) | index 0 のチェックを外すと `tileFetches` が9(期待8) |
| `282-pause` | 再測定待ち | 再測定待ち | 再測定待ち |
| `282-run` | 再測定待ち | 再測定待ち(旧位置では検収の実測で 0/10) | 再測定待ち |
| `277-exit` | 再測定待ち | 検収の実測: 10回とも `false !== true`(仮説確認用。比較の対象外) | socket closed は0件 |

### 4. AC-11 #277 の原因

- **未確定**。socket closed は再現できなかった(検収で `277-exit` を10回流し、10回とも `false !== true`、socket closed は0件)。H2 の採択は取り下げた。
- テスト側の修正(取得Worker の `exit` イベント待ち、実時間の期限の撤去)は残す。

### 5. AC-2 修正後の合格(各注入10回)

| 注入名 | 結果 |
| --- | --- |
| `b18-start` | 再測定待ち |
| `b18-ready` | 再測定待ち |
| `280-frame` | 10 / 10 合格(統括の実測、作り直し後) |
| `282-pause` | 再測定待ち |
| `282-run` | 再測定待ち |
| `282-pause`・`282-run` 入りのファイル全体 | 再測定待ち |

### 6. AC-3〜AC-5・AC-7

- 再測定待ち(builder・inspector が実測したものだけを記録する)。全体実行の件数は実際の出力の値を書く。
- AC-7 #280 の index 0 チェック: 外すと `280-frame` の下で10回中10回、`tileFetches` が9(期待8)で落ちる(統括の実測、作り直し後)。

### 7. 設計との差異・判断事項

- #280: 案A(最小範囲)を実装した。送信途中の中断の決まりは実装しない(案A の節を参照)。
- #282: 本番コードへの第4引数 `clock` は不要で、Worker fixture 内の `mock.timers` で成立した(`decisions-fixture.mjs` の `workerData.mockTimers`)。
