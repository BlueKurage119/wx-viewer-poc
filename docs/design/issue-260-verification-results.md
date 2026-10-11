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
| E2 応答 | 未達・一部未検証 | 初期の部分試行は成功したが、実警報XML 20,000件の取得中、保存済み警報APIが新構成で600件中104/110/118件の503を返した。受け入れ条件の失敗0を満たさない。残る負荷組合せ・並行数・cold/warm等も未検証 |
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

## 同一解析回数による5系列の再測定（探索的・厳密比較ではない）

2026-10-11 UTC に、旧版 `3e95635bf46fb38a559d6ca9d63a36ce414c2ac2` と新構成 `abeb45a18b7607ee305f52dfdfdd453bec49c492` を各系列3ペア測定した。旧版の `@wx-viewer-poc/shared` は旧版コミットからビルドしたものを明示的に解決させた。上の初回比較は旧版で新構成の shared を解決していたため、この再測定と混ぜない。各試行の時刻、要求600件それぞれの送信時刻・status・bytes・latency、CPU/RSS、生 DB 値は [30試行の生値](issue-260-parser-comparison.ndjson) に保存した。NDJSON の1行が1試行で、`series`・`repeat`・`mode` と `record` を持つ。

両版で Node v24.20.0、Darwin 25.6.0 x64、論理12コア、SQLite 3.53.4、`NODE_ENV=production` を使用した。seed 260 の原文5万件×1,024 bytes、PNG 1,024枚×65,536 bytesを生成し、原文 SHA-256 は `892676a0ab68480f87d735e11756624653cbfb5c5a386955ddb0a1f7c3bd3962`、PNG SHA-256 は `e36ebe4782b232411ca8b2d8e2e3eb32bd41e18a5691b7b720992897d8a9c0d5` で一致した。再処理の交絡を避けるため、原文の電文種別は両版とも `VPXX99` とした。気象 DB 本体は各 seed 直後81,928,192 bytes、5万行、`journal_mode=delete` で一致した。保持 DB 本体は旧版102,400 bytes、新構成114,688 bytesで一致せず、起動後の DB ファイルや WAL の物理一致も確認していない。保存済み警報 API の事前応答は各ペアで同じ454 bytes・同じ本文ハッシュ、タイルは各ペアで同じ65,536 bytes・同じ PNG ハッシュ・`X-Wx-Tile-Result: cached` を確認した。

外部の独立したクライアントプロセスから同じパスへ100 ms間隔で600要求を送った。各要求の期限は30秒で、並行数の上限は設けていない。ウォームアップとして負荷前に対象 API を1回呼んだ。XML は同じ500要素の文字列を**各試行11,000回** DOM 解析した。新構成は取得 Worker 内で1,000回ずつ、旧版はメインスレッドで25回ごとに `setTimeout(0)` で譲った。この方法は解析量を固定するが、旧版の実取得フロー、DB書込、復旧、譲渡の製品挙動を再現しない。解析負荷の実時間は試行ごとに異なり、下表に記録した。`process.cpuUsage()` は負荷・外部クライアント開始直前から終了までのプロセス全体、RSS は同区間を100 ms間隔で採取した最大値で、メインと全 Worker を含む。同区間の CPU はクライアントの残要求待ち時間も含む。`resourceUsage().maxRSS` による起動以来の最大値も生値にある。

次の各セルは反復1/2/3の順。CPU は秒、RSS は MiB、応答と解析実時間は ms、失敗は600件中の件数である。p95 はタイムアウトも含む。

