# Issue #260 統合検証結果

## 記録の範囲

2026-10-11 JST 時点の製造段階の記録。設計条件は [Issue #260 設計](issue-260-two-worker-integrated-verification.md) に従う。この記録は E1〜E12 の完了報告ではない。サンドボックス内のローカル HTTP は `EPERM` で拒否されたため、実 Worker/HTTP の 8 試行は統括担当が権限外の隔離環境で実行した。実ブラウザ・rollback は未実施。失敗した試行も経緯を残す。

## 固定した条件と未取得の入力

| 項目 | 記録 |
| --- | --- |
| 比較元 | `3e95635bf46fb38a559d6ca9d63a36ce414c2ac2` |
| 対象の基準 | `8ad36a6215fe8a622c0f2fed898700820973f387` |
| rollback 対象 | `261913362c09db585cb3263e6abbd6e86904fe88` |
| 設計後の作業基点 | `30a889e0d3f9aea7c4cfdb718c4b151a6a939f1b`、開始時 clean |
| OS・CPU・メモリ | Darwin 25.6.0、x64、論理 12 コア、34,359,738,368 bytes |
| Node・driver | Node v24.20.0、better-sqlite3 13.0.3、`SELECT sqlite_version()` は 3.53.4 |
| DB/WAL 設定・会場/端末 | seed 生成時の両 DB は `journal_mode=delete`。実 Worker 稼働時の WAL 設定・サイズは未記録。`NODE_ENV=production` でローカル会場上書きを無効化し、`hkeagh01` で要求 |
| fixture と量 | seed 260、5万電文×1,024 bytes、1,024 PNG×65,536 bytes。ハッシュ・status 配分・DB 本体実 bytes は [manifest](issue-260-fixture-manifest.json) に記録 |
| 計測開始・終了 | 8 試行それぞれの UTC 時刻は下記生 JSON に記録 |

設計の API 上限値（health 500 ms、監視 1,000 ms、system 差分・保存済み API・tile hit 各 2,000 ms、tile miss 30 秒）は目標である。health の同時 1・毎秒 10 件を 3 負荷で各 1 回、監視・system 差分・保存済み警報 API を parser 負荷で各 1 回、tile hit を旧・修正版で各 1 回実測した。旧 tile hit はハーネス不備で失敗、修正版は成功した。cold/warm、同時 8、毎秒 1、各セル 3 回以上、残る負荷組合せは未実施。要求別 latency/status/bytes と p50/p95/p99/最大、取得 Worker スレッド CPU 時間は生 JSON にある。ただし旧 parser/health では CPU 時間を未収集。main/提供 Worker の CPU/RSS/heap、キュー、busy/WAL、報告遅延、外乱、空運転は未取得。

## 試験の実行

| 実行 | 結果 | 判定 |
| --- | --- | --- |
| `npm run test -w apps/api` | サンドボックス内で実行。ローカル `fetch` が `connect EPERM 127.0.0.1` または `::1` となる試験が多数あり、実行を中断した。全件完走・合格の証拠ではない | 未検証 |
| `npm run test -w apps/web` | 一部試験は通過したが、HTTP 待受が `listen EPERM 0.0.0.0` となり exit 1 | 未検証 |
| `npm run lint` | exit 0 | 通過 |
| `npm run typecheck` | exit 0 | 通過 |
| `npm run format:check` | exit 0 | 通過 |
| `npm run build` | exit 0。Vite の 500 kB chunk 警告あり | 通過 |
| サンドボックス外での API 試験再実行 | 本担当の権限要求は中断。後続の統括担当による全件実行結果は末尾に記録 | 報告済み・生ログ未取込 |
| 実 Worker・実 HTTP の負荷と障害注入 | health 3 試行と parser 負荷の監視・system 差分・保存済み警報 API 各 1 試行、tile hit 2 試行を隔離ポートで実測。旧 tile hit は失敗、修正版は成功。障害注入は未実施 | 一部実施 |
| 実ブラウザ操作 | スクリーンショット・操作ログなし | 未実施 |
| 旧版比較・rollback・reset | 隔離 DB の複製と互換検証なし | 未実施 |

既存試験には Worker 起動、異常 exit、再開、世代、reader、タイル競合、通知の個別試験がある。後続の全試験成功は下記に記録するが、設計 §4 の横断検証の代用にはしない。追加した計測ハーネスは `.test.ts` ではない。負荷失敗・サンドボックスでの `EPERM` を非 0 終了と JSON に記録する経路を確認した。

## 受け入れ条件

| 条件 | 状態 | 不足する証拠 |
| --- | --- | --- |
| E1 条件固定 | 一部実施 | seed/hash/生成量/3 負荷の入力は記録。全設定、旧版との同一入力比較、端末・外乱条件が不足 |
| E2 応答 | 一部実施 | health の 3 負荷×各 1 セルと parser 負荷の 4 API×各 1 セルは成功。旧 tile hit の fixture 不整合による失敗も記録。残る API・並行/投入率・cold/warm 反復と資源系列、旧版比較が不足 |
| E3 起動隔離 | 未検証 | open/migration と保持側障害の実注入ログ |
| E4 role 別障害 | 未検証 | 両 role の停止・exit・応答途絶を別々に観測したログ |
| E5 世代 | 未検証 | 旧 exit、DB 世代、tracker/健全性の横断照合 |
| E6 競合 | 未検証 | 更新・端末起動・通知保存・操作喪失の完全一致記録 |
| E7 reader/容量 | 未検証 | busy、miss、清掃、容量限界の実測と失敗 body |
| E8 データ意味 | 未検証 | 1/複数会場と H/K、状態別の実応答 |
| E9 ブラウザ | 未検証 | 実操作・画面・API/履歴の照合 |
| E10 停止/reset/rollback | 未検証 | 資源残 0、reset、旧版 DB 互換または復元 |
| E11 手順 | 一部作成、未検証 | [運用手順](../operations/weather-workers.md) の分岐ごとの実行記録 |
| E12 品質 | 一部実施 | lint・typecheck・format:check・build は通過。API/Web 全試験は統括担当から成功報告あり。生ログと追加ハーネスの red/対照実験が不足 |

現段階では受け入れ条件を 1 件も合格としない。後続の検収担当は、サンドボックス外の隔離試験環境で再実行し、結果の生ログ・時刻・終了確認を追記する必要がある。

## API 全試験で報告された会場件数差の調査

サンドボックス外の API 全試験は exit 1 で、統括担当から `reprocessProgressLogs` と `venueScopedAdoption` に `actual 3、expected 2` があると報告された。前者の全試験ログは本記録には取り込んでいない。後者は次の単独実行で再現した。

| コマンド（`apps/api` で実行） | 結果 |
| --- | --- |
| `node --import tsx --import ./tests/helpers/venueConfigPreload.ts --test tests/venueScopedAdoption.test.ts` | 9 件中 8 件成功、§7-6 の 397 行で `3 !== 2`、exit 1 |
| `NODE_ENV=production node --import tsx --import ./tests/helpers/venueConfigPreload.ts --test tests/venueScopedAdoption.test.ts` | 9 件成功、exit 0 |

設定読込だけを独立に確認すると、`loadVenueConfig({ environment: 'development' })` は `localOverride: applied`、3 会場を返し、`production` では `localOverride: disabled-production`、2 会場を返した。既定の `config/venues.yaml` は 2 会場であり、この環境には Git 管理外の `config/venues.local.yaml` に追加会場がある。`apps/api/tests/helpers/venueConfigPreload.ts` は引数なしの `loadVenueConfig()` を共用する。`reprocessProgressLogs.test.ts` の 601/650 行は `status.venues.length` と HTTP 応答の `venues.length` に 2 を固定期待し、`venueScopedAdoption.test.ts` の 390 行以降はレジストリの全会場を処理しながら 397 行で adoption 行数を 2 と固定期待する。

この件数差はローカル設定を取り込んだ 3 会場という入力と、2 会場固定の旧試験期待の不一致で説明できる。`production` で後者が通ることも整合する。気象処理が 3 件を誤生成したという証拠は得ていない。前者の HTTP 試験については同一条件の単独再実行をしていないため、設定要因以外の失敗がないとは断定しない。恒久対策は試験 fixture をローカル設定から隔離するか、期待件数を対象レジストリから導くことだが、Issue #260 の製造範囲外のためコードは変更していない。

## 後続の全試験結果

統括担当がローカル接続可能な環境で再実行した結果、`NODE_ENV=production` の API 全試験は 1,074/1,074 件、Web 全試験は 511/511 件が通過した。生ログ・開始終了時刻・実行ホストの証拠は本記録に取り込めていないため、E12 の監査可能な完了証拠としては保留する。通常環境での会場 3 件と旧試験の 2 件固定期待の差は残る。

## 固定 fixture と計測ハーネスの実行

`apps/api/tests/issue260Benchmark.mts` を追加した。seed 260 から 5 万件の 1,024 bytes 原文（normal 16,667、training 16,667、test 16,666）と、1,024 枚の 65,536 bytes PNG を一時 DB/cache に生成する。PNG は同一内容を別ファイル名で保存するため、実運用の画像分布は再現しない。実取得・提供 Worker と HTTP を起動し、取得 Worker で同期 XML 解析・大量保存・復旧から指定した負荷を最低 60 秒実行する。1 回につき health、監視、system 差分、保存済み警報 API、保存済み tile hit のうち指定した 1 系列を 100 要求以上、負荷の全区間に分散して実行し、要求単位の送信相対時刻・latency・status・bytes と分位点を JSON へ記録する。毎秒 10 件・60 秒なら 600 件、毎秒 1 件なら最低 100 件を送る。`BENCH_CONCURRENCY=1|8`、`BENCH_RATE=1|10`、`BENCH_LOAD=parser|write|recovery` を選べる。保存済み tile の frame 時刻は提供 Worker の表示窓に入るよう実行開始時に決め、生 JSON に記録する。原文・PNG の内容ハッシュは固定である。

再現コマンド（`apps/api` で実行、出力先は任意の書込可能な一時ファイルに変更する）:

```bash
NODE_ENV=production BENCH_OUTPUT=./issue260-benchmark.json BENCH_SERIES=health BENCH_CONCURRENCY=1 BENCH_RATE=10 node --import tsx tests/issue260Benchmark.mts
```

大量保存と復旧は同じコマンドに `BENCH_LOAD=write` または `BENCH_LOAD=recovery` を加え、出力先を別ファイルにする。結果は `stage=measurement_completed`、`workerLoad.ok=true`、`judgment.passed=true`、exit 0 を揃えて確認する。

サンドボックス内の試行では fixture の生成まで完了し、`listen EPERM 0.0.0.0` で実 Worker の HTTP 待受が拒否された。生成段階の機械可読値は [fixture manifest](issue-260-fixture-manifest.json) に保存した。2026-10-11 02:20:34 UTC 開始の試行で気象 DB 本体 81,928,192 bytes、保持 DB 本体 114,688 bytes、SQLite 3.53.4、seed 段階の journal mode は両 DB とも `delete`。原文 SHA-256 は `892676a0ab68480f87d735e11756624653cbfb5c5a386955ddb0a1f7c3bd3962`、PNG SHA-256 は `e36ebe4782b232411ca8b2d8e2e3eb32bd41e18a5691b7b720992897d8a9c0d5`。実 Worker 稼働時の WAL とファイル量は未計測である。

本担当の権限外実行要求は待機中に作業が中断された。最初の統括担当による実行は次段落の負荷失敗となった。tile miss・旧版比較、RSS/キュー/DB busy/WAL/報告遅延の系列はハーネスに実装していない。cold/warm の 3 回反復と全セルの実行も未実施であり、E1/E2 の合格証拠にはしない。

統括担当による最初の権限外実行（health・同時 1・毎秒 10 件）は 100 要求の後に XML 負荷終了待ちが期限切れとなり、`stage=load_failed`、`parserLoad.ok=false` だった。ハーネスが Worker 準備完了を待たずに負荷メッセージを送っていたこと、要求が約 10 秒で終わり 60 秒全区間を測っていなかったことを修正した。修正版は Worker 準備と負荷開始を確認してから要求を送り、負荷失敗・HTTP 失敗・時間上限超過・投入率不足・60 秒範囲不足を JSON の `judgment` と非 0 終了で示す。

修正版のサンドボックス試行は `listen EPERM` で exit 1、出力 JSON は `stage=measurement_failed` と同じエラーを記録した。測定開始前の環境失敗を成功として扱わない経路は確認した。

統括担当が権限外で実行した health・同時 1・毎秒 10 件の 3 試行は、いずれも `stage=measurement_completed`、`judgment.passed=true`、600 要求・HTTP 失敗 0 件だった。送信直前から本文受信完了までの実値は次のとおり。各セルの要求別生値・時刻・投入率・fixture はリンク先 JSON にある。

| 取得 Worker 負荷 | 期間・処理量・スレッド CPU | p50 / p95 / p99 / 最大 (ms) | 生値 |
| --- | --- | --- | --- |
| 同期 XML 解析 | 60,072 ms、9,703 回解析。旧ハーネスは CPU ms 未収集 | 2.057 / 2.506 / 3.005 / 36.935 | [parser](issue-260-health-parser-c1-r10.json) |
| 実 SQLite 更新 | 処理 60,000 ms、50,151,000 行更新、CPU 59,618 ms | 2.140 / 2.527 / 3.043 / 35.719 | [write](issue-260-health-write-c1-r10.json) |
| 再処理・現況復旧 | 処理 61,009 ms、7,600 件、CPU 59,877 ms | 2.067 / 2.561 / 3.004 / 66.948 | [recovery](issue-260-health-recovery-c1-r10.json) |

3 試行の health 最大値は 500 ms の目標内で、投入率は各約 10 件/秒だった。これは 3 負荷に対する health の同時 1・毎秒 10 件セル各 1 回の結果である。ファイルキャッシュの状態は制御しておらず、cold/warm の分類や 3 回反復はしていない。

parser 負荷で同時 1・毎秒 10 件の 3 API を統括担当が権限外で実行した。各 600 要求・HTTP 失敗 0 件、`stage=measurement_completed`、`judgment.passed=true` で、下表は送信直前から本文受信完了までの値である。

| API | parser 負荷時間・処理量・スレッド CPU | p50 / p95 / p99 / 最大 (ms) | 生値 |
| --- | --- | --- | --- |
| 監視 | 60,037 ms、9,625 回、CPU 59,829 ms | 2.350 / 2.899 / 3.422 / 38.290 | [監視](issue-260-parser-monitoring-c1-r10.json) |
| system 差分 | 60,067 ms、9,665 回、CPU 59,795 ms | 2.359 / 2.801 / 3.379 / 48.670 | [system 差分](issue-260-parser-system-c1-r10.json) |
| 保存済み警報 API | 60,030 ms、9,727 回、CPU 59,867 ms | 2.663 / 3.779 / 271.439 / 286.983 | [警報 API](issue-260-parser-weather-c1-r10.json) |

上記 3 API の最大値は各目標内で、投入率は約 10 件/秒だった。各系列 1 回であり、cold/warm や 3 回反復を満たさない。

同条件の [保存済み tile hit 試行](issue-260-parser-tile-c1-r10.json) は `stage=measurement_failed`、600 要求すべて失敗（404 が 1 件、503 が 599 件）。初回 404 は 5,015.928 ms、全体 p95 は 6.755 ms、最大は 5,015.928 ms で、2,000 ms の目標も超えた。取得 Worker の parser 負荷は 60,064 ms・9,591 回・CPU 59,844 ms まで実行された。旧ハーネスはタイルを静的な `2026-10-11T00:00:00.000Z` の frame で保存し、同じ時刻を URL に使った。試行開始は 04:55 UTC で、提供 Worker は実時刻を使用し、nowcast カタログは現在の表示窓（±60 分）外の frame を除外する。したがって保存済みタイルへの hit 条件を満たしておらず、この試行を実機能の性能評価として扱えない。旧 JSON は失敗 body を保存していないため、404/503 の個々の error code は未確定である。

ハーネスはタイル frame 時刻を実行開始時刻に合わせ、非 200 の body と `X-Wx-Tile-Result` を記録し、すべての要求で `cached` が得られない場合は非 0 終了とした。統括担当が権限外で実行した [修正版 tile hit の生値](issue-260-parser-tile-c1-r10-v2.json) は `stage=measurement_completed`、`judgment.passed=true`。600 要求すべて HTTP 200・`X-Wx-Tile-Result: cached`、失敗 0 件で、p50 6.267 ms、p95 9.064 ms、p99 410.577 ms、最大 631.232 ms だった。取得 Worker の parser 負荷は 60,061 ms・9,257 回・CPU 59,808 ms、投入率は約 10 件/秒。最大値は 2,000 ms の目標内だが、cold/warm 分類や 3 回反復をしていないため E2 全体の判定は保留する。

`BENCH_LOAD=write|recovery` の write は取得 Worker 内の SQLite 接続で既存の受信 1,000 件ずつの `title` を繰り返し更新する。recovery は同 Worker で未処理受信を追加し、既存の `reprocessPendingWarningTelegramReceptions` と `recoverWarningCurrent` を実行する。処理件数は更新行数、または再処理件数と復旧時解析件数の合計であり、異なる仕事量を同一単位として比較しない。両者の負荷時間・スレッド CPU 時間は上表のとおり。

ハーネス追加後に `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run build` を再実行し、すべて exit 0。API/Web の全試験通過報告はハーネス追加前であり、追加 fixture を含む全試験の再実行結果は未取得。

tile 時刻修正後も上記 4 品質ゲートを再実行し、すべて exit 0。`NODE_ENV=production npm run test -w apps/api` はサンドボックス内で再実行したが、HTTP 待受の `listen EPERM` による失敗が複数発生したため中断した。全件完走・合格の証拠にはしない。修正版 tile hit の権限外実測は上記のとおり実施済みで、API 全試験は引き続き必要である。

## 分離前との探索的比較（厳密比較ではない）

2026-10-11 UTC に、#256 直前の `3e95635bf46fb38a559d6ca9d63a36ce414c2ac2` と現ブランチの `5f994e7beb3a0cfef0a9449f0e4f27d3dd159219` を別ディレクトリから起動し、health の1系列を各1回測った。旧版の展開先と計測器は一時領域で、リポジトリには生値 JSON のみを保存した。両試行とも Node v24.20.0、SQLite 3.53.4、同じホスト、seed 260 の5万電文（原文各1,024 bytes、原文 SHA-256 `892676a0ab68480f87d735e11756624653cbfb5c5a386955ddb0a1f7c3bd3962`）、1,024タイル（各65,536 bytes）から開始した。気象 DB 本体は両方とも seed 直後81,866,752 bytes、journal mode は `delete` だった。保持 DB は旧版102,400 bytes、新構成114,688 bytesで一致しない。

外部の独立したクライアントプロセスが `GET /api/health` を100 ms間隔で600件投入し、送信直前から本文受信完了までを測った。各要求のタイムアウトは30秒。負荷は同一 XML 文字列の DOM 解析9,770回。新構成は取得 Worker 内で5秒単位の解析を反復した。旧版はメインスレッドで25解析ごとに `setTimeout(0)` で処理を譲り、同じ解析回数に達するまで反復した。プロセスCPU時間は HTTP/負荷の開始直前から終了までの `process.cpuUsage()` 差分、ピークRSSはプロセス起動以来の `process.resourceUsage().maxRSS` であり、後者は seed 作成・起動時の使用量も含む。

| 系列 | 新構成 | 分離前 |
| --- | ---: | ---: |
| 負荷時間 / 解析回数 | 60.048秒 / 9,770回 | 60.642秒 / 9,770回 |
| プロセスCPU時間 | 67.534秒 | 60.884秒 |
| プロセスのピークRSS | 618,536,960 bytes | 526,327,808 bytes |
| health p50 / p95 / p99 | 2.189 / 2.466 / 3.114 ms | 77.636 / 149.592 / 179.971 ms |
| health 最大値 | 52.520 ms | 504.217 ms |
| HTTP失敗 | 0 / 600 | 0 / 600 |

要求別の送信時刻・latency・status・応答 bytes と資源生値は[新構成](issue-260-exploratory-health-new.json)、[分離前](issue-260-exploratory-health-old.json)に保存した。旧版を800解析ごとに譲渡した先行試行は495件が30秒でタイムアウトしたが、譲渡間隔が製品の実処理と異なるため比較表から除外した。

**解釈の限界:** 旧版は起動時に seed 済み5万件の未処理電文を再処理した一方、新構成は同じ起動処理を行っていない。そのため測定開始時の DB 内容・索引状態が一致しない。また、旧版の負荷は同じ XML 解析をメインスレッドへ注入したもので、実際の取得経路を通した試験ではない。譲渡間隔も旧版の製品挙動を厳密に再現した保証がない。ピークRSSには測定前の処理を含む。1回・healthのみの探索値であり、新構成が「軽くなった」または重くなったとの確定判定にも、E1/E2の合格にも使わない。厳密比較には、両版の測定開始時DBを論理・物理の両面でそろえ、実取得経路で同一処理量を与え、同一外部クライアントと資源サンプリングで全5系列を3回以上反復する必要がある。
