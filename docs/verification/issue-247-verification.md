# Issue #247 製造検証記録

作成: Codex（GPT-6）。承認済み [設計書](../design/issue-247-split-weather-retained-db.md) に対応する。製造ブランチは `feature/issue-247-split-weather-retained-db`。設計コミットは `bcd3465`。

## 検証環境と対象

- better-sqlite3 の異なる物理ファイル2本を `mkdtemp` 配下に作成し、気象・保持接続と世代を明示注入した。実取得は合成応答に置換した。
- HTTPは `port:0`。自分のHTTPをcloseしてから両DB/leaseをcloseし、一時directoryを片付けた。
- APIは `NODE_ENV=production` と正式な待受権限を使用して共有会場設定を検証した。WebはReactのact/StrictModeを必要とするため通常の `npm run test -w apps/web` を使用した。
- 旧単一migration 0001〜0026は変更していない。最終DDLの業務表・FK・indexを新baselineと対照した。
- ルート `package.json` の既存web `--host` 差分は保持し、本件のstageにはreset scriptだけを含める。

## 受入条件の証跡

| 条件 | 実行内容・証跡 |
| --- | --- |
| AC1 | `databasePair.test.ts` の2物理DB/identity/checksum・最終DDL比較、旧DB/逆role/未知checksum無変更拒否、正当な未適用migrationと他側異常の事前拒否。`serverPollingConfig` と `nowcastApi` のmain子プロセスは両保存先を一時領域に指定 |
| AC2 | `databasePair` の保持5表全列fixture、再起動2回の全行・migration metadata・instance完全一致。自動削除triggerなし |
| AC3 | `resetWeatherDatabase` の実root npm plan/apply/no-op再apply、weather本体・付随ファイル限定、保持5表・hash/mtime・cache/settings/無関係DB不変 |
| AC4 | reset後のweather UUID更新/retained UUID不変。`splitDatabaseLifecycle` の旧cache残存・索引消失時unavailable・合成取得後の正常空available。警報/速報/XMLのnormal/training/test・採用/復旧と画像配信は既存API全回帰も実行 |
| AC5 | `splitDatabaseLifecycle` の実reset後HTTP同requestId再生、別操作409、呼出回数不変、全保持行一致、同session continuation。既存監視/受信API回帰 |
| AC6 | 実resetで原文ID=1を別原文へ再利用し、旧通知原文endpointが410 `weather_generation_changed`、別原文を返さない。`notificationReceptionReference` でavailable/missing/raw無し/世代不明/not_applicable/404/400/500。Webで実 `MonitoringDialogHost` 境界に同じcontrollerの前後状態をHTML描画しavailableの原文button1件、410後button0件/参照不可1件、保存summary維持 |
| AC7 | `startupNotifications` と `databaseRecoveryOrchestration` の復旧中HTTP202・session/claim/inquiry無消費、取得/会場評価ゲート維持。既存availability available/stale/unavailable回帰 |
| AC8 | projector・inquiry失敗のrollback。新HTTP試験でweather read/JSON化/thenable/retained deferred FK commit失敗は500、session/claim/inquiry全空。既存同会場claim一回・別会場独立・再起動/応答喪失回帰 |
| AC9 | 保持notification ID/cursorと追加sequenceの維持、差分の一度配信。予約setImmediate更新callbackの同期weather commit→保持INSERTに対し、startupを境界前/後に実行しsnapshot/cursor/delta一致。commit→emit・read→cursor間のawaitなしを静的確認。Web store/session/semantic重複排除回帰 |
| AC10 | alias/相対/case/symlink/hardlink/sidecar/旧設定/旧DB/role/digest/flag、writer lease/非協調open子process/停止検査不能の無変更拒否。WALのSHM有無/hot journalのコピーだけ検査と元stat/hash不変。unlink/進捗write中断、欠落主+残sidecarのjournal resume、別inode/改変journal拒否、起動拒否/lease競合。CLI途中完了/未完了一覧のJSON一致 |
| AC11 | 両側事前検証成功前にどちらもmigrationを進めない。open/未適用migration失敗時両close/lease解放、既存保持全行不変。部分成功の空DBを勝手に削除しない |
| AC12 | `issue43FetchControlApi` の保持write障害でmemory再生/同ID conflict、上限200のeviction、service再生成でmemory消失。照合read障害HTTP500。保持open/migration障害fail-fast、履歴read/startup write500 |
| AC13 | warning/bosai/system/recovery/操作通知の保持接続注入。保存失敗時の既存tracker/log/気象commit回帰。weather外側transaction内の通知保存を明示拒否し、気象rollbackと保持通知空を確認。outbox/再送なし |
| AC14 | startup/delta/recovery/origin pipelineとWeb terminalSession/notificationStore/notificationDelta/shell/警報表示を含む全回帰。複数会場・normal/training/test・H/K・availabilityの既存期待値を維持 |
| AC15 | [保守手順](../weather-db-maintenance.md) に初回/日常reset/resume/rollback/復元を区別。合成新保持DBを保全したまま別の空旧単一schemaを作成し、分割版へ再openして5表とhash不変を確認。旧アプリの全画面・全業務動作まで検証したとは扱わない |
| AC16 | 下記全体コマンド、未追跡/最終差分/既存package差分を確認。skip/todo追加なし。通常保存先の隔離事故は以下に明記 |

