# Issue #183 jmaXmlPolling テストの実タイマー依存の解消

## 状態と前提

- 設計承認済み(2026-10-17)。設計担当: Claude(Opus)。
- 承認時のヒアリング結果:
  1. テスト10・22-3 も範囲に含めて置き換える。
  2. `advanceTime` の意味の変更が、`ManualTimerScheduler` を使う他のテスト(listener 再試行、23-8〜23-10)に及ぶことを許容する(テスト本体は書き換えず、全件パスで確かめる)。
  3. 22-9 が負荷条件で再現した場合は、そこで止めて報告し、別Issueに切り出す。
  4. 追加: `runScheduledOrRetryCycle` は `isRunning` が真のときだけ `finally` で次のタイマーを登録する。このため `advanceTime` の待ちは「次のタイマーが登録された」または「サービスが停止した(タイマーが登録されないまま取得処理が終わった)」のどちらかで終わるようにし、取得中に `stop()` する経路で5秒の上限に当たらないようにする。
- 代表Issueは #183。#277 の 23-3b・23-7、#269 の 22-9 を本設計で扱う。#179 は重複としてクローズ済み。
- 範囲外: #269 の B18(`nowcastApi`)、#277 の workerScopeRead、#280、#282。
- 変更するのは `apps/api/tests/jmaXmlPolling.test.ts` だけ。本番コード(`apps/api/src/**`)・`config/**`・`package.json` は変更しない。調べた結果、本番コードを変えなくても実現できる(後述)。
- ローカルの HTTP テストサーバー(`createTestHttpServer`)はそのまま使う。HTTP はモックにしない。
- 22-9 は再現条件の調査だけを行う。負荷条件で再現しなければ、記録を残して終わる(テストは書き換えない)。

## 参照資料と調査結果

参照した資料: `apps/api/tests/jmaXmlPolling.test.ts`、`apps/api/src/polling/jmaXmlPollingService.ts`、`docs/rules/02-design-protocol.md`、`docs/design/issue-226-polling-test-independence.md`(書式)、統括担当のヒアリング結果。

### 偽タイマーの実名

統括担当のメモにある `FakeTimerScheduler` は、実際のコードでは **`ManualTimerScheduler`**(3355行付近)という名前である。この名前で使っているのは 3414行以降の5箇所。`advanceTime` は、期限の来たタイマーを1つ動かすたびに `setImmediate` を1回待ち、続けて**実時間で20ms待つ**(3404〜3405行)。

### サービス側の性質(静的に読んで確かめた)

- `PollingTimerScheduler` は `setTimeout` と `clearTimeout` だけを持つインターフェースで、`timerScheduler` オプションで差し替えられる(50〜58行、167行)。
- タイマーのコールバックは `void this.runScheduledOrRetryCycle()` である(658〜664行)。このため Promise を受け取れず、HTTP 取得が終わる前に `advanceTime` から制御が戻る。**23-7 が間欠的に失敗する直接の原因はこれ**と判断した。20ms の間にローカル HTTP の往復と DB 書き込みが終わらないと、`requestCounts` や `phase` の検証が先に走ってしまう。
- `runScheduledOrRetryCycle` は、サービスが動いている限り **`finally` の中でだけ** `scheduleNextCycle()` を呼ぶ(744〜749行)。サイクルの途中(`pollFeeds` → `executePollCycle`)で呼ばれる `scheduleNextCycle` は、`start()` の中にしかない(516・520・570・589行)。なお、例外のときも `finally` を通る。
- 以上から、**サイクルが発火したあとに次のタイマーが登録されたら、そのサイクル(取得、`phase` の遷移、完了時の通知を含む)は終わっている**と判定できる。本設計はこれを「完了」の目印にする。
- `inFlightPollPromise` は、`runScheduledOrRetryCycle` が `phase` を更新するより先に `null` に戻る(361行の `finally` が先に走る)。このため、23-3b が使っている「`inFlightPollPromise` を await する」方式では、状態の遷移を待てない。
- `stop()` はタイマーを `clearTimeout` し、実行中のサイクルを待つ(752〜785行)。

### 実時間で待っている箇所の全数(同じ原因のもの)