| 系列 | 版 | 解析実時間 (秒) | CPU (秒) | ピークRSS (MiB) | p95 (ms) | 最大 (ms) | 失敗 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| health | 新 | 74.7 / 72.2 / 95.7 | 75.0 / 72.6 / 88.1 | 579.7 / 589.3 / 588.8 | 2.7 / 2.8 / 4.7 | 58.5 / 85.5 / 61.7 | 0 / 0 / 0 |
| health | 旧 | 72.4 / 69.8 / 82.9 | 71.8 / 69.5 / 81.5 | 485.1 / 468.0 / 478.5 | 178.9 / 160.5 / 189.7 | 953.3 / 787.4 / 1358.0 | 0 / 0 / 0 |
| 監視 | 新 | 105.1 / 86.4 / 90.0 | 88.0 / 87.2 / 88.2 | 557.7 / 533.1 / 549.2 | 4.5 / 3.2 / 3.3 | 67.9 / 63.4 / 64.8 | 0 / 0 / 0 |
| 監視 | 旧 | 89.4 / 91.8 / 80.4 | 89.3 / 91.5 / 80.1 | 486.0 / 381.6 / 459.7 | 216.1 / 230.4 / 225.9 | 1587.1 / 1424.7 / 1526.1 | 0 / 0 / 0 |
| system 差分 | 新 | 69.4 / 82.2 / 85.4 | 70.2 / 78.7 / 76.4 | 570.9 / 579.8 / 573.5 | 3.0 / 3.4 / 3.2 | 60.2 / 57.5 / 58.6 | 0 / 0 / 0 |
| system 差分 | 旧 | 71.8 / 74.8 / 70.6 | 71.7 / 70.9 / 70.6 | 487.4 / 466.0 / 502.5 | 160.4 / 515.7 / 157.9 | 1039.3 / 4457.5 / 817.5 | 0 / 0 / 0 |
| 保存済み警報 API | 新 | 75.3 / 69.1 / 69.7 | 76.4 / 70.2 / 70.9 | 503.0 / 583.3 / 584.7 | 3.7 / 4.0 / 3.7 | 65.7 / 53.2 / 62.4 | 0 / 0 / 0 |
| 保存済み警報 API | 旧 | 76.1 / 70.1 / 71.1 | 74.7 / 70.1 / 71.1 | 464.5 / 488.6 / 487.0 | 204.7 / 165.6 / 163.8 | 3053.8 / 949.7 / 996.4 | 0 / 0 / 0 |
| 保存済み tile hit | 新 | 72.1 / 78.8 / 77.9 | 75.8 / 77.9 / 81.6 | 575.5 / 580.9 / 577.5 | 9.8 / 9.9 / 10.3 | 54.7 / 68.5 / 69.9 | 0 / 0 / 0 |
| 保存済み tile hit | 旧 | 78.7 / 75.0 / 83.6 | 80.2 / 77.1 / 82.1 | 468.8 / 411.1 / 485.9 | 30002.8 / 30002.7 / 30002.7 | 30038.0 / 30022.3 / 30018.4 | 422 / 378 / 506 |

この合成解析負荷では、新構成の5系列の応答 p95 は旧版より短く、タイル要求のタイムアウトも起きなかった。一方、新構成のピークRSSは全15ペアで旧版より大きく、CPU時間も多くのペアで増えた。解析の実時間と処理経路、保持 DB のサイズが異なるため、「Worker分離で製品全体が軽くなった」とは判定できない。今回確認できたのは、この固定解析量の試験での HTTP 応答分離の効果である。旧版の実取得経路で同じ入力を再現できておらず、外乱・swap、cold/warm、同時数1/8、毎秒1要求、write/recovery、main/両 Worker 別の資源、キュー・WAL の記録もない。E1/E2 は引き続き一部実施である。

計測器は `apps/api/tests/issue260Compare.mts`、外部要求列は `apps/api/tests/issue260CompareClient.mjs`、ペア実行は `apps/api/tests/issue260CompareRunner.mjs`、新構成への負荷注入は `apps/api/tests/fixtures/worker/issue260-compare-load.ts`。再現時はリポジトリルートから次を実行する。旧版の展開とビルドに成功したこと、旧版 API の依存解決が旧 shared を指すことを確認してからペア実行する。