## ミューテーション

各変更はコメントだけの対照実験を先に実行し、終了コード0を確認してから実装を壊した。finallyで元ソースを完全復元した。

| 対象 | 対照→破壊→復元 | 検知内容 |
| --- | --- | --- |
| reset保持保護 | 0→1→復元確認 | 保持本体unlinkの注入を実npm applyのhash/mtime保全試験が検知 |
| 世代比較 | 0→1→0 | 世代比較除去による別原文への誤接続を検知 |
| startup transaction | 0→1→0 | transactionを除いたsession/claim/inquiry残留を検知 |
| 通知保存先 | 0→1→0 | 保持接続を気象接続へ戻した通知保存欠落を検知 |
| startup cursor | 0→1→0 | cursorを0へ固定した予約callback境界後の誤配信を検知 |
| CLI途中報告 | 0→1→復元確認 | 完了/未完了JSON報告欠落を検知 |
| UI 410切替 | 0→1→0 | 参照不可への状態更新を壊すと描画/操作抑止試験が失敗 |
| テスト隔離helper | 0→各1→0 | 通常領域guard/保持env固定/cache固定の各破壊を検知 |

詳細ログはOS専用一時領域（ローカル・Git管理外）へ保存した。対象sourceの一時改変中は他担当の実行を同期停止した。

## 全体コマンド

| コマンド | 終了コード・結果 |
| --- | --- |
| `npm run build` | 0（既存の500kB超chunk警告は残る） |
| `npm run lint` | 0 |
| `npm run typecheck` | 0（全workspace） |
| `npm run format:check` | 0 |
| `NODE_ENV=production npm run test -w apps/api` | 0、821件全成功、skip/todo/cancel 0、通常並列 |
| `npm run test -w apps/web` | 0、465件全成功、skip/todo/cancel 0 |
| `npm run test -w packages/shared` | 0、61件全成功、skip/todo/cancel 0 |

詳細ログはOS専用一時領域（ローカル・Git管理外）へ保存した。APIのB18は最終通常並列で成功した。

## 途中で見つけた不備と実保存先への副作用

1. `serverPollingConfig.test.ts` のmain子プロセスfixture更新途中で気象envだけを変更して実行し、保持envが未指定だったため **`apps/api/data/retained.sqlite3` が誤生成**された。metadata上のサイズは102400 bytes、mtimeは `2026-10-07T13:41:30.101682Z`（UTC最終更新の観測値であり、テスト実行開始時刻とは区別する）。製造テスト隔離の不備であり、既存契約の挙動不良とは扱わない。生成プロセスは終了済み。生成ファイル内容を開かず、追加削除/復元せず保持した。PR検証に流用していない。
2. 全テストを停止し、main子プロセス3ファイル、startServer 16ファイルと全pair/CLI入口を監査した。両DB envを固定し旧envを除去するhelper、通常領域拒否guard、専用temp cwd、明示2cache rootsを追加した。`nowcastApi` B18の旧 `DATABASE_PATH`、config省略server fixtureも修正。再発防止2テストと3破壊改変のredを確認してから再開した。
3. 統括が通常保存先全11項目のmetadataを専用一時JSONへ記録して検証後に照合する。事故前のcache leaf metadataは取得しておらず、事故前から一切副作用がなかったとは断定できない。誤生成DB以外の内容を確認するための実DB open、ゴミ箱操作、既存サービスの起動停止はしていない。
4. 初回全APIで新DB試験がcwd依存のため7件失敗した。module位置基準のmigration/root npmパスへ修正し、通常並列820件を全成功。初回Webはproduction Reactのact/StrictMode無効化により6件失敗したため通常Web経路で465件全成功。期待値・skip・timeoutを緩めていない。
5. 中間のserver回帰でfixture writer未解放3件と非同期サイクル完了前の固定20ms照合1件が失敗した。fixture closeと発火済みpromiseの完了待機へ修正し、195件全成功。追加のサイクル発火は行っていない。

