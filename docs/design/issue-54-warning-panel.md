# Issue #54 G3. 警報・注意報パネル 設計書

## 1. 目的と範囲

基本設計§5.7に基づき、会場の固定対象市町村(east: 江東区 `1310800`、trc: 大田区 `1311100`)の警報・注意報の現況を、G1(#52)の共通枠 `InfoPanelFrame` の中身としてバッジ群で表示する。データは E1(#33)の `GET /api/weather/warnings` から取得する。

**やること**

- 見出し「気象警報・注意報」、補助ラベル(対象市町村名)、現況に反映した発表時刻の表示
- バッジ群(危険度カラー+文字、段階順・段階内固定順、短縮表記、折り返し)
- 新規・強化・緩和の補助表示(タイマーなし、データのみで判定)
- 実 API との結線(ポーリング)と開発用フィクスチャ

**やらないこと**

- 承認/差戻ボタン・行ごとの確認操作(§3.2)
- 詳細ダイアログ(G10 #61)。付加事項・発表官署はそちらへ引き継ぐ
- API・共通型(`packages/shared`)・保存・reducer・通知分類の変更
- 洪水 04/18 の未対応表示(§2.1 確定事項3)
- `stale` の保持値の見せ方の確定(G9 #60 の未決)
- 取得状態の常時表示(監視画面・通知領域の責務。本Issueでは実装しない)

## 2. 参照資料と設計判断の根拠

| 資料 | 採用した内容 |
|---|---|
| Issue #54 本文 | やること・やらないこと・受け入れ条件・追加受け入れ条件 |
| `docs/basic-design.md` §5.1 | 固定対象(江東区/大田区)。地図移動に連動させない |
| 同 §5.2 | 配置順2番目(既に G1 で実装済み) |
| 同 §5.4【確定】 | 解除行は現況から外し、「解除」を残さない |
| 同 §5.7 | バッジ短縮表記・段階順・公式配色・レベル5のダーク表現は【確定】。コード表と段階内固定順は【設計案】の表(§2.2) |
| 同 §5.12 | 正常空はパネル省略。`unavailable` と `stale` は別。stale の見せ方は G9 未決 |
| 同 §7.4 | コード対応表(Warning/Item/Kind/Code)。通知区分名を気象情報名の代わりに表示しない |
| `docs/design/issue-33-warning-rest-apis.md` §3 | `WarningsResponse`、`capabilities.unsupportedKindCodes = ['04','18']`、未取得は `data:null`+`availability:'unavailable'`、正常空は `items:[]`。`metadata.issuedAt` は「現況を構成する snapshot の出所」の発表日時 |
| `docs/design/issue-13-warning-current-state.md` §3.5・§3.6 | 発表中集合に入る `kindStatus` は `発表`・`継続`・`特別警報から危険警報`・`特別警報から警報`・`特別警報から注意報`・`危険警報から警報`・`危険警報から注意報`・`警報から注意報` の8値。段階は注意報1〜特別警報4 のコード明示表 |
| `docs/design/issue-52-info-panel-layout.md`・`issue-53-bosai-bulletin-panel.md` | 共通枠・状態入力・occasional 規則・API クライアント/フックの流儀 |
| `docs/design/issue-90-semantic-colors.md`・`apps/web/src/theme/semanticColors.ts` | `--wx-alert-level-{2..5}-{container,on-container,outline}` |
| `docs/audit-epic-a-d.md` AD-H020/044/046 | §8 に結論を記録 |

### 2.1 ヒアリング確定事項(2026-09-25、統括経由)

1. **強調保持**: タイマーを持たない。「現況に反映した最新発表で変化した行」の間だけ強調し、各 item の `kindStatus`/`lastKindCode` 等のデータのみで判定する。VPWS50 の定期集約で `継続` に戻り強調が短時間で消える可能性は未確認事項として記録する(§9)。
2. **補足DTO(AD-H046)**: 追加しない。バッジと発表時刻に絞る。付加事項・発表官署は G10 へ引き継ぐ。API・共通型・保存は変更しない。
3. **洪水 04/18(AD-H044)**: 画面に未対応である旨を表示しない。#33 §9 との緊張関係と見落としリスクを §8 に記録する。
4. **レベル5縁(AD-H020)**: 既存トークンを使う。検収でレベル5・4・3・2のバッジを並べた実画面スクリーンショットを取得し、縁が1px以上あることを確認する。最終的な目視判断はエポック終了時のユーザー監修とし、本Issueで確定扱いにしない。

### 2.2 【設計案】の表の採用

§5.7 の「コード・段階色・バッジ表記の対応」表は【設計案】であるが、Issue #54 のやること(段階順・同段階内は§7.4コード表の固定順)として**本Issueで採用する**。短縮表記の規則と段階順(特別警報→危険警報→警報→注意報)は§5.7で【確定】。段階内の並べ替えは行わず表の記載順をそのまま用いる。

### 2.3 実物確認の結果

- `WarningCurrentItem`(`packages/shared/src/weatherApi.ts`)は `sequence, kindCode, kindName, kindStatus, lastKindCode, lastKindName, kindIssuedAt, sourceTelegram`。`kindCode` は2桁文字列(`'03'` 等。`apps/api/src/polling/jmaWarningCurrentReducer.ts` の `WARNING_CODE_TABLE` で確認)。
- `WARNING_CODE_TABLE` は API 側の非公開モジュールで web から import できない。web 側に表示用の表を別途持つ(段階は同表と一致させる。§3.3)。
- `panelDefinitions.ts` の `warning` の title は「警報・注意報」、presence は `occasional`。`InfoPanelCardInput.heading` で見出しを上書きできる。
- `InfoPanelFrame` は見出し2行目に `target`(`panelTargets.ts` の `warning.displayName`=江東区/大田区)と `formatPanelTime` による時刻(当日は `HH:mm発表`、他日は `M/D HH:mm発表`。G1 H6 でユーザー承認済み)を出す。
- `WeatherMapView.tsx` は `useBosaiBulletins` の結果を `infoPanelInput` に入れている。同じ形で `warning` を差し込む。
- 実電文(東京対象の VPWW54〜61/VPWS50)はクラウド環境に無く、実電文との照合は未実施。`LastKind` と `Status` の意味は気象庁「気象警報・注意報(R06)のXMLフォーマット解説」(令和6年10月31日版、令和8年4月30日追記まで)で確定した(§4.3)。

## 3. 構成

### 3.1 モジュール構成

ファイル名・内部関数分割は製造裁量。§7 の許可一覧の外に出ないこと。

| ファイル | 種別 | 役割 |
|---|---|---|
| `apps/web/src/api/warnings.ts` | 新規 | `fetchTileCatalog` を `path: '/api/weather/warnings'` で呼び、`parseWarningsResponse` で検証 |
| `apps/web/src/map/panels/warning/warningBadges.ts` | 新規 | 純粋関数: コード表、並べ替え、短縮表記、変化種別判定、カード入力組み立て。カード入力の `content` 組み立てに限り `createElement` を使う(既存 `bosaiBulletinCards.ts` と同じ作り。JSX・hooks は使わない) |
| `apps/web/src/map/panels/warning/useWarnings.ts` | 新規 | `useTileCatalogPolling` によるポーリング。`InfoPanelCardInput[]` を返す |
| `apps/web/src/map/panels/warning/WarningBadgeList.tsx` | 新規 | バッジ群の描画 |
| `apps/web/src/map/panels/warning/warningPanel.css` | 新規 | スタイル。`apps/web/src/index.css` に `@import` 1行を追加して読み込む(G2 と同じ流儀) |
| `apps/web/src/map/WeatherMapView.tsx` | 変更 | `useWarnings` を呼び、`infoPanelInput` に `warning: warningCards` を追加 |
| `apps/web/src/map/panels/panelFixtures.ts` | 変更 | フィクスチャ `warning-badges` を追加(§6) |
| `apps/web/tests/warningPanel.test.ts` | 新規 | 単体テスト |

### 3.2 型・シグネチャ

```ts
// apps/web/src/api/warnings.ts
export function parseWarningsResponse(body: unknown, requested: WeatherControlStatus): WarningsResponse | null;
export function fetchWarnings(params: {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly signal: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}): Promise<TileCatalogResult<WarningsResponse>>;
```

`parseWarningsResponse` の検証: ルートがオブジェクト、`controlStatus === requested`、`isTraining === (requested === 'training')`、`metadata` がオブジェクトで `availability` が `available|stale|unavailable` のいずれか、`metadata.issuedAt` が文字列か null、`data` が null またはオブジェクトで `items` が配列、各 item の `kindCode`・`kindName`・`kindStatus` が文字列、`lastKindCode` が文字列か null、`sequence` が数値。不一致は null(取得失敗扱い)。`capabilities` は検証も使用もしない(§2.1-3)。

```ts
// apps/web/src/map/panels/warning/warningBadges.ts
export type WarningStage = 'special' | 'danger' | 'warning' | 'advisory'; // 特別警報/危険警報/警報/注意報
export interface WarningBadgeDefinition {
  readonly code: string;       // 2桁
  readonly stage: WarningStage;
  readonly label: string;      // 短縮表記
  readonly order: number;      // 段階内固定順(0始まり)
}
export const WARNING_BADGE_TABLE: Readonly<Record<string, WarningBadgeDefinition>>;
export type WarningChange = 'new' | 'strengthened' | 'weakened' | null;
export function resolveWarningChange(item: WarningCurrentItem): WarningChange;
export interface WarningBadge {
  readonly code: string;
  readonly stage: WarningStage;
  readonly label: string;
  readonly change: WarningChange;
}
/** 表にあるコードだけを段階順→段階内固定順で返す。表にないコードは除き、件数を別に返す */
export function buildWarningBadges(items: readonly WarningCurrentItem[]): {
  readonly badges: readonly WarningBadge[];
  readonly unknownCodes: readonly string[];
};
export function buildWarningCards(response: WarningsResponse, availability: 'available' | 'stale'): readonly InfoPanelCardInput[];
```

### 3.3 コード表(§5.7 表を2桁化)

| 段階(stage) | 色トークン | 固定順 |
|---|---|---|
| special | `--wx-alert-level-5-*` | 32 暴風雪特別警報／33 レベル5大雨特別警報／35 暴風特別警報／36 大雪特別警報／37 波浪特別警報／38 レベル5高潮特別警報／39 レベル5土砂災害特別警報 |
| danger | `--wx-alert-level-4-*` | 43 レベル4大雨危険警報／48 レベル4高潮危険警報／49 レベル4土砂災害危険警報 |
| warning | `--wx-alert-level-3-*` | 02 暴風雪警報／03 レベル3大雨警報／04 洪水警報／05 暴風警報／06 大雪警報／07 波浪警報／08 レベル3高潮警報／09 レベル3土砂災害警報 |
| advisory | `--wx-alert-level-2-*` | 10 レベル2大雨注意報／19 レベル2高潮注意報／29 レベル2土砂災害注意報／12 大雪注意報／13 風雪注意報／14 雷注意報／15 強風注意報／16 波浪注意報／17 融雪注意報／18 洪水注意報／20 濃霧注意報／21 乾燥注意報／22 なだれ注意報／23 低温注意報／24 霜注意報／25 着氷注意報／26 着雪注意報／27 その他の注意報 |

- ラベルは表の文字列を固定で使う。`kindName`(電文の名称)をラベルに使わない。名称の部分一致・コード値の大小で段階を決めない。
- 04/18 は表に含める(§5.7 の表どおり)が、#33 の契約上 API からは返らない。
- 表の段階と `WARNING_CODE_TABLE` の `level` が一致すること(注意報1=advisory…特別警報4=special)を AC-3 で確認する。27 は `WARNING_CODE_TABLE` 側に無い可能性があり、その場合は web 側だけの定義となる(現況に来ないだけで害はない)。
- **表にないコード**(未定義・予約コード)はパネルに描画しない【確定・2026-09-25 ユーザー回答 Q1】。理由はユーザー判断「K端末への通知で確認できるはず」。`unknownCodes` を返すだけとし、低い段階へ自動割り当てしない(§7.4)。ただし、表外コードが実際に K 端末通知へ到達するかは**未検証**である(#13 では未対応コードの電文はストリームに採用されない)。この経路は確定事実として扱わない(§9)。

## 4. 振る舞い

### 4.1 見出し

- 1行目: `heading: '気象警報・注意報'`(`panelDefinitions.ts` の title は変更しない)。
- 2行目: 共通枠の `target`(江東区/大田区)と時刻。時刻は `metadata.issuedAt`(現況に反映した発表の時刻)を `status.time`、`timeKind: 'issued'` で渡す。個々の `kindIssuedAt` を見出しに使わない。取得時刻(`fetchedAt`)・評価時刻(`evaluatedAt`)を発表時刻として使わない。
- 時刻の書式は G1 共通の `formatPanelTime`(当日 `HH:mm発表`、他日 `M/D HH:mm発表`)に従う【確定・2026-09-25 ユーザー回答 Q2】。§5.7 と Issue の「○月○日○時○分 発表」とは書式が異なる。この差異は共通書式への統一として意図したものである。
- `data` があり `items` が非空で `metadata.issuedAt` が null の場合は契約外として、そのカードを出さない(取得失敗と同じ扱い)。

### 4.2 バッジ群

- 各バッジは `WarningBadge.label` の文字列を表示し、段階の container/on-container 色で塗り、**全段階で** `1px solid` の outline トークンの縁を付ける(レベル5は§5.7【確定】の紫縁、他段階は同じ構造で統一)。
- `display:flex; flex-wrap:wrap; gap` で横並び・折り返し。横スクロールなし。ラベルは折り返さない(`white-space: nowrap`)。
- 色は補助。段階・種別はラベル文字で分かる。HEX・`rgb()` を書かない。通知区分(非常ブザー・問いかけ・警報)の名称・色トークン(`--wx-notice-*`)を使わない。

### 4.3 新規・強化・緩和の補助表示(§2.1-1)

`resolveWarningChange(item)` は次の順で判定する。タイマー・前回応答との比較・ローカル保存を使わない。

| 条件 | 結果 |
|---|---|
| `kindStatus` が「○○から○○」の6値のいずれか | `weakened`(緩和) |
| `kindStatus === '発表'` かつ `lastKindCode` が表にあり、その段階 < 現コードの段階 | `strengthened`(強化) |
| `kindStatus === '発表'` かつ `lastKindCode === null` | `new`(新規) |
| 上記以外(`継続`、`発表` で `lastKindCode` が同段階・高段階・表外・`'00'` 等) | `null`(強調なし) |

- 表示は該当バッジの直後(同じバッジ内の末尾)に「新規」「強化」「緩和」の文字を付ける【設計案】。色は `--md-sys-color-*` のみ。文字で区別でき、色だけに依存しない。
- 次の発表で `継続` になれば強調は消える。最新発表が VPWS50 定期集約で全項目が `継続` になった場合、個別電文での変化の強調が短時間で消える可能性がある(§9 未確認)。
- **Q3 は公式資料で確定した(実電文との照合は未実施)**。根拠は気象庁「気象警報・注意報(R06)のXMLフォーマット解説」(令和6年10月31日版、令和8年4月30日追記まで)の次の記述:
  - §3-2-4-1-1-2 LastKind部(市町村等): 前回電文で同一現象の警報・注意報が発表中だった場合に、前回の内容(Name/Code/Condition)を記載する。発表されていなかった場合は記載しない。記載例は、`Status=発表` の大雨警報(03)に LastKind 大雨注意報(10)。
  - §3-2-4-1-1-1 解説1: `"00"`(解除)のコードは使用しない。
  - Status の定義は §3-2-1-1-1-1 解説3 と同じ(`発表`=前回電文で発表中でなく、今回発表中)。同解説3により、暴風雪特別警報・警報と風雪注意報、暴風特別警報・警報と強風注意報は同一現象の組み合わせと同等に扱われ、LastKind に記載される場合がある。
- 結論: 新規=`発表` かつ `lastKindCode === null`、強化=`発表` かつ `lastKindCode` が低い段階、であり、上の判定表と一致する。**判定表の変更は不要**。`'00'` は LastKind に現れないため、表の「`'00'` 等→強調なし」は防御的な分岐として残す。暴風05←強風15、暴風雪02←風雪13 のような組み合わせも段階比較で強化と判定される。
- 実電文との照合は任意の追加確認として残す(§9)。

### 4.4 取得状態(G1 occasional 規則)

`useWarnings` の返り値:

| 状態 | 返すカード |
|---|---|
| ポーリング `loading` / `failed`(保持値なし) | `[]` |
| 応答 `data === null`(`availability: 'unavailable'`、未取得) | `[]` |
| 応答 `data.items` が空(正常な発表なし) | `[]`(「発表なし」等を置かない。§5.7・G1 H6) |
| 応答 `data.items` に表内コードがある | 1件のカード。`status.availability` は応答の `availability`(`available`/`stale`) |
| ポーリング `stale`(取得失敗・前回応答あり) | 前回応答から `availability: 'stale'` で組み立て |

- `stale` は G1 の現行どおり装飾なしで前回値を表示する。これは G9 #60 の決定までの暫定であり、確定扱いにしない。
- カードの `key` は `'warning'` 固定(1件)。
- 「一部種別未確認」は現 API に種別ごとの確認状態がなく**判別できない**。`items` が空でも洪水 04/18 を含む全警報なしとは限らない(§8 AD-H044)。

### 4.5 会場・訓練

- 要求の `terminalId`/`controlStatus` は `WeatherMapView` の既存値をそのまま使う。会場指定で上書きしない。対象名は `panelTargets.ts` 由来で地図移動に依存しない。
- `parseWarningsResponse` は `controlStatus` 不一致・`isTraining` 矛盾を null とし、訓練データを本番表示に混ぜない。画面上の訓練表示は G1/G2 同様に付けない。

## 5. スタイル

- クラス名は `warning-badge-` 接頭辞。G1 の `.info-panel-*` を再定義しない。
- バッジ: `font-size: 14px` 程度、角丸・余白は製造裁量。縁 `border: 1px solid var(--wx-alert-level-N-outline)`。
- 変化の文字: 色を独自に指定せず、バッジの `--wx-alert-level-N-on-container` を継承する(`inherit`)。太字とし、`--md-sys-color-on-surface` を `color-mix()` で20%にした半透明の背景で小さなバッジとして区別する(暫定採用、2026-09-25。紫・赤バッジ上でもコントラスト比4.5以上を確認。見た目は後日ユーザー監修)。

## 6. 開発用フィクスチャ `warning-badges`

`WarningsResponse` を合成し、本番と同じ `buildWarningCards` を通す(合成データである旨をコメントに書く)。他パネルは `all-content` と同じ。

| # | kindCode | kindStatus | lastKindCode | 期待 |
|---|---|---|---|---|
| W1 | 14 | 継続 | null | 雷注意報、強調なし |
| W2 | 03 | 発表 | 10 | レベル3大雨警報、強化 |
| W3 | 29 | 発表 | null | レベル2土砂災害注意報、新規 |
| W4 | 48 | 継続 | null | レベル4高潮危険警報 |
| W5 | 38 | 継続 | null | レベル5高潮特別警報 |
| W6 | 15 | 警報から注意報 | 05 | 強風注意報、緩和 |
| W7 | 99 | 発表 | null | 描画されない(表外) |

期待表示順: レベル5高潮特別警報 → レベル4高潮危険警報 → レベル3大雨警報 → レベル2土砂災害注意報 → 雷注意報 → 強風注意報。`metadata.issuedAt` は当日 JST 14:00。レベル5・4・3・2が同時に並ぶため AC-11 のスクショに使う。

## 7. 変更を許可するファイル

- 新規: §3.1 の新規6ファイル
- 変更: `apps/web/src/index.css`(`@import` 1行のみ)、`apps/web/src/map/WeatherMapView.tsx`(`useWarnings` 呼び出しと `infoPanelInput` への1項目追加のみ)、`apps/web/src/map/panels/panelFixtures.ts`(`warning-badges` 追加のみ)
- 変更禁止: `apps/api/**`、`packages/**`、`apps/web/src/map/panels/` の既存ファイル(`InfoPanelFrame.tsx`・`panelDefinitions.ts`・`panelTime.ts`・`panels.css` 等)、`apps/web/src/theme/**`、既存テスト、設定ファイル

## 8. 管理項目の結論

| ID | 本Issueでの結論 |
|---|---|
| AD-H020 | 既存 `--wx-alert-level-5-*` を使い、全段階に1px縁を付ける。検収で実画面スクショ(AC-11)を取り縁幅を記録する。**視認性は確定扱いにしない**。最終目視はエポック終了時のユーザー監修。非常色(`--wx-notice-emergency-*`)との同時表示の識別は本パネルでは発生せず、H1/H2 側の確認事項として残す。 |
| AD-H044 | 洪水 04/18 は現況に採用されず(#33 §9)、画面にも未対応の旨を**表示しない**(ユーザー判断 2026-09-25)。#33 §9 の「未対応洪水を現象なしと表示しない」との緊張: パネル省略時、利用者は洪水を含め何も発表されていないと受け取り得る。**全件発表なしでパネルが省略されたとき、実際には洪水警報/注意報が発表中でも見落とすリスクがある**。本Issueでは解消せず、L2 #84 等の後続へ残す。保守事項を修正必須へ昇格させない。 |
| AD-H046 | 補足DTOは追加しない。付加事項・発表官署は表示しない(G10 へ引き継ぎ)。API・共通型・保存は変更しない。Issue の「会場別警報バッジと補足」のうち**補足は非対応**であり、PR の受け入れ条件対応表で実装済みと扱わない。 |

## 9. 未決事項・実挙動未確認

- 【未確認】VPWS50 定期集約の反映で、個別電文による `発表`/`XからY` が `継続` に置き換わり強調が短時間で消える可能性(§2.1-1)。
- 【確定】表外コードは描画しない(Q1)。見出し時刻は G1 共通書式(Q2)。
- 【未確認】表外コードが K 端末通知へ到達するか。#13 では未対応コードの電文はストリームに採用されないため、通知で確認できる経路は検証されていない。
- 【確定・公式資料】`LastKind` の有無・値と強化時の `Status`(Q3)。気象庁 XML フォーマット解説で確定し、判定表の変更は不要(§4.3)。実電文との照合は未実施で、任意の追加確認として残す。
- 【未決・G9】stale の見せ方。本Issueは装飾なしの前回値表示(G1 現行)を暫定とする。
- 【未確認】実データでの画面表示(dev 環境の DB に東京の警報発表が無い場合はフィクスチャのみで確認)。

## 10. 受け入れ条件

前提: dev サーバーの扱いは [01-dev-workflow-protocol.md](../rules/01-dev-workflow-protocol.md) に従う。単体テストは `apps/web/tests/warningPanel.test.ts`、描画確認は `renderToStaticMarkup`。

- [ ] AC-1 品質ゲート: `npm run lint`・`npm run typecheck`・`npm run format:check`・`npm run test -w apps/web` がすべて成功する。
- [ ] AC-2 並び順(単体): §6 の W1〜W6 を逆順・シャッフル順の2通りで `buildWarningBadges` に渡し、ラベル列が常に §6 の期待表示順に一致する。W7(`'99'`)は `badges` に含まれず `unknownCodes` に `'99'` が入る。
- [ ] AC-3 コード表(単体): `WARNING_BADGE_TABLE` が §3.3 の36コードを持ち、各ラベルが表の文字列と完全一致する。レベルを冠するのは 03/08/09/10/19/29/33/38/39/43/48/49 の12コードのみ(`/^レベル[2-5]/` で検査)。API の `WARNING_CODE_TABLE` と共通するコードについて、段階が対応すること(advisory=1…special=4)を、同表の値をテスト内に写した定数と照合する(API モジュールは import しない)。
- [ ] AC-4 変化判定(単体): `resolveWarningChange` が §4.3 の表の各行を満たす。最低限: (`発表`,null)→new、(`発表`,'10' で code '03')→strengthened、(`発表`,'43' で code '03')→null、(`発表`,'00')→null、(`継続`,null)→null、6種の「XからY」→weakened、(`発表`,'99')→null。
- [ ] AC-5 タイマーなし(静的): `apps/web/src/map/panels/warning/` 配下を `setTimeout|setInterval|localStorage|Date.now` で検索し0件。
- [ ] AC-6 解除・継続(単体): items [03 継続, 14 継続] の応答と、次の応答 [03 継続](14 は解除で現況から外れた状態)をそれぞれ `buildWarningCards`→`InfoPanelColumn` で描画し、後者に「雷注意報」「解除」の文字列がなく「レベル3大雨警報」が残る。
- [ ] AC-7 省略・状態(単体): (a) `data.items: []`、(b) `data: null`・`availability:'unavailable'`、(c) items が表外コードのみ、(d) items 非空で `issuedAt: null` のそれぞれで `buildWarningCards`(と `useWarnings` 相当の組み立て)が0件を返し、`InfoPanelColumn` の出力に「気象警報・注意報」「発表なし」がない。`availability:'stale'` の応答ではカードの `status.availability` が `'stale'`。
- [ ] AC-8 メタ情報・訓練(単体): `parseWarningsResponse` が正しい応答を受理し、`controlStatus` 不一致・`isTraining` 矛盾・`data.items` 非配列・`lastKindCode` が数値の応答を null にする。`metadata.issuedAt` を `2026-09-25T05:00:00Z`、`fetchedAt` と `evaluatedAt` と各 `kindIssuedAt` を別時刻にした応答で、見出しの時刻が `14:00発表`(issuedAt 由来)になり、他の時刻が出ない(`now` 固定)。
- [ ] AC-9 見出し・会場(単体+画面): `InfoPanelColumn` を `venueId='east'` と `'trc'` で描画し、見出し1行目「気象警報・注意報」、2行目に「江東区」/「大田区」が出る。
- [ ] AC-10 画面(フィクスチャ): `npm run dev` 起動中に east 端末で `?panelFixture=warning-badges` を開き、警報・注意報カードが速報の直下にあり、§6 の期待順・ラベル・「強化」「新規」「緩和」が表示され、W7 が DOM に無い。パネル幅を狭め(iPad 幅 1180px と 1280×720)バッジが折り返し、列に横スクロールが出ない(`scrollWidth <= clientWidth`)。
- [ ] AC-11 レベル5縁(AD-H020): AC-10 の画面でレベル5・4・3・2のバッジを含む範囲のスクリーンショットを取得し PR に添付する。各段階のバッジで `getComputedStyle(el).borderTopWidth` 等4辺が `1px` 以上であることを記録する。視認性の合否は判定せず「ユーザー監修待ち」と記載する。
- [ ] AC-12 実 API 結線: `?panelFixture` なしで開き、ネットワーク記録で `GET /api/weather/warnings?terminalId=<端末ID>&controlStatus=normal` が発行され 200、ポーリング間隔(`useTileCatalogPolling` 既定)で再発行されることを確認する。応答の items が空ならカードが無く、非空なら件数とラベルが一致することを記録する。
- [ ] AC-13 色: 新規ファイルを `#[0-9a-fA-F]{3,8}\b` と `rgb\(` で検索し0件。`--wx-notice-` の使用が0件。
- [ ] AC-14 境界確認(追加受け入れ条件): `git diff --stat main...HEAD` が §7 の範囲に限られ、`apps/api/`・`packages/` に差分がない。PR の対応表で、補足表示(AD-H046)・洪水未対応表示(AD-H044)・承認/差戻・詳細ダイアログ・stale 表示の確定を「非対応/範囲外」と記載し、実装済みと扱わない。
- [ ] AC-15 管理項目記録: 本設計書 §8 に AD-H020/044/046 の結論があり、PR 本文に転記されている。

## 11. 後続Issueへの引き継ぎ

- G10 #61: 付加事項・発表官署(補足DTO の新設要否を含む)
- G9 #60: stale の表示、取得状態の常時表示場所
- L2 #84 等: 洪水 04/18 の採用と、パネル省略時の見落としリスク(§8)
- H1/H2: 非常色とレベル5の同時表示の識別(AD-H020)
- エポック終了時: レベル5縁の目視監修(AC-11 のスクショを材料とする)
