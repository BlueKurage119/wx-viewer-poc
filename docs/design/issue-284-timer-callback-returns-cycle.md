# Issue #284 設計書: タイマーコールバックがサイクル完了を返し、偽タイマーの完了推測をなくす

## 1. 目的

`JmaXmlPollingService` のタイマーコールバックがサイクルの Promise を返すようにし、テスト用偽タイマー `ManualTimerScheduler` が「次のタイマー登録」という副作用から完了を推測するのをやめ、`await callback()` で完了を直接待てるようにする。本番のポーリング挙動(周期・再試行・停止)は変えない。

## 2. 参照資料と設計判断の根拠

| 資料 | 内容 |
| --- | --- |
| Issue #284 本文 | 制約1〜4、やること(案)、やらないこと |
| 統括担当のヒアリング確定事項 Q1〜Q4(オーナー承認済み) | 下表 |
| `apps/api/src/polling/jmaXmlPollingService.ts` | `PollingTimerScheduler`(50行付近)、`defaultTimerScheduler`(119行付近)、`scheduleNextCycle` のコールバック(658行付近) |
| `apps/api/tests/jmaXmlPolling.test.ts` | `ManualTimerScheduler`(64〜166行付近)、`bindServiceRunningState` 呼び出し(1204, 2603, 2736, 3020行付近) |

確定事項の反映:

- Q1(案A): コールバック型を `() => void | Promise<void>` に広げ、本番コールバックは `return this.runScheduledOrRetryCycle()` とする。`defaultTimerScheduler` は Node の `setTimeout` に渡すだけで戻り値を捨てるため、本番挙動は不変。
- Q2: 保証は既存 api テスト全件通過と、本番差分が型定義とコールバック内1行のみであることの差分確認で行う。実タイマーの新規テストは追加しない。
- Q3: 制約3は本番コードを直さず、調査結果を本書 5章に記録する。偽タイマーには同時刻連続発火の回数上限のみ残す。
- Q4: 登録回数監視・`bindServiceRunningState`・実時間上限・`setImmediate` 空回りを廃止する。

## 3. 変更仕様

### 3.1 本番コード(`apps/api/src/polling/jmaXmlPollingService.ts`)

変更はこの2点に限る。

```ts
export interface PollingTimerScheduler {
  setTimeout(callback: () => void | Promise<void>, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
}
```

`scheduleNextCycle` 内のコールバック:

```ts
this.timerId = this.timerScheduler.setTimeout(() => {
  this.timerId = null;
  if (!this.isRunning) {
    return;
  }
  return this.runScheduledOrRetryCycle();
}, delayMs);
```

- `defaultTimerScheduler` は変更しない(`(cb, ms) => setTimeout(cb, ms)` のまま型が通ること。通らない場合のみ、戻り値を捨てる形 `() => void cb()` への最小修正を許すが、その場合は最終報告で明記する)。
- `runScheduledOrRetryCycle` は内部で try/catch/finally しており reject しない前提。本番では戻り値が捨てられるため、仮に reject しても挙動は従来の `void` と同じ(未処理 rejection の扱いも同じ)。
- 上記以外の本番ファイル・関数は変更しない。
- `eslint.config.js` は `tseslint.configs.recommended` のみで型情報を使う設定を含まないため、`no-misused-promises` 等の型情報依存ルールは有効でない。万一 lint で指摘が出た場合は、本番ロジックを変えずに解消し、内容を報告する。

### 3.2 偽タイマー(`apps/api/tests/jmaXmlPolling.test.ts` の `ManualTimerScheduler`)