実DB reset/初回導入・push・PR・merge・deployは製造担当の作業範囲に含めていない。検収担当へ渡す。

## PR #248 初回コードレビュー対応

計測用 `measureWarningRecovery.ts` に残っていた単一DB呼び出しを修正した。準備・サーバー起動・事後照合に同じ明示2DB設定を渡し、気象処理は気象接続へ統一した。両DBと両タイルcacheを計測専用一時領域に置く。会場解決の既存引数更新漏れも現行registry経由へ合わせた。既存50000件の性能結果・測定判定条件は変更していない。

新しい `measureWarningRecovery.test.ts` は実スクリプトを合成4件・遅延0で実行する。基準処理8件、両会場の復旧結果一致、20サンプル未達の既存契約による終了コード2、計測一時directoryの削除を確認した。テスト自身は終了コード0で成功する。コメントだけの対照実験は0、準備・起動・事後照合のそれぞれを旧単一DB呼び出しへ戻す3改変は各1、完全復元後は0となった。

`apps/api/scripts` と `apps/api/src` の旧呼び出しを検索し、残存は後方互換schema検証用 `initializeDatabase` の関数定義のみと確認した。今回も通常保存先DB・既存サービスを操作していない。

| 修正後のコマンド | 終了コード・結果 |
| --- | --- |
| `npm run build` | 0（既存chunk警告のみ） |
| `npm run lint` | 0 |
| `npm run typecheck` | 0 |
| `npm run format:check` | 0 |
| `npx tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --esModuleInterop --skipLibCheck --strict --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch --noUncheckedIndexedAccess --isolatedModules --resolveJsonModule apps/api/scripts/measureWarningRecovery.ts` | 0（通常workspace型検査の対象外scriptを明示検査） |
| `NODE_ENV=production npm run test -w apps/api` | 0、822件全成功、skip/todo/cancel 0、通常並列 |

明示型検査の初回コマンドは既存base設定のstrict指定が不足し、既存parserのunion絞り込みで終了コード2となった。baseのstrict等を付けた上記コマンドで成功した。Web/sharedは今回未変更であり、前節の全回帰結果を維持する。詳細ログはOS専用一時領域（ローカル・Git管理外）へ保存した。

## PR #248 追加レビュー対応: 起動失敗時の解放

`main` と `startServer` の両入口で、DB初期化前にポートを整数0〜65535として検証する。ポート0の既存fixture契約を維持した。DB初期化後の構成・待受開始・既存初期化cleanupを外側の例外境界で包み、同期例外や他サービスのcleanup失敗でも両DBのcloseとlease解放へ到達させる。追加した終了経路はDB終了の例外をログに残し、起動時の元例外を再送出する。既存の待受・初回同期・停止契約は変更していない。

`serverStartupFailure.test.ts` の6件で次を確認した。

- 両入口とも負値・65536・小数・NaN・InfinityをDB作成前に拒否する。startServerは-Infinityも拒否する。
- ポート0で正常待受し、65535は待受開始への到達を同期例外fixtureで確認する（実際の65535待受は行わない）。
- Expressの構成 `use` と待受開始 `listen` に同期例外を両入口それぞれで注入し、両接続のcloseを記録する。失敗した同じ2DB保存先でstartServerを再起動・closeし、writer leaseの解放を検証する。startServer側は元例外の同一性も確認する。
- main子プロセスの両DB envとcwd、startServerの両DBと両cacheを専用一時領域へ固定する。通常保存先全11項目のmetadataは着手前・全回帰後とも事故後基準と一致した。実DB内容は開いていない。