```bash
mkdir -p apps/api/data/issue260-baseline apps/api/data/issue260-compare
git archive 3e95635bf46fb38a559d6ca9d63a36ce414c2ac2 | tar -x -C apps/api/data/issue260-baseline
ln -s ../../../../node_modules apps/api/data/issue260-baseline/node_modules
node node_modules/typescript/bin/tsc -p apps/api/data/issue260-baseline/packages/shared/tsconfig.json
mkdir -p apps/api/data/issue260-baseline/apps/api/node_modules/@wx-viewer-poc
ln -s ../../../../packages/shared apps/api/data/issue260-baseline/apps/api/node_modules/@wx-viewer-poc/shared
BENCH_BASELINE_ROOT=apps/api/data/issue260-baseline BENCH_OUTPUT_DIR=apps/api/data/issue260-compare BENCH_CURRENT_COMMIT=abeb45a18b7607ee305f52dfdfdd453bec49c492 BENCH_FIXED_ITEMS=11000 node apps/api/tests/issue260CompareRunner.mjs health 1 3
```

最後のコマンドの `health` を `monitoring`、`systemDelta`、`weather`、`tileHit` に替えて各系列を実行する。固定コミットの取得にはローカル Git 履歴が必要で、旧版を展開したディレクトリは Git 管理外である。生成 JSON は出力先から検証して NDJSON に集約した。

比較計測器・結果文書の追加後に `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run build` はすべて exit 0。`NODE_ENV=production npm run test -w apps/api` は 1,074/1,074 件成功、exit 0。今回の合成負荷を通常のテストファイルとして自動実行はしない。5系列×3ペアの計30実行で、`stage=completed`、固定解析11,000回、各600要求、解析60秒以上を検証した。

## 実取得経路の小規模試行（探索的・比較判定には使わない）

旧版と新構成に同じAtomフィードと警報XMLを返すテスト用 `fetch` を注入し、製品の `POST /api/control/fetch/force-refresh` から通常のフィード解析、電文取得、警報解析、`telegram_reception` 保存まで動かした。新構成ではテスト用取得Worker入口で `fetch` を差し替え、旧版では既存の `pollingServiceOptions.fetchFn` を使った。初回取得時は空フィードとし、両版が待受・準備完了してからフィードを有効化した。対象は1会場の `VPWW55` を100件、各版の保存行数100件を読み取って確認した。初期DBは上節と同じ5万行・気象DB 81,928,192 bytesで、保持DBは旧102,400 bytes・新114,688 bytesだった。各版の実行順は新→旧、外部クライアントの health 600要求を100 ms間隔で投入した。[2試行の要求別・資源生値](issue-260-real-poll-pilot.ndjson) に実時刻・DB条件・強制更新操作結果も保存した。

| 指標 | 新構成 | 旧版 |
| --- | ---: | ---: |
| 保存済み `VPWW55` | 100件 | 100件 |
| 電文投入から保存件数確認まで | 591.4 ms | 1,067.8 ms |
| 60秒のHTTP要求区間を含むプロセスCPU | 1,743.3 ms | 1,551.1 ms |
| 同区間のピークRSS | 566,992,896 bytes | 498,483,200 bytes |
| health p50 / p95 / p99 / 最大 | 2.752 / 3.767 / 4.400 / 54.598 ms | 2.905 / 3.885 / 34.239 / 633.417 ms |
| HTTP失敗 | 0 / 600 | 0 / 600 |

両版の強制更新操作自体は `result=failure` だった。XMLは100件保存できたが、同じ操作が並行実行する画像など他取得元へのテスト用 `fetch` は有効な形式を返していない。旧版の `errorMessage` は `nowcast,kikikuru`、新版は `Error: force_refresh_failed` と記録された。このため成功した製品全体の取得サイクルとは扱わない。電文処理が約0.6～1.1秒で終わるのに対しHTTP計測は60秒で、応答分布・CPU/RSSは主に負荷終了後の時間も含む。1ペア、warm、同時上限未設定、保持DBサイズ差があり、「軽くなったか」の判定には使わない。下節で電文件数を増やし、両版のXML処理が60秒以上続く条件を反復した。

再現コマンドは前節の旧版展開・旧 shared ビルド後、同じリポジトリルートから次を実行する。