- 廃止: `MANUAL_TIMER_COMPLETION_TIMEOUT_MS`、`registrationCount`、`isServiceRunning`、`bindServiceRunningState`、`waitForNextRegistration`、`advanceTime` 内の `setImmediate` フラッシュ。
- `timers` の型: `Map<number, { callback: () => void | Promise<void>; dueTimeMs: number }>`。
- `advanceTime(ms)`: 期限が来たタイマーを時刻順に1件ずつ取り出し、`currentTimeMs` を期限に進め、`await timer.callback()` で完了を待つ。以降従来通り繰り返し、なければ `targetTimeMs` に進めて終了。
- 同時刻連続発火の回数上限(制約3の保険): 同一 `dueTimeMs` での連続発火回数を数え、上限(例 `MAX_SAME_TIME_FIRES = 100`、命名・値は製造担当が決めてよい)を超えたら `Error('advanceTime: 同じ時刻での発火が上限を超えました')` を投げる。実時間には依存しない。
- 4箇所の `scheduler.bindServiceRunningState(...)` 呼び出しは削除する。それ以外のテストの検証内容(期待値・アサーション・操作順)は変更しない。テストが新方式で失敗する場合は、検証を緩めず原因を報告する。
- 制約コメント(a)〜(d)を実態に合わせて書き換える。書くべき内容:
  - (a) 完了はコールバックの Promise で直接待つ。サイクル途中で `stop()` しても、`advanceTime` は発火したサイクルの完了まで待つ。
  - (b) サイクル中に `setScheduledIntervalSeconds` や再 `start()` で登録されたタイマーは、期限が来ていれば同じ `advanceTime` 内で後続として発火する(待ちを早く抜けない)。
  - (c) 遅延0の再登録が続いた場合は回数上限で失敗させる。本番では連続しない(本書5章)。
  - (d) #284 で、本番コールバックがサイクルの Promise を返すよう変更済み。

#### 3.2.1 待ち合いによる停止への備え

新しい `advanceTime` は発火したサイクルが終わるまで返らない。旧方式の逃げ道(稼働状態の監視、実時間5秒の上限)を廃止するため、次の作りのテストがあると互いに待ち合い、テストランナーのタイムアウトまで止まり、原因を示すエラーも出ない。

- fetch をゲート(Promise 等)で止め、`await advanceTime(...)` の後でゲートを開ける
- サイクル中の fetch が、`await advanceTime(...)` の後に呼ぶ `stop()` 等の操作を待つ

製造担当は次を行う。

- 着手時に、`jmaXmlPolling.test.ts` で `ManualTimerScheduler` を使う全テスト(`bindServiceRunningState` を呼んでいた 22-2・22-3 等の1204・2603・2736・3020行付近の4件を含む)に上記の作りがないことを確認し、結果を最終報告に書く(設計時点の grep では、ゲート・deferred 型の fetch は見当たらない)。
- 該当する作りがあった場合、または製造中にテストが止まった場合は、テストの検証内容を変えず、待ちの逃げ道も復活させずに製造を止め、該当テストと止まった箇所を統括担当に報告する。対処は統括担当がオーナーと決める。

### 3.3 他の偽タイマー

`independentSystemNotifications.test.ts:172` 付近、`issue178ManualRefreshWhileStopped.test.ts:253` 付近、`timeBasedPollingScheduler.test.ts:1020` 付近は変更しない想定(メソッド引数の双変性、および `() => void | Promise<void>` を `() => void` 引数側で受けても型上問題ない)。typecheck が通らない場合のみ、引数型を `() => void | Promise<void>` に揃える最小修正を許し、報告する。

ただし `timeBasedPollingScheduler.test.ts` は Issue #166 のテスト追記先と同じファイルである。このファイルを触る必要が出た場合は、修正せずに製造を止め、統括担当に報告する。

## 4. 制約1〜4の扱い

| 制約 | 結果 |
| --- | --- |
| 1 stop() が先に isRunning=false | 解消(稼働状態で待ちを抜けなくなる) |
| 2 サイクル中の再登録で早抜け | 解消(登録回数を見ない) |
| 3 遅延0の連続発火 | 本番は非対処(5章)。偽タイマーに回数上限を残す |
| 4 実時間上限・setImmediate空回り | 解消(廃止) |

## 5. 制約3の調査記録(コード読解による判断、実挙動未確認)

前提:

- フィードの結果は `success` / `failure` / `aborted` の3つだけである(`apps/api/src/polling/jmaXmlFeeds.ts:22`)。`failure` は必ず `recordFailure` で `nextAllowedFetchAt` が記録され、`success` は保留から外れる。したがって保留中で `nextAllowedFetchAt` が空になるのは、`aborted` か、結果の記録前に例外が出た場合に限られる。
- 例外が出た後は、保留中のフィードにバックオフは記録されず、`nextCycleNotBeforeMs`(`runScheduledOrRetryCycle` の catch で `now + 周期`)だけが遅延の下限をかける。

