# Issue #166 アメダス取得失敗検知のテストカバレッジ追加

作成日: 2026-10-18

改訂履歴: 2026-10-18 改訂1 — 複数会場の集約判定(M4・M5)を範囲に追加、M3をスケジューラー側(M3a・M3b)まで分解、T3のハング禁止とテストタイムアウト付き実行、#284との調整手順、承認待ちの統括提案(AC8修正・停止規律)を追記。
改訂履歴: 2026-10-18 改訂2 — 設計承認。統括提案(AC10・§3.6 停止規律)を確定に変更。#284 は PR #287(未マージ、pollOnce の型変更なし)と確認。

## 1. 目的と範囲

強制更新(`TimeBasedPollingScheduler.runManualOnce()`)が、アメダスの上流取得失敗を `failedSources` に `'amedas'` として報告する判定を、テストで守る。現状これらの判定を壊しても既存テストがほぼすべて通る(後述 §2.2)。

対象は `apps/api/src/polling/timeBasedPollingScheduler.ts` の次の判定である。**ミューテーション箇所は M1・M2・M3・M3a・M3b・M4・M5 の7か所として数える**(M3a・M3b は M3 の値を運ぶ経路で、それぞれ独立に壊して確認する)。行番号は改訂時点の目安。

| ID | 位置 | 内容 | 一時変更(ミューテーション) |
| --- | --- | --- | --- |
| M1 | `AmedasScheduledAdapter.runManual()` | latest_time 失敗で例外 | `if (!result.latestTime.succeeded)` → `if (false)` |
| M2 | 同上 | 地点データ失敗で例外 | `if (result.pointData.attempted && !result.pointData.succeeded)` → `if (false)` |
| M3 | `AmedasScheduledAdapter.runScheduled()` | `this.lastRunFailed = ...` の記録 | 右辺を `false` |
| M3a | `TimeBasedPollingScheduler.triggerSourcePoll()`(583行付近) | `failed = adapter.hasLastRunFailed?.() ?? false;` で記録を `lastScheduledRunFailedMap` に運ぶ | `failed = false;` |
| M3b | `TimeBasedPollingScheduler.runManualOnce()`(239行付近) | 合流時 `if (this.lastScheduledRunFailedMap.get(source))` で `failedSources` に積む | `if (false)` |
| M4 | `MultiVenueAmedasScheduledAdapter.hasLastRunFailed()`(803行付近) | `this.adapters.some(...)` で会場別の失敗を集約 | `return false;` |
| M5 | `MultiVenueAmedasScheduledAdapter.runManual()`(806〜817行付近) | `Promise.allSettled` で集めた拒否を再送出 | `if (rejected.length > 0)` → `if (false)` |

**Issue本文の対象はM1・M2のみである。M3は起票後のコミット `202b92f` で追加された判定で、同じ経路の一部であるためオーナー承認で範囲に加えた。M3a・M3b・M4・M5は改訂1でオーナー決定により追加した。** 会場ID未指定の本番既定構成(893〜906行付近)は `MultiVenueAmedasScheduledAdapter` を使うため、M4・M5は本番で実際に通る経路である。

範囲外: 本番コード(`apps/**/src`)の変更、サーバー起動を伴う結合テスト、nowcast・kikikuru・XMLの失敗検知。

## 2. 参照資料と前提

### 2.1 ヒアリング確定事項(オーナー承認済み)

- 範囲は M1〜M5(§1。M3a・M3b を含む)
- テストの層は単体。アダプター、または `TimeBasedPollingScheduler.runManualOnce()` を直接呼ぶ。サーバーは起動しない
- 偽の上流は `fetchOptions.fetchFn` 注入でURL別に応答を返す。応答本文は `apps/api/tests/fixtures/` の既存データを使い、実設定ファイルに依存しない。会場定義は `tests/helpers/venueConfigPreload.ts` のテスト用会場構成(`eastVenueId`・`trcVenueId`・`testVenueRegistry`)を使う
- 受け入れ条件は (a) ミューテーションで落ちる (b) 無変更で全件通る (c) 合流経路のテストは合流が実際に起きたことをテスト内で表明する
- T3 は M3a を壊したとき、ハングではなく期限内に明確に失敗すること
- 本番コードの変更は禁止

