# Issue #20 製造差戻しの修正・検証記録

実施日: 2026-09-12  
担当: Codex（GPT-6）  
対象ブランチ: `feature/issue-20-nowcast-tiles`  
仕様: [承認済み設計](design/issue-20-nowcast-tiles.md)  
修正前: `bbc3ef9`

## 修正内容

- タイルを1座標ずつ GET → PNG検証結果を記録 → ファイル保存 → DB登録の順で処理する。保存障害後は後続 GET を中止し、finally で実施済み GET だけを履歴1行にまとめる。
- 保存失敗時の後始末は、今回作成した本体かつ DB 非参照の場合だけ行う。先行成功タイルや既存本体を削除しない。
- 履歴保存失敗を呼出元へ返す。保存エラーもある場合は AggregateError で両原因を保持し、後始末自体の失敗も元の原因を失わず返す。
- constructor 内で同期清掃を完了し、再生成直後の readCatalog 契約を維持する。変更操作との競合や未処理 Promise を作らない。
- elements は全要素が文字列の場合だけ採用する。許可ズーム設定・XYZの安全整数検証を補完する。

## 再現と検証

すべて実 migration 適用済み SQLite と専用一時ディレクトリ、注入 fetch／clock で実行した。fixture の PNG は Python の Base64 デコード・hashlib で独立確認し、70 bytes、SHA-256 `6b7fa434f92a8b80aab02d9bf1a12e49ffcae424e4013a1c4f68b67e3d2bbcd0` を期待定数にした。

| 条件 | 実行方法・結果 |
| --- | --- |
| 2座標目の write／rename／DB 保存障害 | fs.promises の対象操作または SQLite trigger を失敗させた。3座標要求で GET は先頭2件のみ。1件目の DB 全保存列・画像バイト列が完全一致、PNG一覧は1件のみ、一時ファイルなし。履歴は itemCount=2、failedItemCount=0、responseBytes=140、outcome=success。保存障害は例外として返る |
| 履歴失敗 | fetch_attempt の INSERT trigger を失敗させた。正常保存後も例外が返り、保存済みタイルは保持。保存も失敗させると errors は保存・履歴の2原因に完全一致 |
| 既存本体・後始末失敗 | DB byte_size のみ壊して再取得し、DB保存を失敗させた。既存正常本体とDB行は保持。新規本体の後始末を失敗させても保存・後始末の2原因が残る |
| available／stale の欠落・改変 | 3枚のうち1枚削除、1枚を同サイズで改変。available は2 GETで修復、残りはcached。stale は2枚とも catalog_stale、正常1枚はstale cached。URL配列は空 |
| 再生成時の清掃 | 一度正常保存後に一覧取得を失敗させ、孤児PNG・一時ファイルを配置。サービス再生成だけで清掃が完了し、stale のカタログ・参照画像は完全一致で保持。外部sentinelは不変 |
| 競合と一覧更新 | 制御Promiseで2枚目GETを停止し、その間に一覧更新・同座標要求をキュー投入。解放後はdownloaded／cached、各座標GET1回、継続frame ID・先行別座標保持。次に一覧削除処理を停止して後続要求を投入し、解放後はframe_not_availableでDB・画像は復活しない |
| elements の構造不正 | hrpns＋数値、null、別要素＋objectを正常行の後ろに追加し、一覧全体のinvalid_structureを完全一致で検証 |

設計§8の従来試験（時刻・窓・N1/N2独立・鮮度・入力拒否・重複取得・PNG異常・通信履歴）と上表を合わせ、対象3ファイル25件を実行した。フロントエンド、shared、migration、HTTPエンドポイントの変更はない。

## 対照実験と red

対象3テストファイルを毎回実行した。先にサービス先頭へコメントだけを挿入する対照実験が exit 0 になることを確認し、以下の改変はすべて exit 1 で該当アサーションが失敗した。各回後に原状復帰し、検証スクリプトも削除した。

| 意図的な改変 | 検出した試験 |
| --- | --- |
| 窓フィルター無効 | parser の両端・外側、service の時間経過後の窓 |
| baseTime を最新時刻へ置換 | parser の自然キー・候補順序 |
| 片側失敗で両側スナップショット削除 | N1/N2 独立保持 |
| PNG を文字列で保存 | バイト列完全一致・キャッシュ検証 |
| 一覧マージで継続フレームのタイル全削除 | 保存済み別座標・制御Promise競合 |
| elements の全要素型検証を除去 | 非文字列混在の拒否 |
| constructor の清掃呼出しを除去 | サービス再生成だけによる清掃 |
| 履歴保存エラーを握り潰す | 履歴単独・保存と履歴の複合エラー |
| 保存障害で参照中画像を削除 | write／rename／DB障害後の先行画像保持 |
| stale の GET 抑止を除去 | stale 正常・欠落・改変 |
| 許可ズームを通常整数だけで検証 | 安全計算範囲外の拒否 |
| サービスを修正前実装へ戻す | 3座標要求のGET件数、履歴失敗など差戻し再現 |

## 品質確認・引き継ぎ

- `npm run lint`、`npm run typecheck`、`npm run format:check` を実行し通過。
- API全体試験は通常サンドボックスで既存HTTP待受16件が listen EPERM。ローカル待受を許可して再実行し、`npm run test -w apps/api` は332件すべて通過。
- `npm run build` は全workspaceで通過。
- 同期清掃は専用キャッシュの単一サービス所有という設計前提に従う。大容量時の起動時間、複数プロセス共有、PNG完全デコードは設計通り対象外。
- Agy の元 Walkthrough は変更せず、本記録を追加した。push／PR作成は検収担当へ引き継ぐ。
