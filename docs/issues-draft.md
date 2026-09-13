# Issue化ドラフト（実装タスク単位）

更新日: 2026-09-13（#139）

[基本設計](basic-design.md) と [棚卸し](audit-epic-a-d.md) の対応表。既存識別番号を維持し、未決は後続Issueの着手前判断として残す。A〜Dの部品完成とE〜Lの製品/受入完了を区別する。冬季C109向けに夏季降雨地図の優先度を下げる既決方針は維持する。

## Epic A: プロジェクト基盤・共通

- **[A1. プロジェクト初期化（React + TypeScript + Vite + Node.js）](https://github.com/BlueKurage119/wx-viewer-poc/issues/1)**
  実装済み（後続のUI/API接続は別）。Node.js 24条件、npm workspaces、Material Webラッパー、lint/format/build基盤。
- **[A2. 共通シェルレイアウトの実装（ヘッダー・左ナビレール・下部通知領域）](https://github.com/BlueKurage119/wx-viewer-poc/issues/2)**
  実装済み（後続のUI/API接続は別）。登録4端末の固定shellとfixture試作。実通知/再通知/気象ビューは後続へ。
- **[A3. 共通メタ情報の型定義（source, issuedAt, validAt/From/To, fetchedAt, lastSuccessAt, availability, sourceVersion）](https://github.com/BlueKurage119/wx-viewer-poc/issues/3)**
  実装済み（後続のUI/API接続は別）。共通メタ情報の TypeScript 型定義の作成 フロントエンド・バックエンド双方から参照できる形にする
- **[A4. availability状態遷移の実装（available/stale/unavailable）](https://github.com/BlueKurage119/wx-viewer-poc/issues/4)**
  実装済み（後続のUI/API接続は別）。available / stale / unavailable の3状態遷移ロジックの実装 単体テストの作成
- **[A5. 警戒レベル・通知区分のセマンティックカラートークン定義](https://github.com/BlueKurage119/wx-viewer-poc/issues/90)**
  実装済み（後続のUI/API接続は別）。ダーク固定の警戒/通知semantic token。レベル5縁必須、light実表示・取得状態色は対象外でG/Hへ。

## Epic B: 保存基盤

- **[B1. SQLite導入とディスク永続化基盤](https://github.com/BlueKurage119/wx-viewer-poc/issues/5)**
  実装済み（後続のUI/API接続は別）。node:sqlite、WAL、migration runnerと起動時検証。
- **[B2. 情報種別ごとのテーブル・スキーマ設計（現況警報／警報等時系列／早期注意／地域時系列／レーダー／キキクル／アメダス／気象防災速報）](https://github.com/BlueKurage119/wx-viewer-poc/issues/6)**
  実装済み（後続のUI/API接続は別）。各情報種別のテーブル／スキーマの設計・実装 共通メタ情報（A3で定義した source, issuedAt, validAt/From/To, fetchedAt, lastSuccessAt, availability, sourceVersion）をテーブルに反映する
- **[B3. 受信履歴テーブルの設計・実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/7)**
  実装済み（後続のUI/API接続は別）。受信履歴テーブルの設計・実装 電文本文（原文）の保存方法の実装（監視画面での原文閲覧用） 電文本文を取得できなかった失敗を「本文なしの取得試行記録」として区別できるようにする（§8.2）
- **[B4. 通知出力履歴テーブルの設計・実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/8)**
  実装済み（後続のUI/API接続は別）。検知通知のtargets・origin/detectionContext・確定outputを保存。端末起動応答監査はD5別表。
- **[B5. 操作記録テーブルの設計・実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/9)**
  実装済み（後続のUI/API接続は別）。操作記録テーブルの設計・実装（実行時刻、対象、結果、操作主体を保持）
- **[B6. 履歴の「明示削除まで保持」ポリシーの実装（自動削除なし）](https://github.com/BlueKurage119/wx-viewer-poc/issues/10)**
  実装済み（後続のUI/API接続は別）。受信履歴・通知出力履歴・操作記録に対して、自動削除・自動ローテーション処理を実装しないことをテストで保証する 期間経過をシミュレートしてもレコードが残ることを確認する検証コードを用意する

## Epic C: 取得・正規化

- **[C1. XML定時・随時フィードのポーリング基盤（PULL型）](https://github.com/BlueKurage119/wx-viewer-poc/issues/11)**
  実装済み（後続のUI/API接続は別）。定時・高頻度（`regular.xml`）、随時・高頻度（`extra.xml`）、定時・長期（`regular_l.xml`）、随時・長期（`extra_l.xml`）の4フィードのポーリング実装 フィード内のリンクをたどって電文URLを取得する（日時・官署コードからURLを自作しない） Atomのタイトル・概要は絞り込み補助として扱い、本文の名前空間・Control・Head・地域要素を検証してから採用する 同一取得の同時実行の集約 タイムアウト10秒、指数バックオフ60秒〜最大5分の初期実装
- **[C2. XML電文の種別判定・パース（VPWW55-61: 警報・注意報）](https://github.com/BlueKurage119/wx-viewer-poc/issues/12)**
  実装済み（後続のUI/API接続は別）。名前空間を考慮したXMLパース（Report/Control、Head、Body、気象要素の名前空間の違いを扱う） `Control/Status`（通常・訓練・試験）の区別 `Body/Warning`のtypeを選び、市町村等の`Item/Area/Code=1310800`（江東区）を読む処理 `Kind`のName、Code、Status、LastKind、Property、Additionの保持
- **[C3. 気象警報・注意報の現況構成ロジック（新規・継続・強化・緩和・解除の判定）](https://github.com/BlueKurage119/wx-viewer-poc/issues/13)**
  実装済み（後続のUI/API接続は別）。最新VPWS50を検証して全要素の基準状態を作る復元処理 以後のVPWW55-61を現象別に反映する更新処理 `Kind/DateTime`にある対象要素の発表時刻と個別電文の発表時刻を比較し、新しい個別警報が遅れて届いた集約で上書きされないようにする 市町村単位の解除（Code=00）と上位集約の解除対象種別コードの保持を区別して処理する 実東京電文でEventID・Serialが空であることを踏まえ、電文種別・対象府県を含めた地域別保存キーを設計する
- **[C4. VPWP50（警報等時系列）の取得・正規化](https://github.com/BlueKurage119/wx-viewer-poc/issues/14)**
  実装済み（後続のUI/API接続は別）。`MeteorologicalInfos type=量的予想時系列（市町村等）`を読み、江東区（`1310800`）ItemのKind/Propertyを抽出する `TimeDefines/TimeDefine@timeId`と各値の`refID`を、同一の`TimeSeriesInfo`内で結合する（異なるブロックの同じIDを混ぜない） 雨・風・雪などの量的予想と危険度を別項目として保持する 陸上／海上、地域内の細分類、単位、期間を保持する
- **[C5. 警報級の可能性（早期注意情報）の取得・正規化](https://github.com/BlueKurage119/wx-viewer-poc/issues/15)**
  実装済み（後続のUI/API接続は別）。VPFD61（6時間区間＋明後日の12時間区間、TimeDefinesから取得）の取得・パース VPFW60（明々後日以降、VPFD61との併用時は電文中に残る明後日部分を使わない）の取得・パース `PossibilityRankOfWarning`の「高」「中」「なし」、および空要素の`condition="値なし"`を区別して保持する 大雨と土砂災害を別項目として扱う
- **[C6. VPFD51（地域時系列予報）の取得・正規化](https://github.com/BlueKurage119/wx-viewer-poc/issues/16)**
  実装済み（後続のUI/API接続は別）。VPFD51 の区間・時点と block/ref を保存。画面の列共有はE4/G7。
- **[C7. VPBS50（気象防災速報：線状降水帯発生・直前予測・記録的短時間大雨）の取得・正規化](https://github.com/BlueKurage119/wx-viewer-poc/issues/17)**
  実装済み（後続のUI/API接続は別）。Head/Title、Headline/Text、対象区域、発表・観測時刻、EventID（親番・枝番）、更新状態（発表／訂正／取消）の抽出 区域判定の実装: 江東区（`1310800`）は直接対象、東京地方（`130010`）・23区東部（`130012`）等は「江東区を含む広域情報」として区域名を明示する `InfoKind`=気象解説情報、バージョン確認 完全なEventID（親番+枝番）を更新単位として保持し、親番のみでの上書きで別の速報を消さないようにする 訂正でReportDateTimeが変わらない場合を考慮し、`Control/DateTime`で更新を判別する
- **[C8. 竜巻関連電文（VPHW50/51）の取得・正規化](https://github.com/BlueKurage119/wx-viewer-poc/issues/18)**
  実装済み（後続のUI/API接続は別）。VPHW50/51の取得・パース処理の実装 電文に明示された有効期限の抽出（基本設計 §5.12 の設計案どおり、5.5の3時間固定ルールは自動適用しない）
- **[C8-1. 外部サンプル依存を解消し fixture を自己完結化する](https://github.com/BlueKurage119/wx-viewer-poc/issues/118)**
  実装済み（後続のUI/API接続は別）。実サンプルのリポジトリ内fixture化、original/derived/syntheticとSHAの来歴を保持。
- **[C9. アメダス最新時刻・地点データの取得・正規化（江戸川臨海）](https://github.com/BlueKurage119/wx-viewer-poc/issues/19)**
  実装済み（後続のUI/API接続は別）。両地点対応の正規化と推計フラグは実装済み。定期配線はeastのみでC17へ。
- **[C10. 雨雲ナウキャストのタイル取得（オンデマンド）](https://github.com/BlueKurage119/wx-viewer-poc/issues/20)**
  実装済み（後続のUI/API接続は別）。`targetTimes_N1.json` / `targetTimes_N2.json` の取得 N1/N2の基準時刻のズレを考慮し、実在フレームのみで時刻一覧を構成する `hrpns` PNGタイルのオンデマンド取得（必要な画角・時刻のみ） 過去60分〜未来60分の表示窓上限の実装 N1またはN2の片方が取得失敗した場合、もう片方を独立して扱う
- **[C11. キキクル（大雨・浸水・土砂）のタイル取得](https://github.com/BlueKurage119/wx-viewer-poc/issues/21)**
  実装済み（後続のUI/API接続は別）。`risk/targetTimes.json` の取得 `member`（immed0／immed1／none等）を時刻一覧の値から取得する（`none`固定にしない） 大雨（`rain_mesh`）・浸水（`inund`）・土砂（`land`）の3レイヤーのPNGタイル取得 各時刻の`elements`で対象レイヤーの存在を確認する
- **[C12. 長期フィードによる初期取得・復旧処理](https://github.com/BlueKurage119/wx-viewer-poc/issues/22)**
  実装済み（後続のUI/API接続は別）。起動時に`regular_l.xml` / `extra_l.xml`から最新集約・予報・時系列を取得し、対象地域を検証する処理 永続化済み状態と長期フィード・集約からの復元処理 「初期取得済み」判定をプロセス単位でリセットする実装（再起動のたびに初期取得として扱う）
- **[C13. 取得失敗時の指数バックオフ・再試行処理](https://github.com/BlueKurage119/wx-viewer-poc/issues/23)**
  実装済み（後続のUI/API接続は別）。タイムアウト10秒、指数バックオフ60秒〜最大5分の実装 取得失敗時に正常な前回値を保持し、空配列で上書きしない処理 不正な構造・未対応コードを、通信失敗（取得試行そのものの失敗）とは別の状態として記録する
- **[C14. 時間帯別取得周期スケジューラ](https://github.com/BlueKurage119/wx-viewer-poc/issues/24)**
  実装済み（後続のUI/API接続は別）。XML/索引120/60/120秒・夜間停止、画像だけオンデマンド。YAMLは再起動で反映。
- **[C14-1. jmaXmlPolling.test.ts の freshnessPolicy 重複プロパティを解消](https://github.com/BlueKurage119/wx-viewer-poc/issues/130)**
  実装済み（後続のUI/API接続は別）。jmaXmlPolling.test.ts のfreshnessPolicy重複2箇所を除去。
- **[C15. 会場・予報点定義の実装（地域・観測・地図の対象を分離）](https://github.com/BlueKurage119/wx-viewer-poc/issues/109)**
  実装済み（後続のUI/API接続は別）。east/trcの型付き会場対象、異なる市町村・観測地点と共通広域予報を定義。
- **[C16. 会場別の採用履歴と複数会場同時処理を実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/114)**
  実装済み（後続のUI/API接続は別）。受信採用を(reception_id,venue_id)へ移行しXML両会場を常時処理。C7採用は和集合、アメダスはC17。
- **[C17. 複数会場アメダス定期取得の接続](https://github.com/BlueKurage119/wx-viewer-poc/issues/144)**
  未着手。アメダス両会場の定期取得を接続し、latest共有・backfillは設計前判断。

## Epic D: 通知判定・棚卸し

- **[D1. 通知用データモデルの実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/25)**
  実装済み（後続のUI/API接続は別）。通知事実をweather/system unionと非空targetsで定義。表示outputとは分離。
- **[D1-1: 通知メッセージ定義の管理](https://github.com/BlueKurage119/wx-viewer-poc/issues/103)**
  実装済み（後続のUI/API接続は別）。sharedの型付きメッセージ定義とresolver、定義ID/版・タイトル/対象/詳細・区分別確認操作。
- **[D2. コード対応表に基づく通知区分判定ロジック（警報/問いかけ/非常ブザー）](https://github.com/BlueKurage119/wx-viewer-poc/issues/26)**
  実装済み（後続のUI/API接続は別）。非常ブザー該当コード（43, 48, 49, 32, 33, 35, 36, 37, 38, 39）の判定実装 問いかけ該当コード（2, 3, 4, 5, 6, 7, 8, 9, 10, 19, 29）の判定実装 警報（通知区分）該当コード（12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25, 26, 27）の判定実装 未定義・予約コード（42, 45〜47等）を対応表に含めず、未対応コードとして扱う実装（低い区分へ自動割当てしない）
- **[D3. 強化・緩和・解除時の通知生成ロジック](https://github.com/BlueKurage119/wx-viewer-poc/issues/27)**
  実装済み（後続のUI/API接続は別）。強化・緩和: 変更後の気象情報に対応する通知区分で通知する実装（緩和を一律「警報」にしない） 解除: 通知区分「警報」で通知する実装 通知区分が変更前後で同じでも、強化・緩和の状態変化があれば通知対象とする実装
- **[D4. 新規/継続/訂正/取消/初期取得の通知生成ルール実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/28)**
  実装済み（後続のUI/API接続は別）。新規発表: §7.4の対応表に従って通知する実装 同一内容の再取得・単なる継続: 新たな通知を生成しない実装 訂正・取消: 通常の発表と同じ受信・処理・通知経路で扱う実装（同じ版の再取得は重複処理しない） 初期取得・復旧: 検知した「すでに発表中」の情報も、新規発見として通常の状態変化ルールどおりに通知を生成する実装（履歴の一括通知防止の特別な抑制は設けない）
- **[D5. 起動時通知出力API（pull方式）の実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/29)**
  実装済み（後続のUI/API接続は別）。POST startup実装済み。警報出力権はサーバー起動世代×会場、session問い合わせと別。202/専用監査あり。通常差分・再試行・storeはE9。
- **[D6. 端末セッション識別子の発行・保持機構](https://github.com/BlueKurage119/wx-viewer-poc/issues/30)**
  実装済み（後続のUI/API接続は別）。ブラウザUUID v4とsessionStorage/メモリ縮退、サーバの初回問い合わせ記録。認証用途ではない。
- **[D7. 装置異常系（取得遅延・異常）の通知判定ロジック](https://github.com/BlueKurage119/wx-viewer-poc/issues/31)**
  実装済み（後続のUI/API接続は別）。6系列を取得元ごとに監視。失敗2/5回・3周期/600秒、地点は経過除外。タイル基準と50分の運用扱いは未決。
- **[D8. 通知パイプラインでの気象内容/装置異常の区別（originフィールド）](https://github.com/BlueKurage119/wx-viewer-poc/issues/32)**
  実装済み（後続のUI/API接続は別）。weather/system と normal/initial の独立を3組合せの実経路で検証。
- **[D9. 基本設計・Issueドラフト・実装の棚卸しと未決事項の整理](https://github.com/BlueKurage119/wx-viewer-poc/issues/139)**
  棚卸し中。本棚卸し。39設計・48PR・原項目台帳、基本設計/全後続タスク改定とPR転載表。
- **[D10. 速報の通常通知と起動時通知の対象範囲の補完](https://github.com/BlueKurage119/wx-viewer-poc/issues/145)**
  未着手。速報通常通知とsystem/竜巻起動採用の対象から設計。E9の現行配信は先行可能。

## Epic E: REST API

- **[E1. 情報種別単位のRESTエンドポイント実装（気象警報・注意報）](https://github.com/BlueKurage119/wx-viewer-poc/issues/33)**
  会場別現況・正常空・補足項目のDTO。江東区固定を会場台帳へ一般化。C3は34コードで洪水04/18未採用。
  依存: A3, A4, B2, C2, C3、C15 #109、C16 #114。着手前判断: 会場受け渡し/情報別stale/未抽出補足の採用範囲。
  管理ID: AD-H004, AD-H014, AD-H016, AD-H017, AD-H044, AD-H046, AD-H070。
- **[E2. 情報種別単位のRESTエンドポイント実装（警報等時系列）](https://github.com/BlueKurage119/wx-viewer-poc/issues/34)**
  会場別警報等時系列・量的予想のDTO。block/ref/区間/単位を保ちDB内部型を公開しない。
  依存: A3, A4, B2, C4、C15 #109、C16 #114。着手前判断: 時刻定義の公開形式・補足値・欠測とstale。
  管理ID: AD-H004, AD-H014, AD-H017, AD-H030, AD-H048, AD-H070。
- **[E3. 情報種別単位のRESTエンドポイント実装（警報級の可能性）](https://github.com/BlueKurage119/wx-viewer-poc/issues/35)**
  near/far独立の早期注意DTO。東京地方の2表と各発表時刻、明後日JST境界を維持。
  依存: A3, A4, B2, C5、C15 #109、C16 #114。着手前判断: 各表availabilityと正常空の表現。
  管理ID: AD-H004, AD-H014, AD-H049, AD-H070。
- **[E4. 情報種別単位のRESTエンドポイント実装（地域時系列予報）](https://github.com/BlueKurage119/wx-viewer-poc/issues/36)**
  地域時系列の区間・時点と表示入力。風速階級/時間参照を保持。天気コード列と風速範囲列は未保存。
  依存: A3, A4, B2, C6、C15 #109、C16 #114。着手前判断: G7/G8の必須入力・追加保存要否・文字代替。
  管理ID: AD-H004, AD-H014, AD-H046, AD-H050, AD-H051, AD-H070。
- **[E5. 情報種別単位のRESTエンドポイント実装（アメダス）](https://github.com/BlueKurage119/wx-viewer-poc/issues/37)**
  会場別アメダス観測DTO。江戸川臨海/羽田、取得地点の成功と最新時刻確認を分離。
  依存: A3, A4, B2, C9、C17 #144（両地点の定期取得）、C15 #109、C16 #114。着手前判断: C17との状態境界・AQC5/6欠測・要素非提供の表現。
  管理ID: AD-H004, AD-H008, AD-H014, AD-H052, AD-H053, AD-H054。
- **[E6. 情報種別単位のRESTエンドポイント実装（気象防災速報）](https://github.com/BlueKurage119/wx-viewer-poc/issues/38)**
  会場別速報DTOと期限。VPBS3種とVPHW、direct/wide・取消null・合成IDを区別。
  依存: A3, A4, B2, C7, C8、C15 #109、C16 #114。着手前判断: VPHW重複/目撃区域・官署等未保存項目・C7採用精度。
  管理ID: AD-H004, AD-H014, AD-H015, AD-H017, AD-H036, AD-H043, AD-H046, AD-H047, AD-H070。
- **[E7. レーダー（ナウキャスト）タイル配信エンドポイント](https://github.com/BlueKurage119/wx-viewer-poc/issues/39)**
  保存索引と画像のREST配信。readCatalogは追加HTTPなし、共用NowcastServiceで画像要求。
  依存: C10、C14 #24（共用サービス・周期/許可）。着手前判断: URL/DTO/PNG配信・N1/N2同時刻候補・更新頻度。
  管理ID: AD-H014, AD-H056, AD-H059, AD-H060, AD-H061, AD-H062。
- **[E8. キキクルタイル配信エンドポイント](https://github.com/BlueKurage119/wx-viewer-poc/issues/40)**
  キキクル保存索引と画像のREST配信。共用KikikuruService、大雨/浸水/土砂を分離。
  依存: C11、C14 #24（共用サービス・周期/許可）。着手前判断: URL/DTO/画像結果・索引availability・停止許可の公開。
  管理ID: AD-H014, AD-H056, AD-H059, AD-H060, AD-H061, AD-H062。
- **[E9. 通知用API（起動時現況取得・通常ポーリング用差分取得）](https://github.com/BlueKurage119/wx-viewer-poc/issues/41)**
  通常差分と起動応答の共通store合流。D5 POSTは既存。cursor/欠落防止/再試行/対象外でも進行を追加。
  依存: D1, D4, D5、D1-1 #103、D6 #30。D10 #145 は追加対象種別だけ依存し、現行種別の配信は先行可能。着手前判断: snapshot-sequence・保持期間・202/通信再試行・表示3要素復元。
  管理ID: AD-H005, AD-H006, AD-H007, AD-H022, AD-H024, AD-H066, AD-H068, AD-H069。
- **[E10. 監視画面向けAPI（稼働状態・履歴取得）](https://github.com/BlueKurage119/wx-viewer-poc/issues/42)**
  保存済み監視状態と履歴のREST配信。6系列健全性/情報availability/4feed readiness/採用を分離。
  依存: B3, B4, B5、C14 #24（実スケジュール）、C16 #114（会場別採用）、D5 #29（起動監査）、D7 #31（6系列健全性）。着手前判断: 監視DTO・安全な診断・検索上限・タイル基準・地点遅延の扱い。
  管理ID: AD-H001, AD-H003, AD-H011, AD-H012, AD-H039, AD-H040, AD-H041, AD-H045, AD-H063, AD-H065。
- **[E11. 取得制御API（開始・停止・強制更新、要求識別子による重複防止）](https://github.com/BlueKurage119/wx-viewer-poc/issues/43)**
  全体取得制御・要求IDと操作履歴。内部start/stopとB5 repoをAPIへ接続、完了時記録と結果再照会。
  依存: B5, C14。着手前判断: manual/force/recovery・夜間・バックオフ・全体操作対象・認証境界。
  管理ID: AD-H013, AD-H064, AD-H068。

## Epic F: 地図

- **[F1. 地図コンポーネント基盤（背景地図・東京ビッグサイト中心点算出）](https://github.com/BlueKurage119/wx-viewer-poc/issues/44)**
  会場別地図の中心補正。east/trcのmapReferenceと台帳から対象を決める。
  依存: A1, A2。着手前判断: 背景地図提供元/条件・実寸zoom・パネル遮蔽補正。
  管理ID: AD-H018。
- **[F2. ナウキャスト（雨雲）レイヤーの表示・時間操作](https://github.com/BlueKurage119/wx-viewer-poc/issues/45)**
  雨雲タイル・利用可能コマ・再生。N1/N2を時刻だけで無条件結合せず欠けを維持。
  依存: F1, E7。着手前判断: 必要XYZ/同valid候補・保存索引再読込頻度・zoom実測。
  管理ID: AD-H057, AD-H058, AD-H062。
- **[F3. キキクル（大雨・浸水・土砂）レイヤーの表示・種別切替](https://github.com/BlueKurage119/wx-viewer-poc/issues/46)**
  キキクル3種表示。別catalog、初回大雨、期限を実況と誤表示しない。
  依存: F1, E8。着手前判断: zoom/位置/凡例の実確認・保存索引更新頻度。
  管理ID: AD-H057, AD-H058, AD-H062。
- **[F4. 時間操作カード（プレーヤー型UI）の実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/47)**
  時間カードと実在コマ操作。再生中一覧固定・表示時刻/予測・追従状態を明示。
  依存: F1。着手前判断: カード実寸・操作状態・窓外コマの表現。
  管理ID: AD-H057。
- **[F5. レイヤー選択ボタン・凡例開閉UIの実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/48)**
  レイヤー・凡例と出典。画像の色/位置を実検証し出典を隠さない。
  依存: F1。着手前判断: 凡例対応・透過度・実データでの視認性。
  管理ID: AD-H058。
- **[F6. ズーム・「会場へ戻る」ボタンの実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/49)**
  会場へ戻るとzoom。台帳の会場へ戻し時刻/レイヤーは変更しない。
  依存: F1。着手前判断: 画面寸法変更時の中心再計算。
  管理ID: AD-H018。
- **[F7. 最新追従モードと手動時刻選択の切替ロジック](https://github.com/BlueKurage119/wx-viewer-poc/issues/50)**
  最新追従と手動保持。窓外コマを別時刻に黙って置換しない。
  依存: F2, F3, F4。着手前判断: 保持frameが消えた時の案内・再生停止後更新。
  管理ID: AD-H057。
- **[F8. タイル取得失敗時の状態表示（欠けコマ・前回値表示）](https://github.com/BlueKurage119/wx-viewer-poc/issues/51)**
  画像欠け・前回値・停止表示。画像結果と索引staleは別、staleだけでGETを禁じない。
  依存: F2, F3。着手前判断: 未取得/失敗/停止/前回画像の時刻表示。
  管理ID: AD-H057, AD-H061。

## Epic G: 情報パネル

- **[G1. 右側情報パネルの共通レイアウト・スクロール制御](https://github.com/BlueKurage119/wx-viewer-poc/issues/52)**
  会場別パネルレイアウト。会場の固定対象を表示し地図移動では変えない。
  依存: A2。着手前判断: 主解像度・拡大率・短い要約固定表示の採否。
  管理ID: AD-H019。
- **[G2. 気象防災速報パネルの実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/53)**
  速報全文・区域・種別別期限。VPBS3hとVPHW電文期限を分離。取消nullと官署未保存に対応。
  依存: G1, E6。着手前判断: 竜巻重複/付近の精度・官署表示の入力・詳細ボタン。
  管理ID: AD-H007, AD-H046, AD-H047。
- **[G3. 警報・注意報パネルの実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/54)**
  会場別警報バッジと補足。C3段階/警戒レベル/通知区分を混同せずsemantic token使用。
  依存: G1, E1。着手前判断: 強調時間・補足DTO・レベル5縁の実視認性・洪水未採用表示。
  管理ID: AD-H020, AD-H044, AD-H046。
- **[G4. 警報等時系列パネルの実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/55)**
  警報等時系列と量的予想。block/ref/時間定義を使い固定コマ数を仮定しない。
  依存: G1, G10, E2。着手前判断: 色/凡例・現在区間の初期位置・詳細対象区分。
  管理ID: AD-H048。
- **[G5. 警報級の可能性パネルの実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/56)**
  早期注意2表と詳細結合。なし/値なし/未取得を区別、両表の発表時刻を明示。
  依存: G1, G10, E3。着手前判断: 高/中の凡例・stale表示・共通現象だけの結合。
  管理ID: AD-H049。
- **[G6. アメダスパネルの実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/57)**
  会場別アメダスと推移。羽田の湿度非提供、5/6欠測、要素別isEstimated、24h未取得は明示。
  依存: G1, G10, E5。着手前判断: 風向公式対応・品質表示・未提供/欠測/通信異常の表示。
  管理ID: AD-H008, AD-H009, AD-H052, AD-H053, AD-H054。
- **[G7. 地域時系列予報パネルの実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/58)**
  地域予報の区間/時点表。風速階級の実数補間なし、E4入力から範囲表示。
  依存: G1, G8, E4。着手前判断: 風速範囲の根拠・矢羽根/色・天気文字代替。
  管理ID: AD-H046, AD-H050, AD-H051。
- **[G8. 天気アイコン対応表の検証・実装（Material Symbols）](https://github.com/BlueKurage119/wx-viewer-poc/issues/59)**
  天気アイコン入力と対応表の検証。現parserは天気文字でコード列なし。入力契約を先に決める。
  依存: A1（Material Web導入）。着手前判断: 対応単位・根拠・網羅性・未対応時の文字代替。
  管理ID: AD-H051。
- **[G9. 各パネル共通：取得状態表示（取得中/取得できません/一部未確認）の実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/60)**
  3状態と部分欠測の表示契約。staleの前回値をDB削除や単純NGに縮退しない。
  依存: G1〜G7, A4。着手前判断: 各情報の非表示/前回値/時刻・状態色の最終UI。
  管理ID: AD-H004, AD-H022, AD-H049, AD-H070。
- **[G10. 詳細ダイアログ共通コンポーネントの実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/61)**
  詳細ダイアログと時間軸。背景操作停止・復帰・行見出し固定を共通化。
  依存: A2。着手前判断: 実寸レイアウト・横スクロール・取得済み範囲表示。
  管理ID: 固有の設計判断のみ。
- **[G11. 左ナビレールの危険度バッジ実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/62)**
  ナビの最高危険度と速報新着。レベル5縁を維持し通知区分の鳴動から分離。
  依存: A2, G3。着手前判断: 小バッジ視認性・速報新着の表示単位。
  管理ID: AD-H020。

## Epic H: 通知UI

- **[H1. ヘッダー点滅ブザーの実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/63)**
  通知区分別ヘッダー表現。semantic tokenを使い非常outlineを面に使わない。
  依存: A2, D1。着手前判断: 実UIの赤ヘッダーと通知同時表示の視認性。
  管理ID: AD-H020。
- **[H2. 下部通知領域の表示・確認操作の実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/64)**
  通知共通storeと表示・確認。weather/systemと最大6件を保持、resolver3要素を使用。
  依存: A2, D1, D8。着手前判断: 表示優先順・問いかけ中切替・件数/既読単位・操作結果との競合。
  管理ID: AD-H005, AD-H006, AD-H019, AD-H020, AD-H021, AD-H022, AD-H023, AD-H024, AD-H066, AD-H068, AD-H069。
- **[H3. 非常ブザーのスヌーズ機能の実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/65)**
  非常ブザーのスヌーズ。端末内操作、受領監視は追加しない。
  依存: H2。着手前判断: 再通知開始/期限/反復・新着/確認/スヌーズ競合。
  管理ID: AD-H021。
- **[H4. フロント側確認状態の一時管理（サーバー永続化なし）](https://github.com/BlueKurage119/wx-viewer-poc/issues/66)**
  端末内確認状態。ackRequiredと確認済みを分離。D6 session維持とは別。
  依存: H2, H3。着手前判断: reload時の表示/確認reset・保存範囲。サーバ永続化はしない。
  管理ID: AD-H021, AD-H025。

## Epic I: 警報一覧

- **[I1. 警報一覧ビューの実装（一覧表示・フィルターのみ）](https://github.com/BlueKurage119/wx-viewer-poc/issues/67)**
  現行/直近通知の一覧。監視履歴とは別。個別承認/差戻/確認ボタンは設けない。
  依存: A2, D1, E9。着手前判断: 保持件数/期間・起動outputと検知notificationの対応。
  管理ID: AD-H005, AD-H021, AD-H023, AD-H025, AD-H066。
- **[I2. 警報一覧のフィルター機能（通知区分・情報種別・期間）](https://github.com/BlueKurage119/wx-viewer-poc/issues/68)**
  通知一覧フィルター。origin/detectionContext/isTrainingを混同しない。
  依存: I1。着手前判断: 列と条件・対象種別・期間の初期値。
  管理ID: AD-H066。

## Epic J: 訓練通知

- **[J1. サンプル電文カタログUI（一覧・選択）](https://github.com/BlueKurage119/wx-viewer-poc/issues/69)**
  来歴付きサンプルカタログ。self-contained fixtureのoriginal/derived/syntheticを区別。
  依存: A2。着手前判断: 採用sample/権限/一覧UI。加工を実電文と扱わない。
  管理ID: AD-H055, AD-H067。
- **[J2. 訓練電文の注入要求処理（通常パイプライン経由）](https://github.com/BlueKurage119/wx-viewer-poc/issues/70)**
  訓練電文の通常経路注入。trainingをnormal/testと区別し、system実監視storeを汚さない。
  依存: J1, C2〜C8, D2〜D4。着手前判断: 訓練ID・複数同時・時刻変換と権限。
  管理ID: AD-H067。
- **[J3. 訓練データの抹消要求処理（取消電文の合成投入）](https://github.com/BlueKurage119/wx-viewer-poc/issues/71)**
  訓練取消投入と抹消範囲。各parserの取消対応を確認し本番データを直接削除しない。
  依存: J2。着手前判断: 論理取消/物理削除の対象・権限・履歴保持・未対応電文。
  管理ID: AD-H010, AD-H043。
- **[J4. 訓練データの isTraining フラグ伝播（電文→通知→履歴→UI表示）](https://github.com/BlueKurage119/wx-viewer-poc/issues/72)**
  訓練フラグとバッジ。バックエンドtraining伝播済み部分を再実装せずAPI/UIへ延長。
  依存: J2, A3, D1, B2〜B5。着手前判断: バッジ具体表現・通常表示との分離。
  管理ID: AD-H067。
- **[J5. 受入条件検証での訓練データ除外ロジック](https://github.com/BlueKurage119/wx-viewer-poc/issues/73)**
  受入から訓練を除外。Lの実行前に除外条件を供給する。Lへの循環依存を外す。
  依存: J3 #71、J4 #72（Lの実行前に完了）。着手前判断: J3で決めた抹消範囲と本番データ不変の検証。
  管理ID: AD-H010, AD-H067。

## Epic K: 監視画面

- **[K1. 監視画面レイアウト実装（全体状態4カード・取得元別テーブル・情報別テーブル・現在の異常）](https://github.com/BlueKurage119/wx-viewer-poc/issues/74)**
  監視4段レイアウト。運転/健全性/情報状態/処理を別々に表示。
  依存: A2, E10。着手前判断: カード実寸・未評価null・状態の文字表現。
  管理ID: AD-H063。
- **[K2. ツールバー（取得開始/停止/強制更新/受信履歴/出力履歴/送信）の実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/75)**
  操作選択→送信と結果。ユーザー指定（Issue #75 comment-5591790017）に従い、受信履歴（HTTP通信ログ）と電文履歴（XMLログ）の入口を分ける。取得操作は引き続き選択→送信、履歴閲覧は送信不要とする。。未送信で実状態を変えず要求IDで結果を再照会。
  依存: K1, E11。着手前判断: 操作結果と通知の優先順・timeout表示。
  管理ID: AD-H023, AD-H064, AD-H121。
- **[K3. 受信履歴ダイアログの実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/76)**
  原文と会場別採用の検索。ユーザー指定（Issue #76 comment-5591759938）に従い、左ペインに一覧、右ペインに電文を表示する。気象庁カナ形式のパース表示は「可能なら」の候補として、変換根拠・実現性・採否を着手前に判断し、未実装を供給済みと扱わない。。一覧raw除外、詳細だけ原文、会場別adoptionsを表示。
  依存: K1, E10, B3。着手前判断: ページング/normal既定・原文安全表示・採用精度。
  管理ID: AD-H011, AD-H015, AD-H045, AD-H065, AD-H122。
- **[K4. 通知出力履歴ダイアログの実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/77)**
  検知履歴と起動応答監査。B4 detectionContextとD5問い合わせ種別は別。実鳴動完了とはしない。
  依存: K1, E10, B4。着手前判断: 履歴の分類・outputId/notificationId・同時複数件。
  管理ID: AD-H012, AD-H023, AD-H024, AD-H025, AD-H065。
- **[K5. 操作記録の表示実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/78)**
  操作履歴表示。操作結果と上流fetch結果を混同せずactor nullを保持。
  依存: K1, E10, B5。着手前判断: 安全なエラー表現・不明結果の再照会。
  管理ID: AD-H064, AD-H065。
- **[K6. 取得元別稼働状況テーブルの実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/79)**
  6系列取得状態と次回予定。索引も定期取得、画像本体に周期なし。amedas時刻/地点別。
  依存: K1, E10。着手前判断: tile健全性/地点検知遅れの運用表示・評価時刻/scan上限。
  管理ID: AD-H001, AD-H003, AD-H041, AD-H062。
- **[K7. 情報別反映状況テーブルの実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/80)**
  情報別反映状態。片方の失敗を隠さずnear/far・各layerを展開。
  依存: K1, E10。着手前判断: 初期化/解析失敗/stale/停止中保存値の区別。
  管理ID: AD-H040, AD-H045, AD-H063, AD-H070。
- **[K8. 「現在の異常」パネルの実装（同一問題の集約表示）](https://github.com/BlueKurage119/wx-viewer-poc/issues/81)**
  現在の問題とUI更新停止。問題の集約は通知生成単位とは別。最後の表示更新時刻を表示。
  依存: K1, E10。着手前判断: ブラウザ疎通と上流異常の区別・処理skipの採用。
  管理ID: AD-H022, AD-H040。
- **[K9. H端末相当モードでの装置異常系通知の表示フィルタリング実装](https://github.com/BlueKurage119/wx-viewer-poc/issues/82)**
  H端末のsystem表示除外。台帳のterminalModeとoriginだけで判定しcursorは進める。
  依存: A2, D8, H2。着手前判断: フィルター配置。生成/保存は端末によらず共通。
  管理ID: AD-H069。

## Epic L: 受入検証

- **[L1. 表示（地図・パネル）の受入条件検証](https://github.com/BlueKurage119/wx-viewer-poc/issues/83)**
  両会場の地図・パネル受入。既存shell smokeを実データUIの受入へ拡充。
  依存: Epic F, Epic G。着手前判断: G9表示承認・実寸/色/zoom/凡例の実測条件。
  管理ID: AD-H004, AD-H018, AD-H019, AD-H020, AD-H027, AD-H047, AD-H048, AD-H049, AD-H050, AD-H058。
- **[L2. 取得・保存の受入条件検証](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)**
  取得・保存・運用限界の受入。実電文と合成を区別し夜間/復旧/会場/キャッシュ/容量を確認。
  依存: Epic B, Epic C。着手前判断: タイル基準/地点50分・低頻度保守項目は到達性と採否を判断。
  管理ID: AD-H001, AD-H003, AD-H008, AD-H009, AD-H011, AD-H012, AD-H013, AD-H015, AD-H016, AD-H017, AD-H027, AD-H028, AD-H029, AD-H030, AD-H031, AD-H032, AD-H033, AD-H034, AD-H035, AD-H036, AD-H037, AD-H041, AD-H042, AD-H043, AD-H044, AD-H045, AD-H052, AD-H053, AD-H054, AD-H055, AD-H058, AD-H059, AD-H060。
- **[L3. 通知判定（バックエンド）の受入条件検証](https://github.com/BlueKurage119/wx-viewer-poc/issues/85)**
  通知判定・起動出力の受入。D4/D5/D7の単位・二軸・同時件数・at-most-onceを実行確認。
  依存: Epic D。着手前判断: 取消実例/等時刻境界・保存失敗保証・D10採用分の追加条件。
  管理ID: AD-H002, AD-H007, AD-H037, AD-H038, AD-H039, AD-H042, AD-H043, AD-H044。
- **[L4. 監視画面の受入条件検証](https://github.com/BlueKurage119/wx-viewer-poc/issues/86)**
  監視・訓練・表示除外受入。健全性とavailability、会場別採用、3種履歴を分離。
  依存: Epic K, Epic J。着手前判断: E11操作契約・J3抹消範囲・ブラウザ更新停止。
  管理ID: AD-H010, AD-H067, AD-H069。
- **[L5. 通知UI（フロント側）の受入条件検証](https://github.com/BlueKurage119/wx-viewer-poc/issues/87)**
  通知UIの受入。実際の音/確認/スヌーズ、同時通知と両モードを検証。
  依存: Epic H, Epic I。着手前判断: Hの表示単位・優先順位・期限の承認済み値。
  管理ID: AD-H019, AD-H020, AD-H025。
- **[L6. 対象外・除外の確認（洪水キキクル・潮位速報・短時間大雪等）](https://github.com/BlueKurage119/wx-viewer-poc/issues/88)**
  対象外の横断確認。洪水キキクルと洪水警報、試験報と訓練を別に確認。
  依存: L1〜L5。着手前判断: 本番移行事項・未取得実例を未確認のまま記録。
  管理ID: AD-H026, AD-H042, AD-H044, AD-H071。

## 未決事項と集計

未決・未対応・確認待ちは [棚卸しPR転載表](audit-epic-a-d.md#5-pr転載用未解消事項の全件) の全件を参照する。タイル基準、アメダス地点検知遅れ、stale表示、訓練抹消、各API/表示契約を実装の既定値で補わない。既決のD7閾値を未確定へ戻さない。

A5 / B6 / C19 / D11 / E11 / F8 / G11 / H4 / I2 / J5 / K9 / L6、合計 **97タスク**（既存95＋C17 #144＋D10 #145）。E〜Lは56件。C8-1/C14-1/D1-1の枝番を含み、削除・付け替えはない。
