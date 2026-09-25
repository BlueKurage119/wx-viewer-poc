# Issue #212 地図の初回操作時に表示中心が一度だけずれる

作成日: 2026-09-25  
対象 Issue: #212  
関連: #44 (F1、[issue-44-47-49-map-foundation-controls.md](issue-44-47-49-map-foundation-controls.md) §4.1〜4.2・§9.2)、#52 (G1、[issue-52-info-panel-layout.md](issue-52-info-panel-layout.md) AC-7)、#46 (F3、[issue-46-kikikuru-layer-switching.md](issue-46-kikikuru-layer-switching.md) §11.3)

## 1. 目的と範囲

気象情報画面で、読み込み後の初回クリックなどを契機に地図の表示中心が一度だけ動く不具合を直す。原因は、F1の初期中心補正が `requestAnimationFrame`(描画フレーム)に依存しており、描画が起きるまで補正が適用されないことである(§3)。あわせて、初期レイアウト確定後のレイアウト変化で会場が可視矩形の中心から外れる問題も直す。

範囲内:

- `apps/web/src/map/MapViewport.tsx` の中心補正・リサイズ追従処理の改修
- 判定・実行ロジックを DOM 非依存の純粋モジュールへ切り出し、自動テストを追加する
- F1設計書 §4.2(表と本文)・§9.2 の該当箇所の改訂(本Issueで改訂した旨を注記)

範囲外:

- 会場切替時の `placement` の扱い、ズーム操作、会場復帰ボタンの UI
- Leaflet 自身のウィンドウリサイズ処理(`trackResize`)の変更
- 右列・時間カードの寸法や CSS の変更

## 2. 参照資料と確定事項

### 2.1 参照資料

- `apps/web/src/map/MapViewport.tsx`(現行実装。rAF 予約・`layoutSettledRef`・`document.fonts.ready` 後の rAF で初期補正)
- `apps/web/src/map/WeatherMapView.tsx`(右列 slot・時間カードを callback ref + state で `MapViewport` へ渡す。時間カードはナウキャスト時 `TimelineControlCard`、キキクル時 `KikikuruStatusCard` に差し替わり、どちらもクラス `timeline-control-card` を持つ)
- `apps/web/src/map/projection.ts`(`calculateLeafletAdjustedCenter`。変更しない)
- `apps/web/src/map/tiles/useTileCatalogPolling.ts`(カタログ取得は `visibilityState` でゲートされる)
- `apps/web/tests/setupEnv.ts`・`apps/web/tests/kikikuruMapIntegration.test.ts`(テストは `node --test` + ダミー `window` で DOM なし)
- F1設計書 §4.1〜4.2・§9.2、G1設計書 AC-7、F3設計書 §6 末尾(「地図中心の補正 (F1) への影響」)・§11.3
- [C-01-browser-pane-visibility-limit.md](../rules/advisory/C-01-browser-pane-visibility-limit.md)、[C-02-ui-verification-backorder.md](../rules/advisory/C-02-ui-verification-backorder.md)
- Leaflet 1.9 の `setView`/`invalidateSize` の挙動(`setView(..., {animate:false})` は移動量が地図サイズ内なら `panBy` で即時に移動し、タイルを破棄しない)

### 2.2 ヒアリングで確定した事項【確定】

1. 初期中心補正を rAF に依存させず、寸法が計測可能になった時点で適用する。`ResizeObserver` の通知も描画ステップ依存である点に留意し、ブラウザペイン(hidden)でも初期補正が完了する設計にする。リサイズ追従の合流処理は維持してよい。
2. F1 §4.2 の表を改訂する。`initial`(未操作)の間は、初期レイアウト確定後もレイアウト変化(右列/時間カード/地図コンテナ/ウィンドウ)のたびに会場中心補正を再適用する。`manual` は従来どおり `invalidateSize` のみで閲覧位置を維持する。`returning` は従来どおり。
3. 受け入れ条件は、読込後の初回クリック(地図・ヘッダー・右側列)で中心不変、F1 の右列考慮の初期中心維持、未操作時の確定後レイアウト変化での中心維持、`manual` 時の位置維持(回帰)。自動テストとブラウザペインで検証できる範囲を検収対象とし、FHD・HD・iPad 11インチ横の実ブラウザでの見え方はオーナー確認観点(C-02 逆発注)とする。
4. 「起動直後のまれなずれ」の原因仮説は、可能な範囲で裏取りし確度を明記する。

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

確定事項2に従うと、**未操作(`initial`)のまま**ナウキャスト↔キキクルを切り替えてカード高が変わった場合、会場を可視矩形の中心に保つために地図が (ΔB/2) px だけパンし、地図中心の lat/lng が変わる。`manual` 時は従来どおり動かないため、F3 §11.3 の「ドラッグ後に切替を挟んでも戻らない」は維持される。

- 【確定】(2026-09-25 ユーザー判断) 確定事項2の文言どおり、`initial` 中のレイヤー切替によるカード高変化も再補正の対象とする(会場は画面上で可視矩形の中心に留まり、背景地図が ΔB/2 動く)。F3 設計書の該当記述の改訂は本 Issue では行わず、別途扱う。
- 不採用案: カード要素の差し替え(レイヤー切替)に伴う変化だけは再補正の対象外にする。F3 の記述と整合するが、未操作でも会場が可視矩形の中心から外れる。