```bash
BENCH_BASELINE_ROOT=apps/api/data/issue260-baseline BENCH_OUTPUT_DIR=apps/api/data/issue260-real-pilot BENCH_CURRENT_COMMIT=eb85585a1c5303ae7d7f1c181396059a8de5ee1f BENCH_FIXED_ITEMS=100 BENCH_REAL_POLL=1 node apps/api/tests/issue260CompareRunner.mjs health 1 1
```

## 実警報取得を60秒以上続けたhealth比較（範囲限定）

前節と同じ実際のAtom取得→XML取得・解析→警報保存を、フィード内の電文件数を増やして測った。12,000件の1ペアでは新構成の処理が42.5秒、旧版が69.7秒となり、新構成が60秒条件に届かなかったため本比較から除外した。この試行も[生値](issue-260-real-poll-load.ndjson)に残した。20,000件に増やした3ペアは両版とも電文20,000件を保存し、処理時間が60秒以上になった。各ペアで初期気象DBは81,928,192 bytes・5万行、原文 seed SHA-256 は上節と一致した。保持DBは旧版102,400 bytes、新構成114,688 bytes。投入したAtomフィードは5,437,845 bytes、SHA-256 `2e3bf83e37a0ca040c44b57ab5a19b31b7aefabfb67b3fc3028a856adc5438f5`。各警報XMLは769 bytes、SHA-256 `6f26ee0ffb2bd1ae881ac01c513470027c4d0d5f6aefe9e4cb6289b813f8f60a`。URLだけを変えた同じXMLを20,000件送った。実運用の電文分布を表すものではない。OS/Node/SQLite、1会場の要求、外部クライアント600件・100 ms間隔・30秒期限は前節と同じ。`BENCH_FIXED_ITEMS` はこの系列では解析回数ではなくAtom内の電文件数を意味する。

各セルは反復1/2/3の順。処理時間は強制更新要求を開始してから20,000件の保存確認まで、CPUはHTTP要求を開始した直後から保存確認・要求終了までのプロセス全体、ピークRSSは同区間を100 msで採取した最大値。HTTP要求は最初の60秒で全600件を投入したため、旧版では処理終了までに要求投入が終わっている。個々の送信時刻・latency・status・エラー・CPU/RSSの生値は[実取得9試行](issue-260-real-poll-load.ndjson)に保存した。9試行には12,000件2本、20,000件の3ペア6本、旧版の失敗原因診断1本を含む。

| 指標 | 新構成 1 / 2 / 3 | 旧版 1 / 2 / 3 |
| --- | --- | --- |
| 警報電文保存件数 | 20,000 / 20,000 / 20,000 | 20,000 / 20,000 / 20,000 |
| 処理時間 (秒) | 86.0 / 78.5 / 82.6 | 160.3 / 148.2 / 156.7 |
| プロセスCPU (秒) | 80.6 / 79.4 / 82.0 | 123.5 / 117.3 / 120.6 |
| ピークRSS (MiB) | 786.9 / 872.7 / 882.5 | 2,018.8 / 1,956.8 / 2,020.5 |
| health p50 (ms) | 2.2 / 2.1 / 2.3 | 7,775.2 / 7,775.1 / 7,775.4 |
| health p95 (ms) | 3.9 / 2.7 / 2.9 | 30,001.5 / 30,001.4 / 30,001.4 |
| health 最大 (ms) | 72.6 / 60.3 / 65.8 | 30,036.3 / 30,003.9 / 30,004.3 |
| health失敗 | 0 / 0 / 0 | 600 / 600 / 600 |

旧版の各600失敗は、記録上いずれも30秒タイムアウト128件と `TypeError: fetch failed` 472件に分かれた。最初の3ペアでは `fetch failed` の内部 `cause` を保存していなかったため、その3回の472件を原因別に確定できない。同じ20,000件条件で旧版だけを追加診断した結果も128件の30秒タイムアウト、472件の `fetch failed` で、後者の `cause.code` は472件すべて `ETIMEDOUT`、`cause` は `connect ETIMEDOUT 127.0.0.1:<隔離ポート>` だった。接続待ちが期限切れになったことを示す。旧版サーバーは各試行で20,000件保存と正常終了まで進んでおり、計測途中のプロセス終了は確認されていない。診断試行のエラー内訳を最初の3ペアへ遡及して同一原因と断定はしない。計測器はこの診断以降、HTTP失敗の `cause`、`causeCode`、集約エラーの内訳も保存する。

