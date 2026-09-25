# Issue #61 G10. 詳細ダイアログ共通コンポーネント

## 1. 目的と範囲

右側情報パネル（G1 #52）の各パネルから開く詳細ダイアログの共通の土台を実装する。G4〜G6は、この土台に各パネル固有の中身を差し込む。

範囲内:

- 画面の約90%を使うモーダルダイアログ（ネイティブ `<dialog>` の `showModal`）
- 見出し・対象地域／地点・発表または観測時刻・閉じるボタン（共通メタ情報）
- 背景（地図・右側パネル列）の操作停止、Esc での閉じ、閉じた後のフォーカス・スクロール位置の復帰
- 時系列表の共通部品（表部分だけ横スクロール、行見出し列固定、2段の列見出し）
- 仮の入口とサンプル表（開発ビルドの `?panelFixture=` 限定。G4〜G6で置き換える）

範囲外: 各パネル固有の中身（G4 警報等時系列、G5 警報級の可能性、G6 アメダス）、アメダスの取得済み範囲・未取得区間表示（G6）、グラフ部品、`MonitoringDialogHost` の改修・統合。

## 2. 参照資料と設計判断の根拠

- [基本設計](../basic-design.md) §5.13（【設計案・未確定】。下記ヒアリング確定事項の範囲に限り本Issueの設計として採用承認済み）、§5.8〜§5.11（各パネルの表の性質）
- [G1設計書](issue-52-info-panel-layout.md)（列のスクロール・`pointer-events`・`overscroll-behavior`、`panelTime.ts` の時刻表記、`?panelFixture=`）
- [#208 LAN・iPad対応](issue-208-lan-ipad-support.md)（100dvh・セーフエリア）
- [06-ui-md3-protocol.md](../rules/06-ui-md3-protocol.md)、[07-wx-data-protocol.md](../rules/07-wx-data-protocol.md)
- 既存コード: `apps/web/src/monitoring/MonitoringDialogHost.tsx`（`showModal`、`onCancel` の `preventDefault` による Esc 処理、開く前の `document.activeElement` 保存と `queueMicrotask` でのフォーカス復帰、Tab 循環）、`monitoringDialogFocus.ts`（`nextDialogFocusTarget`）、`monitoring.css` の `.monitoring-dialog`（`::backdrop` に `scrim`）、`apps/web/src/map/panels/*`、`MapInformationColumnSlot.tsx`、`WeatherMapView.tsx`（スロットは地図コンテナと兄弟でDOM上に置かれる）
- テスト環境: `apps/web/tests/` は `renderToStaticMarkup` と純粋関数のテストのみで、DOM環境（jsdom等）を持たない。`showModal`・フォーカス・スクロールは単体テストでは検証できないため、実画面の受け入れ条件で確認する。

### 2.1 ヒアリング確定事項（オーナー承認済み）

| # | 確定事項 | 反映 |
|---|---|---|
| D1 | 画面の約90%（幅・高さ、上限幅あり、数値は設計書で定める）。ネイティブ `<dialog>` の `showModal`、既存監視ダイアログの手法（背景操作停止・Esc・フォーカス復帰）を踏襲。`MonitoringDialogHost` は改修・統合せず別コンポーネント。iPad（#208）でも使える | §4.1、§3.1、AC-5〜AC-9 |
| D2 | 閉じたら開いたボタンへフォーカスを戻し、右側パネル列の縦スクロール位置を保つ。地図の表示位置・ズームも変えない | §4.2、AC-6 |
| D3 | 時系列表は横幅超過時に表部分だけ横スクロール、行見出し列固定。列見出し2段（上段の日付は日付が変わる列にだけ、下段に時刻）。文字を過度に縮小しない | §5、AC-2・AC-7 |
| D4 | 単体テストに加え、右側パネルに仮の入口とサンプル表を置き実画面で確認。仮の入口はG4〜G6で置き換える前提 | §6 |
| D5 | 範囲外: 各パネル固有の中身（G4〜G6）、アメダスの取得済み範囲・未取得区間表示（G6） | §1 |
| D6 | オーナーのiPad実機確認・UI監修で改訂（本設計書時点）: (a) 開いたときの初期フォーカスは閉じるボタンではなく見出し（`h2`、`tabindex="-1"`）へ移す。タッチで開いた際にフォーカスリングが出ないようにする。Tabで閉じるボタンへ移り、キーボード操作時はリングが出る。(b) 閉じるボタンの×アイコンの大きさを見出し（`md-typescale-headline-small`、24px）に揃える（ボタン自体は56pxのまま）。(c) 表の細部（日付ラベルの欠け等）は各パネル内容の実装時（G4〜G6）に改めて監修するため本Issueでは扱わない。AC-9はオーナーがiPad実機で確認し概ね問題なしと記録済み | §3.3、§4.2、AC-5・AC-8b・AC-9 |
| D7 | PR #215 外部レビュー（Codex、P2）指摘によりこのPRで改訂: `<dialog>` の `onClose`（ネイティブ `close` イベント）がある限り、`requestClose` が1操作（閉じるボタン／Esc）につき2回実行され `onClose`（親コールバック）が2回呼ばれる。ネイティブ `close` イベントは `requestClose` が自ら呼ぶ `dialog.close()` の帰結であり、別の閉鎖経路ではないため、この経路では `requestClose` を再実行しない設計に改める。副次的に、遅延した `close` イベントが直後の再オープンを誤って閉じる事象（別Issue #214と同根の原因）も本コンポーネントでは防げる。`MonitoringDialogHost`（#214の対象）は本Issueでは改修しない | §4.2、AC-6 |

## 3. 構成

### 3.1 モジュール構成

新規ディレクトリ `apps/web/src/map/detail/`（ファイル名は製造裁量で変更可）。

| ファイル | 役割 |
|---|---|
| `DetailDialog.tsx` | 共通ダイアログ本体。中身を `DetailDialogInner`（ポータルを含まない）に分け、公開する `DetailDialog` は `createPortal` で `document.body` 直下へ描画する薄いラッパーとする（`renderToStaticMarkup` はポータルを描画できないため。製造時の実装を検収でAC-3の趣旨を満たすと判断済み） |
| `detailDialogMeta.ts` | メタ情報の型と、見出し2行目の文字列を組み立てる純粋関数 |
| `DetailTimeSeriesTable.tsx` | 時系列表の共通部品 |
| `timeSeriesHeader.ts` | 列見出し（日付段・時刻段）を組み立てる純粋関数 |
| `useDetailDialogReturn.ts` | 開く前のフォーカス要素・右側列の `scrollTop` の保存と復帰 |
| `detail.css` | スタイル（色はMD3トークンのみ）。読み込みは `panels.css` と同じ方式（`index.css` への import 1行）|

Tab 循環は `monitoring/monitoringDialogFocus.ts` の `nextDialogFocusTarget` を import して再利用する（同ファイルは変更しない）。

`document.body` へのポータル描画とする理由: 右側列スロット（`pointer-events: auto`、`overscroll-behavior: contain`、スクロール容器）の内側に `<dialog>` を置くと、ダイアログ内のフォーカス移動・スクロールが列のスクロール位置に影響し得るため、DOM上で列・地図の外へ出す。React合成イベントはポータル越しにReactツリー上の祖先へ伝播する（`InfoPanelFrame` の `onWheel` の `stopPropagation` 等）が、地図（Leaflet）はネイティブDOMイベントで動くため影響しない。

### 3.2 型定義

```ts
/** 見出し下に出す時刻。発表と観測を型で区別し、値が無い場合も種別は保持する */
export interface DetailDialogTime {
  readonly kind: 'issued' | 'observed';
  readonly value: string | null; // ISO8601。null=時刻不明（取得前・電文に無い等）
}

export interface DetailDialogMeta {
  readonly title: string;            // 見出し（例「地域時系列予報」）
  readonly target: string | null;    // 対象地域／地点（例「東京地方」「江戸川臨海」）。null=未確定
  readonly time: DetailDialogTime;
  /** 本番/訓練。true=訓練、false=本番、null=不明。boolean に丸めない */
  readonly isTraining: boolean | null;
}

export interface DetailDialogProps {
  readonly open: boolean;
  readonly meta: DetailDialogMeta;
  readonly onClose: () => void;
  /** 閉じた後に右側列の scrollTop を戻す対象。省略時はスクロール復帰を行わない */
  readonly scrollContainer?: HTMLElement | null;
  readonly children?: ReactNode;
}

/** 見出し2行目の各要素。null は要素ごと省く（§3.3） */
export function formatDetailDialogMeta(meta: DetailDialogMeta, now: Date): {
  readonly target: string | null;
  readonly time: string | null;       // 例「14:05発表」「9/23 14:05発表」「14:10観測」
  readonly trainingLabel: string | null;
};
```

- 時刻表記は G1 の `panelTime.ts`（`formatPanelTime`）を再利用し、パネルと同一表記にする。
- `availability`（3状態）は本ダイアログのpropsに持たない。ダイアログはパネルが `content` 表示のときだけ開ける前提で、状態の区別は中身（G4〜G6）の責務とする（§7）。
- `DetailTimeSeriesTable` の型は §5.1。

### 3.3 見出し領域

- 1行目: `title`（`md-typescale-headline-small`、24px）。右端に閉じるボタン。**×アイコンのみ**とし（オーナーUI監修で確定）、`GbIconButton`（`color="standard"`、`size="md"`、`type="button"`）の中にアイコン `close` を置く。アイコン表示は `MonitoringToolbar.tsx` の `Icon`（Material Symbols を `aria-hidden="true"` の span で出す）と同じ方式とし、`detail/` 内に同等の小部品を置く（`monitoring/` は変更・importしない。共通化は監視ダイアログ大改修時に行う）。アクセシブルネームは `aria-label="閉じる"`（`title` も「閉じる」）。押せる範囲は48×48px以上: `size="md"` のコンテナ高は56px（`@material/web` の `icon-button.css` で `.icon-btn-md{--container-height:56px}` を確認済み。`sm` は40pxのため不可、ボタン自体は変更しない）。アイコンサイズは見出しの文字サイズに揃え、`.detail-dialog-close-icon` の `font-size` を現行 20px から **24px** に改める（D6・オーナーUI監修）。アイコン色はコンポーネント既定（`on-surface-variant` 系トークン）に任せ、HEX・独自色指定をしない。focus-visible の表示もコンポーネント既定に任せる。
- 見出し要素（`h2`）に `id={titleId}`・`tabindex="-1"` を付け、初期フォーカスの移動先とする（§4.2）。`:focus-visible` でリングが出ない要素なので、タッチでの初期フォーカスではリングが出ない。
- 2行目: `target · time`（G1カードと同じ区切り）。`target` が null ならその要素を省き、`time.value` が null なら時刻要素を省く【確定】（§9 Q1）。どちらも null なら2行目自体を出さない。
- 訓練: `isTraining === true` のとき見出し横に「訓練」ラベルを表示する【確定】（§9 Q2）。`false` は何も出さない。`null` は何も出さない【確定】（§9 Q2）。色は `tertiary-container`／`on-tertiary-container` トークン【設計案】。
- `<dialog>` に `aria-labelledby`（見出しのid）。idは `useId` で生成し、複数インスタンスでも衝突させない。

## 4. ダイアログの寸法と挙動

### 4.1 寸法（D1）

```css
/* .detail-dialog */
inline-size: min(90vw, 960px);
block-size: auto;            /* 中身に合わせる */
max-inline-size: none;       /* UA既定の max-*: calc(100% - 2em - 6px) を解除 */
max-block-size: 90dvh;       /* 高さ上限 */
overflow: hidden;            /* UA既定 dialog:modal{overflow:auto} を打ち消す。ダイアログ本体はスクロールしない */
padding: 0;

/* .detail-dialog-body */
flex: 0 1 auto;              /* 旧 flex:1（basis 0%）は高さauto時に不定になるため使わない */
min-block-size: 0;
overflow: auto;
overscroll-behavior: contain;
position: relative;          /* 本文内の絶対配置要素の包含ブロックを本文にする（下記「二重スクロールの原因」） */
```

| 画面（G1 §4.1 と同じ前提、100%表示） | viewport | ダイアログ幅 | 高さ上限（90dvh） |
|---|---|---|---|
| FHD全画面 | 1920×1080 | 960（上限） | 972 |
| FHDブラウザ最大化 | 1920×960 | 960（上限） | 864 |
| HD | 1280×720 | 960（上限） | 648 |
| iPad 11インチ横（設計基準） | 1180×820 | 960（上限） | 738 |

すべて算出値で、AC-8で実測する。高さは中身の高さと上限の小さい方になる。本文が長い場合は上限に達し、本文領域だけが縦スクロールする。本文が短い場合は上限未満で止まる。

- 上限960pxの根拠（オーナーUI監修で確定）: 1列約65px（実測）で、警報等時系列の現行8列（3時間区間）＋24時間区間2列のブロック、地域時系列予報（天気・風10列、気温11列）が横スクロールなしで収まる。サンプル最大14列の電文では約130px横スクロールすることはオーナー承知済み。対象4viewportはすべて90vwが960pxを超えるため、幅は常に960pxになる。
- 内部構成: 見出し領域（`flex: none`）＋本文領域（上記）。縦スクロールは本文領域だけで行い、ダイアログ本体（`<dialog>`）はスクロールしない。見出しと閉じるボタンはスクロールしても常に見える。
- 二重スクロールの原因（オーナー監修で指摘された、`<dialog>` と `.detail-dialog-body` の両方にスクロールバーが出る現象）: コード調査による特定であり、製造時に修正前の状態で再現・確認すること。
  1. `<dialog>` はUA既定で `dialog:modal { overflow: auto }` を持ち、`detail.css` の `.detail-dialog` はこれを打ち消していない。ダイアログ本体がスクロールコンテナになっている。
  2. `.detail-ts-caption`（視覚的に隠すキャプション）は `position: absolute` だが、`.detail-dialog-body` も `.detail-ts-scroll` も配置されていない（`position: static`）ため、包含ブロックは位置付けられた最寄りの祖先であるダイアログ（`showModal` 中は top layer で `position: fixed`）になる。本文領域の `overflow` はこの要素をクリップせず、本文内の静的位置（表が本文の下方にあれば本文領域の高さより下）がダイアログのスクロール可能領域を押し広げる。これで1と合わせてダイアログ本体にもスクロールバーが出る。
  - 対策は二重に行う: (a) `.detail-dialog` に `overflow: hidden`、(b) `.detail-dialog-body` に `position: relative`（キャプションの包含ブロックを本文領域にする）。どちらか一方だけにしない。(a)だけだとダイアログ本体のはみ出しが見えずに残り、プログラムスクロール（`scrollIntoView`・フォーカス移動）でダイアログ本体がずれる恐れがある。
  - 製造時に上記1・2以外の原因（見出し行のはみ出し等）が見つかった場合も、AC-8(c) を満たすまで直す。原因が1・2と異なった場合は最終報告に記す。
- 背景色 `surface-container-high`、角丸 `--md-sys-shape-corner-md`、`::backdrop` は既存監視ダイアログと同じ `scrim`＋`opacity: 0.32`。
- iPadセーフエリア: 高さ最大90dvh・幅960pxの中央配置で、1180×820の上下に41px以上・左右に110pxの余白が残るため、個別のセーフエリア処理は加えない。

### 4.2 開閉と復帰（D1・D2）

開く（`open` が false→true）:

1. `document.activeElement` を保存（開いたボタン）。`scrollContainer` があればその `scrollTop` を保存。
2. `showModal()`。背景は inert になり、地図のドラッグ・ホイール・クリック、右側列のスクロール・クリックを受け付けない。
3. 見出し（`h2`、`tabindex="-1"`）へ `focus({ preventScroll: true })`（既存と同様 `queueMicrotask` 後）。**閉じるボタンではなく見出しへ移す**（D6・オーナーiPad実機確認：閉じるボタンへ初期フォーカスするとタッチ操作でもフォーカスリングが出るため）。Tabで閉じるボタンへ移動でき、キーボード操作時はリングが表示される（コンポーネント既定の `:focus-visible`）。Tab循環・閉じた後のフォーカス／スクロール復帰は変更しない。

閉じる（閉じるボタン、Esc）:

- Esc は `onCancel` で `preventDefault` し、閉じるボタンと同じ `requestClose` を通す（既存の二重実行防止 `closingRef` を踏襲）。
- `onClose()` → 親が `open=false` → 効果（`useEffect`）が `dialog.close()` を呼ぶ。
- 復帰は `queueMicrotask` 後に、(a) 保存要素が `isConnected` なら `focus({ preventScroll: true })`、未接続なら `#view-content` へ、(b) 保存した `scrollTop` を `scrollContainer` へ代入する。(b)は(a)の後に行い、フォーカスによる自動スクロールを上書きする。
- 背景クリック（`::backdrop`）では閉じない（既存監視ダイアログと同じ）【確定】（§9 Q3）。
- 地図の表示位置・ズームには一切触れない。`MapViewport` の API を呼ばない。

**ネイティブ `close` イベントの二重実行防止（D7、PR #215差し戻し対応）**

`dialog.close()` はネイティブの `close` イベントを発火させる。このイベントは `dialog.close()` を呼んだ結果として起きるものであり、`requestClose`（閉じるボタン／Esc）とは別の独立した閉鎖経路ではない。この `close` イベントで `requestClose` を再実行すると、`closingRef` が `queueMicrotask` で先に `false` へ戻ってしまうため（イベントはタスク、`queueMicrotask` はマイクロタスクで、後者が先に走る）、1操作につき `onClose`（親コールバック）が2回呼ばれる。

修正方針:

- `closingRef` とは別に `programmaticCloseRef`（`useRef(false)`）を設け、`useEffect` 内で `dialog.close()` を呼ぶ直前に `true` にする。
- `<dialog>` の `onClose` ハンドラでは `requestClose` を呼ばない。`programmaticCloseRef.current` が `true` ならそれを `false` に戻すだけで何もしない（自分自身の `close()` 呼び出しの結果である正常系）。`false`（＝`requestClose` を経由しない予期しない閉鎖）の場合のみ、フォールバックとして `requestClose()` を呼ぶ（ブラウザ操作等、想定外の経路で閉じても `onClose`（親）が最低1回は呼ばれるようにするための保険。現状の実装ではこの経路は理論上通らない想定だが、想定外の閉鎖でも復帰処理が漏れないようフォールバックを残す）。
- 効果として、閉じるボタン・Escいずれも `onClose`（親）は1操作につき正確に1回。閉じた直後に `open` が再び `true` になっても、遅延した `close` イベントは `programmaticCloseRef` により無視されるため、開き直した直後に勝手に閉じる事象（#214と同根）も本コンポーネントでは起きない。`MonitoringDialogHost`（#214の対象）は本Issueの範囲外のため未修正のまま残る。

Tab 循環: 既存と同じく `onKeyDown` で `nextDialogFocusTarget` を使う。対象要素のセレクタには、横スクロール領域（`tabindex="0"`、§5.2）を含める。

## 5. 時系列表（D3）

### 5.1 型

```ts
export interface TimeSeriesColumn {
  readonly key: string;
  readonly at: string;          // 列の代表時刻 ISO8601（区間なら開始時刻）。日付段の判定に使う
  readonly timeLabel: string;   // 下段の表示（例「9時」「9-12時」）。区間と時点の違いは呼び出し側が表記で表す（§5.11）
}

export interface TimeSeriesRow {
  readonly key: string;
  readonly header: ReactNode;               // 行見出し（固定列）
  readonly cells: readonly TimeSeriesCell[];
}

export interface TimeSeriesCell {
  readonly key: string;
  readonly span?: number;                   // 区間結合（地域時系列予報の天気・風等）。既定1
  readonly content: ReactNode;              // 空欄・「－」・「—」等の区別は呼び出し側の責務
}

export interface DetailTimeSeriesTableProps {
  readonly caption: string;                 // 視覚的には非表示可（aria用）
  readonly rowHeaderLabel?: string;         // 左上角セル
  readonly columns: readonly TimeSeriesColumn[];
  readonly rows: readonly TimeSeriesRow[];
  readonly initialColumnKey?: string;       // 初期表示でこの列を行見出しの直右に置く
}

/** 上段（日付）の表示。日付が前列と変わる列と先頭列だけ文字列、他は null */
export function buildDateHeaderLabels(columns: readonly TimeSeriesColumn[]): readonly (string | null)[];
```

- 日付はJSTで判定し、表記は `M/D(曜)`（例 `9/24(木)`、ゼロ埋めなし）とする【設計案・製造時変更不可】。
- 各行の `span` の合計が `columns.length` と一致しない場合、開発ビルドで `console.error` を出す（表示は崩れてよい）。検証関数 `validateRowSpans` を純粋関数として切り出しテストする。

### 5.2 レイアウト

- 構造: `<div class="detail-ts-scroll" role="region" aria-label={caption} tabindex="0">` の中に `<table>`。横スクロールするのはこの div だけ（`overflow-x: auto; overscroll-behavior-x: contain`）。ダイアログ本文や見出しは横スクロールしない。
- 行見出し列: 各行の `<th scope="row">` と左上角セルを `position: sticky; inset-inline-start: 0` で固定。背景は不透明な `surface-container-high`（ダイアログ背景と同色）とし、下を流れるセルが透けないようにする。右端に `outline-variant` の区切り線。
- 列見出し: `<thead>` 2行。上段は `buildDateHeaderLabels` の文字列があるセルだけ表示し、ほかは空セル（`colspan` での結合はしない）。日付が変わる列の左端に `outline-variant` の区切り線を引く【設計案・製造裁量】。下段は `timeLabel`。
- 文字サイズ: 表の本文・列見出し・行見出しとも `md-typescale-body-medium`（14px）以上。`font-size` を画面幅で縮める指定（vw・clamp等）をしない。
- 列幅: データ列 `min-inline-size: 4rem`（64px）、`white-space: nowrap`。行見出し列 `min-inline-size: 7rem`（112px）、行見出しは折り返し可。
- 初期位置: `initialColumnKey` があれば、マウント後に `scrollLeft = 該当列の offsetLeft − 行見出し列幅` とする。無ければ `scrollLeft = 0`。
- 縦方向は表でスクロールさせない（ダイアログ本文領域がスクロールする）。
- タッチ（iPad）: 横スワイプは表の div だけが動き、ダイアログ・ページが動かない。

## 6. 仮の入口とサンプル表（D4）

**G4〜G6で置き換える前提の仮実装であり、本番導線ではない。** コード中にも同旨のコメントを置く。

- G1の開発ビルド限定フィクスチャ `?panelFixture=all-content` のうち、「警報等時系列」と「地域時系列予報」のダミー本文に「詳細（仮）」ボタン（`GbButton` text）を追加する。本番ビルドではフィクスチャ自体が無効のため入口も出ない。
- 押すと `DetailDialog` が開き、`scrollContainer` には右側列スロット要素を渡す（`MapInformationColumnSlot` の既存 ref を再利用する。取り回しは製造裁量。スロットの幅計測 ref の挙動は変えない）。
- サンプル内容（`panelFixtures.ts` 近傍に置く。値は明らかにダミーと分かるもの）:

| 入口 | meta | 表 |
|---|---|---|
| 警報等時系列 | title「警報等時系列（サンプル）」、target「江東区」、time 発表、isTraining false | 行5（大雨・洪水・暴風・波浪・高潮）、3時間区切り32列（4日分、日付境界を3回含む）。`initialColumnKey` は3列目 |
| 地域時系列予報 | title「地域時系列予報（サンプル）」、target null、time `{kind:'issued', value:null}`、isTraining true | 行3（天気・風・気温）。天気・風は `span: 2` の区間セル、気温は時点。列24（3日分）|

  2つ目は null・訓練の表示確認を兼ねる。
- 警報等時系列サンプルの列数の根拠（AC-7の初期位置合わせ）: 初期表示で3列目を行見出しの直右に置くには `scrollLeft = 2列分 = 128px` 以上が必要で、横スクロールの最大量 `scrollWidth − clientWidth` がこれ以上でなければならない。検収時の実測では16列・1280×720（ダイアログ幅1152）ではみ出し55pxであり、表の可視幅は約 112 + 16×64 − 55 ≈ 1081px（ダイアログ幅 − 約71px。この実測は幅上限1600px時のもの）。同じ差し引きで可視幅を見積もると、必要列数 N は `112 + 64N − 可視幅 ≥ 128` を満たす最小値である。

  | viewport | ダイアログ幅 | 表可視幅（見積） | 必要N | 32列でのはみ出し |
  |---|---|---|---|---|
  | 1920×1080 / 1920×960 / 1280×720 / 1180×820 | 960（全viewportで上限） | 約889 | 15 | 約1271px |

  幅上限を960pxに改訂した後も、必要15列に対し32列（3時間×8列×4日）で、はみ出し約1271px ≥ 128px のため AC-7 の初期位置合わせは全viewportで成立する（計算確認済み）。列数は据え置く。列数を減らす変更は不可【設計案・製造時変更不可、変更は統括へ】。
- 高さ検証用に、2つのサンプルの本文量を分ける。「警報等時系列」は長い本文（下記の段落）とし、全viewportでダイアログが90dvhに達する。「地域時系列予報」は短い本文（表と一文程度のみ。スクロール確認用段落を置かない）とし、最も低い1280×720（上限648px）でもダイアログ高さが上限未満になる量に抑える（見出し約100px＋表5段約250px＋余白で約450pxの見込み）。
- 「警報等時系列」のダミー本文には、サンプル表のほかに縦スクロールを確認するための段落を置く。量は、AC-8の全viewport（本文領域が最も高い1920×1080を含む）で本文領域の `scrollHeight − clientHeight ≥ 200px` となること。目安として2行以上の段落を30個以上とする（ダイアログ高さ最大972pxに対し、表を除いても本文が1000pxを超える量）。製造時に1920×1080で上記の差を実測し、コミットメッセージまたは最終報告に値を記す。

## 7. 気象データ制約・管理項目の結論

- 確定/未確定: 本Issueは新たな電文構造・コード値を設計に取り込まない。サンプル表の値はダミーで、実データの形を主張しない。
- isTraining: `boolean | null` のまま受け取り、ダイアログで本番に丸めない（§3.2）。
- availability 3状態: 共通ダイアログは状態を持たず、中身（G4〜G6）がパネルと同じ区別を維持する。stale でもパネルが content を出すならダイアログを開けてよい【設計案】。
- 時刻の意味: `kind: 'issued' | 'observed'` を必須にし、値が null でも種別を失わない。
- 会場: 対象名は呼び出し側（G1 `panelTargets.ts`）が決めた文字列を渡す。ダイアログは会場IDや地図状態を入力に取らない。
- 棚卸し管理項目: **該当なし**（Issue #139 棚卸しの結論どおり、既存タスク固有の設計事項のみ）。採否待ちの保守事項は本Issueで修正必須へ昇格させない。

## 8. 受け入れ条件

前提: `npm run dev` の起動・停止は [01-dev-workflow-protocol.md](../rules/01-dev-workflow-protocol.md) に従う。寸法は [G-08](../rules/advisory/G-08-ui-measurement-pitfalls.md) を踏まえ `getBoundingClientRect()` で実測し値を記録する。「開く」は §6 の入口を指す。

- [ ] AC-1: `npm run lint` / `npm run typecheck` / `npm run format:check` / `npm run test -w apps/web` がすべて成功する。
- [ ] AC-2: `buildDateHeaderLabels` の単体テストで、(a) 先頭列は常に日付、(b) 同日の後続列は null、(c) JST 23時台→翌0時台の境界で日付が出る（UTCでは同日でもJSTで日付が変わるケース、例 `2026-09-23T14:00:00Z`→`2026-09-23T15:00:00Z` を含む）、(d) 表記が `9/24(木)` 形式。`validateRowSpans` が span 合計の過不足を検出する。
- [ ] AC-3: `formatDetailDialogMeta` の単体テストで、target null・time.value null・isTraining true/false/null の各組合せが §3.3 どおり（null要素は省く、訓練はtrueのみ「訓練」、発表/観測の語が kind どおり）。`renderToStaticMarkup` でポータル抜きの内側部品 `DetailDialogInner`（open=true 相当）を描画し、見出し・対象・時刻・閉じるボタンの `aria-label="閉じる"`・`aria-labelledby` が出力される。
- [ ] AC-4: `DetailTimeSeriesTable` を `renderToStaticMarkup` し、上段の日付セルが日付境界の列にだけ文字を持ち、日付が前列と変わらない列の上段日付セルが空（テキストが空文字）であることも検証する。行見出しが `th scope="row"`、横スクロール div が `role="region"` と `tabindex="0"` を持つ。
- [ ] AC-5: `?panelFixture=all-content` で「警報等時系列」の「詳細（仮）」を押すとダイアログが開く。開いた状態で、ダイアログ外（地図が見えている位置）でドラッグ・ホイール・ダブルクリックしても地図の中心・ズームが変わらない（開く前後で `map.getCenter()`・`getZoom()` 相当の値、または画面上の目印位置を記録して比較）。右側列もスクロールしない。`document.activeElement` が見出し（`h2`、`tabindex="-1"`）であり、フォーカスリングが出ていない（D6）。Tabで閉じるボタンへ移動でき、その時点でフォーカスリングが表示される。
- [ ] AC-6: 右側列を下までスクロールし（`scrollTop` を記録、0より大きいこと）、「地域時系列予報」の「詳細（仮）」で開く。(a) Esc、(b) 閉じるボタン、それぞれで閉じた後、`document.activeElement` がその「詳細（仮）」ボタン（またはそのホスト要素）であり、列の `scrollTop` が開く前と一致し（差0〜1px）、地図の中心・ズームが開く前と同じ。Tab／Shift+Tab を繰り返してもフォーカスがダイアログ外へ出ない。
- [ ] AC-6b（D7、PR #215差し戻し対応）: 親コンポーネントの `onClose` を一時的にラップし呼び出し回数を計測できる状態（例: 開発コンソールへの `console.count` 差し込み、またはブラウザDevToolsのブレークポイント／ステップ実行）で、(a) 閉じるボタンでの1回のクリック、(b) Escキーの1回の押下、それぞれについて `onClose` の呼び出しが正確に1回であることを確認する。加えて、閉じた直後（同一操作の延長で）ただちに同じ「詳細（仮）」ボタンで再度開き、遅延した `close` イベントによってダイアログが勝手に閉じないこと（開いた状態が保たれること）を確認する。AC-6のフォーカス／スクロール復帰の挙動に変化がないことも合わせて確認する。
- [ ] AC-7: 1280×720 で「警報等時系列」サンプルを開き、表の横スクロール div の `scrollWidth > clientWidth`。横スクロールすると行見出し列の `getBoundingClientRect().left` が変わらず、データセルは行見出しの下に隠れる（透けない）。ダイアログ本文・見出しは横に動かない。初期表示で3列目が行見出しの直右にある。表の文字の computed `font-size` が14px以上。
- [ ] AC-8: 1920×1080、1920×960、1280×720、1180×820 の各viewportで、ダイアログ（`<dialog>`）の `getBoundingClientRect()` を実測する。(a) 「警報等時系列」サンプル（長い本文）: 幅・高さが §4.1 表の幅・高さ上限と±1pxで一致し、本文領域 `.detail-dialog-body` の `scrollHeight > clientHeight`。(b) 「地域時系列予報」サンプル（短い本文）: 幅が960±1px、高さが同viewportの高さ上限より小さく、本文領域の `scrollHeight === clientHeight`（縦スクロールなし）。(c) 二重スクロールの再発防止: (a)(b)いずれも、ダイアログ要素の `scrollHeight === clientHeight` かつ `scrollWidth === clientWidth`、computed `overflow` が `hidden`。(a)で本文領域を最下部までスクロールした後もダイアログの `scrollTop === 0`。(d) いずれも閉じるボタンが見え、ページに横スクロールが発生しない。本文領域を縦スクロールしても見出しと閉じるボタンが見えたまま。
- [ ] AC-8b: 閉じるボタンに可視テキストがなく（`textContent` がアイコン名 `close` のみで、そのspanは `aria-hidden="true"`）、アクセシブルネームが「閉じる」（`aria-label`）。ボタンのホスト要素の `getBoundingClientRect()` の幅・高さがともに48px以上。アイコンの computed `font-size` が見出し（`h2`）の computed `font-size` と一致する（24px、D6）。スクリーンショットで×アイコンが表示されている（アイコン名の文字列がそのまま表示されていない）。
- [ ] AC-9: iPad Pro 11インチ横の実機で、開く・表の横スワイプ（表だけが動きダイアログ・ページが動かない）・本文の縦スワイプ・閉じる後の列スクロール位置保持を確認する。実機で確認できない場合はエミュレーションで合格とせず「実挙動未確認」として統括へ返す。**オーナーがiPad実機で確認済み、概ね問題なし（D6）。** 表の細部（日付ラベルの欠け等の見た目）は各パネル内容の実装時（G4〜G6）に改めて監修するため、本Issueの合否判定には含めない。
- [ ] AC-10: 「地域時系列予報」サンプルで、見出し2行目に対象・時刻が出ず（null）、「訓練」ラベルが表示される。「警報等時系列」サンプルでは「江東区 · HH:mm発表」形式で「訓練」は出ない。
- [ ] AC-11: 新規・変更した css/tsx に色のHEX直書きがない（`#[0-9a-fA-F]{3,8}\b` 検索で0件）。
- [ ] AC-12: `git diff --stat main` の変更が `apps/web/src/map/`（`detail/` 新設、`panels/panelFixtures.ts` 等のフィクスチャ、入口のためのスロット ref 取り回し）、`apps/web/tests/`、`apps/web/src/index.css` の `detail.css` import 1行に限られる。`apps/web/src/monitoring/` に差分がない（閉じるボタンのアイコン部品も `monitoring/` から import しない）。`apps/web/src/components/md/` に差分がない（既存 `GbIconButton` をそのまま使う）。`map.css` の `--wx-map-right-column-width` に差分がない。

## 9. 未確定事項・要ヒアリング

- Q1: メタ情報が null のとき（対象不明・時刻不明）、該当要素を黙って省く案でよいか、「時刻不明」等の文言を出すか。 → 【確定】黙って省く。
- Q2: 訓練電文のとき見出し横に「訓練」ラベルを出す案でよいか。isTraining が不明（null）のときは何も出さない案でよいか。 → 【確定】訓練時のみラベル、null は何も出さない。
- Q3: 背景（暗くなった地図部分）のクリック・タップで閉じるか。現案は既存監視ダイアログに合わせて閉じない。 → 【確定】閉じない。
- 実挙動未確認: iPad Safari での `showModal` 中の背景タッチ操作停止、`overscroll-behavior` の効き、`focus({preventScroll:true})` 後の `scrollTop` 復帰（AC-6・AC-9で確認）。§4.1 の寸法は算出値。二重スクロールの原因（§4.1）はコード調査による特定で、実測による再現確認は製造時に行う。
- Q4（D7、PR #215差し戻し対応）: ネイティブ `close` イベントによる `onClose` 二重呼び出しは、単体テスト（DOM環境なし）では再現・検証できないため、AC-6bとして実画面の受け入れ条件に位置づけた。`programmaticCloseRef` によるフォールバック分岐（想定外の経路での閉鎖）が実際に通るケースがあるかは製造時のコード調査でも見つかっていない未確認点であり、製造・検収時に他の閉鎖経路（本コンポーネントが使わない `<form method="dialog">` 等）が今後追加されないよう留意する。

## 10. 後続Issueへの引き継ぎ

- G4〜G6: §6の仮入口とサンプルを撤去し、各パネル本文に本物の入口を置く。`DetailDialog` の `meta` はパネル見出しと同じ対象名・時刻を渡し、`scrollContainer` に右側列を渡す。時系列表は `DetailTimeSeriesTable` を使い、セル内の「－」・空白・「—」の区別（§5.9、§5.12）は各自で行う。現在時刻を含む列を `initialColumnKey` に渡す（§5.13）。
- G5: 二表の結合表示（§5.9）で発表時刻が2つある場合の見出し時刻の扱いを決める（本ダイアログの `time` は1つ）。
- G6: グラフ部品と取得済み範囲・未取得区間表示は G6 で設計する。本ダイアログの本文領域にそのまま置ける。
- 本入口の撤去時、`panelFixtures.ts` の「詳細（仮）」も削除する。
