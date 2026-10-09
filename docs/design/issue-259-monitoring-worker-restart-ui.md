# Issue #259 Worker別の状態・明示再開を踏まえた監視画面とツールバーの整理

## 1. 位置づけ・前提・根拠

- 対象: [#259](https://github.com/BlueKurage119/wx-viewer-poc/issues/259)、親: [#255](https://github.com/BlueKurage119/wx-viewer-poc/issues/255)。#257・#258（PR #264、マージコミット 3baeabd）のマージ後の main の実装と [#258設計](issue-258-weather-delivery-worker.md) に照らして確定した設計書である。コード上の根拠はファイル名と行番号で示す（行番号は 3baeabd 時点）。
- ユーザーヒアリングは実施済み。確定した判断は §2「確定事項」にまとめる。製造時の実測で確定する項目は §12、残る論点は §14。
- 【確定・追加指示】監視画面は既存カードの並べ替えではなく、意味の通る構成に刷新する。根拠は Issue #259 のコメント所見（見出しと内容のずれ、別状態の同居、Worker生存・鮮度と健全性の区別、対象範囲（全体/会場）の不一致、画面更新時刻と元データ時刻の区別）。単一の「総合正常」にしない既存の意味は維持する。
- 【確定】#257/#258 の仮UI（`WeatherWorkerPanel` 等）・system通知文面は流用しない。本書で設計し直す。
- 【確定】ツールバーは実装済みの階層式ナビゲーション（`monitoringToolbarState.ts` の `navigate` 項目・履歴スタック・`<<`/`<`・階層タイトル）で構成する。
- 本書は既存 #74（K1レイアウト）・#75（K2ツールバー）・#86（監視受け入れ）・#43（取得制御API）の再実装ではない。既存の取得操作・履歴ダイアログの内容・H/K（端末モード）・確認状態・鳴動の意味は変えない。
- 【範囲】監視 DTO（`MonitoringStatusResponse`）と監視 API に「未判定の警報系電文件数」を追加する（§4.3）。web だけで閉じない変更である。
- テーマはダーク固定。色・コントラストの確認はダークのみ。

### 1.1 参照資料と導いた判断

| 資料 | 本書での使い方 |
| --- | --- |
| Issue #259 本文・コメント所見 | 所見1〜5を §5 の刷新の根拠とする |
| [#256設計](issue-256-weather-worker-contracts.md) | 取得/提供の責務、取得側終了時に保存済み情報提供と監視を継続する契約（§5.4）、「結果不明」scope（§6.2） |
| [#257設計](issue-257-weather-acquisition-worker.md) §7・AC15 | 再開の有効条件（stale/failed/stopped かつサーバー許可）、409時の再取得と自動再開禁止、aria-live=polite |
| [#258設計](issue-258-weather-delivery-worker.md) §5.3・§6・§7・AC12 | 提供再開の成功は「新Worker受付確認」であり DB接続/提供ready を保証しない。`weatherSampleReceivedAt` と15秒超の鮮度低下 |
| [#74設計](issue-74-monitoring-dashboard-layout.md) | 1920×1080/960基準、本体高さ予算744 px、カード列数の切替（1280/760）、ツールバー120 px固定幅・グループ単位折返し |
| [#75設計](issue-75-monitoring-toolbar.md) | 取得操作の「選択→送信」、ダイアログ直接開閉、monitor離脱後も同一IDの照会を継続 |
| `packages/shared/src/weatherRuntime.ts` | `WeatherRuntimeStatus`（4〜26行: lifecycle 6値、reportFreshness 3値、stopReason 3値＋null、restartAllowed、pendingRequests、exitConfirmed、unknownScopes（任意）、failureCode 7値＋null）。`projectWeatherRuntimeStatus`（51〜71行）は受領時刻から15秒超で stale とし、`restartAllowed` を「restarting/stopping 以外で failed・stopped・stale のいずれか」とする。`WeatherRestartOperation`（31〜48行）の completed は `workerGeneration`・`historyRecorded`・`desiredRunning?` を持つ |
| `packages/shared/src/monitoringStatus.ts` | `MonitoringReadinessSection`（105〜116行: `initialFetchPhase` は `not_started`/`running`/`completed`/`failed`）、`MonitoringReadError`（215〜220行）、`MonitoringStatusResponse`（222行〜: `weatherSampleReceivedAt?`、`weatherRuntimes`、`readErrors`、`requestedVenueId`、`venues[].reprocessing`） |
| `apps/api/src/runtime/acquisitionWorkerHost.ts`・`deliveryWorkerHost.ts` | stale は通知だけで failed にしない（取得 76〜79行、提供 51〜57行）。提供 reader 接続失敗は同じ世代のまま `failed`＋`initialization_failed`（提供 172〜195行）。取得の再起動は `report` を null に戻す（取得 128〜139行）。提供の `stopReason` は `requested` か null のみで、異常の理由は `failureCode` に入る（提供 75〜90行） |
| `apps/api/src/runtime/startWorkerServer.ts` | Worker 異常通知の組立（`recordFailure`、224〜272行: 区分 question 固定・対象名「気象取得/提供Worker」・code→定義IDの対応）、提供再起動は新Worker受付で成功とし reader 接続障害は runtime 側の異常に残す（478〜545行）、監視GETは提供Workerが作った標本をメインで上書き合成する（598行〜の `monitoringStatus.getStatus`） |
| `apps/api/src/runtime/createApplicationRuntime.ts` | 監視標本は提供Worker側で端末ごとに5秒間隔で採取（375〜394行） |
| `apps/api/src/repositories/telegramReceptionRepository.ts` | `countPendingWarningTelegramReceptions(connection, venueId): number`（493行〜、会場単位・同期）。呼び出し元は起動時再処理（`apps/api/src/polling/jmaWarningTelegramProcessor.ts` 163行）のみ |
| `apps/web/src/monitoring/weatherRestartController.ts`・`apps/web/src/api/weatherWorkers.ts` | `WeatherRestartState` は `phase` で区別（8〜18行）。409→`conflict`、400→`rejected`（weatherWorkers.ts 67〜68行）。履歴は `/api/monitoring/weather-worker-operations?limit=20&beforeId=`（同 108〜109行） |
| `packages/shared/src/notificationMessageDefinitions.ts` | Worker 系8件（313〜392行）・`system-fetch-operation-unknown`（393行〜）・`system-initial-sync-failed`（403行〜）。いずれも `allowedCategories: ['question']` |
| [UI標準](../rules/06-ui-md3-protocol.md)、[G-08](../rules/advisory/G-08-ui-measurement-pitfalls.md)、[G-10](../rules/advisory/G-10-design-consistency-pitfalls.md) | ラッパー経由・トークンのみ・bare import禁止、寸法揺れの列挙、計測の罠 |

### 1.2 #258 からの引き継ぎとの照合

[#258設計](issue-258-weather-delivery-worker.md) §10 の #259 行の項目と本書の対応。

| 引き継ぎ項目 | 本書の対応 |
| --- | --- |
| 仮UI・異常通知のユーザー監修と全面改定 | §5・§6・§9（C7・C9） |
| 2role | §4.2・§5.2 |
| 通常取得停止とWorker停止の区別 | §4.5 末尾・D4 |
| 受付/接続/提供ready の区別 | §5.4・§6.4（受付後の接続失敗を含む）・D6 |
| 結果不明/記録失敗 | §5.4・§6.4（「・履歴未記録」）・D5(d)・D6 |
| 報告と集計鮮度 | §5.2・D3 |
| 両role再開履歴 | §6.3・D6 |
| 360/768/1280px 表示 | §10・D8 |
| 準備中・ready・stale・異常・再開中・結果不明の表示 | §4.5・D2・D9 |
| 再開受付成功後接続失敗の表示 | §4.5・§5.4・§6.4・D6・D9(3b) |
| 履歴保存失敗の表示 | §5.4・§6.4・D6 |
| stale と failed の視覚的区別 | §4.2（優先5と8のトーン・文言）・D3・D9(5) |
| 両roleの専用再開・二重操作抑止 | §6.1・D5 |
| 同ID再確認 | **本 Issue では扱わない**（C19）。結果不明は再読込で解除する（C13） |
| Tab/Enter/Space・フォーカス | §8・D8 |

## 2. 確定事項（ユーザーヒアリング済み）

| # | 確定内容 | 反映先 |
| --- | --- | --- |
| C1 | 監視カードは全体の帯1段・4枚のみ。会場の帯は廃止（今後は設定上、単一会場にする予定）。4枚は「取得Worker」「提供Worker」「自動取得」「電文処理」 | §5.1 |
| C2 | 「取得健全性」カードは廃止。評価時刻・「評価対象外」表示もほかへ移さず削除（取得元の表で分かるため） | §3, §5 |
| C3 | 旧「スケジュール」（適用中の時間帯・次の切替・定期取得の設定なし）は「自動取得」カードに統合 | §5.2 |
| C4 | 「電文処理」カードは初回同期と未判定警報電文を統合。主表示の優先: 準備失敗 ＞ 初回同期中 ＞ 再処理中 n/N ＞ 未判定 N件（0件は「未判定なし」）。補足行: 同期の段階、または「起動時再処理 完了」。気象データ読取失敗は補足行にエラー色。未判定件数は `countPendingWarningTelegramReceptions` を使い、監視 DTO・API で通常運転中にも返す。対象は警報系電文のみ、表示対象会場の値 | §4.3, §5.3 |
| C5 | ツールバーは階層式。取得操作 ▸ 取得開始／取得停止／強制更新（ルート直置きか子階層かは製造時の実測で決定。§6.1・U12）。Worker ▸ 取得再起動／提供再起動（全角5文字以内、選択→送信の2段階、送信ボタンを取得操作専用から拡張、読み上げ名は選択操作に追従、押せないときも表示し理由はカードの再開可否で示す）。履歴 ▸ 受信／電文／通知出力／Worker（旧「出力履歴」は「通知出力」へ改名、Worker再開履歴は既存履歴と同じダイアログ方式）。状態診断はルート | §6 |
| C6 | 強制再起動（報告 fresh だが動作異常の Worker の再起動）は今回設けない。別 Issue で扱う | §13 |
| C7 | #257/#258 の仮UIは流用しない | §1, §7 |
| C8 | 【確定（#258設計の2026-10-09追加判断）】両Workerとも報告が stale になっただけでは failed にせず、処理と新規要求の受付を継続する。stale の間は表示・通知・再開可否だけを示す。実際の要求失敗・プロトコル異常・終了は従来どおり failed。提供系は読取結果の期限・世代・scope 検証を維持。長期途絶を failed に切り替える上限時間は設けない（今後の検討課題）。本書はこの前提で両系とも「稼働中」のまま「応答を確認できません」と表示し、再開可能とする。#258設計（冒頭【確定】・§6・AC6）と照合し、stale で自動停止・terminate・spawn しないこと、stale からの手動再開を受け付けること、role×世代の応答不明通知は復帰後の再staleでも追加しないこと、実際の通信/制御失敗・protocol/handshake異常・初回受付期限超過・初期化失敗・error/exit は failed 等とすることが一致している。マージ版でも stale は通知だけで lifecycle を変えない（`acquisitionWorkerHost.ts` 76〜79行、`deliveryWorkerHost.ts` 51〜57行）、通知は `世代:code` の鍵で1回（取得 81〜85行、提供 59〜66行）ことを確認した。実挙動は D9(5) で結合確認する | §4.2, §9 |
| C9 | system通知のうち §9 の Worker 系と取得操作の結果不明に限り、区分・文面・統合を本 Issue で扱う（Issue本文「非対象: 通知区分の変更」の例外）。それ以外の system 通知は区分も文面も変えない | §9 |
| C10 | 通知領域最下段の行（operationMessage）は「領域: 状況」形と「〜が完了しました」形に揃える。再起動は「取得再起動: 受付済み／準備中」「取得再起動が完了しました／失敗しました」「取得再起動: 結果不明」、提供系も「提供再起動: …」 | §6.4 |
| C11 | 未判定 N件（N≥1）の電文処理カードは attention（旧論点1） | §4.4 |
| C12 | 提供Workerカードは3行目を状況に応じて差し替え、カード高さは固定（旧論点2） | §5.2, §5.5 |
| C13 | 再起動の結果不明は今回は再読込で解除する運用。「結果確認」ボタンは足さない（旧論点7） | §4.2, §12（解消済み U4） |
| C14 | 1920×960 で収まらない場合は縦スクロールを許す。1920×1080 はスクロールなしを維持（旧論点3） | §5.3, D8 |
| C15 | 最小幅 360 px（旧論点8） | §10 |
| C16 | 取得操作と再起動は独立させ、互いにブロックしない（旧論点5） | §6.1 |
| C17 | 再起動完了通知は、再起動を要求した世代についてだけ1回出し、通常の起動では出さない | §9.2 |
| C21 | 自動取得が停止のまま（`desiredRunning === false`）取得Workerを再起動した場合は、Worker の準備完了（`prepared` 受領）で完了とし、カード結果行は「起動済み・自動取得は停止のまま」とする。自動取得が有効な場合は従来どおり初回同期完了で完了とする（旧§14論点2、案A） | §5.4, §6.4, §9.2 |
| C22 | 統合で使わなくなる ID（`system-initial-sync-failed`、`system-weather-acquisition-control-failed`、`system-weather-delivery-control-failed`）の定義は残し、新規の発出だけを止める（過去の出力履歴の表示を壊さないため。旧§14論点3、案A） | §9.2 |
| C18 | 再起動要求が 409（状態の競合）のとき、最下段の行に「取得再起動: 実行できません」「提供再起動: 実行できません」を出す。理由はカードの「再開可否」で示す | §6.4, D5, D6 |
| C19 | #258 の引き継ぎ表にある「同じIDで結果を再確認する」機能は、本 Issue の機能要件から外す（オーナー判断）。再起動できればカードで状態を確認できるため | §1.2, §6.2 |
| C20 | 応答不明（stale）の system 通知は、#258 の「question 系の既存方針を踏襲」を本 Issue で変更し、警報とする（#258 の設計書は修正しない） | §9.2 |

いずれも製造後にオーナーが UI を監修する前提で確定とする。

### 2.1 製造後の監修による追加確定事項（2026-10-09）

製造報告とオーナーの UI 監修を受けて確定した。下表が本文の記述と矛盾する場合は下表を優先する。

| # | 確定事項 | 置き換える記述 |
| --- | --- | --- |
| C23 | 対象画面幅は HD 相当（1280×720）と 11インチ iPad 横向き（1194×834）以上、およびフルHD（1920×1080・1920×960）。iPad 縦向き・360 px は想定しない | C15、§10 |
| C24 | 取得操作はルートに直接置く（案A）。iPad Pro 横向きでスクロールなしに収まることをオーナーが確認済み | §6.1 案A/B、U12、§14 論点1 |
| C25 | （改訂。C39 に置き換え） | — |
| C26 | 「集計受領」は提供Workerカードから外し、ツールバー右端の「画面更新 時刻」の隣へ移す。正常時は表示せず、古いときだけ「集計 鮮度低下」「集計 未受領」を attention で出す（画面全体の値の鮮度を表すため） | §5.2 提供Worker 2行目、F14 |
| C27 | ツールバーの規約: 監視画面に戻ったとき（ナビレール経由を含む）は常に最初のメニュー（ルート）を表示する | §6、§8 |
| C28 | メニュータイトルの幅はボタン1つ分（120 px）とし、MD3 のタイポグラフィトークンで少し太字にする | §6 |
| C29 | （撤回。C34 に置き換え） | — |
| C30 | 使われなくなる仮UI（`WeatherWorkerPanel.tsx`、専用CSS、旧関数 `weatherWorkerLabel`／`weatherRestartResult`、旧パネル描画テスト、`recheck` 経路）は本 Issue で削除する | §7 |
| C31 | 製造で判明した差異を追認する: 取得Workerの `WeatherRuntimeStatus.prepared` 追加（C21 の判定信号）、web の異常コード検証の既存不具合修正、カード高さは実測値に従う、区分を警報へ変えた定義の確認方式は `byCategory` | §4、§5.5、§9.2 |
| C32 | api テストの既存失敗（#258 マージ直後の main で既に失敗していたもの）は本 Issue で修正しない。検収では着手前と失敗集合が一致することを確認する | D10 |
| C33 | Worker 系通知は「題名＝気象Worker＋現象名（準備失敗／停止／応答不明／再起動完了）」「対象＝取得系／提供系」「内容＝停止理由（停止）・理由（準備失敗、ある場合）・なし（応答不明・再起動完了）」とする。表示例: `気象Worker停止　取得系　予期しない終了`。警報へ区分を変えた5件の確認操作は `none` とする | §9.1, §9.2（C20 等の題名） |
| C34 | 初回同期失敗を統合した通知は、題名「気象Worker準備失敗」・対象表示名「取得系」・内容「会場名 段階名」（段階名: 電文再処理／サービス準備／XML初回取得／会場評価）とする。配信範囲判定のため、対象の会場コード（`codeType:'venue'`）と重複抑止の単位（サーバー世代・段階・会場）は保持する | C29, §9.2 |
| C35 | 警報履歴の情報種別は `weather_worker` を「気象Worker」、`initial_sync` を「初回同期」と表示する | §9 |
| C36 | 取得Workerの準備完了（`prepared`）前は、報告が途絶えても `report_stale` 通知を出さず、カードは「準備中」と表示する。`reportFreshness`・`restartAllowed`・他の異常検知は変えない。実データ（約3.1 GB）で準備完了まで約42秒、報告途絶は最長約31秒と実測した。準備処理の非同期化は別 Issue の検討課題とする | §4.2, §9.2 |
| C37 | `WeatherRuntimeStatus` に処理中の範囲 `pendingScopes` を追加し、`unknownScopes` は応答喪失などで結果を確認できない範囲だけとする。読み出しの公開ゲートは両者の和集合で従来どおり抑止する。画面の「結果不明 n件」は `unknownScopes` だけを数える | §4.2, §5.4 |
| C38 | 11インチ iPad 横向きのツールバーは、ルート直置き（C24）のままとする。ブラウザペインの 1194×834 では中央領域に横スクロールが出るが、実機（iPad Pro）で収まることをオーナーが確認済み | C23, C24 |
| C39 | カード4枚はすべて「見出し・状態・詳細1行」の3行構成とし、最小高さは 112 px（main と同じ）とする。Workerカードの詳細は 再起動結果 → 理由 → 結果不明 n件 → 「応答を確認できません（最終報告 時刻）」 → 「最終報告 時刻」 の優先で1つ。再開可否は詳細に出さない。自動取得は「時間帯　次 時刻」（定期取得の設定なし時はそれのみ）、電文処理は読取失敗を優先した補足1つ | C25、§5.2、§5.5 |
| C40 | 最下段の行で取得・提供の再起動結果が並ぶ場合、受付済み・準備中の再起動がある系を優先する。同じ要求の間の「準備中」と「完了」の往復は状態変化とみなさない | §6.4 |
| C41 | 提供Workerの再起動は、reader 未接続（取得Worker再起動中など）で受け付けた場合も世代を追跡し、後の再接続で集計を受領した時点で再起動完了通知を1回出す（PR #265 レビュー指摘） | §9.2 |
| C42 | Workerカードの見出しの右に「再起動可」バッジを出す。条件はツールバーの再起動ボタンが押せる条件と同じ（サーバーの `restartAllowed` かつ当該系の再起動が進行中でない）。色は既存の attention 系トークン。見出し行の高さは固定でカード高さを変えない。自動取得カードの詳細は「時間帯 HH:MM–HH:MM」とし、時間帯の終端と同じ「次の切替」は出さない（C39 の自動取得の記述を改訂） | §5.2, C39 |

## 3. 現行画面の棚卸し（D1の対応表の元）

| # | 既存の情報・操作 | 出典 | 変更後の配置 |
| --- | --- | --- | --- |
| F1 | 運転時間（メイン） | minor-monitoring-uptime | 更新行「メイン 運転時間」 |
| F2 | 最終表示更新・監視取得失敗 | #74/#187 | 更新行「画面更新」。元データ時刻と別ラベル（所見5） |
| F3a | 取得運転: 自動取得有効/停止 | #74/#75 | 「自動取得」カード主値 |
| F3b | 取得運転: 初回同期・初回準備失敗 | #74 | 「電文処理」カード主値（準備失敗・初回同期中）と補足行（同期の段階） |
| F3c | 取得運転: 取得状態未確認（取得報告なし） | #257 | 「取得Worker」カードの「報告待ち」 |
| F4 | 取得健全性（6系列最悪値・評価時刻・評価対象外） | #74 | **削除**（C2）。取得元別の表（F7）で代替 |
| F5 | スケジュール（時間帯・次の切替・設定なし） | #74 | 「自動取得」カード詳細行（C3） |
| F6 | 処理待ち（起動時再処理進捗・読取失敗補足） | #74 | 「電文処理」カード（再処理中 n/N、補足「起動時再処理 完了」、読取失敗はエラー色補足） |
| F7 | 取得元別の稼働状況表 | K6 | 位置・内容不変 |
| F8 | 情報別の反映状況表 | K7 | カード帯・取得元表の下。内容不変。会場帯見出しは廃止（C1） |
| F9 | 取得開始／取得停止 | #43/#75 | 「取得操作」グループ（配置は §6.1、製造時の実測で決定）。選択→送信・requestId・E11不変 |
| F10 | 強制更新 | #43/#75 | 同上 |
| F11 | 受信履歴／電文履歴／出力履歴 | #75 | 子階層「履歴」の「受信」「電文」「通知出力」（改名のみ。ダイアログ内容不変） |
| F12 | 状態診断 | K8 | ルート。不変 |
| F13 | `<<`/`<`・階層タイトル・クリア・送信 | #75 | 不変。送信ボタンは再起動にも使う（§6.2） |
| F14 | 気象集計の最終受領・鮮度低下（#258仮） | #258 | 「提供Worker」カードの「集計受領」行 |
| F15/F16 | 取得/提供Worker 状態・最終報告・理由・再開・結果（#257/#258仮） | #257/#258 | 状態は各Workerカード、再起動はツールバー「Worker」階層 |
| F17 | 再開履歴（仮: 画面内 details 開閉） | #257/#258 | 子階層「履歴」の「Worker」ダイアログ（画面内一覧は廃止） |
| F18 | 結果不明scope | #257 | Workerカードの補足行＋Worker履歴ダイアログ上部 |
| F19 | system通知（Worker 8種＋初回同期失敗＋取得操作の結果不明） | #257/#258/#43 | §9 の表に従い統合・区分変更・題名/対象/内容を再設計。配信範囲・H/K不変 |

削除する情報は F4（取得健全性カード・評価時刻・評価対象外表示）のみ（C2）。操作の削除はない。

## 4. 状態モデル（表示用の派生）

### 4.1 入力

- `MonitoringStatusResponse.weatherRuntimes.{acquisition,delivery}`（`WeatherRuntimeStatus`）
- `MonitoringStatusResponse.weatherSampleReceivedAt`（任意・null可）、`generatedAt`、`readiness`（`initialFetchPhase`、`preparationFailures`）、`operation`（取得運転意図・スケジュール）、起動時再処理進捗（`venues` のうち `venueId === requestedVenueId` の `reprocessing`）、読取失敗（`readErrors`。要素の `code` は `weather_data_read_failed`）
- 新規: 未判定警報電文件数（§4.3）
- 監視取得の読込状態 `MonitoringLoadState`
- role別の `WeatherRestartState`（`phase` が `idle`/`sending`/`checking`/`unverifiable`/`conflict`/`rejected`/`completed`。`weatherRestartController.ts` 8〜18行）
- 停止・異常の理由: `failureCode ?? stopReason` を `reasonLabels`（`weatherWorkerPresentation.ts` 15〜24行）の語で表す。提供Workerは `stopReason` に異常理由を入れず `failureCode` だけに入れる（`deliveryWorkerHost.ts` 75〜90行）ため、`stopReason` だけで判定しない

### 4.2 Worker表示状態の優先順位

役割ごとに上から最初に一致したものを状態とする。`presentWorker(role, input): WorkerView` を純関数で置く。

| 優先 | 条件 | 状態文言 | トーン | 再開可否（カード表示） | 再起動ボタン |
| --- | --- | --- | --- | --- | --- |
| 1 | 監視取得失敗中、またはデータ未取得 | 状態不明 | neutral | 再起動不可: 監視の応答待ち | 押せない |
| 2 | `mode === 'inline'` | Worker未使用 | neutral | 再起動不可: Worker未使用 | 押せない |
| 3 | ローカル `sending`/`checking`、または `lifecycle === 'restarting'` | 再起動中 | attention | 再起動中 | 押せない |
| 4 | `lifecycle === 'stopping'` | 停止を確認中 | attention | 再起動不可: 停止確認中 | 押せない |
| 5 | `lifecycle === 'failed'` | 異常停止 | error | 再起動可 | `restartAllowed` に従う |
| 6 | `lifecycle === 'stopped'` かつ `stopReason === 'requested'` | 停止 | neutral | 再起動可 | 同上 |
| 7 | `lifecycle === 'stopped'`（上記以外） | 異常停止 | error | 再起動可 | 同上 |
| 8 | `reportFreshness === 'stale'`（lifecycle は failed/stopped 以外） | 稼働中 | attention | 再起動可。詳細1行目を「応答を確認できません（最終報告 時刻）」に置換 | 同上 |
| 9 | `reportFreshness === 'unknown'` | 報告待ち | neutral | 再起動不可: 報告待ち | 押せない |
| 10 | `lifecycle === 'starting'` | 準備中 | attention | 再起動不可: 準備中 | 押せない |
| 11 | `lifecycle === 'ready'` | 稼働中 | normal | 再起動不要（稼働中） | 押せない |

- 優先6/7: 提供Workerはマージ版で `stopped` にならない（`deliveryWorkerHost.ts` に `stopped` の代入なし。異常終了は `failed`＋`failureCode: 'unexpected_exit'`、135行）。表は両role共通のまま置き、提供では優先6/7に一致しないだけとする。
- 優先8は C8 を前提とし、マージ版で stale が lifecycle を変えないことを確認済み（§2 C8）。状態語は「稼働中」のままだが、トーンを attention にし「応答を確認できません」を必ず出すことで、古い正常報告を現在正常と表示しない（D3）。優先8は優先11より上。
- `restartAllowed` はサーバー投影値を唯一の根拠とする。優先5〜8でも `false` なら「再起動不可: サーバーが許可していません」とし押せない。UI側推測で有効化しない。
- ローカル `unverifiable` の role は「再起動不可: 結果確認待ち（再読込で解除）」。今回は再読込で解除する運用（C13）。
- 用語: ボタン文言は C5 の「再起動」、#257/#258 API・履歴の内部語は「restart」。画面上の語は「再起動」に統一する（カードの再開可否行・結果文言・履歴ダイアログ）。

### 4.3 未判定警報電文件数（監視 DTO・API 追加）

- 追加フィールド案: `MonitoringStatusResponse.warningTelegrams: { venueId: VenueId; pendingCount: number } | null`（名称は製造の裁量、shared の型に置く）。`null` は読取失敗（既存の読取不能セクションと同じ扱い）。
- 値: 表示対象会場 `venueId` について `countPendingWarningTelegramReceptions(connection, venueId)` の戻り値。対象は警報系電文のみ（関数の既存定義に従い、条件は変えない）。
- 通常運転中・起動時再処理中・初回同期中のいずれでも毎回返す。
- 注記: 表示対象会場の値である。単一会場化すれば全体の値と同じになる（UI上にも表示しない注記として設計書にのみ記す。ラベルは「未判定 N件」で会場名は出さない）。
- 【確定】計算箇所: 提供Worker内の監視組立（`apps/api/src/monitoring/monitoringStatusService.ts` の `createMonitoringStatusService`、`monitoring.sample` 経由。`createDeliveryRuntime.ts` 211〜214行）で、標本の要求端末の会場 `terminal.venueId` について数え、標本 DTO に含める。メインの監視GET（`startWorkerServer.ts` 598行〜）は標本を `...sample` で展開するため追加の合成は不要。標本が無いときの応答（`unavailableMonitoring` の分岐）では `null` を返す。メインプロセスでは数えない（気象DBの読取は提供Workerの責務）。
- 実行頻度: 標本採取は端末ごとに5秒間隔（`createApplicationRuntime.ts` 375〜394行）で、監視GETの回数には比例しない。COUNT は「5秒×端末数」回実行される。
- 性能: 件数・インデックスを製造時に確認し、1回 10 ms を超える場合は統括へ報告する（製造時の実測項目。§12 U11）。
- COUNT が例外を投げた場合は `warningTelegrams: null` とし、`readErrors` は増やさない（`MonitoringReadError.section` の値域を変えないため）。

### 4.4 電文処理カードの主表示

上から最初に一致したものを主値とする。

| 優先 | 条件 | 主値 | トーン | 補足行 |
| --- | --- | --- | --- | --- |
| 1 | `preparationFailures` 1件以上、または `initialFetchPhase === 'failed'` | 準備失敗（n件。phase だけの失敗は件数なし） | error | 失敗の要約（`readiness.errorReason` または先頭の失敗。1行省略＋title） |
| 2 | `initialFetchPhase` が `not_started`/`running` | 初回同期中 | attention | 同期の段階（既存 phase 文言） |
| 3 | 表示対象会場の `reprocessing.status === 'running'` | 再処理中 n/N（`processedCount`/`total`） | attention | 同期の段階、または「起動時再処理 完了」の該当する方 |
| 4 | それ以外・`pendingCount >= 1` | 未判定 N件 | attention（C11） | 「起動時再処理 完了」 |
| 5 | それ以外・`pendingCount === 0` | 未判定なし | normal | 「起動時再処理 完了」 |
| — | `warningTelegrams === null` または `readErrors.length > 0` | 上記の主値を維持（件数不明時は「未判定 —」） | 主値どおり | 「気象データを読み取れません」をエラー色（`--md-sys-color-error`）で補足行に追加 |

- 【確定】DB失敗を表す専用フィールドはマージ版にも無い。「準備失敗」は `readiness`、「読取失敗」は `readErrors`（`monitoringStatus.ts` 215〜220行）と `warningTelegrams === null` で表し、新しいフィールドは足さない。
- 取得Workerの再起動直後は `readiness` が `not_started` に戻る（`acquisitionWorkerHost.ts` 137行で `report` を null にし、`startWorkerServer.ts` の監視GETが `not_started` を補う）。この間は「初回同期中」を出す。

- 補足行は最大2行（段階/完了 1行＋読取失敗 1行）。

### 4.5 Issue D2 の各状態と表示の対応

| D2状態 | 取得Worker | 提供Worker | 電文処理 | 再起動ボタン |
| --- | --- | --- | --- | --- |
| 正常 | 稼働中 | 稼働中／集計受領 時刻 | 未判定なし | 両方押せない（再起動不要） |
| 準備中 | 準備中 | 準備中／集計 未受領 | 初回同期中 | 押せない |
| 取得のみ通常停止 | 停止 | 稼働中 | 主値どおり | 取得のみ押せる（許可時） |
| 取得のみ異常停止 | 異常停止（理由） | 稼働中 | 主値どおり | 取得のみ |
| 提供のみ異常停止 | 稼働中 | 異常停止（理由）、集計 鮮度低下 | 主値どおり | 提供のみ |
| DB失敗 | 状態どおり | 状態どおり | 準備失敗 または 主値維持＋読取失敗補足（§4.4） | Worker 状態（§4.2）どおり。DB失敗そのものでは押下可否を変えない |
| 再起動中 | 再起動中＋結果行 | 同 | 主値どおり | 該当roleは押せない |
| 再起動失敗/結果不明 | 状態どおり＋結果行 | 同 | 主値どおり | 失敗: 許可時に押せる。不明: 押せない（再読込で解除、C13） |
| 再起動受付後の接続失敗 | 異常停止（理由）＋「起動済み・接続に失敗」 | 同 | 主値どおり | 許可時に押せる |
| 報告途絶（C8前提） | 稼働中（attention）＋「応答を確認できません」 | 同 | 主値どおり | 許可時に押せる |

「取得停止」操作（F9）による自動取得停止は Worker 状態ではない。取得Workerは「稼働中」のまま、自動取得カードが「停止」を示す（D4）。

## 5. 監視本体の刷新

### 5.1 構成

```
更新行   画面更新 10:31:20（取得失敗時は失敗文言）        メイン 運転時間 3日 04:12
カード帯 [取得Worker][提供Worker][自動取得][電文処理]   （全体の1段・4枚。会場帯なし）
取得元表 （不変）
情報別の反映状況表（不変。会場見出しは置かない）
ツールバー（§6）
```

| 判断 | 根拠 |
| --- | --- |
| 4枚1段・会場帯廃止 | C1、所見4 |
| 取得健全性カード削除 | C2 |
| 自動取得へスケジュール統合 | C3、所見2 |
| 電文処理で初回同期・再処理・未判定を統合 | C4、所見1・2 |
| Worker生存・鮮度は Worker カードだけに置く | 所見3 |
| 時刻はすべて意味ラベル付き（画面更新／最終報告／集計受領／次の切替） | 所見5 |
| 総合判定カード・総合色は置かない | 既存の意味の維持 |

### 5.2 各カード

既存 `MonitoringCardView` の外形（48 pxアイコン円、`h2` タイトル、24 px主値、詳細行）を再利用する。カード内にボタンは置かない。

| カード | 主値 | 詳細行（最大3行） | トーン | アイコン案 |
| --- | --- | --- | --- | --- |
| 取得Worker | §4.2 の状態 | 1: 最終報告 時刻（経過）／2: 再開可否（§4.2）／3: 理由・結果不明 n件・直近の再起動結果のうち優先度の高い1つ（§5.4） | §4.2 | `cloud_download` |
| 提供Worker | §4.2 の状態 | 1: 最終報告 時刻（経過）／2: 集計受領 時刻・鮮度低下・未受領／3: 再開可否、理由・再起動結果は優先度順で1つ（C12） | §4.2 | `dns` |
| 自動取得 | 有効／停止／取得報告なし時「—」 | 1: 時間帯 05:00–18:00（設定なしは「定期取得の設定なし」）／2: 次の切替 18:00（設定なしは行なし） | 有効=normal、停止=neutral | `settings` |
| 電文処理 | §4.4 | §4.4 の補足行（最大2行） | §4.4 | `checklist` |

- 自動取得の主値は運転意図のみ。取得Workerが止まっていても「有効」は残す（実際の停止は取得Workerカードで示す）。
- 提供Workerは詳細が4種あり3行に収まらない。3行目を「再起動結果（直近・未確定のもの）→再開可否（押せないときのみ）→理由」の優先で1つ出し、カード高さは固定する（C12）。出せなかった情報は Worker 履歴ダイアログで確認する。

### 5.3 列数（ビューポート幅基準）

| 幅 | カード帯 |
| --- | --- |
| ≥1280 px | 4列（#74 の境界を流用） |
| 760〜1279 px | 2列×2段 |
| ≤759 px | 1列×4段 |

本体高さは K1予算のカード112 pxを約136 px（詳細3行）に置き換える。会場帯・健全性が無くなるため 1920×1080 で概算 744+24=768 px ≤ 888 px、1920×960（本体768 px）でほぼ上限。いずれも設計値であり、製造時に実測して確定する（U7）。960で超過した場合は本体の縦スクロールを許す。1920×1080 ではスクロールなしを維持する（C14）。1080 で超過した場合は製造で余白を詰めず統括へ報告する。

### 5.4 Workerカードの再起動結果表示（D6）

詳細行に直近の再起動結果を出す（`role="status" aria-live="polite"`、省略時は `title` に全文）。「再起動要求」「Worker起動」「準備/提供」を分けて書く。

| controller / 応答 | 表示 |
| --- | --- |
| sending/checking | 再起動を確認中 |
| completed success・取得・準備未完 | 起動済み・気象準備中 |
| completed success・取得・準備完了 | 起動済み・準備完了 |
| completed success・取得・準備失敗 | 起動済み・気象準備に失敗 |
| completed success・取得・`desiredRunning === false` | 起動済み・自動取得は停止のまま |
| completed success・提供・ready でない／集計未受領 | 起動済み・提供準備中 |
| completed success・提供・ready かつ集計鮮度OK | 起動済み・提供中 |
| completed success の後、同じ世代が `lifecycle === 'failed'`（下記の判定。reader接続・handshake・protocol 異常など） | 起動済み・接続に失敗（理由） |
| completed success だが現在の世代が completed の世代と異なる | 起動済み（以後の状態はカード主値で示し、合成しない） |
| completed failure | 再起動失敗（理由） |
| completed unknown / unverifiable | 再起動結果不明 |
| conflict (409) | 状態が変わったため再起動せず |
| rejected (400) | 再起動要求を受付不可 |
| historyRecorded=false | 末尾「・履歴未記録」 |

#### 受付後の接続失敗と完了の判定【確定】

マージ版で判定に必要な情報は揃っている。`G = operation.workerGeneration`（completed success の世代。`apps/api/src/services/weatherWorkerControlService.ts` 145〜166行で再開後の `runtime.workerGeneration` を記録）、`R = weatherRuntimes[role]` とする。

| 判定 | 条件 | 根拠 |
| --- | --- | --- |
| 世代一致 | `G !== null && R.workerGeneration === G` | 提供の reader 接続失敗は世代を変えずに `failed` にする（`deliveryWorkerHost.ts` 172〜195行。`startWorkerServer.ts` 519〜521行は再開を成功のまま返す） |
| 受付後の接続失敗 | 世代一致 かつ `R.lifecycle === 'failed'` | 理由は `R.failureCode`（reader 接続失敗は `initialization_failed`） |
| 取得の完了 | 世代一致 かつ `R.lifecycle !== 'failed'` かつ、`desiredRunning !== false` なら `readiness.initialFetchPhase === 'completed'`、`desiredRunning === false` なら Worker の準備完了（`prepared` 受領）（C21） | 再起動で `report` が null に戻るため、旧世代の completed は残らない（`acquisitionWorkerHost.ts` 137行） |
| 提供の完了（提供可能） | 世代一致 かつ `R.lifecycle === 'ready'` かつ `weatherSampleReceivedAt` が「completed 受領後に最初に得た監視応答の `generatedAt`」より後で、かつ `generatedAt` との差が15秒以下 | `weatherSampleReceivedAt` は再起動前の標本時刻を引き継ぐ（`startWorkerServer.ts` の `lastSampleReceivedAt`）ため、時刻の比較だけでは旧標本を誤って新しいと判定する。基準時刻はどちらもサーバー時計 |

- `G === null` または世代不一致のときは接続失敗・完了のどちらも判定せず、§6.4 の行は「準備中」から進めない。カード結果行は「起動済み」とする。
- 15秒は `projectWeatherRuntimeStatus` と同じ値（`weatherRuntime.ts` 58行）。web では `weatherWorkerPresentation.ts` に名前付き定数として置き、`WeatherWorkerPanel.tsx` 68行の直書きは使わない（shared への切り出しは製造の裁量）。
- `desiredRunning === false` での取得の完了判定は C21。

ボタン押下だけで「準備完了／提供中」にしない。completed の operation を保持し、監視の現在状態と毎回合成する。カード上の結果行と §6.4 の operationMessage・§9 の再起動完了通知は同じ合成結果から作り、食い違わせない。

### 5.5 状態で寸法が変わる箇所（G-10）

| 箇所 | 状態による変化 | 抑止策 |
| --- | --- | --- |
| Workerカード高さ | 詳細行: 正常=最終報告＋再開可否（2行）、異常=＋理由（3行）、再起動後=＋結果（3行目を差替え）、結果不明=＋n件（同）、応答不明=1行目が「応答を確認できません（最終報告 時刻）」に伸長 | 詳細3行分を固定高さで予約（C12）。4行目は出さず3行目を優先度で差替え。各行1行省略＋`title` |
| 通知領域最下段（operationMessage） | 「取得再起動: 受付済み」〜「提供再起動が完了しました」で文字数が変わる。取得操作の行と同時に2件出る場合がある（C16） | 既存の行の高さ・省略規則に従う。2件同時時は §6.4 末尾の規則（最後に変わった方を表示し `title` に両方） |
| 提供Workerカード | 集計受領行の文言長（時刻／鮮度低下／未受領） | 同上 |
| 自動取得カード | 設定なし時は詳細1行、ありは2行 | 3行予約に含まれる |
| 電文処理カード | 主値の長さ（「再処理中 1234/5678」「準備失敗（n件）」「未判定なし」）、補足0〜2行 | 主値は1行省略＋`title`、補足は3行予約に含む。読取失敗の追加で高さを変えない |
| 主値の幅 | 最長「状態不明」「停止を確認中」「再処理中 n/N」 | 1行省略＋`title`。24 pxで全角6文字＋数字を 1280 px時の約 280 px/枚で収める見込み【U7】 |
| 同じ行のカード | 上記の差 | grid の行で高さ揃え（`align-items: stretch`） |
| ツールバー | 階層ごとのボタン数（ルート4〜7、子3〜4）、階層タイトル有無 | 既存の固定幅タイトル領域・グループ単位折返し。ボタンは全て既存 120 px（5文字以内のため幅追加なし） |
| 送信ボタンの読み上げ名 | 選択中操作で変化 | 表示文言・幅は固定、`aria-label` のみ変える |
| ダイアログ | 履歴件数 | 既存骨組みの本文スクロール |

## 6. ツールバー（階層式）

### 6.1 階層定義

既存 `ToolbarDefinition`/`navigate` を使う。`<<`・`<`・階層タイトル・クリア・送信は現行どおり。

| 階層（title） | グループ | 項目 |
| --- | --- | --- |
| ルート | 1 | 案A: 取得開始・取得停止・強制更新（operation 直置き）／案B: 取得操作 ▸（navigate） （製造時の実測で決定。U12） |
| | 2 | Worker ▸（navigate）、履歴 ▸（navigate） |
| | 3 | 状態診断（dialog） |
| 取得操作（案Bのみ） | 1 | 取得開始・取得停止 |
| | 2 | 強制更新 |
| Worker | 1 | 取得再起動・提供再起動（新項目種別 `workerRestart`） |
| 履歴 | 1 | 受信・電文・通知出力（既存ダイアログ。「出力履歴」を「通知出力」へ改名） |
| | 2 | Worker（新ダイアログ `workerRestartHistory`） |

- 案A/Bの決定方法: 製造時に 1280 px・1920 px で案Aのルート（6ボタン＋間隔＋クリア/送信）が1行に収まるか実測する。1280 pxで折返す場合は案B。どちらでも取得操作の選択→送信の挙動は変えない。実測値を設計書に追記して統括の承認を得る【§14 論点1】。
- ボタン文言はすべて全角5文字以内（既存 120 px 固定幅）。「取得再起動」「提供再起動」「通知出力」「Worker」。
- 再起動ボタンは状態によらず常に表示する。押せないときは `softDisabled` とし、理由はカードの「再開可否」行で示す（ボタン下に理由行は置かない）。`aria-describedby` で該当カードの再開可否行を参照する。
- 2段階: 再起動ボタン選択 → 送信ボタンが送信可能表示 → 送信で POST。確認ダイアログは置かない（強制再起動は §13）。
- 送信ボタンは取得操作専用から「選択中の操作」の送信に拡張する。`aria-label` は選択操作に追従（例「取得再起動を送信」「取得停止を送信」、未選択時は既存どおり）。
- 送信中・結果は通知領域最下段の行（operationMessage、#75 A1 の共通操作行）に §6.4 の文面で出す。取得操作と再起動は独立で、互いにブロックしない（C16）。
- 階層移動・ダイアログ開閉で未送信の選択を解除（既存規則）。送信済みの再起動照会は監視画面離脱後も継続（既存 `useWeatherRestart` の寿命）。

### 6.2 型の追加

```ts
type ToolbarItem =
  | 既存3種（'operation' | 'dialog' | 'navigate'）
  | { kind: 'workerRestart'; role: WeatherRole; label: string };
interface ToolbarLocalState {
  history; openDialog;
  selectedOperation: FetchControlOperationKind | { kind: 'workerRestart'; role: WeatherRole } | null;
}
type MonitoringDialogId = 'reception' | 'telegram' | 'output' | 'diagnostics' | 'workerRestartHistory';
```

現行の定義は `monitoringToolbarState.ts` 3〜21行（`selectedOperation: FetchControlOperationKind | null`）。「出力履歴」の文言は同 38行。`selectedOperation` を参照する既存箇所（`monitoringOperationMessage.ts` 14〜16行の `operationLabel` など）は型の拡張に合わせて分岐させる。

送信は `selectedOperation` の種別で分岐し、取得操作は `fetchControl.ts`、再起動は `weatherWorkers.ts` の既存controllerへ渡す。取得操作から再開APIを呼ぶ経路を作らない。#258 の引き継ぎにあった「結果を再確認」項目は置かない（C13・C19）。

### 6.3 Worker履歴ダイアログ

- 既存の受信/電文/通知出力履歴と同じダイアログ骨組み（タイトル・本文スクロール・閉じる・ページング）。
- 上部「現在」: 取得/提供の §4.2 状態と結果不明scope全件。
- 表: 要求時刻／対象／結果（§5.4短縮形）／完了時刻／理由／要求ID（先頭8文字、`title`に全体と世代）。
- 取得失敗時は「Worker履歴を取得できません」＋再試行。閉じると「Worker」ボタンへフォーカスを戻す（既存 `monitoringDialogFocus`）。

### 6.4 通知領域最下段の行（operationMessage）

既存の「領域: 状況」形と「取得開始が完了しました」形に揃える（C10）。再開の受付と準備完了の区別（D6）はこの行と §9 の再起動完了通知で示す。

| 段階（§5.4 の合成結果） | 取得系 | 提供系 |
| --- | --- | --- |
| 選択中（未送信） | 取得再起動を選択中／送信で実行 | 提供再起動を選択中／送信で実行 |
| POST 受付（sending/checking・completed success 前） | 取得再起動: 受付済み | 提供再起動: 受付済み |
| completed success・準備未完／提供 ready でない | 取得再起動: 準備中 | 提供再起動: 準備中 |
| completed success・取得の完了（§5.4、C21）／提供可能 | 取得再起動が完了しました | 提供再起動が完了しました |
| completed failure・rejected・受付後の接続失敗（§5.4） | 取得再起動が失敗しました | 提供再起動が失敗しました |
| conflict（409） | 取得再起動: 実行できません | 提供再起動: 実行できません |
| completed unknown・unverifiable | 取得再起動: 結果不明 | 提供再起動: 結果不明 |

- conflict（409）は「失敗しました」とせず「実行できません」とする。理由は行に書かず、既存の監視再取得後のカードの「再開可否」で示す（C18）。
- 「準備中」→「完了しました」は監視ポーリングの更新だけで遷移する。
- 「完了しました」の判定条件は §9 の再起動完了通知と同一（取得: §5.4 の取得の完了（C21）、提供: 提供可能 = §5.4 の「起動済み・提供中」）。受付後の接続失敗では完了文面・完了通知を出さない。
- 履歴保存失敗（`historyRecorded=false`）は、行の末尾にも「・履歴未記録」を付ける（§5.4 と同じ合成結果）。
- 選択中の行は既存の取得操作の形（`monitoringOperationMessage.ts` 14〜16行「〜を選択中／送信で実行」）に合わせる。取得操作の既存文面（送信中・結果確認中・結果不明など）は変えない。
- 【確定】既存の `monitoringOperationMessage` は1行（`string | null`）を返す（同 10〜13行）。複数件の規則は無いため、取得操作と再起動の行が同時にあるときは、最後に状態が変わった方を表示し、`title` に両方を「／」でつないで入れる。選択中の行は常に最優先とする（選択はどちらか一方しか持てない）。

## 7. モジュール構成

| ファイル | 変更 |
| --- | --- |
| `packages/shared/src/monitoringStatus.ts` | §4.3 の `warningTelegrams` を `MonitoringStatusResponse` に追加 |
| `apps/api/src/monitoring/monitoringStatusService.ts` | 提供Worker内の標本組立で §4.3 の件数を毎回入れる。`countPendingWarningTelegramReceptions` を再利用（関数自体は変更しない） |
| `apps/api/src/runtime/unavailableMonitoring.ts`（または `startWorkerServer.ts` の標本なし分岐） | 標本なしの応答で `warningTelegrams: null` |
| `monitoringPresentation.ts` | カード定義を §5.2 の4枚へ置換。取得健全性・会場帯の派生を削除。再処理判定の既存純関数は電文処理で再利用 |
| `weatherWorkerPresentation.ts` | `presentWorker`・§5.4 の判定と結果文言に置換（`lifecycleLabels`・`weatherWorkerLabel`・`weatherRestartResult` の現行文言は破棄。`reasonLabels` の語は維持） |
| `MonitoringDashboard.tsx` | §5.1 の構成。`WeatherWorkerPanel` を使わない |
| `WeatherWorkerPanel.tsx` ほか仮UI | 不使用。削除は製造担当が統括へ確認してから（禁止事項6） |
| `WorkerRestartHistoryDialog.tsx`（新規） | §6.3 |
| `monitoringToolbarState.ts`、`useMonitoringToolbar.ts`、`MonitoringToolbar.tsx`、`MonitoringDialogHost.tsx` | §6 |
| `weatherRestartController.ts`、`useWeatherRestart.ts`、`api/weatherWorkers.ts` | 契約は #258 を正とし原則変更しない |
| `packages/shared/src/notificationMessageDefinitions.ts` | §9 の題名・内容・`allowedCategories`、再起動完了通知2件の定義追加 |
| `apps/api/src/runtime/startWorkerServer.ts` | `recordFailure`（224〜272行）の区分（現在 `question` 固定）・対象名・code→ID対応を §9 に合わせる。再起動完了通知2件の発出（§9.2） |
| `apps/api/src/notifications/initialSyncNotificationPlanner.ts`・`operationNotificationPlanner.ts` | `system-initial-sync-failed` の統合（56行）、`system-fetch-operation-unknown` の区分（72〜74行で `question`） |
| 停止理由の語 | web の `reasonLabels`（`weatherWorkerPresentation.ts` 15〜24行）と同じ語を通知内容にも使う（shared へ移すかは製造の裁量） |
| `monitoring.css` | 4列グリッド、カード高さ予約。色は `--md-sys-color-*` と既存トーンクラスのみ |
| fixture | `apps/web/src/monitoring/__fixtures__/workerStates.ts`（§4.5 の10状態＋inline、§4.4 の電文処理6状態） |

## 8. キーボード・フォーカス

- Tab順: 更新行 → カード帯（フォーカス対象なし）→ 表 → ツールバー。
- `navigate` 項目 Enter → 子階層の先頭項目へフォーカス（既存挙動を確認し、無ければ追加）。`<` で戻ると元の navigate 項目へフォーカスを戻す。
- 再起動を選択→送信後、フォーカスは送信ボタンに残る。状態変化でボタンDOMを差し替えない。

## 9. system通知の整理（区分変更を含む）

Issue 本文の「非対象: 通知区分の変更」の例外として、下表の Worker 系通知と取得操作の結果不明に限り本 Issue で扱う（C9）。それ以外の system 通知は区分も文面も変えない。

### 9.1 書き方

- 既存の決まりどおり「題名／対象／内容」で組み立てる。内容は短い名詞か省略。
- 「監視画面で…してください」のような文章は内容に入れない。
- Worker 系通知の対象欄はすべて「気象Worker」とする（現状の「気象取得Worker」「気象提供Worker」を置換。`apps/api/src/runtime/startWorkerServer.ts` の対象名付近）。

### 9.2 対象通知

| ID | 区分 | 題名 | 内容 |
| --- | --- | --- | --- |
| `system-weather-acquisition-initialization-failed` | 問いかけ | 取得系準備失敗 | 省略 |
| `system-initial-sync-failed` | 取得系準備失敗に統合 | — | — |
| `system-weather-acquisition-exited` | 問いかけ | 取得系停止 | 停止理由（`reasonLabels` の語） |
| `system-weather-acquisition-control-failed` | 取得系停止に統合 | — | 停止理由 |
| `system-weather-acquisition-report-stale` | **警報**（問いかけから変更。C20） | 取得系応答不明 | 省略 |
| `system-weather-delivery-initialization-failed` | 問いかけ | 提供系準備失敗 | 省略 |
| `system-weather-delivery-exited` | 問いかけ | 提供系停止 | 停止理由 |
| `system-weather-delivery-control-failed` | 提供系停止に統合 | — | 停止理由 |
| `system-weather-delivery-report-stale` | **警報**（#258 §6 の「question 系の既存方針を踏襲」を本 Issue で変更。C20） | 提供系応答不明 | 省略 |
| 【新設】取得系の再起動完了（ID は製造の裁量、既存命名規則に従う） | 警報 | 取得系再起動完了 | 省略。§5.4 の取得の完了（自動取得有効時は初回同期完了、停止時は準備完了。C21）の時点で出す |
| 【新設】提供系の再起動完了（同上） | 警報 | 提供系再起動完了 | 省略。提供系が提供可能になった時点で出す |
| `system-fetch-operation-unknown` | **警報**（問いかけから変更） | 取得操作の結果不明 | 省略 |

- 区分を変える・新設するのは5件（取得系応答不明、提供系応答不明、取得系再起動完了、提供系再起動完了、取得操作の結果不明）。鳴動・確認の扱いは既存の「警報」区分の規則にそのまま従い、区分ごとの規則自体は変えない。
- 統合: 統合元の事象は統合先の ID で出す。`system-initial-sync-failed` の事象は「取得系準備失敗」、control-failed の事象は「取得系停止／提供系停止」として、停止理由を内容に入れる。
- 統合で使わなくなる ID の定義は残し、新規の発出だけを止める（C22。統合元の ID は `NotificationMessageDefinitionId` の型（`notificationMessageDefinitions.ts` 27〜49行）と過去の出力履歴の両方から参照されうる）。
- 再起動完了通知の判定は §6.4 の「完了しました」と同一条件。再起動を要求した世代についてだけ1回出し、通常の起動では出さない（C17）。
- 【確定】区分はマージ版では2か所で決まっている。発出側の `category`（Worker系は `startWorkerServer.ts` の `recordFailure` で `question` 固定、取得操作の結果不明は `operationNotificationPlanner.ts` 72〜74行、初回同期失敗は `initialSyncNotificationPlanner.ts` 22行）と、定義の `allowedCategories`（いずれも `['question']`）。区分を変える5件は両方を `warning` にそろえる。現行の題名・内容（例: 取得系応答不明は「気象取得処理の応答不明」＋「…監視画面で状態を確認してください。」、`notificationMessageDefinitions.ts` 333〜342行）は §9.2 の表に置き換える。
- 再起動完了通知はサーバー（`startWorkerServer.ts`）で発出する。成功した再起動要求の `workerGeneration` を保持し、取得は §5.4 の「取得の完了」（その世代の報告で `initialFetch.phase === 'completed'`）、提供は「その世代の reader 接続成功後に作った提供アプリケーションで最初の監視標本を受領した時点」で1回出す。通知IDは `weather-worker:<role>:<世代>:restart_completed` の形にして、既存の `世代:code` の重複抑止と同じ鍵の考え方にそろえる。web 側の §6.4「完了しました」は §5.4 の判定で別に出し、両者の条件を同じ定義から書く。
- `system-initial-sync-failed` は現在、サーバー世代・段階・会場の単位で ID を作る（`initialSyncNotificationPlanner.ts` 20行）。「取得系準備失敗」に統合した後も、この重複抑止の単位は変えない（Worker 世代の単位に変えると、取得Worker再起動のたびに同じ失敗が再通知されるため）。
- 既存契約の維持: 結果不明を成功と推測しない。同じ操作を自動で再送しない。再開を、同じ事象の通知の再配信や確認状態のリセットに使わない。
- 応答不明（stale）は C8 のとおり failed とは別事象とする（#258設計で確定済み）。role×世代で1回、復帰後の再staleでも追加しない（#258 §6）。
- 配信範囲・H/K 扱いは変えない。停止時の閲覧可否は内容に書かない（旧 U8 は不要化）。

## 10. 対象画面幅

最小幅 360 px（C15）、代表幅 768・1280・1920×1080・1920×960。列切替境界 759/760・1279/1280 も確認する。

## 11. 受け入れ条件

前提: 検収は隔離した実ブラウザの専用タブ（[G-08](../rules/advisory/G-08-ui-measurement-pitfalls.md)）、ダークテーマ。fixture は §7、実操作は #257/#258 の実HTTP経路。UI の見え方はオーナー監修で最終判断するため、検収は下記の観点の実測・記録までとする。

- [ ] **D1 機能対応:** §3 の F1〜F19 を1行ずつ確認し、変更後の位置を記録した表を提出する。F4 は削除されていること（「取得健全性」「評価」「評価対象外」の文言が監視本体のDOMに0件）、会場帯見出しが0件であることをDOMで確認。取得開始/停止/強制更新の選択→送信・requestId・E11照会、受信/電文/通知出力履歴（内容は旧出力履歴と同一）、状態診断の既存テストが全件通過する。
- [ ] **D2 状態fixture:** §4.5 の10状態＋inline、§4.4 の電文処理6状態を表示テストに与え、各カードの主値・トーンクラス・詳細行、再起動ボタンの押下可否とカードの再開可否行が §4.2/§4.4/§4.5 と一致する。未判定1件以上で電文処理カードが attention であること。カードが常に4枚・1段（≥1280 px）であること。同じ fixture を1280 pxの実ブラウザで表示しスクリーンショットを残す。
- [ ] **D3 鮮度・時刻・件数:** `ready`＋`stale` で主値「稼働中」・トーン attention・詳細1行目「応答を確認できません」・再起動ボタン押下可（`restartAllowed: true` 時）となり、normal トーンの「稼働中」が出ないこと。`weatherSampleReceivedAt` が `generatedAt` の16秒前で「鮮度低下」、null で「未受領」。画面上のすべての時刻に「画面更新/最終報告/集計受領/次の切替」のいずれかのラベルが付くことをDOM走査で確認。優先順位を入れ替えた対照実装（優先8と11の入替え）で red になることを示す。監視APIの応答に未判定件数が通常運転中も含まれ、`countPendingWarningTelegramReceptions` の値と一致することを api テスト（0件・3件・会場違い）で確認し、0件で「未判定なし」、3件で「未判定 3件」と出る。
- [ ] **D4 識別:** 再起動ボタンが「Worker」階層だけにあることをDOMで確認。取得開始/停止/強制更新を送信したとき `/api/control/weather-workers/` への要求0件、両Workerの `workerGeneration` 不変を実HTTPで確認。送信ボタンの `aria-label` が選択操作（取得再起動/提供再起動/取得開始など）に追従する。
- [ ] **D5 二重要求・誤成功・独立性:** (a) 再起動を選択→送信を100 ms間隔で5回→POST 1件。(b) 送信中に監視が `restarting`→`ready` へ変化しても completed 受領まで成功表示なし。(c) POST応答6秒遅延で GET 照会へ移りPOST再送0件。(d) 500/ネットワーク断/30秒期限で「再起動結果不明」・operationMessage「取得再起動: 結果不明」、自動POST 0件、再読込で解除されること。(e) `restartAllowed: false` でボタンが押せず、カードに「再起動不可」の理由が出る。409応答時にカード結果行「状態が変わったため再起動せず」、operationMessage「取得再起動: 実行できません」（提供系は「提供再起動: 実行できません」）、監視再取得1回、カードの再開可否行に理由が出ること。(f) 再起動の送信中・結果不明中に取得開始/停止/強制更新を選択→送信でき、逆に取得操作の照会中に再起動を送信できる（C16）。各ケースを単体テスト化し、(a)(c)(d)(f) は実ブラウザでもネットワーク記録を残す。
- [ ] **D6 受付と準備:** §5.4 の各行と §6.4 の operationMessage 6段階×2系統（409の「実行できません」を含む）を単体テストで確認（文面が §6.4 と完全一致）。受付後の接続失敗（completed success の後に同じ世代が failed）で、カードが「異常停止」＋「起動済み・接続に失敗（理由）」、行が「取得再起動が失敗しました」（提供系も同様）となり、完了文面・完了通知が0件。`historyRecorded=false` でカード結果行・行の末尾に「・履歴未記録」が付き、Worker履歴ダイアログ側でも欠落が成功扱いされない。通常の起動（再起動要求なし）では再起動完了通知が0件。準備完了後に監視更新だけで「起動済み・準備完了」「取得再起動が完了しました」へ変わり、同時に「取得系再起動完了」通知が1件だけ出る（提供系も同様）。受付だけでは完了通知・完了文面が出ない。Worker履歴ダイアログで同じ requestId（先頭8文字＋title全体）・結果・理由を確認し、画面本体に再開履歴の一覧が無いこと。取得操作の operationMessage・requestId表示が回帰しない。
- [ ] **D7 端末・通知:** (a) H/K 各端末URLで監視画面の表示/操作範囲が変更前と同じ（変更前後スクリーンショットと既存テスト）。(b) §9.2 の全行について、通知定義テストで題名・対象「気象Worker」・内容（省略または停止理由の語）・区分が表どおりであり、内容に「してください」を含む文が0件。(c) 統合: `system-initial-sync-failed` の発生条件で「取得系準備失敗」が、control-failed の発生条件で「取得系停止／提供系停止」（内容=停止理由）が出る。(d) 区分を変えた・新設した5件が「警報」区分の鳴動・確認挙動になることを鳴動・確認テストで確認。(e) 回帰: §9.2 以外の system 通知の区分・文面が変更前と同一（定義のスナップショット比較）、既存の鳴動・確認テストが全件通過。(f) 再起動前後で通知確認状態が変わらず、同一事象の再配信0、再起動後の新規状態変化通知は抑止されない。結果不明の通知は成功扱いされず、自動再送0。
- [ ] **D8 幅・寸法・キーボード:** 360/768/1279/1280/1920×1080/1920×960 で `scrollWidth <= clientWidth`、カード間の矩形交差0、同じ行のカード高さが揃うことを記録。1920×1080 で本体 `scrollHeight <= clientHeight`。1920×960 は縦スクロールを許し、超過量を記録（C14）。§5.5 の各状態（Worker詳細2行/3行・応答不明、提供Worker 3行目の差替え各種、電文処理補足0/1/2行、主値最長）でカード高さの変化量0を実測。operationMessage の最長文面（「提供再起動が完了しました」）と取得操作の行が同時のときも通知領域の高さが変わらないこと。ツールバー各階層のボタン幅がすべて120 pxで文言が省略されないこと、§6.1 の案A/B判定の実測値を記録。マウスなしで ルート→「Worker ▸」→取得再起動→送信→結果確認→`<`→「履歴 ▸」→Worker→Esc→フォーカス復帰を通す。Tab・Enter・Space のそれぞれでボタンの選択・送信ができることを確認する。
- [ ] **D9 実結合:** 実Worker×2で (1) 取得Worker異常終了→「異常停止」・「取得系停止」通知→再起動→「取得再起動: 受付済み」→「準備中」→「取得再起動が完了しました」・「取得系再起動完了」通知、(2) 提供Worker異常終了→再起動→「起動済み・提供中」・「提供系再起動完了」通知、(3) 再起動失敗（初回受付不能のfailpoint）→「再起動失敗」「取得再起動が失敗しました」とWorker履歴、(3b) 再起動の受付成功後に接続失敗（handshake/reader接続のfailpoint）→「起動済み・接続に失敗」「提供再起動が失敗しました」、完了通知0件、(4) 未判定電文を残した状態で電文処理カードが「未判定 N件」（attention）を示す、を実施し各段階のスクリーンショット、コンソールエラー0を記録する。(5) heartbeat 停止で stale にし、両系とも「稼働中」（attention）＋「応答を確認できません」、応答不明通知（警報）1件、手動再起動が送信できること、failed の表示（異常停止・error トーン）と見分けられることを記録する。stale 継続（C8）はマージ版のコードで確認済みであり（§2 C8）、本項で実挙動を確認する。
- [ ] **D10 規約・品質:** `<md-*>` 生タグ0、HEX/RGB直書き0、bare import 0（grep）。`npm run lint`・`npm run typecheck`・`npm run format:check`・web/api/shared の対象workspaceテスト・`npm run build` 通過。

## 12. 製造時に実測して確定する項目と、解消済みの【未確定】

### 12.1 製造時に実測して確定する項目

コードからは決まらないため、製造時に実測し、結果を本書に追記して統括の承認を得る。

| ID | 内容 | 確定方法 |
| --- | --- | --- |
| U7 | 寸法（カード136 px、本体768 px、主値幅 約280 px/枚）と、階層遷移時のフォーカス移動の既存挙動 | §5.3・§5.5・§8 を実ブラウザで実測（D8） |
| U11 | 標本採取ごとの COUNT の実行時間（5秒×端末数回） | 製造時に計測し、1回 10 ms 超なら統括へ報告（§4.3） |
| U12 | 取得操作をルート直置き（案A）か子階層（案B）か | §6.1 の実測（§14 論点1） |

### 12.2 解消済み（#258 マージ版で確定）

| ID | 内容 | 確定した内容と根拠 |
| --- | --- | --- |
| U1 | `WeatherRuntimeStatus` の値域 | §1.1・§4.1 のとおり（`weatherRuntime.ts` 4〜26行）。`unknownScopes` は任意項目、`failureCode` は7値＋null。`report_stale` は値域にあるが、マージ版の Host は stale で `fail` しない |
| U2 | 提供 ready の判定 | マージ版の `weatherRestartResult`（`weatherWorkerPresentation.ts` 38〜51行）は `lifecycle === 'ready'` だけを見る。本書は §5.4 の「提供の完了」（世代一致・ready・再起動後の標本受領）に置き換える |
| U3 | DB失敗の表し方 | 専用フィールドは無い。`readiness`・`readErrors`・`warningTelegrams === null` で表す（§4.4） |
| U4 | `unverifiable` の解除 | 再読込で解除（C13）。controller は `unverifiable` から自動照会しない（`weatherRestartController.ts` 84〜90行） |
| U5 | 提供Workerの `unknownScopes` | 提供の `status()` は `unknownScopes` を返さない（`deliveryWorkerHost.ts` 75〜90行）。結果不明scope の表示は取得Workerだけに出る（`acquisitionWorkerHost.ts` 108行） |
| U6 | 集計鮮度15秒 | shared には名前付き定数が無い（`weatherRuntime.ts` 58行の直書き）。web の `weatherWorkerPresentation.ts` に定数を置く（§5.4） |
| U9 | 送信ボタンの2系統化と operationMessage 2件同時 | §6.2 の型拡張と §6.4 末尾の規則 |
| U10 | 未判定件数を数えるプロセス | 提供Worker内の標本組立（§4.3） |
| U13 | stale で failed にしない | §2 C8 のとおりコードで確認。実挙動は D9(5) |
| U14 | 統合で使わなくなる ID の扱い | C22 で確定（定義は残す） |

旧 U8（提供Worker停止時の閲覧可否）は、§9 の内容を省略・停止理由に絞ったため不要とした。

## 13. 申し送り・今後の検討課題

### 13.1 強制再起動（今回は設けない）

- 内容: 報告は fresh だが動作が異常な Worker を、確認ダイアログ付きで再起動する操作。
- 今回設けない理由: 報告途絶・異常終了・停止は既存の再開（停止→強制終了→終了確認）で救える。`restartAllowed` は stale も許可する（`packages/shared/src/weatherRuntime.ts`）。報告が fresh な Worker の再起動には #257/#258 の再開 API 契約変更が必要で、本 Issue の範囲外。
- 扱い: 将来、別 Issue で扱う。その際は API 契約（許可条件・理由記録）、確認ダイアログ、ツールバー上の配置（Worker 階層内で通常再起動と区別する文言）を検討する。

### 13.2 後続Issueへの引き継ぎ

- #260: 本画面と §9 通知を使った運用手順（異常停止→通知→Worker階層で再起動→再起動完了通知、結果不明時は再読込）の最終検収。
- 単一会場化（C1 の前提）が行われた場合、§4.3 の未判定件数は全体と同値になる。会場選択の廃止に伴う DTO の簡素化はその Issue で扱う。
- 長く続く報告途絶を failed に切り替える上限時間（C8）は今後の検討課題。
- 通知の問いかけ行からのクイックアクションは #263 で扱う。

### 13.3 検収で判明した後続課題（PR #265 時点）

1. 再起動完了後に同じ世代が異常終了すると、カードと最下段の行が「接続に失敗」に書き変わる（§5.4 の判定に時間の区切りがない）。
2. 取得Workerの準備中（実測で約40秒イベントループが止まる）に取得操作を送ると、期限超過で取得Workerが failed になる。C36 の準備処理の非同期化と同根。
3. D9(3) の「初回受付不能なら再起動失敗」の前提が、#257 の契約（`initial_accept_timeout` は結果不明）と食い違う。
4. 失敗コード `worker_exited` に対応する理由の語がなく、「再起動失敗」の後ろに理由が出ない。
5. 取得Workerが期限超過で failed になると、自動取得カードが「停止」と表示される（§5.2 と食い違い）。
6. 異常停止したまま生存している取得Workerの報告が途絶えると、応答不明の通知が重ねて出る。
7. 結果不明の後に `restartAllowed` が true だと再起動ボタンを押せる。§4.5 の「不明は押せない」の範囲が曖昧。
8. 提供Workerの再起動中に、取得・提供の両カードが 0.1 秒未満だけ「状態不明 再起動不可: 監視の応答待ち」になる瞬間がある（再検収で1回観測）。

## 14. 残るヒアリング論点

| # | 論点 | 選択肢 | 推奨 |
| --- | --- | --- | --- |
| 1 | 取得操作の配置（U12）の決め方 | A: 実測で1280 px 1行に収まれば直置き、折返すなら子階層（実測値を追記し統括承認）／B: 常に子階層 | **A** |

旧論点1・2・3・5・7・8は C11〜C16 として確定、旧論点6は C9 で確定した。改訂後の論点2・3は C21・C22 として確定した。