**判定範囲:** この固定警報XMLの実取得経路に限れば、新構成は同じ20,000件を短い時間・少ないプロセスCPU・低いピークRSSで保存し、同時のhealth要求も全件成功した。前節の合成解析では新構成のRSSが大きかったが、入力と処理経路が違うため、相反する測定結果として両方残す。今回も両版の強制更新操作全体は `result=failure` である。XML保存は成功した一方、同じ操作に含まれる画像等は空のテスト応答で失敗した。新構成のエラーは `force_refresh_failed`、旧版は `nowcast,kikikuru` または `nowcast,kikikuru,amedas` と記録された。これは画像等の正常取得性能を測った試行ではない。旧版と新構成の保持DBサイズ差、OSキャッシュ未制御、warmのみ、並行数の上限なし、healthのみ、1つのXMLをURLだけ変えて反復、外乱・swap未計測、Worker別CPU/RSS未採取も残る。製品全体の資源削減やE1/E2合格は主張できない。次はXMLだけを対象にできる操作入口または他取得元の有効fixtureを用意し、監視/system差分/保存済みAPI/tile hitとcold/warm・同時数別の比較を行う。

再現時は前節の旧版展開・旧 shared ビルドに続き、リポジトリルートで次を実行する。

```bash
BENCH_BASELINE_ROOT=apps/api/data/issue260-baseline BENCH_OUTPUT_DIR=apps/api/data/issue260-real-load BENCH_CURRENT_COMMIT=eb85585a1c5303ae7d7f1c181396059a8de5ee1f BENCH_FIXED_ITEMS=20000 BENCH_REAL_POLL=1 node apps/api/tests/issue260CompareRunner.mjs health 1 3
```

実取得用fixture・失敗原因記録・結果文書の追加後に `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run build` はすべて exit 0。`NODE_ENV=production npm run test -w apps/api` は 1,074/1,074 件成功、exit 0。実取得の比較計測は独立の手動ハーネスで、通常のテスト群には含めていない。

## 実警報取得20,000件中の残る4系列（各3ペア）

health と同じ Atom 20,000件、同一警報XML、初期 DB、旧 shared、新→旧のペア順、外部クライアント600要求・100 ms間隔・30秒期限で、監視、system 差分、保存済み警報 API、保存済み tile hit を各3回測った。全24試行で20,000件を保存し、取得処理は60秒以上続いた。各試行の要求別status/body/hash/latency、CPU/RSS、fixture/DB初期値、時刻と強制更新操作の結果は[26試行の生値](issue-260-real-poll-other-apis.ndjson)に保存した。25・26本目は下記503原因の診断試行である。`stage=completed` は計測完了を表し、HTTP成功や強制更新成功の合否ではない。

各セルは反復1/2/3の順。CPUはプロセス全体の実使用時間、RSSは取得・HTTP期間に100 msで測ったピーク。p95と最大には失敗要求も含む。応答単位はms、処理・CPUは秒、RSSはMiB。