### 2.2 統括担当による実測(設計の前提)

関連5テストファイル(`timeBasedPollingScheduler`・`issue43FetchControlApi`・`issue178ManualRefreshWhileStopped`・`multiVenueAmedasScheduler`・`timeBasedPollingSchedulerAcceptance`、計70件)での結果。

| ID | 結果 |
| --- | --- |
| M1・M2・M3 | 全件パス(SURVIVED) |
| M4・M5 | 全件パス(SURVIVED) |
| M3a | `timeBasedPollingScheduler.test` は13件全件パス(SURVIVED) |
| M3b | `timeBasedPollingScheduler.test` の既存テスト「Codexレビュー指摘#1(2回目レビュー): 強制更新が実行中の定期取得へ合流したとき…」が失敗(検出済み) |

M3a・M3b のどちらでも、`issue43FetchControlApi` と `timeBasedPollingSchedulerAcceptance` が10分以上終了せずハングした(無変更なら2ファイル計33件が約2秒で通る)。ハングは検出として弱く検収で扱いにくいため、本設計では AC の実行対象を追加テストのファイルに絞り、`--test-timeout` を付ける(§4)。

### 2.3 コードから確認した事項

- `runManualOnce()` は、`inFlightPromises` に該当取得元の定期取得があれば `await` して合流し、`lastScheduledRunFailedMap.get(source)` が真なら `failedSources` に積む。無ければ `adapter.runManual()` を呼び、例外を `failedSources` に変換する
- `triggerSourcePoll()` は `adapter.runScheduled()` 完了後に `adapter.hasLastRunFailed?.()` を `lastScheduledRunFailedMap` に記録する。`runScheduled()` は失敗しても例外を投げない
- `start()` は稼働時間帯なら非XML取得元の定期取得を即時投入し、その後XMLを開始する
- `runManual()` の pointData は latest_time 失敗時に未試行(`attempted=false`)。M2を単独で検証するには latest_time を成功させ、地点データ(`.json`)だけを失敗させる
- `timeBasedPollingScheduler.test.ts` の `FakeTimerScheduler`・`FakeScheduledAdapter`・`FakeXmlPollingService`・`createTempDb`・`point44136Json` はエクスポートされていない。`FakeXmlPollingService` に `pollOnce` が無い
- `multiVenueAmedasScheduler.test.ts` は独自に `createTempDb`・`FakeTimerScheduler`・`DummyXmlPollingService`(`pollOnce` 無し)、fixture `point44136Json`・`point44166Json`・`latestTimeText`、および `eastVenueId`/`trcVenueId` の2会場で `AmedasScheduledAdapter` を2つ作り `MultiVenueAmedasScheduledAdapter` に束ねる構成を持つ。1400行付近のテストは、この集合アダプターを `TimeBasedPollingScheduler` に接続し、`start()` 後に地点データ応答を保留して要求回数を数える(ゲート方式の前例)
- テストは `node --test tests/*.test.ts` で実行される(`apps/api/package.json`)

## 3. 実装方針

### 3.0 着手前の確認(#284 との調整)

#284(jmaXmlPolling のタイマー)が別セッションで進行中である。§3.1・§3.5 の `pollOnce` 追加は `JmaXmlPollingService['pollOnce']` の型に依存するため、製造担当は着手前に次を行う。

1. `gh pr list --state all --search "284"` 等で #284 の PR の状態を確認する
2. マージ済みなら、作業ブランチに `origin/main` を取り込んでから着手する(`git fetch origin && git merge origin/main`)
3. 未マージなら、その PR の差分で `apps/api/src/polling/jmaXmlPollingService.ts` の `pollOnce` のシグネチャ・戻り値型が変わるかを確認し、変わる場合は最終報告に記載する(本Issueはキャストで吸収するため着手は止めない)

