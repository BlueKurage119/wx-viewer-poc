# Issue #226 ポーリングテストの実行時刻・運用設定からの独立

## 状態と前提

- 設計案。設計承認後に製造へ進む。設計担当: Codex（GPT-6 Sol）。
- [Issue #226](https://github.com/BlueKurage119/wx-viewer-poc/issues/226) の2026-09-29拡大後の範囲を採用する。
- 動作テストにはスケジュール・時計・取得方法を明示し、本番設定を読ませない。実設定の検査は形式・値域に限定し、特定値の解釈はフィクスチャで維持する。
- テストのスキップ、検証緩和、本番設定の変更は行わない。実装コード変更は不要という設計とする。
- 着手時の差分は `config/polling.yaml` と `package.json`。いずれもユーザー変更として保持する。

## 根拠と調査結果

参照資料は Issue 本文・コメント、`apps/api/src/server.ts`、`apps/api/src/config/pollingSchedule.ts`、`apps/api/src/config/pollingScheduleLoader.ts`、下表のテスト、および `docs/rules/02-design-protocol.md`・`docs/rules/05-verification-protocol.md`。

`startServer()` は `enablePolling` の判定前に設定を読み込む。そのため無効起動でも設定読込への依存は残る。ただし「読み込む」と「有効な値の変更で現在のアサーションが失敗する」は区別する。後者が未実証のものを一律に失敗扱いしない。

時計も区別する。サーバーの監視・取得記録には `pollingServiceOptions.clock` が使われ、スケジューラは `schedulerOptions.now` を優先する。後者がなければ前者を `Date` 化して使い、両方なければ実時計を使う。

以下は静的調査結果であり、変更前の昼夜比較・設定変更比較は**実挙動未確認**。表の「実時計なし」は本 Issue のスケジュール判定に関する分類であり、待機時間計測などの全時刻参照の不存在を意味しない。

| 対象（`apps/api/tests/` 配下） | 実行時刻への依存 | 本番設定への依存・対応 |
| --- | --- | --- |
| `serverMonitoringStatusDisabledPolling.test.ts` | 無効起動でスケジュール判定なし | 暗黙読込あり。有効値変更による失敗は未実証。明示設定を渡す |
| `serverFetchHealthStartup.test.ts` | スケジューラは昼固定、監視時計と履歴seedは実時計 | 暗黙読込あり。監視閾値・稼働判定が設定依存。設定と監視時計・seedを固定 |
| `jmaXmlPolling.test.ts` | 初期取得ケースはclock固定、例外ケースはnow固定。待受失敗は取得前 | startServer全呼出しで暗黙読込あり。稼働・例外の前提を明示設定で固定 |
| `nowcastApi.test.ts` | 多数のenablePollingは下位サービスのオプション。startServerとmain子プロセスは無効起動 | B18で両方が本番設定を読む。startServerには明示設定、mainには子プロセス限定の読込差替え |
| `reprocessProgressLogs.test.ts` | 有効起動に時計未注入箇所あり | 暗黙読込と直接loadあり。ログ対象以外の取得も明示スタブ化 |
| `issue33WarningRestApis.test.ts` | 無効起動でスケジュール判定なし | 暗黙読込あり。明示設定を渡す |
| `issue145BulletinNotifications.test.ts` | clock・nowとも固定 | AC14で暗黙読込あり。初期取得と通知の前提を明示設定で固定 |
| `database.test.ts` | 無効起動、およびDB初期化失敗の確認 | 暗黙設定の経路あり。DB失敗の目的を保って明示設定を渡す |
| `issue36TimeseriesAmedasBosaiRestApis.test.ts` | 無効起動でスケジュール判定なし | 暗黙読込あり。明示設定を渡す |
| `serverGracefulShutdownTiming.test.ts` | clock・now未注入で初期取得の有無が昼夜に依存 | 暗黙読込あり。常時XML稼働と固定時計で初期取得待機を保証 |
| `retentionPolicy.test.ts` | 無効起動でスケジュール判定なし | 暗黙読込あり。明示設定を渡す |
| `pollingScheduleLoader.test.ts` | 実時計なし | 既定値の完全一致、異常値ケースの基底、cwd検査に本番読込あり。実設定検査とフィクスチャ検査へ分離 |
| `timeBasedPollingScheduler.test.ts` | 固定時計・仮想タイマー | モジュール先頭で本番読込。周期・停止境界の期待値を保持してフィクスチャ化 |
| `timeBasedPollingSchedulerAcceptance.test.ts` | 主な動作ケースは固定now、サーバー監視時計は未固定箇所あり | 本番読込と夜間・無効startServerの暗黙読込あり。全て明示する |
| `multiVenueAmedasScheduler.test.ts` | 固定時計・仮想タイマー | モジュール先頭で本番読込。固定フィクスチャへ変更 |
| `issue43FetchControlApi.test.ts` | スケジュールを伴うケースは固定時計。ほかに操作記録用実時計あり | 5箇所のloadあり。夜間強制更新等の期待値を固定フィクスチャで保持 |
| `issue178ManualRefreshWhileStopped.test.ts` | 手動実行schedulerのnow未注入箇所あり。手動更新は夜間制限を迂回する | 2箇所のloadあり。明示設定・時計に統一 |
| `databaseRecoveryOrchestration.test.ts` | #222でXMLを常時有効化済み。他ソースと時計は残る | 3箇所のload、およびeval子プロセスの暗黙読込あり。復旧閾値を含め固定し子にも明示注入 |

製造時は `loadPollingScheduleConfig`、`startServer(`、`config/polling.yaml`、子プロセス内の呼出しを再検索し、表の分類と実測結果を本書に追記する。新しい依存があれば同じポーリング関連の範囲で対処し、範囲を超える問題は統括へ返す。

## 構成・シグネチャ

本番の型・関数・APIエンドポイントは変更しない。既存の `startServer(options: StartServerOptions)` の `pollingSchedule?: PollingScheduleConfig`、`pollingServiceOptions.clock`、`schedulerOptions.now`・`setTimer`・`clearTimer`・`adapters` を使う。

テスト専用に以下を追加する。

- `apps/api/tests/fixtures/polling/schedule.yaml`: 夜間停止・日中稼働の4期間、proxy、鮮度300秒等、従来の完全一致アサーションが検証してきた具体値を明示する。本番ファイルから実行時に生成しない。
- `apps/api/tests/helpers/pollingSchedule.ts`: `createTestPollingSchedule(): PollingScheduleConfig` と `createAlwaysOnTestPollingSchedule(): PollingScheduleConfig` を公開する。前者はフィクスチャURLを明示して既存ローダーを使い、呼出しごとに独立した値を返す。後者は全期間のXML・画像カタログ・アメダス周期を有効値、画像許可をtrueにする。呼出し側の変更が他テストへ漏れないこと。
- 必要なケースのみ同ヘルパーに固定時計定数を置く。既存の境界用仮想タイマーは維持し、全テストのタイマー共通化は行わない。
- `apps/api/tests/helpers/pollingConfigPreload.mjs`: main子プロセス専用。既定設定URLと一致する `fs.readFileSync` の読込だけを上記フィクスチャへ差し替え、それ以外は元関数へ委譲する。`--import` でmain実行前に読み込む。ESM named importが必要な場合は `syncBuiltinESMExports()` で同期する。親プロセス・本番コードでは読み込まない。

mainの設定注入口は存在しないため、B18をstartServerテストへ置換せず、上記の限定モックで実際のmain起動・HTTP結線を維持する。環境変数等の本番仕様追加は行わない。evalでstartServerを使う復旧テストは通常のヘルパーをimportして注入する。

## 変更方針

1. 境界・停止・再開を検証するテストは夜間停止フィクスチャを使い、既存の20:00停止、04:00再開、周期、画像許可、強制更新の完全一致を保持する。
2. 起動順序・通知・終了処理など境界自体が目的でないケースは常時稼働設定を使い、時計と必要な取得スタブを明示する。無効起動でも設定を渡す。
3. `serverFetchHealthStartup` の履歴seedと監視時計を同じ固定基準に揃える。停止テストの初期取得が確実に始まることを確認し、時間帯次第で初期取得を検証しない成功を防ぐ。
4. `reprocessProgressLogs` 等の有効起動ではXML以外の不要な取得をスタブにする。既存の本物の結線検証を削除する置換はしない。
5. ローダーの実設定検査は、デフォルトURLから正常にロード・検証できることを残す。timezoneの仕様上固定値は許容するが、proxy、600秒、periodsの個数等の運用値は固定しない。cwd検査は移動前後の読込結果の完全一致とURL解決を確認する。特定値のYAML読込と不正値拒否は明示URLのフィクスチャで従来通り検査する。
6. 待機用の実タイマーを一律に置き換えない。時刻比較のための壁時計と、経過時間待機を分ける。サーバー・子プロセスを終了してからDBディレクトリを片付ける。

変更可能な範囲は表の18テスト、新規の上記フィクスチャ・ヘルパー、および本設計書の実測結果追記。`apps/api/src`、その他実装、共通テスト設定、package関連ファイル、本番設定は変更しない。

## 検証手順・受け入れ条件

- [ ] AC1: 上表18ファイルについて実時計依存と設定依存を別々に記録し、実行した比較結果・残る非対象の実タイマー用途を追記する。
- [ ] AC2: 対象テストを `node --import tsx --test tests/<対象>.test.ts`（apps/apiで実行）で通す。夜間停止・04:00再開・20:00跨ぎ・強制更新・初期取得・終了処理の既存期待値が維持されていることを差分で確認する。
- [ ] AC3: 実時計に依存していた動作ケースを、注入時計のJST昼12:00と夜22:00の両方で実行し、常時稼働設定で同じ検証結果となることを確認する。境界テストは既存の仮想時計による昼夜・境界検査を維持する。時計の注入口を通る比較とし、OS時計やTZだけの変更で代用しない。
- [ ] AC4: 現在の作業ツリーの設定のまま `npm run test -w apps/api` が成功・正常終了する。実行時間、終了コード、成功・失敗件数を記録する。
- [ ] AC5: ユーザーのファイルを変更しない隔離一時コピーで、（a）proxy・夜間全停止、（b）jma-direct・夜間全周期300秒・画像許可、（c）有効な別の期間分割・周期・鮮度・監視閾値・復旧閾値の設定に対してAPI一式を実行し、全て成功・正常終了する。コピーはconfigの相対解決を保てるディレクトリ構造とし、依存パッケージは利用可能なものを参照する。各変更値・コマンド・実行時間・終了コードを記録する。無期限待機はせず検証プロセス固有のタイムアウトで失敗を報告し、スキップ扱いにしない。
- [ ] AC6: 本番設定を読むテストが実設定の形式・値域・既定URL解決の検査だけになっていることを検索と呼出し追跡で確認する。main子プロセスは既定URL読込だけが差し替わり、DB・migration等の読込は元関数を通ることを実行確認する。
- [ ] AC7: 新規の検証には業務標準に従い、意味を変えない対照改変を先に試し成功を確認した後、該当する不正値検証・境界処理等を一時的に壊して失敗を確認する。実装の一時改変は隔離コピー内に限定し、最終差分には含めない。対象・改変・結果を記録する。既存アサーションの削除・緩和がないことも確認する。
- [ ] AC8: `npm run lint`、`npm run typecheck`、`npm run format:check` とAPIテストが成功する。`git diff` で実装変更なし、本番設定・package.jsonの着手時差分保持、新たな範囲外変更なしを確認する。

設計段階では実行結果を記入しない。長時間停止の再現を目的とした無制限の変更前テスト実行は不要。安全な期限付き比較と静的根拠を区別して記録する。

## 判断・引き継ぎ

- 要ヒアリング事項: なし。上記は確定した範囲内のテスト構成の選択であり、本番仕様の追加はない。
- 先送り事項: ローカル専用上書き設定ファイルの導入は別Issue。ランダムポート衝突や一般的な待機時間改善は本Issueで広げない。
- 製造で本番実装変更が不可避と分かった場合は、その根拠とテストのみで解消できない理由を統括へ返し、設計承認の範囲を超えて変更しない。

## 製造実測結果

### 依存の再確認 (AC1, AC6)

`loadPollingScheduleConfig`、`startServer(`、`config/polling.yaml`、子プロセス起動を再検索した。対象18ファイルのうち、設定の境界とローダー自体を検証する`pollingScheduleLoader.test.ts`以外は、テスト用ヘルパーから作成した設定を明示している。スケジューラの周期・停止・再開・強制更新を検証する5ファイルは夜間停止フィクスチャを使い、起動順序・終了処理・通知等の時刻境界が目的でない有効起動は常時稼働フィクスチャを使う。

`serverFetchHealthStartup.test.ts`は履歴seed、監視時計、スケジューラ時計を同じ固定時刻にそろえた。`serverGracefulShutdownTiming.test.ts`は既存の初期取得待機を維持したまま時計を注入し、常時稼働設定でJST 12:00と22:00を比較した。両方で初期取得4件、完了状態になった。残る実時計の利用は、HTTP待受、待機タイムアウト、停止完了待ちなどの経過時間の計測だけであり、スケジュール判定には使わない。

`nowcastApi.test.ts`のmain子プロセスだけは、`--import`でテスト専用preloadを読み込む。既定設定URLへの`fs.readFileSync`だけをフィクスチャに差し替え、他のパスは退避した元関数へ委譲する。子プロセスで既定設定がフィクスチャ値として読まれることと、通常の`package.json`読込が維持されることを確認した。

### 検証結果 (AC2〜AC8)

- 対象18ファイルを`apps/api`で`node --import tsx --test tests/<対象>.test.ts`として実行し、230件成功、0件失敗、正常終了した。夜間停止・04:00再開・20:00境界・強制更新・初期取得・終了処理の既存テストも成功した。
- `serverFetchHealthStartup.test.ts`と`serverGracefulShutdownTiming.test.ts`を再実行し、固定時刻を含む4件が成功した。昼夜比較のテストは、各時刻で同じ初期取得回数と完了状態を完全一致で検証する。
- 本番設定を変更した隔離コピーで、APIテスト一式を3回実行した。proxy・夜間全停止、jma-direct・夜間全周期300秒・画像許可、別の5期間分割と周期・鮮度・監視・復旧閾値の各設定で、全て正常終了した。
- preloadの対照実験として、隔離コピーのフィクスチャへ意味を変えないコメントを加え、スケジューラテスト13件が成功することを確認した。続けて04:00のXML周期を120秒から121秒へ一時改変すると、完全一致アサーション2件が失敗した。加えて、昼夜固定時計の新規テストは対照実験で成功し、隔離コピーの`startServer`でポーリングを常に無効にする変異を加えると初期取得完了アサーションが失敗した。隔離コピーだけの改変であり、最終差分には含めない。
- main子プロセスのB18は、空きポートの予約直後に`address()`を読んだときの固定ポートフォールバックで失敗した。予約用サーバーの`listen`完了を待ち、実ポートを取得できることを確認してから閉じる限定修正を行った。子プロセスはその実ポートで起動し、HTTP結線も成功する。
- `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run build`は全て成功した。対象18ファイルは230件全て成功した。B18を含む`nowcastApi.test.ts`全件も成功した。API全件は`apps/api`で`node --import tsx --test --test-concurrency=1 tests/*.test.ts`を実行し、752件全て成功、0件失敗、正常終了した。標準の`npm run test -w apps/api`も752件全て成功、0件失敗、約30秒で正常終了した。待受ポートの取得不備は解消済みである。

### 初回検収指摘への製造追記

`pollingScheduleLoader.test.ts`では、既定URLの検査を形式・値域にとどめつつ、テストfixture読込の検査で従来の具体値を完全一致で復元した。対象は`tileDeliveryProfile: proxy`、アメダス再確認600秒、XML・画像カタログの鮮度各300秒、`fetchHealth`全体、`startupRecovery`全体、4期間すべての開始・終了・周期・画像有効値である。隔離コピーでfixtureの`proxy`を`jma-direct`へ一時変異すると、この完全一致検査だけが期待どおり失敗することを確認した。

時刻注入は、判定対象と経過時間・ID用途を分離して再確認した。`reprocessProgressLogs.test.ts`の有効`startServer`、停止状態の`buildStoppedPollingStatus`、`issue178ManualRefreshWhileStopped.test.ts`の直接`TimeBasedPollingScheduler` 2箇所と有効`startServer`、`databaseRecoveryOrchestration.test.ts`の有効`startServer`へ、`pollingServiceOptions.clock`および必要な`schedulerOptions.now`を明示した。`serverFetchHealthStartup.test.ts`のseed生成に残る`new Date`は、注入済み固定時計を基準とする履歴日時の組立てである。`reprocessProgressLogs.test.ts`の`Date.now`は電文IDと受信日時の一意化、待機用タイマーは終了・非同期完了を待つ経過時間用途であり、スケジュール判定へは使わない。

次の既存アサーションを、JST 12:00（UTC 03:00）と22:00（UTC 13:00）の両方で実行するようにした。`serverFetchHealthStartup`の異常監視検知、`serverGracefulShutdownTiming`の初期取得中シグナル2件、`reprocessProgressLogs`の4.3初回XMLログと4.4監視API、`issue178ManualRefreshWhileStopped`のR3停止後手動サイクル、`databaseRecoveryOrchestration`のAC17/18復旧後初期取得である。時刻は各テスト名に含め、起動・DBを伴うケースは時刻ごとに一時DBを作成して相互に状態を共有しない。

再検収指摘の対象6ファイルは、時刻識別名への整理後に`node --import tsx --test`で61件成功、0件失敗、正常終了した。最終の`npm run test -w apps/api`は760件成功、0件失敗、正常終了した。直前の同コマンドの初回試行では、非変更の`jmaXmlPolling.test.ts` 23-3bが1件失敗した。`ManualTimerScheduler.advanceTime`がcallback後に`setImmediate`と固定20msだけを待って戻り、HTTP完了がそれを超えると件数アサーションが早過ぎる既存構造であることを確認した。本Issueの変更との因果は断定せず、設計で先送りした一般的な待機改善は行わず、重い検証を並走させない再試行で上記の最終結果を得た。

### PR #235 P1への製造追記

4.3初回XMLログとAC17/18復旧後初期取得の有効`startServer`は、`schedulerOptions.now`だけを渡していたため、既定のnowcast・kikikuru・amedasアダプターが起動時に実行され得た。両方のJST 12:00・22:00ケースへ対象外3アダプターの`runScheduled`・`runManual`空実装を明示し、XML側の既存`pollingService`または`pollingServiceOptions.fetchFn`は維持した。テスト単位で`globalThis.fetch`を通信禁止スタブへ差し替え、正常close後まで対象外のHTTP取得が0回であることをアサートする。各テストのfinallyまたは起動前に登録したafterで、close失敗時も元のfetchを復元する。

隔離コピーの対照では2ファイル31件が成功した。続けてadapter配列だけを一時的に外すと、4.3昼夜各ケースで5回、AC17/18昼夜各ケースで2回の通信企図を検出し、4件が期待どおり失敗した。最終差分にこの変異は含めない。

P1のcleanupはNodeのafter登録順に従い、起動前に登録したcleanupの先頭で復旧gateを解放してから起動Promiseのcloseを待つ。これにより、gate解放前のアサーション失敗でも待機した起動Promiseと循環しない。隔離コピーでこの期待値を昼夜とも意図的に失敗させると、2件失敗・16件成功で約5.6秒以内に終了し、後続の`globalThis.fetch`復元確認も成功した。