| API | 版 | 20,000件の処理時間 | CPU | ピークRSS | p95 | 最大 | HTTP失敗/600 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 監視 | 新 | 76.8 / 77.2 / 75.9 | 77.5 / 78.1 / 75.5 | 883.8 / 825.8 / 872.1 | 3.4 / 3.5 / 3.3 | 64.6 / 63.9 / 59.6 | 0 / 0 / 0 |
| 監視 | 旧 | 129.6 / 134.1 / 134.7 | 102.7 / 106.9 / 106.6 | 1,997.2 / 2,003.0 / 1,973.8 | 30,001.6 / 30,001.8 / 30,001.4 | 30,003.7 / 30,003.1 / 30,003.6 | 600 / 600 / 600 |
| system 差分 | 新 | 75.3 / 77.9 / 73.3 | 75.9 / 78.9 / 74.8 | 898.2 / 795.7 / 891.4 | 2.8 / 3.0 / 2.9 | 54.1 / 57.7 / 55.7 | 0 / 0 / 0 |
| system 差分 | 旧 | 132.6 / 133.0 / 130.5 | 105.7 / 105.6 / 104.2 | 1,977.7 / 2,008.8 / 2,019.3 | 30,001.8 / 30,001.6 / 30,001.8 | 30,004.7 / 30,003.4 / 30,003.4 | 600 / 600 / 600 |
| 保存済み警報 API | 新 | 76.9 / 72.8 / 73.6 | 77.0 / 74.2 / 75.1 | 876.2 / 873.4 / 898.1 | 5.8 / 4.4 / 4.0 | 160.6 / 236.3 / 163.8 | **104 / 110 / 118** |
| 保存済み警報 API | 旧 | 128.2 / 128.0 / 131.2 | 102.0 / 102.3 / 103.3 | 2,018.1 / 1,980.5 / 1,965.8 | 30,001.7 / 30,001.4 / 30,001.5 | 30,002.9 / 30,003.5 / 30,011.1 | 600 / 600 / 600 |
| 保存済み tile hit | 新 | 72.9 / 73.1 / 71.9 | 78.7 / 78.7 / 77.4 | 942.7 / 925.4 / 943.5 | 16.1 / 12.1 / 28.4 | 263.2 / 229.4 / 289.4 | 0 / 0 / 0 |
| 保存済み tile hit | 旧 | 129.4 / 125.1 / 129.2 | 104.8 / 101.0 / 104.3 | 1,962.6 / 2,008.3 / 1,982.2 | 30,001.3 / 30,001.8 / 30,001.7 | 30,007.7 / 30,003.9 / 30,003.1 | 600 / 600 / 600 |

旧版12試行の各600失敗は、いずれも30秒タイムアウト128件、`TypeError: fetch failed` 472件だった。後者の `cause.code` は全件 `ETIMEDOUT`、内容は隔離ポートへの `connect ETIMEDOUT`。各旧版サーバーは20,000件を保存して正常終了し、試行途中のプロセス終了は観測していない。HTTP要求は最初の60秒で投入されるため、旧版では多くの接続待ちが処理完了より先に期限切れになった。負荷側の待受キューの具体的な長さは未計測である。

保存済み警報 API の事前応答は各ペアで454 bytes・本文SHA-256が一致した。タイルも各ペアで65,536 bytes・同一PNGハッシュ・`X-Wx-Tile-Result: cached` が一致し、新構成の負荷中600件は各回すべて成功した。監視は版ごとに事前本文サイズ・ハッシュが異なり、system 差分も時刻等の可変値で事前ハッシュが異なるため、これらの本文同一性は確認していない。

### 保存済み警報 API の503切り分け

新構成の失敗104/110/118件はすべて HTTP 503、body `{"status":"error","code":"weather_worker_unavailable"}` だった。事前応答は200で、503は最初の約1秒以降から60秒の取得負荷中に散在した。反復1の10秒ごとの503件数は13/14/13/29/16/19、反復2は21/19/16/22/19/13、反復3は13/17/23/22/24/19で、単発の起動失敗や停止後だけの障害ではない。

テスト専用の `DeliveryWorkerHost.read/readHttp` 観測を追加して新構成の同条件を1回診断した。警報APIは600件中200が498件、503が102件。`readHttp('weather.read')` は事前確認を含む601件すべて成功し、読取時の提供Worker状態は全件 `lifecycle=ready`、`reportFreshness=fresh`、`exitConfirmed=false`、`failureCode=null`。別の監視標本読取64件も成功した。503の最初は要求番号12・負荷開始後約1.2秒、最後は番号599・約59.9秒で、10秒ごとの件数は14/15/22/18/15/18。提供Workerの停止・報告stale・読取transport失敗はこの診断では観測されていない。DB busyの発生回数・待機時間は採取していないが、503になった要求の提供Worker読取自体は成功している。