#284 側の見立てでは `PollingTimerScheduler` は `timeBasedPollingScheduler` では未使用で影響なし。

### 3.1 単一会場テストの配置

単一会場のテスト(T1〜T4)は、既存フェイクを再利用するため **`apps/api/tests/timeBasedPollingScheduler.test.ts` の末尾に追記**する。

`FakeXmlPollingService` に次のメソッドを追加してよい(既存テストの挙動を変えないこと)。

```ts
async pollOnce(_trigger: 'manual'): Promise<{ feedResults: []; aborted: false }>
// 常に { feedResults: [], aborted: false } を返す(XMLは成功扱い)
```

型が合わない場合は既存テストと同じ `as unknown as JmaXmlPollingService` のキャストで吸収する。

### 3.2 偽の上流

`customFetch: typeof fetch` を定義し、URLで分岐する。

- `latest_time.txt` を含む → 状態に応じて `200`(本文 `'2026-09-12T01:00:00.000Z'` 等)または `503`
- `.json` を含む → 状態に応じて `200`(本文は fixture)または `503`
- その他 → `404`

リクエスト回数をURL種別ごと(複数会場では地点コード別も)に数える。単一会場のアダプターは `new AmedasScheduledAdapter(database.connection, new AmedasFetchState(eastVenueId), 600, { fetchOptions: { fetchFn: customFetch, venueRegistry: testVenueRegistry }, now })` で作る。DBは `createTempDb()` + `initializeDatabase()`、`finally` で `close()`・`cleanup()` する。

**latest_time 本文と HTTP 503 は既存テストに倣った値であり、実データ・公式資料とは照合していない**(§6)。テストの意図は「上流の失敗応答」「成功応答」の区別だけであり、電文仕様の確定事実として扱わない。

### 3.3 追加テスト(単一会場)

テスト名には `#166` と ID を含める。

| テスト | 検証内容 | 主な表明 |
| --- | --- | --- |
| T1 `#166 M1: latest_time 失敗で runManual が例外を投げ、runManualOnce が amedas を failedSources に含める` | latest_time=503 | (1) `adapter.runManual()` が reject する(`assert.rejects`) (2) 別に新しい scheduler(未start)で `runManualOnce()` の `failedSources` に `'amedas'` が含まれる |
| T2 `#166 M2: 地点データ失敗で runManual が例外を投げ、runManualOnce が amedas を failedSources に含める` | latest_time=200、`.json`=503 | T1と同じ2点に加え、地点データへのリクエストが1回以上あったこと(=attempted)を表明 |
| T3 `#166 M3/M3a/M3b: 定期取得実行中に強制更新が合流し、定期取得の失敗が failedSources に反映される` | §3.4 | §3.4 |
| T4 `#166 対照: 上流がすべて成功なら runManualOnce の failedSources は空` | 全200 | `failedSources` に `'amedas'` が含まれない |

T1・T2・T4の scheduler は `start()` しない。nowcast・kikikuru には `FakeScheduledAdapter` を渡す。`failedSources` の表明は `includes('amedas')` とする。

### 3.4 T3(M3・M3a・M3b)の手順

1. `FakeTimerScheduler('2026-09-12T01:00:00.000Z')`(稼働時間帯)を scheduler とアメダスアダプターの時刻源に渡す
2. `customFetch` の latest_time 応答は、テスト側が保持する「ゲート」Promise の解決を待ってから `503` を返す
3. `await scheduler.start()` 後、latest_time のリクエスト回数が1になるまで `await new Promise(r => setImmediate(r))` を上限付き(例: 50回)で繰り返す。上限到達で `assert.fail`
4. **合流の前提表明**: latest_time リクエスト回数が1、ゲート未解決であること
5. `const manual = scheduler.runManualOnce()` を await せずに開始し、ゲートを解決する
6. **期限付きの待ち**: `manual` を、実時間の上限(例: 2000ms の `setTimeout` で reject する Promise)との `Promise.race` で待つ。上限到達時は「runManualOnce が期限内に完了しなかった(M3a/M3b の合流経路が壊れている可能性)」という文言で `assert.fail` する。上限タイマーは `finally` で `clearTimeout` する。これは実時間依存ではなく安全弁であり、正常時は即時に完了する
7. **合流の事後表明**: latest_time リクエスト回数が合計1回のままであること(手動経路を通れば2回になる)
8. `result.failedSources` に `'amedas'` が含まれる
9. `finally` で `await scheduler.stop()`(stop も同様に期限付きで待ってよい)

