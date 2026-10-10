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
| サンドボックス外での API 試験再実行 | 権限要求中に作業ターンが中断され、結果を取得できなかった | 未実施 |
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
