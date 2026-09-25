# Issue #212 地図の初回操作時に表示中心が一度だけずれる

作成日: 2026-09-25  
改訂: 2026-09-25(PR #217 の UI 監修指摘への対応。§2.3・§3.3・§4.7〜4.9・§6.4 を追加し、§1・§4.6・§5・§6.2・§6.3・§7・§8 を改訂)  
対象 Issue: #212  
関連: #44 (F1、[issue-44-47-49-map-foundation-controls.md](issue-44-47-49-map-foundation-controls.md) §4.1〜4.2・§9.2)、#52 (G1、[issue-52-info-panel-layout.md](issue-52-info-panel-layout.md) AC-7)、#46 (F3、[issue-46-kikikuru-layer-switching.md](issue-46-kikikuru-layer-switching.md) §11.3)

## 1. 目的と範囲

気象情報画面で、読み込み後の初回クリックなどを契機に地図の表示中心が一度だけ動く不具合を直す。原因は、F1の初期中心補正が `requestAnimationFrame`(描画フレーム)に依存しており、描画が起きるまで補正が適用されないことである(§3)。あわせて、初期レイアウト確定後のレイアウト変化で会場が可視矩形の中心から外れる問題も直す。

改訂(UI 監修対応): ナウキャストの時刻配信の前後、およびレイヤー切替で会場ピンが動かないようにする(§2.3、§4.7〜4.9)。

範囲内:

- `apps/web/src/map/MapViewport.tsx` の中心補正・リサイズ追従処理の改修
- 判定・実行ロジックを DOM 非依存の純粋モジュールへ切り出し、自動テストを追加する
- F1設計書 §4.2(表と本文)・§9.2 の該当箇所の改訂(本Issueで改訂した旨を注記)
- (改訂)ナウキャスト時間操作カードの空状態の高さを配信後と揃える CSS 変更(§4.7)
- (改訂)中心補正の下端基準 B を「ナウキャストカードの高さ」に統一する高さ基準要素の追加(§4.8)と、F1 設計書 §4.1・§9.2 への追記(§4.9)

範囲外:

- 会場切替時の `placement` の扱い、ズーム操作、会場復帰ボタンの UI
- Leaflet 自身のウィンドウリサイズ処理(`trackResize`)の変更
- 右列の寸法・CSS の変更、キキクルの簡易カード(`KikikuruStatusCard`)の見た目の変更
- ナウキャストカードの配信後の見た目の変更(空状態のスライダー行の高さだけを揃える)

## 2. 参照資料と確定事項

### 2.1 参照資料

- `apps/web/src/map/MapViewport.tsx`(現行実装。rAF 予約・`layoutSettledRef`・`document.fonts.ready` 後の rAF で初期補正)
- `apps/web/src/map/WeatherMapView.tsx`(右列 slot・時間カードを callback ref + state で `MapViewport` へ渡す。時間カードはナウキャスト時 `TimelineControlCard`、キキクル時 `KikikuruStatusCard` に差し替わり、どちらもクラス `timeline-control-card` を持つ)
- `apps/web/src/map/projection.ts`(`calculateLeafletAdjustedCenter`。変更しない)
- `apps/web/src/map/tiles/useTileCatalogPolling.ts`(カタログ取得は `visibilityState` でゲートされる)
- `apps/web/tests/setupEnv.ts`・`apps/web/tests/kikikuruMapIntegration.test.ts`(テストは `node --test` + ダミー `window` で DOM なし)
- F1設計書 §4.1〜4.2・§9.2、G1設計書 AC-7、F3設計書 §6 末尾(「地図中心の補正 (F1) への影響」)・§11.3
- [C-01-browser-pane-visibility-limit.md](../rules/advisory/C-01-browser-pane-visibility-limit.md)、[C-02-ui-verification-backorder.md](../rules/advisory/C-02-ui-verification-backorder.md)
- (改訂)`apps/web/src/map/TimelineControlCard.tsx`・`apps/web/src/map/kikikuru/KikikuruStatusCard.tsx`・`apps/web/src/map/map.css`(時間カードの行構成と寸法)、`apps/web/src/map/nowcast/NowcastLoadingSpinner.tsx`(非表示時も 16×16 を確保)、`apps/web/tests/weatherMapView.test.ts`・`apps/web/tests/kikikuruMapIntegration.test.ts`(HTML 全体を文字列検査するテスト)
- Leaflet 1.9 の `setView`/`invalidateSize` の挙動(`setView(..., {animate:false})` は移動量が地図サイズ内なら `panBy` で即時に移動し、タイルを破棄しない)

### 2.2 ヒアリングで確定した事項【確定】

1. 初期中心補正を rAF に依存させず、寸法が計測可能になった時点で適用する。`ResizeObserver` の通知も描画ステップ依存である点に留意し、ブラウザペイン(hidden)でも初期補正が完了する設計にする。リサイズ追従の合流処理は維持してよい。
2. F1 §4.2 の表を改訂する。`initial`(未操作)の間は、初期レイアウト確定後もレイアウト変化(右列/時間カード/地図コンテナ/ウィンドウ)のたびに会場中心補正を再適用する。`manual` は従来どおり `invalidateSize` のみで閲覧位置を維持する。`returning` は従来どおり。
3. 受け入れ条件は、読込後の初回クリック(地図・ヘッダー・右側列)で中心不変、F1 の右列考慮の初期中心維持、未操作時の確定後レイアウト変化での中心維持、`manual` 時の位置維持(回帰)。自動テストとブラウザペインで検証できる範囲を検収対象とし、FHD・HD・iPad 11インチ横の実ブラウザでの見え方はオーナー確認観点(C-02 逆発注)とする。
4. 「起動直後のまれなずれ」の原因仮説は、可能な範囲で裏取りし確度を明記する。

### 2.3 UI 監修指摘に対するヒアリング確定事項【確定】(2026-09-25)

PR #217 の UI 監修コメントで、既存の受け入れ条件・確認観点はすべて合格としたうえで、次の仕様変更が要望された。

- ナウキャストの時刻情報配信の前後でピンが動かないこと(配信前のカードの高さを配信後と変えない/配信後のナウキャスト領域を基準に初期位置を決める)
- レイヤー切替でピンが動かないこと

統括担当の実測: 1920×1080 `/hkeagh01` でナウキャストカード(配信前・空)118px、キキクル(大雨)カード 54px。レイヤー切替でピンが約 32px 動く。前回検収(1024×768)では配信前 110px → 配信後 128px。

これに対する確定事項:

- A. ナウキャストカード(`TimelineControlCard`)は、配信前(空)・読み込み中・エラー/ステータス表示を含むすべての状態で、配信後と同じ高さを確保する。各ブレークポイントで一致させる。高さ差の発生要因をコード/CSS から特定して設計に書く。
- B. 中心補正の下端基準 B は、表示中レイヤーに関わらず「ナウキャストカードの高さ」に統一する。キキクルカードの見た目は変えない。キキクル表示中は会場が可視矩形中心より少し上になることを許容する(F1 の実寸補正原則の例外)。キキクル表示中にナウキャストカードの高さをどう得るかは設計で決め、`manual`/`returning`/リサイズ時の挙動との整合も書く。
- 前回の §4.6【確定】(未操作中のレイヤー切替も再補正)は、B により「基準高が変わらないので再補正してもピンは動かない」形へ改訂する。F3 設計書の改訂は引き続き本 Issue では行わない。
- 受け入れ条件は追加・変更分と回帰に絞る。配信後の高さを実測できない制約は、自動テスト・静的確認での代替と、オーナー確認観点(C-02)で補う。
- 設計時の判断事項 2 点もユーザーが同意した: (1) F3 既存テスト `kikikuruMapIntegration.test.ts` の時間操作非表示テストは、アサーションを弱めずに基準要素を除去した HTML で判定する(§4.8)。(2) キキクル表示中の会場の上方ずれ(1920×1080 で約 41px、1024×768 で約 37px の見込み)を許容する。細部は UI 監修で確認する。

## 3. 原因調査

### 3.1 実測(2026-09-25、メインフォルダで稼働中の 5174 を読み取りのみで使用、ブラウザペイン 1024×768)

| 計測 | 結果 |
| --- | --- |
| `document.visibilityState` | `hidden` |
| `/hkeagh01` 読込後、rAF ループを 30 秒回した回数 | **0 回** |
| 同期間の `.leaflet-map-pane` の transform | `translate3d(0px, 0px, 0px)` のまま(補正未適用) |
| 同条件で `ResizeObserver` を張った要素の幅を変更後 3 秒待機 | 通知 **0 回** |
| 同条件の `document.fonts.ready.then` / `queueMicrotask` | どちらも実行された |
| 同条件の `setTimeout(…, 1000)` の実間隔 | 1 秒 → 約 5〜10 秒に間引かれた |
| `getBoundingClientRect()`(hidden のまま) | 地図 952×624、右列幅 R=288、時間カード高 B=110 を正しく返した |
| 補正前の会場位置 (DOM 計測、§6.2 の計測式) | 地図中心 (476, 312)。目標 (332, 257) から dx=+144, dy=+55 = (R/2, B/2) |
| 何らかの描画が起きた後の同計測 | pane `translate3d(-144px, -55px)`、会場=目標 (差 0) |

統括担当の実測(1920×1080)でも、スクリーンショット/実クリックで描画が起きた時点で pane が `translate3d(-224px, -59px)`(= R/2, B/2)移動した。

### 3.2 原因と仮説(確度)

| ID | 内容 | 確度 |
| --- | --- | --- |
| H-A | 初期補正が「rAF → `document.fonts.ready` → rAF」の連鎖で、**描画が起きるまで適用されない**。描画が止まる環境(ブラウザペイン、バックグラウンドタブ、最小化・完全に隠れたウィンドウ)では補正が保留され、初回クリック等で描画が再開した瞬間に (R/2, B/2) だけ動く。Issue の「初回操作で一度だけずれる」の正体。 | **確定**(§3.1 で再現・数値一致) |
| H-B | 描画中の実ブラウザでも、補正は `document.fonts.ready` 解決後の次フレームまで待つ。Web フォント(Google Fonts)の取得が遅いと、補正前の地図が表示されてから (R/2, B/2) 動く。サーバー起動直後に Vite の初回変換でページ全体の読込が遅れる状況と重なりやすい。 | 中(コード読解のみ。実ブラウザでの発生タイミングは実挙動未確認) |
| H-C | 初期レイアウト確定後は `initial` でも `invalidateSize({pan:false})` のみ。確定後に時間カード高・右列幅・地図コンテナ寸法が変わると会場が可視矩形の中心から外れる。起動直後は、カタログ未取得の空カード(「利用可能な時刻はありません」、B=110 実測)からカタログ取得後の表示へ切り替わるときにカード高が変わる可能性がある。 | 中〜低(空カードの高さは実測。取得後の高さはブラウザペインではカタログ取得が止まるため**実測できず**、差の有無は実挙動未確認) |
| H-D | 地図コンテナ寸法の変化源。デスクトップではシェルの行が固定値(ヘッダー 48px、通知領域 96px、ツールバー行は地図画面で 0)で、起動後の変化源は見当たらない。iPad Safari は `100dvh` がアドレスバーの表示・非表示で変わりうる。 | 低(CSS 読解のみ、実挙動未確認) |

H-B・H-C・H-D は本設計の改修(§4)でまとめて解消する。H-A は自動テスト + ブラウザペインで、H-B〜H-D はオーナー確認(§6.3)で確かめる。

### 3.3 ナウキャストカードの高さ差の要因(改訂時の調査)

コード: `TimelineControlCard` は状態によらず「上段(サマリー行)・中段(スライダー行)・下段(操作ボタン行)」の 3 行を常に描画する。状態で変わるのは次の 3 箇所だけである。

| 箇所 | 空(`frames.length === 0`) | 配信後 | 高さへの影響 |
| --- | --- | --- | --- |
| 上段 `.timeline-frame-summary` | 空メッセージ(12px) | 実況/予報バッジ(16px + 上下 padding 2px)+ 時刻(20px、line-height 1.2) | 行は `min-height: 28px` で吸収 |
| 上段 `statusSlot` | ナウキャストは常にスピナー枠(16×16、非表示時も `visibility: hidden` で領域確保) | 同左 | なし |
| 中段 `.timeline-slider-row` | `.timeline-slider-empty`(高さ 6px) | `.timeline-slider-track-wrapper`(高さ 24px) | **18px の差** |
| 下段 操作ボタン | 4 ボタンを常に描画(disabled の有無のみ) | 同左 | なし |

読み込み中(`aria-busy`、スピナー)は上表の statusSlot のみ、エラー(カタログ未取得・失敗)は `emptyTimeline` にフォールバックするため空と同じ構造になる。カード幅は `width: 100%; max-width: min(24rem, 100%)` で内容に依存しない。

実測(2026-09-25、ブラウザペイン、`/hkeagh01`、`document.fonts.ready` 後。配信後の状態はペインではカタログ取得が止まるため、実カードを複製して上段・中段を配信後のマークアップに差し替えた要素を `.timeline-card-wrapper` に一時追加して計測し、計測後に除去した):

| ビューポート | 適用される CSS | カード幅 | 空(実カード) | 配信後(複製) | 上段(空/配信後) | 中段(空/配信後) | 下段 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1920×1080 | 既定 | 384 | 118 | 136 | 28 / 28(内容 19.5 / 27) | 6 / 24 | 38 |
| 1024×768 | `max-width: 1024px` | 384 | 110 | 128 | 28 / 28(内容 19.5 / 27) | 6 / 24 | 38 |
| 768×1024 | `max-width: 768px` も適用 | 348 | 110 | 128 | 28 / 28(内容 19.5 / 24.5) | 6 / 24 | 38 |

結論: 高さ差の要因は**中段(スライダー行)の 6px ↔ 24px だけ**で、全ブレークポイントで 18px。前回検収の 110 → 128 と一致する。上段は配信後の内容(最大 27px)も `min-height: 28px` に収まっている。

## 4. 設計

### 4.1 方針

- 補正の判定・実行を「同期関数 `sync()` 1 つ」にまとめ、次の契機で**同期的に**呼ぶ。どの契機も rAF・タイマーを使わない。
  1. レイアウト用 effect の本体(地図生成直後、右列/時間カード要素の差替え時)。`getBoundingClientRect()` は描画を待たずに強制レイアウトで実寸を返すため(§3.1)、hidden でも初期補正がこの時点で完了する。
  2. `document.fonts.ready` の解決時(Promise であり描画に依存しない。§3.1)。
  3. `ResizeObserver` の callback。通知は描画ステップのレイアウト後・ペイント前に届くため、callback 内で同期実行すれば補正前の状態が 1 フレームも表示されない。
- 合流処理: `ResizeObserver` は 1 回の描画ステップで変化したすべての要素を 1 回の callback にまとめて渡すため、callback ごとに `sync()` を 1 回だけ呼ぶ。これで従来の rAF 予約と同じく同一フレームの複数通知は 1 回の計算になる。rAF 予約は廃止する(確定事項1「維持してよい」の範囲内で、補正前フレームの表示をなくすため置き換える)。
- `sync()` 内の `invalidateSize`・`setView` は Leaflet の pane の transform と内部サイズだけを変え、観測対象 3 要素の寸法を変えないため、`ResizeObserver` のループは起きない(§6.2 P7 で確認)。
- 「初期レイアウト確定」の概念(`layoutSettledRef`)は廃止する。`initial` の間は常に補正する(確定事項2)。

### 4.2 状態ごとの動作(F1 §4.2 の表の改訂後)

| `placement` | 地図コンテナ幅または高さが 0 | それ以外 |
| --- | --- | --- |
| `initial` | 何もしない | `invalidateSize({pan:false})` → 最新の R/B で会場中心補正(ズーム 11) |
| `manual` | 何もしない | `invalidateSize({pan:false})` のみ(閲覧位置維持、従来どおり) |
| `returning` | 何もしない | `invalidateSize({pan:false})` → 会場中心補正 → `initial` へ戻す(従来どおり) |

- 右列・時間カード要素が未マウント(null)の場合は幅・高さを 0 として補正し、要素が渡された時点の再実行で正しい値に補正し直す(従来は R>0 かつ B>0 まで待っていたが、`initial` は毎回補正し直すため待つ必要がない)。
- `returnToVenue()`・ズーム操作・`dragstart`/`zoomstart` による状態遷移は変更しない。
- 補正は従来どおり `alignVenueCenter`(`calculateLeafletAdjustedCenter` + `setView(center, 11, {animate:false})`)を使う。`initial` 中はズームが常に 11 のため `zoomstart` は発火せず、`manual` へ遷移しない。R/B が変わらなければ移動量 0 で地図は動かない。

### 4.3 新規モジュール `apps/web/src/map/viewportLayoutSync.ts`

DOM・Leaflet に依存しない純粋モジュール。`MapViewport` から依存を注入して使い、テストはダミー依存で行う。

```ts
import type { ViewPlacement } from './types';

export interface ViewportLayoutMeasurement {
  readonly containerWidth: number;
  readonly containerHeight: number;
  readonly rightColumnWidth: number;
  readonly bottomCardHeight: number;
}

export type ViewportLayoutAction = 'skip' | 'resize-only' | 'align-venue';

/** §4.2 の表を返す純関数 */
export function decideViewportLayoutAction(
  placement: ViewPlacement,
  measurement: ViewportLayoutMeasurement,
): ViewportLayoutAction;

export interface ViewportLayoutSyncDependencies {
  measure(): ViewportLayoutMeasurement;
  getPlacement(): ViewPlacement;
  /** map.invalidateSize({ pan: false }) */
  invalidateSize(): void;
  /** measurement の R/B で会場を可視矩形の中心へ置く(ズーム 11、アニメーションなし) */
  alignVenue(measurement: ViewportLayoutMeasurement): void;
  /** returning で補正した後に呼ぶ(setPlacement('initial')) */
  onReturningAligned(): void;
}

export interface ViewportLayoutSync {
  /** 計測して §4.2 の動作を同期実行する。dispose 後は何もしない */
  sync(): void;
  dispose(): void;
}

export function createViewportLayoutSync(
  dependencies: ViewportLayoutSyncDependencies,
): ViewportLayoutSync;
```

`sync()` の手順: `measure()` → `decideViewportLayoutAction(getPlacement(), m)` → `skip` なら終了 → `invalidateSize()` → `align-venue` なら `alignVenue(m)`、さらに呼出し時の placement が `returning` なら `onReturningAligned()`。`requestAnimationFrame`・`setTimeout` を使わない。

### 4.4 `MapViewport.tsx` の変更

- `layoutSettledRef`・`scheduledRafRef` と、`requestAnimationFrame`/`cancelAnimationFrame` の使用をすべて削除する。
- `alignVenueCenter` は R/B を引数でも受け取れるようにする(省略時は従来どおり `getCurrentOffsets()` で計測。`returnToVenue` はそのまま使う)。
- 「ResizeObserver と中心補正・閲覧位置維持」の effect を次の構成にする(effect の種類は `useEffect` のまま、依存配列は従来どおり)。

```text
container・map が無ければ return
layoutSync = createViewportLayoutSync({
  measure: container.getBoundingClientRect() と getCurrentOffsets() から組み立て,
  getPlacement: () => placementRef.current,
  invalidateSize: () => map.invalidateSize({ pan: false }),
  alignVenue: (m) => alignVenueCenter(map, INITIAL_ZOOM, false, m.rightColumnWidth, m.bottomCardHeight),
  onReturningAligned: () => setPlacement('initial'),
})
resizeObserver = new ResizeObserver(() => layoutSync.sync())  // callback 1 回につき 1 回
getObservedLayoutElements(...) を observe
layoutSync.sync()                                             // 同期の初回計測・補正
document.fonts?.ready.then(() => layoutSync.sync()).catch(() => {})  // 未定義環境ではスキップ
cleanup: layoutSync.dispose(); resizeObserver.disconnect();
```

- `mapViewportConfiguration` に追加の公開は不要(テストは `viewportLayoutSync.ts` を直接 import する)。
- JSDoc/コメントの `§4.2` 参照は改訂後の内容に合わせる。

### 4.5 F1 設計書の改訂(製造担当が同じコミット群で行う)

`docs/design/issue-44-47-49-map-foundation-controls.md` を次のとおり改訂する。改訂箇所の直後に「(Issue #212 で改訂。詳細は [issue-212-map-initial-center-shift.md](issue-212-map-initial-center-shift.md))」と注記する。

1. §4.2 第 2 段落「各 observer callback は同期で `setView` を呼ばず、`requestAnimationFrame` に一つだけ再計算を予約する。…」を、「初回計測は effect 内と `document.fonts.ready` 解決時に同期で行い、描画フレームに依存しない。observer callback は 1 回の通知につき 1 回だけ同期で再計算する(同一フレームの複数通知は 1 回の callback にまとまる)。地図コンテナ寸法の変化には先に `map.invalidateSize({ pan: false })` を行い、その後 `initial`/`returning` の場合だけ補正中心をセットする。アンマウント時は observer を解除する。」へ置き換える。
2. §4.2 の表の「右列／時間カードのサイズ変化、ウィンドウリサイズ」行を「`initial`(未操作)の間は毎回、最新の実寸で可視矩形へ会場を再配置。`manual` では `invalidateSize` のみ(閲覧位置維持)」へ置き換える。
3. 表の下の段落「初期レイアウトが『未確定』かは、…確定とする。」を削除し、「右列が一時的に未マウントの場合は幅 0 とせず、slot を常設して測る。」の文だけ残す。
4. §9.2 の「初期レイアウト計測中にカード高・右列幅が変わっても、フォント適用後に可視矩形の中心へ収束する。」を「未操作の間にカード高・右列幅・地図コンテナ寸法が変わっても、そのたびに可視矩形の中心へ収束する。」へ置き換える(チェックボックスは未チェックのまま)。

### 4.6 他設計書との整合【確定】

F3設計書は「レイヤー切替で地図中心(lat/lng)・ズームを変えない」(§6 末尾の説明、§11.3 の 803 行目付近の受け入れ条件)と定めている。§6 末尾の説明は、確定後は `invalidateSize` のみという**現行 F1 実装を前提に**「地図の地理的中心は動かない」と書いている。

初版では、確定事項2に従い「`initial` 中のレイヤー切替によるカード高変化も再補正し、背景地図が ΔB/2 動く」ことを【確定】としていた。統括担当の実測でナウキャスト(空)118px とキキクル(大雨)54px の差によりピンが約 32px 動くことが判明し、UI 監修の指摘を受けて次のとおり改訂した。

- 【確定】(2026-09-25 改訂、§2.3 B) 下端基準 B はレイヤーに関わらずナウキャストカードの高さとし、レイヤー切替では B が変わらない(§4.8)。`initial` 中は従来どおりレイアウト変化のたびに `sync()` で再補正するが、レイヤー切替では R/B/コンテナ寸法がどれも変わらないため移動量 0 で、**ピンも背景地図(lat/lng)も動かない**。
- これにより F3 設計書の「レイヤー切替で地図中心(lat/lng)・ズームを変えない」(§6 末尾、§11.3)と本 Issue の実装は整合する。F3 §6 末尾の説明が前提にしている「確定後は `invalidateSize` のみ」という理由付けは古くなるが、結論(レイヤー切替で中心が動かない)は変わらないため、F3 設計書は本 Issue でも改訂しない。
- `manual` 時は従来どおり動かない(F3 §11.3 の「ドラッグ後に切替を挟んでも戻らない」は維持)。

### 4.7 ナウキャストカードの高さを全状態で揃える(§2.3 A)

§3.3 のとおり、差は中段のスライダー行だけである。`apps/web/src/map/map.css` の `.timeline-slider-row` に次を追加する(CSS のみ。`TimelineControlCard.tsx` のマークアップは変えない)。

```css
.timeline-slider-row {
  /* 既存の position / display / flex-direction / gap は維持 */
  min-height: 24px; /* .timeline-slider-track-wrapper の height と同値。空状態でも配信後と同じ高さを確保する */
  justify-content: center; /* 空状態の 6px バーを、配信後のトラックと同じ縦位置(行の中央)に置く */
}
```

- 配信後は子の `.timeline-slider-track-wrapper`(24px)と同じ高さなので見た目は変わらない。空状態はバーが行の中央に来て、カード全体が配信後と同じ高さになる(1920×1080 で 118 → 136、1024×768・768×1024 で 110 → 128 の見込み)。
- 24px は `.timeline-slider-track-wrapper` と `.timeline-slider` の `height: 24px` と同じ値にする。変数化はしない(3 箇所が隣接しているため。値を変えるときは 3 箇所を揃える旨をコメントに残す)。
- 上段は既存の `min-height: 28px` で配信後の内容(実測最大 27px)を吸収できているため変更しない。フォントの違いで 28px を超える可能性は §8 に残留リスクとして記す。
- `max-width: 1024px`・`max-width: 768px` のメディアクエリは `.timeline-slider-row` を上書きしていないため、追加の対応は不要。

### 4.8 下端基準 B をナウキャストカードの高さに統一する(§2.3 B)

方式: `WeatherMapView` の `.timeline-card-wrapper` 内に、**空の `TimelineControlCard` を不可視で常設した高さ基準要素**を置き、これを `MapViewport` の `bottomCardElement` として渡す。表示中のカード(ナウキャスト/キキクル)には ref を渡さない。

```tsx
{/* 3. 下部中央時間操作カード (F4) */}
<div className="timeline-card-wrapper" aria-busy={...}>
  {isKikikuru ? <KikikuruStatusCard ... /> : <TimelineControlCard ... />}   {/* ref={setBottomCardRef} を外す */}
  {/* 中心補正の下端基準 B (Issue #212 §4.8)。レイヤーに関わらずナウキャストカードの高さを測る */}
  <div ref={setBottomCardRef} className="timeline-card-height-reference" aria-hidden="true" inert>
    <TimelineControlCard viewModel={emptyTimeline} onIntent={noopTimelineIntent} />
  </div>
</div>
```

```css
/* 中心補正の下端基準 B を測るための不可視のナウキャストカード (Issue #212 §4.8) */
.timeline-card-height-reference {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: center;
  visibility: hidden;
  pointer-events: none;
}
```

- 実カードと同じ親(`.timeline-card-wrapper`、`position: absolute`)の中に、左右 0 で絶対配置するため、内側のカードの幅(`width: 100%; max-width: min(24rem, 100%)`)と適用されるメディアクエリが実カードと一致する。§4.7 によりナウキャストカードの高さは状態に依存しないので、空の基準要素の高さ = 表示中のナウキャストカードの高さ(全状態・全ブレークポイント)になる。
- 絶対配置のため `.timeline-card-wrapper` の高さ・実カードの位置に影響しない。`visibility: hidden` でクリックも受けない。`aria-hidden="true"` と `inert` で支援技術・Tab フォーカスから外す(React 19 は `inert` を boolean 属性として出力する)。
- `statusSlot` は渡さない(§3.3 のとおり上段の高さに影響しないため)。`noopTimelineIntent` は `WeatherMapView.tsx` のモジュールスコープに `() => {}` として置く(名前は任意)。
- DOM 上は実カードの**後**に置く(既存テスト `weatherMapView.test.ts` のフォーカス順検証が `indexOf('class="timeline-control-card nowcast-timeline-card"')` で最初の出現を使うため)。
- 既存テストへの影響: `kikikuruMapIntegration.test.ts` の「キキクル表示中は簡易カードだけを表示し、時間操作と廃止した注記を描画しないこと」(203〜207 行)は `WeatherMapView` の HTML 全体に `timeline-slider`・`aria-label="戻る"` 等が**含まれない**ことを検証しており、基準要素(空のナウキャストカード)を常設すると失敗する。このテストは「画面に見える時間操作が無い」ことの検証なので、同ファイルの禁止語テストが右側情報列を除外している方式に合わせ、判定前に基準要素を除去する(`html.replace(/<div[^>]*class="timeline-card-height-reference"[^>]*>[\s\S]*?<\/section><\/div>/, '')`。基準要素の内側の `section` は 1 つだけなので最短一致で切り出せる)。除去の理由(不可視・`aria-hidden`・`inert` の高さ基準であり、利用者には見えない)をコメントに書く。アサーション自体は弱めない。同ファイルの他のテスト(状態注記スロット数、禁止語)は基準要素に `statusSlot` も禁止語も無いため影響しない。
- `MapViewport.tsx`・`viewportLayoutSync.ts` は変更しない。`bottomCardElement` がレイヤー切替で差し替わらなくなるため、`MapViewport` のレイアウト effect はレイヤー切替で再実行されず、基準要素の寸法も変わらないので `ResizeObserver` も通知しない。

各状態での挙動:

| 状況 | B の値 | 結果 |
| --- | --- | --- |
| 読込直後(ナウキャスト、配信前) | 基準要素の高さ(= 配信後のナウキャストカード高) | 配信後の領域を基準に会場を初期配置 |
| ナウキャストのカタログ取得・時刻配信 | 変化なし | ピンは動かない |
| `initial` でレイヤー切替(ナウキャスト↔キキクル) | 変化なし | 再補正は走らないか走っても移動量 0。ピン・背景地図とも動かない |
| キキクル表示中の `initial` | ナウキャストカード高 | 会場は、キキクルカード(低い)を控除した実際の可視矩形の中心より (B − キキクルカード高)/2 だけ上に置かれる(1920×1080 で約 (136 − 54)/2 = 41px の見込み)。§2.3 B で許容された F1 実寸補正原則の例外 |
| キキクル表示中のリサイズ・ブレークポイント跨ぎ(`initial`) | 基準要素が再計測され `ResizeObserver` が通知 | 新しいナウキャストカード高で再補正(キキクル表示中でも正しい B が得られる) |
| `manual` | 変化なし(使われない) | 従来どおり `invalidateSize` のみ。レイヤー切替・リサイズで閲覧位置を維持 |
| `returning`(会場復帰ボタン) | `getCurrentOffsets()` が基準要素を測る | キキクル表示中に押しても、ナウキャストカード高で補正した位置へ戻る。その後ナウキャストへ切り替えてもピンは動かない |

不採用案:

- 最後に計測したナウキャストカード高をキャッシュしてキキクル中に使う: キキクル表示中のブレークポイント跨ぎで値が古くなる。キキクル表示状態で読み込まれる経路が将来できた場合に値が無い。
- 実のナウキャストカードをキキクル中も `visibility: hidden` で残す: 再生・ポーリング等の状態を持つ実カードを隠して生かすことになり、F3 の「ナウキャストとキキクルの間では画像を引き継がない」構成に波及する。
- 固定寸法(CSS 変数)をカードと基準で共有する: 上段・下段の高さはフォント・折返しで決まっており、固定値にすると実カードとの一致を保証できない。

### 4.9 F1 設計書への追記(製造担当が同じコミット群で行う)

§4.5 の改訂に加え、`docs/design/issue-44-47-49-map-foundation-controls.md` に次を追記する。追記箇所の直後に §4.5 と同じ注記を付ける。

1. §4.1 の「時間カードは下部中央だが、可視矩形ではその**高さ全体**を差し引く。…」の段落の末尾に、「B は表示中のレイヤーに関わらず、ナウキャストの時間操作カードの高さとする。キキクル表示中は簡易カードが低いが、ナウキャストカードの高さで控除する(レイヤー切替・時刻配信で会場位置を動かさないための実寸補正の例外)。高さは不可視の高さ基準要素で測る。」を加える。
2. §9.2 の「時間カードが右列を除く地図領域の下部中央に常設され、実測高さが中心補正に渡る。」を「時間カードが右列を除く地図領域の下部中央に常設され、ナウキャストカードの高さ(高さ基準要素の実測値)が表示中レイヤーに関わらず中心補正に渡る。」へ置き換える(チェックボックスは未チェックのまま)。

## 5. 変更ファイル一覧

| ファイル | 変更 |
| --- | --- |
| `apps/web/src/map/viewportLayoutSync.ts` | 新規(§4.3)。改訂では変更しない |
| `apps/web/src/map/MapViewport.tsx` | §4.4。改訂では変更しない |
| `apps/web/tests/viewportLayoutSync.test.ts` | 新規(§6.1)。改訂では変更しない |
| `docs/design/issue-44-47-49-map-foundation-controls.md` | §4.5、(改訂)§4.9 |
| `apps/web/src/map/map.css` | (改訂)§4.7・§4.8 |
| `apps/web/src/map/WeatherMapView.tsx` | (改訂)§4.8 |
| `apps/web/tests/weatherMapView.test.ts` | (改訂)§6.4 の自動テストを追加 |
| `apps/web/tests/kikikuruMapIntegration.test.ts` | (改訂)§4.8 のとおり、時間操作非表示テストの判定前に基準要素を除去する |

上記以外(`TimelineControlCard.tsx`、`KikikuruStatusCard.tsx`、`projection.ts`、他設計書、上記以外の既存テスト)は変更しない。

## 6. 受け入れ条件

改訂後の検収範囲: §6.1〜6.2 は初版の検収で全項目合格済み。改訂後は **§6.4 の追加分**と、§6.2 のうち **P1・P3・P5・P7・P8・共通**を回帰として再実行する(式 M の B は改訂後の定義を使う。P8 の変更ファイル一覧は改訂後の §5 と照合する)。§6.1 は `npm run test -w apps/web` に含まれるため個別の再実行は不要。

### 6.1 自動テスト(`apps/web/tests/viewportLayoutSync.test.ts`)

各項目を独立した `test()` とし、ダミー依存で呼出し記録を取る。

- [ ] T1: `initial` + 正の寸法で `sync()` を 1 回呼ぶと、`invalidateSize` → `alignVenue` の順に 1 回ずつ呼ばれ、`alignVenue` に渡る R/B が `measure()` の値と一致する。
- [ ] T2(確定事項2の本体): `initial` のまま B を 110 → 150、R を 288 → 320 と変えて `sync()` を計 3 回呼ぶと、`alignVenue` が 3 回呼ばれ、各回の R/B がその時点の計測値である(「確定後は補正しない」挙動が残っていれば失敗する)。
- [ ] T3: `manual` では `invalidateSize` だけが呼ばれ、`alignVenue`・`onReturningAligned` は呼ばれない。
- [ ] T4: `returning` では `invalidateSize` → `alignVenue` → `onReturningAligned` の順に 1 回ずつ呼ばれる。
- [ ] T5: 地図コンテナ幅 0 または高さ 0 の場合、どの依存も呼ばれない(`measure` を除く)。R=0・B=0 かつコンテナ正の場合は `initial` で `alignVenue` が呼ばれる。
- [ ] T6: `dispose()` 後の `sync()` では `measure` を含めどの依存も呼ばれない。
- [ ] T7(確定事項1): `globalThis.requestAnimationFrame` と `window.requestAnimationFrame` を呼ばれたら記録して何もしない関数へ差し替えた状態で `sync()` を呼ぶと、戻り値を返した時点で `alignVenue` が呼ばれ済みで、rAF の呼出し記録が 0 件。差し替えはテスト終了時に元へ戻す。
- [ ] `decideViewportLayoutAction` の 3 状態 × (コンテナ 0 / 正) の 6 通りが §4.2 の表と一致する。
- [ ] テストの有効性: T2 を、`alignVenue` を初回だけ呼ぶよう一時改変した実装に対して実行すると失敗することを検収担当が確認し、改変を戻す。

### 6.2 静的確認・ブラウザペイン

共通: ブラウザペインで `http://localhost:5174/hkeagh01` を開く(稼働中サーバーを使う。devサーバーの起動・停止は業務標準に従う)。ペインは `visibilityState=hidden` のまま動作する([C-01](../rules/advisory/C-01-browser-pane-visibility-limit.md))。計測は `javascript_tool` で次の式 M を評価する(会場マーカーは `iconAnchor [14,36]` のため、要素矩形の左上 + (14, 36) が会場の画面位置)。

```js
const c = document.querySelector('.map-viewport').getBoundingClientRect();
const m = document.querySelector('.wx-venue-marker-container').getBoundingClientRect();
const R = document.querySelector('.map-information-column-slot').getBoundingClientRect().width;
// 改訂後の B は高さ基準要素(§4.8)。改訂前のコードでは要素が無いため表示中カードで代用する
const B = (document.querySelector('.timeline-card-height-reference')
  ?? document.querySelector('.timeline-card-wrapper > .timeline-control-card')).getBoundingClientRect().height;
({ vx: m.left + 14 - c.left, vy: m.top + 36 - c.top,
   dx: m.left + 14 - c.left - (c.width - R) / 2, dy: m.top + 36 - c.top - (c.height - B) / 2,
   R, B, W: c.width, H: c.height,
   pane: document.querySelector('.leaflet-map-pane').style.transform,
   vis: document.visibilityState });
```

- [ ] P0: `grep -n "requestAnimationFrame\|layoutSettledRef\|scheduledRafRef" apps/web/src/map/MapViewport.tsx apps/web/src/map/viewportLayoutSync.ts` が 0 件。
- [ ] P1(H-A の解消、確定事項1): ペインサイズ既定(1024×768)で読込後、スクリーンショット・クリックを一切行わずに `javascript_tool` 内で 3 秒待ってから M を評価する。`vis` が `hidden` かつ `|dx| ≤ 2`・`|dy| ≤ 2`。(修正前は同条件で dx=+144, dy=+55 を実測済み。)
- [ ] P2(初回クリック): 再読込ごとに次の 3 通りを行う。①ヘッダーの非操作部分、②地図の空き領域(右列・カード・左下操作群・凡例を避けた位置)、③右列カードの非操作部分を `computer` の `left_click` で 1 回クリックする。クリック前後の M で `pane` と `vx`/`vy` が一致(±1 px)し、クリック後も `|dx| ≤ 2`・`|dy| ≤ 2`。
- [ ] P3(未操作時の確定後レイアウト変化、確定事項2): 読込後にクリック・ドラッグせず、次を 1 つずつ行い、毎回スクリーンショットを 1 回撮って描画を起こしてから M を評価する。いずれも `|dx| ≤ 2`・`|dy| ≤ 2`、かつ R/B/W/H が意図どおり変化している。①時間カード要素(改訂後は高さ基準要素の内側のカード `.timeline-card-height-reference .timeline-control-card`。P4・P5 の「時間カード `minHeight`」も同じ)に `style.minHeight = (B + 40) + 'px'` を設定、②`.weather-map-view` に `--wx-map-right-column-width: 22rem` を設定、③`resize_window` で 1280×800 に変更。終了後 `resize_window` の `desktop` で戻し、再読込する。
- [ ] P4(`manual` 回帰): 読込後に地図の空き領域を `left_click_drag` で右へ 100 px・下へ 50 px ドラッグし、M を記録する(`dx` ≈ +100)。①時間カード `minHeight` を +40 px → スクリーンショット → M の `vx`/`vy` がドラッグ直後と ±1 px 以内(`invalidateSize({pan:false})` のみで地図が動かない)。②`resize_window` 1280×800 → スクリーンショット → `|dx| ≥ 50`(会場へ強制復帰していない)。
- [ ] P5(`returning` 回帰): P4 の後に「会場の初期位置に戻る」ボタンを押す → M で `|dx| ≤ 2`・`|dy| ≤ 2`。続けて時間カード `minHeight` をさらに +40 px → スクリーンショット → `|dx| ≤ 2`・`|dy| ≤ 2`(復帰後は `initial` として追従する)。
- [ ] P6(寸法別の初期中心、F1 回帰): `resize_window` で 1920×1080、1366×768、1194×834 の各サイズにして再読込し、P1 と同じ手順で `|dx| ≤ 2`・`|dy| ≤ 2`。各サイズの W/H/R/B を報告に記録する。`htrcph01` でも 1024×768 で P1 を行う。
- [ ] P7: P1〜P6 の間、`read_console_messages` に `ResizeObserver loop` を含むメッセージおよび未捕捉例外が無い。
- [ ] P8: F1 設計書が §4.5 の 4 点どおり改訂され、Issue #212 の注記がある。`git diff --stat origin/main` の変更ファイルが §5 の一覧と一致する。
- [ ] 共通: `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/web` がすべて成功する。

ブラウザペインの寸法は `resize_window` によるエミュレーション(縮小表示あり)であり、実機の見え方の代わりにはならない。

### 6.3 オーナー確認観点(C-02 逆発注、検収の合否対象外)

検収担当は次を逆発注シートにまとめる。いずれも「合格/不合格/判断保留」で回答を受ける。

1. FHD(1920×1080)・HD(1366×768 または 1280×720)の実ブラウザで `/hkeagh01` を開いたとき、地図が表示された後に会場ピンが一度動く様子が見えるか。1 回目のクリックで地図が動いたら不合格。
2. サーバー起動直後(`npm run dev` 直後の初回表示)と、ブラウザを別ウィンドウの背後に置いた状態・バックグラウンドタブで読み込んでから前面に出した場合で、1 と同じ確認をする(H-A・H-B)。
3. (改訂)起動直後にナウキャストのカタログが「利用可能な時刻はありません」から時刻表示へ切り替わったとき、①会場ピンも背景地図も動かないか、②時間カードの外形(上端の位置・高さ)が変わらないか、③空状態のスライダーのバーが配信後のスライダーと同じ縦位置に見えるか(H-C、§4.7)。FHD・HD・iPad 11 インチ横のそれぞれで確認する。
4. iPad 11 インチ横の Safari で、読込直後・アドレスバーの表示/非表示の切替後に会場ピンが可視矩形の中心にあるか(H-D)。
5. (改訂)未操作のままナウキャスト↔キキクル(大雨・浸水・土砂)を切り替えたとき、会場ピンも背景地図も動かないか。キキクル表示中は会場がキキクルカード上端までの領域の中心より少し上(FHD で約 40px)に見えることを許容範囲として確認する(§2.3 B)。
6. (改訂)ドラッグ後(`manual`)にキキクルへ切り替え、「会場の初期位置に戻る」を押した後にナウキャストへ戻したとき、ピンが動かないか(§4.8 の `returning` 行)。

### 6.4 改訂分(UI 監修対応、§2.3)

配信後のナウキャストカードはブラウザペインでは表示できない(カタログ取得が `visibilityState` で止まる)。そのため高さの一致は、§3.3 と同じ「実カードを複製し配信後のマークアップに差し替えた要素」との比較で代替し、実データでの見え方は §6.3-3 に回す。

自動テスト(`apps/web/tests/weatherMapView.test.ts` に追加、`renderToStaticMarkup`):

- [ ] U1: 既定(ナウキャスト)で描画した HTML に `class="timeline-card-height-reference"` がちょうど 1 回現れ、その開始タグに `aria-hidden="true"` と `inert=""` がある。基準要素の内側に `timeline-control-card nowcast-timeline-card` と `timeline-slider-empty` がある。表示中カード(`class="timeline-control-card nowcast-timeline-card"` の最初の出現)が基準要素より前にある。
- [ ] U2: `selectedLayerId: 'kikikuru-heavyrain'` で描画しても基準要素が 1 回現れ、その内側に `nowcast-timeline-card` がある。`kikikuru-status-card` が基準要素より前にある。
- [ ] U3: `kikikuruMapIntegration.test.ts` の時間操作非表示テストが §4.8 の除去後の HTML で判定しており、アサーション(`timeline-slider`・4 ボタンの `aria-label` が無いこと)が変更されていない(`git diff` で確認)。

静的確認:

- [ ] S1: `apps/web/src/map/map.css` の `.timeline-slider-row` に `min-height: 24px` と `justify-content: center` があり、`.timeline-slider-track-wrapper` の `height: 24px` と値が一致する。`.timeline-card-height-reference` が §4.8 の宣言(絶対配置・左右下 0・`visibility: hidden`・`pointer-events: none`)を持つ。
- [ ] S2: `grep -n "setBottomCardRef" apps/web/src/map/WeatherMapView.tsx` で、`ref={setBottomCardRef}` は基準要素の 1 箇所だけ(`KikikuruStatusCard`・表示中の `TimelineControlCard` には無い)。
- [ ] S3: `git diff b56af15 -- apps/web/src/map/MapViewport.tsx apps/web/src/map/viewportLayoutSync.ts apps/web/src/map/TimelineControlCard.tsx apps/web/src/map/kikikuru/KikikuruStatusCard.tsx` が空。

ブラウザペイン(共通手順は §6.2。M は改訂後の B を使う):

次の式 Q を「カード高比較」に使う。表示中のナウキャストカード(空)を複製し、上段・中段を配信後のマークアップに差し替えて一時追加・計測・除去する。

```js
await document.fonts.ready;
const wrap = document.querySelector('.timeline-card-wrapper');
const real = wrap.querySelector(':scope > .nowcast-timeline-card');
const ref = document.querySelector('.timeline-card-height-reference');
const c = real.cloneNode(true);
c.style.position = 'absolute'; c.style.bottom = '0'; c.style.visibility = 'hidden';
c.querySelector('.timeline-frame-summary').innerHTML =
  '<span class="timeline-kind-badge kind-observed">実況</span><span class="timeline-selected-time">09/25 10:30</span>'
  + '<div class="timeline-status-slot"><div style="display:inline-flex;width:16px;height:16px"></div></div>';
c.querySelector('.timeline-slider-row').innerHTML =
  '<div class="timeline-slider-track-wrapper"><input type="range" class="timeline-slider" min="0" max="5" value="2">'
  + '<div class="timeline-track-segments"><div class="timeline-segment segment-observed"></div></div></div>';
wrap.appendChild(c);
const pop = c.getBoundingClientRect().height;
c.remove();
({ vw: innerWidth, empty: real.getBoundingClientRect().height, pop, ref: ref.getBoundingClientRect().height,
   refVisibility: getComputedStyle(ref).visibility });
```

- [ ] Q1(§2.3 A、全ブレークポイント): `resize_window` で 1920×1080、1194×834、1024×768、768×1024 の各サイズにして `/hkeagh01` を再読込し、Q を評価する。各サイズで `empty`・`pop`・`ref` が互いに ±0.5 px 以内で一致し、`refVisibility` が `hidden`。各値を報告に記録する(見込み: 136 / 136 / 128 / 128)。改訂前は同じ計測で `empty` が `pop` より 18px 小さいことを §3.3 で実測済み(判別力の根拠)。
- [ ] Q2(§2.3 B、未操作のレイヤー切替): 1920×1080 で再読込し、スクリーンショット・クリックをせずに 3 秒待って M を記録する(`|dx| ≤ 2`・`|dy| ≤ 2`)。`find` で「表示レイヤーを選択」を探して `left_click` し、メニューの「キキクル（大雨）」を `left_click`、スクリーンショットを 1 回撮ってから M を評価する。`pane`・`vx`・`vy`・`B` が切替前と ±1 px 以内で一致する。あわせて `document.querySelector('.kikikuru-status-card').getBoundingClientRect().height`(Bk)と、実際の可視矩形に対するずれ `vy − (H − Bk)/2`(負 = 上、見込み約 −41)を記録する。続けて「雨雲ナウキャスト」へ戻し、同じく切替前と ±1 px 以内。1024×768 でも同じ手順を行う。(改訂前は同条件でピンが約 32px 動くことを統括担当が実測済み。)
- [ ] Q3(キキクル表示中のリサイズ、`initial`): 1920×1080 でキキクル(大雨)に切り替えた状態から、`resize_window` で 1024×768 に変更 → スクリーンショット → M で `|dx| ≤ 2`・`|dy| ≤ 2`、かつ `B` が 1920×1080 時の値から Q1 の 1024×768 の値へ変わっている(基準要素がキキクル表示中もブレークポイントに追従する)。
- [ ] Q4(`manual` 回帰): 1920×1080 で再読込し、地図の空き領域を `left_click_drag` で右へ 100 px・下へ 50 px ドラッグして M を記録する。キキクル(大雨)へ切替 → スクリーンショット → `vx`/`vy` がドラッグ直後と ±1 px 以内。ナウキャストへ戻しても同じ。
- [ ] Q5(`returning`): Q4 の後にキキクル(大雨)へ切り替え、「会場の初期位置に戻る」を押す → スクリーンショット → M で `|dx| ≤ 2`・`|dy| ≤ 2`。続けてナウキャストへ切替 → スクリーンショット → `vx`/`vy` が ±1 px 以内で変わらない。
- [ ] Q6(アクセシビリティ): ナウキャスト表示中に `read_page`(`filter: interactive`)で「再生」ボタンがちょうど 1 つ、キキクル表示中は 0 個。`javascript_tool` で `[...document.querySelectorAll('.timeline-card-height-reference button')].every(b => b.closest('[inert]') && b.closest('[aria-hidden="true"]'))` が `true`。
- [ ] Q7: Q1〜Q6 の間、`read_console_messages` に `ResizeObserver loop` を含むメッセージおよび未捕捉例外が無い。終了後 `resize_window` の `desktop` で戻す。
- [ ] F1 設計書が §4.9 の 2 点どおり追記され、Issue #212 の注記がある。

## 7. 後続への引き継ぎ

- `MapViewport` の中心補正は `viewportLayoutSync.ts` の `sync()` に一本化された。後続で補正契機を追加する場合は `sync()` を同期で呼ぶ。rAF・タイマーで遅延させると、描画が止まる環境で本 Issue の不具合が再発する。
- `initial` は「未操作」を意味し、レイアウトが変わるたびに会場を可視矩形の中心へ置き直す。後続の機能が `initial` のまま地図中心を意図的に動かす場合は、先に `placement` を変える必要がある。
- (改訂)中心補正の下端基準 B は `.timeline-card-height-reference`(空のナウキャストカードを不可視で常設)の高さである。後続でナウキャストカードの行構成・余白を変える場合は、全状態で高さが一致すること(§4.7)を保つ。状態によって高さが変わる要素を足すと、基準要素(常に空)と実カードの高さがずれ、会場が可視矩形の中心から外れる。
- (改訂)キキクル表示中は B がキキクルカードの実高より大きく、会場は実際の可視矩形の中心より上に置かれる(§2.3 B の例外)。F1 §4.1 に追記済み(§4.9)。
- (改訂)F3 設計書の「レイヤー切替で lat/lng が変わらない」は §4.8 により実装と整合したため、改訂は不要になった。F3 §6 末尾の理由付け(確定後は `invalidateSize` のみ)は古いが、結論は変わらない。

## 8. 実挙動未確認の箇所・残留リスク

- H-B(フォント待ちによる実ブラウザでの遅延)、H-C(カタログ取得前後のカード高差)、H-D(iPad の `dvh` 変化)は実挙動未確認。§6.3 で確認する。H-C は改訂(§4.7・§4.8)で要因(スライダー行 6px ↔ 24px)を特定・解消したが、実データでの配信後表示は実挙動未確認(§6.3-3)。
- (改訂)上段(サマリー行)は `min-height: 28px` に対し配信後の内容が Chromium 実測で最大 27px と余裕が 1px しかない。iPad Safari 等でフォントの行高が大きいと 28px を超え、配信前後で高さがずれる可能性がある(実挙動未確認、§6.3-3 で確認)。ずれた場合は上段にも固定の高さを与える追加対応が必要になる。
- (改訂)§3.3・§6.4 Q1 の「配信後」の高さは複製マークアップによる計測であり、実データのフレーム数・再生中アイコン等での実測ではない。操作ボタン行は状態によらず同じボタンを描画するため差は出ない見込み。
- (改訂)基準要素は非表示の DOM(ボタン 4 個を含む)を 1 つ常設する。`inert`・`aria-hidden` で操作・読み上げの対象外にするが、DOM 全体を文字列で検査する既存・後続のテストは基準要素を考慮する必要がある(§4.8 の `kikikuruMapIntegration.test.ts` の扱いを参照)。
- `sync()` を `useEffect` 内で呼ぶため、実ブラウザで「補正前の地図が 1 フレーム描画される」かどうかは React の effect 実行タイミングに依存し、実挙動未確認。地図本体も同じ `useEffect` で生成されるため、生成と補正は同一タスク内で行われる見込み(§6.3-1 で確認)。
- hidden のまま(描画が一度も起きないまま)レイアウトが変わった場合は `ResizeObserver` が届かず、次の描画時(ペイント前)に補正される。地図の状態を JavaScript だけで読む検証では、この間は補正前の値が見える。
- ウィンドウリサイズ時は Leaflet 自身の `trackResize`(rAF で `invalidateSize({pan:true})`)が先に動く。`initial` では直後の `sync()` が補正し直すため結果は変わらない。`manual` の挙動は従来どおり(変更しない)。
