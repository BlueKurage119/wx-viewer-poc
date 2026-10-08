# Issue #247 気象 DB と保持 DB の物理分離

## 1. 状態・目的・承認範囲

- 【設計案】設計担当: Codex（GPT-6）。設計着手のみ承認済み。製造、コミット、実 DB 初期化、サービス操作は本書の承認後に別途着手する。
- 正本は [Issue #247](https://github.com/BlueKurage119/wx-viewer-poc/issues/247) の 2026-10-07 時点の最新本文。以下の内部方式は、その確定事項を実現するための設計案である。
- 【確定】SQLite を 2 物理ファイルに分け、気象 DB の明示初期化後も操作記録・通知履歴・session・claim・起動応答監査を保持する。初回のコピー移行、変換、逆移行は不要。導入後の保持 DB 保全は必須。
- 【確定】通常通知保存の best effort、操作記録失敗時のメモリ fallback、起動問い合わせの at-most-once、既存 availability 3 状態を維持する。通知 origin による保存先分割、監査機能新設、Firestore 移行、本番機能全体分割、部分起動方針の変更は対象外。
- 起動高速化、任意の外部 writer との同時稼働、障害独立、通知配送保証強化は達成したと主張しない。

## 2. 参照資料・静的確認

| 参照 | 確認と設計判断 |
| --- | --- |
| `CLAUDE.md`、`AGENTS.md`、`.claude/agents/wxviewer-designer.md`、業務標準 01・02・05・06・07、G-01・G-04・G-08 指導文書 | 対象設計書だけを作成する。製造へ進む前に設計承認を受ける。気象提供仕様や基本設計の未確定事項は本件で確定しない |
| [基本設計](../basic-design.md) §6〜§8、[Issue ドラフト](../issues-draft.md)、[DB 基盤](issue-5-sqlite-persistence.md)、[履歴保持](issue-10-retention-policy.md) | ファイル永続化、自動削除なし、通知・原文・操作の意味を維持する。基本設計の旧ドライバ記述等より現在のコードを優先する |
| [起動通知](issue-29-startup-notification-api.md)、[差分通知](issue-41-notification-delta-api.md)、[速報通知](issue-145-bulletin-notification-coverage.md)、[復旧](issue-193-database-recovery.md)、[復旧テスト](issue-225-recovery-test-port-cleanup.md) | session とサーバー起動世代を区別し、起動→差分の既存保証・復旧と初期通知・port:0 と終了順序を維持する |
| [境界調査報告](../../../docs/weather-platform-boundary-2026-10-07.md)（Git 管理外） | 同報告の段階移行案・本番提案は参考。本 Issue の全 5 表分離・初回引継ぎ不要・失敗契約維持を優先する。9/5 要求書の未転記部分を撤回と解釈しない |
| `database/config.ts`、`index.ts`、`connection.ts`、`migrations.ts` | 旧設定は `WX_VIEWER_DB_PATH`、既定ファイルは `apps/api/data/wx-viewer.sqlite3`。better-sqlite3 の同期 API、foreign_keys 有効化、checksum 付き `__schema_migrations` を使用 |
| `server.ts` の `main` と `startServer` | 両方で同じ単一接続を注入している。両構成入口、部分初期化 catch、正常終了を変更対象にする |
| `startupNotificationService.ts`、`startupCurrentNotificationProjector.ts` | session・claim・cursor・現況読取・応答監査を現在は 1 immediate transaction に置く。現況 projector は読取だけで通知履歴へ INSERT しない |
| `jmaWarningTelegramProcessor.ts`、`jmaVphwProcessor.ts`、`jmaVpbs50Processor.ts`、通知 emitter | 現況 commit 後の通知保存を同期呼出しする。警報の復旧は 100 件ページの commit→通知保存→次ページ前 yield。分離後もこの同期区間を維持する |
| `notificationOutputHistoryRepository.ts`、`notificationDeltaService.ts` | 整数 `id` が sequence。DB 再作成で振り直すのは気象側だけ。保持通知の ID・cursor は保持する |
| `monitoringHistoryService.ts`、`app.ts` | 受信原文 API は整数 ID のみで検索する。通知・操作・受信一覧は同接続。世代付き通知参照専用経路が必要 |
| `MonitoringDialogHost.tsx` | 出力履歴ダイアログの本文は現状「表示内容は準備中です。」。本件の参照不可表示には通知履歴と原文参照の最小本文を追加する。監視画面全体の作り直しはしない |
| `fetchControlService.ts` | requestId 照合と記録失敗時 completedMemory（上限 200）を持つ。接続先のみ保持側へ変え、この失敗時挙動を変えない |
| `imageServices.ts` | タイル cacheRoot は現在の cwd 基準の `data/cache/nowcast`、`data/cache/kikikuru` または注入値。DB 設定から勝手に cacheRoot を導出せず、reset で cache を消さない |

調査基点は branch `fix/issue-225-recovery-test-port-cleanup`、HEAD `027f6b0`。統括確認では最新 `origin/main` は `a1e8740`、コードツリーは一致。開始時差分はルート `package.json` の web `--host` 追加だけであり、保持し本件コミットに混ぜない。`.agents/skills` はない。設計書保存先は書込可能、Git 管理領域への書込は現在不可。設計担当はブランチを変更しない。

ユーザーは旧 DB をゴミ箱へ移したと報告済み。ただし移動対象・移動先・付随ファイルは実証できていない。ゴミ箱はアクセス制約で確認できず、ファイル不在を主張しない。統括の読取調査では既定保存先およびリポジトリ内に DB 候補なし、現在環境の `WX_VIEWER_DB_PATH` 未設定、本リポジトリ API/writer に該当するプロセスなし。5174 の listener は当初別プロジェクトだったが、ユーザーが停止したとの最新報告を受け、再確認では 5174/3001 とも listener なし。cache は残っている。これは将来の実施時点の全 writer 停止証明にはしない。エージェントによるゴミ箱消去、追加削除、復元、既存サーバー起動停止は行っていない。

本設計は静的調査のみ。2 DB transaction、lease、reset、安全な再実行、参照不可画面の**実挙動未確認**。実 DB を open せず、テスト・dev サーバーも起動していない。

## 3. 保存先・schema

### 3.1 設定と同一ファイル防止

| 項目 | 設計 |
| --- | --- |
| 気象保存先 | `WX_VIEWER_WEATHER_DB_PATH`。既定 `apps/api/data/weather.sqlite3` |
| 保持保存先 | `WX_VIEWER_RETAINED_DB_PATH`。既定 `apps/api/data/retained.sqlite3` |
| 相対パス | 両方とも従来と同じ `apps/api` 基準で解決。cwd によって DB 対象を変えない |
| 旧設定 | `WX_VIEWER_DB_PATH` が定義されていれば、空値を含め明示エラー。暗黙転用・優先順位・互換 alias は設けない。設定案内に新しい 2 設定を表示する |
| 不正値 | 空、NUL、`:memory:`、SQLite URI、非通常ファイル、DB として使用不能なパスは拒否。本番設定で in-memory 分離を偽装しない |

`resolveDatabasePairConfig(env = process.env): DatabasePairConfig` を両起動入口・reset で共有する。型は `DatabasePairConfig = { weather: DatabaseConfig; retained: DatabaseConfig }`、`DatabaseConfig = { databasePath: string; migrationsDirectory: string; role: 'weather' | 'retained' }` とする。

open 前に、既存部分の realpath と未作成末尾を組み合わせた正規パス、存在する場合の dev/ino、SQLite 付随パス、reset journal/lease パスを照合する。case 差だけのパスも保守的に拒否する。両 DB が同じ inode、片方が他方の `-wal` / `-shm` / `-journal`、lease/reset 管理ファイルと衝突する設定は拒否する。最終主 DB の symlink または `nlink > 1` は `main` / `startServer` / plan / apply / resume の共通事前検証で拒否する。hardlink 別名を指定した別 API が異なる lease を取得して同じ inode へ書く構成を許可しない。reset は付随ファイルの symlink/複数 hardlink も拒否し、symlink を辿って削除しない。親ディレクトリ symlink は実体パスへ固定して以後の処理で再検証する。

### 3.2 所有表と baseline

| DB | 業務表 |
| --- | --- |
| 気象 | `warning_current_snapshot/item/stream`、`warning_timeseries_snapshot/time_define/value/addition`、`early_warning_snapshot/time_define/cell`、`area_timeseries_snapshot/time_define/value`、`radar_snapshot/frame/tile`、`risk_snapshot/frame/tile`、`amedas_snapshot/observation`、`bosai_bulletin/area`、`fetch_attempt`、`telegram_reception/area/adoption` |
| 保持 | `operation_history`、`notification_output_history`、`terminal_session`、`startup_warning_claim`、`startup_notification_inquiry` |

各 DB の管理表は `__schema_migrations` と `__database_identity`。後者は 1 行で `singleton INTEGER PRIMARY KEY CHECK(singleton=1)`、`role TEXT NOT NULL CHECK(role IN ('weather','retained'))`、`schema_family TEXT NOT NULL`、`instance_id TEXT NOT NULL`（UUID）、`created_at TEXT NOT NULL` を持つ。role/family/instance の初回保存は各 baseline 適用と同じ transaction に含め、再起動・通常 migration で instance を再発番しない。気象 instance を `weatherDatabaseGenerationId` と呼ぶ。保持 instance は管理確認用で通知 sequence の世代にしない。

- 新 directory は `apps/api/migrations/weather/0001_baseline.sql`、`apps/api/migrations/retained/0001_baseline.sql`。既存 `0001`〜`0026` を編集・削除せず、その checksum と履歴を変更しない。旧ランナーを新ディレクトリへ向けるだけで旧 DB に適用しない。
- baseline は現行最終 DDL の列・constraint・index を所有 DB ごとに組み直す。新旧表・index・FK の対応を製造差分と schema テストで確認する。保持表から気象表への FK は新設しない。
- `notification_output_history` へ `weather_database_generation_id TEXT NULL` を追加する。weather 由来の全通知には世代を保存し、system は NULL。origin の保存先は常に保持 DB。
- metadata のない既存非空ファイル、旧 schema、逆 role、未知 family、未知 migration、checksum 不一致は明示エラー。空の新ファイルだけ baseline 作成を許す。両保存先を先に検証し、片側の異常発見前にもう片側へ metadata 作成/migration を行わない。既存ファイルの識別は §7.2 の専用一時コピー方式を共通 helper として使い、元 DB の SQLite open による WAL/SHM 副作用を避ける。旧 DB を空と誤認して上書きしない。
- 初回後の migration は DB ごとに forward-only。履歴表を空にして baseline をやり直す経路は作らない。保存先配置変更や別世代 backup 復元を自動検知してデータを削除する処理も作らない。

## 4. 接続注入・lifecycle・既存失敗契約

`initializeDatabases(config?: DatabasePairConfig): DatabasePairContext` を新 composition 入口にする。`DatabasePairContext = { weather: DatabaseContext; retained: DatabaseContext; weatherDatabaseGenerationId: string; close(): void }`。内部の単一 `initializeDatabase` と migration runner は各 role に対して再利用する。

| モジュール | 注入 |
| --- | --- |
| 気象 API、取得・正規化・採用・復旧、polling、fetchHealth の取得履歴参照、画像サービス、監視 processing | `weatherConnection` |
| fetchControl の操作履歴・操作通知、全通知 emitter、delta、session/claim/起動監査 | `retainedConnection` |
| startup service、monitoring history、気象読取を伴う初期 emitter | `{ weatherConnection, retainedConnection, weatherDatabaseGenerationId }` |

既存 emitter の `connection` 1 引数を両接続が必要なものだけ dependencies に分ける。例えば `WarningNotificationEmitDeps` / `BosaiNotificationEmitDeps` に `retainedConnection` と `weatherDatabaseGenerationId` を必須追加し、受信・初期・復旧の全呼出しへ渡す。気象側の connection 引数は気象読取専用に残す。暗黙の module global 接続、weather connection への通知 fallback、同一 connection でテストを通す既定値は作らない。

`CreateStartupNotificationServiceDependencies` と `MonitoringHistoryServiceDependencies` は weather/retained を明示。`StartServerOptions.config` は pair 型へ変更し、関連 fixture 全部を更新する。既存 port、close、shutdown/recovery gate の契約は保持する。`main` / `startServer` は設定/alias 検証→writer lease→両既存 DB の一時コピーによる role/family/適用済み checksum 検証→両検証成功確認→元ファイル identity/hash 再確認→各 DB の writable open/migration→構成→HTTP/取得の順で同じ helper を利用する。片側の旧 schema/危険設定が判明した場合は、どちらの元 DB にも writable open/migration を行わない。

両事前検証成功後の実際の open/migration 途中に片側障害が発生した場合は現在の fail-fast を維持し、もう片側の接続を閉じ lease を解放して起動失敗にする。2 DB の migration 全体を原子的に巻き戻す要求は設けない。成功した片側の既存記録を削除・初期化しない。片側に新規空 DB や適用済み migration が残っても自動削除せず次回検証対象にする。終了は新規投入停止→実行中取得/画像/制御処理完了→shutdown 操作記録と通知→HTTP close→両 DB close→lease 解放。片側 close 失敗でも他方 close を試み、失敗を報告し、不確実な停止状態で reset を許可しない。

保持 DB の open/migration 失敗時は全体起動失敗という既存契約を維持する。実行中の操作記録 write 失敗は既存 completedMemory と結果照合を維持し、requestId の永続履歴 read は保持 DB を使う。memory fallback は DB の既存照合 read が成功する場合の write 失敗に対応するもので、read まで失敗した場合は従来の HTTP 500 を維持する。通知 write 失敗は従来の catch/log・tracker 推進を維持し、気象 commit を取り消さない。履歴 API の read 失敗は現在の HTTP 500 を維持する。startup 内の retained write または weather read/projector 失敗は全 retained transaction rollback と HTTP 500。新しい memory DB、片側の自動再作成、別 DB への記録迂回、操作拒否方針、部分起動は追加しない。

## 5. 起動 snapshot・cursor・claim の整合

### 5.1 同期処理境界を使う方式

永続 snapshot 投影、outbox、ATTACH を使わない。現在の同一 Node プロセス・同期 better-sqlite3 を利用し、起動処理中には非同期 yield しない。2 ファイル間の書込 transaction ではなく、気象 DB は読取だけ、保持 DB に session/claim/監査の唯一の commit 点を置く。

`StartupWeatherReadPort.readCurrent(input): StartupProjectionResult` は同期型とし、weather の deferred transaction 内で現況を投影する。`createStartupNotificationService` は以下の処理を retained の `.transaction(...).immediate()` 内で行う。

1. 台帳と readiness を検証する。ready でない場合は既存 202 initializing を返し session/claim/監査を消費しない。
2. session を照合/記録し、新規 session の場合だけ `(serverGenerationId, venueId)` で claim を INSERT。既存 UNIQUE 制約による一度限りの取得を維持する。
3. 同期的に fetchHealth 値を取得し、保持 DB の max notification sequence と weather の現況読取 transaction を実行する。projector で normal/training、本来の時刻、期限、取消、会場 filter を現行どおり適用する。
4. その snapshot と cursor から応答を作り、応答 JSON と inquiry を保持 DB に記録する。気象読取/projector/JSON/監査/commit のどの失敗でも session・claim・inquiry を rollback する。
5. retained commit 成功後だけ応答を返す。HTTP 応答喪失後は既存 at-most-once（warning 再送なし）を維持する。

成立条件を実装の制約として明記する。全 weather 現況 commit→対応する通常通知保存試行は 1 同期区間で実行し、`await` / timer / worker dispatch を挟まない。復旧ページでも weather ページ commit→全ページ分通知保存→yield の順を保つ。通知保存中の例外は emitter が従来どおり吸収する。起動 read と cursor の間にも yield を挟まない。read port や projector が Promise/thenable を返す注入は明示エラーにする。weather の write transaction 内から retained 通知を先に commit する呼出しは許さず、最外側 weather commit 後へ同期的に出す。

これにより、HTTP startup が同期区間の前に実行された場合は旧 snapshot/旧 cursor となり後続 delta に更新が入り、区間の後に実行された場合は新 snapshot/更新後 cursor となり delta で同じ更新を再配信しない。途中の観測は同じイベントループ内では起きない。起動問い合わせ並行要求も retained UNIQUE と immediate transaction で claim を二重取得しない。単に 2 DB を順番に読むだけの方式ではなく、書込側・読取側の同期境界および §7 の共有 lease を受入条件として固定する。

現況保存後・通知保存前のプロセスクラッシュ、通常通知保存の失敗後に通知がないことは現在も配送保証外。次回起動は新 server generation の初期取得・評価・snapshot 再提示を実行する。通知欠落なしの保証を障害時再配送へ広げない。将来 await/worker/複数 writer を導入する際はこの方式を再設計する。本 Issue で大規模投影基盤を先行導入しない。

### 5.2 未復旧状態と世代

- `serverGenerationId`: サーバー起動ごとに新 UUID。claim・Web 世代同期の既存意味を維持する。保存した古い claim は削除せず、新 UUID の claim へ適用しない。同一 session は再起動後も continuation。
- `weatherDatabaseGenerationId`: weather ファイル新規 baseline のときだけ新 UUID。通常 restart で変わらず、weather reset 後に変わる。原文参照の namespace であり cursor/claim/session の世代にはしない。
- reset 後起動は `not_started` / 初期取得中 / 会場未評価なら startup 202。現行 `JmaXmlPollingService` が初期 feed 成功を確認して initialFetchPhase を completed にする条件と、会場の初期通知評価成功後だけ evaluatedVenueIds に追加する二段 gate を維持する。listener/初期評価失敗で phase 自体を巻き戻さない既存挙動でも、その会場の gate は閉じたままとし次周期で再試行する。取得不能を正常空へ変換しない。available（正常空を含む）/ stale / unavailable の weather API・fetchHealth 表示を維持し、個別電文取得の全成功等を新しい readiness 条件に追加しない。
- 起動→delta 切替と Web の semantic 重複排除は現行方式を維持する。保持 notification ID と sequence は一切振り直さず、cursor は保持 DB 全体の max ID。weather 世代の変化で cursor を 0 にしない。

## 6. 過去通知の原文参照と最小 UI

### 6.1 参照の保存・解決

weather 通知の保存 input/row に `weatherDatabaseGenerationId: string | null` を追加する。受信参照の既存 `relatedRefsJson`（`type=telegram_reception`, `ref=整数文字列`）と出力 snapshot は保持し、世代を別列で必ず添える。同じ DB 内でも原文消失を検知するため、参照解決で reception の存在と `rawBody` を確認する。世代不明は整数 ID だけで参照せず参照不可。system/fetch_source 参照は気象原文参照対象外。

shared に次の DTO を追加する。

```ts
type NotificationReceptionReference =
  | { status: 'available'; receptionId: number }
  | { status: 'unavailable'; reason: 'weather_generation_changed' | 'reception_missing' | 'raw_body_missing' | 'generation_unknown' }
  | { status: 'not_applicable' };
```

`GET /api/monitoring/notification-outputs` の既存各 item に `receptionReference` を追加する。既存検索・count・順序・summary・通知 ID を変えない。`GET /api/monitoring/notification-outputs/:id/reception` を追加し、保持通知 ID から世代・relatedRefs を解決して原文へ到達する。既存 reception DTO を成功時に返す。通知なしは 404 `notification_output_not_found`、参照なし/原文なし/世代違いは 410 `{status:'error', code:'notification_reception_unavailable', reason}`、DB read 失敗は既存と同型の 500。不正 ID/query は 400。判定から原文 read までを同期 weather read transaction に置く。

通知からは新 endpoint だけを使う。既存 `/api/monitoring/receptions/:id` は現在の受信一覧用に維持し、過去通知リンクに使わない。snapshot や警報・速報の関連 ref を「当時の原文」として現在の eventId/区域へ代替接続しない。raw に直接つながらない初期通知には not_applicable を返し、「原文リンクなし」を「原文消失」と混同しない。保持に気象原文を複製しない。

世代が一致し `rawBody` がある場合だけ available。古い通知の ref=1 と新 weather の id=1 が一致しても世代相違なら 410。気象 DB が読めないときは参照を available と推測せず 500 とする。通知履歴本体の表示・保存済み summary は retained から取得できる。

### 6.2 UI

`MonitoringDialogHost` の既存 `renderContent` 境界に、出力履歴用の最小本文 `NotificationOutputHistoryPanel` を接続する。`GET /api/monitoring/notification-outputs` を既存 limit/offset/検索契約で取得し、日時・保存済み summary・訓練区分・参照状態を表示する。履歴 UI 全体、電文履歴、診断本文の完成は対象外。

- available の行だけ「原文」操作を出す。クリック時に世代判定を再実行する新 endpoint を呼び、同ダイアログ内で原文をテキスト表示する。XML は HTML として埋め込まない。
- unavailable は「原文参照不可」を表示し原文操作を無効化。表示後に原文が消えてクリックが 410 になった場合も同表示へ更新する。not_applicable は操作を出さない。
- 取得中/失敗を区別し、DB read 失敗を原文消失の確定表示へ変えない。閉じる/切替で自分の fetch を中止し、閉じたダイアログに反映しない。
- MD3 トークン、既存 Gb ラッパー、dialog focus、summary 1 本表示を維持する。HEX 直書き、新しい色体系、見れば分かる説明文は追加しない。
- 通知 feed の H/K origin filter、ブザー、確認、cursor 動作へこの監視用参照 DTO を持ち込まない。

## 7. `npm run db:reset:weather` と停止・対象確認

### 7.1 共有 writer lease

正規化した各 DB パスに対応する `<DBパス>.writer-lock` directory を `mkdir` の排他的作成で取得する。両起動入口は両方を固定順で取得し、reset も同じ 2 lease を取得する。§3.1 の最終主 DB symlink/複数 hardlink 拒否を全入口で lease 取得前・取得後に行い、異なるパス名で同じ inode を共有しないことを確認する。重なる DB を使う別起動や reset は待たず明示失敗する。metadata は PID、開始時刻、所有 token、role だけとし、DB 内容・機密値は保存しない。lease は最初の DB open 前から全 writer/DB close 完了後まで保持する。保持側の lease を取ることは保持 DB 本体の open/更新/初期化を意味しない。

同じ保存先で複数 API プロセスを実行しないという本方式の成立条件を README に記す。lock が残る場合は stale と推測して自動削除しない。PID が死んでいても全 writer を別途確認し、所有 token と対象の確認を受けた保守操作でのみ解消する。reset 専用の force/unlock オプションは作らない。新コードで管理されない旧プロセス・外部 SQLite writer は lease だけで検出できないため、次の停止確認を併用する。

### 7.2 コマンド仕様

ルート npm script `db:reset:weather` から API workspace の `tsx src/database/resetWeatherDatabase.ts` を実行する。通常起動/障害検出から呼ばない。既存 web `--host` 差分をこの script 変更に混ぜない。

1. 正規の停止操作で全 writer を停止したことを実施者が確認する。取得の停止ボタンだけでは API/DB 接続が残るため停止証明にしない。
2. `npm run db:reset:weather -- --plan --confirm-stopped`（既定 mode は plan）: 新 2 設定を解決し、正規パス・role・weather instance・対象ファイル一覧・原文/取得履歴/派生値消失・保持/cache 非対象を出力する。設定ファイルや env 全体は出力しない。plan は元 DB/付随ファイルを変更せず、削除・schema 適用をしない。停止確認 flag 不足なら検査前に失敗する。plan 結果から対象を確認し、必要な実施承認を得る。
3. `npm run db:reset:weather -- --apply --confirm <planDigest> --confirm-stopped`: planDigest は正規化した 2 パス、weather identity/主ファイルと各付随ファイルの dev/ino/size/mtime/hash（不存在も含む）、削除範囲から SHA-256 で作る。実行時に再計算して不一致なら削除前に失敗する。別設定の plan を流用できない。
4. plan/apply/resume 共通で、危険な設定の事前検証後に 2 lease を取得し、対象/identity を再検証する。`lsof` 等の読取コマンドを対象主ファイル/付随ファイルへ限定して実行し、利用プロセスがあれば失敗。検査コマンドの不存在・権限不足・非判定終了も停止確認不能として拒否する。lease と開放確認がそろうまで識別用コピー・削除をしない。プロセスを kill しない。
5. SQLite に元 DB を open させず、専用 `mkdtemp` 配下へ主ファイル/存在する `-wal` / `-shm` / `-journal` を同じ basename で通常のファイルコピーとして取り、コピーだけを open して role/family/適用済み checksum を検証する。コピー先の journal recovery/SHM 作成更新は許すが migration は行わない。検査前後に元の stat と全ファイル hash を照合し、変化した場合は対象が安定していないとして削除前に失敗。コピーに破損/復旧不能/識別不明があれば元を触らず拒否する。コピーと検査接続は finally で close/後始末し、移行・引継ぎ・バックアップの代用にしない。旧単一 DB、保持 role、管理情報なし非空 DB は reset 対象にできない。`main` / `startServer` の両既存 DB 事前検証もこのコピー方式を用い、両検証完了前に元 DB を writable/read-only のいずれでも SQLite open しない。ただし正当な reset journal に基づく resume で主ファイルが削除済みの場合は、§7.3 の記録済み identity 検証に切り替え、欠落主ファイルのコピー open を要求しない。
6. 保存先再検証後、weather 本体とその `-wal` / `-shm` / `-journal` のみを削除する。main だけ消して orphan WAL を新 DB に当てない。directory 全体削除、glob、保持パス、cache、設定の削除は禁止。削除セットの各項目と保持本体/付随ファイル/管理パスに重なりがないことを最終確認する。
7. schema はコマンド内で作成せず、次回の正規起動時に weather baseline と新 instance を作る。reset 完了だけで ready にしない。成功時は削除/既不存在一覧と次回起動・再取得手順を出力し終了コード 0。

plan の digest は対象確認用で停止証明ではない。必要な実施承認を省略する根拠にしない。停止後も非協調な外部 writer の新規起動は防げないため、保守中に SQLite ツール等で対象を開かない運用を明示する。

### 7.3 途中失敗・再実行・cache

削除は複数ファイルに対して原子的ではない。削除開始前に `<weatherパス>.reset.json` を排他的作成し、確認済み weather role/family/instance、対象正規パスと各ファイル identity/hash、planDigest、削除済み項目を記録する。原文・保持記録を入れない。各 unlink 成功後に同 directory 内の一時ファイル→rename で進捗を更新する。journal の create/update が失敗したら追加削除を止める。保持 lease は削除範囲外。

- 途中失敗は非 0、完了/未完了対象を報告し journal を残す。アプリ起動は残存 reset journal を検出して DB open 前に拒否する。片側だけの自動復旧・新規作成をしない。
- 再実行は `--resume --confirm <元planDigest> --confirm-stopped`。2 lease と停止確認を再取得し、journal の対象/role/instance と残存ファイルの identity を検証する。元の一覧だけを再開する。不在は削除済みとして処理する。別 inode・再生成 DB・改変 journal は拒否し、新しいファイルを消さない。
- resume で主ファイルが削除済みの場合は、SQLite コピー open/role 再読を行わない。確認済み reset journal の role/family/instance、元 planDigest と対象一覧、残 sidecar の dev/ino/size/mtime/hash を照合して再開する。主ファイルが残存する場合はコピー検査を併用する。journal が不正/照合不能なら拒否する。plan/apply で主ファイルがなく sidecar のみ存在する場合の帰属不明拒否は維持し、この例外を resume 以外へ広げない。
- 全対象不存在を確認してから journal を削除し、lease を所有 token 一致で解放する。通常 close/catch で lease 解放できず残った場合は §7.1 の明示保守確認に戻す。journal は再開情報であり全 writer 停止の代用ではない。
- 成功後にもう一度 apply した場合、本体も付随ファイルもなく journal もないなら no-op 成功。主ファイルなしで付随ファイルだけ残り、正当な reset journal がない場合は帰属を証明できないため無変更で拒否する。
- タイル cache は全て保持する。DB 索引消失後は古い cache だけで available にしない。再取得/現況構築で新索引を作り、実際のファイルとメタ情報が一致するものだけ配信する。参照外 cache の既存清掃契約は変えず、reset 時の追加 cache 清掃はしない。上流停止で再取得できなければ既存 availability/取得異常を返す。

## 8. 初回導入・日常復旧・rollback 手順の区別

製造では README の DB 設定/起動説明と `docs/weather-db-maintenance.md` を更新/作成する。本書以外の設計資料の一括改訂はしない。

| 手順 | 必須の順序と保全 |
| --- | --- |
| 初回導入 | 旧版・設定・保存先を記録→全 writer 停止→旧 DB と付随ファイルの実在/対象を確認→必要な実施承認→旧ファイルだけの明示削除→旧設定を除き新 2 パスを設定→空から両 baseline 作成→role/table/世代/正常起動を検証。既存データコピー処理は作らない。ユーザーのゴミ箱移動報告を未確認の旧ファイル一括削除へ拡張しない |
| 導入後の気象初期化 | 正規停止→plan→対象確認/承認→apply→必要なら resume→正規起動で weather 新 schema/世代→fixture または正規取得による復旧→保持 5 表と requestId/通知参照を確認。保持側は初期化対象外 |
| コード rollback | 全 writer 停止→新 2 DB の整合した停止時コピーと設定・版・schema/checksum を保全→旧コード/旧設定へ戻す→新 2 DB と重ならない旧版用の空単一 DB を指定→旧版の動作確認。新保持 DB は削除も旧版 open もせず保全する。rollback 中の旧版で増えた記録を分割側へ自動統合しない |
| データ復元 | 退避がなければ削除済み旧データは復元不能。新保持 DB を旧単一 DB として利用できるとは主張しない。分割→単一逆移行は対象外。導入後保持 DB の復元/過去 weather backup との組合せは、保存時点と世代・参照整合を別途確認し、実施承認なしに巻き戻さない |

コード rollback により旧版画面から新保持記録が見えなくても、物理ファイルを保全する。分割版へ戻れば保全した保持 DB をその対応 schema のまま利用できることを合成 fixture で検証する。保持 DB 障害を初期化理由にしない。気象世代 UUID を backup から戻すときのデータ集合の整合検証や RPO/RTO の数値保証は別 Issue とし、破壊的な自動復元手順を用意しない。

## 9. 製造・検収の受け入れ条件

以下は設計承認後に実行する。`mkdtemp` 配下の **異なる 2 SQLite 物理ファイル**と合成 fixture を用い、設定・時計・取得関数・cacheRoot を注入する。実 DB・ゴミ箱・実取得先を使わない。同一 in-memory 接続だけでは合格にしない。HTTP テストは `port:0`、自分のサーバーだけ close→DB close→一時 directory 削除とし、Issue #225 の復旧ゲート中の API 検証を維持する。

- [ ] **AC1（Issue 条件 1）**: 空の一時 directory で `initializeDatabases` と `main` 相当の subprocess 起動を実行する。2 ファイルの dev/ino が異なり、各 identity role/family/instance と `__schema_migrations` checksum が一致し、§3.2 の業務表が所有側だけに存在する。旧非空 DB・逆 role・旧設定で起動すると元 DB open 前の共通事前検証で失敗し、両元 DB/付随ファイルの内容と stat/hash が不変。片側には正当な未適用 migration、他側には旧 schema/未知 checksum を用意し、危険構成で正当側の migration も一切進まないことを確認する。
- [ ] **AC2（条件 2）**: 保持 5 表へ全列の fixture を保存し、close→再起動→migration 再実行を 2 回行う。全行の ID/JSON/時刻/claim/session と migration checksum が完全一致。両 instance は通常再起動で不変。自動削除 trigger/履歴更新なし。
- [ ] **AC3（条件 3）**: 操作・weather/system 通知・session・旧起動世代 claim・応答監査を保存し、停止した一時 DB へ実 npm script の plan/apply を subprocess 実行する。weather 本体/付随ファイルだけがなくなり、保持 5 表の完全一致、保持ファイル hash/mtime 不変、cache と sentinel 設定/無関係 DB 不変。再 apply は no-op 成功。
- [ ] **AC4（条件 4）**: AC3 後に正規起動して weather schema 再作成。weather instance が新 UUID、retained instance が不変。合成警報/速報/XML/画像 fixture を再取得・採用・復旧し、normal/training/test の保存値、現況と availability が期待値どおり。cache 本体だけの状態では正常現況を返さず、新索引と整合した tile だけ配信する。
- [ ] **AC5（条件 5）**: AC4 後に監視操作/通知一覧と同 requestId 照合を HTTP で実行する。保存済み全列・通知 sequence・結果が一致し、同 ID 同操作は再実行なし、別操作は既存 conflict。同 session は continuation、新 session だけ startup。受信一覧は新 weather の行だけ。
- [ ] **AC6（条件 6）**: 旧 weather の reception id=1 に紐づく通知を残し reset 後に別原文を id=1 で保存する。通知一覧は旧 summary/ID を保持し receptionReference が generation_changed。新参照 endpoint は 410、別原文を一切返さない。同世代の存在/消失/空原文、世代不明、not_applicable を各 fixture で検証する。出力履歴 UI で「原文参照不可」と原文操作不可を確認し、available の原文操作成功と表示後 410 への切替も確認する。
- [ ] **AC7（条件 7）**: 初期取得ゲートと会場評価ゲートを閉じた実 HTTP startup は 202、session/claim/inquiry 行なし。取得不能・正常空・stale の fixture を使い既存 readiness と availability 応答を確認する。ゲート解放後の startup と delta に更新を境界前/後で挿入し、期待 snapshot/cursor と配信内容が一致。取得失敗を正常空にしない。
- [ ] **AC8（条件 8）**: projector、weather read、response serialization、inquiry write、retained commit の各失敗を注入して startup 500 と session/claim/inquiry の全 rollback を確認する。並行 HTTP 起動で同起動世代×会場 claim は 1 行/成功 1 回。別会場は独立。再起動後古い claim が新 generation の取得を妨げず、旧 session は continuation のまま。応答喪失後の at-most-once を既存テストどおり確認。
- [ ] **AC9（条件 9）**: reset 前の通知 sequence N と cursor を記録し、再作成後追加通知が N+1 以降であることを確認する。startup 境界前の通知は snapshot に含み delta では再表示せず、境界後の更新は delta で 1 回表示。Web store/session/世代切替・semantic 重複排除を既存回帰テストで検証。weather commit→emit と startup read→cursor に yield がないことを静的レビューし、同期境界の前後に予約した update callback で両順序を実行する。
- [ ] **AC10（条件 10）**: 同一パス/相対 alias/symlink/hardlink/case 差/付随パス重複/旧設定/旧 DB/role 違い/確認 digest 不一致/確認 flag 不足で reset を実行し、非 0 と全対象内容不変を確認する。一時 writer subprocess の lease と、lease 非対応だが対象を開く自分の子プロセスを各用意し plan/apply/resume 拒否。停止検査不能も拒否。停止済み WAL fixture の SHM あり/なし、journal recovery を要するコピー検査 fixture で plan/apply を実行し、plan の前後に元主/付随ファイルの dev/ino/size/mtime/hash が完全一致、検査による digest 自己競合なし、一時コピー後始末完了を確認する。unlink/進捗更新の途中失敗を注入し起動拒否→同 journal から resume→再実行を検証する。主ファイル削除直後に中断して sidecar だけ残すケースでも、正当な journal と残 sidecar の照合で resume が成功し、欠落主ファイルの SQLite open を試みないことを確認する。途中で別 inode を置いた場合は resume 拒否。主なし sidecar の帰属不明は無変更拒否。2 個の reset/同一保存先起動競合も片方だけ lease 取得成功。weather/retained の最終主 DB に hardlink 別名を作り、別名を指定する 2 起動を試すと共通 `nlink > 1` 検証で両方拒否し、異 lease による同 inode writer は成立しない。main/startServer/plan/apply/resume の全入口でこの拒否と元 DB 不変を確認する。
- [ ] **AC11（条件 11）**: 両事前検証成功後、weather と retained の open/migration/write の失敗を別々に注入する。起動失敗時に両接続と lease が解放され、もう片側の既存全行が不変。既に成功した migration や新空 DB が残ることは許容するが、その削除/再初期化はしない。旧 DB/未知 checksum/破損は事前検証で両元 DB writable open 前に拒否し自動再作成・削除なし。実行中の read/write エラーでももう片側の初期化処理を呼ばないことを確認する。
- [ ] **AC12（条件 12）**: DB の既存照合 read が成功する条件で保持 operation_history write を失敗させ、既存 memory fallback の結果と requestId 照合（上限・再起動で消える意味を含む）が既存 fixture と一致。照合 read 自体の失敗は従来の 500 と一致。保持 open/migration 失敗は fail-fast、履歴 read/startup write 失敗は既存 500。weather 専用の memory fallback や操作拒否/新部分起動が追加されていないことを差分で確認。
- [ ] **AC13（条件 13）**: 通常通知 INSERT を失敗させ、weather 現況/採用 commit が保持され、tracker 推進/log/既存応答が維持される。warning/bosai/system/recovery/操作通知の保存先は保持。weather 最外 transaction を失敗させた場合は、未確定現況に由来する通知を保持側へ先に commit しない。通常通知の再送/outbox が追加されていない。
- [ ] **AC14（条件 14）**: `startupNotifications.test.ts`、`notificationDeltaApi.test.ts`、`databaseRecoveryOrchestration.test.ts`、`notificationOriginPipeline.acceptance.test.ts` と Web の terminalSession/notificationStore/notificationDelta/shell、警報表示の既存テストを実行する。複数会場、normal/training/test、H/K origin 表示、availability available/stale/unavailable の期待値・スキップなし。復旧ゲート中の HTTP 条件と port:0/終了順序が維持される。
- [ ] **AC15（条件 15）**: 手順書に初回/導入後/reset再実行/コードrollback/データ復元の区別が記載されている。合成 fixture の新保持 DB を保全→旧版用別空 DB を使う rollback→分割版へ戻す往復を実行し、新保持 5 表の全値とファイル hash が保持される。旧 DB 退避なしなら旧データ復元不能、逆移行なし、保持 DB を旧版で直接使用しないという制限も記載される。
- [ ] **AC16（条件 16）**: `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api`、`npm run test -w apps/web` と shared の定義済み対象テストが終了コード 0。既存ローカル設定/待受権限制約は Issue #225 の検証環境注記に従って共有設定・正式権限で扱い、既存失敗を隠さず通常並列経路との差を報告する。対象差分と未追跡を確認し、既存 `package.json` web 差分の保持・コミット除外、実 DB/実 cache/他サービスへの無操作を確認する。

新規テストには業務標準 05 に従い意味を変えない対照改変を先に実行し、その後「reset の保持側保護除去」「世代比較除去」「startup transaction 除去」「保存先振分けを旧単一接続に戻す」の該当改変で各テストが red になることを確認する。完全一致を基本とし、期待値を実装から複製しない。一時改変を復元し、検証 fixture/サーバーを自分の所有物だけ後始末する。

## 10. 判断・残留リスク・後続への引継ぎ

- 要ヒアリング事項: なし。Issue の「設計で決める」事項を上記で具体化した。ユーザー確定事項を再質問しない。設計承認は別に必要。
- 承認判断点: 同期 transaction と writer lease を使う整合方式、旧設定の明示拒否、plan/apply/resume のコマンド方式、既存出力履歴 dialog への原文参照最小本文が本書の具体的な設計案。
- 残留リスク: lease と lsof の実環境判定、case/alias/付随ファイル衝突検証、reset journal の障害注入、2 DB 同期区間、最小 UI は実挙動未確認。非協調 writer の起動を完全に防ぐ OS ロックではない。製造で成立しなければ保証を緩めたり outbox/部分起動へ勝手に変更せず統括へ戻す。
- 後続: 保持障害時の操作/起動縮退、監査保証、複数 writer/worker/非同期投影、通知配送保証、backup 時点整合と RPO/RTO、本番設備管理/情報伝達/Firestore、履歴 UI 全体は別 Issue。現在の scope に先行実装しない。
- 初回実施前のブロッカー: 対象旧ファイル・付随ファイルと全 writer 停止は実施時に再確認が必要。ユーザーの DB 移動報告だけで削除対象を推定しない。製造用ブランチ・Git 書込権限と製造方式は統括が設計承認後に用意する。

設計フェーズの変更はこのファイル 1 本のみ。コード・設定・ブランチ・コミット・DB・サービスの操作は行っていない。