この診断に限って `BENCH_DIAG_DELIVERY=1` を加え、[計測専用の提供読取プローブ](../../apps/api/tests/issue260DeliveryProbe.mjs)を有効化した。プローブは成功・失敗とその時点の `lifecycle`・`reportFreshness`・`exitConfirmed` を保存する。元の3ペアには追加していないため、上の601件の観測は診断1回の値である。

[取得後の照合処理](../../apps/api/src/runtime/startWorkerServer.ts) は提供Workerの読取結果を受けた後、DB世代・取得scopeの状態を `assertCurrentRead` で再検査する。そこで発生する `generation_changed` は[HTTPエラー変換](../../apps/api/src/app.ts)により同じ503 bodyへ変換される。26本目は `BENCH_DIAG_DELIVERY=1 BENCH_DIAG_READ_REJECTION=1` で同じ20,000件・600要求を実施し、照合処理の例外コードをテスト専用フックで直接記録した。取得は71,503 ms、警報XMLの保存は20,000件、HTTPは200が478件・503が122件で、503のbodyは全件 `weather_worker_unavailable`。提供Workerの `weather.read` は事前確認を含む601件すべて成功し、状態は全件 `ready`・`fresh`・`exitConfirmed=false`・`failureCode=null` だった。一方、`assertCurrentRead` は `weather.read` を125回拒否し、コードは125件すべて `generation_changed` だった。最初の拒否は08:49:06.846 UTC、最後は08:50:05.447 UTC。HTTP 503との件数差3件は、このフックと外部クライアント間に要求IDの対応付けがないため個別には確定できない。503の直接原因として取得後の世代照合拒否が実測で確認されたが、どのepoch・scope条件が変化したかは未採取である。#258の提供・公開境界の責務へ再現条件とともに差し戻す候補である。フックは省略時に動作せず、診断以外の応答処理は変更していない。設計のE2は失敗0の条件を満たさず、受け入れ不可である。

26本目の実行条件は `NODE_ENV=production BENCH_MODE=new BENCH_SERIES=weather BENCH_FIXED_ITEMS=20000 BENCH_REAL_POLL=1 BENCH_DIAG_DELIVERY=1 BENCH_DIAG_READ_REJECTION=1`。計測器は `node --import tsx apps/api/tests/issue260Compare.mts`、`BENCH_ROOT=.`、`BENCH_OUTPUT=<一時出力先>`、`BENCH_COMMIT=2c447dc6d7f2b2b025c72a53fc70b6cb6a314c50` とした。結果は生値ファイルの最終行に保存した。診断フック追加後の `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run build` はすべて exit 0、`NODE_ENV=production npm run test -w apps/api` は1,074/1,074件成功した。

全試行で強制更新操作全体は `result=failure`。テスト用 `fetch` が警報Atom/XML以外のURLには空本文を返すため、画像・アメダス等の取得解析は失敗する。警報XMLの20,000件保存成功と、強制更新全体の失敗を別々に扱う。これら別種の正常fixtureを用意しなければ製品の全取得サイクルの成功は測れず、今回のCPU/RSSには他取得元の失敗処理も含まれる。今回の比較は単一の警報XMLをURLだけ変えた負荷、warm、1会場、同時数上限なし、OSキャッシュ/外乱/DB busy未計測に限定する。監視/system差分/tileでは新構成の応答と資源が旧版より良好だったが、製品全体の軽量化やE1/E2の合格は主張しない。

再現時は前節の旧版展開・ビルドに続き、次の `health` を `monitoring`、`systemDelta`、`weather`、`tileHit` に替えて各系列を実行する。

```bash
BENCH_BASELINE_ROOT=apps/api/data/issue260-baseline BENCH_OUTPUT_DIR=apps/api/data/issue260-real-all BENCH_CURRENT_COMMIT=673bf08769856c2ff56e08327d6fc66980320ebd BENCH_FIXED_ITEMS=20000 BENCH_REAL_POLL=1 node apps/api/tests/issue260CompareRunner.mjs health 1 3
```

4系列の生値・診断プローブ・結果文書の追加後、`npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run build` はすべて exit 0。`NODE_ENV=production npm run test -w apps/api` は1,074/1,074件成功、exit 0。
