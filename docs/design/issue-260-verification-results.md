# Issue #260 統合検証結果

## 記録の範囲

2026-10-11 JST 時点の製造段階の記録。設計条件は [Issue #260 設計](issue-260-two-worker-integrated-verification.md) に従う。この記録は E1〜E12 の完了報告ではない。試験環境のローカル HTTP 接続が `EPERM` で拒否され、実 HTTP・ブラウザ・性能・rollback の実測値を取得できていない。失敗した試行を性能判定から除外していない。

## 固定した条件と未取得の入力

| 項目 | 記録 |
| --- | --- |
| 比較元 | `3e95635bf46fb38a559d6ca9d63a36ce414c2ac2` |
| 対象の基準 | `8ad36a6215fe8a622c0f2fed898700820973f387` |
| rollback 対象 | `261913362c09db585cb3263e6abbd6e86904fe88` |
| 設計後の作業基点 | `30a889e0d3f9aea7c4cfdb718c4b151a6a939f1b`、開始時 clean |
| OS・CPU・メモリ | Darwin 25.6.0、x64、論理 12 コア、34,359,738,368 bytes |
| Node・driver | Node v24.20.0、better-sqlite3 13.0.3。Node の SQLite 表示は 3.53.4。driver が使用する SQLite 版は未取得 |
| DB/WAL 設定・会場/端末 | 未記録。負荷 fixture 未作成のため対象構成として固定できていない |
| fixture と量 | 5万電文・1 KiB 原文・1,024 枚の 64 KiB タイルという設計条件のみ。seed、ハッシュ、DB/原文/タイル実 bytes は未取得 |
| 計測開始・終了 | 性能計測を開始していないため該当なし |

設計の API 上限値（health 500 ms、監視 1,000 ms、system 差分・保存済み API・tile hit 各 2,000 ms、tile miss 30 秒）は目標であり、達成実績ではない。cold/warm、同時 1/8、毎秒 1/10、各セル 100 件以上・3 回以上、取得の実解析・大量保存・復旧各 60 秒以上は未実施。要求別 latency/status/bytes、p50/p95/p99/最大、CPU/RSS/heap、イベントループ、キュー、busy/WAL、報告遅延、外乱、空運転も未取得。

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
| 実 Worker・実 HTTP の負荷と障害注入 | 専用 fixture・隔離ポート・生ログなし | 未実施 |
| 実ブラウザ操作 | スクリーンショット・操作ログなし | 未実施 |
| 旧版比較・rollback・reset | 隔離 DB の複製と互換検証なし | 未実施 |

既存試験には Worker 起動、異常 exit、再開、世代、reader、タイル競合、通知の個別試験がある。しかし、この試行では全件合格を確認できず、設計 §4 の横断検証の代用にはしない。追加のテストコードは作成していないため、red 確認と対照実験の対象もない。

## 受け入れ条件

| 条件 | 状態 | 不足する証拠 |
| --- | --- | --- |
| E1 条件固定 | 未達 | fixture の seed/hash/実 bytes、全設定、実コマンド列、同一入力の再生成 |
| E2 応答 | 未検証 | 実負荷 3 系列、全セルの生値と資源系列、旧版比較 |
| E3 起動隔離 | 未検証 | open/migration と保持側障害の実注入ログ |
| E4 role 別障害 | 未検証 | 両 role の停止・exit・応答途絶を別々に観測したログ |
| E5 世代 | 未検証 | 旧 exit、DB 世代、tracker/健全性の横断照合 |
| E6 競合 | 未検証 | 更新・端末起動・通知保存・操作喪失の完全一致記録 |
| E7 reader/容量 | 未検証 | busy、miss、清掃、容量限界の実測と失敗 body |
| E8 データ意味 | 未検証 | 1/複数会場と H/K、状態別の実応答 |
| E9 ブラウザ | 未検証 | 実操作・画面・API/履歴の照合 |
| E10 停止/reset/rollback | 未検証 | 資源残 0、reset、旧版 DB 互換または復元 |
| E11 手順 | 一部作成、未検証 | [運用手順](../operations/weather-workers.md) の分岐ごとの実行記録 |
| E12 品質 | 未達 | lint・typecheck・format:check・build は通過。API/Web 全試験は接続制限のない環境で再実行が必要 |

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

`apps/api/tests/issue260Benchmark.mts` を追加した。seed 260 から 5 万件の 1,024 bytes 原文（normal 16,667、training 16,667、test 16,666）と、1,024 枚の 65,536 bytes PNG を一時 DB/cache に生成する。PNG は同一内容を別ファイル名で保存するため、実運用の画像分布は再現しない。実取得・提供 Worker と HTTP を起動し、取得 Worker で同期 XML 解析を最低 60 秒反復する。1 回につき health、監視、system 差分、保存済み警報 API、保存済み tile hit のうち指定した 1 系列を 100 要求以上実行し、要求単位の送信相対時刻・latency・status・bytes と分位点を JSON へ記録する。`BENCH_CONCURRENCY=1|8`、`BENCH_RATE=1|10` を選べる。

再現コマンド（`apps/api` で実行、出力先は任意の書込可能な一時ファイルに変更する）:

```bash
NODE_ENV=production BENCH_OUTPUT=./issue260-benchmark.json BENCH_SERIES=health BENCH_CONCURRENCY=1 BENCH_RATE=10 node --import tsx tests/issue260Benchmark.mts
```

サンドボックス内の試行では fixture の生成まで完了し、`listen EPERM 0.0.0.0` で実 Worker の HTTP 待受が拒否された。生成段階の機械可読値は [fixture manifest](issue-260-fixture-manifest.json) に保存した。2026-10-11 02:20:34 UTC 開始の試行で気象 DB 本体 81,928,192 bytes、保持 DB 本体 114,688 bytes、SQLite 3.53.4、seed 段階の journal mode は両 DB とも `delete`。原文 SHA-256 は `892676a0ab68480f87d735e11756624653cbfb5c5a386955ddb0a1f7c3bd3962`、PNG SHA-256 は `e36ebe4782b232411ca8b2d8e2e3eb32bd41e18a5691b7b720992897d8a9c0d5`。実 Worker 稼働時の WAL とファイル量は未計測である。

権限外実行の要求は待機中に作業が中断されたため、HTTP の latency/status/bytes と解析反復回数は得られていない。このハーネスは現時点で XML 解析負荷のみを発生させ、大量保存・復旧・tile miss・旧版比較、CPU/RSS/キュー/DB busy/WAL/報告遅延の系列は実装していない。cold/warm の 3 回反復と全セルの実行も未実施であり、E1/E2 の合格証拠にはしない。

ハーネス追加後に `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run build` を再実行し、すべて exit 0。API/Web の全試験通過報告はハーネス追加前であり、計測コード自体の HTTP 完走は未確認である。