M3a を壊したときにハングした既存2ファイルと同じ原因(合流後の待機が解けない等)で T3 が詰まる可能性があるため、手順6の期限付き待ちを必須とする。期限付き待ちでも決定的に失敗させられない場合は §3.6 に従う。

### 3.5 複数会場テストの配置と内容(M4・M5)

`multiVenueAmedasScheduler.test.ts` が2会場の部品(`createTempDb`・`FakeTimerScheduler`・`DummyXmlPollingService`・fixture・`MultiVenueAmedasScheduledAdapter` 組み立て・scheduler 接続の前例)を既に持つため、**このファイルの末尾に追記**する。`DummyXmlPollingService` に §3.1 と同じ `pollOnce` を追加してよい。

構成: `eastVenueId`(地点44136)・`trcVenueId`(地点44166)の `AmedasScheduledAdapter` を同一 `customFetch` で作り、`new MultiVenueAmedasScheduledAdapter([eastAdapter, trcAdapter])` で束ねる。`customFetch` は地点コード(URL中の `44136`/`44166`)で応答を分け、**一方の会場だけ地点データを503**にする(latest_time は両会場とも200。本文は既存の `latestTimeText`)。

| テスト | 検証内容 | 主な表明 |
| --- | --- | --- |
| T5 `#166 M5: 一方の会場だけ失敗すると集合アダプターの runManual が例外を投げ、runManualOnce が amedas を含める` | 44166 の `.json`=503、他200 | (1) `multiAdapter.runManual()` が reject (2) 未start の scheduler で `runManualOnce()` の `failedSources` に `'amedas'` (3) 44136・44166 の地点データ要求が各1回以上(両会場が実際に試行された) |
| T6 `#166 M4: 一方の会場だけ失敗した定期取得へ強制更新が合流し、amedas を含める` | 同上、ゲートは 44166 の地点データ応答に置く | §3.4 と同じ手順(前提表明・期限付き待ち・事後表明)。事後表明は「各会場の latest_time 要求が合計1回ずつのまま」 |
| T7 `#166 対照: 2会場とも成功なら runManualOnce の failedSources に amedas を含まない` | 全200 | `includes('amedas')` が偽 |

T6 は M4 を `return false` にすると `lastScheduledRunFailedMap` が偽になり失敗する。M3a/M3b が壊れても失敗するが、AC は M4 の検出のみを求める。

### 3.6 停止規律【確定: 2026-10-18 総統括担当がオーナーの委任に基づき承認】

T3・T6 等が決定的に作れない場合(期限付き待ちでもミューテーション時に失敗を確定できない、無変更時に不安定に失敗する等)、製造担当は待機時間の延長・リトライ・テストのスキップ等の回避策を入れず、作業を止めて状況(試した構成、観測した挙動)を報告する。

## 4. 受け入れ条件

検収担当は `apps/api` で実行する。worktree では事前に `packages/shared` で `npm run build` が必要(ルートの `npm run build` は禁止)。

ミューテーション確認の実行コマンドは対象ファイルに絞り、タイムアウトを付ける(以下「単一会場コマンド」「複数会場コマンド」)。macOS には `timeout` コマンドが無いため、打ち切りは `node --test` の `--test-timeout` に依る。

```bash
# 単一会場コマンド
node --import tsx --import ./tests/helpers/venueConfigPreload.ts --test --test-timeout=30000 tests/timeBasedPollingScheduler.test.ts
# 複数会場コマンド
node --import tsx --import ./tests/helpers/venueConfigPreload.ts --test --test-timeout=30000 tests/multiVenueAmedasScheduler.test.ts
```

