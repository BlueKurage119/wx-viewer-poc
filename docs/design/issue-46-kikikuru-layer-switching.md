# Issue #46 (F3) キキクル（大雨・浸水・土砂）レイヤーの表示・種別切替 設計

作成日: 2026-09-15
改訂日: 2026-09-15（統括担当のヒアリング結果を反映。§0 に改訂内容 / 検収差し戻しによる改訂は §17）
対象 Issue: #46 (F3)
依存: #44 (F1 地図基盤)、#47〜#49 (F4/F5/F6 操作面)、#39・#40 (E7/E8 索引・PNG 配信 API)、**#45 (F2 ナウキャスト) — 共通モジュールの提供元。F2 が先行して実装し、F3 はそれを import して流用する（§10）**

## 0. 改訂履歴（2026-09-15 ヒアリング結果の反映）

初版の未決事項に対し、統括担当がユーザーへヒアリングして得た確定事項を反映した。

| # | 論点 | 確定した判断 | 反映先 |
| --- | --- | --- | --- |
| 1 | レイヤー選択 UI | **2 段構成への変更を撤回。** F5 (#48) が実装・検収済みのフラット 4 択（雨雲／大雨／浸水／土砂）を維持する。これに伴い「キキクルへの初回切り替え時に大雨を初期選択」は本 Issue の対象外 | §1.2、§5.1、§5.4、§11.2、§16 |
| 2 | 索引ポーリング間隔 | **60 秒**に統一（30 秒案は撤回）。F2 (#45) も 60 秒で確定 | §6.2、§10、§13 |
| 3 | 共通モジュールの所有 | **F2 (#45) が先に実装し、F3 は import して流用する。** F3 独自実装にしない | §4.1、§10 |
| 4 | 種別切替時の時刻 | **切替前に選択していた時刻を維持する**（一律リセットから変更）。3 種は時間軸が完全一致するため | §5.2、§5.3、§11.4 |
| 5 | 凡例の階級区分・名称 | 公式マニュアル（大雨危険度通知_解説資料.pdf 別表 3）の支給を受け**確定**。警戒レベル相当も含む | §7.4.1 |
| 5b | 凡例の階級色 | 公式配色（HP 配色設定指針・警戒レベル対応ページ）の支給を受け**確定**。実測した `#F2E700` は「注意」と確定（公式値と完全一致）。MD3 データ色トークン `--wx-data-kikikuru-*` を定義 | §7.4.2、§4.1 |
| 6 | 表示窓の長さ | **過去 3 時間に制限**して確定（基本設計 §4.3 の案を採用）。クライアント側でフィルタする | §6.4、§11.4.1 |
| 7 | 最新のみ表示 | **最新コマ1枚のみ表示**へ変更。「基準」「予測を含む判定結果です」表記の削除、時刻引継ぎの廃止 | §1.1、§5.3、§6.4、§8.2、§18 |
| 8 | キキクル専用簡易カード | **最新コマのみ表示に合わせ、操作部（スライダー、前後・再生ボタン）を持たないキキクル専用の簡易カード（`KikikuruStatusCard`）へ差し替える** | §1.1、§4.1、§6.4、§8.3、§11.4、§18 |

## 1. 目的と範囲

`apps/web` の防災気象情報ビューに、キキクル（大雨・浸水・土砂）の危険度分布タイルを実データで重畳し、3 種別を切り替えられるようにする。時刻一覧はキキクル専用の保存索引（`GET /api/weather/kikikuru/times`）から取得し、雨雲ナウキャストとは独立に管理する。

### 1.1 この設計で実装するもの

| 項目 | 内容 |
| --- | --- |
| キキクル索引の取得 | `/api/weather/kikikuru/times` の定期ポーリングと DTO → 表示モデル変換 |
| キキクルタイルの重畳 | `/api/weather/kikikuru/:layer/tiles/:z/:x/:y.png` を Leaflet のラスターレイヤーとして地図へ重ねる |
| 種別選択 | F5 実装済みのフラット 4 択（雨雲ナウキャスト／大雨／浸水／土砂）に、押された種別を即座に反映する配線 |
| 切替時の挙動 | 地図中心・ズームを保持、**常に最新の1コマを表示**（時刻引き継ぎは廃止） |
| 表示窓 | 取得済みフレームのうち**最新の1コマ**のみをクライアント側で表示 |
| 凡例 | 公式の階級区分・名称・配色で実仕様化し、選択中の種別に応じて差し替え。データ色トークン `--wx-data-kikikuru-*` を定義 |
| 時刻表現 | 最新コマの時刻のみ（MM/DD HH:mm）を表示。「基準」「予測」等の表記・注意書きは削除 |
| 操作カード | **キキクル専用の簡易カード（`KikikuruStatusCard`）を作成し、キキクル時は時間操作カード（`TimelineControlCard`）と差し替えて表示する（操作部なし）** |

### 1.2 この設計で実装しないもの

- 洪水キキクル（基本設計 §4.2・§4.3 で対象外確定。PBF 複合描画が未検証）。
- 雨雲ナウキャストの実画像・実カタログ（F2 #45）。本書はキキクルのみを接続する。
- **「キキクルへの初回切り替え時に大雨（統合表示）を初期選択」（基本設計 §4.3【確定】／Issue #46 の受け入れ条件 1）。** §5.1 の経緯により本 Issue の対象外とする。
- **§10 の共通モジュールの新規実装。** F2 (#45) が先行実装したものを import して流用する。
- 最新追従・手動保持・再生タイマー・再生中の一覧固定（F7 #50）。本書は「切替直後に再生を停止し最新時刻を選ぶ」ことだけを行い、再生の進行そのものは実装しない。
- 欠けコマ・取得失敗・前回画像・停止理由の状態表示の作り込み（F8 #51）。本書は F8 が差し込む `status` slot を壊さない範囲で最小限の非表示・注記のみ行う。
- レイヤー濃度（透過度）のユーザー操作 UI。透過度の値そのものは §7.3 で定めるが、ユーザーが変更する UI は作らない。
- ナウキャストのデータ色トークン `--wx-data-nowcast-*`（F2 #45 の範囲）。

## 2. 参照した資料と、統括担当から渡された確定事項

### 2.1 参照資料

- `docs/basic-design.md` §4.1〜§4.3（レイヤー単一選択、キキクル 3 種、中心・ズーム保持、基準時刻の表現、時刻一覧の個別管理、過去 3 時間の表示窓案）。なお「初回大雨」と「切替時の最新時刻リセット」は §5.1・§5.3 の判断により本 Issue では採用しない
- `../docs/260907_weather-data/jmaxml_20260826_Manual(pdf)/大雨危険度通知_解説資料.pdf`（気象庁「『大雨危険度通知』の解説」令和 4 年 2 月 10 日）— 危険度コードと名称の出典（§7.4.1）
- 気象庁「気象庁ホームページにおける気象情報の配色に関する設定指針」 <https://www.jma.go.jp/jma/kishou/info/colorguide/HPColorGuide_202007.pdf>、および「防災気象情報と警戒レベルとの対応について」 <https://www.jma.go.jp/jma/kishou/know/bosai/alertlevel.html> — キキクル階級色の出典（§7.4.2）
- `docs/design/issue-44-47-49-map-foundation-controls.md`（F1/F4/F5/F6 の実装済み構造、`MapLayerId`、`TimelineViewModel`、Z10 拡縮を F2/F3 へ申し送り）
- `docs/design/issue-39-nowcast-kikikuru-rest-apis.md` §3.3（キキクル索引・PNG の API 契約）
- `docs/design/issue-21-kikikuru-tiles.md`、`docs/data-acquisition-report.md` §4.1
- `docs/audit-epic-a-d.md` AD-H057 / AD-H058 / AD-H062
- 実コード: `apps/web/src/map/*`、`packages/shared/src/tileApi.ts`、`packages/shared/src/weatherApi.ts`、`apps/api/src/polling/kikikuruService.ts`、`apps/api/src/polling/kikikuruParser.ts`、`apps/api/src/services/kikikuruApiService.ts`、`config/polling.yaml`

### 2.2 統括担当から渡された確定事項

1. 保存索引のフロント再読込は「一定間隔の自動ポーリング」とする。**間隔は 60 秒で確定**（F2 #45 と統一）（→ §6.2）。
2. ズーム・タイル座標・凡例位置を実測して結論を記録する（→ §3、§7）。
3. キキクルの「期限」を実況と誤表示しない。危険度判定の基準時刻としての表現方法を明記する（→ §8）。
4. レイヤー選択 UI は F5 実装済みのフラット 4 択を維持し、「初回大雨」要件は対象外とする（→ §5.1）。
5. 共通モジュールは F2 (#45) 先行実装・F3 流用とする（→ §10）。
6. 種別切替時は選択時刻を維持する（→ §5.3）。
7. 表示窓は過去 3 時間で確定する（→ §6.4）。
8. 階級区分・名称の公式資料として `../docs/260907_weather-data/jmaxml_20260826_Manual(pdf)/大雨危険度通知_解説資料.pdf`（→ §7.4.1）、階級色の公式資料として気象庁 HP 配色設定指針・警戒レベル対応ページ（→ §7.4.2）の支給を受けた。

## 3. 実測（2026-09-15 実施）

すべて本書作成時に実データへアクセスして得た値である。推測値は含まない。

### 3.1 時刻一覧 `targetTimes.json`

`https://www.jma.go.jp/bosai/jmatile/data/risk/targetTimes.json` を取得（2026-09-15 11:4x JST）。

| 観測事項 | 実測値 |
| --- | --- |
| 件数 | 37 件 |
| 時間範囲 | `20260914204000` 〜 `20260915024000`（UTC 14 桁）＝ 6 時間、10 分間隔 |
| `basetime` と `validtime` の関係 | **37 件すべてで `basetime === validtime`** |
| `validtime` の重複 | なし（37 件すべて異なる） |
| 未来時刻 | なし（最新 `validtime` は取得時刻の直近過去の 10 分丸め） |
| `member` の値 | `immed0`(1 件)、`immed1`(1 件)、`immed2`(1 件)、`none`(34 件) |
| `member` の並び | 最新から順に `immed0` → `immed1` → `immed2` → 以降すべて `none` |
| `elements` | `land` / `inund` / `flood_mesh` / `rain_mesh` / `flood` / `designated_river` / `inland_flood` / `designated_river_nation` / `flood_riskline`（37 件すべて同一） |

**導かれる結論（本書の設計前提）**

- **キキクルに「未来時刻のコマ」は存在しない。** `validtime` は常に `basetime` と等しく、危険度判定の基準時刻そのものである。予測の要素は画像の中身（判定ロジック）に含まれており、時間軸には現れない。基本設計 §4.3 の「未来時刻の選択は設けない」はこの実データと一致する。
- **`member` は時刻の「新しさの順位」を表し、同じ `basetime` に対して時間とともに変化する。** ある時刻が `immed0` → `immed1` → `immed2` → `none` と遷移する。したがって、フロントが古い索引で得た `member` を保持したままタイルを要求すると、保存索引の自然キーと一致せず `404 frame_not_available` になりうる（§6.3 で対処）。
- **同一 `validTime` に複数候補は生じない。** `apps/api/src/polling/kikikuruService.ts` L180-250 は、取得成功のたびに `layerFrames.map(...)` でスナップショットの `frames` を最新 `targetTimes.json` の内容へ**全面置換**する（旧フレームを積み増さない）。上流が 1 時刻 1 `member` しか返さないため、保存索引にも重複は生じない。これは AD-H057 の「同 valid 候補選択」がキキクルでは発生しないことを意味する（ナウキャストの N1/N2 とは事情が異なる）。

### 3.2 タイル座標

会場座標（`packages/shared/src/venueForecastTargets.ts`）から標準 XYZ（Web Mercator / EPSG:3857、`tileSize=256`）で算出した。

| 会場 | 緯度経度 | z=10 タイル | タイル内画素 |
| --- | --- | --- | --- |
| `east` 東京ビッグサイト | 35.63159368010876, 139.79281040119963 | **10/909/403** | (162, 103) |
| `trc` 東京流通センター | 35.58138, 139.748119 | **10/909/403** | (129, 148) |

`docs/data-acquisition-report.md` L393 の実検証済み URL の座標（`10/909/403`）と完全に一致する。両会場は z=10 では同一タイルに収まる。z=11 では `east` が 11/1819/806、`trc` が 11/1819/807 と別タイルになる。

**結論**: 気象タイルの重畳は、背景の地理院タイルと同じ標準 XYZ / EPSG:3857 であり、Leaflet の `L.tileLayer` に座標変換を追加する必要はない。

### 3.3 ズーム（AD-H058 の核心）

同一時刻（`20260915024000` / `member=immed0`）で、**着色データが存在するタイル**を全国走査して 1 件見つけ（`rain_mesh` `10/892/408`）、その親子ズームを実取得した。

| 要求 | HTTP | バイト数 | 中身 |
| --- | --- | --- | --- |
| `rain_mesh/8/223/102` | 200 | 744 B | **着色あり** |
| `rain_mesh/9/446/204` | 200 | 334 B | 空（全透明） |
| `rain_mesh/10/892/408` | 200 | 380 B | **着色あり** |
| `rain_mesh/11/1784..1785/816..817`（z10 の全 4 子タイル） | 200 | 334 B | 空（全透明） |
| `rain_mesh/12/3568..3571/1632..1635`（z10 の全 16 子タイル） | 200 | 334 B | 空（全透明） |
| `rain_mesh` / `inund` / `land` の `z=9,10,11,12` @会場 (909/403 系) | 200 | 334 B | 空（全透明・12 件すべてバイト同一） |

**結論 1（決定的）**: **HTTP 200 が返ることは「そのズームに対応している」ことを意味しない。** 未対応ズームでも、上流は同一バイト列の 256×256 全透明 PNG を 200 で返す。`docs/data-acquisition-report.md` の「ズーム 10 以外は未検証」は、本実測により「z9・z11・z12 は、z10 に着色がある地点でも空タイルしか返さない＝ネイティブ生成されていない」まで踏み込める。z8 には着色があり、取得方法レポートの「偶数ズーム利用」の記述と整合する。

**結論 2**: したがって **API の `TILE_API_ALLOWED_ZOOMS = [10]` を維持し、フロントは常に z=10 のタイルだけを要求して表示ズームへ拡縮する。** Leaflet の現在ズームをそのまま `z` に渡してはならない（F1 設計 L206 の申し送りどおり）。実装は `L.tileLayer` に `minNativeZoom: 10, maxNativeZoom: 10` を指定する。

**結論 3（空タイルの意味）**: 全透明タイルは「危険度の着色がない」ことしか示さず、「安全」「危険度なし」と断定できない（未対応ズーム・未生成でも同じ絵が返る）。画面に「危険度なし」「安全」と読める文言を出さない。

### 3.4 PNG の完全デコードと色（AD-H058）

`rain_mesh/10/892/408`（380 B）を完全展開して検証した。

- PNG 署名・チャンク構成: `IHDR`(13) → `IDAT`(277) → `IEND`。256×256、bitDepth 8、colorType 6 (RGBA)、非インターレース。
- zlib 展開後の生バイト長 262400 = 256 行 ×(1 フィルタバイト + 256px × 4ch)。**全行のフィルタ解除まで通り、完全デコードに成功した。**
- 実際に現れた色は 2 種のみ。

| RGBA | 画素数 | 意味 |
| --- | --- | --- |
| `(255, 255, 255, 0)` | 65,261 | 完全透明（着色なし） |
| **`(242, 231, 0, 255)`** = `#F2E700` | 275 | **着色（不透明）** |

- 会場タイル `10/909/403` の 3 レイヤーはいずれも全画素 `alpha=0`（本日、会場周辺に着色なし）。

**結論**: キキクルのタイルは**着色部が α=255 の完全不透明**である。背景の地理院淡色地図は着色部で完全に隠れる。地名・行政界を読ませたい要件（基本設計 §4.3）と両立させるため、**重畳レイヤーには CSS ではなく Leaflet の `opacity` を設定する**（§7.3）。

実測できた階級色は `#F2E700` の 1 色のみである。本日は全国的に危険度の高い領域が発生しておらず（全国 z10 タイルを粗く走査して着色タイルは 1 枚のみ）、**上位階級（警戒・危険・災害切迫）の色は実データから実測できなかった＝画素値としては実挙動未確認**。ただし階級色一式は公式資料から確定済みであり（§7.4.2）、この実測値 `#F2E700` は公式配色の「注意」rgb(242,231,0) と完全一致した。透明画素の `(255,255,255,0)` も公式配色の「今後の情報に留意」rgb(255,255,255) と一致する。

### 3.5 バックエンドの取得周期（AD-H062 の入力）

`config/polling.yaml` の実値。

| 時間帯 (JST) | `imageCatalogSeconds` | `kikikuruEnabled` |
| --- | --- | --- |
| 04:00–05:00 | 120 | true |
| 05:00–18:00 | **60** | true |
| 18:00–20:00 | 120 | true |
| 20:00–04:00 | `null`（停止） | **false** |

`freshness.imageCatalog.staleAfterSeconds: 300`、`fetchHealth.evaluationIntervalSeconds: 30`。

## 4. モジュール構成

### 4.1 追加・変更するファイル

| ファイル | 種別 | 内容 |
| --- | --- | --- |
ファイル名・配置は **F2 (#45) の設計書 `docs/design/issue-45-nowcast-layer.md` §8.2 が定める共通モジュールの構成に従う**。

| ファイル | 種別 | 内容 |
| --- | --- | --- |
| `apps/web/src/api/tileCatalogClient.ts` | **F2 #45 が作成。F3 は import のみ** | 索引 API クライアント基盤（`fetch` / 中断 / HTTP→失敗種別） |
| `apps/web/src/map/tiles/useTileCatalogPolling.ts` | **F2 #45 が作成。F3 は import のみ** | 60 秒ポーリング hook（レイヤー非依存） |
| `apps/web/src/map/tiles/WeatherTileOverlay.tsx` | **F2 #45 が作成。F3 は import のみ** | Leaflet 重ね描画（ダブルバッファ） |
| `apps/web/src/map/tiles/tileZoom.ts` | **F2 #45 が作成。F3 は import のみ** | `resolveTileZoomPolicy(allowedZooms)` — native zoom と表示ズーム下限 |
| `apps/web/src/map/tiles/tileCatalogTypes.ts` | **F2 #45 が作成** | 共通の状態型 |
| `apps/web/src/map/MapViewport.tsx` | **F2 #45 が変更。F3 は変更しない** | `MapViewportHandle` に Leaflet インスタンスの読み取り専用取得口を追加 |
| `apps/web/src/api/kikikuruTimes.ts` | 新規（F3） | キキクル索引の薄いラッパー。`tileCatalogClient.ts` に `path='/api/weather/kikikuru/times'` とキキクル DTO の `parse` を渡す |
| `apps/web/src/map/kikikuru/kikikuruCatalog.ts` | 新規（F3） | 純関数: `KikikuruTimesResponse` → 表示用カタログ。最新1コマ抽出（§6.4）、`member` 再解決（§6.3）、`MapLayerId` ↔ `KikikuruApiLayer` 変換 |
| `apps/web/src/map/kikikuru/kikikuruTileUrl.ts` | 新規（F3） | `WeatherTileOverlay` へ渡す `urlTemplate` の組立（`imageId` / `member` を含む、§7.1） |
| `apps/web/src/map/kikikuru/useKikikuruLayerState.ts` | 新規（F3） | 常に最新時刻を返す処理（選択状態の維持が不要に、§5） |
| `apps/web/src/map/kikikuru/KikikuruStatusCard.tsx` | 新規（F3） | **キキクル専用の簡易カード。最新時刻とレイヤー名のみを表示し、スライダー・各種操作ボタンを持たない。MD3 トークンで既存スタイルを踏襲する** |
| `apps/web/src/theme/officialJmaColors.css` | 新規（F3） | 気象庁公式配色のプリミティブ `--wx-jma-hue-*` 5 値。**HEX リテラルを書いてよい唯一のモジュール**。出典・取得日をコメントで保持（§7.4.3） |
| `apps/web/src/theme/kikikuruDataColors.css` | 新規（F3） | キキクルのデータ色トークン `--wx-data-kikikuru-*`。値はプリミティブの `var()` 参照（§7.4.3） |
| `apps/web/src/theme/dataColors.ts` | **削除**（F3） | §7.4.3 により不要。CSS へ移行 |
| `apps/web/src/theme/applyTheme.ts` | 変更（F3） | `applyDataColors` の import と呼び出しを除去。他の行に触れない |
| `apps/web/src/theme/index.ts` | 変更（F3） | `dataColors` の re-export 行を除去 |
| `apps/web/src/index.css` | 変更（F3） | 新設 CSS 2 本の `@import` を追加 |
| `apps/web/src/theme/weatherDataColors.css` | 変更（F3、**1 行のみ**） | `--wx-data-nowcast-7` をプリミティブ参照へ。F2 所有ファイルのため他 7 行に触れない（§7.4.3） |
| `apps/web/src/map/fixtures.ts` | 変更（F3） | キキクル 3 種の `LAYER_PRESENTATIONS` の `legendTitle` を §7.4.1 の確定値へ、`swatchToken` を `var(--wx-data-kikikuru-*)` へ。fixture 扱いを解除 |
| `apps/web/src/map/WeatherMapView.tsx` | 変更（F2 も変更。競合注意） | キキクル選択時にオーバーレイと `KikikuruStatusCard` の切り替えを配線（§8.3） |
| `apps/web/src/App.tsx` | 変更（F2 も変更。競合注意） | `WeatherMapView` へ `selectedLayerId` / `onLayerSelect` / `timelineViewModel` / `onTimelineIntent` を供給するコンテナを接続 |
| `apps/web/tests/*` | 新規（F3） | §11 の検証に対応する単体テスト |

`apps/web/src/map/LayerSelector.tsx` は**変更しない**（§5.4）。`apps/web/src/map/types.ts` の既存型、`packages/shared` の DTO、**`apps/web/src/map/TimelineControlCard.tsx`** も変更しない。ナウキャスト向けのモジュール（`nowcast/` 配下等）にも影響を与えない。

F2 (#45) が先にマージされていることが本 Issue の製造着手条件である。上記の共通モジュール 5 本と `MapViewport.tsx` を F3 側で新規作成・改変してはならない。F2 の実装が本書の前提（§10）と食い違っていた場合は、自己判断で F3 側に別実装を起こさず統括担当へ差し戻す。

### 4.2 追加する型

```ts
// apps/web/src/map/kikikuru/kikikuruCatalog.ts
import type { KikikuruApiLayer, KikikuruApiFrame } from '@wx-viewer-poc/shared';
import type { MapLayerId } from './types';

export type KikikuruMapLayerId = 'kikikuru-heavyrain' | 'kikikuru-inund' | 'kikikuru-land';

export function isKikikuruLayer(id: MapLayerId): id is KikikuruMapLayerId;
export function toApiLayer(id: KikikuruMapLayerId): KikikuruApiLayer;
export function toMapLayerId(layer: KikikuruApiLayer): KikikuruMapLayerId;

/** 表示に使う 1 コマ。member は索引更新のたびに再解決する（§6.3） */
export type KikikuruFrameRef = Readonly<{
  /** frameId は validTime のみから作る。member を含めない */
  id: string;
  layer: KikikuruApiLayer;
  baseTime: string;
  validTime: string;
  imageId: 'rain_mesh' | 'inund' | 'land';
  member: string;
}>;

export function buildKikikuruTileUrlTemplate(
  frame: KikikuruFrameRef,
  terminalId: string,
): string;

/** 表示窓（最新1コマ）を適用したうえで TimelineFrame へ変換する（§6.4） */
export function toTimelineFrames(
  frames: readonly KikikuruApiFrame[],
  now: Date,
): readonly KikikuruFrameRef[];
```

```ts
// apps/web/src/map/useKikikuruLayerState.ts
export type KikikuruLayerState = Readonly<{
  /** 常に最新コマを選択。null は「利用可能な時刻なし」。選択状態の維持は不要（§5.3） */
  selectedFrameId: string | null;
  playing: boolean;
}>;
```

ポーリングの型と定数（`TILE_CATALOG_POLL_INTERVAL_MS = 60_000`、`TILE_CATALOG_BACKOFF_MS`、共通の状態型）は **F2 (#45) が `apps/web/src/map/tiles/` に定義する**。F3 は import して使うだけで再定義しない。F3 が前提とする値は §6.2 に記す。

## 5. 種別選択とレイヤー切替の状態機械

### 5.1 「初回大雨」要件を対象外とする判断（2026-09-15 確定）

基本設計 §4.3 は「キキクルへの初回切り替え時は大雨（統合表示）を初期選択とし、以降は選択した種別を画面内で保持する」を【確定】としている。Issue #46 もこれを受け入れ条件の 1 つ「キキクルへの初回切り替え時に大雨（統合表示）が選択される」として挙げている。

しかしこの確定事項は、**レイヤーとキキクル種別を分けた 2 段グルーピング UI**（1 段目で「キキクル」を選び、2 段目で種別を選ぶ）を前提としている。F5 (#48) が実装・検収済みの `apps/web/src/map/LayerSelector.tsx` は **雨雲／大雨／浸水／土砂のフラット 4 択**であり、「キキクルへ切り替える」という独立した操作自体が存在しない。ユーザーは常に種別を直接指定するため、「初回は大雨を初期選択」という状態が発生しえない。

**判断（2026-09-15、統括担当のユーザーヒアリングで確認済み）**: 「基本設計の大雨優先は前提が崩れたので無視してよい」とのユーザー判断を得た。統括判断により、**基本設計 §4.3 の当該確定事項と、Issue #46 の当該受け入れ条件を本 Issue の対象外とする。** 2 段構成への UI 変更は行わず、検収済みのフラット 4 択を維持する。

したがって本 Issue の種別選択は次の単純な実装でよい。

- 大雨・浸水・土砂の各ボタンは**特別な初期強制ロジックを持たない**。押された種別がそのまま即座に表示される。
- 「最後に選んだキキクル種別を覚えておき、キキクルへ戻ったときに復元する」状態（初版設計の `selectedKikikuruLayerId`）は**不要**。`selectedLayerId`（`MapLayerId`）1 つで足りる。
- 初期選択は F5 実装済みのとおり `'nowcast'`（雨雲ナウキャスト）のままとする。

基本設計書 `docs/basic-design.md` §4.3 の当該記述そのものの更新は本 Issue のスコープ外であり、別途フォローアップを要する（§16）。

### 5.2 切替時の副作用

`selectedLayerId` が変化したとき（ナウキャスト↔キキクル、キキクル種別間のいずれも）、次を**この順**で実行する。

1. 地図中心・ズームに**触らない**。`map.setView` / `flyTo` / `fitBounds` / `panTo` を呼ばない。`MapViewport` の `placementRef`（`'initial' | 'manual' | 'returning'`）も変更しない。
2. `playing` を `false` にする。
3. **`selectedFrameId` は常に切替先の最新コマを指す**（§5.3）。
4. 旧レイヤーの Leaflet タイルレイヤーを `map.removeLayer` し、新レイヤーを `addLayer` する（§7.5）。

中心・ズーム保持は、現状の `MapViewport` がレイヤー選択に一切反応しない実装のため「何もしないこと」で成立する。**この不作為を回帰テストで固定する**（§11.3）。

### 5.3 時刻引き継ぎの廃止（2026-09-22 オーナー指示）

オーナー指示「キキクルは最新のコマ1枚だけを表示する」により、過去コマの選択や、種別切替時の時刻引き継ぎは**廃止**する。

実装規約:

- 切替時には、常に**切替先の利用可能コマのうち最新の1コマ（`validTime` が最大のもの）**を表示する。
- ユーザーが任意の時刻を選択して保持する状態（`selectedFrameId` の状態管理）そのものが不要になるため、常に最新コマの ID または `null` を返す。
- `playing` はいずれの切替でも `false` にする。

### 5.4 選択 UI（変更しない）

`apps/web/src/map/LayerSelector.tsx` は **F5 (#48) 実装・検収済みのフラット 4 択（雨雲ナウキャスト／大雨／浸水／土砂）を維持し、本 Issue では変更しない。** 2 段構成への変更案は §5.1 の判断により撤回した。

本 Issue が行うのは、既存の `selectedLayerId` / `onLayerSelect` props を `App.tsx` 側のコンテナから controlled で供給し、選択された `MapLayerId` を実レイヤーへ反映する配線だけである。洪水・雷・竜巻・複数同時選択が出ないこと、「表示レイヤー選択」の冗長ラベルが出ないことは F5 で既に満たされている。

## 6. 保存索引のポーリング（AD-H062 の結論）

### 6.1 呼び出す API

`GET /api/weather/kikikuru/times?terminalId=<台帳ID>&controlStatus=normal`

- この API は保存索引の読み出しのみで上流 HTTP を起こさない（`readCatalog` は追加 HTTP なし）。AD-H062 が禁じた「画面が `refreshTimes` を毎回呼ぶ」契約違反にはあたらない。
- 応答は 3 レイヤーを `layers: Record<'heavyrain'|'inund'|'land', KikikuruApiDataset>` で**必ず同時に**返す。**種別切替のたびに再取得してはならない。** 1 回の応答で 3 種すべてを賄う。
- `controlStatus` はビュー側で保持している値をそのまま渡す。フロントで `normal` に固定しない。

### 6.2 間隔【確定・2026-09-15】

**基準間隔 60 秒**とする。初版の 30 秒案は統括担当の判断により撤回した。定数 `TILE_CATALOG_POLL_INTERVAL_MS = 60_000` は **F2 (#45) が `apps/web/src/map/tiles/useTileCatalogPolling.ts` に定義する**（F2 設計書 §5.2・§8.2）。F3 は import して使うだけで、別の値を定義しない。

根拠:

1. 上流キキクルは 10 分更新（§3.1 実測）。バックエンドの索引取得は日中 60 秒（§3.5）。画面までの検知遅れは「バックエンド周期＋フロント周期」で決まり、60 秒なら最悪 120 秒＝10 分周期の 20% に収まる。危険度分布は 10 分粒度の情報であり、この遅れは運用上許容できる。
2. フロント周期をバックエンド最短周期（60 秒）より粗くしない。同値であれば、バックエンドの更新を恒常的に取りこぼす状態にはならない。
3. `freshness.imageCatalog.staleAfterSeconds: 300` を大きく下回るため、`availability` の `available`→`stale` 遷移を画面が確実に検知できる。
4. コストは `/times` の JSON 1 本（3 レイヤー分のフレーム配列、実データで 37 件×3）である。上流 HTTP は発生しない。端末 1 台あたり 60 リクエスト/時、台帳 4 端末で 240 リクエスト/時。
5. F2 (#45) も 60 秒で確定しており、両レイヤーが同一の共通フックを同一間隔で使う。

**後退（バックオフ）は F2 の共通フックの規約に従う。** F2 設計書 §5.2 は「取得失敗（ネットワーク・5xx）時は 60 → 120 → 240 → 300 秒の指数バックオフ（上限 300 秒）とし、成功で 60 秒へ戻す。直前に成功したカタログは破棄せず保持する」と定めている。F3 はこの挙動をそのまま使い、キキクル側で別のバックオフを実装しない。

20:00–04:00 は `kikikuruEnabled: false` のため索引が更新されないが、`/times` 自体は 200 で成功応答を返す（`catalogAccess.allowed === false`、`reason: 'scheduled_stopped'`）。これは**取得失敗ではない**のでバックオフの対象にせず、60 秒間隔のまま同じ内容を読み続ける。夜間の応答を「異常」として扱わない。停止中である旨は `catalogAccess` から `status` slot へ示す。

**種別切替での即時再取得はしない。** F2 設計書 §8.3 の引き継ぎ表は「`useTileCatalogPolling` の `resetKey` に選択中のキキクル種別を含め、種別切替で即時取得させる」としているが、キキクル API は 1 応答で 3 レイヤーすべてを返す（§6.1）ため、種別切替で再取得しても新しい情報は得られず API 呼び出しが増えるだけである。**`resetKey` にキキクル種別を含めない**（含めてよいのは `terminalId` と `controlStatus`）。この点は F2 設計書の記述と食い違うため、§12-3 に挙げる。

**実装上の必須事項**

以下はいずれも F2 の共通フックが備える挙動であり、**F3 は再実装しない**。F3 の役割は、F2 のフックにキキクル用の `path` と `parse` を渡すことだけである。検収では、キキクル側でもこれらが成立していることを確認する。

- `setInterval` の重複起動を避け、前回のリクエストが未完了なら次回をスキップする。
- 可視状態（`document.visibilityState === 'visible'`）でのみ動かす（F2 設計書 §5.2 の規約）。F3 で独自に常時実行へ変えない。
- アンマウント時に `clearInterval` と `AbortController.abort()` を行う。
- 取得失敗時は**直前の値を保持**する。フレーム一覧を空にしない。フレーム一覧を空にすると「危険度の情報がない」と「通信に失敗した」が区別できなくなる。
- 初回マウント時に即座に 1 回取得し、その後に間隔を開始する。

### 6.3 索引更新時のフレーム再解決（`member` ドリフト対策）

§3.1 で実測したとおり、同一 `validTime` の `member` は時間とともに `immed0`→`immed1`→`immed2`→`none` と変化する。したがって:

- **`TimelineFrame.id` は `validTime` だけから生成する。** `member` や `baseTime` を id に含めない。
- タイル URL を組み立てる直前に、**その時点の最新索引**から `(layer, validTime)` で `member` / `imageId` / `baseTime` を引き直す。
- 索引更新後は、新しい一覧の最新コマを常に選択する。過去コマの維持や、再生中の一覧固定（バッファ退避）は不要となるため実装しない。

### 6.4 表示窓（最新1コマ）【2026-09-22 オーナー指示】

オーナー指示により、「過去3時間の表示窓」案は撤回し、**最新の1コマのみを表示する**仕様へ変更する。また、これに伴いキキクルでは操作部を持たない**簡易カード（`KikikuruStatusCard`）**を使用する。

**フィルタはクライアント側で行う。** API・バックエンドは変更せず、全フレームを返す契約を維持する。

実装規約:

```ts
// apps/web/src/map/kikikuru/kikikuruCatalog.ts
// 索引が持つ最新の validTime のコマ1件のみを抽出する
const latestTime = Math.max(...frames.map((f) => Date.parse(f.validTime)));
const visible = frames.filter((f) => Date.parse(f.validTime) === latestTime);
```

- `frames` には 1 コマ（または 0 コマ）しか含まれない。時間操作カード（`TimelineControlCard`）は用いず、新設する**キキクル専用簡易カード（`KikikuruStatusCard`）**へ差し替えるため、スライダー・前へ/次へ/最新へ/再生ボタンは**DOM に存在しなくなる**（非表示となる）。
- 索引そのものが空（`data.frames === []`）の場合、簡易カード上で「利用可能な時刻はありません」と表示する（既存の空表示の考え方に合わせる）。
- ズーム10未満の場合は、簡易カードに「この縮尺では危険度分布を表示していません」という案内文言を表示する。

## 7. タイルの重畳

### 7.1 URL とレイヤー生成

```ts
const url =
  `/api/weather/kikikuru/${apiLayer}/tiles/{z}/{x}/{y}.png` +
  `?terminalId=${encodeURIComponent(terminalId)}` +
  `&controlStatus=${controlStatus}` +
  `&baseTime=${encodeURIComponent(frame.baseTime)}` +
  `&validTime=${encodeURIComponent(frame.validTime)}` +
  `&imageId=${frame.imageId}` +
  `&member=${encodeURIComponent(frame.member)}`;

この `url` を **F2 の `WeatherTileOverlay` に `urlTemplate` として渡す**（F2 設計書 §8.3）。`L.tileLayer` の生成・オプション設定・ダブルバッファ差替え・破棄は `WeatherTileOverlay` の責務であり、F3 では `L.tileLayer` を直接呼ばない。

`baseTime` / `validTime` は `packages/shared/src/tileApi.ts` の検証に合わせ、`YYYY-MM-DDTHH:mm:ss.sssZ` の正規 UTC 表記をそのまま URL エンコードして渡す。クエリはちょうど 6 キーで、増減させてはならない。z/x/y は Leaflet が埋める。

ネイティブズームは**定数 10 を直書きせず、API 応答の `allowedZooms` から F2 の `resolveTileZoomPolicy(allowedZooms)` で決める**（F2 設計書 §6.1・§8.2）。キキクル API の `allowedZooms` は normal で `[10]`、`training`/`test` で `[]` である。`[]` のときは `resolveTileZoomPolicy` が `null` を返し、レイヤーを地図へ載せない（§9）。

### 7.2 表示可能ズームの下限

ネイティブズームを 10 に固定したまま表示ズームを下げると、Leaflet は可視範囲全体分の z10 タイルを要求する。表示ズームを下げるほど必要タイル数が爆発するため、下限を設ける。

主領域を約 1848×880 CSS px（フル HD からヘッダー・ナビレール・通知領域を除いた概算）として、1 フレームあたりの要求タイル数は次のとおり。

| 表示ズーム | z10 タイル 1 枚の CSS px | 概算タイル数 |
| --- | --- | --- |
| 13 | 2048 | 約 4 枚 |
| 11（初期ズーム） | 512 | 約 15 枚 |
| 10 | 256 | 約 45 枚 |
| 9 | 128 | 約 162 枚 |
| 8 | 64 | 約 600 枚 |

**結論**: 気象タイルの重畳は**表示ズーム 10 以上**でのみ行う。10 未満では重畳レイヤーを地図から外し、凡例と時間カードの `status` slot に「この縮尺では危険度分布を表示していません」と明示する。**「危険度なし」「安全」とは書かない。** 背景地図自体のズーム範囲（5〜18）と F6 の ± ボタンの挙動は変えない。判定は F2 の `resolveTileZoomPolicy` が返す表示ズーム下限に従い、F3 で独自のしきい値を持たない。

初期ズーム 11 では z10 タイルを 2 倍に拡大して表示する。z10 の解像度は北緯 35.6° で約 124 m/px、表示ズーム 11 では約 62 CSS m/px 相当となる。大雨・浸水キキクルの 1 km メッシュは z10 で約 8 px、表示上は約 16 CSS px の階段になるが、判読可能である。

### 7.3 透過度

§3.4 の実測により、着色部は α=255 の完全不透明である。そのままでは背景の地名・行政界が読めなくなり、基本設計 §4.3 の「地名と行政界が読める淡色地図」と衝突する。

**結論【設計案】**: `WeatherTileOverlay` の `opacity` props に `0.75` を渡す（F2 設計書 §8.2 の `WeatherTileOverlayProps.opacity`）。CSS の `opacity` や `filter` を要素側に当てない（Leaflet がダブルバッファ差替え時に `opacity` を操作するため、CSS 側で上書きすると差替えが壊れる）。値は実データに着色が出ている状況で調整する必要があり、本日の実データでは会場周辺に着色がないため**視認性の最終確認は実挙動未確認**である。F2 のナウキャスト側 `NOWCAST_LAYER_OPACITY` とは別の定数として持ち、値を共有しない（雨雲は半透明前提の配色、キキクルは不透明の階級色であり、適正値が一致する保証がない）。ユーザー操作による濃度変更 UI は本書の範囲外（F5 が F2/F3 へ申し送った項目のうち、操作 UI は引き続き未実装とする）。

### 7.4 凡例

- 凡例の**枠・開閉・位置は F5 実装済み**であり変更しない。位置は地図領域の**左上**、閉じた後は同位置に「凡例を表示」アイコンボタンが残る（`apps/web/src/map/MapLegend.tsx`）。本書はこの位置を変えない。
- 本書は、選択中のレイヤーに応じて凡例の見出し・項目を差し替える配線を行う（基本設計 §4.2「凡例、単位、表示対象時刻、操作可能な時刻一覧は、選択した情報に合わせて切り替える」）。

#### 7.4.1 階級区分・名称【確定】

統括担当より公式資料の支給を受けた。

- 出典: `../docs/260907_weather-data/jmaxml_20260826_Manual(pdf)/大雨危険度通知_解説資料.pdf`（気象庁「『大雨危険度通知』の解説」令和 4 年 2 月 10 日、InfoKindVersion 1.3_0）
- 参照日: 2026-09-15
- 参照箇所: 別表 3「危険度分布の危険度」コード表（令和 4 年 6 月 \*\* 日 \*\* 時 \*\* 分以降）

**【土砂災害、洪水の場合】**（＝土砂キキクル `land`）

| コード | 危険度分布の危険度 | 内容 |
| --- | --- | --- |
| 00 | 今後の情報等に留意 | 今後の情報等に留意 |
| 22 | 注意 | 警戒レベル 2（避難行動の確認）相当 |
| 32 | 警戒 | 警戒レベル 3（高齢者等は避難）相当 |
| 42 | 危険 | 警戒レベル 4（避難）相当 |
| 52 | 災害切迫 | 警戒レベル 5（災害切迫）相当 |

**【浸水害の場合】**（＝浸水キキクル `inund`）

| コード | 危険度分布の危険度 | 内容 |
| --- | --- | --- |
| 00 | 今後の情報等に留意 | 今後の情報等に留意 |
| 24 | 注意 | 注意 |
| 34 | 警戒 | 警戒 |
| 44 | 危険 | 危険 |
| 52 | 災害切迫 | 警戒レベル 5（災害切迫）相当 |

**重要**: 浸水害では 24 / 34 / 44 に**警戒レベル相当の記載がない**（52 のみ「警戒レベル 5 相当」）。凡例で浸水キキクルの注意・警戒・危険に「警戒レベル 2/3/4 相当」と付記してはならない。土砂キキクルにのみ付記する。

**大雨キキクル（`heavyrain` / `rain_mesh`）**: 本資料に大雨キキクルのタイル階級表は含まれていない。取得方法レポート §4.1 のとおり浸水と洪水の危険度を統合した表示であり、階級の名称は「注意／警戒／危険／災害切迫」の 4 段階を用いる。統合時の算出規則は未検証のため、凡例に警戒レベル相当を付記しない。

凡例のラベルはこの 4 段階＋「着色なし（今後の情報等に留意）」の 5 行構成とする。旧表記の「非常に危険」「極めて危険」は令和 4 年 6 月以降の表では「危険」「災害切迫」に置き換わっており、**旧表記を使わない**。階級名の表記は別表 3 に合わせ、最下位は「**今後の情報等に留意**」（「等」を入れる）で統一する。配色資料側の「今後の情報に留意」は同義だが、階級名の正本は別表 3 とする。

##### 凡例見出し（`legendTitle`）の確定値【2026-09-15 改訂】

検収で、`apps/web/src/map/fixtures.ts` の大雨キキクルの `legendTitle` が `'大雨警報（浸水害）の危険度分布'` となっており、**浸水キキクルの名称を大雨キキクルに付けてしまっている**ことが判明した。本節でこれを含む 3 種の見出しを確定する。

| `MapLayerId` | 確定する `legendTitle` | 根拠 |
| --- | --- | --- |
| `kikikuru-heavyrain` | **`浸水害・洪水の危険度分布（統合）`** | 基本設計 §4.3【確定】「大雨キキクルは公式仕様上、浸水・洪水の危険度を統合した PNG」。取得方法レポート §4.1 の「浸水と洪水の危険度を統合」 |
| `kikikuru-inund` | **`大雨警報（浸水害）の危険度分布`** | 大雨危険度通知_解説資料.pdf 別表 1「浸水害危険度」の判定に用いる情報 |
| `kikikuru-land` | **`大雨警報（土砂災害）の危険度分布`** | 同 別表 1「土砂災害危険度」の判定に用いる情報（＝土砂災害警戒判定メッシュ情報） |

**実装側で修正すべき文言**（`apps/web/src/map/fixtures.ts` の `LAYER_PRESENTATIONS`）:

| キー | 現在の値 | 修正後の値 |
| --- | --- | --- |
| `kikikuru-heavyrain.legendTitle` | `'大雨警報（浸水害）の危険度分布'` | `'浸水害・洪水の危険度分布（統合）'` |
| `kikikuru-inund.legendTitle` | `'浸水害危険度分布'` | `'大雨警報（浸水害）の危険度分布'` |
| `kikikuru-land.legendTitle` | `'土砂災害警戒判定メッシュ'` | `'大雨警報（土砂災害）の危険度分布'` |

規約:

- `legendTitle` に「キキクル」「大雨キキクル」等の製品名を**含めない**。レイヤー選択ボタンと `label`（`キキクル（大雨）` 等）が同じ画面に出ており、重複は 06-ui-md3-protocol 必須制約 2（見ればわかるラベルは省略）に反する。`legendTitle` が担うのは「どの警報のどの危険度分布か」だけである。
- 大雨キキクルの見出しに**単独の警報名（「大雨警報（浸水害）」等）を使わない**。統合表示であることが読めなくなり、実態と食い違う。
- 土砂キキクルに「土砂災害警戒判定メッシュ（情報）」を単独で使わない。別表 1 が「大雨警報（土砂災害）の危険度分布（土砂災害警戒判定メッシュ情報）」と併記しており、前段の正式名称を見出しに使う。
- `sourceLabel` は 3 種とも `'気象庁'` のままとする（変更不要）。

#### 7.4.2 階級色【確定・2026-09-15】

##### 出典

統括担当より、ユーザー経由で公式配色の支給を受けた（06-ui-md3-protocol §例外 4 の「ユーザーより支給を受ける」に該当）。

- 気象庁「気象庁ホームページにおける気象情報の配色に関する設定指針」 <https://www.jma.go.jp/jma/kishou/info/colorguide/HPColorGuide_202007.pdf>
- 気象庁「防災気象情報と警戒レベルとの対応について」 <https://www.jma.go.jp/jma/kishou/know/bosai/alertlevel.html>
- 支給日: 2026-09-15

初版で「大雨危険度通知_解説資料.pdf に色の記載がない」としたのは事実であり（同 PDF は XML 電文の構成解説で、別表 2・別表 3 が与えるのは危険度コードと名称のみ）、**配色はこの別出典から得た**。両者は役割が異なり矛盾しない。

##### 確定した配色

| 危険度（名称） | RGB | HEX |
| --- | --- | --- |
| 災害切迫 | rgb(12, 0, 12) | `#0C000C` |
| 危険 | rgb(170, 0, 170) | `#AA00AA` |
| 警戒 | rgb(255, 40, 0) | `#FF2800` |
| 注意 | rgb(242, 231, 0) | `#F2E700` |
| 今後の情報に留意 | rgb(255, 255, 255) | `#FFFFFF` |

##### 実測値との照合【一致】

初版で実測した唯一の着色値と、公式配色の「注意」が**完全一致**した。

| 項目 | 実測（2026-09-15） | 公式配色 | 判定 |
| --- | --- | --- | --- |
| 着色画素の RGB | 242, 231, 0（α=255） | rgb(242, 231, 0)＝「注意」 | **完全一致** |
| 透明画素の RGB | 255, 255, 255（α=0） | rgb(255, 255, 255)＝「今後の情報に留意」 | **完全一致**（α のみ 0） |

実測元: `https://www.jma.go.jp/bosai/jmatile/data/risk/20260915024000/immed0/20260915024000/surf/rain_mesh/10/892/408.png`（着色 275 px / 65536 px）。

**したがって、実測した `#F2E700` は「注意」であると確定する。** 初版で「最下位の着色階級である蓋然性が高いが断定しない」とした保留を解除する。統括指示にあった「レベル 3 相当」という割当は誤りであり、正しくは**土砂災害・洪水では警戒レベル 2（避難行動の確認）相当、浸水害では警戒レベル相当の記載なし**である（§7.4.1 の別表 3）。

透明画素が `(0,0,0,0)` ではなく `(255,255,255,0)` だった事実も、タイルが「今後の情報に留意＝白」を α=0 で描いていることと整合する。ただし §3.3 の結論は変わらない。**未対応ズームでも同じ全透明タイルが返るため、透明を「今後の情報に留意」と断定表示してはならない。** 凡例には「今後の情報に留意」を掲げてよいが、地図上の無着色領域に「今後の情報に留意」「危険度なし」「安全」と読める文言を重ねない。

##### 危険度コードとの対応

§7.4.1 の別表 3（危険度分布の危険度、令和 4 年 6 月以降）と本配色は、**危険度の名称が完全に同一の文字列**であるため名称で 1 対 1 に対応する。両資料がこの対応表を明示しているわけではなく、名称一致に基づく対応である点を明記する。

| 配色（名称） | 土砂災害・洪水のコード | 浸水害のコード | HEX |
| --- | --- | --- | --- |
| 災害切迫 | 52 | 52 | `#0C000C` |
| 危険 | 42 | 44 | `#AA00AA` |
| 警戒 | 32 | 34 | `#FF2800` |
| 注意 | 22 | 24 | `#F2E700` |
| 今後の情報に留意 | 00 | 00 | `#FFFFFF` |

**浸水害の対応（統括担当の確認依頼への回答）**: 24＝注意、34＝警戒、44＝危険、52＝災害切迫、00＝今後の情報に留意という対応で問題ない。別表 3【浸水害の場合】の「対応する危険度分布の危険度」欄が、配色表と同じ名称をそのまま用いているためである。ただし §7.4.1 の注意点は維持する。**浸水害の 24 / 34 / 44 には警戒レベル相当の記載がないため、凡例で「警戒レベル 2/3/4 相当」と付記してはならない**（52 のみ「警戒レベル 5（災害切迫）相当」）。色は共通でも、付記するテキストはレイヤーごとに異なる。

大雨キキクル（`heavyrain` / `rain_mesh`）は浸水と洪水を統合した表示であり、統合時の算出規則は未検証である（§7.4.1）。配色は同じ 5 段階を用いるが、**警戒レベル相当を付記しない**。実測した `#F2E700` が `rain_mesh` タイル由来であることは、大雨キキクルがこの配色を用いている裏付けになる。

##### MD3 データ色トークン【確定】

06-ui-md3-protocol §例外 1〜3 に従い、データ色トークンとして定義する。値は支給された公式値を**そのまま**入れる（同 §例外 4「この色は、別に指示をしない限り、そのままデータ色トークン値とすること」）。

| トークン | 値 | 危険度 |
| --- | --- | --- |
| `--wx-data-kikikuru-imminent` | `#0C000C` | 災害切迫 |
| `--wx-data-kikikuru-danger` | `#AA00AA` | 危険 |
| `--wx-data-kikikuru-warning` | `#FF2800` | 警戒 |
| `--wx-data-kikikuru-caution` | `#F2E700` | 注意 |
| `--wx-data-kikikuru-none` | `#FFFFFF` | 今後の情報に留意 |

実装規約:

- 定義場所は `apps/web/src/theme/kikikuruDataColors.css`（新規）とし、値は `apps/web/src/theme/officialJmaColors.css`（新規）のプリミティブを `var()` で参照する。**HEX リテラルを書いてよいのは `officialJmaColors.css` だけ**とし、`apps/web/src/theme/semanticColors.ts` がシード 4 色にリテラルを限定しているのと同じ扱いにする。CSS・TSX・fixture への直書きは引き続き禁止（06-ui-md3-protocol §例外 3）。構成と根拠は §7.4.3 を参照。
- 凡例・タイル補助 UI は `var(--wx-data-kikikuru-*)` で参照する（同 §例外 2）。`fixtures.ts` の `LAYER_PRESENTATIONS` のキキクル 3 種の `swatchToken` を、この `var(...)` へ差し替える。fixture 扱いを解除し、実仕様の凡例とする。
- **`--wx-alert-level-*`（`semanticColors.ts`）を流用してはならない。** あちらは MD3 トーナルパレットから生成した近似色であり、タイルの実配色と一致しない。凡例と地図が食い違う事故（06-ui-md3-protocol §例外の趣旨そのもの）になる。
- トークン名は危険度の名称に対応させ、警戒レベル番号を使わない。浸水害では警戒レベル相当が定義されないため、番号でキーを作ると誤った対応を固定してしまう。
- `--wx-data-kikikuru-none`（白）の swatch は、ダークテーマの凡例カード上で背景と紛れないよう `--md-sys-color-outline` の細線で囲む。色そのものは変えない。
- ナウキャストのデータ色トークン（`--wx-data-nowcast-*`）の**値**は F2 (#45) の範囲であり、本 Issue では定義しない。ただし両者が同一のリテラルを二重に持つ問題への対処は §7.4.3 で定める。

透過度（§7.3）は、公式配色が確定したことで実データでの視認性検証がしやすくなったが、**会場周辺に着色が出ている実データでの確認は依然として未実施**である。`opacity: 0.75` は引き続き【設計案】のままとする。

#### 7.4.3 公式配色リテラルの単一情報源化【2026-09-15 改訂】

##### 検出された重複

検収により、`#FF2800` が 2 か所に別々にハードコードされていることが判明した。

| ファイル | 所有 | 該当箇所 | 意味 |
| --- | --- | --- | --- |
| `apps/web/src/theme/weatherDataColors.css` | F2 (#45) | `--wx-data-nowcast-7: #ff2800;` | 雨雲ナウキャストの 7 階級目（降水強度） |
| `apps/web/src/theme/dataColors.ts` | F3 (#46) | `KIKIKURU_DATA_COLORS.warning = '#FF2800'` | キキクルの「警戒」 |

大文字・小文字も揃っていない。値が一致しているのは気象庁公式配色どうしの一致であって、**意味は無関係**である（一方は降水強度、他方は危険度階級）。

##### 採用する構造: 2 層（プリミティブ／セマンティック）

意味の異なる 2 つの尺度を 1 つのトークンに統合すると、将来どちらか一方の配色が改定されたときにもう一方が黙って巻き込まれる。これは重複より悪い失敗モードである。したがって**リテラルだけを共有し、意味は分離したまま**にする 2 層構成を採る。

```
apps/web/src/theme/officialJmaColors.css   ★新設（プリミティブ層・リテラルの唯一の所在）
  :root {
    --wx-jma-hue-dark-purple: #0c000c;
    --wx-jma-hue-purple:      #aa00aa;
    --wx-jma-hue-red:         #ff2800;
    --wx-jma-hue-yellow:      #f2e700;
    --wx-jma-hue-white:       #ffffff;
  }

apps/web/src/theme/kikikuruDataColors.css  ★新設（セマンティック層・F3）
  :root {
    --wx-data-kikikuru-imminent: var(--wx-jma-hue-dark-purple);
    --wx-data-kikikuru-danger:   var(--wx-jma-hue-purple);
    --wx-data-kikikuru-warning:  var(--wx-jma-hue-red);
    --wx-data-kikikuru-caution:  var(--wx-jma-hue-yellow);
    --wx-data-kikikuru-none:     var(--wx-jma-hue-white);
  }

apps/web/src/theme/weatherDataColors.css   既存（セマンティック層・F2）
  --wx-data-nowcast-7: var(--wx-jma-hue-red);   ← この 1 行だけ変更
  （他の 7 値は据え置き。§7.4.3「据え置く理由」を参照）
```

- プリミティブ名は**色相の記述であり意味を持たない**。`--wx-jma-alert-warning` のような意味づけ名にすると、`--wx-data-nowcast-7`（猛烈な雨）がそれを参照した時点で「猛烈な雨＝警戒」という誤った対応を固定してしまう。
- セマンティックトークン（`--wx-data-*`）の名前・粒度・個数は現状から変えない。参照先が `var()` になるだけで、利用側（`fixtures.ts` の `swatchToken` 等）は一切変更不要である。
- 出典（§7.4.2 の 2 URL）と取得日は `officialJmaColors.css` の冒頭コメントに記す。06-ui-md3-protocol §例外 4 の「取得先・取得日時とともに保存」をこのファイルが担う。

##### なぜ CSS で行うか（TypeScript にしない理由）

`weatherDataColors.css` は `apps/web/src/index.css` から `@import` される純 CSS であり、**CSS ファイルは TypeScript の定数を参照できない**。逆に CSS 側の値を JS が実行時に上書きする形にすると、JS 実行前の描画で色が未定義になる読み込み順の問題が生じる。リテラルを 1 か所にする解は「両方を CSS に寄せる」しかない。

これに伴い、F3 の `apps/web/src/theme/dataColors.ts` と実行時適用は**不要になる**。

| 対象 | 変更 |
| --- | --- |
| `apps/web/src/theme/dataColors.ts` | **削除**。`KIKIKURU_DATA_COLORS` / `KIKIKURU_COLOR_TOKENS` / `applyDataColors` はいずれも不要 |
| `apps/web/src/theme/applyTheme.ts` | `applyDataColors` の import と呼び出し（L8 / L124 付近）を削除 |
| `apps/web/src/theme/index.ts` | `dataColors` の re-export 行を削除 |
| `apps/web/src/index.css` | `@import './theme/officialJmaColors.css';` と `@import './theme/kikikuruDataColors.css';` を追加。`officialJmaColors.css` を**先に**書く |
| `apps/web/tests/kikikuruLegendAndColors.test.ts` | TS 定数への assertion を CSS ファイル内容の assertion へ置き換え。HEX 許可ファイル一覧を更新（§11.5.1） |

CSS カスタムプロパティは宣言順に依存しないため `@import` の順序は動作上は任意だが、読み手のために依存の向き（プリミティブ→セマンティック）どおりに並べる。

MD3 テーマ（`--md-sys-color-*`）が要素単位で適用されるのに対し、データ色は文書全体で一意の絶対値であり、`:root` の静的 CSS に置くほうが正しい。現行実装は `applyMd3Theme` 経由でヘッダー要素にもキキクル色を書き込んでおり、この点も解消される。

##### `weatherDataColors.css` の他 7 値を据え置く理由

`--wx-data-nowcast-1〜6, 8` は本書では**プリミティブへ移さない**。これらの出典（どの公式資料のどの表か、取得日）は F2 (#45) が保持しており、F3 は確認していない。出典を確認せずに「気象庁公式配色のプリミティブ」として持ち上げると、07-wx-data-protocol「実データ・公式資料と照合できたものだけを確定として扱う」に反する。プリミティブへ載せるのは、本書 §7.4.2 で出典と取得日を記録した 5 値だけとする。残りの扱いは F2 側の判断に委ねる。

##### 責務分担（F2 設計担当との重複回避）

F2 (#45) の設計担当が並行して別の修正を進めているため、**変更対象ファイル単位で所有を分ける**。

| ファイル | 変更する担当 | 内容 |
| --- | --- | --- |
| `apps/web/src/theme/officialJmaColors.css` | **F3 (#46) が新設** | プリミティブ 5 値。出典・取得日のコメント |
| `apps/web/src/theme/kikikuruDataColors.css` | **F3 (#46) が新設** | キキクル 5 トークン |
| `apps/web/src/theme/dataColors.ts` | **F3 (#46) が削除** | F3 が作ったファイル |
| `apps/web/src/theme/applyTheme.ts` | **F3 (#46)** | F3 が追加した 2 行の除去のみ。他の行に触れない |
| `apps/web/src/theme/index.ts` | **F3 (#46)** | F3 が追加した 1 行の除去のみ |
| `apps/web/src/index.css` | **F3 (#46)** | `@import` 2 行の追加のみ。既存行を並べ替えない |
| `apps/web/src/theme/weatherDataColors.css` | **F3 (#46)** | `--wx-data-nowcast-7` の 1 行のみ `var(--wx-jma-hue-red)` へ変更。他 7 行に触れない |
| `apps/web/src/map/fixtures.ts` | **F3 (#46)** | §7.4.1 の `legendTitle` 3 件の修正 |

**F3 が共有モジュールを新設し、F2 所有ファイルは 1 行だけ書き換える**方針を採る。根拠は次の 3 点。

1. 重複を持ち込んだのは後発の F3 である（`weatherDataColors.css` はコミット `1ec973b`、`dataColors.ts` は `9aaeef8`）。後から同じ値を別形式で足した側が解消する。
2. 「HEX リテラルを書いてよいモジュールを 1 つに限る」という規約は F3 の設計（§7.4.2）が持ち込んだものであり、その規約の適用範囲を広げる作業は F3 に属する。
3. F2 所有ファイルへの変更を 1 行に抑えられ、F2 設計担当の並行作業との衝突面積が最小になる。逆向き（F2 が新設）にすると、F3 の `dataColors.ts` 削除・`applyTheme.ts` 改変まで F2 が担うことになり、衝突面積が大きい。

**F3 製造担当への指示**: `weatherDataColors.css` は 1 行だけを変更する。同ファイルの他の値・順序・書式に手を入れない。着手前に同ファイルの最新状態を確認し、F2 側が先に改変していた場合は上書きせず統括担当へ報告する。

### 7.5 タイル取得失敗・未取得

レイヤーの差替え機構（ダブルバッファ）は F2 の `WeatherTileOverlay` が所有する。F3 が前提とする挙動は次のとおりで、F3 側で再実装しない。

- `errorTileUrl` は空であり、失敗タイルを代替画像で埋めない。透明のまま残す。
- 新レイヤーを `opacity: 0` で `addLayer` し、その `load` を待ってから `opacity` を入れ替え旧レイヤーを `removeLayer` する。**表示中の画像と表示日時が常に同じコマを指す**（F2 設計書 §9.3）。前のコマの画像を新しい時刻の画像として見せない。
- 上流由来の 502 / 503 / 404 は Leaflet からは `tileerror` として観測される。`WeatherTileOverlay` が `onTileError` / `onSwapSettled` で外へ渡す。F3 は件数を受け取って `status` slot へ「一部のタイルを取得できていません」とだけ出す。失敗理由の分類・前回画像の時刻表示は F8 (#51) の責務であり、先取りしない。
- レスポンスヘッダー（`X-Wx-Catalog-Availability` / `X-Wx-Tile-Result` / `X-Wx-Tile-Stored-At`）は Leaflet の `<img>` 経由では読めない（F2 設計書 §9）。F3 もこれらを画面ロジックで読まない。検収では DevTools の Network タブで付与を確認するに留める（§11.5）。

種別切替（`selectedLayerId` の変化）時は、`urlTemplate` が変わるだけで同じ差替え機構が働く。§5.3 のとおり表示時刻は変えないため、切替前後で表示日時は同一のまま画像だけが入れ替わる。

## 8. 時刻の表現（渡された確定事項 3 の結論）

### 8.1 表示する時刻の定義

| API のフィールド | 何の時刻か | 画面での扱い |
| --- | --- | --- |
| `KikikuruApiFrame.validTime` | **危険度判定の基準時刻**（§3.1 実測により `baseTime` と常に等しい） | 時間カードの「選択日時」として表示する唯一の時刻 |
| `KikikuruApiFrame.baseTime` | 同上 | 画面に別項目として出さない。タイル URL の組立にのみ使う |
| `metadata.issuedAt` | 保存サービスの内部規約で「最大 `baseTime`」（正常空・初回失敗時は代用取得時刻） | **「気象庁の発表時刻」と表示しない。** 画面には出さない |
| `metadata.validFrom` / `validTo` | 索引が保持するフレームの最小／最大 `validTime` | **「有効期限」「〜まで有効」と表示しない。** 時間軸の範囲としてのみ内部利用 |
| `metadata.fetchedAt` / `lastSuccessAt` | 索引の取得試行／取得成功時刻 | 取得状態の注記としてのみ使う。危険度の時刻と並べて出さない |
| `evaluatedAt` | 応答の評価時刻 | 危険度の時刻として使わない |

### 8.2 表示ルール（必須）

1. キキクルの全フレームの `TimelineFrame.kind` は **`'reference'` 固定**とする。`types.ts` の `TimelineFrameKind` に `'reference'` があり用途を定義済みである（簡易カードではバッジ表示は行われないが、内部データとして維持する）。
2. 選択日時のラベルは「**MM/DD HH:mm**」（JST 表記）とする。オーナー指示により「基準」の表記は削除する。「実況」「現在」「予測」「予報」「有効期限」「〜まで」の語を使わない。
3. オーナー指示により、**「この危険度は予測を含む判定結果です」の注意書きは不要（削除）**とする。
4. `validTo` を根拠に「期限切れ」「失効」と表示しない。キキクルの時間軸に有効期限は存在しない。
5. 時間軸に未来のコマを作らない。万一返っても未来コマとして特別扱いせず、他と同じ `'reference'` として扱う。
6. `aria-valuetext` 等スクリーンリーダーへ「実況」「予報」と読ませない。
7. 土砂キキクルを「2 時間先の予測」等の固定の先行時間で説明しない。

### 8.3 簡易カード（`KikikuruStatusCard`）と配置・レイアウト

キキクル選択時は、共用の時間操作カード（`TimelineControlCard`）を使わず、**キキクル専用の簡易カード（`KikikuruStatusCard`）**へ差し替える。

- **表示内容**: レイヤー名と最新時刻のみ。操作部（スライダー・各種ボタン）は持たない。
- **スタイル**: 最小限のテキストで、色は HEX 直書きを避け MD3 トークン（`--md-sys-color-*`）を使用し、既存カードのスタイルを流用する。
- **配置規約**: 既存の `WeatherMapView.tsx` 内の `<div className="timeline-card-wrapper">` と `bottomCardRef` を使い続ける形で実装する。
  ```tsx
  <div className="timeline-card-wrapper">
    {isKikikuru ? (
      <KikikuruStatusCard ref={bottomCardRef} viewModel={effectiveTimelineViewModel} statusSlot={effectiveStatusSlot} />
    ) : (
      <TimelineControlCard ref={bottomCardRef} viewModel={effectiveTimelineViewModel} onIntent={handleIntent} statusSlot={effectiveStatusSlot} />
    )}
  </div>
  ```
- **地図中心の補正 (F1) への影響**: F1 の `MapViewport.tsx` は、下部カードの高さ（`bottomCardRef.current.offsetHeight`）を ResizeObserver で監視している。初期レイアウト確定後（`layoutSettledRef.current === true`）は、高さが変化して ResizeObserver が発火しても、`placementRef.current === 'returning'` でない限り `alignVenueCenter` は呼ばれず、`invalidateSize({ pan: false })` のみが実行される実装となっている。したがって、ナウキャスト↔キキクルの切替でカードの高さが変わっても、**Leaflet 地図の地理的中心（lat/lng）は動かず維持される**。会場マーカーは画面上で高さの差分だけ垂直方向に相対的に移動して見えるが、地図自体が勝手にパンしたりズームが変わったりすることはなく、意図せぬジャンプや会場が隠れる問題は発生しない。
- **viewModelの整理**: `KikikuruStatusCard` では `TimelineViewModel` のうちレイヤー名とフレーム配列程度しか使用しないが、`WeatherMapView.tsx` 内の `effectiveTimelineViewModel` 等の構造を大きく壊さないよう、互換性のある渡し方とするか、キキクル分岐を削除して直接値を渡すかは実装時に整える。


## 9. 共通メタ情報・availability・会場・訓練/本番

追加受け入れ条件「共通メタ情報の null・3 状態・時刻の意味・会場・本番/訓練の区別を該当範囲で維持する」への対応。

- **availability の 3 状態を縮退させない。** 表示は `layers[layer].metadata.availability` をレイヤーごとに独立して扱う。`available` / `stale` / `unavailable` を boolean や OK/NG へ丸めない。`stale` のときは**フレーム一覧と表示中の画像を保持したまま**、鮮度低下を `status` slot に示す。`stale` を理由にタイル GET を止めない（AD-H061 の結論どおり、索引の鮮度と画像取得可否は別軸）。
- **`data === null` と `data.frames === []` を同一視しない。** 前者は「一度も取得に成功していない（`lastSuccessAt === null`）」、後者は「正常に取得できたが対象フレームが 0 件」である。画面文言を分ける。
- **`metadata` の各 null を推測で埋めない。** `source` / `sourceVersion` / `issuedAt` などが null のとき、他のフィールドから代用値を作らない。
- **会場は `terminalId` でのみ解決する。** 緯度経度・会場 ID をクエリに載せない。API は全国共通の索引を返すが、`terminalId` は必須である。
- **`controlStatus` を画面で `normal` に固定しない。** `training` / `test` では API が `status: 'unsupported_control_status'`、`allowedZooms: []`、3 レイヤーとも `availability: 'unavailable'` / 他フィールド全 null / `data: null` を返す。この場合、**キキクルのタイル要求を一切行わず**、「この制御状態ではキキクルを提供していません」と明示する。正常データの流用・別 `controlStatus` への自動フォールバックを行わない。
- **`isTraining` を本番相当と同一視しない。** `WeatherContext.isTraining` が true の応答から得た時刻・画像を、本番の危険度として表示しない。`controlStatus !== 'normal'` では上記のとおりそもそもデータが来ないため、実装上は「非提供」の分岐で完結する。
- `allowedZooms` が `[]` のときにフロントの既定 10 で補完しない。空なら重畳しない。

## 10. F2 (#45) への依存【確定・2026-09-15】

**製造順序は F2 (#45) 先行、F3 (#46) 後続で確定した。** 以下の共通基盤は **F2 が実装してマージ済みであることを本 Issue の着手条件**とし、F3 は `import` して流用する。F3 側で新規作成・再定義・フォークをしない。名称・配置は F2 設計書 `docs/design/issue-45-nowcast-layer.md` §8.2 が正本である。

| 共通モジュール（F2 が所有） | F3 が前提とする仕様 |
| --- | --- |
| `apps/web/src/api/tileCatalogClient.ts` | `fetch` + `AbortController`、HTTP・JSON 失敗を例外ではなく失敗種別へ写す。`path` と `parse` を差し替えてキキクル索引に使う |
| `apps/web/src/map/tiles/useTileCatalogPolling.ts` | `TILE_CATALOG_POLL_INTERVAL_MS = 60_000`、`TILE_CATALOG_BACKOFF_MS = [60_000, 120_000, 240_000, 300_000]`（取得失敗時のみ）、成功で基準へ復帰、直前値を保持し一覧を空にしない、初回は即時 1 回、可視状態でのみ動作、アンマウントで `clearInterval` と `abort()` |
| `apps/web/src/map/tiles/WeatherTileOverlay.tsx` | `urlTemplate` / `opacity` / native zoom を props で受ける。`errorTileUrl` は空。新レイヤーの `load` 後に旧レイヤーを外すダブルバッファ。`onTileError` / `onSwapSettled` を外へ渡す |
| `apps/web/src/map/tiles/tileZoom.ts` | `resolveTileZoomPolicy(allowedZooms)` が native zoom と表示ズーム下限を返す。`allowedZooms` が空なら `null`（レイヤーを載せない） |
| `apps/web/src/map/MapViewport.tsx` の改変 | `MapViewportHandle` の Leaflet インスタンス取得口。F3 はこのファイルを変更しない |

**F3 製造担当への指示**: 着手時に上記が `main` に存在することを確認する。存在しない、または仕様が上表と食い違う場合、**自己判断で F3 側に別実装を起こさず、統括担当へ差し戻す。** `apps/web/src/map/WeatherMapView.tsx` と `apps/web/src/App.tsx` は F2 も変更するため、F2 のマージ後の最新 `main` を基点にすること。

### 10.1 共通モジュールへ押し込まないレイヤー固有事項

- **同 `validTime` の候補選択**: ナウキャストは N1/N2 の 2 プロダクトを持ち候補が生じうる（AD-H057）。キキクルは §3.1 の実測により候補が生じない。候補選択はレイヤー別のアダプター（F3 では `kikikuruCatalog.ts`）に置く。
- **表示窓**: 雨雲は ±60 分、キキクルは過去 3 時間（§6.4）と異なる。共通フック側で窓を適用しない。
- **`member` の再解決**: キキクル固有（§6.3）。共通側へ持ち込まない。
- **`opacity`**: 雨雲とキキクルで別定数とする（§7.3）。
- **`resetKey` の構成**: F2 設計書 §8.3 はキキクルについて「`resetKey` に選択中の種別を含め、種別切替で即時取得させる」としているが、キキクル API は 1 応答で 3 レイヤーを返すため再取得の実益がない。**F3 は `resetKey` に種別を含めない。** → §12-3。

## 11. 受け入れ条件

検収担当が 1 項目ずつ実行する。UI 実測は Web フォント適用完了後、主領域を 1920×1080 相当と 1024×768 相当の両方で行う。

### 11.1 静的検査

- [ ] `npm run lint` / `npm run typecheck` / `npm run format:check` / `npm run test -w apps/web` がいずれもエラー・警告 0 で完了する。

### 11.2 種別選択（Issue 受け入れ条件 1 を差し替え）

**Issue #46 の受け入れ条件「キキクルへの初回切り替え時に大雨（統合表示）が選択される」は、§5.1 の判断（2026-09-15 統括確定）により本 Issue の対象外である。検収で確認しない。** 代わりに次を確認する。

- [ ] アプリ起動直後、レイヤー選択メニューを開くと「雨雲ナウキャスト」が選択状態であり、メニュー項目は雨雲ナウキャスト／大雨／浸水／土砂のフラット 4 択のままである（F5 実装から構造が変わっていない）。
- [ ] 「大雨」を押すとタイル要求のパスが `/api/weather/kikikuru/heavyrain/tiles/...`、「浸水」で `/inund/`、「土砂」で `/land/` になる。ブラウザの Network タブで確認する。
- [ ] 押した種別がそのまま即座に表示される。別の種別へ勝手に差し替わる初期強制ロジックが存在しない（例: 「土砂」を押して一瞬でも `heavyrain` のタイル要求が出ない）。
- [ ] `localStorage` / `sessionStorage` にレイヤー種別のキーが増えていないことを DevTools の Application タブで確認する。
- [ ] `apps/web/src/map/LayerSelector.tsx` に差分がない（`git diff` で確認）。

### 11.3 中心・ズームの保持（Issue 受け入れ条件 2）

- [ ] 地図をドラッグして会場から意図的にずらし、＋ボタンでズーム 13 にする。この状態で 大雨→浸水→土砂→雨雲→大雨 と切り替える。各切替の前後で `map.getCenter()` の lat/lng と `map.getZoom()` が**完全に一致**する（DevTools コンソールで取得、または切替前後の値を比較する単体テストで確認）。
- [ ] 上記の操作中、`MapViewport` の `placementRef` が `'manual'` のまま変化しない（＝会場への強制復帰が起きない）。ドラッグ後に切替を挟んでも会場中心へ戻らないことを目視で確認する。
- [ ] `apps/web/tests` に、**レイヤー切替時に `setView` / `flyTo` / `fitBounds` / `panTo` のいずれも呼ばれないこと**を検証する回帰テストが存在し、通過する。
- [ ] `apps/web/tests` に、**キキクル種別の切替で常に最新コマの ID に更新されること**を検証する回帰テストが存在し、通過する。

### 11.4 再生停止・時刻の維持・操作UI（Issue 受け入れ条件 3 を修正）

**Issue #46 の受け入れ条件「切り替え直後は再生停止・最新時刻表示になる」は、§5.3 および §6.4 の判断（最新1コマのみ表示・簡易カード化）により修正されている。**

- [ ] ナウキャストで再生中（`playing === true`）にキキクルへ切り替えると、キキクル用の簡易カードに切り替わり、ナウキャストへ戻った時には再生が停止している。
- [ ] ナウキャストからキキクル、およびキキクル種別間で切り替えたとき、常に各レイヤーの最新コマが選択される。
- [ ] キキクル表示中、下部中央のカードが簡易カード（`KikikuruStatusCard`）になっており、**スライダー・前へ・次へ・再生・最新へボタンが DOM に存在しない**ことを確認する。
- [ ] キキクル表示中の簡易カードに「基準」「予測を含む判定結果です」の表記が DOM に存在しないことを確認する。
- [ ] キキクル表示中、最新時刻が `MM/DD HH:mm` 形式で表示されている。
- [ ] 0コマ（利用可能な時刻がない）の場合、「利用可能な時刻はありません」と表示される。
- [ ] ナウキャスト選択中は従来どおり `TimelineControlCard` が表示され、スライダーやスピナー等の機能に影響が出ていない（F2 の受け入れ条件を満たし続ける）。
- [ ] F4 共有コンポーネント（`TimelineControlCard.tsx`）、`types.ts`、`nowcast/`、`tiles/` 等に差分がないことを `git diff` で確認する。
- [ ] ナウキャスト↔キキクル間で切り替えた際、カードの高さが変わっても、地図の中心（lat/lng）やズームが変わらず、意図せぬジャンプが起きないことを目視および `map.getCenter()` 等で確認する。

### 11.4.1 表示窓（最新1コマ）

- [ ] キキクルの `frames` が**索引の最新 `validTime` の1コマのみ**にフィルタされている。
- [ ] API 応答（`/api/weather/kikikuru/times`）には古いフレームが含まれている一方、簡易カードには最新時刻1件しか出ていない。
- [ ] `apps/api` と `packages/shared` に表示窓に関する差分がない（`git diff` で確認）。窓の適用はクライアント側だけである。

### 11.5 ズーム・タイル座標・凡例位置（AD-H058）

- [ ] キキクル表示中に DevTools の Network タブでタイル要求を確認し、**表示ズームが 11 でも 13 でも、要求 URL の `z` が常に `10`** である。
- [ ] `east` 端末の初期表示（ズーム 11、会場中心）で、要求されたタイル座標の集合に **`10/909/403`** が含まれる。`trc` 端末でも同じく `10/909/403` が含まれる。
- [ ] 表示ズームを 9 以下へ下げると、キキクルのタイル要求が発生しなくなり、「この縮尺では危険度分布を表示していません」が表示される。「危険度なし」「安全」の語が画面に現れない。
- [ ] 表示ズームを 10 へ戻すと重畳が復帰する。
- [ ] 凡例が地図領域の**左上**に表示され、閉じると同位置に「凡例を表示」ボタンが残る。凡例が右側情報列・時間操作カード・出典リンクのいずれとも重ならない（1920×1080 と 1024×768 の両方）。
- [ ] 凡例の階級ラベルが §7.4.1 の確定値である。土砂キキクルでは「注意（警戒レベル 2 相当）／警戒（警戒レベル 3 相当）／危険（警戒レベル 4 相当）／災害切迫（警戒レベル 5 相当）」、**浸水キキクルでは注意・警戒・危険に警戒レベル相当の付記がない**（災害切迫のみ「警戒レベル 5 相当」）。大雨キキクルには警戒レベル相当の付記がない。
- [ ] 旧表記「非常に危険」「極めて危険」が画面のどこにも現れない（DOM 全体を検索して確認）。

### 11.5.1 階級色とデータ色トークン（§7.4.2）

- [ ] 凡例の swatch の算出値が、3 種いずれでも上から `#0C000C`（災害切迫）/ `#AA00AA`（危険）/ `#FF2800`（警戒）/ `#F2E700`（注意）/ `#FFFFFF`（今後の情報に留意）である。DevTools の Computed スタイルで `background-color` を読み、`rgb(12, 0, 12)` / `rgb(170, 0, 170)` / `rgb(255, 40, 0)` / `rgb(242, 231, 0)` / `rgb(255, 255, 255)` と一致することを確認する。
- [ ] `--wx-data-kikikuru-imminent` / `-danger` / `-warning` / `-caution` / `-none` の 5 トークンが定義され、`getComputedStyle(document.documentElement).getPropertyValue('--wx-data-kikikuru-caution')` が `#F2E700` 相当を返す。
- [ ] 凡例の swatch が `var(--wx-data-kikikuru-*)` を参照しており、`--wx-alert-level-*` を流用していない（`apps/web/src/map/fixtures.ts` を確認）。

### 11.5.2 公式配色リテラルの単一情報源化（§7.4.3）

- [ ] `apps/web/src/theme/officialJmaColors.css` が存在し、`--wx-jma-hue-dark-purple` / `-purple` / `-red` / `-yellow` / `-white` の 5 プリミティブを定義している。ファイル冒頭コメントに §7.4.2 の出典 2 URL と取得日 2026-09-15 がある。
- [ ] `apps/web/src/theme/kikikuruDataColors.css` のキキクル 5 トークンが、いずれも `var(--wx-jma-hue-*)` 参照であり HEX を直書きしていない。
- [ ] `apps/web/src/theme/weatherDataColors.css` の `--wx-data-nowcast-7` が `var(--wx-jma-hue-red)` になっている。**同ファイルの他 7 行（`nowcast-1〜6, 8`）が変更されていない**ことを `git diff` で確認する（差分が 1 行であること）。
- [ ] `#FF2800` / `#ff2800` が `apps/web/src` 全体で `officialJmaColors.css` の 1 か所にしか存在しない。`grep -ri 'ff2800' apps/web/src` で 1 件であることを確認する。
- [ ] **HEX リテラルの許可ファイルが `seeds.ts` / `semanticColors.ts` / `buzzerNoticeColors.ts` / `systemStatusColors.ts` / `weatherDataColors.css` / `officialJmaColors.css` の 6 つに限られている。** `apps/web/tests/kikikuruLegendAndColors.test.ts` の許可一覧から `dataColors.ts` が除かれ、`officialJmaColors.css` が加わっていること。テストが通過すること。なお `buzzerNoticeColors.ts`（main の Issue #63、PR #196）と `systemStatusColors.ts`（main の K1 監視画面）は、いずれも MD3 トーナルパレット生成用のシード色だけを持つファイルで、本 Issue の後から許可一覧に加えた。
- [ ] `apps/web/src/theme/dataColors.ts` が削除され、`applyTheme.ts` / `index.ts` に `applyDataColors` への参照が残っていない（`grep -rn 'applyDataColors\|KIKIKURU_DATA_COLORS\|KIKIKURU_COLOR_TOKENS' apps/web/src apps/web/tests` が 0 件）。
- [ ] `apps/web/src/index.css` が `officialJmaColors.css` と `kikikuruDataColors.css` を `@import` している。
- [ ] ブラウザで凡例の swatch が §11.5.1 の 5 色で描画される（CSS への移行後も実際に色が付いていること。`var()` の参照切れで透明・黒になっていないこと）。
- [ ] 雨雲ナウキャストの凡例・タイル補助 UI の色が、この変更の前後で見た目に変化していない（`--wx-data-nowcast-7` の解決値が `rgb(255, 40, 0)` のままであることを Computed スタイルで確認）。

### 11.5.3 凡例見出し（§7.4.1）

- [ ] 大雨キキクルの凡例見出しが `浸水害・洪水の危険度分布（統合）` である。**`大雨警報（浸水害）の危険度分布` になっていない**（これは浸水キキクルの名称）。
- [ ] 浸水キキクルの凡例見出しが `大雨警報（浸水害）の危険度分布` である。
- [ ] 土砂キキクルの凡例見出しが `大雨警報（土砂災害）の危険度分布` である。
- [ ] 3 種いずれの `legendTitle` にも「キキクル」の語が含まれていない（レイヤー名との重複を避ける規約）。
- [ ] 階級名の最下位が 3 種とも「今後の情報等に留意」（「等」あり）で統一されている。
- [ ] 「今後の情報に留意」の白い swatch が、ダークテーマの凡例カード上で `--md-sys-color-outline` の細線に囲まれ、背景と区別できる。
- [ ] 実データに着色が出ている時刻・座標があれば、地図上の着色と凡例の swatch が同じ色に見える。着色が出ていない場合はその旨を検収記録に残し、「凡例と地図の色一致を確認した」と報告しない。
- [ ] タイル画像のレスポンスが `Content-Type: image/png`、`Cache-Control: no-store` であり、`X-Wx-Catalog-Availability` / `X-Wx-Tile-Result` / `X-Wx-Tile-Stored-At` が付いている。
- [ ] 取得した PNG が 256×256 で完全にデコードできる（DevTools のプレビュー、または保存したファイルのデコードで確認）。全透明のタイルが返っても、画面に「危険度なし」と表示されない。

### 11.6 索引ポーリング（AD-H062）

- [ ] キキクル表示中、`GET /api/weather/kikikuru/times` が **60 秒間隔**で 1 本ずつ発生する。5 分間観測して 5〜6 本であり、多重起動していない。
- [ ] ポーリング間隔が F2 (#45) の `TILE_CATALOG_POLL_INTERVAL_MS` を import した値であり、F3 側で別途 60000 を定義していない（`git grep` で `60_000` / `60000` の重複定義がないことを確認）。
- [ ] **種別を大雨→浸水→土砂と切り替えても、`/times` の追加要求が発生しない**（1 応答の `layers` から 3 種を賄っている）。
- [ ] ビューから離れる／コンポーネントをアンマウントすると `/times` の要求が停止する。
- [ ] 索引取得を意図的に失敗させても（DevTools でオフライン化、または API を停止）、直前のフレーム一覧と表示中の画像が消えず、取得失敗が `status` slot に示される。「利用可能な時刻はありません」へ落ちない。
- [ ] `catalogAccess.allowed === false` を返す応答（夜間相当、または `config/polling.yaml` の時間帯を検証環境で調整して再現）を受けても、ポーリング間隔は 60 秒のままである（正常応答であり、取得失敗のバックオフ対象にしない）。停止中である旨が `status` slot に示される。
- [ ] `/times` を 5xx で失敗させると、次回以降の間隔が 120 → 240 → 300 秒と後退し、成功した時点で 60 秒へ戻る（F2 の共通フックの挙動をキキクル側でも確認する）。
- [ ] `/times` 以外に、画面から上流の気象庁へ直接アクセスする要求が 1 本も発生しない（Network タブで `jma.go.jp` へのリクエストが `cyberjapandata.gsi.go.jp` の背景タイル以外に存在しない）。

### 11.7 時刻表現（確定事項 3）

- [ ] キキクル表示中、選択日時が「MM/DD HH:mm」の形式で表示され、「基準」等の表記がない。
- [ ] キキクル表示中の画面テキストに「実況」「予報」「予測中」「有効期限」「〜まで有効」「失効」のいずれも現れない。DOM 全体を検索して確認する。
- [ ] DOM 全体を検索して、「この危険度は予測を含む判定結果です」の注記が存在しないことを確認する。
- [ ] スライダーの各目盛りの `aria-valuetext` に「実況」「予報」が含まれない。
- [ ] `metadata.issuedAt` の値が「発表時刻」というラベルで画面に出ていない。
- [ ] 時間軸に現在時刻より未来のコマが並んでいない。
- [ ] 単体テストで、`KikikuruApiFrame` から生成した `TimelineFrame` の `kind` が全件 `'reference'` であることを検証している。

### 11.8 共通メタ情報・3 状態・訓練/本番（追加受け入れ条件）

- [ ] `availability` が `stale` の応答（`lastSuccessAt` を古くした fixture で再現）で、フレーム一覧と画像が保持されたまま鮮度低下が示される。一覧が空にならない。タイル要求が止まらない。
- [ ] `availability` が `unavailable` かつ `data: null` の応答と、`availability: 'available'` かつ `data: { frames: [] }` の応答とで、画面文言が異なる。
- [ ] 3 レイヤーの `availability` が異なる応答（例: `heavyrain` は `available`、`land` は `unavailable`）で、選択中の種別の状態だけが反映され、他種別の状態で上書きされない。
- [ ] `controlStatus=training` / `test` の端末で、キキクルのタイル要求が 1 本も発生せず、「この制御状態ではキキクルを提供していません」が表示される。`normal` のデータを流用しない。
- [ ] 単体テストで、`status: 'unsupported_control_status'` の応答から `TimelineFrame` が 1 件も生成されないことを検証している。
- [ ] `allowedZooms: []` の応答で重畳が行われない。フロントの既定値 10 で補完しない。

### 11.9 境界確認（追加受け入れ条件「未対応を実装済みと扱わない」）

- [ ] 洪水キキクルがレイヤー選択メニューに現れない。`flood` を含むタイル要求が発生しない。
- [ ] 雨雲ナウキャストの実タイル重畳は F2 (#45) の成果であり、本 Issue の実装結果として報告しない。本 Issue で確認するのは、ナウキャストを選択しても例外が出ずキキクル側の状態が壊れないことだけである。
- [ ] 再生ボタンを押しても時刻が自動で進まない（再生タイマーは F7 #50 の責務）。押下で `playing` の表示状態だけが切り替わることを確認し、「再生機能が動作する」と報告しない。
- [ ] 最新追従（新着コマの自動選択）が動作しない。索引更新で新しいコマが増えても、選択時刻は自動で進まない（F7 #50）。
- [ ] 凡例の階級色は公式配色（§7.4.2）で確定しているが、**地図上の実着色との目視一致は実データ次第**である。着色が出ていない状態で「凡例と地図の色一致を確認した」と報告しない。
- [ ] 透過度 `0.75` は【設計案】のままであり（§7.3）、「実データで視認性を検証して確定した」と報告しない。
- [ ] ナウキャストのデータ色トークン `--wx-data-nowcast-*` を F3 が定義していない（F2 #45 の範囲）。
- [ ] §10 の共通モジュール 4 本が F2 (#45) 由来であり、F3 が同名・同責務のファイルを新規作成していない（`git log --follow` または `git diff` で作成者 Issue を確認）。「共通基盤を実装した」と報告しない。
- [ ] 「キキクルへの初回切り替え時に大雨が選択される」を実装済みと報告しない（§5.1 により対象外）。

### 11.10 棚卸し結論の記録

- [ ] 本書 §13 に AD-H057 / AD-H058 / AD-H062 の結論が記録されている。採否待ちの保守事項を修正必須へ昇格させていない。

## 12. 未決事項（統括担当の確認を要する）

初版の未決事項はすべて 2026-09-15 のヒアリングと資料支給で確定した（§0）。**階級色（初版 §12-1）と `#F2E700` の階級割当（初版 §12-2）は §7.4.2 で確定済みであり、未決から外した。** 残る未決は次のとおり。

1. **重畳の透過度 0.75。** 会場周辺に着色が出ている実データで視認性を確認できていない（実挙動未確認）。公式配色が確定したことで検証はしやすくなった（`#0C000C` の災害切迫を 0.75 で重ねたときに背景の地名が読めるか、`#FFFFFF` 相当の無着色域と区別がつくか等）が、着色が発生している実データを待つ必要がある。検収時に着色が出ていなければ、値は【設計案】のまま据え置く。
2. **キキクル→ナウキャストの切替で時刻を引き継がない扱い。** §5.3 のとおり時間軸が一致しないため引き継がず最新コマを選ぶ設計にしたが、確定事項として明示的に確認を得ていない。F2 (#45) の設計と突き合わせる必要がある。
3. **F2 設計書 §8.3 との食い違い（`resetKey` に種別を含めるか）。** F2 設計書は「`useTileCatalogPolling` の `resetKey` に選択中のキキクル種別を含め、種別切替で即時取得させる」としているが、キキクル API は 1 応答で 3 レイヤーすべてを返すため（`kikikuruApiService.ts` が `KIKIKURU_LAYERS` をループして `layers` Record を必ず埋める）、種別切替での再取得は新しい情報を得られず API 呼び出しを増やすだけである。本書は §6.2・§10.1 のとおり**種別を `resetKey` に含めない**設計にした。どちらを正とするか、F2 設計書側の当該記述を修正するかの判断を要する。本書の受け入れ条件 §11.6 は「種別切替で `/times` の追加要求が発生しない」を検証項目にしている。

## 13. 棚卸し管理項目の結論

| 項目 | 本 Issue での結論 |
| --- | --- |
| **AD-H057** タイルの選択・部分欠け | **キキクルでは同一 `validTime` の複数候補は発生しない。** 上流 `targetTimes.json` は 1 時刻につき 1 `member` しか返さず（37 件で `validtime` 重複ゼロ、実測）、`kikikuruService` は取得成功のたびにスナップショットの `frames` を全面置換するため、保存索引にも重複が生じない。ただし `member` は時間とともに `immed0`→`immed1`→`immed2`→`none` とドリフトするため、フロントは `validTime` を id とし、タイル要求の直前に最新索引から `member` を引き直す（§6.3）。部分欠けは `errorTileUrl` で埋めず透明のまま残し、件数のみ `status` slot へ出す。欠けの分類・前回画像の時刻表示は F8 (#51) に残す。再生中の一覧固定は受け口のみ用意し、再生タイマーは F7 (#50) に残す。 |
| **AD-H058** PNG 完全 decode・位置/凡例 | **完全 decode を実施し成功した。** `rain_mesh/10/892/408` は 256×256 / bitDepth 8 / colorType 6 / 非インターレース、zlib 展開後 262400 バイトを全行フィルタ解除まで通した。**位置**は標準 XYZ / EPSG:3857 であり、会場の z10 タイルは両会場とも `10/909/403`（取得方法レポートの実検証座標と一致）。**zoom** は z10 のみがネイティブ生成であり、z9・z11・z12 は z10 に着色がある地点でも同一バイト列の全透明 PNG を 200 で返す（＝HTTP 200 は対応の証拠にならない）。よって `allowedZooms=[10]` を維持し `minNativeZoom=maxNativeZoom=10` で拡縮する。**凡例**の位置は F5 実装済みの左上を維持する。**階級区分・名称は公式マニュアル（別表 3、令和 4 年 6 月以降）から確定させた**（§7.4.1）。**階級色は公式配色（HP 配色設定指針・警戒レベル対応ページ）から 5 段階すべてを確定させ、データ色トークン `--wx-data-kikikuru-*` として定義した**（§7.4.2）。実測した着色 `#F2E700` は公式値 rgb(242,231,0)「注意」と**完全一致**し、透明画素 `(255,255,255,0)` も「今後の情報に留意」の白と一致した。着色部が α=255 の完全不透明であることを確認し、重畳は `opacity: 0.75` とする。**透過度の実データでの視認性のみ実挙動未確認**であり §12-1 に残す。追加検証の採否は統括担当の判断とし、本書から修正必須へ昇格させない。 |
| **AD-H062** 索引周期と画面再読込頻度 | **画面は `/api/weather/kikikuru/times`（保存索引の読み出しのみ、上流 HTTP なし）を 60 秒間隔でポーリングする。** `refreshTimes` 相当の上流再取得を画面から起こさない。根拠はバックエンド索引周期の最短値（日中 60 秒）を上回らないこと、`staleAfterSeconds: 300` の鮮度遷移を確実に検知できること、上流 10 分更新に対し最悪検知遅れ 120 秒（20%）に収まることである。取得失敗時のバックオフ（60→120→240→300 秒、成功で復帰）は F2 の共通フックの規約に従う。夜間の `catalogAccess.allowed === false` は正常応答でありバックオフの対象にしない。定数 `TILE_CATALOG_POLL_INTERVAL_MS` は F2 (#45) が定義し F3 が import する（§10）。 |

## 14. 後続 Issue への引き継ぎ

| 後続 | 引き継ぐもの | 先取りしないもの |
| --- | --- | --- |
| F2 #45（**先行**） | §10 の共通モジュール仕様（`TILE_CATALOG_POLL_INTERVAL_MS = 60_000`、`resolveTileZoomPolicy` による native zoom と表示ズーム下限）を F2 が実装する前提 | 表示窓（雨雲 ±60 分とキキクル過去 3 時間は別物。共通フックに窓を入れない）、キキクル固有の `member` 再解決 |
| F7 #50 | `playing` 中に索引をバッファへ退避する受け口、`selectedFrameId` が窓外・提供範囲外になったときに `null` にして案内する接点、種別切替で時刻を維持する規約（§5.3） | 再生タイマー、最新追従、手動保持、案内文言の最終形 |
| F8 #51 | `tileerror` の件数、`availability` 3 状態、`data === null` と空 `frames` の区別、`status` slot | 欠け・未取得・停止・前回画像の分類表示と文言 |
| F5 #48 / L1 #83 | §7.4.1 の確定した階級区分・名称・警戒レベル相当（浸水は 24/34/44 に警戒レベル相当なし）、§7.4.2 の確定した公式配色 5 色とデータ色トークン `--wx-data-kikikuru-*`、「着色部は α=255」「無着色部は `(255,255,255,0)`」の実測事実 | 透過度の実データ検証、洪水キキクルの配色 |
| K6 #79 | フロント側索引ポーリング 60 秒という結論（取得監視画面の表示更新頻度と整合させる） | タイル健全性の判定基準 |

## 15. 実挙動未確認の箇所

1. 会場周辺に危険度の着色が出ている状態での視認性・透過度 0.75 の妥当性（2026-09-15 時点で、会場周辺および全国のほぼ全域で着色なし）。
2. 「注意」より上位の階級色（警戒・危険・災害切迫）が**タイル画像上で**公式配色どおりに描かれていること。配色自体は §7.4.2 で公式資料から確定したが、実データに出現しなかったため画素値としては未照合である。「注意」と「今後の情報に留意」の 2 色のみ実測と一致を確認済み。
3. 実画面での背景地図との重ね合わせの目視一致（座標系の一致は算出と実検証座標の照合で確認済みだが、描画結果の目視は未実施）。
4. 夜間（20:00–04:00、`kikikuruEnabled: false`）での実運用挙動。
5. 表示ズーム 10 における 45 枚規模のタイル同時要求の実測応答時間。

## 16. 備考（本 Issue のスコープ外・要フォローアップ）

1. **`docs/basic-design.md` §4.3 の更新が必要である。** 同節は「キキクルへの初回切り替え時は大雨（統合表示）を初期選択とし、以降は選択した種別を画面内で保持する」を【確定】として記載しているが、§5.1 のとおり F5 実装のフラット 4 択 UI ではこの前提が成立せず、2026-09-15 のユーザー判断により本 Issue の対象外となった。基本設計書本体の記述更新は本 Issue のスコープ外であり、別途フォローアップ Issue または統括担当による改訂を要する。CLAUDE.md 禁止事項 7 のとおり、本書から基本設計書を書き換えていない。
2. **`docs/basic-design.md` §4.2 の「切り替え時は再生を停止し、切り替え先の最新の利用可能時刻を表示する案とする。時刻の引き継ぎや選択状態の保存は要協議」も更新対象である。** §5.3 のとおり、キキクル種別間では時刻を引き継ぐ方針が一度確定したが、さらにオーナー指示により「常に最新1コマのみ表示・時刻引き継ぎ廃止」へ変更された。同じく本 Issue のスコープ外とする。
3. **`docs/basic-design.md` §4.3 の「キキクルは最新を基本とし、取得可能な過去 3 時間を表示窓とする案」は【未確定】のまま記載されている。** §6.4 のとおりオーナー指示により「最新1コマのみ」へと変更されたため、タグを【確定】へ改め内容も更新する必要がある。同じく本 Issue のスコープ外とする。
4. **`docs/basic-design.md` §4.3 の時間操作カードに関する記述の更新。** 本書 §8.3 の決定により、キキクルでは共用の時間操作カードを使用せず専用の簡易カードを使用することになったため、基本設計書と食い違う。これもフォローアップ事項とする。
5. **Issue #46 の本文（やること・受け入れ条件）も、変更を反映する必要がある。** 受け入れ条件 1 の削除と受け入れ条件 3 の文言修正。本書は設計書のみを改訂しており、Issue 本文は変更していない。
6. **`docs/audit-epic-a-d.md` の AD-H057 / AD-H058 / AD-H062 の状態欄。** 本書 §13 に結論を記録したが、台帳側の状態更新は棚卸し Issue (#139) の管理範囲であり本 Issue では行わない。採否待ちの保守事項（AD-H058 の追加検証）を修正必須へ昇格させていない。

## 17. 検収差し戻しによる改訂（2026-09-15）

ブランチ `feature/issue-45-46-nowcast-kikikuru-layers`、F3 実装コミット `9aaeef8` に対する検収（`wxviewer-inspector`）で見つかった軽微な不整合 3 点を、本書で解消した。いずれも受け入れ条件の不合格ではなく、設計書と実装の記述上のずれ、および設計上の改善点である。

| # | 検収指摘 | 本書での解消 | 実装側の作業 |
| --- | --- | --- | --- |
| 1 | `fixtures.ts` の大雨キキクル `legendTitle` が `'大雨警報（浸水害）の危険度分布'` であり、浸水キキクルの名称になっている。§7.4.1 の「浸水＋洪水の統合表示」と食い違う | §7.4.1 に「凡例見出し（`legendTitle`）の確定値」を追加。3 種の見出しを確定し、命名規約（製品名を含めない・単独の警報名を使わない）を明記 | `fixtures.ts` の `legendTitle` 3 件を修正（§7.4.1 の修正表） |
| 2 | 受け入れ条件は「スライダーが disabled」だが、実装はスライダー自体を非表示にしている。動作は同等だが記述が食い違う | §11.4 の当該条件を「スライダーが非表示（未描画）になる」へ修正。**現行実装（非表示）を正**と明記 | 実装変更なし |
| 3 | `#FF2800` が `weatherDataColors.css`（F2 所有）と `dataColors.ts`（F3 所有）の 2 か所にハードコードされ、単一情報源になっていない | §7.4.3 を新設。プリミティブ／セマンティックの 2 層構成、CSS へ寄せる技術的理由、F2 所有ファイルの 7 値を据え置く理由、責務分担と根拠を明記 | 共通 CSS 2 本を F3 が新設、`dataColors.ts` を削除、`weatherDataColors.css` は 1 行のみ変更（§7.4.3 の分担表） |

指摘 3 について、統括担当は「F3 側が共有モジュールを新設するか、F2 側がするか、どちらでもよいので設計書側で決めて根拠を残す」としていた。本書は **F3 側が新設し、F2 所有ファイルの変更を 1 行に抑える**方針を採った。根拠は §7.4.3「責務分担」の 3 点（重複を持ち込んだのが後発の F3 であること、リテラル単一化の規約が F3 の設計由来であること、F2 設計担当の並行作業との衝突面積が最小になること）。

**意味の統合はしない**点を強調する。`--wx-data-nowcast-7`（猛烈な雨）と `--wx-data-kikikuru-warning`（警戒）は値が一致しているだけで意味は無関係であり、1 つの配色改定がもう片方を黙って巻き込む。共有するのはリテラルのみとし、セマンティックトークンは分離したままにする。

これに伴う受け入れ条件の追加は §11.5.2（単一情報源化）と §11.5.3（凡例見出し）である。§11.5.1 から、`dataColors.ts` を前提とした HEX 許可ファイルの確認項目は §11.5.2 へ移した。

## 18. オーナー指示による設計変更（2026-09-22）

オーナーの指示により、キキクルの表示を「最新コマ1枚のみ」とする設計変更を実施した。さらに、直後の指示により「簡易カードの採用」「最新時刻の表示維持」が【確定】した。

### 18.1 不要になった要件と残る要件の整理

| 不要になる要件 | 残る要件 |
| --- | --- |
| 3時間窓のフィルタ | `swapKey` 等による種別切替でのタイル差し替え |
| 種別切替での過去時刻の引き継ぎ | `member` の再解決 |
| 選択消失時の「提供範囲外」の注記・状態遷移 | 60秒ポーリング |
| `selectedFrameId` による過去時刻の保持 | ズーム10未満での非表示・案内文言 |
| 「基準」「予測を含む判定結果です」の注意書き表示 | 0コマ時（バックエンド不具合等）の「利用可能な時刻はありません」相当の表示 |
| 共用の時間操作カードのキキクルでの利用 | 凡例の階級色・見出し・出典の表示 |
| | 最新時刻（`MM/DD HH:mm`）の表示 |

**0コマ時の定義**: バックエンド不具合等により索引が空（`data.frames === []`）の場合、クライアント側フィルタ後も0コマとなる。この場合、「利用可能な時刻はありません」と表示される。

### 18.2 基本設計（§4.3）との差異とフォローアップ事項

基本設計書の §4.3 には以下の記述があるが、今回の変更により前提が覆るため差が生じる。
- 「キキクルの時刻は危険度判定の基準時刻として示し、予測を含む危険度を単なる実況と表現しない」 → 注意書きを全削除した。
- 「キキクルは最新を基本とし過去3時間を表示窓とする案」 → 最新1コマのみの表示とした。
- キキクルでも時間操作カードを用いる前提の記述 → キキクル専用簡易カード（`KikikuruStatusCard`）へ差し替えることとした。

**【要フォローアップ】**: 基本設計書 `docs/basic-design.md` 自体の改訂は本 Issue のスコープ外とするため、後日統括担当または別 Issue にて基本設計書の更新を行う必要がある（本設計書 §16 の備考に追記した扱いと同様）。

### 18.3 誤認防止と簡易カードに関するユーザー判断事項【確定】

「基準」「予測を含む判定結果です」の注意書きを削除するにあたり提示した選択肢は、オーナー指示により以下のように【確定】した。

- **時刻表示を残す（MM/DD HH:mm）**: 【確定】。最新コマの時刻は引き続き表示し、禁止語ルール（「実況」「予報」等を使わない）を維持する。
- **簡易カード（`KikikuruStatusCard`）への差し替え**: 【確定】。最新1コマのみとなることに伴い、スライダーや再生ボタン等の操作部を持たないキキクル専用カードを新設し、共用カード（`TimelineControlCard`）と差し替えることとなった。

### 18.4 Codexレビュー指摘の自動解消

`useKikikuruLayerState.ts` に対する「選択消失時の null を初期状態と誤認する問題」の Codex レビュー指摘は、本設計変更により自動的に解消される見込みである。
過去のコマを保持するための `selectedFrameId` 状態管理自体が不要となり、常に「最新コマの ID」か「空（null）」の二値に単純化されるため、選択消失の複雑な状態遷移そのものが消滅する。
