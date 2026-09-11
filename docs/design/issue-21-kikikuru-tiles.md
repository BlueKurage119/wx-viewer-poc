# Issue #21「C11. キキクル（大雨・浸水・土砂）のタイル取得」設計

作成日: 2026-09-12  
作成: Codex  
状態: 承認待ち  
予定ブランチ: `feature/issue-21-kikikuru-tiles`

## 1. 目的・前提

気象庁が公開するキキクルの時刻一覧を取得し、その一覧に実在する大雨・浸水・土砂のフレームについて、呼び出し元が指定した XYZ 座標の PNG だけをオンデマンドで取得・保存する。時刻一覧にない時刻・`member`・レイヤーを補完して URL を組み立てない。

対象レイヤーは次の3種に限る。大雨は浸水・洪水の危険度を統合した公式 PNG 表示である。洪水キキクルは PBF・GeoJSON 等の複合描画が未検証のため対象外とする。

| 保存レイヤー | 時刻一覧の element | URL の imageId |
| --- | --- | --- |
| `heavyrain` | `heavyrain` | `rain_mesh` |
| `inund` | `inund` | `inund` |
| `land` | `land` | `land` |

## 2. 参照資料・判断根拠

| 参照 | 本設計での扱い |
| --- | --- |
| Issue #21 | 対象は3種の PNG、`member` は時刻一覧から採用、UI と洪水は対象外 |
| [基本設計](../basic-design.md) §4.2、§4.3 | キキクル3種の採用、他レイヤーと独立した時刻一覧、欠けコマの非補間、取得失敗と危険度なしの区別 |
| [取得方法レポート](../data-acquisition-report.md) §4.1 | 公式 URL、`member` の値、element/imageId の対応、ズーム10で3種 PNG を実取得・デコード済みという確認範囲 |
| [Issue #20 設計](issue-20-nowcast-tiles.md) | 時刻一覧→オンデマンド PNG→DB メタデータ・ファイルキャッシュという構成、および availability と取得履歴の扱い |
| `risk_*` schema と `riskRepository.ts` | B2 で整備済みの `RiskLayer`、スナップショット、フレーム、タイル永続化を再利用 |

表示窓の「最新から過去3時間」は基本設計上の案であり、Issue #21 の受け入れ条件には含まれない。したがって本 Issue は一覧の全フレームを保存し、どの時刻を UI に見せるか・絞り込むかは F3 に委ねる。取得先の全ズーム上限、画像位置合わせ、危険度の色と値の対応は未検証であり、実装で推測して補わない。

## 3. 範囲

### 実装すること

- `targetTimes.json` の取得、構文検証、レイヤー別フレームの正規化・SQLite 保存
- 一覧に記載された `member` と `basetime`、`validtime`、imageId を用いる PNG タイル URL の構築
- 許可済み座標だけのオンデマンド PNG 取得、PNG 検証、ファイルキャッシュと `risk_tile` への保存
- レイヤーごとの 3 状態（`available` / `stale` / `unavailable`）と取得試行履歴
- 注入可能な fetch / clock / キャッシュパスを使用した単体テスト

### 実装しないこと

- 洪水レイヤー、PBF、GeoJSON、危険度値への復号・判定
- HTTP 配信エンドポイント（E8）、地図 UI・レイヤー切替（F3）、時間カード、ズーム・画角の算出
- 定期スケジューリング、再試行・プロセス起動時の初期取得（C12〜C14）
- 未検証のズーム範囲を既定値として一般化すること

## 4. 外部データと正規化

URL は次の固定定数からのみ作る。利用者入力の URL・member・imageId は受け取らない。

```text
https://www.jma.go.jp/bosai/jmatile/data/risk/targetTimes.json
https://www.jma.go.jp/bosai/jmatile/data/risk/{basetime}/{member}/{validtime}/surf/{imageId}/{z}/{x}/{y}.png
```

- 一覧ルートは配列とし、各行の `basetime`・`validtime` は厳密な14桁 UTC 日時、`member` は空でない文字列、`elements` は文字列配列として検証する。UTC 往復で実在日時を検証する。
- 3種の対象 element を持つ行だけを、そのレイヤーの候補とする。対象外 element のみの行は正常な除外である。対象レイヤーを持つ行に必要フィールドが欠けるなど構造が不正なら、一覧全体を失敗として前回正常値を保持する。
- 1行が複数の対象 element を持つ場合、各レイヤーに独立したフレームを生成する。フレームには時刻一覧の `member` をそのまま保存する。
- レイヤー別の自然キーは `(layer, baseTime, validTime, imageId, member)` とし、重複を1件にまとめ、`validTime`、`baseTime`、`member`、`imageId` の昇順で `sequence` を0から採番する。
- 取得成功時には、レイヤーごとに `source` を時刻一覧 URL、`issuedAt` を採用フレームの最大 `baseTime`、`validFrom` / `validTo` を最小 / 最大 `validTime`、`sourceVersion` を一覧本文の SHA-256 として保存する。対象フレームが0件なら期間は null、`issuedAt` は取得時刻とする（気象庁の発表時刻ではない内部規約）。

## 5. サービス構成・契約

既存の `riskRepository` を変更せずに使い、ナウキャストと同様の責務分割とする。

| モジュール | 責務 |
| --- | --- |
| `polling/kikikuruTypes.ts` | 正規化済みフレームキー、座標、カタログ、取得結果の型 |
| `polling/kikikuruSource.ts` | 固定 URL 定数、14桁 UTC 変換、タイル URL 構築 |
| `polling/kikikuruParser.ts` | 時刻一覧 JSON の検証、対象3レイヤーのフレーム化、重複排除・並べ替え |
| `polling/kikikuruService.ts` | 一覧更新、available/stale/unavailable の評価、フレーム存在確認、オンデマンド取得の直列化 |
| `polling/kikikuruTileStore.ts` | PNG 検証済みバイナリの安全な相対パスへの原子的保存とキャッシュ読出し |
| `polling/index.ts` | 上記の公開 export |

`KikikuruService` は `DatabaseConnection`、絶対パスのキャッシュルート、許可ズーム列、正の有限値の `staleAfterMs`（レイヤーごと）、任意の `fetchFn` / `clock` / timeout を受ける。ズーム10だけが実データで確認済みのため、製造時のテストおよび利用側は明示的に `[10]` を渡す。ライブラリ側に推測の既定ズームを設けない。

カタログ読出しは各レイヤーのスナップショットと全フレームを返す。UI 用の3時間窓はここで勝手に適用しない。タイル要求は、保存済みフレームキーと許可済みの非負整数 XYZ 座標だけを受け付ける。いずれかが不正・未存在なら外部 fetch を実行せず `unavailable` と理由を返す。

タイル相対パスはレイヤー・時刻・member・imageId・XYZ からサービス内部で決定し、既存のパス検証を通す。キャッシュ済みかつファイルが存在するときはネットワークへ出ず `cached` を返す。取得成功時は PNG 署名・チャンク構造を検証して原子的に保存し、同じトランザクションで `risk_tile` を更新する。同一フレームへの同時要求はサービス内で集約し、同じ PNG を重複取得しない。

## 6. 失敗・鮮度・履歴

- 一覧取得の成功は、正常な空一覧も含む。成功時は `fetchedAt` と `lastSuccessAt` を更新し `available` とする。
- 一覧取得の HTTP・タイムアウト・JSON・構造エラーでは、前回正常スナップショットがあればフレームと `lastSuccessAt`、`sourceVersion` を保持して `stale` とし、なければ空の `unavailable` を保存する。
- 読出し時にも clock から鮮度を再評価する。最後の正常取得から `staleAfterMs` 以上なら `stale` とする。従ってサービス再生成後も DB の日時から同じ状態となる。
- あるタイルの取得失敗は、そのタイルを「危険度なし」として保存しない。既存タイルがあれば上書きしない。カタログの一覧取得状態とも混同しない。
- `fetch_attempt` には時刻一覧を1回、PNG はタイル単位で記録する。成功・失敗、URL、HTTP status、バイト数、ハッシュ、エラー種別を記録する。

## 7. 受け入れ条件・検証

製造担当は以下を automated test で検証する。新規テストは対象実装を意図的に壊して失敗する red を確認してから完成させる。

1. `heavyrain` / `inund` / `land` を含む synthetic `targetTimes.json` から、それぞれのフレームが保存・読出しできる。`heavyrain` のタイル URL は `rain_mesh`、他2種は同名 imageId になる。
2. `member` が `immed0`、`immed1`、`none` のフレームを混在させ、各 URL が一覧の当該値を使う。固定値への置換があれば失敗する完全一致アサーションにする。
3. 対象 element がない行は当該レイヤーに入らず、重複行は1件に畳まれ、順序と sequence が決定的である。
4. 一覧に存在しないフレーム、別レイヤーへ差し替えたキー、未許可ズーム・不正 XYZ を要求しても外部 fetch が0回である。
5. 3レイヤーの有効フレームに対する PNG をそれぞれ取得・検証・保存でき、同一座標の2回目はキャッシュを返して外部 fetch を増やさない。PNG 以外の本文と HTTP 失敗は保存されない。
6. 初回失敗は `unavailable`、成功後の一覧失敗は旧フレーム・最終成功時刻・版を保持した `stale`、閾値境界の再読出しも `stale` となる。正常な空一覧は `available` である。
7. 対象テスト、`npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api` を成功させる。

## 8. 後続 Issue への引き継ぎ

- E8 はサービスのカタログとタイル取得結果を HTTP レスポンス／配信へ変換する。キャッシュの相対パスを無検証で公開しない。
- F3 はレイヤーごとに独立した一覧を使い、大雨を初期選択にする。表示時刻は危険度判定の基準時刻とし、未来の実況と表現しない。
- C12〜C14 は `refreshTimes()` の呼出し周期・初期取得・再試行を担う。ここで時刻を補間・先読みしない。

## 9. 未確認事項

Issue #21 の範囲に未決事項はない。ズーム10以外の可用性、画面での過去3時間の絞り込み、凡例・色と危険度値の意味、洪水複合レイヤーは、公式実データの追加検証が必要な後続範囲として残す。