| テスト | 行(付近) | 実時間への依存 | 扱い |
| --- | --- | --- | --- |
| 10. 複数回の start() と stop() 後 | 1094, 1118 | `intervalMs: 50`、stop 後に `setTimeout(150)` | 置き換える【設計案・要ヒアリング】 |
| 22-2 | 2488, 2525 | `intervalMs: 40`、`setTimeout(250)`、検証が `>= 2` | 置き換える |
| 22-3(部分失敗の3パターン) | 2607, 2634 | `intervalMs: 40`、`setTimeout(80)` | 置き換える【設計案・要ヒアリング】 |
| 22-6 | 2871, 2902 | `intervalMs: 40`、`setTimeout(250)`、検証が `>= 2` | 置き換える |
| `ManualTimerScheduler.advanceTime` | 3405 | タイマー1つごとに20ms待つ | 完了を待つ方式に置き換える(23-3b・23-7 などすべての利用箇所に効く) |
| 22-9 | 3120 | タイマー待ちはない。`startServer` と実際の HTTP を使う | 調査だけ |

このほか 992・3475行にも `setTimeout` があるが、これは HTTP ハンドラの応答遅延(タイムアウト分類のための意図的な遅延)であり、タイマーの完了待ちではない。対象外とする。

## 変更内容

### 1. `ManualTimerScheduler` の改修

シグネチャは次のとおり(既存のメソッドは名前も型も変えない)。

```ts
class ManualTimerScheduler implements PollingTimerScheduler {
  constructor(initialTimeMs?: number);
  getCurrentTimeMs(): number;
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
  advanceTime(ms: number): Promise<void>; // 意味を変える(後述)
  hasPendingTimers(): boolean;
}
```

`advanceTime` の新しい動き:

1. 期限の来たタイマーのうち、最も早いものを選ぶ(これまでどおり)。
2. コールバックを呼ぶ前に、登録の回数を数える変数(`registrationCount`)を控えておく。
3. コールバックを呼んだあと、**`setTimeout` がもう一度呼ばれるまで待つ**。`setTimeout` の中で、待っている側の Promise を resolve する。
   - 待つ時間には実時間の上限を設ける(例: 5,000ms)。上限を超えたら、`advanceTime: 発火したサイクルが次のタイマーを登録しませんでした` という趣旨のエラーで reject する。黙ってハングさせない。この上限は**失敗したときの保険**であって、合否の判定には使わない。
   - コールバックがその場で(同期的に)次のタイマーを登録したときは、待たずに先へ進む。
4. 次のタイマーが登録されたら、`setImmediate` で1回だけ待ってから、ループの先頭へ戻る。新しく登録されたタイマーも、`targetTimeMs` 以内であれば同じ `advanceTime` の中で発火させる(これまでどおり)。
5. 実時間で20ms待つ処理(`setTimeout(r, 20)`)は削除する。

前提: このスケジューラを渡したテストでは、タイマーが発火するのは、サービスが動いている間に `scheduleNextCycle` が登録したタイマーだけである。`stop()` するとタイマーは消えるので、停止後に `advanceTime` してもコールバックは呼ばれない。この前提が崩れる使い方(動いていないサービスのタイマーを発火させるなど)をした場合は、3 の上限エラーで気づける。

追加してよい補助メソッド(名前は製造担当に任せる):

- `pendingTimerCount(): number` — テスト10で、stop 後にタイマーが0件であることを確かめるため。

### 2. 各テストの置き換え

すべての置き換えで共通にすること:

- `new ManualTimerScheduler(new Date('2026-09-09T01:00:00.000Z').getTime())` を作り、`timerScheduler` に渡す。
- `clock` は `() => new Date(scheduler.getCurrentTimeMs()).toISOString()` にする。ただし、元のテストが検証している時刻の文字列(例: 22-2 の `startedAt`)は、表記まで同じになるようにする。元のテストの clock が `'...01:00:00Z'` のようにミリ秒のない書き方なら、その書き方での期待値が変わらないか製造時に確かめる。
- `intervalMs` は実運用に近い値(`60_000`)にする。
- 実時間で待っている `await new Promise((r) => setTimeout(r, N))` は、`await scheduler.advanceTime(...)` に置き換える。
- `>= 2` のような下限だけの検証は、**決まった値の完全一致**に強める。

