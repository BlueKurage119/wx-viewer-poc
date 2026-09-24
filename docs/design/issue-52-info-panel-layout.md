# Issue #52 G1. 右側情報パネルの共通レイアウト・スクロール制御

## 1. 目的と範囲

F1（#44）で用意した右側情報列スロット `MapInformationColumnSlot` に、基本設計§5.2順の6パネルの共通枠（見出し・状態表示・中身差し込み口）を実装する。各パネルの中身（G2〜G7）とデータ取得の結線は本Issueの範囲外とする。

範囲内:

- 6パネルの配置順固定と共通枠コンポーネント
- 見出し（パネル名・対象地域／観測地点・発表／観測時刻）
- 「常時あるべき情報」「常時あるとは限らない情報」の状態別の枠表示（スケルトン／取得失敗文言／非表示／前回値）
- 列の縦スクロールと地図操作の両立（F1の挙動の維持）
- 仮データでの表示確認手段

範囲外: 各パネルの内容・一部欠測表示（G2〜G7）、詳細ダイアログ（G10）、取得異常の告知（通知領域・H5 #211）、左ナビのバッジ（G11）、APIからの実データ取得。

## 2. 参照資料と設計判断の根拠

- [基本設計](../basic-design.md) §5.1（対象固定【確定】）、§5.2（配置順【確定】）、§5.3（表示・操作【設計案】）、§5.12
- [Issue下書き](../issues-draft.md) G1・G9
- [監査記録](../audit-epic-a-d.md) AD-H004・AD-H019・AD-H022・AD-H049・AD-H070
- [F1〜F3設計書](issue-44-47-49-map-foundation-controls.md)、[#208 LAN・iPad対応](issue-208-lan-ipad-support.md)
- 既存コード: `apps/web/src/map/MapInformationColumnSlot.tsx`、`apps/web/src/map/map.css`（`.map-information-column-slot`、`--wx-map-right-column-width`）、`apps/web/src/map/WeatherMapView.tsx`（`setRightColumnRef` で列幅を中心補正に使用）、`packages/shared/src/availability.ts`（`Availability = 'available' | 'stale' | 'unavailable'`）、`packages/shared/src/venueForecastTargets.ts`

### 2.1 ヒアリング確定事項（ユーザー承認済み）

| # | 確定事項 | 本設計への反映 |
|---|---|---|
| H1 | 対象画面はFHD全画面・FHDブラウザ最大化1920×960（以上が基準）、HD、iPad 11インチ横。iPad縦は対象外 | §4.1の列幅表、AC-8〜AC-11 |
| H2 | 右上の短い要約固定表示（§5.3案）は不採用。新着は下部通知領域、危険度は左ナビバッジ（G11）が担い、配置順固定により最上部の速報・警報が要約を兼ねる | 要約領域を設けない（§3） |
| H3 | 列幅は現行clampを維持。G4〜G7で窮屈なら再検討 | `map.css` の幅定義を変更しない |
| H4 | 情報の分類と状態別表示（G9 #60 から引継ぎ） | §5 |
| H5 | 見出しに対象地域／観測地点と発表／観測時刻を表示。対象は会場固定で地図移動・レイヤー切替で変化しない | §3.3、§6 |
| H7 | 追加決定: 気象防災速報は1件＝1カード。見出しは電文の `Report/Head/Title` をそのまま表示し発表時刻（H6の表記）を併記、固定対象名は出さない。カード間は発表時刻の新しい順（§5.6）、速報群は列の最上部（§5.2順維持）で件数分の押し下げを許容。会場フィルタは既存実装済みでG1は受け取った件数分を描画するだけ。竜巻目撃情報の区別・記録的短時間大雨のフィルタ地域の確認はG2へ申し送り | §3.2、§3.3、§3.4、§6、AC-4・AC-5 |
| H6 | 追加回答（§9のQ1〜Q5）: 速報見出しに固定対象名を出さない、時刻は当日のみ時刻・当日以外は日付併記、地域時系列予報は「東京地方」、速報・警報とも非表示時に「発表なし」を置かない、HDは1280×720、iPadは幅1180pxを設計基準とし実機確認はiPad Pro 11インチ（1194幅） | §3.3、§4.1、§5、AC-10・AC-11 |

## 3. 構成

### 3.1 モジュール構成

新規ディレクトリ `apps/web/src/map/panels/` を設ける（ファイル名は製造担当の裁量で変更可）。

| ファイル | 役割 |
|---|---|
| `panelDefinitions.ts` | 6パネルのID・表示名・分類・順序の定義（単一の配列） |
| `panelTargets.ts` | 会場IDから各パネルの対象名を引く関数（`venueForecastTargets` を正とする） |
| `panelDisplayState.ts` | 状態入力から枠の表示形態を決める純粋関数 |
| `InfoPanelFrame.tsx` | 共通枠（見出し・状態表示・children 差し込み口） |
| `InfoPanelColumn.tsx` | 6パネルを§5.2順に並べる。スロットの children として渡す |
| `panels.css` | 枠のスタイル（色はMD3トークンのみ） |

`MapInformationColumnSlot` は変更最小とし、既定のプレースホルダーカード3枚を撤去して `WeatherMapView` から `<InfoPanelColumn />` を children に渡す。スロットの ref（中心補正用の幅計測）は変更しない。スクロール・`pointer-events` は §4.2 の改訂に従う。

### 3.2 型定義

```ts
export type InfoPanelId =
  | 'bosaiBulletin'     // 気象防災速報（竜巻含む）
  | 'warning'           // 警報・注意報
  | 'warningTimeSeries' // 警報等時系列
  | 'earlyWarning'      // 警報級の可能性
  | 'amedas'            // アメダス
  | 'areaForecast';     // 地域時系列予報

/** always: 常時あるべき情報 / occasional: 常時あるとは限らない情報 */
export type InfoPanelPresence = 'always' | 'occasional';

export interface InfoPanelDefinition {
  readonly id: InfoPanelId;
  readonly title: string;        // UI表示名（§5.2の名称）
  readonly presence: InfoPanelPresence;
}

/** パネルへ渡す状態入力。G2〜G7の結線時に各パネルが組み立てる */
export type InfoPanelStatus =
  | { readonly kind: 'loading' }                       // 初回取得中（保持値なし）
  | { readonly kind: 'failed' }                        // 取得失敗かつ保持値なし
  | { readonly kind: 'empty' }                         // 正常取得・発表なし（occasional用）
  | { readonly kind: 'data'; readonly availability: 'available' | 'stale';
      readonly time: string;                           // 発表／観測時刻 ISO8601
      readonly timeKind: 'issued' | 'observed' };

export type InfoPanelDisplay =
  | { readonly mode: 'hidden' }
  | { readonly mode: 'skeleton' }
  | { readonly mode: 'failed' }
  | { readonly mode: 'content'; readonly time: string; readonly timeKind: 'issued' | 'observed' };

export function resolveInfoPanelDisplay(
  presence: InfoPanelPresence,
  status: InfoPanelStatus,
): InfoPanelDisplay;
```

種別ごとに0枚以上のカードを出せる構造とするため、`InfoPanelColumn` へ渡す入力を種別単位の配列とする。

```ts
/** 1カード分の入力 */
export interface InfoPanelCardInput {
  readonly key: string;            // Reactのkey（速報は電文ID等）
  readonly heading?: string;       // 省略時は definition.title（速報は Report/Head/Title）
  readonly status: InfoPanelStatus;
  readonly content?: ReactNode;
}

/** 種別ごとの入力。always 種別は常に1件、occasional 種別は0件以上 */
export type InfoPanelColumnInput = Readonly<Record<InfoPanelId, readonly InfoPanelCardInput[]>>;
```

`InfoPanelFrame` のprops: `{ definition: InfoPanelDefinition; heading?: string; target?: string; status: InfoPanelStatus; children?: ReactNode }`。`display.mode === 'hidden'` のときは何も描画しない（`null`）。`content` のときだけ children を描画する。

`availability` は `packages/shared` の `Availability` と対応させる（`unavailable` かつ保持値なしが `failed`）。3状態を別名の独自型で再定義しない。

### 3.3 見出し

- 1行目: パネル名（速報は `heading`）。2行目: 対象名と時刻（例 `江東区 · 14:05発表`、アメダスは `江戸川臨海 · 14:10観測`）。
- 時刻はJSTで表記する。表示時点のJST日付と同日なら時刻のみ（例 `14:05発表`）、それ以外は日付を併記（例 `9/23 14:05発表`、月日はゼロ埋めなし）。観測は `観測` を付ける。
- `skeleton`・`failed` のときは時刻を表示しない（対象名は表示する）。
- 対象名は会場ID（端末台帳の `terminal.venue`）から `panelTargets.ts` で決め、地図の表示位置・選択レイヤーを入力に取らない（依存しない構造でH5を担保）。

| パネル | east | trc |
|---|---|---|
| 気象防災速報 | 固定対象名なし。見出しは電文の `Report/Head/Title`（例「東京都気象防災速報（竜巻注意）」）＋発表時刻。区域名はG2の中身で示す | 同左 |
| 警報・注意報 | 江東区 | 大田区 |
| 警報等時系列 | 江東区 | 大田区 |
| 警報級の可能性 | 東京地方 | 東京地方 |
| アメダス | 江戸川臨海 | 羽田 |
| 地域時系列予報 | 東京地方 | 東京地方（気温地点の東京（北の丸公園）はG7の中身で示す） |

気象防災速報は§5.1で「広域速報は元の対象区域名を表示し、会場の市町村単独の情報へ書き換えない」【確定】とされるため、見出しに会場の市町村名を固定表示すると誤解を招く。区域名は各速報の中身（G2）に表示する案とする。

### 3.4 気象防災速報の複数カード（H7）

- 1件＝1カード。1枚にまとめない。
- カード間の並びは発表時刻の新しい順（§5.6）。同時刻の並びは電文受信順の新しい順を【設計案・製造裁量】とする。ソートは `InfoPanelColumn` で行い、呼び出し側の順序に依存しない。
- 速報群は列の最上部（§5.2の順を維持）。件数分だけ下のパネルが押し下がることは許容する。
- 会場フィルタは既存実装（`packages/shared/src/venueForecastTargets.ts` の includedAreaCodes と weatherApiService）で済んでいる前提とし、G1は受け取った件数分を描画するだけとする。
- 0件は何も描画しない（§5の occasional 規則）。
- 基本設計との差の指摘: §5.2・§5.6は「パネル＝種別ごとに1枚」とも読める記述である。本設計はユーザー決定（H7）により速報を件数分のカードとする。基本設計は本Issueでは編集せず、統括担当の判断に委ねる。
- 警報・注意報は現時点で1カードとする（件数分割はG3の判断）。

## 4. レイアウト・スクロール

### 4.1 列幅（現行clamp維持、H3）

`--wx-map-right-column-width: clamp(18rem, 25vw, 28rem)`、768px以下は `16rem`。ルートfont-sizeは既定の16px（`index.css` に `html` のfont-size指定なし）として算出した値。

| 画面 | viewport幅(CSS px) | 25vw | 列幅 | 状態 |
|---|---|---|---|---|
| FHD全画面（基準） | 1920 | 480 | 448（上限28rem） | 算出値。AC-8で実測 |
| FHDブラウザ最大化（基準） | 1920×960 | 480 | 448（上限28rem） | 算出値。AC-9で実測 |
| HD | 1280×720（確定） | 320 | 320 | AC-10で実測 |
| iPad 11インチ横 | 1180（設計基準。Pro以外の11インチも対応） | 295 | 295 | AC-11でエミュレーション実測 |
| iPad Pro 11インチ横（実機確認機） | 1194 | 298.5 | 298.5 | AC-11で実機計測 |

- OSの表示拡大率（Windowsの125%等）・ブラウザズームでCSS幅は変わる。上表は100%前提とし、この前提はユーザー了承済み（拡大率自体はAD-H019で未確定のまま）。
- 小さい画面（HD・iPad）で成立すれば大きい画面でも成立するものとして扱う（ユーザー回答）。
- 列の内側は `padding: 16px` のため、カード幅は列幅−32px（FHD 416px、HD 288px、iPad基準 263px、iPad Pro実機 266.5px）。

### 4.2 スクロール

- 列全体を縦スクロール（F1実装を維持）。パネルごとの内部スクロールや高さ上限は設けない。
- カード上のホイールは地図へ伝播させない（F1の `stopPropagation` を `InfoPanelFrame` のルート要素へ移す）。
- 【UI監修での改訂（ユーザー決定）】列（スロット）自体を `pointer-events: auto` とし、高さはカード量に合わせて縮む（上限は利用可能高さ）。カード間の隙間は列の一部として地図操作を受け付けない。カード群より下の透明部分（列の外）は従来どおり地図操作が可能。列に `overscroll-behavior: contain` を指定し、iPad Safari でページ全体へスクロールが連鎖しないようにする。背景は透明のまま。
  - 理由: 監修時、Chrome・iPad Safari でカード間の隙間から地図が操作でき、iPad Safari ではカード上のタッチスクロールがページ全体のスクロールになった（`pointer-events: none` のスクロール容器が WebKit のスクロール対象判定から外れるためと推定）。
- パネル表示・非表示の切替で閲覧位置が跳ぶことを避ける仕組み（スクロールアンカー制御）は本Issueでは設けない。ブラウザ既定の `overflow-anchor` に任せる。

## 5. 状態別の表示（H4、G9からの引継ぎ）

`resolveInfoPanelDisplay` の対応表:

| status | always（警報等時系列・警報級の可能性・アメダス・地域時系列予報） | occasional（気象防災速報・警報・注意報） |
|---|---|---|
| loading | skeleton | hidden |
| failed | failed（本文「取得できませんでした」） | hidden |
| empty | 該当なし（always では渡さない。渡された場合は failed ではなく skeleton とする【設計案】） | hidden |
| data / available | content | content |
| data / stale | content（前回値。stale表示を付けない） | content（前回値） |

- stale: 前回値を黙って表示する。削除や「取得できませんでした」への縮退をしない。stale を示す装飾・色も付けない。
- 一部欠測: 各パネル（G2〜G7）のコンテンツ責務。枠は関与しない。
- 取得異常の告知: パネルでなく通知領域の責務。端末内診断の静的表示は #211（H5）。
- occasional の `loading` を hidden とするのは「データがないときはカードを出さない」の適用。初回取得完了前に速報・警報が表示されない時間が生じるが、ユーザー了承済みとして確定事項どおりとする。
- 速報・警報とも非表示のとき「発表なし」等の表示は置かず、最上部は警報等時系列になる（ユーザー回答）。
- skeleton: 見出し（パネル名・対象名）＋本文のプレースホルダー矩形。高さは固定値（例 96px）とし、アニメーションの有無は製造裁量。色は `surface-container-highest` 等のMD3トークン。
- 失敗文言は `on-surface-variant`。エラー色（`error`）は使わない（異常告知は通知領域の責務のため）。

### 5.1 管理項目の結論

| ID | 本Issueでの結論 |
|---|---|
| AD-H004 stale画面表現と状態色 | パネルではstaleを装飾せず前回値を表示する。状態色は付けない。§5.12の非表示案は、occasional情報の「データなし・失敗時は非表示」として採用し、stale時は非表示にしない。通知領域側の表現は本Issueの範囲外 |
| AD-H022 ブラウザ疎通異常 | パネルは疎通異常を表示しない（保持値があれば前回値、なければ always は「取得できませんでした」）。告知・成功対象・復帰条件は通知領域／H5の責務として本Issueでは未決のまま引き継ぐ |
| AD-H049 早期注意の二表・日界 | 枠は1パネル＝1時刻の見出しのみ提供。二表それぞれの発表時刻表示・3状態の結線はG5の責務として引き継ぐ（§8） |
| AD-H070 気象snapshotの鮮度評価 | 鮮度判定（stale化の閾値）は枠では行わず、入力の `availability` をそのまま使う。閾値・評価はデータ結線側（G2〜G7／API）へ引き継ぐ |
| AD-H019 主解像度・小画面と拡大率 | 主解像度はFHD（全画面・1920×960最大化）、副次対象はHD（1280×720）・iPad 11インチ横（幅1180px基準）と確定（H1・H6）。iPad縦は対象外。拡大率は未確定のまま100%前提で検証（ユーザー了承済み） |

## 6. 仮データでの表示

実データ結線前でも受け入れ確認ができるよう、`InfoPanelColumn` は各パネルの `status` を props（省略時は既定値）で受け取る。既定値は全パネル `loading`（always 4枚がスケルトン、occasional 2枚は非表示）とする。

検収用に、開発ビルド限定でURLクエリ `?panelFixture=<名前>` から状態セットを切り替える仕組みを設ける【設計案・製造裁量】。本番ビルドでは無効化する。フィクスチャ名:

| 名前 | 内容 |
|---|---|
| `all-content` | 速報2件（見出し「東京都気象防災速報（竜巻注意）」14:05、「東京都気象防災速報（記録的短時間大雨）」13:40、入力は古い順に渡す）＋他5種各1枚、すべて data/available、本文はダミー（高さ約200pxの文言ブロック） |
| `mixed` | 速報 empty、警報 data/stale、時系列 failed、可能性 loading、アメダス data/stale、予報 data/available |
| `failed` | 6枚すべて failed |

ダミー本文は既存プレースホルダーと同様に「（G2で実装）」等と中身未実装が分かる文言とする。

## 7. 受け入れ条件

前提: `npm run dev` の起動・停止は[01-dev-workflow-protocol.md](../rules/01-dev-workflow-protocol.md)の規定に従う。計測は[G-08](../rules/advisory/G-08-ui-measurement-pitfalls.md)を踏まえ `getBoundingClientRect()` で行い、値を記録する。

- [ ] AC-1: `npm run lint` / `npm run typecheck` / `npm run format:check` / `npm run test -w apps/web` がすべて成功する。
- [ ] AC-2: `resolveInfoPanelDisplay` の単体テストが §5 の表の全セル（2分類×5状態）を網羅する。表の1セル（例: always×stale を skeleton に）を意図的に変えるとテストが失敗することを確認し、戻す。
- [ ] AC-3: `panelDefinitions` の順序が §5.2 と一致することをテストで確認する（id配列の完全一致）。`panelTargets` が east/trc それぞれ §3.3 表の対象名を返すことをテストで確認する。
- [ ] AC-4: `?panelFixture=all-content` で、右側列のカード見出しを上から読むと「東京都気象防災速報（竜巻注意）14:05発表／東京都気象防災速報（記録的短時間大雨）13:40発表／警報・注意報／警報等時系列／警報級の可能性／アメダス／地域時系列予報」の順である（DOM順とy座標の昇順の両方）。速報2枚が発表時刻の新しい順で最上部にあり、固定対象名が表示されない。加えて、並べ替えの単体テストで入力順（古い順・新しい順）によらず新しい順になることを確認する。
- [ ] AC-5: `?panelFixture=mixed` で、速報カードが存在しない（DOMにもない）、警報カードとアメダスカードは本文を表示しstale表示や警告色がない、時系列カードは「取得できませんでした」、可能性カードはスケルトン、予報カードは本文を表示する。`failed` で always 4枚が「取得できませんでした」、occasional 2枚が存在しない。
- [ ] AC-6: east端末とtrc端末それぞれで見出しの対象名が §3.3 表と一致する（速報は固定対象名なし、地域時系列予報は「東京地方」）。時刻が当日なら `HH:mm発表`、前日以前なら `M/D HH:mm発表` になることを表示ロジックの単体テストで確認する（日付境界 00:00 JST 前後を含む）。地図をドラッグ・ズームし、レイヤーを切り替えた後も対象名・時刻が変化しない。
- [ ] AC-7: `all-content` で列が縦スクロールでき、最下部の地域時系列予報カード全体が表示できる。カード上でホイールしても地図のズームが変化しない。カード群の下の透明部分で地図をドラッグ・ホイールでき、地図が動く。カード間の隙間でドラッグ・ホイールしても地図が動かない。iPad Safari 実機でカード上をタッチスクロールすると列だけがスクロールし、ページ全体がスクロールしない（列の端に達した後も含む）。F1の中心補正（右列幅を考慮した初期表示中心）が従来と同じ位置である。
- [ ] AC-8: FHD全画面（1920×1080相当のviewport）で列幅448px、カード幅416pxを実測し記録する。横スクロールが発生しない。
- [ ] AC-9: 1920×960 のviewportで列幅448pxを実測し、`all-content` で最下部カードまでスクロール到達できる。
- [ ] AC-10: 1280×720 のviewportで列幅320px、カード幅288pxを実測し、見出しの対象名・時刻（日付併記の `9/23 14:05発表` 形式を含む）が切れずに（折り返しは可）表示される。
- [ ] AC-11: (a) 1180×820 のviewportで列幅295px、カード幅263pxを実測し、見出しが切れない（折り返しは可）。(b) iPad Pro 11インチ横の実機（またはユーザーの実機確認）で `window.innerWidth`（1194を想定）と列幅を記録し、見出しが切れず、指のスワイプで列が縦スクロールし、カード外で地図をパンできる。(b)は実機で確認できない場合にエミュレーションで合格とせず「実挙動未確認」として統括へ返す。
- [ ] AC-12: 色のHEX直書きがない（`panels.css` と新規tsxを `#[0-9a-fA-F]{3,8}\b` で検索し0件）。
- [ ] AC-13: `git diff --stat main` で変更が `apps/web/src/map/` 配下・`apps/web/tests/` 配下に限られ（例外: `apps/web/src/index.css` への `panels.css` の import 1行は既存 `map.css` と同じ読み込み方式として許容する。検収で判明した設計漏れをユーザー承認のうえ改訂）、`map.css` の `--wx-map-right-column-width` 定義に差分がない。

## 8. 後続Issueへの引き継ぎ

- G2〜G7: 各パネルは `InfoPanelFrame` に `status` と children を渡す。一部欠測・中身の状態区別（なし／値なし／未取得等）は各パネルで実装する。`always` のパネルで「正常取得・発表なし」を表す場合の表現は各パネルで定義する。
- G5: 二表の発表時刻を見出しの1時刻でどう示すか（代表時刻＋本文内明示等）を決める（AD-H049）。
- G2: 速報は1件＝1カードで `heading` に `Report/Head/Title` を渡す。区域名は中身で示す。竜巻目撃情報の区別（`Control/Title` にのみ「目撃情報付き」が現れるサンプルがある）と、記録的短時間大雨の会場フィルタが Head と Body のどちらの地域で行われているかの確認を申し送る。
- G4〜G7: 列幅（HD 288px・iPad 約265pxのカード幅）で窮屈な場合は列幅再検討を統括へ上げる（H3）。
- データ結線: stale閾値（AD-H070）・`availability` の算出はAPI側の値を使う。
- 通知領域／H5 #211: 取得異常の告知（AD-H022）。

## 9. 未確定事項・実挙動未確認

ヒアリング事項Q1〜Q5はユーザー回答により解消済み（H6として§2.1に記録し、本文へ反映）。

- ユーザー了承済みのリスク: 常時あるとは限らないパネルの初回取得中非表示、拡大率100%前提での検証。
- 実挙動未確認: iPad Pro 11インチ実機での表示（AC-11(b)で確認）、OS拡大率を掛けた場合の列幅。