各ミューテーションは確認後に必ず復旧する。「失敗すること」は該当テストが fail(タイムアウトによる fail を含まない、表明失敗であること。T3・T6 は §3.4 手順6の期限付き待ちによる `assert.fail` も表明失敗に数える)として判定する。

- [ ] **AC1(追加)**: `timeBasedPollingScheduler.test.ts` に `#166` を含むテストが T1〜T4 の4件、`multiVenueAmedasScheduler.test.ts` に T5〜T7 の3件あること
- [ ] **AC2(無変更で通る)**: `npm run test -w apps/api` が全件パスすること
- [ ] **AC3(M1)**: M1 を一時変更し、単一会場コマンドで T1 が失敗すること
- [ ] **AC4(M2)**: M2 を一時変更し、単一会場コマンドで T2 が失敗すること
- [ ] **AC5(M3・M3a・M3b)**: M3・M3a・M3b をそれぞれ単独で一時変更し、単一会場コマンドで毎回 T3 が失敗すること。コマンドが `--test-timeout` に達せずに終了すること(ハングしないこと)
- [ ] **AC6(合流の表明)**: T3・T6 のコード中に、強制更新開始時点で定期取得が実行中である表明、上流 latest_time 要求回数が増えていない表明、期限付き待ちがあること。目視で確認する
- [ ] **AC7(偽成功の排除)**: T2 に地点データ要求の表明、T5 に両会場の地点データ要求の表明があり、対照 T4・T7 があること
- [ ] **AC8(M4)**: M4 を一時変更し、複数会場コマンドで T6 が失敗すること(ハングしないこと)
- [ ] **AC9(M5)**: M5 を一時変更し、複数会場コマンドで T5 が失敗すること
- [ ] **AC10(本番コード不変)**【確定: 2026-10-18 総統括担当がオーナーの委任に基づき承認】: `git diff --stat origin/main...HEAD` で `apps/**/src` に差分がなく、変更が `apps/api/tests/` 配下と本設計書のみであること。一時変更が残っていないこと(`git status --porcelain` が空)
- [ ] **AC11(実設定非依存)**: 追加テストが `config/` 配下の実設定ファイルを読まないこと(会場は `tests/helpers/venueConfigPreload.ts`、応答本文は `tests/fixtures/` と文字列リテラルのみ)。目視で確認する
- [ ] **AC12(静的検査)**: リポジトリルートで `npm run lint`・`npm run typecheck`・`npm run format:check` が通ること

## 5. 後続Issueへの引き継ぎ

- nowcast・kikikuru の失敗検知も同様に未保護の可能性がある。必要なら同じ手法で別Issueとする
- M3a・M3b を壊すと `issue43FetchControlApi`・`timeBasedPollingSchedulerAcceptance` がハングする。既存テストに期限付き待ちが無いことが原因と推定され、別Issueで扱う候補
- フェイク群が2ファイルに重複している(`createTempDb`・`FakeTimerScheduler` 等)。`tests/helpers/` への切り出しは別途検討する

## 6. 実挙動未確認の箇所

- 偽の上流の latest_time 本文 `'2026-09-12T01:00:00.000Z'` と HTTP 503 は既存テストに倣った値で、実データ・公式資料とは照合していない(CLAUDE.md 気象データ遵守事項。本Issueは失敗/成功の区別のみを使う)
- T3・T6 の期限付き待ちで、M3a・M3b・M4 の各ミューテーション時に実際にハングせず表明失敗になるかは未実測(既存2ファイルのハング原因は未特定)
- `start()` 後に上流要求が発生するまでのマクロタスク数は未計測(上限付き待機で吸収)
- `FakeXmlPollingService`・`DummyXmlPollingService` への `pollOnce` 追加で型キャストが必要か、#284 による型変更の影響は未確認(§3.0)
- 集合アダプターの `runManual()` が各会場の地点データ要求を並行に行うことはコード(`allSettled`)から推定しており、T5 の要求回数表明は実測していない