| テスト | 置き換え後の手順と検証 |
| --- | --- |
| 22-2 | `start()` を await したら、その時点の件数がちょうど4フィード各1回であることを確かめる(既存)。`fakeNow` の書き換えはやめ、`advanceTime(60_000)` を1回行う。そのうえで regular=2・extra=2・regular_l=1・extra_l=1 が完全一致することを確かめてから `stop()` する。「長期フィードは1回のまま」という意図を強めるため、さらに `advanceTime(60_000)` を行い、regular=3・extra=3・長期フィードは1のまま、まで確かめてもよい(推奨) |
| 22-6 | 再 `start()` のあと、`advanceTime(60_000)` で regular=2・extra=2・regular_l=1・extra_l=1 の完全一致を確かめ、そのあと `stop()` する |
| 22-3 | `setTimeout(80)` を `advanceTime(60_000)` に置き換える。パターンごとに新しい scheduler を使う。失敗した長期フィードは再試行の待ち時間(60秒)に入るので、60秒進めると `failed` のフィードの再試行が発火しうる。そうなると「長期フィードは各1回のまま」という既存の検証と衝突するおそれがある。製造時は、まず変更前と同じ意味になる進め方(通常周期が1回だけ走り、再試行はまだ走らない時間)を実際に動かして決め、その根拠を設計書の「実測記録」に追記する |
| 10 | `stop()` のあと `pendingTimerCount() === 0` を確かめる。さらに `advanceTime(600_000)` を行い、regular の件数が stop 時点と同じであることを確かめる |
| 23-3b | 3箇所の `inFlightPollPromise` の await(と型の変換)を削除する。`advanceTime` が完了を待つので不要になる。直接 `runScheduledOrRetryCycle()` を呼んでいる箇所は await しているのでそのままでよい |
| 23-7 | テスト本体は変えない。`advanceTime` の改修だけで決定的になる |

`ManualTimerScheduler` を使っているほかのテスト(3414行の listener 再試行、23-8、23-9 など)は書き換えない。ただし `advanceTime` の意味が変わるので、全テストが通ることを受け入れ条件で確かめる。

### 3. 22-9 の調査(テストは変えない)

受け入れ条件 AC-3 と同じ負荷条件で、`--test-name-pattern "^22-9\. "` を付けて単独で30回流す。失敗したときは、TAP 出力の該当箇所(エラーメッセージとスタック)を保存する。

- **再現しなかったとき**: 「実施した条件・回数・失敗0」を、本設計書の末尾「22-9 調査記録」に追記して終わる。
- **再現したとき**: テストは書き換えない。記録を残し、原因の推定を製造報告に書いて統括担当の判断を待つ(要ヒアリング事項 Q3)。

## 負荷のかけ方(AC-3・失敗率の測定・22-9 で共通)

- 論理 CPU の数(`sysctl -n hw.ncpu`。Linux なら `nproc`)と同じ数だけ、`yes > /dev/null &` を起動してから計測する。
- 計測が終わったら、起動したプロセスの PID を控えておき、すべて `kill` する。`pgrep yes` が空になったことを確かめて記録する(マシンに負荷を残さない)。
- 計測ループの例(単独実行。cwd は `apps/api`):

```bash
node --import tsx --import ./tests/helpers/venueConfigPreload.ts --test tests/jmaXmlPolling.test.ts
```

 これを `for i in $(seq 30)` で回し、終了コードが 0 でない回の数と、失敗したテストの名前(TAP の `not ok` 行)を集計する。
- ログなどの一時ファイルは、作業ディレクトリの外(スクラッチ領域や `mktemp -d`)に置き、終わったら削除する。

## 製造の手順

1. **変更前の失敗率を測る**: 変更する前の `main` 相当のコードで、AC-1(単独30回)・AC-2(全体5回)・AC-3(負荷あり10回)と同じ条件の計測を行う。テストごとの失敗回数を、本設計書の末尾「実測記録」に追記する。ここで失敗0でも作業は続ける(比較のための記録にする)。
2. `ManualTimerScheduler` を改修し、23-3b・23-7 の対応を行う。
3. 22-2・22-6・22-3・テスト10を置き換える(22-3・テスト10を含めるかは要ヒアリング Q1 の回答に従う)。
4. AC-4 のわざと壊す確認を行う。終わったら必ず元に戻す。
5. AC-1〜AC-3 を変更後の状態で計測し、「実測記録」に追記する。
6. 22-9 を調査する。
7. lint・typecheck・format:check・apps/api のテストを流し、コミットする。

## 受け入れ条件