failed フェーズで `nextAllowedFetchAt` が記録されず遅延0になる経路は次の2つのみ。

1. 初回 `pollFeeds` が例外 → 1回の即時 recovery。再度例外になった場合は、上記のとおり `nextCycleNotBeforeMs = now + 周期` が `scheduleNextCycle` の下限となり、遅延0は続かない。
2. aborted は `stop()` 時のみ発生し、そのとき `isRunning=false` のため再登録されない。再 `start()` 時は `abortController.reset()` 後に1回即時再試行し、その成否が記録される。

よって本番の遅延0は1回限りで連続しない、と判断し本番コードは直さない。実タイマーでの確認は行っていない。

## 6. 受け入れ条件

検収担当はリポジトリ直下で実行する。

- [ ] `npm run lint` が警告0・エラー0で終了する。
- [ ] `npm run typecheck` がエラー0で終了する(3.3 の他の偽タイマー3ファイルを含め、型エラーが出ないこと)。
- [ ] `npm run format:check` が差分なしで終了する。
- [ ] `npm run test -w apps/api` が全件通過する(skip・only の追加がないこと: `git diff main -- apps/api/tests | grep -nE '\.(skip|only)\('` が0件)。
- [ ] 本番差分範囲: `git diff main --stat -- apps/api/src packages` が `apps/api/src/polling/jmaXmlPollingService.ts` 1ファイルのみ。`git diff main -- apps/api/src` の変更行が、`PollingTimerScheduler.setTimeout` の型と、コールバック内 `void this.runScheduledOrRetryCycle()` → `return this.runScheduledOrRetryCycle()` の置換だけである(3.1 の例外を使った場合はその1行を含め報告と一致すること)。
- [ ] 推測待ちの消滅(ファイル全体): `grep -nE 'registrationCount|waitForNextRegistration|bindServiceRunningState|MANUAL_TIMER_COMPLETION_TIMEOUT_MS' apps/api/tests/jmaXmlPolling.test.ts` が0件。
- [ ] 実時間依存の消滅(クラス内に限定): `awk '/^class ManualTimerScheduler/{f=1} f{print NR": "$0} f&&/^}/{exit}' apps/api/tests/jmaXmlPolling.test.ts | grep -E 'setImmediate|Date\.now\(\)|setTimeout\(\(?r'` が0件(クラス本体の `setTimeout(callback, ms)` メソッド定義は対象外であることを出力で確認する)。
- [ ] 本番を壊すと落ちること(変異確認): 一時的に本番コールバックを `void this.runScheduledOrRetryCycle()` に戻して `npm run test -w apps/api` を実行し、22-2・22-3・23-7 のうち1件以上が失敗することを確認する。確認後は元に戻し、`git diff main -- apps/api/src` が 3.1 の差分と一致することを再確認する。変異状態をコミットしない。
- [ ] 待ち合い確認の報告: 3.2.1 の確認結果が最終報告に書かれている。
- [ ] `ManualTimerScheduler.advanceTime` がコールバックの戻り値を `await` しており、同時刻連続発火の回数上限があることを目視確認する。
- [ ] 制約コメントが 3.2 の(a)〜(d)の内容になっている。
- [ ] テスト検証内容を緩めていない: `git diff main -- apps/api/tests` で、`ManualTimerScheduler` 本体と `bindServiceRunningState` 呼び出し4行の削除以外に、`expect`/`assert` 行の削除・変更がない。

## 7. 後続への引き継ぎ

- 他の偽タイマー3つも同様に `await callback()` 方式へ寄せられる。本Issueの範囲外。
- 制約3の本番挙動は実タイマーで確認していない。必要になれば別Issueで観測する。

## 8. 実挙動未確認の箇所

- 5章の判断(コード読解のみ)。
- 3.2.1 の待ち合いが既存テストで起きないこと(設計時点の grep による判断。製造時に確認する)。

なお、ESLint の型情報依存ルールは設定上有効でないことを `eslint.config.js` で確認済みであり、未確認事項ではない。