ナウキャストとキキクルでカード高が実際に異なるかは本設計時に実測していない(ブラウザペインではカタログ取得が止まるため)。

## 5. 変更ファイル一覧

| ファイル | 変更 |
| --- | --- |
| `apps/web/src/map/viewportLayoutSync.ts` | 新規(§4.3) |
| `apps/web/src/map/MapViewport.tsx` | §4.4 |
| `apps/web/tests/viewportLayoutSync.test.ts` | 新規(§6.1) |
| `docs/design/issue-44-47-49-map-foundation-controls.md` | §4.5 |

上記以外(CSS、`WeatherMapView.tsx`、`projection.ts`、他設計書、既存テスト)は変更しない。

## 6. 受け入れ条件

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
const B = document.querySelector('.timeline-control-card').getBoundingClientRect().height;
({ vx: m.left + 14 - c.left, vy: m.top + 36 - c.top,
   dx: m.left + 14 - c.left - (c.width - R) / 2, dy: m.top + 36 - c.top - (c.height - B) / 2,
   R, B, W: c.width, H: c.height,
   pane: document.querySelector('.leaflet-map-pane').style.transform,
   vis: document.visibilityState });
```

- [ ] P0: `grep -n "requestAnimationFrame\|layoutSettledRef\|scheduledRafRef" apps/web/src/map/MapViewport.tsx apps/web/src/map/viewportLayoutSync.ts` が 0 件。
- [ ] P1(H-A の解消、確定事項1): ペインサイズ既定(1024×768)で読込後、スクリーンショット・クリックを一切行わずに `javascript_tool` 内で 3 秒待ってから M を評価する。`vis` が `hidden` かつ `|dx| ≤ 2`・`|dy| ≤ 2`。(修正前は同条件で dx=+144, dy=+55 を実測済み。)
- [ ] P2(初回クリック): 再読込ごとに次の 3 通りを行う。①ヘッダーの非操作部分、②地図の空き領域(右列・カード・左下操作群・凡例を避けた位置)、③右列カードの非操作部分を `computer` の `left_click` で 1 回クリックする。クリック前後の M で `pane` と `vx`/`vy` が一致(±1 px)し、クリック後も `|dx| ≤ 2`・`|dy| ≤ 2`。
- [ ] P3(未操作時の確定後レイアウト変化、確定事項2): 読込後にクリック・ドラッグせず、次を 1 つずつ行い、毎回スクリーンショットを 1 回撮って描画を起こしてから M を評価する。いずれも `|dx| ≤ 2`・`|dy| ≤ 2`、かつ R/B/W/H が意図どおり変化している。①時間カード要素に `style.minHeight = (B + 40) + 'px'` を設定、②`.weather-map-view` に `--wx-map-right-column-width: 22rem` を設定、③`resize_window` で 1280×800 に変更。終了後 `resize_window` の `desktop` で戻し、再読込する。
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
3. 起動直後にナウキャストのカタログが「利用可能な時刻はありません」から時刻表示へ切り替わったとき、会場ピンが可視矩形(右列・時間カードを除く領域)の中心に留まるか(H-C)。
4. iPad 11 インチ横の Safari で、読込直後・アドレスバーの表示/非表示の切替後に会場ピンが可視矩形の中心にあるか(H-D)。
5. 未操作のままナウキャスト↔キキクルを切り替えたときの地図の動き(§4.6 の判断結果に応じた期待を記載)。

## 7. 後続への引き継ぎ

- `MapViewport` の中心補正は `viewportLayoutSync.ts` の `sync()` に一本化された。後続で補正契機を追加する場合は `sync()` を同期で呼ぶ。rAF・タイマーで遅延させると、描画が止まる環境で本 Issue の不具合が再発する。
- `initial` は「未操作」を意味し、レイアウトが変わるたびに会場を可視矩形の中心へ置き直す。後続の機能が `initial` のまま地図中心を意図的に動かす場合は、先に `placement` を変える必要がある。
- F3 設計書の「レイヤー切替で lat/lng が変わらない」の記述は、§4.6 のユーザー判断に従って別途改訂が必要になる可能性がある。

## 8. 実挙動未確認の箇所・残留リスク

- H-B(フォント待ちによる実ブラウザでの遅延)、H-C(カタログ取得前後のカード高差)、H-D(iPad の `dvh` 変化)は実挙動未確認。§6.3 で確認する。
- `sync()` を `useEffect` 内で呼ぶため、実ブラウザで「補正前の地図が 1 フレーム描画される」かどうかは React の effect 実行タイミングに依存し、実挙動未確認。地図本体も同じ `useEffect` で生成されるため、生成と補正は同一タスク内で行われる見込み(§6.3-1 で確認)。
- hidden のまま(描画が一度も起きないまま)レイアウトが変わった場合は `ResizeObserver` が届かず、次の描画時(ペイント前)に補正される。地図の状態を JavaScript だけで読む検証では、この間は補正前の値が見える。
- ウィンドウリサイズ時は Leaflet 自身の `trackResize`(rAF で `invalidateSize({pan:true})`)が先に動く。`initial` では直後の `sync()` が補正し直すため結果は変わらない。`manual` の挙動は従来どおり(変更しない)。