| ID | 実行すること | 合格の基準 |
| --- | --- | --- |
| AC-0 | 製造の最初に、変更前のコードで AC-1〜AC-3 と同じ計測を行い、設計書の「実測記録」に書く | テストごとの失敗回数(0回も含む)と、実行環境(CPU 数、負荷プロセス数)が記録されている |
| AC-1 | `apps/api` で上記の単独実行コマンドを30回続けて流す(負荷なし) | 30回とも終了コードが0 |
| AC-2 | リポジトリのルートで `npm run test -w apps/api` を5回流す | 5回とも、`jmaXmlPolling.test.ts` の中のテストに `not ok` が無い。対象外ファイル(#269 B18 など)が失敗したときは、そのテスト名を報告に書けば不合格にしない |
| AC-3 | 前節の負荷をかけた状態で単独実行を10回流し、終わったら負荷プロセスを止める | 10回とも終了コードが0。`pgrep yes` が空であることが記録されている |
| AC-4a | `ManualTimerScheduler` を使ったうえで、22-2 の検証に対して本番コードの `runScheduledOrRetryCycle` の `completed` の枝にある `targetFeeds` を一時的に `['regular']` に変える | 22-2・22-6 が落ちる(extra の件数が合わない) |
| AC-4b | 本番コードの `failed` の枝で、`readyFeeds` を一時的に `pendingFeeds` ではなく `INITIAL_FEED_KINDS` から作るように変える | 23-7 が落ちる(成功済みのフィードを再取得してしまう) |
| AC-4c | 本番コードの `scheduleNextCycle` で、`scheduledPollDueOnNextRun` を一時的に常に `true` にする | 23-3b が落ちる |
| AC-4d | 本番コードの `stop()` で、`clearTimeout` を一時的に呼ばないようにする | テスト10が落ちる(Q1 でテスト10を範囲に含めた場合) |
| AC-4e | 本番コードの `start()` の再 start の枝(`phase === 'completed'`)で、一時的に `pollFeeds('initial', INITIAL_FEED_KINDS)` を呼ぶようにする | 22-6 が落ちる(長期フィードの件数が合わない) |
| AC-4f | (22-3 を含める場合)初期取得が失敗したあとの周期で、一時的に `phase` を `completed` にする | 22-3 が落ちる |
| AC-4 共通 | AC-4a〜f が終わったら `git diff --stat apps/api/src` を実行する | 差分なし(元に戻されている)。それぞれの壊し方と、落ちたテスト名が報告に書かれている |
| AC-5 | `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api` を流す | すべて終了コード0(AC-2 と同じく、対象外ファイルの既知の間欠失敗は名前を書けば許す) |
| AC-6 | `git diff --stat main...HEAD` を実行する | 変更されたのは `apps/api/tests/jmaXmlPolling.test.ts` と本設計書(実測記録の追記)だけ。`apps/api/src/**`・`config/**`・`package.json` に差分が無い |
| AC-7 | `grep -nE "setTimeout\(r(esolve)?, *[0-9]+\)" apps/api/tests/jmaXmlPolling.test.ts` を実行する | 待つための実時間の `setTimeout` が残っていない(HTTP ハンドラの応答遅延 992・3475行付近は残ってよい) |
| AC-8 | 22-9 の調査結果を、本設計書の「22-9 調査記録」で確かめる | 条件・回数・結果が書かれている。22-9 のテスト本体に差分が無い |

AC-4 は、壊した箇所が目的のテストで本当に落ちることを確かめるためのものである。壊し方の具体的な行は製造時に合わせてよい。ただし「どこを・どう壊し・どのテストが落ちたか」は必ず記録する。

## 実挙動未確認の箇所

- 23-7 が落ちる原因(20ms の間に取得が終わらない)は、コードを読んで推定したものである。変更前の失敗を実際に再現して確かめたわけではない。AC-0 で確かめる。
- 「次のタイマーが登録されたらサイクルは終わっている」という判定は、`runScheduledOrRetryCycle` を静的に読んで導いた。`ManualTimerScheduler` を使うほかのテスト(listener 再試行、23-8、23-9、23-10)が新しい `advanceTime` でも通るかは、まだ動かしていない。
- 22-3 で何秒進めれば元の意味と同じになるか(通常周期だけが走り、再試行は走らない時間)は、まだ決まっていない。製造時に実際に動かして決める。
- 負荷をかけたときの失敗率は、まだ一度も測っていない。

## 後続への引き継ぎ

- #269 B18(`nowcastApi`)、#277 workerScopeRead、#280、#282 は別の Issue で扱う。それらでも同じ種類の実時間待ちが見つかったら、本設計の「次のタイマーの登録を完了の目印にする」方式を参考にしてよい。ただし、対象の本番コードでも `finally` の中でだけ次のタイマーを登録しているかを、先に確かめること。
- `ManualTimerScheduler` は今は `jmaXmlPolling.test.ts` の中だけにある。ほかのファイルからも使う必要が出たら、`tests/helpers/` へ移すことを検討する(本 Issue ではしない)。

## 実測記録

(製造担当が AC-0・AC-1〜AC-3 の結果を書く)

## 22-9 調査記録

(製造担当が書く)