コメントだけの対照実験は0、ポート検証削除・startServer例外境界のDB close削除・main例外境界のDB close削除は各1、完全復元後は0だった。初回型検査でテストの異なるExpressメソッドのunion代入が失敗したため、fixtureの差替えを `Object.defineProperty` へ修正した。期待値・skip・timeoutは緩めていない。

| 修正後のコマンド | 終了コード・結果 |
| --- | --- |
| `npm run build` | 0（既存chunk警告のみ） |
| `npm run lint` | 0 |
| `npm run typecheck` | 0 |
| `npm run format:check` | 0 |
| `NODE_ENV=production node --import tsx --import ./apps/api/tests/helpers/venueConfigPreload.ts --test apps/api/tests/serverStartupFailure.test.ts` | 0、6件全成功 |
| `NODE_ENV=production npm run test -w apps/api` | 0、828件全成功、skip/todo/cancel 0、通常並列 |

`git diff -w` で業務上の変更はポート検証と例外境界の追加のみと確認した。外側tryに伴う整形差分を含む。詳細ログはOS専用一時領域（ローカル・Git管理外）へ保存した。既存packageのweb `--host` 差分は保持し、今回もコミットへ含めない。

## PR #248 3度目レビュー対応: 終了例外とhashのメモリ上限

pairの終了処理は、接続closeが失敗しても両接続とleaseの終了を全て試行して例外を集約する。migration前に接続を登録し、role初期化中の例外でも接続終了を試行して元例外を保持する。返却済みpairのcloseは失敗時に再試行可能とし、成功した接続・leaseを再終了せず、全成功後はno-opとなる。初期化失敗と同時にlease削除も拒否された場合は解放成功とは扱わず、元例外・close例外・lease例外を報告する。

lease解放も片側の例外で他方を止めず、成功したlockをpending集合から除いて失敗分だけ再試行する。lease取得途中の失敗時も、取得済み全lockの後片付けを試行して元例外を保存する。所有tokenの照合契約は維持した。

`fileIdentity` のSHA256計算は全量readから64 KiB固定bufferの同期readへ変更した。読込byte数だけをhashへ加え、fdはfinallyで閉じる。hash・metadata・不存在・単一リンクの判定契約は維持している。

新しい `databasePairCleanup.test.ts` と `databaseFileIdentity.test.ts` の6件で、次を実行した。

- close例外とlease削除例外の同時発生、両接続・両leaseの試行、失敗分の再close、成功後の繰返しclose、同じpair保存先の再初期化。
- retained migrationの元例外とclose例外の保存、さらにlease削除例外も含めた3者集約。migration失敗接続も終了記録に含まれること。
- 最初のlease解放を拒否しても次のleaseを解放することと、復旧後の再試行。
- 空・1 byte・64 KiB境界前後・複数chunkの既知SHA256との一致、metadata保全、各read要求の64 KiB上限、全量read禁止、成功時fd close、不存在とhardlink拒否。
- 途中read例外でのfd closeと元例外の同一性、復旧後のhash再実行。

コメントだけの対照は0、release呼出除去・migration前接続登録除去・lease片側失敗のfail-fast化・hash全量readへ戻す・fd close除去の5改変は各1、完全復元後は0だった。新しい成功時fd検査の初回はfixtureファイル作成時のcloseまで数えて失敗したため、hash呼出し前後の差分で確認するよう修正した。期待値・skip・timeoutは緩めていない。

| 修正後のコマンド | 終了コード・結果 |
| --- | --- |
| `npm run build` | 0（既存chunk警告のみ） |
| `npm run lint` | 0 |
| `npm run typecheck` | 0 |
| `npm run format:check` | 0 |
| `NODE_ENV=production node --import tsx --test apps/api/tests/databasePairCleanup.test.ts apps/api/tests/databaseFileIdentity.test.ts` | 0、6件全成功 |
| `NODE_ENV=production npm run test -w apps/api` | 0、834件全成功、skip/todo/cancel 0、通常並列 |

全fixtureは専用一時領域へ置いた。通常保存先全11項目のmetadataは着手前・全回帰後とも事故後基準と一致した。通常DB内容・数GB実DB・既存サービスは操作していない。Web/sharedは今回未変更。詳細ログはOS専用一時領域（ローカル・Git管理外）へ保存した。既存packageのweb `--host` 差分は保持し、コミットへ含めない。
